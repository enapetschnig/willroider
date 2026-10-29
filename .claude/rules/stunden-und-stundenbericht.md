---
paths:
  - "src/pages/Stunden.tsx"
  - "src/pages/StundenBericht.tsx"
  - "src/pages/StundenBerichteListe.tsx"
  - "src/pages/Stundenauswertung.tsx"
  - "src/pages/HalleErfassung.tsx"
  - "src/components/stunden/**"
  - "src/components/TagBearbeitenDialog.tsx"
  - "src/components/BsbVersendenDialog.tsx"
  - "src/components/StundenberichtErinnernDialog.tsx"
  - "src/hooks/useStunden*.ts"
  - "src/lib/stunden*.ts"
  - "src/lib/zeiterfassung.ts"
  - "src/lib/taggeld.ts"
  - "src/lib/zulagen.ts"
  - "src/lib/bsbPdfHelper.ts"
  - "src/lib/baustellenstundenberichtPdf.ts"
  - "supabase/functions/stundenbericht-versenden/**"
---

# Zeiterfassung & Baustellenstundenbericht (BSB)

## Stunden schreiben (`/stunden`, `/halle`)
- **Kostenstelle Pflicht** (N. Gwenger, 08.10.): Arbeitsstunden (Baustelle/Firma) ohne Baustelle bzw.
  Kostenstelle werden nicht gespeichert — außer Krank, Urlaub, Schlechtwetter, Berufs-/Polierschule.
  Gilt in Stunden, „Tag bearbeiten“ (BSB) und Büro-Korrektur.
- **Firma mit Kostenstelle:** Bei „Firma“ wählt man die Kostenstelle; oben die internen
  „Zimmerei Allgemein (1404899)“ und „Woodwork sonstige Kosten (4760)“ (`baustellen.kategorie = 'intern'`,
  Migration `20261008120000_interne_kostenstellen.sql`), darunter alle Baustellen. Firma heißt **kein Taggeld**.
  Im Bericht: „HMH Skrube (in der Firma)“. `baustelle_id` wird auch bei Firma-Zeilen gespeichert.
- Der Umschalter „Auf der Baustelle / In der Firma“ (05.10.) wurde am 08.10. wieder entfernt;
  Spalte `stunden_taetigkeiten.ort` und ihre Auswertung bleiben. 316 alte Firma-Zeilen ohne KST bleiben so.
- **Fahrtgeld** (B. Sirnitzer, 08.10.): nur „Fahrtgeld (Polier)“ mit Keins / 0,5 / 1,0 / 1,5 Std, keine
  Euro-Beträge, kein manuelles Taggeld. Christoph: Fahrtgeld-Stunden werden nur vermerkt und vom Lohnbüro
  abgerechnet, **zählen nicht zu den Arbeitsstunden**. Spalte `stunden_fahrt.fahrtgeld_stunden`
  (`fahrtgeld_eur` bleibt, wird nicht mehr befüllt).
- **Taggeld** rechnet die App immer automatisch aus den Baustellen-Stunden (Firma-Zeilen zählen nicht).
- **Polier wählt alle Mitarbeiter** (B. Sirnitzer, 08.10.): Wer „für andere erfassen“ hat, bekommt alle
  aktiven Mitarbeiter (eigene Partie oben). Hat jemand schon einen Tag, steht „erfasst“ und er wird
  **nicht überschrieben**. RPC `stunden_tag_vorhanden(datum, ids)` sagt nur Ja/Nein;
  `stunden_tage_select` erlaubt zusätzlich `erfasst_von = auth.uid()`.
- **Zulagen für alle** (E. Winkler, 19.10.): keine Zuteilung = alle aktiven Zulagen; eine bewusste
  Zuteilung durch das Büro bleibt bestehen. Auch in `TagBearbeitenDialog` antippbar.
- Werk-/Hallenstunden lassen sich auf eine Baustelle buchen (28.07.). Halle = Maschinen-Zeiterfassung.
- Mein Tag → „Meine Stunden“: Baustellenname je Tag + Knopf „Ändern“ (`/stunden?datum=JJJJ-MM-TT`),
  solange das Büro den Tag nicht freigegeben hat (B. Sirnitzer, 19.10.).
- Fallstrick: Masken ohne bestimmte Felder müssen beim Speichern den gespeicherten Wert übernehmen
  (Ort, Fahrtgeld), sonst fällt er still zurück.

## Baustellenstundenbericht (BSB)
- Nur für **Arbeiter**. Angestellte haben Tätigkeitsbericht (N. Gwenger, 01.10.):
  `stunden_bericht_erzeugen` überspringt `zeiterfassung_typ = 'angestellter'` und `'leasing'`.
- Perioden Teil I = 1.–16., Teil II = 17.–Monatsende; Bericht entsteht am 16. bzw. Monatsletzten abends
  (Cron `bsb-abend`, 18:00), nur für Perioden mit Stunden. Mitarbeiter unterschreibt, Büro bestätigt.
- Auf `/stunden` oben Karte „Meine 14-tägigen Stundenberichte“ (gelb, wenn Unterschrift fehlt).
- **Bestätigen und Senden getrennt** (J. Maurer, 23.10.): „Bestätigen“ (Status `bestaetigt`, RPC
  `stunden_bericht_bestaetigen(p_id, p_unterschrift)` speichert die Büro-Unterschrift) und
  „Ans Büro senden“. Büro-Unterschrift gilt danach im selben Tab weiter (Modul-Variable
  `gemerkteBueroUnterschrift`, nicht gespeichert).
- **Nacheinander prüfen** (22./23.10.): Standard „Alle wartenden (alle Monate)“, älteste Periode zuerst,
  darin alphabetisch (sessionStorage `bsb-pruefen-reihe`). „Bestätigen — weiter“, am Ende
  „Bestätigte ans Büro senden (n)“ in einer Mail. Liste: Monat/Teil oben, Filter, 15 Zeilen eingeklappt,
  ZIP-Download (`lib/zipDownload.ts`).
- **Fahrgeld/Zulagen als Zeilen je Tag** (J. Maurer, 23.10.): `zusatzZeilenJeTag` in
  `stundenAggregation.ts`, unter der Summe, am Bildschirm (✓) und im PDF („x“, jsPDF hat kein ✓).
  Krankheit/Schlechtwetter weiter als Zeilen K/SW.
- Erinnern an Unterschrift (Glocke, „Alle n erinnern“) → siehe `push-erinnerungen.md`.
- Fehler 29.10. (L. Schuller): `useState` hinter frühem Return → React #310, Seite stürzte für alle ab.
  Hooks immer vor `if (isLoading) return`.
