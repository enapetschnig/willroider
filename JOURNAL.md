# Journal

## 2026-10-01 · Wunsch von Johannes Maurer („aktualisiert sich beim Öffnen nochmal“)

**Ursache:** Die App fragte beim Öffnen nach einer neuen Version und lud sich bei
einem Treffer sofort neu (`registerType: 'autoUpdate'`). Heute wurde mehrmals
ausgeliefert, also passierte das sichtbar, gleich nach dem Öffnen.

**Geändert:**
- `vite.config.ts`: `registerType: 'prompt'`.
- `src/main.tsx`: Eine gefundene neue Version wird erst übernommen, wenn die App im
  Hintergrund ist. Außerdem lädt die App bei fehlenden nachgeladenen Bausteinen
  einmal neu (`vite:preloadError`).
- **Übergang:** Handys mit der alten Version bekommen die neue erst, wenn die App
  einmal ganz geschlossen wird.

**„Ansicht am Handy sollte noch verbessert werden“** (Screenshot von Christoph,
02.10.): Die Startseite war breiter als das Handy, rechts blieb ein leerer
Streifen.
- **Ursache:** In „Aktive Baustellen“ drückte ein langer Baustellenname die Karte
  breiter als den Bildschirm (gemessen: 866 statt 393 Punkte). `truncate` griff nicht,
  weil das Grid-Element keine `min-w-0` hatte.
- **Behoben:** `grid-cols-1` und `min-w-0`. Am Handy steht der Zeitraum jetzt in der
  zweiten Zeile, damit der Name mehr Platz hat.
- **Nachgemessen:** im Test-Browser (Chromium, Pixel-5-Breite, nachgestellte Daten,
  keine echten Konten). Die Seitenbreite ist jetzt gleich der Bildschirmbreite, auch
  mit offenem Benutzer-Menü.
- **Für spätere Tests:** Der Test-Browser startet hier, wenn `libnspr4`/`libnss3`
  per `apt-get download` ins Zwischenverzeichnis geholt und über `LD_LIBRARY_PATH`
  eingebunden werden.

## 2026-10-01 · Wünsche von Niklas Gwenger (Stundenbericht, Unterweisung)

**1. „Angestellte haben keinen Baustellenstundenbericht, wir schreiben Tätigkeitsbericht“**
- **Ursache:** Die Datenbank-Funktion `stunden_bericht_erzeugen` (Cron „bsb-abend“,
  täglich 18:00) legte Berichte für alle mit Stunden an, auch für Angestellte. Seit
  heute sind die Erinnerungen scharf. Um 09:00 bekamen 8 Angestellte eine Mail und
  einer eine Push-Nachricht „Stundenbericht unterschreiben“.
- Migration `20261001100000_bsb_ohne_angestellte.sql` (**angewendet**):
  - Die Funktion überspringt `zeiterfassung_typ = 'angestellter'`.
  - Die 41 offenen, nie unterschriebenen Berichte von Angestellten sind gelöscht
    (Freigabe Christoph).
  - Die 9 versendeten Berichte von Angestellten bleiben als Nachweis stehen.
- Dashboard: Die Karte „Dein Baustellenstundenbericht wartet …“ erscheint für
  Angestellte nicht mehr. Die Kontroll-Karte fürs Büro bleibt.

**2. „Mitarbeiter hinzufügen bzw. ändern … Wo sehe ich die fertig unterschriebene
Unterweisung … ähnlich wie die Vorlage von Christian“**
- Vorlage: „5.1 Unterweisung 2.docx“ (Gefahrenevaluierung Baustellen –
  Zimmerei/Tischlerei, Google Drive).
- **Neu:** Auf der Baustelle unter „Unterweisung“ gibt es den Knopf **„Nachweis als
  PDF“**, außerdem ein Download-Symbol bei jeder Evaluierung. Erzeugt wird ein
  Dokument im Aufbau der Vorlage (`src/lib/unterweisungNachweisPdf.ts`):
  - Seite 1: Angaben zur Baustelle (Anschrift, Art und Umfang, Arbeitsbeginn und
    -ende als KW, Bauleiter, Partieführer, Anzahl), Hinweis § 4 ASchG, „Schulung und
    Unterweisung auf Baustelle“ mit der Tabelle Name | Unterschrift | Name |
    Unterschrift samt Unterschriftsbildern, „Evaluierung durchgeführt“.
  - Ab Seite 2: „Gefahrenermittlung / Festlegung von Maßnahmen“ mit dem Zustand
    i.O. / nicht i.O. / n.A. je Punkt.
  - Bei Tagesbaustellen (SiGe) kommt weiter das Wulz-Formular.
