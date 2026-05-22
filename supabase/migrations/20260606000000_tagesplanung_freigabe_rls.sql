-- ============================================================================
-- Tagesplanung-Freigabe: Mitarbeiter sehen einen Tag erst nach Freigabe.
--
-- Bisher waren einteilungen/einteilung_mitarbeiter/einteilung_fahrzeuge per
-- RLS für ALLE sichtbar. Jetzt: Admins (is_admin_role) sehen alles, alle
-- anderen nur Tage mit einer Zeile in tagesplanung_freigaben.
--
-- Freigeben/Zurücknehmen darf nur Büro + Geschäftsführung (nicht Bauleiter).
-- ============================================================================

-- ─── Helper: wer darf die Tagesplanung freigeben ────────────────────────
CREATE OR REPLACE FUNCTION public.darf_tagesplan_freigeben(_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid
      AND role IN ('buero', 'geschaeftsfuehrung')
  );
$$;

-- ─── SELECT-RLS: einteilungen ───────────────────────────────────────────
DROP POLICY IF EXISTS "einteilungen_select_all" ON public.einteilungen;
DROP POLICY IF EXISTS "einteilungen_select" ON public.einteilungen;
CREATE POLICY "einteilungen_select" ON public.einteilungen
  FOR SELECT TO authenticated USING (
    public.is_admin_role(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.tagesplanung_freigaben f
      WHERE f.datum = einteilungen.datum
    )
  );

-- ─── SELECT-RLS: einteilung_mitarbeiter ─────────────────────────────────
DROP POLICY IF EXISTS "einteilung_ma_select_all" ON public.einteilung_mitarbeiter;
DROP POLICY IF EXISTS "einteilung_ma_select" ON public.einteilung_mitarbeiter;
CREATE POLICY "einteilung_ma_select" ON public.einteilung_mitarbeiter
  FOR SELECT TO authenticated USING (
    public.is_admin_role(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.einteilungen e
      JOIN public.tagesplanung_freigaben f ON f.datum = e.datum
      WHERE e.id = einteilung_mitarbeiter.einteilung_id
    )
  );

-- ─── SELECT-RLS: einteilung_fahrzeuge ───────────────────────────────────
DROP POLICY IF EXISTS ef_select ON public.einteilung_fahrzeuge;
CREATE POLICY ef_select ON public.einteilung_fahrzeuge
  FOR SELECT TO authenticated USING (
    public.is_admin_role(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.einteilungen e
      JOIN public.tagesplanung_freigaben f ON f.datum = e.datum
      WHERE e.id = einteilung_fahrzeuge.einteilung_id
    )
  );

-- ─── Write-RLS: tagesplanung_freigaben → nur Büro + Geschäftsführung ─────
DROP POLICY IF EXISTS tagesplanung_freigaben_write ON public.tagesplanung_freigaben;
CREATE POLICY tagesplanung_freigaben_write ON public.tagesplanung_freigaben
  FOR ALL TO authenticated
  USING (public.darf_tagesplan_freigeben(auth.uid()))
  WITH CHECK (public.darf_tagesplan_freigeben(auth.uid()));

COMMENT ON FUNCTION public.darf_tagesplan_freigeben IS
  'TRUE wenn der Benutzer die Tagesplanung freigeben/zurücknehmen darf '
  '(Rolle buero oder geschaeftsfuehrung).';

NOTIFY pgrst, 'reload schema';
