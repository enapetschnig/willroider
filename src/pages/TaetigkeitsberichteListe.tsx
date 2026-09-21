/**
 * Freigabe-Liste der Tätigkeitsberichte (Geschäftsführung / Stellvertreter).
 *
 * Änderungswunsch Johannes Maurer (21.09.2026): Tätigkeitsberichte müssen
 * wie die Stundenberichte freigegeben werden. Je Periode (21.–20.) steht
 * hier jeder Angestellte mit Stand: nicht unterschrieben, wartet auf
 * Freigabe, freigegeben. Freigeben = Unterschrift des Freigebers, danach
 * ist die Periode für den Angestellten gesperrt („Wieder öffnen" hebt das auf).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, CheckCircle2, Clock, Eye, Loader2, LockOpen, PenLine, AlertCircle } from "lucide-react";
import { localIso } from "@/lib/dateFmt";
import { periodeVonDatum, periodeVerschieben, periodeTitel, type Periode } from "@/lib/taetigkeitsbericht";

type Angestellter = { id: string; vorname: string; nachname: string };
type Zeile = {
  mitarbeiter_id: string;
  jahr: number;
  monat: number;
  status: "unterschrieben" | "freigegeben";
  unterschrieben_am: string | null;
  freigegeben_am: string | null;
  freigegeben_von: string | null;
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" }) : "";

export default function TaetigkeitsberichteListe() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [periode, setPeriode] = useState<Periode>(() => {
    // Nach dem 20. ist die abgelaufene Periode die interessante.
    const heute = localIso();
    const p = periodeVonDatum(heute);
    return Number(heute.slice(8, 10)) > 20 ? periodeVerschieben(p, -1) : p;
  });
  const [angestellte, setAngestellte] = useState<Angestellter[]>([]);
  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const [tage, setTage] = useState<Record<string, number>>({});
  const [wartendAlle, setWartendAlle] = useState<Zeile[]>([]);
  const [laden, setLaden] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLaden(true);
    const [{ data: an }, { data: z }, { data: t }, { data: w }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, vorname, nachname")
        .eq("is_active", true)
        .eq("zeiterfassung_typ", "angestellter" as any)
        .order("nachname"),
      (supabase as any)
        .from("taetigkeitsbericht_unterschriften")
        .select("mitarbeiter_id, jahr, monat, status, unterschrieben_am, freigegeben_am, freigegeben_von")
        .eq("jahr", periode.jahr)
        .eq("monat", periode.monat),
      supabase
        .from("stunden_tage")
        .select("mitarbeiter_id")
        .gte("datum", periode.von)
        .lte("datum", periode.bis)
        .range(0, 9999),
      (supabase as any)
        .from("taetigkeitsbericht_unterschriften")
        .select("mitarbeiter_id, jahr, monat, status, unterschrieben_am, freigegeben_am, freigegeben_von")
        .eq("status", "unterschrieben")
        .order("jahr", { ascending: false })
        .order("monat", { ascending: false }),
    ]);
    setAngestellte((an as Angestellter[]) ?? []);
    setZeilen((z as Zeile[]) ?? []);
    const count: Record<string, number> = {};
    ((t as { mitarbeiter_id: string }[]) ?? []).forEach((r) => {
      count[r.mitarbeiter_id] = (count[r.mitarbeiter_id] ?? 0) + 1;
    });
    setTage(count);
    setWartendAlle((w as Zeile[]) ?? []);
    setLaden(false);
  }, [periode]);

  useEffect(() => {
    void load();
  }, [load]);

  const zeileVon = (id: string) => zeilen.find((z) => z.mitarbeiter_id === id) ?? null;
  const nameVon = (id: string | null) => {
    const a = angestellte.find((x) => x.id === id);
    return a ? `${a.nachname} ${a.vorname}` : "";
  };

  const sortiert = useMemo(() => {
    const rang = (id: string) => {
      const z = zeileVon(id);
      if (!z) return 1;
      return z.status === "unterschrieben" ? 0 : 2;
    };
    return [...angestellte].sort((a, b) => rang(a.id) - rang(b.id) || a.nachname.localeCompare(b.nachname, "de-AT"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [angestellte, zeilen]);

  const oeffnen = (id: string, freigeben = false) =>
    navigate(
      `/taetigkeitsbericht?ma=${id}&jahr=${periode.jahr}&monat=${periode.monat}${freigeben ? "&freigeben=1" : ""}`,
    );

  const wiederOeffnen = async (a: Angestellter) => {
    if (!window.confirm(`Tätigkeitsbericht von ${a.vorname} ${a.nachname} wieder öffnen? Die Freigabe wird zurückgenommen.`)) return;
    setBusy(a.id);
    const { error } = await (supabase as any).rpc("taetigkeitsbericht_wieder_oeffnen", {
      p_mitarbeiter: a.id,
      p_jahr: periode.jahr,
      p_monat: periode.monat,
    });
    setBusy(null);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Wieder geöffnet" });
    void load();
  };

  const wartendAndere = wartendAlle.filter((w) => !(w.jahr === periode.jahr && w.monat === periode.monat));

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <PageHeader
        title="Tätigkeitsberichte freigeben"
        description="Angestellte unterschreiben, Geschäftsführung gibt frei — danach ist die Periode gesperrt und das PDF liegt im Archiv und in SharePoint."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setPeriode((p) => periodeVerschieben(p, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-1 text-sm sm:text-base font-bold whitespace-nowrap tabular-nums">
              {periodeTitel(periode)}
            </span>
            <Button variant="outline" size="sm" onClick={() => setPeriode((p) => periodeVerschieben(p, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </>
        }
      />

      {wartendAndere.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardContent className="p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
              <AlertCircle className="h-4 w-4" />
              {wartendAndere.length} Bericht{wartendAndere.length === 1 ? "" : "e"} aus anderen Perioden warten auf Freigabe
            </div>
            {wartendAndere.map((w) => (
              <button
                key={`${w.mitarbeiter_id}-${w.jahr}-${w.monat}`}
                type="button"
                className="w-full text-left text-sm py-1 px-1 rounded hover:bg-amber-100/60 flex items-center gap-2"
                onClick={() => {
                  const p = periodeVonDatum(`${w.jahr}-${String(w.monat).padStart(2, "0")}-20`);
                  setPeriode(p);
                }}
              >
                <span className="flex-1">{nameVon(w.mitarbeiter_id) || "—"}</span>
                <span className="text-xs text-muted-foreground">{periodeTitel(periodeVonDatum(`${w.jahr}-${String(w.monat).padStart(2, "0")}-20`))}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {laden ? (
            <div className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Lade…
            </div>
          ) : (
            <div className="divide-y">
              {sortiert.map((a) => {
                const z = zeileVon(a.id);
                const n = tage[a.id] ?? 0;
                const status = !z ? "offen" : z.status;
                return (
                  <div key={a.id} className="flex items-center gap-2 px-3 py-2.5 flex-wrap">
                    <div className="flex-1 min-w-[10rem]">
                      <div className="font-medium">
                        {a.nachname} {a.vorname}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {n} Tag{n === 1 ? "" : "e"} eingetragen
                        {z?.unterschrieben_am ? ` · unterschrieben am ${fmt(z.unterschrieben_am)}` : ""}
                        {z?.status === "freigegeben"
                          ? ` · freigegeben am ${fmt(z.freigegeben_am)}${nameVon(z.freigegeben_von) ? ` von ${nameVon(z.freigegeben_von)}` : ""}`
                          : ""}
                      </div>
                    </div>
                    {status === "offen" && (
                      <Badge variant="outline" className="bg-slate-100 text-slate-800 border-slate-300 text-[10px]">
                        <Clock className="h-3 w-3 mr-1" /> Nicht unterschrieben
                      </Badge>
                    )}
                    {status === "unterschrieben" && (
                      <Badge variant="outline" className="bg-blue-100 text-blue-900 border-blue-300 text-[10px]">
                        <PenLine className="h-3 w-3 mr-1" /> Wartet auf Freigabe
                      </Badge>
                    )}
                    {status === "freigegeben" && (
                      <Badge variant="outline" className="bg-emerald-100 text-emerald-900 border-emerald-300 text-[10px]">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Freigegeben
                      </Badge>
                    )}
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-8" onClick={() => oeffnen(a.id)}>
                        <Eye className="h-3.5 w-3.5 sm:mr-1" />
                        <span className="hidden sm:inline">Ansehen</span>
                      </Button>
                      {status === "unterschrieben" && (
                        <Button size="sm" className="h-8" onClick={() => oeffnen(a.id, true)} title="Bericht ansehen und mit Unterschrift freigeben">
                          <CheckCircle2 className="h-3.5 w-3.5 sm:mr-1" />
                          <span className="hidden sm:inline">Freigeben</span>
                        </Button>
                      )}
                      {status === "freigegeben" && (
                        <Button size="sm" variant="ghost" className="h-8" onClick={() => wiederOeffnen(a)} disabled={busy === a.id}>
                          <LockOpen className="h-3.5 w-3.5 sm:mr-1" />
                          <span className="hidden sm:inline">Wieder öffnen</span>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
              {sortiert.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">Keine Angestellten gefunden.</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
