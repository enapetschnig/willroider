/**
 * Liste erfasster Stunden-Tage mit Status-Punkt.
 *
 * Vorher stand dieser Block als loses JSX mitten in Stunden.tsx. Er wird
 * jetzt an zwei Stellen gebraucht — in der Erfassung („Meine letzten Tage")
 * und in „Mein Tag" — und ist deshalb eine Komponente: eine Darstellung,
 * zwei Orte, nichts läuft auseinander.
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { fmtH } from "@/lib/zeiterfassung";
import { STATUS_LABELS } from "./zeiterfassungUi";
import type { StundenTagFull } from "@/hooks/useStundenTag";

/** Ampel für den Freigabe-Weg eines Tages. */
export function tagStatusAnzeige(status: string | null | undefined) {
  const istFreigegeben = status === "buero_freigabe" || status === "exportiert";
  const istBestaetigt = status === "ma_bestaetigt" || status === "zm_freigabe";
  const istOffen = status === "erfasst";
  const istAbgelehnt = status === "abgelehnt";
  return {
    istOffen,
    punkt: istFreigegeben
      ? "bg-emerald-500"
      : istBestaetigt
      ? "bg-sky-500"
      : istAbgelehnt
      ? "bg-red-500"
      : istOffen
      ? "bg-amber-500"
      : "bg-muted-foreground/40",
    label: istFreigegeben
      ? "freigegeben"
      : istBestaetigt
      ? "bestätigt"
      : istAbgelehnt
      ? "abgelehnt"
      : istOffen
      ? "offen"
      : (status ?? ""),
    badge: istFreigegeben
      ? "border-emerald-400 text-emerald-800 bg-emerald-50"
      : istBestaetigt
      ? "border-sky-300 text-sky-800 bg-sky-50"
      : istAbgelehnt
      ? "border-red-300 text-red-800 bg-red-50"
      : istOffen
      ? "border-amber-300 text-amber-800 bg-amber-50"
      : "",
  };
}

export function MeineStundenListe({
  tage,
  maxAnzahl,
  onDelete,
  /** Zeigt zusätzlich den Namen — für die Partie-Ansicht des Poliers. */
  nameFuer,
}: {
  tage: StundenTagFull[];
  maxAnzahl?: number;
  onDelete?: (t: StundenTagFull) => void;
  nameFuer?: (mitarbeiterId: string) => string | null;
}) {
  const sichtbar = maxAnzahl ? tage.slice(0, maxAnzahl) : tage;

  if (sichtbar.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic px-2 py-3">
        Noch keine Stunden erfasst.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {sichtbar.map((t) => {
        const s = tagStatusAnzeige(t.tag.status);
        const name = nameFuer?.(t.tag.mitarbeiter_id);
        return (
          <div
            key={t.tag.id}
            className="flex items-center gap-2 text-xs rounded px-2 py-1.5 bg-muted/40"
          >
            <span
              className={`inline-block h-2 w-2 rounded-full shrink-0 ${s.punkt}`}
              aria-hidden
            />
            <span className="font-bold tabular-nums shrink-0">
              {fmtH(Number(t.tag.netto_stunden))}
            </span>
            <span className="text-muted-foreground tabular-nums shrink-0">
              {new Date(t.tag.datum).toLocaleDateString("de-AT", {
                weekday: "short",
                day: "2-digit",
                month: "2-digit",
              })}
            </span>
            {name && (
              <span className="font-medium shrink-0 truncate max-w-[9rem]">{name}</span>
            )}
            <Badge variant="outline" className="text-[10px]">
              {STATUS_LABELS[t.tag.tag_status]}
            </Badge>
            <Badge variant="outline" className={`text-[10px] ${s.badge}`}>
              {s.label}
            </Badge>
            <span className="flex-1" />
            {s.istOffen && onDelete && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-destructive"
                onClick={() => onDelete(t)}
                aria-label="Tag löschen"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
