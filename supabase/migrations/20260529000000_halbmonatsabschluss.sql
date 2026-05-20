-- ============================================================================
-- Halbmonats-Abschluss: ermoeglicht 14-taegigen Abschluss statt nur monatlich.
--
-- Konvention fuer monatsabschluss.monat (TEXT):
--   'YYYY-MM'      = ganzer Monat (alt-kompatibel)
--   'YYYY-MM-H1'   = 1.-15. (erster Halbmonat)
--   'YYYY-MM-H2'   = 16.-Monatsende (zweiter Halbmonat)
--
-- Neue Spalten von_datum/bis_datum als kanonische Datums-Begrenzungen.
-- PK (mitarbeiter_id, monat) bleibt — H1/H2 erzeugen distinkte Strings.
-- ============================================================================

-- 1) Neue Datums-Spalten
ALTER TABLE public.monatsabschluss
  ADD COLUMN IF NOT EXISTS von_datum DATE,
  ADD COLUMN IF NOT EXISTS bis_datum DATE;

-- 2) Backfill: alte 'YYYY-MM'-Eintraege bekommen den vollen Monat
UPDATE public.monatsabschluss
SET von_datum = (monat || '-01')::date,
    bis_datum = (date_trunc('month', (monat || '-01')::date) + interval '1 month' - interval '1 day')::date
WHERE von_datum IS NULL
  AND monat ~ '^\d{4}-\d{2}$';

-- 3) NOT NULL — nur wenn alle Backfills sauber liefen
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.monatsabschluss WHERE von_datum IS NULL) THEN
    ALTER TABLE public.monatsabschluss
      ALTER COLUMN von_datum SET NOT NULL,
      ALTER COLUMN bis_datum SET NOT NULL;
  END IF;
END $$;

-- 4) Helper: month_locked() — jetzt range-basiert
CREATE OR REPLACE FUNCTION public.month_locked(p_uid UUID, p_datum DATE)
RETURNS BOOLEAN
LANGUAGE SQL STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.monatsabschluss
    WHERE mitarbeiter_id = p_uid
      AND p_datum BETWEEN von_datum AND bis_datum
  );
$$;

-- 5) RPC: Periode-Abschluss mit explizitem Range
--    Ersetzt die alte 'p_monat TEXT'-Variante — die alte Signatur wird gedroppt
--    und neu angelegt, um Konflikt mit alten Aufrufern zu erkennen.
DROP FUNCTION IF EXISTS public.monatsabschluss_durchfuehren(TEXT, UUID);
DROP FUNCTION IF EXISTS public.monatsabschluss_durchfuehren(DATE, DATE, UUID);

