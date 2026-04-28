import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { BaustelleDokumente } from "@/components/BaustelleDokumente";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Building2,
  ArrowLeft,
  CalendarDays,
  Trash2,
  Plus,
  FileText,
  Banknote,
  Clock,
  ShieldCheck,
  Users,
  Pencil,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BaustellenmeldungForm } from "@/components/BaustellenmeldungForm";
import type { Database, BaustellenStatus } from "@/integrations/supabase/types";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Termin = Database["public"]["Tables"]["baustellen_termine"]["Row"];
type Dokument = Database["public"]["Tables"]["dokumente"]["Row"];
type Kosten = Database["public"]["Tables"]["kostenbuchungen"]["Row"];
type Stunden = Database["public"]["Tables"]["stundenbuchungen"]["Row"];
type Eval = Database["public"]["Tables"]["evaluierungen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];

const STATUS_LABEL: Record<BaustellenStatus, string> = {
  geplant: "Geplant",
  aktiv: "Aktiv",
  pausiert: "Pausiert",
  abgeschlossen: "Abgeschlossen",
};

export default function BaustelleDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [b, setB] = useState<Baustelle | null>(null);
  const [termine, setTermine] = useState<Termin[]>([]);
  const [dokumente, setDokumente] = useState<Dokument[]>([]);
  const [kosten, setKosten] = useState<Kosten[]>([]);
  const [stunden, setStunden] = useState<Stunden[]>([]);
  const [evals, setEvals] = useState<Eval[]>([]);
  const [partie, setPartie] = useState<Partie | null>(null);
  const [team, setTeam] = useState<Profile[]>([]);
  const [allPartien, setAllPartien] = useState<Partie[]>([]);
  const [terminDialog, setTerminDialog] = useState(false);
  const [kostenDialog, setKostenDialog] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("dokumente");

  const load = async () => {
    if (!id) return;
    const [bs, t, d, k, s, e] = await Promise.all([
      supabase.from("baustellen").select("*").eq("id", id).maybeSingle(),
      supabase.from("baustellen_termine").select("*").eq("baustelle_id", id).order("termin_datum"),
      supabase.from("dokumente").select("*").eq("baustelle_id", id).order("created_at", { ascending: false }),
      supabase.from("kostenbuchungen").select("*").eq("baustelle_id", id).order("datum", { ascending: false }),
      supabase.from("stundenbuchungen").select("*").eq("baustelle_id", id).order("datum", { ascending: false }).limit(100),
      supabase.from("evaluierungen").select("*").eq("baustelle_id", id).order("datum", { ascending: false }),
    ]);
    const baustelle = (bs.data as Baustelle) ?? null;
    setB(baustelle);
    setTermine((t.data as Termin[]) ?? []);
    setDokumente((d.data as Dokument[]) ?? []);
    setKosten((k.data as Kosten[]) ?? []);
    setStunden((s.data as Stunden[]) ?? []);
    setEvals((e.data as Eval[]) ?? []);

    const { data: allP } = await supabase.from("partien").select("*").order("name");
    setAllPartien((allP as Partie[]) ?? []);

    if (baustelle?.partie_id) {
      const partieRow = (allP as Partie[] | null)?.find((p) => p.id === baustelle.partie_id) ?? null;
      const { data: members } = await supabase
        .from("profiles")
        .select("*")
        .eq("partie_id", baustelle.partie_id)
        .order("nachname");
      setPartie(partieRow);
      setTeam((members as Profile[]) ?? []);
    } else {
      setPartie(null);
      setTeam([]);
    }
  };

  const assignPartie = async (partieId: string | null) => {
    if (!b) return;
    const { error } = await supabase
      .from("baustellen")
      .update({ partie_id: partieId })
      .eq("id", b.id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      toast({ title: partieId ? "Partie zugeordnet" : "Partie entfernt" });
      load();
    }
  };

  const setPflichtUnterweisung = async (typ: "" | "werkstatt" | "baustelle" | "fertigteilmontage") => {
    if (!b) return;
    if (!b.partie_id) {
      toast({
        variant: "destructive",
        title: "Erst Partie zuordnen",
        description: "Die Pflicht-Unterweisung gilt für die Mitarbeiter der zugeordneten Partie.",
      });
      return;
    }
    if (!typ) {
      toast({ title: "Pflicht-Unterweisung wird nur entfernt, wenn keine angelegt ist." });
      return;
    }
    const { data: members } = await supabase
      .from("profiles")
      .select("id")
      .eq("partie_id", b.partie_id)
      .eq("is_active", true);

    const { data: evalData, error: evalErr } = await supabase
      .from("evaluierungen")
      .insert({
        baustelle_id: b.id,
        datum: b.start_datum ?? new Date().toISOString().slice(0, 10),
        typ,
        checkliste: {},
        abgeschlossen: false,
      } as any)
      .select()
      .single();
    if (evalErr) {
      toast({ variant: "destructive", title: "Fehler", description: evalErr.message });
      return;
    }
    if (members && members.length > 0) {
      const rows = members.map((m: any) => ({
        evaluierung_id: evalData.id,
        mitarbeiter_id: m.id,
      }));
      await supabase.from("evaluierung_unterschriften").insert(rows as any);
    }
    await supabase
      .from("baustellen")
      .update({ pflicht_evaluierung_id: evalData.id })
      .eq("id", b.id);
    toast({
      title: "Pflicht-Unterweisung angelegt",
      description: `${members?.length ?? 0} Mitarbeiter müssen unterschreiben.`,
    });
    load();
  };

  useEffect(() => {
    load();
  }, [id]);

  const updateStatus = async (status: BaustellenStatus) => {
    if (!b) return;
    const { error } = await supabase.from("baustellen").update({ status }).eq("id", b.id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      toast({ title: "Status aktualisiert" });
      load();
    }
  };

  const submitTermin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!b) return;
    const fd = new FormData(e.currentTarget);
    const { error } = await supabase.from("baustellen_termine").insert({
      baustelle_id: b.id,
      termin_datum: fd.get("termin_datum") as string,
      typ: (fd.get("typ") as string) || "meilenstein",
      bezeichnung: (fd.get("bezeichnung") as string) || null,
      notizen: (fd.get("notizen") as string) || null,
    } as any);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      toast({ title: "Termin angelegt" });
      setTerminDialog(false);
      load();
    }
  };

  const submitKosten = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!b) return;
    const fd = new FormData(e.currentTarget);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("kostenbuchungen").insert({
      baustelle_id: b.id,
      datum: fd.get("datum") as string,
      kostenart: fd.get("kostenart") as string,
      betrag: Number(fd.get("betrag")),
      beschreibung: (fd.get("beschreibung") as string) || null,
      erfasst_von: u.user?.id,
    } as any);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      toast({ title: "Kostenbuchung erfasst" });
      setKostenDialog(false);
      load();
    }
  };

  const deleteTermin = async (tid: string) => {
    if (!confirm("Termin löschen?")) return;
    await supabase.from("baustellen_termine").delete().eq("id", tid);
    load();
  };

  const deleteBaustelle = async () => {
    if (!b) return;
    const confirmText = window.prompt(
      `⚠️ ENDGÜLTIG LÖSCHEN\n\n` +
        `"${b.bvh_name}" und ALLE zugehörigen Daten werden gelöscht:\n` +
        `• Alle Stundenbuchungen auf dieser Baustelle\n` +
        `• Alle Termine, Dokumente, Kosten\n` +
        `• Alle Einteilungen & Evaluierungen\n\n` +
        `Das kann NICHT rückgängig gemacht werden!\n\n` +
        `Tippe "${b.bvh_name}" ein, um zu bestätigen:`
    );
    if (confirmText === null) return;
    if (confirmText.trim() !== b.bvh_name) {
      toast({
        variant: "destructive",
        title: "Bestätigung falsch",
        description: "Eingabe stimmt nicht — Löschung abgebrochen.",
      });
      return;
    }
    const { error } = await supabase.from("baustellen").delete().eq("id", b.id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: `Baustelle "${b.bvh_name}" gelöscht` });
    navigate("/baustellen");
  };

  if (!b) {
    return (
      <div className="text-sm text-muted-foreground">Baustelle wird geladen…</div>
    );
  }

  const sumStunden = stunden.reduce((s, r) => s + (r.arbeitsstunden ?? 0), 0);
  const sumKosten = kosten.reduce((s, k) => s + Number(k.betrag), 0);

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/baustellen">
          <ArrowLeft className="h-4 w-4 mr-2" /> Zurück
        </Link>
      </Button>

      <PageHeader
        title={b.bvh_name}
        description={[b.kostenstelle, b.ort, b.bauherr].filter(Boolean).join(" · ")}
        actions={!isAdmin ? <Badge>{STATUS_LABEL[b.status]}</Badge> : undefined}
      />

      {/* Admin-Toolbar — Status, Bearbeiten, Löschen jeweils klar beschriftet */}
      {isAdmin && (
        <Card>
          <CardContent className="p-3 flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="flex items-center gap-2 sm:flex-1">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground shrink-0">
                Status
              </Label>
              <select
                value={b.status}
                onChange={(e) => updateStatus(e.target.value as BaustellenStatus)}
                className="h-11 sm:h-10 px-3 rounded-md border bg-background text-sm font-medium flex-1 sm:flex-none sm:min-w-[180px]"
                aria-label="Status ändern"
              >
                {Object.entries(STATUS_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 sm:flex gap-2">
              <Button
                variant="outline"
                onClick={() => setEditDialog(true)}
                className="h-11 sm:h-10"
              >
                <Pencil className="h-4 w-4 mr-1.5" /> Bearbeiten
              </Button>
              <Button
                variant="outline"
                onClick={deleteBaustelle}
                className="h-11 sm:h-10 border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground"
              >
                <Trash2 className="h-4 w-4 mr-1.5" /> Löschen
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Zeitraum</div>
            <div className="text-sm font-semibold">
              {b.start_datum && new Date(b.start_datum).toLocaleDateString("de-AT")} →{" "}
              {b.end_datum ? new Date(b.end_datum).toLocaleDateString("de-AT") : "offen"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Stunden gesamt</div>
            <div className="text-sm font-semibold">{sumStunden.toFixed(1)} h</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Kosten</div>
            <div className="text-sm font-semibold">€ {sumKosten.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Auftragssumme</div>
            <div className="text-sm font-semibold">
              {b.auftragssumme ? `€ ${Number(b.auftragssumme).toFixed(2)}` : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Section-Cards (mobile-optimiert): große Touch-Ziele statt Tab-Pills */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
        {[
          { value: "dokumente", label: "Dokumente", icon: FileText, count: null, color: "#dc2626" },
          { value: "team", label: "Team", icon: Users, count: team.length, color: partie?.farbcode ?? "#3b82f6" },
          { value: "termine", label: "Termine", icon: CalendarDays, count: termine.length, color: "#f59e0b" },
          { value: "stunden", label: "Stunden", icon: Clock, count: stunden.length, color: "#10b981" },
          { value: "kosten", label: "Kosten", icon: Banknote, count: kosten.length, color: "#8b5cf6" },
          { value: "eval", label: "Unterweisung", icon: ShieldCheck, count: evals.length, color: "#84cc16" },
          { value: "info", label: "Stammdaten", icon: Building2, count: null, color: "#6b7280" },
        ].map((s) => {
          const active = activeTab === s.value;
          return (
            <button
              key={s.value}
              onClick={() => setActiveTab(s.value)}
              className={`text-left rounded-lg border-2 p-3 sm:p-4 transition-all ${
                active
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border bg-card hover:border-primary/40 hover:shadow-sm"
              }`}
            >
              <div className="flex items-start gap-2">
                <div
                  className="h-9 w-9 sm:h-10 sm:w-10 rounded-md flex items-center justify-center shrink-0"
                  style={{ background: `${s.color}1a`, color: s.color }}
                >
                  <s.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm sm:text-base leading-tight">
                    {s.label}
                  </div>
                  {s.count != null && (
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {s.count} Eintrag{s.count === 1 ? "" : "e"}
                    </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="hidden">
          <TabsTrigger value="dokumente" />
          <TabsTrigger value="team" />
          <TabsTrigger value="termine" />
          <TabsTrigger value="stunden" />
          <TabsTrigger value="kosten" />
          <TabsTrigger value="eval" />
          <TabsTrigger value="info" />
        </TabsList>

        <TabsContent value="info">
          <Card>
            <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <Info label="BVH" value={b.bvh_name} />
              <Info label="Kostenstelle" value={b.kostenstelle} />
              <Info label="Bauherr" value={b.bauherr} />
              <Info label="Bauherr-Adresse" value={b.bauherr_adresse} />
              <Info label="Baustellen-Adresse" value={b.baustellen_adresse} />
              <Info label="PLZ/Ort" value={[b.plz, b.ort].filter(Boolean).join(" ")} />
              <Info label="Start" value={b.start_datum} />
              <Info label="Ende" value={b.end_datum} />
              <Info label="Anzahl Mitarbeiter" value={b.anzahl_mitarbeiter?.toString()} />
              <Info label="Art der Bauarbeiten" value={b.art_bauarbeiten} />
              <Info label="Dacheindeckung" value={b.dacheindeckung} />
              <Info label="Farben/Grundierung" value={b.farben_grundierung} />
              <Info
                label="Auftragssumme"
                value={b.auftragssumme ? `€ ${Number(b.auftragssumme).toFixed(2)}` : null}
              />
              <Info label="Notizen" value={b.notizen} className="md:col-span-2" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team">
          <div className="space-y-3">
            {/* Partie-Zuordnung (Admin-only) */}
            {isAdmin && (
              <Card>
                <CardContent className="p-3 space-y-2">
                  <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                    Partie-Zuordnung
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => assignPartie(null)}
                      className={`px-2.5 py-1.5 rounded-full text-xs font-medium border ${
                        !b.partie_id ? "bg-muted" : "bg-background hover:bg-muted"
                      }`}
                    >
                      — keine —
                    </button>
                    {allPartien.map((p) => {
                      const active = p.id === b.partie_id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => assignPartie(p.id)}
                          className={`px-2.5 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1.5 ${
                            active ? "text-white border-transparent" : "bg-background hover:bg-muted"
                          }`}
                          style={active ? { background: p.farbcode } : undefined}
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ background: p.farbcode }}
                          />
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Pflicht-Unterweisung (Admin-only) */}
            {isAdmin && b.partie_id && (
              <Card>
                <CardContent className="p-3 space-y-2">
                  <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                    Pflicht-Unterweisung für die zugeordneten Mitarbeiter
                  </div>
                  {b.pflicht_evaluierung_id ? (
                    <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
                      Pflicht-Unterweisung bereits angelegt. Mitarbeiter erhalten beim
                      App-Öffnen den Sign-Gate.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => setPflichtUnterweisung("werkstatt")}
                        className="px-2.5 py-1.5 rounded-full text-xs font-medium border bg-background hover:bg-muted"
                      >
                        Werkstatt
                      </button>
                      <button
                        onClick={() => setPflichtUnterweisung("baustelle")}
                        className="px-2.5 py-1.5 rounded-full text-xs font-medium border bg-background hover:bg-muted"
                      >
                        Baustelle
                      </button>
                      <button
                        onClick={() => setPflichtUnterweisung("fertigteilmontage")}
                        className="px-2.5 py-1.5 rounded-full text-xs font-medium border bg-background hover:bg-muted"
                      >
                        Fertigteilmontage
                      </button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {!partie ? (
              <Card>
                <CardContent className="p-6 text-center space-y-2">
                  <Users className="h-8 w-8 mx-auto text-muted-foreground opacity-50" />
                  <div className="text-sm">
                    Dieser Baustelle ist noch keine Partie zugeordnet.
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div
                    className="h-12 w-12 rounded-md flex items-center justify-center text-white shrink-0"
                    style={{ background: partie.farbcode }}
                  >
                    <Users className="h-6 w-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Zugeordnete Partie
                    </div>
                    <div className="font-bold text-base">{partie.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {team.length} Mitarbeiter
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-1.5">
                {team.map((m) => (
                  <Card key={m.id}>
                    <CardContent className="p-3 flex items-center gap-3">
                      <div
                        className="h-9 w-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ background: partie.farbcode }}
                      >
                        {m.vorname[0]}
                        {m.nachname[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">
                          {m.vorname} {m.nachname}
                          {m.id === partie.partieleiter_id && (
                            <Badge variant="outline" className="ml-1.5 text-[10px]">
                              Partieleiter
                            </Badge>
                          )}
                          {m.kran_berechtigung && (
                            <Badge variant="outline" className="ml-1 text-[10px]">
                              Kran
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {[m.qualifikation, m.telefon].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      {m.telefon && (
                        <a
                          href={`tel:${m.telefon}`}
                          className="text-primary text-xs hover:underline shrink-0"
                        >
                          {m.telefon}
                        </a>
                      )}
                    </CardContent>
                  </Card>
                ))}
                {team.length === 0 && (
                  <Card>
                    <CardContent className="p-6 text-center text-sm text-muted-foreground">
                      Diese Partie hat noch keine Mitarbeiter.
                    </CardContent>
                  </Card>
                )}
              </div>
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="termine">
          <div className="flex justify-end mb-2">
            {isAdmin && (
              <Button onClick={() => setTerminDialog(true)} size="sm">
                <Plus className="h-4 w-4 mr-2" /> Termin
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {termine.map((t) => (
              <Card key={t.id}>
                <CardContent className="p-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      {new Date(t.termin_datum).toLocaleDateString("de-AT")} ·{" "}
                      <Badge variant="outline" className="capitalize">
                        {t.typ}
                      </Badge>
                    </div>
                    <div className="text-sm">{t.bezeichnung}</div>
                    {t.notizen && (
                      <div className="text-xs text-muted-foreground">{t.notizen}</div>
                    )}
                  </div>
                  {isAdmin && (
                    <Button variant="ghost" size="icon" onClick={() => deleteTermin(t.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
            {termine.length === 0 && (
              <Card>
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  Keine Termine.
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="dokumente">
          <BaustelleDokumente baustelleId={b.id} />
        </TabsContent>

        <TabsContent value="kosten">
          <div className="flex justify-end mb-2">
            {isAdmin && (
              <Button onClick={() => setKostenDialog(true)} size="sm">
                <Plus className="h-4 w-4 mr-2" /> Kostenbuchung
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {kosten.map((k) => (
              <Card key={k.id}>
                <CardContent className="p-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">
                      {k.kostenart}
                      <span className="text-muted-foreground"> · {new Date(k.datum).toLocaleDateString("de-AT")}</span>
                    </div>
                    {k.beschreibung && (
                      <div className="text-xs text-muted-foreground">{k.beschreibung}</div>
                    )}
                  </div>
                  <div className="font-bold">€ {Number(k.betrag).toFixed(2)}</div>
                </CardContent>
              </Card>
            ))}
            {kosten.length === 0 && (
              <Card>
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  Keine Kostenbuchungen.
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="stunden">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="text-left p-2">Datum</th>
                    <th className="text-left p-2">Stunden</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Tätigkeit</th>
                  </tr>
                </thead>
                <tbody>
                  {stunden.map((s) => (
                    <tr key={s.id} className="border-b">
                      <td className="p-2">{new Date(s.datum).toLocaleDateString("de-AT")}</td>
                      <td className="p-2">{Number(s.arbeitsstunden ?? 0).toFixed(1)} h</td>
                      <td className="p-2"><Badge variant="outline">{s.status}</Badge></td>
                      <td className="p-2">{s.taetigkeit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {stunden.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">Noch keine Stundenbuchungen.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="eval">
          <Card>
            <CardContent className="p-3 space-y-2">
              <Button onClick={() => navigate("/evaluierung?baustelle=" + b.id)} size="sm">
                <Plus className="h-4 w-4 mr-2" /> Neue Evaluierung
              </Button>
              {evals.map((e) => (
                <div key={e.id} className="flex items-center justify-between border-b py-2 text-sm">
                  <div>
                    {new Date(e.datum).toLocaleDateString("de-AT")} ·{" "}
                    <Badge variant="outline">{e.typ}</Badge>
                  </div>
                  <Badge variant={e.abgeschlossen ? "default" : "outline"}>
                    {e.abgeschlossen ? "Abgeschlossen" : "Offen"}
                  </Badge>
                </div>
              ))}
              {evals.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">Noch keine Evaluierungen.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Termin Dialog */}
      <Dialog open={terminDialog} onOpenChange={setTerminDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Termin / Meilenstein</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitTermin} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Datum *</Label>
              <Input name="termin_datum" type="date" required />
            </div>
            <div className="space-y-1.5">
              <Label>Typ</Label>
              <select name="typ" className="w-full h-10 rounded-md border bg-background px-3 text-sm">
                <option value="meilenstein">Meilenstein</option>
                <option value="kran">Kran-Termin</option>
                <option value="material">Material-Lieferung</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Bezeichnung</Label>
              <Input name="bezeichnung" />
            </div>
            <div className="space-y-1.5">
              <Label>Notizen</Label>
              <Textarea name="notizen" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTerminDialog(false)}>
                Abbrechen
              </Button>
              <Button type="submit">Anlegen</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Kosten Dialog */}
      <Dialog open={kostenDialog} onOpenChange={setKostenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kostenbuchung</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitKosten} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Datum *</Label>
                <Input name="datum" type="date" required defaultValue={new Date().toISOString().slice(0,10)} />
              </div>
              <div className="space-y-1.5">
                <Label>Kostenart *</Label>
                <Input name="kostenart" required placeholder="Material / Subunternehmer / ..." />
              </div>
              <div className="space-y-1.5">
                <Label>Betrag (EUR) *</Label>
                <Input name="betrag" type="number" step="0.01" required />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Beschreibung</Label>
                <Textarea name="beschreibung" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setKostenDialog(false)}>
                Abbrechen
              </Button>
              <Button type="submit">Speichern</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bearbeiten-Dialog: gesamte Baustellen-Stammdaten editieren */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Baustelle bearbeiten</DialogTitle>
          </DialogHeader>
          <BaustellenmeldungForm
            initial={b}
            onCancel={() => setEditDialog(false)}
            onSaved={() => {
              setEditDialog(false);
              load();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Info({ label, value, className }: { label: string; value: any; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value || "—"}</div>
    </div>
  );
}
