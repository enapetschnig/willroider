/**
 * CLT Massivholz (ZMP / Stora Enso Sylva). Plattentypen + Abbund-/
 * Zusatz-Leistungen + Transport-Pauschalen. 1:1 aus dem HTML-Original.
 *
 * Berechnung: EP €/m² = (Listenpreis nach Qualität + Abbund-Aufschlag)
 *   × (1 + cltAufschlag %). Zusatz-Leistungen + Transport werden separat
 *   addiert, ebenfalls × Aufschlag.
 */

export type CltQualitaet = "nvi" | "inv" | "vi";
export const CLT_QUAL_LABEL: Record<CltQualitaet, string> = {
  nvi: "Nichtsicht (NVI)",
  inv: "Industriesicht (INV)",
  vi: "Wohnsicht (VI)",
};

export interface CltPanel {
  id: number;
  nenn: number; // mm
  typ: string;
  schichten: number;
  nvi: number; // €/m²
  inv: number;
  vi: number;
}

export const CLT_PANELS: CltPanel[] = [
  { id: 0, nenn: 60, typ: "C3s", schichten: 3, nvi: 45.4, inv: 57.4, vi: 70.4 },
  { id: 1, nenn: 70, typ: "C3s", schichten: 3, nvi: 48.8, inv: 60.8, vi: 73.8 },
  { id: 2, nenn: 80, typ: "C3s", schichten: 3, nvi: 50.5, inv: 62.5, vi: 75.5 },
  { id: 3, nenn: 90, typ: "C3s", schichten: 3, nvi: 54.3, inv: 66.3, vi: 79.3 },
  { id: 4, nenn: 100, typ: "C3s", schichten: 3, nvi: 60.7, inv: 72.7, vi: 85.7 },
  { id: 5, nenn: 100, typ: "C5s", schichten: 5, nvi: 69.8, inv: 81.8, vi: 94.8 },
  { id: 6, nenn: 110, typ: "C3s", schichten: 3, nvi: 64.7, inv: 76.7, vi: 89.7 },
  { id: 7, nenn: 120, typ: "C3s", schichten: 3, nvi: 69.4, inv: 81.4, vi: 94.4 },
  { id: 8, nenn: 120, typ: "C5s", schichten: 5, nvi: 78.0, inv: 90.0, vi: 103.0 },
  { id: 9, nenn: 140, typ: "C5s", schichten: 5, nvi: 83.9, inv: 95.9, vi: 108.9 },
  { id: 10, nenn: 150, typ: "C5s", schichten: 5, nvi: 86.1, inv: 98.1, vi: 111.1 },
  { id: 11, nenn: 160, typ: "C5s", schichten: 5, nvi: 92.9, inv: 104.9, vi: 117.9 },
  { id: 12, nenn: 60, typ: "L3s", schichten: 3, nvi: 45.4, inv: 57.4, vi: 70.4 },
  { id: 13, nenn: 70, typ: "L3s", schichten: 3, nvi: 48.8, inv: 60.8, vi: 73.8 },
  { id: 14, nenn: 80, typ: "L3s", schichten: 3, nvi: 50.5, inv: 62.5, vi: 75.5 },
  { id: 15, nenn: 90, typ: "L3s", schichten: 3, nvi: 54.3, inv: 66.3, vi: 79.3 },
  { id: 16, nenn: 100, typ: "L3s", schichten: 3, nvi: 60.7, inv: 72.7, vi: 85.7 },
  { id: 17, nenn: 100, typ: "L5s", schichten: 5, nvi: 69.8, inv: 81.8, vi: 94.8 },
  { id: 18, nenn: 110, typ: "L3s", schichten: 3, nvi: 64.7, inv: 76.7, vi: 89.7 },
  { id: 19, nenn: 120, typ: "L3s", schichten: 3, nvi: 69.4, inv: 81.4, vi: 94.4 },
  { id: 20, nenn: 120, typ: "L5s", schichten: 5, nvi: 78.0, inv: 90.0, vi: 103.0 },
  { id: 21, nenn: 140, typ: "L5s", schichten: 5, nvi: 83.9, inv: 95.9, vi: 108.9 },
  { id: 22, nenn: 150, typ: "L5s", schichten: 5, nvi: 86.1, inv: 98.1, vi: 111.1 },
  { id: 23, nenn: 160, typ: "L5s", schichten: 5, nvi: 92.9, inv: 104.9, vi: 117.9 },
  { id: 24, nenn: 160, typ: "L5s-2", schichten: 5, nvi: 92.9, inv: 104.9, vi: 117.9 },
  { id: 25, nenn: 180, typ: "L5s", schichten: 5, nvi: 103.1, inv: 115.1, vi: 128.1 },
  { id: 26, nenn: 180, typ: "L7s", schichten: 7, nvi: 114.0, inv: 126.0, vi: 139.0 },
  { id: 27, nenn: 200, typ: "L5s", schichten: 5, nvi: 115.5, inv: 127.5, vi: 140.5 },
  { id: 28, nenn: 200, typ: "L7s", schichten: 7, nvi: 124.2, inv: 136.2, vi: 149.2 },
  { id: 29, nenn: 220, typ: "L7s-2", schichten: 7, nvi: 129.2, inv: 141.2, vi: 154.2 },
  { id: 30, nenn: 240, typ: "L7s", schichten: 7, nvi: 139.4, inv: 151.4, vi: 164.4 },
  { id: 31, nenn: 240, typ: "L7s-2", schichten: 7, nvi: 139.4, inv: 151.4, vi: 164.4 },
  { id: 32, nenn: 260, typ: "L7s-2", schichten: 7, nvi: 148.5, inv: 160.5, vi: 173.5 },
  { id: 33, nenn: 280, typ: "L7s-2", schichten: 7, nvi: 159.8, inv: 171.8, vi: 184.8 },
  { id: 34, nenn: 300, typ: "L8s-2", schichten: 8, nvi: 171.7, inv: 183.7, vi: 196.7 },
  { id: 35, nenn: 320, typ: "L8s-2", schichten: 8, nvi: 183.0, inv: 195.0, vi: 208.0 },
];

