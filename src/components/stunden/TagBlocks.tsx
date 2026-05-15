import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { fmtH } from "@/lib/stundenTime";
import { TagBlockCard } from "./TagBlockCard";

type Stunde = Database["public"]["Tables"]["stundenbuchungen"]["Row"];
type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];

const fehlzeitLabel = (typ: string) =>
  typ === "U" ? "Urlaub" :
  typ === "K" ? "Krank" :
  typ === "F" ? "Feiertag" :
  typ === "SW" ? "Schlechtwetter" : typ;

const fehlzeitBadgeClass = (typ: string) =>
  typ === "U" ? "bg-amber-100 text-amber-900 border-amber-300" :
  typ === "K" ? "bg-red-100 text-red-900 border-red-300" :
  typ === "F" ? "bg-violet-100 text-violet-900 border-violet-300" :
  typ === "SW" ? "bg-sky-100 text-sky-900 border-sky-300" :
  "bg-muted text-foreground border-border";

export interface TagBlocksProps {
  rows: Stunde[];
  baustellen: Baustelle[];
  isMonthLocked: boolean;
  isAdmin: boolean;
  onEdit: (row: Stunde) => void;
  onDelete: (id: string) => void;
}

export function TagBlocks({
  rows,
  baustellen,
  isMonthLocked,
  isAdmin,
  onEdit,
  onDelete,
}: TagBlocksProps) {
  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      // Fehlzeiten ans Ende
      if (!!a.fehlzeit_typ !== !!b.fehlzeit_typ) {
        return a.fehlzeit_typ ? 1 : -1;
      }
      return (a.start_zeit ?? "").localeCompare(b.start_zeit ?? "");
    });
  }, [rows]);

  const summary = useMemo(() => {
    let arbeit = 0;
    const fehlzeit = new Map<string, number>();
    rows.forEach((r) => {
      if (r.fehlzeit_typ) {
        fehlzeit.set(
          r.fehlzeit_typ,
          (fehlzeit.get(r.fehlzeit_typ) ?? 0) + Number(r.fehlzeit_stunden ?? 0)
        );
      } else {
        arbeit += Number(r.arbeitsstunden ?? 0);
      }
    });
    return { arbeit, fehlzeit };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-4 text-center text-sm text-muted-foreground">
          Noch keine Buchung für diesen Tag.
          {isMonthLocked && (
            <div className="mt-2 flex items-center justify-center gap-1.5 text-xs">
              <Lock className="h-3.5 w-3.5" />
              <span>Monat ist bereits abgeschlossen.</span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Block-Nummerierung: nur Arbeits-Blöcke werden gezählt
  let blockCounter = 0;
  const blockNrFor = (r: Stunde) => {
    if (r.fehlzeit_typ) return null;
    blockCounter += 1;
    return blockCounter;
  };

  return (
    <Card>
      <CardContent className="p-3 sm:p-4 space-y-2.5">
        {/* Header mit Tagessumme */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm font-semibold">Heute eingetragen</div>
          <div className="flex flex-wrap gap-1.5">
            {summary.arbeit > 0 && (
              <Badge variant="outline" className="text-xs">
                {fmtH(summary.arbeit)} Arbeit
              </Badge>
            )}
            {Array.from(summary.fehlzeit.entries()).map(([typ, h]) => (
              <Badge
                key={typ}
                variant="outline"
                className={`text-xs ${fehlzeitBadgeClass(typ)}`}
              >
                {fmtH(h)} {fehlzeitLabel(typ)}
              </Badge>
            ))}
            {isMonthLocked && (
              <Badge variant="outline" className="text-xs flex items-center gap-1">
                <Lock className="h-3 w-3" />
                gesperrt
              </Badge>
            )}
          </div>
        </div>

        {/* Block-Karten */}
        <div className="space-y-2">
          {sortedRows.map((r) => {
            const canEdit = (r.status === "offen" && (!isMonthLocked || isAdmin));
            const baustelle = baustellen.find((b) => b.id === r.baustelle_id) ?? null;
            return (
              <TagBlockCard
                key={r.id}
                row={r}
                blockNr={blockNrFor(r)}
                baustelle={baustelle}
                canEdit={canEdit}
                onEdit={() => onEdit(r)}
                onDelete={() => onDelete(r.id)}
              />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
