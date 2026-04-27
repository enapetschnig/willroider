import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Truck,
  Users,
  AlertTriangle,
  Send,
  Trash2,
  Edit,
  Building2,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Einteilung = Database["public"]["Tables"]["einteilungen"]["Row"];
type EM = Database["public"]["Tables"]["einteilung_mitarbeiter"]["Row"];
type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Fahrzeug = Database["public"]["Tables"]["fahrzeuge"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];

export default function Einteilung() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [einteilungen, setEinteilungen] = useState<Einteilung[]>([]);
  const [emRows, setEmRows] = useState<EM[]>([]);
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [fahrzeuge, setFahrzeuge] = useState<Fahrzeug[]>([]);
  const [partien, setPartien] = useState<Partie[]>([]);
  const [editing, setEditing] = useState<Partial<Einteilung> | null>(null);
  const [editingMa, setEditingMa] = useState<string[]>([]);

  const load = async () => {
    const [eRes, emRes, bRes, pRes, fRes, ptRes] = await Promise.all([
      supabase.from("einteilungen").select("*").eq("datum", date),
      supabase
        .from("einteilung_mitarbeiter")
        .select("*, einteilungen!inner(datum)")
        .eq("einteilungen.datum", date),
      supabase.from("baustellen").select("*").in("status", ["aktiv", "geplant"]).order("bvh_name"),
      supabase.from("profiles").select("*").eq("is_active", true).order("nachname"),
      supabase.from("fahrzeuge").select("*").eq("aktiv", true).order("kennzeichen"),
      supabase.from("partien").select("*"),
    ]);
    setEinteilungen((eRes.data as Einteilung[]) ?? []);
    setEmRows((emRes.data as any[]) ?? []);
    setBaustellen((bRes.data as Baustelle[]) ?? []);
    setProfiles((pRes.data as Profile[]) ?? []);
    setFahrzeuge((fRes.data as Fahrzeug[]) ?? []);
    setPartien((ptRes.data as Partie[]) ?? []);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("einteilung-" + date)
      .on("postgres_changes", { event: "*", schema: "public", table: "einteilungen" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "einteilung_mitarbeiter" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [date]);

  const assignedIds = useMemo(() => new Set(emRows.map((r) => r.mitarbeiter_id)), [emRows]);
  const conflicts = useMemo(() => {
    const map = new Map<string, number>();
    emRows.forEach((r) => map.set(r.mitarbeiter_id, (map.get(r.mitarbeiter_id) ?? 0) + 1));
    return new Set([...map.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [emRows]);

  const moveDate = (delta: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() + delta);
    setDate(d.toISOString().slice(0, 10));
  };

  const openNew = () => {
    setEditing({ datum: date, abfahrtszeit: "06:30:00", baustelle_id: null });
    setEditingMa([]);
  };

  const openEdit = async (e: Einteilung) => {
    setEditing(e);
    const { data } = await supabase
      .from("einteilung_mitarbeiter")
      .select("mitarbeiter_id")
      .eq("einteilung_id", e.id);
    setEditingMa((data ?? []).map((r: any) => r.mitarbeiter_id));
  };

  const saveEinteilung = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    const payload = {
      datum: date,
      baustelle_id: (fd.get("baustelle_id") as string) || null,
      fahrzeug_id: (fd.get("fahrzeug_id") as string) || null,
      abfahrtszeit: (fd.get("abfahrtszeit") as string) || null,
      treffpunkt: (fd.get("treffpunkt") as string) || null,
      material_hinweise: (fd.get("material_hinweise") as string) || null,
      sonderaufgaben: (fd.get("sonderaufgaben") as string) || null,
      hat_anhaenger: fd.get("hat_anhaenger") === "on",
      kranfahrer_id: (fd.get("kranfahrer_id") as string) || null,
      notizen: (fd.get("notizen") as string) || null,
      created_by: user?.id ?? null,
    };

    let einteilungId = editing.id;
    if (einteilungId) {
      const { error } = await supabase.from("einteilungen").update(payload).eq("id", einteilungId);
      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: error.message });
        return;
      }
      await supabase.from("einteilung_mitarbeiter").delete().eq("einteilung_id", einteilungId);
    } else {
      const { data, error } = await supabase
        .from("einteilungen")
        .insert(payload as any)
        .select()
        .single();
      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: error.message });
        return;
      }
      einteilungId = data.id;
    }

    if (einteilungId && editingMa.length > 0) {
      const rows = editingMa.map((mid) => ({
        einteilung_id: einteilungId!,
        mitarbeiter_id: mid,
      }));
      const { error } = await supabase.from("einteilung_mitarbeiter").insert(rows as any);
      if (error) {
        toast({ variant: "destructive", title: "Fehler bei Mitarbeiter-Zuordnung", description: error.message });
      }
    }

    toast({ title: editing.id ? "Einteilung aktualisiert" : "Einteilung erstellt" });
    setEditing(null);
    setEditingMa([]);
    load();
  };

  const deleteEinteilung = async (id: string) => {
    if (!confirm("Einteilung löschen?")) return;
    await supabase.from("einteilungen").delete().eq("id", id);
    load();
  };

  const sendAll = async () => {
    const ids = einteilungen.map((e) => e.id);
    if (ids.length === 0) return;
    await supabase.from("einteilungen").update({ versendet_am: new Date().toISOString() }).in("id", ids);
    toast({ title: "Einteilung versendet", description: "Alle Mitarbeiter werden benachrichtigt." });
    load();
  };

  const dateObj = new Date(date);
  const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Arbeitseinteilung"
        description="Tägliche Einteilung der Mitarbeiter auf Baustellen, Fahrzeuge und Aufgaben."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={sendAll} disabled={einteilungen.length === 0}>
              <Send className="h-4 w-4 mr-2" /> An Mitarbeiter senden
            </Button>
            <Button onClick={openNew}>
              <Plus className="h-4 w-4 mr-2" /> Neue Einteilung
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="p-3 flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => moveDate(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
          <Button variant="outline" size="sm" onClick={() => moveDate(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="text-sm font-medium ml-2">
            {dateObj.toLocaleDateString("de-AT", {
              weekday: "long",
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}
            {isWeekend && (
              <Badge variant="outline" className="ml-2">
                Wochenende
              </Badge>
            )}
          </div>
          <div className="ml-auto text-xs text-muted-foreground">
            {einteilungen.length} Einteilungen · {assignedIds.size} eingeteilte Mitarbeiter
            {conflicts.size > 0 && (
              <Badge variant="destructive" className="ml-2">
                <AlertTriangle className="h-3 w-3 mr-1" /> {conflicts.size} Konflikt
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {einteilungen.map((e) => {
          const baustelle = baustellen.find((b) => b.id === e.baustelle_id);
          const fahrzeug = fahrzeuge.find((f) => f.id === e.fahrzeug_id);
          const ma = emRows.filter((r) => r.einteilung_id === e.id);
          return (
            <Card key={e.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-primary" />
                      {baustelle?.bvh_name ?? "— ohne Baustelle —"}
                      {e.versendet_am && <Badge variant="outline" className="text-[10px]">Gesendet</Badge>}
                    </CardTitle>
                    <div className="text-xs text-muted-foreground">
                      {[baustelle?.kostenstelle, baustelle?.ort].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(e)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteEinteilung(e.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <Info label="Abfahrt" value={e.abfahrtszeit?.slice(0, 5)} />
                  <Info label="Fahrzeug" value={fahrzeug?.kennzeichen} />
                  <Info label="Anhänger" value={e.hat_anhaenger ? "Ja" : "Nein"} />
                  <Info label="Treffpunkt" value={e.treffpunkt} />
                </div>
                {(e.material_hinweise || e.sonderaufgaben) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {e.material_hinweise && <Info label="Material" value={e.material_hinweise} />}
                    {e.sonderaufgaben && <Info label="Sonderaufgaben" value={e.sonderaufgaben} />}
                  </div>
                )}
                <div className="border-t pt-2">
                  <div className="text-xs font-medium mb-1 flex items-center gap-1">
                    <Users className="h-3 w-3" /> Eingeteilte Mitarbeiter ({ma.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {ma.map((r) => {
                      const p = profiles.find((x) => x.id === r.mitarbeiter_id);
                      const inConflict = conflicts.has(r.mitarbeiter_id);
                      const partie = partien.find((pt) => pt.id === p?.partie_id);
                      return (
                        <Badge
                          key={r.id}
                          variant={inConflict ? "destructive" : "outline"}
                          style={
                            !inConflict && partie
                              ? { borderColor: partie.farbcode, color: partie.farbcode }
                              : undefined
                          }
                          className="text-[10px]"
                        >
                          {p?.vorname} {p?.nachname}
                          {inConflict && " ⚠"}
                        </Badge>
                      );
                    })}
                    {ma.length === 0 && (
                      <span className="text-[11px] text-muted-foreground">Noch niemand eingeteilt</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {einteilungen.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center space-y-2">
              <Truck className="h-10 w-10 mx-auto text-muted-foreground" />
              <div className="text-sm text-muted-foreground">
                Noch keine Einteilung für {dateObj.toLocaleDateString("de-AT")}.
              </div>
              <Button onClick={openNew} variant="outline" size="sm">
                <Plus className="h-4 w-4 mr-2" /> Erste Einteilung anlegen
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Einteilung bearbeiten" : "Neue Einteilung"}</DialogTitle>
            <DialogDescription>
              Datum: {dateObj.toLocaleDateString("de-AT")}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <form onSubmit={saveEinteilung} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <Label>Baustelle</Label>
                  <select
                    name="baustelle_id"
                    defaultValue={editing.baustelle_id ?? ""}
                    className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="">— ohne / Bauhof —</option>
                    {baustellen.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.bvh_name} {b.kostenstelle ? `· ${b.kostenstelle}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Abfahrtszeit</Label>
                  <Input
                    type="time"
                    name="abfahrtszeit"
                    defaultValue={editing.abfahrtszeit?.slice(0, 5) ?? "06:30"}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Treffpunkt</Label>
                  <Input
                    name="treffpunkt"
                    defaultValue={editing.treffpunkt ?? "Bauhof"}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Fahrzeug</Label>
                  <select
                    name="fahrzeug_id"
                    defaultValue={editing.fahrzeug_id ?? ""}
                    className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="">— wählen —</option>
                    {fahrzeuge.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.kennzeichen} {f.bezeichnung ? `· ${f.bezeichnung}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Kranfahrer</Label>
                  <select
                    name="kranfahrer_id"
                    defaultValue={editing.kranfahrer_id ?? ""}
                    className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="">— keiner —</option>
                    {profiles
                      .filter((p) => p.kran_berechtigung)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.vorname} {p.nachname}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="hat_anhaenger"
                    name="hat_anhaenger"
                    defaultChecked={!!editing.hat_anhaenger}
                  />
                  <Label htmlFor="hat_anhaenger">Anhänger mit dabei</Label>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Material-Hinweise</Label>
                  <Textarea name="material_hinweise" defaultValue={editing.material_hinweise ?? ""} />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Sonderaufgaben</Label>
                  <Textarea name="sonderaufgaben" defaultValue={editing.sonderaufgaben ?? ""} />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Notizen</Label>
                  <Textarea name="notizen" defaultValue={editing.notizen ?? ""} />
                </div>

                <div className="col-span-2 space-y-1.5 border-t pt-3">
                  <Label>Mitarbeiter eingeteilt ({editingMa.length})</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 max-h-64 overflow-y-auto p-2 border rounded">
                    {profiles.map((p) => {
                      const partie = partien.find((pt) => pt.id === p.partie_id);
                      const checked = editingMa.includes(p.id);
                      const conflict = !checked && assignedIds.has(p.id);
                      return (
                        <label
                          key={p.id}
                          className={`flex items-center gap-2 text-xs p-1.5 rounded cursor-pointer ${
                            conflict ? "bg-destructive/10" : "hover:bg-muted/60"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) setEditingMa([...editingMa, p.id]);
                              else setEditingMa(editingMa.filter((id) => id !== p.id));
                            }}
                          />
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ background: partie?.farbcode ?? "#999" }}
                          />
                          <span className="truncate">
                            {p.vorname} {p.nachname[0]}.
                          </span>
                          {conflict && <AlertTriangle className="h-3 w-3 text-destructive ml-auto" />}
                        </label>
                      );
                    })}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Mitarbeiter mit ⚠ sind bereits einer anderen Baustelle an diesem Tag zugeordnet.
                  </div>
                </div>
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

function Info({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium truncate">{value || "—"}</div>
    </div>
  );
}
