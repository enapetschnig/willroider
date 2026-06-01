/**
 * Bausatz-Kalkulator — eigenständiges Holzbau-Kalkulationstool von
 * Holzbau Willroider, eingebunden als iframe. Sichtbar nur für die
 * Geschäftsführung (Filter im AppShell + App.tsx).
 *
 * Das HTML-File liegt unter /public/bausatz-kalkulator.html und nutzt
 * intern eigene Login-Codes (KUNDE-2026, MA-2026, ADMIN-2026) plus
 * localStorage für Kalkulations-Sätze.
 */

import { PageHeader } from "@/components/PageHeader";

export default function Kalkulator() {
  return (
    <div className="space-y-3">
      <PageHeader
        title="Bausatz-Kalkulator"
        description="Holzbau Willroider — Zimmermeisterarbeiten · K3/K7-Preisermittlung nach ÖNORM B2061"
      />
      <div className="rounded-md border bg-card overflow-hidden shadow-sm">
        <iframe
          src="/bausatz-kalkulator.html"
          title="Bausatz-Kalkulator"
          className="w-full"
          style={{ height: "calc(100vh - 200px)", minHeight: 600, border: 0 }}
        />
      </div>
    </div>
  );
}
