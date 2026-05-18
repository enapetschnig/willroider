/**
 * Stunden-Tagesblatt-Erfassung (Phase A des Zeiterfassung-Redesigns).
 *
 * Eingabe pro Tag (ein Eintrag pro Mitarbeiter × Tag):
 * - Tag-Status: Baustelle / Firma / Krank / Urlaub / Schlechtwetter
 * - Netto-Stunden (das was wirklich gearbeitet wurde)
 * - Pausen-Toggles VM + Mittag (Dauer aus Stammdaten, werden ADDIERT)
 * - 1..N Tätigkeitszeilen mit Baustelle + Stunden + Notiz
 * - Optional Zulagen mit Stunden-Split
 * - Polier: zusätzlich Fahrtgeld + KM + Taggeld
 *
 * Live-Preview zeigt Netto / Brutto / Von-Bis / Soll / Überstunden.
 */

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Plus,
  Minus,
  ChevronLeft,
  ChevronRight,
  Hammer,
  Sun,
  HeartPulse,
  CloudRain,
  Factory,
  Coffee,
  Edit,
  Trash2,
  AlertTriangle,
  Loader2,
  Car,
  Tag,
  Calendar,
} from "lucide-react";
import type { Database, TagStatus, BuchungStatus } from "@/integrations/supabase/types";
import { feiertagAt } from "@/lib/feiertage";
import { localIso } from "@/lib/dateFmt";
import { MicButton } from "@/components/MicButton";
import { BaustelleCombobox } from "@/components/stunden/BaustelleCombobox";
import {
  berechneTagZeiten,
  pruefArbeitszeitGesetz,
  ueberstundenForTag,
  fmtH,
  fmtHNum,
} from "@/lib/zeiterfassung";
import {
  useTaetigkeitenStamm,
  useZulagenTypen,
  useMitarbeiterZulagen,
  usePausenConfig,
  useArbeitszeitLimits,
} from "@/hooks/useStammdatenStunden";
import {
  useStundenTageList,
  useSaveStundenTag,
  useDeleteStundenTag,
  type SaveTaetigkeit,
  type SaveZulage,
  type SaveFahrt,
  type StundenTagFull,
} from "@/hooks/useStundenTag";
import { useSollHoursForDay } from "@/hooks/useSollHoursForDay";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];

const STATUS_LABELS: Record<TagStatus, string> = {
  baustelle: "Baustelle",
  firma: "Firma",
  krank: "Krank",
  urlaub: "Urlaub",
  schlechtwetter: "Schlechtwetter",
  feiertag: "Feiertag",
};

const STATUS_ICONS = {
  baustelle: Hammer,
  firma: Factory,
  krank: HeartPulse,
  urlaub: Sun,
  schlechtwetter: CloudRain,
  feiertag: Calendar,
};

const STATUS_COLORS: Record<TagStatus, string> = {
  baustelle: "bg-primary text-primary-foreground border-primary",
  firma: "bg-blue-500 text-white border-blue-500",
  krank: "bg-red-500 text-white border-red-500",
  urlaub: "bg-amber-500 text-white border-amber-500",
  schlechtwetter: "bg-sky-500 text-white border-sky-500",
  feiertag: "bg-violet-500 text-white border-violet-500",
};

const STATUS_OPTIONS: TagStatus[] = ["baustelle", "firma", "krank", "urlaub", "schlechtwetter"];

const todayIso = () => localIso();

interface FormState {
  editingId: string | null;
  tagStatus: TagStatus;
  nettoStunden: number;
  vmPause: boolean;
  mittagPause: boolean;
  arbeitsbeginn: string | null;
  anmerkung: string;
  taetigkeiten: TaetigkeitZeileState[];
  zulagenSelected: Map<string, { stunden: number | null; notiz: string }>;
  fahrt: SaveFahrt | null;
  fehlzeitBis: string;
}

interface TaetigkeitZeileState {
  taetigkeit_id: string | null;
  taetigkeit_freitext: string;
  baustelle_id: string | null;
  stunden: number;
  notiz: string;
}

function emptyForm(initialStatus: TagStatus = "baustelle"): FormState {
  return {
    editingId: null,
    tagStatus: initialStatus,
    nettoStunden: 8,
    vmPause: true,
    mittagPause: true,
    arbeitsbeginn: null,
    anmerkung: "",
    taetigkeiten: [
      { taetigkeit_id: null, taetigkeit_freitext: "", baustelle_id: null, stunden: 0, notiz: "" },
    ],
    zulagenSelected: new Map(),
    fahrt: null,
    fehlzeitBis: "",
  };
}

