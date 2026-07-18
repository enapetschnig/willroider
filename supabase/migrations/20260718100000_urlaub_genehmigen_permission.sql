-- =====================================================================
-- Urlaubs-Genehmigung als eigene, in der Rollen-Verwaltung einstellbare
-- Berechtigung. Default: Geschäftsführung + Büro. Steuert die Genehmigen-
-- Oberfläche, den Dashboard-Hinweis und (via RLS) das Update-Recht.
-- =====================================================================

INSERT INTO public.berechtigungen (schluessel, modul, aktion, subresource, bezeichnung, beschreibung, ist_kritisch, sort_order) VALUES
  ('urlaub.genehmigen', 'stunden', 'approve', 'urlaub', 'Urlaubsanträge genehmigen',
   'Anträge genehmigen/ablehnen; sieht offene Anträge am Dashboard', FALSE, 345)
ON CONFLICT (schluessel) DO NOTHING;

-- Default-Zuweisung: GF + Büro (in Verwaltung → Berechtigungen änderbar)
INSERT INTO public.rollen_berechtigungen (rolle_id, berechtigung_id)
SELECT r.id, b.id
  FROM public.rollen r, public.berechtigungen b
 WHERE r.schluessel IN ('geschaeftsfuehrung', 'buero')
   AND b.schluessel = 'urlaub.genehmigen'
ON CONFLICT DO NOTHING;

-- RLS: Sehen + Entscheiden hängt an der Berechtigung (Admin-Fallback bleibt)
DROP POLICY IF EXISTS urlaubsantraege_select ON public.urlaubsantraege;
CREATE POLICY urlaubsantraege_select ON public.urlaubsantraege
  FOR SELECT TO authenticated
  USING (
    mitarbeiter_id = auth.uid()
    OR public.is_admin_role(auth.uid())
    OR public.has_permission(auth.uid(), 'urlaub.genehmigen')
  );

DROP POLICY IF EXISTS urlaubsantraege_update ON public.urlaubsantraege;
CREATE POLICY urlaubsantraege_update ON public.urlaubsantraege
  FOR UPDATE TO authenticated
  USING (
    (mitarbeiter_id = auth.uid() AND status = 'offen'::urlaubsantrag_status)
    OR public.has_permission(auth.uid(), 'urlaub.genehmigen')
  )
  WITH CHECK (
    mitarbeiter_id = auth.uid()
    OR public.has_permission(auth.uid(), 'urlaub.genehmigen')
  );

NOTIFY pgrst, 'reload schema';
