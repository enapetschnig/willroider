import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Pencil,
  Trash2,
  Plus,
  Check,
  X,
  Clock,
  Tag,
  Coffee,
  ShieldAlert,
  Car,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useTaetigkeitenStamm,
  useTaetigkeitMutation,
  useZulagenTypen,
  useZulageMutation,
  usePausenConfig,
  usePausenConfigMutation,
  useArbeitszeitLimits,
  useArbeitszeitLimitsMutation,
} from "@/hooks/useStammdatenStunden";

export function AdminStammdatenStunden() {
  return (
    <div className="space-y-4">
      <PausenConfigCard />
      <ArbeitszeitLimitsCard />
      <KilometergeldCard />
      <TaetigkeitenStammCard />
      <ZulagenStammCard />
    </div>
  );
}

// ─── Kilometergeld ─────────────────────────────────────────────────────────

function KilometergeldCard() {
  const { toast } = useToast();
  const { data, isLoading } = useArbeitszeitLimits();
  const mut = useArbeitszeitLimitsMutation();

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Kilometergeld laden…
        </CardContent>
      </Card>
    );
  }

  const update = async (satz: number) => {
    try {
      await mut.mutateAsync({ kilometergeld_satz_eur: satz });
      toast({ title: "Kilometergeld-Satz aktualisiert" });
    } catch (e) {
      toast({ variant: "destructive", title: "Fehler", description: (e as Error).message });
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold">
          <Car className="h-4 w-4 text-primary" />
          Kilometergeld
        </div>
        <div className="space-y-1 max-w-[200px]">
          <Label className="text-xs text-muted-foreground">
            Satz pro privat gefahrenem km
          </Label>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              step={0.01}
              min={0}
              defaultValue={data.kilometergeld_satz_eur}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (v >= 0 && v !== data.kilometergeld_satz_eur) update(v);
              }}
              className="h-9"
            />
            <span className="text-xs text-muted-foreground">€/km</span>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Wird in der Zeiterfassung für privat gefahrene Kilometer verwendet
          (amtlicher Satz aktuell 0,50 €/km).
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Pausen-Config ─────────────────────────────────────────────────────────

function PausenConfigCard() {
  const { toast } = useToast();
  const { data, isLoading } = usePausenConfig();
  const mut = usePausenConfigMutation();

  const update = async (typ: "vormittag" | "mittag", patch: { dauer_minuten?: number; default_aktiv?: boolean }) => {
    try {
      await mut.mutateAsync({ typ, ...patch });
      toast({ title: "Pause aktualisiert" });
    } catch (e) {
      toast({ variant: "destructive", title: "Fehler", description: (e as Error).message });
    }
  };

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Pausen-Stammdaten laden…
        </CardContent>
      </Card>
    );
  }

  const renderRow = (typ: "vormittag" | "mittag", label: string) => {
    const row = typ === "vormittag" ? data.vm : data.mittag;
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <div className="font-medium min-w-32">{label}</div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Dauer</Label>
          <Input
            type="number"
            min={0}
            step={5}
            defaultValue={row.dauer_minuten}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (v !== row.dauer_minuten) update(typ, { dauer_minuten: v });
            }}
            className="w-20 h-9 text-right"
          />
          <span className="text-xs text-muted-foreground">min</span>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={row.default_aktiv}
            onCheckedChange={(v) => update(typ, { default_aktiv: v })}
          />
          <Label className="text-xs cursor-pointer">Standardmäßig aktiv</Label>
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold">
          <Coffee className="h-4 w-4 text-primary" />
          Pausen-Einstellungen
        </div>
        <p className="text-xs text-muted-foreground -mt-1">
          Diese Pausen werden auf die Netto-Eingabe addiert (nicht abgezogen).
          Toggles bei der Eingabe sind standardmäßig aktiv.
        </p>
        {renderRow("vormittag", "Vormittagspause")}
        {renderRow("mittag", "Mittagspause")}
      </CardContent>
    </Card>
  );
}

// ─── Arbeitszeit-Limits ────────────────────────────────────────────────────

