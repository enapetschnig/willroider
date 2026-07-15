-- =====================================================================
-- Baustellen-Formular: Wohnanschrift des Bauherrn in Straße/PLZ/Ort
-- aufteilen (bisher nur ein Freitextfeld bauherr_adresse = Straße).
-- =====================================================================

ALTER TABLE public.baustellen
  ADD COLUMN IF NOT EXISTS bauherr_plz TEXT,
  ADD COLUMN IF NOT EXISTS bauherr_ort TEXT;

COMMENT ON COLUMN public.baustellen.bauherr_adresse IS 'Wohnanschrift Bauherr — Straße + Hausnummer';
COMMENT ON COLUMN public.baustellen.bauherr_plz IS 'Wohnanschrift Bauherr — PLZ';
COMMENT ON COLUMN public.baustellen.bauherr_ort IS 'Wohnanschrift Bauherr — Ort';

NOTIFY pgrst, 'reload schema';
