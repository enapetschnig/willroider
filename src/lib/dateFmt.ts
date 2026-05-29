// Lokale ISO-Datumsformatierung (YYYY-MM-DD).
// KEIN toISOString() — sonst Timezone-Bug:
// In CEST (UTC+2) wird 1. Mai 00:00 lokal zu 30. April 22:00 UTC,
// und toISOString().slice(0,10) liefert "2026-04-30" statt "2026-05-01".
// localIso nimmt die lokalen Komponenten und liefert immer das tatsächliche
// Datum, das der User sieht.

export const localIso = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Zählt Werktage (Mo–Fr) zwischen einem ISO-Datum in der Vergangenheit
 *  und heute. Feiertage sind hier (bewusst) nicht ausgeklammert — bei
 *  Karenzfrist-Logik ist ein Off-by-One durch Feiertag pragmatisch ok. */
export function werktageSeit(iso: string): number {
  const start = new Date(iso + "T00:00:00");
  const ende = new Date();
  ende.setHours(0, 0, 0, 0);
  if (ende <= start) return 0;
  let cnt = 0;
  const cur = new Date(start);
  while (cur < ende) {
    cur.setDate(cur.getDate() + 1);
    const wd = cur.getDay();
    if (wd !== 0 && wd !== 6) cnt++;
  }
  return cnt;
}
