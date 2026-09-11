-- Bautagesbericht: Zeilen, die beim Anlegen aus dem Tagesplan (Einteilung)
-- vorbelegt wurden. Sie sind Platzhalter, bis die Zeiterfassung die echten
-- Stunden liefert — dann werden sie wie aus_zeiterfassung-Zeilen ersetzt.
ALTER TABLE public.bericht_mitarbeiter
  ADD COLUMN IF NOT EXISTS aus_einteilung boolean NOT NULL DEFAULT false;
ALTER TABLE public.bericht_taetigkeiten
  ADD COLUMN IF NOT EXISTS aus_einteilung boolean NOT NULL DEFAULT false;
ALTER TABLE public.berichte
  ADD COLUMN IF NOT EXISTS einteilung_quelle_am timestamptz;
