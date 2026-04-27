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
import {
  Plus,
  Edit,
  Trash2,
  Building2,
  Minus,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Send,
} from "lucide-react";
import type { Database, StundenStatus } from "@/integrations/supabase/types";

type Stunde = Database["public"]["Tables"]["stundenbuchungen"]["Row"];
type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];

const STATUS_LABEL: Record<StundenStatus, string> = {
  offen: "Offen",
  zm_freigabe: "ZM-Freigabe",
  buero_freigabe: "Büro",
  exportiert: "Exportiert",
  abgelehnt: "Abgelehnt",
};
const STATUS_COLOR: Record<StundenStatus, string> = {
  offen: "bg-blue-500",
  zm_freigabe: "bg-amber-500",
  buero_freigabe: "bg-purple-500",
  exportiert: "bg-emerald-600",
  abgelehnt: "bg-destructive",
};

const FEHLZEITEN = [
  { value: "U", label: "Urlaub", color: "#3b82f6" },
  { value: "K", label: "Krank", color: "#ef4444" },
  { value: "F", label: "Feiertag", color: "#8b5cf6" },
  { value: "SW", label: "Schlechtwetter", color: "#f59e0b" },
  { value: "S", label: "Sozialst.", color: "#10b981" },
];

export default function Stunden() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<Stunde[]>([]);
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [editing, setEditing] = useState<Partial<Stunde> | null>(null);
  const [extras, setExtras] = useState(false);

  const todayIso = () => new Date().toISOString().slice(0, 10);

  // Quick book form state
  const [date, setDate] = useState<string>(todayIso);
  const [hours, setHours] = useState<number>(8);
  const [baustelleId, setBaustelleId] = useState<string>("");
  const [taetigkeit, setTaetigkeit] = useState<string>("");
  const [fehlzeitTyp, setFehlzeitTyp] = useState<string>("");
  const [fahrstunden, setFahrstunden] = useState<number>(0);
  const [taggeldKurz, setTaggeldKurz] = useState<number>(0);
  const [taggeldLang, setTaggeldLang] = useState<number>(0);
  const [km, setKm] = useState<number>(0);
  const [notizen, setNotizen] = useState<string>("");

  const load = async () => {
    if (!user) return;
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 30);

    const [r, b] = await Promise.all([
      supabase
        .from("stundenbuchungen")
        .select("*")
        .eq("mitarbeiter_id", user.id)
        .gte("datum", fromDate.toISOString().slice(0, 10))
        .order("datum", { ascending: false }),
      profile?.partie_id
        ? supabase
            .from("baustellen")
            .select("*")
            .eq("partie_id", profile.partie_id)
            .in("status", ["aktiv", "geplant"])
            .order("bvh_name")
        : supabase
            .from("baustellen")
            .select("*")
            .in("status", ["aktiv", "geplant"])
            .order("bvh_name"),
    ]);
    setRows((r.data as Stunde[]) ?? []);
    setBaustellen((b.data as Baustelle[]) ?? []);

    // Default Baustelle: first active one of partie
    if (!baustelleId && (b.data as Baustelle[])?.length === 1) {
      setBaustelleId((b.data as Baustelle[])[0].id);
    }
  };

  useEffect(() => {
    load();
  }, [user, profile]);

  const totalsThisMonth = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    let arbeit = 0,
      fahrt = 0,
      fehl = 0;
    rows.forEach((r) => {
      if (new Date(r.datum) >= monthStart) {
        arbeit += Number(r.arbeitsstunden ?? 0);
        fahrt += Number(r.fahrstunden ?? 0);
        fehl += Number(r.fehlzeit_stunden ?? 0);
      }
    });
    return { arbeit, fahrt, fehl };
  }, [rows]);

  const moveDate = (d: number) => {
    const nd = new Date(date);
    nd.setDate(nd.getDate() + d);
    setDate(nd.toISOString().slice(0, 10));
  };

  const resetForm = () => {
    setDate(todayIso());
    setHours(8);
    setTaetigkeit("");
    setFehlzeitTyp("");
    setFahrstunden(0);
    setTaggeldKurz(0);
    setTaggeldLang(0);
    setKm(0);
    setNotizen("");
    setExtras(false);
  };

  const submit = async () => {
    if (!user) return;
    if (!fehlzeitTyp && !baustelleId) {
      toast({
        variant: "destructive",
        title: "Baustelle fehlt",
        description: "Wähle eine Baustelle oder einen Fehlzeit-Typ.",
      });
      return;
    }

    const payload = {
      mitarbeiter_id: user.id,
      datum: date,
      baustelle_id: fehlzeitTyp ? null : baustelleId || null,
      arbeitsstunden: fehlzeitTyp ? 0 : hours,
      fahrstunden: fahrstunden,
      taggeld_kurz: taggeldKurz,
      taggeld_lang: taggeldLang,
      km_gefahren: km,
      fehlzeit_typ: fehlzeitTyp || null,
      fehlzeit_stunden: fehlzeitTyp ? hours : 0,
      taetigkeit: taetigkeit || null,
      notizen: notizen || null,
      status: "offen" as StundenStatus,
    };
    const { error } = await supabase.from("stundenbuchungen").insert(payload as any);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Stunden gebucht", description: `${hours}h für ${date}` });
    resetForm();
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Buchung löschen?")) return;
    await supabase.from("stundenbuchungen").delete().eq("id", id);
    load();
  };

  const submitForApproval = async (id: string) => {
    await supabase.from("stundenbuchungen").update({ status: "zm_freigabe" }).eq("id", id);
    toast({ title: "Zur Freigabe eingereicht" });
    load();
  };

  const submitAllOpen = async () => {
    if (!user) return;
    const open = rows.filter((r) => r.status === "offen");
    if (open.length === 0) return;
    await supabase
      .from("stundenbuchungen")
      .update({ status: "zm_freigabe" })
      .eq("mitarbeiter_id", user.id)
      .eq("status", "offen");
    toast({ title: `${open.length} Buchungen eingereicht` });
    load();
  };

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <PageHeader
        title="Stundenerfassung"
        description="Erfasse deine Arbeitsstunden, Fahrtzeiten und Fehlzeiten."
      />

      {/* Quick-Book Card */}
      <Card>
        <CardContent className="p-4 space-y-4">
          {/* Datum mit Pfeilen */}
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Datum</Label>
            <div className="flex items-center gap-2 mt-1.5">
              <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={() => moveDate(-1)}>
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="text-center font-medium h-11"
              />
              <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={() => moveDate(1)}>
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex gap-1.5 mt-2">
              <Button
                size="sm"
                variant={date === todayIso() ? "default" : "outline"}
                className="flex-1"
                onClick={() => setDate(todayIso())}
              >
                Heute
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() - 1);
                  setDate(d.toISOString().slice(0, 10));
                }}
              >
                Gestern
              </Button>
            </div>
            <div className="text-xs text-muted-foreground text-center mt-1.5">
              {new Date(date).toLocaleDateString("de-AT", {
                weekday: "long",
                day: "2-digit",
                month: "long",
              })}
            </div>
          </div>

          {/* Mode: Arbeit oder Fehlzeit */}
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              {fehlzeitTyp ? "Fehlzeit" : "Baustelle"}
            </Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              <button
                onClick={() => setFehlzeitTyp("")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition ${
                  !fehlzeitTyp
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-muted"
                }`}
              >
                Arbeit
              </button>
              {FEHLZEITEN.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setFehlzeitTyp(f.value)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition ${
                    fehlzeitTyp === f.value
                      ? "text-white border-transparent"
                      : "bg-background hover:bg-muted"
                  }`}
                  style={
                    fehlzeitTyp === f.value
                      ? { background: f.color }
                      : undefined
                  }
                >
                  {f.label}
                </button>
              ))}
            </div>

            {!fehlzeitTyp && (
              <div className="mt-2">
                {baustellen.length === 0 ? (
                  <div className="text-xs text-muted-foreground p-3 bg-muted/40 rounded">
                    Aktuell keine aktiven Baustellen für deine Partie.
                  </div>
                ) : baustellen.length <= 4 ? (
                  <div className="grid gap-1.5">
                    {baustellen.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => setBaustelleId(b.id)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-md border text-left text-sm transition ${
                          baustelleId === b.id
                            ? "bg-primary/10 border-primary"
                            : "bg-background hover:bg-muted"
                        }`}
                      >
                        <Building2
                          className={`h-4 w-4 shrink-0 ${
                            baustelleId === b.id ? "text-primary" : "text-muted-foreground"
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{b.bvh_name}</div>
                          {b.kostenstelle && (
                            <div className="text-[11px] text-muted-foreground truncate">
                              {b.kostenstelle}
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <select
                    value={baustelleId}
                    onChange={(e) => setBaustelleId(e.target.value)}
                    className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="">— Baustelle wählen —</option>
                    {baustellen.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.bvh_name} {b.kostenstelle ? `· ${b.kostenstelle}` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          {/* Stunden Big Display */}
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              {fehlzeitTyp ? "Fehlzeit-Stunden" : "Arbeitsstunden"}
            </Label>
            <div className="flex items-center gap-3 mt-1.5">
              <Button
                variant="outline"
                size="icon"
                className="h-12 w-12 shrink-0"
                onClick={() => setHours(Math.max(0, hours - 0.5))}
              >
                <Minus className="h-5 w-5" />
              </Button>
              <div className="flex-1 text-center">
                <div className="text-4xl font-bold tabular-nums">
                  {hours.toFixed(1)} <span className="text-lg text-muted-foreground">h</span>
                </div>
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-12 w-12 shrink-0"
                onClick={() => setHours(hours + 0.5)}
              >
                <Plus className="h-5 w-5" />
              </Button>
            </div>
            <div className="grid grid-cols-4 gap-1.5 mt-2">
              {[4, 6, 8, 10].map((h) => (
                <Button
                  key={h}
                  className="h-10"
                  variant={hours === h ? "default" : "outline"}
                  onClick={() => setHours(h)}
                >
                  {h}h
                </Button>
              ))}
            </div>
          </div>

          {/* Tätigkeit */}
          {!fehlzeitTyp && (
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Tätigkeit (optional)
              </Label>
              <Input
                value={taetigkeit}
                onChange={(e) => setTaetigkeit(e.target.value)}
                placeholder="z.B. Wand-Elemente versetzen, Dachstuhl"
                className="mt-1.5"
              />
            </div>
          )}

          {/* Erweitert */}
          {!fehlzeitTyp && (
            <button
              onClick={() => setExtras(!extras)}
              className="text-xs text-primary hover:underline"
            >
              {extras ? "Weniger anzeigen" : "+ Fahrtzeit / Taggeld / KM"}
            </button>
          )}

          {extras && !fehlzeitTyp && (
            <div className="grid grid-cols-2 gap-2 pt-2 border-t">
              <div>
                <Label className="text-xs">Fahrstunden</Label>
                <Input
                  inputMode="decimal"
                  type="number"
                  step="0.25"
                  value={fahrstunden}
                  onChange={(e) => setFahrstunden(Number(e.target.value))}
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs">KM gefahren</Label>
                <Input
                  inputMode="numeric"
                  type="number"
                  step="1"
                  value={km}
                  onChange={(e) => setKm(Number(e.target.value))}
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs">Taggeld kurz</Label>
                <Input
                  inputMode="numeric"
                  type="number"
                  step="1"
                  value={taggeldKurz}
                  onChange={(e) => setTaggeldKurz(Number(e.target.value))}
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs">Taggeld lang</Label>
                <Input
                  inputMode="numeric"
                  type="number"
                  step="1"
                  value={taggeldLang}
                  onChange={(e) => setTaggeldLang(Number(e.target.value))}
                  className="h-9"
                />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Notizen</Label>
                <Textarea
                  value={notizen}
                  onChange={(e) => setNotizen(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
          )}

          {/* Submit */}
          <Button onClick={submit} className="w-full h-12 text-base">
            <Plus className="h-5 w-5 mr-2" /> Buchung speichern
          </Button>
        </CardContent>
      </Card>

      {/* Monat-Summary */}
      <Card>
        <CardContent className="p-3 grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-2xl font-bold tabular-nums">
              {totalsThisMonth.arbeit.toFixed(1)}
            </div>
            <div className="text-[10px] text-muted-foreground uppercase">Arbeit</div>
          </div>
          <div>
            <div className="text-2xl font-bold tabular-nums">
              {totalsThisMonth.fahrt.toFixed(1)}
            </div>
            <div className="text-[10px] text-muted-foreground uppercase">Fahrt</div>
          </div>
          <div>
            <div className="text-2xl font-bold tabular-nums">
              {totalsThisMonth.fehl.toFixed(1)}
            </div>
            <div className="text-[10px] text-muted-foreground uppercase">Fehlzeit</div>
          </div>
        </CardContent>
      </Card>

      {/* Letzte Buchungen */}
      <div>
        <div className="flex items-center justify-between mb-2 px-1">
          <h2 className="text-sm font-semibold">Letzte Buchungen</h2>
          {rows.some((r) => r.status === "offen") && (
            <Button size="sm" variant="outline" onClick={submitAllOpen}>
              <Send className="h-3.5 w-3.5 mr-1" /> Alle offenen einreichen
            </Button>
          )}
        </div>
        <div className="space-y-1.5">
          {rows.map((r) => {
            const b = baustellen.find((x) => x.id === r.baustelle_id);
            return (
              <Card key={r.id}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div
                    className={`h-9 w-9 rounded ${STATUS_COLOR[r.status]} flex items-center justify-center text-white shrink-0`}
                  >
                    <Calendar className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm">
                      <span className="font-semibold tabular-nums">
                        {new Date(r.datum).toLocaleDateString("de-AT", {
                          day: "2-digit",
                          month: "2-digit",
                        })}
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <span className="font-bold tabular-nums">
                        {Number(r.arbeitsstunden ?? r.fehlzeit_stunden ?? 0).toFixed(1)}h
                      </span>
                      {r.fehlzeit_typ && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {r.fehlzeit_typ}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {b?.bvh_name ?? (r.fehlzeit_typ ? "Fehlzeit" : "—")}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {STATUS_LABEL[r.status]}
                  </Badge>
                  {r.status === "offen" && (
                    <div className="flex shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10"
                        onClick={() => setEditing(r)}
                        aria-label="Bearbeiten"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10"
                        onClick={() => remove(r.id)}
                        aria-label="Löschen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {rows.length === 0 && (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                Noch keine Buchungen. Trag deine ersten Stunden oben ein.
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-sm sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Buchung bearbeiten</DialogTitle>
          </DialogHeader>
          {editing && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget as HTMLFormElement);
                await supabase
                  .from("stundenbuchungen")
                  .update({
                    datum: fd.get("datum") as string,
                    arbeitsstunden: Number(fd.get("h")),
                    taetigkeit: (fd.get("t") as string) || null,
                  })
                  .eq("id", editing.id!);
                toast({ title: "Aktualisiert" });
                setEditing(null);
                load();
              }}
              className="space-y-3"
            >
              <div>
                <Label>Datum</Label>
                <Input type="date" name="datum" defaultValue={editing.datum} required />
              </div>
              <div>
                <Label>Stunden</Label>
                <Input
                  inputMode="decimal"
                  type="number"
                  step="0.25"
                  name="h"
                  defaultValue={editing.arbeitsstunden ?? 0}
                  required
                />
              </div>
              <div>
                <Label>Tätigkeit</Label>
                <Input name="t" defaultValue={editing.taetigkeit ?? ""} />
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
    </div>
  );
}
