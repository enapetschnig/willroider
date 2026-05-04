-- Sensitive Personalanlage-Felder in eigene Tabelle auslagern.
-- Bisher: alle Felder in public.profiles, RLS profiles_select_all = jeder
-- authentifizierte User sieht alles → leakt IBAN/SVNr/Stundenlohn.
-- Neu: profiles_sensitive mit eigenem RLS — nur Admin oder Person selbst.

CREATE TABLE IF NOT EXISTS public.profiles_sensitive (
  profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  sv_nr TEXT,
  religion TEXT,
  familienstand TEXT,
  bank_name TEXT,
  bank_bic TEXT,
  bank_iban TEXT,
  stundenlohn NUMERIC(7,2),
  zulagen TEXT,
  letzter_arbeitgeber TEXT,
  vorbeschaeftigung_von DATE,
  vorbeschaeftigung_bis DATE,
  personal_vermerke TEXT,
  vorstellungsdatum DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bestandsdaten übernehmen (nur wenn etwas in den alten Spalten steht)
INSERT INTO public.profiles_sensitive (
  profile_id, sv_nr, religion, familienstand, bank_name, bank_bic, bank_iban,
  stundenlohn, zulagen, letzter_arbeitgeber,
  vorbeschaeftigung_von, vorbeschaeftigung_bis, personal_vermerke, vorstellungsdatum
)
SELECT id, sv_nr, religion, familienstand, bank_name, bank_bic, bank_iban,
       stundenlohn, zulagen, letzter_arbeitgeber,
       vorbeschaeftigung_von, vorbeschaeftigung_bis, personal_vermerke, vorstellungsdatum
FROM public.profiles
WHERE COALESCE(sv_nr, '') <> ''
   OR COALESCE(bank_iban, '') <> ''
   OR COALESCE(bank_bic, '') <> ''
   OR COALESCE(bank_name, '') <> ''
   OR stundenlohn IS NOT NULL
   OR COALESCE(religion, '') <> ''
   OR COALESCE(familienstand, '') <> ''
   OR COALESCE(zulagen, '') <> ''
   OR COALESCE(letzter_arbeitgeber, '') <> ''
   OR vorbeschaeftigung_von IS NOT NULL
   OR vorbeschaeftigung_bis IS NOT NULL
   OR COALESCE(personal_vermerke, '') <> ''
   OR vorstellungsdatum IS NOT NULL
ON CONFLICT (profile_id) DO NOTHING;

-- Sensitive Spalten aus profiles entfernen (idempotent durch IF EXISTS)
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS sv_nr,
  DROP COLUMN IF EXISTS religion,
  DROP COLUMN IF EXISTS familienstand,
  DROP COLUMN IF EXISTS bank_name,
  DROP COLUMN IF EXISTS bank_bic,
  DROP COLUMN IF EXISTS bank_iban,
  DROP COLUMN IF EXISTS stundenlohn,
  DROP COLUMN IF EXISTS zulagen,
  DROP COLUMN IF EXISTS letzter_arbeitgeber,
  DROP COLUMN IF EXISTS vorbeschaeftigung_von,
  DROP COLUMN IF EXISTS vorbeschaeftigung_bis,
  DROP COLUMN IF EXISTS personal_vermerke,
  DROP COLUMN IF EXISTS vorstellungsdatum;

ALTER TABLE public.profiles_sensitive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_sensitive_select ON public.profiles_sensitive;
CREATE POLICY profiles_sensitive_select ON public.profiles_sensitive
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.is_admin_role(auth.uid()));

DROP POLICY IF EXISTS profiles_sensitive_modify ON public.profiles_sensitive;
CREATE POLICY profiles_sensitive_modify ON public.profiles_sensitive
  FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

-- updated_at-Trigger (nutzt vorhandene set_updated_at-Funktion)
DROP TRIGGER IF EXISTS profiles_sensitive_set_updated_at ON public.profiles_sensitive;
CREATE TRIGGER profiles_sensitive_set_updated_at
  BEFORE UPDATE ON public.profiles_sensitive
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
