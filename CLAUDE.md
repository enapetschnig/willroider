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

---

## Kundenakte (ergänzt 29.10.2026)

> Ab hier stehen auch **feste Regeln** (mit Datum/Quelle) — die Abschnitte oben
> bleiben reine Bestandsaufnahme. Teilweise ist oben der Stand vom Juli
> beschrieben (z. B. „11 Edge Functions“ — inzwischen 21, u. a. `sharepoint-*`,
> `push-senden`, `erinnerungen`, `archiv-versenden`, `einsatzplan-pdf`).

**Kunde:** Holzbau Willroider, Zimmerei in Villach (Kärnten), rund 50 Mitarbeiter.
Firmenname im Microsoft-Tenant/SharePoint: „Stadtbaumeister Josef Willroider GmbH“
(`josefwillroider.sharepoint.com`). Adresse auf den PDFs: Willroiderstraße 13, 9500 Villach.
Echte Lohn- und Produktionsdaten — **die App ist seit 01.10.2026 bei allen Mitarbeitern im Einsatz.**

**Wer meldet / wer entscheidet** (aus den Änderungswünschen, Stand 29.10.2026)
- **Johannes „Hannes“ Maurer** — Bauleiter und Admin, Hauptansprechpartner, schreibt die meisten
  Wünsche; gibt Tätigkeitsberichte als Geschäftsführung frei. Mails an ihn: kurz, „ich schlage vor“,
  leicht mit Ja/Nein zu beantworten (Christoph, 23.09.).
- **Christian Pließnig** — zweiter Admin. Laut Elias Winkler (19.10.) dürfen **nur Maurer und
  Pließnig** neue Anmeldungen freischalten und Stundenberichte prüfen.
- Bauleiter (`profiles.ist_bauleiter`, je ein Teams-Team „Aktuelle BVH …“): Sebastian Egger,
  Eckart Egger, Niklas Gwenger, Elias Winkler (meldet sich als Büro), Maurer, Pließnig.
- Poliere/Mitarbeiter, die melden: Bua Sirnitzer (Polier), Dirk Tauchhammer, Leo Schuller.
  Angestellte (Tätigkeitsbericht statt Stundenbericht): z. B. Jürgen Mainhard, Birgit Köstenberger
  (geringfügig).
- Feste Mail-Empfänger im Büro: `schneider@willroider.at`, `maurer@willroider.at`.

**Rollen — Achtung Begriffe:** Die DB-Rolle `bauleiter` heißt in der Oberfläche
„Vorarbeiter / Polier“. Die echten Bauleiter erkennt man an `profiles.ist_bauleiter`
(bzw. `baustellen.bauleiter_id`). `zimmermeister` und `polier_vorarbeiter` wurden am 24.07. entfernt
(Enum-Wert `zimmermeister` existiert noch, ist ungenutzt). Rechte zusätzlich je Person über
`user_berechtigungen` (Verwaltung → Mitarbeiter → Rechte). `is_admin_role` = `system.admin_panel`
oder `admin.view`; `has_permission(_user_id, _schluessel)`.

**Fachbegriffe**
- **BVH** Bauvorhaben · **KS/KST** Kostenstelle (eigene Baustellen `14045xx`; Sammel-KST
  `1404020…1404070` mit Unterzählung `-JJNN`; Planung `1404895-JJNN`; intern `1404899` Zimmerei
  Allgemein, `4760` Woodwork sonstige Kosten).
- **Partie** = Arbeitsgruppe mit Partieleiter/Polier · **Einteilung/Tagesplan** = wer wo arbeitet.
- **Jahresplanung** = Seite `/arbeitsplanung` (Poliereinsatz-Gantt + Abwesenheiten).
- **BSB** Baustellenstundenbericht (14-tägig, Arbeiter) · **TB** Tätigkeitsbericht (Angestellte,
  Periode 21.–20.) · **Bautagesbericht / Regiebericht** = `berichte`.
- **Evaluierung/Unterweisung** = Sicherheitsunterweisung nach ASchG, wird am Handy/Tablet unterschrieben.
- **Taggeld** (automatisch aus Baustellen-Stunden), **Fahrtgeld** (Polier, 0,5/1,0/1,5 h), **Zulagen**.
- **Leasing Personal** = Leihpersonal ohne App-Zugang (`zeiterfassung_typ = 'leasing'`).

**Feste Regeln / No-Gos**
- **SharePoint/OneDrive: nie löschen, überschreiben, umbenennen oder verschieben** — „schau dass du
  Nix löschst bei onedrive das ist immer oberste Bedingung“ (Christoph, 09/2026). Anlegen und
  Hochladen ist erlaubt. Einmalige Löschungen nur auf ausdrücklichen Auftrag, nie im App-Code.
- **Keine Test-Mails/SMS an napetschnig.chris@gmail.com** (auch +Alias), kein Login/generate_link auf
  seinem Konto, bestehende Konten beim Testen tabu — „Bestehende Konten sollen in Ruhe gelassen
  werden“ (Christoph, 09/2026). Testkonten `pruef-<ts>@willroider.invalid`, danach restlos löschen.
  `npm run test:e2e` legt Testnutzer in der **Produktiv-DB** an → nur bewusst und mit Teardown.
- **App-Domain ist `willroider.app`** (nie holzerleben.app — Christoph, 07/2026, sehr deutlich).
- **Supabase-Projekt `ylqbxnsxksbtsqrcwtuq`** (siehe oben; `config.toml` ist falsch).
- **GitHub-Repo ist öffentlich** → nie Schlüssel/Passwörter in Code oder Doku. `.env` nicht anfassen.
  VAPID-Schlüssel (Push) nie neu erzeugen.
