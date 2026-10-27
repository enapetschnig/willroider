# Journal

## 2026-10-27 · Tagesplan am Handy

- **J. Maurer, „Tagesplangröße an Handyformat anpassen, nur am Handy“:** `TagesplanPreview`
  zeigt unter `sm` (< 640 px) eine Karte je Baustelle untereinander statt der 4-spaltigen
  Tabelle. Jede Karte enthält BVH + KS, Fahrzeug, Tätigkeit und die Mitarbeiter. Die
  Sonderfälle stehen untereinander. Ab Tablet/PC bleibt das Word-Layout unverändert. Die
  Dialoge in Dashboard/MeinTag sind am Handy fast bildschirmbreit und haben weniger Rand.

## 2026-10-23 · Stundenbericht: Bestätigen/Senden getrennt, Prüf-Reihe über alle Monate, Fahrgeld/Zulagen je Tag

- **J. Maurer, „Bestätigen und ans Büro senden trennen“:**
  - Zwei Knöpfe: „Bestätigen“ (nur Status `bestaetigt`) und „Ans Büro senden“ (bei
    unterschriebenen Berichten wie bisher mit Bestätigung).
  - Die RPC `stunden_bericht_bestaetigen(p_id, p_unterschrift)` speichert jetzt die
    Büro-Unterschrift. Sie kommt beim späteren Versand ins PDF.
  - Die Büro-Unterschrift gilt nach dem ersten Mal für weitere Bestätigungen im selben Tab
    (Modul-Variable, nicht gespeichert).
- **J. Maurer, „nacheinander prüfen – da hakt es“:**
  - Die Reihe lief nur innerhalb einer Periode und stand am Ende still, z. B. Aug T II
    „1/2“ statt aller Wartenden.
  - Jetzt ist standardmäßig „Alle wartenden (alle Monate)“ eingestellt: älteste Periode
    zuerst, darin alphabetisch. Wählbar sind auch „Wartende dieser Periode“ und „Alle dieser
    Periode“. Die Liste setzt die Wahl passend zum Filter.
  - Statt „Passt/Vormerken“: „Bestätigen — weiter“ springt zum Nächsten. „Bestätigte ans
    Büro senden (n)“ schickt alle bestätigten Berichte der Reihe in einer Mail.
- **J. Maurer, „Fahrgeld als Tabellenzeile je Tag, auch Zulagen“:** `zusatzZeilenJeTag` in
  `stundenAggregation.ts`. Unter der Summe stehen Zeilen für Fahrgeld und jede Zulage mit
  Stunden je Tag und Summe. Das gilt am Bildschirm und im PDF. Die Textzeile „Zulagen etc.“
  entfällt dann. Eine Zulage ohne Stunden zeigt ✓ am Bildschirm und „x“ im PDF.
  Krankheit/Schlechtwetter stehen wie bisher als eigene Zeilen (K/SW).

## 2026-10-22 · Nachprüfung der drei Wünsche

- Nachgerechnet:
  - Tätigkeitsbericht-Summen mit dem echten Code (esbuild-Bündel): Köstenberger Aug–Sep
    29 h, ohne eigenes Soll 161 h.
  - `soll_woche_von` als `authenticated` liefert ihr Muster, sonst `null`.
  - `tages_soll` nutzt nur `stunden_tag_recompute`.
  - Der `has_permission`-Parameter heißt `_schluessel`, Johannes ist Admin.
- Korrekturen:
  - „Passt — weiter“ auch bei Berichten, die schon bestätigt, aber noch nicht versendet sind.
  - Wochen-Soll für eine Person ohne Einstellungs-Zeile: Das Modell kommt aus dem
    Zeiterfassungs-Typ, nicht vom Standard „zimmerei_sommer“.

## 2026-10-22 · Stundenberichte nacheinander prüfen, erinnern, Download; Wochen-Soll je Person

- **J. Maurer, „alle nacheinander alphabetisch prüfen, danach versenden, Download bei beiden“:**
  - Stundenbericht: Prüf-Leiste mit ‹ ›, Auswahl „3/25 · Name — Stand“ und dem Haken
    „nur Wartet auf Büro“. Sie läuft alphabetisch durch alle Berichte derselben Periode und
    springt mit `replace`, „Zurück“ führt also direkt in die Liste.
  - „Passt — weiter“ merkt den Bericht vor (sessionStorage `bsb-vorgemerkt`) und öffnet den
    nächsten. „Vorgemerkte bestätigen & senden (n)“ braucht eine Unterschrift und schickt
    eine Mail mit allen (BsbVersendenDialog mit mehreren IDs).
  - Liste: „Nacheinander prüfen“ in der Periode und im Block der offenen Berichte (startet
    beim ersten Wartenden alphabetisch), „Alle herunterladen (ZIP)“, „Herunterladen“ bei
    den markierten und oben „Gesammelt versenden / Download“ ins Berichte-Archiv (mit `teil`).
  - Stundenbericht: neuer Knopf „PDF herunterladen“ (vorher nur „ansehen“).
  - Berichte-Archiv: „Herunterladen (ZIP)“ für die markierten, gilt für beide Arten
    (`lib/zipDownload.ts`, jszip jetzt direkte Abhängigkeit).
  - Tätigkeitsbericht: ‹ › neben der Personenauswahl.
