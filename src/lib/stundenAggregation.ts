/**
 * Aggregationen für die Stundenauswertung pro Mitarbeiter pro Monat:
 *   - Tätigkeiten-Summen (welche Arbeit wie oft, in Stunden)
 *   - Zulagen-Summen (Schmutz, Höhe, Aufsicht, ...)
 *   - Taggeld-Summen (kurz/lang, in € umgerechnet)
 *
 * Quelle: StundenTagFull[] aus useStundenTageList — bereits inkl. children.
 * Liefert reine Daten, keine UI — wird gleichermaßen in der Detail-View, im
 * CSV-Export und im PDF-Stundenzettel verwendet.
 */

import type { StundenTagFull } from "@/hooks/useStundenTag";
import { berechneTaggeld } from "@/lib/taggeld";

/** Standard-Bau-KV-Sätze (in €). Bei KV-Update hier ändern. */
export const TAGGELD_SATZ_KURZ_EUR = 12.6;
export const TAGGELD_SATZ_LANG_EUR = 20.3;

/** Pausen-Dauern (Minuten) — für die Brutto-/Taggeld-Berechnung. */
export interface PausenDauer {
  vmDauerMin: number;
  mittagDauerMin: number;
}

export interface TaetigkeitName {
  id: string;
  bezeichnung: string;
}

export interface ZulagenTypName {
  id: string;
  bezeichnung: string;
}

export interface AggTaetigkeit {
  bezeichnung: string;
  summe_stunden: number;
}

export interface AggZulage {
  bezeichnung: string;
  summe_stunden: number;
  anzahl_tage: number;
}

export interface AggTaggeld {
  kurz_anzahl: number;
  lang_anzahl: number;
  kurz_eur: number;
  lang_eur: number;
  total_eur: number;
}

/** Tätigkeiten-Aggregation: gruppiert nach Tätigkeit-ID (oder Freitext-Bezeichnung).
 *  Sortiert nach Summe absteigend. */
export function aggregiereTaetigkeiten(
  tage: StundenTagFull[],
  stamm: TaetigkeitName[],
): AggTaetigkeit[] {
  const nameById = new Map(stamm.map((s) => [s.id, s.bezeichnung]));
  const map = new Map<string, AggTaetigkeit>();
  for (const t of tage) {
    for (const tt of t.taetigkeiten) {
      const bez =
        (tt.taetigkeit_id && nameById.get(tt.taetigkeit_id)) ||
        tt.taetigkeit_freitext ||
        "Sonstiges";
      const cur = map.get(bez) ?? { bezeichnung: bez, summe_stunden: 0 };
      cur.summe_stunden += Number(tt.stunden ?? 0);
      map.set(bez, cur);
    }
  }
  return Array.from(map.values())
    .map((v) => ({
      ...v,
      summe_stunden: Math.round(v.summe_stunden * 100) / 100,
    }))
    .filter((v) => v.summe_stunden > 0)
    .sort((a, b) => b.summe_stunden - a.summe_stunden);
}

/** Zulagen-Aggregation: pro Zulagen-Typ Summe Stunden + Anzahl Tage. */
export function aggregiereZulagen(
  tage: StundenTagFull[],
  typen: ZulagenTypName[],
): AggZulage[] {
  const nameById = new Map(typen.map((t) => [t.id, t.bezeichnung]));
  const map = new Map<string, { summe: number; tage: Set<string> }>();
  for (const t of tage) {
    for (const z of t.zulagen) {
      const bez = nameById.get(z.zulagen_typ_id) ?? "Unbekannt";
      const cur = map.get(bez) ?? { summe: 0, tage: new Set<string>() };
      cur.summe += Number(z.stunden ?? 0);
      cur.tage.add(t.tag.datum);
      map.set(bez, cur);
    }
  }
  return Array.from(map.entries())
    .map(([bezeichnung, v]) => ({
      bezeichnung,
      summe_stunden: Math.round(v.summe * 100) / 100,
      anzahl_tage: v.tage.size,
    }))
    .sort((a, b) => b.summe_stunden - a.summe_stunden);
}

/**
 * Taggeld für EINEN Tag — berechnet aus der reinen Baustellen-Zeit.
 * Maßgeblich ist die Summe der `art='baustelle'`-Einträge; Firma- und
 * Abwesenheits-Einträge zählen nicht. Bei `taggeld_manuell=true` wird der
 * gespeicherte stunden_fahrt-Wert respektiert (bewusster Override).
 *
 * Der `_pausen`-Parameter wird nicht mehr genutzt (Pausen entfallen),
 * bleibt aber erhalten, damit Altaufrufer kompilieren.
 */
