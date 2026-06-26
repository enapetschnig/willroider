/**
 * Admin-Tab "Berechtigungen": Two-Pane-Editor für Rollen + ihre Permissions.
 *
 *  Links:  Rollen-Liste (System-Rollen oben, Custom unten, + Neue Rolle)
 *  Rechts: Permission-Matrix gruppiert nach Modul (collapsible)
 *
 * Save geht atomar über rpc_save_role_permissions(). Lockout-Schutz auf
 * der UI: kritische Permissions der eigenen Rolle sind disabled.
 */
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissionContext } from "@/contexts/PermissionContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  ShieldCheck,
  Plus,
  Save,
  Trash2,
  ChevronDown,
  ChevronRight,
  Lock,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";

interface Rolle {
  id: string;
  schluessel: string;
  bezeichnung: string;
  beschreibung: string | null;
  is_system: boolean;
  legacy_enum: string | null;
  sort_order: number;
}
interface Berechtigung {
  id: string;
  schluessel: string;
  modul: string;
  aktion: string;
  bezeichnung: string;
  beschreibung: string | null;
  ist_kritisch: boolean;
  sort_order: number;
}

const MODUL_LABEL: Record<string, string> = {
  baustellen: "Baustellen",
  mitarbeiter: "Mitarbeiter",
  stunden: "Stunden",
  berichte: "Berichte",
  evaluierungen: "Evaluierungen",
  arbeitsplanung: "Arbeitsplanung",
  tagesplanung: "Tagesplanung",
  fahrzeuge: "Fahrzeuge",
  kalkulator: "Kalkulator",
  konten: "Konten (ZA + Urlaub)",
  arbeitszeitkalender: "Arbeitszeitkalender",
  angebote: "Angebote",
  meintag: "Mein Tag",
  dashboard: "Dashboard",
  admin: "Admin-Bereich",
  system: "System",
};