- **J. Maurer, „Mitarbeiter mit einer Nachricht nochmals erinnern“:**
  `StundenberichtErinnernDialog`. Je Person geht eine Nachricht mit allen offenen Perioden
  raus, dazu ein eigener Zusatz. Erreichbar über die Glocke je Zeile, „Alle n erinnern“ und
  im Bericht. Angezeigt wird „erinnert am“ aus `benachrichtigungen_log`
  (`bsb_unterschrift`/`bsb_erinnerung`).
  - `push-senden` hat neu `sms_ersatz`: ohne Push-Gerät geht eine SMS über Twilio
    (`sendeSms` in `_shared/sms.ts`). Nur 9 von 33 Leuten haben Push, 25 nur eine
    Platzhalter-Mail.
  - Mail-Ersatz überspringt `@….invalid`.
  - Erinnern dürfen außer Admins auch Leute mit `stunden.bsb.bestaetigen`.
  - Getestet ohne echten Versand (unbekannte ID → „keiner“).
- **J. Maurer, Köstenberger geringfügig, „andere Sollstunden“:**
  - Neue Spalte `profile_konten_settings.soll_woche` = `{woche:[Mo..So], gerade_kw?:[…]}`.
    Sie geht dem Arbeitszeit-Modell vor und gilt absolut, ohne Beschäftigungsgrad.
  - Gepflegt wird sie in Verwaltung → Arbeitszeit, Spalte „Eigenes Wochen-Soll“.
  - Wirkt im Tätigkeitsbericht (RPC `soll_woche_von`, auch für Freigeber ohne
    Admin-Recht), in `tagesSoll`/`periodeSoll`, in den Soll-Hooks, in MeineStunden, in der
    Stundenauswertung und in SQL `tages_soll`.
  - Köstenberger laut Muster: Mo–Mi 2 h, Do 1 h (ungerade KW) bzw. 1,5 h (gerade KW),
    ergibt 29 h für Aug–Sep, wie im Muster.
  - Nebenbei: `tages_soll` kennt jetzt das Modell `angestellter` (8,5/5). Vorher fiel es auf
    den Arbeiter-Kalender, ein Urlaubstag zog im Sommer nur 0,94 Tage ab.
  - In der Modell-Auswahl fehlte „Angestellter“, jetzt ist es drin.

## 2026-10-21 · Baustellenmeldung (Teams, PLZ, gleiche Adresse, Kostenstelle) und Partie im Bericht

- **J. Maurer, Empfänger „Leistungsstand“:** Die Teams-Adresse
  `582a7247.willroider.at@emea.teams.ms` ist ein fester Empfänger mit dem Namen
  „Leistungsstand (Teams)“. Bei Planung (1404895) und den Sammel-Kostenstellen
  1404020–1404070 ist nur Teams angehakt, sonst Teams, Schneider und Maurer. Schneider und
  Maurer bleiben immer zum Anhaken da. Vorher bekam die Planung gar nichts und die
  Sammel-Kostenstellen nur Maurer.
- **J. Maurer, Baustellenmeldung:**
  - Ort aus der PLZ (`lib/plzOrt.ts`): zuerst Orte, die in der App zu dieser PLZ schon
    stehen (die häufigsten zuerst), dann zippopotam.us. Ist das Feld leer, wird der erste
    Ort eingetragen, die anderen stehen als Vorschlag im Feld. Ein automatisch
    eingetragener Ort wird bei neuer PLZ ersetzt, ein von Hand getippter nicht.
  - Haken „Gleich wie Wohnanschrift Bauherr“: Solange er gesetzt ist, übernimmt die
    Baustellenanschrift Straße, PLZ und Ort vom Bauherrn.
  - Knopf „Nächste eigene: …“: höchste Kostenstelle `^1404[0-7]\d\d$` ohne die
    Sammel-Kostenstellen plus 1. Stand jetzt ist das 1404557. Interne Nummern wie 14048xx
    (Planung, Zimmerei Allgemein) zählen nicht.
- **D. Tauchhammer, Bericht „Partie auswählen“:** Beim Hinzufügen gibt es jetzt die Gruppe
  „Ganze Partie“. Sie fügt alle aktiven Mitglieder der Partie samt Partieleiter ein, die
  noch nicht im Bericht stehen. Bei jeder Partie steht dabei, wie viele noch fehlen.

## 2026-10-21 · Vier Wünsche: Fahrtenbuch, Stundenberichte, Archiv-Versand

- **E. Egger, „neue Fahrt landet oben“:** Am 21. (nach der Periode) bekam eine neue Fahrt
  den Periodenstart (21.) als Datum. Jetzt das Periodenende. Außerdem stehen Fahrten ohne
  Uhrzeit innerhalb eines Tages nach denen mit Uhrzeit (`nullsFirst: false`), also unten.
- **J. Maurer, Stundenberichte „Monatsauswahl“:** Die Auswahl gab es, sie stand aber unter
  129 offenen Berichten. Monat/Teil steht jetzt oben. Die offenen Berichte lassen sich
  nach Monat/Teil (Knöpfe mit Anzahl) und „Wartet auf Büro / Mitarbeiter unterschreibt
  noch“ filtern und sind auf 15 Zeilen eingeklappt.
- **J. Maurer, Tätigkeitsberichte „gesammelt per PDF senden“:** Das Archiv kann das schon
  (er hat es selbst bemerkt). Auf „Tätigkeitsberichte freigeben“ gibt es jetzt den Knopf
  „Gesammelt versenden“. Er öffnet das Berichte-Archiv mit derselben Periode, das Archiv
  liest dafür `?art&jahr&monat`.
