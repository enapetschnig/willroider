import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, ChevronLeft, ChevronRight, Filter, Building2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { Database, BaustellenStatus } from "@/integrations/supabase/types";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];
type Termin = Database["public"]["Tables"]["baustellen_termine"]["Row"];

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfISOWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay() || 7;
  if (day !== 1) date.setDate(date.getDate() - (day - 1));
  date.setHours(0, 0, 0, 0);
  return date;
}

function isoWeek(d: Date): { year: number; week: number } {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  const week =
    1 +
    Math.round(((date.getTime() - week1.getTime()) / DAY_MS - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return { year: date.getFullYear(), week };
}

const STATUS_COLOR: Record<BaustellenStatus, string> = {
  aktiv: "bg-emerald-500",
  geplant: "bg-blue-500",
  pausiert: "bg-amber-500",
  abgeschlossen: "bg-gray-400",
};

const STATUS_DOT: Record<BaustellenStatus, string> = {
  aktiv: "#10b981",
  geplant: "#3b82f6",
  pausiert: "#f59e0b",
  abgeschlossen: "#9ca3af",
};

const STATUS_LABEL: Record<BaustellenStatus, string> = {
  aktiv: "Aktiv",
  geplant: "Geplant",
  pausiert: "Pausiert",
  abgeschlossen: "Abgeschlossen",
};

export default function Arbeitsplanung() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [partien, setPartien] = useState<Partie[]>([]);
  const [termine, setTermine] = useState<Termin[]>([]);
  const [filterPartie, setFilterPartie] = useState<string>("alle");
  const [weeksVisible, setWeeksVisible] = useState(20);
  const [anchorWeek, setAnchorWeek] = useState<Date>(() => {
    const today = new Date();
    today.setDate(today.getDate() - 14); // start 2 weeks ago
    return startOfISOWeek(today);
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Baustelle> | null>(null);
  const dayWidth = 18; // px

  const load = async () => {
    const [bs, p, t] = await Promise.all([
      supabase.from("baustellen").select("*").order("start_datum", { ascending: true }),
      supabase.from("partien").select("*").order("name"),
      supabase.from("baustellen_termine").select("*"),
    ]);
    setBaustellen((bs.data as Baustelle[]) ?? []);
    setPartien((p.data as Partie[]) ?? []);
    setTermine((t.data as Termin[]) ?? []);
  };

  useEffect(() => {
    load();

    const ch = supabase
      .channel("planung-bs")
      .on("postgres_changes", { event: "*", schema: "public", table: "baustellen" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "baustellen_termine" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const totalDays = weeksVisible * 7;
  const rangeStart = anchorWeek;
  const rangeEnd = new Date(anchorWeek.getTime() + totalDays * DAY_MS);

  const partienById = useMemo(() => Object.fromEntries(partien.map((p) => [p.id, p])), [partien]);

  const grouped = useMemo(() => {
    const filtered = baustellen.filter((b) => {
      if (filterPartie === "alle") return true;
      if (filterPartie === "ohne") return !b.partie_id;
      return b.partie_id === filterPartie;
    });
    const groups = new Map<string, { partie: Partie | null; rows: Baustelle[] }>();
    for (const b of filtered) {
      const key = b.partie_id ?? "ohne";
      if (!groups.has(key)) {
        groups.set(key, { partie: b.partie_id ? partienById[b.partie_id] : null, rows: [] });
      }
      groups.get(key)!.rows.push(b);
    }
    return [...groups.values()].sort((a, b) =>
      (a.partie?.name ?? "ZZ").localeCompare(b.partie?.name ?? "ZZ")
    );
  }, [baustellen, filterPartie, partienById]);

  const dayHeaders = useMemo(() => {
    const days: { date: Date; week: number; year: number; isMonday: boolean; isToday: boolean }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(rangeStart.getTime() + i * DAY_MS);
      const w = isoWeek(d);
      days.push({
        date: d,
        week: w.week,
        year: w.year,
        isMonday: d.getDay() === 1,
        isToday: d.getTime() === today.getTime(),
      });
    }
    return days;
  }, [rangeStart, totalDays]);

  const weekHeaders = useMemo(() => {
    const out: { week: number; year: number; offsetDays: number; widthDays: number }[] = [];
    let cur: { week: number; year: number; offsetDays: number; widthDays: number } | null = null;
    dayHeaders.forEach((d, i) => {
      if (!cur || cur.week !== d.week || cur.year !== d.year) {
        if (cur) out.push(cur);
        cur = { week: d.week, year: d.year, offsetDays: i, widthDays: 1 };
      } else {
        cur.widthDays++;
      }
    });
    if (cur) out.push(cur);
    return out;
  }, [dayHeaders]);

  const positionFor = (b: Baustelle) => {
    if (!b.start_datum) return null;
    const start = new Date(b.start_datum);
    start.setHours(0, 0, 0, 0);
    const end = b.end_datum ? new Date(b.end_datum) : new Date(start.getTime() + 7 * DAY_MS);
    end.setHours(0, 0, 0, 0);
    if (end < rangeStart || start > rangeEnd) return null;
    const clampedStart = start < rangeStart ? rangeStart : start;
    const clampedEnd = end > rangeEnd ? rangeEnd : end;
    const left = ((clampedStart.getTime() - rangeStart.getTime()) / DAY_MS) * dayWidth;
    const width = ((clampedEnd.getTime() - clampedStart.getTime()) / DAY_MS + 1) * dayWidth;
    return { left, width };
  };

  const movePeriod = (weeks: number) => {
    const next = new Date(anchorWeek.getTime() + weeks * 7 * DAY_MS);
    setAnchorWeek(startOfISOWeek(next));
  };

  const onSubmitBaustelle = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      bvh_name: fd.get("bvh_name") as string,
      kostenstelle: (fd.get("kostenstelle") as string) || null,
      bauherr: (fd.get("bauherr") as string) || null,
      baustellen_adresse: (fd.get("adresse") as string) || null,
      ort: (fd.get("ort") as string) || null,
      plz: (fd.get("plz") as string) || null,
      start_datum: (fd.get("start_datum") as string) || null,
      end_datum: (fd.get("end_datum") as string) || null,
      status: (fd.get("status") as BaustellenStatus) || "geplant",
      partie_id: (fd.get("partie_id") as string) || null,
      auftragssumme: fd.get("auftragssumme") ? Number(fd.get("auftragssumme")) : null,
      art_bauarbeiten: (fd.get("art_bauarbeiten") as string) || null,
      notizen: (fd.get("notizen") as string) || null,
    };

    const { error } = editing?.id
      ? await supabase.from("baustellen").update(payload).eq("id", editing.id)
      : await supabase.from("baustellen").insert(payload as any);

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: editing?.id ? "Baustelle aktualisiert" : "Baustelle angelegt" });
    setDialogOpen(false);
    setEditing(null);
    load();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Arbeitsplanung"
        description="Gantt-Chart aller Baustellen über Kalenderwochen, gruppiert nach Partien."
        actions={
          isAdmin ? (
            <Button
              onClick={() => {
                setEditing({});
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Neue Baustelle
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => movePeriod(-4)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const t = new Date();
              t.setDate(t.getDate() - 14);
              setAnchorWeek(startOfISOWeek(t));
            }}
          >
            Heute
          </Button>
          <Button variant="outline" size="sm" onClick={() => movePeriod(4)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="text-sm font-medium px-2">
            KW {isoWeek(rangeStart).week}/{isoWeek(rangeStart).year} – KW{" "}
            {isoWeek(new Date(rangeEnd.getTime() - DAY_MS)).week}/
            {isoWeek(new Date(rangeEnd.getTime() - DAY_MS)).year}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={filterPartie} onValueChange={setFilterPartie}>
              <SelectTrigger className="w-44 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alle">Alle Partien</SelectItem>
                <SelectItem value="ohne">Ohne Partie</SelectItem>
                {partien.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(weeksVisible)}
              onValueChange={(v) => setWeeksVisible(parseInt(v, 10))}
            >
              <SelectTrigger className="w-32 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="8">8 Wochen</SelectItem>
                <SelectItem value="12">12 Wochen</SelectItem>
                <SelectItem value="20">20 Wochen</SelectItem>
                <SelectItem value="30">30 Wochen</SelectItem>
                <SelectItem value="52">52 Wochen</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Mobile: simple list (Gantt only on >=md) */}
      <div className="md:hidden space-y-2">
        {grouped.map((g) => (
          <div key={g.partie?.id ?? "ohne"}>
            <div
              className="px-3 py-1.5 rounded-t-md text-xs font-semibold flex items-center gap-2"
              style={{
                background: g.partie ? `${g.partie.farbcode}20` : "hsl(var(--muted))",
                color: g.partie?.farbcode ?? undefined,
              }}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: g.partie?.farbcode ?? "#999" }}
              />
              {g.partie?.name ?? "Ohne Partie"}
              <span className="ml-auto text-[10px] opacity-70">{g.rows.length}</span>
            </div>
            <div className="space-y-1.5 pt-1.5">
              {g.rows.map((b) => (
                <Link to={`/baustellen/${b.id}`} key={b.id}>
                  <Card>
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm truncate">{b.bvh_name}</div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {[b.kostenstelle, b.ort].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {STATUS_LABEL[b.status]}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {b.start_datum && new Date(b.start_datum).toLocaleDateString("de-AT")} –{" "}
                        {b.end_datum ? new Date(b.end_datum).toLocaleDateString("de-AT") : "offen"}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: Gantt chart */}
      <Card className="overflow-hidden hidden md:block">
        <div className="flex">
          {/* Left fixed multi-column area (Excel-style) */}
          <div className="shrink-0 border-r bg-card" style={{ width: 460 }}>
            {/* Two-row header to match timeline header height (28+28=56) */}
            <div className="bg-muted/60 border-b sticky top-0 z-10" style={{ height: 56 }}>
              <div className="grid h-full text-[10px] font-semibold uppercase tracking-wide" style={{ gridTemplateColumns: "1fr 90px 80px 80px 50px" }}>
                <div className="px-2 py-1 border-r flex items-end">Bauvorhaben (BVH)</div>
                <div className="px-2 py-1 border-r flex items-end">Kostenstelle</div>
                <div className="px-2 py-1 border-r flex items-end">Start</div>
                <div className="px-2 py-1 border-r flex items-end">Ende</div>
                <div className="px-2 py-1 flex items-end">Status</div>
              </div>
            </div>
            {grouped.map((g) => (
              <div key={g.partie?.id ?? "ohne"}>
                <div
                  className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide flex items-center gap-2 border-b"
                  style={{
                    background: g.partie ? `${g.partie.farbcode}25` : "hsl(var(--muted))",
                    color: g.partie?.farbcode ?? undefined,
                    height: 28,
                  }}
                >
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ background: g.partie?.farbcode ?? "#999" }}
                  />
                  {g.partie?.name ?? "Ohne Partie"}
                  <span className="ml-auto text-[10px] opacity-70">{g.rows.length} BVH</span>
                </div>
                {g.rows.map((b) => (
                  <Link
                    to={`/baustellen/${b.id}`}
                    key={b.id}
                    className="grid border-b text-[11px] hover:bg-muted/50 cursor-pointer"
                    style={{
                      gridTemplateColumns: "1fr 90px 80px 80px 50px",
                      height: 28,
                    }}
                  >
                    <div className="px-2 flex items-center gap-1.5 border-r min-w-0">
                      <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="font-medium truncate">{b.bvh_name}</span>
                    </div>
                    <div className="px-2 flex items-center border-r truncate text-muted-foreground">
                      {b.kostenstelle ?? "—"}
                    </div>
                    <div className="px-2 flex items-center border-r text-muted-foreground tabular-nums">
                      {b.start_datum ? new Date(b.start_datum).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—"}
                    </div>
                    <div className="px-2 flex items-center border-r text-muted-foreground tabular-nums">
                      {b.end_datum ? new Date(b.end_datum).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—"}
                    </div>
                    <div className="px-1 flex items-center justify-center">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: STATUS_DOT[b.status] }}
                        title={STATUS_LABEL[b.status]}
                      />
                    </div>
                  </Link>
                ))}
              </div>
            ))}
            {grouped.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Noch keine Baustellen.
              </div>
            )}
          </div>

          {/* Timeline */}
          <div className="flex-1 overflow-x-auto">
            <div style={{ width: totalDays * dayWidth, position: "relative" }}>
              {/* Headers */}
              <div className="bg-muted/60 sticky top-0 z-10">
                <div className="flex border-b" style={{ height: 28 }}>
                  {weekHeaders.map((w, i) => (
                    <div
                      key={i}
                      className="text-[11px] font-semibold flex items-center justify-center border-r"
                      style={{ width: w.widthDays * dayWidth }}
                    >
                      KW {w.week}
                    </div>
                  ))}
                </div>
                <div className="flex border-b" style={{ height: 28 }}>
                  {dayHeaders.map((d, i) => {
                    const isWeekend = d.date.getDay() === 0 || d.date.getDay() === 6;
                    const dow = ["S", "M", "D", "M", "D", "F", "S"][d.date.getDay()];
                    return (
                      <div
                        key={i}
                        className={`text-[9px] flex flex-col items-center justify-center border-r leading-tight ${
                          d.isToday
                            ? "bg-primary/20 text-primary font-semibold"
                            : isWeekend
                            ? "bg-muted/40 text-muted-foreground"
                            : "text-muted-foreground"
                        }`}
                        style={{ width: dayWidth }}
                      >
                        <span className="opacity-70">{dow}</span>
                        <span className="font-semibold tabular-nums">{d.date.getDate()}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Body */}
              <div className="relative">
                {grouped.map((g) => (
                  <div key={g.partie?.id ?? "ohne"}>
                    {/* Group spacer matches left column */}
                    <div
                      className="border-b"
                      style={{
                        height: 28,
                        background: g.partie ? `${g.partie.farbcode}25` : "hsl(var(--muted))",
                      }}
                    />
                    {g.rows.map((b) => {
                      const pos = positionFor(b);
                      const baustelleColor = g.partie?.farbcode ?? "#3b82f6";
                      const myTermine = termine.filter((t) => t.baustelle_id === b.id);
                      return (
                        <div
                          key={b.id}
                          className="border-b relative"
                          style={{ height: 28 }}
                        >
                          {/* Vertical day grid */}
                          <div className="absolute inset-0 flex pointer-events-none">
                            {dayHeaders.map((d, i) => (
                              <div
                                key={i}
                                className={`border-r ${
                                  d.isToday
                                    ? "bg-primary/10"
                                    : d.date.getDay() === 0 || d.date.getDay() === 6
                                    ? "bg-muted/40"
                                    : ""
                                }`}
                                style={{ width: dayWidth }}
                              />
                            ))}
                          </div>
                          {/* Bar */}
                          {pos && (
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setEditing(b);
                                setDialogOpen(true);
                              }}
                              className="absolute top-[3px] bottom-[3px] rounded-sm shadow-sm flex items-center px-1.5 text-[10px] text-white font-medium cursor-pointer hover:brightness-110 truncate"
                              style={{
                                left: pos.left,
                                width: Math.max(pos.width, dayWidth),
                                background: baustelleColor,
                                opacity: b.status === "abgeschlossen" ? 0.55 : 1,
                                border:
                                  b.status === "geplant"
                                    ? "1.5px dashed rgba(255,255,255,0.7)"
                                    : "1px solid rgba(0,0,0,0.15)",
                              }}
                              title={`${b.bvh_name} · ${STATUS_LABEL[b.status]}`}
                            >
                              <span className="truncate">{b.bvh_name}</span>
                            </div>
                          )}
                          {/* Termine markers */}
                          {myTermine.map((t) => {
                            const td = new Date(t.termin_datum);
                            td.setHours(0, 0, 0, 0);
                            if (td < rangeStart || td > rangeEnd) return null;
                            const left =
                              ((td.getTime() - rangeStart.getTime()) / DAY_MS) * dayWidth +
                              dayWidth / 2;
                            return (
                              <div
                                key={t.id}
                                className="absolute top-0 bottom-0 flex items-center"
                                style={{ left: left - 6 }}
                                title={`${t.typ}: ${t.bezeichnung ?? ""}`}
                              >
                                <span className="h-3 w-3 rotate-45 bg-yellow-400 border border-yellow-700" />
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-emerald-500" /> Aktiv
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-blue-500" /> Geplant
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-amber-500" /> Pausiert
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-gray-400" /> Abgeschlossen
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rotate-45 bg-yellow-400 border border-yellow-700" /> Kran/Material-Termin
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Baustelle bearbeiten" : "Neue Baustelle"}</DialogTitle>
            <DialogDescription>Stammdaten der Baustelle</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmitBaustelle} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="bvh_name">BVH (Bauvorhaben) *</Label>
                <Input id="bvh_name" name="bvh_name" defaultValue={editing?.bvh_name ?? ""} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kostenstelle">Kostenstelle</Label>
                <Input id="kostenstelle" name="kostenstelle" defaultValue={editing?.kostenstelle ?? ""} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bauherr">Bauherr</Label>
                <Input id="bauherr" name="bauherr" defaultValue={editing?.bauherr ?? ""} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="adresse">Baustellen-Adresse</Label>
                <Input id="adresse" name="adresse" defaultValue={editing?.baustellen_adresse ?? ""} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plz">PLZ</Label>
                <Input id="plz" name="plz" defaultValue={editing?.plz ?? ""} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ort">Ort</Label>
                <Input id="ort" name="ort" defaultValue={editing?.ort ?? ""} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="start_datum">Start</Label>
                <Input
                  id="start_datum"
                  name="start_datum"
                  type="date"
                  defaultValue={editing?.start_datum ?? ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end_datum">Ende</Label>
                <Input
                  id="end_datum"
                  name="end_datum"
                  type="date"
                  defaultValue={editing?.end_datum ?? ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="status">Status</Label>
                <select
                  id="status"
                  name="status"
                  defaultValue={editing?.status ?? "geplant"}
                  className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="geplant">Geplant</option>
                  <option value="aktiv">Aktiv</option>
                  <option value="pausiert">Pausiert</option>
                  <option value="abgeschlossen">Abgeschlossen</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="partie_id">Partie</Label>
                <select
                  id="partie_id"
                  name="partie_id"
                  defaultValue={editing?.partie_id ?? ""}
                  className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">— ohne Partie —</option>
                  {partien.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="auftragssumme">Auftragssumme (EUR)</Label>
                <Input
                  id="auftragssumme"
                  name="auftragssumme"
                  type="number"
                  step="0.01"
                  defaultValue={editing?.auftragssumme ?? ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="art_bauarbeiten">Art der Bauarbeiten</Label>
                <Input
                  id="art_bauarbeiten"
                  name="art_bauarbeiten"
                  defaultValue={editing?.art_bauarbeiten ?? ""}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="notizen">Notizen</Label>
                <Textarea id="notizen" name="notizen" defaultValue={editing?.notizen ?? ""} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Abbrechen
              </Button>
              <Button type="submit">{editing?.id ? "Speichern" : "Anlegen"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
