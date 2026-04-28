// Österreichische gesetzliche Feiertage + Kärntner Landesfeiertage
// Berechnet alle beweglichen (Ostern-relativen) und fixen Feiertage.

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Gauss/Butcher-Algorithmus — Datum des Ostersonntags
function easterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

export type FeiertagInfo = {
  name: string;
  /** "bundesweit" (gesetzlich AT) oder "kaernten" (Landesfeiertag) */
  scope: "bundesweit" | "kaernten";
};

/**
 * Liefert eine Map iso-date → FeiertagInfo für ein Jahr in Österreich.
 * Inklusive Kärntner Landesfeiertag (10. Oktober).
 */
export function austrianHolidays(year: number): Map<string, FeiertagInfo> {
  const map = new Map<string, FeiertagInfo>();
  const easter = easterDate(year);
  const relative = (offset: number, name: string, scope: FeiertagInfo["scope"] = "bundesweit") => {
    const d = new Date(easter);
    d.setDate(d.getDate() + offset);
    map.set(isoOf(d), { name, scope });
  };
  const fixed = (m: number, d: number, name: string, scope: FeiertagInfo["scope"] = "bundesweit") => {
    map.set(`${year}-${pad(m)}-${pad(d)}`, { name, scope });
  };

  // Bundesweit
  fixed(1, 1, "Neujahr");
  fixed(1, 6, "Heilige Drei Könige");
  relative(1, "Ostermontag");
  fixed(5, 1, "Staatsfeiertag");
  relative(39, "Christi Himmelfahrt");
  relative(50, "Pfingstmontag");
  relative(60, "Fronleichnam");
  fixed(8, 15, "Mariä Himmelfahrt");
  fixed(10, 26, "Nationalfeiertag");
  fixed(11, 1, "Allerheiligen");
  fixed(12, 8, "Mariä Empfängnis");
  fixed(12, 25, "Christtag");
  fixed(12, 26, "Stefanitag");

  // Kärntner Landesfeiertag (Tag der Volksabstimmung)
  fixed(10, 10, "10. Oktober (Tag der Volksabstimmung)", "kaernten");

  return map;
}

// In-Memory-Cache pro Jahr — verhindert wiederholte Berechnungen
const cache = new Map<number, Map<string, FeiertagInfo>>();
function getCachedYear(year: number) {
  let m = cache.get(year);
  if (!m) {
    m = austrianHolidays(year);
    cache.set(year, m);
  }
  return m;
}

/** Schnell-Lookup: ist `iso` ein Feiertag? Liefert FeiertagInfo oder null. */
export function feiertagAt(iso: string): FeiertagInfo | null {
  const year = Number(iso.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  return getCachedYear(year).get(iso) ?? null;
}

/** Alle Feiertage zwischen zwei ISO-Daten (inklusive). */
export function feiertageInRange(fromIso: string, toIso: string): { iso: string; info: FeiertagInfo }[] {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (to < from) return [];
  const out: { iso: string; info: FeiertagInfo }[] = [];
  for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
    for (const [iso, info] of getCachedYear(y).entries()) {
      if (iso >= fromIso && iso <= toIso) out.push({ iso, info });
    }
  }
  out.sort((a, b) => a.iso.localeCompare(b.iso));
  return out;
}
