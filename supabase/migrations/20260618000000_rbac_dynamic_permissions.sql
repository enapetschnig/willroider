-- =====================================================================
-- Migration: Dynamisches RBAC-System (Phase 1 — DB-Foundation)
--
-- Führt 3 neue Tabellen ein (rollen, berechtigungen, rollen_berechtigungen),
-- den zentralen RLS-Check `has_permission()` + Frontend-Hydration
-- `my_permissions()` + Admin-RPC `rpc_save_role_permissions()`.
--
-- Backward-compatible: das alte `app_role`-ENUM + `user_roles.role` bleiben
-- aktiv und werden via Sync-Trigger automatisch aus `user_roles.rolle_id`
-- gefüllt. Alle bestehenden RLS-Policies (is_admin_role / can_review /
-- direkte ENUM-Checks) funktionieren unverändert weiter.
--
-- Lockout-Schutz: CONSTRAINT TRIGGER verhindert, dass die letzte Rolle
-- mit `system.manage_permissions` diese Permission verliert.
-- =====================================================================

-- ─── 1) Tabellen ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rollen (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schluessel   TEXT UNIQUE NOT NULL,
  bezeichnung  TEXT NOT NULL,
  beschreibung TEXT,
  is_system    BOOLEAN NOT NULL DEFAULT FALSE,
  legacy_enum  app_role,
  sort_order   INT NOT NULL DEFAULT 100,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rollen_legacy_enum ON public.rollen(legacy_enum);

CREATE TABLE IF NOT EXISTS public.berechtigungen (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schluessel   TEXT UNIQUE NOT NULL,
  modul        TEXT NOT NULL,
  aktion       TEXT NOT NULL,
  subresource  TEXT,
  bezeichnung  TEXT NOT NULL,
  beschreibung TEXT,
  ist_kritisch BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order   INT NOT NULL DEFAULT 100,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_berechtigungen_modul ON public.berechtigungen(modul, sort_order);

CREATE TABLE IF NOT EXISTS public.rollen_berechtigungen (
  rolle_id        UUID NOT NULL REFERENCES public.rollen(id) ON DELETE CASCADE,
  berechtigung_id UUID NOT NULL REFERENCES public.berechtigungen(id) ON DELETE CASCADE,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (rolle_id, berechtigung_id)
);
CREATE INDEX IF NOT EXISTS idx_rb_rolle ON public.rollen_berechtigungen(rolle_id);

-- user_roles erweitern: neue Spalte für die Verlinkung auf rollen.
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS rolle_id UUID REFERENCES public.rollen(id);
CREATE INDEX IF NOT EXISTS idx_user_roles_rolle_id ON public.user_roles(rolle_id);

-- ─── 2) Audit-Log ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rollen_berechtigungen_audit (
  id              BIGSERIAL PRIMARY KEY,
  rolle_id        UUID,
  berechtigung_id UUID,
  rolle_schl      TEXT,
  berechtigung_schl TEXT,
  aktion          TEXT NOT NULL CHECK (aktion IN ('granted','revoked')),
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  zeitpunkt       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rba_zeitpunkt ON public.rollen_berechtigungen_audit(zeitpunkt DESC);

CREATE OR REPLACE FUNCTION public.fn_audit_rollen_berechtigungen()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO rollen_berechtigungen_audit (rolle_id, berechtigung_id, rolle_schl, berechtigung_schl, aktion, user_id)
    SELECT NEW.rolle_id, NEW.berechtigung_id, r.schluessel, b.schluessel, 'granted', auth.uid()
    FROM rollen r, berechtigungen b
    WHERE r.id = NEW.rolle_id AND b.id = NEW.berechtigung_id;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO rollen_berechtigungen_audit (rolle_id, berechtigung_id, rolle_schl, berechtigung_schl, aktion, user_id)
    SELECT OLD.rolle_id, OLD.berechtigung_id, r.schluessel, b.schluessel, 'revoked', auth.uid()
    FROM rollen r, berechtigungen b
    WHERE r.id = OLD.rolle_id AND b.id = OLD.berechtigung_id;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_audit_rollen_berechtigungen ON public.rollen_berechtigungen;
CREATE TRIGGER trg_audit_rollen_berechtigungen
  AFTER INSERT OR DELETE ON public.rollen_berechtigungen
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_rollen_berechtigungen();

-- ─── 3) Kern-Funktionen ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.has_permission(_user_id UUID, _schluessel TEXT)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.rollen_berechtigungen rb ON rb.rolle_id = ur.rolle_id
    JOIN public.berechtigungen b ON b.id = rb.berechtigung_id
    WHERE ur.user_id = _user_id
      AND b.schluessel = _schluessel
  );
