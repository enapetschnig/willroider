import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { feiertageInRange } from "@/lib/feiertage";
import { isoToYearKw } from "@/lib/konten";
import type { Database, Wochentyp } from "@/integrations/supabase/types";

type Row = Database["public"]["Tables"]["arbeitszeitkalender"]["Row"];

const TYPE_LABEL: Record<Wochentyp, string> = {
  L: "Lang (42h)",
  K: "Kurz (36h)",
  F: "Feiertag",
  U: "Urlaubswoche",
  BU: "Betriebsurlaub",
  BV: "Betriebsversammlung",
};

type Vorlage = {
  key: string;
  label: string;
  wochentyp: Wochentyp;
  mo: number;
  di: number;
  mi: number;
  do_: number;
  fr: number;
  sa: number;
  so: number;
};

/** Tageswerte der beiden Grund-Wochentypen — EINZIGE Definition,
 *  von VORLAGEN und ensureYear gemeinsam genutzt. */
const TAGE_L = { mo: 9, di: 9, mi: 9, do_: 9, fr: 6, sa: 0, so: 0 }; // Lang = 42 h
const TAGE_K = { mo: 9, di: 9, mi: 9, do_: 9, fr: 0, sa: 0, so: 0 }; // Kurz = 36 h

const VORLAGEN: Vorlage[] = [
  { key: "L_42", label: "Lange Woche (42h)", wochentyp: "L", ...TAGE_L },
  { key: "K_36", label: "Kurze Woche (36h)", wochentyp: "K", ...TAGE_K },
  { key: "WINTER_40", label: "Winter 40h Mo-Fr 8h", wochentyp: "L", mo: 8, di: 8, mi: 8, do_: 8, fr: 8, sa: 0, so: 0 },
  { key: "BU", label: "Betriebsurlaub (0h)", wochentyp: "BU", mo: 0, di: 0, mi: 0, do_: 0, fr: 0, sa: 0, so: 0 },
  { key: "BV", label: "Betriebsversammlung", wochentyp: "BV", ...TAGE_L },
];

/** Anzahl der ISO-Wochen eines Jahres (52 oder 53). Der 28.12. liegt
 *  immer in der letzten ISO-Woche — daraus lässt sich die Anzahl ablesen. */
