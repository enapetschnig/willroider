-- =====================================================================
-- RBAC Phase 5b: Alle hartkodierten ENUM-Checks durch has_permission()
-- ersetzen — damit Custom-Rollen wirklich überall wirken.
--
-- Workflow-Audit hat aufgedeckt:
--  - is_admin_role() hartkodiert auf 3 Rollen → 52 Tabellen blockieren
--    Custom-Rollen.
--  - can_review() hartkodiert auf 4 Rollen → 5 Tabellen blockieren.
--  - Kalkulator-Policies prüfen direkt ENUM.
--  - baustellen_delete_gf_only blockt Custom-Rollen.
--  - tagesplanung_freigaben blockt Custom-Rollen.
--
-- Fix: Helper-Funktionen werden so umgebaut, dass sie has_permission()
-- mit semantischen Schlüsseln nutzen. Damit wirken Custom-Rollen
-- automatisch in ALLEN bestehenden 52 Tabellen, ohne dass die Policies
-- selbst angefasst werden müssen (Backward-Compat-Maximum).
-- =====================================================================

-- ─── is_admin_role() umbauen ────────────────────────────────────────
-- Definition "Admin" = darf den Admin-Bereich der App nutzen.
-- Permission-Schlüssel: 'system.admin_panel' oder 'admin.view'.
CREATE OR REPLACE FUNCTION public.is_admin_role(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.has_permission(_user_id, 'system.admin_panel')
    OR public.has_permission(_user_id, 'admin.view');
$$;

-- ─── can_review() umbauen ───────────────────────────────────────────
-- Definition "Review" = darf Stunden/Berichte/Evaluierungen freigeben.
CREATE OR REPLACE FUNCTION public.can_review(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.has_permission(_user_id, 'stunden.freigeben_zm')
    OR public.has_permission(_user_id, 'stunden.freigeben_buero')
    OR public.has_permission(_user_id, 'berichte.edit_alle')
    OR public.has_permission(_user_id, 'evaluierungen.edit');
$$;

-- ─── darf_tagesplan_freigeben() umbauen ─────────────────────────────
CREATE OR REPLACE FUNCTION public.darf_tagesplan_freigeben(_uid UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_permission(_uid, 'tagesplanung.freigeben');
$$;

-- ─── has_role() bleibt, aber bekommt einen has_permission-Pfad ──────
-- Bestehende Aufrufer wie `has_role(uid, 'geschaeftsfuehrung')` sind
-- selten und prüfen meistens auf GF. Wir lassen die Funktion erhalten
-- (Backward-Compat), die Logik bleibt ENUM-basiert. Custom-Rollen
-- fallen über den Sync-Trigger auf 'mitarbeiter' zurück — bei strikten
-- has_role(uid,'geschaeftsfuehrung')-Checks wäre das ein Issue. Aktuell
-- aber kein produktiver Aufrufer betroffen.
COMMENT ON FUNCTION public.has_role(UUID, app_role) IS
  'LEGACY — prüft ENUM. Neue Policies sollen has_permission() nutzen.';

-- ─── Kalkulator-Policies umbauen ────────────────────────────────────
-- kalkulator_k3_saetze: K3-Sätze sind Lese-frei, schreiben durch Berechtigte
DROP POLICY IF EXISTS kk_write ON public.kalkulator_k3_saetze;
CREATE POLICY kk_write ON public.kalkulator_k3_saetze FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'kalkulator.edit_k3'))
  WITH CHECK (public.has_permission(auth.uid(), 'kalkulator.edit_k3'));

-- kalkulator_anfragen: Lesen + Update durch kalkulator.anfragen_verwalten
DROP POLICY IF EXISTS ka_select ON public.kalkulator_anfragen;
CREATE POLICY ka_select ON public.kalkulator_anfragen FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'kalkulator.anfragen_verwalten'));

DROP POLICY IF EXISTS ka_update ON public.kalkulator_anfragen;
CREATE POLICY ka_update ON public.kalkulator_anfragen FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'kalkulator.anfragen_verwalten'))
  WITH CHECK (TRUE);

-- ─── Baustellen-Delete-Policy umbauen ───────────────────────────────
DROP POLICY IF EXISTS baustellen_delete_gf_only ON public.baustellen;
CREATE POLICY baustellen_delete_gf_only ON public.baustellen FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'baustellen.delete'));

-- ─── Tagesplanung-Freigabe ──────────────────────────────────────────
-- darf_tagesplan_freigeben wurde oben umgebaut → bestehende Policy
-- darauf funktioniert automatisch.

-- ─── Audit-Log: hat_permission für audit-view ───────────────────────
-- Bereits in Phase 1 Migration so verdrahtet — kein Update nötig.

COMMENT ON FUNCTION public.is_admin_role(UUID) IS
  'Phase 5b: prüft jetzt has_permission(system.admin_panel) — Custom-Rollen wirken.';
COMMENT ON FUNCTION public.can_review(UUID) IS
  'Phase 5b: prüft jetzt has_permission(stunden.freigeben_*) etc. — Custom-Rollen wirken.';
COMMENT ON FUNCTION public.darf_tagesplan_freigeben(UUID) IS
  'Phase 5b: prüft jetzt has_permission(tagesplanung.freigeben).';