$$;

CREATE OR REPLACE FUNCTION public.my_permissions()
RETURNS SETOF TEXT
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT b.schluessel
  FROM public.user_roles ur
  JOIN public.rollen_berechtigungen rb ON rb.rolle_id = ur.rolle_id
  JOIN public.berechtigungen b ON b.id = rb.berechtigung_id
  WHERE ur.user_id = auth.uid();
$$;

-- ─── 4) Sync-Trigger user_roles.role <-> rolle_id ───────────────────

CREATE OR REPLACE FUNCTION public.fn_sync_user_role_enum()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_legacy app_role;
BEGIN
  IF NEW.rolle_id IS NOT NULL THEN
    SELECT legacy_enum INTO v_legacy FROM rollen WHERE id = NEW.rolle_id;
    -- Custom-Rolle ohne legacy_enum → 'mitarbeiter' (least privilege)
    NEW.role := COALESCE(v_legacy, 'mitarbeiter'::app_role);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_user_role_enum ON public.user_roles;
CREATE TRIGGER trg_sync_user_role_enum
  BEFORE INSERT OR UPDATE OF rolle_id ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_user_role_enum();

-- ─── 5) Lockout-Schutz ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_protect_admin_permission()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM rollen_berechtigungen rb
  JOIN berechtigungen b ON b.id = rb.berechtigung_id
  WHERE b.schluessel = 'system.manage_permissions';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'Lockout-Schutz: mindestens eine Rolle muss "system.manage_permissions" haben.';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_protect_admin_permission ON public.rollen_berechtigungen;
CREATE CONSTRAINT TRIGGER trg_protect_admin_permission
  AFTER DELETE OR UPDATE ON public.rollen_berechtigungen
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_admin_permission();

-- ─── 6) RLS ─────────────────────────────────────────────────────────

ALTER TABLE public.rollen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rollen_select ON public.rollen;
CREATE POLICY rollen_select ON public.rollen FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS rollen_modify ON public.rollen;
CREATE POLICY rollen_modify ON public.rollen FOR ALL TO authenticated
  USING (has_permission(auth.uid(), 'system.manage_permissions'))
  WITH CHECK (has_permission(auth.uid(), 'system.manage_permissions'));

ALTER TABLE public.berechtigungen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS berechtigungen_select ON public.berechtigungen;
CREATE POLICY berechtigungen_select ON public.berechtigungen FOR SELECT TO authenticated USING (TRUE);
-- Berechtigungen werden nur über Migrationen befüllt (kein User-Insert).

ALTER TABLE public.rollen_berechtigungen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rb_select ON public.rollen_berechtigungen;
CREATE POLICY rb_select ON public.rollen_berechtigungen FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS rb_modify ON public.rollen_berechtigungen;
CREATE POLICY rb_modify ON public.rollen_berechtigungen FOR ALL TO authenticated
  USING (has_permission(auth.uid(), 'system.manage_permissions'))
  WITH CHECK (has_permission(auth.uid(), 'system.manage_permissions'));

ALTER TABLE public.rollen_berechtigungen_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rba_select ON public.rollen_berechtigungen_audit;
CREATE POLICY rba_select ON public.rollen_berechtigungen_audit FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'system.view_audit'));

-- ─── 7) Permission-Katalog seeden ───────────────────────────────────

