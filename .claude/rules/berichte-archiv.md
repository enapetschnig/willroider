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
- **Fotos groß ansehen / PDF statt Foto** (J. Maurer, 11.11.2026: „Bilder nicht ersichtlich sollen sich auch beim anklicken größer öffnen lassen“):
  Im Bericht a33c3e50 war unter „Fotos“ eine PDF (Plan, 11 MB) angehängt — „Aus Galerie“ (`accept="image/*"`) lässt am PC trotzdem jede Datei zu,
  `compressImage` reicht Nicht-Bilder durch. Kachel war leer. Jetzt: Klick auf Kachel → `DocViewerDialog` (Bild groß, PDF im Rahmen); PDF-Kachel zeigt
  die erste Seite (`lib/pdfVorschau.ts`) mit „PDF“-Marke; im Bericht-PDF wird die erste Seite eingepasst (nicht verzerrt) als Bild gedruckt. PDFs bleiben erlaubt.
- **Fotos weiterblättern** (J. Maurer, 18.11.2026: „nach öffnen eines Bildes eine weiter Klick Funktion“): `DocViewerDialog` hat optional
  `onVorher`/`onWeiter`/`position` → Pfeile links/rechts, Tasten ← →, Wischen, „3 / 5“ im Titel, am Ende wieder von vorn. Genutzt im Bericht (alle Fotos
  inkl. PDF-Anhänge in Kachel-Reihenfolge) und in den Dokumente-Reitern von Baustelle und Angebot (nur Bilder im selben Ordner; Pläne gehen in den Plan-Viewer).
  Baustelle: `viewerDocId` erst zusammen mit `setViewerItem` setzen, SharePoint-Antworten per Zähler (`viewerAnfrage`) — sonst zeigt die Position die neue, die Ansicht die alte Datei.
  Probefahrt: Dev-Server scheitert hier an ENOSPC (inotify) → mit eigener Config `server.watch: null` starten.
- **Bautagesbericht → Regiebericht** (J. Maurer, 17.11.2026: „Übernehmen in Regiebericht“): Knopf „In Regiebericht übernehmen“ im Kopf des
  Bautagesberichts (`uebernehmeInRegiebericht` in `useBericht.ts`). Legt den Regiebericht für denselben Tag/dieselbe Baustelle an (UNIQUE baustelle+datum+typ),
  kopiert Wetter, Besonderheiten, MA, Tätigkeiten, Aufmaß, Fotos (gleiche `dokument_id`, keine Kopie der Datei), keine Unterschriften. Gibt es den
  Regiebericht schon → seit 25.11. Auswahl „Vorhandenen öffnen“ / „Weiteren Regiebericht anlegen“. Übernimmt die Verwaltung, gehört er dem Polier des Bautagesberichts (`erfasst_von`). Weil Fotos geteilt sein
  können, löscht `useDeleteBericht` Foto-Dokumente nur, wenn kein anderer Bericht sie noch nutzt.
- **Mehrere Regieberichte je Tag + Datum ändern** (J. Maurer, 25.11.2026: „Regieberichte müssen auch mehrere am Tag möglich sein weiters
  braucht es die Möglichkeit das Datum zu ändern“). Neuer Wunsch ersetzt „ein Regiebericht je Tag“ vom 17.11. Ursache der Sperre:
  `UNIQUE (baustelle_id, datum, typ)` → jetzt nur noch Index `berichte_bautagesbericht_je_tag` (Bautagesbericht bleibt einmal je Tag, MeinTag sucht ihn so).
  „Neuer Regiebericht“ und „In Regiebericht übernehmen“ fragen, wenn es schon welche gibt (`ladeRegieberichteAmTag`); Liste/Kopf zeigen „Nr. 1/2“
  (älteste = 1). PDF-Pfad `berichtPdfPfad`: eigener Pfad bleibt, sonst erster freier `<datum>_regiebericht_2.pdf` (vorher hätte upsert das PDF des
  ersten überschrieben); SharePoint-Name „… <Datum> (2).pdf“ aus `storage_path`. „Datum ändern“ im Kopf nur Entwurf/Eingereicht (Freigegebene erst zurück auf Entwurf). War der Bericht
  schon einmal freigegeben, bleibt das alte PDF mit altem Datum in Dokumente/SharePoint liegen (nie umbenennen/löschen), das neue kommt bei der
  nächsten Freigabe dazu. Trigger `bericht_audit` schreibt „Datum: alt → neu“. ZE-Übernahme nach Datumsänderung nur anbieten, wenn der neue Tag
  Stunden hat — `uebernehmeVorausfuellung` löscht zuerst alle `aus_zeiterfassung`-Zeilen (auch die aus „In Regiebericht übernehmen“).
  Test `tests/roboter/2026-11-25-regieberichte-mehrere-je-tag-datum-aendern.spec.ts`. `.maybeSingle()` auf (baustelle, datum, typ) nie wieder für Regie.