- **J. Maurer, Archiv-Versand „Kilometerberichte und Krankmeldungen mitschicken“:**
  - Im Versenden-Dialog „Mitschicken“ mit „Kilometerberichte (Fahrtenbuch)“ und
    „Krankmeldungen“, beide standardmäßig an.
  - Fahrtenbuch-PDF je gewähltem Tätigkeitsbericht im Browser (`makeFahrtenbuchPdf`,
    wie beim Drucken), als `extra_anhaenge` übergeben.
  - `archiv-versenden` hängt die Krankmeldungen mit Datei (`ma_dokumente`) an, die in die
    Periode fallen: Tätigkeitsbericht 21.–20., Stundenbericht Teil I/II. Jede nur einmal.
    Bei Übergröße als Link.
  - Per SQL nachgestellt: Sebastian Egger Sept–Okt ergibt seine Krankmeldung
    30.09.–02.10.

## 2026-10-20 · Leasing Personal (Kundenmail)

- **Wunsch:** In „Mitarbeiter & Partien“ ein Reiter „Leasing Personal“. Die Leute sollen
  einteilbar und Partien zuteilbar sein, der Polier schreibt ihre Stunden. Kein Zugang
  zur App.
- **Christophs Vorgaben:** Kein Stundenbericht. Prüfung in der Stundenauswertung,
  Leasing-Firma optional.
- **Datenbank** (`20261020100000_leasing_personal.sql`, eingespielt):
  - `zeiterfassung_typ` erlaubt jetzt 'leasing'. Neue Spalte `profiles.leasing_firma`.
  - `stunden_bericht_erzeugen` nimmt Leasing aus.
  - `registrierung_pruefen` meldet bei Leasing „im Büro melden“.
- **admin-create-employee** (`leasing: true`):
  - Platzhalter-Adresse `leasing-…@willroider.invalid` und ein zufälliges 48-stelliges
    Passwort.
  - Keine Einladung, Telefon nur im Profil (nicht am Anmeldekonto).
  - Rolle immer Mitarbeiter, kein Urlaubsanspruch, Doppelt-Schutz über den Namen.
- **App:**
  - Reiter „Leasing Personal (n)“ (`LeasingPersonalTab`): Liste nach Firma, Partie-Auswahl,
    Bearbeiten, Archivieren nur mit `mitarbeiter.edit`, „Neues Leasing Personal“.
  - Die Mitarbeiter-Liste zeigt kein Leasing mehr.
  - Bearbeiten-Dialog: dritte Art „Leasing Personal“ plus Feld Leasing-Firma. Vorher wäre
    beim Speichern alles außer „angestellter“ zu „bauarbeiter“ geworden.
  - Aus Zugang senden, Urlaubs-Konten, ZA-Konten und Lohnzettel herausgenommen.
  - Stundenauswertung: Filter „Personal: Eigenes / Leasing“ mit Summe der gearbeiteten
    Stunden je Leasing-Firma. Leasing-Zeilen zeigen bei Soll und Differenz „—“.
  - „Zusammenführen“ gibt Leasing nie eine Anmelde-E-Mail.
- **Automatisch ohne Änderung:** Tagesplanung, Arbeitsplanung, Partien und Stunden durch
  den Polier laufen über dieselben Profilfelder.
- **Nicht getestet:** Das Anlegen über die Funktion selbst (braucht einen angemeldeten
  Admin). DB-Teil geprüft: Check-Regel, Spalte und leere E-Mail per zurückgerolltem
  Update.

## 2026-10-20 · Neue Ordnerstruktur für alle Bauleiter freigeschaltet

- **Anlass:** Sebastian Egger (Mail): „Jetzt passt alles super. Ist das für die anderen
  auch schon so eingerichtet? Wenn nein, für alle freischalten.“ Christoph hat zugestimmt.
- **Umsetzung:** `app_settings.sharepoint_neue_struktur` =
  `{ alle: true, ab: "2026-10-20" }`. Alle 6 aktiven Bauleiter haben ein Team.
  Für sie gilt jetzt dasselbe wie für Sebastian:
  - Ordner „<KS> <BVH>“ nach Vorlage mit ausgefüllter Materialliste
  - Berichte und Evaluierungen als PDF in 00-Baustelle
  - Baustellenanlage als PDF
- **„ab“ = 20.10.:** Baustellen, die andere vor heute angelegt haben, bekommen keinen
  nachträglichen Auftrag und damit keinen zweiten Ordner.
- **Getestet (zurückgerollt):** Neue Ausführung von Maurer bzw. Eckart Egger ergibt je 1
  Auftrag, eine Planung keinen.
- **Hinweis für die Bauleiter:** Ordner für neue Baustellen nicht mehr selbst anlegen. Ein
  von Hand angelegter Ordner wird nur verknüpft, wenn sein Name mit genau der
  Kostenstelle beginnt.

## 2026-10-19 · Doppelkonto Fischer zusammengeführt, Knopf „Zusammenführen“

- **Christoph:** „Welches ist aktiv, kann man das nicht zusammenführen?“
- **Aktiv:** „Matthias Franz Fischer“, Pers.-Nr. 512, angelegt 25.06., Handy-Login, heute
  10:18 angemeldet, 85 Stundentage, Partie Hallegger. Das Doppel „Matthias Fischer“
  (matthias.fischer@outlook.at, 16.10.) war nie freigeschaltet und hatte keine Daten.
- **Zusammengeführt:**
  - Schutzregeln geprüft und Doppel gelöscht.
  - Beim aktiven Konto die E-Mail über die Admin-Schnittstelle als Anmeldung eingetragen
    (`email_confirm`, die Identität ist mitgezogen). Profil-Adresse ebenso.
  - Handynummer und Passwort unverändert. Für die E-Mail-Anmeldung einmal „Passwort
    vergessen?“, oder er bleibt bei der SMS.