INSERT INTO public.berechtigungen (schluessel, modul, aktion, subresource, bezeichnung, beschreibung, ist_kritisch, sort_order) VALUES
-- BAUSTELLEN
('baustellen.view',           'baustellen', 'view',   NULL,        'Baustellen sehen',                   'Liste + Detail-Ansicht',                                          FALSE, 110),
('baustellen.create',         'baustellen', 'create', NULL,        'Baustelle anlegen',                  NULL,                                                              FALSE, 111),
('baustellen.edit',           'baustellen', 'edit',   NULL,        'Baustelle bearbeiten',               'Bauherr, Adresse, Status, Bauleiter, …',                          FALSE, 112),
('baustellen.delete',         'baustellen', 'delete', NULL,        'Baustelle löschen',                  'Unwiderruflich',                                                  TRUE,  113),
('baustellen.termine',        'baustellen', 'edit',   'termine',   'Termine setzen',                     NULL,                                                              FALSE, 114),
('baustellen.kosten',         'baustellen', 'view',   'kosten',    'Kosten sehen',                       NULL,                                                              FALSE, 115),
('baustellen.dokumente.view', 'baustellen', 'view',   'dokumente', 'Baustellen-Dokumente sehen',         NULL,                                                              FALSE, 116),
('baustellen.dokumente.upload','baustellen','create', 'dokumente', 'Dokumente hochladen',                NULL,                                                              FALSE, 117),
('baustellen.dokumente.delete','baustellen','delete', 'dokumente', 'Dokumente löschen',                  NULL,                                                              FALSE, 118),
-- MITARBEITER
('mitarbeiter.view',          'mitarbeiter','view',   NULL,        'Mitarbeiter-Liste sehen',            NULL,                                                              FALSE, 210),
('mitarbeiter.create',        'mitarbeiter','create', NULL,        'Mitarbeiter anlegen',                NULL,                                                              FALSE, 211),
('mitarbeiter.edit',          'mitarbeiter','edit',   NULL,        'Mitarbeiter bearbeiten',             NULL,                                                              FALSE, 212),
('mitarbeiter.delete',        'mitarbeiter','delete', NULL,        'Mitarbeiter löschen',                'Unwiderruflich',                                                  TRUE,  213),
('mitarbeiter.view_sensitive','mitarbeiter','view',   'sensitive', 'Sensible Daten sehen',               'SV-Nr, Lohn, Bank, Religion',                                     TRUE,  214),
('mitarbeiter.edit_sensitive','mitarbeiter','edit',   'sensitive', 'Sensible Daten ändern',              NULL,                                                              TRUE,  215),
('mitarbeiter.einladung_senden','mitarbeiter','create','einladung','SMS-Einladung senden',               NULL,                                                              FALSE, 216),
-- STUNDEN
('stunden.view_eigene',       'stunden',    'view',   'eigene',    'Eigene Stunden sehen',               NULL,                                                              FALSE, 310),
('stunden.view_partie',       'stunden',    'view',   'partie',    'Partie-Stunden sehen',               'Stunden der eigenen Partie-Mitglieder',                           FALSE, 311),
('stunden.view_alle',         'stunden',    'view',   'alle',      'Alle Stunden sehen',                 NULL,                                                              FALSE, 312),
('stunden.create_eigene',     'stunden',    'create', 'eigene',    'Eigene Stunden eintragen',           NULL,                                                              FALSE, 313),
('stunden.create_andere',     'stunden',    'create', 'andere',    'Stunden für andere eintragen',       NULL,                                                              FALSE, 314),
('stunden.edit_alle',         'stunden',    'edit',   'alle',      'Alle Stunden bearbeiten',            NULL,                                                              FALSE, 315),
('stunden.freigeben_zm',      'stunden',    'approve','zm',        'Stunden freigeben (Zimmermeister)',  'Erste Freigabe-Stufe',                                            FALSE, 316),
('stunden.freigeben_buero',   'stunden',    'approve','buero',     'Stunden freigeben (Büro)',           'Zweite Freigabe-Stufe',                                           FALSE, 317),
('stunden.bsb.bestaetigen',   'stunden',    'approve','bsb',       'BSB bestätigen',                     'Baustellenstundenbericht abschließen',                            FALSE, 318),
('stunden.bsb.versenden',     'stunden',    'create', 'bsb',       'BSB ans Büro versenden',             NULL,                                                              FALSE, 319),
-- BERICHTE
('berichte.view',             'berichte',   'view',   NULL,        'Berichte sehen',                     'Bautagebücher + Regieberichte',                                   FALSE, 410),
('berichte.create',           'berichte',   'create', NULL,        'Bericht anlegen',                    NULL,                                                              FALSE, 411),
('berichte.edit_eigene',      'berichte',   'edit',   'eigene',    'Eigene Berichte bearbeiten',         'Nur im Status Entwurf',                                           FALSE, 412),
('berichte.edit_alle',        'berichte',   'edit',   'alle',      'Alle Berichte bearbeiten',           NULL,                                                              FALSE, 413),
('berichte.delete',           'berichte',   'delete', NULL,        'Bericht löschen',                    NULL,                                                              FALSE, 414),
-- EVALUIERUNGEN
('evaluierungen.view',        'evaluierungen','view', NULL,        'Sicherheits-Unterweisungen sehen',   NULL,                                                              FALSE, 510),
('evaluierungen.create',      'evaluierungen','create',NULL,       'Unterweisung erstellen',             NULL,                                                              FALSE, 511),
('evaluierungen.edit',        'evaluierungen','edit', NULL,        'Unterweisung bearbeiten',            NULL,                                                              FALSE, 512),
('evaluierungen.unterschreiben','evaluierungen','create','unterschrift','Unterschriften erfassen',       NULL,                                                              FALSE, 513),
-- ARBEITSPLANUNG (Wochen-Gantt)
('arbeitsplanung.view',       'arbeitsplanung','view', NULL,       'Arbeitsplanung sehen',               NULL,                                                              FALSE, 610),
('arbeitsplanung.edit',       'arbeitsplanung','edit', NULL,       'Arbeitsplanung bearbeiten',          'Drag&Drop, Bars verschieben',                                     FALSE, 611),
('arbeitsplanung.partien_verwalten','arbeitsplanung','edit','partien','Partien verwalten',               'Anlegen, Polier setzen, MA zuordnen',                             FALSE, 612),
-- TAGESPLANUNG
('tagesplanung.view',         'tagesplanung','view',  NULL,        'Tagesplanung sehen',                 NULL,                                                              FALSE, 710),
('tagesplanung.edit',         'tagesplanung','edit',  NULL,        'Tagesplanung bearbeiten',            NULL,                                                              FALSE, 711),
('tagesplanung.freigeben',    'tagesplanung','approve',NULL,       'Tagesplan freigeben',                'Schaltet Tagesplanung für MA sichtbar',                           FALSE, 712),
-- FAHRZEUGE
('fahrzeuge.view',            'fahrzeuge',  'view',   NULL,        'Fahrzeuge sehen',                    NULL,                                                              FALSE, 810),
('fahrzeuge.create',          'fahrzeuge',  'create', NULL,        'Fahrzeug anlegen',                   NULL,                                                              FALSE, 811),
('fahrzeuge.edit',            'fahrzeuge',  'edit',   NULL,        'Fahrzeug bearbeiten',                NULL,                                                              FALSE, 812),
('fahrzeuge.delete',          'fahrzeuge',  'delete', NULL,        'Fahrzeug löschen',                   NULL,                                                              FALSE, 813),
-- KALKULATOR
('kalkulator.view',           'kalkulator', 'view',   NULL,        'Kalkulator sehen',                   NULL,                                                              FALSE, 910),
('kalkulator.edit_k3',        'kalkulator', 'edit',   'k3',        'K3-Sätze ändern',                    'Mittellohnpreis, Zuschläge',                                      FALSE, 911),
('kalkulator.anfragen_verwalten','kalkulator','edit', 'anfragen',  'Anfragen verwalten',                 NULL,                                                              FALSE, 912),
-- KONTEN (ZA, Urlaub)
('konten.view_eigene',        'konten',     'view',   'eigene',    'Eigene Konten sehen',                'ZA + Urlaub-Saldo',                                               FALSE, 1010),
('konten.view_alle',          'konten',     'view',   'alle',      'Alle Konten sehen',                  NULL,                                                              FALSE, 1011),
('konten.edit_alle',          'konten',     'edit',   'alle',      'Konten bearbeiten',                  'Initial-Buchungen, Korrekturen, Auszahlungen',                    TRUE,  1012),
-- ARBEITSZEITKALENDER
('arbeitszeitkalender.view',  'arbeitszeitkalender','view',NULL,   'Arbeitszeitkalender sehen',          NULL,                                                              FALSE, 1110),
('arbeitszeitkalender.edit',  'arbeitszeitkalender','edit',NULL,   'Arbeitszeitkalender bearbeiten',     'Wochentypen, Soll-Stunden',                                       FALSE, 1111),
-- ANGEBOTE
('angebote.view',             'angebote',   'view',   NULL,        'Angebote sehen',                     NULL,                                                              FALSE, 1210),
('angebote.create',           'angebote',   'create', NULL,        'Angebot anlegen',                    NULL,                                                              FALSE, 1211),
('angebote.edit',             'angebote',   'edit',   NULL,        'Angebot bearbeiten',                 NULL,                                                              FALSE, 1212),
('angebote.delete',           'angebote',   'delete', NULL,        'Angebot löschen',                    NULL,                                                              FALSE, 1213),
-- MEIN TAG / DASHBOARD
('meintag.view',              'meintag',    'view',   NULL,        'Mein Tag sehen',                     NULL,                                                              FALSE, 1310),
('dashboard.view',            'dashboard',  'view',   NULL,        'Dashboard sehen',                    'Kennzahlen, aktive Baustellen',                                   FALSE, 1311),
-- ADMIN-BEREICH
('admin.view',                'admin',      'view',   NULL,        'Admin-Bereich sehen',                'Sidebar-Eintrag + /admin-Route',                                  FALSE, 1410),
('admin.taetigkeiten_verwalten','admin',    'edit',   'taetigkeiten','Tätigkeiten verwalten',            NULL,                                                              FALSE, 1411),
('admin.zulagen_verwalten',   'admin',      'edit',   'zulagen',   'Zulagen verwalten',                  NULL,                                                              FALSE, 1412),
('admin.unterweisungs_vorlagen','admin',    'edit',   'vorlagen',  'Unterweisungs-Vorlagen verwalten',   NULL,                                                              FALSE, 1413),
('admin.lohnzettel_verwalten','admin',      'edit',   'lohnzettel','Lohnzettel verwalten',               NULL,                                                              FALSE, 1414),
-- SYSTEM
('system.admin_panel',        'system',     'view',   'panel',     'Admin-Panel (Legacy isAdmin)',       'Backward-compat Flag für AuthContext.isAdmin',                    FALSE, 1510),
('system.manage_permissions', 'system',     'edit',   'rbac',      'Rollen + Berechtigungen verwalten',  'KRITISCH — Lockout-geschützt',                                    TRUE,  1511),
('system.view_audit',         'system',     'view',   'audit',     'Audit-Log sehen',                    NULL,                                                              TRUE,  1512)
ON CONFLICT (schluessel) DO NOTHING;

