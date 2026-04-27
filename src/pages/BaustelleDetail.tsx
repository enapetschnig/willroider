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
import type { Database, BaustellenStatus } from "@/integrations/supabase/types";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Termin = Database["public"]["Tables"]["baustellen_termine"]["Row"];
type Dokument = Database["public"]["Tables"]["dokumente"]["Row"];
type Kosten = Database["public"]["Tables"]["kostenbuchungen"]["Row"];
type Stunden = Database["public"]["Tables"]["stundenbuchungen"]["Row"];
type Eval = Database["public"]["Tables"]["evaluierungen"]["Row"];

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
  const [terminDialog, setTerminDialog] = useState(false);
  const [kostenDialog, setKostenDialog] = useState(false);

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
    setB((bs.data as Baustelle) ?? null);
    setTermine((t.data as Termin[]) ?? []);
    setDokumente((d.data as Dokument[]) ?? []);
    setKosten((k.data as Kosten[]) ?? []);
    setStunden((s.data as Stunden[]) ?? []);
    setEvals((e.data as Eval[]) ?? []);
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
        actions={
          isAdmin ? (
            <select
              value={b.status}
              onChange={(e) => updateStatus(e.target.value as BaustellenStatus)}
              className="h-9 px-3 rounded-md border bg-background text-sm"
            >
              {Object.entries(STATUS_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          ) : (
            <Badge>{STATUS_LABEL[b.status]}</Badge>
          )
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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

      <Tabs defaultValue="info">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="info"><Building2 className="h-4 w-4 mr-2" /> Stammdaten</TabsTrigger>
          <TabsTrigger value="termine"><CalendarDays className="h-4 w-4 mr-2" /> Termine ({termine.length})</TabsTrigger>
          <TabsTrigger value="dokumente"><FileText className="h-4 w-4 mr-2" /> Dokumente ({dokumente.length})</TabsTrigger>
          <TabsTrigger value="kosten"><Banknote className="h-4 w-4 mr-2" /> Kosten ({kosten.length})</TabsTrigger>
          <TabsTrigger value="stunden"><Clock className="h-4 w-4 mr-2" /> Stunden ({stunden.length})</TabsTrigger>
          <TabsTrigger value="eval"><ShieldCheck className="h-4 w-4 mr-2" /> Evaluierung ({evals.length})</TabsTrigger>
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
