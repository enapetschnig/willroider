---
paths:
  - src/components/feedback/**
  - src/components/admin/AdminFeedback.tsx
  - src/components/admin/BesprechungsModus.tsx
  - src/pages/Aenderungswuensche.tsx
---
# Änderungswünsche (feedback)

- `feedback.admin_notiz` ist die **Antwort an den Melder** (kein interner Vermerk — intern ist `feedback_kommentare.ist_intern`).
  Seit 13.11.2026 zeigt `components/feedback/WunschAntwort.tsx` sie an („Antwort:“, bei `umgesetzt` grün mit Haken):
  „Meine Wünsche“ im Wunsch-Dialog, Seite `/aenderungswuensche`, Verwaltung → Änderungswünsche, Besprechungsmodus.
  Lesen darf sie, wer den Wunsch sieht (RLS `feedback_select`: eigener Wunsch, Admin, `feedback.view_alle`). Daher kurz,
  du-Form, mit „wo in der App“ formulieren — der Mitarbeiter liest sie direkt (Christoph, 13.11.2026).
