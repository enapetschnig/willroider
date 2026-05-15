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

export function calcArbeitsstunden(
  start: string | null | undefined,
  end: string | null | undefined,
  pauseVon: string | null | undefined,
  pauseBis: string | null | undefined
): number {
  if (!start || !end) return 0;
  const s = timeToMin(start);
  const e = timeToMin(end);
  if (e <= s) return 0;
  let total = e - s;
  if (pauseVon && pauseBis) {
    const pv = timeToMin(pauseVon);
    const pb = timeToMin(pauseBis);
    if (pb > pv) {
      const overlap = Math.max(0, Math.min(e, pb) - Math.max(s, pv));
      total -= overlap;
    }
  }
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
