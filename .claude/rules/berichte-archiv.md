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
- **Fotos im HEIC-Format** (J. Maurer, 08.11.2026: „die bilder müssen beim prüfen sichtbar sein“): ein Handy schickte 34 Fotos als .heic,
  `compressImage` ließ HEIC unverändert durch → Chrome/Edge zeigen nichts, jsPDF bettet es nicht ein. Jetzt wandelt `lib/heic.ts` (`heic-to`,
  ~3 MB, nur bei Bedarf geladen, nicht im SW-Precache) HEIC beim Hochladen in JPG; alte HEIC werden in Vorschau und Bericht-PDF im Browser umgewandelt.
  Die 34 Fotos von Bericht 8a3dc3bc wurden als JPG daneben abgelegt und `dokumente` umgestellt (Original-.heic bleibt im Speicher;
  Sicherung `~/roboter/sicherungen/willroider-2026-11-08-heic/`). Gleiches nachgezogen im Dokumente-Reiter (Baustelle + Angebot): Upload HEIC → JPG
  (`heicDateiAlsJpg`, ohne Verkleinern), `dokumente/Thumbnail.tsx` und `DocViewerDialog.tsx` wandeln alte HEIC aus dem Speicher im Browser um
  (SharePoint-HEIC kommt schon über `sharepoint-datei` als JPG).

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
- Einreichen (03.11.2026): `berichte_update` hatte kein WITH CHECK → Polier konnte eigenen Entwurf nie einreichen (RLS-Fehler).
  Jetzt darf der Ersteller `entwurf`→`eingereicht`; freigeben/archivieren bleibt `is_admin_role`.
- **Download direkt, Zulagen-Zettel, Krankenzettel** (J. Maurer, 04.11.2026: „kommt immer der gleiche … Granitzer … zu den Zulagen brauchen wir den
  Zettel immer ausgefüllt … plus die Krankenzettel“). Alle 44 Archiv-PDFs waren richtig (Name im PDF = Dateiname). Der Download ging je Klick über
  ein neues Fenster nach einer Wartezeit; eine Browser-Sperre ließ sich im Test nicht nachstellen, ist aber die wahrscheinlichste Erklärung. Jetzt
  `dateiHerunterladen` ohne Fenster. Beilagen: `lib/berichtBeilagen.ts`, Zettel `lib/erschwerniszulagePdf.ts`
  (Vorlage „Aufzeichnung Erschwerniszulage“ aus Chat 04.05.2026, ein Blatt je KW und Zulage, immer frisch aus den Stunden, nicht im Archiv/SharePoint).
  Gehen mit: Archiv-Zeile und -ZIP, Archiv-Mail (`extra_anhaenge`), Stundenbericht „PDF herunterladen“ und Listen-ZIP (nur Verwaltung), „Ans Büro senden“
  (`mit_krankmeldungen` in `stundenbericht-versenden`). Hoehenzulage = Punkt m (wie `zulagen.ts`), Schmutz und Abbruch = Punkt d.
  Fallstricke: `arbeitsbeginn` ist praktisch immer leer → Raster zählt ab 07:00 mit Hinweis am Zettel, maßgeblich ist die Summe. Eine Polier-Unterschrift
  gibt es nicht und wird nicht nachgestellt: nur sein Name (`partien.partieleiter_id`), dazu die Unterschriften aus dem BSB. Krankmeldungen liest per RLS
  nur die Verwaltung; Mitarbeiter laden Zettel selten hoch (Mein Tag → Krankmeldung), darum Hinweis „n Krank-Tage ohne Zettel“ in der Zeile. Das Büro kann
  noch keinen Zettel für einen Mitarbeiter hochladen.
