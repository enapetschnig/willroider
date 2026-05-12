import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Database } from "@/integrations/supabase/types";

type Stunde = Database["public"]["Tables"]["stundenbuchungen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];

const fmtH = (n: number) => `${n.toFixed(1).replace(".", ",")} h`;
const fmtN = (n: number) => n.toFixed(0);
const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const fmtT = (t: string | null) => (t ? t.slice(0, 5) : "");

type BRow = {
  id: string;
  baustelle: Baustelle | null;
  inFirma: boolean;
  h: number;
  fahrt: number;
  tgK: number;
  tgL: number;
  km: number;
  zul: number;
  maSet: Set<string>;
};

export function BaustellenTabelle({
  rows,
  baustellen,
  members,
}: {
  rows: Stunde[];
  baustellen: Baustelle[];
  members: Profile[];
}) {
  const baustelleById = useMemo(
    () => new Map(baustellen.map((b) => [b.id, b])),
    [baustellen]
  );
  const memberById = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members]
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const aggregated: BRow[] = useMemo(() => {
    const map = new Map<string, BRow>();
    rows.forEach((r) => {
      if (r.fehlzeit_typ) return;
      const key = r.baustelle_id ?? (r.in_firma ? "_firma_" : "_ohne_");
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          baustelle: r.baustelle_id ? baustelleById.get(r.baustelle_id) ?? null : null,
          inFirma: !!r.in_firma,
          h: 0,
          fahrt: 0,
          tgK: 0,
          tgL: 0,
          km: 0,
          zul: 0,
          maSet: new Set(),
        });
      }
      const x = map.get(key)!;
      x.h += Number(r.arbeitsstunden ?? 0);
      x.fahrt += Number(r.fahrstunden ?? 0);
      x.tgK += Number(r.taggeld_kurz ?? 0);
      x.tgL += Number(r.taggeld_lang ?? 0);
      x.km += Number(r.km_gefahren ?? 0);
      x.zul += Number(r.zulage_stunden ?? 0);
      x.maSet.add(r.mitarbeiter_id);
    });
    return Array.from(map.values()).sort((a, b) => b.h - a.h);
  }, [rows, baustelleById]);

  const totals = useMemo(() => {
    return aggregated.reduce(
      (s, r) => ({
        h: s.h + r.h,
        fahrt: s.fahrt + r.fahrt,
        tgK: s.tgK + r.tgK,
        tgL: s.tgL + r.tgL,
        km: s.km + r.km,
        zul: s.zul + r.zul,
      }),
      { h: 0, fahrt: 0, tgK: 0, tgL: 0, km: 0, zul: 0 }
    );
  }, [aggregated]);

  const selected = selectedId
    ? aggregated.find((a) => a.id === selectedId) ?? null
    : null;

  const detailRows = useMemo(() => {
    if (!selectedId) return [];
    return rows.filter((r) => {
      if (r.fehlzeit_typ) return false;
      const key = r.baustelle_id ?? (r.in_firma ? "_firma_" : "_ohne_");
      return key === selectedId;
    });
  }, [rows, selectedId]);

  // Pro MA gruppiert für Drawer
  const byMember = useMemo(() => {
    const map = new Map<
      string,
      { ma: Profile | null; rows: Stunde[]; h: number; fahrt: number }
    >();
    detailRows.forEach((r) => {
      const m = memberById.get(r.mitarbeiter_id);
      if (!map.has(r.mitarbeiter_id)) {
        map.set(r.mitarbeiter_id, {
          ma: m ?? null,
          rows: [],
          h: 0,
          fahrt: 0,
        });
      }
      const e = map.get(r.mitarbeiter_id)!;
      e.rows.push(r);
      e.h += Number(r.arbeitsstunden ?? 0);
      e.fahrt += Number(r.fahrstunden ?? 0);
    });
    return Array.from(map.values()).sort(
      (a, b) =>
        (a.ma?.nachname ?? "").localeCompare(b.ma?.nachname ?? "") || b.h - a.h
    );
  }, [detailRows, memberById]);

  return (
    <>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="text-xs min-w-[700px] w-full">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-3 py-2">BVH</th>
                <th className="text-right px-2 py-2">Σ Stunden</th>
                <th className="text-right px-2 py-2">Σ Fahrt</th>
                <th className="text-right px-2 py-2">MA</th>
                <th className="text-right px-2 py-2">Diäten K/L</th>
                <th className="text-right px-2 py-2">KM</th>
                <th className="text-right px-2 py-2">Zulagen</th>
              </tr>
            </thead>
            <tbody>
              {aggregated.map((b) => (
                <tr
                  key={b.id}
                  onClick={() => setSelectedId(b.id)}
                  className="border-t hover:bg-muted/30 cursor-pointer"
                >
                  <td className="px-3 py-1.5">
                    <div className="font-medium">
                      {b.baustelle?.bvh_name ?? (b.inFirma ? "Firma" : "(ohne BVH)")}
                    </div>
                    {b.baustelle?.kostenstelle && (
                      <div className="text-[10px] text-muted-foreground">
                        {b.baustelle.kostenstelle}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                    {fmtH(b.h)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {b.fahrt > 0 ? fmtH(b.fahrt) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {b.maSet.size}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {b.tgK + b.tgL > 0
                      ? `${fmtN(b.tgK)}/${fmtN(b.tgL)}`
                      : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {b.km > 0 ? fmtN(b.km) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {b.zul > 0 ? fmtH(b.zul) : "—"}
                  </td>
                </tr>
              ))}
              {aggregated.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-2 py-4 text-center text-muted-foreground"
                  >
                    Keine Baustellen-Buchungen im Zeitraum.
                  </td>
                </tr>
              )}
            </tbody>
            {aggregated.length > 0 && (
              <tfoot className="bg-muted/60 font-semibold">
                <tr>
                  <td className="px-3 py-1.5">Σ Total</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {fmtH(totals.h)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {fmtH(totals.fahrt)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">—</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {fmtN(totals.tgK)}/{fmtN(totals.tgL)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {fmtN(totals.km)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {fmtH(totals.zul)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle>
              {selected?.baustelle?.bvh_name ??
                (selected?.inFirma ? "Firma" : "Baustelle")}
            </DialogTitle>
            <div className="text-xs text-muted-foreground">
              Σ {fmtH(selected?.h ?? 0)} ·{" "}
              {selected?.maSet.size ?? 0} Mitarbeiter
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
            {byMember.map((m) => (
              <div key={m.ma?.id ?? "x"} className="space-y-1">
                <div className="text-xs font-semibold flex items-center justify-between bg-muted/40 px-2 py-1 rounded">
                  <span>
                    {m.ma ? `${m.ma.nachname}, ${m.ma.vorname}` : "?"}
                  </span>
                  <span className="tabular-nums">
                    {fmtH(m.h)}
                    {m.fahrt > 0 ? ` · Fa ${fmtH(m.fahrt)}` : ""}
                  </span>
                </div>
                <table className="w-full text-[11px]">
                  <tbody>
                    {m.rows
                      .sort((a, b) => a.datum.localeCompare(b.datum))
                      .map((r) => {
                        const d = new Date(r.datum);
                        return (
                          <tr key={r.id} className="border-b last:border-b-0">
                            <td className="py-0.5 tabular-nums whitespace-nowrap">
                              {d.toLocaleDateString("de-AT")} {WT[d.getDay()]}
                            </td>
                            <td className="py-0.5 tabular-nums whitespace-nowrap text-muted-foreground">
                              {fmtT(r.start_zeit)}–{fmtT(r.end_zeit)}
                            </td>
                            <td className="py-0.5 tabular-nums text-right">
                              {Number(r.arbeitsstunden ?? 0).toFixed(2).replace(".", ",")} h
                            </td>
                            <td className="py-0.5 px-1 truncate text-muted-foreground max-w-[200px]">
                              {r.taetigkeit}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
