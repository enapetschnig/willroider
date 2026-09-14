# Holzbau Willroider — Baustellenmanagement

Individuelle App für **Holzbau Willroider** (Zimmerei). Baustellen, Stunden,
Berichte, Angebote/Kalkulation, Evaluierung.

> Dieses Dokument beschreibt nur, **was ist** — es enthält keine Vorgaben,
> wie gearbeitet werden soll.

---

## ⚠️ Wichtig: Supabase-Projekt

Es gibt zwei widersprüchliche Angaben im Repo:

| Quelle | Projekt-ID | Gültig? |
|---|---|---|
| `.env` → `VITE_SUPABASE_URL` | `ylqbxnsxksbtsqrcwtuq` | ✅ **Das ist das echte Projekt** |
| `supabase/config.toml` → `project_id` | `wcxkcyblpcavvawznfsd` | ❌ veraltet |

URL: `https://ylqbxnsxksbtsqrcwtuq.supabase.co`

Die `config.toml` ist ein Überbleibsel und wurde nie nachgezogen. Sie steuert,
worauf die Supabase-CLI zeigt (`supabase link`, `supabase db push`,
`supabase functions deploy`). Wer sich auf sie verlässt, arbeitet auf dem
falschen Projekt.

---

## Sonderstellung im Portfolio

**Willroider ist kein Fork der anderen Kundenapps.** Es ist eine eigenständige
Codebasis:

- Eigenes Datenbank-Fundament: `20260427000000_initial_schema.sql`
  (die anderen Apps starten alle mit `20251105065433_33daeb17-…`)
- Eigenes Auth-Modell: `AuthContext.tsx` + `PermissionContext.tsx`
  (andere Apps: `OnboardingContext.tsx`, Rollenprüfung direkt in `App.tsx`)
- Durchgehend deutsche Benennung — Dateien, Routen, Spalten:
  `Baustellen`, `Stunden`, `Berichte`, `Mitarbeiter`, `Notizen`
- Eigenes Rollen-Enum (siehe unten)

Code aus anderen Kundenapps lässt sich hier nicht ohne Weiteres übernehmen.

---

## Stack

| | |
|---|---|
| Frontend | React 18 + TypeScript, Vite |
| UI | shadcn/ui (Radix) + Tailwind, Alias `@` → `src/` |
| Backend | Supabase (Postgres + Auth + Storage + Edge Functions) |
| PWA | `vite-plugin-pwa`, Service Worker aktiv |
| Deploy | Vercel, SPA-Rewrite in `vercel.json` |
| Tests | Playwright (`e2e/`), 16 Specs |
| Git | `main` → `git@github.com:enapetschnig/willroider.git` |

Primärfarbe: `--primary: 349 40% 53%` (Weinrot) in `src/index.css`

## Befehle

```bash
npm run dev              # Dev-Server
npm run build            # Produktions-Build
npm run lint             # ESLint
npm run test:e2e         # Playwright
npm run test:e2e:setup   # Testnutzer anlegen (tools/test-setup.mjs)
npm run test:e2e:teardown
```

---

## Rollen

Enum `app_role` (aus `initial_schema.sql`):

```
geschaeftsfuehrung | bauleiter | zimmermeister | buero | mitarbeiter
```

Berechtigungen laufen **nicht** über die Rolle direkt, sondern über einzelne
Permission-Keys — siehe `src/lib/permissionKeys.ts` und
`src/contexts/PermissionContext.tsx`. Abfrage im Code über
`hasPermission("feedback.bearbeiten")` bzw. den Hook `useHasPermission`.

Zuletzt aufgeräumt in `20260723100000_rollen_aufraeumen.sql`.

---

## Seiten

`src/pages/` — 27 Seiten:

**Baustellen & Berichte**
`Baustellen`, `BaustelleDetail`, `Berichte`, `BerichtDetail`

**Stunden**
`Stunden`, `StundenBericht`, `StundenBerichteListe`, `Stundenauswertung`

**Planung**
`Tagesplanung`, `Arbeitsplanung`, `Kalender`, `MeinTag`

**Angebote & Kalkulation**
`Angebote`, `AngebotDetail`, `Kalkulator`, `KalkulatorAnfragen`, `HalleErfassung`

**Stammdaten & Sonstiges**
`Mitarbeiter`, `Fahrzeuge`, `Evaluierung`, `Notizen`, `Dashboard`, `Admin`

**Änderungswünsche**
`Aenderungswuensche` ← siehe eigener Abschnitt unten

**Auth**
`Auth`, `RegistrierungBestaetigung`, `NotFound`

---

## Das Änderungswunsch-System

Das ist die ausgereifteste Umsetzung im gesamten Portfolio — **keine andere
Kundenapp hat davon irgendetwas.**

