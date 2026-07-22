-- =====================================================================
-- Versand-Nachweis für Dokumente (u.a. die Baustellenmeldung).
-- Bisher schrieb die Edge-Function `dokument-versenden` NICHTS mit —
-- man konnte einem Dokument nicht ansehen, ob die E-Mail schon raus ist.
-- Als Protokoll (nicht als Häkchen), damit auch mehrfacher Versand,
-- Empfänger und Absender nachvollziehbar bleiben.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.dokument_versand (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dokument_id   UUID NOT NULL REFERENCES public.dokumente(id) ON DELETE CASCADE,
  empfaenger    TEXT NOT NULL,
  betreff       TEXT,
  versendet_von UUID,
  versendet_am  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dokument_versand_dok_idx
  ON public.dokument_versand (dokument_id, versendet_am DESC);

ALTER TABLE public.dokument_versand ENABLE ROW LEVEL SECURITY;

-- Lesen darf, wer Baustellen sehen darf (die Doku hängt an der Baustelle).
-- Schreiben nur die Edge-Function via Service-Role — daher keine
-- INSERT-Policy für authenticated.
DROP POLICY IF EXISTS dokument_versand_select ON public.dokument_versand;
CREATE POLICY dokument_versand_select ON public.dokument_versand
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'baustellen.view'));

NOTIFY pgrst, 'reload schema';
