-- =====================================================================
-- Planung sichtbar machen + EINE Quelle für „wer ist wann wo".
--
-- AUSGANGSLAGE (in der Produktivdatenbank nachgemessen, 27.07.2026):
--
--   • Die RLS auf einteilungen / einteilung_mitarbeiter erlaubte Lesen nur
--     bei gesetztem tagesplanung_freigaben.freigegeben_am — oder für
--     is_admin_role. Von 7 Freigabe-Zeilen haben 2 ein Datum, beide aus
--     Mai. Alle Juli-Tage: NULL. Der Freigabe-Workflow wird nicht gelebt.
--
--   • Die Rolle 'bauleiter' (= die Poliere, 11 Personen) hat WEDER
--     admin.view NOCH system.admin_panel → is_admin_role() ist FALSE.
--     Damit sahen auch die Poliere ihre eigene Tagesplanung nicht.
--
--   • poliereinsatz_zeitraeume (86 Zeilen, gepflegt — für den 27.07. sind
--     10 Partien mit Baustelle belegt) verlangte arbeitsplanung.view. Die
--     Rolle 'mitarbeiter' (29 Personen) hat das nicht.
--
--   Folge: Vorbelegung in der Stundenerfassung und die Baustelle in
--   „Mein Tag" blieben still leer.
--
-- WAS DIESE MIGRATION TUT:
--   1. planung_sichtbare_mitarbeiter() — die Reichweite an EINER Stelle.
--   2. Die drei SELECT-Policies daran hängen; das Freigabe-Tor entfällt.
--      Schreibrechte bleiben unverändert.
--   3. plan_fuer_tag() — die verbindliche Antwort auf „wer ist an Tag X
--      auf welcher Baustelle", inkl. Abwesenheiten. Alle Ansichten fragen
--      ab jetzt diese eine Funktion, damit sie nicht auseinanderlaufen.
--
--   tagesplanung_freigaben bleibt unangetastet — der Freigabe-Knopf
--   funktioniert weiter, er sperrt nur nichts mehr.
-- =====================================================================


