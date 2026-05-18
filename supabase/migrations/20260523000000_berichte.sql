-- ============================================================================
-- Bautages- + Regieberichte
-- Ein Bericht pro (Baustelle, Datum, Typ) — UNIQUE verhindert Duplikate.
-- Foto-Ablage einmal in dokumente (= Baustellen-Foto-Ordner), Referenz via
-- bericht_fotos.dokument_id.
-- ============================================================================

-- Besonderes Augenmerk auf der Baustelle (für Polier prominent angezeigt)
ALTER TABLE public.baustellen
  ADD COLUMN IF NOT EXISTS besonderes_augenmerk TEXT;
COMMENT ON COLUMN public.baustellen.besonderes_augenmerk IS
  'Kurz-Hinweis pro Baustelle, der dem Polier beim Erstellen eines Berichts '
  'als gelbe Warnkarte oben angezeigt wird. Z.B. "schwacher Holzboden 2.OG".';

-- ─── Enums ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.bericht_typ AS ENUM ('bautagesbericht','regiebericht');
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.bericht_status AS ENUM (
    'entwurf','eingereicht','freigegeben','archiviert'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN others THEN NULL;
END $$;

-- ─── Kern-Tabelle berichte ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.berichte (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  baustelle_id             UUID NOT NULL REFERENCES public.baustellen(id) ON DELETE CASCADE,
  datum                    DATE NOT NULL,
  typ                      public.bericht_typ NOT NULL,
  status                   public.bericht_status NOT NULL DEFAULT 'entwurf',
  erfasst_von              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  eingereicht_am           TIMESTAMPTZ,
  freigegeben_von          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  freigegeben_am           TIMESTAMPTZ,
  archiviert_am            TIMESTAMPTZ,
  -- Wetter (aus Open-Meteo oder manuell)
  wetter_beschreibung      TEXT,
  temperatur_min           NUMERIC(4,1),
  temperatur_max           NUMERIC(4,1),
  niederschlag_mm          NUMERIC(5,1),
  wetter_quelle            TEXT,        -- 'open-meteo' | 'manuell' | NULL
  -- Inhalt
  freitext_besonderheiten  TEXT,
  -- Snapshot-Marker: wann zuletzt aus Zeiterfassung übernommen
  zeiterfassung_quelle_am  TIMESTAMPTZ,
  -- Verknüpfung zur generierten PDF
  pdf_dokument_id          UUID REFERENCES public.dokumente(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (baustelle_id, datum, typ)
);
CREATE INDEX IF NOT EXISTS idx_berichte_baustelle_datum
  ON public.berichte(baustelle_id, datum DESC);
CREATE INDEX IF NOT EXISTS idx_berichte_status ON public.berichte(status);
CREATE INDEX IF NOT EXISTS idx_berichte_typ_datum ON public.berichte(typ, datum DESC);

-- ─── Children-Tabellen ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bericht_mitarbeiter (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bericht_id         UUID NOT NULL REFERENCES public.berichte(id) ON DELETE CASCADE,
  mitarbeiter_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  position           INT NOT NULL DEFAULT 1,
  stunden_netto      NUMERIC(5,2) NOT NULL DEFAULT 0,
  taetigkeit_notiz   TEXT,
  aus_zeiterfassung  BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (bericht_id, mitarbeiter_id)
);
CREATE INDEX IF NOT EXISTS idx_bm_bericht ON public.bericht_mitarbeiter(bericht_id);

CREATE TABLE IF NOT EXISTS public.bericht_taetigkeiten (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bericht_id          UUID NOT NULL REFERENCES public.berichte(id) ON DELETE CASCADE,
  position            INT NOT NULL DEFAULT 1,
  taetigkeit_id       UUID REFERENCES public.taetigkeiten_stamm(id) ON DELETE SET NULL,
  bezeichnung         TEXT NOT NULL,
  summe_stunden       NUMERIC(6,2) NOT NULL DEFAULT 0,
  notiz               TEXT,
  aus_zeiterfassung   BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_bt_bericht ON public.bericht_taetigkeiten(bericht_id);

CREATE TABLE IF NOT EXISTS public.bericht_aufmass (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bericht_id    UUID NOT NULL REFERENCES public.berichte(id) ON DELETE CASCADE,
  position      INT NOT NULL DEFAULT 1,
  beschreibung  TEXT NOT NULL,
  menge         NUMERIC(10,3),
  einheit       TEXT,
  notiz         TEXT,
  UNIQUE (bericht_id, position)
);

CREATE TABLE IF NOT EXISTS public.bericht_fotos (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bericht_id           UUID NOT NULL REFERENCES public.berichte(id) ON DELETE CASCADE,
  dokument_id          UUID NOT NULL REFERENCES public.dokumente(id) ON DELETE CASCADE,
  aufmass_position_id  UUID REFERENCES public.bericht_aufmass(id) ON DELETE SET NULL,
  position             INT NOT NULL DEFAULT 1,
  bildunterschrift     TEXT,
  geo_lat              DOUBLE PRECISION,
  geo_lng              DOUBLE PRECISION,
  aufgenommen_am       TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bericht_id, dokument_id)
);
CREATE INDEX IF NOT EXISTS idx_bf_bericht ON public.bericht_fotos(bericht_id);

CREATE TABLE IF NOT EXISTS public.bericht_aenderungen (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bericht_id      UUID NOT NULL REFERENCES public.berichte(id) ON DELETE CASCADE,
  autor_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  zeitpunkt       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  art             TEXT NOT NULL,
  details         TEXT
);
CREATE INDEX IF NOT EXISTS idx_bae_bericht
  ON public.bericht_aenderungen(bericht_id, zeitpunkt DESC);

-- ─── Trigger: updated_at + Audit ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bericht_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_berichte_upd ON public.berichte;
CREATE TRIGGER trg_berichte_upd BEFORE UPDATE ON public.berichte
  FOR EACH ROW EXECUTE FUNCTION public.bericht_set_updated_at();

-- Audit-Trigger: Statusänderungen automatisch loggen
CREATE OR REPLACE FUNCTION public.bericht_audit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.bericht_aenderungen (bericht_id, autor_id, art, details)
    VALUES (NEW.id, NEW.erfasst_von, 'erstellt', NULL);
    RETURN NEW;
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.bericht_aenderungen (bericht_id, autor_id, art, details)
    VALUES (NEW.id, auth.uid(), NEW.status::text,
      CONCAT('Status: ', OLD.status, ' → ', NEW.status));
    RETURN NEW;
  END IF;
  -- Generic edit-Log (nur wenn relevante Inhaltsfelder geändert)
  IF OLD.freitext_besonderheiten IS DISTINCT FROM NEW.freitext_besonderheiten
     OR OLD.wetter_beschreibung IS DISTINCT FROM NEW.wetter_beschreibung
     OR OLD.temperatur_min IS DISTINCT FROM NEW.temperatur_min
     OR OLD.temperatur_max IS DISTINCT FROM NEW.temperatur_max
     OR OLD.niederschlag_mm IS DISTINCT FROM NEW.niederschlag_mm THEN
    INSERT INTO public.bericht_aenderungen (bericht_id, autor_id, art, details)
    VALUES (NEW.id, auth.uid(), 'editiert', 'Bericht-Felder geändert');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_berichte_audit ON public.berichte;
CREATE TRIGGER trg_berichte_audit
  AFTER INSERT OR UPDATE ON public.berichte
  FOR EACH ROW EXECUTE FUNCTION public.bericht_audit();

-- ─── RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.berichte ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bericht_mitarbeiter ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bericht_taetigkeiten ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bericht_aufmass ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bericht_fotos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bericht_aenderungen ENABLE ROW LEVEL SECURITY;

-- berichte
DROP POLICY IF EXISTS berichte_select_all ON public.berichte;
CREATE POLICY berichte_select_all ON public.berichte
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS berichte_insert ON public.berichte;
CREATE POLICY berichte_insert ON public.berichte
  FOR INSERT TO authenticated WITH CHECK (TRUE);

DROP POLICY IF EXISTS berichte_update ON public.berichte;
CREATE POLICY berichte_update ON public.berichte
  FOR UPDATE TO authenticated USING (
    public.is_admin_role(auth.uid())
    OR (status = 'entwurf' AND erfasst_von = auth.uid())
  );

DROP POLICY IF EXISTS berichte_delete ON public.berichte;
CREATE POLICY berichte_delete ON public.berichte
  FOR DELETE TO authenticated USING (
    public.is_admin_role(auth.uid())
    OR (status = 'entwurf' AND erfasst_von = auth.uid())
  );

-- Children: SELECT für alle Authenticated, Write nur via Parent-Bericht-Status
DROP POLICY IF EXISTS bm_select ON public.bericht_mitarbeiter;
CREATE POLICY bm_select ON public.bericht_mitarbeiter
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS bm_write ON public.bericht_mitarbeiter;
CREATE POLICY bm_write ON public.bericht_mitarbeiter
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.berichte b WHERE b.id = bericht_mitarbeiter.bericht_id
      AND (public.is_admin_role(auth.uid())
           OR (b.status IN ('entwurf','eingereicht') AND b.erfasst_von = auth.uid()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.berichte b WHERE b.id = bericht_mitarbeiter.bericht_id
      AND (public.is_admin_role(auth.uid())
           OR (b.status = 'entwurf' AND b.erfasst_von = auth.uid()))
  ));

DROP POLICY IF EXISTS bt_select ON public.bericht_taetigkeiten;
CREATE POLICY bt_select ON public.bericht_taetigkeiten
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS bt_write ON public.bericht_taetigkeiten;
CREATE POLICY bt_write ON public.bericht_taetigkeiten
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.berichte b WHERE b.id = bericht_taetigkeiten.bericht_id
      AND (public.is_admin_role(auth.uid())
           OR (b.status IN ('entwurf','eingereicht') AND b.erfasst_von = auth.uid()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.berichte b WHERE b.id = bericht_taetigkeiten.bericht_id
      AND (public.is_admin_role(auth.uid())
           OR (b.status = 'entwurf' AND b.erfasst_von = auth.uid()))
  ));

DROP POLICY IF EXISTS bau_select ON public.bericht_aufmass;
CREATE POLICY bau_select ON public.bericht_aufmass
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS bau_write ON public.bericht_aufmass;
CREATE POLICY bau_write ON public.bericht_aufmass
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.berichte b WHERE b.id = bericht_aufmass.bericht_id
      AND (public.is_admin_role(auth.uid())
           OR (b.status IN ('entwurf','eingereicht') AND b.erfasst_von = auth.uid()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.berichte b WHERE b.id = bericht_aufmass.bericht_id
      AND (public.is_admin_role(auth.uid())
           OR (b.status = 'entwurf' AND b.erfasst_von = auth.uid()))
  ));

DROP POLICY IF EXISTS bf_select ON public.bericht_fotos;
CREATE POLICY bf_select ON public.bericht_fotos
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS bf_write ON public.bericht_fotos;
CREATE POLICY bf_write ON public.bericht_fotos
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.berichte b WHERE b.id = bericht_fotos.bericht_id
      AND (public.is_admin_role(auth.uid())
           OR (b.status IN ('entwurf','eingereicht') AND b.erfasst_von = auth.uid()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.berichte b WHERE b.id = bericht_fotos.bericht_id
      AND (public.is_admin_role(auth.uid())
           OR (b.status = 'entwurf' AND b.erfasst_von = auth.uid()))
  ));

-- bericht_aenderungen: alle SELECT, INSERT/DELETE über Trigger oder Admin
DROP POLICY IF EXISTS bae_select ON public.bericht_aenderungen;
CREATE POLICY bae_select ON public.bericht_aenderungen
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS bae_insert ON public.bericht_aenderungen;
CREATE POLICY bae_insert ON public.bericht_aenderungen
  FOR INSERT TO authenticated WITH CHECK (TRUE);

-- ─── Realtime aktivieren ────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'berichte','bericht_mitarbeiter','bericht_taetigkeiten',
    'bericht_aufmass','bericht_fotos','bericht_aenderungen'
  ]) LOOP
    BEGIN
      EXECUTE FORMAT('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', t);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END LOOP;
END $$;

COMMENT ON TABLE public.berichte IS
  'Bautages- + Regieberichte. UNIQUE pro (baustelle, datum, typ) = keine '
  'Duplikate. Workflow: entwurf → eingereicht → freigegeben → archiviert. '
  'Bei Freigabe wird PDF generiert + via pdf_dokument_id verlinkt.';
