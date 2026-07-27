/**
 * Planungs-Helpers: der EINZIGE Zugriff auf „wer arbeitet wann wo".
 *
 * Alles läuft über die Datenbank-Funktion `plan_fuer_tag(datum)`
 * (Migration 20260727000000_planung_sichtbarkeit.sql). Sie beantwortet die
 * Frage verbindlich und für alle Ansichten gleich:
 *
 *   Tagesplanung (einteilungen)   ← konkret für den Tag geplant
 *   sonst Poliereinsatz           ← Partie → Baustelle, nur an Arbeitstagen
 *   Abwesenheit                   ← wird immer mitgeliefert
 *
 * Vorher leitete jede Stelle das selbst ab (Stunden, Mein Tag, Berichte,
 * Tagesplanung) — vier Ableitungen, vier Gelegenheiten auseinanderzulaufen.
 *
 * Die Reichweite steckt in der DB-Funktion: Admin/Büro sehen alle,
 * Partieleiter ihre Partie, alle anderen nur sich selbst.
 */

import { supabase } from "@/integrations/supabase/client";

/** Woher die Zuordnung stammt — für den Herkunftshinweis in der Oberfläche. */
export type PlanQuelle = "tagesplanung" | "poliereinsatz" | "abwesenheit";

export interface PlanEintrag {
  mitarbeiter_id: string;
  /** null nur bei quelle === "abwesenheit" (abwesend ohne jede Planung). */
  baustelle_id: string | null;
  taetigkeit: string | null;
  /** null, wenn die Zuordnung aus dem Poliereinsatz abgeleitet wurde. */
  einteilung_id: string | null;
  quelle: PlanQuelle;
  abwesend: boolean;
  /** "urlaub" | "krank" | "schlechtwetter", sonst null. */
  abwesenheit_art: string | null;
}

const QUELLE_LABEL: Record<PlanQuelle, string> = {
  tagesplanung: "aus Tagesplanung",
  poliereinsatz: "aus Poliereinsatz",
  abwesenheit: "abwesend",
};

/** Kurzer Herkunftshinweis für die Oberfläche. */
export function planQuelleLabel(quelle: PlanQuelle): string {
  return QUELLE_LABEL[quelle] ?? "";
}

/**
 * Der Plan für einen Tag, so weit der angemeldete Nutzer ihn sehen darf.
 *
 * Liefert bei Fehlern ein leeres Array statt zu werfen — die Vorbelegung
 * ist eine Bequemlichkeit, sie darf keine Seite blockieren.
 */
export async function getPlanFuerTag(datum: string): Promise<PlanEintrag[]> {
  if (!datum) return [];
  // Die generierten Supabase-Typen kennen keine Functions (Functions: never),
  // deshalb der Cast — dasselbe Muster wie bei den übrigen RPC-Aufrufen.
  const { data, error } = await (supabase.rpc as any)("plan_fuer_tag", {
    p_datum: datum,
  });
  if (error || !data) {
    if (error) console.warn("plan_fuer_tag fehlgeschlagen:", error.message);
    return [];
  }
  return (data as any[]).map((r) => ({
    mitarbeiter_id: r.mitarbeiter_id,
    baustelle_id: r.baustelle_id ?? null,
    taetigkeit: r.taetigkeit ?? null,
    einteilung_id: r.einteilung_id ?? null,
    quelle: (r.quelle ?? "tagesplanung") as PlanQuelle,
    abwesend: !!r.abwesend,
    abwesenheit_art: r.abwesenheit_art ?? null,
  }));
}

export interface MaTagesEinteilung {
  baustelle_id: string;
  /** null, wenn die Baustelle aus dem Poliereinsatz kommt. */
  einteilung_id: string | null;
  taetigkeit: string | null;
  quelle: PlanQuelle;
}

/**
 * Die Baustelle(n) eines einzelnen Mitarbeiters an einem Tag.
 *
 * Schmaler Aufsatz auf {@link getPlanFuerTag} — damit Aufrufer, die nur
 * eine Person brauchen (Berichte-Dialog), dieselbe Quelle benutzen.
 * Abwesende ohne Baustelle liefern nichts.
 */
export async function getBaustellenForMaToday(
  mitarbeiterId: string,
  datum: string,
): Promise<MaTagesEinteilung[]> {
  if (!mitarbeiterId || !datum) return [];
  const plan = await getPlanFuerTag(datum);
  return plan
    .filter((p) => p.mitarbeiter_id === mitarbeiterId && p.baustelle_id)
    .map((p) => ({
      baustelle_id: p.baustelle_id as string,
      einteilung_id: p.einteilung_id,
      taetigkeit: p.taetigkeit,
      quelle: p.quelle,
    }));
}

/** Was zum Sortieren einer Partie gebraucht wird. */
export interface PartieReihenfolge {
  sort_order: number | null;
  name: string;
}

/**
 * Die Reihenfolge der Polierplanung: `sort_order`, dann Name.
 *
 * Partien ohne `sort_order` stehen hinten (aktuell Sirnitzer und Büro) —
 * bewusst so, damit Tagesplan und Poliereinsatz-Gantt dieselbe Abfolge
 * zeigen. Diese Funktion ist die EINZIGE Definition dieser Reihenfolge;
 * vorher stand der Vergleich in PoliereinsatzView und in useTagesplanung
 * getrennt und lief auseinander.
 */
export function vergleichePartien(
  a: PartieReihenfolge | null | undefined,
  b: PartieReihenfolge | null | undefined,
): number {
  const sa = a?.sort_order ?? 9999;
  const sb = b?.sort_order ?? 9999;
  if (sa !== sb) return sa - sb;
  return (a?.name ?? "zzz").localeCompare(b?.name ?? "zzz");
}

/**
 * Baustelle je Partie an einem Tag, direkt aus dem Poliereinsatz.
 *
 * Für die Planungsansichten (Tagesplanung, Reihenfolge der Baustellen),
 * die nicht nach Mitarbeitern, sondern nach Partien sortieren. Bei mehreren
 * laufenden Zeiträumen gewinnt der früher begonnene — das ist die
 * Hauptbaustelle der Partie.
 */
export async function getPoliereinsatzFuerTag(
  datum: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!datum) return out;
  const { data } = await supabase
    .from("poliereinsatz_zeitraeume")
    .select("partie_id, baustelle_id, von_datum")
    .lte("von_datum", datum)
    .gte("bis_datum", datum)
    // Früher begonnene zuerst — der erste Treffer je Partie gewinnt.
    .order("von_datum", { ascending: true });
  ((data as any[]) ?? []).forEach((z) => {
    if (!z.partie_id || !z.baustelle_id) return;
    if (!out.has(z.partie_id)) out.set(z.partie_id, z.baustelle_id);
  });
  return out;
}
