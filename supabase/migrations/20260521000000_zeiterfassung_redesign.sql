-- ============================================================================
-- Zeiterfassung-Redesign (Phase A): NEUE Tabellen + Stammdaten anlegen.
-- Die alte `stundenbuchungen` bleibt zunaechst parallel bestehen — sie wird in
-- einer spaeteren Phase-B-Migration weggemigriert, sobald Frontend, Trigger und
-- RPC umgeschrieben sind. So vermeiden wir eine kaputte Zwischenphase.
-- ============================================================================

-- ─── Stammdaten: Taetigkeiten ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.taetigkeiten_stamm (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bezeichnung  TEXT NOT NULL UNIQUE,
  sort_order   INT NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.taetigkeiten_stamm(bezeichnung, sort_order) VALUES
  ('Dachstuhl aufstellen',    10),
  ('Holzbau aufstellen',      20),
  ('Vorfertigung Werk',       30),
  ('Daemmarbeit',             40),
  ('Holzverschalung',         50),
  ('Fassade',                 60),
  ('Carport aufstellen',      70),
  ('Abbrucharbeit',           80),
  ('Lieferung',               90),
  ('Baustelle einrichten',   100),
  ('Baustelle aufraeumen',   110),
  ('Baubesprechung',         120),
  ('Regiearbeit',            130),
  ('Reparaturarbeit',        140),
  ('Stehzeit',               150)
ON CONFLICT (bezeichnung) DO NOTHING;

ALTER TABLE public.taetigkeiten_stamm ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS taetigkeiten_read_all ON public.taetigkeiten_stamm;
CREATE POLICY taetigkeiten_read_all ON public.taetigkeiten_stamm
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS taetigkeiten_write_admin ON public.taetigkeiten_stamm;
CREATE POLICY taetigkeiten_write_admin ON public.taetigkeiten_stamm
  FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

-- ─── Stammdaten: Zulagen ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zulagen_typen (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bezeichnung                TEXT NOT NULL UNIQUE,
  sort_order                 INT NOT NULL DEFAULT 0,
  is_active                  BOOLEAN NOT NULL DEFAULT TRUE,
  ermoeglicht_stunden_split  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.zulagen_typen(bezeichnung, sort_order) VALUES
  ('Schmutzzulage',   10),
  ('Aufsicht',        20),
  ('Abbruchzulage',   30),
  ('Hoehenzulage',    40),
  ('Wechselzulage',   50)
ON CONFLICT (bezeichnung) DO NOTHING;

ALTER TABLE public.zulagen_typen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS zulagen_typen_read_all ON public.zulagen_typen;
CREATE POLICY zulagen_typen_read_all ON public.zulagen_typen
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS zulagen_typen_write_admin ON public.zulagen_typen;
CREATE POLICY zulagen_typen_write_admin ON public.zulagen_typen
  FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

-- ─── Mitarbeiter-Zulagen-Berechtigung ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mitarbeiter_zulagen (
  mitarbeiter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  zulagen_typ_id UUID NOT NULL REFERENCES public.zulagen_typen(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mitarbeiter_id, zulagen_typ_id)
);

ALTER TABLE public.mitarbeiter_zulagen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mz_read_own_or_admin ON public.mitarbeiter_zulagen;
CREATE POLICY mz_read_own_or_admin ON public.mitarbeiter_zulagen
  FOR SELECT TO authenticated
  USING (mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid()));
DROP POLICY IF EXISTS mz_write_admin ON public.mitarbeiter_zulagen;
CREATE POLICY mz_write_admin ON public.mitarbeiter_zulagen
  FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

-- Default: alle bestehenden MA bekommen alle Zulagen erlaubt (Admin kann später einschränken)
INSERT INTO public.mitarbeiter_zulagen (mitarbeiter_id, zulagen_typ_id)
SELECT p.id, z.id
FROM public.profiles p
CROSS JOIN public.zulagen_typen z
WHERE p.is_active = TRUE
ON CONFLICT DO NOTHING;

-- ─── Pausen-Config ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pausen_config (
  typ            TEXT PRIMARY KEY CHECK (typ IN ('vormittag','mittag')),
  dauer_minuten  INT NOT NULL,
  default_aktiv  BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.pausen_config(typ, dauer_minuten, default_aktiv) VALUES
  ('vormittag', 20, TRUE),
  ('mittag',    30, TRUE)
ON CONFLICT (typ) DO NOTHING;

ALTER TABLE public.pausen_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pausen_read_all ON public.pausen_config;
CREATE POLICY pausen_read_all ON public.pausen_config
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS pausen_write_admin ON public.pausen_config;
CREATE POLICY pausen_write_admin ON public.pausen_config
  FOR UPDATE TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

-- ─── Arbeitszeit-Limits (für Warnungen + Default-Beginn) ─────────────────
CREATE TABLE IF NOT EXISTS public.arbeitszeit_limits (
  id                     INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  max_netto_pro_tag      NUMERIC(4,1) NOT NULL DEFAULT 10,
  max_brutto_pro_tag     NUMERIC(4,1) NOT NULL DEFAULT 13,
  arbeitsbeginn_default  TIME NOT NULL DEFAULT '07:00',
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.arbeitszeit_limits(id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.arbeitszeit_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS azl_read_all ON public.arbeitszeit_limits;
CREATE POLICY azl_read_all ON public.arbeitszeit_limits
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS azl_write_admin ON public.arbeitszeit_limits;
CREATE POLICY azl_write_admin ON public.arbeitszeit_limits
  FOR UPDATE TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

-- ─── Baustellen: Fahrtgeld + Entfernung ──────────────────────────────────
ALTER TABLE public.baustellen
  ADD COLUMN IF NOT EXISTS fahrtgeld_pauschale_eur NUMERIC(7,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS entfernung_km           NUMERIC(6,1);

COMMENT ON COLUMN public.baustellen.fahrtgeld_pauschale_eur IS
  'Pauschale Anreise pro Tag (EUR). Polier-Erfassung uebernimmt diesen Wert als Default.';
COMMENT ON COLUMN public.baustellen.entfernung_km IS
  'Einfache Entfernung von der Firma zur Baustelle in km. Basis fuer Taggeld-Auto.';

-- ─── Enums fuer neue Hauptabelle ─────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.tag_status AS ENUM (
    'baustelle','firma','krank','urlaub','schlechtwetter','feiertag'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.buchung_status AS ENUM (
    'erfasst',
    'ma_bestaetigt',
    'zm_freigabe',
    'buero_freigabe',
    'exportiert',
    'abgelehnt'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN others THEN NULL;
END $$;

-- ─── Hauptabelle: stunden_tage (ein Eintrag pro MA × Tag) ────────────────
CREATE TABLE IF NOT EXISTS public.stunden_tage (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mitarbeiter_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  datum                 DATE NOT NULL,
  tag_status            public.tag_status NOT NULL,
  netto_stunden         NUMERIC(5,2) NOT NULL DEFAULT 0,
  vm_pause              BOOLEAN NOT NULL DEFAULT FALSE,
  mittag_pause          BOOLEAN NOT NULL DEFAULT FALSE,
  arbeitsbeginn         TIME,
  anmerkung             TEXT,
  status                public.buchung_status NOT NULL DEFAULT 'erfasst',
  erfasst_von           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  bestaetigt_am         TIMESTAMPTZ,
  freigegeben_zm_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  freigegeben_zm_am     TIMESTAMPTZ,
  freigegeben_buero_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  freigegeben_buero_am  TIMESTAMPTZ,
  abgelehnt_grund       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mitarbeiter_id, datum)
);
CREATE INDEX IF NOT EXISTS idx_stunden_tage_ma_datum
  ON public.stunden_tage(mitarbeiter_id, datum DESC);
CREATE INDEX IF NOT EXISTS idx_stunden_tage_status
  ON public.stunden_tage(status);

ALTER TABLE public.stunden_tage ENABLE ROW LEVEL SECURITY;

-- RLS: Lesen darf jeder Authentifizierte (innerhalb der eigenen Partie wird die
-- Sichtbarkeit aktuell ohnehin auf der App-Seite gefiltert). Wir bleiben hier
-- kompatibel zur bestehenden stundenbuchungen-Policy "stunden_select_all".
DROP POLICY IF EXISTS stunden_tage_select_all ON public.stunden_tage;
CREATE POLICY stunden_tage_select_all ON public.stunden_tage
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS stunden_tage_insert_self ON public.stunden_tage;
CREATE POLICY stunden_tage_insert_self ON public.stunden_tage
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin_role(auth.uid())
    OR mitarbeiter_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.partien p
       JOIN public.profiles m ON m.partie_id = p.id
       WHERE p.partieleiter_id = auth.uid()
         AND m.id = stunden_tage.mitarbeiter_id
    )
  );

DROP POLICY IF EXISTS stunden_tage_update ON public.stunden_tage;
CREATE POLICY stunden_tage_update ON public.stunden_tage
  FOR UPDATE TO authenticated
  USING (
    public.is_admin_role(auth.uid())
    OR (
      (mitarbeiter_id = auth.uid() OR erfasst_von = auth.uid())
      AND status IN ('erfasst','ma_bestaetigt')
      AND NOT public.month_locked(mitarbeiter_id, datum)
    )
  );

DROP POLICY IF EXISTS stunden_tage_delete ON public.stunden_tage;
CREATE POLICY stunden_tage_delete ON public.stunden_tage
  FOR DELETE TO authenticated
  USING (
    public.is_admin_role(auth.uid())
    OR (
      mitarbeiter_id = auth.uid()
      AND status = 'erfasst'
      AND NOT public.month_locked(mitarbeiter_id, datum)
    )
  );

-- ─── Taetigkeit-Zeilen pro Tag ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stunden_taetigkeiten (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stunden_tag_id       UUID NOT NULL REFERENCES public.stunden_tage(id) ON DELETE CASCADE,
  position             INT NOT NULL DEFAULT 1,
  taetigkeit_id        UUID REFERENCES public.taetigkeiten_stamm(id) ON DELETE SET NULL,
  taetigkeit_freitext  TEXT,
  baustelle_id         UUID REFERENCES public.baustellen(id) ON DELETE SET NULL,
  stunden              NUMERIC(5,2) NOT NULL,
  notiz                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stunden_tag_id, position)
);
CREATE INDEX IF NOT EXISTS idx_stunden_taetigkeiten_tag
  ON public.stunden_taetigkeiten(stunden_tag_id);
CREATE INDEX IF NOT EXISTS idx_stunden_taetigkeiten_baustelle
  ON public.stunden_taetigkeiten(baustelle_id);

ALTER TABLE public.stunden_taetigkeiten ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS st_select_all ON public.stunden_taetigkeiten;
CREATE POLICY st_select_all ON public.stunden_taetigkeiten
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS st_write ON public.stunden_taetigkeiten;
CREATE POLICY st_write ON public.stunden_taetigkeiten
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.stunden_tage t
      WHERE t.id = stunden_taetigkeiten.stunden_tag_id
        AND (
          public.is_admin_role(auth.uid())
          OR t.mitarbeiter_id = auth.uid()
          OR t.erfasst_von = auth.uid()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stunden_tage t
      WHERE t.id = stunden_taetigkeiten.stunden_tag_id
        AND (
          public.is_admin_role(auth.uid())
          OR t.mitarbeiter_id = auth.uid()
          OR t.erfasst_von = auth.uid()
        )
    )
  );

-- ─── Zulagen-Buchungen pro Tag (Flag + optional Stunden-Split) ──────────
CREATE TABLE IF NOT EXISTS public.stunden_zulagen (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stunden_tag_id  UUID NOT NULL REFERENCES public.stunden_tage(id) ON DELETE CASCADE,
  zulagen_typ_id  UUID NOT NULL REFERENCES public.zulagen_typen(id) ON DELETE RESTRICT,
  stunden         NUMERIC(5,2),   -- NULL = gilt fuer alle Netto-Stunden des Tages
  notiz           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stunden_tag_id, zulagen_typ_id)
);

ALTER TABLE public.stunden_zulagen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sz_select_all ON public.stunden_zulagen;
CREATE POLICY sz_select_all ON public.stunden_zulagen
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS sz_write ON public.stunden_zulagen;
CREATE POLICY sz_write ON public.stunden_zulagen
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.stunden_tage t
      WHERE t.id = stunden_zulagen.stunden_tag_id
        AND (
          public.is_admin_role(auth.uid())
          OR t.mitarbeiter_id = auth.uid()
          OR t.erfasst_von = auth.uid()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stunden_tage t
      WHERE t.id = stunden_zulagen.stunden_tag_id
        AND (
          public.is_admin_role(auth.uid())
          OR t.mitarbeiter_id = auth.uid()
          OR t.erfasst_von = auth.uid()
        )
    )
  );

