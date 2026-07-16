-- =====================================================================
-- Rollen-Bezeichnungen: Das Mitarbeiter-Dropdown zeigte für die Rolle
-- 'bauleiter' bisher hart codiert „Vorarbeiter" — die rollen-Tabelle
-- aber „Bauleiter". Jetzt, wo das Dropdown dynamisch aus der Tabelle
-- liest, wird die DB an das gewohnte UI-Label angeglichen.
-- (Ab jetzt in der Verwaltung → Berechtigungen → Bearbeiten umbenennbar.)
-- =====================================================================

UPDATE public.rollen
   SET bezeichnung = 'Vorarbeiter'
 WHERE schluessel = 'bauleiter'
   AND bezeichnung = 'Bauleiter';

NOTIFY pgrst, 'reload schema';
