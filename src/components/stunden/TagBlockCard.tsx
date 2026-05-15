import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, Factory, Building2 } from "lucide-react";
import type { Database, StundenStatus } from "@/integrations/supabase/types";
import { fmtTime, fmtH } from "@/lib/stundenTime";

type Stunde = Database["public"]["Tables"]["stundenbuchungen"]["Row"];
type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];

const STATUS_LABEL: Record<StundenStatus, string> = {
  offen: "Offen",
  zm_freigabe: "ZM-Freigabe",
  buero_freigabe: "Büro",
  exportiert: "Exportiert",
  abgelehnt: "Abgelehnt",
};
const STATUS_COLOR: Record<StundenStatus, string> = {
  offen: "bg-blue-500",
  zm_freigabe: "bg-amber-500",
  buero_freigabe: "bg-purple-500",
  exportiert: "bg-emerald-600",
  abgelehnt: "bg-destructive",
};

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

export function TagBlockCard({
  row,
  blockNr,
  baustelle,
  canEdit,
  onEdit,
  onDelete,
}: {
  row: Stunde;
  /** 1-basiert, nur bei Arbeit/in_firma. Bei Fehlzeit null → Karte ohne Block-Nr */
  blockNr: number | null;
  baustelle: Baustelle | null;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isFehlzeit = !!row.fehlzeit_typ;
  const stunden = isFehlzeit
    ? Number(row.fehlzeit_stunden ?? 0)
    : Number(row.arbeitsstunden ?? 0);

  return (
    <div className="relative pl-3 pr-3 py-3 rounded-md border bg-card shadow-sm">
      {/* Linker Akzent-Balken */}
      <div
        className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-md ${
          isFehlzeit ? fehlzeitBadgeClass(row.fehlzeit_typ!) : "bg-primary"
        }`}
        aria-hidden
      />

      <div className="flex items-start gap-2">
        {/* Block-Nummer-Badge */}
        {blockNr !== null && (
          <div className="shrink-0 h-7 w-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
            {blockNr}
          </div>
        )}

        <div className="min-w-0 flex-1">
          {/* Zeile 1: Zeitfenster + Stunden + Status */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              {isFehlzeit ? (
                <Badge
                  variant="outline"
                  className={`text-xs ${fehlzeitBadgeClass(row.fehlzeit_typ!)}`}
                >
                  {fehlzeitLabel(row.fehlzeit_typ!)}
                </Badge>
              ) : (
                <span className="text-sm font-semibold tabular-nums">
                  {fmtTime(row.start_zeit)}–{fmtTime(row.end_zeit)}
                </span>
              )}
              <span className="text-sm font-bold tabular-nums">{fmtH(stunden)}</span>
            </div>

            <Badge
              variant="outline"
              className={`text-[10px] h-5 ${STATUS_COLOR[row.status]} text-white border-transparent`}
            >
              {STATUS_LABEL[row.status]}
            </Badge>
          </div>

          {/* Zeile 2: Baustelle / Firma */}
          {!isFehlzeit && (
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 truncate">
              {row.in_firma ? (
                <>
                  <Factory className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">In der Firma</span>
                </>
              ) : baustelle ? (
                <>
                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {baustelle.bvh_name}
                    {baustelle.kostenstelle ? ` · ${baustelle.kostenstelle}` : ""}
                  </span>
                </>
              ) : (
                <span className="italic">Keine Baustelle</span>
              )}
            </div>
          )}

          {/* Zeile 3: Pause + Tätigkeit */}
          {!isFehlzeit && row.pause_von && row.pause_bis && (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Pause {fmtTime(row.pause_von)}–{fmtTime(row.pause_bis)}
            </div>
          )}
          {row.taetigkeit && (
            <div className="text-[11px] text-muted-foreground mt-0.5 truncate italic">
              {row.taetigkeit}
            </div>
          )}

          {/* Zulagen + Diäten als kompakte Pills */}
          {(row.zulage_typ || (row.taggeld_kurz ?? 0) > 0 || (row.taggeld_lang ?? 0) > 0 || (row.fahrstunden ?? 0) > 0) && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {row.zulage_typ && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200">
                  {row.zulage_typ === "andere" && row.zulage_notiz
                    ? row.zulage_notiz
                    : row.zulage_typ}
                  {(row.zulage_stunden ?? 0) > 0 && ` · ${row.zulage_stunden}h`}
                </span>
              )}
              {(row.taggeld_kurz ?? 0) > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-900 border border-emerald-200">
                  {row.taggeld_kurz}× Taggeld kurz
                </span>
              )}
              {(row.taggeld_lang ?? 0) > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-900 border border-emerald-200">
                  {row.taggeld_lang}× Taggeld lang
                </span>
              )}
              {(row.fahrstunden ?? 0) > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-900 border border-sky-200">
                  Fahrt {row.fahrstunden}h
                </span>
              )}
            </div>
          )}

          {/* Aktions-Buttons */}
          {canEdit && (
            <div className="flex gap-1 mt-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2 text-xs"
                onClick={onEdit}
              >
                <Edit className="h-3.5 w-3.5 mr-1" />
                Bearbeiten
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs text-destructive hover:bg-destructive/10"
                onClick={onDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
