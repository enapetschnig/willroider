/**
 * Stundenerfassung im Gasser-Matrix-Pattern.
 *
 * Matrix:
 *   Zeilen = Tätigkeiten (jeweils mit Baustelle + Notiz)
 *   Spalten = ausgewählte Mitarbeiter (1 im Self-Modus, N im Polier-Bulk)
 *   Zellen = Stunden für (MA, Tätigkeit)
 *
 * Pausen + Zulagen + Fahrt sind global pro Tag.
 * Tag-Status (Baustelle/Firma/Krank/Urlaub/SW) gilt für alle selektierten MA.
 * Netto-Stunden pro MA = Summe der Stunden in seiner Spalte.
 *
 * Mobile-Fallback bei N>1 MA: pro Tätigkeit eine Card mit MA-Inputs vertikal.
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
import { useQuery } from "@tanstack/react-query";
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
import type { Database, TagStatus } from "@/integrations/supabase/types";
import { feiertagAt } from "@/lib/feiertage";
import { localIso } from "@/lib/dateFmt";
import { MicButton } from "@/components/MicButton";
import { BaustelleCombobox } from "@/components/stunden/BaustelleCombobox";
import { PersonPicker, type Mode } from "@/components/stunden/PersonPicker";
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

interface TaetigkeitsZeile {
  taetigkeit_id: string | null;
  taetigkeit_freitext: string;
  baustelle_id: string | null;
  notiz: string;
  stundenPerMa: Record<string, number>;
}

interface MatrixForm {
  tagStatus: TagStatus;
  taetigkeiten: TaetigkeitsZeile[];
  vmPause: boolean;
  mittagPause: boolean;
  arbeitsbeginn: string | null;
  anmerkung: string;
  zulagenSelected: Map<string, { stunden: number | null; notiz: string }>;
  fahrt: SaveFahrt | null;
  fehlzeitStunden: number;
  fehlzeitBis: string;
}

function emptyForm(): MatrixForm {
  return {
    tagStatus: "baustelle",
    taetigkeiten: [
      {
        taetigkeit_id: null,
        taetigkeit_freitext: "",
        baustelle_id: null,
        notiz: "",
        stundenPerMa: {},
      },
    ],
    vmPause: true,
    mittagPause: true,
    arbeitsbeginn: null,
    anmerkung: "",
    zulagenSelected: new Map(),
    fahrt: null,
    fehlzeitStunden: 8,
    fehlzeitBis: "",
  };
}

export default function Stunden() {
  const { user, profile, isAdmin } = useAuth();
  const { toast } = useToast();

  const [date, setDate] = useState<string>(todayIso);
  const [polierPartie, setPolierPartie] = useState<Partie | null>(null);
  const [allPartien, setAllPartien] = useState<Partie[]>([]);
  const [allMembers, setAllMembers] = useState<Profile[]>([]);
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [forUserIds, setForUserIds] = useState<Set<string>>(new Set());
  const [memberSearch, setMemberSearch] = useState<string>("");

  useEffect(() => {
    if (user) setForUserIds(new Set([user.id]));
  }, [user]);

  // Polier-Partie / Members
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
        const [{ data: members }, { data: partien }] = await Promise.all([
          supabase.from("profiles").select("*").eq("is_active", true).order("nachname"),
          supabase.from("partien").select("*").order("name"),
        ]);
        setAllMembers((members as Profile[]) ?? []);
        setAllPartien((partien as Partie[]) ?? []);
      } else if (p) {
        const { data: members } = await supabase
          .from("profiles")
          .select("*")
          .eq("partie_id", (p as Partie).id)
          .eq("is_active", true)
          .order("nachname");
        setAllMembers((members as Profile[]) ?? []);
        setAllPartien([p as Partie]);
      }
    })();
  }, [user, isAdmin]);

  // Baustellen
  useEffect(() => {
    (async () => {
      const partieFilter = polierPartie?.id ?? (profile as any)?.partie_id ?? null;
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

  const mode: Mode = isAdmin ? "admin" : polierPartie ? "polier" : "self";
  const hasPicker = mode !== "self";
  const istPolier = !!polierPartie;
  const primaryUserId = user?.id ?? "";

  const { data: taetigkeitenStamm = [] } = useTaetigkeitenStamm();
  const { data: zulagenTypen = [] } = useZulagenTypen();
  const { data: erlaubteZulagenIds = [] } = useMitarbeiterZulagen(primaryUserId);
  const { data: pausen } = usePausenConfig();
  const { data: limits } = useArbeitszeitLimits();
  const { sollHours: primarySoll } = useSollHoursForDay(primaryUserId, date);

  // Status-Map fürs Picker-UI (zeigt pro MA „4,5h" wenn schon was gebucht)
  const memberIds = useMemo(
    () => Array.from(new Set([user?.id, ...allMembers.map((m) => m.id)].filter(Boolean) as string[])),
    [user, allMembers],
  );
  const { data: statusForDateMap = new Map<string, { hours: number }>() } = useQuery({
    queryKey: ["stunden_status_for_date", date, memberIds],
    queryFn: async () => {
      if (memberIds.length === 0) return new Map<string, { hours: number }>();
      const { data } = await supabase
        .from("stunden_tage")
        .select("mitarbeiter_id, netto_stunden")
        .eq("datum", date)
        .in("mitarbeiter_id", memberIds);
      const map = new Map<string, { hours: number }>();
      (data ?? []).forEach((r: any) => {
        const cur = map.get(r.mitarbeiter_id) ?? { hours: 0 };
        cur.hours += Number(r.netto_stunden ?? 0);
        map.set(r.mitarbeiter_id, cur);
      });
      return map;
    },
    enabled: !!date && memberIds.length > 0,
  });

  // Eigene Tage-Liste oben
  const fromDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return localIso(d);
  }, []);
  const { data: tageList = [], refetch: refetchTage } = useStundenTageList({
    fromDate,
    mitarbeiterIds: primaryUserId ? [primaryUserId] : [],
    enabled: !!primaryUserId,
  });
  const aktuellerEigenerTag = useMemo(
    () => tageList.find((t) => t.tag.datum === date),
    [tageList, date],
  );

  // ─── Form-State ─────────────────────────────────────────────────────
  const [form, setForm] = useState<MatrixForm>(() => emptyForm());

  // Form-Reset auf Pausen-Defaults sobald geladen
  useEffect(() => {
    if (!pausen) return;
    setForm((f) => ({
      ...f,
      vmPause: pausen.vm.default_aktiv,
      mittagPause: pausen.mittag.default_aktiv,
    }));
  }, [pausen]);

  // Wenn user wechselt forUserIds → für neuen User stundenPerMa initialisieren mit 0
  useEffect(() => {
    setForm((f) => ({
      ...f,
      taetigkeiten: f.taetigkeiten.map((t) => {
        const next: Record<string, number> = {};
        for (const uid of forUserIds) {
          next[uid] = t.stundenPerMa[uid] ?? 0;
        }
        return { ...t, stundenPerMa: next };
      }),
    }));
  }, [forUserIds]);

  // Bei Datums-/User-Wechsel: bestehenden Eintrag des primaryUsers laden
  useEffect(() => {
    if (!aktuellerEigenerTag) {
      // Form reset wenn auf neuen Tag ohne Daten
      setForm((f) => ({
        ...emptyForm(),
        vmPause: pausen?.vm.default_aktiv ?? true,
        mittagPause: pausen?.mittag.default_aktiv ?? true,
        // Init stundenPerMa für alle selektierten Users
        taetigkeiten: [
          {
            taetigkeit_id: null,
            taetigkeit_freitext: "",
            baustelle_id: null,
            notiz: "",
            stundenPerMa: Object.fromEntries(Array.from(forUserIds).map((uid) => [uid, 0])),
          },
        ],
      }));
      return;
    }
    // Bestehender Tag: Form aus Daten füllen (nur für den primary user)
    const t = aktuellerEigenerTag;
    const tStunden = (uid: string, idx: number, defaultVal: number) =>
      uid === primaryUserId ? defaultVal : 0;
    setForm({
      tagStatus: t.tag.tag_status,
      taetigkeiten:
        t.taetigkeiten.length > 0
          ? t.taetigkeiten.map((tt, idx) => ({
              taetigkeit_id: tt.taetigkeit_id,
              taetigkeit_freitext: tt.taetigkeit_freitext ?? "",
              baustelle_id: tt.baustelle_id,
              notiz: tt.notiz ?? "",
              stundenPerMa: Object.fromEntries(
                Array.from(forUserIds).map((uid) => [
                  uid,
                  tStunden(uid, idx, Number(tt.stunden)),
                ]),
              ),
            }))
          : [
              {
                taetigkeit_id: null,
                taetigkeit_freitext: "",
                baustelle_id: null,
                notiz: "",
                stundenPerMa: Object.fromEntries(
                  Array.from(forUserIds).map((uid) => [
                    uid,
                    uid === primaryUserId ? Number(t.tag.netto_stunden) : 0,
                  ]),
                ),
              },
            ],
      vmPause: t.tag.vm_pause,
      mittagPause: t.tag.mittag_pause,
      arbeitsbeginn: t.tag.arbeitsbeginn?.slice(0, 5) ?? null,
      anmerkung: t.tag.anmerkung ?? "",
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
      fehlzeitStunden: 8,
      fehlzeitBis: "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktuellerEigenerTag?.tag.id, primaryUserId]);

  const isArbeit = form.tagStatus === "baustelle" || form.tagStatus === "firma";
  const selectedMaList = useMemo(() => {
    const ids = Array.from(forUserIds);
    // Self zuerst, Rest nach Nachname
    return ids
      .map((id) => (id === user?.id ? (profile as any as Profile) : allMembers.find((m) => m.id === id)))
      .filter(Boolean) as Profile[];
  }, [forUserIds, allMembers, profile, user]);

  // Netto pro MA + tagZeiten + Soll
  const arbeitsbeginnEffective =
    form.arbeitsbeginn || limits?.arbeitsbeginn_default?.slice(0, 5) || "07:00";
  const summenProMa = useMemo(() => {
    const map = new Map<string, number>();
    for (const uid of forUserIds) {
      let s = 0;
      if (isArbeit) {
        for (const t of form.taetigkeiten) s += Number(t.stundenPerMa[uid] ?? 0);
      } else {
        s = form.fehlzeitStunden;
      }
      map.set(uid, Math.round(s * 100) / 100);
    }
    return map;
  }, [form.taetigkeiten, form.fehlzeitStunden, forUserIds, isArbeit]);

  const summeProTaetigkeit = (zeile: TaetigkeitsZeile) =>
    Array.from(forUserIds).reduce((s, uid) => s + Number(zeile.stundenPerMa[uid] ?? 0), 0);

  const tagZeitenForMa = (uid: string) =>
    berechneTagZeiten({
      nettoStunden: summenProMa.get(uid) ?? 0,
      vmPause: isArbeit ? form.vmPause : false,
      mittagPause: isArbeit ? form.mittagPause : false,
      pausenConfig: {
        vmDauerMin: pausen?.vm.dauer_minuten ?? 20,
        mittagDauerMin: pausen?.mittag.dauer_minuten ?? 30,
      },
      arbeitsbeginn: arbeitsbeginnEffective,
    });

  const saveMut = useSaveStundenTag();
  const deleteMut = useDeleteStundenTag();
  const [busy, setBusy] = useState(false);

  // ─── Submit ──────────────────────────────────────────────────────────
  const submit = async () => {
    if (forUserIds.size === 0) {
      toast({ variant: "destructive", title: "Niemand ausgewählt" });
      return;
    }

    // AZG-Check pro MA — bei Überschreitung Confirm
    if (limits && isArbeit) {
      const violations: string[] = [];
      for (const ma of selectedMaList) {
        const z = tagZeitenForMa(ma.id);
        const ok = pruefArbeitszeitGesetz(z, {
          maxNettoProTag: limits.max_netto_pro_tag,
          maxBruttoProTag: limits.max_brutto_pro_tag,
          arbeitsbeginnDefault: limits.arbeitsbeginn_default,
        });
        if (!ok.ok) violations.push(`${ma.vorname} ${ma.nachname}: ${ok.meldung}`);
      }
      if (violations.length > 0) {
        if (
          !window.confirm(
            `Arbeitszeit-Grenze überschritten:\n${violations.join("\n")}\n\nTrotzdem speichern?`,
          )
        )
          return;
      }
    }

    // Daten für Multi-Tages-Fehlzeit
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
        toast({ variant: "destructive", title: "Keine Werktage im Zeitraum" });
        return;
      }
    }

    setBusy(true);
    let savedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    try {
      // Bestehende Einträge laden um zu wissen welche zu upserten + welche zu überspringen
      for (const dt of dates) {
        const { data: existing } = await supabase
          .from("stunden_tage")
          .select("id, mitarbeiter_id, status")
          .eq("datum", dt)
          .in("mitarbeiter_id", Array.from(forUserIds));
        const existingMap = new Map<string, { id: string; status: string }>();
        (existing ?? []).forEach((r: any) =>
          existingMap.set(r.mitarbeiter_id, { id: r.id, status: r.status }),
        );

        for (const uid of forUserIds) {
          const ma = selectedMaList.find((m) => m.id === uid);
          const maName = ma ? `${ma.vorname} ${ma.nachname}` : "MA";
          const existingEntry = existingMap.get(uid);

          // Bereits bestätigt/freigegeben → überspringen
          if (existingEntry && existingEntry.status !== "erfasst") {
            toast({
              title: `${maName} übersprungen`,
              description: `Tag ${dt} bereits ${existingEntry.status}`,
            });
            skippedCount++;
            continue;
          }

          const nettoFuerMa = isArbeit
            ? form.taetigkeiten.reduce((s, t) => s + Number(t.stundenPerMa[uid] ?? 0), 0)
            : form.fehlzeitStunden;
          // MA ohne Stunden bei Arbeit → überspringen
          if (isArbeit && nettoFuerMa === 0) {
            skippedCount++;
            continue;
          }

          // Zulagen: nur die, die der MA erhalten darf
          let erlaubteZulagenForUid: Set<string>;
          if (uid === primaryUserId) {
            erlaubteZulagenForUid = new Set(erlaubteZulagenIds);
          } else {
            const { data: zRows } = await supabase
              .from("mitarbeiter_zulagen")
              .select("zulagen_typ_id")
              .eq("mitarbeiter_id", uid);
            erlaubteZulagenForUid = new Set(
              (zRows ?? []).map((r: any) => r.zulagen_typ_id),
            );
          }
          const zulagen: SaveZulage[] = isArbeit
            ? Array.from(form.zulagenSelected.entries())
                .filter(([typId]) => erlaubteZulagenForUid.has(typId))
                .map(([typId, val]) => ({
                  zulagen_typ_id: typId,
                  stunden: val.stunden,
                  notiz: val.notiz.trim() || null,
                }))
            : [];

          const taetigkeitenForUid: SaveTaetigkeit[] = isArbeit
            ? form.taetigkeiten
                .filter((t) => Number(t.stundenPerMa[uid] ?? 0) > 0)
                .map((t, idx) => ({
                  position: idx + 1,
                  taetigkeit_id: t.taetigkeit_id,
                  taetigkeit_freitext: t.taetigkeit_id
                    ? null
                    : t.taetigkeit_freitext.trim() || null,
                  baustelle_id: t.baustelle_id,
                  stunden: Number(t.stundenPerMa[uid]),
                  notiz: t.notiz.trim() || null,
                }))
            : [];

          try {
            await saveMut.mutateAsync({
              id: dates.length === 1 ? existingEntry?.id : undefined,
              mitarbeiter_id: uid,
              datum: dt,
              tag_status: form.tagStatus,
              netto_stunden: nettoFuerMa,
              vm_pause: isArbeit ? form.vmPause : false,
              mittag_pause: isArbeit ? form.mittagPause : false,
              arbeitsbeginn: form.arbeitsbeginn,
              anmerkung: form.anmerkung.trim() || null,
              taetigkeiten: taetigkeitenForUid,
              zulagen,
              fahrt: uid === primaryUserId && istPolier && isArbeit ? form.fahrt : null,
            });
            savedCount++;
          } catch (e) {
            errors.push(`${maName}: ${(e as Error).message}`);
          }
        }
      }

      const total = savedCount + skippedCount + errors.length;
      toast({
        title:
          errors.length > 0
            ? `${savedCount} von ${total} gespeichert`
            : skippedCount > 0
            ? `${savedCount} gespeichert · ${skippedCount} übersprungen`
            : `${savedCount} ${savedCount === 1 ? "Eintrag" : "Einträge"} gespeichert`,
        description: errors.length > 0 ? errors.join(", ") : undefined,
        variant: errors.length > 0 ? "destructive" : undefined,
      });

      refetchTage();
      // Form-Reset auf Standardwerte für den nächsten Tag (außer wir editieren grad)
      if (!aktuellerEigenerTag) {
        setForm({
          ...emptyForm(),
          vmPause: pausen?.vm.default_aktiv ?? true,
          mittagPause: pausen?.mittag.default_aktiv ?? true,
          taetigkeiten: [
            {
              taetigkeit_id: null,
              taetigkeit_freitext: "",
              baustelle_id: null,
              notiz: "",
              stundenPerMa: Object.fromEntries(
                Array.from(forUserIds).map((uid) => [uid, 0]),
              ),
            },
          ],
        });
        if (dates.length === 1) {
          const next = new Date(date);
          next.setDate(next.getDate() + 1);
          setDate(localIso(next));
        }
      }
    } finally {
      setBusy(false);
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

  const togglePerson = (uid: string) => {
    setForUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <PageHeader title="Stundenerfassung" />

      {/* Personen-Picker — nur für Polier/Admin */}
      {hasPicker && user && (
        <PersonPicker
          mode={mode}
          partie={polierPartie}
          partien={allPartien}
          members={allMembers}
          selectedIds={forUserIds}
          onToggle={togglePerson}
          onSetSelection={setForUserIds}
          ownUserId={user.id}
          ownProfile={profile as any}
          statusForDate={statusForDateMap}
          search={memberSearch}
          onSearchChange={setMemberSearch}
          date={date}
        />
      )}

      {/* Datum */}
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

      {/* Eigene Tage-Liste (kompakt, der Polier sieht eigene Buchungen) */}
      {tageList.length > 0 && (
        <Card>
          <CardContent className="p-3 space-y-1.5">
            <div className="text-xs font-semibold uppercase text-muted-foreground">
              Meine letzten Tage
            </div>
            {tageList.slice(0, 5).map((t) => (
              <div
                key={t.tag.id}
                className="flex items-center gap-2 text-xs rounded px-2 py-1.5 bg-muted/40"
              >
                <span className="font-bold tabular-nums shrink-0">
                  {fmtH(Number(t.tag.netto_stunden))}
                </span>
                <span className="text-muted-foreground tabular-nums shrink-0">
                  {new Date(t.tag.datum).toLocaleDateString("de-AT", {
                    weekday: "short",
                    day: "2-digit",
                    month: "2-digit",
                  })}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {STATUS_LABELS[t.tag.tag_status]}
                </Badge>
                <span className="flex-1" />
                {t.tag.status === "erfasst" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-destructive"
                    onClick={() => onDeleteTag(t.tag.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Eingabe-Form */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <h3 className="text-base font-bold flex items-center gap-2">
            {aktuellerEigenerTag ? (
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
            {forUserIds.size > 1 && (
              <Badge variant="outline" className="ml-auto">
                {forUserIds.size} Mitarbeiter
              </Badge>
            )}
          </h3>

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

          {/* Matrix (bei Arbeit) */}
          {isArbeit && (
            <MatrixEditor
              taetigkeiten={form.taetigkeiten}
              selectedMa={selectedMaList}
              taetigkeitenStamm={taetigkeitenStamm}
              baustellen={baustellen}
              onChange={(neue) => setForm((f) => ({ ...f, taetigkeiten: neue }))}
              summenProMa={summenProMa}
            />
          )}

          {/* Fehlzeit-Eingabe */}
          {!isArbeit && (
            <div className="space-y-2 border-t pt-3">
              <Label className="text-sm font-semibold">Stunden pro Tag</Label>
              <div className="flex items-stretch gap-2">
                <Button
                  variant="outline"
                  className="h-12 w-12 shrink-0"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      fehlzeitStunden: Math.max(0, +(f.fehlzeitStunden - 0.25).toFixed(2)),
                    }))
                  }
                >
                  <Minus className="h-5 w-5" />
                </Button>
                <Input
                  type="number"
                  step={0.25}
                  min={0}
                  value={form.fehlzeitStunden}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      fehlzeitStunden: Math.max(0, Number(e.target.value) || 0),
                    }))
                  }
                  className="h-12 text-center text-xl font-bold tabular-nums"
                />
                <span className="h-12 flex items-center px-2 text-sm font-medium text-muted-foreground">
                  h
                </span>
                <Button
                  variant="outline"
                  className="h-12 w-12 shrink-0"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      fehlzeitStunden: +(f.fehlzeitStunden + 0.25).toFixed(2),
                    }))
                  }
                >
                  <Plus className="h-5 w-5" />
                </Button>
              </div>
              <div className="space-y-1 pt-2">
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
                    Wochenenden und Feiertage werden übersprungen.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Pausen (nur Arbeit, global pro Tag) */}
          {isArbeit && pausen && (
            <div className="space-y-2 border-t pt-3">
              <Label className="text-sm font-semibold flex items-center gap-1.5">
                <Coffee className="h-4 w-4 text-primary" />
                Pausen (werden auf die Anwesenheit aufgeschlagen)
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
                    <span className="text-muted-foreground">
                      ({pausen.mittag.dauer_minuten} min)
                    </span>
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Zulagen */}
          {isArbeit && erlaubteZulagenIds.length > 0 && (
            <div className="space-y-2 border-t pt-3">
              <Label className="text-sm font-semibold">Zulagen (gilt für alle mit Berechtigung)</Label>
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
                        {active && sel?.stunden != null && (
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
                      placeholder="alle Std"
                      className="h-8 w-32 text-right"
                    />
                    <span className="text-muted-foreground">h (leer = alle)</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Fahrt nur für Polier-Self */}
          {isArbeit && istPolier && forUserIds.has(primaryUserId) && (
            <FahrtSection
              fahrt={form.fahrt}
              setFahrt={(fahrt) => setForm((f) => ({ ...f, fahrt }))}
              baustelle={
                baustellen.find((b) => b.id === form.taetigkeiten[0]?.baustelle_id) ?? null
              }
            />
          )}

          {/* Anmerkung */}
          <div className="space-y-1 border-t pt-3">
            <Label className="text-sm">Anmerkung (optional)</Label>
            <div className="flex items-start gap-1.5">
              <Textarea
                value={form.anmerkung}
                onChange={(e) => setForm((f) => ({ ...f, anmerkung: e.target.value }))}
                rows={2}
                className="flex-1"
              />
              <MicButton
                onText={(text) =>
                  setForm((f) => ({
                    ...f,
                    anmerkung: f.anmerkung ? `${f.anmerkung} ${text}` : text,
                  }))
                }
                className="h-9 w-9"
              />
            </div>
          </div>

          {/* Zusammenfassung pro MA */}
          {selectedMaList.length > 0 && (
            <ZusammenfassungCard
              selectedMa={selectedMaList}
              summenProMa={summenProMa}
              isArbeit={isArbeit}
              primaryUserId={primaryUserId}
              primarySoll={primarySoll}
              vmPause={form.vmPause}
              mittagPause={form.mittagPause}
              pausen={pausen}
              arbeitsbeginn={arbeitsbeginnEffective}
              limits={limits}
            />
          )}

          {/* Submit */}
          <Button onClick={submit} disabled={busy} className="w-full h-12 text-base">
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {forUserIds.size > 1
              ? `Für ${forUserIds.size} Mitarbeiter speichern`
              : aktuellerEigenerTag
              ? "Änderungen speichern"
              : "Tag speichern"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Matrix-Editor ──────────────────────────────────────────────────────

function MatrixEditor({
  taetigkeiten,
  selectedMa,
  taetigkeitenStamm,
  baustellen,
  onChange,
  summenProMa,
}: {
  taetigkeiten: TaetigkeitsZeile[];
  selectedMa: Profile[];
  taetigkeitenStamm: Database["public"]["Tables"]["taetigkeiten_stamm"]["Row"][];
  baustellen: Baustelle[];
  onChange: (neue: TaetigkeitsZeile[]) => void;
  summenProMa: Map<string, number>;
}) {
  const isMulti = selectedMa.length > 1;

  const addZeile = () => {
    onChange([
      ...taetigkeiten,
      {
        taetigkeit_id: null,
        taetigkeit_freitext: "",
        baustelle_id: taetigkeiten[taetigkeiten.length - 1]?.baustelle_id ?? null,
        notiz: "",
        stundenPerMa: Object.fromEntries(selectedMa.map((m) => [m.id, 0])),
      },
    ]);
  };

  const updateZeile = (idx: number, patch: Partial<TaetigkeitsZeile>) => {
    const next = [...taetigkeiten];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const setStunden = (idx: number, uid: string, val: number) => {
    const next = [...taetigkeiten];
    next[idx] = {
      ...next[idx],
      stundenPerMa: { ...next[idx].stundenPerMa, [uid]: Math.max(0, val || 0) },
    };
    onChange(next);
  };

  const removeZeile = (idx: number) => {
    onChange(taetigkeiten.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold flex items-center gap-1.5">
          <Tag className="h-4 w-4 text-primary" />
          Tätigkeiten
        </Label>
        <Button size="sm" variant="outline" onClick={addZeile}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Tätigkeit
        </Button>
      </div>

      {taetigkeiten.map((t, idx) => (
        <div key={idx} className="rounded-md border p-2.5 space-y-2 bg-muted/20">
          {/* Tätigkeit + Baustelle */}
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={t.taetigkeit_id ?? ""}
              onChange={(e) => updateZeile(idx, { taetigkeit_id: e.target.value || null })}
              className="h-10 flex-1 min-w-0 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">— Tätigkeit wählen —</option>
              {taetigkeitenStamm.map((tt) => (
                <option key={tt.id} value={tt.id}>
                  {tt.bezeichnung}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive shrink-0 h-8 w-8 p-0"
              onClick={() => removeZeile(idx)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          {!t.taetigkeit_id && (
            <Input
              placeholder="Oder Freitext"
              value={t.taetigkeit_freitext}
              onChange={(e) => updateZeile(idx, { taetigkeit_freitext: e.target.value })}
              className="h-9 text-sm"
            />
          )}
          <BaustelleCombobox
            baustellen={baustellen}
            value={t.baustelle_id ?? ""}
            onChange={(v) => updateZeile(idx, { baustelle_id: v || null })}
            allowClear
          />

          {/* Stunden-Eingabe */}
          {!isMulti && selectedMa[0] && (
            // Single-MA: ein Stunden-Feld
            <StundenZelle
              value={t.stundenPerMa[selectedMa[0].id] ?? 0}
              onChange={(v) => setStunden(idx, selectedMa[0].id, v)}
              big
            />
          )}
          {isMulti && (
            // Multi-MA: Zellen pro MA
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Stunden pro Mitarbeiter
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {selectedMa.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center gap-1.5 bg-background border rounded p-1.5"
                  >
                    <span className="text-[11px] font-medium truncate flex-1">
                      {m.vorname}
                    </span>
                    <StundenZelle
                      value={t.stundenPerMa[m.id] ?? 0}
                      onChange={(v) => setStunden(idx, m.id, v)}
                    />
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-muted-foreground text-right">
                Σ {fmtHNum(
                  selectedMa.reduce((s, m) => s + Number(t.stundenPerMa[m.id] ?? 0), 0),
                )}{" "}
                h
              </div>
            </div>
          )}

          {/* Notiz */}
          <Input
            placeholder="Notiz (optional)"
            value={t.notiz}
            onChange={(e) => updateZeile(idx, { notiz: e.target.value })}
            className="h-9 text-sm"
          />
        </div>
      ))}

      {isMulti && (
        <div className="bg-primary/5 border border-primary/20 rounded-md p-2 text-xs flex items-center justify-between flex-wrap gap-1">
          <span className="font-semibold">Netto pro Mitarbeiter:</span>
          {selectedMa.map((m) => (
            <span key={m.id} className="tabular-nums">
              <strong>{m.vorname}</strong>: {fmtH(summenProMa.get(m.id) ?? 0)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function StundenZelle({
  value,
  onChange,
  big = false,
}: {
  value: number;
  onChange: (v: number) => void;
  big?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={big ? "h-12 w-12 shrink-0" : "h-7 w-7 shrink-0 p-0"}
        onClick={() => onChange(Math.max(0, +(value - 0.25).toFixed(2)))}
      >
        <Minus className={big ? "h-5 w-5" : "h-3 w-3"} />
      </Button>
      <Input
        type="number"
        step={0.25}
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className={`${big ? "h-12 text-xl font-bold" : "h-7 text-sm"} text-center tabular-nums ${
          big ? "" : "w-14"
        }`}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={big ? "h-12 w-12 shrink-0" : "h-7 w-7 shrink-0 p-0"}
        onClick={() => onChange(+(value + 0.25).toFixed(2))}
      >
        <Plus className={big ? "h-5 w-5" : "h-3 w-3"} />
      </Button>
      {big && (
        <span className="h-12 flex items-center px-1 text-sm font-medium text-muted-foreground">
          h
        </span>
      )}
    </div>
  );
}

// ─── FahrtSection (Polier-Self) ────────────────────────────────────────

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
          Fahrt &amp; Diäten (Polier)
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
              <Label className="text-xs cursor-pointer">Privat-PKW</Label>
            </div>
          </div>
          {fahrt.privat_pkw && (
            <div className="space-y-1">
              <Label className="text-xs">Kilometer</Label>
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
              <Label className="text-xs">Taggeld kurz</Label>
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
              <Label className="text-xs">Taggeld lang</Label>
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

// ─── ZusammenfassungCard ────────────────────────────────────────────────

function ZusammenfassungCard({
  selectedMa,
  summenProMa,
  isArbeit,
  primaryUserId,
  primarySoll,
  vmPause,
  mittagPause,
  pausen,
  arbeitsbeginn,
  limits,
}: {
  selectedMa: Profile[];
  summenProMa: Map<string, number>;
  isArbeit: boolean;
  primaryUserId: string;
  primarySoll: number;
  vmPause: boolean;
  mittagPause: boolean;
  pausen: { vm: any; mittag: any } | undefined;
  arbeitsbeginn: string;
  limits:
    | { max_netto_pro_tag: number; max_brutto_pro_tag: number; arbeitsbeginn_default: string }
    | undefined;
}) {
  return (
    <div className="rounded-lg border bg-primary/5 border-primary/20 p-3 space-y-1.5">
      <div className="text-[11px] font-semibold uppercase text-primary">Zusammenfassung</div>
      {selectedMa.map((m) => {
        const netto = summenProMa.get(m.id) ?? 0;
        const z = pausen
          ? berechneTagZeiten({
              nettoStunden: netto,
              vmPause: isArbeit ? vmPause : false,
              mittagPause: isArbeit ? mittagPause : false,
              pausenConfig: {
                vmDauerMin: pausen.vm.dauer_minuten,
                mittagDauerMin: pausen.mittag.dauer_minuten,
              },
              arbeitsbeginn,
            })
          : null;
        const soll = m.id === primaryUserId ? primarySoll : 0;
        const ueber = z ? ueberstundenForTag(z, soll) : { diff: 0, istUeberstunde: false };
        const azg = z && limits
          ? pruefArbeitszeitGesetz(z, {
              maxNettoProTag: limits.max_netto_pro_tag,
              maxBruttoProTag: limits.max_brutto_pro_tag,
              arbeitsbeginnDefault: limits.arbeitsbeginn_default,
            })
          : { ok: true as const };
        return (
          <div
            key={m.id}
            className="flex items-center gap-2 flex-wrap text-xs border-t border-primary/10 pt-1.5 first:border-0 first:pt-0"
          >
            <span className="font-semibold w-28 truncate">
              {m.vorname} {m.nachname[0] ?? ""}.
            </span>
            <span className="tabular-nums font-bold">{fmtH(netto)}</span>
            {z && isArbeit && (
              <>
                <span className="text-muted-foreground tabular-nums">
                  Anwesenheit {fmtH(z.bruttoAnwesenheit)}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {z.von}–{z.bis}
                </span>
              </>
            )}
            {m.id === primaryUserId && soll > 0 && (
              <span
                className={
                  ueber.diff > 0
                    ? "text-emerald-700 tabular-nums"
                    : ueber.diff < 0
                    ? "text-amber-700 tabular-nums"
                    : "text-muted-foreground tabular-nums"
                }
              >
                Soll {fmtH(soll)}
                {ueber.diff !== 0 && (
                  <>
                    {" "}
                    ({ueber.diff > 0 ? "+" : "−"}
                    {fmtHNum(Math.abs(ueber.diff))})
                  </>
                )}
              </span>
            )}
            {!azg.ok && (
              <Badge variant="outline" className="text-[10px] bg-destructive/10 border-destructive text-destructive">
                <AlertTriangle className="h-3 w-3 mr-1" /> {azg.meldung}
              </Badge>
            )}
          </div>
        );
      })}
    </div>
  );
}
