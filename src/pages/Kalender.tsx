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
import type { Database, Wochentyp } from "@/integrations/supabase/types";

type Row = Database["public"]["Tables"]["arbeitszeitkalender"]["Row"];

const TYPE_LABEL: Record<Wochentyp, string> = {
  L: "Lang (38,5h)",
  K: "Kurz (36h)",
  F: "Feiertag",
  U: "Urlaubswoche",
};

export default function Kalender() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [rows, setRows] = useState<Row[]>([]);

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

  const ensureYear = async () => {
    const { data: existing } = await supabase
      .from("arbeitszeitkalender")
      .select("kw")
      .eq("jahr", year);
    const have = new Set((existing ?? []).map((x: any) => x.kw));
    const insertRows = [];
    for (let kw = 1; kw <= 52; kw++) {
      if (!have.has(kw)) {
        insertRows.push({
          jahr: year,
          kw,
          wochentyp: kw % 2 === 0 ? "L" : "K",
          soll_stunden: kw % 2 === 0 ? 38.5 : 36,
        });
      }
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
                <th className="text-left p-2">Feiertage</th>
                <th className="text-left p-2">BU-Tage</th>
                <th className="text-left p-2">Notizen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="p-2 font-medium">KW {r.kw}</td>
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
                  <td className="p-2">
                    {isAdmin ? (
                      <Input
                        defaultValue={r.feiertage ?? ""}
                        onBlur={(e) => updateRow(r.id, { feiertage: e.target.value || null })}
                        className="h-8"
                        placeholder="z.B. Ostermontag"
                      />
                    ) : (
                      r.feiertage ?? "—"
                    )}
                  </td>
                  <td className="p-2">
                    {isAdmin ? (
                      <Input
                        type="number"
                        defaultValue={r.bu_tage ?? 0}
                        onBlur={(e) => updateRow(r.id, { bu_tage: Number(e.target.value) || 0 })}
                        className="h-8 w-20"
                      />
                    ) : (
                      r.bu_tage ?? 0
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