function isoWeeksInYear(year: number): number {
  const d = new Date(year, 11, 28);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(
      ((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7,
    )
  );
}

type SollTage = {
  soll_mo: number; soll_di: number; soll_mi: number; soll_do: number;
  soll_fr: number; soll_sa: number; soll_so: number;
};
/** Index = JS-Wochentag (0=So..6=Sa) → passende soll_*-Spalte. */
const SOLL_COLS = [
  "soll_so", "soll_mo", "soll_di", "soll_mi", "soll_do", "soll_fr", "soll_sa",
] as const;

/** Baut die Tages-Soll-Werte aus einem Wochentyp-Basiswert und nullt die
 *  Feiertage (übergeben als JS-Wochentag-Indizes 0=So..6=Sa). */
function bauTage(
  basis: { mo: number; di: number; mi: number; do_: number; fr: number; sa: number; so: number },
  feiertageDow: number[],
): { tage: SollTage; sum: number } {
  const tage: SollTage = {
    soll_mo: basis.mo, soll_di: basis.di, soll_mi: basis.mi, soll_do: basis.do_,
    soll_fr: basis.fr, soll_sa: basis.sa, soll_so: basis.so,
  };
  for (const dow of feiertageDow) tage[SOLL_COLS[dow]] = 0;
  const sum =
    tage.soll_mo + tage.soll_di + tage.soll_mi + tage.soll_do +
    tage.soll_fr + tage.soll_sa + tage.soll_so;
  return { tage, sum };
}

/** Liefert pro KW die Feiertage eines Jahres (JS-Wochentag + Name). */
function feiertageProKw(year: number): Map<number, { dow: number; name: string }[]> {
  const map = new Map<number, { dow: number; name: string }[]>();
  for (const { iso, info } of feiertageInRange(`${year}-01-01`, `${year}-12-31`)) {
    const d = new Date(iso + "T00:00:00");
    const { jahr, kw } = isoToYearKw(d);
    if (jahr !== year) continue; // ISO-Jahresgrenze → gehört zum Nachbarjahr
    const arr = map.get(kw) ?? [];
    arr.push({ dow: d.getDay(), name: info.name });
    map.set(kw, arr);
  }
  return map;
}

export default function Kalender() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [rows, setRows] = useState<Row[]>([]);
  const feiertageMap = useMemo(() => feiertageProKw(year), [year]);

  const load = async () => {
    const { data } = await supabase
      .from("arbeitszeitkalender")
      .select("*")
      .eq("jahr", year)
      .order("kw");
    setRows((data as Row[]) ?? []);
  };

  useEffect(() => {
    load();
  }, [year]);

  const updateRow = async (id: string, patch: Partial<Row>) => {
    const { error } = await supabase.from("arbeitszeitkalender").update(patch).eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      load();
    }
  };

  const applyVorlage = async (id: string, vk: string) => {
    const v = VORLAGEN.find((x) => x.key === vk);
    if (!v) return;
    const row = rows.find((r) => r.id === id);
    // Feiertage der Woche immer auf 0 — der Kalender bleibt einzige Quelle.
    const ftDow = (row ? feiertageMap.get(row.kw) ?? [] : []).map((f) => f.dow);
    const { tage, sum } = bauTage(v, ftDow);
    await updateRow(id, {
      wochentyp: v.wochentyp,
      soll_stunden: sum,
      ...tage,
    } as any);
  };

  const ensureYear = async () => {
    const { data: existing } = await supabase
      .from("arbeitszeitkalender")
      .select("kw")
      .eq("jahr", year);
    const have = new Set((existing ?? []).map((x: any) => x.kw));
    const insertRows = [];
    // Jahre mit 53 ISO-Wochen (z.B. 2026) brauchen auch KW 53.
    const wochenImJahr = isoWeeksInYear(year);
    for (let kw = 1; kw <= wochenImJahr; kw++) {
      if (have.has(kw)) continue;
      // Startwert abwechselnd L/K — der Admin korrigiert per Vorlage auf
      // das echte Muster. Tageswerte werden IMMER vollständig gesetzt
      // (sonst liefert tagesSoll 0); Feiertage werden genullt.
      const basis = kw % 2 === 0 ? TAGE_L : TAGE_K;
      const ftDow = (feiertageMap.get(kw) ?? []).map((f) => f.dow);
      const { tage, sum } = bauTage(basis, ftDow);
      insertRows.push({
        jahr: year,
        kw,
        wochentyp: kw % 2 === 0 ? "L" : "K",
        ...tage,
        soll_stunden: sum,
      });
    }
    if (insertRows.length > 0) {
      await supabase.from("arbeitszeitkalender").insert(insertRows as any);
      toast({ title: `${insertRows.length} Wochen für ${year} angelegt` });
      load();
    } else {
      toast({ title: "Alle Wochen bereits vorhanden" });
    }
  };

  const summary = useMemo(() => {
    let total = 0;
    rows.forEach((r) => (total += Number(r.soll_stunden)));
    const byType: Record<string, number> = {};
    rows.forEach((r) => {
      byType[r.wochentyp] = (byType[r.wochentyp] ?? 0) + 1;
    });
    return { total, byType };
  }, [rows]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Arbeitszeitkalender"
        description="Wochenweise Soll-Stunden, Wochentyp (Lang/Kurz), Feiertage und BU-Tage."
        actions={
          isAdmin ? (
            <Button onClick={ensureYear} variant="outline">
              Jahr {year} initialisieren
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="p-3 flex items-center gap-3">
          <label className="text-sm">Jahr:</label>
          <Input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="w-28"
          />
          <div className="ml-auto text-xs text-muted-foreground flex flex-wrap gap-2">
            <span>Soll gesamt: <strong>{summary.total.toFixed(1)} h</strong></span>
            <span>L: {summary.byType.L ?? 0}</span>
            <span>K: {summary.byType.K ?? 0}</span>
            <span>F: {summary.byType.F ?? 0}</span>
            <span>U: {summary.byType.U ?? 0}</span>
          </div>
        </CardContent>
      </Card>

      {/* Mobile: cards */}
      <div className="md:hidden space-y-2">
        {rows.map((r) => (
          <Card key={r.id}>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-baseline justify-between">
                <div className="font-bold text-lg">KW {r.kw}</div>
                <div className="text-sm font-semibold tabular-nums">{Number(r.soll_stunden).toFixed(1)} h</div>
              </div>
              {(feiertageMap.get(r.kw) ?? []).length > 0 && (
                <div className="text-[10px] text-amber-700">
                  Feiertag: {(feiertageMap.get(r.kw) ?? []).map((f) => f.name).join(", ")}
                </div>
              )}
              {isAdmin ? (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <Label className="text-[10px]">Typ</Label>
                    <Select
                      value={r.wochentyp}
                      onValueChange={(v) => updateRow(r.id, { wochentyp: v as Wochentyp })}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(TYPE_LABEL) as Wochentyp[]).map((k) => (
                          <SelectItem key={k} value={k}>{TYPE_LABEL[k]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px]">Soll-Stunden</Label>
                    <Input
                      type="number"
                      step="0.5"
                      defaultValue={r.soll_stunden}
                      onBlur={(e) => updateRow(r.id, { soll_stunden: Number(e.target.value) })}
                      className="h-8"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px]">Feiertage</Label>
                    <Input
                      defaultValue={r.feiertage ?? ""}
                      onBlur={(e) => updateRow(r.id, { feiertage: e.target.value || null })}
                      className="h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px]">BU-Tage</Label>
                    <Input
                      type="number"
                      defaultValue={r.bu_tage ?? 0}
                      onBlur={(e) => updateRow(r.id, { bu_tage: Number(e.target.value) || 0 })}
                      className="h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px]">Notiz</Label>
                    <Input
                      defaultValue={r.notizen ?? ""}
                      onBlur={(e) => updateRow(r.id, { notizen: e.target.value || null })}
                      className="h-8"
                    />
                  </div>
                </div>
              ) : (
                <div className="text-xs space-y-0.5">
                  <div><span className="text-muted-foreground">Typ: </span>{TYPE_LABEL[r.wochentyp]}</div>
                  {r.feiertage && <div><span className="text-muted-foreground">Feiertage: </span>{r.feiertage}</div>}
                  {!!r.bu_tage && <div><span className="text-muted-foreground">BU: </span>{r.bu_tage} Tage</div>}
                  {r.notizen && <div className="text-muted-foreground italic">{r.notizen}</div>}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {rows.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Keine Wochen für {year}.
            </CardContent>
          </Card>
        )}
      </div>

      {/* Desktop: table */}
      <Card className="hidden md:block">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 sticky top-0">
              <tr>
                <th className="text-left p-2">KW</th>
                <th className="text-left p-2">Wochentyp</th>
                <th className="text-left p-2">Soll-Stunden</th>
                <th className="text-left p-2">Mo–Fr</th>
                <th className="text-left p-2">Vorlage</th>
                <th className="text-left p-2">Notizen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="p-2 font-medium">
                    KW {r.kw}
                    {(feiertageMap.get(r.kw) ?? []).length > 0 && (
                      <div
                        className="text-[10px] font-normal text-amber-700"
                        title="Feiertag — Tages-Soll ist hier 0"
                      >
                        {(feiertageMap.get(r.kw) ?? []).map((f) => f.name).join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="p-2">
                    {isAdmin ? (
                      <Select
                        value={r.wochentyp}
                        onValueChange={(v) =>
                          updateRow(r.id, { wochentyp: v as Wochentyp })
                        }
                      >
                        <SelectTrigger className="h-8 w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(TYPE_LABEL) as Wochentyp[]).map((k) => (
                            <SelectItem key={k} value={k}>
                              {TYPE_LABEL[k]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      TYPE_LABEL[r.wochentyp]
                    )}
                  </td>
                  <td className="p-2">
                    {isAdmin ? (
                      <Input
                        type="number"
                        step="0.5"
                        defaultValue={r.soll_stunden}
                        onBlur={(e) => updateRow(r.id, { soll_stunden: Number(e.target.value) })}
                        className="h-8 w-24"
                      />
                    ) : (
                      `${Number(r.soll_stunden).toFixed(1)} h`
                    )}
                  </td>
                  <td className="p-2 text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                    {[r.soll_mo, r.soll_di, r.soll_mi, r.soll_do, r.soll_fr]
                      .map((v) => (v == null ? "·" : Number(v).toFixed(0)))
                      .join(" / ")}
                  </td>
                  <td className="p-2">
                    {isAdmin && (
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) applyVorlage(r.id, e.target.value);
                          e.target.value = "";
                        }}
                        className="h-8 rounded-md border bg-background px-1.5 text-xs"
                      >
                        <option value="">— Vorlage —</option>
                        {VORLAGEN.map((v) => (
                          <option key={v.key} value={v.key}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="p-2">
                    {isAdmin ? (
                      <Input
                        defaultValue={r.notizen ?? ""}
                        onBlur={(e) => updateRow(r.id, { notizen: e.target.value || null })}
                        className="h-8"
                      />
                    ) : (
                      r.notizen ?? ""
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Keine Wochen für {year}. Klicken Sie „Jahr initialisieren".
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