-- ─── Fahrt + Taggeld pro Tag (Polier) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stunden_fahrt (
  stunden_tag_id    UUID PRIMARY KEY REFERENCES public.stunden_tage(id) ON DELETE CASCADE,
  fahrtgeld_eur     NUMERIC(7,2) NOT NULL DEFAULT 0,
  privat_pkw        BOOLEAN NOT NULL DEFAULT FALSE,
  km_gefahren       NUMERIC(7,1),
  taggeld_kurz      INT NOT NULL DEFAULT 0,
  taggeld_lang      INT NOT NULL DEFAULT 0,
  taggeld_manuell   BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.stunden_fahrt ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sf_select_all ON public.stunden_fahrt;
CREATE POLICY sf_select_all ON public.stunden_fahrt
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS sf_write ON public.stunden_fahrt;
CREATE POLICY sf_write ON public.stunden_fahrt
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.stunden_tage t
      WHERE t.id = stunden_fahrt.stunden_tag_id
        AND (
          public.is_admin_role(auth.uid())
          OR t.mitarbeiter_id = auth.uid()
          OR t.erfasst_von = auth.uid()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stunden_tage t
      WHERE t.id = stunden_fahrt.stunden_tag_id
        AND (
          public.is_admin_role(auth.uid())
          OR t.mitarbeiter_id = auth.uid()
          OR t.erfasst_von = auth.uid()
        )
    )
  );

