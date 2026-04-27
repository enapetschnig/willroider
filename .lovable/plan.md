

## Eindeutige Projektnamen erzwingen

### Aktueller Zustand

Es gibt bereits einen UNIQUE-Constraint auf `(name, plz)` — das erlaubt aber zwei Projekte mit gleichem Namen, solange die PLZ unterschiedlich ist.

### Änderung

1. **Datenbank-Migration:** Neuen UNIQUE-Constraint auf `name` allein hinzufügen:
   ```sql
   ALTER TABLE public.projects ADD CONSTRAINT projects_name_unique UNIQUE (name);
   ```

2. **Frontend-Validierung:** In den Projekt-Erstellungs-Dialogen (TimeTracking und Projects-Seite) eine Fehlermeldung anzeigen, wenn ein Projekt mit diesem Namen bereits existiert. Der Datenbank-Constraint fängt Duplikate ab — die Fehlermeldung vom Insert wird als Toast angezeigt (z.B. "Ein Projekt mit diesem Namen existiert bereits").

### Technische Details

- **Migration:** Ein einfacher `ALTER TABLE` mit UNIQUE auf `name`
- **Code:** Keine zwingenden Code-Änderungen nötig — der DB-Constraint wirft einen Fehler, der bereits von den bestehenden Error-Handlern als Toast angezeigt wird. Optional: bessere Fehlermeldung parsen wenn der Constraint-Fehler `projects_name_unique` enthält.