-- ─── 8) 5 System-Rollen seeden ──────────────────────────────────────

INSERT INTO public.rollen (schluessel, bezeichnung, beschreibung, is_system, legacy_enum, sort_order) VALUES
  ('geschaeftsfuehrung', 'Geschäftsführung', 'Voller Zugriff auf alle Module + Verwaltung von Rollen und Berechtigungen.', TRUE, 'geschaeftsfuehrung'::app_role, 10),
  ('bauleiter',          'Bauleiter',        'Projektleitung, Stundenfreigabe Stufe 2, kein Delete kritischer Datensätze, kein Zugriff auf sensible Personaldaten.', TRUE, 'bauleiter'::app_role,        20),
  ('buero',              'Büro',             'Verwaltung, Kalkulator, Konten, Stundenfreigabe Stufe 2.', TRUE, 'buero'::app_role,             30),
  ('zimmermeister',      'Zimmermeister',    'Polier / Vorarbeiter mit Stundenfreigabe Stufe 1 und Partie-Sicht.', TRUE, 'zimmermeister'::app_role,    40),
  ('mitarbeiter',        'Mitarbeiter',      'Eigene Stunden eintragen, Lese-Zugriff auf Baustellen.', TRUE, 'mitarbeiter'::app_role,       50)
ON CONFLICT (schluessel) DO NOTHING;

