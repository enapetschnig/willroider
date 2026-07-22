-- =====================================================================
-- Änderungswünsche werden zur gemeinsamen Sache:
--   feedback.view_alle       — alle Wünsche sehen (Besprechung)
--   feedback.bearbeiten      — Status setzen/zurücksetzen, Notizen, Rückfragen
--   feedback.sofort_freigeben— darf „Sofort umsetzen" vergeben (Chefsache)
-- Polier/Vorarbeiter bekommen die ersten beiden, NICHT die dritte.
-- =====================================================================

INSERT INTO public.berechtigungen (schluessel, modul, aktion, subresource, bezeichnung, beschreibung, ist_kritisch, sort_order) VALUES
  ('feedback.view_alle',  'system', 'view',   'feedback', 'Alle Änderungswünsche sehen',
   'Nicht nur die eigenen — Grundlage für die Besprechung', FALSE, 1310),
  ('feedback.bearbeiten', 'system', 'edit',   'feedback', 'Änderungswünsche bearbeiten',
   'Status setzen und zurücksetzen, Notizen und Rückfragen schreiben', FALSE, 1311),
  ('feedback.sofort_freigeben', 'system', 'approve', 'feedback', 'Für Sofort-Umsetzung freigeben',
   'Darf den Status „Sofort umsetzen" vergeben', FALSE, 1312)
ON CONFLICT (schluessel) DO NOTHING;

-- Sehen + bearbeiten: Führung, Büro und die Baustellen-Verantwortlichen
INSERT INTO public.rollen_berechtigungen (rolle_id, berechtigung_id)
SELECT r.id, b.id
  FROM public.rollen r, public.berechtigungen b
 WHERE r.schluessel IN ('geschaeftsfuehrung','buero','polier_vorarbeiter','zimmermeister','bauleiter')
   AND b.schluessel IN ('feedback.view_alle','feedback.bearbeiten')
ON CONFLICT DO NOTHING;

-- Sofort-Freigabe bleibt bei Führung + Büro
INSERT INTO public.rollen_berechtigungen (rolle_id, berechtigung_id)
SELECT r.id, b.id
  FROM public.rollen r, public.berechtigungen b
 WHERE r.schluessel IN ('geschaeftsfuehrung','buero')
   AND b.schluessel = 'feedback.sofort_freigeben'
ON CONFLICT DO NOTHING;

-- ── RLS feedback ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS feedback_select ON public.feedback;
CREATE POLICY feedback_select ON public.feedback
  FOR SELECT TO authenticated
  USING (
    erstellt_von = auth.uid()
    OR public.is_admin_role(auth.uid())
    OR public.has_permission(auth.uid(), 'feedback.view_alle')
  );

-- Status ändern darf, wer feedback.bearbeiten hat. Der Sonderfall
-- „Sofort umsetzen" verlangt zusätzlich feedback.sofort_freigeben —
-- geprüft am NEUEN Wert, damit Wegnehmen immer erlaubt bleibt.
DROP POLICY IF EXISTS feedback_update ON public.feedback;
CREATE POLICY feedback_update ON public.feedback
  FOR UPDATE TO authenticated
  USING (
    public.is_admin_role(auth.uid())
    OR public.has_permission(auth.uid(), 'feedback.bearbeiten')
  )
  WITH CHECK (
    (
      public.is_admin_role(auth.uid())
      OR public.has_permission(auth.uid(), 'feedback.bearbeiten')
    )
    AND (
      status IS DISTINCT FROM 'sofort'
      OR public.has_permission(auth.uid(), 'feedback.sofort_freigeben')
    )
  );

-- ── RLS Kommentare: an dieselben Rechte hängen ───────────────────────
DROP POLICY IF EXISTS fk_select ON public.feedback_kommentare;
CREATE POLICY fk_select ON public.feedback_kommentare
  FOR SELECT TO authenticated
  USING (
    public.is_admin_role(auth.uid())
    OR public.has_permission(auth.uid(), 'feedback.view_alle')
    OR (
      NOT ist_intern
      AND EXISTS (
        SELECT 1 FROM public.feedback f
         WHERE f.id = feedback_id AND f.erstellt_von = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS fk_insert ON public.feedback_kommentare;
CREATE POLICY fk_insert ON public.feedback_kommentare
  FOR INSERT TO authenticated
  WITH CHECK (
    autor_id = auth.uid()
    AND (
      public.is_admin_role(auth.uid())
      OR public.has_permission(auth.uid(), 'feedback.bearbeiten')
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

NOTIFY pgrst, 'reload schema';
