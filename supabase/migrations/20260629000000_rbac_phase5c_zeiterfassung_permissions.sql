-- =====================================================================
-- RBAC Phase 5c: Zeiterfassung + restliche Module permission-gated
--
-- Workflow-Audit hatte zwei Hauptlücken aufgedeckt:
-- 1. Zeiterfassung: stunden_tage Policies erlauben Polier nur via
--    is_partieleiter_of()-RPC. Eine Custom-Rolle "Bauleiter-Vertretung"
--    mit `stunden.create_andere` wäre DB-seitig blockiert, auch wenn
--    die Permission gesetzt ist.
-- 2. Permission-Katalog: einige granulare Berechtigungen fehlen
--    (z. B. berichte.freigeben).
-- =====================================================================

-- ─── Permission-Katalog ergänzen ────────────────────────────────────

INSERT INTO public.berechtigungen (schluessel, modul, aktion, subresource, bezeichnung, beschreibung, ist_kritisch, sort_order) VALUES
  ('berichte.freigeben',     'berichte', 'approve', NULL, 'Bericht freigeben + PDF',         'Endfreigabe eines Bautagebuchs/Regieberichts', FALSE, 415),
  ('berichte.archivieren',   'berichte', 'edit',    'archiv', 'Bericht archivieren',         NULL,                                            FALSE, 416),
  ('mitarbeiter.einladung_resend', 'mitarbeiter', 'create', 'einladung', 'SMS-Einladung erneut senden', 'Bestehende Mitarbeiter erneut einladen', FALSE, 217),
  ('baustellen.edit_partie', 'baustellen', 'edit', 'partie', 'Baustelle-Partie zuordnen',    NULL,                                            FALSE, 119),
  ('baustellen.edit_status', 'baustellen', 'edit', 'status', 'Baustelle-Status ändern',     'geplant/aktiv/abgeschlossen',                   FALSE, 120),
  ('angebote.status_aendern','angebote', 'edit', 'status',   'Angebot-Status ändern',       NULL,                                            FALSE, 1214)
ON CONFLICT (schluessel) DO NOTHING;

-- Default-Mapping für neue Permissions:
-- GF: alles
INSERT INTO public.rollen_berechtigungen (rolle_id, berechtigung_id)
SELECT (SELECT id FROM rollen WHERE schluessel='geschaeftsfuehrung'), b.id
FROM public.berechtigungen b
WHERE b.schluessel IN (
  'berichte.freigeben','berichte.archivieren','mitarbeiter.einladung_resend',
  'baustellen.edit_partie','baustellen.edit_status','angebote.status_aendern'
)
ON CONFLICT DO NOTHING;

-- Bauleiter: alles außer destructiv
INSERT INTO public.rollen_berechtigungen (rolle_id, berechtigung_id)
SELECT (SELECT id FROM rollen WHERE schluessel='bauleiter'), b.id
FROM public.berechtigungen b
WHERE b.schluessel IN (
  'berichte.freigeben','berichte.archivieren','mitarbeiter.einladung_resend',
  'baustellen.edit_partie','baustellen.edit_status','angebote.status_aendern'
)
ON CONFLICT DO NOTHING;

-- Büro: dito
INSERT INTO public.rollen_berechtigungen (rolle_id, berechtigung_id)
SELECT (SELECT id FROM rollen WHERE schluessel='buero'), b.id
FROM public.berechtigungen b
WHERE b.schluessel IN (
  'berichte.freigeben','berichte.archivieren','mitarbeiter.einladung_resend',
  'baustellen.edit_partie','baustellen.edit_status','angebote.status_aendern'
)
ON CONFLICT DO NOTHING;

-- Zimmermeister: nur berichte.freigeben (für Polier-Bautagebuch-Freigabe)
INSERT INTO public.rollen_berechtigungen (rolle_id, berechtigung_id)
SELECT (SELECT id FROM rollen WHERE schluessel='zimmermeister'), b.id
FROM public.berechtigungen b
WHERE b.schluessel IN ('berichte.freigeben')
ON CONFLICT DO NOTHING;

-- ─── Zeiterfassung-RLS: has_permission-Fallback einbauen ─────────────
--
-- Idee: bestehende is_partieleiter_of()-Logik bleibt, ZUSÄTZLICH greift
-- has_permission('stunden.create_andere') als generischer Override.
-- Damit funktionieren sowohl die alten Polier-Beziehungen ALS AUCH
-- Custom-Rollen mit der Permission.

