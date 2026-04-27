import { useEffect, useState } from "react";
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
import { Plus, Truck, Edit, Trash2 } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Fahrzeug = Database["public"]["Tables"]["fahrzeuge"]["Row"];

export default function Fahrzeuge() {
  const { toast } = useToast();
  const [data, setData] = useState<Fahrzeug[]>([]);
  const [editing, setEditing] = useState<Partial<Fahrzeug> | null>(null);

  const load = async () => {
    const { data: rows } = await supabase.from("fahrzeuge").select("*").order("kennzeichen");
    setData((rows as Fahrzeug[]) ?? []);
  };
  useEffect(() => {
    load();
  }, []);

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    const payload = {
      kennzeichen: fd.get("kennzeichen") as string,
      typ: (fd.get("typ") as string) || null,
      bezeichnung: (fd.get("bezeichnung") as string) || null,
      kapazitaet: fd.get("kapazitaet") ? Number(fd.get("kapazitaet")) : null,
      hat_anhaenger: fd.get("hat_anhaenger") === "on",
      aktiv: fd.get("aktiv") === "on",
      notizen: (fd.get("notizen") as string) || null,
    };
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Fahrzeuge"
        description="Verwaltung der Fahrzeuge und Anhänger für die Einteilung."
        actions={
          <Button onClick={() => setEditing({ aktiv: true })}>
            <Plus className="h-4 w-4 mr-2" /> Neues Fahrzeug
          </Button>
        }
      />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {data.map((f) => (
          <Card key={f.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start gap-2">
                <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
                  <Truck className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold">{f.kennzeichen}</div>
                  <div className="text-xs text-muted-foreground">
                    {[f.typ, f.bezeichnung].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {f.aktiv ? (
                  <Badge className="bg-emerald-600">aktiv</Badge>
                ) : (
                  <Badge variant="outline">inaktiv</Badge>
                )}
              </div>
              <div className="text-xs">
                {f.kapazitaet ? `${f.kapazitaet} Plätze · ` : ""}
                {f.hat_anhaenger ? "mit Anhänger" : "ohne Anhänger"}
              </div>
              {f.notizen && <div className="text-xs text-muted-foreground">{f.notizen}</div>}
              <div className="flex gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(f)}>
                  <Edit className="h-3 w-3 mr-1" /> Bearbeiten
                </Button>
                <Button variant="ghost" size="sm" onClick={() => remove(f.id)}>
                  <Trash2 className="h-3 w-3 mr-1" /> Löschen
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {data.length === 0 && (
          <Card className="md:col-span-2 lg:col-span-3">
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Keine Fahrzeuge angelegt.
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Fahrzeug bearbeiten" : "Neues Fahrzeug"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <form onSubmit={save} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <Label>Kennzeichen *</Label>
                  <Input name="kennzeichen" required defaultValue={editing.kennzeichen ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label>Typ</Label>
                  <Input name="typ" defaultValue={editing.typ ?? ""} placeholder="LKW, Pritsche, Bus..." />
                </div>
                <div className="space-y-1.5">
                  <Label>Bezeichnung</Label>
                  <Input name="bezeichnung" defaultValue={editing.bezeichnung ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label>Kapazität (Plätze)</Label>
                  <Input type="number" name="kapazitaet" defaultValue={editing.kapazitaet ?? ""} />
                </div>
                <div className="flex items-center gap-2 pt-7">
                  <Switch name="hat_anhaenger" defaultChecked={!!editing.hat_anhaenger} />
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