- **Neu:** In der Unterweisungsliste lassen sich Mitarbeiter von Hand hinzufügen
  und offene (noch nicht unterschriebene) wieder herausnehmen. Wer von Hand dazukommt,
  hat keine Fälligkeit: Die Unterweisung erscheint in der App und kann unterschrieben
  werden, gesperrt wird erst bei einer Einteilung über den Tagesplan. Dafür war keine
  Datenbank-Änderung nötig, das Büro darf das laut Rechten schon.
- Nebenbei behoben: Die Einzel-PDF je Mitarbeiter zeigte „nicht i.O.“ als „—“.

**Offen:**
- Sebastian Egger, 21.07.: „Liste Sonderdimensionen Hölzer“ wartet weiter auf die
  Besprechung (Liste fehlt).
- Die Erinnerungsfunktion (`erinnerungen`) schließt Angestellte nicht selbst aus.
  Das ist nicht mehr nötig, weil für sie keine Berichte mehr entstehen.

## 2026-09-29 · Wunsch von Johannes Maurer (Krankmeldung)

**Meldungen:** Die Krankmeldung erscheint nicht im Tätigkeitsbericht. Am Handy
„fliegt man aus dem Vorgang“, sobald ein Kamerafoto gemacht wird. Danach kann man
nichts mehr bearbeiten.

**Ursache:** Beim Zurückkommen aus der Kamera erneuert das Handy die Anmeldung.
Dabei hat die Seite „Mein Tag“ sich komplett neu aufgebaut (kurz „Lädt…“), und das
offene Krankmeldungs-Formular wurde geschlossen, bevor man einreichen konnte. Laut
Server-Protokoll kam am 29.09. um 08:08 vom Handy nie ein Speichervorgang an. Die
Krankmeldung gab es also noch gar nicht, deshalb war auch der Tätigkeitsbericht leer.
Die um 08:14 eingereichte Meldung (28.09., 2 Std. Zahnarzt) steht korrekt im Bericht.

**Geändert:**
- `AuthContext`: `user` und `profile` behalten beim Erneuern der Anmeldung dasselbe
  Objekt, wenn sich inhaltlich nichts ändert. So laden Seiten nicht mehr grundlos
  neu. Das gilt für die ganze App.
- `MeinTag`: „Lädt…“ erscheint nur beim ersten Laden. Neu geladen wird nur, wenn sich
  die Person oder die Partie ändert.
- Die Krankmeldung merkt sich den Entwurf (Datum, Stunden, Notiz) im Browser. Lädt
  das Handy die Seite beim Fotografieren doch komplett neu, öffnet sich das Formular
  wieder mit allen Angaben und dem Hinweis, das Foto noch einmal anzuhängen.
- **Neu: Krankmeldung bearbeiten** (Stift-Symbol in „Mein Tag“ → Krankmeldung):
  Datum, Stunden und Notiz lassen sich ändern und ein Foto nachreichen oder tauschen.
- Migration `20260929100000_krankmeldung_bearbeiten.sql` (**angewendet**):
  - Mitarbeiter dürfen die eigene Krankmeldung ändern.
  - Ändern sich Datum oder Stunden, bucht die Datenbank die Krank-Einträge im
    Tätigkeitsbericht um. Im zurückgerollten Test wurde aus 2 Std. richtig 3 Std.,
    die Arbeitsstunden blieben stehen.

**Offen:**
- Ganztägige Krankmeldungen überschreiben weiterhin nur Tage im Status „erfasst“.
  Das ist unverändert, aber aufgefallen.

## 2026-09-24 · Roboter · Wunsch von Jürgen Mainhard

**Meldung (Tätigkeitsbericht → Fahrtenbuch):** „Fahrtenbuch Eingabe Kennzeichen,
Abfahrt - Ankunft über google maps“

**Was geändert wurde** (freigegebener Vorschlag: kein Google, keine km-Berechnung,
Kennzeichen je Fahrt)

