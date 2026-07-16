-- =====================================================================
-- Fahrzeug ↔ Partie: Jede Partie hat ihre festen Fahrzeuge (Bus etc.).
-- Grundlage für „Fahrzeug kommt aus der Polierplanung": beim Übernehmen
-- in die Tagesplanung bekommt die Baustelle automatisch die Fahrzeuge
-- der eingeteilten Partie.
-- =====================================================================

ALTER TABLE public.fahrzeuge
  ADD COLUMN IF NOT EXISTS partie_id UUID REFERENCES public.partien(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.fahrzeuge.partie_id IS 'Stamm-Partie des Fahrzeugs — wird bei „Aus Polierplanung übernehmen" automatisch der Baustelle der Partie zugeteilt';

CREATE INDEX IF NOT EXISTS fahrzeuge_partie_idx ON public.fahrzeuge (partie_id);

NOTIFY pgrst, 'reload schema';
