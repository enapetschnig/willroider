/**
 * 5 große farbige Toggle-Buttons (Baustelle / Firma / Krank / Urlaub /
 * Schlechtwetter). Klick = Art an/aus für den Kontext (1 MA oder alle).
 */

import { Wrench } from "lucide-react";
import type { TagStatus } from "@/integrations/supabase/types";
import {
  STATUS_OPTIONS,
  STATUS_ICONS,
  STATUS_LABELS,
  STATUS_COLORS,
  STATUS_OUTLINE,
} from "./zeiterfassungUi";

export function StatusButtonsLeiste({
  fuerAnzahl,
  aktiveArten,
  onToggle,
  optionen = STATUS_OPTIONS,
  kategorie,
}: {
  fuerAnzahl: number;
  aktiveArten: Set<TagStatus>;
  onToggle: (art: TagStatus) => void;
  /** Welche Arten als Toggles zeigen. Default: alle 5. */
  optionen?: TagStatus[];
  /** Bei `'maschine'` wird der baustelle-Button zu „Maschine" (Wrench-Icon). */
  kategorie?: "baustelle" | "maschine";
}) {
  const istMaschine = kategorie === "maschine";
  const cols =
    optionen.length === 5
      ? "grid-cols-5"
      : optionen.length === 4
        ? "grid-cols-4"
        : optionen.length === 3
          ? "grid-cols-3"
          : "grid-cols-2";
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] text-muted-foreground">
        {fuerAnzahl === 1
          ? "Antippen = anschalten, nochmal antippen = ausschalten."
          : `Antippen schaltet die Art für alle ${fuerAnzahl} Mitarbeiter an/aus.`}
      </div>
      <div className={`grid ${cols} gap-1.5`}>
        {optionen.map((art) => {
          const istMaschBtn = istMaschine && art === "baustelle";
          const Icon = istMaschBtn ? Wrench : STATUS_ICONS[art];
          const label = istMaschBtn ? "Maschine" : STATUS_LABELS[art];
          const aktiv = aktiveArten.has(art);
          return (
            <button
              key={art}
              type="button"
              onClick={() => onToggle(art)}
              aria-pressed={aktiv}
              className={`h-20 rounded-lg border-2 flex flex-col items-center justify-center gap-1 shadow-sm active:scale-[0.97] transition ${
                aktiv ? STATUS_COLORS[art] : STATUS_OUTLINE[art]
              }`}
            >
              <Icon className="h-6 w-6" />
              <span className="text-[10px] sm:text-xs font-semibold leading-none">
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
