-- Angebote: Akquise-Pipeline vor der Baustelle
-- 4 Ordner pro Angebot, Duplikat-Check via pg_trgm, Konvertierung zu Baustelle.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

DO $$ BEGIN
  CREATE TYPE angebot_status AS ENUM
    ('offen', 'in_verhandlung', 'angenommen', 'abgelehnt', 'zurueckgezogen');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE angebot_ordner AS ENUM
    ('ausschreibungsunterlagen', 'plaene', 'subunternehmer', 'angebotsunterlagen');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.angebote (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  angebots_nr TEXT,
  datum_angebot DATE DEFAULT CURRENT_DATE,
  bvh_name TEXT NOT NULL,
  bauherr TEXT,
  bauherr_adresse TEXT,
  baustellen_adresse TEXT,
  plz TEXT,
  ort TEXT,
  kontakt_telefon TEXT,
  kontakt_email TEXT,
  wert_euro NUMERIC(12, 2),
  status angebot_status NOT NULL DEFAULT 'offen',
  bearbeiter_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  naechste_nachfrage DATE,
  notizen TEXT,
  baustelle_id UUID REFERENCES public.baustellen(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_angebote_status ON public.angebote(status);
CREATE INDEX IF NOT EXISTS idx_angebote_naechste_nachfrage
  ON public.angebote(naechste_nachfrage)
  WHERE naechste_nachfrage IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_angebote_bauherr_trgm
  ON public.angebote USING gin (bauherr gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_angebote_adresse_trgm
  ON public.angebote USING gin (baustellen_adresse gin_trgm_ops);
-- Auch auf baustellen Trigram-Indexe, damit Duplikat-Check schnell ist
CREATE INDEX IF NOT EXISTS idx_baustellen_bauherr_trgm
  ON public.baustellen USING gin (bauherr gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_baustellen_adresse_trgm
  ON public.baustellen USING gin (baustellen_adresse gin_trgm_ops);

CREATE TABLE IF NOT EXISTS public.angebot_dokumente (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  angebot_id UUID NOT NULL REFERENCES public.angebote(id) ON DELETE CASCADE,
  ordner angebot_ordner NOT NULL,
  dateiname TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mimetype TEXT,
  groesse INTEGER,
  hochgeladen_von UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_angebot_dokumente_angebot
  ON public.angebot_dokumente(angebot_id);

-- RLS: nur Admin-Rollen
ALTER TABLE public.angebote ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS angebote_admin ON public.angebote;
CREATE POLICY angebote_admin ON public.angebote
  FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

ALTER TABLE public.angebot_dokumente ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS angebot_dokumente_admin ON public.angebot_dokumente;
CREATE POLICY angebot_dokumente_admin ON public.angebot_dokumente
  FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

DROP TRIGGER IF EXISTS angebote_set_updated_at ON public.angebote;
CREATE TRIGGER angebote_set_updated_at
  BEFORE UPDATE ON public.angebote
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Storage-Bucket "angebote"
INSERT INTO storage.buckets (id, name, public)
  VALUES ('angebote', 'angebote', false)
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "angebote_storage_admin" ON storage.objects;
CREATE POLICY "angebote_storage_admin" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'angebote' AND public.is_admin_role(auth.uid()))
  WITH CHECK (bucket_id = 'angebote' AND public.is_admin_role(auth.uid()));

-- RPC: Duplikat-Suche (Fuzzy auf bauherr + adressen) gegen angebote UND baustellen
CREATE OR REPLACE FUNCTION public.angebot_duplicate_check(
  p_bauherr TEXT,
  p_adresse TEXT,
  p_threshold REAL DEFAULT 0.4
)
RETURNS TABLE (
  source TEXT,
  id UUID,
  name TEXT,
  bauherr_match TEXT,
  adresse_match TEXT,
  status TEXT,
  score REAL
)
LANGUAGE sql STABLE AS $$
  WITH inputs AS (
    SELECT unaccent(coalesce(p_bauherr, '')) AS qb,
           unaccent(coalesce(p_adresse, '')) AS qa
  ),
  a_matches AS (
    SELECT 'angebot'::text AS source,
           a.id,
           a.bvh_name AS name,
           a.bauherr AS bauherr_match,
           COALESCE(a.baustellen_adresse, a.bauherr_adresse) AS adresse_match,
           a.status::text AS status,
           GREATEST(
             similarity(unaccent(coalesce(a.bauherr, '')), (SELECT qb FROM inputs)),
             similarity(unaccent(coalesce(a.baustellen_adresse, '')), (SELECT qa FROM inputs)),
             similarity(unaccent(coalesce(a.bauherr_adresse, '')), (SELECT qa FROM inputs))
           ) AS score
    FROM public.angebote a
  ),
  b_matches AS (
    SELECT 'baustelle'::text AS source,
           b.id,
           b.bvh_name AS name,
           b.bauherr AS bauherr_match,
           COALESCE(b.baustellen_adresse, b.bauherr_adresse) AS adresse_match,
           b.status::text AS status,
           GREATEST(
             similarity(unaccent(coalesce(b.bauherr, '')), (SELECT qb FROM inputs)),
             similarity(unaccent(coalesce(b.baustellen_adresse, '')), (SELECT qa FROM inputs)),
             similarity(unaccent(coalesce(b.bauherr_adresse, '')), (SELECT qa FROM inputs))
           ) AS score
    FROM public.baustellen b
  )
  SELECT * FROM a_matches WHERE score >= p_threshold
  UNION ALL
  SELECT * FROM b_matches WHERE score >= p_threshold
  ORDER BY score DESC
  LIMIT 10;
$$;

-- RPC: Angebot zu Baustelle umwandeln
CREATE OR REPLACE FUNCTION public.angebot_zu_baustelle(p_angebot_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_baustelle_id UUID;
  v_a public.angebote%ROWTYPE;
BEGIN
  IF NOT public.is_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'nicht berechtigt';
  END IF;
  SELECT * INTO v_a FROM public.angebote WHERE id = p_angebot_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Angebot % nicht gefunden', p_angebot_id;
  END IF;
  IF v_a.baustelle_id IS NOT NULL THEN
    RAISE EXCEPTION 'Angebot ist bereits zu Baustelle % umgewandelt', v_a.baustelle_id;
  END IF;
  INSERT INTO public.baustellen
    (bvh_name, bauherr, bauherr_adresse, baustellen_adresse, plz, ort,
     auftragssumme, status, created_by, notizen)
  VALUES
    (v_a.bvh_name, v_a.bauherr, v_a.bauherr_adresse, v_a.baustellen_adresse,
     v_a.plz, v_a.ort, v_a.wert_euro, 'geplant', auth.uid(),
     COALESCE(v_a.notizen || E'\n\n', '') ||
       'Aus Angebot ' || COALESCE(v_a.angebots_nr, v_a.id::text))
  RETURNING id INTO v_baustelle_id;
  UPDATE public.angebote
    SET baustelle_id = v_baustelle_id,
        status = 'angenommen',
        updated_at = NOW()
    WHERE id = p_angebot_id;
  RETURN v_baustelle_id;
END;
$$;

COMMENT ON TABLE public.angebote IS
  'Angebote (Akquise-Pipeline). Wenn Auftrag bekommen → baustelle_id verweist auf neue Baustelle.';
COMMENT ON TABLE public.angebot_dokumente IS
  '4 fixe Ordner pro Angebot: Ausschreibungsunterlagen, Pläne, Subunternehmer, Angebotsunterlagen.';
