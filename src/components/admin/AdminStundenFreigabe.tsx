/**
 * Büro-Bulk-Freigabe der Mitarbeiter-Stunden.
 * Zeigt alle ma_bestaetigt-Tage in einem Zeitraum, erlaubt Massen-Freigabe
 * an die Lohnverrechnung (Status → buero_freigabe). Re-Open eines bereits
 * freigegebenen Tages ist ebenfalls möglich, solange er noch nicht exportiert
 * wurde.
 */

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  useStundenTageList,
  useSetStundenStatus,
} from "@/hooks/useStundenTag";
import { usePausenConfig, useArbeitszeitLimits } from "@/hooks/useStammdatenStunden";
import { berechneTagZeiten, fmtH } from "@/lib/zeiterfassung";
import { CheckCircle2, RotateCcw, Loader2, FileCheck2, Filter } from "lucide-react";
import type { BuchungStatus } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const STATUS_BADGE: Record<BuchungStatus, { label: string; cls: string }> = {
  erfasst: { label: "Erfasst", cls: "bg-blue-100 text-blue-900 border-blue-300" },
  ma_bestaetigt: { label: "Bestätigt", cls: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  zm_freigabe: { label: "ZM frei", cls: "bg-purple-100 text-purple-900 border-purple-300" },
  buero_freigabe: { label: "Büro frei", cls: "bg-orange-100 text-orange-900 border-orange-300" },
  exportiert: { label: "Exportiert", cls: "bg-gray-300 text-gray-900 border-gray-400" },
  abgelehnt: { label: "Abgelehnt", cls: "bg-red-100 text-red-900 border-red-300" },
};

function isoDaysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function AdminStundenFreigabe() {
  const { toast } = useToast();
  const [from, setFrom] = useState(isoDaysAgo(14));
  const [to, setTo] = useState(todayIso());
  const [statusFilter, setStatusFilter] = useState<"alle" | "ma_bestaetigt" | "erfasst" | "buero_freigabe">(
    "ma_bestaetigt",
  );
  const [members, setMembers] = useState<Profile[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, vorname, nachname")
        .eq("is_active", true)
        .order("nachname");
      setMembers((data as Profile[]) ?? []);
    })();
  }, []);

  const { data: tage = [], isLoading, refetch } = useStundenTageList({
    fromDate: from,
    toDate: to,
  });
  const { data: pausen } = usePausenConfig();
  const { data: limits } = useArbeitszeitLimits();
  const mut = useSetStundenStatus();

  const filtered = useMemo(
    () =>
      tage.filter((t) =>
        statusFilter === "alle" ? true : t.tag.status === statusFilter,
      ),
    [tage, statusFilter],
  );

  const byMa = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const t of filtered) {
      const arr = map.get(t.tag.mitarbeiter_id) ?? [];
      arr.push(t);
      map.set(t.tag.mitarbeiter_id, arr);
    }
    return Array.from(map.entries()).map(([uid, list]) => ({
      mitarbeiter: members.find((m) => m.id === uid),
      list,
      summe: list.reduce((a, t) => a + Number(t.tag.netto_stunden), 0),
    }));
  }, [filtered, members]);

  const freigebenAlle = async () => {
    const ids = filtered
      .filter((t) => t.tag.status === "ma_bestaetigt" || t.tag.status === "erfasst")
      .map((t) => t.tag.id);
    if (ids.length === 0) {
      toast({ title: "Nichts zu freizugeben" });
      return;
    }
    if (!window.confirm(`${ids.length} Tag(e) für Lohn freigeben?`)) return;
    try {
      await mut.mutateAsync({ ids, newStatus: "buero_freigabe" });
      toast({ title: `${ids.length} Tag(e) freigegeben` });
      refetch();
    } catch (e) {
      toast({ variant: "destructive", title: "Fehler", description: (e as Error).message });
    }
  };

  const reopen = async (id: string) => {
    if (!window.confirm("Tag wieder öffnen (zur Bearbeitung)?")) return;
    try {
      await mut.mutateAsync({ ids: [id], newStatus: "erfasst" });
      toast({ title: "Tag re-geöffnet" });
      refetch();
    } catch (e) {
      toast({ variant: "destructive", title: "Fehler", description: (e as Error).message });
    }
  };

  return (
    <div className="space-y-3">
      {/* Filter-Card */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 font-semibold">
            <Filter className="h-4 w-4 text-primary" />
            Zeitraum &amp; Filter
          </div>
          <div className="grid sm:grid-cols-4 gap-2 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Von</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Bis</Label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="ma_bestaetigt">Bestätigt (offen)</option>
                <option value="erfasst">Erfasst (nicht bestätigt)</option>
                <option value="buero_freigabe">Büro freigegeben</option>
                <option value="alle">Alle</option>
              </select>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setFrom(isoDaysAgo(14));
                  setTo(todayIso());
                }}
                className="h-9 flex-1"
              >
                Letzte 2 Wo
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk-Aktion */}
      <Card>
        <CardContent className="p-4 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold flex items-center gap-1.5">
              <FileCheck2 className="h-4 w-4 text-primary" />
              {filtered.length} Tag{filtered.length === 1 ? "" : "e"} im Filter ·{" "}
              {byMa.length} Mitarbeiter
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Klick auf „Alle freigeben" setzt alle erfassten und bestätigten
              Tage auf <strong>Büro-Freigabe</strong> — bereit für Lohn-Export.
            </div>
          </div>
          <Button
            onClick={freigebenAlle}
            disabled={mut.isPending || filtered.length === 0}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {mut.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            <CheckCircle2 className="h-4 w-4 mr-1.5" /> Alle freigeben
          </Button>
        </CardContent>
      </Card>

      {/* Liste pro Mitarbeiter */}
      {isLoading ? (
        <Card>
          <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lade Tage…
          </CardContent>
        </Card>
      ) : byMa.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-center text-sm text-muted-foreground">
            Keine Tage im Filter.
          </CardContent>
        </Card>
      ) : (
        byMa.map(({ mitarbeiter, list, summe }) => (
          <Card key={mitarbeiter?.id ?? "unknown"}>
            <CardContent className="p-3 sm:p-4 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="font-semibold">
                  {mitarbeiter
                    ? `${mitarbeiter.nachname} ${mitarbeiter.vorname}`
                    : "Unbekannt"}
                </div>
                <div className="text-sm tabular-nums">
                  Summe Netto: <strong>{fmtH(summe)}</strong>
                </div>
              </div>
              <div className="space-y-1">
                {list
                  .sort((a, b) => b.tag.datum.localeCompare(a.tag.datum))
                  .map((t) => {
                    const isArbeit =
                      t.tag.tag_status === "baustelle" || t.tag.tag_status === "firma";
                    const zeiten =
                      isArbeit && pausen
                        ? berechneTagZeiten({
                            nettoStunden: Number(t.tag.netto_stunden),
                            vmPause: t.tag.vm_pause,
                            mittagPause: t.tag.mittag_pause,
                            pausenConfig: {
                              vmDauerMin: pausen.vm.dauer_minuten,
                              mittagDauerMin: pausen.mittag.dauer_minuten,
                            },
                            arbeitsbeginn:
                              t.tag.arbeitsbeginn?.slice(0, 5) ||
                              limits?.arbeitsbeginn_default?.slice(0, 5) ||
                              "07:00",
                          })
                        : null;
                    const sb = STATUS_BADGE[t.tag.status];
                    const canReopen =
                      t.tag.status === "buero_freigabe" || t.tag.status === "zm_freigabe";
                    return (
                      <div
                        key={t.tag.id}
                        className="flex items-center gap-2 text-xs px-2 py-1.5 rounded border bg-card"
                      >
                        <span className="font-semibold tabular-nums w-16">
                          {new Date(t.tag.datum).toLocaleDateString("de-AT", {
                            day: "2-digit",
                            month: "2-digit",
                          })}
                        </span>
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {t.tag.tag_status}
                        </Badge>
                        <span className="tabular-nums font-semibold">
                          {fmtH(Number(t.tag.netto_stunden))}
                        </span>
                        {zeiten && (
                          <span className="text-muted-foreground tabular-nums">
                            {zeiten.von}–{zeiten.bis}
                          </span>
                        )}
                        <span className="flex-1" />
                        <Badge variant="outline" className={`text-[10px] ${sb.cls}`}>
                          {sb.label}
                        </Badge>
                        {canReopen && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => reopen(t.tag.id)}
                            title="Wieder zur Bearbeitung freigeben"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
