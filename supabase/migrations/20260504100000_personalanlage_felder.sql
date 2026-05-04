-- Personalanlageblatt-Felder für profiles
-- Quelle: Vorlage "PERSONAL ANLAGEBLATT.docx" — alle dort erfassten Stammdaten
-- werden hier als optionale Felder gespiegelt, damit die Personalakte
-- digital geführt werden kann.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS geburtsdatum DATE,
  ADD COLUMN IF NOT EXISTS geburtsort TEXT,
  ADD COLUMN IF NOT EXISTS sv_nr TEXT,
  ADD COLUMN IF NOT EXISTS staatsangehoerigkeit TEXT,
  ADD COLUMN IF NOT EXISTS religion TEXT,
  ADD COLUMN IF NOT EXISTS familienstand TEXT,
  ADD COLUMN IF NOT EXISTS wohn_strasse TEXT,
  ADD COLUMN IF NOT EXISTS wohn_plz TEXT,
  ADD COLUMN IF NOT EXISTS wohn_ort TEXT,
  ADD COLUMN IF NOT EXISTS wohn_land TEXT,
  ADD COLUMN IF NOT EXISTS erlernter_beruf TEXT,
  ADD COLUMN IF NOT EXISTS letzter_arbeitgeber TEXT,
  ADD COLUMN IF NOT EXISTS vorbeschaeftigung_von DATE,
  ADD COLUMN IF NOT EXISTS vorbeschaeftigung_bis DATE,
  ADD COLUMN IF NOT EXISTS sonstige_pruefungen TEXT,
  ADD COLUMN IF NOT EXISTS bewerbung_als TEXT,
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_bic TEXT,
  ADD COLUMN IF NOT EXISTS bank_iban TEXT,
  ADD COLUMN IF NOT EXISTS vorstellungsdatum DATE,
  ADD COLUMN IF NOT EXISTS stundenlohn NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS zulagen TEXT,
  ADD COLUMN IF NOT EXISTS personal_vermerke TEXT;

COMMENT ON COLUMN public.profiles.sv_nr IS 'österreichische Versicherungsnummer (10-stellig)';
COMMENT ON COLUMN public.profiles.bank_iban IS 'IBAN für Lohnauszahlung';
COMMENT ON COLUMN public.profiles.stundenlohn IS 'Brutto-Stundenlohn in Euro';
COMMENT ON COLUMN public.profiles.zulagen IS 'Freitext: z.B. KFZ-Zulage, Lehrlingszulage';
