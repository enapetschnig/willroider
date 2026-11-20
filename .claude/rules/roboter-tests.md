---
paths:
  - tests/roboter/**
---
# Roboter-Tests (`tests/roboter/`)

- **Laufen parallel** (`tests/roboter/parallel-ok` liegt seit 20.11.2026 → `--workers=4`; Christoph: „halb parallel ist
  schlimmer als einzeln“). Vorher `--workers=1`. Gegen die Testumgebung: `TEST_API_URL/TEST_ANON_KEY/TEST_SERVICE_ROLE_KEY/
  TEST_APP_URL`, `-c tests/roboter/playwright.config.ts`. Ganze Reihe ≈ 30 s mit 4 Workern.
- Jeder Test legt eigene Daten an und fasst nur diese an: E-Mail mit Zufallsanhang (`${Date.now()}${Math.random()…}`),
  `stamp` mit Zufallsanteil — **`baustellen.kostenstelle` ist unique**, gleiche Millisekunde in zwei Tests ⇒ 409.
- Nichts Gemeinsames ändern/zählen: `tagesplanung_freigaben` gilt je **Datum für alle** → eigene Zufallstage weit in der
  Zukunft + Aufräumen in `afterEach` (Fehler 20.11.: feste Tage 2031-03-03/04 machten den Test nach dem 1. Lauf rot).
  `zulagen_typen` nur lesen.
- Baustellen-Suche (cmdk) ist **unscharf** (Buchstaben in Reihenfolge): Negativ-Prüfungen nicht mit Ziffern im Namen,
  die zufällig zur gesuchten KST passen.
- Härtetest neuer Tests: `--repeat-each=3 --workers=4` (fand am 20.11. einen echten Ladefehler in `/stunden`).