- **Kennzeichen je Fahrt:** neue Spalte „Kennzeichen“ in jeder Fahrt-Zeile. Beim
  Tippen werden die Kennzeichen aus der Fahrzeugliste vorgeschlagen, freie Eingabe
  bleibt möglich, es wird in Großbuchstaben gespeichert. Eine neue Fahrt übernimmt
  das Kennzeichen der vorigen Fahrt, sonst das Standard-Kennzeichen.
- **Standard-Kennzeichen im Kopf:** Das Feld hat jetzt einen Rahmen und den Hinweis
  „Kennzeichen eintragen“. Vorher sah man nicht, dass man dort tippen kann. Alte
  Fahrten ohne eigenes Kennzeichen zeigen es grau an, gespeichert wird bei ihnen
  nichts.
- **Abfahrt/Ankunft sind jetzt Orte** (neues Feld `OrtFeld.tsx`). Beim Tippen kommt
  eine Vorschlagsliste mit Firma, Baustellen mit Adresse, eigenen früheren Orten und
  der Adresssuche auf der Karte (OpenStreetMap über den Dienst Photon, kostenlos und
  ohne Konto). Freie Eingabe geht immer.
  - Die Abfahrt einer neuen Fahrt ist der Ankunftsort der vorigen Fahrt.
  - Ist die Ankunft eine Baustelle, wird deren Kostenstelle eingetragen, solange
    noch keine drinsteht.
  - Die Uhrzeit bleibt klein und freiwillig unter dem Ort.
  - Die km bleiben reine Tacho-Werte, es wird keine Strecke berechnet.
- **Frühere Orte** kommen auch aus alten Driversnote-Fahrten („Von – Nach“ im
  Reiseweg). Das dient nur als Vorschlag, die 144 bestehenden Fahrten bleiben
  unverändert.
- **PDF „Fahrtenbuch“:** neue Spalte Kennzeichen. Abfahrt/Ankunft zeigen Ort und
  eventuelle Uhrzeit. Im Kopf stehen alle Kennzeichen der Periode.
- **Driversnote-Import:** „Von“ geht jetzt in die Abfahrt, „Nach“ in die Ankunft,
  vorher stand beides im Reiseweg. Importierte Fahrten bekommen das
  Standard-Kennzeichen.
- Fahrten am selben Tag ohne Uhrzeit stehen jetzt fest in Eingabe-Reihenfolge. Die
  „vorige Fahrt“ ist damit immer die unterste Zeile.

**Datenbank:** Migration `20260924100000_fahrtenbuch_orte_kennzeichen.sql` bringt
drei freiwillige Textspalten in `fahrtenbuch_eintraege`: `kennzeichen`,
`abfahrt_ort`, `ankunft_ort`. Sie ist **noch nicht angewendet**. Rechte und
bestehende Daten bleiben unverändert, die Periodensperre gilt automatisch.

**Wichtig beim Ausrollen:** Erst die Migration anwenden, dann deployen. Sonst
scheitern „Fahrt hinzufügen“ und der Import, weil die neuen Spalten fehlen.

**Geprüft:**
- `npm run build` ist grün, TS2304-Prüfung ergibt 0.
- Die Kartensuche (Photon) wurde einmal direkt abgefragt und liefert passende
  Adressen.
- Die Playwright-Tests konnten hier nicht laufen: Dem Test-Browser fehlt die
  Systembibliothek `libnspr4`, und die installierte Browser-Version passt nicht.
- Ein Klicktest in der App war nicht möglich, weil keine Anmeldung auf echten
  Konten erlaubt ist.

**Offene Punkte**
1. **Firmenadresse:** Beide Adressen stehen als „Firma“ in der Auswahl:
   „Willroiderstraße 13, 9500 Villach“ (so auf den PDFs) und „Willroider-Allee 10,
   9580 St. Niklas an der Drau“ (so in 60 importierten Fahrten). Welche soll
   bleiben? Die Liste steht in `FIRMA_ORTE` in `FahrtenbuchTab.tsx`.
2. **Datenschutz:** Die getippten Adressen gehen an den freien OpenStreetMap-Dienst
   photon.komoot.io (komoot, Deutschland). Das ist ähnlich wie heute schon
   Nominatim beim Wetter.
