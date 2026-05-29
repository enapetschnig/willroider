/**
 * Vorlagen für Sicherheits-Unterweisungen — verwaltet im Bereich
 * /admin?tab=evaluierung. Eine Vorlage ist im MVP ein Bündel aus
 * Name + Typ + Default-Notizen, das beim Anlegen einer neuen Evaluierung
 * mit einem Klick vorgefüllt werden kann.
 */

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { useAuth } from "@/contexts/AuthContext";
import { Plus, FileText, Pencil, Trash2 } from "lucide-react";
import type { Database, EvaluierungTyp } from "@/integrations/supabase/types";
import { UNTERWEISUNG_OPTIONS, unterweisungLabel } from "@/lib/unterweisungen";

type Vorlage = Database["public"]["Tables"]["evaluierung_vorlagen"]["Row"];

export function EvaluierungVorlagenCard() {
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const [rows, setRows] = useState<Vorlage[]>([]);
  const [editing, setEditing] = useState<Partial<Vorlage> | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("evaluierung_vorlagen")
      .select("*")
      .order("aktiv", { ascending: false })
      .order("name");
    setRows((data as Vorlage[]) ?? []);
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  if (!isAdmin) return null;

  const openNew = () =>
    setEditing({ typ: "baustelle", aktiv: true, notizen: "" });

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: (fd.get("name") as string).trim(),
      typ: (fd.get("typ") as EvaluierungTyp) || "baustelle",
      notizen: ((fd.get("notizen") as string) || "").trim() || null,
      aktiv: editing.aktiv ?? true,
      erstellt_von: user?.id ?? null,
    };
    if (!payload.name) {
      toast({ variant: "destructive", title: "Name erforderlich" });
      return;
    }
    if (editing.id) {
      const { error } = await supabase
        .from("evaluierung_vorlagen")
        .update(payload)
        .eq("id", editing.id);
      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: error.message });
        return;
      }
    } else {
      const { error } = await supabase
        .from("evaluierung_vorlagen")
        .insert(payload as any);
      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: error.message });
        return;
      }
    }
    toast({ title: editing.id ? "Vorlage aktualisiert" : "Vorlage angelegt" });
    setEditing(null);
    load();
  };

  const toggleAktiv = async (v: Vorlage) => {
    const { error } = await supabase
      .from("evaluierung_vorlagen")
      .update({ aktiv: !v.aktiv })
      .eq("id", v.id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    load();
  };

  const remove = async (v: Vorlage) => {
    if (!window.confirm(`Vorlage „${v.name}" wirklich löschen?`)) return;
    const { error } = await supabase
      .from("evaluierung_vorlagen")
      .delete()
      .eq("id", v.id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Vorlage gelöscht" });
    load();
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-semibold text-sm flex items-center gap-1.5">
              <FileText className="h-4 w-4 text-primary" />
              Unterweisungs-Vorlagen
            </div>
            <div className="text-xs text-muted-foreground">
              Wiederverwendbare Defaults für Typ und Notizen.
            </div>
          </div>
          <Button size="sm" onClick={openNew}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Vorlage
          </Button>
        </div>

        {rows.length === 0 ? (
          <div className="text-xs text-muted-foreground italic text-center py-4">
            Keine Vorlagen angelegt.
          </div>
        ) : (
          <div className="space-y-1.5">
            {rows.map((v) => (
              <div
                key={v.id}
                className={`flex items-center gap-2 border rounded p-2 text-sm ${
                  v.aktiv ? "" : "opacity-60"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{v.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {unterweisungLabel(v.typ)}
                    {v.notizen ? ` · ${v.notizen.slice(0, 60)}${v.notizen.length > 60 ? "…" : ""}` : ""}
                  </div>
                </div>
                <Switch
                  checked={v.aktiv}
                  onCheckedChange={() => toggleAktiv(v)}
                  aria-label="aktiv"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => setEditing(v)}
                  aria-label="Bearbeiten"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-destructive"
                  onClick={() => remove(v)}
                  aria-label="Löschen"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editing?.id ? "Vorlage bearbeiten" : "Neue Vorlage"}
              </DialogTitle>
            </DialogHeader>
            {editing && (
              <form onSubmit={save} className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Name *</Label>
                  <Input
                    name="name"
                    required
                    defaultValue={editing.name ?? ""}
                    placeholder="z. B. Arbeiten in Höhe"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Unterweisungs-Typ</Label>
                  <select
                    name="typ"
                    defaultValue={editing.typ ?? "baustelle"}
                    className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  >
                    {UNTERWEISUNG_OPTIONS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Notizen-Default (optional)</Label>
                  <Textarea
                    name="notizen"
                    rows={3}
                    defaultValue={editing.notizen ?? ""}
                    placeholder="Hinweise, die in jede aus dieser Vorlage erzeugte Evaluierung kopiert werden."
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditing(null)}
                  >
                    Abbrechen
                  </Button>
                  <Button type="submit">{editing.id ? "Speichern" : "Anlegen"}</Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
