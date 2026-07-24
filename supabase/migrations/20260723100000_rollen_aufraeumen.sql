-- =====================================================================
-- Ungenutzte Rollen entfernen: 'zimmermeister' und 'polier_vorarbeiter'.
--
-- Geprüft vor dem Löschen:
--   • Niemand hat sie — 0 aktive UND 0 inaktive Zuordnungen in user_roles.
--   • Keine DB-Funktion und keine RLS-Policy nennt sie namentlich.
--   • 'polier_vorarbeiter' kommt im Frontend-Code überhaupt nicht vor.
--   • 'polier_vorarbeiter' ist ein Duplikat: Die tatsächlich genutzte Rolle
--     'bauleiter' (11 Personen) heißt in der Oberfläche bereits
--     „Vorarbeiter / Polier".
--
-- rollen_berechtigungen hängt mit ON DELETE CASCADE dran — die je 28
-- Rechte-Zuordnungen verschwinden automatisch mit.
--
-- FALLS JE ZURÜCKGEHOLT: beide Rollen hatten exakt dieselben 28 Rechte:
--   arbeitsplanung.view, arbeitszeitkalender.view,
--   baustellen.dokumente.upload, baustellen.dokumente.view,
--   baustellen.termine, baustellen.view, berichte.create,
--   berichte.edit_alle, berichte.edit_eigene, berichte.freigeben,
--   berichte.view, dashboard.view, evaluierungen.create,
--   evaluierungen.unterschreiben, evaluierungen.view, fahrzeuge.view,
--   feedback.bearbeiten, feedback.view_alle, konten.view_eigene,
--   meintag.view, mitarbeiter.view, stunden.create_andere,
--   stunden.create_eigene, stunden.freigeben_zm, stunden.view_alle,
--   stunden.view_eigene, stunden.view_partie, tagesplanung.view
--
-- Der Legacy-Enum-Wert app_role.'zimmermeister' bleibt bestehen
-- (Enum-Werte lassen sich in Postgres nicht gefahrlos entfernen). Er wird
-- von keiner Zeile in user_roles.role verwendet und stört nicht.
-- =====================================================================

-- Sicherheitsnetz: nur löschen, wenn wirklich niemand die Rolle hat.
DO $$
DECLARE
  v_belegt INT;
BEGIN
  SELECT count(*) INTO v_belegt
    FROM user_roles ur
    JOIN rollen r ON r.id = ur.rolle_id
   WHERE r.schluessel IN ('zimmermeister', 'polier_vorarbeiter');

  IF v_belegt > 0 THEN
    RAISE EXCEPTION
      'Abbruch: % Zuordnung(en) auf zimmermeister/polier_vorarbeiter vorhanden — Rollen NICHT gelöscht.',
      v_belegt;
  END IF;

  DELETE FROM rollen WHERE schluessel IN ('zimmermeister', 'polier_vorarbeiter');
END $$;

NOTIFY pgrst, 'reload schema';
