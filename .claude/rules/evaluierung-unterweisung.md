---
paths:
  - "src/pages/Evaluierung.tsx"
  - "src/components/evaluierung/**"
  - "src/components/EvaluierungSignatureGate.tsx"
  - "src/components/EvaluierungKiDialog.tsx"
  - "src/components/UnterweisungTablet.tsx"
  - "src/components/UnterweisungNachweis.tsx"
  - "src/components/MeinTag/UnterweisungOffenCard.tsx"
  - "src/components/admin/EvaluierungVorlagenCard.tsx"
  - "src/lib/unterweisung*.ts"
  - "src/lib/pflichtUnterweisung.ts"
  - "src/lib/evaluierung*.ts"
  - "supabase/functions/evaluierung-reminder/**"
  - "supabase/functions/analyze_unterweisung/**"
---

# Evaluierung / Unterweisung (ASchG)

- Typen (`UNTERWEISUNG_OPTIONS` in `lib/unterweisungen.ts`): werkstatt, baustelle, fertigteilmontage,
  tagesbaustelle (SiGe-Dokument nach Vorlage Ingenieurbüro Wulz, „Evaluierung neu.xlsx“, 18.09.).
  Pflicht-Unterweisung je Baustelle: `baustellen.pflicht_evaluierung_id`, RPC `unterweisung_setzen`.
- Unterschriften in `evaluierung_unterschriften` (`faellig_am`, `bestaetigt_ueber`, `gelesen_bestaetigt`).
  Zuteilung automatisch über die Einteilung (Trigger `pflicht_unterweisung_zuteilen`/`_nachholen`).
- **Frist** (J. Maurer, Rollout 01.10.): eingeteilt am Vortag → fällig 08:00 (Wien); sonst +30 Min; abwesend
  → keine Frist. Danach ist die App gesperrt, bis unterschrieben ist. Erinnerung per SMS an Bauleiter/Polier/
  Partieleiter (`evaluierung-reminder`, Cron alle 5 Min, Mo–Sa 06–18). Polier bekommt auch eine
  Aufforderung, Karenz einstellbar (28.07.).
- **Nur über den gemeinsamen Weg setzen:** `setzePflichtUnterweisung()` in `lib/pflichtUnterweisung.ts`
  archiviert beim Wechsel die offenen, nicht unterschriebenen Zuteilungen der alten Unterweisung
  (Vorfall Painter Carport, 08.10.: drei Mitarbeiter hingen an der falschen, App gesperrt). Christoph hat einen
  DB-Trigger dafür **nicht** eingespielt und das Löschen per SQL abgelehnt — wer
  `pflicht_evaluierung_id` anderswo setzt, muss diesen Weg nehmen.
- Löschen: Mülleimer je Evaluierung auf der Seite Unterweisungen, Warnung bei vorhandenen Unterschriften.
- **Tablet-Modus** (`UnterweisungTablet`) und Handy (`EvaluierungSignatureGate`): Knopf „Gelesen und
  verstanden“ wird auch ohne Scrollen frei (ResizeObserver), Lesebereiche `min-h-0` — passte der Text ganz
  aufs iPad, blieb er früher für immer grau (N. Gwenger, 08.10.).
- Kein Zeitstempel ohne Unterschrift, keine doppelte Anlage (15.09.).
- **Erst unterschreiben, dann an die Baustelle** (J. Maurer, 27.10.: „Vortragender muss ausgefüllt sein und
  derjenige der die Baustelle anlegt muss die Evaluierung unterschreiben bevor sie zur Baustelle geht“):
  Migration `20261027100000_evaluierung_freigabe.sql`; `unterweisung_setzen` legt UNFREIGEGEBEN an,
  Trigger teilen Unfreigegebenes niemandem zu; RPC `evaluierung_freigeben(p_id, p_unterschrift,
  p_vortragender)` verteilt sofort. UI `components/evaluierung/EvaluierungFreigabe.tsx`.
- **Nachweis-PDF** (N. Gwenger, 01.10.): „Nachweis als PDF“ im Reiter Unterweisung, aufgebaut wie Christians
  Vorlage „5.1 Unterweisung 2.docx“ (Gefahrenevaluierung Baustellen) — `lib/unterweisungNachweisPdf.ts`;
  Tagesbaustellen bekommen das Wulz-Formular (`evaluierungTagesbaustellePdf.ts`). jsPDF-Helvetica kann
  „→“/„≥“ nicht → `pdfText`-Bereinigung. Ablage in SharePoint → `sharepoint-onedrive.md`.
- Mitarbeiter von Hand dazunehmen/herausnehmen in der Unterweisungsliste; von Hand Dazugekommene haben
  keine Fälligkeit (gesperrt erst bei Einteilung).
- Tagesplanung warnt bei Baustellen ohne Unterweisung und bietet „Standard anlegen“.
- Offen: Partieführer im Excel ist fest „Hinteregger Norbert“, wird nicht befüllt (15.10.).
