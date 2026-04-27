# Holzbau Willroider – Baustellenmanagement

Digitale App für die Holzbau Willroider GmbH (Villach, Kärnten).
Ersetzt manuelle Word/Excel/WhatsApp-Prozesse durch einen integrierten
Workflow von der Arbeitsplanung bis zur Nachkalkulation.

## Stack

- **React 18 + Vite + TypeScript**
- **TailwindCSS + shadcn/ui** – UI-Komponenten
- **Supabase** – Postgres, Auth, Storage, Realtime, RLS
- **TanStack Query + React Router**
- **PWA** (Vite PWA Plugin)

## Module

| Modul | Pfad | Beschreibung |
|---|---|---|
| Dashboard | `/` | Kennzahlen, Schnellzugriff, aktive Baustellen |
| Mein Tag | `/mein-tag` | Persönliche Tagesansicht für Mitarbeiter |
| Arbeitsplanung | `/arbeitsplanung` | Gantt-Chart aller Baustellen, Partien-Farbcodes |
| Einteilung | `/einteilung` | Tägliche Mitarbeiter-/Fahrzeug-Einteilung |
| Baustellen | `/baustellen` | Stammdaten, Termine, Dokumente, Kosten, Stunden, Evaluierungen |
| Mitarbeiter | `/mitarbeiter` | Mitarbeiter & Partien, Rollen, Aktivierung |
| Fahrzeuge | `/fahrzeuge` | Fuhrpark-Verwaltung |
| Stunden | `/stunden` | Tägliche Stundenerfassung |
| Freigaben | `/stunden/freigabe` | 2-stufige Freigabe ZM → Büro, CSV-Export |
| Evaluierung | `/evaluierung` | Sicherheitsunterweisung gemäß ASchG |
| Arbeitszeitkalender | `/kalender` | Wochentyp L/K/F/U, Soll-Stunden |

## Setup

```bash
# 1. Dependencies
npm install

# 2. Supabase-Credentials in .env eintragen (siehe .env.example)
cp .env.example .env

# 3. Schema in Supabase deployen
# Migrations: supabase/migrations/

# 4. Dev-Server
npm run dev    # http://localhost:8080

# 5. Production Build
npm run build
```

## Rollen

- **Geschäftsführung** – Vollzugriff
- **Bauleiter** – Planung, Einteilung, Berichte, Evaluierung
- **Zimmermeister** – Stunden-Freigabe (1. Stufe)
- **Büro** – Freigabe (2. Stufe), Export, Dokumente
- **Mitarbeiter** – Eigene Daten: Einteilung lesen, Stunden erfassen

Berechtigungen werden via Postgres Row-Level-Security durchgesetzt.

## Brand

- Burgundy `#B0353C` (primary)
- Logo-Gelb `#F5D300` (accent)
- Logo: `public/willroider-logo.jpg`
