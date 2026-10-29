---
paths:
  - "src/pages/Taetigkeitsbericht.tsx"
  - "src/pages/TaetigkeitsberichteListe.tsx"
  - "src/components/taetigkeitsbericht/**"
  - "src/lib/taetigkeitsbericht*.ts"
  - "src/components/dashboard/TaetigkeitsberichtHintCard.tsx"
  - "src/components/MeinTag/KrankmeldungenCard.tsx"
---

# Tätigkeitsbericht (Angestellte), Fahrtenbuch, Krankmeldung

## Tätigkeitsbericht (TB)
- Für Angestellte (`zeiterfassung_typ = 'angestellter'`), Excel-Optik, eigene Zeiterfassung (seit 28.07.).
- **Periode „Monat“ = 21. des Vormonats bis 20.** Kostenstellen-Zeilen: nur KST mit Stunden plus selbst
  über „Kostenstelle hinzufügen“ ergänzte; die Liste wird je Person und Periode neu aufgebaut
  (J. Maurer, 22.09. — fremde KST 4020/4504 standen vorher drin). Interne KST nur mit Stunden;
  „Zim Allgemein 4899“ steht schon unter „Kostenstelle hinzufügen“.
- **Freigabe** wie Stundenberichte (J. Maurer, 21.09.): Menü „Tätigkeitsberichte“ (Recht
  `stunden.taetigkeitsbericht.freigeben`, Geschäftsführung bzw. Stellvertreter). Nach Freigabe ist die
  Periode gesperrt, „Wieder öffnen“ hebt das auf.
- **Erst ab dem 21. zur Freigabe** (E. Winkler, 07.10.): `freigabeFaellig(jahr, monat, heute)` in
  `lib/taetigkeitsbericht.ts` — früh Unterschriebenes erscheint nicht als „wartet auf Freigabe“, bis dahin
  darf der Angestellte ändern und neu unterschreiben. Gilt für Dashboard-Karte, Liste und Cron `erinnerungen`.
- „Gesammelt versenden“ führt ins Berichte-Archiv mit derselben Periode (`?art&jahr&monat`).
- ‹ › neben der Personenauswahl zum Durchblättern.
- **Eigenes Wochen-Soll** (z. B. Köstenberger, geringfügig) → `arbeitszeit-abwesenheiten.md`.

## Fahrtenbuch (Reiter im TB)
- Kennzeichen **je Fahrt** (Vorschläge aus Fahrzeugliste, Großbuchstaben), Abfahrt/Ankunft als **Orte**
  (`OrtFeld.tsx`: Firma, Baustellen, frühere Orte, Photon/OpenStreetMap). **Kein Google, keine
  km-Berechnung** — km bleiben Tacho-Werte (J. Mainhard, 24.09., freigegebener Vorschlag).
  Spalten `fahrtenbuch_eintraege.kennzeichen/abfahrt_ort/ankunft_ort`.
- Offen seit 24.09.: zwei Firmenadressen in `FIRMA_ORTE` (`FahrtenbuchTab.tsx`) — „Willroiderstraße 13,
  9500 Villach“ und „Willroider-Allee 10, 9580 St. Niklas an der Drau“; Kunde hat nicht entschieden.
- Fahrten mit früherem Datum nachtragen erlaubt, nur freigegebene Perioden gesperrt (S. Egger, 21.09.).
- Neue Fahrt bekommt nach Periodenende das **Periodenende** als Datum und steht unten; Fahrten ohne Uhrzeit
  nach denen mit Uhrzeit (`nullsFirst: false`) (E. Egger, 21.10.).
- Import aus Driversnote (13.08., ab 14.08. auch der PDF-Fahrtenbericht; `fahrtenbuchImport.ts`): „Von“ → Abfahrt, „Nach“ → Ankunft.
- Fahrtenbuch-PDF monatlich, erste Spalte Periodenlabel „Mai-Juni“ (fürs Lohnbüro).

## Krankmeldung (Mein Tag → „Krankmeldung / Arzttermin“)
- Fallstrick (J. Maurer, 29.09.): Rückkehr aus der Handy-Kamera erneuert die Anmeldung → Seite baute sich
  neu auf und schloss das Formular. Lösung: `AuthContext` behält `user`/`profile`-Objekt bei gleichem Inhalt,
  Entwurf im Browser gemerkt. Gilt app-weit — nicht zurückbauen.
- Eigene Krankmeldung nachträglich ändern (Stift); Datum/Stunden-Änderung bucht die Krank-Einträge im TB um
  (Migration `20260929100000_krankmeldung_bearbeiten.sql`).
- Ganztägige Krankmeldungen überschreiben nur Tage im Status „erfasst“ (bekannt, unverändert).
