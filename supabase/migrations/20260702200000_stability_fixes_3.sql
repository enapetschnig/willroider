-- =====================================================================
-- Stability-Fixes Runde 3 (Audit R2, 2026-07-02)
--
-- 1. Tagesplanung: Die bloße EXISTENZ einer tagesplanung_freigaben-Zeile
--    war das Freigabe-Signal für die RLS — aber der Sonstige-Hinweise-
--    Autosave legte diese Zeile beim Tippen an → halbfertiger Plan wurde
--    an alle MA veröffentlicht. Fix: freigegeben_am nullable; RLS und
--    App prüfen jetzt freigegeben_am IS NOT NULL. Notiz kann damit vor
--    der Freigabe existieren, und Freigabe-Rücknahme (UPDATE auf NULL)
--    erhält die Notiz.
-- 2. Krankmeldung löschen: Auto-erzeugte 'krank'-Tage blieben als Waisen
--    in stunden_tage (zählten im Abschluss als Soll-erfüllt). Fix:
--    AFTER-DELETE-Trigger räumt die reinen Auto-Tage ab.
-- 3. stunden_tage_update: Partieleiter-Zweig ergänzt — die Kind-Policies
--    (st/sz/sf_write) erlauben is_partieleiter_of, der Parent nicht;
--    Polier-Speichern für Partie-MA schlug am Header-Update fehl.
-- =====================================================================

-- ─── 1. Freigabe von Notiz entkoppeln ─────────────────────────────────
ALTER TABLE public.tagesplanung_freigaben
  ALTER COLUMN freigegeben_am DROP NOT NULL,
  ALTER COLUMN freigegeben_am DROP DEFAULT;

DROP POLICY IF EXISTS einteilungen_select ON public.einteilungen;
CREATE POLICY einteilungen_select ON public.einteilungen FOR SELECT TO authenticated
  USING (
    public.is_admin_role(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.tagesplanung_freigaben f
       WHERE f.datum = einteilungen.datum
         AND f.freigegeben_am IS NOT NULL
    )
  );

DROP POLICY IF EXISTS einteilung_ma_select ON public.einteilung_mitarbeiter;
CREATE POLICY einteilung_ma_select ON public.einteilung_mitarbeiter FOR SELECT TO authenticated
  USING (
    public.is_admin_role(auth.uid())
    OR EXISTS (
      SELECT 1
        FROM public.einteilungen e
        JOIN public.tagesplanung_freigaben f
          ON f.datum = e.datum AND f.freigegeben_am IS NOT NULL
       WHERE e.id = einteilung_mitarbeiter.einteilung_id
    )
  );

DROP POLICY IF EXISTS ef_select ON public.einteilung_fahrzeuge;
CREATE POLICY ef_select ON public.einteilung_fahrzeuge FOR SELECT TO authenticated
  USING (
    public.is_admin_role(auth.uid())
    OR EXISTS (
      SELECT 1
        FROM public.einteilungen e
        JOIN public.tagesplanung_freigaben f
          ON f.datum = e.datum AND f.freigegeben_am IS NOT NULL
       WHERE e.id = einteilung_fahrzeuge.einteilung_id
    )
  );

-- ─── 2. Krankmeldung-Delete räumt Auto-Krank-Tage ab ──────────────────
-- Nur die vom Insert-Trigger ERZEUGTEN Tage (tag_status='krank', keine
-- erfassten Tätigkeiten) werden entfernt. Tage, die der Trigger von
-- 'erfasst' auf 'krank' umgestellt hat und die Tätigkeiten tragen,
-- bleiben — deren Vorzustand ist nicht rekonstruierbar.
CREATE OR REPLACE FUNCTION public.krankmeldung_cleanup_stunden_tage()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM public.stunden_tage st
   WHERE st.mitarbeiter_id = OLD.mitarbeiter_id
     AND st.datum BETWEEN OLD.von AND OLD.bis
     AND st.tag_status = 'krank'
     AND NOT public.month_locked(st.mitarbeiter_id, st.datum)
     AND NOT EXISTS (
       SELECT 1 FROM public.stunden_taetigkeiten tt
        WHERE tt.stunden_tag_id = st.id
     );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_krankmeldung_delete ON public.krankmeldungen;
CREATE TRIGGER trg_krankmeldung_delete
  AFTER DELETE ON public.krankmeldungen
  FOR EACH ROW
  EXECUTE FUNCTION public.krankmeldung_cleanup_stunden_tage();

-- ─── 3. Parent-Policy an Kind-Policies angleichen ─────────────────────
DROP POLICY IF EXISTS stunden_tage_update ON public.stunden_tage;
CREATE POLICY stunden_tage_update ON public.stunden_tage
  FOR UPDATE TO authenticated
  USING (
    public.is_admin_role(auth.uid())
    OR public.has_permission(auth.uid(), 'stunden.create_andere')
    OR public.has_permission(auth.uid(), 'stunden.edit_alle')
    OR (
      (mitarbeiter_id = auth.uid()
       OR erfasst_von = auth.uid()
       OR public.is_partieleiter_of(auth.uid(), mitarbeiter_id))
      AND status IN ('erfasst', 'ma_bestaetigt')
      AND NOT public.month_locked(mitarbeiter_id, datum)
    )
  );

NOTIFY pgrst, 'reload schema';
