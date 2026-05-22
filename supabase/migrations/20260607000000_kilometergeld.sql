-- ============================================================================
-- Kilometergeld: einstellbarer Satz pro privat gefahrenem Kilometer.
-- Wohnt auf der Singleton-Zeile arbeitszeit_limits (id = 1).
-- ============================================================================

ALTER TABLE public.arbeitszeit_limits
  ADD COLUMN IF NOT EXISTS kilometergeld_satz_eur NUMERIC(5,2) NOT NULL DEFAULT 0.50;

COMMENT ON COLUMN public.arbeitszeit_limits.kilometergeld_satz_eur IS
  'Kilometergeld pro privat gefahrenem Kilometer (EUR). Default 0,50 = amtl. Satz.';

NOTIFY pgrst, 'reload schema';
