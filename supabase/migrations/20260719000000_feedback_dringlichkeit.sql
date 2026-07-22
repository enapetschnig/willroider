-- =====================================================================
-- Dringlichkeit eines Änderungswunsches — vom EINREICHER gewählt.
-- Ergänzt (ersetzt nicht) das Feld `status`, das die Verwaltung setzt:
--   dringlichkeit = Einschätzung des Melders ("wie eilig ist das für mich")
--   status        = Entscheidung der Verwaltung ("was machen wir damit")
-- =====================================================================

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS dringlichkeit TEXT NOT NULL DEFAULT 'normal';

COMMENT ON COLUMN public.feedback.dringlichkeit IS
  'Vom Einreicher gewählt: sofort | normal | besprechen | irgendwann';

-- Bestandsdaten bleiben auf 'normal' — sie wurden ohne Auswahl erfasst.

NOTIFY pgrst, 'reload schema';
