-- =====================================================================
-- „Neue Anmeldung wartet auf dich" zeigte ALT-deaktivierte Mitarbeiter.
--
-- Der je_freigeschaltet-Backfill vom 14.07. hat nur Profile erfasst, die
-- IN DEM MOMENT aktiv waren. Wer schon davor deaktiviert wurde (Austritt,
-- kurzzeitig weg), blieb auf je_freigeschaltet=false — und taucht seither
-- im Dashboard-Banner als „neue Anmeldung" auf, obwohl er ein Bestands-
-- Mitarbeiter ist.
--
-- Kriterium für „war sicher schon einmal echter Mitarbeiter":
-- Personalnummer vergeben ODER Stunden erfasst ODER je in einer
-- Einteilung. Eine echte offene Selbst-Registrierung (z. B. die namenlose
-- SMS-Anmeldung) hat nichts davon und bleibt korrekt im Banner.
-- =====================================================================

UPDATE public.profiles p
   SET je_freigeschaltet = TRUE
 WHERE p.is_active = FALSE
   AND p.je_freigeschaltet = FALSE
   AND (
     p.pers_nr IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.stunden_tage t WHERE t.mitarbeiter_id = p.id)
     OR EXISTS (SELECT 1 FROM public.einteilung_mitarbeiter em WHERE em.mitarbeiter_id = p.id)
     OR EXISTS (SELECT 1 FROM public.jahresplan_mitarbeiter jm WHERE jm.mitarbeiter_id = p.id)
   );