function ArbeitszeitLimitsCard() {
  const { toast } = useToast();
  const { data, isLoading } = useArbeitszeitLimits();
  const mut = useArbeitszeitLimitsMutation();

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Arbeitszeit-Limits laden…
        </CardContent>
      </Card>
    );
  }

  const update = async (patch: Partial<typeof data>) => {
    try {
      await mut.mutateAsync(patch);
      toast({ title: "Limit aktualisiert" });
    } catch (e) {
      toast({ variant: "destructive", title: "Fehler", description: (e as Error).message });
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldAlert className="h-4 w-4 text-primary" />
          Arbeitszeit-Grenzen &amp; Standard-Beginn
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Max. Netto-Arbeit pro Tag
            </Label>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                step={0.5}
                defaultValue={data.max_netto_pro_tag}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (v !== data.max_netto_pro_tag) update({ max_netto_pro_tag: v });
                }}
                className="h-9"
              />
              <span className="text-xs text-muted-foreground">h</span>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Max. Anwesenheit pro Tag
            </Label>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                step={0.5}
                defaultValue={data.max_brutto_pro_tag}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (v !== data.max_brutto_pro_tag) update({ max_brutto_pro_tag: v });
                }}
                className="h-9"
              />
              <span className="text-xs text-muted-foreground">h</span>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Standard-Arbeitsbeginn
            </Label>
            <Input
              type="time"
              defaultValue={data.arbeitsbeginn_default?.slice(0, 5) ?? "07:00"}
              onBlur={(e) => {
                const v = e.target.value;
                if (v && v !== data.arbeitsbeginn_default?.slice(0, 5)) {
                  update({ arbeitsbeginn_default: v });
                }
              }}
              className="h-9"
            />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Überschreitet eine Eingabe diese Grenzen, zeigt das Form eine Warnung.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Tätigkeiten-Stammdaten ────────────────────────────────────────────────

