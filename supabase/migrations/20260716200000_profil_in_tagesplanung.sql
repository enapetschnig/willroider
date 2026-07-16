-- =====================================================================
-- profiles.in_tagesplanung: Steuert, ob ein Mitarbeiter in der
-- Tagesplanung einteilbar ist (Auswahl-Liste + automatische Übernahme
-- aus der Polierplanung). Büro/Bauleitung/GF planen, werden aber selbst
-- nicht auf Baustellen eingeteilt.
-- =====================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS in_tagesplanung BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.profiles.in_tagesplanung IS
  'FALSE = erscheint nicht in der Tagesplanung (Auswahl + Übernahme) — z.B. Büro/Bauleitung/GF';

NOTIFY pgrst, 'reload schema';
