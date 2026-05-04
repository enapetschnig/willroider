// Lokale ISO-Datumsformatierung (YYYY-MM-DD).
// KEIN toISOString() — sonst Timezone-Bug:
// In CEST (UTC+2) wird 1. Mai 00:00 lokal zu 30. April 22:00 UTC,
// und toISOString().slice(0,10) liefert "2026-04-30" statt "2026-05-01".
// localIso nimmt die lokalen Komponenten und liefert immer das tatsächliche
// Datum, das der User sieht.

export const localIso = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
