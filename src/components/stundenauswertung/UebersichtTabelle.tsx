import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Lock, ArrowUpDown, ChevronUp, ChevronDown } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { werktageImMonat } from "@/lib/konten";

type Stunde = Database["public"]["Tables"]["stundenbuchungen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];
type PKS = Database["public"]["Tables"]["profile_konten_settings"]["Row"];

type SortKey =
  | "name"
  | "arbeit"
  | "firma"
  | "fahrt"
  | "fehl"
  | "diaeten"
  | "km"
  | "zulagen"
  | "soll"
  | "ist"
  | "diff"
  | "za";
type SortDir = "asc" | "desc";

const fmtH = (n: number) => `${n.toFixed(1).replace(".", ",")} h`;
const fmtN = (n: number) => n.toFixed(0);

type Row = {
  ma: Profile;
  partie: Partie | null;
  arbeit: number;
  firma: number;
  fahrt: number;
  fehl: number;
  fehlU: number;
  fehlK: number;
  fehlF: number;
  fehlSW: number;
  tgK: number;
  tgL: number;
  km: number;
  zulagen: number;
  soll: number;
  ist: number;
  diff: number;
  za: number;
  urlaub: number;
  locked: boolean;
};

export function UebersichtTabelle({
  monat,
  rows: stunden,
  members,
  partien,
  pks,
  zaSalden,
  urlaubSalden,
  monatsabschluesse,
  onSelectMa,
}: {
  monat: string;
  rows: Stunde[];
  members: Profile[];
  partien: Partie[];
  pks: PKS[];
  zaSalden: Record<string, number>;
  urlaubSalden: Record<string, number>;
  monatsabschluesse: Record<string, boolean>;
  onSelectMa: (uid: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [year, month] = monat.split("-").map(Number);
  const werktage = useMemo(() => werktageImMonat(year, month), [year, month]);
  const pksById = useMemo(() => new Map(pks.map((p) => [p.profile_id, p])), [pks]);
  const partieById = useMemo(() => new Map(partien.map((p) => [p.id, p])), [partien]);

  const rows: Row[] = useMemo(() => {
    return members.map((m) => {
      const set = pksById.get(m.id);
      const tagesnorm = Number(set?.tagesnorm_stunden ?? 8);
      const grad = Number(set?.beschaeftigungsgrad ?? 1);
      const soll = werktage * tagesnorm * grad;
      const my = stunden.filter((r) => r.mitarbeiter_id === m.id);
      let arbeit = 0,
        firma = 0,
        fahrt = 0,
        fehlU = 0,
        fehlK = 0,
        fehlF = 0,
        fehlSW = 0;
      let tgK = 0,
        tgL = 0,
        km = 0,
        zulagen = 0;
      my.forEach((r) => {
        if (r.fehlzeit_typ) {
          const h = Number(r.fehlzeit_stunden ?? 0);
          if (r.fehlzeit_typ === "U") fehlU += h;
          else if (r.fehlzeit_typ === "K") fehlK += h;
          else if (r.fehlzeit_typ === "F") fehlF += h;
          else if (r.fehlzeit_typ === "SW") fehlSW += h;
        } else {
          const h = Number(r.arbeitsstunden ?? 0);
          if (r.in_firma) firma += h;
          else arbeit += h;
        }
        fahrt += Number(r.fahrstunden ?? 0);
        tgK += Number(r.taggeld_kurz ?? 0);
        tgL += Number(r.taggeld_lang ?? 0);
        km += Number(r.km_gefahren ?? 0);
        zulagen += Number(r.zulage_stunden ?? 0);
      });
      const fehl = fehlU + fehlK + fehlF + fehlSW;
      const ist = arbeit + firma + fahrt + fehl;
      return {
        ma: m,
        partie: partieById.get(m.partie_id ?? "") ?? null,
        arbeit,
        firma,
        fahrt,
        fehl,
        fehlU,
        fehlK,
        fehlF,
        fehlSW,
        tgK,
        tgL,
        km,
        zulagen,
        soll,
        ist,
        diff: ist - soll,
        za: zaSalden[m.id] ?? 0,
        urlaub: urlaubSalden[m.id] ?? 0,
        locked: !!monatsabschluesse[m.id],
      };
    });
  }, [stunden, members, pksById, partieById, werktage, zaSalden, urlaubSalden, monatsabschluesse]);

  const sorted = useMemo(() => {
    const cp = [...rows];
    cp.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = `${a.ma.nachname} ${a.ma.vorname}`.localeCompare(
            `${b.ma.nachname} ${b.ma.vorname}`
          );
          break;
        case "arbeit":
          cmp = a.arbeit + a.firma - (b.arbeit + b.firma);
          break;
        case "firma":
          cmp = a.firma - b.firma;
          break;
        case "fahrt":
          cmp = a.fahrt - b.fahrt;
          break;
        case "fehl":
          cmp = a.fehl - b.fehl;
          break;
        case "diaeten":
          cmp = a.tgK + a.tgL - (b.tgK + b.tgL);
          break;
        case "km":
          cmp = a.km - b.km;
          break;
        case "zulagen":
          cmp = a.zulagen - b.zulagen;
          break;
        case "soll":
          cmp = a.soll - b.soll;
          break;
        case "ist":
          cmp = a.ist - b.ist;
          break;
        case "diff":
          cmp = a.diff - b.diff;
          break;
        case "za":
          cmp = a.za - b.za;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return cp;
  }, [rows, sortKey, sortDir]);

  const totals = useMemo(() => {
    return rows.reduce(
      (s, r) => ({
        arbeit: s.arbeit + r.arbeit,
        firma: s.firma + r.firma,
        fahrt: s.fahrt + r.fahrt,
        fehl: s.fehl + r.fehl,
        tgK: s.tgK + r.tgK,
        tgL: s.tgL + r.tgL,
        km: s.km + r.km,
        zulagen: s.zulagen + r.zulagen,
        soll: s.soll + r.soll,
        ist: s.ist + r.ist,
        diff: s.diff + r.diff,
        za: s.za + r.za,
      }),
      {
        arbeit: 0,
        firma: 0,
        fahrt: 0,
        fehl: 0,
        tgK: 0,
        tgL: 0,
        km: 0,
        zulagen: 0,
        soll: 0,
        ist: 0,
        diff: 0,
        za: 0,
      }
    );
  }, [rows]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir(k === "name" ? "asc" : "desc");
    }
  };

  const SortHead = ({ k, label, align }: { k: SortKey; label: string; align?: string }) => (
    <th
      onClick={() => toggleSort(k)}
      className={`px-2 py-2 cursor-pointer select-none whitespace-nowrap ${
        align ?? "text-left"
      } hover:bg-muted/70`}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {sortKey === k ? (
          sortDir === "asc" ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-30" />
        )}
      </span>
    </th>
  );

  // Desktop: Tabelle, Mobile: Cards
  return (
    <>
      <div className="hidden md:block">
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="text-xs min-w-[1100px] w-full">
              <thead className="bg-muted">
                <tr>
                  <SortHead k="name" label="Mitarbeiter" />
                  <SortHead k="arbeit" label="Arbeit Σ" align="text-right" />
                  <SortHead k="firma" label="Firma" align="text-right" />
                  <SortHead k="fahrt" label="Fahrt" align="text-right" />
                  <SortHead k="fehl" label="Fehl" align="text-right" />
                  <SortHead k="diaeten" label="Diäten K/L" align="text-right" />
                  <SortHead k="km" label="KM" align="text-right" />
                  <SortHead k="zulagen" label="Zulagen" align="text-right" />
                  <SortHead k="soll" label="Soll" align="text-right" />
                  <SortHead k="ist" label="Ist" align="text-right" />
                  <SortHead k="diff" label="Diff" align="text-right" />
                  <SortHead k="za" label="ZA-Saldo" align="text-right" />
                  <th className="px-2 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr
                    key={r.ma.id}
                    onClick={() => onSelectMa(r.ma.id)}
                    className="border-t hover:bg-muted/30 cursor-pointer"
                  >
                    <td className="px-2 py-1.5">
                      <div className="font-medium">
                        {r.ma.nachname} {r.ma.vorname}
                      </div>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                        {r.ma.pers_nr && <span>{r.ma.pers_nr}</span>}
                        {r.partie && (
                          <span
                            className="px-1 rounded text-[9px] text-white"
                            style={{ background: r.partie.farbcode ?? "#999" }}
                          >
                            {r.partie.name}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                      {fmtH(r.arbeit + r.firma)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                      {r.firma > 0 ? fmtH(r.firma) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.fahrt > 0 ? fmtH(r.fahrt) : "—"}
                    </td>
                    <td
                      className="px-2 py-1.5 text-right tabular-nums"
                      title={`U ${r.fehlU.toFixed(1)} · K ${r.fehlK.toFixed(
                        1
                      )} · F ${r.fehlF.toFixed(1)} · SW ${r.fehlSW.toFixed(1)}`}
                    >
                      {r.fehl > 0 ? fmtH(r.fehl) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.tgK + r.tgL > 0
                        ? `${fmtN(r.tgK)}/${fmtN(r.tgL)}`
                        : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.km > 0 ? fmtN(r.km) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.zulagen > 0 ? fmtH(r.zulagen) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                      {fmtH(r.soll)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {fmtH(r.ist)}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right tabular-nums font-semibold ${
                        r.diff < 0 ? "text-red-700" : r.diff > 0 ? "text-emerald-700" : ""
                      }`}
                    >
                      {(r.diff > 0 ? "+" : "") + fmtH(r.diff)}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right tabular-nums font-semibold ${
                        r.za < 0 ? "text-red-700" : r.za > 0 ? "text-emerald-700" : ""
                      }`}
                    >
                      {(r.za > 0 ? "+" : "") + fmtH(r.za)}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {r.locked ? (
                        <Lock className="h-3.5 w-3.5 inline text-amber-600" />
                      ) : (
                        <span className="text-[9px] text-muted-foreground uppercase">offen</span>
                      )}
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={13} className="px-2 py-4 text-center text-muted-foreground">
                      Keine Mitarbeiter im Filter.
                    </td>
                  </tr>
                )}
              </tbody>
              {sorted.length > 0 && (
                <tfoot className="bg-muted/60 font-semibold">
                  <tr>
                    <td className="px-2 py-1.5">Σ Total</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {fmtH(totals.arbeit + totals.firma)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {fmtH(totals.firma)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {fmtH(totals.fahrt)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {fmtH(totals.fehl)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {fmtN(totals.tgK)}/{fmtN(totals.tgL)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {fmtN(totals.km)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {fmtH(totals.zulagen)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {fmtH(totals.soll)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {fmtH(totals.ist)}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right tabular-nums ${
                        totals.diff < 0 ? "text-red-700" : "text-emerald-700"
                      }`}
                    >
                      {(totals.diff > 0 ? "+" : "") + fmtH(totals.diff)}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right tabular-nums ${
                        totals.za < 0 ? "text-red-700" : "text-emerald-700"
                      }`}
                    >
                      {(totals.za > 0 ? "+" : "") + fmtH(totals.za)}
                    </td>
                    <td className="px-2 py-1.5"></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </CardContent>
        </Card>
      </div>

      {/* Mobile-Cards */}
      <div className="md:hidden space-y-2">
        {sorted.map((r) => (
          <Card
            key={r.ma.id}
            onClick={() => onSelectMa(r.ma.id)}
            className="cursor-pointer hover:shadow-sm transition"
          >
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">
                    {r.ma.nachname} {r.ma.vorname}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {r.ma.pers_nr} {r.partie?.name && `· ${r.partie.name}`}
                  </div>
                </div>
                {r.locked && <Lock className="h-4 w-4 text-amber-600" />}
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                <Cell label="Σ Arbeit" v={fmtH(r.arbeit + r.firma)} />
                <Cell label="Fahrt" v={r.fahrt > 0 ? fmtH(r.fahrt) : "—"} />
                <Cell label="Fehl" v={r.fehl > 0 ? fmtH(r.fehl) : "—"} />
                <Cell label="Soll" v={fmtH(r.soll)} />
                <Cell label="Ist" v={fmtH(r.ist)} />
                <Cell
                  label="Diff"
                  v={(r.diff > 0 ? "+" : "") + fmtH(r.diff)}
                  tone={r.diff < 0 ? "red" : r.diff > 0 ? "emerald" : "muted"}
                />
                <Cell label="Diäten" v={`${fmtN(r.tgK)}/${fmtN(r.tgL)}`} />
                <Cell label="KM" v={fmtN(r.km)} />
                <Cell
                  label="ZA"
                  v={(r.za > 0 ? "+" : "") + fmtH(r.za)}
                  tone={r.za < 0 ? "red" : r.za > 0 ? "emerald" : "muted"}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

function Cell({
  label,
  v,
  tone,
}: {
  label: string;
  v: string;
  tone?: "red" | "emerald" | "muted";
}) {
  const cls =
    tone === "red"
      ? "text-red-700"
      : tone === "emerald"
      ? "text-emerald-700"
      : tone === "muted"
      ? "text-muted-foreground"
      : "";
  return (
    <div className="rounded bg-muted/40 px-1.5 py-1">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`font-semibold tabular-nums ${cls}`}>{v}</div>
    </div>
  );
}
