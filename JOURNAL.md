# Journal

## 2026-10-08 · Wünsche von Niklas Gwenger (Evaluierung löschen, Tablet-Unterschrift)

**1. „Wie kann ich eine falsche Evaluierung löschen?“**
- **Vorfall Painter Carport:** Um 06:20 wurde über die Tagesplanung („Standard-
  Unterweisung anlegen“) eine Baustellen-Unterweisung angelegt, um 06:21 über „Neue
  Evaluierung“ die richtige Tagesbaustelle. Beide Wege setzten
  `pflicht_evaluierung_id` direkt. Nur `unterweisung_setzen()` hätte die offenen
  Zuteilungen der alten archiviert. Jörg Hallegger, Noah Moser und Martin Tripolt
  hingen ab 08:00 an der falschen Unterweisung, die App war gesperrt.
- **Sofort:** Die 3 offenen Zuteilungen sind archiviert (Grund „durch neue
  Unterweisung ersetzt“). Die Evaluierung selbst blieb stehen, weil Christoph das
  Löschen in der Datenbank abgelehnt hat.
- **Damit es nicht wieder vorkommt:** Neuer gemeinsamer Weg
  `lib/pflichtUnterweisung.ts` → `setzePflichtUnterweisung()`. „Neue Evaluierung“ und
  „Standard-Unterweisung anlegen“ (Tagesplanung) archivieren damit beim Wechsel die
  offenen, nicht unterschriebenen Zuteilungen der vorigen Unterweisung. Unterschriften
  bleiben. Eine Datenbank-Regel (Trigger) dafür wurde vorgeschlagen, Christoph hat sie
  aber nicht eingespielt. Wer `pflicht_evaluierung_id` künftig an anderer Stelle setzt,
  muss diesen Weg nehmen.
- **Neu:** Auf der Seite Unterweisungen gibt es für Büro/Verwaltung einen Löschen-Knopf
  (Mülleimer) je Evaluierung. Bei vorhandenen Unterschriften kommt eine deutliche
  Warnung.

**2. „Bei den Partieführern geht die Evaluierung am Tablet nicht zum Unterschreiben …
lässt sich nicht bis zum Ende scrollen“**
- **Ursache:** Der Knopf „Gelesen und verstanden“ wurde nur durch ein Scroll-Ereignis
  am Ende frei. Die Tagesbaustellen-Unterweisung passt auf einem iPad komplett auf den
  Bildschirm, also kam nie ein Scroll-Ereignis und der Knopf blieb für immer grau. Im
  Test-Browser (iPad quer, nachgestellte Daten) so nachgestellt.
- **Behoben:** Gilt im Tablet-Modus (`UnterweisungTablet`) und beim eigenen Handy
  (`EvaluierungSignatureGate`).
  - Es wird auch ohne Scrollen und bei Größenänderung geprüft (ResizeObserver).
  - Die Lesebereiche haben `min-h-0`, damit sie in der Flex-Spalte auf iPad/Safari
    sicher scrollen.
  - Beim Wechsel zur nächsten Person wird zurückgesetzt.
- **Geprüft:** Bei der Tagesbaustelle ist der Knopf sofort aktiv. Bei Werkstatt (lang)
  ist er erst grau und nach dem Scrollen bis ans Ende aktiv.
- Den „Absturz“ selbst konnte ich nicht nachstellen. Der Screenshot zeigt nur die
  Liste am PC.

**Werkzeug:** Screenshots der Meldungen jetzt über
`~/Developer/_baukasten/werkzeuge/wunsch-bilder.mjs` (siehe Memory).

## 2026-10-08 · Wunsch von Niklas Gwenger (Firma mit Kostenstelle, Pflicht)

**Meldung:** „Baustelle-Firma: Wurde von mir falsch geschrieben. Beim Stunden schreiben
gibt es die Auswahl Baustelle und Firma. Bei Firma muss auch die Baustelle ausgewählt
werden können. Es dürfen keine Stunden geschrieben werden ohne eine Baustelle bzw.
Kostenstelle (außer Krank, Urlaub, Schlechtwetter). Auswählbar sein müssen auch
1404899 Zimmerei Allgemein (Schulungen etc.) und 4760 Woodwork sonstige Kosten
(Lagerarbeiten etc.).“

