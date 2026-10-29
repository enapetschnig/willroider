---
paths:
  - "src/pages/Berichte.tsx"
  - "src/pages/BerichtDetail.tsx"
  - "src/pages/BerichteArchiv.tsx"
  - "src/hooks/useBericht*.ts"
  - "src/lib/berichtPdf.ts"
  - "src/lib/berichtArchiv.ts"
  - "src/lib/zipDownload.ts"
  - "src/components/dashboard/BerichteHintCard.tsx"
  - "supabase/functions/archiv-versenden/**"
  - "supabase/functions/bericht-ablegen/**"
---

# Bautages-/Regieberichte und Berichte-Archiv

## Berichte (`berichte`)
- Bautagesbericht/Regiebericht; Vorbelegung aus dem Tagesplan (`useBerichtVorausfuellung.ts`), Wetter mit
  Gerätestandort als Rückfall, Diktieren (MicButton) bei Aufmaß/Tätigkeiten/Notiz, Unterschriften am
  Regiebericht, gespeicherte Unterschrift mit einem Klick (`unterschrift_vorlagen`) (11.09.).
- Aufmaß ist optional (28.07.).
- **„Ganze Partie“** beim Hinzufügen der Mitarbeiter (D. Tauchhammer, 21.10.): fügt alle aktiven Mitglieder
  samt Partieleiter ein, Doppelte werden übersprungen.
- **Hinweis „Bericht wartet auf deine Freigabe“** bekommt nur der Bauleiter der Baustelle
  (`baustellen.bauleiter_id`); ansehen, suchen und freigeben darf weiter jeder Bauleiter jeden Bericht
  (E. Winkler, 19.10.).
- Ablage als PDF in SharePoint `00-Baustelle` → `sharepoint-onedrive.md`.

## Berichte-Archiv (`/berichte-archiv`, Recht `stunden.bsb.bestaetigen`)
- Abgestimmt mit J. Maurer (21.09., er wollte vorher gefragt werden): fertige TB (nach Freigabe) und BSB
  (nach Bestätigung) werden in der App archiviert **und** nach SharePoint kopiert, **jährliche Unterordner**,
  Versand **gesammelt** (1× Stundenberichte, 1× Tätigkeitsberichte). Tabelle `bericht_archiv`
  (`ueberholt_am` bei neuer Fassung; Überholtes nicht auswählbar, `archiv-versenden` lehnt es ab).
- **„Mitschicken“** (J. Maurer, 21.10.), standardmäßig an: Fahrtenbuch-PDF je TB (im Browser erzeugt,
  `extra_anhaenge`) und Krankmeldungen mit Datei aus `ma_dokumente`, die in die Periode fallen (TB 21.–20.,
  BSB Teil I/II). Bei Übergröße als Link.
- „Herunterladen (ZIP)“ für markierte Einträge; URL-Parameter `?art&jahr&monat&teil`.
- Bekannt (23.09.): zwei archivierte TB-PDFs mit leeren Zeilen (Maurer Juli–Aug, Gwenger Sep); neu freigeben
  würde eine zweite Datei erzeugen — nur auf Wunsch.
