-- Mitarbeiter-Anlage durch Admin + SMS-Einladungen via Twilio.
-- Heilt zwei Bugs in der vorhandenen send-invitation Edge Function:
-- 1. fehlende invitation_logs-Tabelle (Inserts in der Function liefen ins Leere)
-- 2. legt das Fundament fuer Admin-Mitarbeiter-Anlage + Re-Send-Flow.

-- ─── invitation_logs ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invitation_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  telefonnummer TEXT NOT NULL,
  gesendet_von  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  gesendet_am   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        TEXT NOT NULL DEFAULT 'gesendet'  -- 'gesendet' | 'fehler'
                CHECK (status IN ('gesendet', 'fehler')),
  twilio_sid    TEXT,
  fehler        TEXT,
  sms_text      TEXT
);

CREATE INDEX IF NOT EXISTS idx_invitation_logs_profile
  ON public.invitation_logs (profile_id);
CREATE INDEX IF NOT EXISTS idx_invitation_logs_zeit
  ON public.invitation_logs (gesendet_am DESC);

ALTER TABLE public.invitation_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invitation_logs_admin_read ON public.invitation_logs;
CREATE POLICY invitation_logs_admin_read ON public.invitation_logs
  FOR SELECT TO authenticated
  USING (public.is_admin_role(auth.uid()));

DROP POLICY IF EXISTS invitation_logs_admin_write ON public.invitation_logs;
CREATE POLICY invitation_logs_admin_write ON public.invitation_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_role(auth.uid()));

COMMENT ON TABLE public.invitation_logs IS
  'Protokoll aller versendeten SMS-Einladungen (Twilio). Nur Admins sehen/schreiben.';