**Geändert:**
- Migration `20261008120000_interne_kostenstellen.sql` (**angewendet**):
  `baustellen.kategorie` kennt jetzt `intern`. Zwei neue Zeilen „Zimmerei Allgemein“
  (1404899) und „Woodwork sonstige Kosten“ (4760), Status aktiv.
- **Firma hat eine Kostenstelle:** Bei „Firma“ steht oben „Kostenstelle bzw. Baustelle
  wählen“. Zuerst kommen die beiden internen Kostenstellen, darunter alle Baustellen.
  Mehrere Kostenstellen am Tag gehen über „weitere Kostenstelle“. Bei „Baustelle“ gibt
  es die internen nicht (Firma heißt kein Taggeld).
- **Pflicht:** Arbeitsstunden (Baustelle/Firma) ohne Auswahl werden nicht gespeichert.
  In der Karte steht ein roter Hinweis, beim Speichern eine Meldung mit den Namen. Das
  gilt für Stunden, Tag bearbeiten (Bericht) und die Büro-Korrektur. Die Option „Keine
  Baustelle (allgemein in Firma)“ ist weg. Krank, Urlaub, Schlechtwetter und
  Berufsschule brauchen nichts.
- **Umschalter „Auf der Baustelle / In der Firma“ entfernt:** Er stammt aus Niklas'
  Wunsch vom 05.10., den er jetzt richtiggestellt hat. Benutzt wurde er nie: alle
  Zeilen stehen auf „baustelle“. Die Auswertung von `ort = firma` bleibt für den Fall
  bestehen, dass doch Daten kommen.
- **Berichte:** Im Baustellenstundenbericht (Seite und PDF) steht Firma mit Baustelle
  als „Baustelle (in der Firma)“ mit deren Kostenstelle. Interne Kostenstellen stehen
  unter ihrem Namen, zum Beispiel „Zimmerei Allgemein · 1404899“. Firma ohne
  Kostenstelle (alte Einträge) bleibt „Firma“. Die Baustellen-Seite und die
  Stundenauswertung zählen Firma-Stunden mit Baustelle auf diese Baustelle.
- **Tätigkeitsbericht (Angestellte):** Die internen Zeilen erscheinen nur, wenn darauf
  Stunden liegen, und nicht unter „Kostenstelle hinzufügen“. Dort gibt es schon
  „Zim Allgemein 4899“, sonst stünde es doppelt.
- Gespeichert wird `baustelle_id` jetzt auch bei Firma-Zeilen (Stunden, Tag bearbeiten,
  Büro-Korrektur). Vorher wurde es dort auf leer gesetzt.

**Bestand:** 316 alte Firma-Zeilen haben keine Kostenstelle. Sie bleiben, wie sie sind.
Erst wer einen solchen Tag bearbeitet, muss eine Kostenstelle wählen.

**Geprüft:** Build ok, Typprüfung ohne neue Fehler. Ein Klicktest in der App steht noch
aus, weil es hier keinen Testzugang gibt.

## 2026-10-08 · Zwei Wünsche von Bua Sirnitzer (Stunden schreiben als Polier)

**Meldung 1 (Fahrtgeld):** „Hier darf man nur Fahrtgeld auswählen dürfen. Kein
Taggeld. Das wird ja automatisch über die Stunden abgewickelt. Keine Geldangaben.
Unter der Fahrtgeld-Auswahl muss dann noch 0,5 Std, 1,0 Std und 1,5 Std auswählbar
sein.“

**Entscheidung Christoph:** Die Fahrtgeld-Stunden werden nur vermerkt (PDF,
Auswertung) und vom Lohnbüro abgerechnet. Sie zählen nicht zu den Arbeitsstunden.

