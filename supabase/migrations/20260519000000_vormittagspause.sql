-- Vormittagspause als zusätzliches Pausen-Paar in stundenbuchungen.
-- Wird wie die Mittagspause als unbezahlt behandelt (Arbeitszeit-Berechnung
-- subtrahiert beide Pausen-Bereiche). Pro Tag nur einmal — UI sorgt dafür.

ALTER TABLE public.stundenbuchungen
  ADD COLUMN IF NOT EXISTS pause_vm_von time,
  ADD COLUMN IF NOT EXISTS pause_vm_bis time;

COMMENT ON COLUMN public.stundenbuchungen.pause_vm_von IS
  'Vormittagspause Beginn (z.B. 09:00). Unbezahlt — wird von arbeitsstunden abgezogen wie pause_von/pause_bis.';
COMMENT ON COLUMN public.stundenbuchungen.pause_vm_bis IS
  'Vormittagspause Ende (z.B. 09:15). Pro Tag/MA nur einmal — Lockout über Anwendungslogik.';
