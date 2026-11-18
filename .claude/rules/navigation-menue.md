---
paths:
  - "src/components/AppShell.tsx"
  - "src/lib/menuGedaechtnis.ts"
  - "src/pages/BaustelleDetail.tsx"
  - "src/components/BaustelleDokumente.tsx"
  - "src/components/AngebotDokumente.tsx"
---
# Seitenleiste / Navigation

## Letzte Position je Menüpunkt (E. Winkler, 18.11.2026 — „wie im Explorer“)
- `lib/menuGedaechtnis.ts` + `AppShell`: je Menüpunkt wird Pfad + `?…` gemerkt (sessionStorage je Benutzer, beim
  Abmelden geleert). Klick auf einen anderen Menüpunkt → dorthin, wo man zuletzt war; Klick auf den Menüpunkt, in dem
  man gerade ist → Übersicht. Gilt für Seitenleiste und untere Leiste am Handy. Seiten ohne eigenen Menüpunkt
  (`/stundenbericht/…`, `/evaluierung`) zählen zum Menüpunkt, aus dem man kam.
- Gemerkt wird nur, was in der Adresse steht → Zustand, der sich merken soll, gehört in die URL (mit `replace`, über
  `suchParameterSetzen`): BaustelleDetail `?tab=`, Dokumente `?dok=<Ordner-Schlüssel, auch sp:Name>&pfad=<Unterordner>`
  (Baustelle und Angebot). `?ordner=<klasse>` bleibt als Tiefer-Link (Mein Tag) und wird nach dem Laden zu `dok`.
- Den gemerkten Ordner erst nach dem Laden prüfen (sp-Ordner und Rechte kommen asynchron), sonst springt er auf die Wurzel.
- Zurück-Knöpfe in Unterseiten: `zurueck(navigate, ersatz)` — im Verlauf zurück nur, wenn die vorige Seite im selben
  Menüpunkt war, sonst zur Übersicht (sonst führte „Zurück“ nach der Wiederherstellung z. B. nach „Pläne“).
- Gelöschte/unsichtbare Baustelle als gemerkte Position → BaustelleDetail leitet zur Liste um (vorher Dauer-„wird geladen“).