-- ─── Trigger: updated_at automatisch setzen ──────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at_zeiterfassung()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stunden_tage_upd ON public.stunden_tage;
CREATE TRIGGER trg_stunden_tage_upd BEFORE UPDATE ON public.stunden_tage
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_zeiterfassung();

DROP TRIGGER IF EXISTS trg_stunden_fahrt_upd ON public.stunden_fahrt;
CREATE TRIGGER trg_stunden_fahrt_upd BEFORE UPDATE ON public.stunden_fahrt
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_zeiterfassung();

DROP TRIGGER IF EXISTS trg_pausen_config_upd ON public.pausen_config;
CREATE TRIGGER trg_pausen_config_upd BEFORE UPDATE ON public.pausen_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_zeiterfassung();

DROP TRIGGER IF EXISTS trg_taetigkeiten_upd ON public.taetigkeiten_stamm;
CREATE TRIGGER trg_taetigkeiten_upd BEFORE UPDATE ON public.taetigkeiten_stamm
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_zeiterfassung();

DROP TRIGGER IF EXISTS trg_zulagen_typen_upd ON public.zulagen_typen;
CREATE TRIGGER trg_zulagen_typen_upd BEFORE UPDATE ON public.zulagen_typen
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_zeiterfassung();

-- ─── Trigger: Urlaubs-Auto-Buchung fuer Tag-Status='urlaub' ─────────────
-- Spiegelt das Verhalten des alten urlaub_auto_book-Triggers auf
-- stundenbuchungen, jetzt fuer stunden_tage. Schreibt urlaubs_buchungen.
CREATE OR REPLACE FUNCTION public.urlaub_auto_book_tag()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_tagesnorm NUMERIC;
  v_tage NUMERIC;
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE')
     AND NEW.tag_status = 'urlaub' AND COALESCE(NEW.netto_stunden, 0) > 0 THEN
    SELECT COALESCE(tagesnorm_stunden, 8.0) INTO v_tagesnorm
      FROM public.profile_konten_settings WHERE profile_id = NEW.mitarbeiter_id;
    v_tagesnorm := COALESCE(v_tagesnorm, 8.0);
    v_tage := ROUND(NEW.netto_stunden::numeric / v_tagesnorm, 2);
    -- Wir loggen via stunden_tag_id-Notiz, da urlaubs_buchungen.stundenbuchung_id
    -- noch auf alte Tabelle zeigt. Spaetere Phase-B-Migration entkoppelt das.
    DELETE FROM public.urlaubs_buchungen
      WHERE art = 'urlaub_genommen'
        AND notiz LIKE 'TAG:' || NEW.id || '%';
    INSERT INTO public.urlaubs_buchungen
      (mitarbeiter_id, art, tage, wirksam_am, notiz, erstellt_von)
      VALUES
      (NEW.mitarbeiter_id, 'urlaub_genommen', -v_tage, NEW.datum,
       'TAG:' || NEW.id || ' · ' || NEW.netto_stunden || ' h Urlaub (auto)',
       auth.uid());
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.tag_status = 'urlaub'
     AND (NEW.tag_status IS DISTINCT FROM 'urlaub' OR COALESCE(NEW.netto_stunden, 0) = 0) THEN
    DELETE FROM public.urlaubs_buchungen
      WHERE art = 'urlaub_genommen'
        AND notiz LIKE 'TAG:' || NEW.id || '%';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stunden_tage_urlaub_auto ON public.stunden_tage;