- Kundenantworten: Deutsch, du-Form, „Hallo <Vorname>“ … „LG“, kurz, sagen *wo* man es in der App
  findet, ggf. „App einmal neu laden“. Nicht „das war ein echter Fehler“ dramatisieren (Christoph, 09/2026).
- Wunsch fertig → Antwort gleich in `feedback.admin_notiz`, Status `umgesetzt` (Christoph, 08.10.:
  „wenn du es erledigt hast dann gleich die antwort in die app schreiben“).

**Technik / Ablauf**
- Deploy: Push auf `main` → Vercel baut `willroider.app` (SPA-Rewrite in `vercel.json`).
- **Gate vor jedem Commit:** `npm run build` (Exit 0) **und**
  `test "$(npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c TS2304)" = "0"`; Commit/Push nur
  mit `&&` dahinter. Zusätzlich auf TDZ (`no-use-before-define`) und rules-of-hooks prüfen — beides hat
  schon die Live-App abstürzen lassen (19.10. Mitarbeiter, 29.10. Stundenbericht). Bekannte
  Alt-Fehler: TS2345 in `useStundenBericht.ts`.
- Deutsche Anführungszeichen in Strings: „…“ immer mit “ schließen, nie mit geradem `"` — hat den
  Build dreimal zerschossen.
- Migrationen: Datei in `supabase/migrations/`, einspielen per Supabase-MCP (`apply_migration`/
  `execute_sql`, project_id `ylqbxnsxksbtsqrcwtuq`) oder Management-API (Token aus
  `~/.config/hw/zugangsdaten.env`, nie ausgeben). Neue Spalten fehlen in `types.ts` → `as any`.
  Tests von DB-Logik in zurückgerollten Transaktionen. Erst Migration, dann Deploy.
- Edge Functions: `supabase functions deploy <fn> --project-ref ylqbxnsxksbtsqrcwtuq --use-api`
  (Token per `set -a; eval "$(grep … SUPABASE_ACCESS_TOKEN …)"`). Einige Dateien enthalten NUL-Bytes
  (`sharepoint-schreiben`, `sharepoint-sync`, `_shared/push.ts`, `_shared/sms.ts`, `push-senden`) →
  mit Python bearbeiten, nicht mit dem Edit-Werkzeug.
- Mail über Resend (Absender `berichte@willroider.app`), SMS über Twilio, Push per Web-Push (VAPID).
- Screenshots aus Wünschen: `node ~/Developer/_baukasten/werkzeuge/wunsch-bilder.mjs ylqbxnsxksbtsqrcwtuq feedback-dateien <pfad> --ziel <dir>`.
- **Verlauf:** `JOURNAL.md` (neueste Einträge oben, vorne einfügen) — nie ganz lesen, gezielt per
  `grep` suchen. `AGENTS.md` ist eine exakte Kopie dieser Datei (für Codex).

## Wissen nach Thema

| Thema | Datei | Wann lesen |
|---|---|---|
| Zeiterfassung & Baustellenstundenbericht | `.claude/rules/stunden-und-stundenbericht.md` | Stunden, Kostenstelle, Fahrtgeld, Taggeld, Zulagen, BSB prüfen/senden/erinnern |
| Tätigkeitsbericht, Fahrtenbuch, Krankmeldung | `.claude/rules/taetigkeitsbericht-fahrtenbuch.md` | Angestellte, Periode 21.–20., Freigabe, Kilometer, Krankmeldung |
| Arbeitszeit, Soll, Abwesenheiten | `.claude/rules/arbeitszeit-abwesenheiten.md` | Wochen-Soll, Arbeitszeitmodelle, Berufs-/Polierschule, Urlaub |
| Planung & Tagesplan | `.claude/rules/planung-tagesplan.md` | Jahresplanung/Poliereinsatz, Tagesplanung, Tagesplan-Ansicht, Einsatzplan-PDF |
| Baustelle anlegen | `.claude/rules/baustellen-anlage.md` | Baustellenmeldung, Planung↔Ausführung, KST-Vergabe, Empfänger |
| SharePoint / OneDrive | `.claude/rules/sharepoint-onedrive.md` | Ordner, Abgleich, Ablage von PDFs, Dokumente-Reiter |
| Evaluierung / Unterweisung | `.claude/rules/evaluierung-unterweisung.md` | Unterweisungen, Unterschrift Handy/Tablet, Nachweis-PDF, Fristen |
| Berichte & Archiv | `.claude/rules/berichte-archiv.md` | Bautages-/Regiebericht, Berichte-Archiv, gesammelt versenden |
| Anmeldung, Mitarbeiter, Rechte | `.claude/rules/anmeldung-mitarbeiter.md` | Login, Einladung, Doppelkonten, Freischalten, Leasing, Rechte je Person |
| Push, Erinnerungen, Dashboard-Hinweise | `.claude/rules/push-erinnerungen.md` | Benachrichtigungen, SMS-Ersatz, Cron, wer welchen Hinweis sieht |

## Wissen ablegen (für jede KI – auch den Roboter)
- Diese Datei ist die kurze Kundenakte und bleibt unter 25 KB. Hier nur: wer der Kunde ist, feste Regeln, Technik, Index.
- Neue Erkenntnis, Fallstrick oder Entscheidung zu einem Thema → in die passende Datei unter `.claude/rules/`
  (mit Datum und, wenn von Christoph/Kunde, dem Zitat). Gibt es kein passendes Thema: neue Datei mit `paths:` auf die
  betroffenen Code-Ordner anlegen und oben im Index eintragen.
- Ausführliche Protokolle, Testberichte, Abläufe → `JOURNAL.md` oder `research_notes/`, nicht hierher.
