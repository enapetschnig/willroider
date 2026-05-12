-- Konten-System: Urlaubskonto + Zeitausgleichskonto pro Mitarbeiter
-- + Monatsabschluss + Audit-Verlauf für alle Bewegungen.

-- 1) Konto-Einstellungen pro Mitarbeiter
CREATE TABLE IF NOT EXISTS public.profile_konten_settings (
  profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  eintrittsdatum DATE,
  beschaeftigungsgrad NUMERIC(3,2) NOT NULL DEFAULT 1.00,
  tagesnorm_stunden NUMERIC(3,1) NOT NULL DEFAULT 8.0,
  urlaub_jahresanspruch_tage NUMERIC(5,1) NOT NULL DEFAULT 25,
  urlaub_modell TEXT NOT NULL DEFAULT 'fix_datum',
  urlaub_stichtag_tag INT DEFAULT 1,
  urlaub_stichtag_monat INT DEFAULT 4,
  za_faktor NUMERIC(3,2) NOT NULL DEFAULT 1.00,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS pks_set_updated_at ON public.profile_konten_settings;
CREATE TRIGGER pks_set_updated_at
  BEFORE UPDATE ON public.profile_konten_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Urlaubsbuchungs-Verlauf
CREATE TABLE IF NOT EXISTS public.urlaubs_buchungen (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mitarbeiter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  art TEXT NOT NULL,
  tage NUMERIC(5,2) NOT NULL,
  wirksam_am DATE NOT NULL,
  notiz TEXT,
  stundenbuchung_id UUID REFERENCES public.stundenbuchungen(id) ON DELETE SET NULL,
  erstellt_von UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_urlaubs_buchungen_ma ON public.urlaubs_buchungen(mitarbeiter_id, wirksam_am DESC);

-- 3) ZA-Buchungs-Verlauf
CREATE TABLE IF NOT EXISTS public.za_buchungen (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mitarbeiter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  art TEXT NOT NULL,
  stunden NUMERIC(7,2) NOT NULL,
  wirksam_am DATE NOT NULL,
  monat TEXT,
  notiz TEXT,
  stundenbuchung_id UUID REFERENCES public.stundenbuchungen(id) ON DELETE SET NULL,
  erstellt_von UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_za_buchungen_ma ON public.za_buchungen(mitarbeiter_id, wirksam_am DESC);

-- 4) Monatsabschluss
CREATE TABLE IF NOT EXISTS public.monatsabschluss (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mitarbeiter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  monat TEXT NOT NULL,
  soll_stunden NUMERIC(7,2) NOT NULL,
  ist_stunden NUMERIC(7,2) NOT NULL,
  differenz_stunden NUMERIC(7,2) NOT NULL,
  za_buchung_id UUID REFERENCES public.za_buchungen(id) ON DELETE SET NULL,
  abgeschlossen_von UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  abgeschlossen_am TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (mitarbeiter_id, monat)
);
CREATE INDEX IF NOT EXISTS idx_monatsabschluss_monat ON public.monatsabschluss(monat);

-- 5) Salden-Views
CREATE OR REPLACE VIEW public.v_urlaubs_saldo AS
  SELECT mitarbeiter_id,
         COALESCE(SUM(tage), 0)::NUMERIC(7,2) AS saldo_tage,
         MAX(wirksam_am) AS letzte_buchung
  FROM public.urlaubs_buchungen
  GROUP BY mitarbeiter_id;

CREATE OR REPLACE VIEW public.v_za_saldo AS
  SELECT mitarbeiter_id,
         COALESCE(SUM(stunden), 0)::NUMERIC(9,2) AS saldo_stunden,
         MAX(wirksam_am) AS letzte_buchung
  FROM public.za_buchungen
  GROUP BY mitarbeiter_id;

-- 6) RLS — alle Konto-Tabellen
ALTER TABLE public.profile_konten_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.urlaubs_buchungen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.za_buchungen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monatsabschluss ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS konten_settings_select ON public.profile_konten_settings;
CREATE POLICY konten_settings_select ON public.profile_konten_settings
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.is_admin_role(auth.uid()));
DROP POLICY IF EXISTS konten_settings_modify ON public.profile_konten_settings;
CREATE POLICY konten_settings_modify ON public.profile_konten_settings
  FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

DROP POLICY IF EXISTS urlaub_select ON public.urlaubs_buchungen;
CREATE POLICY urlaub_select ON public.urlaubs_buchungen
  FOR SELECT TO authenticated
  USING (mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid()));
DROP POLICY IF EXISTS urlaub_modify ON public.urlaubs_buchungen;
CREATE POLICY urlaub_modify ON public.urlaubs_buchungen
  FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

DROP POLICY IF EXISTS za_select ON public.za_buchungen;
CREATE POLICY za_select ON public.za_buchungen
  FOR SELECT TO authenticated
  USING (mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid()));
DROP POLICY IF EXISTS za_modify ON public.za_buchungen;
CREATE POLICY za_modify ON public.za_buchungen
  FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