- **Mitarbeiterliste:** Aus „Doppelte Anmeldung löschen“ wird „Zusammenführen“.
  Doppel entfernen (`doppelte_anmeldung_entfernen`), dann bei Platzhalter-Adresse
  (`…@willroider.invalid`) die neue E-Mail über `admin-update-email` als Anmeldung
  eintragen.

## 2026-10-19 · Doppelte Registrierungen verhindern (Johannes Maurer)

- **Wunsch:** „Kann das sein, wenn sich einer falsch anmeldet, dass sich dann ein
  Mitarbeiter anlegt? Falls ja, ausschalten bzw. so machen, dass kein Problem entsteht.“
- **Befund:**
  - Eine falsche ANMELDUNG legt nie ein Konto an (SMS mit `shouldCreateUser: false`, ein
    falsches Passwort scheitert einfach).
  - Neu entsteht nur etwas über „Registrieren“. Fischer (angelegt mit Handynummer) hat
    sich am 16.10. mit E-Mail neu registriert.
  - Die „Ohne Namen“-Anmeldung (abbund@) war bereits bereinigt; abbund ist jetzt ein
    aktives, von Hand angelegtes Konto.
- **Umsetzung** (`20261019130000_doppelte_registrierung.sql`, eingespielt):
  - `registrierung_pruefen(vorname, nachname)`, auch ohne Anmeldung aufrufbar. Liefert
    nur „schon angelegt“ und die Art der Anmeldung (telefon/email), keine Daten. Das
    Formular ruft sie vor `signUp` auf und schickt die Person zur richtigen Anmeldung.
  - Falsches E-Mail-Passwort: Hinweis „Bist du mit deiner Handynummer angelegt? … bitte
    nicht neu registrieren“.
  - `doppelte_anmeldung_entfernen(id)`: nur mit `mitarbeiter.edit`, nur für nie
    freigeschaltete Konten ohne Stunden, Dokumente oder Unterschriften. In der
    Mitarbeiterliste steht beim Doppelt-Hinweis „Doppelte Anmeldung löschen“, und
    „Freischalten“ fragt bei Doppelten nach.
  - Getestet (zurückgerollt): Prüfung als anon, Fischer gibt „telefon“; Löschen als Büro
    abgelehnt; Löschen des echten, aktiven Fischer abgelehnt; Löschen der
    Doppel-Anmeldung als Maurer geht, das Original bleibt aktiv.
- **Fischer selbst:** Die Doppel-Anmeldung ist NICHT gelöscht. Das macht Johannes mit dem
  neuen Knopf, oder Christoph gibt es frei.

## 2026-10-19 · Neue Baustelle → Ordner: so, dass es immer funktioniert (Christoph)

- **Vorgabe:** „Ich will, dass das immer funktioniert.“
- **1. Kein Raten mehr bei der neuen Struktur** (sharepoint-schreiben):
  - Verknüpft wird nur ein freier Ordner im Bauleiter-Team, der mit GENAU der
    Kostenstelle beginnt, also ein halb fertiges Anlegen oder ein von Hand angelegter.
  - Sonst wird immer neu angelegt. Es gibt keine Ähnlichkeitssuche und keinen
    Vorschlag, der das Anlegen blockiert.
  - Hat ein von Hand angelegter Ordner `00-Baustelle`, gilt er als neue Struktur.
- **2. Unabhängig vom Browser:**
  - Trigger `baustellen_sharepoint_auftrag` (Insert bzw. Wechsel des Bauleiters): Für
    Ausführungen von Bauleitern mit neuer Struktur, angelegt ab 15.10., entsteht ein
    Auftrag in `sharepoint_auftraege`.
  - Zeitplan `sharepoint-auftraege` (alle 5 Min, versetzt): Er arbeitet Aufträge ab, die
    älter als 2 Minuten sind, damit der Formular-Aufruf nicht doppelt läuft. Dann
    spiegelt er sofort und lädt hoch. Bis zu 6 Versuche, danach Status „fehler“.
  - Getestet:
    - Trigger in einer Transaktion: Sebastian ergibt 1 Auftrag, Maurer und Planung 0.
    - Abarbeiter echt: „Egger Test 2“ gelöst und neu beauftragt. Er fand
      „1404050-2606 Egger Test 2“ über die exakte Kostenstelle, legte keinen zweiten
      Ordner an, verknüpfte, setzte die Struktur, spiegelte und markierte erledigt.
- **3. Kein stiller Fehler:**
  - `SharePointFehlerHintCard` im Dashboard für den Bauleiter der Baustelle und für
    Admins, mit Weg in den Reiter „Team“.
- **4. Selbstheilung Nachweise:** Beim Öffnen einer Baustelle mit neuer Struktur wird
  für jede vollständig unterschriebene Evaluierung ein fehlender Nachweis nachgeholt.
- **Bleibt:** Das Graph-Client-Geheimnis läuft am 13.03.2027 ab. Danach scheitert jeder
  SharePoint-Zugriff, der Hinweis im Dashboard würde das zeigen.

## 2026-10-19 · Absturz Verwaltung → Mitarbeiter (Johannes Maurer)

- **Fehler:** „ReferenceError: Cannot access 'de' before initialization … at Array.filter“
  beim Öffnen von Mitarbeiter & Partien.
