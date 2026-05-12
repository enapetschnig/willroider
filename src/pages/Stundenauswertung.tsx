import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { TimePickerInput } from "@/components/TimePickerInput";
import { localIso } from "@/lib/dateFmt";
import { autoTaggeld, autoTaggeldReason } from "@/lib/dienstreise";
import {
  ChevronDown,
  ChevronUp,
  Download,
  ChevronLeft,
  ChevronRight,
  Factory,
  MapPin,
  Building2,
  Edit,
  Users,
  Trash2,
  FileSpreadsheet,
  LayoutDashboard,
  Search,
  X,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { UebersichtTabelle } from "@/components/stundenauswertung/UebersichtTabelle";
import { DetailTabelle } from "@/components/stundenauswertung/DetailTabelle";
import { BaustellenTabelle } from "@/components/stundenauswertung/BaustellenTabelle";
import { exportStundenauswertung } from "@/lib/stundenExport";

type PKS = Database["public"]["Tables"]["profile_konten_settings"]["Row"];

type Stunde = Database["public"]["Tables"]["stundenbuchungen"]["Row"];
type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];

type Mode = "self" | "polier" | "admin";

const fmtTime = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

function timeToMin(t: string | null | undefined): number {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function snap15(t: string): string {
  if (!t) return t;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return t;
  const total = h * 60 + m;
  const rounded = Math.round(total / 15) * 15;
  const clamped = Math.max(0, Math.min(23 * 60 + 45, rounded));
  return minToTime(clamped);
}
function calcArbeit(s?: string | null, e?: string | null, pv?: string | null, pb?: string | null) {
  if (!s || !e) return 0;
  const sm = timeToMin(s);
  const em = timeToMin(e);
  if (em <= sm) return 0;
  let total = em - sm;
  if (pv && pb) {
    const pvm = timeToMin(pv);
    const pbm = timeToMin(pb);
    if (pbm > pvm) total -= Math.max(0, Math.min(em, pbm) - Math.max(sm, pvm));
  }
  return Math.max(0, total) / 60;
}

export default function Stundenauswertung() {
  const { user, profile, isAdmin } = useAuth();
  const { toast } = useToast();
  const [polierPartie, setPolierPartie] = useState<Partie | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const [partien, setPartien] = useState<Partie[]>([]);
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [rows, setRows] = useState<Stunde[]>([]);
  const [pks, setPks] = useState<PKS[]>([]);
  const [zaSalden, setZaSalden] = useState<Record<string, number>>({});
  const [urlaubSalden, setUrlaubSalden] = useState<Record<string, number>>({});
  const [monatsabschluesse, setMonatsabschluesse] = useState<Record<string, boolean>>({});
  const [monat, setMonat] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [tab, setTab] = useState<"uebersicht" | "detail" | "baustellen">("uebersicht");
  const [selectedMaId, setSelectedMaId] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"alle" | "offen" | "fehlzeit">("alle");
  const [editing, setEditing] = useState<Stunde | null>(null);

  const mode: Mode = isAdmin ? "admin" : polierPartie ? "polier" : "self";

  // Mode + Mitarbeiter + Stammdaten laden
  useEffect(() => {
    if (!user) return;
    (async () => {
      if (isAdmin) {
        const [{ data: ms }, { data: ps }, { data: bs }] = await Promise.all([
          supabase.from("profiles").select("*").eq("is_active", true).order("nachname"),
          supabase.from("partien").select("*").order("name"),
          supabase.from("baustellen").select("*").order("bvh_name"),
        ]);
        setMembers((ms as Profile[]) ?? []);
        setPartien((ps as Partie[]) ?? []);
        setBaustellen((bs as Baustelle[]) ?? []);
        setPolierPartie(null);
        return;
      }
      const { data: p } = await supabase
        .from("partien")
        .select("*")
        .eq("partieleiter_id", user.id)
        .maybeSingle();
      const { data: bs } = await supabase
        .from("baustellen")
        .select("*")
        .order("bvh_name");
      setBaustellen((bs as Baustelle[]) ?? []);
      if (p) {
        setPolierPartie(p as Partie);
        setPartien([p as Partie]);
        const { data: ms } = await supabase
          .from("profiles")
          .select("*")
          .eq("partie_id", p.id)
          .eq("is_active", true)
          .order("nachname");
        setMembers((ms as Profile[]) ?? []);
      } else {
        setPolierPartie(null);
        // Eigenes Profil als einziges Mitglied (für self-Mode)
        if (profile && user) {
          setMembers([{ ...(profile as any), id: user.id }]);
        } else {
          setMembers([]);
        }
      }
    })();
  }, [user, isAdmin, profile]);

  // Stundenbuchungen + Konten laden
  const reload = () => {
    if (!user) return;
    const monthStart = `${monat}-01`;
    const next = new Date(monthStart);
    next.setMonth(next.getMonth() + 1);
    const monthEnd = localIso(next);

    let q = supabase
      .from("stundenbuchungen")
      .select("*")
      .gte("datum", monthStart)
      .lt("datum", monthEnd)
      .order("datum", { ascending: false });
    if (mode === "admin") {
      // alle
    } else if (mode === "polier" && members.length > 0) {
      const ids = [user.id, ...members.map((m) => m.id)];
      q = q.in("mitarbeiter_id", Array.from(new Set(ids)));
    } else {
      q = q.eq("mitarbeiter_id", user.id);
    }
    q.then(({ data }) => setRows((data as Stunde[]) ?? []));

    // PKS, ZA, Urlaub, Monatsabschluss parallel
    Promise.all([
      supabase.from("profile_konten_settings").select("*"),
      supabase.from("v_za_saldo" as any).select("*"),
      supabase.from("v_urlaubs_saldo" as any).select("*"),
      supabase.from("monatsabschluss").select("mitarbeiter_id").eq("monat", monat),
    ]).then(([pksR, zaR, urR, maR]) => {
      setPks((pksR.data as PKS[]) ?? []);
      const zaMap: Record<string, number> = {};
      ((zaR.data as any[]) ?? []).forEach(
        (r) => (zaMap[r.mitarbeiter_id] = Number(r.saldo_stunden ?? 0))
      );
      setZaSalden(zaMap);
      const urMap: Record<string, number> = {};
      ((urR.data as any[]) ?? []).forEach(
        (r) => (urMap[r.mitarbeiter_id] = Number(r.saldo_tage ?? 0))
      );
      setUrlaubSalden(urMap);
      const maMap: Record<string, boolean> = {};
      ((maR.data as any[]) ?? []).forEach((r) => (maMap[r.mitarbeiter_id] = true));
      setMonatsabschluesse(maMap);
    });
  };
  useEffect(reload, [user, monat, mode, members]);

  const moveMonth = (d: number) => {
    const date = new Date(monat + "-01");
    date.setMonth(date.getMonth() + d);
    setMonat(date.toISOString().slice(0, 7));
  };

  // Filter auf rows anwenden (Suche + Status)
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === "fehlzeit" && !r.fehlzeit_typ) return false;
      if (statusFilter === "offen" && r.status !== "offen") return false;
      if (q) {
        const b = baustellen.find((x) => x.id === r.baustelle_id);
        const m = members.find((x) => x.id === r.mitarbeiter_id);
        const hay = [
          b?.bvh_name,
          b?.kostenstelle,
          r.taetigkeit,
          r.notizen,
          m ? `${m.vorname} ${m.nachname}` : "",
          m?.pers_nr,
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter, baustellen, members]);

  const selectedMa = useMemo(
    () => members.find((m) => m.id === selectedMaId) ?? null,
    [members, selectedMaId]
  );
  const selectedMaPartie = useMemo(
    () => (selectedMa?.partie_id ? partien.find((p) => p.id === selectedMa.partie_id) ?? null : null),
    [partien, selectedMa]
  );
  const selectedMaPks = useMemo(
    () => pks.find((p) => p.profile_id === selectedMaId) ?? null,
    [pks, selectedMaId]
  );
  const detailRows = useMemo(
    () => filteredRows.filter((r) => r.mitarbeiter_id === selectedMaId),
    [filteredRows, selectedMaId]
  );

  const onExportExcel = () => {
    if (members.length === 0 || filteredRows.length === 0) {
      toast({ variant: "destructive", title: "Keine Daten zum Exportieren" });
      return;
    }
    exportStundenauswertung({
      monat,
      rows: filteredRows,
      members,
      baustellen,
      partien,
      pks,
      zaSalden,
      urlaubSalden,
    });
  };

  const removeBuchung = async (r: Stunde) => {
    if (!confirm("Buchung wirklich löschen?")) return;
    const { error } = await supabase.from("stundenbuchungen").delete().eq("id", r.id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Buchung gelöscht" });
    reload();
  };

  const onSelectMa = (uid: string) => {
    setSelectedMaId(uid);
    setTab("detail");
  };

  // Mitarbeiter-Selector im Detail-Tab: alle mit Buchungen oder alle Members
  const maOptionsForDetail = useMemo(() => {
    return [...members].sort((a, b) => a.nachname.localeCompare(b.nachname));
  }, [members]);

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <PageHeader
        title="Stunden-Auswertung"
        description={
          mode === "admin"
            ? "Monatsauswertung aller aktiven Mitarbeiter"
            : mode === "polier"
            ? `Monatsauswertung deiner Partie · ${polierPartie?.name}`
            : "Deine Monatsauswertung"
        }
        actions={
          isAdmin || mode === "polier" ? (
            <Button onClick={onExportExcel} variant="default" size="sm">
              <FileSpreadsheet className="h-4 w-4 mr-1.5" />
              Excel-Export
            </Button>
          ) : undefined
        }
      />

      {/* Filter-Bar */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => moveMonth(-1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="month"
              value={monat}
              onChange={(e) => setMonat(e.target.value)}
              className="h-9 w-[140px] text-center font-medium"
            />
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => moveMonth(1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Suche: Name, BVH, Tätigkeit, Notiz…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 flex-1"
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="alle">Alle Buchungen</option>
            <option value="offen">Nur offene</option>
            <option value="fehlzeit">Nur Fehlzeiten</option>
          </select>

          <Badge variant="outline" className="ml-auto tabular-nums">
            {filteredRows.length} Buchungen
          </Badge>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="uebersicht" className="gap-1.5">
            <LayoutDashboard className="h-4 w-4" />
            <span className="hidden sm:inline">Übersicht</span>
          </TabsTrigger>
          <TabsTrigger value="detail" className="gap-1.5">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Detail</span>
          </TabsTrigger>
          <TabsTrigger value="baustellen" className="gap-1.5">
            <Building2 className="h-4 w-4" />
            <span className="hidden sm:inline">Baustellen</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="uebersicht" className="space-y-3 mt-3">
          <UebersichtTabelle
            monat={monat}
            rows={filteredRows}
            members={members}
            partien={partien}
            pks={pks}
            zaSalden={zaSalden}
            urlaubSalden={urlaubSalden}
            monatsabschluesse={monatsabschluesse}
            onSelectMa={onSelectMa}
          />
        </TabsContent>

        <TabsContent value="detail" className="space-y-3 mt-3">
          {mode !== "self" && (
            <Card>
              <CardContent className="p-3 flex items-center gap-2 flex-wrap">
                <Users className="h-4 w-4 text-muted-foreground" />
                <Label className="text-xs whitespace-nowrap">Mitarbeiter</Label>
                <select
                  value={selectedMaId}
                  onChange={(e) => setSelectedMaId(e.target.value)}
                  className="h-9 rounded-md border bg-background px-2 text-sm flex-1 min-w-[200px]"
                >
                  <option value="">— wählen —</option>
                  {maOptionsForDetail.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nachname}, {m.vorname}
                      {m.pers_nr ? ` (${m.pers_nr})` : ""}
                    </option>
                  ))}
                </select>
              </CardContent>
            </Card>
          )}
          <DetailTabelle
            monat={monat}
            member={
              mode === "self" && user && profile
                ? ({ ...(profile as any), id: user.id } as Profile)
                : selectedMa
            }
            partie={mode === "self" ? polierPartie ?? null : selectedMaPartie}
            rows={
              mode === "self"
                ? filteredRows.filter((r) => r.mitarbeiter_id === user?.id)
                : detailRows
            }
            baustellen={baustellen}
            pks={
              mode === "self" && user
                ? pks.find((p) => p.profile_id === user.id) ?? null
                : selectedMaPks
            }
            zaSaldo={
              mode === "self" && user
                ? zaSalden[user.id] ?? 0
                : zaSalden[selectedMaId] ?? 0
            }
            monatLocked={
              mode === "self" && user
                ? !!monatsabschluesse[user.id]
                : !!monatsabschluesse[selectedMaId]
            }
            isAdmin={isAdmin}
            onEdit={(r) => setEditing(r)}
            onDelete={removeBuchung}
          />
        </TabsContent>

        <TabsContent value="baustellen" className="space-y-3 mt-3">
          <BaustellenTabelle
            rows={filteredRows}
            baustellen={baustellen}
            members={members}
          />
        </TabsContent>
      </Tabs>

      {/* Edit-Dialog (Admin) */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Buchung bearbeiten</DialogTitle>
          </DialogHeader>
          {editing && (
            <EditBuchungForm
              row={editing}
              baustellen={baustellen}
              person={members.find((m) => m.id === editing.mitarbeiter_id)}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                reload();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Edit-Form (Admin kann alle Felder editieren) ───
function EditBuchungForm({
  row,
  baustellen,
  person,
  onClose,
  onSaved,
}: {
  row: Stunde;
  baustellen: Baustelle[];
  person?: Profile;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [datum, setDatum] = useState<string>(row.datum);
  const [baustelleId, setBaustelleId] = useState<string>(row.baustelle_id ?? "");
  const [inFirma, setInFirma] = useState<boolean>(!!row.in_firma);
  const [fehlzeitTyp, setFehlzeitTyp] = useState<string>(row.fehlzeit_typ ?? "");
  const [startZeit, setStartZeit] = useState<string>(fmtTime(row.start_zeit) || "07:00");
  const [endZeit, setEndZeit] = useState<string>(fmtTime(row.end_zeit) || "15:30");
  const [hasPause, setHasPause] = useState<boolean>(!!row.pause_von && !!row.pause_bis);
  const [pauseVon, setPauseVon] = useState<string>(fmtTime(row.pause_von) || "12:00");
  const [pauseBis, setPauseBis] = useState<string>(fmtTime(row.pause_bis) || "12:30");
  const [fehlzeitHours, setFehlzeitHours] = useState<number>(Number(row.fehlzeit_stunden ?? 8));
  const [taetigkeit, setTaetigkeit] = useState<string>(row.taetigkeit ?? "");
  const [fahrstunden, setFahrstunden] = useState<number>(Number(row.fahrstunden ?? 0));
  const [taggeldKurz, setTaggeldKurz] = useState<number>(Number(row.taggeld_kurz ?? 0));
  const [taggeldLang, setTaggeldLang] = useState<number>(Number(row.taggeld_lang ?? 0));
  const [taggeldManuell, setTaggeldManuell] = useState<boolean>(true);
  const [km, setKm] = useState<number>(Number(row.km_gefahren ?? 0));
  const [zulageTyp, setZulageTyp] = useState<string>(row.zulage_typ ?? "");
  const [zulageStunden, setZulageStunden] = useState<number>(Number(row.zulage_stunden ?? 0));
  const [zulageNotiz, setZulageNotiz] = useState<string>(row.zulage_notiz ?? "");

  const liveArbeit = useMemo(
    () =>
      fehlzeitTyp
        ? 0
        : calcArbeit(
            startZeit,
            endZeit,
            hasPause ? pauseVon : null,
            hasPause ? pauseBis : null
          ),
    [fehlzeitTyp, startZeit, endZeit, hasPause, pauseVon, pauseBis]
  );
  const autoTagInput = useMemo(
    () => ({
      arbeitsstunden: liveArbeit,
      fahrstunden,
      inFirma,
      isFehlzeit: !!fehlzeitTyp,
    }),
    [liveArbeit, fahrstunden, inFirma, fehlzeitTyp]
  );
  const autoDiaeten = useMemo(() => autoTaggeld(autoTagInput), [autoTagInput]);
  const autoDiaetenReason = useMemo(
    () => autoTaggeldReason(autoTagInput),
    [autoTagInput]
  );
  useEffect(() => {
    if (taggeldManuell) return;
    setTaggeldKurz(autoDiaeten.kurz);
    setTaggeldLang(autoDiaeten.lang);
  }, [autoDiaeten, taggeldManuell]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let arbeit = 0;
    const update: any = {
      datum,
      taetigkeit: taetigkeit || null,
      fahrstunden,
      taggeld_kurz: !fehlzeitTyp && inFirma ? 0 : taggeldKurz,
      taggeld_lang: !fehlzeitTyp && inFirma ? 0 : taggeldLang,
      km_gefahren: km,
    };
    if (fehlzeitTyp) {
      update.fehlzeit_typ = fehlzeitTyp;
      update.fehlzeit_stunden = fehlzeitHours;
      update.start_zeit = null;
      update.end_zeit = null;
      update.pause_von = null;
      update.pause_bis = null;
      update.arbeitsstunden = 0;
      update.baustelle_id = null;
      update.in_firma = false;
      update.zulage_typ = null;
      update.zulage_stunden = 0;
      update.zulage_notiz = null;
    } else {
      const sStart = snap15(startZeit);
      const sEnd = snap15(endZeit);
      const sPV = hasPause ? snap15(pauseVon) : null;
      const sPB = hasPause ? snap15(pauseBis) : null;
      update.fehlzeit_typ = null;
      update.fehlzeit_stunden = 0;
      update.start_zeit = sStart;
      update.end_zeit = sEnd;
      update.pause_von = sPV;
      update.pause_bis = sPB;
      arbeit = calcArbeit(sStart, sEnd, sPV, sPB);
      update.arbeitsstunden = arbeit;
      update.baustelle_id = baustelleId || null;
      update.in_firma = inFirma;
      update.zulage_typ = zulageTyp || null;
      update.zulage_stunden = zulageTyp ? Math.min(zulageStunden, arbeit) : 0;
      update.zulage_notiz =
        zulageTyp === "andere" ? zulageNotiz.trim() || null : null;
    }

    const { error } = await supabase
      .from("stundenbuchungen")
      .update(update)
      .eq("id", row.id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Buchung aktualisiert" });
    onSaved();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {person && (
        <div className="text-xs text-muted-foreground">
          Mitarbeiter: <strong>{person.vorname} {person.nachname}</strong>
          {person.pers_nr && ` (${person.pers_nr})`}
        </div>
      )}

      <div>
        <Label>Datum</Label>
        <Input
          type="date"
          value={datum}
          onChange={(e) => setDatum(e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => setFehlzeitTyp("")}
          className={`h-9 rounded-md border text-sm font-medium ${
            !fehlzeitTyp
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background"
          }`}
        >
          Arbeit
        </button>
        <select
          value={fehlzeitTyp}
          onChange={(e) => setFehlzeitTyp(e.target.value)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">— Fehlzeit —</option>
          <option value="U">Urlaub</option>
          <option value="K">Krank</option>
          <option value="F">Feiertag</option>
          <option value="SW">Schlechtwetter</option>
        </select>
      </div>

      {!fehlzeitTyp ? (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setInFirma(false)}
              className={`h-9 rounded-md border text-xs font-medium flex items-center justify-center gap-1 ${
                !inFirma
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background"
              }`}
            >
              <MapPin className="h-3.5 w-3.5" /> Auf Baustelle
            </button>
            <button
              type="button"
              onClick={() => setInFirma(true)}
              className={`h-9 rounded-md border text-xs font-medium flex items-center justify-center gap-1 ${
                inFirma
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background"
              }`}
            >
              <Factory className="h-3.5 w-3.5" /> In Firma
            </button>
          </div>

          <div>
            <Label>Baustelle{inFirma && " (optional)"}</Label>
            <select
              value={baustelleId}
              onChange={(e) => setBaustelleId(e.target.value)}
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">— keine —</option>
              {baustellen.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.bvh_name}
                  {b.kostenstelle ? ` · ${b.kostenstelle}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <TimePickerInput label="Start" value={startZeit} onChange={setStartZeit} />
            <TimePickerInput label="Ende" value={endZeit} onChange={setEndZeit} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={hasPause} onCheckedChange={setHasPause} />
            <Label>Pause</Label>
          </div>
          {hasPause && (
            <div className="grid grid-cols-2 gap-2">
              <TimePickerInput label="Pause von" value={pauseVon} onChange={setPauseVon} />
              <TimePickerInput label="Pause bis" value={pauseBis} onChange={setPauseBis} />
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Berechnete Arbeitszeit:{" "}
            <strong>
              {calcArbeit(
                startZeit,
                endZeit,
                hasPause ? pauseVon : null,
                hasPause ? pauseBis : null
              ).toFixed(2)}{" "}
              h
            </strong>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2 border-t">
            <div>
              <Label className="text-xs">Fahrstunden</Label>
              <Input
                inputMode="decimal"
                type="number"
                step="0.25"
                value={fahrstunden}
                onChange={(e) => setFahrstunden(Number(e.target.value))}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">KM</Label>
              <Input
                inputMode="numeric"
                type="number"
                step="1"
                value={km}
                onChange={(e) => setKm(Number(e.target.value))}
                className="h-9"
              />
            </div>
            <div className="col-span-2 flex items-center justify-between pt-1">
              <Label className="text-xs font-medium">Diäten / Taggeld</Label>
              <label className="text-[11px] flex items-center gap-1.5 cursor-pointer">
                <Switch
                  checked={taggeldManuell}
                  onCheckedChange={(v) => setTaggeldManuell(!!v)}
                />
                <span>manuell</span>
              </label>
            </div>
            {!taggeldManuell && (
              <div className="col-span-2 -mt-1 text-[11px] text-muted-foreground">
                Auto nach Bau-KV § 9: {autoDiaetenReason}
              </div>
            )}
            <div>
              <Label className="text-xs">
                TG kurz {inFirma && <span className="opacity-60">(0)</span>}
              </Label>
              <Input
                inputMode="numeric"
                type="number"
                min={0}
                step="1"
                disabled={inFirma}
                readOnly={!taggeldManuell || inFirma}
                value={inFirma ? 0 : taggeldKurz}
                onChange={(e) => setTaggeldKurz(Number(e.target.value) || 0)}
                className={`h-9 ${!taggeldManuell ? "bg-muted/40" : ""}`}
              />
            </div>
            <div>
              <Label className="text-xs">
                TG lang {inFirma && <span className="opacity-60">(0)</span>}
              </Label>
              <Input
                inputMode="numeric"
                type="number"
                min={0}
                step="1"
                disabled={inFirma}
                readOnly={!taggeldManuell || inFirma}
                value={inFirma ? 0 : taggeldLang}
                onChange={(e) => setTaggeldLang(Number(e.target.value) || 0)}
                className={`h-9 ${!taggeldManuell ? "bg-muted/40" : ""}`}
              />
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Erschwerniszulage
            </Label>
            <select
              value={zulageTyp}
              onChange={(e) => {
                const v = e.target.value;
                setZulageTyp(v);
                if (v && zulageStunden === 0) {
                  setZulageStunden(
                    calcArbeit(
                      startZeit,
                      endZeit,
                      hasPause ? pauseVon : null,
                      hasPause ? pauseBis : null
                    )
                  );
                }
                if (!v) setZulageStunden(0);
              }}
              className="w-full h-10 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">— keine —</option>
              <option value="aufsicht">Aufsicht (§ 6 a)</option>
              <option value="schmutz">Schmutz / Abbruch (§ 6 d)</option>
              <option value="hoehe">Höhenzulage (§ 6 m)</option>
              <option value="andere">Andere</option>
            </select>
            {zulageTyp && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px]">Zulagen-Stunden</Label>
                  <Input
                    type="number"
                    step="0.25"
                    min={0}
                    value={zulageStunden}
                    onChange={(e) => setZulageStunden(Number(e.target.value))}
                    className="h-9"
                  />
                </div>
                {zulageTyp === "andere" && (
                  <div>
                    <Label className="text-[10px]">Notiz</Label>
                    <Input
                      value={zulageNotiz}
                      onChange={(e) => setZulageNotiz(e.target.value)}
                      placeholder="z.B. § 6 g"
                      className="h-9"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        <div>
          <Label>Stunden ({fehlzeitTyp})</Label>
          <Input
            inputMode="decimal"
            type="number"
            step="0.25"
            value={fehlzeitHours}
            onChange={(e) => setFehlzeitHours(Number(e.target.value))}
            required
          />
        </div>
      )}

      <div>
        <Label>Tätigkeit</Label>
        <Input
          value={taetigkeit}
          onChange={(e) => setTaetigkeit(e.target.value)}
          placeholder="optional"
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Abbrechen
        </Button>
        <Button type="submit">Speichern</Button>
      </DialogFooter>
    </form>
  );
}
