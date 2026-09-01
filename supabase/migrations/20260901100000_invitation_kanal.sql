-- =====================================================================
-- Einladung per E-Mail: invitation_logs lernt den Versandweg.
--
-- kanal: 'sms' | 'email' — je Versand ein Log-Eintrag.
-- empfaenger: Telefonnummer bzw. E-Mail-Adresse des Versands.
-- telefonnummer wird optional (eine reine E-Mail-Einladung hat keine).
-- =====================================================================

ALTER TABLE public.invitation_logs
  ADD COLUMN IF NOT EXISTS kanal text NOT NULL DEFAULT 'sms'
  CHECK (kanal IN ('sms', 'email'));

ALTER TABLE public.invitation_logs
  ADD COLUMN IF NOT EXISTS empfaenger text NULL;

ALTER TABLE public.invitation_logs
  ALTER COLUMN telefonnummer DROP NOT NULL;

-- Bestand: bisher war alles SMS an die Telefonnummer.
UPDATE public.invitation_logs
   SET empfaenger = telefonnummer
 WHERE empfaenger IS NULL AND telefonnummer IS NOT NULL;
