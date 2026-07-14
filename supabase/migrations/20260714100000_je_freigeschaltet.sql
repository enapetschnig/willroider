-- =====================================================================
-- profiles.je_freigeschaltet: True, sobald der Mitarbeiter jemals aktiv
-- war (Freischaltung durch Admin oder Admin-Anlage).
--
-- Zweck: Das Dashboard-Banner "Neue Anmeldung wartet auf dich" darf nur
-- bei ECHTEN, noch nie freigeschalteten Selbst-Registrierungen kommen —
-- NICHT wenn ein bestehender Mitarbeiter deaktiviert wird (der wird auch
-- is_active=false, ist aber keine neue Anmeldung).
-- =====================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS je_freigeschaltet BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: alle aktuell Aktiven + alle vom Admin Angelegten gelten als
-- freigeschaltet (nur echte, offene Selbst-Registrierungen bleiben FALSE).
UPDATE public.profiles
   SET je_freigeschaltet = TRUE
 WHERE is_active = TRUE OR angelegt_manuell = TRUE;

NOTIFY pgrst, 'reload schema';
