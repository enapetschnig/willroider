/**
 * Orte zu einer österreichischen PLZ (Wunsch J. Maurer, 21.10.2026: „bei
 * der Adresse soll er den Ort automatisch übernehmen von der PLZ").
 *
 * Reihenfolge der Vorschläge:
 *   1. Orte, die in der App zu dieser PLZ schon eingetragen sind (häufigste
 *      zuerst) — so kennt die App auch Ortschaften wie „Laubendorf" (9872),
 *      die in Verzeichnissen nur als Gemeinde „Millstatt" stehen.
 *   2. zippopotam.us (freie PLZ-Datenbank, nur die PLZ wird abgefragt).
 */
import { supabase } from "@/integrations/supabase/client";

const cache = new Map<string, string[]>();

export async function orteZurPlz(plzRoh: string): Promise<string[]> {
  const plz = (plzRoh ?? "").trim();
  if (!/^\d{4}$/.test(plz)) return [];
  const schon = cache.get(plz);
  if (schon) return schon;

  const zaehler = new Map<string, number>();
  const zaehle = (o: unknown) => {
    const t = String(o ?? "").trim();
    if (t) zaehler.set(t, (zaehler.get(t) ?? 0) + 1);
  };
  const [{ data: b }, { data: h }] = await Promise.all([
    supabase.from("baustellen").select("ort").eq("plz", plz).not("ort", "is", null).limit(300),
    (supabase as any).from("baustellen").select("bauherr_ort").eq("bauherr_plz", plz).not("bauherr_ort", "is", null).limit(300),
  ]);
  ((b as { ort: string | null }[]) ?? []).forEach((r) => zaehle(r.ort));
  ((h as { bauherr_ort: string | null }[]) ?? []).forEach((r) => zaehle(r.bauherr_ort));
  const ausApp = [...zaehler.entries()].sort((a, c) => c[1] - a[1]).map(([o]) => o);

  let ausVerzeichnis: string[] = [];
  try {
    const r = await fetch(`https://api.zippopotam.us/at/${plz}`);
    if (r.ok) {
      const j = (await r.json()) as { places?: { "place name"?: string }[] };
      ausVerzeichnis = (j.places ?? []).map((p) => String(p["place name"] ?? "").trim()).filter(Boolean);
    }
  } catch {
    /* ohne Netz: nur die Vorschläge aus der App */
  }

  const gesehen = new Set<string>();
  const alle = [...ausApp, ...ausVerzeichnis].filter((o) => {
    const k = o.toLowerCase();
    if (gesehen.has(k)) return false;
    gesehen.add(k);
    return true;
  });
  cache.set(plz, alle);
  return alle;
}
