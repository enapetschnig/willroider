---
paths:
  - "src/lib/sharepoint.ts"
  - "src/lib/ordnerKlasse.ts"
  - "src/lib/baustellenOrdner.ts"
  - "src/lib/angebotOrdner.ts"
  - "src/lib/nachweisAblage.ts"
  - "src/components/BaustelleDokumente.tsx"
  - "src/components/baustelle/**"
  - "src/components/dokumente/**"
  - "src/components/dashboard/SharePointFehlerHintCard.tsx"
  - "supabase/functions/sharepoint-*/**"
  - "supabase/functions/bericht-ablegen/**"
  - "supabase/functions/_shared/graph.ts"
  - "supabase/functions/_shared/materialliste.ts"
  - "supabase/functions/_shared/ordnerklasse.ts"
---

# SharePoint / OneDrive

**Oberste Regel (Christoph, 09/2026):** „schau dass du Nix löschst bei onedrive das ist immer oberste
Bedingung“. `_shared/graph.ts` hat kein DELETE/PATCH; Uploads mit `conflictBehavior=rename`. Was in der
App gelöscht wird, bleibt in SharePoint. Einmalige Löschungen nur auf ausdrücklichen Auftrag per Skript.

## Aufbau
- Graph-App „IntraFit für OneDrive“ (Client-Credentials; Secrets `GRAPH_TENANT_ID/GRAPH_CLIENT_ID/
  GRAPH_CLIENT_SECRET` in Supabase). **Client-Geheimnis läuft am 13.03.2027 ab** — danach scheitert jeder
  Zugriff (Hinweis im Dashboard würde es zeigen).
- Baustellen-Ordner liegen in den **Teams-Teams je Bauleiter** („Aktuelle BVH Egger Sebastian“, „BVH Maurer“,
  „BVH Gwenger“, „Aktuelle BVH Winkler Elias“, „Aktuelle BVH Pließnig Christian“ …), Tabelle `sharepoint_teams`.
  „Aktuelle BVH Mainhard“ (Angebote/Planung) ist nicht eingetragen.
- Tabellen: `sharepoint_ordner` (Ordnerverzeichnis), `sharepoint_dateien` (gespiegelte Dateien),
  `sharepoint_auftraege` (Warteschlange), View `v_sharepoint_status`; Spalten `baustellen.sharepoint_*`.
- Functions: `sharepoint-sync` (Modi `spiegeln`, `ordner`; nur lesend), `sharepoint-schreiben` (`ordner`,
  `hochladen`, `auftraege`), `sharepoint-datei` (Datei öffnen mit Benutzer-JWT/RLS).
- Fallstricke: `@microsoft.graph.downloadUrl` nie mit `$select` anfordern (fehlt sonst); Storage-Schlüssel
  ohne Umlaute (`speicherPfadTeil`); RLS auf `sharepoint_dateien` mit `(select …)`-Muster (sonst 12 s).

## Abgleich & Öffnen (Christoph, 15.10.: „Alle Dateien sollen im OneDrive und in der App synchron sein und in der App zum Öffnen gehen.“)
- Öffnen des Dokumente-Reiters gleicht die Baustelle sofort ab (höchstens alle 2 Min). Zeitplan-Abgleich mit
  100-s-Budget; frischt das Ordnerverzeichnis auf, wenn älter als 30 Min (N. Gwenger, 13.10. — vorher seit
  14.09. nie aufgefrischt). „Ordner verknüpfen“ sucht beim Öffnen frisch.
- Umbenannte Ordner bekommen in SharePoint neue IDs → „Graph 404“ beim Abgleich (Fall S. Egger, 13.10.).
- Office, Outlook (.msg/.eml), .tif → als PDF; .heic → SharePoint-Vorschau 2000 px; .dwg/.dxf/.ifc → Link
  „In SharePoint“ (braucht Microsoft-Konto mit Team-Zugriff).
- Dokumente-Reiter zeigt bei verknüpften Baustellen **genau die SharePoint-Ordner** (E. Winkler, 21.09.),
  oben feste Kacheln Pläne / Fotos / Unterweisung. Upload landet im gerade offenen Ordner.
- Ordner-Sichtbarkeit serverseitig: `darf_ordner_sehen` (Ausnahme je Person → Admin → Prüfer → Rollen-Vorgabe
  `app_settings.ordner_visibility`); Ordnerklasse über Namen (`ordnerKlasse`, `pfadKlasse`).

## Neue Baustelle → Ordner (neue Struktur „bvh-neu“)
- Vorlage im privaten Bucket `vorlagen/bvh-neu/` (`struktur.json` v2: 26 Ordner, feste Dateien,
  `materialliste.xlsx`). Neue Vorlage von S. Egger → Dateien dort tauschen.
- Ordnername `<komplette KST> <BVH>`. Materialliste: nur Zellen Stammdaten!C2–C14 direkt im XML setzen
  (`_shared/materialliste.ts`, keine Excel-Bibliothek — die zerstört Dropdowns/Bilder); Bauleiter wie im
  Dropdown („Maurer Hannes“).
- Seit 20.10. für **alle Bauleiter**: `app_settings.sharepoint_neue_struktur = {alle:true, ab:"2026-10-20"}`
  (S. Egger: „für alle freischalten“). Ältere Baustellen bekommen keinen nachträglichen Ordner.
- „Immer funktionieren“ (Christoph, 19.10.): Trigger `baustellen_sharepoint_auftrag` → `sharepoint_auftraege`,
  Cron `sharepoint-auftraege` (alle 5 Min, bis 6 Versuche) + `SharePointFehlerHintCard`. Verknüpft wird nur
  ein **freier Ordner, der mit GENAU der KST beginnt** — nie Ähnlichkeitssuche, nie fremde KST, nie ein schon
  belegter Ordner (Fall „Egger Test 2“, 19.10.). Sonst wird neu angelegt; zweiter Lauf ergänzt nur.
- Reiter Team: „Ordnerstruktur anlegen“ / „Ordnerstruktur ergänzen“ (E. Winkler, 28.10.; legt nur Fehlendes an).
- Ablage in `00-Baustelle`: Berichte `<KS> Bautagesbericht|Regiebericht <JJJJ-MM-TT>.pdf`, Evaluierungs-
  Nachweis `<KS> Evaluierung <Art> <Datum>.pdf` erst wenn alle unterschrieben, Nachzügler „… Fassung 2“
  (`lib/nachweisAblage.ts`); Baustellenanlage-PDF in `01-Baustellenmanagement` (S. Egger/Christoph, 18.10.).
- Bauleiter sollen Ordner für neue Baustellen nicht mehr selbst anlegen. Windows-Explorer hinkt beim
  OneDrive-Abgleich nach (Fall Winkler, 28.10.) — erst in SharePoint selbst nachsehen.
- Testreste, die von Hand gelöscht werden müssten: „ZZ TEST App-Vorlage …“ im Team „Aktuelle BVH Gruber Peter“;
  falsch abgelegte „1404050-2606 Baustellenanlage 2026-10-19.pdf“ in „1404050-2605 Egger Test“.
