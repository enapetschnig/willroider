-- =====================================================================
-- Garantie gegen das „Deaktivierter taucht als neue Anmeldung auf"-Problem.
--
-- Invariante: Sobald ein Profil aktiv IST oder aktiviert WIRD, gilt es
-- dauerhaft als je_freigeschaltet=TRUE. Damit erscheint es nach einer
-- späteren Deaktivierung NIE im Dashboard-„Neue Anmeldung"-Banner
-- (das nur is_active=false UND je_freigeschaltet=false zeigt).
--
-- Der Trigger deckt ALLE Wege ab — unabhängig vom Frontend/Edge-Code:
--   • Selbst-Registrierung: Profil wird is_active=false angelegt → Flag
--     bleibt false → Banner zeigt es (korrekt, echte offene Anmeldung).
--   • Freischaltung (is_active → true): Flag wird true.
--   • admin-create-employee (Profil-Update auf is_active=true): Flag true.
--   • Jede manuelle DB-Änderung, die is_active=true setzt: Flag true.
-- Das Flag wird nur GESETZT (nie zurück auf false) — Deaktivieren lässt es
-- unangetastet.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.mark_freigeschaltet_on_active()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_active IS TRUE THEN
    NEW.je_freigeschaltet := TRUE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_freigeschaltet ON public.profiles;
CREATE TRIGGER trg_mark_freigeschaltet
  BEFORE INSERT OR UPDATE OF is_active ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.mark_freigeschaltet_on_active();

-- Sicherheitshalber Bestand angleichen (sollte nach dem 20260714100000-
-- Backfill schon stimmen, ist aber idempotent).
UPDATE public.profiles
   SET je_freigeschaltet = TRUE
 WHERE is_active = TRUE AND je_freigeschaltet = FALSE;
