/**
 * Auto-Berechnung der Taggeld-Stufen (kleine / große Zulage).
 *
 * Regel (AT-Bau-KV-orientiert, vom User bestätigt: über/unter 9 Stunden):
 *   - tag_status !== 'baustelle' → kein Taggeld (Firma/Krank/Urlaub/SW/Feiertag)
 *   - brutto < 3 h               → kein Taggeld (Kurzeinsatz)
 *   - 3 h <= brutto < 9 h        → 1× Taggeld kurz
 *   - brutto >= 9 h              → 1× Taggeld lang
 *
 * Wird im Submit-Pfad von Stunden.tsx aufgerufen und in stunden_fahrt
 * gespeichert. Der MA selbst gibt das nicht ein — es wird automatisch
 * aus den eingetragenen Stunden + Pausen abgeleitet.
 *
 * Konstanten zentral hier — wenn die Firma andere Grenzen will, hier ändern.
 */

import type { TagStatus } from "@/integrations/supabase/types";

export const TAGGELD_GRENZE_MIN_STUNDEN = 3;
export const TAGGELD_GRENZE_LANG_STUNDEN = 9;

export interface TaggeldErgebnis {
  kurz: number;
  lang: number;
}

export function berechneTaggeld(
  bruttoStunden: number,
  tagStatus: TagStatus,
): TaggeldErgebnis {
  if (tagStatus !== "baustelle") return { kurz: 0, lang: 0 };
  if (!Number.isFinite(bruttoStunden) || bruttoStunden < TAGGELD_GRENZE_MIN_STUNDEN) {
    return { kurz: 0, lang: 0 };
  }
  if (bruttoStunden < TAGGELD_GRENZE_LANG_STUNDEN) return { kurz: 1, lang: 0 };
  return { kurz: 0, lang: 1 };
}

/** Kompaktes Label für UI-Anzeigen, z.B. "1× kurz" oder "1× lang" oder "—". */
export function fmtTaggeldLabel(t: TaggeldErgebnis): string {
  if (t.lang > 0) return `${t.lang}× lang`;
  if (t.kurz > 0) return `${t.kurz}× kurz`;
  return "—";
}
