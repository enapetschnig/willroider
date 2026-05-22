/**
 * Vergleicht den bei Erzeugung des Baustellenstundenberichts gespeicherten
 * Snapshot mit den aktuellen (Live-)Stunden-Tagen und liefert die Datumswerte,
 * deren Einträge sich seither geändert haben. Diese Tage werden in Raster und
 * PDF gelb markiert.
 */

import type { StundenTagFull } from "@/hooks/useStundenTag";

export interface SnapshotEintrag {
  art: string;
  baustelle_id: string | null;
  taetigkeit_id: string | null;
  taetigkeit_freitext: string | null;
  stunden: number | string;
}

/** snapshot: Datum (YYYY-MM-DD) → Liste der Einträge bei Erzeugung. */
export type BerichtSnapshot = Record<string, SnapshotEintrag[]>;

function normEintrag(e: SnapshotEintrag): string {
  return [
    e.art,
    e.baustelle_id ?? "",
    e.taetigkeit_id ?? "",
    (e.taetigkeit_freitext ?? "").trim(),
    (Number(e.stunden) || 0).toFixed(2),
  ].join("|");
}

/** Deterministische Normalform einer Tages-Eintragsliste (reihenfolge-unabhängig). */
function normTag(entries: SnapshotEintrag[]): string {
  return entries.map(normEintrag).sort().join(";");
}

/**
 * Liefert die Menge der Datumswerte, deren Einträge vom Snapshot abweichen
 * (hinzugefügt, entfernt oder verändert).
 */
export function geaenderteTage(
  snapshot: BerichtSnapshot | null | undefined,
  liveTage: StundenTagFull[],
): Set<string> {
  const snap = snapshot ?? {};
  const liveByDate = new Map<string, StundenTagFull>();
  for (const t of liveTage) liveByDate.set(t.tag.datum, t);

  const alleDaten = new Set<string>([
    ...Object.keys(snap),
    ...liveByDate.keys(),
  ]);

  const geaendert = new Set<string>();
  for (const datum of alleDaten) {
    const snapNorm = normTag(snap[datum] ?? []);
    const liveNorm = normTag(
      (liveByDate.get(datum)?.taetigkeiten ?? []) as SnapshotEintrag[],
    );
    if (snapNorm !== liveNorm) geaendert.add(datum);
  }
  return geaendert;
}