- **Ursache:** Meine Änderung von heute (Doppelkonto/„nur neue Anmeldungen“).
  `listeProfiles = profiles.filter(… zeigeArchiv … nurNeue …)` stand direkt unter
  `profiles`, aber vor `zeigeArchiv`/`nurNeue`. `filter` läuft beim Rendern sofort, das
  ergibt einen Zugriff auf eine noch nicht angelegte Variable. TypeScript meldet das nicht,
  weil der Zugriff in einer Pfeilfunktion steckt.
- **Behoben:** Berechnung nach die beiden States verschoben.
- **Gegenprobe:** Alle heute geänderten Dateien mit `no-use-before-define` geprüft (ESLint
  über die API, nur diese Regel), ohne weitere Treffer im Render-Pfad. Die übrigen
  Meldungen in Arbeitsplanung/Jahresplanung/Dokumente liegen in Klick-Handlern und sind
  älter.

## 2026-10-19 · Fehler: neue Baustelle mit fremdem Ordner verknüpft (S. Egger)

- **Meldung per Mail:** „In der App steht OneDrive verknüpft, aber in meinem Ordner sehe
  ich das Bauvorhaben nicht.“
- **Ursache:** „Egger Test 2“ (1404050-2606) wurde nicht angelegt, sondern mit dem Ordner
  „1404050-2605 Egger Test“ vom 16.10. verknüpft. Die Ähnlichkeitssuche fand beide
  Wörter, und 1404050 ist eine Sammelkostenstelle.
- **Behoben (sharepoint-schreiben):**
  - Ein Ordner mit einer anderen vollständigen Kostenstelle im Namen zählt nie als
    Treffer.
  - Ordner, die schon an einer anderen Baustelle hängen, werden nie automatisch
    verknüpft.
- **Daten:**
  - „Egger Test 2“ ist gelöst, der Ordner „1404050-2606 Egger Test 2“ wurde neu angelegt
    (26 Ordner, 4 Dateien, Materialliste) und die Baustellenanlage als PDF hochgeladen.
  - „Egger Test“ hat nachträglich `sharepoint_struktur = 'bvh-neu'`.
  - Im Ordner „1404050-2605 Egger Test/01-Baustellenmanagement“ liegt die falsch
    abgelegte „1404050-2606 Baustellenanlage 2026-10-19.pdf“. Die muss jemand von Hand
    löschen.

## 2026-10-19 · Hinweise nur für die Zuständigen (Elias Winkler)

- **Wunsch 1:** Das Büro hat das Recht für Stundenberichte nicht mehr, sah aber weiter
  „Stundenberichte warten auf Kontrolle“. Neue Anmeldungen sollen nur Admins (Maurer,
  Pließnig) sehen und freischalten.
  - Dashboard-Hinweis Stundenbericht jetzt an `stunden.bsb.bestaetigen` gebunden. Die
    Push-Erinnerung prüfte das schon.
  - Anmelde-Hinweis und Freischalten/Archivieren an `mitarbeiter.edit` gebunden (Maurer
    und Pließnig ja, Büro nein).
  - Datenbank: Trigger `profiles_freischalten_pruefen` lässt `is_active` /
    `je_freigeschaltet` nur mit diesem Recht ändern (oder serverseitig ohne Benutzer).
    Getestet: Büro abgelehnt, Maurer erlaubt (zurückgerollt).
  - Der weiter angezeigte „Fischer“ ist das Doppelkonto (siehe unten).
- **Wunsch 2:** Die Erinnerung „Bericht wartet auf Freigabe“ bekommt nur der Bauleiter
  der Baustelle (`baustellen.bauleiter_id`). Ansehen und freigeben kann weiter jeder
  Bauleiter jeden Bericht.

## 2026-10-19 · Tagesplan für alle, Zulagen für alle (Elias Winkler)

- **Wunsch (sofort):** Jeder soll den kompletten Tagesplan sehen, nicht nur die eigenen
  Baustellen. Alle Mitarbeiter sollen Zulagen eintragen können, auch in der
  „Admin-Freigabeliste“.
- **Tagesplan** (`20261019100000_tagesplan_fuer_alle.sql`, eingespielt):
  - Ist ein Tag freigegeben (`tagesplanung_freigaben.freigegeben_am`), darf jeder
    Angemeldete dessen Einteilungen lesen: `darf_einteilung_sehen` und
    `einteilung_ma_select`.
  - Neu `tagesplan_abwesende(datum)` (security definer): Abwesende wie am Aushang, ohne
    dass Mitarbeiter fremde Stunden oder Anträge lesen dürfen. `useTagesplanung` führt
    das zusammen.
  - Als normaler Mitarbeiter simuliert: 19.10. mit 8 Baustellen, 31 Leuten und 4
    Abwesenden sichtbar.
  - Mein Tag: „Ganzen Tagesplan ansehen“ auch ohne eigene Einteilung.
- **Zulagen:**
  - Nur 4 von 48 Mitarbeitern hatten Zulagen zugeteilt, alle anderen sahen den Bereich
    nicht. Jetzt gilt: keine Zuteilung = alle aktiven Zulagen. Eine bewusste Zuteilung
    bleibt bestehen (eigene Erfassung, Mehrfach-Erfassung, Speichern).
  - `TagBearbeitenDialog` (Tag bearbeiten im Baustellenstundenbericht): Zulagen lassen
    sich antippen und mit Stunden versehen.

## 2026-10-19 · Dashboard: direkt dorthin, wo etwas zu tun ist (Johannes Maurer)

- **Wunsch:** „Fischer ist freigeschaltet, steht aber noch da … im Dashboard muss ich
  danach immer noch suchen, besser nur zu denen, wo es ein Problem gibt bzw. eine
  Freigabe erfordert.“
