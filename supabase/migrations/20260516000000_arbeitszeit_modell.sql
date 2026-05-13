-- Arbeitszeitmodell „lange/kurze Woche" — Tag-genaue Soll-Stunden + Pro-MA-Modell.

-- 1) Tag-Soll-Spalten im Kalender
ALTER TABLE public.arbeitszeitkalender
  ADD COLUMN IF NOT EXISTS soll_mo NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS soll_di NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS soll_mi NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS soll_do NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS soll_fr NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS soll_sa NUMERIC(3,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS soll_so NUMERIC(3,1) DEFAULT 0;

-- 2) Wochentyp-Enum erweitern um BU + BV (idempotent)
DO $$ BEGIN
  ALTER TYPE wochentyp ADD VALUE IF NOT EXISTS 'BU';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE wochentyp ADD VALUE IF NOT EXISTS 'BV';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Pro-MA-Arbeitszeitmodell
ALTER TABLE public.profile_konten_settings
  ADD COLUMN IF NOT EXISTS arbeitszeitmodell TEXT
    NOT NULL DEFAULT 'zimmerei_sommer';

-- 4) UNIQUE-Index falls fehlt (für ON CONFLICT)
DO $$ BEGIN
  ALTER TABLE public.arbeitszeitkalender
    ADD CONSTRAINT arbeitszeitkalender_jahr_kw_key UNIQUE (jahr, kw);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN others THEN NULL;
END $$;

-- 5) Seed 2026 — Wechselmodell KW 11..44 (L/K alternierend ab KW 11=L),
--    Winterwochen außerhalb mit 8/Tag = 40 h (Wochentyp 'L' als Platzhalter,
--    User kann in Admin-UI auf BU/BV/spezielle Werte anpassen).
DO $$
DECLARE
  v_kw INT;
  v_typ wochentyp;
  v_mo NUMERIC; v_di NUMERIC; v_mi NUMERIC; v_do_ NUMERIC; v_fr NUMERIC;
BEGIN
  FOR v_kw IN 1..53 LOOP
    IF v_kw BETWEEN 11 AND 44 THEN
      -- Sommer-Wechselmodell: KW 11=L (ungerade), 12=K, 13=L, …
      IF v_kw % 2 = 1 THEN
        v_typ := 'L'::wochentyp;
        v_mo := 9; v_di := 9; v_mi := 9; v_do_ := 9; v_fr := 6;
      ELSE
        v_typ := 'K'::wochentyp;
        v_mo := 9; v_di := 9; v_mi := 9; v_do_ := 9; v_fr := 0;
      END IF;
    ELSE
      -- Winterschema: Mo-Fr 8 h
      v_typ := 'L'::wochentyp;
      v_mo := 8; v_di := 8; v_mi := 8; v_do_ := 8; v_fr := 8;
    END IF;
    INSERT INTO public.arbeitszeitkalender
      (jahr, kw, wochentyp, soll_stunden,
       soll_mo, soll_di, soll_mi, soll_do, soll_fr, soll_sa, soll_so)
    VALUES
      (2026, v_kw, v_typ,
       v_mo + v_di + v_mi + v_do_ + v_fr,
       v_mo, v_di, v_mi, v_do_, v_fr, 0, 0)
    ON CONFLICT (jahr, kw) DO UPDATE SET
      wochentyp = EXCLUDED.wochentyp,
      soll_stunden = EXCLUDED.soll_stunden,
      soll_mo = EXCLUDED.soll_mo,
      soll_di = EXCLUDED.soll_di,
      soll_mi = EXCLUDED.soll_mi,
      soll_do = EXCLUDED.soll_do,
      soll_fr = EXCLUDED.soll_fr,
      soll_sa = EXCLUDED.soll_sa,
      soll_so = EXCLUDED.soll_so;
  END LOOP;
END $$;

