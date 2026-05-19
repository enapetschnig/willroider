-- Safety-Migration: stellt sicher, dass die manuell_geaendert-Spalten
-- aus 20260524000000_tagesplanung.sql vorhanden sind (idempotent).
-- Notwendig, falls die ursprüngliche Migration nicht durchgelaufen ist
-- oder der PostgREST-Schema-Cache veraltet ist.

ALTER TABLE public.einteilungen
  ADD COLUMN IF NOT EXISTS manuell_geaendert boolean NOT NULL DEFAULT false;

ALTER TABLE public.einteilung_mitarbeiter
  ADD COLUMN IF NOT EXISTS manuell_geaendert boolean NOT NULL DEFAULT false;

-- PostgREST: Schema-Cache reloaden, sonst „column not found in schema cache"
NOTIFY pgrst, 'reload schema';
