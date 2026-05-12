-- KI-Unterweisung: Verweis vom Evaluierungs-Eintrag auf das
-- hochgeladene Quell-Dokument (PDF/Text).

ALTER TABLE public.evaluierungen
  ADD COLUMN IF NOT EXISTS quell_dokument_id UUID
    REFERENCES public.dokumente(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.evaluierungen.quell_dokument_id IS
  'Verweis auf das Original-Dokument (z.B. PDF), aus dem die Evaluierung mit KI erstellt wurde.';
