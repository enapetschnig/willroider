import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, Plus, Edit, Trash2 } from "lucide-react";
import type { Database, AppRole } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];

const ROLES: { value: AppRole; label: string }[] = [
  { value: "geschaeftsfuehrung", label: "Geschäftsführung" },
  { value: "bauleiter", label: "Bauleiter" },
  { value: "zimmermeister", label: "Zimmermeister" },
  { value: "buero", label: "Büro" },
  { value: "mitarbeiter", label: "Mitarbeiter" },
];

export default function Mitarbeiter() {
  const { toast } = useToast();
  const [tab, setTab] = useState("mitarbeiter");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [partien, setPartien] = useState<Partie[]>([]);
  const [roles, setRoles] = useState<Record<string, AppRole>>({});
  const [editing, setEditing] = useState<Profile | null>(null);
  const [editingPartie, setEditingPartie] = useState<Partial<Partie> | null>(null);

  const load = async () => {
    const [profRes, partRes, roleRes] = await Promise.all([
      supabase.from("profiles").select("*").order("nachname"),
      supabase.from("partien").select("*").order("name"),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    setProfiles((profRes.data as Profile[]) ?? []);
    setPartien((partRes.data as Partie[]) ?? []);
    const map: Record<string, AppRole> = {};
    (roleRes.data ?? []).forEach((r: any) => {
      map[r.user_id] = r.role;
    });
    setRoles(map);
  };

  useEffect(() => {
    load();
  }, []);

  const toggleActive = async (p: Profile) => {
    const { error } = await supabase
      .from("profiles")
      .update({ is_active: !p.is_active })
      .eq("id", p.id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      toast({ title: !p.is_active ? "Mitarbeiter freigeschaltet" : "Mitarbeiter deaktiviert" });
      load();
    }
  };

  const setRole = async (userId: string, role: AppRole) => {
    await supabase.from("user_roles").delete().eq("user_id", userId);
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      toast({ title: "Rolle aktualisiert" });
      load();
    }
  };

  const saveProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    const payload = {
      vorname: fd.get("vorname") as string,
      nachname: fd.get("nachname") as string,
      pers_nr: (fd.get("pers_nr") as string) || null,
      telefon: (fd.get("telefon") as string) || null,
      qualifikation: (fd.get("qualifikation") as string) || null,
      fuehrerschein: (fd.get("fuehrerschein") as string) || null,
      kran_berechtigung: fd.get("kran_berechtigung") === "on",
      partie_id: (fd.get("partie_id") as string) || null,
      is_partieleiter: fd.get("is_partieleiter") === "on",
    };
    const { error } = await supabase.from("profiles").update(payload).eq("id", editing.id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Mitarbeiter aktualisiert" });
    setEditing(null);
    load();
  };

  const savePartie = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingPartie) return;
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: fd.get("name") as string,
      farbcode: fd.get("farbcode") as string,
      partieleiter_id: (fd.get("partieleiter_id") as string) || null,
      beschreibung: (fd.get("beschreibung") as string) || null,
    };
    const { error } = editingPartie.id
      ? await supabase.from("partien").update(payload).eq("id", editingPartie.id)
      : await supabase.from("partien").insert(payload as any);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: editingPartie.id ? "Partie aktualisiert" : "Partie angelegt" });
    setEditingPartie(null);
    load();
  };

  const deletePartie = async (id: string) => {
    if (!confirm("Partie wirklich löschen? Mitarbeiter werden entkoppelt.")) return;
    const { error } = await supabase.from("partien").delete().eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      toast({ title: "Partie gelöscht" });
      load();
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mitarbeiter & Partien"
        description="Verwalten Sie Mitarbeiter, Rollen und Partien (Teams)."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="mitarbeiter">Mitarbeiter ({profiles.length})</TabsTrigger>
          <TabsTrigger value="partien">Partien ({partien.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="mitarbeiter">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Pers.-Nr.</TableHead>
                    <TableHead>E-Mail</TableHead>
                    <TableHead>Partie</TableHead>
                    <TableHead>Rolle</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aktion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.map((p) => {
                    const partie = partien.find((x) => x.id === p.partie_id);
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="font-medium">
                            {p.nachname} {p.vorname}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {p.is_partieleiter ? "Partieleiter" : ""}
                            {p.kran_berechtigung ? (p.is_partieleiter ? " · " : "") + "Kran" : ""}
                          </div>
                        </TableCell>
                        <TableCell>{p.pers_nr ?? "—"}</TableCell>
                        <TableCell className="text-xs">{p.email}</TableCell>
                        <TableCell>
                          {partie ? (
                            <Badge
                              variant="outline"
                              style={{
                                borderColor: partie.farbcode,
                                color: partie.farbcode,
                              }}
                            >
                              {partie.name}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <select
                            value={roles[p.id] ?? "mitarbeiter"}
                            onChange={(e) => setRole(p.id, e.target.value as AppRole)}
                            className="h-8 text-xs rounded-md border bg-background px-2"
                          >
                            {ROLES.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell>
                          {p.is_active ? (
                            <Badge variant="default" className="bg-emerald-600">
                              <CheckCircle2 className="h-3 w-3 mr-1" /> aktiv
                            </Badge>
                          ) : (
                            <Badge variant="outline">
                              <XCircle className="h-3 w-3 mr-1" /> inaktiv
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => toggleActive(p)}
                          >
                            {p.is_active ? "Deaktivieren" : "Freischalten"}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {profiles.length === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Noch keine Mitarbeiter. Mitarbeiter müssen sich registrieren und werden hier
                  angezeigt.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="partien">
          <div className="flex justify-end mb-3">
            <Button onClick={() => setEditingPartie({ farbcode: "#3b82f6" })}>
              <Plus className="h-4 w-4 mr-2" /> Neue Partie
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {partien.map((p) => {
              const leiter = profiles.find((x) => x.id === p.partieleiter_id);
              const members = profiles.filter((x) => x.partie_id === p.id);
              return (
                <Card key={p.id}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start gap-2">
                      <div
                        className="h-10 w-10 rounded-md shrink-0"
                        style={{ background: p.farbcode }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate">{p.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {p.beschreibung || "—"}
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => setEditingPartie(p)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => deletePartie(p.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="text-xs">
                      <span className="text-muted-foreground">Partieleiter: </span>
                      {leiter ? `${leiter.vorname} ${leiter.nachname}` : "—"}
                    </div>
                    <div className="text-xs">
                      <span className="text-muted-foreground">Mitglieder: </span>
                      {members.length}
                    </div>
                    {members.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {members.map((m) => (
                          <Badge key={m.id} variant="outline" className="text-[10px]">
                            {m.vorname} {m.nachname[0]}.
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* Edit profile dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mitarbeiter bearbeiten</DialogTitle>
          </DialogHeader>
          {editing && (
            <form onSubmit={saveProfile} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Vorname</Label>
                  <Input name="vorname" defaultValue={editing.vorname} required />
                </div>
                <div className="space-y-1.5">
                  <Label>Nachname</Label>
                  <Input name="nachname" defaultValue={editing.nachname} required />
                </div>
                <div className="space-y-1.5">
                  <Label>Pers.-Nr.</Label>
                  <Input name="pers_nr" defaultValue={editing.pers_nr ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label>Telefon</Label>
                  <Input name="telefon" defaultValue={editing.telefon ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label>Qualifikation</Label>
                  <Input
                    name="qualifikation"
                    defaultValue={editing.qualifikation ?? ""}
                    placeholder="z.B. Zimmerer, Lehrling"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Führerscheinklasse</Label>
                  <Input
                    name="fuehrerschein"
                    defaultValue={editing.fuehrerschein ?? ""}
                    placeholder="B, C, CE..."
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Partie</Label>
                  <select
                    name="partie_id"
                    defaultValue={editing.partie_id ?? ""}
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
                <div className="flex items-center gap-2">
                  <Switch
                    id="is_partieleiter"
                    name="is_partieleiter"
                    defaultChecked={!!editing.is_partieleiter}
                  />
                  <Label htmlFor="is_partieleiter">Partieleiter</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="kran_berechtigung"
                    name="kran_berechtigung"
                    defaultChecked={!!editing.kran_berechtigung}
                  />
                  <Label htmlFor="kran_berechtigung">Kran-Berechtigung</Label>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  Abbrechen
                </Button>
                <Button type="submit">Speichern</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Partie dialog */}
      <Dialog open={!!editingPartie} onOpenChange={(open) => !open && setEditingPartie(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPartie?.id ? "Partie bearbeiten" : "Neue Partie"}</DialogTitle>
          </DialogHeader>
          {editingPartie && (
            <form onSubmit={savePartie} className="space-y-3">
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input name="name" defaultValue={editingPartie.name ?? ""} required />
              </div>
              <div className="space-y-1.5">
                <Label>Farbcode</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    name="farbcode"
                    defaultValue={editingPartie.farbcode ?? "#3b82f6"}
                    className="h-10 w-16 rounded border"
                  />
                  <span className="text-xs text-muted-foreground">
                    Wird im Gantt-Chart verwendet.
                  </span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Partieleiter</Label>
                <select
                  name="partieleiter_id"
                  defaultValue={editingPartie.partieleiter_id ?? ""}
                  className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">— wählen —</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.vorname} {p.nachname}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Beschreibung</Label>
                <Input name="beschreibung" defaultValue={editingPartie.beschreibung ?? ""} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingPartie(null)}>
                  Abbrechen
                </Button>
                <Button type="submit">{editingPartie.id ? "Speichern" : "Anlegen"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