export interface CltLeistung {
  name: string;
  preis: number; // €/EH
  eh: string;
}

export const CLT_ABBUND: CltLeistung[] = [
  { name: "Formatschnitt (Standard, max 4 Elem/MP)", preis: 3.4, eh: "m²" },
  { name: "Deckenabbund mit Falzbrett", preis: 5.0, eh: "m²" },
  { name: "Deckenabbund mit Stufenfalz", preis: 7.0, eh: "m²" },
  { name: "Wandabbund (Türen/Fenster)", preis: 7.5, eh: "m²" },
  { name: "Wandabbund stehend (inkl. Falzfräsung)", preis: 11.0, eh: "m²" },
  { name: "Abbund ohne Kettensäge (NVI/INV)", preis: 2.5, eh: "m²" },
  { name: "Geringe Bauteilgröße < 6 m²", preis: 6.0, eh: "m²" },
];

export const CLT_ZUSATZ: CltLeistung[] = [
  { name: "Hebeschlaufen", preis: 4.0, eh: "Stk" },
  { name: "Hebeschlaufen mit Sackloch", preis: 10.0, eh: "Stk" },
  { name: "Falzbrett 27×150×5000mm", preis: 28.0, eh: "Stk" },
  { name: "Fräsungen (zerspantes Volumen)", preis: 1.6, eh: "dm³" },
  { name: "Bohrung klein (bis 40mm)", preis: 2.9, eh: "Stk" },
  { name: "Bohrung groß (41-160mm)", preis: 4.0, eh: "Stk" },
  { name: "Auslässe (Pfetten/Sparren/Träger)", preis: 15.5, eh: "Stk" },
  { name: "Kleinteile < 1 m²", preis: 15.0, eh: "Stk" },
  { name: "CNC Stop (Ausschnitt entfernen)", preis: 41.5, eh: "Stk" },
  { name: "Radius entfernen", preis: 3.5, eh: "Stk" },
  { name: "Bohrung für Hebesysteme (Sihga/Pitzl)", preis: 4.0, eh: "Stk" },
];

export const CLT_TRANSPORT: CltLeistung[] = [
  { name: "Standard-Aufleger bis 50 km", preis: 590, eh: "Fuhre" },
  { name: "Standard-Aufleger 50-150 km", preis: 830, eh: "Fuhre" },
  { name: "Standard-Aufleger 150-250 km", preis: 1230, eh: "Fuhre" },
  { name: "Standard-Aufleger über 250 km", preis: 1320, eh: "Fuhre" },
  { name: "Standard-Aufleger Tirol", preis: 1650, eh: "Fuhre" },
  { name: "Selbstabholungspauschale", preis: 55, eh: "pauschal" },
];

export interface CltZeile {
  typId: number;
  qual: CltQualitaet;
  abbund: string; // name aus CLT_ABBUND, oder leer
  menge: number; // m²
}

export interface CltState {
  zeilen: CltZeile[];
  zusatz: Record<number, number>; // index -> Anzahl
  transport: string; // name aus CLT_TRANSPORT oder ""
}

export const CLT_INITIAL: CltState = {
  zeilen: [],
  zusatz: {},
  transport: "",
};

/** Einkaufs-Basis €/m² (ZMP-Listenpreis + Abbund-Aufschlag) für eine Zeile. */
export function cltBaseM2(row: CltZeile): number {
  const p = CLT_PANELS.find((x) => x.id === row.typId);
  if (!p) return 0;
  let base = p[row.qual] || 0;
  const ab = CLT_ABBUND.find((a) => a.name === row.abbund);
  if (ab) base += ab.preis;
  return base;
}

/** Aufschlagsfaktor (cltAufschlag in %, Standard 0). */
export function cltFak(cltAufschlag: number): number {
  return 1 + (Number(cltAufschlag) || 0) / 100;
}

/** EP €/m² für die Zeile (mit Aufschlag). */
export function cltVKM2(row: CltZeile, cltAufschlag: number): number {
  return Math.round(cltBaseM2(row) * cltFak(cltAufschlag) * 100) / 100;
}

/** CLT-Gesamtsumme = Platten + Zusatz + Transport, alles mit Aufschlag. */
export function cltSum(state: CltState, cltAufschlag: number): number {
  const f = cltFak(cltAufschlag);
  let s = 0;
  for (const r of state.zeilen) s += cltVKM2(r, cltAufschlag) * (Number(r.menge) || 0);
  CLT_ZUSATZ.forEach((z, i) => {
    s += z.preis * f * (Number(state.zusatz[i]) || 0);
  });
  const tr = CLT_TRANSPORT.find((t) => t.name === state.transport);
  if (tr) s += tr.preis * f;
  return s;
}