- **Fischer:**
  - Das ist ein Doppelkonto. „Matthias Franz Fischer“ (aktiv seit Juni, Anmeldung per
    Telefonnummer, nie eingeloggt) hat sich am 16.10. zusätzlich mit
    matthias.fischer@outlook.at registriert.
  - Neu `lib/doppelkonto.ts`: Dashboard und Mitarbeiter-Seite zeigen bei solchen
    Anmeldungen „gibt es schon als …“.
- **Ziele der Hinweise:**
  - Anmeldungen → `/mitarbeiter?neu=1` (nur neue Anmeldungen, im Archiv).
  - Berichte: bei einem direkt in den Bericht, sonst Liste mit Status, Art und ab dem
    ältesten Datum.
  - Stundenbericht: bei einem direkt hinein.
  - Unterweisungen: eine Baustelle → direkt in deren Reiter Unterweisung. Die
    Baustellen-Chips sind anklickbar.
  - Urlaub zeigte die offenen Anträge schon oben.

## 2026-10-19 · Mein Tag: Stunden mit Baustelle und „Ändern“ (Bua Sirnitzer)

- **Wunsch:** „Übersicht der Stunden sollte besser dargestellt sein mit Baustellen-Name.
  Es sollte auch hier eine Funktion zum Ändern geben.“ Auf dem Screenshot war die
  Kopfzeile der Karte am Handy zerquetscht, die Zeilen zeigten nur „Baustelle“.
- **Umsetzung:**
  - `MeineStundenListe` zeigt je Tag eine zweite Zeile mit den Baustellennamen
    (sonst Firma/Urlaub …). Das gilt auf Mein Tag und in der Stundenerfassung.
  - Knopf „Ändern“ bei eigenen Tagen, solange das Büro sie nicht freigegeben hat.
    Er führt auf `/stunden?datum=JJJJ-MM-TT`, die Erfassung öffnet genau diesen Tag.
  - Kopfzeile „Meine Stunden“: Titel und Monat links, Ist und Soll rechts, jeweils
    zweizeilig.

## 2026-10-18 · Jahresplanung: „Zur Baustelle“ (Eckart Egger)

- **Wunsch:** In der Jahresplanung beim Klick auf eine Baustelle mit einem Knopf direkt
  zur Baustelle kommen, um dort Einstellungen zu ändern.
- **Umsetzung (PoliereinsatzView):**
  - Im Info-Fenster am Balken gibt es den Knopf „Zur Baustelle“, im Dialog „Einsatz
    bearbeiten“ oben rechts den Link „Zur Baustelle“.
  - Beide öffnen `/baustellen/<id>` und sind nur sichtbar mit `baustellen.view`.

## 2026-10-18 · Neue Struktur, Runde 2: weniger Ordner, PDFs automatisch (Sebastian Egger)

- **Mail S. Egger 16.10.:**
  - Neue, schlankere Vorlage (ZIP): 26 statt 60 Ordner. 00-Baustelle hat nur noch
    01-Montage und 02-Produktion; neu sind 08-Fotos und 06-BauKG.
  - Bautages- und Regieberichte sowie die Evaluierung (erst wenn unterschrieben) sollen
    als PDF direkt in 00-Baustelle liegen, mit Nummer, Bezeichnung und Datum.
  - Die Baustellenanlage soll als PDF direkt in 01-Baustellenmanagement liegen.
- **Christophs Vorgaben:**
  - Nummer = Kostenstelle.
  - Kommt nach Abschluss noch eine Unterschrift dazu, wird eine neue Fassung daneben
    gelegt.
  - Baustellenanlage nur als PDF, von der App selbst erzeugt.
- **Umsetzung:**
  - `vorlagen/bvh-neu/struktur.json` getauscht, die Materialliste ist unverändert. Test
    im Gruber-Testordner: genau die 5 neuen Ordner ergänzt.
  - Neue Spalte `baustellen.sharepoint_struktur` ('bvh-neu'), die der Server beim Anlegen
    setzt. Nur diese Baustellen bekommen die neue Ablage, alte bleiben, wie sie waren.
  - `sharepoint-schreiben`: Berichte und Evaluierungs-Nachweise gehen direkt nach
    00-Baustelle. Berichte heißen `<KS> Bautagesbericht|Regiebericht <JJJJ-MM-TT>.pdf`,
    `dokumente.dateiname` wird mitgezogen.
  - `lib/nachweisAblage.ts`: Nach jeder Unterschrift (Handy und Tablet) entsteht das PDF,
    sobald alle unterschrieben haben, als `<KS> Evaluierung <Art> <Datum>.pdf`, bei
    Nachzüglern als `… Fassung 2`. Je Stand gibt es genau ein PDF (Speicherpfad mit
    Anzahl der Unterschriften).
  - `lib/baustellenanlagePdf.ts` (jsPDF, Felder wie im Word-Formular). Bei neuer
    Struktur wird nur `<KS> Baustellenanlage <Datum>.pdf` abgelegt, das Word-Formular
    nur noch für die Mail erzeugt.
  - Ordnerregel: „Montage“ und „Produktion“ in 00-Baustelle zählen als Pläne, damit
    Mitarbeiter sie wie bisher sehen. Was direkt in 00 liegt (Berichte, Nachweise), sehen
    Poliere, Büro und Geschäftsführung.
- **Datum im Dateinamen** als JJJJ-MM-TT, damit die Dateien im Explorer zeitlich sortiert
  sind.

## 2026-10-15 · SharePoint: alles synchron und in der App zu öffnen (Christoph)

