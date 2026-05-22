-- ============================================================================
-- Baustellenstundenbericht — 14-tägige Durchsicht, Unterschrift, Kontrolle
--
-- Ein stunden_berichte-Eintrag je (Mitarbeiter, Jahr, Monat, Teil).
--   Teil 1 = Tage 1.–16., Teil 2 = Tage 17.–Monatsende.
-- Workflow: offen → unterschrieben → bestaetigt (→ versendet, später).
-- Die Bestätigung ruft den bestehenden Perioden-Abschluss
-- (monatsabschluss_durchfuehren) auf → ZA-Buchung + Sperre.
-- ============================================================================

-- ─── Enum ───────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.stunden_bericht_status AS ENUM (
    'offen','unterschrieben','bestaetigt','versendet'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── Kern-Tabelle ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stunden_berichte (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mitarbeiter_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  jahr               INT  NOT NULL,
  monat              INT  NOT NULL CHECK (monat BETWEEN 1 AND 12),
  teil               INT  NOT NULL CHECK (teil IN (1, 2)),
  von_datum          DATE NOT NULL,
  bis_datum          DATE NOT NULL,
  status             public.stunden_bericht_status NOT NULL DEFAULT 'offen',
  -- Tages-Zustand bei Erzeugung — Basis für den Gelb-Diff (datum → [Einträge])
  snapshot           JSONB NOT NULL DEFAULT '{}'::jsonb,
  erstellt_am        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unterschrift_data  TEXT,            -- Base64-PNG der MA-Unterschrift
  unterschrieben_am  TIMESTAMPTZ,
  bestaetigt_von     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  bestaetigt_am      TIMESTAMPTZ,
  versendet_am       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mitarbeiter_id, jahr, monat, teil)
);
CREATE INDEX IF NOT EXISTS idx_sb_mitarbeiter ON public.stunden_berichte(mitarbeiter_id);
CREATE INDEX IF NOT EXISTS idx_sb_status      ON public.stunden_berichte(status);
CREATE INDEX IF NOT EXISTS idx_sb_periode     ON public.stunden_berichte(jahr, monat, teil);

-- ─── Audit-Log ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stunden_bericht_aenderungen (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stunden_bericht_id  UUID NOT NULL REFERENCES public.stunden_berichte(id) ON DELETE CASCADE,
  autor_id            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  zeitpunkt           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  art                 TEXT NOT NULL,
  details             TEXT
);
CREATE INDEX IF NOT EXISTS idx_sbae_bericht
  ON public.stunden_bericht_aenderungen(stunden_bericht_id, zeitpunkt DESC);

-- ─── Trigger: updated_at + Audit ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stunden_bericht_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sb_upd ON public.stunden_berichte;
CREATE TRIGGER trg_sb_upd BEFORE UPDATE ON public.stunden_berichte
  FOR EACH ROW EXECUTE FUNCTION public.stunden_bericht_set_updated_at();

CREATE OR REPLACE FUNCTION public.stunden_bericht_audit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.stunden_bericht_aenderungen (stunden_bericht_id, autor_id, art, details)
    VALUES (NEW.id, auth.uid(), 'erstellt', NULL);
    RETURN NEW;
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.stunden_bericht_aenderungen (stunden_bericht_id, autor_id, art, details)
    VALUES (NEW.id, auth.uid(), NEW.status::text,
      CONCAT('Status: ', OLD.status, ' → ', NEW.status));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sb_audit ON public.stunden_berichte;
CREATE TRIGGER trg_sb_audit
  AFTER INSERT OR UPDATE ON public.stunden_berichte
  FOR EACH ROW EXECUTE FUNCTION public.stunden_bericht_audit();

-- ─── RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.stunden_berichte ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stunden_bericht_aenderungen ENABLE ROW LEVEL SECURITY;

-- stunden_berichte: Eigentümer sieht den eigenen, Admin/Büro alle.
DROP POLICY IF EXISTS sb_select ON public.stunden_berichte;
CREATE POLICY sb_select ON public.stunden_berichte
  FOR SELECT TO authenticated USING (
    mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid())
  );

-- Schreiben läuft über SECURITY-DEFINER-RPCs; direkter Zugriff nur Admin/Büro.
DROP POLICY IF EXISTS sb_write ON public.stunden_berichte;
CREATE POLICY sb_write ON public.stunden_berichte
  FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