- **Zurück mit letzter Auswahl** (J. Maurer, 17.11.2026): `/berichte` merkt Typ/Zeitraum/Status/Baustelle in `sessionStorage` (`lib/berichteAuswahl.ts`);
  Zurück-Pfeil im Bericht und der Menüpunkt holen sie zurück. Baustellen-Auswahl (Filter + „Neuer Bericht“) ist jetzt `BaustelleCombobox` mit Suche nach Name/KST.
- **„ZE“** = Zeile aus der Zeiterfassung: beim MA dessen Stunden auf der Baustelle an dem Tag, bei der Tätigkeit die Summe aller MA. Entfernt man MA von Hand,
  bleibt die Tätigkeits-Summe stehen (Bericht 605b6c96, 09.11.: 5×9,5 = 47,5 h übernommen, 2 MA danach entfernt). Vermutlich sieht der Polier beim Anlegen per RLS
  nur Arbeiter-Stunden, Angestellten-Stunden auf derselben KST (dort 11 h ohne Tätigkeit) kommen dann nicht mit.
- **Gesammelt versenden** (J. Maurer, 19.11.2026: „Berichte gesammelt versenden mit Auswahl Möglichkeiten“): `/berichte` → „Gesammelt versenden“
  schaltet Häkchen ein; Auswahl über die normalen Filter (Typ, Zeitraum, Status, Baustelle) + „Alle in der Liste“, bleibt beim Umschalten erhalten
  (Bautages- + Regieberichte in einer Mail). Nur freigegebene/archivierte Berichte mit `pdf_dokument_id` wählbar („Zurück auf Entwurf“ lässt das alte PDF stehen). „Per Mail senden“ nur bei `isAdmin`
  (`dokument-versenden` ist `is_admin_role`; Poliere haben `berichte.freigeben`, sind aber keine Verwaltung), „Herunterladen (ZIP)“ für alle.
  Dateinamen „Bautagesbericht <BVH> <Datum>.pdf“ (im Speicher heißen sie alle `<datum>_<typ>.pdf`). Bericht-PDFs sind im Schnitt 3,7 MB, bis 21 MB →
  `DocSendDialog` teilt ab 15 MB je Mail auf mehrere Mails auf („Teil 1/2“, `lib/mailTeile.ts`) — gilt auch für Dokumente bei Baustelle/Angebot.

## Berichte-Archiv (`/berichte-archiv`, Recht `stunden.bsb.bestaetigen`)
- Abgestimmt mit J. Maurer (21.09., er wollte vorher gefragt werden): fertige TB (nach Freigabe) und BSB
  (nach Bestätigung) werden in der App archiviert **und** nach SharePoint kopiert, **jährliche Unterordner**,
  Versand **gesammelt** (1× Stundenberichte, 1× Tätigkeitsberichte). Tabelle `bericht_archiv`
  (`ueberholt_am` bei neuer Fassung; Überholtes nicht auswählbar, `archiv-versenden` lehnt es ab).
- **„Mitschicken“** (J. Maurer, 21.10.), standardmäßig an: Fahrtenbuch-PDF je TB (im Browser erzeugt,
  `extra_anhaenge`) und Krankmeldungen mit Datei aus `ma_dokumente`, die in die Periode fallen (TB 21.–20.,
  BSB Teil I/II). Bei Übergröße als Link.
- „Herunterladen (ZIP)“ für markierte Einträge; URL-Parameter `?art&jahr&monat&teil`.
- **Eine PDF je Mitarbeiter bei Tätigkeitsberichten** (J. Maurer, 23.11.2026: „Bei den Berichten fehlen die Kilometer optimal wäre eine PDF je
  Mitarbeiter mit Tätigkeitsbericht Kilometerbuch und Krankscheine“). Ursache: das Fahrtenbuch hing nur an der Mail, nicht an Download/ZIP.
  Jetzt `lib/berichtGesamtPdf.ts` (pdf-lib, im Browser, jedes Mal frisch): TB → Fahrtenbuch → Zulagen-Zettel → Krankenzettel (PDF-Seiten, Fotos auf A4,
  HEIC umgewandelt). Gilt für Zeilen-Download, ZIP und Mail (`ersetzt_ids` an `archiv-versenden`, die dann Bericht/Krankmeldungen nicht doppelt anhängt).
  Nicht Einfügbares geht als eigene Datei mit; nicht lesbares Archiv-PDF, Nicht-Verwaltung (Krankmeldungen per RLS) oder > 20 MB → alter Weg.
  Archiv-PDF und SharePoint-Kopie bleiben nur der TB. Stundenberichte unverändert (Bericht + Beilagen einzeln). Zeile zeigt „Fahrtenbuch (n Fahrten)“.
  Test `tests/roboter/2026-11-23-archiv-tb-eine-pdf-je-mitarbeiter.spec.ts`.
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
