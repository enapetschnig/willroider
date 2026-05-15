export function timeToMin(t: string | null | undefined): number {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function subtractPauseOverlap(
  s: number,
  e: number,
  pVon: string | null | undefined,
  pBis: string | null | undefined
): number {
  if (!pVon || !pBis) return 0;
  const pv = timeToMin(pVon);
  const pb = timeToMin(pBis);
  if (pb <= pv) return 0;
  return Math.max(0, Math.min(e, pb) - Math.max(s, pv));
}

export function calcArbeitsstunden(
  start: string | null | undefined,
  end: string | null | undefined,
  pauseVon: string | null | undefined,
  pauseBis: string | null | undefined,
  pauseVmVon?: string | null | undefined,
  pauseVmBis?: string | null | undefined
): number {
  if (!start || !end) return 0;
  const s = timeToMin(start);
  const e = timeToMin(end);
  if (e <= s) return 0;
  let total = e - s;
  total -= subtractPauseOverlap(s, e, pauseVon, pauseBis);
  total -= subtractPauseOverlap(s, e, pauseVmVon, pauseVmBis);
  return Math.max(0, total) / 60;
}

export const fmtTime = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");
export const fmtH = (n: number) => `${n.toFixed(2).replace(".", ",")} h`;

// Auf nächste 15 Min runden — defensiv gegen leere Inputs / NaN
export function snap15(t: string | null | undefined): string {
  if (!t || typeof t !== "string" || !t.trim()) return "07:00";
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return "07:00";
  const total = h * 60 + m;
  const rounded = Math.round(total / 15) * 15;
  const clamped = Math.max(0, Math.min(23 * 60 + 45, rounded));
  return minToTime(clamped);
}

export function shiftTime(t: string, deltaMin: number): string {
  const cur = timeToMin(t);
  const next = Math.max(0, Math.min(23 * 60 + 45, cur + deltaMin));
  return minToTime(next);
}

// Überlappung in Minuten (für Konflikt-Erkennung)
export function overlapMin(
  aS: string | null | undefined,
  aE: string | null | undefined,
  bS: string | null | undefined,
  bE: string | null | undefined
): number {
  if (!aS || !aE || !bS || !bE) return 0;
  const aSm = timeToMin(aS);
  const aEm = timeToMin(aE);
  const bSm = timeToMin(bS);
  const bEm = timeToMin(bE);
  return Math.max(0, Math.min(aEm, bEm) - Math.max(aSm, bSm));
}

export const DEFAULT_START = "07:00";
export const DEFAULT_END = "15:30";
export const DEFAULT_PAUSE_VON = "12:00";
export const DEFAULT_PAUSE_BIS = "12:30";
export const DEFAULT_PAUSE_VM_VON = "09:00";
export const DEFAULT_PAUSE_VM_BIS = "09:20";

/** ISO-Wochennummer + ISO-Jahr für ein Datum berechnen (laut ISO 8601). */
export function isoWeekParts(date: Date): { jahr: number; kw: number } {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // Donnerstag dieser Woche
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const isoYear = d.getFullYear();
  const week1 = new Date(isoYear, 0, 4);
  const diffDays = Math.round((d.getTime() - week1.getTime()) / 86400000);
  const kw = 1 + Math.round((diffDays - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return { jahr: isoYear, kw };
}

/** Mo=0, Di=1, ..., So=6 — passend zu soll_mo..soll_so der arbeitszeitkalender-Tabelle. */
export function weekdayIndexMonFirst(date: Date): number {
  // JS: 0=Sun, 1=Mon, ..., 6=Sat → wir wollen 0=Mon..6=Sun
  return (date.getDay() + 6) % 7;
}