-- ─── 9) Default-Mapping pro Rolle (Status-quo) ──────────────────────

-- GF: ALLE Permissions
INSERT INTO public.rollen_berechtigungen (rolle_id, berechtigung_id)
SELECT (SELECT id FROM rollen WHERE schluessel='geschaeftsfuehrung'), b.id
FROM public.berechtigungen b
ON CONFLICT DO NOTHING;

-- Bauleiter: alles AUSSER *.delete + sensitive + system.manage_permissions
INSERT INTO public.rollen_berechtigungen (rolle_id, berechtigung_id)
SELECT (SELECT id FROM rollen WHERE schluessel='bauleiter'), b.id
FROM public.berechtigungen b
WHERE b.schluessel NOT IN (
  'baustellen.delete','mitarbeiter.delete','fahrzeuge.delete',
  'mitarbeiter.view_sensitive','mitarbeiter.edit_sensitive',
  'system.manage_permissions','system.view_audit',
  'konten.edit_alle'
)
ON CONFLICT DO NOTHING;

-- Büro: Verwaltung, Kalkulator, Konten, Stunden-Freigabe Stufe 2
INSERT INTO public.rollen_berechtigungen (rolle_id, berechtigung_id)
SELECT (SELECT id FROM rollen WHERE schluessel='buero'), b.id
FROM public.berechtigungen b
WHERE b.schluessel IN (
  'baustellen.view','baustellen.create','baustellen.edit','baustellen.termine',
  'baustellen.kosten','baustellen.dokumente.view','baustellen.dokumente.upload',
  'mitarbeiter.view','mitarbeiter.create','mitarbeiter.edit','mitarbeiter.einladung_senden',
  'mitarbeiter.view_sensitive','mitarbeiter.edit_sensitive',
  'stunden.view_alle','stunden.create_andere','stunden.edit_alle',
  'stunden.freigeben_buero','stunden.bsb.bestaetigen','stunden.bsb.versenden',
  'berichte.view','berichte.edit_alle',
  'evaluierungen.view','evaluierungen.create','evaluierungen.edit',
  'arbeitsplanung.view','arbeitsplanung.edit','arbeitsplanung.partien_verwalten',
  'tagesplanung.view','tagesplanung.edit','tagesplanung.freigeben',
  'fahrzeuge.view','fahrzeuge.create','fahrzeuge.edit',
  'kalkulator.view','kalkulator.edit_k3','kalkulator.anfragen_verwalten',
  'konten.view_alle','konten.edit_alle',
  'arbeitszeitkalender.view','arbeitszeitkalender.edit',
  'angebote.view','angebote.create','angebote.edit',
  'meintag.view','dashboard.view',
  'admin.view','admin.taetigkeiten_verwalten','admin.zulagen_verwalten',
  'admin.unterweisungs_vorlagen','admin.lohnzettel_verwalten',
  'system.admin_panel'
)
ON CONFLICT DO NOTHING;