- **Vorgabe:** „Alle Dateien sollen im OneDrive und in der App synchron sein und in der
  App zum Öffnen gehen.“
- **Aktualität:**
  - Vorher wurde jede Baustelle nur etwa einmal pro Stunde abgeglichen (97 verknüpft, 15
    je 10-Minuten-Lauf, Läufe bis 143 s, knapp an der 150-s-Grenze).
  - Jetzt gleicht das Öffnen des Dokumente-Reiters die Baustelle sofort ab und lädt neu,
    wenn sich etwas geändert hat. Das darf jeder, der die Baustelle sehen darf, höchstens
    alle 2 Minuten (`sharepoint-sync`, nur lesend).
  - Der Zeitplan hat ein Zeitbudget von 100 s. Was nicht mehr drankommt, ist beim nächsten
    Lauf zuerst dran.
- **Öffnen** (`sharepoint-datei`):
  - Als PDF: Office, Outlook-Mails (.msg/.eml, ~600 Stück), .tif.
  - iPhone-Fotos (.heic, ~165): Microsoft rechnet HEIC nicht nach JPG um, deshalb die
    SharePoint-Vorschau in 2000 px.
  - Jede Datei bringt ihre SharePoint-Adresse mit. Der Betrachter hat „In SharePoint“,
    für Pläne (.dwg/.dxf/.ifc), die kein Browser zeigt. Download geht immer.
  - Getestet mit echten Dateien: msg, tif, docx, xlsx → PDF; heic, jpg → JPG; pdf direkt;
    dwg → SharePoint-Link.
- **Grenze:**
  - Was in der App gelöscht wird, bleibt in SharePoint. In SharePoint wird nie gelöscht.
  - „In SharePoint“ öffnen kann nur, wer ein Microsoft-Konto mit Zugriff aufs Team hat.

## 2026-10-15 · Neue Baustelle → SharePoint-Ordner nach neuer Struktur (Sebastian Egger)

- **Wunsch (Mail an Christoph, 14./15.10.):** Beim Anlegen einer Baustelle soll im Team
  des Bauleiters ein Ordner mit der neuen Struktur entstehen (ZIP „1 Vorlagen Bvh“), dazu
  seine überarbeitete Materialliste mit den Stammdaten. Bestehende Baustellen bleiben, wie
  sie sind. „00-Baustelle“ ist der Ordner für die Poliere.
- **Christophs Vorgaben:** feste Vorlage für alle, Ordnername `<komplette Kostenstelle>
  <BVH>`, vorerst nur für Sebastian.
- **Vorlage:** privater Speicher `vorlagen`, liest nur der Server.
  - `bvh-neu/struktur.json` mit 60 Ordnern und 5 festen Dateien:
    - 3 PDFs in „ÜA-Holzforschung“
    - Schlussbrief-Vorlage
    - Zusatzangebot-Vorlage
  - `bvh-neu/materialliste.xlsx`: die Mail-Version vom 15.10., NICHT die ältere aus
    der ZIP.
  - Neue Vorlage von Sebastian → Dateien dort ersetzen, die Struktur steht in der JSON.
- **Materialliste:** `_shared/materialliste.ts`.
  - Setzt nur die Zellen Stammdaten!C2–C14 direkt im XML, ohne Excel-Bibliothek. Die
    würde Dropdowns (x14), Bilder in Zellen und Druckeinstellungen verlieren.
  - Der Bauleiter wird so geschrieben, wie ihn das Dropdown kennt (Blatt „Bauleiter“,
    z. B. Johannes Maurer → „Maurer Hannes“).
  - Die zwischengespeicherten Werte der `=Stammdaten!Cn`-Verweise werden mitgesetzt,
    damit die Vorschau stimmt, dazu `fullCalcOnLoad`.
  - Lokal gegen die echte Vorlage getestet: alle Felder gesetzt, Dropdowns noch da,
    alle XML-Teile wohlgeformt.
- **sharepoint-schreiben:**
  - `app_settings.sharepoint_neue_struktur` (`bauleiter_ids` oder `alle`).
  - Für diese Bauleiter und nur bei Ausführungen legt `modus: ordner` den Ordner an,
    wenn kein passender existiert. Inhalt: Struktur (je Ebene parallel), feste Dateien
    und ausgefüllte Materialliste.
  - Jeder Schritt prüft vorher, ob es das schon gibt. Ein zweiter Lauf ergänzt nur,
    auch nach einem Abbruch.
  - `nur_neue_struktur: true` sorgt dafür, dass der Aufruf nach dem Anlegen bei anderen
    Bauleitern nichts tut.
  - Testmodus `vorlage_test` (nur Server) legt die Vorlage in einem beliebigen Team an,
    ohne Verknüpfung.
  - Test im stillgelegten Team „Aktuelle BVH Gruber Peter“: Ordner „ZZ TEST
    App-Vorlage 1404050-2603 Carport Platzer“ mit 60 Ordnern, 5 Dateien und
    Materialliste in 18 s. Der zweite Lauf hat 0 ergänzt. **Der Testordner liegt noch
    dort, bitte in SharePoint von Hand löschen.**
- **App:**
  - Das Baustellenformular ruft nach dem Speichern einer neuen Ausführung
    `sharePointNachAnlegen` im Hintergrund auf: anlegen/verknüpfen, gleich spiegeln,
    App-Dateien (Baustellenanlage) hochladen.
  - Im Dialog „Ordner verknüpfen“ gibt es bei diesen Bauleitern den Knopf „Neuen Ordner
    nach Vorlage anlegen“.
