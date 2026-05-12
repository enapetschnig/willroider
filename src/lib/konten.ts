import { supabase } from "@/integrations/supabase/client";
import { feiertagAt } from "@/lib/feiertage";

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