DROP POLICY IF EXISTS monatsabschluss_select ON public.monatsabschluss;
CREATE POLICY monatsabschluss_select ON public.monatsabschluss
  FOR SELECT TO authenticated
  USING (mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid()));
DROP POLICY IF EXISTS monatsabschluss_modify ON public.monatsabschluss;
CREATE POLICY monatsabschluss_modify ON public.monatsabschluss
  FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

-- 7) Trigger: Urlaubs-Auto-Abzug + Cleanup
CREATE OR REPLACE FUNCTION public.urlaub_auto_book()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_tagesnorm NUMERIC;
  v_tage NUMERIC;
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE')
     AND NEW.fehlzeit_typ = 'U' AND COALESCE(NEW.fehlzeit_stunden, 0) > 0 THEN
    SELECT COALESCE(tagesnorm_stunden, 8.0) INTO v_tagesnorm
      FROM public.profile_konten_settings WHERE profile_id = NEW.mitarbeiter_id;
    v_tagesnorm := COALESCE(v_tagesnorm, 8.0);
    v_tage := ROUND(NEW.fehlzeit_stunden::numeric / v_tagesnorm, 2);
    DELETE FROM public.urlaubs_buchungen
      WHERE stundenbuchung_id = NEW.id AND art = 'urlaub_genommen';
    INSERT INTO public.urlaubs_buchungen
      (mitarbeiter_id, art, tage, wirksam_am, stundenbuchung_id, notiz, erstellt_von)
      VALUES
      (NEW.mitarbeiter_id, 'urlaub_genommen', -v_tage, NEW.datum, NEW.id,
       CONCAT(NEW.fehlzeit_stunden, ' h Urlaub (auto)'), auth.uid());
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.fehlzeit_typ = 'U'
     AND (NEW.fehlzeit_typ IS DISTINCT FROM 'U' OR COALESCE(NEW.fehlzeit_stunden, 0) = 0) THEN
    DELETE FROM public.urlaubs_buchungen
      WHERE stundenbuchung_id = NEW.id AND art = 'urlaub_genommen';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stundenbuchungen_urlaub_auto ON public.stundenbuchungen;
CREATE TRIGGER stundenbuchungen_urlaub_auto
  AFTER INSERT OR UPDATE ON public.stundenbuchungen
  FOR EACH ROW EXECUTE FUNCTION public.urlaub_auto_book();

CREATE OR REPLACE FUNCTION public.urlaub_auto_cleanup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.urlaubs_buchungen
    WHERE stundenbuchung_id = OLD.id AND art = 'urlaub_genommen';
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS stundenbuchungen_urlaub_cleanup ON public.stundenbuchungen;
CREATE TRIGGER stundenbuchungen_urlaub_cleanup
  BEFORE DELETE ON public.stundenbuchungen
  FOR EACH ROW EXECUTE FUNCTION public.urlaub_auto_cleanup();

-- 8) Monatslock-Helper + Stunden-RLS-Verschärfung
CREATE OR REPLACE FUNCTION public.month_locked(p_uid UUID, p_datum DATE)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.monatsabschluss
    WHERE mitarbeiter_id = p_uid
      AND monat = TO_CHAR(p_datum, 'YYYY-MM')
  );
$$;

DROP POLICY IF EXISTS "stunden_update_self_or_admin" ON public.stundenbuchungen;
CREATE POLICY "stunden_update_self_or_admin" ON public.stundenbuchungen
  FOR UPDATE TO authenticated
  USING (
    public.is_admin_role(auth.uid())
    OR (mitarbeiter_id = auth.uid() AND NOT public.month_locked(auth.uid(), datum))
  );

DROP POLICY IF EXISTS "stunden_delete_admin" ON public.stundenbuchungen;
CREATE POLICY "stunden_delete_admin" ON public.stundenbuchungen
  FOR DELETE TO authenticated
  USING (
    public.is_admin_role(auth.uid())
    OR (mitarbeiter_id = auth.uid() AND NOT public.month_locked(auth.uid(), datum))
  );

-- 9) RPC: Monatsabschluss durchführen (tagesnorm × werktage − feiertage)
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
  v_werktage INT;
  v_tagesnorm NUMERIC;
  v_beschgrad NUMERIC;
  v_za_faktor NUMERIC;
  v_soll NUMERIC;
  v_ist NUMERIC;
  v_diff NUMERIC;
  v_za_id UUID;
