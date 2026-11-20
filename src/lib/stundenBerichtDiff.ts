/**
 * Vergleicht den gespeicherten Snapshot (bei Erzeugung; ab 20.11.2026 beim
 * Unterschreiben neu gezogen) mit den aktuellen (Live-)Stunden-Tagen und liefert die Datumswerte,
 * deren Einträge sich seither geändert haben. Diese Tage werden in Raster und
 * PDF gelb markiert.
 */

import type { StundenTagFull } from "@/hooks/useStundenTag";

export interface SnapshotEintrag {
  art: string;
  baustelle_id: string | null;
  /** Erst ab Juli 2026. Ältere Schnappschüsse haben das Feld nicht — beide
   *  Seiten normalisieren fehlend und null gleich, damit Altberichte nicht
   *  plötzlich als geändert (gelb) erscheinen. */
  ziel_baustelle_id?: string | null;
  /** Erst ab 05.10.2026; fehlend = „baustelle". */
  ort?: string | null;
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
    e.ziel_baustelle_id ?? "",
    // Nur „firma" zählt — fehlend und „baustelle" sind gleich, damit
    // Altberichte ohne Ort nicht gelb werden.
    e.ort === "firma" ? "firma" : "",
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
  status?: string | null,
): Set<string> {
  const snap = snapshot ?? {};
  // Vor der Unterschrift ist der Snapshot der Stand vom Erzeugen (16./Monatsletzter,
  // 19:00). Tage, die danach erst geschrieben werden (meist der letzte), sind keine
  // Änderung — sonst war fast immer der letzte Tag markiert (J. Maurer, 20.11.2026).
  // Ab der Unterschrift ist der Snapshot der unterschriebene Stand → alles zählt.
  const nurBekannteTage = status === "offen";
  const liveByDate = new Map<string, StundenTagFull>();
  for (const t of liveTage) liveByDate.set(t.tag.datum, t);

  const alleDaten = new Set<string>([
    ...Object.keys(snap),
    ...liveByDate.keys(),
  ]);

  const geaendert = new Set<string>();
  for (const datum of alleDaten) {
    if (nurBekannteTage && !(datum in snap)) continue;
    const snapNorm = normTag(snap[datum] ?? []);
    const liveNorm = normTag(
      (liveByDate.get(datum)?.taetigkeiten ?? []) as SnapshotEintrag[],
    );
    if (snapNorm !== liveNorm) geaendert.add(datum);
  }
  return geaendert;
}
