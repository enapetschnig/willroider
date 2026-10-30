---
paths:
  - "src/pages/Arbeitsplanung.tsx"
  - "src/pages/Tagesplanung.tsx"
  - "src/pages/MeinTag.tsx"
  - "src/components/arbeitsplanung/**"
  - "src/components/TagesplanPreview.tsx"
  - "src/components/ui/datum-kw-feld.tsx"
  - "src/hooks/useTagesplanung.ts"
  - "src/lib/tagesplanung*.ts"
  - "src/lib/poliereinsatzPdf.ts"
  - "supabase/functions/einsatzplan-pdf/**"
  - "supabase/functions/_shared/poliereinsatzPdf.ts"
---

# Jahresplanung (Poliereinsatz), Tagesplanung, Tagesplan

## Jahresplanung = `/arbeitsplanung`
- Poliereinsatz-Gantt nach Vorbild des MS-Project-Ausdrucks (KW28.mpp importiert), **Poliereinsatz zuerst**
  (24.07.). Reiter „Mitarbeiter“ zeigt nur Abwesenheiten (18.07./22.07.).
- **Abwesenheiten nur mit Recht** (B. Sirnitzer, 18.09.): Urlaub/Krank nur für Büro und Geschäftsführung
  (`arbeitsplanung.abwesenheiten`); ohne Recht entfallen Reiter „Mitarbeiter“ und Block „Urlaube“. Ein Polier
  sieht die Abwesenheiten seiner Partie. Auch per RLS (`stunden_tage_select`) abgesichert.
- Abwesenheits-Codes in `Arbeitsplanung.tsx`: `FEHLZEIT_LABEL/_COLOR/_TAG_STATUS`, `TAG_STATUS_CODE`
  (U, K, F, SW, BS, PS, „U?“ beantragt).
- **KW im Datumswähler** (J. Maurer, 15.10.): `components/ui/datum-kw-feld.tsx` (ISO-Wochen); Tipp auf KW
  setzt bei „Von“ Montag, bei „Bis“ Freitag. Der Browser-`input type="date"` kann keine KW.
- Balken-Info und „Einsatz bearbeiten“ haben „Zur Baustelle“ (nur mit `baustellen.view`) (E. Egger, 18.10.).
- Suche nach BVH/KST/Partie (Lupe) in der Einsatzplanung.
- **Arbeitseinteilung als PDF** (E. Egger, 15.09.): Reihenfolge wie am Bildschirm (Partien nach
  Reihenfolge, nicht alphabetisch), kein „Büro“, Format A4/A3/A2 wählbar; PDF = 1:1-Nachbau der Ansicht.
- **Wöchentliches Archiv** (S. Egger, 18.09.): Cron `einsatzplan-woche` (Mittwoch früh) → Edge Function
  `einsatzplan-pdf`, Montag der laufenden Woche + 12 Wochen, A3 quer; in der App (Jahresplanung → PDF →
  „Archiv“) und in SharePoint „Personaleinteilung Zimmerei / Einsatzplanung PDF <Jahr>“ als `KWxx.pdf`.
  `_shared/poliereinsatzPdf.ts` ist eine Kopie von `src/lib/poliereinsatzPdf.ts` — beide pflegen.
- Offener Altwunsch (S. Egger): „Wochenstand einfrieren“ wurde zurückgestellt.
- Entkopplung Jahresplanung ↔ Tagesplanung: Christoph wollte „Die Dashboard-Einteilung soll immer nach der
  Tagesplanung sein“; Phase 2 (eigene Tabelle) nur nach erneuter Bestätigung beginnen (07/2026).

## Tagesplanung / Tagesplan
- Tabellen `einteilungen`, `einteilung_mitarbeiter`, `einteilung_fahrzeuge`; Freigabe durch das Büro in
  `tagesplanung_freigaben`. Stunden und Mein Tag ziehen die Baustelle aus der Planung (`plan_fuer_tag`).
- Tagesplan in Reihenfolge der Polierplanung, ohne Büro-Leute (27.07.); mehrere BVH je Partie (11.08.).
- Sonderfälle-Zeilen: Berufsschule (J. Maurer, 11.09.), Polierschule nur wenn jemand dort ist.
- **Tagesplan für alle** (E. Winkler, 19.10.): Ist ein Tag freigegeben, sieht jeder Angemeldete den ganzen
  Plan (`darf_einteilung_sehen`, `einteilung_ma_select`, `tagesplan_abwesende(datum)` security definer).
  Mein Tag: „Ganzen Tagesplan ansehen“, auch ohne eigene Einteilung.
- **Nächster Einsatz** auf der Startseite (B. Sirnitzer, 18.09.): nächster freigegebener Tag, auch Fr→Mo.
- **Tagesplan am Handy** (J. Maurer, 26.–30.10.: „soll so aussehen wie in der Ansicht am Tablet aber zum
  zoomen“): Karten-Ansicht wurde verworfen. `HandyZoom` in `TagesplanPreview.tsx`: unter 640 px dasselbe
  Blatt (760 px) per CSS `zoom` eingepasst; Zwei-Finger-Zoom um den Fingerpunkt, Doppeltippen, − / ⤢ / +;
  ab 640 px unverändert. **Fallstrick (30.10.):** `DialogContent` ist ein CSS-Grid, Grid-Kinder haben
  `min-width: auto` — das breite Blatt blähte den gemessenen Rahmen auf (448 statt 296 px), Blatt rechts
  abgeschnitten, Zoom-Knöpfe außerhalb des Bildschirms. Darum misst `HandyZoom` am Rahmen mit
  `minWidth: 0` + `contain: "inline-size"`. Christoph (30.10.): „muss glaube ich mal selber drüber schauen
  … das scheint immer noch nicht zu funktionieren“ → Handy-Ansichten vor dem Melden selbst rendern:
- **Handy-Ansicht selbst prüfen** (30.10.): `/usr/bin/google-chrome` headless über `playwright-core` aus dem
  Repo (`executablePath`, `isMobile`, `hasTouch`, `deviceScaleFactor`; 360/390/412 px), Gesten echt per
  CDP `Input.dispatchTouchEvent`. Ohne Login: Wegwerf-Seite unter Vite mit der echten `DialogContent`-Klasse
  und vorbefülltem react-query-Cache (`setQueryData(["tagesplan", datum], plan)`), per `.git/info/exclude`
  ausgeschlossen und danach gelöscht — echte Namen nie committen (Repo öffentlich). Echtes iPhone/Safari
  nicht getestet (Safari-`gesture*`-Ereignisse werden vorsorglich abgefangen).
- „Standard-Unterweisung anlegen“ in der Tagesplanung → `evaluierung-unterweisung.md`.
