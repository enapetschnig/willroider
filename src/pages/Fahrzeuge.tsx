import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Plus,
  Truck,
  Edit,
  Trash2,
  Wrench,
  Building2,
  UserCog,
  UserCheck,
} from "lucide-react";
import type { Database, FahrzeugKategorie } from "@/integrations/supabase/types";

type Fahrzeug = Database["public"]["Tables"]["fahrzeuge"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const KATEGORIEN: { key: FahrzeugKategorie; label: string; color: string; icon: typeof Truck }[] = [
  { key: "anlage", label: "Anlagen", color: "#eab308", icon: Wrench },
  { key: "baustelle", label: "Baustelle", color: "#dc2626", icon: Building2 },
  { key: "bauleiter", label: "Bauleiter", color: "#10b981", icon: UserCog },
];

export default function Fahrzeuge() {
  const { toast } = useToast();
  const [data, setData] = useState<Fahrzeug[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [editing, setEditing] = useState<Partial<Fahrzeug> | null>(null);
  const [tab, setTab] = useState<FahrzeugKategorie>("baustelle");
  const [assignTarget, setAssignTarget] = useState<Fahrzeug | null>(null);

  const load = async () => {
    const [{ data: rows }, { data: ps }] = await Promise.all([
      supabase.from("fahrzeuge").select("*").order("inventar_nr"),
      supabase.from("profiles").select("*").eq("is_active", true).order("nachname"),
    ]);
    setData((rows as Fahrzeug[]) ?? []);
    setProfiles((ps as Profile[]) ?? []);
  };
  useEffect(() => {
    load();
  }, []);

  const profileById = useMemo(
    () => new Map(profiles.map((p) => [p.id, p])),
    [profiles]
  );

  const filtered = useMemo(
    () => data.filter((f) => (f.kategorie ?? "baustelle") === tab),
    [data, tab]
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { anlage: 0, baustelle: 0, bauleiter: 0 };
    data.forEach((f) => {
      const k = f.kategorie ?? "baustelle";
      c[k] = (c[k] ?? 0) + 1;
    });
    return c;
  }, [data]);

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    const payload: any = {
      inventar_nr: (fd.get("inventar_nr") as string) || null,
      kennzeichen: (fd.get("kennzeichen") as string) || null,
      typ: (fd.get("typ") as string) || null,
      bezeichnung: (fd.get("bezeichnung") as string) || null,
      kapazitaet: fd.get("kapazitaet") ? Number(fd.get("kapazitaet")) : null,
      hat_anhaenger: fd.get("hat_anhaenger") === "on",
      aktiv: fd.get("aktiv") === "on",
      notizen: (fd.get("notizen") as string) || null,
      kategorie: (fd.get("kategorie") as string) || "baustelle",
    };
    if (!payload.kennzeichen) {
      payload.kennzeichen = `ANL-${(payload.inventar_nr ?? "neu").replace(/\s+/g, "-")}`;
    }
    const { error } = editing.id
      ? await supabase.from("fahrzeuge").update(payload).eq("id", editing.id)
      : await supabase.from("fahrzeuge").insert(payload as any);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: editing.id ? "Aktualisiert" : "Angelegt" });
    setEditing(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Fahrzeug wirklich löschen?")) return;
    await supabase.from("fahrzeuge").delete().eq("id", id);
    load();
  };

  const assignFahrer = async (fahrerId: string | null) => {
    if (!assignTarget) return;
    const { error } = await supabase
      .from("fahrzeuge")
      .update({ standard_fahrer_id: fahrerId } as any)
      .eq("id", assignTarget.id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: fahrerId ? "Fahrer zugeordnet" : "Zuordnung entfernt" });
    setAssignTarget(null);
    load();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Fahrzeuge & Anlagen"
        description="Werkstatt-Anlagen, Baustellen-Fahrzeuge und Bauleiter-PKW. Standard-Fahrer werden bei Einteilungen automatisch vorgeschlagen."
        actions={
          <Button onClick={() => setEditing({ aktiv: true, kategorie: tab } as any)}>
            <Plus className="h-4 w-4 mr-2" /> Neues Fahrzeug
          </Button>
        }
      />

      {/* Kategorie-Tabs */}
      <Card>
        <CardContent className="p-2 flex flex-wrap gap-1.5">
          {KATEGORIEN.map((k) => {
            const active = k.key === tab;
            const Icon = k.icon;
            return (
              <button
                key={k.key}
                onClick={() => setTab(k.key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition ${
                  active
                    ? "text-white"
                    : "hover:bg-muted text-foreground"
                }`}
                style={active ? { background: k.color } : undefined}
              >
                <Icon className="h-4 w-4" />
                {k.label}
                <span className="text-[10px] tabular-nums opacity-80">
                  ({counts[k.key] ?? 0})
                </span>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((f) => {
          const kat = KATEGORIEN.find((k) => k.key === f.kategorie) ?? KATEGORIEN[1];
          const Icon = kat.icon;
          const fahrer = f.standard_fahrer_id
            ? profileById.get(f.standard_fahrer_id)
            : null;
          return (
            <Card key={f.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start gap-2">
                  <div
                    className="h-10 w-10 rounded-md flex items-center justify-center shrink-0"
                    style={{ background: kat.color + "20" }}
                  >
                    <Icon className="h-5 w-5" style={{ color: kat.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    {f.inventar_nr && (
                      <div className="text-[10px] font-mono text-muted-foreground">
                        {f.inventar_nr}
                      </div>
                    )}
                    <div className="font-bold truncate">
                      {f.bezeichnung || f.kennzeichen}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {f.kennzeichen?.startsWith("ANL-")
                        ? f.typ ?? ""
                        : [f.kennzeichen, f.typ].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {f.aktiv ? (
                    <Badge style={{ background: kat.color }} className="text-white">
                      {kat.label}
                    </Badge>
                  ) : (
                    <Badge variant="outline">inaktiv</Badge>
                  )}
                </div>

                {/* Standard-Fahrer-Zuordnung (nur für Baustelle/Bauleiter) */}
                {f.kategorie !== "anlage" && (
                  <div className="text-xs">
                    {fahrer ? (
                      <div className="flex items-center gap-1 text-emerald-700">
                        <UserCheck className="h-3.5 w-3.5" />
                        <span className="font-medium">
                          {fahrer.vorname} {fahrer.nachname}
                        </span>
                        <button
                          onClick={() => setAssignTarget(f)}
                          className="text-muted-foreground hover:text-primary ml-1 underline"
                        >
                          ändern
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        {f.standard_fahrer_notiz && (
                          <span className="text-muted-foreground italic">
                            {f.standard_fahrer_notiz}
                          </span>
                        )}
                        <button
                          onClick={() => setAssignTarget(f)}
                          className="text-primary hover:underline font-medium ml-auto"
                        >
                          {f.standard_fahrer_notiz ? "→ zuordnen" : "+ Fahrer zuordnen"}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {(f.kapazitaet || f.hat_anhaenger) && (
                  <div className="text-xs text-muted-foreground">
                    {f.kapazitaet ? `${f.kapazitaet} Plätze` : ""}
                    {f.kapazitaet && f.hat_anhaenger ? " · " : ""}
                    {f.hat_anhaenger ? "mit Anhänger" : ""}
                  </div>
                )}

                {f.notizen && (
                  <div className="text-xs text-muted-foreground italic">
                    {f.notizen}
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={() => setEditing(f)}>
                    <Edit className="h-3 w-3 mr-1" /> Bearbeiten
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(f.id)}>
                    <Trash2 className="h-3 w-3 mr-1" /> Löschen
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <Card className="md:col-span-2 lg:col-span-3">
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Keine Einträge in dieser Kategorie.
            </CardContent>
          </Card>
        )}
      </div>

      {/* Bearbeiten-Dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? "Fahrzeug bearbeiten" : "Neues Fahrzeug"}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <form onSubmit={save} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Inventar-Nr.</Label>
                  <Input
                    name="inventar_nr"
                    defaultValue={editing.inventar_nr ?? ""}
                    placeholder="z.B. 140 4810"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Kategorie</Label>
                  <select
                    name="kategorie"
                    defaultValue={editing.kategorie ?? "baustelle"}
                    className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  >
                    {KATEGORIEN.map((k) => (
                      <option key={k.key} value={k.key}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Kennzeichen</Label>
                  <Input
                    name="kennzeichen"
                    defaultValue={editing.kennzeichen ?? ""}
                    placeholder="VI 418 DS (bei Anlagen leer)"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Typ</Label>
                  <Input
                    name="typ"
                    defaultValue={editing.typ ?? ""}
                    placeholder="kastenwagen, lkw, pkw, anhaenger, anlage, stapler"
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Bezeichnung</Label>
                  <Input
                    name="bezeichnung"
                    defaultValue={editing.bezeichnung ?? ""}
                    placeholder="z.B. Sprinter Mercedes"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Kapazität (Plätze)</Label>
                  <Input
                    type="number"
                    name="kapazitaet"
                    defaultValue={editing.kapazitaet ?? ""}
                  />
                </div>
                <div className="flex items-center gap-2 pt-7">
                  <Switch
                    name="hat_anhaenger"
                    defaultChecked={!!editing.hat_anhaenger}
                  />
                  <Label>Hat Anhänger</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch name="aktiv" defaultChecked={editing.aktiv !== false} />
                  <Label>Aktiv</Label>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Notizen</Label>
                  <Input name="notizen" defaultValue={editing.notizen ?? ""} />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(null)}
                >
                  Abbrechen
                </Button>
                <Button type="submit">
                  {editing.id ? "Speichern" : "Anlegen"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Fahrer-Zuordnung-Dialog */}
      <Dialog
        open={!!assignTarget}
        onOpenChange={(o) => !o && setAssignTarget(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Standard-Fahrer zuordnen</DialogTitle>
          </DialogHeader>
          {assignTarget && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Fahrzeug:{" "}
                <strong className="text-foreground">
                  {assignTarget.inventar_nr} · {assignTarget.bezeichnung}
                </strong>
                {assignTarget.standard_fahrer_notiz && (
                  <>
                    <br />
                    <span>Notiz aus Stammliste: „{assignTarget.standard_fahrer_notiz}"</span>
                  </>
                )}
              </div>
              <div className="max-h-[50vh] overflow-y-auto space-y-1">
                {profiles.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => assignFahrer(p.id)}
                    className={`w-full text-left px-3 py-2 rounded border hover:bg-muted ${
                      assignTarget.standard_fahrer_id === p.id
                        ? "bg-primary/10 border-primary"
                        : ""
                    }`}
                  >
                    <div className="text-sm font-medium">
                      {p.nachname}, {p.vorname}
                    </div>
                    {p.pers_nr && (
                      <div className="text-[10px] text-muted-foreground">
                        Pers.-Nr. {p.pers_nr}
                      </div>
                    )}
                  </button>
                ))}
              </div>
              {assignTarget.standard_fahrer_id && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => assignFahrer(null)}
                >
                  Zuordnung entfernen
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
