---
paths:
  - "src/integrations/supabase/**"
  - "src/contexts/AuthContext.tsx"
---
# Supabase-Protokolle: geprüft und harmlos

- `520 /realtime/v1/websocket` (1× am 03.11.2026, 01:18 UTC): Cloudflare-Fehlerseite nach 40 s Warten auf Supabase, sonst 214× 101 in 24 h, keine Meldungen in Realtime/Postgres, derselbe Browser nach 0,2 s wieder verbunden → Aussetzer außerhalb der App; einzeln ignorieren, erst bei Häufung nachsehen.
- `relation "ma_dokumente"` / `column f.user_id`, `t.art`, `k.erstellt_von`, `"titel"`, `z.tag_id does not exist` (je 1× am 04.11.2026): eigene Diagnose-Abfragen der KI über die Management-API (`application_name = mgmt-api`, Kommentar `source: POST /v1/projects/:ref/database/query`) mit falsch geratenen Namen, nichts davon in App, Funktionen, Policies oder Cron → harmlos; bei solchen Meldungen zuerst `application_name` prüfen. `ma_dokumente` ist nur ein Storage-Bucket, die Tabelle heißt `dokumente`.
