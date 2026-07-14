-- =====================================================================
-- Feedback-Kanal: jeder eingeloggte Nutzer kann Verbesserungswünsche /
-- Fehler / Lob eingeben. Nur Admins (Büro/GF) sehen & verwalten alles.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  erstellt_von  UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  text          TEXT NOT NULL CHECK (length(btrim(text)) > 0),
  -- idee | problem | lob | sonstiges
  kategorie     TEXT NOT NULL DEFAULT 'idee',
  -- Wo war der Nutzer? (Pfad) + App-Version — hilft beim Nachvollziehen.
  seiten_kontext TEXT,
  app_version   TEXT,
  -- neu | gesehen | umgesetzt | abgelehnt
  status        TEXT NOT NULL DEFAULT 'neu',
  admin_notiz   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_status_idx ON public.feedback (status);
CREATE INDEX IF NOT EXISTS feedback_created_idx ON public.feedback (created_at DESC);

-- updated_at pflegen
DROP TRIGGER IF EXISTS trg_feedback_updated ON public.feedback;
CREATE TRIGGER trg_feedback_updated
  BEFORE UPDATE ON public.feedback
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Anlegen: jeder eingeloggte Nutzer, aber nur in eigenem Namen.
DROP POLICY IF EXISTS feedback_insert ON public.feedback;
CREATE POLICY feedback_insert ON public.feedback
  FOR INSERT TO authenticated
  WITH CHECK (erstellt_von = auth.uid());

-- Lesen: eigenes Feedback ODER Admin sieht alles.
DROP POLICY IF EXISTS feedback_select ON public.feedback;
CREATE POLICY feedback_select ON public.feedback
  FOR SELECT TO authenticated
  USING (erstellt_von = auth.uid() OR public.is_admin_role(auth.uid()));

-- Bearbeiten (Status/Notiz): nur Admin.
DROP POLICY IF EXISTS feedback_update ON public.feedback;
CREATE POLICY feedback_update ON public.feedback
  FOR UPDATE TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

-- Löschen: nur Admin.
DROP POLICY IF EXISTS feedback_delete ON public.feedback;
CREATE POLICY feedback_delete ON public.feedback
  FOR DELETE TO authenticated
  USING (public.is_admin_role(auth.uid()));

NOTIFY pgrst, 'reload schema';
