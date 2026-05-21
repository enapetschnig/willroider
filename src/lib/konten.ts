import { supabase } from "@/integrations/supabase/client";
import { feiertagAt } from "@/lib/feiertage";
import { localIso } from "@/lib/dateFmt";

export function fmtTage(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${Number(v).toFixed(2).replace(".", ",")} Tg`;
}

export function fmtStunden(v: number | null | undefined): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${Number(v).toFixed(2).replace(".", ",")} h`;
}

export const URLAUB_ART_LABEL: Record<string, string> = {
  initial: "Initial-Saldo",
  jahresgutschrift: "Jährliche Gutschrift",
  monatsgutschrift: "Monatliche Gutschrift",
  urlaub_genommen: "Urlaub genommen",
  korrektur: "Korrektur",
  verfall: "Verfall",
};

export const ZA_ART_LABEL: Record<string, string> = {
  initial: "Initial-Saldo",
  monatsabschluss: "Monatsabschluss",
  zeitausgleich_genommen: "Zeitausgleich genommen",
  korrektur: "Korrektur",
  auszahlung: "Auszahlung",
};

/** Werktage Mo-Fr (ohne Feiertage) im Monat zählen. */
export function werktageImMonat(year: number, monthOneBased: number): number {
  const start = new Date(year, monthOneBased - 1, 1);
  const end = new Date(year, monthOneBased, 1);
  let count = 0;
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay(); // 0 = So, 6 = Sa
    if (dow === 0 || dow === 6) continue;
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (feiertagAt(iso)) continue;
    count++;
  }
  return count;
}

export function sollStunden(
  year: number,
  monthOneBased: number,
  tagesnorm: number,
  beschaeftigungsgrad: number
): number {
  return werktageImMonat(year, monthOneBased) * tagesnorm * beschaeftigungsgrad;
}

// ─── Tag-/Monats-Soll laut Arbeitszeitkalender + Pro-MA-Modell ───

export type TagessollKalender = {
  jahr: number;
  kw: number;
  wochentyp: string;
  soll_mo: number | null;
  soll_di: number | null;
  soll_mi: number | null;
  soll_do: number | null;
  soll_fr: number | null;
  soll_sa: number | null;
  soll_so: number | null;
};

export type ArbeitszeitModell = "zimmerei_sommer" | "fix_40h" | "individuell";

/** ISO-8601-konformer KW-Helper (Donnerstag-Regel). */
export function isoToYearKw(date: Date): { jahr: number; kw: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const kw = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { jahr: d.getUTCFullYear(), kw };
}

/** Lädt alle KW-Einträge aus dem Arbeitszeitkalender für ein Jahr als Map. */
export async function ladeKalenderMap(
  year: number
): Promise<Map<string, TagessollKalender>> {
  const { data } = await supabase
    .from("arbeitszeitkalender")
    .select(
      "jahr, kw, wochentyp, soll_mo, soll_di, soll_mi, soll_do, soll_fr, soll_sa, soll_so"
    )
    .eq("jahr", year);
  const map = new Map<string, TagessollKalender>();
  ((data as any[]) ?? []).forEach((r) =>
    map.set(`${r.jahr}-${r.kw}`, r as TagessollKalender)
  );
  return map;
}

/**
 * Tages-Soll an einem konkreten Datum für einen Mitarbeiter.
 * Feiertage zählen aktuell mit ihrem Tages-Soll mit (User bucht F als
 * Fehlzeit mit gleicher Stundenzahl → Diff = 0).
 */
export function tagesSoll(
  isoDate: string,
  kalender: Map<string, TagessollKalender>,
  modell: ArbeitszeitModell,
  tagesnorm: number,
  beschaeftigungsgrad: number
): number {
  const d = new Date(isoDate + "T00:00:00");
  const dow = d.getDay(); // 0=So, 1=Mo, …, 6=Sa
  if (modell === "fix_40h") {
    return dow >= 1 && dow <= 5 ? 8 * beschaeftigungsgrad : 0;
  }
  if (modell === "individuell") {
    return dow >= 1 && dow <= 5 ? tagesnorm * beschaeftigungsgrad : 0;
  }
  // zimmerei_sommer
  const { jahr, kw } = isoToYearKw(d);
  const k = kalender.get(`${jahr}-${kw}`);
  if (!k) {
    return dow >= 1 && dow <= 5 ? tagesnorm * beschaeftigungsgrad : 0;
  }
  const map: (number | null)[] = [
    k.soll_so,
    k.soll_mo,
    k.soll_di,
    k.soll_mi,
    k.soll_do,
    k.soll_fr,
    k.soll_sa,
  ];
  const v = map[dow];
  return (v ?? 0) * beschaeftigungsgrad;
}

/** Summe aller Tages-Soll-Werte für einen Monat. */
export function monatsSoll(
  year: number,
  monthOneBased: number,
  kalender: Map<string, TagessollKalender>,
  modell: ArbeitszeitModell,
  tagesnorm: number,
  beschaeftigungsgrad: number
): number {
  let total = 0;
  const start = new Date(year, monthOneBased - 1, 1);
  const end = new Date(year, monthOneBased, 1);
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    total += tagesSoll(
      localIso(d),
      kalender,
      modell,
      tagesnorm,
      beschaeftigungsgrad
    );
  }
  return total;
}

/**
 * Summe der Tages-Soll-Werte über einen beliebigen Datumsbereich (inkl.
 * beider Grenzen). Für Halbmonats-/Periodenauswertungen. Identische Logik
 * wie monatsSoll, nur mit freiem from/to.
 */
export function periodeSoll(
  fromIso: string,
  toIso: string,
  kalender: Map<string, TagessollKalender>,
  modell: ArbeitszeitModell,
  tagesnorm: number,
  beschaeftigungsgrad: number
): number {
  let total = 0;
  const d = new Date(fromIso + "T00:00:00");
  const end = new Date(toIso + "T00:00:00");
  while (d <= end) {
    total += tagesSoll(localIso(d), kalender, modell, tagesnorm, beschaeftigungsgrad);
    d.setDate(d.getDate() + 1);
  }
  return total;
}

export type UrlaubsSaldo = {
  mitarbeiter_id: string;
  saldo_tage: number;
  letzte_buchung: string | null;
};
export type ZaSaldo = {
  mitarbeiter_id: string;
  saldo_stunden: number;
  letzte_buchung: string | null;
};

export async function ladeUrlaubsSalden(): Promise<UrlaubsSaldo[]> {
  const { data } = await supabase.from("v_urlaubs_saldo" as any).select("*");
  return ((data as any[]) ?? []).map((r) => ({
    mitarbeiter_id: r.mitarbeiter_id,
    saldo_tage: Number(r.saldo_tage ?? 0),
    letzte_buchung: r.letzte_buchung ?? null,
  }));
}

export async function ladeZaSalden(): Promise<ZaSaldo[]> {
  const { data } = await supabase.from("v_za_saldo" as any).select("*");
  return ((data as any[]) ?? []).map((r) => ({
    mitarbeiter_id: r.mitarbeiter_id,
    saldo_stunden: Number(r.saldo_stunden ?? 0),
    letzte_buchung: r.letzte_buchung ?? null,
  }));
}
