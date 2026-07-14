-- =====================================================================
-- Feedback: Realtime aktivieren, damit Admin-Liste und Dashboard-Zähler
-- live aktualisieren (die postgres_changes-Subscriptions bekamen bisher
-- nie ein Event, weil die Tabelle nicht in der Publication war).
-- =====================================================================

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.feedback;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Defense-in-Depth: anon braucht keinen Zugriff (RLS schützt bereits,
-- das entfernt zusätzlich die Default-Grants).
REVOKE ALL ON public.feedback FROM anon;

NOTIFY pgrst, 'reload schema';