function TaetigkeitenStammCard() {
  const { toast } = useToast();
  const { data: list = [], isLoading } = useTaetigkeitenStamm({ onlyActive: false });
  const mut = useTaetigkeitMutation();
  const [newName, setNewName] = useState("");
  const [newBereich, setNewBereich] = useState<"baustelle" | "halle" | "beide">("baustelle");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const add = async () => {
    if (!newName.trim()) return;
    try {
      const maxSort = list.reduce((m, t) => Math.max(m, t.sort_order), 0);
      await mut.create.mutateAsync({
        bezeichnung: newName.trim(),
        sort_order: maxSort + 10,
        bereich: newBereich,
      });
      setNewName("");
      toast({ title: "Tätigkeit hinzugefügt" });
    } catch (e) {
      toast({ variant: "destructive", title: "Fehler", description: (e as Error).message });
    }
  };

  const save = async (id: string) => {
    if (!editName.trim()) return;
    try {
      await mut.update.mutateAsync({ id, bezeichnung: editName.trim() });
      setEditId(null);
      toast({ title: "Aktualisiert" });
    } catch (e) {
      toast({ variant: "destructive", title: "Fehler", description: (e as Error).message });
    }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Tätigkeit „${name}" wirklich löschen?`)) return;
    try {
      await mut.remove.mutateAsync(id);
      toast({ title: "Gelöscht" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Löschen nicht möglich",
        description:
          "Vermutlich bereits in Buchungen verwendet. Stattdessen Deaktivieren-Toggle nutzen.",
      });
    }
  };

  const toggleActive = async (id: string, current: boolean) => {
    await mut.update.mutateAsync({ id, is_active: !current });
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold">
          <Tag className="h-4 w-4 text-primary" />
          Tätigkeiten ({list.filter((t) => t.is_active).length} aktiv)
        </div>
        <div className="flex gap-2 flex-wrap">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Neue Tätigkeit, z.B. Spengler-Arbeit"
            onKeyDown={(e) => e.key === "Enter" && add()}
            className="h-10 flex-1 min-w-[180px]"
          />
          <select
            value={newBereich}
            onChange={(e) => setNewBereich(e.target.value as typeof newBereich)}
            className="h-10 px-3 rounded-md border bg-background text-sm"
            title="Wo soll diese Tätigkeit auswählbar sein?"
          >
            <option value="baustelle">Baustelle</option>
            <option value="halle">Halle</option>
            <option value="beide">Beide</option>
          </select>
          <Button onClick={add} disabled={!newName.trim() || mut.create.isPending}>
            <Plus className="h-4 w-4 mr-1.5" /> Hinzufügen
          </Button>
        </div>
        <div className="space-y-1.5">
          {isLoading && (
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Lade…
            </div>
          )}
          {list.map((t) => (
            <div
              key={t.id}
              className={`flex items-center gap-2 px-3 py-2 rounded-md border ${
                !t.is_active ? "bg-muted/40 text-muted-foreground" : "bg-card"
              }`}
            >
              {editId === t.id ? (
                <>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && save(t.id)}
                    autoFocus
                    className="flex-1 h-8"
                  />
                  <Button size="sm" onClick={() => save(t.id)} variant="default">
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex-1 text-sm">{t.bezeichnung}</div>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      t.bereich === "halle"
                        ? "border-amber-500 text-amber-800 bg-amber-50"
                        : t.bereich === "beide"
                          ? "border-violet-500 text-violet-800 bg-violet-50"
                          : "border-blue-500 text-blue-800 bg-blue-50"
                    }`}
                  >
                    {t.bereich === "halle"
                      ? "Halle"
                      : t.bereich === "beide"
                        ? "Beide"
                        : "Baustelle"}
                  </Badge>
                  {!t.is_active && (
                    <Badge variant="outline" className="text-[10px]">
                      inaktiv
                    </Badge>
                  )}
                  <Switch
                    checked={t.is_active}
                    onCheckedChange={() => toggleActive(t.id, t.is_active)}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditId(t.id);
                      setEditName(t.bezeichnung);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => remove(t.id, t.bezeichnung)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Zulagen-Stammdaten ────────────────────────────────────────────────────

function ZulagenStammCard() {
  const { toast } = useToast();
  const { data: list = [] } = useZulagenTypen({ onlyActive: false });
  const mut = useZulageMutation();
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const add = async () => {
    if (!newName.trim()) return;
    try {
      const maxSort = list.reduce((m, t) => Math.max(m, t.sort_order), 0);
      await mut.create.mutateAsync({
        bezeichnung: newName.trim(),
        sort_order: maxSort + 10,
      });
      setNewName("");
      toast({ title: "Zulage hinzugefügt" });
    } catch (e) {
      toast({ variant: "destructive", title: "Fehler", description: (e as Error).message });
    }
  };

  const save = async (id: string) => {
    if (!editName.trim()) return;
    try {
      await mut.update.mutateAsync({ id, bezeichnung: editName.trim() });
      setEditId(null);
    } catch (e) {
      toast({ variant: "destructive", title: "Fehler", description: (e as Error).message });
    }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Zulage „${name}" wirklich löschen?`)) return;
    try {
      await mut.remove.mutateAsync(id);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Löschen nicht möglich",
        description:
          "Vermutlich bereits in Buchungen verwendet. Stattdessen Deaktivieren-Toggle nutzen.",
      });
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold">
          <Clock className="h-4 w-4 text-primary" />
          Zulagen ({list.filter((z) => z.is_active).length} aktiv)
        </div>
        <p className="text-xs text-muted-foreground -mt-1">
          Welche Zulagen ein einzelner Mitarbeiter bekommen darf, wird im
          Personalanlageblatt unter „Erlaubte Zulagen" festgelegt.
        </p>
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Neue Zulage, z.B. Nässe-Zulage"
            onKeyDown={(e) => e.key === "Enter" && add()}
            className="h-10"
          />
          <Button onClick={add} disabled={!newName.trim() || mut.create.isPending}>
            <Plus className="h-4 w-4 mr-1.5" /> Hinzufügen
          </Button>
        </div>
        <div className="space-y-1.5">
          {list.map((z) => (
            <div
              key={z.id}
              className={`flex items-center gap-2 px-3 py-2 rounded-md border ${
                !z.is_active ? "bg-muted/40 text-muted-foreground" : "bg-card"
              }`}
            >
              {editId === z.id ? (
                <>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && save(z.id)}
                    autoFocus
                    className="flex-1 h-8"
                  />
                  <Button size="sm" onClick={() => save(z.id)} variant="default">
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex-1 text-sm">{z.bezeichnung}</div>
                  {!z.is_active && (
                    <Badge variant="outline" className="text-[10px]">
                      inaktiv
                    </Badge>
                  )}
                  <Switch
                    checked={z.is_active}
                    onCheckedChange={() =>
                      mut.update.mutate({ id: z.id, is_active: !z.is_active })
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditId(z.id);
                      setEditName(z.bezeichnung);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => remove(z.id, z.bezeichnung)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
