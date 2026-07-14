-- =====================================================================
-- Urlaubs-Abzug: pro vollem Urlaubstag genau 1,0 Tag — unabhängig von der
-- Saison (Sommer 9h, kurzer Fr 6h, Winter 8h).
--
-- Bug: stunden_tag_recompute buchte Urlaub = -ROUND(urlaub_h / 8.0), also
-- an einem 9h-Tag -1,13 und an einem 6h-Freitag -0,75 Tage. Der Antrags-
-- Weg (UrlaubAntragDialog) bucht dagegen korrekt -1,0/Tag → Widerspruch.
--
-- Fix: durch das ECHTE Tages-Soll teilen (tages_soll()). Da das Raster
-- den Urlaub mit dem Tages-Soll vorbefüllt, ergibt urlaub_h / tages_soll
-- = 1,0 pro vollem Tag, 0,5 pro halbem.
-- =====================================================================

-- ─── Tages-Soll einer Person an einem Datum (Kalender-/Modell-basiert) ─
-- Extrahiert aus monatsabschluss_durchfuehren, damit Trigger + Abschluss
-- dieselbe Soll-Definition nutzen.
CREATE OR REPLACE FUNCTION public.tages_soll(p_uid uuid, p_datum date)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ROUND(
    (CASE
       WHEN s.modell = 'fix_40h' THEN
         CASE WHEN EXTRACT(ISODOW FROM p_datum) BETWEEN 1 AND 5 THEN 8.0 ELSE 0 END
       WHEN s.modell = 'individuell' THEN
         CASE WHEN EXTRACT(ISODOW FROM p_datum) BETWEEN 1 AND 5 THEN s.tagesnorm ELSE 0 END
       ELSE  -- zimmerei_sommer: aus Kalender, sonst Tagesnorm-Fallback
         CASE
           WHEN k.jahr IS NULL THEN
             CASE WHEN EXTRACT(ISODOW FROM p_datum) BETWEEN 1 AND 5 THEN s.tagesnorm ELSE 0 END
           ELSE COALESCE(
             CASE EXTRACT(ISODOW FROM p_datum)::int
               WHEN 1 THEN k.soll_mo WHEN 2 THEN k.soll_di WHEN 3 THEN k.soll_mi
               WHEN 4 THEN k.soll_do WHEN 5 THEN k.soll_fr WHEN 6 THEN k.soll_sa
               WHEN 7 THEN k.soll_so END, 0)
         END
     END) * s.beschgrad, 2)
  FROM (
    SELECT COALESCE(tagesnorm_stunden, 8.0) AS tagesnorm,
           COALESCE(beschaeftigungsgrad, 1.0) AS beschgrad,
           COALESCE(arbeitszeitmodell, 'zimmerei_sommer') AS modell
      FROM public.profile_konten_settings WHERE profile_id = p_uid
    UNION ALL SELECT 8.0, 1.0, 'zimmerei_sommer'
    LIMIT 1
  ) s
  LEFT JOIN public.arbeitszeitkalender k
    ON k.jahr = EXTRACT(ISOYEAR FROM p_datum)::int
   AND k.kw   = EXTRACT(WEEK FROM p_datum)::int;
$$;

-- ─── recompute-Trigger: Urlaub durch Tages-Soll teilen ────────────────
CREATE OR REPLACE FUNCTION public.stunden_tag_recompute()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
$$;

-- ─── Altbestand korrigieren: die bereits falsch gebuchten TAG:-Urlaube ─
UPDATE public.urlaubs_buchungen ub
   SET tage = -ROUND(
         (SELECT COALESCE(SUM(tt.stunden), 0)
            FROM public.stunden_taetigkeiten tt
           WHERE tt.stunden_tag_id = st.id AND tt.art = 'urlaub')
         / GREATEST(public.tages_soll(st.mitarbeiter_id, st.datum), 0.01), 2)
  FROM public.stunden_tage st
 WHERE ub.art = 'urlaub_genommen'
   AND ub.notiz LIKE 'TAG:' || st.id || '%'
   AND public.tages_soll(st.mitarbeiter_id, st.datum) > 0;

NOTIFY pgrst, 'reload schema';
