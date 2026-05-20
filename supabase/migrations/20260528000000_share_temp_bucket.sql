-- Storage-Bucket fuer temporaere WhatsApp-Sharing-Links.
-- PDF wird hochgeladen, signed URL (7 Tage) erzeugt und ueber wa.me geteilt.
-- Idempotent — kann mehrfach laufen.

INSERT INTO storage.buckets (id, name, public)
VALUES ('share-temp', 'share-temp', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS share_temp_select ON storage.objects;
CREATE POLICY share_temp_select ON storage.objects FOR SELECT
  USING (bucket_id = 'share-temp');

DROP POLICY IF EXISTS share_temp_insert ON storage.objects;
CREATE POLICY share_temp_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'share-temp');

DROP POLICY IF EXISTS share_temp_delete ON storage.objects;
CREATE POLICY share_temp_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'share-temp');

NOTIFY pgrst, 'reload schema';