-- Zimmermeister: Stunden-Freigabe Stufe 1, Partie-Sicht, Berichte schreiben
INSERT INTO public.rollen_berechtigungen (rolle_id, berechtigung_id)
SELECT (SELECT id FROM rollen WHERE schluessel='zimmermeister'), b.id
FROM public.berechtigungen b
WHERE b.schluessel IN (
  'baustellen.view','baustellen.termine','baustellen.dokumente.view','baustellen.dokumente.upload',
  'mitarbeiter.view',
  'stunden.view_eigene','stunden.view_partie','stunden.view_alle',
  'stunden.create_eigene','stunden.create_andere',
  'stunden.freigeben_zm',
  'berichte.view','berichte.create','berichte.edit_eigene','berichte.edit_alle',
  'evaluierungen.view','evaluierungen.create','evaluierungen.unterschreiben',
  'arbeitsplanung.view',
  'tagesplanung.view',
  'fahrzeuge.view',
  'konten.view_eigene',
  'arbeitszeitkalender.view',
  'meintag.view','dashboard.view'
)
ON CONFLICT DO NOTHING;

-- Mitarbeiter: eigene Daten, Lese-Zugriff
INSERT INTO public.rollen_berechtigungen (rolle_id, berechtigung_id)
SELECT (SELECT id FROM rollen WHERE schluessel='mitarbeiter'), b.id
FROM public.berechtigungen b
WHERE b.schluessel IN (
  'baustellen.view','baustellen.dokumente.view',
  'stunden.view_eigene','stunden.create_eigene',
  'berichte.view',
  'evaluierungen.view','evaluierungen.unterschreiben',
  'tagesplanung.view',
  'konten.view_eigene',
  'arbeitszeitkalender.view',
  'meintag.view','dashboard.view'
)
ON CONFLICT DO NOTHING;