CREATE OR REPLACE FUNCTION public.monatsabschluss_durchfuehren(
  p_von_datum DATE,
  p_bis_datum DATE,
  p_mitarbeiter_id UUID DEFAULT NULL
)
RETURNS TABLE (mitarbeiter_id UUID, soll NUMERIC, ist NUMERIC, differenz NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_ma_id UUID;
  v_werktage INT;
  v_tagesnorm NUMERIC;
  v_beschgrad NUMERIC;
  v_za_faktor NUMERIC;
  v_soll NUMERIC;
  v_ist NUMERIC;
  v_diff NUMERIC;
  v_za_id UUID;
  v_monat_label TEXT;
  v_year INT;
  v_month INT;
  v_h1_end DATE;
  v_full_end DATE;
BEGIN
  IF NOT public.is_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'nicht berechtigt';
  END IF;
  IF p_bis_datum < p_von_datum THEN
    RAISE EXCEPTION 'bis_datum vor von_datum';
  END IF;

  -- Periode-Label ableiten: H1 / H2 / ganzer Monat
  v_year  := EXTRACT(YEAR FROM p_von_datum)::INT;
  v_month := EXTRACT(MONTH FROM p_von_datum)::INT;
  v_h1_end := MAKE_DATE(v_year, v_month, 15);
  v_full_end := (date_trunc('month', p_von_datum) + interval '1 month' - interval '1 day')::date;

  IF p_von_datum = MAKE_DATE(v_year, v_month, 1) AND p_bis_datum = v_full_end THEN
    v_monat_label := TO_CHAR(p_von_datum, 'YYYY-MM');
  ELSIF p_von_datum = MAKE_DATE(v_year, v_month, 1) AND p_bis_datum = v_h1_end THEN
    v_monat_label := TO_CHAR(p_von_datum, 'YYYY-MM') || '-H1';
  ELSIF p_von_datum = MAKE_DATE(v_year, v_month, 16) AND p_bis_datum = v_full_end THEN
    v_monat_label := TO_CHAR(p_von_datum, 'YYYY-MM') || '-H2';
  ELSE
    -- freier Range: serialisiere als ISO-Bereich
    v_monat_label := TO_CHAR(p_von_datum, 'YYYY-MM-DD') || '_' || TO_CHAR(p_bis_datum, 'YYYY-MM-DD');
  END IF;

  -- Werktage Mo-Fr in der Periode
  SELECT COUNT(*) INTO v_werktage
    FROM generate_series(p_von_datum, p_bis_datum, INTERVAL '1 day') AS d
    WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5;

  FOR v_ma_id IN
    SELECT id FROM public.profiles
    WHERE is_active = TRUE
      AND (p_mitarbeiter_id IS NULL OR id = p_mitarbeiter_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.monatsabschluss ma
        WHERE ma.mitarbeiter_id = profiles.id AND ma.monat = v_monat_label
      )
  LOOP
    SELECT COALESCE(tagesnorm_stunden, 8.0),
           COALESCE(beschaeftigungsgrad, 1.0),
           COALESCE(za_faktor, 1.0)
      INTO v_tagesnorm, v_beschgrad, v_za_faktor
      FROM public.profile_konten_settings WHERE profile_id = v_ma_id;
    v_tagesnorm := COALESCE(v_tagesnorm, 8.0);
    v_beschgrad := COALESCE(v_beschgrad, 1.0);
    v_za_faktor := COALESCE(v_za_faktor, 1.0);

    v_soll := ROUND(v_werktage * v_tagesnorm * v_beschgrad, 2);

    SELECT COALESCE(SUM(netto_stunden), 0) INTO v_ist
      FROM public.stunden_tage
      WHERE mitarbeiter_id = v_ma_id
        AND datum BETWEEN p_von_datum AND p_bis_datum;

    v_diff := ROUND((v_ist - v_soll) * v_za_faktor, 2);

    INSERT INTO public.za_buchungen
      (mitarbeiter_id, art, stunden, wirksam_am, monat, notiz, erstellt_von)
      VALUES
      (v_ma_id, 'monatsabschluss', v_diff, p_bis_datum, v_monat_label,
       CONCAT('Periode ', p_von_datum, '–', p_bis_datum,
              ': Soll ', v_soll, ' h / Ist ', v_ist, ' h / Faktor ', v_za_faktor),
       auth.uid())
      RETURNING id INTO v_za_id;

    INSERT INTO public.monatsabschluss
      (mitarbeiter_id, monat, von_datum, bis_datum, soll_stunden, ist_stunden,
       differenz_stunden, za_buchung_id, abgeschlossen_von)
      VALUES
      (v_ma_id, v_monat_label, p_von_datum, p_bis_datum,
       v_soll, v_ist, v_diff, v_za_id, auth.uid());

    mitarbeiter_id := v_ma_id;
    soll  := v_soll;
    ist   := v_ist;
    differenz := v_diff;
    RETURN NEXT;
  END LOOP;
END $$;

COMMENT ON FUNCTION public.monatsabschluss_durchfuehren IS
  'Schliesst eine Periode (Halbmonat/Monat/freier Range) fuer einen MA oder alle MAs ab. '
  'Periode-Label wird abgeleitet: YYYY-MM (Monat), YYYY-MM-H1, YYYY-MM-H2 oder ISO-Range.';

-- 6) RPC: Periode wieder oeffnen — range-fähig
DROP FUNCTION IF EXISTS public.monatsabschluss_oeffnen(TEXT, UUID);

CREATE OR REPLACE FUNCTION public.monatsabschluss_oeffnen(
  p_von_datum DATE,
  p_bis_datum DATE,
  p_mitarbeiter_id UUID
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_za_id UUID;
BEGIN
  IF NOT public.is_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'nicht berechtigt';
  END IF;

  SELECT za_buchung_id INTO v_za_id
    FROM public.monatsabschluss
    WHERE mitarbeiter_id = p_mitarbeiter_id
      AND von_datum = p_von_datum
      AND bis_datum = p_bis_datum;

  DELETE FROM public.monatsabschluss
    WHERE mitarbeiter_id = p_mitarbeiter_id
      AND von_datum = p_von_datum
      AND bis_datum = p_bis_datum;

  IF v_za_id IS NOT NULL THEN
    DELETE FROM public.za_buchungen WHERE id = v_za_id;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
