-- =====================================================================
-- 1) Änderungswünsche: Datei-/Screenshot-Anhang
-- 2) Notizen-Modul: Ordner + Notizen (+ Anhänge/Skizzen) für Büro/BL/GF
-- =====================================================================

-- ── 1) Feedback-Anhang ───────────────────────────────────────────────
ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS anhang_pfad TEXT,
  ADD COLUMN IF NOT EXISTS anhang_name TEXT,
  ADD COLUMN IF NOT EXISTS anhang_typ TEXT;

INSERT INTO storage.buckets (id, name, public)
VALUES ('feedback-dateien', 'feedback-dateien', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS feedback_dateien_insert ON storage.objects;
CREATE POLICY feedback_dateien_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'feedback-dateien'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS feedback_dateien_select ON storage.objects;
CREATE POLICY feedback_dateien_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'feedback-dateien'
    AND (
      public.is_admin_role(auth.uid())
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS feedback_dateien_delete ON storage.objects;
CREATE POLICY feedback_dateien_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'feedback-dateien' AND public.is_admin_role(auth.uid()));

-- ── 2) Notizen-Modul ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notiz_ordner (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  erstellt_von UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notizen (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ordner_id    UUID REFERENCES public.notiz_ordner(id) ON DELETE SET NULL,
  baustelle_id UUID REFERENCES public.baustellen(id) ON DELETE SET NULL,
  titel        TEXT NOT NULL DEFAULT '',
  inhalt       TEXT NOT NULL DEFAULT '',
  erstellt_von UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notiz_anhaenge (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notiz_id    UUID NOT NULL REFERENCES public.notizen(id) ON DELETE CASCADE,
  pfad        TEXT NOT NULL,
  name        TEXT NOT NULL,
  typ         TEXT,
  ist_skizze  BOOLEAN NOT NULL DEFAULT FALSE,
  erstellt_von UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notizen_ordner_idx ON public.notizen (ordner_id);
CREATE INDEX IF NOT EXISTS notizen_baustelle_idx ON public.notizen (baustelle_id);
CREATE INDEX IF NOT EXISTS notiz_anhaenge_notiz_idx ON public.notiz_anhaenge (notiz_id);

DROP TRIGGER IF EXISTS trg_notizen_updated ON public.notizen;
CREATE TRIGGER trg_notizen_updated
  BEFORE UPDATE ON public.notizen
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.notiz_ordner ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notizen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notiz_anhaenge ENABLE ROW LEVEL SECURITY;

-- Gemeinsames Büro-Werkzeug: alle mit Verwaltungs-Zugang (Büro/BL/GF)
-- sehen und bearbeiten alles.
DROP POLICY IF EXISTS notiz_ordner_all ON public.notiz_ordner;
CREATE POLICY notiz_ordner_all ON public.notiz_ordner
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'admin.view'))
  WITH CHECK (public.has_permission(auth.uid(), 'admin.view'));

DROP POLICY IF EXISTS notizen_all ON public.notizen;
CREATE POLICY notizen_all ON public.notizen
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'admin.view'))
  WITH CHECK (public.has_permission(auth.uid(), 'admin.view'));

DROP POLICY IF EXISTS notiz_anhaenge_all ON public.notiz_anhaenge;
CREATE POLICY notiz_anhaenge_all ON public.notiz_anhaenge
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'admin.view'))
  WITH CHECK (public.has_permission(auth.uid(), 'admin.view'));

INSERT INTO storage.buckets (id, name, public)
VALUES ('notizen-anhaenge', 'notizen-anhaenge', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS notizen_anhaenge_rw ON storage.objects;
CREATE POLICY notizen_anhaenge_rw ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'notizen-anhaenge' AND public.has_permission(auth.uid(), 'admin.view'))
  WITH CHECK (bucket_id = 'notizen-anhaenge' AND public.has_permission(auth.uid(), 'admin.view'));

NOTIFY pgrst, 'reload schema';