**Geändert:**
- Migration `20261008100000_fahrtgeld_stunden.sql` (**angewendet**): neue Spalte
  `stunden_fahrt.fahrtgeld_stunden` (Standard 0). `fahrtgeld_eur` bleibt stehen,
  wird aber nicht mehr befüllt. Es stand in allen 230 Zeilen 0 und wurde nirgends
  ausgegeben.
- **Stunden:** Statt „Fahrtgeld & Taggeld (Polier)“ mit Euro-Feld und „Taggeld
  manuell überschreiben“ gibt es jetzt nur noch „Fahrtgeld (Polier)“ mit den Knöpfen
  Keins / 0,5 / 1,0 / 1,5 Std. Das Taggeld wird immer automatisch gerechnet.
- **Ausgabe:** Stundenzettel-PDF (Spalte Taggeld „FG 1,00 h“ + Summenzeile
  „Fahrtgeld“), Baustellenstundenbericht (Seite und PDF, Zeile „Zulagen etc.“),
  Stundenauswertung (Karte „Fahrtgeld (Polier)“ + CSV-Spalte „Fahrtgeld (h)“).
- Die anderen Masken (Tätigkeitsbericht, Halle, Tag bearbeiten, Büro-Korrektur)
  übernehmen den gespeicherten Wert beim Speichern.

**Meldung 2 (alle Mitarbeiter):** „Hier muss der Polier alle Mitarbeiter auswählen
können. Wenn jemand krank ist und/oder bei einem anderen Polier ist, sollte der
Polier diesen auswählen können und nicht wir im Büro die ganze Partie-Einteilung
ändern müssen.“

**Ursache:** Seit 18.09. sieht ein Polier nur die Tage seiner Partie und seiner
Einteilung (Urlaub/Krank verborgen). Deshalb bekam er auch nur seine Partie zur
Auswahl. Bei Leuten außerhalb wäre sonst das Speichern gescheitert.

**Geändert:**
- Migration `20261008110000_polier_alle_mitarbeiter.sql` (**angewendet**):
  - `stunden_tage_select` zusätzlich `erfasst_von = auth.uid()`. Wer einen Tag für
    jemanden erfasst hat, darf ihn wieder lesen. Ohne das scheiterte schon das
    Speichern (`insert … returning`).
  - Neue Funktion `stunden_tag_vorhanden(datum, ids)`: Sie sagt nur Ja/Nein, ob es
    den Tag schon gibt, ohne Stunden und ohne Art. Nur für Leute mit „für andere
    erfassen“, Partieleiter oder Verwaltung.
  - Die Richtlinie ließ sich über `apply_migration` nicht setzen (Zeitüberschreitung),
    sie ist per `alter policy` mit demselben Inhalt eingespielt.
- **Stunden:** Wer „für andere erfassen“ hat, bekommt alle aktiven Mitarbeiter zur
  Auswahl, nach Partie gruppiert, die eigene Partie oben. „Ganze Partie“ gibt es
  jetzt auch dort, „Alle“ nur noch fürs Büro (ohne eigene Partie).
- Hat jemand aus einer anderen Partie schon einen Tag, steht in der Auswahl
  „erfasst“ und im gelben Hinweis „schon erfasst (wird nicht überschrieben)“. Beim
  Speichern wird die Person übersprungen, Änderungen gehen übers Büro.

**Geprüft:** Build ok, Typprüfung ohne neue Fehler. In der Datenbank als Bua
nachgestellt (Transaktion, zurückgerollt): Am 07.10. sieht er 2 Tage im Detail, die
Funktion meldet 18 vorhandene Tage. Ein normaler Mitarbeiter bekommt von der
Funktion nichts. Ein Klicktest in der App steht noch aus, weil es in dieser
Umgebung keinen Testzugang gibt.

## 2026-10-07 · Wunsch von Elias Winkler (Tätigkeitsberichte erst ab dem 21. zur Freigabe)

**Meldung:** „Die Tätigkeitsberichte sollten gesammelt am 21. des Monats zur Freigabe
an die Geschäftsführung gesendet werden, auch wenn sie schon früher unterschrieben
wurden. Ich habe zum Probieren eine Unterschrift gesetzt und nun leuchtet das bei
Hannes immer am Dashboard auf.“

