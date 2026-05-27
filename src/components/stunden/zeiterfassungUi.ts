/**
 * Gemeinsame UI-Bausteine + Konstanten der Stunden-Erfassung.
 * Werden von der Vollerfassung (Stunden.tsx) UND vom Tages-Editor im
 * Baustellenstundenbericht (TagBearbeitenDialog) genutzt.
 */

import {
  Hammer,
  Sun,
  HeartPulse,
  CloudRain,
  Factory,
  Calendar,
} from "lucide-react";
import type { TagStatus } from "@/integrations/supabase/types";

export const STATUS_LABELS: Record<TagStatus, string> = {
  baustelle: "Baustelle",
  firma: "Firma",
  krank: "Krank",
  urlaub: "Urlaub",
  schlechtwetter: "Schlechtwetter",
  feiertag: "Feiertag",
};

export const STATUS_ICONS = {
  baustelle: Hammer,
  firma: Factory,
  krank: HeartPulse,
  urlaub: Sun,
  schlechtwetter: CloudRain,
  feiertag: Calendar,
};

/** Solider Farb-Stil (Knöpfe + Badges, aktiver Zustand). */
export const STATUS_COLORS: Record<TagStatus, string> = {
  baustelle: "bg-primary text-primary-foreground border-primary",
  firma: "bg-blue-500 text-white border-blue-500",
  krank: "bg-red-500 text-white border-red-500",
  urlaub: "bg-amber-500 text-white border-amber-500",
  schlechtwetter: "bg-sky-500 text-white border-sky-500",
  feiertag: "bg-violet-500 text-white border-violet-500",
};

/** Outline-Stil (Top-Toggle inaktiv) — gleiche Farbe, transparenter Hintergrund. */
export const STATUS_OUTLINE: Record<TagStatus, string> = {
  baustelle: "bg-background text-primary border-primary/40",
  firma: "bg-background text-blue-700 border-blue-200",
  krank: "bg-background text-red-700 border-red-200",
  urlaub: "bg-background text-amber-700 border-amber-200",
  schlechtwetter: "bg-background text-sky-700 border-sky-200",
  feiertag: "bg-background text-violet-700 border-violet-200",
};

/** Linke Akzent-Border je Eintrags-Art (für Section-Karten). */
export const ART_BORDER: Record<TagStatus, string> = {
  baustelle: "border-l-primary",
  firma: "border-l-blue-500",
  krank: "border-l-red-500",
  urlaub: "border-l-amber-500",
  schlechtwetter: "border-l-sky-500",
  feiertag: "border-l-violet-500",
};

/** Reihenfolge, in der Art-Sections im MA-Block dargestellt werden. */
export const ART_REIHENFOLGE: TagStatus[] = [
  "baustelle",
  "firma",
  "urlaub",
  "krank",
  "schlechtwetter",
  "feiertag",
];

/** Auswahl für die Top-Toggles (ohne Feiertag — wird automatisch vergeben). */
export const STATUS_OPTIONS: TagStatus[] = [
  "baustelle",
  "firma",
  "krank",
  "urlaub",
  "schlechtwetter",
];

/** Ein typisierter Eintrag im Tag eines Mitarbeiters. */
export interface EintragRow {
  key: string;
  art: TagStatus;
  baustelle_id: string | null;
  taetigkeit_id: string | null;
  taetigkeit_freitext: string;
  stunden: number;
  notiz: string;
}

export const istArbeitArt = (art: TagStatus) =>
  art === "baustelle" || art === "firma";

export const newKey = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

/** Rundet auf das nächste Viertelstunden-Raster (0,25 h). */
export const aufViertelstunde = (n: number) =>
  Math.round((Number(n) || 0) / 0.25) * 0.25;

/** Eine Art-Section im MA-Block (eine pro Art bei Abwesenheiten, ggf. mehrere
 *  bei Baustelle — eine je Baustellen-Auswahl). */
export interface ArtSectionData {
  /** stabiler Render-Key */
  key: string;
  art: TagStatus;
  /** Die Baustelle der Section (nur bei art=baustelle, sonst null). */
  baustelleId: string | null;
  rows: EintragRow[];
}

/** Gruppiert die Einträge eines Tages in Art-Sections.
 *  - Bei `baustelle`: Gruppierung nach `baustelle_id`. Zeilen mit
 *    `baustelle_id=null` bekommen je ihren eigenen Section-Key (mit ihrem
 *    `row.key`), damit zwei unausgefüllte Baustellen nicht mergen.
 *  - Bei anderen Arten: maximal eine Section pro Art. */
export function gruppiereSections(eintraege: EintragRow[]): ArtSectionData[] {
  const out: ArtSectionData[] = [];
  for (const art of ART_REIHENFOLGE) {
    if (art === "baustelle") {
      const groups = new Map<string, EintragRow[]>();
      for (const r of eintraege.filter((e) => e.art === "baustelle")) {
        const k = r.baustelle_id ?? `null:${r.key}`;
        const arr = groups.get(k);
        if (arr) arr.push(r);
        else groups.set(k, [r]);
      }
      for (const [key, rows] of groups) {
        out.push({
          key: `baustelle:${key}`,
          art,
          baustelleId: rows[0]?.baustelle_id ?? null,
          rows,
        });
      }
    } else {
      const rows = eintraege.filter((e) => e.art === art);
      if (rows.length > 0) {
        out.push({ key: art, art, baustelleId: null, rows });
      }
    }
  }
  return out;
}
