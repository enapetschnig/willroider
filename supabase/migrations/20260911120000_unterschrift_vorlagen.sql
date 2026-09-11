-- =====================================================================
-- Gespeicherte Unterschrift je Person — „Meine Unterschrift einfügen".
-- Am Rechner sieht Zeichnen mit der Maus unbeholfen aus: einmal am Handy
-- zeichnen (oder ein Bild hochladen), danach überall mit einem Klick.
-- Eigene Tabelle statt profiles: profiles ist für alle lesbar, die
-- Unterschrift soll es nicht sein.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.unterschrift_vorlagen (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  data text NOT NULL,                       -- PNG als Data-URL
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.unterschrift_vorlagen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.unterschrift_vorlagen FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.unterschrift_vorlagen TO authenticated;

DROP POLICY IF EXISTS unterschrift_vorlagen_select ON public.unterschrift_vorlagen;
CREATE POLICY unterschrift_vorlagen_select ON public.unterschrift_vorlagen
  FOR SELECT TO authenticated USING (profile_id = auth.uid());
DROP POLICY IF EXISTS unterschrift_vorlagen_write ON public.unterschrift_vorlagen;
CREATE POLICY unterschrift_vorlagen_write ON public.unterschrift_vorlagen
  FOR ALL TO authenticated USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());