export default function Stunden() {
  const { user, profile, isAdmin } = useAuth();
  const { toast } = useToast();

  // Datum + Personen
  const [date, setDate] = useState<string>(todayIso);
  const [primaryUserId, setPrimaryUserId] = useState<string>("");
  const [polierPartie, setPolierPartie] = useState<Partie | null>(null);
  const [allMembers, setAllMembers] = useState<Profile[]>([]);
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);

  useEffect(() => {
    if (user) setPrimaryUserId(user.id);
  }, [user]);

  // Polier-Partie / Member laden
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: p } = await supabase
        .from("partien")
        .select("*")
        .eq("partieleiter_id", user.id)
        .maybeSingle();
      setPolierPartie((p as Partie) ?? null);

      if (isAdmin) {
        const { data: members } = await supabase
          .from("profiles")
          .select("*")
          .eq("is_active", true)
          .order("nachname");
        setAllMembers((members as Profile[]) ?? []);
      } else if (p) {
        const { data: members } = await supabase
          .from("profiles")
          .select("*")
          .eq("partie_id", (p as Partie).id)
          .eq("is_active", true)
          .order("nachname");
        setAllMembers((members as Profile[]) ?? []);
      }
    })();
  }, [user, isAdmin]);

  // Baustellen laden
  useEffect(() => {
    (async () => {
      const partieFilter =
        polierPartie?.id ?? (profile as any)?.partie_id ?? null;
      let q = supabase
        .from("baustellen")
        .select("*")
        .in("status", ["aktiv", "geplant"])
        .order("bvh_name");
      if (!isAdmin && partieFilter) q = q.eq("partie_id", partieFilter);
      const { data } = await q;
      setBaustellen((data as Baustelle[]) ?? []);
    })();
  }, [polierPartie, profile, isAdmin]);

  // Stammdaten
  const { data: taetigkeitenStamm = [] } = useTaetigkeitenStamm();
  const { data: zulagenTypen = [] } = useZulagenTypen();
  const { data: erlaubteZulagenIds = [] } = useMitarbeiterZulagen(primaryUserId);
  const { data: pausen } = usePausenConfig();
  const { data: limits } = useArbeitszeitLimits();
  const { sollHours } = useSollHoursForDay(primaryUserId, date);

  // Tag-Liste (letzte 30 Tage des primary user)
  const fromDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return localIso(d);
  }, []);

  const { data: tageList = [], isLoading: tageLoading, refetch: refetchTage } =
    useStundenTageList({
      fromDate,
      mitarbeiterIds: primaryUserId ? [primaryUserId] : [],
      enabled: !!primaryUserId,
    });

  // Tag des aktuellen Datums (falls schon vorhanden → Edit-Mode)
  const aktuellerTag = useMemo(
    () => tageList.find((t) => t.tag.datum === date),
    [tageList, date],
  );

  // Form-State
  const [form, setForm] = useState<FormState>(() =>
    emptyForm(pausen?.vm.default_aktiv && pausen?.mittag.default_aktiv ? "baustelle" : "baustelle"),
  );

  // Form an Pausen-Defaults anpassen sobald geladen
  useEffect(() => {
    if (!pausen) return;
    setForm((f) => ({
      ...f,
      vmPause: f.editingId ? f.vmPause : pausen.vm.default_aktiv,
      mittagPause: f.editingId ? f.mittagPause : pausen.mittag.default_aktiv,
    }));
  }, [pausen]);

  // Wenn ein bestehender Tag existiert für das Datum → in Form laden (Edit-Mode)
  useEffect(() => {
    if (!aktuellerTag) {
      setForm((f) => ({
        ...emptyForm(),
        vmPause: pausen?.vm.default_aktiv ?? true,
        mittagPause: pausen?.mittag.default_aktiv ?? true,
      }));
      return;
    }
    const t = aktuellerTag;
    setForm({
      editingId: t.tag.id,
      tagStatus: t.tag.tag_status,
      nettoStunden: Number(t.tag.netto_stunden),
      vmPause: t.tag.vm_pause,
      mittagPause: t.tag.mittag_pause,
      arbeitsbeginn: t.tag.arbeitsbeginn?.slice(0, 5) ?? null,
      anmerkung: t.tag.anmerkung ?? "",
      taetigkeiten: t.taetigkeiten.length > 0
        ? t.taetigkeiten.map((tt) => ({
            taetigkeit_id: tt.taetigkeit_id,
            taetigkeit_freitext: tt.taetigkeit_freitext ?? "",
            baustelle_id: tt.baustelle_id,
            stunden: Number(tt.stunden),
            notiz: tt.notiz ?? "",
          }))
        : [
            {
              taetigkeit_id: null,
              taetigkeit_freitext: "",
              baustelle_id: null,
              stunden: Number(t.tag.netto_stunden),
              notiz: "",
            },
          ],
      zulagenSelected: new Map(
        t.zulagen.map((z) => [
          z.zulagen_typ_id,
          { stunden: z.stunden ?? null, notiz: z.notiz ?? "" },
        ]),
      ),
      fahrt: t.fahrt
        ? {
            fahrtgeld_eur: Number(t.fahrt.fahrtgeld_eur),
            privat_pkw: t.fahrt.privat_pkw,
            km_gefahren: t.fahrt.km_gefahren !== null ? Number(t.fahrt.km_gefahren) : null,
            taggeld_kurz: t.fahrt.taggeld_kurz,
            taggeld_lang: t.fahrt.taggeld_lang,
            taggeld_manuell: t.fahrt.taggeld_manuell,
          }
        : null,
      fehlzeitBis: "",
    });
  }, [aktuellerTag, pausen]);

  // Sync Tätigkeits-Summe ↔ Netto bei 1 Zeile
  useEffect(() => {
    if (form.tagStatus !== "baustelle" && form.tagStatus !== "firma") return;
    if (form.taetigkeiten.length === 1) {
      setForm((f) => ({
        ...f,
        taetigkeiten: [{ ...f.taetigkeiten[0], stunden: f.nettoStunden }],
      }));
    }
  }, [form.nettoStunden, form.taetigkeiten.length, form.tagStatus]);

  // Live-Zeiten berechnen
  const arbeitsbeginnEffective =
    form.arbeitsbeginn || limits?.arbeitsbeginn_default?.slice(0, 5) || "07:00";
  const tagZeiten = useMemo(
    () =>
      berechneTagZeiten({
        nettoStunden: form.nettoStunden,
        vmPause: form.vmPause,
        mittagPause: form.mittagPause,
        pausenConfig: {
          vmDauerMin: pausen?.vm.dauer_minuten ?? 20,
          mittagDauerMin: pausen?.mittag.dauer_minuten ?? 30,
        },
        arbeitsbeginn: arbeitsbeginnEffective,
      }),
    [form.nettoStunden, form.vmPause, form.mittagPause, pausen, arbeitsbeginnEffective],
  );

  const ueber = useMemo(
    () => ueberstundenForTag(tagZeiten, sollHours),
    [tagZeiten, sollHours],
  );

  const azgCheck = useMemo(
    () =>
      limits
        ? pruefArbeitszeitGesetz(tagZeiten, {
            maxNettoProTag: limits.max_netto_pro_tag,
            maxBruttoProTag: limits.max_brutto_pro_tag,
            arbeitsbeginnDefault: limits.arbeitsbeginn_default,
          })
        : { ok: true },
    [tagZeiten, limits],
  );

  const isArbeit = form.tagStatus === "baustelle" || form.tagStatus === "firma";

  // Stunden-Summen-Check
  const taetigkeitenSumme = useMemo(
    () => form.taetigkeiten.reduce((a, t) => a + (Number(t.stunden) || 0), 0),
    [form.taetigkeiten],
  );
  const taetigkeitenMismatch =
    isArbeit && form.taetigkeiten.length > 1 && Math.abs(taetigkeitenSumme - form.nettoStunden) > 0.01;

  const saveMut = useSaveStundenTag();
  const deleteMut = useDeleteStundenTag();

  // Submit
  const submit = async () => {
    if (!primaryUserId) {
      toast({ variant: "destructive", title: "Kein Mitarbeiter ausgewählt" });
      return;
    }
    if (!azgCheck.ok) {
      if (!window.confirm(`${azgCheck.meldung}\n\nTrotzdem speichern?`)) return;
    }
    if (taetigkeitenMismatch) {
      toast({
        variant: "destructive",
        title: "Stunden-Summe stimmt nicht",
        description: `Tätigkeiten ergeben ${fmtHNum(taetigkeitenSumme)}h, aber Netto = ${fmtHNum(
          form.nettoStunden,
        )}h. Bitte angleichen.`,
      });
      return;
    }

    // Mehrtages-Fehlzeit: mehrere Tage erzeugen
    const dates: string[] = [date];
    if (!isArbeit && form.fehlzeitBis && form.fehlzeitBis > date) {
      let cur = new Date(date + "T00:00:00");
      const end = new Date(form.fehlzeitBis + "T00:00:00");
      dates.length = 0;
      while (cur <= end) {
        const day = cur.getDay();
        const iso = localIso(cur);
        if (day !== 0 && day !== 6 && !feiertagAt(iso)) dates.push(iso);
        cur.setDate(cur.getDate() + 1);
      }
      if (dates.length === 0) {
        toast({
          variant: "destructive",
          title: "Keine Werktage im Zeitraum",
        });
        return;
      }
    }

    try {
      for (const dt of dates) {
        const taetigkeiten: SaveTaetigkeit[] = isArbeit
          ? form.taetigkeiten.map((t, idx) => ({
              position: idx + 1,
              taetigkeit_id: t.taetigkeit_id,
              taetigkeit_freitext: t.taetigkeit_id ? null : t.taetigkeit_freitext.trim() || null,
              baustelle_id: t.baustelle_id,
              stunden: t.stunden || form.nettoStunden,
              notiz: t.notiz.trim() || null,
            }))
          : [];

        const zulagen: SaveZulage[] = isArbeit
          ? Array.from(form.zulagenSelected.entries()).map(([typId, val]) => ({
              zulagen_typ_id: typId,
              stunden: val.stunden,
              notiz: val.notiz.trim() || null,
            }))
          : [];

        await saveMut.mutateAsync({
          id: dates.length === 1 ? form.editingId ?? undefined : undefined,
          mitarbeiter_id: primaryUserId,
          datum: dt,
          tag_status: form.tagStatus,
          netto_stunden: form.nettoStunden,
          vm_pause: isArbeit ? form.vmPause : false,
          mittag_pause: isArbeit ? form.mittagPause : false,
          arbeitsbeginn: form.arbeitsbeginn,
          anmerkung: form.anmerkung.trim() || null,
          taetigkeiten,
          zulagen,
          fahrt: isArbeit ? form.fahrt : null,
        });
      }

      toast({
        title: dates.length > 1
          ? `${dates.length} Tage gespeichert`
          : form.editingId
          ? "Tag aktualisiert"
          : "Tag gespeichert",
      });
      refetchTage();
      // Form auf nächsten Tag reset
      setForm({
        ...emptyForm(),
        vmPause: pausen?.vm.default_aktiv ?? true,
        mittagPause: pausen?.mittag.default_aktiv ?? true,
      });
      // Datum +1 Tag, ausser bei Edit
      if (dates.length === 1 && !form.editingId) {
        const next = new Date(date);
        next.setDate(next.getDate() + 1);
        setDate(localIso(next));
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Fehler beim Speichern",
        description: (e as Error).message,
      });
    }
  };

  const onDeleteTag = async (id: string) => {
    if (!window.confirm("Tag wirklich löschen?")) return;
    try {
      await deleteMut.mutateAsync(id);
      toast({ title: "Tag gelöscht" });
    } catch (e) {
      toast({ variant: "destructive", title: "Fehler", description: (e as Error).message });
    }
  };

  const moveDate = (d: number) => {
    const nd = new Date(date);
    nd.setDate(nd.getDate() + d);
    setDate(localIso(nd));
  };

  const isPolier = !!polierPartie;

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <PageHeader title="Stundenerfassung" />

      {/* Datums-Navigation */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
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
          <div className="flex gap-1.5">
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
                setDate(localIso(d));
              }}
            >
              Gestern
            </Button>
          </div>
          <div className="text-xs text-muted-foreground text-center">
            {new Date(date).toLocaleDateString("de-AT", {
              weekday: "long",
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}
          </div>
        </CardContent>
      </Card>

      {/* Tage-Liste (letzte 30 Tage) */}
      <TageListe
        tage={tageList}
        loading={tageLoading}
        baustellen={baustellen}
        taetigkeitenStamm={taetigkeitenStamm}
        zulagenTypen={zulagenTypen}
        pausen={pausen}
        limits={limits}
        onEditDate={(d) => setDate(d)}
        onDeleteTag={onDeleteTag}
      />

      {/* Eingabe-Form */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-base font-bold flex items-center gap-2">
              {form.editingId ? (
                <>
                  <Edit className="h-4 w-4 text-primary" />
                  Tag bearbeiten
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 text-primary" />
                  Tag erfassen
                </>
              )}
            </h3>
          </div>

          {/* Status-Bar */}
          <div>
            <Label className="text-sm font-semibold">Was war an dem Tag?</Label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-2">
              {STATUS_OPTIONS.map((s) => {
                const Icon = STATUS_ICONS[s];
                const active = form.tagStatus === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, tagStatus: s }))}
                    className={`h-14 rounded-lg text-sm font-semibold border-2 transition flex items-center justify-center gap-1.5 ${
                      active
                        ? STATUS_COLORS[s] + " shadow-sm"
                        : "bg-background border-border hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {STATUS_LABELS[s]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Netto-Stunden */}
          <div className="space-y-2 border-t pt-3">
            <Label className="text-sm font-semibold">
              {isArbeit ? "Tatsächlich gearbeitet" : "Stunden"}
            </Label>
            <div className="flex items-stretch gap-2">
              <Button
                variant="outline"
                className="h-12 w-12 shrink-0"
                onClick={() =>
                  setForm((f) => ({ ...f, nettoStunden: Math.max(0, +(f.nettoStunden - 0.25).toFixed(2)) }))
                }
              >
                <Minus className="h-5 w-5" />
              </Button>
              <Input
                type="number"
                step={0.25}
                min={0}
                value={form.nettoStunden}
                onChange={(e) =>
                  setForm((f) => ({ ...f, nettoStunden: Math.max(0, Number(e.target.value) || 0) }))
                }
                className="h-12 text-center text-xl font-bold tabular-nums"
              />
              <span className="h-12 flex items-center px-2 text-sm font-medium text-muted-foreground">h</span>
              <Button
                variant="outline"
                className="h-12 w-12 shrink-0"
                onClick={() => setForm((f) => ({ ...f, nettoStunden: +(f.nettoStunden + 0.25).toFixed(2) }))}
              >
                <Plus className="h-5 w-5" />
              </Button>
            </div>
            {isArbeit && (
              <div className="grid grid-cols-4 gap-1.5">
                {[8, 9, 9.5, 10].map((q) => (
                  <Button
                    key={q}
                    variant="outline"
                    size="sm"
                    className="h-9"
                    onClick={() => setForm((f) => ({ ...f, nettoStunden: q }))}
                  >
                    {fmtHNum(q)} h
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* Pausen-Toggles (nur Arbeit) */}
          {isArbeit && pausen && (
            <div className="space-y-2 border-t pt-3">
              <Label className="text-sm font-semibold flex items-center gap-1.5">
                <Coffee className="h-4 w-4 text-primary" />
                Pausen (werden zur Anwesenheit dazu addiert)
              </Label>
              <div className="grid sm:grid-cols-2 gap-2">
                <label
                  className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer ${
                    form.vmPause ? "bg-primary/5 border-primary/40" : "border-border"
                  }`}
                >
                  <Switch
                    checked={form.vmPause}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, vmPause: v }))}
                  />
                  <span className="text-sm">
                    Vormittagspause{" "}
                    <span className="text-muted-foreground">({pausen.vm.dauer_minuten} min)</span>
                  </span>
                </label>
                <label
                  className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer ${
                    form.mittagPause ? "bg-primary/5 border-primary/40" : "border-border"
                  }`}
                >
                  <Switch
                    checked={form.mittagPause}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, mittagPause: v }))}
                  />
                  <span className="text-sm">
                    Mittagspause{" "}
                    <span className="text-muted-foreground">({pausen.mittag.dauer_minuten} min)</span>
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Tätigkeiten (nur Arbeit) */}
          {isArbeit && (
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold flex items-center gap-1.5">
                  <Tag className="h-4 w-4 text-primary" />
                  Tätigkeiten
                </Label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      taetigkeiten: [
                        ...f.taetigkeiten,
                        {
                          taetigkeit_id: null,
                          taetigkeit_freitext: "",
                          baustelle_id: f.taetigkeiten[f.taetigkeiten.length - 1]?.baustelle_id ?? null,
                          stunden: 0,
                          notiz: "",
                        },
                      ],
                    }))
                  }
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Tätigkeit
                </Button>
              </div>
              {form.taetigkeiten.map((t, idx) => (
                <div key={idx} className="rounded-md border p-2.5 space-y-2 bg-muted/20">
                  <div className="flex items-center gap-2">
                    <select
                      value={t.taetigkeit_id ?? ""}
                      onChange={(e) =>
                        setForm((f) => {
                          const next = [...f.taetigkeiten];
                          next[idx] = { ...next[idx], taetigkeit_id: e.target.value || null };
                          return { ...f, taetigkeiten: next };
                        })
                      }
                      className="h-10 flex-1 rounded-md border bg-background px-3 text-sm"
                    >
                      <option value="">— Tätigkeit wählen —</option>
                      {taetigkeitenStamm.map((tt) => (
                        <option key={tt.id} value={tt.id}>
                          {tt.bezeichnung}
                        </option>
                      ))}
                    </select>
                    {form.taetigkeiten.length > 1 && (
                      <>
                        <Input
                          type="number"
                          step={0.25}
                          min={0}
                          value={t.stunden}
                          onChange={(e) =>
                            setForm((f) => {
                              const next = [...f.taetigkeiten];
                              next[idx] = { ...next[idx], stunden: Number(e.target.value) || 0 };
                              return { ...f, taetigkeiten: next };
                            })
                          }
                          className="h-10 w-20 text-right"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              taetigkeiten: f.taetigkeiten.filter((_, i) => i !== idx),
                            }))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                  {!t.taetigkeit_id && (
                    <Input
                      placeholder="Oder Freitext (z.B. Spengler-Arbeit)"
                      value={t.taetigkeit_freitext}
                      onChange={(e) =>
                        setForm((f) => {
                          const next = [...f.taetigkeiten];
                          next[idx] = { ...next[idx], taetigkeit_freitext: e.target.value };
                          return { ...f, taetigkeiten: next };
                        })
                      }
                      className="h-9 text-sm"
                    />
                  )}
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <BaustelleCombobox
                        baustellen={baustellen}
                        value={t.baustelle_id ?? ""}
                        onChange={(v) =>
                          setForm((f) => {
                            const next = [...f.taetigkeiten];
                            next[idx] = { ...next[idx], baustelle_id: v || null };
                            return { ...f, taetigkeiten: next };
                          })
                        }
                        allowClear={form.tagStatus === "firma"}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Input
                      placeholder="Notiz (optional)"
                      value={t.notiz}
                      onChange={(e) =>
                        setForm((f) => {
                          const next = [...f.taetigkeiten];
                          next[idx] = { ...next[idx], notiz: e.target.value };
                          return { ...f, taetigkeiten: next };
                        })
                      }
                      className="h-9 text-sm flex-1"
                    />
                    <MicButton
                      onText={(text) =>
                        setForm((f) => {
                          const next = [...f.taetigkeiten];
                          next[idx] = {
                            ...next[idx],
                            notiz: next[idx].notiz ? `${next[idx].notiz} ${text}` : text,
                          };
                          return { ...f, taetigkeiten: next };
                        })
                      }
                      className="h-9 w-9"
                    />
                  </div>
                </div>
              ))}
              {taetigkeitenMismatch && (
                <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  Tätigkeiten ergeben <strong>{fmtHNum(taetigkeitenSumme)} h</strong>, aber Netto-
                  Eingabe ist <strong>{fmtHNum(form.nettoStunden)} h</strong>. Bitte angleichen.
                </div>
              )}
            </div>
          )}

          {/* Zulagen */}
          {isArbeit && erlaubteZulagenIds.length > 0 && (
            <div className="space-y-2 border-t pt-3">
              <Label className="text-sm font-semibold">Zulagen</Label>
              <div className="flex flex-wrap gap-1.5">
                {zulagenTypen
                  .filter((z) => erlaubteZulagenIds.includes(z.id))
                  .map((z) => {
                    const sel = form.zulagenSelected.get(z.id);
                    const active = !!sel;
                    return (
                      <button
                        key={z.id}
                        type="button"
                        onClick={() =>
                          setForm((f) => {
                            const next = new Map(f.zulagenSelected);
                            if (next.has(z.id)) next.delete(z.id);
                            else next.set(z.id, { stunden: null, notiz: "" });
                            return { ...f, zulagenSelected: next };
                          })
                        }
                        className={`text-xs px-2.5 py-1.5 rounded-full border transition ${
                          active
                            ? "bg-primary/10 border-primary text-primary font-semibold"
                            : "bg-background border-border text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {z.bezeichnung}
                        {active && sel?.stunden !== null && sel?.stunden !== undefined && (
                          <span className="ml-1">· {sel.stunden}h</span>
                        )}
                      </button>
                    );
                  })}
              </div>
              {Array.from(form.zulagenSelected.entries()).map(([typId, val]) => {
                const z = zulagenTypen.find((x) => x.id === typId);
                if (!z?.ermoeglicht_stunden_split) return null;
                return (
                  <div key={typId} className="flex items-center gap-2 text-xs">
                    <span className="w-24">{z.bezeichnung}:</span>
                    <Input
                      type="number"
                      step={0.25}
                      min={0}
                      max={form.nettoStunden}
                      value={val.stunden ?? ""}
                      onChange={(e) =>
                        setForm((f) => {
                          const next = new Map(f.zulagenSelected);
                          const cur = next.get(typId)!;
                          next.set(typId, {
                            ...cur,
                            stunden: e.target.value === "" ? null : Number(e.target.value),
                          });
                          return { ...f, zulagenSelected: next };
                        })
                      }
                      placeholder={`alle ${fmtHNum(form.nettoStunden)} h`}
                      className="h-8 w-32 text-right"
                    />
                    <span className="text-muted-foreground">h (leer = alle)</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Fahrt (nur Polier) */}
          {isArbeit && isPolier && (
            <FahrtSection
              fahrt={form.fahrt}
              setFahrt={(fahrt) => setForm((f) => ({ ...f, fahrt }))}
              baustelle={baustellen.find((b) => b.id === form.taetigkeiten[0]?.baustelle_id) ?? null}
            />
          )}

          {/* Fehlzeit: Bis-Datum */}
          {!isArbeit && (
            <div className="space-y-2 border-t pt-3">
              <Label className="text-sm">Bis-Datum (optional, für Mehrtages-Fehlzeit)</Label>
              <Input
                type="date"
                min={date}
                value={form.fehlzeitBis}
                onChange={(e) => setForm((f) => ({ ...f, fehlzeitBis: e.target.value }))}
                className="h-10"
              />
              {form.fehlzeitBis && form.fehlzeitBis > date && (
                <div className="text-[11px] text-muted-foreground">
                  Wochenenden und Feiertage werden übersprungen — pro Werktag wird ein Eintrag erzeugt.
                </div>
              )}
            </div>
          )}

          {/* Anmerkung */}
          <div className="space-y-1 border-t pt-3">
            <Label className="text-sm">Anmerkung (optional)</Label>
            <div className="flex items-center gap-1.5">
              <Textarea
                value={form.anmerkung}
                onChange={(e) => setForm((f) => ({ ...f, anmerkung: e.target.value }))}
                rows={2}
                className="flex-1"
              />
              <MicButton
                onText={(text) =>
                  setForm((f) => ({ ...f, anmerkung: f.anmerkung ? `${f.anmerkung} ${text}` : text }))
                }
                className="h-9 w-9"
              />
            </div>
          </div>

          {/* Live-Preview */}
          {isArbeit && (
            <div className="rounded-lg border bg-primary/5 border-primary/20 p-3 space-y-1.5">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Tatsächlich gearbeitet
                  </div>
                  <div className="text-xl font-bold tabular-nums text-primary">
                    {fmtH(tagZeiten.nettoArbeit)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Anwesenheit
                  </div>
                  <div className="text-xl font-bold tabular-nums">
                    {fmtH(tagZeiten.bruttoAnwesenheit)}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-primary/20 pt-1.5">
                <span className="tabular-nums">
                  {tagZeiten.von} – {tagZeiten.bis}
                </span>
                <span>
                  Soll: {fmtH(sollHours)}
                  {ueber.diff !== 0 && (
                    <span className={ueber.diff > 0 ? "text-emerald-700 ml-1.5" : "text-amber-700 ml-1.5"}>
                      ({ueber.diff > 0 ? "+" : ""}
                      {fmtH(Math.abs(ueber.diff))} {ueber.diff > 0 ? "Überstunden" : "fehlend"})
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}

          {/* Arbeitszeit-Warnung */}
          {!azgCheck.ok && (
            <div className="rounded-md border-2 border-destructive bg-destructive/5 p-3 flex items-start gap-2 text-xs">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <div>
                <strong className="text-destructive">Arbeitszeit-Grenze überschritten</strong>
                <div className="text-foreground mt-0.5">{azgCheck.meldung}</div>
              </div>
            </div>
          )}

          {/* Submit */}
          <Button
            onClick={submit}
            disabled={saveMut.isPending}
            className="w-full h-12 text-base"
          >
            {saveMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {form.editingId ? "Änderungen speichern" : "Tag speichern"}
          </Button>
          {form.editingId && (
            <Button
              variant="outline"
              onClick={() =>
                setForm({
                  ...emptyForm(),
                  vmPause: pausen?.vm.default_aktiv ?? true,
                  mittagPause: pausen?.mittag.default_aktiv ?? true,
                })
              }
              className="w-full"
            >
              Eingaben verwerfen
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Fahrt-Section (nur Polier) ────────────────────────────────────────────

function FahrtSection({
  fahrt,
  setFahrt,
  baustelle,
}: {
  fahrt: SaveFahrt | null;
  setFahrt: (f: SaveFahrt | null) => void;
  baustelle: Baustelle | null;
}) {
  const enabled = !!fahrt;

  const toggle = () => {
    if (enabled) setFahrt(null);
    else
      setFahrt({
        fahrtgeld_eur: Number(baustelle?.fahrtgeld_pauschale_eur ?? 0),
        privat_pkw: false,
        km_gefahren: null,
        taggeld_kurz: 0,
        taggeld_lang: 0,
        taggeld_manuell: false,
      });
  };

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center gap-2">
        <Switch checked={enabled} onCheckedChange={toggle} />
        <Label className="text-sm font-semibold flex items-center gap-1.5 cursor-pointer">
          <Car className="h-4 w-4 text-primary" />
          Fahrt & Diäten (Polier)
        </Label>
      </div>
      {enabled && fahrt && (
        <div className="space-y-2 pl-1">
          <div className="grid sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Fahrtgeld (€)</Label>
              <Input
                type="number"
                step={0.5}
                min={0}
                value={fahrt.fahrtgeld_eur}
                onChange={(e) =>
                  setFahrt({ ...fahrt, fahrtgeld_eur: Number(e.target.value) || 0 })
                }
                className="h-9"
              />
              {baustelle && Number(baustelle.fahrtgeld_pauschale_eur) > 0 && (
                <div className="text-[10px] text-muted-foreground">
                  Default aus Baustelle: € {baustelle.fahrtgeld_pauschale_eur}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 pt-5">
              <Switch
                checked={fahrt.privat_pkw}
                onCheckedChange={(v) => setFahrt({ ...fahrt, privat_pkw: v })}
              />
              <Label className="text-xs cursor-pointer">Mit Privat-PKW gefahren</Label>
            </div>
          </div>
          {fahrt.privat_pkw && (
            <div className="space-y-1">
              <Label className="text-xs">Kilometer gefahren</Label>
              <Input
                type="number"
                step={1}
                min={0}
                value={fahrt.km_gefahren ?? ""}
                onChange={(e) =>
                  setFahrt({
                    ...fahrt,
                    km_gefahren: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                className="h-9"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Taggeld kurz (× )</Label>
              <Input
                type="number"
                step={1}
                min={0}
                value={fahrt.taggeld_kurz}
                onChange={(e) =>
                  setFahrt({ ...fahrt, taggeld_kurz: Number(e.target.value) || 0 })
                }
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Taggeld lang (× )</Label>
              <Input
                type="number"
                step={1}
                min={0}
                value={fahrt.taggeld_lang}
                onChange={(e) =>
                  setFahrt({ ...fahrt, taggeld_lang: Number(e.target.value) || 0 })
                }
                className="h-9"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tage-Liste ────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<BuchungStatus, { label: string; cls: string }> = {
  erfasst: { label: "Erfasst", cls: "bg-blue-100 text-blue-900 border-blue-300" },
  ma_bestaetigt: { label: "Bestätigt", cls: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  zm_freigabe: { label: "ZM frei", cls: "bg-purple-100 text-purple-900 border-purple-300" },
  buero_freigabe: { label: "Büro frei", cls: "bg-orange-100 text-orange-900 border-orange-300" },
  exportiert: { label: "Exportiert", cls: "bg-gray-300 text-gray-900 border-gray-400" },
  abgelehnt: { label: "Abgelehnt", cls: "bg-red-100 text-red-900 border-red-300" },
};

function TageListe({
  tage,
  loading,
  baustellen,
  taetigkeitenStamm,
  zulagenTypen,
  pausen,
  limits,
  onEditDate,
  onDeleteTag,
}: {
  tage: StundenTagFull[];
  loading: boolean;
  baustellen: Baustelle[];
  taetigkeitenStamm: Database["public"]["Tables"]["taetigkeiten_stamm"]["Row"][];
  zulagenTypen: Database["public"]["Tables"]["zulagen_typen"]["Row"][];
  pausen: { vm: any; mittag: any } | undefined;
  limits: any;
  onEditDate: (date: string) => void;
  onDeleteTag: (id: string) => void;
}) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Lade Tage…
        </CardContent>
      </Card>
    );
  }
  if (tage.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-4 text-center text-sm text-muted-foreground">
          Noch keine Tage erfasst.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-3 sm:p-4 space-y-2">
        <div className="text-sm font-semibold">Letzte 30 Tage</div>
        <div className="space-y-1.5">
          {tage.map((t) => {
            const zeiten = pausen
              ? berechneTagZeiten({
                  nettoStunden: Number(t.tag.netto_stunden),
                  vmPause: t.tag.vm_pause,
                  mittagPause: t.tag.mittag_pause,
                  pausenConfig: {
                    vmDauerMin: pausen.vm.dauer_minuten,
                    mittagDauerMin: pausen.mittag.dauer_minuten,
                  },
                  arbeitsbeginn:
                    t.tag.arbeitsbeginn?.slice(0, 5) ||
                    limits?.arbeitsbeginn_default?.slice(0, 5) ||
                    "07:00",
                })
              : null;
            const isArbeit =
              t.tag.tag_status === "baustelle" || t.tag.tag_status === "firma";
            const statusBadge = STATUS_BADGE[t.tag.status];
            const canEdit = t.tag.status === "erfasst" || t.tag.status === "ma_bestaetigt";
            return (
              <div
                key={t.tag.id}
                className="rounded-md border p-2.5 flex items-start gap-2 bg-card hover:bg-muted/20 transition"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold tabular-nums">
                      {new Date(t.tag.datum).toLocaleDateString("de-AT", {
                        weekday: "short",
                        day: "2-digit",
                        month: "2-digit",
                      })}
                    </span>
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {STATUS_LABELS[t.tag.tag_status]}
                    </Badge>
                    <Badge variant="outline" className={`text-[10px] ${statusBadge.cls}`}>
                      {statusBadge.label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                    {isArbeit && zeiten ? (
                      <>
                        <span className="font-semibold text-foreground tabular-nums">
                          {fmtH(zeiten.nettoArbeit)}
                        </span>
                        <span>·</span>
                        <span className="tabular-nums">
                          {zeiten.von} – {zeiten.bis} ({fmtH(zeiten.bruttoAnwesenheit)})
                        </span>
                      </>
                    ) : (
                      <span className="font-semibold text-foreground">
                        {fmtH(Number(t.tag.netto_stunden))}
                      </span>
                    )}
                  </div>
                  {isArbeit && t.taetigkeiten.length > 0 && (
                    <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {t.taetigkeiten
                        .map((tt) => {
                          const stammName =
                            taetigkeitenStamm.find((s) => s.id === tt.taetigkeit_id)?.bezeichnung ??
                            tt.taetigkeit_freitext ??
                            "—";
                          const bvh = baustellen.find((b) => b.id === tt.baustelle_id)?.bvh_name;
                          return bvh ? `${stammName} (${bvh})` : stammName;
                        })
                        .join(" · ")}
                    </div>
                  )}
                  {t.zulagen.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {t.zulagen.map((z) => {
                        const typ = zulagenTypen.find((x) => x.id === z.zulagen_typ_id);
                        return (
                          <span
                            key={z.id}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200"
                          >
                            {typ?.bezeichnung ?? "Zulage"}
                            {z.stunden !== null && ` · ${z.stunden}h`}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {canEdit && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={() => onEditDate(t.tag.datum)}
                        title="Bearbeiten"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                        onClick={() => onDeleteTag(t.tag.id)}
                        title="Löschen"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