export function AdminBerechtigungen() {
  const { user } = useAuth();
  const { refresh: refreshOwnPerms } = usePermissionContext();
  const { toast } = useToast();

  const [rollen, setRollen] = useState<Rolle[]>([]);
  const [perms, setPerms] = useState<Berechtigung[]>([]);
  const [rb, setRb] = useState<Record<string, Set<string>>>({}); // rolle_id → Set<berechtigung_id>
  const [ownRoleId, setOwnRoleId] = useState<string | null>(null);

  const [selRolleId, setSelRolleId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set()); // current selected perm IDs (working copy)
  const [savedSnapshot, setSavedSnapshot] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newRolleOpen, setNewRolleOpen] = useState(false);
  const [editRolleOpen, setEditRolleOpen] = useState(false);

  // ── Load everything ──────────────────────────────────────────────
  const load = async () => {
    setLoading(true);
    const [rRes, bRes, rbRes, userRoleRes] = await Promise.all([
      supabase.from("rollen").select("*").order("sort_order"),
      supabase.from("berechtigungen").select("*").order("sort_order"),
      supabase.from("rollen_berechtigungen").select("rolle_id, berechtigung_id"),
      user
        ? supabase.from("user_roles").select("rolle_id").eq("user_id", user.id).maybeSingle()
        : Promise.resolve({ data: null } as any),
    ]);
    if (rRes.error || bRes.error || rbRes.error) {
      toast({
        variant: "destructive",
        title: "Lade-Fehler",
        description: rRes.error?.message ?? bRes.error?.message ?? rbRes.error?.message,
      });
      return;
    }
    const rollenData = (rRes.data ?? []) as Rolle[];
    const permsData = (bRes.data ?? []) as Berechtigung[];
    const rbData = (rbRes.data ?? []) as { rolle_id: string; berechtigung_id: string }[];
    const rbMap: Record<string, Set<string>> = {};
    for (const r of rollenData) rbMap[r.id] = new Set();
    for (const x of rbData) {
      if (!rbMap[x.rolle_id]) rbMap[x.rolle_id] = new Set();
      rbMap[x.rolle_id].add(x.berechtigung_id);
    }
    setRollen(rollenData);
    setPerms(permsData);
    setRb(rbMap);
    setOwnRoleId((userRoleRes as any)?.data?.rolle_id ?? null);
    setLoading(false);

    // Default: erste Rolle wählen, alle Modulgruppen ausklappen
    if (!selRolleId && rollenData.length > 0) {
      setSelRolleId(rollenData[0].id);
    }
    setOpenGroups(new Set(Array.from(new Set(permsData.map((p) => p.modul)))));
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ── Bei Rolle-Wechsel: Draft + Snapshot setzen ────────────────────
  useEffect(() => {
    if (!selRolleId) return;
    const current = rb[selRolleId] ?? new Set<string>();
    setDraft(new Set(current));
    setSavedSnapshot(new Set(current));
  }, [selRolleId, rb]);

  const selRolle = useMemo(
    () => rollen.find((r) => r.id === selRolleId) ?? null,
    [rollen, selRolleId],
  );

  // ── Gruppierung der Permissions nach Modul ────────────────────────
  const grouped = useMemo(() => {
    const groups: Record<string, Berechtigung[]> = {};
    for (const p of perms) {
      if (search && !p.bezeichnung.toLowerCase().includes(search.toLowerCase()) && !p.schluessel.includes(search)) continue;
      if (!groups[p.modul]) groups[p.modul] = [];
      groups[p.modul].push(p);
    }
    return groups;
  }, [perms, search]);

  // ── Dirty-Tracking ────────────────────────────────────────────────
  const dirty = useMemo(() => {
    if (savedSnapshot.size !== draft.size) return true;
    for (const id of draft) if (!savedSnapshot.has(id)) return true;
    return false;
  }, [savedSnapshot, draft]);

  // ── Permission togglen ────────────────────────────────────────────
  const togglePerm = (permId: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(permId)) next.delete(permId);
      else next.add(permId);
      return next;
    });
  };

  /** True wenn die Checkbox disabled werden muss, weil der User die
   *  Berechtigung sich selbst entziehen würde (kritische Permission
   *  + eigene Rolle). */
  const isLockedForSelf = (perm: Berechtigung): boolean => {
    if (!perm.ist_kritisch) return false;
    if (selRolleId !== ownRoleId) return false;
    return draft.has(perm.id); // nur wenn aktuell aktiv → Entzug verhindern
  };

  const save = async () => {
    if (!selRolle) return;
    setSaving(true);
    const keys = perms.filter((p) => draft.has(p.id)).map((p) => p.schluessel);
    const { data, error } = await supabase.rpc("rpc_save_role_permissions", {
      _rolle_id: selRolle.id,
      _keys: keys,
    });
    if (error) {
      toast({ variant: "destructive", title: "Speichern fehlgeschlagen", description: error.message });
    } else {
      const summary = data as { granted?: number; revoked?: number };
      toast({
        title: "Berechtigungen gespeichert",
        description: `${summary?.granted ?? 0} hinzugefügt, ${summary?.revoked ?? 0} entzogen.`,
      });
      // Realtime sollte load triggern, sicherheitshalber manuell:
      await load();
      await refreshOwnPerms();
    }
    setSaving(false);
  };

  const reset = () => setDraft(new Set(savedSnapshot));

  // ── Render ────────────────────────────────────────────────────────
  if (loading) return <div className="p-6 text-muted-foreground">Lade Berechtigungen …</div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <div className="font-semibold">Rollen & Berechtigungen</div>
            <div className="text-xs text-muted-foreground">
              Pro Rolle festlegen, welche Berechtigungen vergeben sind. Änderungen wirken
              <strong> sofort</strong> in der DB und im Frontend (Realtime).
            </div>
          </div>
          <Button onClick={() => setNewRolleOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Neue Rolle
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-3">
        {/* Rollen-Liste */}
        <Card className="h-fit">
          <CardContent className="p-2 space-y-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground px-2 pt-1 pb-2">
              Rollen
            </div>
            {rollen.map((r) => {
              const cnt = rb[r.id]?.size ?? 0;
              return (
                <button
                  key={r.id}
                  onClick={() => setSelRolleId(r.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition ${
                    selRolleId === r.id
                      ? "bg-primary/10 ring-1 ring-primary/40"
                      : "hover:bg-muted"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium flex-1 truncate">{r.bezeichnung}</span>
                    {r.is_system && (
                      <Lock className="h-3 w-3 text-muted-foreground" />
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {cnt} Berechtigung{cnt === 1 ? "" : "en"}
                    {r.id === ownRoleId ? " · deine Rolle" : ""}
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Permission-Matrix */}
        <Card>
          <CardContent className="p-4 space-y-3">
            {!selRolle ? (
              <div className="text-sm text-muted-foreground">Wähle links eine Rolle.</div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <div className="font-semibold flex items-center gap-2">
                      {selRolle.bezeichnung}
                      {selRolle.is_system && (
                        <span className="text-[10px] uppercase tracking-wide bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                          System
                        </span>
                      )}
                    </div>
                    {selRolle.beschreibung && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {selRolle.beschreibung}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {dirty && (
                      <Button size="sm" variant="outline" onClick={reset} disabled={saving}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Verwerfen
                      </Button>
                    )}
                    <Button size="sm" onClick={save} disabled={!dirty || saving}>
                      <Save className="h-3.5 w-3.5 mr-1.5" />
                      {saving ? "Speichere …" : "Speichern"}
                    </Button>
                    {!selRolle.is_system && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditRolleOpen(true)}
                      >
                        Bearbeiten
                      </Button>
                    )}
                  </div>
                </div>

                <Input
                  placeholder="Berechtigungen suchen …"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9"
                />

                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  {Object.entries(grouped)
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([modul, plist]) => {
                      const total = plist.length;
                      const active = plist.filter((p) => draft.has(p.id)).length;
                      const isOpen = openGroups.has(modul);
                      return (
                        <div key={modul} className="border rounded-md">
                          <button
                            onClick={() =>
                              setOpenGroups((prev) => {
                                const next = new Set(prev);
                                if (next.has(modul)) next.delete(modul);
                                else next.add(modul);
                                return next;
                              })
                            }
                            className="w-full px-3 py-2 flex items-center gap-2 text-sm font-medium hover:bg-muted/50"
                          >
                            {isOpen ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                            <span className="flex-1 text-left">{MODUL_LABEL[modul] ?? modul}</span>
                            <span className="text-[11px] text-muted-foreground">
                              {active} / {total}
                            </span>
                          </button>
                          {isOpen && (
                            <div className="divide-y border-t">
                              {plist.map((p) => {
                                const locked = isLockedForSelf(p);
                                return (
                                  <label
                                    key={p.id}
                                    className={`flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-muted/30 ${
                                      p.ist_kritisch ? "bg-amber-50/40" : ""
                                    } ${locked ? "opacity-60 cursor-not-allowed" : ""}`}
                                    title={locked ? "Du kannst dir selbst keine kritische Berechtigung entziehen" : undefined}
                                  >
                                    <Checkbox
                                      checked={draft.has(p.id)}
                                      onCheckedChange={() => !locked && togglePerm(p.id)}
                                      disabled={locked}
                                      className="mt-0.5"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm font-medium flex items-center gap-1.5">
                                        {p.bezeichnung}
                                        {p.ist_kritisch && (
                                          <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
                                        )}
                                      </div>
                                      <div className="text-[11px] text-muted-foreground">
                                        {p.schluessel}
                                        {p.beschreibung ? ` · ${p.beschreibung}` : ""}
                                      </div>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <NewRolleDialog
        open={newRolleOpen}
        onOpenChange={setNewRolleOpen}
        onCreated={() => void load()}
        templates={rollen}
      />

      {selRolle && !selRolle.is_system && (
        <EditRolleDialog
          rolle={selRolle}
          open={editRolleOpen}
          onOpenChange={setEditRolleOpen}
          onChanged={() => void load()}
          onDeleted={() => {
            setSelRolleId(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

// ── NEUE-ROLLE-DIALOG ────────────────────────────────────────────────
function NewRolleDialog({
  open,
  onOpenChange,
  onCreated,
  templates,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
  templates: Rolle[];
}) {
  const { toast } = useToast();
  const [bezeichnung, setBezeichnung] = useState("");
  const [beschreibung, setBeschreibung] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setBezeichnung("");
      setBeschreibung("");
      setTemplateId("");
    }
  }, [open]);

  const create = async () => {
    if (!bezeichnung.trim()) return;
    setSaving(true);
    const schluessel = bezeichnung
      .toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const { data: rolle, error } = await supabase
      .from("rollen")
      .insert({
        schluessel,
        bezeichnung: bezeichnung.trim(),
        beschreibung: beschreibung.trim() || null,
        is_system: false,
        sort_order: 1000,
      })
      .select("id")
      .single();
    if (error) {
      toast({ variant: "destructive", title: "Anlegen fehlgeschlagen", description: error.message });
      setSaving(false);
      return;
    }
    // Optional: Permissions von Vorlage kopieren
    if (templateId && rolle) {
      const { data: tmplPerms } = await supabase
        .from("rollen_berechtigungen")
        .select("berechtigung_id")
        .eq("rolle_id", templateId);
      if (tmplPerms && tmplPerms.length > 0) {
        const rows = tmplPerms.map((x) => ({
          rolle_id: rolle.id,
          berechtigung_id: x.berechtigung_id,
        }));
        await supabase.from("rollen_berechtigungen").insert(rows);
      }
    }
    toast({ title: "Rolle angelegt", description: bezeichnung });
    setSaving(false);
    onOpenChange(false);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Neue Rolle anlegen</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Bezeichnung *</Label>
            <Input
              value={bezeichnung}
              onChange={(e) => setBezeichnung(e.target.value)}
              placeholder="z. B. Polier extern"
              autoFocus
            />
          </div>
          <div>
            <Label>Beschreibung</Label>
            <Textarea
              value={beschreibung}
              onChange={(e) => setBeschreibung(e.target.value)}
              rows={2}
            />
          </div>
          <div>
            <Label>Vorlage (Berechtigungen kopieren)</Label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full h-10 px-3 rounded-md border bg-background text-sm"
            >
              <option value="">— keine Vorlage, leer starten —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.bezeichnung}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={create} disabled={!bezeichnung.trim() || saving}>
            {saving ? "Anlegen …" : "Anlegen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── EDIT-ROLLE-DIALOG ────────────────────────────────────────────────
function EditRolleDialog({
  rolle,
  open,
  onOpenChange,
  onChanged,
  onDeleted,
}: {
  rolle: Rolle;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [bezeichnung, setBezeichnung] = useState(rolle.bezeichnung);
  const [beschreibung, setBeschreibung] = useState(rolle.beschreibung ?? "");

  useEffect(() => {
    if (open) {
      setBezeichnung(rolle.bezeichnung);
      setBeschreibung(rolle.beschreibung ?? "");
    }
  }, [open, rolle]);

  const save = async () => {
    const { error } = await supabase
      .from("rollen")
      .update({
        bezeichnung: bezeichnung.trim(),
        beschreibung: beschreibung.trim() || null,
      })
      .eq("id", rolle.id);
    if (error) {
      toast({ variant: "destructive", title: "Speichern fehlgeschlagen", description: error.message });
      return;
    }
    toast({ title: "Rolle aktualisiert" });
    onOpenChange(false);
    onChanged();
  };

  const remove = async () => {
    if (!window.confirm(`Rolle "${rolle.bezeichnung}" wirklich löschen? Zugewiesene User landen auf "Mitarbeiter".`)) return;
    // Vorher: alle user_roles auf 'mitarbeiter' setzen
    const { data: mitarbeiterRolle } = await supabase
      .from("rollen")
      .select("id")
      .eq("schluessel", "mitarbeiter")
      .single();
    if (mitarbeiterRolle) {
      await supabase
        .from("user_roles")
        .update({ rolle_id: mitarbeiterRolle.id })
        .eq("rolle_id", rolle.id);
    }
    const { error } = await supabase.from("rollen").delete().eq("id", rolle.id);
    if (error) {
      toast({ variant: "destructive", title: "Löschen fehlgeschlagen", description: error.message });
      return;
    }
    toast({ title: "Rolle gelöscht" });
    onOpenChange(false);
    onDeleted();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rolle bearbeiten</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Bezeichnung</Label>
            <Input value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)} />
          </div>
          <div>
            <Label>Beschreibung</Label>
            <Textarea value={beschreibung} onChange={(e) => setBeschreibung(e.target.value)} rows={2} />
          </div>
          <div className="text-xs text-muted-foreground">
            Schlüssel <code>{rolle.schluessel}</code> kann nicht geändert werden.
          </div>
        </div>
        <DialogFooter className="justify-between">
          <Button variant="outline" className="text-destructive" onClick={remove}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Löschen
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button onClick={save}>Speichern</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
