-- Tätigkeit + mehrere Fahrzeuge pro Einteilung
-- Begründung: in der bestehenden Wordvorlage werden pro BVH oft 1-3 Fahrzeuge
-- aufgeführt (z.B. Stiegerhof: 418 DS / 481 DB / 148 EW). einteilungen.fahrzeug_id
-- ist 1:1 — wir ergänzen eine M:N-Junction.

-- Tätigkeit (z.B. "Montage", "Abbund", "Streichen")
ALTER TABLE public.einteilungen
  ADD COLUMN IF NOT EXISTS taetigkeit TEXT;

-- Fahrzeug-Junction
CREATE TABLE IF NOT EXISTS public.einteilung_fahrzeuge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  einteilung_id UUID NOT NULL REFERENCES public.einteilungen(id) ON DELETE CASCADE,
  fahrzeug_id UUID NOT NULL REFERENCES public.fahrzeuge(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(einteilung_id, fahrzeug_id)
);

CREATE INDEX IF NOT EXISTS idx_einteilung_fahrzeuge_eid
  ON public.einteilung_fahrzeuge(einteilung_id);
CREATE INDEX IF NOT EXISTS idx_einteilung_fahrzeuge_fid
  ON public.einteilung_fahrzeuge(fahrzeug_id);

ALTER TABLE public.einteilung_fahrzeuge ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ef_select ON public.einteilung_fahrzeuge;
CREATE POLICY ef_select ON public.einteilung_fahrzeuge
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS ef_modify ON public.einteilung_fahrzeuge;
CREATE POLICY ef_modify ON public.einteilung_fahrzeuge
  FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

COMMENT ON TABLE public.einteilung_fahrzeuge IS
  'Welche Fahrzeuge gehören zu welcher Tageseinteilung. Mehrere Fahrzeuge pro Einteilung möglich.';
