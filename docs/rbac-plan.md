# RBAC — Dynamisches Berechtigungssystem für Willroider

Stand: 2026-06-25 · Entwurf basierend auf vollständiger Inventur der bestehenden Codebase + Architektur-Design via Workflow.

---

## 0. Ausgangslage

**Heute:** 5 hartkodierte Rollen (`app_role` ENUM = `geschaeftsfuehrung, bauleiter, zimmermeister, buero, mitarbeiter`). Tabelle `user_roles` (1 Rolle pro User). 45+ Tabellen mit RLS, davon ~30 Policies prüfen Rollen direkt über `is_admin_role()`, `can_review()` oder hartkodierte ENUM-Werte. Im Frontend gibt es 40+ Stellen mit `role === 'X'`-Checks.

**Ziel:** Geschäftsführung kann im Admin-Bereich `/admin?tab=berechtigungen`:
- Beliebig viele neue Rollen anlegen
- Pro Rolle per Checkbox-Matrix Berechtigungen vergeben/entziehen
- Änderungen wirken **sofort** auf DB (RLS) **und** Frontend (Sichtbarkeit)
- Lockout-Schutz: kritische Permissions können der GF-Rolle nicht entzogen werden

**Constraints (User-Entscheidungen):**
- Eine Rolle pro User (wie bisher)
- Default-Permissions bilden den aktuellen Status quo ab (keine Verhaltensänderung beim Deploy)
- `system.manage_permissions` ist kritisch, kann durch UI + DB-Trigger niemals komplett entzogen werden

---

## 1. Architektur — 3-Layer-Modell