export function taggeldFuerTag(
  t: StundenTagFull,
  _pausen?: PausenDauer,
  /** IDs der Maschinen-/Halle-Baustellen — deren Stunden zählen NICHT
   *  fürs Baustellen-Taggeld (Werkstatt-Arbeit gibt kein Taggeld). */
  maschinenIds?: Set<string>,
): { kurz: number; lang: number } {
  if (t.fahrt?.taggeld_manuell) {
    return {
      kurz: Number(t.fahrt.taggeld_kurz ?? 0),
      lang: Number(t.fahrt.taggeld_lang ?? 0),
    };
  }
  const baustelleStunden = t.taetigkeiten
    .filter(
      (tt) =>
        tt.art === "baustelle" &&
        !(maschinenIds && tt.baustelle_id && maschinenIds.has(tt.baustelle_id)),
    )
    .reduce((s, tt) => s + Number(tt.stunden ?? 0), 0);
  return berechneTaggeld(baustelleStunden, "baustelle");
}

/** Taggeld-Aggregation über mehrere Tage — berechnet pro Tag via taggeldFuerTag. */
export function aggregiereTaggeld(
  tage: StundenTagFull[],
  pausen: PausenDauer,
  satz_kurz_eur: number = TAGGELD_SATZ_KURZ_EUR,
  satz_lang_eur: number = TAGGELD_SATZ_LANG_EUR,
  maschinenIds?: Set<string>,
): AggTaggeld {
  let kurz = 0;
  let lang = 0;
  for (const t of tage) {
    const tg = taggeldFuerTag(t, pausen, maschinenIds);
    kurz += tg.kurz;
    lang += tg.lang;
  }
  const kurz_eur = Math.round(kurz * satz_kurz_eur * 100) / 100;
  const lang_eur = Math.round(lang * satz_lang_eur * 100) / 100;
  return {
    kurz_anzahl: kurz,
    lang_anzahl: lang,
    kurz_eur,
    lang_eur,
    total_eur: Math.round((kurz_eur + lang_eur) * 100) / 100,
  };
}

/** Privat gefahrene Kilometer eines Tages (aus stunden_fahrt). */
export function kmFuerTag(t: StundenTagFull): number {
  return t.fahrt?.privat_pkw ? Number(t.fahrt.km_gefahren ?? 0) : 0;
}

/** Kilometergeld eines Tages = privat gefahrene km × Satz. */
export function kilometergeldFuerTag(t: StundenTagFull, satzEur: number): number {
  return Math.round(kmFuerTag(t) * satzEur * 100) / 100;
}

/** Kilometergeld-Aggregation über mehrere Tage. */
export function aggregiereKilometergeld(
  tage: StundenTagFull[],
  satzEur: number,
): { km: number; eur: number } {
  const km = tage.reduce((s, t) => s + kmFuerTag(t), 0);
  return {
    km: Math.round(km * 10) / 10,
    eur: Math.round(km * satzEur * 100) / 100,
  };
}

/** Formatiert eine Tätigkeits-Liste eines Tages als kompakten Inline-Text:
 *  `"Holzbau 4.5h, Dämmarbeit 4.5h"`. */
export function fmtTaetigkeitenInline(
  t: StundenTagFull,
  stamm: TaetigkeitName[],
): string {
  const nameById = new Map(stamm.map((s) => [s.id, s.bezeichnung]));
  return t.taetigkeiten
    .map((tt) => {
      const bez =
        (tt.taetigkeit_id && nameById.get(tt.taetigkeit_id)) ||
        tt.taetigkeit_freitext ||
        "—";
      const h = Number(tt.stunden ?? 0);
      return `${bez} ${h}h`;
    })
    .join(", ");
}

/** Formatiert eine Zulagen-Liste eines Tages als kompakten Inline-Text. */
export function fmtZulagenInline(
  t: StundenTagFull,
  typen: ZulagenTypName[],
): string {
  const nameById = new Map(typen.map((tt) => [tt.id, tt.bezeichnung]));
  return t.zulagen
    .map((z) => {
      const bez = nameById.get(z.zulagen_typ_id) ?? "—";
      const h = z.stunden != null ? `${Number(z.stunden)}h` : "✓";
      return `${bez} ${h}`;
    })
    .join(", ");
}

/** Formatiert Euro-Beträge im de-AT-Format ("1.234,56 €"). */
export function fmtEur(n: number): string {
  return n.toLocaleString("de-AT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  });
}
