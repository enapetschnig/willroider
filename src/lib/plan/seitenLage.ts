/** Plan-Viewer: Lage der PDF-Seiten in der durchgehenden Ansicht (E. Winkler 18.11.2026). */
export type Seitenlage = { x: number; y: number; w: number; h: number };
export type Lage = { seiten: Seitenlage[]; W: number; H: number };

/** Alle Seiten untereinander, waagrecht mittig, mit Abstand (Einheit: PDF-Punkte). */
export function seitenLage(groessen: { w: number; h: number }[]): Lage {
  const W = Math.max(1, ...groessen.map((g) => g.w));
  const abstand = Math.max(12, W * 0.015);
  let y = 0;
  const seiten = groessen.map((g) => {
    const l = { x: (W - g.w) / 2, y, w: g.w, h: g.h };
    y += g.h + abstand;
    return l;
  });
  return { seiten, W, H: Math.max(1, y - abstand) };
}
