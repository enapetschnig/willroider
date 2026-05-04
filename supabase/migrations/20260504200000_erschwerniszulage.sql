-- Erschwerniszulagen pro Stundenbuchung
-- KV § 6 — die in der Praxis genutzten Codes:
--   aufsicht  → Punkt a (Aufsichtszulage)
--   schmutz   → Punkt d (Schmutz- / Abbrucharbeiten)
--   hoehe     → Punkt m (Arbeiten im Gebirge / Höhenzulage)
--   andere    → Free-Text-Variante (selten)
-- Es ist erlaubt, dass eine ganze Buchung unter Zulage fällt (zulage_stunden =
-- arbeitsstunden) ODER nur ein Teil (z.B. 4 von 8 h auf dem Gerüst).

ALTER TABLE public.stundenbuchungen
  ADD COLUMN IF NOT EXISTS zulage_typ TEXT,
  ADD COLUMN IF NOT EXISTS zulage_stunden NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zulage_notiz TEXT;

CREATE INDEX IF NOT EXISTS idx_stundenbuchungen_zulage_typ
  ON public.stundenbuchungen(zulage_typ) WHERE zulage_typ IS NOT NULL;

COMMENT ON COLUMN public.stundenbuchungen.zulage_typ IS
  'KV §6: aufsicht | schmutz | hoehe | andere — NULL = keine';
COMMENT ON COLUMN public.stundenbuchungen.zulage_stunden IS
  'Stunden dieser Buchung, die unter Zulage fielen (≤ arbeitsstunden)';
COMMENT ON COLUMN public.stundenbuchungen.zulage_notiz IS
  'Free-Text wenn zulage_typ = andere — z.B. konkreter KV-Punkt';
