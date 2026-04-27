import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Plus, Edit, Trash2, Clock } from "lucide-react";
import type { Database, StundenStatus } from "@/integrations/supabase/types";

type Stunde = Database["public"]["Tables"]["stundenbuchungen"]["Row"];
type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];

const STATUS_LABEL: Record<StundenStatus, string> = {
  offen: "Offen",
  zm_freigabe: "ZM-Freigabe",
  buero_freigabe: "Büro-Freigabe",
  exportiert: "Exportiert",
  abgelehnt: "Abgelehnt",
};
const STATUS_VARIANT: Record<StundenStatus, "default" | "outline" | "secondary" | "destructive"> = {
  offen: "outline",
  zm_freigabe: "secondary",
  buero_freigabe: "default",
  exportiert: "default",
  abgelehnt: "destructive",
};

const FEHLZEITEN = [
  { value: "", label: "—" },
  { value: "U", label: "Urlaub" },
  { value: "K", label: "Krankenstand" },
  { value: "F", label: "Feiertag" },
  { value: "SW", label: "Schlechtwetter" },
  { value: "S", label: "Sozialstunden" },
];

export default function Stunden() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<Stunde[]>([]);
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [editing, setEditing] = useState<Partial<Stunde> | null>(null);
  const [month, setMonth] = useState<string>(() => new Date().toISOString().slice(0, 7));

  const load = async () => {
    if (!user) return;
    const monthStart = `${month}-01`;
    const next = new Date(month + "-01");
    next.setMonth(next.getMonth() + 1);
    const monthEnd = next.toISOString().slice(0, 10);

    const [r, b] = await Promise.all([
      supabase
        .from("stundenbuchungen")
        .select("*")
        .eq("mitarbeiter_id", user.id)
        .gte("datum", monthStart)
        .lt("datum", monthEnd)
        .order("datum", { ascending: false }),
      supabase.from("baustellen").select("*").in("status", ["aktiv", "geplant"]).order("bvh_name"),
    ]);
    setRows((r.data as Stunde[]) ?? []);
    setBaustellen((b.data as Baustelle[]) ?? []);
  };

  useEffect(() => {
    load();
  }, [user, month]);

  const totals = useMemo(() => {
    let arbeit = 0,
      fahrt = 0,
      taggeldKurz = 0,
      taggeldLang = 0,
      fehlzeit = 0;
    rows.forEach((r) => {
      arbeit += Number(r.arbeitsstunden ?? 0);
      fahrt += Number(r.fahrstunden ?? 0);
      taggeldKurz += Number(r.taggeld_kurz ?? 0);
      taggeldLang += Number(r.taggeld_lang ?? 0);
      fehlzeit += Number(r.fehlzeit_stunden ?? 0);
    });
    return { arbeit, fahrt, taggeldKurz, taggeldLang, fehlzeit };
  }, [rows]);

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing || !user) return;
    const fd = new FormData(e.currentTarget);
    const payload = {
      mitarbeiter_id: user.id,
      datum: fd.get("datum") as string,
      baustelle_id: (fd.get("baustelle_id") as string) || null,
      arbeitsstunden: Number(fd.get("arbeitsstunden") ?? 0),
      fahrstunden: Number(fd.get("fahrstunden") ?? 0),
      taggeld_kurz: Number(fd.get("taggeld_kurz") ?? 0),
      taggeld_lang: Number(fd.get("taggeld_lang") ?? 0),
      km_gefahren: Number(fd.get("km_gefahren") ?? 0),
      fehlzeit_typ: (fd.get("fehlzeit_typ") as string) || null,
      fehlzeit_stunden: Number(fd.get("fehlzeit_stunden") ?? 0),
      taetigkeit: (fd.get("taetigkeit") as string) || null,
      notizen: (fd.get("notizen") as string) || null,
      status: "offen" as StundenStatus,
    };
    const { error } = editing.id
      ? await supabase.from("stundenbuchungen").update(payload).eq("id", editing.id)
      : await supabase.from("stundenbuchungen").insert(payload as any);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: editing.id ? "Aktualisiert" : "Gebucht" });
    setEditing(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Buchung wirklich löschen?")) return;
    await supabase.from("stundenbuchungen").delete().eq("id", id);
    load();
  };

  const submitForApproval = async (id: string) => {
    await supabase.from("stundenbuchungen").update({ status: "zm_freigabe" }).eq("id", id);
    toast({ title: "Zur Freigabe eingereicht" });
    load();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stundenerfassung"
        description="Tägliche Erfassung von Arbeitsstunden, Fahrstunden, Taggeldern und Fehlzeiten."
        actions={
          <Button onClick={() => setEditing({ datum: new Date().toISOString().slice(0, 10) })}>
            <Plus className="h-4 w-4 mr-2" /> Stunden buchen
          </Button>
        }
      />

      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-40"
          />
          <div className="ml-auto flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">Arbeit: {totals.arbeit.toFixed(1)} h</Badge>
            <Badge variant="outline">Fahrt: {totals.fahrt.toFixed(1)} h</Badge>
            <Badge variant="outline">Taggeld kurz: {totals.taggeldKurz.toFixed(0)}</Badge>
            <Badge variant="outline">Taggeld lang: {totals.taggeldLang.toFixed(0)}</Badge>
            <Badge variant="outline">Fehlzeit: {totals.fehlzeit.toFixed(1)} h</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {rows.map((r) => {
          const b = baustellen.find((x) => x.id === r.baustelle_id);
          return (
            <Card key={r.id}>
              <CardContent className="p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-medium">
                        {new Date(r.datum).toLocaleDateString("de-AT", {
                          weekday: "short",
                          day: "2-digit",
                          month: "2-digit",
                        })}
                      </span>
                      <Badge variant={STATUS_VARIANT[r.status]} className="text-[10px]">
                        {STATUS_LABEL[r.status]}
                      </Badge>
                    </div>
                    <div className="text-sm">
                      {b ? b.bvh_name : "Ohne Baustelle"}{" "}
                      {b?.kostenstelle ? (
                        <span className="text-muted-foreground">· {b.kostenstelle}</span>
                      ) : null}
                    </div>
                    {r.taetigkeit && (
                      <div className="text-xs text-muted-foreground">{r.taetigkeit}</div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 items-center text-xs">
                    <Badge variant="secondary">
                      {Number(r.arbeitsstunden ?? 0).toFixed(1)}h Arbeit
                    </Badge>
                    {Number(r.fahrstunden ?? 0) > 0 && (
                      <Badge variant="outline">
                        {Number(r.fahrstunden).toFixed(1)}h Fahrt
                      </Badge>
                    )}
                    {r.fehlzeit_typ && (
                      <Badge variant="outline">
                        {r.fehlzeit_typ} {Number(r.fehlzeit_stunden ?? 0).toFixed(1)}h
                      </Badge>
                    )}
                    {r.status === "offen" && (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => setEditing(r)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => remove(r.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <Button size="sm" onClick={() => submitForApproval(r.id)}>
                          Einreichen
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {r.status === "abgelehnt" && r.abgelehnt_grund && (
                  <div className="mt-2 text-xs text-destructive">
                    Abgelehnt: {r.abgelehnt_grund}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {rows.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Keine Buchungen für {month}.
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Buchung bearbeiten" : "Stunden buchen"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <form onSubmit={save} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Datum *</Label>
                  <Input
                    type="date"
                    name="datum"
                    required
                    defaultValue={editing.datum ?? new Date().toISOString().slice(0, 10)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Baustelle</Label>
                  <select
                    name="baustelle_id"
                    defaultValue={editing.baustelle_id ?? ""}
                    className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="">— wählen —</option>
                    {baustellen.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.bvh_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Arbeitsstunden</Label>
                  <Input
                    type="number"
                    step="0.25"
                    name="arbeitsstunden"
                    defaultValue={editing.arbeitsstunden ?? 8}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Fahrstunden</Label>
                  <Input
                    type="number"
                    step="0.25"
                    name="fahrstunden"
                    defaultValue={editing.fahrstunden ?? 0}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Taggeld kurz</Label>
                  <Input
                    type="number"
                    step="1"
                    name="taggeld_kurz"
                    defaultValue={editing.taggeld_kurz ?? 0}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Taggeld lang</Label>
                  <Input
                    type="number"
                    step="1"
                    name="taggeld_lang"
                    defaultValue={editing.taggeld_lang ?? 0}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>km gefahren</Label>
                  <Input
                    type="number"
                    step="0.1"
                    name="km_gefahren"
                    defaultValue={editing.km_gefahren ?? 0}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Fehlzeit-Typ</Label>
                  <select
                    name="fehlzeit_typ"
                    defaultValue={editing.fehlzeit_typ ?? ""}
                    className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  >
                    {FEHLZEITEN.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Fehlzeit-Stunden</Label>
                  <Input
                    type="number"
                    step="0.25"
                    name="fehlzeit_stunden"
                    defaultValue={editing.fehlzeit_stunden ?? 0}
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Tätigkeit</Label>
                  <Input
                    name="taetigkeit"
                    defaultValue={editing.taetigkeit ?? ""}
                    placeholder="Wand-Elemente versetzen, Dachstuhl..."
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Notizen</Label>
                  <Textarea name="notizen" defaultValue={editing.notizen ?? ""} />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  Abbrechen
                </Button>
                <Button type="submit">{editing.id ? "Speichern" : "Buchen"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
