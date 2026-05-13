import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Edit,
  Trash2,
  Lock,
  FileText,
  Download as DownloadIcon,
} from "lucide-react";
import type { Database, ArbeitszeitModell } from "@/integrations/supabase/types";
import { feiertagAt } from "@/lib/feiertage";
import { monatsSoll, type TagessollKalender } from "@/lib/konten";
import { downloadStundenzettel } from "@/lib/stundenPdf";

type Stunde = Database["public"]["Tables"]["stundenbuchungen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];
type PKS = Database["public"]["Tables"]["profile_konten_settings"]["Row"];

const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const fmtT = (t: string | null) => (t ? t.slice(0, 5) : "");
const fmtH = (n: number) => n.toFixed(2).replace(".", ",");
const fmtH1 = (n: number) => n.toFixed(1).replace(".", ",");

function pauseDauerMin(s: Stunde): number {
  if (!s.pause_von || !s.pause_bis) return 0;
  const [vh, vm] = s.pause_von.slice(0, 5).split(":").map(Number);
  const [bh, bm] = s.pause_bis.slice(0, 5).split(":").map(Number);
  return bh * 60 + bm - (vh * 60 + vm);
}

function fehlzeitColor(typ: string | null): string {
  switch (typ) {
    case "U":
      return "bg-amber-50";
    case "K":
      return "bg-red-50";
    case "F":
      return "bg-violet-50";
    case "SW":
      return "bg-sky-50";
    default:
      return "";
  }
}

export function DetailTabelle({
  monat,
  member,
  partie,
  rows: stunden,
  baustellen,
  pks,
  kalender,
  zaSaldo,
  monatLocked,
  isAdmin,
  onEdit,
  onDelete,
}: {
  monat: string;
  member: Profile | null;
  partie: Partie | null;
  rows: Stunde[];
  baustellen: Baustelle[];
  pks: PKS | null;
  kalender: Map<string, TagessollKalender>;
  zaSaldo: number;
  monatLocked: boolean;
  isAdmin: boolean;
  onEdit: (r: Stunde) => void;
  onDelete: (r: Stunde) => void;
}) {
  const baustelleById = useMemo(
    () => new Map(baustellen.map((b) => [b.id, b])),
    [baustellen]
  );

  const sorted = useMemo(
    () =>
      [...stunden].sort(
        (a, b) =>
          a.datum.localeCompare(b.datum) ||
          (a.start_zeit ?? "").localeCompare(b.start_zeit ?? "")
      ),
    [stunden]
  );

  const [year, month] = monat.split("-").map(Number);
  const tagesnorm = Number(pks?.tagesnorm_stunden ?? 8);
  const grad = Number(pks?.beschaeftigungsgrad ?? 1);
  const modell =
    (pks?.arbeitszeitmodell as ArbeitszeitModell) ?? "zimmerei_sommer";
  const soll = useMemo(
    () => monatsSoll(year, month, kalender, modell, tagesnorm, grad),
    [year, month, kalender, modell, tagesnorm, grad]
  );

  const totals = useMemo(() => {
    let arbeit = 0,
      fahrt = 0,
      fehl = 0,
      tgK = 0,
      tgL = 0,
      km = 0,
      zul = 0,
      pause = 0;
    stunden.forEach((r) => {
      arbeit += Number(r.arbeitsstunden ?? 0);
      fahrt += Number(r.fahrstunden ?? 0);
      fehl += Number(r.fehlzeit_stunden ?? 0);
      tgK += Number(r.taggeld_kurz ?? 0);
      tgL += Number(r.taggeld_lang ?? 0);
      km += Number(r.km_gefahren ?? 0);
      zul += Number(r.zulage_stunden ?? 0);
      pause += pauseDauerMin(r);
    });
    return { arbeit, fahrt, fehl, tgK, tgL, km, zul, pause };
  }, [stunden]);

  const ist = totals.arbeit + totals.fahrt + totals.fehl;

  if (!member) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          Wähle oben einen Mitarbeiter aus, um die Detail-Buchungen zu sehen.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* MA-Header */}
      <Card>
        <CardContent className="p-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="text-base font-bold">
                {member.vorname} {member.nachname}
              </div>
              <div className="text-xs text-muted-foreground">
                {member.pers_nr && `Pers.Nr. ${member.pers_nr}`}
                {partie?.name && ` · Partie ${partie.name}`}
                {pks?.eintrittsdatum &&
                  ` · Eintritt ${new Date(pks.eintrittsdatum).toLocaleDateString("de-AT")}`}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Pill label="Arbeit+Fahrt" v={`${fmtH1(totals.arbeit + totals.fahrt)} h`} />
              <Pill label="Soll" v={`${fmtH1(soll)} h`} />
              <Pill
                label="Diff"
                v={`${ist - soll > 0 ? "+" : ""}${fmtH1(ist - soll)} h`}
                tone={ist - soll < 0 ? "red" : ist - soll > 0 ? "emerald" : "muted"}
              />
              <Pill
                label="ZA-Saldo"
                v={`${zaSaldo > 0 ? "+" : ""}${fmtH1(zaSaldo)} h`}
                tone={zaSaldo < 0 ? "red" : zaSaldo > 0 ? "emerald" : "muted"}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                downloadStundenzettel({
                  monat,
                  rows: stunden,
                  member,
                  baustellen,
                  partie,
                  pks,
                  kalender,
                })
              }
            >
              <FileText className="h-4 w-4 mr-1" />
              PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {monatLocked && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 flex items-center gap-2 text-xs">
          <Lock className="h-4 w-4 text-amber-700" />
          <span>
            <strong>Monat abgeschlossen</strong> — Buchungen können vom
            Mitarbeiter nicht mehr geändert werden. Differenz wurde aufs
            ZA-Konto gebucht.
          </span>
        </div>
      )}

      {/* Detail-Tabelle Desktop */}
      <div className="hidden md:block">
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="text-xs min-w-[1100px] w-full">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-2 py-2">Datum</th>
                  <th className="text-left px-2 py-2">Wt</th>
                  <th className="text-left px-2 py-2">BVH / Tätigkeit</th>
                  <th className="text-center px-2 py-2">Start</th>
                  <th className="text-center px-2 py-2">Ende</th>
                  <th className="text-center px-2 py-2">Pause</th>
                  <th className="text-right px-2 py-2">Pause Min</th>
                  <th className="text-right px-2 py-2">Arbeit</th>
                  <th className="text-right px-2 py-2">Fahrt</th>
                  <th className="text-right px-2 py-2">KM</th>
                  <th className="text-center px-2 py-2">Diät</th>
                  <th className="text-center px-2 py-2">Zulage</th>
                  <th className="text-center px-2 py-2">Fehl</th>
                  <th className="text-center px-2 py-2">Status</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const d = new Date(r.datum);
                  const dow = d.getDay();
                  const weekend = dow === 0 || dow === 6;
                  const fei = feiertagAt(r.datum);
                  const b = baustelleById.get(r.baustelle_id ?? "");
                  const bgClass = r.fehlzeit_typ
                    ? fehlzeitColor(r.fehlzeit_typ)
                    : fei
                    ? "bg-violet-50"
                    : weekend
                    ? "bg-muted/30"
                    : "";
                  return (
                    <tr key={r.id} className={`border-t ${bgClass}`}>
                      <td className="px-2 py-1 tabular-nums whitespace-nowrap">
                        {d.toLocaleDateString("de-AT")}
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">{WT[dow]}</td>
                      <td className="px-2 py-1">
                        {r.fehlzeit_typ ? (
                          <span className="text-muted-foreground italic">
                            {r.fehlzeit_typ === "U"
                              ? "Urlaub"
                              : r.fehlzeit_typ === "K"
                              ? "Krank"
                              : r.fehlzeit_typ === "F"
                              ? "Feiertag"
                              : r.fehlzeit_typ === "SW"
                              ? "Schlechtwetter"
                              : r.fehlzeit_typ}
                          </span>
                        ) : (
                          <>
                            <span className="font-medium">
                              {b?.bvh_name ?? (r.in_firma ? "Firma" : "—")}
                            </span>
                            {r.taetigkeit && (
                              <span className="text-muted-foreground"> · {r.taetigkeit}</span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-2 py-1 text-center tabular-nums">
                        {fmtT(r.start_zeit)}
                      </td>
                      <td className="px-2 py-1 text-center tabular-nums">
                        {fmtT(r.end_zeit)}
                      </td>
                      <td className="px-2 py-1 text-center tabular-nums text-muted-foreground">
                        {r.pause_von && r.pause_bis
                          ? `${fmtT(r.pause_von)}-${fmtT(r.pause_bis)}`
                          : "—"}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                        {pauseDauerMin(r) > 0 ? pauseDauerMin(r) : "—"}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums font-semibold">
                        {Number(r.arbeitsstunden ?? 0) > 0
                          ? fmtH(Number(r.arbeitsstunden))
                          : "—"}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {Number(r.fahrstunden ?? 0) > 0
                          ? fmtH(Number(r.fahrstunden))
                          : "—"}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {r.km_gefahren ? r.km_gefahren : "—"}
                      </td>
                      <td className="px-2 py-1 text-center text-[10px]">
                        {(r.taggeld_kurz ?? 0) > 0 && (
                          <span className="inline-block px-1 rounded bg-sky-100 text-sky-900 mr-1">
                            K{r.taggeld_kurz}
                          </span>
                        )}
                        {(r.taggeld_lang ?? 0) > 0 && (
                          <span className="inline-block px-1 rounded bg-indigo-100 text-indigo-900">
                            L{r.taggeld_lang}
                          </span>
                        )}
                        {(r.taggeld_kurz ?? 0) === 0 && (r.taggeld_lang ?? 0) === 0 && "—"}
                      </td>
                      <td className="px-2 py-1 text-center text-[10px]">
                        {r.zulage_typ ? (
                          <span
                            className="inline-block px-1 rounded bg-amber-100 text-amber-900"
                            title={r.zulage_notiz ?? r.zulage_typ}
                          >
                            {r.zulage_typ.slice(0, 3)} {r.zulage_stunden}h
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-1 text-center text-[10px]">
                        {r.fehlzeit_typ ? (
                          <span className="inline-block px-1 rounded bg-amber-100 text-amber-900">
                            {r.fehlzeit_typ} {Number(r.fehlzeit_stunden ?? 0).toFixed(1)}h
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-1 text-center text-[9px] uppercase">
                        {r.status === "offen" ? (
                          <span className="text-muted-foreground">offen</span>
                        ) : (
                          <span className="text-emerald-700">{r.status}</span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {isAdmin && !monatLocked && (
                          <div className="flex items-center gap-0.5 justify-end">
                            <button
                              onClick={() => onEdit(r)}
                              className="text-muted-foreground hover:text-primary p-1"
                              title="Bearbeiten"
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => onDelete(r)}
                              className="text-muted-foreground hover:text-destructive p-1"
                              title="Löschen"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                        {monatLocked && (
                          <Lock className="h-3.5 w-3.5 text-muted-foreground inline" />
                        )}
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && (
                  <tr>
                    <td
                      colSpan={15}
                      className="px-2 py-4 text-center text-muted-foreground"
                    >
                      Keine Buchungen im Zeitraum.
                    </td>
                  </tr>
                )}
              </tbody>
              {sorted.length > 0 && (
                <tfoot className="bg-muted/60 font-semibold">
                  <tr>
                    <td colSpan={6} className="px-2 py-1.5">
                      Σ
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {totals.pause}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {fmtH1(totals.arbeit)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {fmtH1(totals.fahrt)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{totals.km}</td>
                    <td className="px-2 py-1.5 text-center">
                      {totals.tgK > 0 || totals.tgL > 0
                        ? `K${totals.tgK}/L${totals.tgL}`
                        : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-center tabular-nums">
                      {totals.zul > 0 ? `${fmtH1(totals.zul)}h` : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-center tabular-nums">
                      {totals.fehl > 0 ? `${fmtH1(totals.fehl)}h` : "—"}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </CardContent>
        </Card>
      </div>

      {/* Mobile-Cards */}
      <div className="md:hidden space-y-2">
        {sorted.map((r) => {
          const d = new Date(r.datum);
          const dow = d.getDay();
          const fei = feiertagAt(r.datum);
          const b = baustelleById.get(r.baustelle_id ?? "");
          const bgClass = r.fehlzeit_typ
            ? fehlzeitColor(r.fehlzeit_typ)
            : fei
            ? "bg-violet-50"
            : dow === 0 || dow === 6
            ? "bg-muted/30"
            : "";
          return (
            <Card key={r.id} className={bgClass}>
              <CardContent className="p-3 space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <div className="font-semibold">
                    {d.toLocaleDateString("de-AT")} {WT[dow]}
                  </div>
                  <div className="flex-1 truncate text-muted-foreground">
                    {r.fehlzeit_typ ?? b?.bvh_name ?? (r.in_firma ? "Firma" : "—")}
                  </div>
                  {isAdmin && !monatLocked && (
                    <button
                      onClick={() => onEdit(r)}
                      className="text-muted-foreground hover:text-primary p-1"
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {r.start_zeit && (
                  <div className="text-muted-foreground tabular-nums">
                    {fmtT(r.start_zeit)}–{fmtT(r.end_zeit)}
                    {r.pause_von && ` · Pause ${fmtT(r.pause_von)}-${fmtT(r.pause_bis)}`}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-1">
                  <span className="font-semibold tabular-nums">
                    {Number(r.arbeitsstunden ?? r.fehlzeit_stunden ?? 0)
                      .toFixed(2)
                      .replace(".", ",")}h
                  </span>
                  {Number(r.fahrstunden ?? 0) > 0 && (
                    <span className="tabular-nums">Fa {fmtH(Number(r.fahrstunden))}h</span>
                  )}
                  {Number(r.km_gefahren ?? 0) > 0 && (
                    <span className="tabular-nums">{r.km_gefahren} km</span>
                  )}
                  {(r.taggeld_kurz ?? 0) > 0 && (
                    <span className="text-sky-700">K{r.taggeld_kurz}</span>
                  )}
                  {(r.taggeld_lang ?? 0) > 0 && (
                    <span className="text-indigo-700">L{r.taggeld_lang}</span>
                  )}
                  {r.zulage_typ && (
                    <span className="text-amber-700">
                      {r.zulage_typ} {r.zulage_stunden}h
                    </span>
                  )}
                </div>
                {r.notizen && (
                  <div className="text-[10px] text-muted-foreground italic">
                    {r.notizen}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Pill({
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
      ? "border-red-300 bg-red-50 text-red-900"
      : tone === "emerald"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : tone === "muted"
      ? "border-border bg-muted/40 text-muted-foreground"
      : "border-primary/30 bg-primary/5 text-foreground";
  return (
    <div className={`px-2 py-1 rounded border text-[11px] ${cls}`}>
      <div className="text-[9px] uppercase tracking-wide opacity-70 font-semibold">
        {label}
      </div>
      <div className="font-bold tabular-nums">{v}</div>
    </div>
  );
}