BEGIN
  IF NOT public.is_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'nicht berechtigt';
  END IF;
  v_year := SPLIT_PART(p_monat, '-', 1)::INT;
  v_month := SPLIT_PART(p_monat, '-', 2)::INT;
  v_start := MAKE_DATE(v_year, v_month, 1);
  v_end := (v_start + INTERVAL '1 month')::DATE;

  -- Werktage Mo-Fr im Monat
  SELECT COUNT(*) INTO v_werktage
    FROM generate_series(v_start, v_end - 1, INTERVAL '1 day') AS d
    WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5;

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
           COALESCE(za_faktor, 1.0)
      INTO v_tagesnorm, v_beschgrad, v_za_faktor
      FROM public.profile_konten_settings WHERE profile_id = v_ma_id;
    v_tagesnorm := COALESCE(v_tagesnorm, 8.0);
    v_beschgrad := COALESCE(v_beschgrad, 1.0);
    v_za_faktor := COALESCE(v_za_faktor, 1.0);

    v_soll := ROUND(v_werktage * v_tagesnorm * v_beschgrad, 2);

    SELECT COALESCE(SUM(
      COALESCE(arbeitsstunden, 0)
      + COALESCE(fahrstunden, 0)
      + COALESCE(fehlzeit_stunden, 0)
    ), 0) INTO v_ist
    FROM public.stundenbuchungen
    WHERE mitarbeiter_id = v_ma_id
      AND datum >= v_start AND datum < v_end;

    v_diff := ROUND((v_ist - v_soll) * v_za_faktor, 2);

    INSERT INTO public.za_buchungen
      (mitarbeiter_id, art, stunden, wirksam_am, monat, notiz, erstellt_von)
      VALUES
      (v_ma_id, 'monatsabschluss', v_diff, v_end - 1, p_monat,
       CONCAT('Soll ', v_soll, ' h / Ist ', v_ist, ' h / Faktor ', v_za_faktor),
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

-- 10) RPC: Monatsabschluss rückgängig
CREATE OR REPLACE FUNCTION public.monatsabschluss_oeffnen(
  p_monat TEXT,
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
  SELECT za_buchung_id INTO v_za_id FROM public.monatsabschluss
    WHERE mitarbeiter_id = p_mitarbeiter_id AND monat = p_monat;
  DELETE FROM public.monatsabschluss
    WHERE mitarbeiter_id = p_mitarbeiter_id AND monat = p_monat;
  IF v_za_id IS NOT NULL THEN
    DELETE FROM public.za_buchungen WHERE id = v_za_id;
  END IF;
END $$;

-- 11) RPC: Jährliche Urlaubsgutschriften nachholen
CREATE OR REPLACE FUNCTION public.urlaub_gutschriften_nachholen()
RETURNS TABLE (mitarbeiter_id UUID, tage NUMERIC, datum DATE)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_ma_id UUID;
  v_modell TEXT;
  v_tag INT;
  v_monat INT;
  v_anspruch NUMERIC;
  v_eintritt DATE;
  v_letzte DATE;
  v_jahr INT;
  v_naechster DATE;
BEGIN
  IF NOT public.is_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'nicht berechtigt';
  END IF;
  FOR v_ma_id, v_modell, v_tag, v_monat, v_anspruch, v_eintritt IN
    SELECT p.id,
           COALESCE(ks.urlaub_modell, 'fix_datum'),
           COALESCE(ks.urlaub_stichtag_tag, 1),
           COALESCE(ks.urlaub_stichtag_monat, 4),
           COALESCE(ks.urlaub_jahresanspruch_tage, 25),
           ks.eintrittsdatum
    FROM public.profiles p
    LEFT JOIN public.profile_konten_settings ks ON ks.profile_id = p.id
    WHERE p.is_active = true
  LOOP
    IF v_modell = 'fix_datum' THEN
      SELECT MAX(wirksam_am) INTO v_letzte
        FROM public.urlaubs_buchungen
        WHERE urlaubs_buchungen.mitarbeiter_id = v_ma_id
          AND art = 'jahresgutschrift';
      v_letzte := COALESCE(v_letzte,
                            (COALESCE(v_eintritt, CURRENT_DATE - INTERVAL '1 year'))::DATE);
      FOR v_jahr IN
        EXTRACT(YEAR FROM v_letzte)::INT + 1 .. EXTRACT(YEAR FROM CURRENT_DATE)::INT
      LOOP
        v_naechster := MAKE_DATE(v_jahr, v_monat, LEAST(v_tag, 28));
        IF v_naechster <= CURRENT_DATE THEN
          INSERT INTO public.urlaubs_buchungen
            (mitarbeiter_id, art, tage, wirksam_am, notiz, erstellt_von)
            VALUES (v_ma_id, 'jahresgutschrift', v_anspruch,
                    v_naechster,
                    CONCAT('Jährliche Gutschrift ', v_jahr), auth.uid());
          mitarbeiter_id := v_ma_id;
          tage := v_anspruch;
          datum := v_naechster;
          RETURN NEXT;
        END IF;
      END LOOP;
    END IF;
    -- TODO: eintrittsdatum + monatlich später
  END LOOP;
END $$;

COMMENT ON TABLE public.profile_konten_settings IS
  'Pro-MA Konfiguration: Urlaubsanspruch, Stichtag-Modell, Tagesnorm, ZA-Faktor.';
COMMENT ON TABLE public.urlaubs_buchungen IS
  'Audit-Log aller Urlaubs-Bewegungen (Initial, Gutschrift, Urlaub genommen, Korrektur).';
COMMENT ON TABLE public.za_buchungen IS
  'Audit-Log aller Zeitausgleichs-Bewegungen.';
COMMENT ON TABLE public.monatsabschluss IS
  'Monatsabschluss-Markierung pro MA. Sperrt die Stundenbuchungen des Monats.';
