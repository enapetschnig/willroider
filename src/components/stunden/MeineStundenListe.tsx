/**
 * Liste erfasster Stunden-Tage mit Status-Punkt.
 *
 * Vorher stand dieser Block als loses JSX mitten in Stunden.tsx. Er wird
 * jetzt an zwei Stellen gebraucht — in der Erfassung („Meine letzten Tage")
 * und in „Mein Tag" — und ist deshalb eine Komponente: eine Darstellung,
 * zwei Orte, nichts läuft auseinander.
 *
 * Wunsch B. Sirnitzer (19.10.2026): Baustellenname je Tag und ein Knopf zum
 * Ändern — er öffnet die Stundenerfassung direkt mit diesem Tag.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
  /** „Ändern" für diese Person anbieten (eigene, noch nicht freigegebene Tage). */
  aendernFuer,
}: {
  tage: StundenTagFull[];
  maxAnzahl?: number;
  onDelete?: (t: StundenTagFull) => void;
  nameFuer?: (mitarbeiterId: string) => string | null;
  aendernFuer?: string | null;
}) {
  const sichtbar = maxAnzahl ? tage.slice(0, maxAnzahl) : tage;

  // Baustellennamen der angezeigten Tage in einem Rutsch nachladen.
  const baustellenIds = useMemo(
    () =>
      [
        ...new Set(
          sichtbar.flatMap((t) => t.taetigkeiten.map((x) => x.baustelle_id).filter(Boolean) as string[]),
        ),
      ].sort(),
    [sichtbar],
  );
  const [bstNamen, setBstNamen] = useState<Map<string, string>>(new Map());
  const idsKey = baustellenIds.join(",");
  useEffect(() => {
    if (baustellenIds.length === 0) return;
    let aktiv = true;
    supabase
      .from("baustellen")
      .select("id, bvh_name")
      .in("id", baustellenIds)
      .then(({ data }) => {
        if (!aktiv) return;
        setBstNamen(new Map(((data as { id: string; bvh_name: string }[]) ?? []).map((b) => [b.id, b.bvh_name])));
      });
    return () => {
      aktiv = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

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
        // Wo gearbeitet: Baustellennamen, sonst die Art (Firma, Urlaub …).
        const namenBst = [
          ...new Set(
            t.taetigkeiten
              .map((x) => (x.baustelle_id ? bstNamen.get(x.baustelle_id) : null))
              .filter(Boolean) as string[],
          ),
        ];
        const wo = namenBst.length > 0 ? namenBst.join(" · ") : STATUS_LABELS[t.tag.tag_status];
        // Ändern: eigene Tage, solange das Büro sie nicht freigegeben hat
        // (dieselbe Regel wie in der Erfassung).
        const aenderbar =
          !!aendernFuer &&
          t.tag.mitarbeiter_id === aendernFuer &&
          t.tag.status !== "buero_freigabe" &&
          t.tag.status !== "exportiert";
        return (
          <div key={t.tag.id} className="rounded px-2 py-1.5 bg-muted/40 text-xs">
            <div className="flex items-center gap-2">
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
                <span className="font-medium min-w-0 truncate">{name}</span>
              )}
              <span className="flex-1" />
              <Badge variant="outline" className={`text-[10px] shrink-0 ${s.badge}`}>
                {s.label}
              </Badge>
              {aenderbar && (
                <Link to={`/stunden?datum=${t.tag.datum}`} aria-label="Tag ändern">
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] gap-1">
                    <Pencil className="h-3 w-3" /> Ändern
                  </Button>
                </Link>
              )}
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
            <div className="pl-4 mt-0.5 text-[11px] text-muted-foreground truncate">
              {wo}
            </div>
          </div>
        );
      })}
    </div>
  );
}