```
┌─────────────────────────────────────────────────────────────┐
│  DB-Layer                                                    │
│  ├── Tabelle  rollen                                         │
│  ├── Tabelle  berechtigungen           (Permission-Katalog) │
│  ├── Tabelle  rollen_berechtigungen    (Junction)           │
│  ├── Tabelle  user_roles               (+ rolle_id FK)      │
│  ├── Fkt      has_permission()         (zentraler RLS-Check)│
│  └── Fkt      my_permissions()         (Frontend-Hydration) │
├─────────────────────────────────────────────────────────────┤
│  Frontend-Layer                                              │
│  ├── PermissionContext                 (lädt 1× pro Session)│
│  ├── useHasPermission(key)             (Hook)               │
│  ├── <Can perm="...">                  (JSX-Conditional)    │
│  └── <RequirePermission>               (Route-Guard)        │
├─────────────────────────────────────────────────────────────┤
│  UI-Layer                                                    │
│  └── /admin?tab=berechtigungen         (Matrix-Editor)      │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Phasen-Detailplan

Jede Phase ist atomar deploybar. Zwischen den Phasen läuft die App unverändert (Backward-Compat über `legacy_enum` + Sync-Triggers).

### Phase 1 — DB-Foundation (8–10 h)

**Migration `supabase/migrations/20260618000000_rbac_dynamic_permissions.sql`:**

#### 1.1 Tabellen

```sql
CREATE TABLE rollen (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schluessel   TEXT UNIQUE NOT NULL,              -- 'geschaeftsfuehrung', 'polier_extern'
  bezeichnung  TEXT NOT NULL,                     -- 'Geschäftsführung'
  beschreibung TEXT,
  is_system    BOOLEAN DEFAULT FALSE,             -- TRUE = 5 Initial-Rollen, nicht löschbar
  legacy_enum  app_role,                          -- Mapping auf alten ENUM
  sort_order   INT DEFAULT 100,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE berechtigungen (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schluessel   TEXT UNIQUE NOT NULL,              -- 'baustellen.delete'
  modul        TEXT NOT NULL,                     -- 'baustellen'
  aktion       TEXT NOT NULL,                     -- 'view'/'create'/'edit'/'delete'/'export'/'approve'
  subresource  TEXT,                              -- 'sensitive'/'own'/'partie'/NULL
  bezeichnung  TEXT NOT NULL,                     -- 'Baustelle löschen'
  beschreibung TEXT,
  ist_kritisch BOOLEAN DEFAULT FALSE,
  sort_order   INT DEFAULT 100,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE rollen_berechtigungen (
  rolle_id        UUID REFERENCES rollen(id) ON DELETE CASCADE,
  berechtigung_id UUID REFERENCES berechtigungen(id) ON DELETE CASCADE,
  granted_at      TIMESTAMPTZ DEFAULT NOW(),
  granted_by      UUID REFERENCES auth.users(id),
  PRIMARY KEY (rolle_id, berechtigung_id)
);

ALTER TABLE user_roles
  ADD COLUMN rolle_id UUID REFERENCES rollen(id);
```

#### 1.2 RLS auf neue Tabellen

```sql
ALTER TABLE rollen, berechtigungen, rollen_berechtigungen ENABLE ROW LEVEL SECURITY;

CREATE POLICY rollen_select ON rollen FOR SELECT USING (TRUE);
CREATE POLICY rollen_modify ON rollen FOR ALL
  USING (has_permission(auth.uid(), 'system.manage_permissions'))
  WITH CHECK (has_permission(auth.uid(), 'system.manage_permissions'));

CREATE POLICY berechtigungen_select ON berechtigungen FOR SELECT USING (TRUE);
-- berechtigungen werden NUR durch Migrationen befüllt; kein User-Insert

CREATE POLICY rb_select ON rollen_berechtigungen FOR SELECT USING (TRUE);
CREATE POLICY rb_modify ON rollen_berechtigungen FOR ALL
  USING (has_permission(auth.uid(), 'system.manage_permissions'))
  WITH CHECK (has_permission(auth.uid(), 'system.manage_permissions'));
```

#### 1.3 Zentrale Funktionen

```sql
-- Der RLS-Check. STABLE damit Postgres innerhalb Query cached.
CREATE FUNCTION has_permission(_user_id UUID, _schluessel TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN rollen_berechtigungen rb ON rb.rolle_id = ur.rolle_id
    JOIN berechtigungen b ON b.id = rb.berechtigung_id
    WHERE ur.user_id = _user_id
      AND b.schluessel = _schluessel
  );
$$;

-- Für Frontend-Hydration: gibt alle Permission-Keys des eingeloggten Users
CREATE FUNCTION my_permissions()
RETURNS SETOF TEXT LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT DISTINCT b.schluessel
  FROM user_roles ur
  JOIN rollen_berechtigungen rb ON rb.rolle_id = ur.rolle_id
  JOIN berechtigungen b ON b.id = rb.berechtigung_id
  WHERE ur.user_id = auth.uid();
$$;

-- Bulk-Save für Admin-UI
CREATE FUNCTION rpc_save_role_permissions(_rolle_id UUID, _keys TEXT[])
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NOT has_permission(auth.uid(), 'system.manage_permissions') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  DELETE FROM rollen_berechtigungen WHERE rolle_id = _rolle_id;
  INSERT INTO rollen_berechtigungen (rolle_id, berechtigung_id, granted_by)
  SELECT _rolle_id, b.id, auth.uid()
  FROM berechtigungen b
  WHERE b.schluessel = ANY(_keys);
END $$;
```

#### 1.4 Permission-Katalog seeden (~80 Keys)

Pro Modul ein `INSERT INTO berechtigungen` mit allen Aktionen. Beispiel:

```sql
INSERT INTO berechtigungen (schluessel, modul, aktion, bezeichnung, beschreibung, ist_kritisch, sort_order) VALUES
-- BAUSTELLEN
('baustellen.view',        'baustellen', 'view',   'Baustellen sehen',         NULL, FALSE, 10),
('baustellen.create',      'baustellen', 'create', 'Baustelle anlegen',        NULL, FALSE, 11),
('baustellen.edit',        'baustellen', 'edit',   'Baustelle bearbeiten',     NULL, FALSE, 12),
('baustellen.delete',      'baustellen', 'delete', 'Baustelle löschen',        'Unwiderruflich', TRUE,  13),
('baustellen.termine',     'baustellen', 'edit',   'Termine setzen',           NULL, FALSE, 14),
('baustellen.kosten',      'baustellen', 'view',   'Kosten sehen',             NULL, FALSE, 15),
('baustellen.dokumente.upload',  'baustellen', 'create', 'Dokumente hochladen', NULL, FALSE, 16),
('baustellen.dokumente.delete',  'baustellen', 'delete', 'Dokumente löschen',  NULL, FALSE, 17),

-- MITARBEITER
('mitarbeiter.view',       'mitarbeiter','view',   'Mitarbeiter-Liste sehen',  NULL, FALSE, 20),
('mitarbeiter.create',     'mitarbeiter','create', 'Mitarbeiter anlegen',      NULL, FALSE, 21),
('mitarbeiter.edit',       'mitarbeiter','edit',   'Mitarbeiter bearbeiten',   NULL, FALSE, 22),
('mitarbeiter.delete',     'mitarbeiter','delete', 'Mitarbeiter löschen',      'Unwiderruflich', TRUE, 23),
('mitarbeiter.view_sensitive','mitarbeiter','view','Sensible Daten sehen (SV-Nr, Lohn, Bank)', NULL, TRUE, 24),
('mitarbeiter.edit_sensitive','mitarbeiter','edit','Sensible Daten ändern',    NULL, TRUE, 25),
('mitarbeiter.einladung_senden','mitarbeiter','create','SMS-Einladung senden', NULL, FALSE, 26),

-- STUNDEN (komplexes Modul mit Sub-Resources)
('stunden.view_eigene',    'stunden', 'view',    'Eigene Stunden sehen',       NULL, FALSE, 30),
('stunden.view_alle',      'stunden', 'view',    'Alle Stunden sehen',         NULL, FALSE, 31),
('stunden.view_partie',    'stunden', 'view',    'Partie-Stunden sehen',       NULL, FALSE, 32),
('stunden.create_eigene',  'stunden', 'create',  'Eigene Stunden eintragen',   NULL, FALSE, 33),
('stunden.create_andere',  'stunden', 'create',  'Stunden für andere eintragen', NULL, FALSE, 34),
('stunden.freigeben_zm',   'stunden', 'approve', 'Stunden freigeben (Zimmermeister)', NULL, FALSE, 35),
('stunden.freigeben_buero','stunden', 'approve', 'Stunden freigeben (Büro)',   NULL, FALSE, 36),
('stunden.bsb.bestaetigen','stunden', 'approve', 'BSB bestätigen',             NULL, FALSE, 37),
('stunden.bsb.versenden',  'stunden', 'create',  'BSB versenden',              NULL, FALSE, 38),

-- BERICHTE, EVALUIERUNGEN, ARBEITSPLANUNG, TAGESPLANUNG, FAHRZEUGE,
-- KALKULATOR, KONTEN, ADMIN, SYSTEM — analog (komplette Liste in Migration)

-- SYSTEM (kritisch!)
('system.manage_permissions','system','edit','Rollen + Berechtigungen verwalten', 'KRITISCH: Lockout-geschützt', TRUE, 90),
('system.view_audit',        'system','view','Audit-Log sehen', NULL, TRUE, 91);
```

Vollständige Liste in der Migration. ~14 Module × ~5 Permissions = ~70–80 Keys.

#### 1.5 System-Rollen + Default-Mapping seeden

```sql
INSERT INTO rollen (schluessel, bezeichnung, is_system, legacy_enum, sort_order) VALUES
  ('geschaeftsfuehrung', 'Geschäftsführung', TRUE, 'geschaeftsfuehrung', 10),
  ('bauleiter',          'Bauleiter',        TRUE, 'bauleiter',          20),
  ('buero',              'Büro',             TRUE, 'buero',              30),
  ('zimmermeister',      'Zimmermeister',    TRUE, 'zimmermeister',      40),
  ('mitarbeiter',        'Mitarbeiter',      TRUE, 'mitarbeiter',        50);

-- Geschäftsführung: ALLE Permissions
INSERT INTO rollen_berechtigungen (rolle_id, berechtigung_id)
SELECT (SELECT id FROM rollen WHERE schluessel='geschaeftsfuehrung'), id FROM berechtigungen;

-- Bauleiter: alles außer destructive + sensitive
INSERT INTO rollen_berechtigungen (rolle_id, berechtigung_id)
SELECT (SELECT id FROM rollen WHERE schluessel='bauleiter'), id FROM berechtigungen
WHERE schluessel NOT IN ('baustellen.delete','mitarbeiter.delete',
                         'mitarbeiter.edit_sensitive','system.manage_permissions');

-- Büro: Verwaltung + Konten + Kalkulator
INSERT INTO rollen_berechtigungen (rolle_id, berechtigung_id)
SELECT (SELECT id FROM rollen WHERE schluessel='buero'), id FROM berechtigungen
WHERE modul IN ('mitarbeiter','stunden','kalkulator','konten','arbeitsplanung',
                'tagesplanung','baustellen','fahrzeuge')
  AND schluessel NOT LIKE '%.delete' AND ist_kritisch = FALSE;

-- Zimmermeister: Stunden-Freigabe + Mitarbeiter sehen + Partie
INSERT INTO rollen_berechtigungen (rolle_id, berechtigung_id)
SELECT (SELECT id FROM rollen WHERE schluessel='zimmermeister'), id FROM berechtigungen
WHERE schluessel IN ('stunden.freigeben_zm','stunden.view_partie','stunden.view_alle',
                     'mitarbeiter.view','arbeitsplanung.view','baustellen.view',
                     'berichte.view','dokumente.upload','dokumente.view');

-- Mitarbeiter: nur eigene Daten + Lesen
INSERT INTO rollen_berechtigungen (rolle_id, berechtigung_id)
SELECT (SELECT id FROM rollen WHERE schluessel='mitarbeiter'), id FROM berechtigungen
WHERE schluessel IN ('stunden.view_eigene','stunden.create_eigene',
                     'baustellen.view','konten.view_eigene','meintag.view');
```

#### 1.6 Backfill `user_roles.rolle_id`

```sql
UPDATE user_roles ur
SET rolle_id = r.id
FROM rollen r
WHERE r.legacy_enum = ur.role
  AND ur.rolle_id IS NULL;
```

#### 1.7 Sync-Trigger (Backward-Compat)

```sql
-- Wenn rolle_id geändert wird, ENUM-Wert mitziehen (für alte Policies)
CREATE FUNCTION sync_user_role_enum() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rolle_id IS NOT NULL THEN
    SELECT legacy_enum INTO NEW.role FROM rollen WHERE id = NEW.rolle_id;
    IF NEW.role IS NULL THEN
      NEW.role := 'mitarbeiter';  -- Custom-Rollen: least-privilege fallback
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_sync_user_role_enum
  BEFORE INSERT OR UPDATE OF rolle_id ON user_roles
  FOR EACH ROW EXECUTE FUNCTION sync_user_role_enum();
```

#### 1.8 Lockout-Schutz

```sql
CREATE FUNCTION protect_admin_permission() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM rollen_berechtigungen rb
    JOIN berechtigungen b ON b.id = rb.berechtigung_id
    WHERE b.schluessel = 'system.manage_permissions'
  ) THEN
    RAISE EXCEPTION
      'Lockout-Schutz: mindestens eine Rolle muss "system.manage_permissions" haben.';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_protect_admin_permission
  AFTER DELETE OR UPDATE ON rollen_berechtigungen
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION protect_admin_permission();
```

#### 1.9 Audit-Log (optional, aber empfohlen)

```sql
CREATE TABLE rollen_berechtigungen_audit (
  id BIGSERIAL PRIMARY KEY,
  rolle_id UUID,
  berechtigung_id UUID,
  aktion TEXT,                          -- 'granted', 'revoked'
  user_id UUID REFERENCES auth.users(id),
  zeitpunkt TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger füllt es bei jedem INSERT/DELETE auf rollen_berechtigungen
```

#### 1.10 Deploy + Verify Phase 1

- `supabase db push` gegen Prod
- App unverändert testen → alles muss noch funktionieren (alte ENUM-Policies aktiv)
- Verify-Skript: für jeden bekannten User: `my_permissions()` aufrufen → muss konsistent sein mit altem `is_admin_role()`-Verhalten

---

### Phase 2 — Frontend-Plumbing (4–6 h)

**Neue Files:**
- `src/contexts/PermissionContext.tsx`
- `src/hooks/useHasPermission.ts`
- `src/components/Can.tsx`

**PermissionContext** — lädt einmal pro Session über `my_permissions()` RPC, hört auf Realtime-Updates:

```tsx
export function PermissionProvider({ children }) {
  const { user } = useAuth();
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) { setPerms(new Set()); setLoading(false); return; }
    const { data, error } = await supabase.rpc('my_permissions');
    if (!error && data) setPerms(new Set(data as string[]));
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  // Realtime: auf Rollen-Änderungen reagieren
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel(`perms:${user.id}`)
      .on('postgres_changes',
          { event:'*', schema:'public', table:'user_roles', filter:`user_id=eq.${user.id}` },
          () => void load())
      .on('postgres_changes',
          { event:'*', schema:'public', table:'rollen_berechtigungen' },
          () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id, load]);

  return <Ctx.Provider value={{ perms, loading, refresh: load }}>{children}</Ctx.Provider>;
}
```

**Hooks + Komponenten:**

```tsx
export function useHasPermission(key: string): boolean {
  return usePermissionContext().perms.has(key);
}

