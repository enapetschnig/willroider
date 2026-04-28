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
import { Switch } from "@/components/ui/switch";
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
  Users,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { Database, StundenStatus } from "@/integrations/supabase/types";

type Stunde = Database["public"]["Tables"]["stundenbuchungen"]["Row"];
type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];

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
];

const initials = (p: { vorname: string; nachname: string }) =>
  `${p.vorname[0] ?? ""}${p.nachname[0] ?? ""}`.toUpperCase();

type Mode = "self" | "polier" | "admin";

// ─── Time helpers ───
function timeToMin(t: string | null | undefined): number {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function calcArbeitsstunden(
  start: string | null | undefined,
  end: string | null | undefined,
  pauseVon: string | null | undefined,
  pauseBis: string | null | undefined
): number {
  if (!start || !end) return 0;
  const s = timeToMin(start);
  const e = timeToMin(end);
  if (e <= s) return 0;
  let total = e - s;
  if (pauseVon && pauseBis) {
    const pv = timeToMin(pauseVon);
    const pb = timeToMin(pauseBis);
    if (pb > pv) {
      const overlap = Math.max(0, Math.min(e, pb) - Math.max(s, pv));
      total -= overlap;
    }
  }
  return Math.max(0, total) / 60;
}
const fmtTime = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");
const fmtH = (n: number) => `${n.toFixed(2).replace(".", ",")} h`;

const DEFAULT_START = "07:00";
const DEFAULT_END = "15:30";
const DEFAULT_PAUSE_VON = "12:00";
const DEFAULT_PAUSE_BIS = "12:30";

export default function Stunden() {
  const { user, profile, isAdmin } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<Stunde[]>([]);
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [editing, setEditing] = useState<Partial<Stunde> | null>(null);
  const [extras, setExtras] = useState(false);

  const [polierPartie, setPolierPartie] = useState<Partie | null>(null);
  const [allMembers, setAllMembers] = useState<Profile[]>([]);
  const [allPartien, setAllPartien] = useState<Partie[]>([]);
  const [forUserId, setForUserId] = useState<string>("");
  const [memberSearch, setMemberSearch] = useState<string>("");

  const todayIso = () => new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState<string>(todayIso);

  // Time-Range State (Arbeit-Mode)
  const [startZeit, setStartZeit] = useState<string>(DEFAULT_START);
  const [endZeit, setEndZeit] = useState<string>(DEFAULT_END);
  const [hasPause, setHasPause] = useState<boolean>(true);
  const [pauseVon, setPauseVon] = useState<string>(DEFAULT_PAUSE_VON);
  const [pauseBis, setPauseBis] = useState<string>(DEFAULT_PAUSE_BIS);

  // Fehlzeit-Mode hours
  const [fehlzeitHours, setFehlzeitHours] = useState<number>(8);

  const [baustelleId, setBaustelleId] = useState<string>("");
  const [taetigkeit, setTaetigkeit] = useState<string>("");
  const [fehlzeitTyp, setFehlzeitTyp] = useState<string>("");
  const [fahrstunden, setFahrstunden] = useState<number>(0);
  const [taggeldKurz, setTaggeldKurz] = useState<number>(0);
  const [taggeldLang, setTaggeldLang] = useState<number>(0);
  const [km, setKm] = useState<number>(0);
  const [notizen, setNotizen] = useState<string>("");

  const mode: Mode = isAdmin ? "admin" : polierPartie ? "polier" : "self";
  const hasPicker = mode !== "self";

  const arbeitstundenLive = useMemo(
    () =>
      calcArbeitsstunden(
        startZeit,
        endZeit,
        hasPause ? pauseVon : null,
        hasPause ? pauseBis : null
      ),
    [startZeit, endZeit, hasPause, pauseVon, pauseBis]
  );

  // ─── Detektion Modus ───
  useEffect(() => {
    if (!user) return;
    (async () => {
      if (isAdmin) {
        const [{ data: members }, { data: partien }] = await Promise.all([
          supabase.from("profiles").select("*").eq("is_active", true).order("nachname"),
          supabase.from("partien").select("*").order("name"),
        ]);
        setAllMembers((members as Profile[]) ?? []);
        setAllPartien((partien as Partie[]) ?? []);
        setPolierPartie(null);
        setForUserId(user.id);
        return;
      }
      const { data: p } = await supabase
        .from("partien")
        .select("*")
        .eq("partieleiter_id", user.id)
        .maybeSingle();
      if (!p) {
        setPolierPartie(null);
        setAllMembers([]);
        setForUserId(user.id);
        return;
      }
      setPolierPartie(p as Partie);
      setAllPartien([p as Partie]);
      const { data: members } = await supabase
        .from("profiles")
        .select("*")
        .eq("partie_id", p.id)
        .eq("is_active", true)
        .order("nachname");
      setAllMembers((members as Profile[]) ?? []);
      setForUserId(user.id);
    })();
  }, [user, isAdmin]);

  // ─── Daten laden: Buchungen + Baustellen ───
  const load = async () => {
    if (!user) return;
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 30);
    const fromIso = fromDate.toISOString().slice(0, 10);

    let stundenQuery = supabase
      .from("stundenbuchungen")
      .select("*")
      .gte("datum", fromIso)
      .order("datum", { ascending: false })
      .order("start_zeit", { ascending: true })
      .limit(500);

    if (mode === "admin") {
      // alle Buchungen
    } else if (mode === "polier" && allMembers.length > 0) {
      const ids = [user.id, ...allMembers.map((m) => m.id)];
      stundenQuery = stundenQuery.in("mitarbeiter_id", Array.from(new Set(ids)));
    } else {
      stundenQuery = stundenQuery.eq("mitarbeiter_id", user.id);
    }

    const partieFilter =
      mode === "admin"
        ? null
        : mode === "polier"
        ? polierPartie?.id ?? null
        : profile?.partie_id ?? null;

    const [r, b] = await Promise.all([
      stundenQuery,
      partieFilter
        ? supabase
            .from("baustellen")
            .select("*")
            .eq("partie_id", partieFilter)
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

    if (!baustelleId && (b.data as Baustelle[])?.length === 1) {
      setBaustelleId((b.data as Baustelle[])[0].id);
    }
  };

  useEffect(() => {
    load();
  }, [user, profile, polierPartie, allMembers]);

  // ─── Tagesstatus pro Person für aktuelles Datum ───
  const statusForDate = useMemo(() => {
    const map = new Map<string, { hours: number; rows: Stunde[] }>();
    rows
      .filter((r) => r.datum === date)
      .forEach((r) => {
        const cur = map.get(r.mitarbeiter_id) ?? { hours: 0, rows: [] };
        cur.hours += Number(r.arbeitsstunden ?? r.fehlzeit_stunden ?? 0);
        cur.rows.push(r);
        map.set(r.mitarbeiter_id, cur);
      });
    return map;
  }, [rows, date]);

  const todayBlocks = useMemo(() => {
    return rows.filter((r) => r.mitarbeiter_id === forUserId && r.datum === date);
  }, [rows, forUserId, date]);

  const todayTotalH = todayBlocks.reduce(
    (s, r) => s + Number(r.arbeitsstunden ?? r.fehlzeit_stunden ?? 0),
    0
  );

  // ─── Doppel-Buchung-Warnung (nur Arbeit + gleiche Baustelle) ───
  const existingForCurrent = useMemo(() => {
    if (fehlzeitTyp || !baustelleId) return null;
    return todayBlocks.find((r) => r.baustelle_id === baustelleId);
  }, [todayBlocks, baustelleId, fehlzeitTyp]);

  const moveDate = (d: number) => {
    const nd = new Date(date);
    nd.setDate(nd.getDate() + d);
    setDate(nd.toISOString().slice(0, 10));
  };

  const resetTimeFields = () => {
    setStartZeit(DEFAULT_START);
    setEndZeit(DEFAULT_END);
    setHasPause(true);
    setPauseVon(DEFAULT_PAUSE_VON);
    setPauseBis(DEFAULT_PAUSE_BIS);
  };

  const fullReset = () => {
    resetTimeFields();
    setFehlzeitHours(8);
    setBaustelleId("");
    setTaetigkeit("");
    setFehlzeitTyp("");
    setFahrstunden(0);
    setTaggeldKurz(0);
    setTaggeldLang(0);
    setKm(0);
    setNotizen("");
    setExtras(false);
  };

  const partialResetForNextBaustelle = (lastBlock?: Stunde) => {
    setBaustelleId("");
    setTaetigkeit("");
    setFahrstunden(0);
    setTaggeldKurz(0);
    setTaggeldLang(0);
    setKm(0);
    setNotizen("");
    setExtras(false);
    if (lastBlock?.end_zeit) {
      // Nahtloser Anschluss: Start = vorheriges Ende
      setStartZeit(fmtTime(lastBlock.end_zeit) || DEFAULT_START);
      // Standard: 8.5h Fenster
      const startMin = timeToMin(fmtTime(lastBlock.end_zeit));
      setEndZeit(minToTime(startMin + 8 * 60 + 30));
      setHasPause(false); // Pause war ja schon im ersten Block
    } else {
      resetTimeFields();
    }
  };

  const submit = async (continueFlag: boolean) => {
    if (!user || !forUserId) return;

    const isFehlzeit = !!fehlzeitTyp;

    if (!isFehlzeit && !baustelleId) {
      toast({
        variant: "destructive",
        title: "Baustelle fehlt",
        description: "Wähle eine Baustelle oder einen Fehlzeit-Typ.",
      });
      return;
    }

    let arbeit = 0;
    if (!isFehlzeit) {
      if (timeToMin(endZeit) <= timeToMin(startZeit)) {
        toast({ variant: "destructive", title: "Endzeit muss nach Startzeit liegen." });
        return;
      }
      if (hasPause) {
        const pv = timeToMin(pauseVon);
        const pb = timeToMin(pauseBis);
        if (pb <= pv) {
          toast({ variant: "destructive", title: "Pause-Ende muss nach Pause-Beginn liegen." });
          return;
        }
      }
      arbeit = calcArbeitsstunden(
        startZeit,
        endZeit,
        hasPause ? pauseVon : null,
        hasPause ? pauseBis : null
      );
      if (arbeit <= 0) {
        toast({ variant: "destructive", title: "Arbeitszeit ist 0 — bitte prüfen." });
        return;
      }
    }

    if (existingForCurrent) {
      const personLabel =
        forUserId === user.id
          ? "dich"
          : allMembers.find((m) => m.id === forUserId)?.vorname ?? "diese Person";
      const ok = window.confirm(
        `Für ${personLabel} ist auf dieser Baustelle am ${new Date(date).toLocaleDateString(
          "de-AT"
        )} bereits ${Number(existingForCurrent.arbeitsstunden ?? 0).toFixed(
          2
        )}h gebucht. Trotzdem zusätzliche Buchung anlegen?`
      );
      if (!ok) return;
    }

    const payload: any = {
      mitarbeiter_id: forUserId,
      datum: date,
      baustelle_id: isFehlzeit ? null : baustelleId || null,
      start_zeit: isFehlzeit ? null : startZeit,
      end_zeit: isFehlzeit ? null : endZeit,
      pause_von: !isFehlzeit && hasPause ? pauseVon : null,
      pause_bis: !isFehlzeit && hasPause ? pauseBis : null,
      arbeitsstunden: isFehlzeit ? 0 : arbeit,
      fahrstunden,
      taggeld_kurz: taggeldKurz,
      taggeld_lang: taggeldLang,
      km_gefahren: km,
      fehlzeit_typ: fehlzeitTyp || null,
      fehlzeit_stunden: isFehlzeit ? fehlzeitHours : 0,
      taetigkeit: taetigkeit || null,
      notizen: notizen || null,
      status: "offen" as StundenStatus,
    };
    const { data: inserted, error } = await supabase
      .from("stundenbuchungen")
      .insert(payload)
      .select()
      .single();
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({
      title: continueFlag ? "Block gespeichert – nächste Baustelle" : "Buchung gespeichert",
      description: isFehlzeit
        ? `${fehlzeitHours}h ${fehlzeitTyp}`
        : `${arbeit.toFixed(2)}h · ${fmtTime(startZeit)}–${fmtTime(endZeit)}`,
    });

    if (continueFlag && !isFehlzeit) {
      partialResetForNextBaustelle(inserted as Stunde);
    } else {
      fullReset();
    }
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Buchung löschen?")) return;
    await supabase.from("stundenbuchungen").delete().eq("id", id);
    load();
  };

  const submitAllOpen = async () => {
    if (!user) return;
    const open = rows.filter((r) => r.status === "offen");
    if (open.length === 0) return;
    const ids = open.map((r) => r.id);
    await supabase.from("stundenbuchungen").update({ status: "zm_freigabe" }).in("id", ids);
    toast({ title: `${open.length} Buchung${open.length === 1 ? "" : "en"} eingereicht` });
    load();
  };

  // ─── Personen-Lookup für Listen ───
  const personById = useMemo(() => {
    const map = new Map<string, Profile>();
    allMembers.forEach((m) => map.set(m.id, m));
    if (profile && user) {
      map.set(user.id, { ...(profile as any), id: user.id });
    }
    return map;
  }, [allMembers, profile, user]);

  const focusPerson = (uid: string) => {
    setForUserId(uid);
    fullReset();
  };

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <PageHeader title="Stundenerfassung" />

      <div className="space-y-4">
          {hasPicker && (
            <PersonPicker
              mode={mode}
              partie={polierPartie}
              partien={allPartien}
              members={allMembers}
              forUserId={forUserId}
              onPick={focusPerson}
              ownUserId={user!.id}
              ownProfile={profile as any}
              statusForDate={statusForDate}
              search={memberSearch}
              onSearchChange={setMemberSearch}
              date={date}
            />
          )}

          {/* Datum + Tagesliste oben */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Datum
                </Label>
                <div className="flex items-center gap-2 mt-1.5">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    onClick={() => moveDate(-1)}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="text-center font-medium h-11"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    onClick={() => moveDate(1)}
                  >
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

              {/* Bereits gebucht heute */}
              {todayBlocks.length > 0 && (
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Schon gebucht
                    </Label>
                    <span className="text-xs font-bold tabular-nums">Σ {fmtH(todayTotalH)}</span>
                  </div>
                  <div className="space-y-1">
                    {todayBlocks.map((r) => {
                      const b = baustellen.find((x) => x.id === r.baustelle_id);
                      return (
                        <div
                          key={r.id}
                          className="flex items-center gap-2 text-xs bg-muted/40 rounded px-2 py-1.5"
                        >
                          <span className="font-bold tabular-nums shrink-0">
                            {Number(r.arbeitsstunden ?? r.fehlzeit_stunden ?? 0)
                              .toFixed(2)
                              .replace(".", ",")}h
                          </span>
                          {r.start_zeit && r.end_zeit && (
                            <span className="text-muted-foreground tabular-nums shrink-0">
                              {fmtTime(r.start_zeit)}–{fmtTime(r.end_zeit)}
                            </span>
                          )}
                          <span className="truncate flex-1">
                            {r.fehlzeit_typ
                              ? `Fehlzeit ${r.fehlzeit_typ}`
                              : b?.bvh_name ?? "—"}
                          </span>
                          {r.status === "offen" && (
                            <button
                              onClick={() => remove(r.id)}
                              className="text-muted-foreground hover:text-destructive shrink-0"
                              aria-label="Löschen"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Doppel-Buchung-Warnung */}
          {existingForCurrent && (
            <Card className="border-amber-400 bg-amber-50">
              <CardContent className="p-3 flex items-start gap-2 text-xs">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <strong>Diese Baustelle hat heute schon eine Buchung</strong> (
                  {Number(existingForCurrent.arbeitsstunden ?? 0).toFixed(2)}h). Eine zusätzliche
                  Buchung wird beim Speichern nochmal abgefragt.
                </div>
              </CardContent>
            </Card>
          )}

          {/* Quick-Book Card */}
          <Card>
            <CardContent className="p-4 space-y-4">
              {/* Mode: Arbeit / Fehlzeit */}
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
                      style={fehlzeitTyp === f.value ? { background: f.color } : undefined}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Baustellen-Auswahl */}
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

              {/* Arbeit-Mode: Time-Range */}
              {!fehlzeitTyp && (
                <div className="space-y-3 border-t pt-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                        Startzeit
                      </Label>
                      <Input
                        type="time"
                        value={startZeit}
                        onChange={(e) => setStartZeit(e.target.value)}
                        className="h-11 text-center font-semibold"
                      />
                    </div>
                    <div>
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                        Endzeit
                      </Label>
                      <Input
                        type="time"
                        value={endZeit}
                        onChange={(e) => setEndZeit(e.target.value)}
                        className="h-11 text-center font-semibold"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <Switch checked={hasPause} onCheckedChange={setHasPause} id="has_pause" />
                    <Label htmlFor="has_pause" className="text-sm cursor-pointer">
                      Pause angeben
                    </Label>
                  </div>

                  {hasPause && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                          Pause von
                        </Label>
                        <Input
                          type="time"
                          value={pauseVon}
                          onChange={(e) => setPauseVon(e.target.value)}
                          className="h-10 text-center"
                        />
                      </div>
                      <div>
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                          Pause bis
                        </Label>
                        <Input
                          type="time"
                          value={pauseBis}
                          onChange={(e) => setPauseBis(e.target.value)}
                          className="h-10 text-center"
                        />
                      </div>
                    </div>
                  )}

                  {/* Live-Arbeitszeit */}
                  <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 flex items-center gap-3">
                    <Clock className="h-5 w-5 text-primary" />
                    <div className="flex-1">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Arbeitszeit
                      </div>
                      <div className="text-2xl font-bold tabular-nums text-primary">
                        {fmtH(arbeitstundenLive)}
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground text-right">
                      {fmtTime(startZeit)}–{fmtTime(endZeit)}
                      {hasPause && (
                        <>
                          <br />
                          Pause {fmtTime(pauseVon)}–{fmtTime(pauseBis)}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Fehlzeit-Mode: Stunden-Picker */}
              {fehlzeitTyp && (
                <div className="border-t pt-3">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Fehlzeit-Stunden
                  </Label>
                  <div className="flex items-center gap-3 mt-1.5">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-12 w-12 shrink-0"
                      onClick={() => setFehlzeitHours(Math.max(0, fehlzeitHours - 0.5))}
                    >
                      <Minus className="h-5 w-5" />
                    </Button>
                    <div className="flex-1 text-center">
                      <div className="text-4xl font-bold tabular-nums">
                        {fehlzeitHours.toFixed(1)}{" "}
                        <span className="text-lg text-muted-foreground">h</span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-12 w-12 shrink-0"
                      onClick={() => setFehlzeitHours(fehlzeitHours + 0.5)}
                    >
                      <Plus className="h-5 w-5" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 mt-2">
                    {[4, 6, 8, 10].map((h) => (
                      <Button
                        key={h}
                        className="h-10"
                        variant={fehlzeitHours === h ? "default" : "outline"}
                        onClick={() => setFehlzeitHours(h)}
                      >
                        {h}h
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* Tätigkeit */}
              {!fehlzeitTyp && (
                <div>
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Tätigkeit (optional)
                  </Label>
                  <Input
                    value={taetigkeit}
                    onChange={(e) => setTaetigkeit(e.target.value)}
                    placeholder="z.B. Wand-Elemente versetzen"
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

              {/* Submit-Buttons */}
              <div className="flex flex-col sm:flex-row gap-2">
                <Button onClick={() => submit(false)} className="flex-1 h-12 text-base">
                  <Plus className="h-5 w-5 mr-2" /> Speichern
                </Button>
                {!fehlzeitTyp && (
                  <Button
                    onClick={() => submit(true)}
                    variant="outline"
                    className="flex-1 h-12"
                  >
                    + weitere Baustelle
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Letzte Buchungen */}
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <h2 className="text-sm font-semibold">
                {mode === "admin"
                  ? "Alle Buchungen (letzte 30 Tage)"
                  : mode === "polier"
                  ? "Buchungen meiner Partie"
                  : "Meine Buchungen"}
              </h2>
              {rows.some((r) => r.status === "offen" && r.mitarbeiter_id === user?.id) && (
                <Button size="sm" variant="outline" onClick={submitAllOpen}>
                  <Send className="h-3.5 w-3.5 mr-1" /> Alle offenen einreichen
                </Button>
              )}
            </div>
            <div className="space-y-1.5">
              {rows.map((r) => (
                <BuchungCard
                  key={r.id}
                  r={r}
                  baustelle={baustellen.find((x) => x.id === r.baustelle_id)}
                  person={personById.get(r.mitarbeiter_id)}
                  ownUserId={user!.id}
                  hasPicker={hasPicker}
                  partieFarbe={polierPartie?.farbcode}
                  onEdit={() => setEditing(r)}
                  onDelete={() => remove(r.id)}
                />
              ))}
              {rows.length === 0 && (
                <Card>
                  <CardContent className="p-6 text-center text-sm text-muted-foreground">
                    <CheckCircle2 className="h-6 w-6 mx-auto mb-2 opacity-50" />
                    Noch keine Buchungen. Trag deine ersten Stunden oben ein.
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-sm sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Buchung bearbeiten</DialogTitle>
          </DialogHeader>
          {editing && <EditForm row={editing as Stunde} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ════════════════════════════ Sub-Components ════════════════════════════

function BuchungCard({
  r,
  baustelle,
  person,
  ownUserId,
  hasPicker,
  partieFarbe,
  onEdit,
  onDelete,
}: {
  r: Stunde;
  baustelle?: Baustelle;
  person?: Profile;
  ownUserId: string;
  hasPicker: boolean;
  partieFarbe?: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const ownEntry = r.mitarbeiter_id === ownUserId;
  const canEdit = r.status === "offen" && (ownEntry || hasPicker);
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div
          className={`h-9 w-9 rounded ${STATUS_COLOR[r.status]} flex items-center justify-center text-white shrink-0`}
        >
          <Calendar className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm flex-wrap">
            <span className="font-semibold tabular-nums">
              {new Date(r.datum).toLocaleDateString("de-AT", {
                day: "2-digit",
                month: "2-digit",
              })}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="font-bold tabular-nums">
              {Number(r.arbeitsstunden ?? r.fehlzeit_stunden ?? 0)
                .toFixed(2)
                .replace(".", ",")}h
            </span>
            {r.start_zeit && r.end_zeit && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {fmtTime(r.start_zeit)}–{fmtTime(r.end_zeit)}
              </span>
            )}
            {r.fehlzeit_typ && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {r.fehlzeit_typ}
              </Badge>
            )}
            {hasPicker && person && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0"
                style={partieFarbe ? { borderColor: partieFarbe, color: partieFarbe } : undefined}
              >
                {ownEntry ? "Ich" : `${person.vorname} ${person.nachname[0]}.`}
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {baustelle?.bvh_name ?? (r.fehlzeit_typ ? "Fehlzeit" : "—")}
            {r.taetigkeit && ` · ${r.taetigkeit}`}
          </div>
        </div>
        <Badge variant="outline" className="text-xs shrink-0">
          {STATUS_LABEL[r.status]}
        </Badge>
        {canEdit && (
          <div className="flex shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              onClick={onEdit}
              aria-label="Bearbeiten"
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              onClick={onDelete}
              aria-label="Löschen"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


// ─── Edit-Form ───
function EditForm({
  row,
  onClose,
  onSaved,
}: {
  row: Stunde;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const hasTimes = !!row.start_zeit && !!row.end_zeit;
  const [datum, setDatum] = useState<string>(row.datum);
  const [startZeit, setStartZeit] = useState<string>(fmtTime(row.start_zeit) || DEFAULT_START);
  const [endZeit, setEndZeit] = useState<string>(fmtTime(row.end_zeit) || DEFAULT_END);
  const [hasPause, setHasPause] = useState<boolean>(!!row.pause_von && !!row.pause_bis);
  const [pauseVon, setPauseVon] = useState<string>(fmtTime(row.pause_von) || DEFAULT_PAUSE_VON);
  const [pauseBis, setPauseBis] = useState<string>(fmtTime(row.pause_bis) || DEFAULT_PAUSE_BIS);
  const [hours, setHours] = useState<number>(
    Number(row.arbeitsstunden ?? row.fehlzeit_stunden ?? 0)
  );
  const [taetigkeit, setTaetigkeit] = useState<string>(row.taetigkeit ?? "");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const update: any = { datum, taetigkeit: taetigkeit || null };
    if (row.fehlzeit_typ) {
      update.fehlzeit_stunden = hours;
    } else if (hasTimes || (startZeit && endZeit)) {
      const arbeit = calcArbeitsstunden(
        startZeit,
        endZeit,
        hasPause ? pauseVon : null,
        hasPause ? pauseBis : null
      );
      update.start_zeit = startZeit;
      update.end_zeit = endZeit;
      update.pause_von = hasPause ? pauseVon : null;
      update.pause_bis = hasPause ? pauseBis : null;
      update.arbeitsstunden = arbeit;
    } else {
      update.arbeitsstunden = hours;
    }
    const { error } = await supabase
      .from("stundenbuchungen")
      .update(update)
      .eq("id", row.id!);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Aktualisiert" });
    onSaved();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label>Datum</Label>
        <Input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} required />
      </div>
      {row.fehlzeit_typ ? (
        <div>
          <Label>Stunden ({row.fehlzeit_typ})</Label>
          <Input
            inputMode="decimal"
            type="number"
            step="0.25"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            required
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Start</Label>
              <Input
                type="time"
                value={startZeit}
                onChange={(e) => setStartZeit(e.target.value)}
              />
            </div>
            <div>
              <Label>Ende</Label>
              <Input
                type="time"
                value={endZeit}
                onChange={(e) => setEndZeit(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={hasPause} onCheckedChange={setHasPause} />
            <Label>Pause</Label>
          </div>
          {hasPause && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Pause von</Label>
                <Input
                  type="time"
                  value={pauseVon}
                  onChange={(e) => setPauseVon(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Pause bis</Label>
                <Input
                  type="time"
                  value={pauseBis}
                  onChange={(e) => setPauseBis(e.target.value)}
                />
              </div>
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Berechnete Arbeitszeit:{" "}
            <strong>
              {fmtH(
                calcArbeitsstunden(
                  startZeit,
                  endZeit,
                  hasPause ? pauseVon : null,
                  hasPause ? pauseBis : null
                )
              )}
            </strong>
          </div>
        </>
      )}
      <div>
        <Label>Tätigkeit</Label>
        <Input value={taetigkeit} onChange={(e) => setTaetigkeit(e.target.value)} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Abbrechen
        </Button>
        <Button type="submit">Speichern</Button>
      </DialogFooter>
    </form>
  );
}

// ─── PersonPicker ───
function PersonPicker({
  mode,
  partie,
  partien,
  members,
  forUserId,
  onPick,
  ownUserId,
  ownProfile,
  statusForDate,
  search,
  onSearchChange,
  date,
}: {
  mode: Mode;
  partie: Partie | null;
  partien: Partie[];
  members: Profile[];
  forUserId: string;
  onPick: (id: string) => void;
  ownUserId: string;
  ownProfile: Profile | null;
  statusForDate: Map<string, { hours: number }>;
  search: string;
  onSearchChange: (s: string) => void;
  date: string;
}) {
  const isAdmin = mode === "admin";

  const filteredMembers = members.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.vorname.toLowerCase().includes(q) ||
      m.nachname.toLowerCase().includes(q) ||
      (m.pers_nr ?? "").toLowerCase().includes(q)
    );
  });

  const grouped = (() => {
    if (!isAdmin) return null;
    const map = new Map<string | "ohne", { partie: Partie | null; rows: Profile[] }>();
    filteredMembers.forEach((m) => {
      const key = m.partie_id ?? "ohne";
      if (!map.has(key)) {
        map.set(key, {
          partie: m.partie_id ? partien.find((p) => p.id === m.partie_id) ?? null : null,
          rows: [],
        });
      }
      map.get(key)!.rows.push(m);
    });
    return [...map.values()].sort((a, b) =>
      (a.partie?.name ?? "ZZ").localeCompare(b.partie?.name ?? "ZZ")
    );
  })();

  const focused =
    forUserId === ownUserId
      ? "dich"
      : (() => {
          const m = members.find((x) => x.id === forUserId);
          return m ? `${m.vorname} ${m.nachname}` : "?";
        })();

  const renderPill = (m: Profile, color: string) => {
    const s = statusForDate.get(m.id);
    const active = forUserId === m.id;
    return (
      <button
        key={m.id}
        onClick={() => onPick(m.id)}
        className={`px-2.5 py-1.5 rounded-full text-xs font-medium border transition flex items-center gap-1.5 shrink-0 ${
          active
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-background hover:bg-muted"
        }`}
      >
        <span
          className="h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
          style={{ background: color }}
        >
          {initials(m)}
        </span>
        <span className="truncate max-w-[100px]">
          {m.vorname} {m.nachname[0]}.
        </span>
        {s ? (
          <span
            className={`text-[10px] tabular-nums ${
              active ? "opacity-90" : "text-emerald-600 font-semibold"
            }`}
          >
            {s.hours.toFixed(1)}h
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">—</span>
        )}
      </button>
    );
  };

  return (
    <Card className="border-primary/30">
      <CardContent className="p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Users className="h-4 w-4 text-primary shrink-0" />
          <span className="font-semibold uppercase tracking-wide">
            {isAdmin ? "Admin" : `Polier · ${partie?.name ?? ""}`}
          </span>
          <span className="ml-auto text-muted-foreground">
            Buche für <strong className="text-foreground">{focused}</strong>
          </span>
        </div>

        {isAdmin && members.length > 6 && (
          <Input
            placeholder="Mitarbeiter suchen…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-9"
          />
        )}

        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => onPick(ownUserId)}
            className={`px-2.5 py-1.5 rounded-full text-xs font-medium border transition flex items-center gap-1.5 ${
              forUserId === ownUserId
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-muted"
            }`}
          >
            <span className="h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white bg-primary">
              {ownProfile ? initials(ownProfile) : "ME"}
            </span>
            Mich
            {(() => {
              const s = statusForDate.get(ownUserId);
              if (!s) return null;
              return (
                <span className="text-[10px] opacity-70 tabular-nums">{s.hours.toFixed(1)}h</span>
              );
            })()}
          </button>
        </div>

        {!isAdmin && (
          <div className="flex flex-wrap gap-1.5">
            {filteredMembers
              .filter((m) => m.id !== ownUserId)
              .map((m) => renderPill(m, partie?.farbcode ?? "#999"))}
          </div>
        )}

        {isAdmin && grouped && (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {grouped.map((g) => {
              const rows = g.rows.filter((m) => m.id !== ownUserId);
              if (rows.length === 0) return null;
              const color = g.partie?.farbcode ?? "#999";
              return (
                <div key={g.partie?.id ?? "ohne"}>
                  <div
                    className="text-[10px] uppercase tracking-wide font-semibold mb-1 flex items-center gap-1.5"
                    style={{ color }}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                    {g.partie?.name ?? "Ohne Partie"}
                    <span className="opacity-60 font-normal">({rows.length})</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {rows.map((m) => renderPill(m, color))}
                  </div>
                </div>
              );
            })}
            {grouped.every((g) => g.rows.filter((m) => m.id !== ownUserId).length === 0) && (
              <div className="text-xs text-muted-foreground italic">
                {search ? "Niemand passt zur Suche." : "Keine aktiven Mitarbeiter."}
              </div>
            )}
          </div>
        )}

        <div className="text-[11px] text-muted-foreground">
          Tippe eine Person an, um ihre Stunden für{" "}
          {new Date(date).toLocaleDateString("de-AT")} einzugeben.
        </div>
      </CardContent>
    </Card>
  );
}
