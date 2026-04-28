-- Baustellenmeldung: Bauträger-Flag + Pflicht-Evaluierung-Verlinkung
ALTER TABLE public.baustellen
  ADD COLUMN IF NOT EXISTS bautraeger BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pflicht_evaluierung_id UUID REFERENCES public.evaluierungen(id) ON DELETE SET NULL;
