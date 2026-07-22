-- =====================================================================
-- Änderungswünsche werden zum Gespräch statt zum Einbahn-Postkasten.
--
-- Bisher: Mitarbeiter schickt einen Wunsch ab und sieht ihn NIE WIEDER —
-- es gab keinerlei Ansicht der eigenen Wünsche. Eine Rückfrage konnte
-- ihn also gar nicht erreichen.
--
-- Neu: Kommentar-Faden je Wunsch (Rückfrage, Antwort, Notiz, Screenshot).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.feedback_kommentare (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id  UUID NOT NULL REFERENCES public.feedback(id) ON DELETE CASCADE,
  autor_id     UUID,
  text         TEXT,
  -- Rückfrage an den Melder (erzeugt bei ihm den roten Punkt)
  ist_frage    BOOLEAN NOT NULL DEFAULT FALSE,
  -- Interne Notiz: nur für die Verwaltung sichtbar, nie für den Melder
  ist_intern   BOOLEAN NOT NULL DEFAULT FALSE,
  anhang_pfad  TEXT,
  anhang_name  TEXT,
  anhang_typ   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_kommentare_fb_idx
  ON public.feedback_kommentare (feedback_id, created_at);

ALTER TABLE public.feedback_kommentare ENABLE ROW LEVEL SECURITY;

-- Lesen: Verwaltung immer; der Melder nur die nicht-internen Beiträge
-- seines eigenen Wunsches.
DROP POLICY IF EXISTS fk_select ON public.feedback_kommentare;
CREATE POLICY fk_select ON public.feedback_kommentare
  FOR SELECT TO authenticated
  USING (
    public.is_admin_role(auth.uid())
    OR (
      NOT ist_intern
      AND EXISTS (
        SELECT 1 FROM public.feedback f
         WHERE f.id = feedback_id AND f.erstellt_von = auth.uid()
      )
    )
  );

-- Schreiben: Verwaltung immer; der Melder darf auf seinen eigenen Wunsch
-- antworten (aber nichts Internes und keine Rückfrage-Markierung setzen).
DROP POLICY IF EXISTS fk_insert ON public.feedback_kommentare;
CREATE POLICY fk_insert ON public.feedback_kommentare
  FOR INSERT TO authenticated
  WITH CHECK (
    autor_id = auth.uid()
    AND (
      public.is_admin_role(auth.uid())
      OR (
        NOT ist_intern
        AND NOT ist_frage
        AND EXISTS (
          SELECT 1 FROM public.feedback f
           WHERE f.id = feedback_id AND f.erstellt_von = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS fk_delete ON public.feedback_kommentare;
CREATE POLICY fk_delete ON public.feedback_kommentare
  FOR DELETE TO authenticated
  USING (public.is_admin_role(auth.uid()));

-- ── Zustand für die roten Punkte ─────────────────────────────────────
-- Statt einer Gelesen-Tabelle: wer zuletzt geschrieben hat. Daraus
-- ergibt sich beidseitig, wer am Zug ist.
ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS letzter_kommentar_am  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS letzter_kommentar_von UUID,
  ADD COLUMN IF NOT EXISTS offene_frage          BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.fn_feedback_kommentar_sync()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_feedback UUID := COALESCE(NEW.feedback_id, OLD.feedback_id);
  v_letzte   RECORD;
BEGIN
  SELECT k.autor_id, k.created_at, k.ist_frage
    INTO v_letzte
    FROM feedback_kommentare k
   WHERE k.feedback_id = v_feedback AND NOT k.ist_intern
   ORDER BY k.created_at DESC
   LIMIT 1;

  UPDATE feedback f
     SET letzter_kommentar_am  = v_letzte.created_at,
         letzter_kommentar_von = v_letzte.autor_id,
         -- Offen ist eine Frage nur, solange der Melder nicht geantwortet
         -- hat (dann wäre er selbst der letzte Schreiber).
         offene_frage = COALESCE(
           v_letzte.ist_frage AND v_letzte.autor_id IS DISTINCT FROM f.erstellt_von,
           FALSE
         )
   WHERE f.id = v_feedback;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_feedback_kommentar_sync ON public.feedback_kommentare;
CREATE TRIGGER trg_feedback_kommentar_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.feedback_kommentare
  FOR EACH ROW EXECUTE FUNCTION public.fn_feedback_kommentar_sync();

-- Storage: Hängt die Verwaltung einen Screenshot an eine Rückfrage, liegt
-- er in IHREM Ordner — der Melder käme sonst nicht dran.
DROP POLICY IF EXISTS feedback_dateien_select_faden ON storage.objects;
CREATE POLICY feedback_dateien_select_faden ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'feedback-dateien'
    AND EXISTS (
      SELECT 1
        FROM public.feedback_kommentare k
        JOIN public.feedback f ON f.id = k.feedback_id
       WHERE k.anhang_pfad = storage.objects.name
         AND NOT k.ist_intern
         AND f.erstellt_von = auth.uid()
    )
  );

-- Realtime, damit Rückfragen ohne Neuladen ankommen
ALTER PUBLICATION supabase_realtime ADD TABLE public.feedback_kommentare;

NOTIFY pgrst, 'reload schema';
