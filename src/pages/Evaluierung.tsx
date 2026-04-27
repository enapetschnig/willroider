import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import { Plus, ShieldCheck, ShieldAlert, CheckCircle2 } from "lucide-react";
import type { Database, EvaluierungTyp, Json } from "@/integrations/supabase/types";

type Eval = Database["public"]["Tables"]["evaluierungen"]["Row"];
type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const CHECKLIST_KURZ = [
  { key: "absturzsicherung", label: "Absturzsicherung vorhanden" },
  { key: "psa", label: "Persönliche Schutzausrüstung getragen" },
  { key: "werkzeuge", label: "Werkzeuge geprüft" },
  { key: "arbeitsbereich", label: "Arbeitsbereich abgesichert" },
];

const CHECKLIST_LANG = [
  ...CHECKLIST_KURZ,
  { key: "kran_pruefung", label: "Kran-Prüfprotokoll aktuell" },
  { key: "geruest_pruefung", label: "Gerüst-Abnahme erfolgt" },
  { key: "leitern", label: "Leitern auf Stabilität geprüft" },
  { key: "stromversorgung", label: "Elektrik / Verlängerungen geprüft" },
  { key: "fluchtwege", label: "Fluchtwege frei" },
  { key: "erste_hilfe", label: "Erste-Hilfe-Material vorhanden" },
  { key: "feuerloescher", label: "Feuerlöscher vorhanden" },
  { key: "lagerung", label: "Sichere Lagerung Fertigteilelemente" },
  { key: "transport", label: "Transport / Hubmittel geprüft" },
  { key: "versetzung", label: "Versetz-Anweisung vorhanden" },
];

export default function Evaluierung() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [params] = useSearchParams();
  const [rows, setRows] = useState<Eval[]>([]);
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [editing, setEditing] = useState<Partial<Eval> | null>(null);
  const [checklist, setChecklist] = useState<Record<string, string>>({});

  const baustelleParam = params.get("baustelle");

  const load = async () => {
    const [e, b, p] = await Promise.all([
      supabase.from("evaluierungen").select("*").order("datum", { ascending: false }).limit(200),
      supabase.from("baustellen").select("*").order("bvh_name"),
      supabase.from("profiles").select("*"),
    ]);
    setRows((e.data as Eval[]) ?? []);
    setBaustellen((b.data as Baustelle[]) ?? []);
    setProfiles((p.data as Profile[]) ?? []);
  };

  useEffect(() => {
    load();
    if (baustelleParam) {
      setEditing({ baustelle_id: baustelleParam, datum: new Date().toISOString().slice(0, 10), typ: "kurz" });
    }
  }, []);

  const openNew = () => {
    setEditing({ datum: new Date().toISOString().slice(0, 10), typ: "kurz" });
    setChecklist({});
  };

  const openEdit = (e: Eval) => {
    setEditing(e);
    setChecklist((e.checklist as Record<string, string>) || {});
  };

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    const payload = {
      baustelle_id: fd.get("baustelle_id") as string,
      datum: fd.get("datum") as string,
      typ: (fd.get("typ") as EvaluierungTyp) || "kurz",
      vortragender_id: user?.id ?? null,
      checkliste: checklist as unknown as Json,
      notizen: (fd.get("notizen") as string) || null,
      abgeschlossen: false,
    };
    const { error } = editing.id
      ? await supabase.from("evaluierungen").update(payload).eq("id", editing.id)
      : await supabase.from("evaluierungen").insert(payload as any);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: editing.id ? "Aktualisiert" : "Evaluierung angelegt" });
    setEditing(null);
    load();
  };

  const finalize = async (e: Eval) => {
    await supabase.from("evaluierungen").update({ abgeschlossen: true }).eq("id", e.id);
    toast({ title: "Evaluierung abgeschlossen" });
    load();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sicherheitsunterweisung & Gefahrenevaluierung"
        description="Digitale Checkliste gemäß ASchG vor Arbeitsbeginn auf jeder Baustelle."
        actions={
          isAdmin && (
            <Button onClick={openNew}>
              <Plus className="h-4 w-4 mr-2" /> Neue Evaluierung
            </Button>
          )
        }
      />

      <div className="space-y-2">
        {rows.map((e) => {
          const b = baustellen.find((x) => x.id === e.baustelle_id);
          const v = profiles.find((p) => p.id === e.vortragender_id);
          return (
            <Card key={e.id}>
              <CardContent className="p-3 flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    {e.abgeschlossen ? (
                      <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <ShieldAlert className="h-4 w-4 text-amber-500" />
                    )}
                    <div className="font-medium">{b?.bvh_name ?? "—"}</div>
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {e.typ === "kurz" ? "Kurz" : "Lang"}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(e.datum).toLocaleDateString("de-AT")}
                    {v ? ` · Vortragender: ${v.vorname} ${v.nachname}` : ""}
                  </div>
                  {e.notizen && (
                    <div className="text-xs mt-1 line-clamp-2">{e.notizen}</div>
                  )}
                </div>
                <div className="flex flex-col gap-1 items-end">
                  <Badge variant={e.abgeschlossen ? "default" : "outline"}>
                    {e.abgeschlossen ? "Abgeschlossen" : "Offen"}
                  </Badge>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => openEdit(e)}>
                      Öffnen
                    </Button>
                    {!e.abgeschlossen && isAdmin && (
                      <Button size="sm" onClick={() => finalize(e)}>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Abschließen
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {rows.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Noch keine Evaluierungen.
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Evaluierung bearbeiten" : "Neue Evaluierung"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <form onSubmit={save} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <Label>Baustelle *</Label>
                  <select
                    name="baustelle_id"
                    defaultValue={editing.baustelle_id ?? ""}
                    required
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
                  <Label>Datum *</Label>
                  <Input type="date" name="datum" required defaultValue={editing.datum ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label>Typ</Label>
                  <select
                    name="typ"
                    defaultValue={editing.typ ?? "kurz"}
                    className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="kurz">Kurzversion</option>
                    <option value="lang">Langversion</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2 border-t pt-3">
                <Label>Checkliste</Label>
                {(editing.typ === "lang" ? CHECKLIST_LANG : CHECKLIST_KURZ).map((c) => (
                  <div
                    key={c.key}
                    className="flex items-center justify-between gap-2 text-sm border-b py-2"
                  >
                    <span className="flex-1">{c.label}</span>
                    <div className="flex gap-1">
                      {["i.O.", "nicht i.O.", "n.A."].map((opt) => (
                        <button
                          type="button"
                          key={opt}
                          onClick={() => setChecklist((s) => ({ ...s, [c.key]: opt }))}
                          className={`px-2 py-1 text-[11px] rounded border ${
                            checklist[c.key] === opt
                              ? opt === "i.O."
                                ? "bg-emerald-600 text-white border-emerald-600"
                                : opt === "nicht i.O."
                                ? "bg-destructive text-white border-destructive"
                                : "bg-muted"
                              : "bg-background"
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                <Label>Notizen</Label>
                <Textarea name="notizen" defaultValue={editing.notizen ?? ""} />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  Abbrechen
                </Button>
                <Button type="submit">{editing.id ? "Speichern" : "Anlegen"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
