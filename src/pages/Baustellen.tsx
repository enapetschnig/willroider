import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, Building2, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { Database, BaustellenStatus } from "@/integrations/supabase/types";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];

const STATUS_LABEL: Record<BaustellenStatus, string> = {
  geplant: "Geplant",
  aktiv: "Aktiv",
  pausiert: "Pausiert",
  abgeschlossen: "Abgeschlossen",
};

export default function Baustellen() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<Baustelle[]>([]);
  const [partien, setPartien] = useState<Partie[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("alle");
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = async () => {
    const [bs, p] = await Promise.all([
      supabase.from("baustellen").select("*").order("start_datum", { ascending: false }),
      supabase.from("partien").select("*").order("name"),
    ]);
    setData((bs.data as Baustelle[]) ?? []);
    setPartien((p.data as Partie[]) ?? []);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    return data.filter((b) => {
      if (statusFilter !== "alle" && b.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          b.bvh_name.toLowerCase().includes(q) ||
          (b.kostenstelle ?? "").toLowerCase().includes(q) ||
          (b.bauherr ?? "").toLowerCase().includes(q) ||
          (b.ort ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [data, search, statusFilter]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      bvh_name: fd.get("bvh_name") as string,
      kostenstelle: (fd.get("kostenstelle") as string) || null,
      bauherr: (fd.get("bauherr") as string) || null,
      bauherr_adresse: (fd.get("bauherr_adresse") as string) || null,
      baustellen_adresse: (fd.get("baustellen_adresse") as string) || null,
      plz: (fd.get("plz") as string) || null,
      ort: (fd.get("ort") as string) || null,
      start_datum: (fd.get("start_datum") as string) || null,
      end_datum: (fd.get("end_datum") as string) || null,
      status: (fd.get("status") as BaustellenStatus) || "geplant",
      partie_id: (fd.get("partie_id") as string) || null,
      auftragssumme: fd.get("auftragssumme") ? Number(fd.get("auftragssumme")) : null,
      art_bauarbeiten: (fd.get("art_bauarbeiten") as string) || null,
      dacheindeckung: (fd.get("dacheindeckung") as string) || null,
      farben_grundierung: (fd.get("farben_grundierung") as string) || null,
      anzahl_mitarbeiter: fd.get("anzahl_mitarbeiter") ? Number(fd.get("anzahl_mitarbeiter")) : null,
      notizen: (fd.get("notizen") as string) || null,
    };
    const { error } = await supabase.from("baustellen").insert(payload as any);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Baustelle angelegt" });
    setDialogOpen(false);
    load();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Baustellen"
        description="Alle Baustellen mit Stammdaten, Status und Zuordnungen."
        actions={
          isAdmin ? (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Neue Baustelle
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="p-3 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Suche nach BVH, Kostenstelle, Bauherr, Ort"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alle">Alle Status</SelectItem>
              <SelectItem value="aktiv">Aktiv</SelectItem>
              <SelectItem value="geplant">Geplant</SelectItem>
              <SelectItem value="pausiert">Pausiert</SelectItem>
              <SelectItem value="abgeschlossen">Abgeschlossen</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground">
            {filtered.length} / {data.length} Baustellen
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((b) => {
          const partie = partien.find((p) => p.id === b.partie_id);
          return (
            <Link to={`/baustellen/${b.id}`} key={b.id}>
              <Card className="hover:shadow-md hover:border-primary/40 transition-all h-full">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <Building2 className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{b.bvh_name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {b.kostenstelle ?? "—"}
                      </div>
                    </div>
                    <Badge variant="outline">{STATUS_LABEL[b.status]}</Badge>
                  </div>
                  <div className="text-xs space-y-0.5">
                    {b.bauherr && (
                      <div>
                        <span className="text-muted-foreground">Bauherr: </span>
                        {b.bauherr}
                      </div>
                    )}
                    {(b.ort || b.plz) && (
                      <div>
                        <span className="text-muted-foreground">Ort: </span>
                        {[b.plz, b.ort].filter(Boolean).join(" ")}
                      </div>
                    )}
                    <div>
                      <span className="text-muted-foreground">Zeitraum: </span>
                      {b.start_datum
                        ? new Date(b.start_datum).toLocaleDateString("de-AT")
                        : "—"}{" "}
                      →{" "}
                      {b.end_datum ? new Date(b.end_datum).toLocaleDateString("de-AT") : "offen"}
                    </div>
                    {partie && (
                      <div>
                        <span className="text-muted-foreground">Partie: </span>
                        <Badge
                          variant="outline"
                          style={{ borderColor: partie.farbcode, color: partie.farbcode }}
                          className="text-[10px]"
                        >
                          {partie.name}
                        </Badge>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
        {filtered.length === 0 && (
          <Card className="md:col-span-2 lg:col-span-3">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Keine Baustellen gefunden.
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Neue Baustelle anlegen</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>BVH (Bauvorhaben) *</Label>
                <Input name="bvh_name" required />
              </div>
              <div className="space-y-1.5">
                <Label>Kostenstelle</Label>
                <Input name="kostenstelle" />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <select name="status" defaultValue="geplant" className="w-full h-10 rounded-md border bg-background px-3 text-sm">
                  <option value="geplant">Geplant</option>
                  <option value="aktiv">Aktiv</option>
                  <option value="pausiert">Pausiert</option>
                  <option value="abgeschlossen">Abgeschlossen</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Bauherr</Label>
                <Input name="bauherr" />
              </div>
              <div className="space-y-1.5">
                <Label>Bauherr-Adresse</Label>
                <Input name="bauherr_adresse" />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Baustellen-Adresse</Label>
                <Input name="baustellen_adresse" />
              </div>
              <div className="space-y-1.5">
                <Label>PLZ</Label>
                <Input name="plz" />
              </div>
              <div className="space-y-1.5">
                <Label>Ort</Label>
                <Input name="ort" />
              </div>
              <div className="space-y-1.5">
                <Label>Start</Label>
                <Input name="start_datum" type="date" />
              </div>
              <div className="space-y-1.5">
                <Label>Ende (vsl.)</Label>
                <Input name="end_datum" type="date" />
              </div>
              <div className="space-y-1.5">
                <Label>Partie</Label>
                <select name="partie_id" className="w-full h-10 rounded-md border bg-background px-3 text-sm">
                  <option value="">— ohne —</option>
                  {partien.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Anzahl Mitarbeiter</Label>
                <Input name="anzahl_mitarbeiter" type="number" />
              </div>
              <div className="space-y-1.5">
                <Label>Auftragssumme (EUR)</Label>
                <Input name="auftragssumme" type="number" step="0.01" />
              </div>
              <div className="space-y-1.5">
                <Label>Art der Bauarbeiten</Label>
                <Input name="art_bauarbeiten" />
              </div>
              <div className="space-y-1.5">
                <Label>Dacheindeckung</Label>
                <Input name="dacheindeckung" />
              </div>
              <div className="space-y-1.5">
                <Label>Farben/Grundierung</Label>
                <Input name="farben_grundierung" />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Notizen</Label>
                <Textarea name="notizen" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Abbrechen
              </Button>
              <Button type="submit">Anlegen</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
