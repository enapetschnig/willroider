-- Stundenerfassung: Zeit-Range mit Pausen
ALTER TABLE public.stundenbuchungen
  ADD COLUMN IF NOT EXISTS start_zeit TIME,
  ADD COLUMN IF NOT EXISTS end_zeit TIME,
  ADD COLUMN IF NOT EXISTS pause_von TIME,
  ADD COLUMN IF NOT EXISTS pause_bis TIME;
