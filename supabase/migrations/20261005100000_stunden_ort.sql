-- =====================================================================
-- Ort je Stundenzeile: auf der Baustelle oder in der Firma.
--
-- Änderungswunsch N. Gwenger 05.10.: „Auf den Berichten muss ersichtlich
-- sein, ob der Mitarbeiter auf der Baustelle war oder in der Firma …
-- Sollte man beim Stunden schreiben auswählen können."
--
-- Entscheidung Christoph: je Zeile wählbar; Stunden „in der Firma" geben
-- KEIN Taggeld (wie schon die Werk-/Maschinenstunden). Das Taggeld wird in
-- der App gerechnet (stundenAggregation.taggeldFuerTag), nicht hier.
--
-- Bestehende Zeilen bleiben „baustelle" — es ändert sich nichts rückwirkend.
-- Der Bericht-Schnappschuss nimmt den Ort mit, damit spätere Änderungen
-- (Baustelle ↔ Firma) im Bericht als geändert auffallen.
-- =====================================================================

ALTER TABLE public.stunden_taetigkeiten
  ADD COLUMN IF NOT EXISTS ort TEXT NOT NULL DEFAULT 'baustelle';

DO $$ BEGIN
  ALTER TABLE public.stunden_taetigkeiten
    ADD CONSTRAINT stunden_taetigkeiten_ort_check CHECK (ort IN ('baustelle', 'firma'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.stunden_taetigkeiten.ort IS
  'Wo gearbeitet wurde: baustelle (Standard) oder firma (Halle/Werkstatt/Büro). Firma gibt kein Taggeld.';

CREATE OR REPLACE FUNCTION public.stunden_bericht_erzeugen(p_jahr integer, p_monat integer, p_teil integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_von DATE;
  v_bis DATE;
  v_ma_id UUID;
  v_snapshot JSONB;
  v_count INT := 0;
BEGIN
  -- Aufrufer: Admin/Büro (Test-Button) oder Cron (auth.uid() IS NULL).
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'nicht berechtigt';
  END IF;
  IF p_teil NOT IN (1, 2) THEN
    RAISE EXCEPTION 'teil muss 1 oder 2 sein';
  END IF;

  v_von := MAKE_DATE(p_jahr, p_monat, CASE p_teil WHEN 1 THEN 1 ELSE 17 END);
  v_bis := CASE p_teil
    WHEN 1 THEN MAKE_DATE(p_jahr, p_monat, 16)
    ELSE (date_trunc('month', MAKE_DATE(p_jahr, p_monat, 1))
          + interval '1 month' - interval '1 day')::date
  END;

  FOR v_ma_id IN
    SELECT DISTINCT st.mitarbeiter_id
    FROM public.stunden_tage st
    JOIN public.profiles p ON p.id = st.mitarbeiter_id AND p.is_active = TRUE
    WHERE st.datum BETWEEN v_von AND v_bis
      -- Angestellte führen den Tätigkeitsbericht, keinen Stundenbericht.
      AND p.zeiterfassung_typ IS DISTINCT FROM 'angestellter'
  LOOP
    SELECT COALESCE(jsonb_object_agg(s.datum::text, s.entries), '{}'::jsonb)
      INTO v_snapshot
      FROM (
        SELECT st.datum,
               COALESCE(
                 jsonb_agg(
                   jsonb_build_object(
                     'art', tt.art,
                     'baustelle_id', tt.baustelle_id,
                     'ziel_baustelle_id', tt.ziel_baustelle_id,
                     'ort', tt.ort,
                     'taetigkeit_id', tt.taetigkeit_id,
                     'taetigkeit_freitext', tt.taetigkeit_freitext,
                     'stunden', tt.stunden
                   ) ORDER BY tt.position
                 ) FILTER (WHERE tt.id IS NOT NULL),
                 '[]'::jsonb
               ) AS entries
        FROM public.stunden_tage st
        LEFT JOIN public.stunden_taetigkeiten tt ON tt.stunden_tag_id = st.id
        WHERE st.mitarbeiter_id = v_ma_id
          AND st.datum BETWEEN v_von AND v_bis
        GROUP BY st.datum
      ) s;

    INSERT INTO public.stunden_berichte
      (mitarbeiter_id, jahr, monat, teil, von_datum, bis_datum, status, snapshot)
    VALUES
      (v_ma_id, p_jahr, p_monat, p_teil, v_von, v_bis, 'offen', v_snapshot)
    ON CONFLICT (mitarbeiter_id, jahr, monat, teil) DO NOTHING;

    IF FOUND THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END $function$;

NOTIFY pgrst, 'reload schema';