-- 6) RPC monatsabschluss_durchfuehren neu: tagesweise aus Kalender
CREATE OR REPLACE FUNCTION public.monatsabschluss_durchfuehren(
  p_monat TEXT,
  p_mitarbeiter_id UUID DEFAULT NULL
)
RETURNS TABLE (mitarbeiter_id UUID, soll NUMERIC, ist NUMERIC, differenz NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_ma_id UUID;
  v_year INT;
  v_month INT;
  v_start DATE;
  v_end DATE;
  v_tagesnorm NUMERIC;
  v_beschgrad NUMERIC;
  v_za_faktor NUMERIC;
  v_modell TEXT;
  v_soll NUMERIC;
  v_ist NUMERIC;
  v_diff NUMERIC;
  v_za_id UUID;
  v_d DATE;
  v_dow INT;
  v_kw INT;
  v_yr INT;
  v_tag_soll NUMERIC;
BEGIN
  IF NOT public.is_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'nicht berechtigt';
  END IF;
  v_year := SPLIT_PART(p_monat, '-', 1)::INT;
  v_month := SPLIT_PART(p_monat, '-', 2)::INT;
  v_start := MAKE_DATE(v_year, v_month, 1);
  v_end := (v_start + INTERVAL '1 month')::DATE;

  FOR v_ma_id IN
    SELECT id FROM public.profiles
    WHERE is_active = true
      AND (p_mitarbeiter_id IS NULL OR id = p_mitarbeiter_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.monatsabschluss ma
        WHERE ma.mitarbeiter_id = profiles.id AND ma.monat = p_monat
      )
  LOOP
    SELECT COALESCE(tagesnorm_stunden, 8.0),
           COALESCE(beschaeftigungsgrad, 1.0),
           COALESCE(za_faktor, 1.0),
           COALESCE(arbeitszeitmodell, 'zimmerei_sommer')
      INTO v_tagesnorm, v_beschgrad, v_za_faktor, v_modell
      FROM public.profile_konten_settings WHERE profile_id = v_ma_id;
    v_tagesnorm := COALESCE(v_tagesnorm, 8.0);
    v_beschgrad := COALESCE(v_beschgrad, 1.0);
    v_za_faktor := COALESCE(v_za_faktor, 1.0);
    v_modell := COALESCE(v_modell, 'zimmerei_sommer');

    -- Tagesweise Soll-Summe
    v_soll := 0;
    v_d := v_start;
    WHILE v_d < v_end LOOP
      v_dow := EXTRACT(DOW FROM v_d)::INT; -- 0=So, 1=Mo, …
      IF v_modell = 'fix_40h' THEN
        v_tag_soll := CASE WHEN v_dow BETWEEN 1 AND 5 THEN 8 ELSE 0 END;
      ELSIF v_modell = 'individuell' THEN
        v_tag_soll := CASE WHEN v_dow BETWEEN 1 AND 5 THEN v_tagesnorm ELSE 0 END;
      ELSE
        -- zimmerei_sommer: aus arbeitszeitkalender
        v_kw := EXTRACT(WEEK FROM v_d)::INT;
        v_yr := EXTRACT(ISOYEAR FROM v_d)::INT;
        SELECT CASE v_dow
                 WHEN 1 THEN COALESCE(soll_mo, 0)
                 WHEN 2 THEN COALESCE(soll_di, 0)
                 WHEN 3 THEN COALESCE(soll_mi, 0)
                 WHEN 4 THEN COALESCE(soll_do, 0)
                 WHEN 5 THEN COALESCE(soll_fr, 0)
                 WHEN 6 THEN COALESCE(soll_sa, 0)
                 WHEN 0 THEN COALESCE(soll_so, 0)
               END INTO v_tag_soll
        FROM public.arbeitszeitkalender WHERE jahr = v_yr AND kw = v_kw;
        IF v_tag_soll IS NULL THEN
          v_tag_soll := CASE WHEN v_dow BETWEEN 1 AND 5 THEN v_tagesnorm ELSE 0 END;
        END IF;
      END IF;
      v_soll := v_soll + COALESCE(v_tag_soll, 0) * v_beschgrad;
      v_d := v_d + 1;
    END LOOP;
    v_soll := ROUND(v_soll, 2);

    SELECT COALESCE(SUM(
      COALESCE(arbeitsstunden, 0)
      + COALESCE(fahrstunden, 0)
      + COALESCE(fehlzeit_stunden, 0)
    ), 0) INTO v_ist
    FROM public.stundenbuchungen
    WHERE mitarbeiter_id = v_ma_id
      AND datum >= v_start AND datum < v_end;
    v_ist := ROUND(v_ist, 2);

    v_diff := ROUND((v_ist - v_soll) * v_za_faktor, 2);

    INSERT INTO public.za_buchungen
      (mitarbeiter_id, art, stunden, wirksam_am, monat, notiz, erstellt_von)
      VALUES
      (v_ma_id, 'monatsabschluss', v_diff, v_end - 1, p_monat,
       CONCAT('Soll ', v_soll, ' h / Ist ', v_ist, ' h / Modell ', v_modell,
              ' / Faktor ', v_za_faktor),
       auth.uid())
      RETURNING id INTO v_za_id;

    INSERT INTO public.monatsabschluss
      (mitarbeiter_id, monat, soll_stunden, ist_stunden, differenz_stunden,
       za_buchung_id, abgeschlossen_von)
      VALUES (v_ma_id, p_monat, v_soll, v_ist, v_diff, v_za_id, auth.uid());

    mitarbeiter_id := v_ma_id;
    soll := v_soll;
    ist := v_ist;
    differenz := v_diff;
    RETURN NEXT;
  END LOOP;
END $$;

COMMENT ON COLUMN public.arbeitszeitkalender.soll_mo IS
  'Soll-Stunden Montag (Bau-KV-Wechselmodell: 9 in L/K, 8 im Winter, 0 in BU).';
COMMENT ON COLUMN public.profile_konten_settings.arbeitszeitmodell IS
  'Welches Schema gilt: zimmerei_sommer (folgt Kalender) | fix_40h (Mo-Fr 8h) | individuell (tagesnorm × Mo-Fr).';
