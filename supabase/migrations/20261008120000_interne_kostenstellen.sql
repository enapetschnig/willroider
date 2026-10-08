-- =====================================================================
-- Interne Kostenstellen für die Stundenerfassung.
--
-- Änderungswunsch N. Gwenger 08.10.: „Bei Firma muss auch die Baustelle
-- ausgewählt werden können. Es dürfen keine Stunden geschrieben werden ohne
-- eine Baustelle bzw. Kostenstelle auszuwählen (außer Krank, Urlaub,
-- Schlechtwetter). Es müssen auch folgende Kostenstellen auswählbar sein:
-- 1404899 Zimmerei Allgemein (Schulungen etc.) und 4760 Woodwork sonstige
-- Kosten (Lagerarbeiten etc.)."
--
-- Kostenstellen sind in der Stundenerfassung baustellen-Zeilen (wie schon
-- die Maschinen). Die zwei internen bekommen kategorie = 'intern': Sie
-- stehen nur bei „Firma" zur Auswahl (kein Taggeld) und nicht bei
-- „Baustelle". Die Pflicht zur Kostenstelle prüft die App beim Speichern.
-- =====================================================================

ALTER TABLE public.baustellen DROP CONSTRAINT IF EXISTS baustellen_kategorie_check;
ALTER TABLE public.baustellen
  ADD CONSTRAINT baustellen_kategorie_check
  CHECK (kategorie IN ('baustelle', 'maschine', 'intern'));

COMMENT ON COLUMN public.baustellen.kategorie IS
  'baustelle = Kundenbaustelle, maschine = Werk/Halle, intern = interne Kostenstelle (nur bei Firma wählbar, kein Taggeld).';

INSERT INTO public.baustellen (bvh_name, kostenstelle, status, kategorie)
SELECT v.name, v.kst, 'aktiv', 'intern'
  FROM (VALUES
          ('Zimmerei Allgemein', '1404899'),
          ('Woodwork sonstige Kosten', '4760')
       ) AS v(name, kst)
 WHERE NOT EXISTS (
         SELECT 1 FROM public.baustellen b WHERE b.kostenstelle = v.kst
       );