-- Audit-Log: Eigentümer/Admin lesen, alle Authenticated dürfen loggen.
DROP POLICY IF EXISTS sbae_select ON public.stunden_bericht_aenderungen;
CREATE POLICY sbae_select ON public.stunden_bericht_aenderungen
  FOR SELECT TO authenticated USING (
    public.is_admin_role(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.stunden_berichte b
      WHERE b.id = stunden_bericht_aenderungen.stunden_bericht_id
        AND b.mitarbeiter_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS sbae_insert ON public.stunden_bericht_aenderungen;
CREATE POLICY sbae_insert ON public.stunden_bericht_aenderungen
  FOR INSERT TO authenticated WITH CHECK (TRUE);

-- ─── Funktion: Berichte einer Periode erzeugen ──────────────────────────
CREATE OR REPLACE FUNCTION public.stunden_bericht_erzeugen(
  p_jahr INT,
  p_monat INT,
  p_teil INT
)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
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
END $$;

-- ─── Funktion: Mitarbeiter unterschreibt ────────────────────────────────
CREATE OR REPLACE FUNCTION public.stunden_bericht_unterschreiben(
  p_id UUID,
  p_unterschrift TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  r public.stunden_berichte;
BEGIN
  SELECT * INTO r FROM public.stunden_berichte WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bericht nicht gefunden';
  END IF;
  IF r.mitarbeiter_id <> auth.uid() AND NOT public.is_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'nicht berechtigt';
  END IF;
  IF r.status <> 'offen' THEN
    RAISE EXCEPTION 'Bericht ist nicht im Status offen';
  END IF;
  UPDATE public.stunden_berichte
    SET status = 'unterschrieben',
        unterschrift_data = p_unterschrift,
        unterschrieben_am = NOW()
    WHERE id = p_id;
END $$;

-- ─── Funktion: Büro bestätigt → Periodenabschluss + ZA-Buchung ──────────
CREATE OR REPLACE FUNCTION public.stunden_bericht_bestaetigen(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  r public.stunden_berichte;
BEGIN
  IF NOT public.is_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'nicht berechtigt';
  END IF;
  SELECT * INTO r FROM public.stunden_berichte WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bericht nicht gefunden';
  END IF;
  IF r.status <> 'unterschrieben' THEN
    RAISE EXCEPTION 'Bericht ist nicht im Status unterschrieben';
  END IF;

  UPDATE public.stunden_berichte
    SET status = 'bestaetigt',
        bestaetigt_von = auth.uid(),
        bestaetigt_am = NOW()
    WHERE id = p_id;

  -- Periodenabschluss + ZA-Buchung (tolerant: bereits abgeschlossene
  -- Mitarbeiter überspringt monatsabschluss_durchfuehren intern).
  PERFORM public.monatsabschluss_durchfuehren(r.von_datum, r.bis_datum, r.mitarbeiter_id);
END $$;

-- ─── Funktion: wieder öffnen → Abschluss zurücknehmen ───────────────────
CREATE OR REPLACE FUNCTION public.stunden_bericht_wieder_oeffnen(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  r public.stunden_berichte;
BEGIN
  IF NOT public.is_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'nicht berechtigt';
  END IF;
  SELECT * INTO r FROM public.stunden_berichte WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bericht nicht gefunden';
  END IF;

  PERFORM public.monatsabschluss_oeffnen(r.von_datum, r.bis_datum, r.mitarbeiter_id);

  UPDATE public.stunden_berichte
    SET status = 'unterschrieben',
        bestaetigt_von = NULL,
        bestaetigt_am = NULL
    WHERE id = p_id;
END $$;

-- ─── Cron: automatische Erzeugung am Abend ──────────────────────────────
-- Heute = 16. → Teil 1; heute = Monatsletzter → Teil 2.
CREATE OR REPLACE FUNCTION public.stunden_bericht_cron()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_today DATE := current_date;
  v_last  DATE := (date_trunc('month', current_date)
                   + interval '1 month' - interval '1 day')::date;
BEGIN
  IF EXTRACT(DAY FROM v_today) = 16 THEN
    PERFORM public.stunden_bericht_erzeugen(
      EXTRACT(YEAR FROM v_today)::int, EXTRACT(MONTH FROM v_today)::int, 1);
  ELSIF v_today = v_last THEN
    PERFORM public.stunden_bericht_erzeugen(
      EXTRACT(YEAR FROM v_today)::int, EXTRACT(MONTH FROM v_today)::int, 2);
  END IF;
END $$;

-- pg_cron aktivieren + Job einplanen (defensiv: Migration scheitert nicht,
-- falls pg_cron in dieser Umgebung nicht verfügbar ist).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron konnte nicht aktiviert werden: %', SQLERRM;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule('bsb-abend', '0 18 * * *',
    'SELECT public.stunden_bericht_cron()');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron.schedule fehlgeschlagen: %', SQLERRM;
END $$;

-- ─── Realtime ───────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['stunden_berichte','stunden_bericht_aenderungen']) LOOP
    BEGIN
      EXECUTE FORMAT('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', t);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END LOOP;
END $$;

COMMENT ON TABLE public.stunden_berichte IS
  'Baustellenstundenbericht je (Mitarbeiter, Jahr, Monat, Teil 1=1.-16. / '
  '2=17.-Monatsende). Workflow offen → unterschrieben → bestaetigt. Die '
  'Bestätigung löst monatsabschluss_durchfuehren aus (ZA-Buchung + Sperre).';

NOTIFY pgrst, 'reload schema';
