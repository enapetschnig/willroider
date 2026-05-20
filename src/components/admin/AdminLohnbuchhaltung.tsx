/**
 * Lohnbuchhaltung — Zusammenführung der zwei Workflow-Schritte für die
 * Lohnverrechnung in EINE Verwaltungsseite, mit klarer Reihenfolge:
 *
 *   1. STUNDENFREIGABE (Tages-genau)
 *      Bestätigte Tage des Mitarbeiters auf „Büro-Freigabe" setzen
 *      → laufender Prozess, sobald MA Tage bestätigt hat
 *
 *   2. MONATSABSCHLUSS (Monatlich)
 *      Soll/Ist abgleichen, Differenz ins ZA-Konto buchen, Monat sperren
 *      → einmal pro Monat, nachdem alle Tage freigegeben sind
 *
 * Beide Sub-Komponenten bleiben wiederverwendbar — diese Datei rendert sie
 * nur zusammen mit Erklärungstexten und einem optischen Trenner.
 */

import { AdminStundenFreigabe } from "./AdminStundenFreigabe";
import { AdminMonatsabschluss } from "./AdminMonatsabschluss";
import { CheckCircle2, CalendarCheck } from "lucide-react";

export function AdminLohnbuchhaltung() {
  return (
    <div className="space-y-8">
      {/* Section 1: Stundenfreigabe */}
      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-emerald-100 p-2 flex-none">
            <CheckCircle2 className="h-5 w-5 text-emerald-700" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">1. Stunden-Freigabe</h2>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Hier werden die vom Mitarbeiter bestätigten Tage auf „Büro-Freigabe"
              gesetzt. Das ist der laufende Check vor der Lohnverrechnung — sobald
              ein MA seine Tage bestätigt, kannst du sie hier in Sammlung
              freigeben.
            </p>
          </div>
        </div>
        <AdminStundenFreigabe />
      </section>

      <hr className="border-muted" />

      {/* Section 2: Monatsabschluss */}
      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-sky-100 p-2 flex-none">
            <CalendarCheck className="h-5 w-5 text-sky-700" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">2. Monatsabschluss</h2>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Wenn alle Tage eines Monats freigegeben (oder exportiert) sind,
              schließt du den Monat ab: Soll-Stunden (aus Kalender) werden gegen
              die Ist-Stunden gerechnet, die Differenz landet als Buchung im
              Zeitausgleichs-Konto, und der Monat wird gesperrt — damit
              nachträgliche Änderungen nicht mehr möglich sind.
            </p>
          </div>
        </div>
        <AdminMonatsabschluss />
      </section>
    </div>
  );
}
