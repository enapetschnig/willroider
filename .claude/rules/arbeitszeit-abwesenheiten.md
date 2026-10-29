---
paths:
  - "src/lib/konten.ts"
  - "src/lib/feiertage.ts"
  - "src/lib/urlaubsantrag.ts"
  - "src/hooks/useSollHours*.ts"
  - "src/pages/Kalender.tsx"
  - "src/components/UrlaubAntragDialog.tsx"
  - "src/components/admin/AdminArbeitszeit.tsx"
  - "src/components/admin/AdminEinstellungen.tsx"
  - "src/components/admin/AdminUrlaubsKonten.tsx"
  - "src/components/admin/AdminZaKonten.tsx"
  - "src/components/stunden/zeiterfassungUi.ts"
  - "supabase/functions/_shared/feiertage.ts"
---

# Arbeitszeit, Soll-Stunden, Abwesenheiten

- **Arbeitszeitmodelle** (`profile_konten_settings.arbeitszeitmodell`): `zimmerei_sommer` (Bau-KV lange/kurze
  Woche über `arbeitszeitkalender` soll_mo…soll_so), `fix_40h`, `individuell`, `angestellter` (8,5/5).
  Seit 22.10. kennt SQL `tages_soll` auch `angestellter` (vorher zog ein Urlaubstag im Sommer nur 0,94 Tage ab).
- **Eigenes Wochen-Soll je Person** (J. Maurer, 22.10.): `profile_konten_settings.soll_woche` =
  `{woche:[Mo..So], gerade_kw?:[…]}` — geht dem Modell vor, absolut (ohne Beschäftigungsgrad). Pflege in
  Verwaltung → Arbeitszeit → „Eigenes Wochen-Soll“. Wirkt in TB (RPC `soll_woche_von`), `konten.ts`
  (tagesSoll/periodeSoll), Soll-Hooks, MeineStunden, Stundenauswertung, SQL `tages_soll`.
  Person ohne Einstellungs-Zeile: Modell aus `zeiterfassung_typ`, nicht „zimmerei_sommer“.
- **Köstenberger** (geringfügig): seit 27.10. jede Woche Mo–Mi 2, Do 1,5 = 7,5 h, **kein** Wechsel
  gerade/ungerade KW mehr (J. Maurer: „immer 7,5 Wochenstunden … jede Woche gleich“).
  Migration `20261027110000_soll_woche_koestenberger.sql`.
- Wochenend-/Feiertagstage werden bei Auswahl und Verschieben übersprungen; Urlaub nur Werktage
  (Christoph, 07/2026: „Nur Werktage wie bisher“). Feiertage: `src/lib/feiertage.ts`
  (Kopie in `supabase/functions/_shared/feiertage.ts` — beide pflegen).
- **Berufsschule** (`tag_status 'berufsschule'`, 30.07.) und **Polierschule** (`'polierschule'`, Code PS,
  Indigo, 12.10.): Christoph „Wie Berufsschule“ — Tag zählt mit Tages-Soll, kein Minus im Zeitausgleich,
  kein Urlaubsabzug, erscheint in Stunden/BSB/Auswertung/Poliereinsatz/Tagesplan als abwesend.
  Neuer Abwesenheitstyp: überall dort ergänzen, wo `berufsschule` vorkommt (`git grep berufsschule`).
  Fallstrick: `ALTER TYPE … ADD VALUE` muss allein committet sein, bevor er benutzt wird.
- Monatsabschluss rechnet für jeden Nicht-Arbeits-Status Tages-Soll (`baustelle`/`firma` → netto).
- Urlaub: genehmigter Urlaub lässt sich löschen, Konto wird gutgeschrieben (J. Maurer, 31.08./01.09.);
  „Zeitraum ändern“ passt Antrag und Tageszahl an. Genehmigen mit Recht `urlaub.genehmigen`.
- Stundenweise Abwesenheit/Krankheit möglich (31.08./13.08.).
- Sichtbarkeit von Abwesenheiten → `planung-tagesplan.md` (Recht `arbeitsplanung.abwesenheiten`).