- **Rechte:**
  - Neue Ordnerart `00-baustelle` (ordnerKlasse in App und Server). Sichtbar für
    Vorarbeiter, Zimmermeister, Büro und Geschäftsführung (`ordner_visibility`).
  - Unterordner in 00-Baustelle zählen nach ihrem Namen: Pläne, LV, Fotos und Evaluierung
    sehen alle wie bisher.
  - App-Unterweisungen landen bei neuer Struktur in `00-Baustelle/06-Evaluierung`.
  - Bei Baustellen ohne SharePoint gibt es keinen leeren 00-Ordner.
- **Nebenbei:** Die Polierschul-Funktionen (`20261012100100_polierschule.sql`) sind jetzt
  eingespielt.
- **Offen:** Partieführer in Evaluierung/ÜA-Checkliste der Excel ist fest
  „Hinteregger Norbert“, er steht nicht in den Stammdaten und wird nicht befüllt.

## 2026-10-15 · KW im Datumswähler der Arbeitsplanung (Johannes Maurer)

- **Wunsch:** „Kannst du die KW hier seitlich beim Auswählen auch einfügen?“ Der Screenshot
  zeigt den Einsatz-Dialog.
- Der Browser-Datumswähler (`input type="date"`) kann keine KW anzeigen. Deshalb gibt es
  das neue Feld `components/ui/datum-kw-feld.tsx` (react-day-picker, ISO-Wochen, Montag
  zuerst). Links steht die KW-Spalte. Ein Tipp auf die KW wählt bei „Von“ den Montag und
  bei „Bis“ den Freitag.
- Eingesetzt in der Arbeitsplanung: Einsatz anlegen/bearbeiten, PDF-Zeitraum und
  „Zeitraum ändern“.

## 2026-10-13 · SharePoint: neue Ordner nicht auffindbar (Niklas Gwenger)

- **Wunsch:** „Synchronisiert nicht, Ordner sind seit 2 Wochen erstellt.“ Der Ordner
  „1404040 Painter Carport“ war in „Ordner verknüpfen“ nicht zu finden.
- **Ursache 1:** Das Ordnerverzeichnis (`sharepoint_ordner`, Modus `ordner` von
  `sharepoint-sync`) wurde nie per Zeitplan aufgefrischt, zuletzt von Hand am 14.09.
  Seither in SharePoint angelegte Ordner kannte die App nicht.
- **Ursache 2:** Sebastian Egger hat sechs Ordner umbenannt (z. B. „1404030 - Balkone
  Mittewald“ → „4030 - Balkone Mittewald“). Sie haben dabei neue IDs bekommen, und jeder
  Abgleich lief für HMH Obersteiner, Carport Inzko, Mischkulnig, Balkone Mittewald, Rohde
  und Carport Luger auf „Graph 404“.
- **Behoben:**
  - Der Zeitplan-Abgleich frischt das Verzeichnis nebenbei auf, sobald es älter als 30
    Minuten ist. Das dauert ca. 5 s für 900 Ordner.
  - Der Dialog „Ordner verknüpfen“ holt es beim Öffnen frisch und zeigt dabei „SharePoint
    wird durchsucht …“.
  - Den Modus `ordner` dürfen alle auslösen, die verknüpfen dürfen
    (`is_admin_role`/`can_review`).
  - Ordner, die es nicht mehr gibt, fliegen aus dem App-Verzeichnis, aber nur für Teams,
    die vollständig gelesen wurden. In SharePoint wird nichts gelöscht.
- **Daten:**
  - Die sechs Egger-Baustellen sind auf die umbenannten Ordner umgehängt (863 Dateien
    gespiegelt).
  - Painter Carport und Scherwitzl (BVH Gwenger) sind verknüpft.
  - Auf Christophs OK auch verknüpft (Name und Kostenstelle eindeutig): Ly Vong, Platzer,
    FF St. Filippen, MH Becker, MH Traschl, Ropac, Steinwender, Tramlage Lauritsch,
    Umbau Zangl. Dabei 201 Dateien gespiegelt; die Baustellenanlage (.docx) wird
    hochgeladen.
  - **Marvin** und **Sanierung Velden** (zwei Kandidaten: Maurer und Egger Sebastian)
    verknüpft der Bauleiter selbst.

## 2026-10-12 · Abwesenheit „Polierschule“ (Christoph)

- **Wunsch:** Im Fenster „Abwesenheit eintragen“ der Arbeitsplanung soll neben
  Berufsschule auch „Polierschule“ stehen.
- **Umsetzung:** Neuer Code **PS · Polierschule** (Indigo). Er wird wie die
  Berufsschule behandelt: Der Tag zählt mit dem Tages-Soll, es gibt kein Minus im
  Zeitausgleich und keinen Urlaubsabzug. Polierschule erscheint in Stunden,
  Stundenbericht, BSB-PDF, Stundenauswertung, Poliereinsatz und Tagesplanung als
  abwesend. Im Tagesplan und im PDF steht die Zeile „Polierschule:“ nur, wenn jemand
  dort ist.
- **Datenbank:**
  - `20261012100000_polierschule_enum.sql`: Enum-Wert `polierschule`, ist eingespielt.
  - `20261012100100_polierschule.sql`: `stunden_tag_recompute` (Vorrang nach
    Berufsschule) und `plan_fuer_tag` (Abwesenheitsliste). Beim Einspielen zweimal
    abgelehnt, **noch nicht in der DB**. Ohne sie funktioniert der Knopf, weil der
    Trigger den Status stehen lässt. Nur „Mein Tag“ und die Polier-Ansicht zeigen
    Polierschule noch nicht als abwesend.

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
