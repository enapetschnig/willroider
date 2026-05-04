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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
  Users,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ChevronDown,
  Check,
  Factory,
  MapPin,
} from "lucide-react";
import type { Database, StundenStatus } from "@/integrations/supabase/types";
import { feiertagAt } from "@/lib/feiertage";
import { ZULAGEN, type ZulageTyp } from "@/lib/zulagen";

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
  { value: "SW", label: "Schlechtwetter", color: "#f59e0b" },
  // F (Feiertag) wird automatisch aus dem Feiertagskalender ermittelt — kein manueller Eintrag.
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

// Auf nächste 15 Min runden
function snap15(t: string): string {
  if (!t) return t;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return t;
  const total = h * 60 + m;
  const rounded = Math.round(total / 15) * 15;
  const clamped = Math.max(0, Math.min(23 * 60 + 45, rounded));
  return minToTime(clamped);
}
function shiftTime(t: string, deltaMin: number): string {
  const cur = timeToMin(t);
  const next = Math.max(0, Math.min(23 * 60 + 45, cur + deltaMin));
  return minToTime(next);
}
// Überlappung in Minuten (für Konflikt-Erkennung)
function overlapMin(
  aS: string | null | undefined,
  aE: string | null | undefined,
  bS: string | null | undefined,
  bE: string | null | undefined
): number {
  if (!aS || !aE || !bS || !bE) return 0;
  const aSm = timeToMin(aS),
    aEm = timeToMin(aE),
    bSm = timeToMin(bS),
    bEm = timeToMin(bE);
  return Math.max(0, Math.min(aEm, bEm) - Math.max(aSm, bSm));
}

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
  const [forUserIds, setForUserIds] = useState<Set<string>>(new Set());
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
  const [inFirma, setInFirma] = useState<boolean>(false); // Arbeit in der Firma → keine Diäten
  const [continuationOf, setContinuationOf] = useState<{
    bvhName: string | null;
    endZeit: string;
  } | null>(null); // gesetzt wenn nach +Weitere Baustelle
  const [fahrstunden, setFahrstunden] = useState<number>(0);
  const [taggeldKurz, setTaggeldKurz] = useState<number>(0);
  const [taggeldLang, setTaggeldLang] = useState<number>(0);
  const [km, setKm] = useState<number>(0);
  const [notizen, setNotizen] = useState<string>("");
  const [zulageTyp, setZulageTyp] = useState<ZulageTyp | "">("");
  const [zulageStunden, setZulageStunden] = useState<number>(0);
  const [zulageNotiz, setZulageNotiz] = useState<string>("");

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
        setForUserIds(new Set([user.id]));
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
        setForUserIds(new Set([user.id]));
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
      setForUserIds(new Set([user.id]));
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
    const blist = (b.data as Baustelle[]) ?? [];
    setBaustellen(blist);

    // URL-Query ?baustelle=ID → vorausgewählt setzen (z.B. von der Heute-Card)
    const urlParams = new URLSearchParams(window.location.search);
    const fromUrl = urlParams.get("baustelle");
    if (fromUrl && blist.some((x) => x.id === fromUrl)) {
      setBaustelleId(fromUrl);
    } else if (!baustelleId && blist.length === 1) {
      setBaustelleId(blist[0].id);
    }
  };

  useEffect(() => {
    load();
  }, [user, profile, polierPartie, allMembers]);

  // ─── Tagesstatus pro Person für aktuelles Datum ───
  // Primärer User für Status-Anzeigen (eigener User wenn dabei, sonst erster)
  const primaryUserId = useMemo(() => {
    if (!user) return "";
    if (forUserIds.has(user.id)) return user.id;
    return Array.from(forUserIds)[0] ?? user.id;
  }, [forUserIds, user]);

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
    return rows.filter((r) => r.mitarbeiter_id === primaryUserId && r.datum === date);
  }, [rows, primaryUserId, date]);

  const todayTotalH = todayBlocks.reduce(
    (s, r) => s + Number(r.arbeitsstunden ?? r.fehlzeit_stunden ?? 0),
    0
  );

  // Pause: pro Tag nur einmal (vom Lohn her). Wenn der primäre User heute
  // irgendwo eine Buchung mit pause_von/bis hat, wird der Pause-Toggle gesperrt.
  const pauseAlreadyBookedToday = useMemo(() => {
    const blockWithPause = todayBlocks.find((r) => r.pause_von && r.pause_bis);
    if (!blockWithPause) return null;
    return {
      von: fmtTime(blockWithPause.pause_von),
      bis: fmtTime(blockWithPause.pause_bis),
    };
  }, [todayBlocks]);

  // Pause-Toggle automatisch ausschalten, wenn am Tag schon eine gebucht wurde
  useEffect(() => {
    if (pauseAlreadyBookedToday && hasPause) setHasPause(false);
  }, [pauseAlreadyBookedToday]);

  // Continuation-State zurücksetzen, wenn Datum oder primärer User wechselt
  useEffect(() => {
    setContinuationOf(null);
  }, [date, primaryUserId]);

  // ─── Konflikt-Warnung: gleicher Mitarbeiter + Zeitfenster überschneidet sich ───
  // (Mehrere Buchungen pro Tag sind erlaubt — auch auf gleicher Baustelle —
  //  solange sie sich nicht zeitlich überschneiden.)
  const overlappingBlock = useMemo(() => {
    if (fehlzeitTyp) return null;
    if (forUserIds.size > 1) return null; // Multi-Mode: pro User checken wir im Submit
    const minutes = (s: string, e: string) => Math.max(0, timeToMin(e) - timeToMin(s));
    if (minutes(startZeit, endZeit) <= 0) return null;
    return todayBlocks.find(
      (r) =>
        r.start_zeit &&
        r.end_zeit &&
        overlapMin(startZeit, endZeit, fmtTime(r.start_zeit), fmtTime(r.end_zeit)) > 0
    );
  }, [todayBlocks, fehlzeitTyp, startZeit, endZeit, forUserIds]);

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
    setInFirma(false);
    setFahrstunden(0);
    setTaggeldKurz(0);
    setTaggeldLang(0);
    setKm(0);
    setNotizen("");
    setZulageTyp("");
    setZulageStunden(0);
    setZulageNotiz("");
    setExtras(false);
    setContinuationOf(null);
  };

  const partialResetForNextBaustelle = (lastBlock?: Stunde, lastBaustelleName?: string | null) => {
    setBaustelleId("");
    setTaetigkeit("");
    setInFirma(false);
    setFahrstunden(0);
    setTaggeldKurz(0);
    setTaggeldLang(0);
    setKm(0);
    setNotizen("");
    setZulageTyp("");
    setZulageStunden(0);
    setZulageNotiz("");
    setExtras(false);
    if (lastBlock?.end_zeit) {
      const newStart = fmtTime(lastBlock.end_zeit) || DEFAULT_START;
      setStartZeit(newStart);
      // Default-Ende: Anschluss + 4h, lässt sich sofort anpassen
      setEndZeit(shiftTime(newStart, 4 * 60));
      setHasPause(false); // Pause war ja schon im ersten Block
      setContinuationOf({
        bvhName: lastBaustelleName ?? null,
        endZeit: newStart,
      });
    } else {
      resetTimeFields();
      setContinuationOf(null);
    }
  };

  const submit = async (continueFlag: boolean) => {
    if (!user || forUserIds.size === 0) {
      toast({
        variant: "destructive",
        title: "Niemand ausgewählt",
        description: "Wähle mindestens einen Mitarbeiter.",
      });
      return;
    }

    const isFehlzeit = !!fehlzeitTyp;

    // Bei Arbeit: entweder Baustelle ODER Firma-Mode (mit/ohne Bezugs-Baustelle)
    if (!isFehlzeit && !baustelleId && !inFirma) {
      toast({
        variant: "destructive",
        title: "Arbeitsort fehlt",
        description: 'Wähle eine Baustelle, „In der Firma" oder einen Fehlzeit-Typ.',
      });
      return;
    }

    // 15-Min-Snap final vor Save
    const sStart = isFehlzeit ? null : snap15(startZeit);
    const sEnd = isFehlzeit ? null : snap15(endZeit);
    const sPauseVon = !isFehlzeit && hasPause ? snap15(pauseVon) : null;
    const sPauseBis = !isFehlzeit && hasPause ? snap15(pauseBis) : null;

    let arbeit = 0;
    if (!isFehlzeit) {
      if (timeToMin(sEnd!) <= timeToMin(sStart!)) {
        toast({ variant: "destructive", title: "Endzeit muss nach Startzeit liegen." });
        return;
      }
      if (hasPause) {
        const pv = timeToMin(sPauseVon!);
        const pb = timeToMin(sPauseBis!);
        if (pb <= pv) {
          toast({ variant: "destructive", title: "Pause-Ende muss nach Pause-Beginn liegen." });
          return;
        }
      }
      arbeit = calcArbeitsstunden(sStart, sEnd, sPauseVon, sPauseBis);
      if (arbeit <= 0) {
        toast({ variant: "destructive", title: "Arbeitszeit ist 0 — bitte prüfen." });
        return;
      }
    }

    // Konflikt-Check pro Mitarbeiter (Zeitfenster-Überlappung)
    if (!isFehlzeit && !continueFlag) {
      const conflicts: { uid: string; minutes: number }[] = [];
      for (const uid of forUserIds) {
        const userBlocks = rows.filter((r) => r.mitarbeiter_id === uid && r.datum === date);
        for (const r of userBlocks) {
          const m = overlapMin(sStart, sEnd, fmtTime(r.start_zeit), fmtTime(r.end_zeit));
          if (m > 0) {
            conflicts.push({ uid, minutes: m });
            break;
          }
        }
      }
      if (conflicts.length > 0) {
        const names = conflicts
          .map((c) => {
            if (c.uid === user.id) return "dich";
            const m = allMembers.find((p) => p.id === c.uid);
            return m ? `${m.vorname} ${m.nachname}` : "?";
          })
          .join(", ");
        const ok = window.confirm(
          `Für ${names} überschneidet sich diese Zeit (${fmtTime(sStart)}–${fmtTime(
            sEnd
          )}) mit einer bereits vorhandenen Buchung am ${new Date(date).toLocaleDateString(
            "de-AT"
          )}. Trotzdem speichern?`
        );
        if (!ok) return;
      }
    }

    const ids = Array.from(forUserIds);
    const commonPayload: any = {
      datum: date,
      baustelle_id: isFehlzeit ? null : baustelleId || null,
      start_zeit: sStart,
      end_zeit: sEnd,
      pause_von: sPauseVon,
      pause_bis: sPauseBis,
      arbeitsstunden: isFehlzeit ? 0 : arbeit,
      fahrstunden,
      taggeld_kurz: !isFehlzeit && inFirma ? 0 : taggeldKurz,
      taggeld_lang: !isFehlzeit && inFirma ? 0 : taggeldLang,
      km_gefahren: km,
      fehlzeit_typ: fehlzeitTyp || null,
      fehlzeit_stunden: isFehlzeit ? fehlzeitHours : 0,
      taetigkeit: taetigkeit || null,
      notizen: notizen || null,
      in_firma: !isFehlzeit && inFirma,
      // Erschwerniszulage: nur bei Arbeit, nicht bei Fehlzeit
      zulage_typ: !isFehlzeit && zulageTyp ? zulageTyp : null,
      zulage_stunden:
        !isFehlzeit && zulageTyp
          ? Math.min(zulageStunden || arbeit, arbeit)
          : 0,
      zulage_notiz:
        !isFehlzeit && zulageTyp === "andere" ? zulageNotiz.trim() || null : null,
      status: "offen" as StundenStatus,
    };
    let lastInserted: Stunde | null = null;
    let success = 0;
    for (const uid of ids) {
      const payload: any = { ...commonPayload, mitarbeiter_id: uid };
      const { data, error } = await supabase
        .from("stundenbuchungen")
        .insert(payload)
        .select()
        .single();
      if (error) {
        const p = allMembers.find((m) => m.id === uid);
        toast({
          variant: "destructive",
          title: `Fehler bei ${p ? `${p.vorname} ${p.nachname}` : uid}`,
          description: error.message,
        });
        continue;
      }
      lastInserted = data as Stunde;
      success++;
    }
    if (success === 0) return;

    toast({
      title:
        ids.length > 1
          ? `${success} Buchungen gespeichert`
          : continueFlag
          ? "Block gespeichert – nächste Baustelle"
          : "Buchung gespeichert",
      description: isFehlzeit
        ? `${fehlzeitHours}h ${fehlzeitTyp} · ${success} Mitarbeiter`
        : `${arbeit.toFixed(2)}h · ${fmtTime(startZeit)}–${fmtTime(endZeit)}${
            ids.length > 1 ? ` · ${success} Mitarbeiter` : ""
          }`,
    });

    if (continueFlag && !isFehlzeit && lastInserted) {
      const bName =
        baustellen.find((b) => b.id === lastInserted!.baustelle_id)?.bvh_name ?? null;
      partialResetForNextBaustelle(lastInserted, bName);
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

  // ─── Personen-Lookup für Listen ───
  const personById = useMemo(() => {
    const map = new Map<string, Profile>();
    allMembers.forEach((m) => map.set(m.id, m));
    if (profile && user) {
      map.set(user.id, { ...(profile as any), id: user.id });
    }
    return map;
  }, [allMembers, profile, user]);

  const togglePerson = (uid: string) => {
    setForUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
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
              selectedIds={forUserIds}
              onToggle={togglePerson}
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
                {/* Feiertag-Hinweis: automatisch aus Kalender */}
                {(() => {
                  const fei = feiertagAt(date);
                  if (!fei) return null;
                  return (
                    <div className="mt-2 rounded-md border border-violet-300 bg-violet-50 px-2.5 py-2 text-xs flex items-center gap-2">
                      <span className="h-5 w-5 rounded-full bg-violet-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                        F
                      </span>
                      <div className="flex-1">
                        <div className="font-semibold text-violet-900">
                          Feiertag: {fei.name}
                        </div>
                        <div className="text-[11px] text-violet-700">
                          {fei.scope === "kaernten"
                            ? "Kärntner Landesfeiertag"
                            : "Gesetzlicher Feiertag in Österreich"}{" "}
                          — keine Buchung nötig.
                        </div>
                      </div>
                    </div>
                  );
                })()}
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
                              : r.in_firma
                              ? b?.bvh_name
                                ? `Firma · ${b.bvh_name}`
                                : "Firma"
                              : b?.bvh_name ?? "—"}
                          </span>
                          {r.status === "offen" && (
                            <div className="flex items-center gap-0.5 shrink-0">
                              <button
                                onClick={() => setEditing(r)}
                                className="text-muted-foreground hover:text-primary p-1"
                                aria-label="Buchung bearbeiten"
                                title="Bearbeiten"
                              >
                                <Edit className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => remove(r.id)}
                                className="text-muted-foreground hover:text-destructive p-1"
                                aria-label="Buchung löschen"
                                title="Löschen"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                          {r.status !== "offen" && (
                            <span
                              className="text-[9px] uppercase tracking-wide text-muted-foreground shrink-0"
                              title="Bereits eingereicht — nicht mehr editierbar"
                            >
                              {r.status === "zm_freigabe"
                                ? "ZM"
                                : r.status === "buero_freigabe"
                                ? "Büro"
                                : r.status}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Konflikt-Warnung: Zeitfenster überlappt mit existierender Buchung */}
          {overlappingBlock && (
            <Card className="border-amber-400 bg-amber-50">
              <CardContent className="p-3 flex items-start gap-2 text-xs">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <strong>Zeitüberschneidung:</strong> Du hast heute bereits{" "}
                  {fmtTime(overlappingBlock.start_zeit)}–{fmtTime(overlappingBlock.end_zeit)}{" "}
                  gebucht. Mehrere Buchungen pro Tag sind erlaubt — solange sie sich nicht zeitlich
                  überschneiden.
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
                  {fehlzeitTyp ? "Fehlzeit" : "Was wurde gemacht"}
                </Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-1.5">
                  <button
                    onClick={() => setFehlzeitTyp("")}
                    className={`h-11 rounded-md text-sm font-semibold border-2 transition ${
                      !fehlzeitTyp
                        ? "bg-primary text-primary-foreground border-primary shadow-sm ring-2 ring-primary/30"
                        : "bg-background border-border hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    Arbeit
                  </button>
                  {FEHLZEITEN.map((f) => {
                    const active = fehlzeitTyp === f.value;
                    return (
                      <button
                        key={f.value}
                        onClick={() => setFehlzeitTyp(f.value)}
                        className={`h-11 rounded-md text-sm font-semibold border-2 transition ${
                          active
                            ? "text-white shadow-sm"
                            : "bg-background border-border hover:bg-muted text-muted-foreground"
                        }`}
                        style={
                          active
                            ? {
                                background: f.color,
                                borderColor: f.color,
                                boxShadow: `0 0 0 2px ${f.color}40`,
                              }
                            : undefined
                        }
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>

                {!fehlzeitTyp && (
                  <>
                    {/* Arbeitsort-Toggle: Baustelle vs. Firma */}
                    <div className="mt-3 grid grid-cols-2 gap-1.5">
                      <button
                        onClick={() => setInFirma(false)}
                        className={`flex items-center justify-center gap-1.5 h-11 rounded-md border text-sm font-medium transition ${
                          !inFirma
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background hover:bg-muted"
                        }`}
                      >
                        <MapPin className="h-4 w-4" />
                        Auf Baustelle
                      </button>
                      <button
                        onClick={() => setInFirma(true)}
                        className={`flex items-center justify-center gap-1.5 h-11 rounded-md border text-sm font-medium transition ${
                          inFirma
                            ? "bg-foreground text-background border-foreground"
                            : "bg-background hover:bg-muted"
                        }`}
                      >
                        <Factory className="h-4 w-4" />
                        In der Firma
                      </button>
                    </div>
                    {inFirma && (
                      <div className="mt-1.5 text-[11px] text-muted-foreground italic">
                        In der Firma → keine Diäten. Baustelle ist optional, falls für eine
                        bestimmte Baustelle vorbereitet wurde.
                      </div>
                    )}

                    {/* Baustellen-Combobox: required wenn nicht inFirma, sonst optional */}
                    <div className="mt-2">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                        Baustelle {inFirma ? "(optional)" : ""}
                      </Label>
                      <div className="mt-1">
                        <BaustelleCombobox
                          baustellen={baustellen}
                          value={baustelleId}
                          onChange={setBaustelleId}
                          allowClear={inFirma}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Arbeit-Mode: Time-Range */}
              {!fehlzeitTyp && (
                <div className="space-y-3 border-t pt-3">
                  {/* Anschluss-Banner: zeigt nahtlosen Übergang vom letzten Block */}
                  {continuationOf && (
                    <div className="rounded-md border-2 border-primary/40 bg-primary/5 p-2.5 flex items-start gap-2 text-xs">
                      <span className="h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold shrink-0">
                        2.
                      </span>
                      <div className="flex-1">
                        <div className="font-semibold text-foreground">
                          Anschluss-Buchung ab {continuationOf.endZeit}
                        </div>
                        <div className="text-muted-foreground mt-0.5">
                          {continuationOf.bvhName
                            ? `Direkt nach „${continuationOf.bvhName}" — Pause war im ersten Block.`
                            : "Direkt nach dem vorigen Block — Pause war schon dort."}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <TimeStepper label="Startzeit" value={startZeit} onChange={setStartZeit} big />
                    <TimeStepper label="Endzeit" value={endZeit} onChange={setEndZeit} big />
                  </div>

                  {/* Pause-Sektion: gesperrt wenn am Tag schon eine gebucht ist */}
                  {pauseAlreadyBookedToday ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2.5 flex items-start gap-2 text-xs">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <div className="font-semibold text-emerald-900">
                          Pause heute schon gebucht
                        </div>
                        <div className="text-emerald-800 mt-0.5">
                          {pauseAlreadyBookedToday.von}–{pauseAlreadyBookedToday.bis} im vorherigen
                          Block — keine zweite Pause nötig.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 pt-1">
                        <Switch
                          checked={hasPause}
                          onCheckedChange={setHasPause}
                          id="has_pause"
                        />
                        <Label htmlFor="has_pause" className="text-sm cursor-pointer">
                          Pause angeben
                        </Label>
                      </div>

                      {hasPause && (
                        <div className="grid grid-cols-2 gap-2">
                          <TimeStepper
                            label="Pause von"
                            value={pauseVon}
                            onChange={setPauseVon}
                          />
                          <TimeStepper
                            label="Pause bis"
                            value={pauseBis}
                            onChange={setPauseBis}
                          />
                        </div>
                      )}
                    </>
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

              {/* Erschwerniszulage (KV § 6) */}
              {!fehlzeitTyp && (
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Erschwerniszulage
                  </Label>
                  <select
                    value={zulageTyp}
                    onChange={(e) => {
                      const v = e.target.value as ZulageTyp | "";
                      setZulageTyp(v);
                      // Default: Zulage gilt für die ganze Buchung
                      if (v && zulageStunden === 0) setZulageStunden(arbeitstundenLive);
                      if (!v) setZulageStunden(0);
                    }}
                    className="w-full h-11 rounded-md border bg-background px-3 text-sm"
                    aria-label="Erschwerniszulage"
                  >
                    <option value="">— keine —</option>
                    {ZULAGEN.map((z) => (
                      <option key={z.code} value={z.code}>
                        {z.label} ({z.kv})
                      </option>
                    ))}
                  </select>
                  {zulageTyp && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Davon Zulagen-Stunden
                        </Label>
                        <Input
                          inputMode="decimal"
                          type="number"
                          step="0.25"
                          min={0}
                          max={arbeitstundenLive}
                          value={zulageStunden}
                          onChange={(e) =>
                            setZulageStunden(Math.min(Number(e.target.value), arbeitstundenLive))
                          }
                          className="h-10"
                        />
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          max {arbeitstundenLive.toFixed(2).replace(".", ",")} h
                        </div>
                      </div>
                      {zulageTyp === "andere" && (
                        <div>
                          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Notiz / KV-Punkt
                          </Label>
                          <Input
                            value={zulageNotiz}
                            onChange={(e) => setZulageNotiz(e.target.value)}
                            placeholder="z.B. § 6 g Künetten"
                            className="h-10"
                          />
                        </div>
                      )}
                    </div>
                  )}
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
                    <Label className="text-xs">
                      Taggeld kurz {inFirma && <span className="opacity-60">(Firma → 0)</span>}
                    </Label>
                    <Input
                      inputMode="numeric"
                      type="number"
                      step="1"
                      value={inFirma ? 0 : taggeldKurz}
                      disabled={inFirma}
                      onChange={(e) => setTaggeldKurz(Number(e.target.value))}
                      className="h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">
                      Taggeld lang {inFirma && <span className="opacity-60">(Firma → 0)</span>}
                    </Label>
                    <Input
                      inputMode="numeric"
                      type="number"
                      step="1"
                      value={inFirma ? 0 : taggeldLang}
                      disabled={inFirma}
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
                  <Plus className="h-5 w-5 mr-2" />
                  {continuationOf ? "Fertig — Speichern" : "Speichern"}
                </Button>
                {!fehlzeitTyp && (
                  <Button
                    onClick={() => submit(true)}
                    variant="outline"
                    className="flex-1 h-12"
                    title="Speichern und direkt im Anschluss eine weitere Baustelle buchen"
                  >
                    + weitere Baustelle
                  </Button>
                )}
              </div>
              {!fehlzeitTyp && !continuationOf && (
                <div className="text-[11px] text-muted-foreground text-center -mt-1">
                  Bei Wechsel auf eine andere Baustelle am selben Tag → „+ weitere Baustelle"
                </div>
              )}
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
          <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
            {r.in_firma && (
              <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0">
                <Factory className="h-2.5 w-2.5 mr-0.5" />
                Firma
              </Badge>
            )}
            <span className="truncate">
              {baustelle?.bvh_name ?? (r.fehlzeit_typ ? "Fehlzeit" : r.in_firma ? "Allgemein" : "—")}
              {r.taetigkeit && ` · ${r.taetigkeit}`}
            </span>
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
  const [zulageTyp, setZulageTyp] = useState<ZulageTyp | "">(
    (row.zulage_typ as ZulageTyp | null) ?? ""
  );
  const [zulageStunden, setZulageStunden] = useState<number>(
    Number(row.zulage_stunden ?? 0)
  );
  const [zulageNotiz, setZulageNotiz] = useState<string>(row.zulage_notiz ?? "");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const update: any = { datum, taetigkeit: taetigkeit || null };
    let arbeit = 0;
    if (row.fehlzeit_typ) {
      update.fehlzeit_stunden = hours;
    } else if (hasTimes || (startZeit && endZeit)) {
      const sStart = snap15(startZeit);
      const sEnd = snap15(endZeit);
      const sPV = hasPause ? snap15(pauseVon) : null;
      const sPB = hasPause ? snap15(pauseBis) : null;
      update.start_zeit = sStart;
      update.end_zeit = sEnd;
      update.pause_von = sPV;
      update.pause_bis = sPB;
      arbeit = calcArbeitsstunden(sStart, sEnd, sPV, sPB);
      update.arbeitsstunden = arbeit;
    } else {
      arbeit = hours;
      update.arbeitsstunden = hours;
    }
    // Zulage nur bei Arbeit
    if (!row.fehlzeit_typ) {
      update.zulage_typ = zulageTyp || null;
      update.zulage_stunden = zulageTyp ? Math.min(zulageStunden, arbeit) : 0;
      update.zulage_notiz =
        zulageTyp === "andere" ? zulageNotiz.trim() || null : null;
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
            <TimeStepper label="Start" value={startZeit} onChange={setStartZeit} />
            <TimeStepper label="Ende" value={endZeit} onChange={setEndZeit} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={hasPause} onCheckedChange={setHasPause} />
            <Label>Pause</Label>
          </div>
          {hasPause && (
            <div className="grid grid-cols-2 gap-2">
              <TimeStepper label="Pause von" value={pauseVon} onChange={setPauseVon} />
              <TimeStepper label="Pause bis" value={pauseBis} onChange={setPauseBis} />
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
      {!row.fehlzeit_typ && (
        <div className="space-y-2 pt-2 border-t">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Erschwerniszulage
          </Label>
          <select
            value={zulageTyp}
            onChange={(e) => setZulageTyp(e.target.value as ZulageTyp | "")}
            className="w-full h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">— keine —</option>
            {ZULAGEN.map((z) => (
              <option key={z.code} value={z.code}>
                {z.label} ({z.kv})
              </option>
            ))}
          </select>
          {zulageTyp && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px]">Zulagen-Stunden</Label>
                <Input
                  type="number"
                  step="0.25"
                  min={0}
                  value={zulageStunden}
                  onChange={(e) => setZulageStunden(Number(e.target.value))}
                />
              </div>
              {zulageTyp === "andere" && (
                <div>
                  <Label className="text-[10px]">Notiz</Label>
                  <Input
                    value={zulageNotiz}
                    onChange={(e) => setZulageNotiz(e.target.value)}
                    placeholder="z.B. § 6 g"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
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
  selectedIds,
  onToggle,
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
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
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

  const focused = (() => {
    if (selectedIds.size === 0) return "niemanden";
    if (selectedIds.size === 1) {
      const id = Array.from(selectedIds)[0];
      if (id === ownUserId) return "dich";
      const m = members.find((x) => x.id === id);
      return m ? `${m.vorname} ${m.nachname}` : "?";
    }
    return `${selectedIds.size} Mitarbeiter`;
  })();

  const renderPill = (m: Profile, color: string) => {
    const s = statusForDate.get(m.id);
    const active = selectedIds.has(m.id);
    return (
      <button
        key={m.id}
        onClick={() => onToggle(m.id)}
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
        <div className="text-[10px] text-muted-foreground italic">
          Tipp: mehrere Pills antippen, um für mehrere Mitarbeiter gleichzeitig zu buchen.
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
            onClick={() => onToggle(ownUserId)}
            className={`px-2.5 py-1.5 rounded-full text-xs font-medium border transition flex items-center gap-1.5 ${
              selectedIds.has(ownUserId)
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

// ─── Baustellen-Combobox (durchsuchbar) ───
function BaustelleCombobox({
  baustellen,
  value,
  onChange,
  allowClear = false,
}: {
  baustellen: Baustelle[];
  value: string;
  onChange: (id: string) => void;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = baustellen.find((b) => b.id === value);

  if (baustellen.length === 0) {
    return (
      <div className="text-xs text-muted-foreground p-3 bg-muted/40 rounded">
        Aktuell keine aktiven Baustellen für deine Partie.
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-12 text-left font-normal"
        >
          {selected ? (
            <span className="flex items-center gap-2 min-w-0 flex-1">
              <Building2 className="h-4 w-4 text-primary shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{selected.bvh_name}</span>
                {selected.kostenstelle && (
                  <span className="text-xs text-muted-foreground ml-1.5">
                    · {selected.kostenstelle}
                  </span>
                )}
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Building2 className="h-4 w-4 shrink-0" />
              Baustelle wählen…
            </span>
          )}
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[var(--radix-popover-trigger-width)] max-h-[60vh]"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Baustelle suchen…" className="h-11" />
          <CommandList>
            <CommandEmpty>Keine Baustelle gefunden.</CommandEmpty>
            <CommandGroup>
              {allowClear && (
                <CommandItem
                  value="--keine--"
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className="cursor-pointer text-muted-foreground italic"
                >
                  <Check className={`mr-2 h-4 w-4 ${!value ? "opacity-100" : "opacity-0"}`} />
                  Keine Baustelle (allgemein in Firma)
                </CommandItem>
              )}
              {baustellen.map((b) => {
                const isSel = b.id === value;
                return (
                  <CommandItem
                    key={b.id}
                    value={`${b.bvh_name} ${b.kostenstelle ?? ""} ${b.bauherr ?? ""} ${b.ort ?? ""}`}
                    onSelect={() => {
                      onChange(b.id);
                      setOpen(false);
                    }}
                    className="cursor-pointer"
                  >
                    <Check
                      className={`mr-2 h-4 w-4 ${isSel ? "opacity-100" : "opacity-0"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{b.bvh_name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {[b.kostenstelle, b.ort, b.bauherr].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── TimeStepper: 15-min-Schritte mit ± Buttons, Mobile-tauglich ───
function TimeStepper({
  label,
  value,
  onChange,
  big = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  big?: boolean;
}) {
  const inputH = big ? "h-12" : "h-11";
  const btnH = big ? "h-12 w-12" : "h-11 w-11";
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div>
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="flex items-stretch gap-1 mt-1.5">
        <Button
          type="button"
          variant="outline"
          className={`${btnH} shrink-0 px-0`}
          onClick={() => onChange(shiftTime(value, -15))}
          aria-label={`${label} −15 min`}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`${inputH} flex-1 rounded-md border bg-background text-center font-semibold tabular-nums hover:bg-muted transition`}
              aria-label={`${label} ändern`}
            >
              {value}
            </button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-32" align="center">
            <TimeListPicker
              value={value}
              onSelect={(v) => {
                onChange(v);
                setPickerOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
        <Button
          type="button"
          variant="outline"
          className={`${btnH} shrink-0 px-0`}
          onClick={() => onChange(shiftTime(value, 15))}
          aria-label={`${label} +15 min`}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// Quarter-hour Quick-Picker (96 Optionen 00:00 bis 23:45)
function TimeListPicker({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (v: string) => void;
}) {
  const [refEl, setRefEl] = useState<HTMLDivElement | null>(null);
  const options = useMemo(() => {
    const arr: string[] = [];
    for (let m = 0; m < 24 * 60; m += 15) arr.push(minToTime(m));
    return arr;
  }, []);
  // Auf den aktuellen Wert scrollen, sobald die Liste gemountet ist
  useEffect(() => {
    if (!refEl) return;
    const target = refEl.querySelector<HTMLButtonElement>(`[data-time="${value}"]`);
    if (target) {
      const off = target.offsetTop - refEl.clientHeight / 2 + target.clientHeight / 2;
      refEl.scrollTop = Math.max(0, off);
    }
  }, [refEl, value]);
  return (
    <div ref={setRefEl} className="max-h-64 overflow-y-auto py-1">
      {options.map((t) => {
        const sel = t === value;
        return (
          <button
            key={t}
            type="button"
            data-time={t}
            onClick={() => onSelect(t)}
            className={`w-full text-center text-sm py-2 tabular-nums transition ${
              sel
                ? "bg-primary text-primary-foreground font-bold"
                : "hover:bg-muted"
            }`}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}