-- ─── 10) Backfill user_roles.rolle_id ───────────────────────────────

UPDATE public.user_roles ur
SET rolle_id = r.id
FROM public.rollen r
WHERE r.legacy_enum = ur.role
  AND ur.rolle_id IS NULL;

-- ─── 11) Admin-RPC für Bulk-Save ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_save_role_permissions(_rolle_id UUID, _keys TEXT[])
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_granted INT := 0;
  v_revoked INT := 0;
BEGIN
  -- Permission-Check für Aufrufer
  IF NOT public.has_permission(auth.uid(), 'system.manage_permissions') THEN
    RAISE EXCEPTION 'Permission denied: system.manage_permissions required';
  END IF;

  -- 1) Bestehende Permissions löschen, die nicht in _keys sind (= revoke)
  WITH deleted AS (
    DELETE FROM public.rollen_berechtigungen rb
    USING public.berechtigungen b
    WHERE rb.berechtigung_id = b.id
      AND rb.rolle_id = _rolle_id
      AND b.schluessel <> ALL(_keys)
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_revoked FROM deleted;

  -- 2) Neue Permissions hinzufügen (= grant), conflict ignore
  WITH inserted AS (
    INSERT INTO public.rollen_berechtigungen (rolle_id, berechtigung_id, granted_by)
    SELECT _rolle_id, b.id, auth.uid()
    FROM public.berechtigungen b
    WHERE b.schluessel = ANY(_keys)
    ON CONFLICT (rolle_id, berechtigung_id) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_granted FROM inserted;

  RETURN jsonb_build_object('granted', v_granted, 'revoked', v_revoked);
END $$;

GRANT EXECUTE ON FUNCTION public.rpc_save_role_permissions(UUID, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(UUID, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.my_permissions() TO authenticated;

COMMENT ON FUNCTION public.has_permission(UUID, TEXT) IS 'Zentraler RLS-Check: hat User X die Berechtigung Y?';
COMMENT ON FUNCTION public.my_permissions() IS 'Liefert die Permission-Keys des aktuellen Users (für Frontend-Hydration).';
COMMENT ON FUNCTION public.rpc_save_role_permissions(UUID, TEXT[]) IS 'Atomarer Bulk-Save: setzt die Permissions einer Rolle auf exakt _keys[]. Nur für User mit system.manage_permissions.';
