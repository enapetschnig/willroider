-- Polierschule als eigene Abwesenheit (Wunsch 12.10.2026, Christoph).
-- Eigene Datei: ALTER TYPE … ADD VALUE muss committed sein, bevor die
-- Funktionen in 20261012100100_polierschule.sql den Wert verwenden.
ALTER TYPE public.tag_status ADD VALUE IF NOT EXISTS 'polierschule' AFTER 'berufsschule';
