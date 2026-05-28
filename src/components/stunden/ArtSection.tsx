/**
 * Section pro Art (Baustelle/Firma/…) mit Tätigkeit-Splits darunter.
 * Bei `art = "baustelle"` steht die Baustelle einmal oben im Header und gilt
 * für alle Splits. Erklärungs-Notiz je Zeile.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import type { Database, TagStatus } from "@/integrations/supabase/types";
import { BaustelleCombobox } from "@/components/stunden/BaustelleCombobox";
import { StundenZelle } from "./StundenZelle";
import {
  ART_BORDER,
  STATUS_COLORS,
  STATUS_ICONS,
  STATUS_LABELS,
  istArbeitArt,
  type EintragRow,
} from "./zeiterfassungUi";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];

export function ArtSection({
  art,
  rows,
  baustellen,
  taetigkeitenStamm,
  onUpdate,
  onRemove,
  onAddSplit,
  onSectionBaustelle,
  kategorie = "baustelle",
}: {
  art: TagStatus;
  rows: EintragRow[];
  baustellen: Baustelle[];
  taetigkeitenStamm: Database["public"]["Tables"]["taetigkeiten_stamm"]["Row"][];
  onUpdate: (key: string, patch: Partial<EintragRow>) => void;
  onRemove: (key: string) => void;
  onAddSplit: () => void;
  onSectionBaustelle: (baustelle_id: string | null) => void;
  /** Filtert Combobox + setzt Label: 'maschine' für Halle-Erfassung. */
  kategorie?: "baustelle" | "maschine";
}) {
  const Icon = STATUS_ICONS[art];
  const arbeit = istArbeitArt(art);
  const sectionBaustelleId =
    art === "baustelle" ? rows[0]?.baustelle_id ?? null : null;
  const istMaschine = kategorie === "maschine";
  const artLabel =
    istMaschine && art === "baustelle" ? "Werk/Maschine" : STATUS_LABELS[art];
  return (
    <div
      className={`rounded-md border border-l-4 ${ART_BORDER[art]} bg-muted/15 overflow-hidden`}
    >
      <div className="px-2.5 py-1.5 flex items-center gap-2 bg-muted/30 border-b">
        <span
          className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded ${STATUS_COLORS[art]}`}
        >
          <Icon className="h-3 w-3" />
          {artLabel}
        </span>
      </div>

      {art === "baustelle" && (
        <div className="p-2.5 border-b bg-background/50">
          <BaustelleCombobox
            baustellen={baustellen}
            value={sectionBaustelleId ?? ""}
            onChange={(v) => onSectionBaustelle(v || null)}
            allowClear={!istMaschine}
            kategorie={kategorie}
          />
        </div>
      )}

      <div className="p-2.5 space-y-3">
        {rows.map((row) => (
          <div
            key={row.key}
            className="space-y-2 pb-3 border-b last:border-0 last:pb-0"
          >
            {arbeit && (
              <>
                <select
                  value={row.taetigkeit_id ?? ""}
                  onChange={(e) =>
                    onUpdate(row.key, { taetigkeit_id: e.target.value || null })
                  }
                  className="h-11 w-full rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">— Tätigkeit wählen —</option>
                  {taetigkeitenStamm.map((tt) => (
                    <option key={tt.id} value={tt.id}>
                      {tt.bezeichnung}
                    </option>
                  ))}
                </select>
                {!row.taetigkeit_id && (
                  <Input
                    placeholder="Oder Freitext"
                    value={row.taetigkeit_freitext}
                    onChange={(e) =>
                      onUpdate(row.key, { taetigkeit_freitext: e.target.value })
                    }
                    className="h-10 text-sm"
                  />
                )}
              </>
            )}

            <div className="flex items-center justify-between gap-2">
              <StundenZelle
                value={row.stunden}
                onChange={(v) => onUpdate(row.key, { stunden: v })}
              />
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive shrink-0 h-11 w-11 p-0"
                onClick={() => onRemove(row.key)}
                aria-label="Entfernen"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <Input
              placeholder="Erklärung (optional)"
              value={row.notiz}
              onChange={(e) => onUpdate(row.key, { notiz: e.target.value })}
              className="h-10 text-sm"
            />
          </div>
        ))}

        {arbeit && (
          <Button
            variant="outline"
            size="sm"
            className="w-full h-11"
            onClick={onAddSplit}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Tätigkeit
          </Button>
        )}
      </div>
    </div>
  );
}