CREATE TRIGGER stunden_tage_urlaub_auto
  AFTER INSERT OR UPDATE ON public.stunden_tage
  FOR EACH ROW EXECUTE FUNCTION public.urlaub_auto_book_tag();

CREATE OR REPLACE FUNCTION public.urlaub_auto_cleanup_tag()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  DELETE FROM public.urlaubs_buchungen
    WHERE art = 'urlaub_genommen'
      AND notiz LIKE 'TAG:' || OLD.id || '%';
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS stunden_tage_urlaub_cleanup ON public.stunden_tage;
CREATE TRIGGER stunden_tage_urlaub_cleanup
  BEFORE DELETE ON public.stunden_tage
  FOR EACH ROW EXECUTE FUNCTION public.urlaub_auto_cleanup_tag();

-- ─── Realtime fuer neue Tabellen aktivieren ──────────────────────────────
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'stunden_tage','stunden_taetigkeiten','stunden_zulagen','stunden_fahrt'
  ]) LOOP
    BEGIN
      EXECUTE FORMAT('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', t);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END LOOP;
END $$;

COMMENT ON TABLE public.stunden_tage IS
  'Zeiterfassung Phase A: ein Eintrag pro (Mitarbeiter, Tag). netto_stunden ist die '
  'TATSAECHLICHE Arbeitszeit (ohne Pausen). Pausen werden via vm_pause/mittag_pause-'
  'Toggles erfasst und in Reports auf die Anwesenheit DAZUGERECHNET. Die alte '
  'Tabelle stundenbuchungen bleibt parallel bis Phase B.';
