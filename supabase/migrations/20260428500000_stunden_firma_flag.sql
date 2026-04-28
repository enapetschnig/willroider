-- Firma-Flag für Stundenbuchungen
-- Wenn in_firma=true → Mitarbeiter war in der Firma (Werkstatt/Hof) → keine Diäten
-- baustelle_id darf trotzdem gesetzt sein: "in der Firma für Baustelle X vorbereitet"

ALTER TABLE public.stundenbuchungen
  ADD COLUMN IF NOT EXISTS in_firma BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.stundenbuchungen.in_firma IS
  'true = Arbeit in der Firma (keine Taggelder). baustelle_id optional als Bezugs-BVH.';

CREATE INDEX IF NOT EXISTS idx_stundenbuchungen_in_firma
  ON public.stundenbuchungen(in_firma) WHERE in_firma = true;
