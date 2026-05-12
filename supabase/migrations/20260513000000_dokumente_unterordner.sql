-- Unterordner-Support für Dokumente (Baustelle + Angebot)
-- - subpath: relativer Pfad innerhalb eines Top-Level-Ordners
--   z.B. "Behörden/2024" innerhalb von "1-baustellenmanagement"
-- - dokument_ordner / angebot_ordner_unterordner: Marker-Tabellen für leere Ordner
--   (Ordner, die noch keine Datei enthalten, müssen trotzdem sichtbar sein)

ALTER TABLE public.dokumente
  ADD COLUMN IF NOT EXISTS subpath TEXT;

ALTER TABLE public.angebot_dokumente
  ADD COLUMN IF NOT EXISTS subpath TEXT;

CREATE INDEX IF NOT EXISTS idx_dokumente_subpath
  ON public.dokumente(baustelle_id, ordner, subpath);

CREATE INDEX IF NOT EXISTS idx_angebot_dokumente_subpath
  ON public.angebot_dokumente(angebot_id, ordner, subpath);

-- Marker-Tabelle: leere Unterordner pro Baustelle
CREATE TABLE IF NOT EXISTS public.dokument_ordner (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  baustelle_id UUID NOT NULL REFERENCES public.baustellen(id) ON DELETE CASCADE,
  ordner TEXT NOT NULL,
  subpath TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (baustelle_id, ordner, subpath)
);

CREATE INDEX IF NOT EXISTS idx_dokument_ordner_baustelle
  ON public.dokument_ordner(baustelle_id, ordner);

ALTER TABLE public.dokument_ordner ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dokument_ordner_all ON public.dokument_ordner;
CREATE POLICY dokument_ordner_all ON public.dokument_ordner
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Marker-Tabelle: leere Unterordner pro Angebot
CREATE TABLE IF NOT EXISTS public.angebot_ordner_unterordner (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  angebot_id UUID NOT NULL REFERENCES public.angebote(id) ON DELETE CASCADE,
  ordner angebot_ordner NOT NULL,
  subpath TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (angebot_id, ordner, subpath)
);

CREATE INDEX IF NOT EXISTS idx_angebot_ordner_unterordner_angebot
  ON public.angebot_ordner_unterordner(angebot_id, ordner);

ALTER TABLE public.angebot_ordner_unterordner ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS angebot_ordner_unterordner_admin ON public.angebot_ordner_unterordner;
CREATE POLICY angebot_ordner_unterordner_admin ON public.angebot_ordner_unterordner
  FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

COMMENT ON COLUMN public.dokumente.subpath IS
  'Optionaler Unterpfad innerhalb des Top-Level-Ordners, z.B. "Behörden/2024".';
COMMENT ON COLUMN public.angebot_dokumente.subpath IS
  'Optionaler Unterpfad innerhalb des Top-Level-Ordners.';
COMMENT ON TABLE public.dokument_ordner IS
  'Marker für leere Unterordner (Ordner ohne Dateien) pro Baustelle.';
COMMENT ON TABLE public.angebot_ordner_unterordner IS
  'Marker für leere Unterordner pro Angebot.';
