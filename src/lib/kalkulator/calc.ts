/**
 * K3/K7-Preisermittlung nach ÖNORM B2061 — Mathematik aus dem
 * ursprünglichen HTML-Kalkulator.
 */

import type { Bereich, Position } from "./positionen";

export interface K3Satz {
  grundlohn: number;
  lnk: number;       // Lohnnebenkosten %
  unprod: number;    // unprod. Zeiten %
  ggk: number;       // Geschäftsgemeinkosten %
  bauzinsen: number;
  wagnis: number;
  gewinn: number;
}

export interface ProjektDaten {
  wandflaeche: number;
  wandtypen: number;
  geschosse: number;
  laser: boolean;
  std3d: number;
  punktwolke: boolean;
}

export const DEFAULT_PROJEKT: ProjektDaten = {
  wandflaeche: 300,
  wandtypen: 3,
  geschosse: 1,
  laser: false,
  std3d: 3,
  punktwolke: false,
};

export const DEFAULT_K3: Record<Bereich | "clt", K3Satz> = {
  dach:   { grundlohn: 18.5, lnk: 95, unprod: 8, ggk: 12, bauzinsen: 0.5, wagnis: 3, gewinn: 7 },
  decken: { grundlohn: 18.5, lnk: 95, unprod: 8, ggk: 12, bauzinsen: 0.5, wagnis: 3, gewinn: 7 },
  waende: { grundlohn: 18.5, lnk: 95, unprod: 8, ggk: 10, bauzinsen: 0.5, wagnis: 3, gewinn: 6 },
  regie:  { grundlohn: 18.5, lnk: 95, unprod: 8, ggk: 10, bauzinsen: 0.5, wagnis: 2, gewinn: 6 },
  clt:    { grundlohn: 18.5, lnk: 95, unprod: 8, ggk:  8, bauzinsen: 0.5, wagnis: 3, gewinn: 7 },
};

/** Mittellohnpreis €/h für eine Gruppe. */
export function mlp(k: K3Satz): number {
  return k.grundlohn * (1 + k.lnk / 100) * (1 + k.unprod / 100);
}

/** Gesamtzuschlag % (K2/K3) für eine Gruppe. */
export function gz(k: K3Satz): number {
  return k.ggk + k.bauzinsen + k.wagnis + k.gewinn;
}

export interface K7Override {
  aw?: number;        // Aufwandswert h/EH
  material?: number;  // €/EH
  geraete?: number;   // €/EH
  fremd?: number;     // €/EH
}

/** Berechnet K7-Preis (Lohn + Sonstiges + Zuschlag) — wenn ein Override
 *  da ist. Andernfalls null → Aufrufer fällt auf Basispreis zurück. */
export function k7Calc(
  k3: K3Satz,
  override: K7Override | undefined,
): { lohn: number; sonst: number; ep: number } | null {
  if (!override) return null;
  const aw = num(override.aw);
  const mat = num(override.material);
  const ger = num(override.geraete);
  const fr = num(override.fremd);
  if (aw <= 0 && mat <= 0 && ger <= 0 && fr <= 0) return null;
  const lohn = aw * mlp(k3);
  const sonst = mat + ger + fr;
  const ep = round2((lohn + sonst) * (1 + gz(k3) / 100));
  return { lohn, sonst, ep };
}

/** EP für die Anzeige: K7-Preis wenn vorhanden, sonst Basispreis. Für
 *  Stützen wird die Länge eingerechnet (Basis = 3 m). */
export function displayEP(
  p: Position,
  k3: K3Satz,
  override: K7Override | undefined,
  stuetzeLen: number,
): number {
  const calc = k7Calc(k3, override);
  let ep = calc ? calc.ep : p.base;
  if (p.isStuetze) {
    const l = Math.max(0.1, num(stuetzeLen));
    ep = round2((ep / 3) * l);
  }
  return ep;
}

/** Baustellengemeinkosten (BGK 36 01). */
export interface BGK {
  statik: number;
  werkplan: number;
  laser: number;
  punkt: number;
  werkplanH: number;
  total: number;
}
export function calcBGK(p: ProjektDaten): BGK {
  const statik = num(p.wandflaeche) * 0.81;
  let wh = num(p.wandtypen) * 2;
  const ge = num(p.geschosse);
  wh += ge === 2 ? 1 : ge >= 3 ? 2 : 0;
  wh += p.laser ? 2 : 0;
  wh = Math.max(4, wh);
  const werkplan = wh * 85;
  const laser = p.laser ? num(p.std3d) * 99 : 0;
  const punkt = p.punktwolke ? 446.88 : 0;
  return {
    statik,
    werkplan,
    laser,
    punkt,
    werkplanH: wh,
    total: statik + werkplan + laser + punkt,
  };
}

export function eur(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("de-AT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " €";
}

export function num(v: unknown): number {
  if (v == null || v === "") return 0;
  const x = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : 0;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
