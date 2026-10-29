---
paths:
  - "src/components/BaustellenmeldungForm.tsx"
  - "src/pages/Baustellen.tsx"
  - "src/pages/BaustelleDetail.tsx"
  - "src/components/baustellen/**"
  - "src/lib/baustellenanlage*.ts"
  - "src/lib/plzOrt.ts"
  - "src/lib/kostenstellen.ts"
---

# Baustelle anlegen (Baustellenmeldung)

- Formular `BaustellenmeldungForm.tsx` = Nachbau des Word-Formulars „1.1 Baustellenanlage.docx“;
  benutzt in `Baustellen.tsx`, `BaustelleDetail.tsx`, `Arbeitsplanung.tsx`.
- **Planung und Ausführung getrennt** (J. Maurer, 23.09.): `baustellen.art` = `planung` | `ausfuehrung`.
  Planung bekommt KST `1404895-JJNN` und braucht nur BVH + KST. „In Ausführung übernehmen“ legt eine neue
  Ausführung mit neuer KST an (RPC `planung_uebernehmen`): Dokumente, Notizen, Angebote, Termine und
  SharePoint-Verknüpfung wandern mit, **Stunden bleiben auf 1404895** — Maurer: „Ausführung mit neuer Kst
  beginnt bei 0 mit Stunden und Kosten“. Reiter „Planung“ in Baustellen. Die Jahresplanung blendet Planungen aus
  (`Arbeitsplanung.tsx` filtert `art !== "planung"`).
- **Ausführung: Pflichtfelder** beim Anlegen (Maurer, 23.09.: „muss zwingend schon alles ausgefüllt werden
  plus die Auswahl der Evaluierung, sonst soll die Anlage nicht möglich sein“) — alles außer Notizen/
  Besonderes Augenmerk/Koordinaten, dazu Evaluierungs-Typ → `unterweisung_setzen`.
- Seit 27.10.: nach dem Anlegen springt die App in den Reiter „Evaluierung“; der Anleger muss als
  Vortragender unterschreiben, erst dann geht die Unterweisung an die Baustelle → `evaluierung-unterweisung.md`.
- **KST-Vergabe:** Sammel-KST `SAMMEL_KST = 1404020…1404070` mit `vergebeNaechsteKst(basis)` →
  `<Basis>-<JJ><NN>` („wie bei 1404020 2601 (Jahr plus Nummer)“). Knopf „Nächste eigene: …“ = höchste
  `^1404[0-7]\d\d$` ohne Sammel-KST + 1 (Stand 21.10.: 1404557); 14048xx (Planung, intern) zählt nicht.
- **Empfänger der Meldung** (J. Maurer, 21.10.): fester Empfänger „Leistungsstand (Teams)“
  `582a7247.willroider.at@emea.teams.ms`. Bei Sammel-KST 1404020–1404070 und Planung 1404895 nur Teams
  angehakt, sonst Teams + Schneider + Maurer. Teams-Kanäle nehmen evtl. nur bestimmte Absender an
  (Absender `berichte@willroider.app`).
- **PLZ → Ort** (`lib/plzOrt.ts`): erst Orte aus der App zur PLZ, dann zippopotam.us; von Hand getippter
  Ort wird nie überschrieben. Haken „Gleich wie Wohnanschrift Bauherr“ (21.10.).
- Baustellenanlage: bei neuer SharePoint-Struktur nur als PDF (`baustellenanlagePdf.ts`) abgelegt,
  Word (`baustellenanlageDocx.ts`) nur noch für die Mail (Christoph, 18.10.: „nur pdf selbst erzeugen“).
- Neue Ausführung → SharePoint-Ordner automatisch → `sharepoint-onedrive.md`.
- Kostenstellenübersicht als Baustellen-Reiter (`KostenstellenListe`, 18.08.).
- Baustellensuche bleibt nach Detail-Besuch erhalten (23.07.).