**Tabellen**
- `feedback` — `20260714500000_feedback.sql`
- `feedback_kommentare` — `20260721000000_feedback_kommentare.sql`

**Ausbaustufen** (chronologisch, an den Migrationsnamen ablesbar)

| Migration | Was dazukam |
|---|---|
| `20260714500000_feedback` | Grundtabelle, RLS, Status, Kategorie |
| `20260714600000_feedback_realtime` | Live-Aktualisierung |
| `20260714700000_feedback_voice` | Sprachnachricht |
| `20260717000000_feedback_anhang_notizen` | Datei-Anhang + Notizen |
| `20260719000000_feedback_dringlichkeit` | Dringlichkeitsstufen |
| `20260721000000_feedback_kommentare` | Kommentar-Faden mit Rückfragen |
| `20260721100000_feedback_berechtigungen` | Feingranulare Rechte |

**Komponenten**
| Datei | Zweck |
|---|---|
| `components/FeedbackDialog.tsx` | Eingabe (Text, Sprache, Datei) |
| `components/feedback/MeineWuensche.tsx` | Melder sieht seine eigenen Wünsche |
| `components/feedback/FeedbackFaden.tsx` | Gesprächsfaden, intern/extern getrennt |
| `components/admin/AdminFeedback.tsx` | Verwaltungsansicht |
| `components/admin/BesprechungsModus.tsx` | Gemeinsames Durchgehen in der Besprechung |
| `pages/Aenderungswuensche.tsx` | Eigene Menüseite |

**Datenmodell — die Kniffe**
- `seiten_kontext` + `app_version` werden automatisch mitgeschickt
- `ist_intern` auf Kommentaren: Verwaltungsnotizen sieht der Melder nie
  (über RLS erzwungen, nicht nur im UI ausgeblendet)
- `ist_frage`: erzeugt beim Melder einen Hinweis, dass eine Rückfrage offen ist
- Kategorien: `idee` · `problem` · `sonstiges`
- Status: `neu` · `gesehen` · `sofort` · `besprechung` · `umgesetzt` · `abgelehnt`
- Dringlichkeit: `sofort` · `normal` · `besprechen` · `irgendwann`
- „Sofort umsetzen" ist an `feedback.sofort_freigeben` gebunden, alles andere
  an `feedback.bearbeiten`

**Storage-Buckets:** `feedback-audio`, `feedback-dateien`

**Edge Function:** `feedback-notify`

Anmerkung im Code: `.from("feedback" as any)` — die Tabellen fehlen in den
generierten Supabase-Typen und werden per Cast angesprochen.

---

## Edge Functions

`supabase/functions/` — 11 Stück (plus `_shared`):

| Function | Zweck |
|---|---|
| `admin-create-employee` | Mitarbeiter anlegen |
| `analyze_unterweisung` | Unterweisungen auswerten |
| `dokument-versenden` | Dokumentversand |
| `evaluierung-reminder` | Erinnerungen zur Evaluierung |
| `feedback-notify` | Benachrichtigung bei neuem Änderungswunsch |
| `kalkulator-bridge` | Anbindung Kalkulator |
| `send-invitation` | Einladung (`verify_jwt = true`) |
| `send-sms-hook` | SMS |
| `stundenbericht-versenden` | Stundenbericht per Mail |
| `transcribe_audio` | Sprache → Text |

---

## Fachlogik in `src/lib/`

37 Dateien, überwiegend Willroider-spezifisch:

**PDF-Erzeugung**
`berichtPdf`, `baustellenstundenberichtPdf`, `stundenZettelPdf`,
`poliereinsatzPdf`, `evaluierungPdf`, `tagesplanungPdf`, `bsbPdfHelper`

**Stunden & Lohn**
`stundenAggregation`, `stundenBerichtDiff`, `stundenTime`, `zeiterfassung`,
`zulagen`, `taggeld`, `konten`, `urlaubsantrag`, `feiertage`

**Sonstiges**
`kalkulator/` (Ordner), `baustellenanlageDocx`, `unterweisungen`, `wetter`,
`exif`, `imageCompress`, `openaiClient`, `permissionKeys`, `pwaInstall`

---

## Besonderheiten

- **DOCX-Erzeugung** (`baustellenanlageDocx.ts`) — sonst nirgends im Portfolio
- **Kalkulator** als eigenes Teilsystem mit eigenem Ordner in `src/lib/kalkulator/`
- **Evaluierung** (Arbeitsplatzevaluierung) mit Erinnerungs-Function
- **Wetterdaten** in `lib/wetter.ts`
- `docs/rbac-plan.md` und `docs/stability-audit-2026-07.md` beschreiben
  Rechtemodell und einen Stabilitäts-Durchgang
