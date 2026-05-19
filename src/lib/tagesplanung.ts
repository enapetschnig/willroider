/**
 * Tagesplanung-Helpers: Source-of-Truth-Zugriff auf „wer arbeitet wann wo".
 *
 * Wird von Zeiterfassung (Stunden.tsx) und Berichten (Berichte.tsx) verwendet,
 * um die Baustelle des Mitarbeiters für den jeweiligen Tag vorauszuwählen.
 */

import { supabase } from "@/integrations/supabase/client";

export interface MaTagesEinteilung {
  baustelle_id: string;
  einteilung_id: string;
  taetigkeit: string | null;
}

/**
 * Liefert die Baustellen, denen ein MA an einem bestimmten Tag laut Tagesplanung
 * zugewiesen ist.
 *
 * Üblicherweise 0 oder 1 Eintrag pro MA pro Tag. Bei V2-Halbtags-Splits liefert
 * die Funktion ein Array — Reihenfolge nach Einteilungs-Erstellung.
 *
 * Greift egal ob Plan freigegeben oder nicht — Stunden/Berichte sollen schon
 * vor Freigabe eine sinnvolle Vorauswahl bekommen.
 */
export async function getBaustellenForMaToday(
  mitarbeiterId: string,
  datum: string,
): Promise<MaTagesEinteilung[]> {
  if (!mitarbeiterId || !datum) return [];
  const { data, error } = await supabase
    .from("einteilung_mitarbeiter")
    .select(
      "einteilung_id, einteilung:einteilungen!inner(datum, baustelle_id, taetigkeit)",
    )
    .eq("mitarbeiter_id", mitarbeiterId)
    .eq("einteilung.datum", datum);
  if (error || !data) return [];
  return (data as any[])
    .filter((r) => r.einteilung?.baustelle_id)
    .map((r) => ({
      baustelle_id: r.einteilung.baustelle_id,
      einteilung_id: r.einteilung_id,
      taetigkeit: r.einteilung.taetigkeit ?? null,
    }));
}