-- ─── 1. Reichweite: wessen Planung darf ich sehen? ───────────────────
--
-- SECURITY DEFINER, weil die Funktion aus RLS-Policies heraus aufgerufen
-- wird und dabei profiles/partien lesen muss, ohne selbst wieder in eine
-- Policy-Prüfung zu laufen.
CREATE OR REPLACE FUNCTION public.planung_sichtbare_mitarbeiter(_user uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Admin / Büro / Geschäftsführung und jeder, der Stunden für andere
  -- schreiben darf: alle aktiven Mitarbeiter.
  SELECT p.id
    FROM public.profiles p
   WHERE p.is_active
     AND (
       public.is_admin_role(_user)
       OR public.has_permission(_user, 'stunden.create_andere')
     )

  UNION

  -- Partieleiter (Polier): die eigene Partie.
  SELECT p.id
    FROM public.profiles p
    JOIN public.partien pa ON pa.id = p.partie_id
   WHERE p.is_active
     AND pa.partieleiter_id = _user

  UNION

  -- Jeder sieht sich selbst.
  SELECT _user
   WHERE _user IS NOT NULL;
$$;

COMMENT ON FUNCTION public.planung_sichtbare_mitarbeiter(uuid) IS
  'Reichweite der Planungssicht: alle (Admin/Büro/stunden.create_andere), '
  'eigene Partie (Partieleiter) oder nur man selbst. Einzige Definition — '
  'wird von den RLS-Policies UND von plan_fuer_tag() benutzt.';


-- Hilfsprädikat für die einteilungen-Policy. Als eigene SECURITY-DEFINER-
-- Funktion, damit in der Policy kein Unter-SELECT auf eine Tabelle steht,
-- die selbst wieder RLS-geprüft würde.
CREATE OR REPLACE FUNCTION public.darf_einteilung_sehen(_user uuid, _einteilung uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin_role(_user)
      OR public.has_permission(_user, 'arbeitsplanung.view')
      OR EXISTS (
           SELECT 1
             FROM public.einteilung_mitarbeiter em
            WHERE em.einteilung_id = _einteilung
              AND em.mitarbeiter_id IN (
                    SELECT public.planung_sichtbare_mitarbeiter(_user)
                  )
         );
$$;


-- ─── 2. SELECT-Policies: Freigabe-Tor raus, Reichweite rein ──────────

DROP POLICY IF EXISTS einteilungen_select ON public.einteilungen;
CREATE POLICY einteilungen_select ON public.einteilungen
  FOR SELECT
  USING (public.darf_einteilung_sehen(auth.uid(), id));

DROP POLICY IF EXISTS einteilung_ma_select ON public.einteilung_mitarbeiter;
CREATE POLICY einteilung_ma_select ON public.einteilung_mitarbeiter
  FOR SELECT
  USING (
    public.is_admin_role(auth.uid())
    OR public.has_permission(auth.uid(), 'arbeitsplanung.view')
    OR mitarbeiter_id IN (SELECT public.planung_sichtbare_mitarbeiter(auth.uid()))
  );

-- einteilung_fahrzeuge hing am selben Freigabe-Tor (Fahrzeug + Abfahrtszeit
-- gehören zur Anzeige in „Mein Tag"). Sichtbar, sobald die zugehörige
-- Einteilung sichtbar ist.
DROP POLICY IF EXISTS ef_select ON public.einteilung_fahrzeuge;
CREATE POLICY ef_select ON public.einteilung_fahrzeuge
  FOR SELECT
  USING (public.darf_einteilung_sehen(auth.uid(), einteilung_id));

-- Poliereinsatz: zusätzlich die eigene Partie, damit auch die Rolle
-- 'mitarbeiter' (ohne arbeitsplanung.view) ihre Baustelle sieht.
DROP POLICY IF EXISTS poliereinsatz_select ON public.poliereinsatz_zeitraeume;
CREATE POLICY poliereinsatz_select ON public.poliereinsatz_zeitraeume
  FOR SELECT
  USING (
    public.has_permission(auth.uid(), 'arbeitsplanung.view')
    OR partie_id IN (
         SELECT p.partie_id FROM public.profiles p WHERE p.id = auth.uid()
       )
  );


-- ─── 3. Die eine Quelle ──────────────────────────────────────────────
--
-- Rangfolge:
--   Tagesplanung (einteilungen)          ← konkret für den Tag geplant
--   sonst Poliereinsatz (Partie → Baustelle)
--   Abwesenheit wird immer mitgeliefert, überschreibt die Erfassung.
--
-- Der Poliereinsatz greift nur an Arbeitstagen. Maßstab ist der
-- Arbeitszeitkalender (soll_mo…soll_so je KW) — dort sind Feiertage und
-- Winterwochen bereits mit 0 hinterlegt. Fehlt die KW-Zeile, gilt Mo–Fr.
CREATE OR REPLACE FUNCTION public.plan_fuer_tag(p_datum date)
RETURNS TABLE (
  mitarbeiter_id  uuid,
  baustelle_id    uuid,
  taetigkeit      text,
  einteilung_id   uuid,
  quelle          text,
  abwesend        boolean,
  abwesenheit_art text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
         AND st.tag_status IN ('urlaub', 'krank', 'schlechtwetter')
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
$$;

COMMENT ON FUNCTION public.plan_fuer_tag(date) IS
  'Verbindliche Antwort auf „wer ist an diesem Tag auf welcher Baustelle". '
  'Tagesplanung schlägt Poliereinsatz; Abwesenheiten werden mitgeliefert. '
  'Reichweite über planung_sichtbare_mitarbeiter(auth.uid()). Einziger '
  'Zugangsweg für Stundenerfassung, Mein Tag und Berichte.';

GRANT EXECUTE ON FUNCTION public.planung_sichtbare_mitarbeiter(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.darf_einteilung_sehen(uuid, uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.plan_fuer_tag(date)                 TO authenticated;
