-- =====================================================================
-- Änderungswünsche per Sprachnachricht: Audio-Aufnahme statt/zusätzlich
-- zum Text. Audio liegt im (privaten) Storage-Bucket 'feedback-audio',
-- die feedback-Zeile verweist per Pfad darauf.
-- =====================================================================

-- Text ist nun optional (wenn eine Sprachnachricht dabei ist).
ALTER TABLE public.feedback ALTER COLUMN text DROP NOT NULL;
ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_text_check;

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS audio_pfad TEXT,
  ADD COLUMN IF NOT EXISTS audio_typ TEXT,
  ADD COLUMN IF NOT EXISTS audio_sekunden INTEGER;

-- Mindestens Text ODER Sprachnachricht muss vorhanden sein.
ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_inhalt_check;
ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_inhalt_check
  CHECK (
    (text IS NOT NULL AND length(btrim(text)) > 0)
    OR audio_pfad IS NOT NULL
  );

-- ── Storage-Bucket (privat) ─────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('feedback-audio', 'feedback-audio', false)
ON CONFLICT (id) DO NOTHING;

-- Hochladen: jeder eingeloggte Nutzer, aber nur in seinen eigenen Ordner
-- ({uid}/…) — verhindert Fremd-Uploads.
DROP POLICY IF EXISTS feedback_audio_insert ON storage.objects;
CREATE POLICY feedback_audio_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'feedback-audio'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Lesen (für signierte URLs): eigene Aufnahme ODER Admin.
DROP POLICY IF EXISTS feedback_audio_select ON storage.objects;
CREATE POLICY feedback_audio_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'feedback-audio'
    AND (
      public.is_admin_role(auth.uid())
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

-- Löschen: nur Admin (räumt mit dem Feedback auf).
DROP POLICY IF EXISTS feedback_audio_delete ON storage.objects;
CREATE POLICY feedback_audio_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'feedback-audio' AND public.is_admin_role(auth.uid()));

NOTIFY pgrst, 'reload schema';