export function Can({ perm, children, fallback = null }: Props) {
  return useHasPermission(perm) ? <>{children}</> : <>{fallback}</>;
}

export function RequirePermission({ perm, children }: Props) {
  const ok = useHasPermission(perm);
  const { loading } = usePermissionContext();
  if (loading) return <FullPageSpinner />;
  if (!ok) return <Navigate to="/" replace />;
  return <>{children}</>;
}
```

**AuthContext Backward-Compat** — bestehende Flags wie `isAdmin`, `canReview` bleiben, delegieren intern:

```tsx
// in AuthContext.tsx
const isAdmin = useHasPermission('system.admin_panel');
const canReview = useHasPermission('stunden.freigeben_zm')
               || useHasPermission('stunden.freigeben_buero');
```

→ Alle existierenden `if (isAdmin)` funktionieren ohne Code-Änderung weiter.

**Wiring** in `main.tsx`:
```tsx
<AuthProvider>
  <PermissionProvider>
    <App />
  </PermissionProvider>
</AuthProvider>
```

**TS-Type-Generation:** Build-Script `tools/gen-permission-types.mjs` zieht alle `berechtigungen.schluessel` aus der DB und schreibt `src/lib/permissionKeys.ts` mit Union-Type. So gibt es einen Compile-Error, wenn jemand `useHasPermission('typo.key')` schreibt.

---

### Phase 3 — Admin-UI (10–14 h)

**Neue Files:**
- `src/components/admin/AdminBerechtigungen.tsx`
- `src/components/admin/RollenListe.tsx`
- `src/components/admin/PermissionMatrix.tsx`
- `src/components/admin/RolleEditorDialog.tsx`
- `src/components/admin/AuditLogPanel.tsx`

**Layout (Two-Pane, Mobile-stacked):**

```
┌────────────────────────────────────────────────────────────┐
│ Berechtigungen                              [+ Neue Rolle] │
├──────────────────┬─────────────────────────────────────────┤
│ ROLLEN           │ RECHTE: "Bauleiter"   [Speichern] [⌀]  │
│ ──────────────── │ Geänderte Felder: 3                     │
│ Geschäftsführg.  │ ┌─────────────────────────────────────┐ │
│ Bauleiter   ✓    │ │ [Suche…]              [Nur Diffs]   │ │
│ Büro             │ ├─────────────────────────────────────┤ │
│ Zimmermeister    │ │ > Baustellen                  [4/7] │ │
│ Mitarbeiter      │ │   [x] Sehen        baustellen.view  │ │
│ ──────────────── │ │   [x] Anlegen      baustellen.crete │ │
│ Polier extern    │ │   [x] Bearbeiten   baustellen.edit  │ │
│ (Custom)         │ │   [ ] Löschen ⚠    baustellen.delete│ │
│ ──────────────── │ │   [x] Termine                       │ │
│ [+ Neue Rolle]   │ │ > Stunden                     [3/9] │ │
│                  │ │ > Mitarbeiter                 [2/7] │ │
│                  │ │ > … (Modulgruppen collapsible)      │ │
│                  │ └─────────────────────────────────────┘ │
└──────────────────┴─────────────────────────────────────────┘
```

**Features:**
- Rolle anlegen: Dialog mit Name + Beschreibung + Vorlage (von welcher Rolle kopieren)
- Rolle umbenennen / Beschreibung ändern
- System-Rollen können NICHT gelöscht werden (UI-Block + DB-Check)
- Permission-Matrix: pro Modul-Gruppe collapsible, Anzahl aktiv/gesamt in der Überschrift
- Kritische Permissions ⚠️ mit gelbem Hintergrund
- Eigene Rolle: kritische Permissions sind disabled (Lockout-Vermeidung in UI)
- Dirty-Tracking: Speichern-Button enabled nur wenn Diffs
- Speichern via `rpc_save_role_permissions(_rolle_id, _keys[])` (atomar)
- Filter „Nur Diffs zur Standard-Konfiguration"
- Audit-Log-Panel zeigt letzte 50 Änderungen mit User + Zeitstempel

**Tab-Integration** in `src/pages/Admin.tsx`: TABS-Array um `'berechtigungen'` erweitern, Component-Switch ergänzen, Lazy-Load via `React.lazy()`.

**Mitarbeiter-Tab Anpassung:** Rolle-Dropdown verwendet jetzt `rollen`-Tabelle statt ENUM. Beim Save wird `user_roles.rolle_id` gesetzt; Sync-Trigger setzt automatisch `role`-ENUM.

---

### Phase 4 — Testing & Rollout (4–6 h)

**Manuelle Test-Matrix:** 5 System-Rollen × 14 Module × {Read, Write} = ~140 Checks. Stichproben pro Rolle:

| Rolle | Erwartet |
|---|---|
| Geschäftsführung | Alle Module + Admin-Tab sichtbar, alle Buttons aktiv |
| Bauleiter | Baustellen/Stunden/Mitarbeiter ok, kein Delete, keine Sensitive-Daten |
| Büro | Verwaltung + Kalkulator + Konten, keine Mitarbeiter-Anlage |
| Zimmermeister | Stunden-Freigabe, Partie-Sicht, kein Delete |
| Mitarbeiter | nur eigene Stunden + Mein-Tag |

**Automatisierter Smoke-Test:** `tools/rbac-smoke.mjs` loggt sich pro Rolle ein (Test-User pro Rolle), ruft pro Modul 1 SELECT auf, vergleicht erwartete Boolean-Matrix.

**Emergency-Recovery:** `tools/rbac-emergency-grant.sql` — service_role-Skript, gibt einem User-ID via SQL alle Permissions zurück. Im Repo dokumentiert, nie automatisch ausgeführt.

**Deployment-Reihenfolge (kritisch!):**
1. **Phase 1 Migration deployen** → Prod. App läuft weiter unverändert (Sync-Trigger hält ENUM aktuell).
2. **Verify:** `my_permissions()` für 3 Stichprobe-User abrufen, mit erwarteten Sets vergleichen.
3. **Phase 2 + 3 Frontend deployen** (zusammen) → `/admin?tab=berechtigungen` ist verfügbar.
4. **Smoke-Test** durchklicken.
5. **GF/Büro-Briefing** (15 min): wie funktioniert die Matrix, was bedeutet „kritisch", Custom-Rollen-Hinweis.

---

### Phase 5 — Cleanup (optional, verteilt 20–40 h)

Schrittweise pro Sprint:
- **Frontend:** 40+ hartkodierte `role === 'X'`-Checks → durch `useHasPermission('xxx')` ersetzen
- **Backend:** 3 hartkodierte Policies (Kalkulator, Baustellen-Delete, Tagesplan-Freigabe) → durch `has_permission()` ersetzen

Bis Phase 5 abgeschlossen ist gilt: **Custom-Rollen wirken sofort überall, AUSSER** in den 3 Modulen Kalkulator / Baustellen-Delete / Tagesplan-Freigabe. Dort gelten die ENUM-Werte über das `legacy_enum`-Mapping. Custom-Rollen ohne `legacy_enum` → fallen auf `mitarbeiter` zurück (least-privilege).

---

## 3. Risiken & Mitigationen

| # | Risiko | Mitigation |
|---|---|---|
| 1 | **Lockout** der Geschäftsführung | `protect_admin_permission()` Trigger + UI-Sperre für eigene Rolle + Emergency-SQL-Script |
| 2 | **Permission-Drift** Frontend ↔ DB | TS-Union-Type aus DB-Katalog generiert (Build-Check), Skript `tools/gen-permission-types.mjs` |
| 3 | **Performance** durch viele RLS-Checks | `has_permission()` ist STABLE, Index auf `(user_id)` + `(rolle_id, berechtigung_id)`, Postgres-Cache innerhalb Query, Smoke-Bench <50ms für 1000 SELECT |
| 4 | **Realtime-Mismatch** während User-Session | Realtime-Channel auf `user_roles` + `rollen_berechtigungen`, automatischer Reload binnen Sekunden + Error-Boundary |
| 5 | **Backward-Compat-Bruch** | Custom-Rollen ohne `legacy_enum` fallen in alten Policies auf `mitarbeiter` zurück (least-privilege) — keine Eskalation möglich |
| 6 | **Migrations-Order** | Phase 1 muss VOR Frontend-Deploy. PermissionContext hat Graceful-Fallback auf `useAuth().isAdmin` wenn RPC fehlt |
| 7 | **Race-Condition** beim Save | Letzter gewinnt, Audit-Log macht Konflikte sichtbar |
| 8 | **Audit-Lücke** bei Migration-Seeds | `granted_by = NULL` ist akzeptiert für System-Seeds; User-Aktionen tracken `auth.uid()` |
| 9 | **Testing-Aufwand** | Smoke-Skript automatisiert das pro Release |
| 10 | **Data-Leak via my_permissions()** | Funktion ist SECURITY DEFINER, gibt nur eigene Permissions zurück (`auth.uid()`) — kein Eskalations-Vektor |
| 11 | **ENUM-Deprecation** verfrüht | Phase 5 läuft kontrolliert, bis dahin bleibt ENUM aktiv synchronisiert |

---

## 4. Aufwand

| Phase | Aufwand |
|---|---|
| Phase 1 — DB-Foundation | 8–10 h |
| Phase 2 — Frontend-Plumbing | 4–6 h |
| Phase 3 — Admin-UI | 10–14 h |
| Phase 4 — Testing & Rollout | 4–6 h |
| **Core (1–4)** | **26–36 h ≈ 4–5 Personentage** |
| Phase 5 — Cleanup (optional) | +20–40 h verteilt |

---

## 5. Files

**Neu:**
- `supabase/migrations/20260618000000_rbac_dynamic_permissions.sql`
- `src/contexts/PermissionContext.tsx`
- `src/hooks/useHasPermission.ts`
- `src/components/Can.tsx`
- `src/components/RequirePermission.tsx`
- `src/components/admin/AdminBerechtigungen.tsx`
- `src/components/admin/PermissionMatrix.tsx`
- `src/components/admin/RolleEditorDialog.tsx`
- `src/components/admin/AuditLogPanel.tsx`
- `src/lib/permissionKeys.ts` (auto-generiert)
- `tools/gen-permission-types.mjs`
- `tools/rbac-smoke.mjs`
- `tools/rbac-emergency-grant.sql`

**Ändern:**
- `src/main.tsx` (PermissionProvider wrappen)
- `src/contexts/AuthContext.tsx` (Flags an Hook delegieren)
- `src/pages/Admin.tsx` (neuer Tab)
- `src/App.tsx` (RequirePermission für sensitive Routes)
- Mitarbeiter-Tab → Rolle-Dropdown nutzt `rollen`-Tabelle statt ENUM
- (Phase 5) ~40 Frontend-Files + 3 alte Policies

**Nicht ändern in Core:**
- Bestehende ENUM `app_role` bleibt erhalten (Backward-Compat über Sync-Trigger)
- Bestehende RLS-Policies bleiben aktiv (mit `is_admin_role()` etc.)
- Bestehende `user_roles`-Tabelle bleibt funktional

---

## 6. Verifikation

Nach jeder Phase:
1. `tsc --noEmit` + `npm run build` grün
2. App startet, bestehende Funktionalität unverändert
3. Phase-spezifischer Smoke-Test:
   - **Phase 1:** SQL-Tests gegen `has_permission()` für 5 Stichprobe-User × 10 Permission-Keys
   - **Phase 2:** Browser Console: `useHasPermission('baustellen.view')` liefert erwarteten Bool
   - **Phase 3:** Klick durch alle 5 Rollen, Matrix lädt, Save funktioniert, Lockout-Schutz greift
   - **Phase 4:** `rbac-smoke.mjs` läuft alle 70 Stichproben grün

---

## 7. Rollback

**Wenn etwas in Phase 1 schiefgeht:**
- Migration ist additiv (keine bestehende Tabelle/Spalte gelöscht).
- Rollback: `DROP TABLE rollen_berechtigungen, berechtigungen, rollen CASCADE; ALTER TABLE user_roles DROP COLUMN rolle_id;` — alle Funktionen + Trigger werden mit gedroppt.
- App läuft weiter, weil alte ENUM unverändert ist.

**Wenn Frontend-Deploy bricht:**
- Vorherige Build-Version via Lovable wieder ausrollen.
- Backend bleibt funktional (Phase 1 ist atomar).

**Notfall-Recovery:**
- `tools/rbac-emergency-grant.sql` mit Service-Role-Key gibt einer User-ID alle Permissions zurück.

---

## 8. Offene Punkte

1. **Audit-Log-Aufbewahrung** — wie lange Einträge behalten? Vorschlag: unbegrenzt (klein), oder 1 Jahr Cleanup-Job.
2. **Granularität Stunden-Modul** — soll es `stunden.view_partie` als separate Permission geben, oder reicht `stunden.view_alle`?
3. **Mehrere Rollen pro User** — aktuell raus, aber zukunftssicher? Schema unterstützt es bereits (UNIQUE(user_id, rolle_id) statt UNIQUE(user_id)).
4. **Permission-Vererbung** zwischen Rollen — vermutlich Overkill für jetzt.

---

## 9. Reihenfolge — wenn du grünes Licht gibst

1. **Du sagst „los"** → ich starte Phase 1
2. Migration schreiben + lokal testen (2 h)
3. Permission-Katalog seeden (1 h)
4. Default-Mapping seeden (1 h)
5. Lockout + Sync-Trigger (1 h)
6. Deploy + Verify (1 h)
7. **Phase 1 fertig** → Status-Update an dich → Phase 2

Pro Phase melde ich mich mit Zwischenstand + nächsten Schritten.
