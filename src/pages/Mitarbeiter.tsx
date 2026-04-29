import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
import { CheckCircle2, XCircle, Plus, Edit, Trash2, AlertTriangle } from "lucide-react";
import type { Database, AppRole } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];

const ROLES: { value: AppRole; label: string }[] = [
  { value: "geschaeftsfuehrung", label: "Geschäftsführung" },
  { value: "bauleiter", label: "Vorarbeiter" },
  { value: "buero", label: "Büro" },
  { value: "mitarbeiter", label: "Mitarbeiter" },
];

export default function Mitarbeiter() {
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const initialTab = params.get("tab") === "partien" ? "partien" : "mitarbeiter";
  const [tab, setTab] = useState(initialTab);

  const onTabChange = (v: string) => {
    setTab(v);
    const next = new URLSearchParams(params);
    if (v === "partien") next.set("tab", "partien");
    else next.delete("tab");
    setParams(next, { replace: true });
  };
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [partien, setPartien] = useState<Partie[]>([]);
  const [roles, setRoles] = useState<Record<string, AppRole>>({});
  const [editing, setEditing] = useState<Profile | null>(null);
  const [editingPartie, setEditingPartie] = useState<Partial<Partie> | null>(null);
  const [assignToPartie, setAssignToPartie] = useState<Partie | null>(null);
  const [deletingProfile, setDeletingProfile] = useState<Profile | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState<string>("");
  const [deleting, setDeleting] = useState<boolean>(false);

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

  const openDelete = (p: Profile) => {
    setDeletingProfile(p);
    setDeleteConfirmText("");
  };

  const confirmDelete = async () => {
    const p = deletingProfile;
    if (!p) return;
    const expected = (p.nachname || `${p.vorname} ${p.nachname}`.trim() || p.email || "")
      .toString()
      .trim();
    if (deleteConfirmText.trim() !== expected) {
      toast({
        variant: "destructive",
        title: "Bestätigung stimmt nicht",
        description: `Eingabe muss exakt "${expected}" lauten.`,
      });
      return;
    }
    setDeleting(true);
    const { error } = await supabase.rpc("admin_delete_user", { _user_id: p.id });
    setDeleting(false);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    const fullName = `${p.vorname} ${p.nachname}`.trim() || p.email || "Mitarbeiter";
    toast({ title: `${fullName} gelöscht`, description: "Alle zugehörigen Daten entfernt." });
    setDeletingProfile(null);
    setDeleteConfirmText("");
    load();
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

  const assignMember = async (profileId: string, partieId: string | null) => {
    const { error } = await supabase
      .from("profiles")
      .update({ partie_id: partieId })
      .eq("id", profileId);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      load();
    }
  };

  const setPartieleiter = async (partieId: string, profileId: string | null) => {
    const { error } = await supabase
      .from("partien")
      .update({ partieleiter_id: profileId })
      .eq("id", partieId);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      // mark/unmark profile as partieleiter
      if (profileId) {
        await supabase.from("profiles").update({ is_partieleiter: true }).eq("id", profileId);
      }
      toast({ title: "Partieleiter aktualisiert" });
      load();
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mitarbeiter & Partien"
        description="Verwalten Sie Mitarbeiter, Rollen und Partien (Teams)."
      />

      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList>
          <TabsTrigger value="mitarbeiter">Mitarbeiter ({profiles.length})</TabsTrigger>
          <TabsTrigger value="partien">Partien ({partien.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="mitarbeiter">
          {/* Mobile: cards */}
          <div className="md:hidden space-y-2">
            {profiles.map((p) => {
              const partie = partien.find((x) => x.id === p.partie_id);
              return (
                <Card key={p.id}>
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm">
                          {p.nachname} {p.vorname}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{p.email}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {p.pers_nr ? `Pers.-Nr. ${p.pers_nr}` : ""}
                          {p.is_partieleiter ? (p.pers_nr ? " · " : "") + "Partieleiter" : ""}
                          {p.kran_berechtigung ? " · Kran" : ""}
                        </div>
                      </div>
                      {p.is_active ? (
                        <Badge className="bg-emerald-600 shrink-0">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> aktiv
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="shrink-0">
                          <XCircle className="h-3 w-3 mr-1" /> inaktiv
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 items-center text-xs">
                      {partie && (
                        <Badge
                          variant="outline"
                          style={{ borderColor: partie.farbcode, color: partie.farbcode }}
                        >
                          {partie.name}
                        </Badge>
                      )}
                      <select
                        value={roles[p.id] ?? "mitarbeiter"}
                        onChange={(e) => setRole(p.id, e.target.value as AppRole)}
                        className="h-9 text-xs rounded-md border bg-background px-2 flex-1 min-w-0"
                      >
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button
                        variant={p.is_active ? "outline" : "default"}
                        size="sm"
                        className="flex-1 h-10"
                        onClick={() => toggleActive(p)}
                      >
                        {p.is_active ? "Deaktivieren" : "Freischalten"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10"
                        onClick={() => setEditing(p)}
                        aria-label="Bearbeiten"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => openDelete(p)}
                        aria-label="Endgültig löschen"
                        title="Endgültig löschen (mit allen Buchungen)"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {profiles.length === 0 && (
              <Card>
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  Noch keine Mitarbeiter.
                </CardContent>
              </Card>
            )}
          </div>

          {/* Desktop: table */}
          <Card className="hidden md:block">
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
                            variant={p.is_active ? "outline" : "default"}
                            size="sm"
                            onClick={() => toggleActive(p)}
                          >
                            {p.is_active ? "Deaktivieren" : "Freischalten"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing(p)}
                            aria-label="Bearbeiten"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => openDelete(p)}
                            aria-label="Endgültig löschen"
                            title="Endgültig löschen (inkl. aller Buchungen)"
                          >
                            <Trash2 className="h-4 w-4" />
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {partien.map((p) => {
              const leiter = profiles.find((x) => x.id === p.partieleiter_id);
              const members = profiles.filter((x) => x.partie_id === p.id);
              return (
                <Card key={p.id}>
                  <CardContent className="p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-center gap-3">
                      <div
                        className="h-10 w-10 rounded-md shrink-0"
                        style={{ background: p.farbcode }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-base truncate">{p.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {p.beschreibung || `${members.length} Mitglieder`}
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => setEditingPartie(p)} aria-label="Bearbeiten">
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => deletePartie(p.id)} aria-label="Löschen">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Partieleiter */}
                    <div className="border-t pt-2">
                      <Label className="text-[10px] uppercase tracking-wide">Partieleiter</Label>
                      <select
                        value={p.partieleiter_id ?? ""}
                        onChange={(e) => setPartieleiter(p.id, e.target.value || null)}
                        className="w-full h-9 rounded-md border bg-background px-2 text-sm mt-1"
                      >
                        <option value="">— keiner —</option>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.vorname} {m.nachname}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Mitglieder-Liste */}
                    <div className="border-t pt-2">
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-[10px] uppercase tracking-wide">
                          Mitglieder ({members.length})
                        </Label>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => setAssignToPartie(p)}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Hinzufügen
                        </Button>
                      </div>
                      {members.length === 0 ? (
                        <div className="text-xs text-muted-foreground italic">
                          Keine Mitarbeiter zugeordnet
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {members.map((m) => (
                            <div
                              key={m.id}
                              className="flex items-center gap-2 px-2 py-1.5 rounded bg-muted/40 text-sm"
                            >
                              <div
                                className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                                style={{ background: p.farbcode, color: "white" }}
                              >
                                {m.vorname[0]}
                                {m.nachname[0]}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="truncate text-xs">
                                  {m.vorname} {m.nachname}
                                  {m.id === p.partieleiter_id && (
                                    <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0">
                                      Leiter
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <button
                                onClick={() => assignMember(m.id, null)}
                                className="text-muted-foreground hover:text-destructive p-1"
                                aria-label="Aus Partie entfernen"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Assign-Members Dialog */}
          <Dialog open={!!assignToPartie} onOpenChange={(o) => !o && setAssignToPartie(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Mitarbeiter zu „{assignToPartie?.name}" hinzufügen</DialogTitle>
              </DialogHeader>
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {profiles
                  .filter((p) => !p.partie_id || p.partie_id === assignToPartie?.id)
                  .map((m) => {
                    const inThis = m.partie_id === assignToPartie?.id;
                    return (
                      <label
                        key={m.id}
                        className="flex items-center gap-3 p-2.5 rounded hover:bg-muted/60 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={inThis}
                          onChange={(e) => {
                            if (e.target.checked) assignMember(m.id, assignToPartie!.id);
                            else assignMember(m.id, null);
                          }}
                          className="h-5 w-5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">
                            {m.vorname} {m.nachname}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {m.qualifikation ?? m.email}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                {profiles.filter((p) => !p.partie_id).length === 0 &&
                  profiles.filter((p) => p.partie_id === assignToPartie?.id).length === 0 && (
                    <div className="text-center text-sm text-muted-foreground p-6">
                      Alle Mitarbeiter sind bereits anderen Partien zugeordnet.
                    </div>
                  )}
              </div>
              <DialogFooter>
                <Button onClick={() => setAssignToPartie(null)}>Fertig</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

      {/* Mitarbeiter endgültig löschen — eigener Confirm-Dialog mit Eingabefeld */}
      <Dialog
        open={!!deletingProfile}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingProfile(null);
            setDeleteConfirmText("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          {deletingProfile && (() => {
            const p = deletingProfile;
            const fullName = `${p.vorname} ${p.nachname}`.trim() || p.email || "Mitarbeiter";
            const expected = (p.nachname || fullName).toString().trim();
            const matches = deleteConfirmText.trim() === expected;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-5 w-5" />
                    Mitarbeiter endgültig löschen
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="rounded-md border-2 border-destructive/40 bg-destructive/5 p-3 text-sm space-y-2">
                    <div>
                      <strong>{fullName}</strong>
                      {p.pers_nr && (
                        <span className="text-muted-foreground"> · Pers.-Nr. {p.pers_nr}</span>
                      )}
                    </div>
                    <div className="text-xs">
                      Beim Bestätigen werden <strong>unwiderruflich</strong> gelöscht:
                    </div>
                    <ul className="text-xs list-disc list-inside space-y-0.5">
                      <li>Profil &amp; Login-Account</li>
                      <li>Alle Stundenbuchungen</li>
                      <li>Alle Einteilungen &amp; Unterschriften</li>
                    </ul>
                  </div>

                  <div>
                    <Label htmlFor="delete-confirm" className="text-sm">
                      Tippe zur Bestätigung den Nachnamen ein:
                    </Label>
                    <div className="mt-1 mb-1.5">
                      <code className="inline-block rounded bg-muted px-2 py-1 text-base font-bold tabular-nums">
                        {expected}
                      </code>
                    </div>
                    <Input
                      id="delete-confirm"
                      autoFocus
                      autoComplete="off"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder={expected}
                      className={`h-11 ${
                        deleteConfirmText && !matches
                          ? "border-destructive focus-visible:ring-destructive"
                          : ""
                      }`}
                    />
                    {deleteConfirmText && !matches && (
                      <div className="text-xs text-destructive mt-1">
                        Eingabe stimmt nicht mit „{expected}" überein.
                      </div>
                    )}
                  </div>
                </div>
                <DialogFooter className="mt-2 gap-2 sm:gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setDeletingProfile(null);
                      setDeleteConfirmText("");
                    }}
                    disabled={deleting}
                  >
                    Abbrechen
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={!matches || deleting}
                    onClick={confirmDelete}
                  >
                    <Trash2 className="h-4 w-4 mr-1.5" />
                    {deleting ? "Lösche…" : "Endgültig löschen"}
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