**Ursache:** Jede Unterschrift mit Status „unterschrieben“ zählte sofort als „wartet
auf Freigabe“, auch für die laufende Periode. Elias hat die Periode September–Oktober
(endet 20.10.) schon am 23.09. unterschrieben.

**Geändert:** Neue Regel `freigabeFaellig(jahr, monat, heute)` in
`lib/taetigkeitsbericht.ts`: Zur Freigabe geht eine Periode erst nach ihrem Ende, also
ab dem 21.
- **Startseite:** Die Karte „N Tätigkeitsberichte warten auf Freigabe“ zählt nur
  abgelaufene Perioden.
- **Freigabe-Liste:** Bei früh Unterschriebenem steht
  „Unterschrieben · Freigabe ab 21.10.“, ohne Freigeben-Knopf. Der Hinweis „aus
  anderen Perioden“ zeigt nur fällige Berichte.
- **Bericht:** Dort steht „geht am 21.10. gesammelt zur Freigabe an die
  Geschäftsführung. Bis dahin kannst du noch ändern und neu unterschreiben.“ Der
  Freigeben-Knopf erscheint erst ab dem 21.
- **Erinnerung `erinnerungen` (Version 4, hochgeladen):** Die tägliche Nachricht
  „tb_freigabe“ zählt nur fällige Berichte. Ein Probelauf über `net.http_post` mit
  `probe: true` lieferte 200 und hat nichts verschickt.

**Stand jetzt:** Einzige offene Unterschrift ist Elias, Periode Oktober, nicht fällig.
Bei Hannes ist die Karte also weg, ab dem 21.10. erscheint sie wieder.

## 2026-10-05 · Wunsch von Niklas Gwenger (Baustelle oder Firma)

**Meldung (Baustellenstundenbericht):** „Auf den Berichten muss ersichtlich sein, ob
der Mitarbeiter auf der Baustelle war oder in der Firma … Sollte man beim Stunden
schreiben auswählen können.“

**Entscheidung Christoph:** Der Ort wird je Zeile gewählt, Stunden „In der Firma“
geben kein Taggeld.

**Geändert:**
- Migration `20261005100000_stunden_ort.sql` (**angewendet**):
  - Neue Spalte `stunden_taetigkeiten.ort` (`baustelle` | `firma`, Standard
    `baustelle`). Alle 1778 bestehenden Zeilen stehen auf „baustelle“, rückwirkend
    ändert sich nichts.
  - Der Bericht-Schnappschuss (`stunden_bericht_erzeugen`) nimmt den Ort mit.
- **Stunden und Tag bearbeiten:** Jede Baustellen-Zeile hat den Umschalter „Auf der
  Baustelle / In der Firma“. Werk/Halle haben keinen, die sind ohnehin Firma.
- **Taggeld:** Firma-Zeilen zählen nicht, sowohl beim automatischen Taggeld beim
  Speichern als auch in `taggeldFuerTag` (Stundenauswertung, Stundenzettel).
- **Bericht und PDF:** Firma-Stunden stehen in einer eigenen Zeile, zum Beispiel
  „HMH Skrube (in der Firma)“. Die Änderungsmarkierung (gelb) erkennt einen
  Wechsel Baustelle ↔ Firma. Altberichte ohne Ort werden nicht gelb.
- **Speichern:** Masken ohne Umschalter (Tätigkeitsbericht, Halle, Büro-Korrektur)
  übernehmen den bisherigen Ort jeder Zeile. Sonst fiele „Firma“ beim nächsten
  Speichern still auf „Baustelle“ zurück.
- Nebenbei: „Tag bearbeiten“ verlor beim Speichern die Ziel-Baustelle von
  Werk-Stunden. Das ist behoben.

**Geprüft:** im Test-Browser (Handy-Breite, nachgestellte Daten, Service Worker
blockiert, kein echter Server).
- „In der Firma“ + Baustelle + 8 Std. → gespeichert `ort: "firma"`, kein Taggeld.
- Gegenprobe „Auf der Baustelle“ → `ort: "baustelle"`, 1× Taggeld kurz.

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
