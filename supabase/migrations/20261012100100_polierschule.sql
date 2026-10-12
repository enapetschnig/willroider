-- Polierschule zählt wie die Berufsschule (Wunsch 12.10.2026):
-- Tages-Soll wird gutgeschrieben (Monatsabschluss behandelt jeden
-- Nicht-Arbeits-Status so), kein Urlaubsabzug, in Tagesplanung/Polier-
-- Ansicht als abwesend geführt.

CREATE OR REPLACE FUNCTION public.stunden_tag_recompute()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tag_id    UUID := COALESCE(NEW.stunden_tag_id, OLD.stunden_tag_id);
  v_netto     NUMERIC;
  v_status    TEXT;
  v_urlaub    NUMERIC;
  v_ma        UUID;
  v_datum     DATE;
  v_soll      NUMERIC;
BEGIN
  SELECT COALESCE(SUM(stunden), 0),
         CASE
           WHEN bool_or(art = 'baustelle') THEN 'baustelle'
           WHEN bool_or(art = 'firma') THEN 'firma'
           WHEN bool_or(art = 'berufsschule') THEN 'berufsschule'
           WHEN bool_or(art = 'polierschule') THEN 'polierschule'
           WHEN bool_or(art = 'urlaub') THEN 'urlaub'
           WHEN bool_or(art = 'krank') THEN 'krank'
           WHEN bool_or(art = 'schlechtwetter') THEN 'schlechtwetter'
           WHEN bool_or(art = 'feiertag') THEN 'feiertag'
           ELSE NULL
         END
    INTO v_netto, v_status
    FROM public.stunden_taetigkeiten WHERE stunden_tag_id = v_tag_id;

  IF v_status IS NOT NULL THEN
    UPDATE public.stunden_tage
      SET netto_stunden = v_netto, tag_status = v_status::public.tag_status
      WHERE id = v_tag_id;
  ELSE
    UPDATE public.stunden_tage SET netto_stunden = COALESCE(v_netto, 0)
      WHERE id = v_tag_id;
  END IF;

  SELECT COALESCE(SUM(stunden), 0) INTO v_urlaub
    FROM public.stunden_taetigkeiten
    WHERE stunden_tag_id = v_tag_id AND art = 'urlaub';
  DELETE FROM public.urlaubs_buchungen
    WHERE art = 'urlaub_genommen' AND notiz LIKE 'TAG:' || v_tag_id || '%';
  IF v_urlaub > 0 THEN
    SELECT mitarbeiter_id, datum INTO v_ma, v_datum
      FROM public.stunden_tage WHERE id = v_tag_id;
    IF v_ma IS NOT NULL THEN
      -- Nenner = echtes Tages-Soll → ein voller Urlaubstag = 1,0.
      -- Fällt das Soll auf 0 (Wochenende/Feiertag), Fallback Tagesnorm.
      v_soll := public.tages_soll(v_ma, v_datum);
      IF v_soll IS NULL OR v_soll <= 0 THEN
        SELECT COALESCE(NULLIF(tagesnorm_stunden, 0), 8.0) INTO v_soll
          FROM public.profile_konten_settings WHERE profile_id = v_ma;
        v_soll := COALESCE(v_soll, 8.0);
      END IF;
      INSERT INTO public.urlaubs_buchungen
        (mitarbeiter_id, art, tage, wirksam_am, notiz, erstellt_von)
        VALUES
        (v_ma, 'urlaub_genommen', -ROUND(v_urlaub / v_soll, 2), v_datum,
         'TAG:' || v_tag_id || ' · ' || v_urlaub || ' h Urlaub (auto)',
         auth.uid());
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.plan_fuer_tag(p_datum date)
 RETURNS TABLE(mitarbeiter_id uuid, baustelle_id uuid, taetigkeit text, einteilung_id uuid, quelle text, abwesend boolean, abwesenheit_art text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH scope AS (
  SELECT public.planung_sichtbare_mitarbeiter(auth.uid()) AS ma
),
-- Ist p_datum ein Arbeitstag?
werktag AS (
  SELECT COALESCE(
    (SELECT CASE EXTRACT(isodow FROM p_datum)
              WHEN 1 THEN k.soll_mo WHEN 2 THEN k.soll_di
              WHEN 3 THEN k.soll_mi WHEN 4 THEN k.soll_do
              WHEN 5 THEN k.soll_fr WHEN 6 THEN k.soll_sa
              ELSE k.soll_so
            END > 0
       FROM public.arbeitszeitkalender k
      WHERE k.jahr = EXTRACT(isoyear FROM p_datum)::int
        AND k.kw   = EXTRACT(week    FROM p_datum)::int
      LIMIT 1),
    EXTRACT(isodow FROM p_datum) <= 5
  ) AS ist_werktag
),
-- Abwesenheiten aus denselben Quellen wie ladeTagesBelegung() in der
-- Tagesplanung — sonst führen die beiden Ansichten andere Leute als
-- abwesend. Reihenfolge = Vorrang: erfasster Tag schlägt Antrag.
abwesend AS (
  SELECT DISTINCT ON (x.ma) x.ma, x.art
    FROM (
      SELECT st.mitarbeiter_id AS ma, st.tag_status::text AS art, 1 AS prio
        FROM public.stunden_tage st
       WHERE st.datum = p_datum
         AND st.tag_status IN ('urlaub', 'krank', 'schlechtwetter', 'berufsschule', 'polierschule')
      UNION ALL
      SELECT km.mitarbeiter_id, 'krank', 2
        FROM public.krankmeldungen km
       WHERE p_datum BETWEEN km.von AND km.bis
      UNION ALL
      SELECT ua.mitarbeiter_id, 'urlaub', 3
        FROM public.urlaubsantraege ua
       WHERE ua.status = 'genehmigt'
         AND p_datum BETWEEN ua.von AND ua.bis
    ) x
   WHERE x.ma IN (SELECT ma FROM scope)
   ORDER BY x.ma, x.prio
),
-- Ebene 1: Tagesplanung
tp AS (
  SELECT em.mitarbeiter_id,
         e.baustelle_id,
         e.taetigkeit,
         e.id AS einteilung_id
    FROM public.einteilung_mitarbeiter em
    JOIN public.einteilungen e ON e.id = em.einteilung_id
   WHERE e.datum = p_datum
     AND e.baustelle_id IS NOT NULL
     AND COALESCE(em.abwesend, false) = false
     AND em.mitarbeiter_id IN (SELECT ma FROM scope)
),
-- Ebene 2: Poliereinsatz — nur für die, die an dem Tag keine konkrete
-- Einteilung haben. Bei mehreren laufenden Zeiträumen gewinnt der früher
-- begonnene (Hauptbaustelle der Partie) — dieselbe Regel wie in
-- Tagesplanung.tsx „Aus Polierplanung übernehmen".
pe AS (
  SELECT DISTINCT ON (p.id)
         p.id AS mitarbeiter_id,
         z.baustelle_id,
         NULL::text AS taetigkeit,
         NULL::uuid AS einteilung_id
    FROM public.profiles p
    JOIN public.poliereinsatz_zeitraeume z ON z.partie_id = p.partie_id
   CROSS JOIN werktag w
   WHERE w.ist_werktag
     AND p.is_active
     AND COALESCE(p.in_tagesplanung, true)
     AND z.baustelle_id IS NOT NULL
     AND p_datum BETWEEN z.von_datum AND z.bis_datum
     AND p.id IN (SELECT ma FROM scope)
     AND p.id NOT IN (SELECT t.mitarbeiter_id FROM tp t)
   ORDER BY p.id, z.von_datum ASC, z.created_at ASC
),
geplant AS (
  SELECT mitarbeiter_id, baustelle_id, taetigkeit, einteilung_id,
         'tagesplanung'::text AS quelle FROM tp
  UNION ALL
  SELECT mitarbeiter_id, baustelle_id, taetigkeit, einteilung_id,
         'poliereinsatz'::text FROM pe
)
SELECT g.mitarbeiter_id, g.baustelle_id, g.taetigkeit, g.einteilung_id,
       g.quelle, (a.ma IS NOT NULL), a.art
  FROM geplant g
  LEFT JOIN abwesend a ON a.ma = g.mitarbeiter_id

UNION ALL

-- Abwesende ohne jede Planung trotzdem melden, damit der Polier sieht,
-- warum jemand fehlt, statt ihn schlicht nicht in der Liste zu finden.
SELECT a.ma, NULL::uuid, NULL::text, NULL::uuid, 'abwesenheit'::text, true, a.art
  FROM abwesend a
 WHERE a.ma NOT IN (SELECT g.mitarbeiter_id FROM geplant g);
$function$;
