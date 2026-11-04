---
paths:
  - "src/integrations/supabase/**"
  - "src/contexts/AuthContext.tsx"
---
# Supabase-Protokolle: geprüft und harmlos

- `520 /realtime/v1/websocket` (1× am 03.11.2026, 01:18 UTC): Cloudflare-Fehlerseite nach 40 s Warten auf Supabase, sonst 214× 101 in 24 h, keine Meldungen in Realtime/Postgres, derselbe Browser nach 0,2 s wieder verbunden → Aussetzer außerhalb der App; einzeln ignorieren, erst bei Häufung nachsehen.