-- stundenbuchungen
DROP POLICY IF EXISTS "stunden_select_all" ON public.stundenbuchungen;
CREATE POLICY "stunden_select_all" ON public.stundenbuchungen FOR SELECT TO authenticated
  USING (
    mitarbeiter_id = auth.uid()
    OR public.can_review(auth.uid())
    OR public.is_partieleiter_of(auth.uid(), mitarbeiter_id)
    OR public.has_permission(auth.uid(), 'stunden.view_alle')
    OR public.has_permission(auth.uid(), 'stunden.view_partie')
  );

DROP POLICY IF EXISTS "stunden_insert_self" ON public.stundenbuchungen;
CREATE POLICY "stunden_insert_self" ON public.stundenbuchungen FOR INSERT TO authenticated
  WITH CHECK (
    mitarbeiter_id = auth.uid()
    OR public.is_admin_role(auth.uid())
    OR public.is_partieleiter_of(auth.uid(), mitarbeiter_id)
    OR public.has_permission(auth.uid(), 'stunden.create_andere')
  );

DROP POLICY IF EXISTS "stunden_update_self_or_admin" ON public.stundenbuchungen;
CREATE POLICY "stunden_update_self_or_admin" ON public.stundenbuchungen FOR UPDATE TO authenticated
  USING (
    mitarbeiter_id = auth.uid()
    OR public.can_review(auth.uid())
    OR public.is_partieleiter_of(auth.uid(), mitarbeiter_id)
    OR public.has_permission(auth.uid(), 'stunden.edit_alle')
    OR public.has_permission(auth.uid(), 'stunden.create_andere')
  )
  WITH CHECK (
    mitarbeiter_id = auth.uid()
    OR public.can_review(auth.uid())
    OR public.is_partieleiter_of(auth.uid(), mitarbeiter_id)
    OR public.has_permission(auth.uid(), 'stunden.edit_alle')
    OR public.has_permission(auth.uid(), 'stunden.create_andere')
  );

-- stunden_tage (zentrale Tabelle des Phase-B-Redesigns)
DROP POLICY IF EXISTS stunden_tage_insert_self ON public.stunden_tage;
CREATE POLICY stunden_tage_insert_self ON public.stunden_tage
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin_role(auth.uid())
    OR mitarbeiter_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.partien p
       JOIN public.profiles m ON m.partie_id = p.id
       WHERE p.partieleiter_id = auth.uid()
         AND m.id = stunden_tage.mitarbeiter_id
    )
    OR public.has_permission(auth.uid(), 'stunden.create_andere')
  );

DROP POLICY IF EXISTS stunden_tage_update ON public.stunden_tage;
CREATE POLICY stunden_tage_update ON public.stunden_tage
  FOR UPDATE TO authenticated
  USING (
    public.is_admin_role(auth.uid())
    OR public.has_permission(auth.uid(), 'stunden.create_andere')
    OR public.has_permission(auth.uid(), 'stunden.edit_alle')
    OR (
      (mitarbeiter_id = auth.uid() OR erfasst_von = auth.uid())
      AND status IN ('erfasst','ma_bestaetigt')
      AND NOT public.month_locked(mitarbeiter_id, datum)
    )
  );

DROP POLICY IF EXISTS stunden_tage_delete ON public.stunden_tage;
CREATE POLICY stunden_tage_delete ON public.stunden_tage
  FOR DELETE TO authenticated
  USING (
    public.is_admin_role(auth.uid())
    OR public.has_permission(auth.uid(), 'stunden.create_andere')
    OR (
      mitarbeiter_id = auth.uid()
      AND status = 'erfasst'
      AND NOT public.month_locked(mitarbeiter_id, datum)
    )
  );

COMMENT ON POLICY stunden_tage_insert_self ON public.stunden_tage IS
  'Phase 5c: Custom-Rollen mit stunden.create_andere können Tage für andere anlegen.';
COMMENT ON POLICY stunden_tage_update ON public.stunden_tage IS
  'Phase 5c: Custom-Rollen mit stunden.edit_alle bzw. stunden.create_andere können bearbeiten.';
