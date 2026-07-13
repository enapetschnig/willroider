import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, ChevronLeft, ChevronRight, ChevronDown, Filter, UserPlus, X, Trash2, Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BaustellenmeldungForm } from "@/components/BaustellenmeldungForm";
import { PoliereinsatzView } from "@/components/arbeitsplanung/PoliereinsatzView";
import { useToast } from "@/hooks/use-toast";
import type { Database, TagStatus } from "@/integrations/supabase/types";
import {
  feiertagAt,
  isWerktag,
  werktagePlus,
  naechsterWerktag,
  type FeiertagInfo,
} from "@/lib/feiertage";
import { localIso } from "@/lib/dateFmt";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Fahrzeug = Database["public"]["Tables"]["fahrzeuge"]["Row"];

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfISOWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay() || 7;
  if (day !== 1) date.setDate(date.getDate() - (day - 1));
  date.setHours(0, 0, 0, 0);
  return date;
}

function isoWeek(d: Date): { year: number; week: number } {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  const week =
    1 +
    Math.round(((date.getTime() - week1.getTime()) / DAY_MS - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return { year: date.getFullYear(), week };
}

type AssignmentCell = {
  source: "einteilung" | "fehlzeit";
  refId: string;
  einteilungId?: string;
  baustelleId?: string | null;
  baustelleName?: string;
  baustelleColor?: string;
  fehlzeitTyp?: string;
  status?: string;
  isReadOnly?: boolean;
};

const FEHLZEIT_LABEL: Record<string, string> = {
  U: "Urlaub",
  K: "Krank",
  F: "Feiertag",
  SW: "Schlechtwetter",
};
const FEHLZEIT_COLOR: Record<string, string> = {
  U: "#3b82f6",
  K: "#ef4444",
  F: "#8b5cf6",
  SW: "#f59e0b",
};
// Mapping Planungs-Code → stunden_tage.tag_status (Enum der Zeiterfassung).
// Fehlzeiten werden in stunden_tage geschrieben — die einzige Tabelle, die
// Zeiterfassung/BSB/Auswertung/Lohn lesen (stundenbuchungen ist Legacy).
const FEHLZEIT_TAG_STATUS: Record<string, TagStatus> = {
  U: "urlaub",
  K: "krank",
  F: "feiertag",
  SW: "schlechtwetter",
};
// Rück-Mapping tag_status → Planungs-Code (für Anzeige im Gantt)
const TAG_STATUS_CODE: Record<string, string> = {
  urlaub: "U",
  krank: "K",
  feiertag: "F",
  schlechtwetter: "SW",
};
const FEHLZEIT_TAG_STATI = Object.keys(TAG_STATUS_CODE) as TagStatus[];

const cellKey = (workerId: string, iso: string) => `${workerId}:${iso}`;
const isoDate = (d: Date) => localIso(d);

export default function Arbeitsplanung() {
  const { canCreateBaustelle, isAdmin, user } = useAuth();
  const { toast } = useToast();
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [partien, setPartien] = useState<Partie[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [fahrzeuge, setFahrzeuge] = useState<Fahrzeug[]>([]);
  const [filterPartie, setFilterPartie] = useState<string>("alle");
  /** Ansicht: MA-Zeilen (klassisch) oder Poliereinsatz (MS-Project-Stil). */
  const [ansicht, setAnsicht] = useState<"ma" | "polier">("ma");
  const [weeksVisible, setWeeksVisible] = useState(20);
  const [anchorWeek, setAnchorWeek] = useState<Date>(() => {
    const today = new Date();
    today.setDate(today.getDate() - 14); // start 2 weeks ago
    return startOfISOWeek(today);
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Baustelle> | null>(null);
  const [partieDialog, setPartieDialog] = useState(false);
  const [editingPartieId, setEditingPartieId] = useState<string | null>(null);
  const [newPartieName, setNewPartieName] = useState("");
  const [newPartieFarbe, setNewPartieFarbe] = useState("#3b82f6");
  const [newPartieleiterId, setNewPartieleiterId] = useState("");

  const openPartieEditor = (partie?: Partie | null) => {
    if (partie) {
      setEditingPartieId(partie.id);
      setNewPartieName(partie.name);
      setNewPartieFarbe(partie.farbcode || "#3b82f6");
      setNewPartieleiterId(partie.partieleiter_id ?? "");
    } else {
      setEditingPartieId(null);
      setNewPartieName("");
      setNewPartieFarbe("#3b82f6");
      setNewPartieleiterId("");
    }
    setPartieDialog(true);
  };
  const closePartieEditor = () => {
    setPartieDialog(false);
    setEditingPartieId(null);
    setNewPartieName("");
    setNewPartieFarbe("#3b82f6");
    setNewPartieleiterId("");
  };
  const [assignments, setAssignments] = useState<Map<string, AssignmentCell>>(new Map());
  // Lock gegen Doppelklick auf Bestätigungs-Dialoge (assignBaustelle/setFehlzeit/clearCells)
  const assignBusyRef = useRef(false);
  // Busy-State für setFehlzeit/clearCells: guarded gegen Doppelklick
  // (erzeugte doppelte Zeilen) und disabled die Popover-Buttons
  const [cellActionBusy, setCellActionBusy] = useState(false);
  const [selectionAnchor, setSelectionAnchor] = useState<{ workerId: string; iso: string } | null>(
    null
  );
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [dragAnchor, setDragAnchor] = useState<{ workerId: string; iso: string } | null>(null);
  const [dragHover, setDragHover] = useState<{ workerId: string; iso: string } | null>(null);
  const [popover, setPopover] = useState<{
    workerId: string;
    cells: { workerId: string; iso: string }[];
    anchor: { x: number; y: number };
  } | null>(null);
  // Eingeklappte Partien (reine Anzeige) + aktiver Drag auf einem Partie-Überbalken
  const [collapsedPartien, setCollapsedPartien] = useState<Set<string>>(new Set());
  const [partieDrag, setPartieDrag] = useState<{
    partieId: string;
    anchorIdx: number;
    hoverIdx: number;
  } | null>(null);
  const toggleCollapse = (pid: string) =>
    setCollapsedPartien((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  const dayWidth = 22; // px

  const load = async () => {
    const [bs, p, pr, fz] = await Promise.all([
      supabase.from("baustellen").select("*").order("start_datum", { ascending: true }),
      supabase.from("partien").select("*").order("name"),
      supabase.from("profiles").select("*"),
      // Anlagen (Werkstatt-Maschinen, Stapler) sind nicht für Einteilungen
      supabase
        .from("fahrzeuge")
        .select("*")
        .eq("aktiv", true)
        .in("kategorie", ["baustelle", "bauleiter"])
        .order("inventar_nr"),
    ]);
    setBaustellen((bs.data as Baustelle[]) ?? []);
    // Sortierung: Werkvorfertigung immer oben, „Lager" immer unten,
    // alle anderen alphabetisch dazwischen.
    const partieRang = (name: string) =>
      name === "Werkvorfertigung" ? 0 : name === "Lager" ? 2 : 1;
    const sortedPartien = ((p.data as Partie[]) ?? []).sort(
      (a, b) =>
        partieRang(a.name) - partieRang(b.name) || a.name.localeCompare(b.name),
    );
    setPartien(sortedPartien);
    setProfiles((pr.data as Profile[]) ?? []);
    setFahrzeuge((fz.data as Fahrzeug[]) ?? []);
  };

  const loadAssignments = async () => {
    const startIso = isoDate(rangeStart);
    const endIso = isoDate(new Date(rangeStart.getTime() + (totalDays - 1) * DAY_MS));
    const [{ data: emRows }, { data: fzRows }] = await Promise.all([
      supabase
        .from("jahresplan_mitarbeiter")
        .select(
          "id, mitarbeiter_id, einteilung_id, einteilungen:jahresplan_einteilungen!inner(id, datum, baustelle_id, baustellen(bvh_name))"
        )
        .gte("einteilungen.datum", startIso)
        .lte("einteilungen.datum", endIso),
      // Fehlzeiten aus stunden_tage — dieselbe Quelle, die auch
      // Zeiterfassung/BSB/Lohn lesen (stundenbuchungen ist Legacy)
      supabase
        .from("stunden_tage")
        .select("id, mitarbeiter_id, datum, tag_status, status")
        .gte("datum", startIso)
        .lte("datum", endIso)
        .in("tag_status", FEHLZEIT_TAG_STATI),
    ]);
    const map = new Map<string, AssignmentCell>();
    (emRows ?? []).forEach((r: any) => {
      const e = r.einteilungen;
      if (!e?.datum) return;
      const b = baustellen.find((x) => x.id === e.baustelle_id);
      const partie = b?.partie_id ? partienById[b.partie_id] : null;
      map.set(cellKey(r.mitarbeiter_id, e.datum), {
        source: "einteilung",
        refId: r.id,
        einteilungId: r.einteilung_id,
        baustelleId: e.baustelle_id,
        baustelleName: e.baustellen?.bvh_name ?? b?.bvh_name ?? "Bauhof",
        baustelleColor: partie?.farbcode ?? "#6b7280",
      });
    });
    (fzRows ?? []).forEach((r: any) => {
      // Fehlzeit überschreibt Einteilung (Mitarbeiter nicht da)
      map.set(cellKey(r.mitarbeiter_id, r.datum), {
        source: "fehlzeit",
        refId: r.id,
        fehlzeitTyp: TAG_STATUS_CODE[r.tag_status] ?? r.tag_status,
        status: r.status,
        // Bereits im Freigabe-Workflow → Planung darf nicht mehr ändern
        isReadOnly: r.status !== "erfasst" && r.status !== "ma_bestaetigt",
      });
    });
    setAssignments(map);
  };

  useEffect(() => {
    load();

    const ch = supabase
      .channel("planung-bs")
      .on("postgres_changes", { event: "*", schema: "public", table: "baustellen" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "jahresplan_einteilungen" }, () => loadAssignments())
      .on("postgres_changes", { event: "*", schema: "public", table: "jahresplan_mitarbeiter" }, () => loadAssignments())
      .on("postgres_changes", { event: "*", schema: "public", table: "stunden_tage" }, () => loadAssignments())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  useEffect(() => {
    loadAssignments();
  }, [anchorWeek, weeksVisible, baustellen, partien]);

  const totalDays = weeksVisible * 7;
  const rangeStart = anchorWeek;
  const rangeEnd = new Date(anchorWeek.getTime() + totalDays * DAY_MS);

  // dayHeaders vor barsByWorker, weil Bars die Tag-Indizes brauchen
  const dayHeaders = useMemo(() => {
    const days: {
      date: Date;
      week: number;
      year: number;
      isMonday: boolean;
      isToday: boolean;
      feiertag: FeiertagInfo | null;
    }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(rangeStart.getTime() + i * DAY_MS);
      const w = isoWeek(d);
      const iso = isoDate(d);
      days.push({
        date: d,
        week: w.week,
        year: w.year,
        isMonday: d.getDay() === 1,
        isToday: d.getTime() === today.getTime(),
        feiertag: feiertagAt(iso),
      });
    }
    return days;
  }, [rangeStart, totalDays]);

  const partienById = useMemo(() => Object.fromEntries(partien.map((p) => [p.id, p])), [partien]);
  const profilesById = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);

  const membersByPartie = useMemo(() => {
    const m: Record<string, Profile[]> = {};
    profiles.forEach((p) => {
      if (p.partie_id) {
        (m[p.partie_id] = m[p.partie_id] || []).push(p);
      }
    });
    return m;
  }, [profiles]);

  const polierName = (partie: Partie | null) => {
    if (!partie?.partieleiter_id) return null;
    const p = profilesById[partie.partieleiter_id];
    return p ? `${p.vorname} ${p.nachname}`.trim() : null;
  };

  const unassignedMembers = useMemo(
    () => profiles.filter((p) => !p.partie_id && p.is_active),
    [profiles]
  );

  const workerGroups = useMemo(() => {
    const groups: { partie: Partie | null; members: Profile[] }[] = [];
    const filtered =
      filterPartie === "alle"
        ? partien
        : partien.filter((p) => p.id === filterPartie);
    // Alle gefilterten Partien rendern — auch leere, damit man MA per Drag
    // hineinziehen kann. MA ohne Partie (Fallback) landen in „Werkvorfertigung".
    const wvf = partien.find((p) => p.name === "Werkvorfertigung");
    filtered.forEach((p) => {
      let members = (membersByPartie[p.id] ?? []).filter((m) => m.is_active !== false);
      if (wvf && p.id === wvf.id && unassignedMembers.length > 0) {
        members = [...members, ...unassignedMembers];
      }
      groups.push({ partie: p, members });
    });
    return groups;
  }, [partien, membersByPartie, unassignedMembers, filterPartie]);

  const activeBaustellen = useMemo(
    () => baustellen.filter((b) => b.status === "aktiv" || b.status === "geplant"),
    [baustellen]
  );

  // Flache Mitarbeiter-Reihenfolge aus den workerGroups — nötig für Cross-Row-Selection
  const flatWorkerIds = useMemo(
    () => workerGroups.flatMap((g) => g.members.map((m) => m.id)),
    [workerGroups]
  );
  const workerIdx = useMemo(() => {
    const m = new Map<string, number>();
    flatWorkerIds.forEach((id, i) => m.set(id, i));
    return m;
  }, [flatWorkerIds]);

  // Bars: pro Mitarbeiter zusammenhängende Segmente gleicher Einteilung/Fehlzeit
  type Bar = {
    workerId: string;
    startIdx: number; // Index in dayHeaders (visueller Anfang)
    endIdx: number;   // inklusive (visuelles Ende)
    color: string;
    label: string; // BVH-Name oder Fehlzeit-Typ-Label
    source: "einteilung" | "fehlzeit";
    baustelleId?: string | null;
    fehlzeitTyp?: string;
    isReadOnly: boolean;
    einteilungIds: Set<string>;
    /** Tatsächlich belegte dayHeader-Indizes (nur Werktage) — Wochenenden/
     *  Feiertage im visuellen Span sind NICHT enthalten. */
    assignedIdx: Set<number>;
  };
  const barsByWorker = useMemo(() => {
    const result = new Map<string, Bar[]>();
    if (workerGroups.length === 0 || dayHeaders.length === 0) return result;
    for (const g of workerGroups) {
      for (const m of g.members) {
        const bars: Bar[] = [];
        let cur: Bar | null = null;
        // Nicht-Werktag-Indizes seit dem letzten echten Assignment — werden
        // erst dann in den Bar übernommen, wenn er danach fortgesetzt wird.
        let pendingGap: number[] = [];
        for (let i = 0; i < dayHeaders.length; i++) {
          const iso = isoDate(dayHeaders[i].date);
          const a = assignments.get(cellKey(m.id, iso));
          const werktag = isWerktag(dayHeaders[i].date);
          if (!a) {
            if (cur && !werktag) {
              // Sa/So/Feiertag mit offenem Bar → evtl. Brücke, noch nicht committen
              pendingGap.push(i);
            } else {
              // echte Lücke (Werktag ohne Einteilung) → Bar endet
              cur = null;
              pendingGap = [];
            }
            continue;
          }
          const key =
            a.source === "fehlzeit"
              ? `f:${a.fehlzeitTyp ?? ""}`
              : `e:${a.baustelleId ?? "x"}`;
          if (cur && (cur as any)._key === key) {
            // Fortsetzung — Wochenend-Lücke in den visuellen Span aufnehmen
            pendingGap = [];
            cur.endIdx = i;
            cur.assignedIdx.add(i);
            if (a.einteilungId) cur.einteilungIds.add(a.einteilungId);
            cur.isReadOnly = cur.isReadOnly && !!a.isReadOnly;
            continue;
          }
          // Neuer Bar
          pendingGap = [];
          const color =
            a.source === "fehlzeit"
              ? FEHLZEIT_COLOR[a.fehlzeitTyp ?? "U"] ?? "#6b7280"
              : a.baustelleColor ?? "#6b7280";
          const label =
            a.source === "fehlzeit"
              ? FEHLZEIT_LABEL[a.fehlzeitTyp ?? ""] ?? a.fehlzeitTyp ?? ""
              : a.baustelleName ?? "BV";
          cur = {
            workerId: m.id,
            startIdx: i,
            endIdx: i,
            color,
            label,
            source: a.source,
            baustelleId: a.baustelleId,
            fehlzeitTyp: a.fehlzeitTyp,
            isReadOnly: !!a.isReadOnly,
            einteilungIds: new Set(a.einteilungId ? [a.einteilungId] : []),
            assignedIdx: new Set([i]),
          };
          (cur as any)._key = key;
          bars.push(cur);
        }
        if (bars.length > 0) result.set(m.id, bars);
      }
    }
    return result;
  }, [workerGroups, dayHeaders, assignments]);

  // ─── Partie-Konsens: gemeinsame Einteilung aller anwesenden Mitglieder ──
  // Pro Partie ein Array über dayHeaders: an einem Tag gefüllt, wenn ALLE
  // nicht-abwesenden Mitglieder dieselbe Baustelle haben.
  const partieConsensus = useMemo(() => {
    const result = new Map<
      string,
      ({ baustelleId: string | null; color: string; label: string } | null)[]
    >();
    if (dayHeaders.length === 0) return result;
    for (const g of workerGroups) {
      const pid = g.partie?.id;
      if (!pid || g.members.length === 0) continue;
      const arr: ({ baustelleId: string | null; color: string; label: string } | null)[] =
        [];
      for (let i = 0; i < dayHeaders.length; i++) {
        const iso = isoDate(dayHeaders[i].date);
        let consensus: AssignmentCell | null = null;
        let valid = true;
        for (const m of g.members) {
          const a = assignments.get(cellKey(m.id, iso));
          if (a?.source === "fehlzeit") continue; // abwesend → ignorieren
          if (a?.source === "einteilung") {
            if (!consensus) consensus = a;
            else if ((consensus.baustelleId ?? "x") !== (a.baustelleId ?? "x")) {
              valid = false;
              break;
            }
          } else {
            valid = false; // weder abwesend noch eingeteilt → kein Konsens
            break;
          }
        }
        arr.push(
          valid && consensus
            ? {
                baustelleId: consensus.baustelleId ?? null,
                color: consensus.baustelleColor ?? "#6b7280",
                label: consensus.baustelleName ?? "BV",
              }
            : null,
        );
      }
      result.set(pid, arr);
    }
    return result;
  }, [workerGroups, dayHeaders, assignments]);

  // ─── Bar-Drag: Blöcke verschieben / verlängern / verkürzen ──────────────
  const dayIsoByIdx = useMemo(
    () => dayHeaders.map((d) => isoDate(d.date)),
    [dayHeaders],
  );

  type BarDrag = {
    bar: Bar;
    mode: "move" | "resize-l" | "resize-r";
    pointerStartIdx: number;
    pointerStart: { x: number; y: number };
    active: boolean;
    preview: { workerId: string; cellIsos: string[] } | null;
  };
  const [barDrag, setBarDrag] = useState<BarDrag | null>(null);

  /** Info-Popup beim Antippen eines Balkens: voller Baustellenname, KST,
   *  Zeitraum. Schmale 1-Tages-Balken zeigen sonst nur 2 Buchstaben —
   *  am Tablet gibt es keinen Hover-Tooltip. */
  const [barInfo, setBarInfo] = useState<{
    bar: Bar;
    dateRange: string;
    anchor: { x: number; y: number };
    cells: { workerId: string; iso: string }[];
  } | null>(null);

  /** Werktag-ISOs zwischen zwei Daten (inklusive). */
  const werktageZwischen = (aIso: string, bIso: string): string[] => {
    const res: string[] = [];
    const d = new Date(aIso + "T00:00:00");
    const end = new Date(bIso + "T00:00:00");
    while (d <= end) {
      if (isWerktag(d)) res.push(isoDate(d));
      d.setDate(d.getDate() + 1);
    }
    return res;
  };

  const onBarPointerDown = (
    e: React.PointerEvent,
    bar: Bar,
    mode: BarDrag["mode"],
  ) => {
    if (!isAdmin || bar.isReadOnly) return;
    e.stopPropagation();
    e.preventDefault();
    const row = (e.currentTarget as HTMLElement).closest(
      "[data-row='1']",
    ) as HTMLElement | null;
    let idx = bar.startIdx;
    if (row) {
      const rect = row.getBoundingClientRect();
      idx = Math.max(
        0,
        Math.min(dayHeaders.length - 1, Math.floor((e.clientX - rect.left) / dayWidth)),
      );
    }
    setBarDrag({
      bar,
      mode,
      pointerStartIdx: idx,
      pointerStart: { x: e.clientX, y: e.clientY },
      active: false,
      preview: null,
    });
  };

  /** Wendet einen abgeschlossenen Bar-Drag an: alte Zellen löschen, neue setzen. */
  const applyBarDrag = async (bd: BarDrag) => {
    if (!bd.preview) return;
    const bar = bd.bar;
    const alteCells = [...bar.assignedIdx].map((i) => ({
      workerId: bar.workerId,
      iso: dayIsoByIdx[i],
    }));
    // Harte Sicherung: niemals Sa/So/Feiertag belegen — egal was die
    // Preview liefert.
    const neueCells = bd.preview.cellIsos
      .filter((iso) => isWerktag(iso))
      .map((iso) => ({
        workerId: bd.preview!.workerId,
        iso,
      }));
    const sameSet =
      alteCells.length === neueCells.length &&
      alteCells.every((c) =>
        neueCells.some((n) => n.workerId === c.workerId && n.iso === c.iso),
      );
    if (sameSet) return;
    // Beide Schritte prüfen: schlägt das Löschen fehl, gar nicht erst neu
    // schreiben; schlägt das Schreiben fehl, zeigt der Reload den echten
    // DB-Zustand (vorher radierte ein Teilfehler den Block stillschweigend aus)
    if (!(await clearCellsRaw(alteCells))) {
      loadAssignments();
      return;
    }
    let ok = true;
    if (bar.source === "einteilung" && bar.baustelleId) {
      ok = await assignBaustelle(neueCells, bar.baustelleId, {
        wochenendeIncluden: false,
      });
    } else if (bar.source === "fehlzeit" && bar.fehlzeitTyp) {
      ok = await setFehlzeit(neueCells, bar.fehlzeitTyp);
    }
    if (!ok) {
      // Fehler-Toast kam bereits aus assignBaustelle/setFehlzeit —
      // hier nur sicherstellen, dass die UI den echten Zustand zeigt
      loadAssignments();
      return;
    }
    loadAssignments();
  };

  // Globales Drag-Tracking für Bar-Move/Resize
  useEffect(() => {
    if (!barDrag) return;

    const findAt = (x: number, y: number): { workerId: string; idx: number } | null => {
      const stack = (document.elementsFromPoint(x, y) as HTMLElement[]) ?? [];
      for (const el of stack) {
        const row = el.closest?.("[data-row='1']") as HTMLElement | null;
        if (row && row.dataset.worker) {
          const rect = row.getBoundingClientRect();
          const idx = Math.max(
            0,
            Math.min(dayHeaders.length - 1, Math.floor((x - rect.left) / dayWidth)),
          );
          return { workerId: row.dataset.worker, idx };
        }
      }
      return null;
    };

    const computePreview = (
      workerId: string,
      idx: number,
    ): BarDrag["preview"] => {
      const bar = barDrag.bar;
      const assigned = [...bar.assignedIdx].sort((a, b) => a - b);
      const count = assigned.length;
      if (count === 0) return null;
      const firstIso = dayIsoByIdx[assigned[0]];
      const lastIso = dayIsoByIdx[assigned[count - 1]];
      if (barDrag.mode === "move") {
        const delta = idx - barDrag.pointerStartIdx;
        const startIdx = Math.max(
          0,
          Math.min(dayHeaders.length - 1, assigned[0] + delta),
        );
        let startIso = dayIsoByIdx[startIdx];
        if (!isWerktag(startIso)) startIso = isoDate(naechsterWerktag(startIso));
        return { workerId, cellIsos: werktagePlus(startIso, count) };
      }
      if (barDrag.mode === "resize-r") {
        let curIso = dayIsoByIdx[idx];
        if (new Date(curIso) < new Date(firstIso)) curIso = firstIso;
        const cells = werktageZwischen(firstIso, curIso);
        return { workerId: bar.workerId, cellIsos: cells.length ? cells : [firstIso] };
      }
      // resize-l
      let curIso = dayIsoByIdx[idx];
      if (new Date(curIso) > new Date(lastIso)) curIso = lastIso;
      const cells = werktageZwischen(curIso, lastIso);
      return { workerId: bar.workerId, cellIsos: cells.length ? cells : [lastIso] };
    };

    const onMove = (e: PointerEvent) => {
      const isActive =
        barDrag.active ||
        Math.abs(e.clientX - barDrag.pointerStart.x) > 4 ||
        Math.abs(e.clientY - barDrag.pointerStart.y) > 4;
      if (!isActive) return;
      const at = findAt(e.clientX, e.clientY);
      if (!at) {
        setBarDrag((cur) => (cur ? { ...cur, active: true } : cur));
        return;
      }
      const preview = computePreview(at.workerId, at.idx);
      setBarDrag((cur) => (cur ? { ...cur, active: true, preview } : cur));
    };

    const onUp = (e: PointerEvent) => {
      const bd = barDrag;
      setBarDrag(null);
      if (!bd) return;
      if (!bd.active || !bd.preview) {
        // Reiner Klick (keine Bewegung) → Info-Popup mit vollem Namen.
        // Von dort führt „Bearbeiten" ins CellPopover — schmale Balken
        // sind sonst nicht lesbar (2 Buchstaben, kein Hover am Tablet).
        const cells = [...bd.bar.assignedIdx].map((i) => ({
          workerId: bd.bar.workerId,
          iso: dayIsoByIdx[i],
        }));
        const idxs = [...bd.bar.assignedIdx].sort((a, b) => a - b);
        const s = dayHeaders[idxs[0]].date;
        const en = dayHeaders[idxs[idxs.length - 1]].date;
        setBarInfo({
          bar: bd.bar,
          dateRange:
            idxs.length === 1
              ? s.toLocaleDateString("de-AT")
              : `${s.toLocaleDateString("de-AT")} – ${en.toLocaleDateString("de-AT")}`,
          anchor: { x: e.clientX, y: e.clientY },
          cells,
        });
        return;
      }
      void applyBarDrag(bd);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barDrag, dayHeaders, dayIsoByIdx]);

  // ─── MA-Namen-Drag: Mitarbeiter zwischen Partien verschieben ────────────
  type NameDrag = {
    member: Profile;
    fromPartieId: string | null;
    pointerStart: { x: number; y: number };
    active: boolean;
    pos: { x: number; y: number };
    /** string = Partie-Ziel, undefined = kein gültiges Ziel */
    overPartieId: string | null | undefined;
  };
  const [nameDrag, setNameDrag] = useState<NameDrag | null>(null);
  const draggedRecentlyRef = useRef(false);

  const onNamePointerDown = (
    e: React.PointerEvent,
    member: Profile,
    fromPartieId: string | null,
  ) => {
    if (!isAdmin) return;
    setNameDrag({
      member,
      fromPartieId,
      pointerStart: { x: e.clientX, y: e.clientY },
      active: false,
      pos: { x: e.clientX, y: e.clientY },
      overPartieId: undefined,
    });
  };

  useEffect(() => {
    if (!nameDrag) return;
    const findPartieDrop = (x: number, y: number): string | null | undefined => {
      const stack = (document.elementsFromPoint(x, y) as HTMLElement[]) ?? [];
      for (const el of stack) {
        const drop = el.closest?.("[data-partie-drop]") as HTMLElement | null;
        if (drop) {
          const v = drop.dataset.partieDrop ?? "";
          return v === "lager" ? null : v;
        }
      }
      return undefined;
    };
    const onMove = (e: PointerEvent) => {
      const isActive =
        nameDrag.active ||
        Math.abs(e.clientX - nameDrag.pointerStart.x) > 4 ||
        Math.abs(e.clientY - nameDrag.pointerStart.y) > 4;
      if (!isActive) return;
      const over = findPartieDrop(e.clientX, e.clientY);
      setNameDrag((cur) =>
        cur
          ? { ...cur, active: true, pos: { x: e.clientX, y: e.clientY }, overPartieId: over }
          : cur,
      );
    };
    const onUp = () => {
      const nd = nameDrag;
      setNameDrag(null);
      if (!nd || !nd.active) return;
      draggedRecentlyRef.current = true;
      setTimeout(() => {
        draggedRecentlyRef.current = false;
      }, 400);
      if (nd.overPartieId === undefined) return; // kein gültiges Ziel
      const ziel = nd.overPartieId; // string | null
      if ((ziel ?? null) === (nd.fromPartieId ?? null)) return; // unverändert
      assignMemberToPartie(nd.member.id, ziel);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameDrag]);

  // Liefert das Cartesian-Produkt zwischen zwei Zellen — über mehrere Mitarbeiter UND Tage
  const makeRange = (
    a: { workerId: string; iso: string },
    b: { workerId: string; iso: string }
  ): { workerId: string; iso: string }[] => {
    const aIdx = workerIdx.get(a.workerId);
    const bIdx = workerIdx.get(b.workerId);
    let workerSlice: string[];
    if (aIdx == null || bIdx == null) {
      // Fallback: nur Anker-Mitarbeiter
      workerSlice = [a.workerId];
    } else {
      const [from, to] = aIdx <= bIdx ? [aIdx, bIdx] : [bIdx, aIdx];
      workerSlice = flatWorkerIds.slice(from, to + 1);
    }
    const aT = new Date(a.iso).getTime();
    const bT = new Date(b.iso).getTime();
    const [s, e] = aT <= bT ? [aT, bT] : [bT, aT];
    // Wochenenden + Feiertage werden übersprungen — sie sind keine wählbaren
    // Zellen, die Auswahl läuft einfach über sie hinweg.
    const dates: string[] = [];
    for (let t = s; t <= e; t += DAY_MS) {
      const iso = isoDate(new Date(t));
      if (isWerktag(iso)) dates.push(iso);
    }
    const cells: { workerId: string; iso: string }[] = [];
    for (const wid of workerSlice) {
      for (const iso of dates) {
        cells.push({ workerId: wid, iso });
      }
    }
    return cells;
  };

  const onCellPointerDown = (e: React.PointerEvent, workerId: string, iso: string) => {
    if (!isAdmin) return;
    e.preventDefault();

    // Shift+Click → instant range from previous anchor (auch über mehrere Zeilen)
    if (e.shiftKey && selectionAnchor) {
      const cells = makeRange(selectionAnchor, { workerId, iso });
      setSelection(new Set(cells.map((c) => cellKey(c.workerId, c.iso))));
      setPopover({
        workerId,
        cells,
        anchor: { x: e.clientX, y: e.clientY },
      });
      return;
    }

    // Drag-Start
    setDragAnchor({ workerId, iso });
    setDragHover({ workerId, iso });
    setSelectionAnchor({ workerId, iso });
    setSelection(new Set([cellKey(workerId, iso)]));
  };

  // Drag-Tracking: globaler PointerMove + PointerUp
  useEffect(() => {
    if (!dragAnchor) return;

    const findCellAtPoint = (x: number, y: number) => {
      const stack = (document.elementsFromPoint
        ? (document.elementsFromPoint(x, y) as HTMLElement[])
        : [document.elementFromPoint(x, y) as HTMLElement | null].filter(Boolean) as HTMLElement[]);
      for (const el of stack) {
        // Cell-Direktmodus (Mobile-Variante hat noch echte Cells)
        const cell = (el as HTMLElement).closest?.("[data-cell='1']") as HTMLElement | null;
        if (cell) return { workerId: cell.dataset.worker ?? "", iso: cell.dataset.iso ?? "" };
        // Row-Modus (Desktop-Bars): Tag aus x-Position berechnen
        const row = (el as HTMLElement).closest?.("[data-row='1']") as HTMLElement | null;
        if (row && row.dataset.worker) {
          const rect = row.getBoundingClientRect();
          const idx = Math.max(
            0,
            Math.min(dayHeaders.length - 1, Math.floor((x - rect.left) / dayWidth))
          );
          return { workerId: row.dataset.worker, iso: isoDate(dayHeaders[idx].date) };
        }
      }
      return null;
    };

    const onMove = (e: PointerEvent) => {
      if (!dragAnchor) return;
      const c = findCellAtPoint(e.clientX, e.clientY);
      // Auch über andere Mitarbeiter-Zeilen erlaubt → cross-row selection
      if (c && c.iso) {
        if (!dragHover || dragHover.iso !== c.iso || dragHover.workerId !== c.workerId) {
          setDragHover({ workerId: c.workerId, iso: c.iso });
          const cells = makeRange(dragAnchor, c);
          setSelection(new Set(cells.map((x) => cellKey(x.workerId, x.iso))));
        }
      }
    };

    const onUp = (e: PointerEvent) => {
      const finalHover = dragHover ?? dragAnchor;
      const cells = makeRange(dragAnchor, finalHover);
      setSelection(new Set(cells.map((c) => cellKey(c.workerId, c.iso))));
      setPopover({
        workerId: dragAnchor.workerId,
        cells,
        anchor: { x: e.clientX, y: e.clientY },
      });
      setDragAnchor(null);
      setDragHover(null);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, [dragAnchor, dragHover, dayHeaders]);

  // Drag-Auswahl auf einem Partie-Überbalken → Popover für die GANZE Partie.
  useEffect(() => {
    if (!partieDrag) return;
    const findIdx = (x: number, y: number): number | null => {
      const stack = (document.elementsFromPoint(x, y) as HTMLElement[]) ?? [];
      for (const el of stack) {
        const pr = el.closest?.("[data-partie-row='1']") as HTMLElement | null;
        if (pr && pr.dataset.partie === partieDrag.partieId) {
          const rect = pr.getBoundingClientRect();
          return Math.max(
            0,
            Math.min(
              dayHeaders.length - 1,
              Math.floor((x - rect.left) / dayWidth),
            ),
          );
        }
      }
      return null;
    };
    const onMove = (e: PointerEvent) => {
      const idx = findIdx(e.clientX, e.clientY);
      if (idx != null) {
        setPartieDrag((cur) => (cur ? { ...cur, hoverIdx: idx } : cur));
      }
    };
    const onUp = (e: PointerEvent) => {
      const pd = partieDrag;
      setPartieDrag(null);
      if (!pd) return;
      const g = workerGroups.find((x) => x.partie?.id === pd.partieId);
      if (!g || g.members.length === 0) return;
      const lo = Math.min(pd.anchorIdx, pd.hoverIdx);
      const hi = Math.max(pd.anchorIdx, pd.hoverIdx);
      const isos: string[] = [];
      for (let i = lo; i <= hi; i++) {
        const iso = isoDate(dayHeaders[i].date);
        if (isWerktag(iso)) isos.push(iso);
      }
      if (isos.length === 0) return;
      const cells = g.members.flatMap((m) =>
        isos.map((iso) => ({ workerId: m.id, iso })),
      );
      setSelection(new Set(cells.map((c) => cellKey(c.workerId, c.iso))));
      setPopover({
        workerId: pd.partieId,
        cells,
        anchor: { x: e.clientX, y: e.clientY },
      });
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partieDrag, workerGroups, dayHeaders]);

  const closePopover = () => {
    setPopover(null);
    setSelection(new Set());
    setSelectionAnchor(null);
  };

  const assignMemberToPartie = async (memberId: string, newPartieId: string | null) => {
    if (!isAdmin) return;
    const { error } = await supabase
      .from("profiles")
      .update({ partie_id: newPartieId })
      .eq("id", memberId);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      toast({ title: newPartieId ? "Partie gewechselt" : "Aus Partie entfernt" });
      load();
    }
  };

  const savePartie = async () => {
    if (!isAdmin) return;
    if (!newPartieName.trim()) {
      toast({ variant: "destructive", title: "Name fehlt" });
      return;
    }
    const payload: any = {
      name: newPartieName.trim(),
      farbcode: newPartieFarbe,
      partieleiter_id: newPartieleiterId || null,
    };

    let savedId: string | null = null;
    if (editingPartieId) {
      // UPDATE: Falls der Partieleiter gewechselt wurde, alten Polier-Flag entfernen
      const old = partien.find((p) => p.id === editingPartieId);
      const { error } = await supabase
        .from("partien")
        .update(payload)
        .eq("id", editingPartieId);
      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: error.message });
        return;
      }
      savedId = editingPartieId;
      if (old?.partieleiter_id && old.partieleiter_id !== newPartieleiterId) {
        await supabase
          .from("profiles")
          .update({ is_partieleiter: false })
          .eq("id", old.partieleiter_id);
      }
      toast({ title: `Partie „${newPartieName}" aktualisiert` });
    } else {
      const { data, error } = await supabase
        .from("partien")
        .insert(payload)
        .select()
        .single();
      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: error.message });
        return;
      }
      savedId = data.id;
      toast({ title: `Partie „${newPartieName}" angelegt` });
    }

    // Wenn ein Partieleiter gewählt wurde: dessen profile.partie_id + is_partieleiter setzen
    if (newPartieleiterId && savedId) {
      await supabase
        .from("profiles")
        .update({ partie_id: savedId, is_partieleiter: true })
        .eq("id", newPartieleiterId);
    }

    closePartieEditor();
    load();
  };

  const deletePartieFromPlan = async (partieId: string, partieName: string) => {
    if (!isAdmin) return;
    if (!confirm(`Partie „${partieName}" löschen? Mitarbeiter werden entkoppelt.`)) return;
    const { error } = await supabase.from("partien").delete().eq("id", partieId);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Partie gelöscht" });
    load();
  };

  // ─── Cell-Aktionen: Mitarbeiter pro Tag einteilen / Fehlzeit setzen ───
  // Gibt false zurück, wenn ein Schritt fehlschlug (Caller muss dann neu laden).
  const clearCellsRaw = async (
    cells: { workerId: string; iso: string }[],
  ): Promise<boolean> => {
    if (cells.length === 0) return true;
    const workerIds = Array.from(new Set(cells.map((c) => c.workerId)));
    const dates = Array.from(new Set(cells.map((c) => c.iso)));
    // Jahresplan-Mitarbeiter-Einträge für (worker, datum) löschen
    const { data: emToDelete, error: emSelErr } = await supabase
      .from("jahresplan_mitarbeiter")
      .select("id, mitarbeiter_id, einteilung_id, einteilungen:jahresplan_einteilungen!inner(datum)")
      .in("mitarbeiter_id", workerIds)
      .in("einteilungen.datum", dates);
    if (emSelErr) {
      toast({ variant: "destructive", title: "Fehler beim Entfernen", description: emSelErr.message });
      return false;
    }
    const emIds = (emToDelete ?? [])
      .filter((r: any) =>
        cells.some(
          (c) => c.workerId === r.mitarbeiter_id && c.iso === r.einteilungen?.datum
        )
      )
      .map((r: any) => r.id);
    if (emIds.length > 0) {
      const { error: emDelErr } = await supabase
        .from("jahresplan_mitarbeiter")
        .delete()
        .in("id", emIds);
      if (emDelErr) {
        toast({ variant: "destructive", title: "Fehler beim Entfernen", description: emDelErr.message });
        return false;
      }
    }
    // Fehlzeit-Tage in stunden_tage löschen — NUR noch nicht freigegebene
    // reine Fehlzeit-Tage (Freigabe-Workflow bleibt unangetastet)
    const { data: ftRows, error: ftSelErr } = await supabase
      .from("stunden_tage")
      .select("id, mitarbeiter_id, datum")
      .in("mitarbeiter_id", workerIds)
      .in("datum", dates)
      .in("tag_status", FEHLZEIT_TAG_STATI)
      .in("status", ["erfasst", "ma_bestaetigt"]);
    if (ftSelErr) {
      toast({ variant: "destructive", title: "Fehler beim Entfernen", description: ftSelErr.message });
      return false;
    }
    let ftIds = (ftRows ?? [])
      .filter((r: any) => cells.some((c) => c.workerId === r.mitarbeiter_id && c.iso === r.datum))
      .map((r: any) => r.id as string);
    if (ftIds.length > 0) {
      // Tage mit erfassten Tätigkeiten NICHT löschen — dort hängen echte Stunden dran
      const { data: ttRows, error: ttSelErr } = await supabase
        .from("stunden_taetigkeiten")
        .select("stunden_tag_id")
        .in("stunden_tag_id", ftIds);
      if (ttSelErr) {
        toast({ variant: "destructive", title: "Fehler beim Entfernen", description: ttSelErr.message });
        return false;
      }
      const mitTaetigkeiten = new Set((ttRows ?? []).map((r: any) => r.stunden_tag_id));
      ftIds = ftIds.filter((id) => !mitTaetigkeiten.has(id));
    }
    if (ftIds.length > 0) {
      const { error: ftDelErr } = await supabase.from("stunden_tage").delete().in("id", ftIds);
      if (ftDelErr) {
        toast({ variant: "destructive", title: "Fehler beim Entfernen", description: ftDelErr.message });
        return false;
      }
    }
    return true;
  };

  // Gibt false zurück, wenn nichts (vollständig) geschrieben wurde.
  const assignBaustelle = async (
    cellsInput: { workerId: string; iso: string }[],
    baustelleId: string,
    options?: { wochenendeIncluden?: boolean },
  ): Promise<boolean> => {
    if (!isAdmin || cellsInput.length === 0) return false;
    if (assignBusyRef.current) return false; // Doppelklick-Schutz
    assignBusyRef.current = true;
    try {
    let cells = cellsInput;

    // 1) Wochenenden/Feiertage rausfiltern (außer Override)
    if (!options?.wochenendeIncluden) {
      const werktageOnly = cells.filter((c) => isWerktag(c.iso));
      const skipped = cells.length - werktageOnly.length;
      if (werktageOnly.length === 0) {
        const ok = window.confirm(
          `Alle ausgewählten Tage sind Wochenende/Feiertag. Trotzdem als Wochenend-Einsatz eintragen?`,
        );
        if (!ok) {
          toast({
            title: "Keine Werktage in Auswahl",
            description: "Sa/So/Feiertage werden standardmäßig übersprungen.",
          });
          return false;
        }
        // User bestätigt Wochenend-Override → ursprüngliche cells behalten
      } else {
        cells = werktageOnly;
        if (skipped > 0) {
          toast({
            title: `${skipped} Wochenend-/Feiertage übersprungen`,
            description: `${cells.length} Werktage werden eingeplant.`,
          });
        }
      }
    }

    // Alte Zellen räumen — bei Fehler abbrechen und echten Zustand zeigen
    if (!(await clearCellsRaw(cells))) {
      loadAssignments();
      return false;
    }

    // Jahresplan-Einteilungen pro datum sicherstellen, dann
    // jahresplan_mitarbeiter Insert
    const inserts: { mitarbeiter_id: string; einteilung_id: string }[] = [];
    const datesSeen = new Map<string, string>(); // iso -> einteilung_id
    for (const c of cells) {
      let einteilungId = datesSeen.get(c.iso);
      if (!einteilungId) {
        const { data: existing } = await supabase
          .from("jahresplan_einteilungen")
          .select("id")
          .eq("datum", c.iso)
          .eq("baustelle_id", baustelleId)
          .maybeSingle();
        if (existing?.id) {
          einteilungId = existing.id;
        } else {
          const { data: created, error } = await supabase
            .from("jahresplan_einteilungen")
            .insert({ datum: c.iso, baustelle_id: baustelleId })
            .select("id")
            .single();
          if (error) {
            toast({ variant: "destructive", title: "Fehler", description: error.message });
            // Alte Zellen sind schon gelöscht → echten Zustand nachladen
            loadAssignments();
            return false;
          }
          einteilungId = created!.id;
        }
        datesSeen.set(c.iso, einteilungId!);
      }
      inserts.push({ mitarbeiter_id: c.workerId, einteilung_id: einteilungId! });
    }
    if (inserts.length > 0) {
      const { error } = await supabase.from("jahresplan_mitarbeiter").insert(inserts as any);
      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: error.message });
        // Alte Zellen sind schon gelöscht → echten Zustand nachladen
        loadAssignments();
        return false;
      }
    }
    toast({ title: `${cells.length} Tag${cells.length === 1 ? "" : "e"} eingeteilt` });
    loadAssignments();
    return true;
    } finally {
      assignBusyRef.current = false;
    }
  };

  // Fehlzeit direkt in stunden_tage schreiben (Muster: UrlaubAntragDialog.genehmigen).
  // stundenbuchungen ist Legacy — dort landende Fehlzeiten erreichten Lohn/
  // Abschluss nie. Gibt false zurück, wenn nichts (vollständig) gesetzt wurde.
  const setFehlzeit = async (
    cellsInput: { workerId: string; iso: string }[],
    typ: string,
  ): Promise<boolean> => {
    if (!isAdmin || cellsInput.length === 0) return false;
    // Doppelklick-Schutz — ohne Lock erzeugte ein Doppelklick doppelte Zeilen
    if (cellActionBusy || assignBusyRef.current) return false;
    const tagStatus = FEHLZEIT_TAG_STATUS[typ];
    if (!tagStatus) {
      toast({ variant: "destructive", title: "Unbekannter Fehlzeit-Typ", description: typ });
      return false;
    }
    assignBusyRef.current = true;
    setCellActionBusy(true);
    try {
      // Wochenenden/Feiertage rausfiltern — Urlaub/Krank gilt nur an Werktagen
      const cells = cellsInput.filter((c) => isWerktag(c.iso));
      const skipped = cellsInput.length - cells.length;
      if (cells.length === 0) {
        toast({
          title: "Keine Werktage in Auswahl",
          description: `${FEHLZEIT_LABEL[typ] ?? typ} kann nur an Werktagen gebucht werden.`,
        });
        return false;
      }
      if (skipped > 0) {
        toast({
          title: `${skipped} Wochenend-/Feiertage übersprungen`,
        });
      }
      // Einteilungen/alte Fehlzeiten des Bereichs räumen
      if (!(await clearCellsRaw(cells))) {
        loadAssignments();
        return false;
      }
      // Pro Mitarbeiter: existierende stunden_tage laden, fehlende Tage
      // einfügen, überschreibbare (erfasst/ma_bestaetigt) umstellen
      const datesByWorker = new Map<string, string[]>();
      for (const c of cells) {
        const arr = datesByWorker.get(c.workerId) ?? [];
        arr.push(c.iso);
        datesByWorker.set(c.workerId, arr);
      }
      for (const [mitarbeiterId, dates] of datesByWorker) {
        const { data: existing, error: exErr } = await supabase
          .from("stunden_tage")
          .select("id, datum, status")
          .eq("mitarbeiter_id", mitarbeiterId)
          .in("datum", dates);
        if (exErr) {
          toast({ variant: "destructive", title: "Fehler beim Laden der Stunden-Tage", description: exErr.message });
          loadAssignments();
          return false;
        }
        const existingSet = new Set((existing ?? []).map((r: any) => r.datum));
        const toInsert = dates.filter((d) => !existingSet.has(d));
        if (toInsert.length > 0) {
          const { error: insErr } = await supabase.from("stunden_tage").insert(
            toInsert.map((datum) => ({
              mitarbeiter_id: mitarbeiterId,
              datum,
              tag_status: tagStatus,
              netto_stunden: 0,
              status: "erfasst" as const,
            })),
          );
          if (insErr) {
            toast({ variant: "destructive", title: "Fehlzeit setzen fehlgeschlagen", description: insErr.message });
            loadAssignments();
            return false;
          }
        }
        // Bestehende (noch nicht freigegebene) Tage auf Fehlzeit umstellen.
        // WICHTIG: deren stunden_taetigkeiten löschen — sonst rechnet der
        // Recompute-Trigger beim nächsten Edit die alten Stunden zurück.
        const ueberschreibbar = (existing ?? []).filter(
          (r: any) => r.status === "erfasst" || r.status === "ma_bestaetigt",
        );
        if (ueberschreibbar.length > 0) {
          const tagIds = ueberschreibbar.map((r: any) => r.id);
          const { error: ttDelErr } = await supabase
            .from("stunden_taetigkeiten")
            .delete()
            .in("stunden_tag_id", tagIds);
          if (ttDelErr) {
            toast({ variant: "destructive", title: "Fehlzeit setzen fehlgeschlagen", description: ttDelErr.message });
            loadAssignments();
            return false;
          }
          const { error: updErr } = await supabase
            .from("stunden_tage")
            .update({ tag_status: tagStatus, netto_stunden: 0 })
            .in("id", tagIds);
          if (updErr) {
            toast({ variant: "destructive", title: "Fehlzeit setzen fehlgeschlagen", description: updErr.message });
            loadAssignments();
            return false;
          }
        }
      }
      toast({
        title: `${FEHLZEIT_LABEL[typ] ?? typ} für ${cells.length} Tag${cells.length === 1 ? "" : "e"} gesetzt`,
        // Admin-Direkteintrag bucht bewusst KEIN Urlaubskonto —
        // dafür ist der Urlaubsantrags-Flow zuständig
        description:
          typ === "U"
            ? "Hinweis: Kein Urlaubskonto-Abzug — dafür Urlaubsantrag verwenden."
            : undefined,
      });
      loadAssignments();
      return true;
    } finally {
      assignBusyRef.current = false;
      setCellActionBusy(false);
    }
  };

  const clearCells = async (cells: { workerId: string; iso: string }[]) => {
    if (!isAdmin || cells.length === 0) return;
    // Doppelklick-Schutz — ohne Lock konnten parallele Löschläufe kollidieren
    if (cellActionBusy || assignBusyRef.current) return;
    assignBusyRef.current = true;
    setCellActionBusy(true);
    try {
      if (!(await clearCellsRaw(cells))) {
        loadAssignments();
        return;
      }
      toast({ title: `${cells.length} Eintrag${cells.length === 1 ? "" : "e"} entfernt` });
      loadAssignments();
    } finally {
      assignBusyRef.current = false;
      setCellActionBusy(false);
    }
  };

  const weekHeaders = useMemo(() => {
    const out: { week: number; year: number; offsetDays: number; widthDays: number }[] = [];
    let cur: { week: number; year: number; offsetDays: number; widthDays: number } | null = null;
    dayHeaders.forEach((d, i) => {
      if (!cur || cur.week !== d.week || cur.year !== d.year) {
        if (cur) out.push(cur);
        cur = { week: d.week, year: d.year, offsetDays: i, widthDays: 1 };
      } else {
        cur.widthDays++;
      }
    });
    if (cur) out.push(cur);
    return out;
  }, [dayHeaders]);

  const movePeriod = (weeks: number) => {
    const next = new Date(anchorWeek.getTime() + weeks * 7 * DAY_MS);
    setAnchorWeek(startOfISOWeek(next));
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Arbeitsplanung"
        description="Gantt-Chart aller Baustellen über Kalenderwochen, gruppiert nach Partien."
        actions={
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => openPartieEditor()}
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Neue Partie
              </Button>
            )}
            {canCreateBaustelle && (
              <Button
                onClick={() => {
                  setEditing({});
                  setDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Neue Baustelle
              </Button>
            )}
          </div>
        }
      />

      {/* Ansicht-Umschalter: Mitarbeiter-Zeilen ↔ Poliereinsatz (MS-Project-Stil) */}
      <div className="inline-flex rounded-md border bg-card p-0.5">
        {(
          [
            { key: "ma", label: "Mitarbeiter" },
            { key: "polier", label: "Poliereinsatz" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setAnsicht(t.key)}
            className={`px-4 py-1.5 rounded text-sm font-medium transition ${
              ansicht === t.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {ansicht === "polier" && (
        <PoliereinsatzView
          baustellen={baustellen}
          partien={partien}
          profiles={profiles}
          fahrzeuge={fahrzeuge}
          canEdit={isAdmin}
          userId={user?.id ?? null}
        />
      )}

      {ansicht === "ma" && (
      <>

      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => movePeriod(-4)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const t = new Date();
              t.setDate(t.getDate() - 14);
              setAnchorWeek(startOfISOWeek(t));
            }}
          >
            Heute
          </Button>
          <Button variant="outline" size="sm" onClick={() => movePeriod(4)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="text-sm font-medium px-2">
            KW {isoWeek(rangeStart).week}/{isoWeek(rangeStart).year} – KW{" "}
            {isoWeek(new Date(rangeEnd.getTime() - DAY_MS)).week}/
            {isoWeek(new Date(rangeEnd.getTime() - DAY_MS)).year}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={filterPartie} onValueChange={setFilterPartie}>
              <SelectTrigger className="w-44 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alle">Alle Partien</SelectItem>
                {partien.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(weeksVisible)}
              onValueChange={(v) => setWeeksVisible(parseInt(v, 10))}
            >
              <SelectTrigger className="w-32 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="8">8 Wochen</SelectItem>
                <SelectItem value="12">12 Wochen</SelectItem>
                <SelectItem value="20">20 Wochen</SelectItem>
                <SelectItem value="30">30 Wochen</SelectItem>
                <SelectItem value="52">52 Wochen</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Mobile: kompakter Worker-Plan pro Tag */}
      <div className="md:hidden space-y-3">
        {/* Sticky Mobile-Legende */}
        <div className="md:hidden sticky top-14 z-20 bg-background/95 backdrop-blur border rounded-md px-2 py-1.5 -mx-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
            <span className="font-semibold uppercase tracking-wide text-muted-foreground">
              Codes:
            </span>
            {Object.entries(FEHLZEIT_LABEL).map(([k, l]) => (
              <span key={k} className="flex items-center gap-1">
                <span
                  className="h-3 w-3 rounded-sm shrink-0"
                  style={{ background: FEHLZEIT_COLOR[k] }}
                />
                <strong className="font-mono">{k}</strong>
                <span className="text-muted-foreground">{l}</span>
              </span>
            ))}
            <span className="flex items-center gap-1 ml-auto">
              <span className="h-3 w-3 rounded-sm shrink-0 bg-primary/70" />
              <span className="text-muted-foreground">Baustelle</span>
            </span>
          </div>
          {isAdmin && (
            <div className="text-[9px] text-muted-foreground italic mt-0.5 leading-tight">
              Tippen für Aktion · Streichen wählt Bereich aus
            </div>
          )}
        </div>

        <MobileWorkerPlan
          workerGroups={workerGroups}
          dayHeaders={dayHeaders}
          assignments={assignments}
          selection={selection}
          isAdmin={isAdmin}
          onCellPointerDown={onCellPointerDown}
          partien={partien}
          onAssignMember={assignMemberToPartie}
          onEditPartie={openPartieEditor}
        />
      </div>

      {/* Desktop: Mitarbeiter-Gantt */}
      <Card className="overflow-hidden hidden md:block">
        <div className="flex">
          {/* Left fixed: Polier + Mitarbeiter */}
          <div className="shrink-0 border-r bg-card" style={{ width: 240 }}>
            <div
              className="bg-muted/60 border-b sticky top-0 z-10 px-3 text-[10px] font-semibold uppercase tracking-wide flex items-end"
              style={{ height: 56 }}
            >
              <span className="pb-1">Polier · Mitarbeiter</span>
            </div>
            {workerGroups.map((g) => {
              const polier = polierName(g.partie);
              const partieKey = g.partie?.id ?? "ohne";
              const collapsed = collapsedPartien.has(partieKey);
              const istDropZiel =
                !!nameDrag?.active &&
                (g.partie
                  ? nameDrag.overPartieId === g.partie.id
                  : nameDrag.overPartieId === null);
              return (
                <div
                  key={partieKey}
                  data-partie-drop={g.partie?.id ?? "lager"}
                  className={
                    istDropZiel ? "ring-2 ring-primary ring-inset bg-primary/5" : ""
                  }
                >
                  <PolierHeader
                    partie={g.partie}
                    polier={polier}
                    bvhCount={g.members.length}
                    members={[]}
                    allPartien={partien}
                    unassignedMembers={unassignedMembers}
                    onAssign={assignMemberToPartie}
                    onDeletePartie={deletePartieFromPlan}
                    onEditPartie={openPartieEditor}
                    isAdmin={isAdmin}
                    collapsed={collapsed}
                    onToggleCollapse={() => toggleCollapse(partieKey)}
                  />
                  {!collapsed && g.members.length === 0 && (
                    <div
                      className="border-b flex items-center px-2 text-[10px] italic text-muted-foreground"
                      style={{ height: 28 }}
                    >
                      {nameDrag?.active ? "Hierher ziehen …" : "— leer —"}
                    </div>
                  )}
                  {!collapsed &&
                    g.members.map((m) => {
                    const row = (
                      <button
                        type="button"
                        onPointerDown={(e) =>
                          isAdmin && onNamePointerDown(e, m, g.partie?.id ?? null)
                        }
                        onClickCapture={(e) => {
                          if (draggedRecentlyRef.current) {
                            e.stopPropagation();
                            e.preventDefault();
                            draggedRecentlyRef.current = false;
                          }
                        }}
                        className={`border-b flex items-center gap-2 px-2 text-[11px] w-full text-left transition ${
                          isAdmin
                            ? "hover:bg-muted cursor-grab active:cursor-grabbing"
                            : "cursor-default"
                        } ${
                          nameDrag?.active && nameDrag.member.id === m.id
                            ? "opacity-40"
                            : ""
                        }`}
                        style={{ height: 28, touchAction: isAdmin ? "none" : undefined }}
                        title={
                          isAdmin
                            ? `${m.vorname} ${m.nachname} · ziehen zum Verschieben, klicken für Menü`
                            : `${m.vorname} ${m.nachname}`
                        }
                      >
                        <span
                          className="h-5 w-5 rounded-full flex items-center justify-center text-white text-[8px] font-bold shrink-0"
                          style={{ background: g.partie?.farbcode ?? "#999" }}
                        >
                          {m.vorname[0]}
                          {m.nachname[0]}
                        </span>
                        <span className="font-medium truncate">
                          {m.nachname} {m.vorname[0]}.
                        </span>
                        {m.id === g.partie?.partieleiter_id && (
                          <Badge variant="outline" className="text-[8px] px-1 py-0 shrink-0 ml-auto">
                            Polier
                          </Badge>
                        )}
                      </button>
                    );
                    if (!isAdmin) return <div key={m.id}>{row}</div>;
                    return (
                      <MemberActionPopover
                        key={m.id}
                        member={m}
                        partie={g.partie}
                        allPartien={partien}
                        onAssign={assignMemberToPartie}
                      >
                        {row}
                      </MemberActionPopover>
                    );
                  })}
                </div>
              );
            })}
            {workerGroups.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Keine Mitarbeiter in Partien zugeordnet.
              </div>
            )}
            {isAdmin && (
              <button
                type="button"
                onClick={() => openPartieEditor()}
                className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground hover:bg-muted border-b transition"
              >
                <Plus className="h-3.5 w-3.5" /> Neue Partie
              </button>
            )}
          </div>

          {/* Timeline */}
          <div className="flex-1 overflow-x-auto">
            <div style={{ width: totalDays * dayWidth, position: "relative" }}>
              {/* Headers */}
              <div className="bg-muted/60 sticky top-0 z-10">
                <div className="flex border-b" style={{ height: 28 }}>
                  {weekHeaders.map((w, i) => (
                    <div
                      key={i}
                      className="text-[11px] font-semibold flex items-center justify-center border-r"
                      style={{ width: w.widthDays * dayWidth }}
                    >
                      KW {w.week}
                    </div>
                  ))}
                </div>
                <div className="flex border-b" style={{ height: 28 }}>
                  {dayHeaders.map((d, i) => {
                    const isWeekend = d.date.getDay() === 0 || d.date.getDay() === 6;
                    const dow = ["S", "M", "D", "M", "D", "F", "S"][d.date.getDay()];
                    const isFeiertag = !!d.feiertag;
                    return (
                      <div
                        key={i}
                        title={
                          d.feiertag
                            ? `${d.feiertag.name}${
                                d.feiertag.scope === "kaernten" ? " (Kärnten)" : ""
                              } · ${d.date.toLocaleDateString("de-AT")}`
                            : d.date.toLocaleDateString("de-AT")
                        }
                        className={`text-[9px] flex flex-col items-center justify-center border-r leading-tight ${
                          d.isToday
                            ? "bg-primary/20 text-primary font-semibold"
                            : isFeiertag
                            ? "bg-violet-200 text-violet-900 font-semibold"
                            : isWeekend
                            ? "bg-muted/40 text-muted-foreground"
                            : "text-muted-foreground"
                        }`}
                        style={{ width: dayWidth }}
                      >
                        <span className="opacity-70">{dow}</span>
                        <span className="font-semibold tabular-nums">{d.date.getDate()}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Body — Gantt-Bars statt 1-Tag-Cells */}
              <div className="relative">
                {/* Heute-Linie als senkrechter Strich über die ganze Body-Höhe */}
                {(() => {
                  const todayIdx = dayHeaders.findIndex((d) => d.isToday);
                  if (todayIdx < 0) return null;
                  return (
                    <div
                      className="absolute top-0 bottom-0 z-20 pointer-events-none"
                      style={{
                        left: todayIdx * dayWidth + dayWidth / 2,
                        width: 2,
                        background: "hsl(var(--destructive))",
                        opacity: 0.6,
                      }}
                    />
                  );
                })()}
                {workerGroups.map((g) => {
                  const partieKey = g.partie?.id ?? "ohne";
                  const collapsed = collapsedPartien.has(partieKey);
                  const partieAktiv =
                    isAdmin && !!g.partie && g.members.length > 0;
                  return (
                  <div key={partieKey}>
                    {/* Partie-Überbalken — Planungszeile für die ganze Partie */}
                    <div
                      data-partie-row={g.partie ? "1" : undefined}
                      data-partie={g.partie?.id}
                      onPointerDown={(e) => {
                        if (!partieAktiv || !g.partie) return;
                        e.preventDefault();
                        const rect = (
                          e.currentTarget as HTMLDivElement
                        ).getBoundingClientRect();
                        const idx = Math.max(
                          0,
                          Math.min(
                            dayHeaders.length - 1,
                            Math.floor((e.clientX - rect.left) / dayWidth),
                          ),
                        );
                        setPartieDrag({
                          partieId: g.partie.id,
                          anchorIdx: idx,
                          hoverIdx: idx,
                        });
                      }}
                      className="border-b relative"
                      style={{
                        height: 36,
                        background: g.partie
                          ? `${g.partie.farbcode}25`
                          : "hsl(var(--muted))",
                        cursor: partieAktiv ? "pointer" : "default",
                        touchAction: partieAktiv ? "none" : undefined,
                        userSelect: "none",
                      }}
                      title={
                        partieAktiv
                          ? "Ziehen, um die ganze Partie einzuteilen"
                          : undefined
                      }
                    >
                      {/* Konsens-Balken: gemeinsame Einteilung der Partie */}
                      {g.partie &&
                        (() => {
                          const arr = partieConsensus.get(g.partie.id);
                          if (!arr) return null;
                          const segs: {
                            start: number;
                            end: number;
                            color: string;
                            label: string;
                          }[] = [];
                          for (let i = 0; i < arr.length; i++) {
                            const c = arr[i];
                            if (!c) continue;
                            const last = segs[segs.length - 1];
                            if (
                              last &&
                              last.end === i - 1 &&
                              last.label === c.label &&
                              last.color === c.color
                            )
                              last.end = i;
                            else
                              segs.push({
                                start: i,
                                end: i,
                                color: c.color,
                                label: c.label,
                              });
                          }
                          return segs.map((s, si) => {
                            const w = (s.end - s.start + 1) * dayWidth - 2;
                            return (
                              <div
                                key={si}
                                className="absolute rounded-md flex items-center px-1.5 text-[10px] font-bold text-white truncate pointer-events-none shadow-sm"
                                style={{
                                  left: s.start * dayWidth + 1,
                                  width: w,
                                  top: 6,
                                  height: 24,
                                  background: s.color,
                                }}
                              >
                                {w < 60 ? s.label.slice(0, 2) : s.label}
                              </div>
                            );
                          });
                        })()}
                      {/* Auswahl-Highlight beim Partie-Drag */}
                      {partieDrag &&
                        g.partie &&
                        partieDrag.partieId === g.partie.id &&
                        dayHeaders.map((d, i) => {
                          const lo = Math.min(
                            partieDrag.anchorIdx,
                            partieDrag.hoverIdx,
                          );
                          const hi = Math.max(
                            partieDrag.anchorIdx,
                            partieDrag.hoverIdx,
                          );
                          if (i < lo || i > hi || !isWerktag(d.date))
                            return null;
                          return (
                            <div
                              key={`pd${i}`}
                              className="absolute top-0 bottom-0 z-10 pointer-events-none"
                              style={{
                                left: i * dayWidth,
                                width: dayWidth,
                                boxShadow: "inset 0 0 0 2px hsl(var(--primary))",
                                background: "hsl(var(--primary)/0.15)",
                              }}
                            />
                          );
                        })}
                      {/* Wochenend-/Feiertag-Overlay */}
                      {dayHeaders.map((d, i) => {
                        const we =
                          d.date.getDay() === 0 || d.date.getDay() === 6;
                        const ft = !!d.feiertag;
                        if (!we && !ft) return null;
                        return (
                          <div
                            key={`we${i}`}
                            className="absolute top-0 bottom-0 z-20 pointer-events-none"
                            style={{
                              left: i * dayWidth,
                              width: dayWidth,
                              background: ft
                                ? "rgba(139,92,246,0.32)"
                                : "rgba(120,120,120,0.34)",
                            }}
                          />
                        );
                      })}
                    </div>
                    {/* Platzhalter für leere Gruppen — muss exakt zur
                        „— leer —"-Zeile der Namens-Spalte passen (28px),
                        sonst verrutschen Balken und Namen. */}
                    {!collapsed && g.members.length === 0 && (
                      <div className="border-b" style={{ height: 28 }} />
                    )}
                    {!collapsed &&
                      g.members.map((m) => {
                      const bars = barsByWorker.get(m.id) ?? [];
                      return (
                        <div
                          key={m.id}
                          data-row="1"
                          data-worker={m.id}
                          onPointerDown={(e) => {
                            if (!isAdmin) return;
                            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                            const idx = Math.max(
                              0,
                              Math.min(dayHeaders.length - 1, Math.floor((e.clientX - rect.left) / dayWidth))
                            );
                            const iso = isoDate(dayHeaders[idx].date);
                            onCellPointerDown(e, m.id, iso);
                          }}
                          className="border-b relative"
                          style={{
                            height: 28,
                            cursor: isAdmin ? "pointer" : "default",
                            touchAction: isAdmin ? "none" : undefined,
                            userSelect: "none",
                          }}
                        >
                          {/* Hintergrund-Layer: Wochenende + Feiertag-Schatten + Tages-Border */}
                          {dayHeaders.map((d, i) => {
                            const isWeekend = d.date.getDay() === 0 || d.date.getDay() === 6;
                            const isFeiertag = !!d.feiertag;
                            return (
                              <div
                                key={i}
                                className="absolute top-0 bottom-0 border-r border-border/40 pointer-events-none"
                                style={{
                                  left: i * dayWidth,
                                  width: dayWidth,
                                  background: isFeiertag
                                    ? "rgba(139,92,246,0.12)"
                                    : isWeekend
                                    ? "rgba(0,0,0,0.04)"
                                    : "transparent",
                                }}
                              />
                            );
                          })}
                          {/* Selection-Overlay */}
                          {dayHeaders.map((d, i) => {
                            const iso = isoDate(d.date);
                            const sel = selection.has(cellKey(m.id, iso));
                            if (!sel) return null;
                            return (
                              <div
                                key={`s${i}`}
                                className="absolute top-0 bottom-0 z-10 pointer-events-none"
                                style={{
                                  left: i * dayWidth,
                                  width: dayWidth,
                                  boxShadow: "inset 0 0 0 2px hsl(var(--primary))",
                                  background: "hsl(var(--primary)/0.08)",
                                }}
                              />
                            );
                          })}
                          {/* Bars — je zusammenhängendem Werktag-Lauf ein
                              Segment. Wochenenden/Feiertage erzeugen eine
                              echte Lücke, der Block wird optisch aufgeteilt. */}
                          {bars.map((bar, bi) => {
                            const sortedIdx = [...bar.assignedIdx].sort(
                              (a, b) => a - b,
                            );
                            if (sortedIdx.length === 0) return null;
                            const segments: { start: number; end: number }[] = [];
                            for (const i of sortedIdx) {
                              const last = segments[segments.length - 1];
                              if (last && i === last.end + 1) last.end = i;
                              else segments.push({ start: i, end: i });
                            }
                            const startDate = dayHeaders[sortedIdx[0]].date;
                            const endDate =
                              dayHeaders[sortedIdx[sortedIdx.length - 1]].date;
                            const dateRange =
                              sortedIdx.length === 1
                                ? startDate.toLocaleDateString("de-AT")
                                : `${startDate.toLocaleDateString("de-AT")} – ${endDate.toLocaleDateString("de-AT")}`;
                            const greifbar = isAdmin && !bar.isReadOnly;
                            const wirdGezogen =
                              barDrag?.active && barDrag.bar === bar;
                            return segments.map((seg, si) => {
                              const left = seg.start * dayWidth + 1;
                              const width =
                                (seg.end - seg.start + 1) * dayWidth - 2;
                              const isFirst = si === 0;
                              const isLast = si === segments.length - 1;
                              return (
                                <div
                                  key={`${bi}-${si}`}
                                  className="absolute rounded-md flex items-center px-1.5 text-[10px] font-semibold text-white truncate shadow-sm"
                                  style={{
                                    left,
                                    width,
                                    top: 2,
                                    height: 24,
                                    background: bar.color,
                                    opacity: bar.isReadOnly
                                      ? 0.6
                                      : wirdGezogen
                                      ? 0.35
                                      : 1,
                                    // Auch nicht-greifbare Balken (Polier-Sicht,
                                    // eingereichte) sind antippbar → Info-Popup.
                                    pointerEvents: "auto",
                                    cursor: greifbar ? undefined : "pointer",
                                  }}
                                  title={`${bar.label} · ${dateRange}${bar.isReadOnly ? " (eingereicht)" : ""}`}
                                  onClick={
                                    greifbar
                                      ? undefined // Klick läuft über den Drag-Pfad (onUp)
                                      : (e) => {
                                          e.stopPropagation();
                                          setBarInfo({
                                            bar,
                                            dateRange,
                                            anchor: { x: e.clientX, y: e.clientY },
                                            cells: sortedIdx.map((i) => ({
                                              workerId: bar.workerId,
                                              iso: dayIsoByIdx[i],
                                            })),
                                          });
                                        }
                                  }
                                >
                                  {greifbar && (
                                    <>
                                      {isFirst && (
                                        <div
                                          onPointerDown={(e) =>
                                            onBarPointerDown(e, bar, "resize-l")
                                          }
                                          className="absolute left-0 top-0 bottom-0"
                                          style={{ width: 8, cursor: "ew-resize" }}
                                        />
                                      )}
                                      <div
                                        onPointerDown={(e) =>
                                          onBarPointerDown(e, bar, "move")
                                        }
                                        className="absolute top-0 bottom-0"
                                        style={{
                                          left: isFirst ? 8 : 0,
                                          right: isLast ? 8 : 0,
                                          cursor: "grab",
                                        }}
                                      />
                                      {isLast && (
                                        <div
                                          onPointerDown={(e) =>
                                            onBarPointerDown(e, bar, "resize-r")
                                          }
                                          className="absolute right-0 top-0 bottom-0"
                                          style={{ width: 8, cursor: "ew-resize" }}
                                        />
                                      )}
                                    </>
                                  )}
                                  <span className="truncate pointer-events-none">
                                    {width < 60
                                      ? bar.label.slice(0, 2)
                                      : bar.label}
                                  </span>
                                </div>
                              );
                            });
                          })}
                          {/* Ghost-Vorschau beim Bar-Drag — ebenfalls in
                              Segmente geteilt (Wochenend-Lücken sichtbar). */}
                          {barDrag?.active &&
                            barDrag.preview &&
                            barDrag.preview.workerId === m.id &&
                            (() => {
                              const idxs = barDrag.preview.cellIsos
                                .map((iso) => dayIsoByIdx.indexOf(iso))
                                .filter((x) => x >= 0)
                                .sort((a, b) => a - b);
                              if (idxs.length === 0) return null;
                              const segs: { start: number; end: number }[] = [];
                              for (const i of idxs) {
                                const last = segs[segs.length - 1];
                                if (last && i === last.end + 1) last.end = i;
                                else segs.push({ start: i, end: i });
                              }
                              return segs.map((s, si) => (
                                <div
                                  key={`g${si}`}
                                  className="absolute rounded-md border-2 border-dashed pointer-events-none z-20"
                                  style={{
                                    left: s.start * dayWidth + 1,
                                    width: (s.end - s.start + 1) * dayWidth - 2,
                                    top: 2,
                                    height: 24,
                                    background: `${barDrag.bar.color}55`,
                                    borderColor: barDrag.bar.color,
                                  }}
                                />
                              ));
                            })()}
                          {/* Wochenend-/Feiertag-Overlay ÜBER den Bars —
                              schneidet gebrückte Balken optisch durch, sodass
                              Sa/So/Feiertage nie „belegt" aussehen. */}
                          {dayHeaders.map((d, i) => {
                            const isWeekend =
                              d.date.getDay() === 0 || d.date.getDay() === 6;
                            const isFeiertag = !!d.feiertag;
                            if (!isWeekend && !isFeiertag) return null;
                            return (
                              <div
                                key={`we${i}`}
                                className="absolute top-0 bottom-0 z-30 pointer-events-none"
                                style={{
                                  left: i * dayWidth,
                                  width: dayWidth,
                                  background: isFeiertag
                                    ? "rgba(139,92,246,0.32)"
                                    : "rgba(120,120,120,0.34)",
                                }}
                              />
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {Object.entries(FEHLZEIT_LABEL).map(([k, l]) => (
          <div key={k} className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 rounded-sm"
              style={{ background: FEHLZEIT_COLOR[k] }}
            />
            <span className="font-mono font-semibold">{k}</span> {l}
          </div>
        ))}
        {isAdmin && (
          <div className="ml-auto text-[11px] italic">
            Klick = Aktion · Ziehen über Tage/Mitarbeiter = Bereich · Shift+Klick = bis hier · Klick auf Eintrag → „entfernen"
          </div>
        )}
      </div>

      </>
      )}

      {/* Balken-Info: kleines Popup mit vollem Baustellennamen — schmale
          Balken zeigen nur 2 Buchstaben, am Tablet gibt es keinen Hover. */}
      {barInfo && (() => {
        const b = barInfo.bar;
        const bst = b.baustelleId
          ? baustellen.find((x) => x.id === b.baustelleId)
          : null;
        const prof = profilesById[b.workerId];
        const w = 280;
        const px = Math.min(Math.max(8, barInfo.anchor.x - w / 2), window.innerWidth - w - 8);
        const py = Math.min(barInfo.anchor.y + 10, window.innerHeight - 220);
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setBarInfo(null)} />
            <div
              className="fixed z-50 bg-card border rounded-lg shadow-xl p-3"
              style={{ left: px, top: py, width: w }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-2">
                <span
                  className="h-3 w-3 rounded-full shrink-0 mt-1"
                  style={{ background: b.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold leading-tight break-words">
                    {b.label}
                  </div>
                  {bst && (bst.kostenstelle || bst.ort) && (
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {[bst.kostenstelle, bst.ort].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
                {b.isReadOnly && (
                  <Badge variant="outline" className="text-[9px] shrink-0">
                    eingereicht
                  </Badge>
                )}
              </div>
              <div className="mt-2 pt-2 border-t text-[11px] text-muted-foreground space-y-0.5">
                {prof && (
                  <div>
                    {prof.vorname} {prof.nachname}
                  </div>
                )}
                <div>
                  {barInfo.dateRange} ({barInfo.cells.length}{" "}
                  {barInfo.cells.length === 1 ? "Tag" : "Tage"})
                </div>
              </div>
              {isAdmin && !b.isReadOnly && (
                <Button
                  size="sm"
                  className="w-full mt-2 h-9"
                  onClick={() => {
                    setSelection(
                      new Set(
                        barInfo.cells.map((c) => cellKey(c.workerId, c.iso)),
                      ),
                    );
                    setPopover({
                      workerId: b.workerId,
                      cells: barInfo.cells,
                      anchor: barInfo.anchor,
                    });
                    setBarInfo(null);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1.5" /> Bearbeiten
                </Button>
              )}
            </div>
          </>
        );
      })()}

      {popover && (
        <CellPopover
          anchor={popover.anchor}
          cells={popover.cells}
          baustellen={activeBaustellen}
          partien={partien}
          fahrzeuge={fahrzeuge}
          profilesById={profilesById}
          assignments={assignments}
          onAssignBaustelle={(bId) => {
            assignBaustelle(popover.cells, bId);
            closePopover();
          }}
          onSetFehlzeit={(typ) => {
            setFehlzeit(popover.cells, typ);
            closePopover();
          }}
          onClear={() => {
            clearCells(popover.cells);
            closePopover();
          }}
          onSavedEinteilung={() => {
            loadAssignments();
            toast({ title: "Einteilung aktualisiert" });
            closePopover();
          }}
          onClose={closePopover}
          busy={cellActionBusy}
        />
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? "Baustelle bearbeiten" : "Baustellenmeldung"}
            </DialogTitle>
          </DialogHeader>
          <BaustellenmeldungForm
            initial={editing}
            onCancel={() => {
              setDialogOpen(false);
              setEditing(null);
            }}
            onSaved={() => {
              setDialogOpen(false);
              setEditing(null);
              load();
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Partie-Editor (anlegen / bearbeiten) */}
      <Dialog open={partieDialog} onOpenChange={(o) => !o && closePartieEditor()}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Partien verwalten</DialogTitle>
          </DialogHeader>

          {/* Bestehende Partien — bearbeiten / löschen */}
          {partien.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Bestehende Partien
              </div>
              {partien.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
                    editingPartieId === p.id ? "ring-2 ring-primary" : ""
                  }`}
                >
                  <span
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ background: p.farbcode }}
                  />
                  <span className="flex-1 text-sm truncate">{p.name}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => openPartieEditor(p)}
                    title="Bearbeiten"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-destructive"
                    onClick={() => deletePartieFromPlan(p.id, p.name)}
                    title="Löschen"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="border-t pt-3 text-xs uppercase tracking-wide font-semibold text-muted-foreground">
            {editingPartieId ? "Partie bearbeiten" : "Neue Partie anlegen"}
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">
                Name
              </label>
              <input
                value={newPartieName}
                onChange={(e) => setNewPartieName(e.target.value)}
                placeholder="z.B. Partie Müller"
                autoFocus
                className="w-full h-11 rounded-md border bg-background px-3 text-sm mt-1"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">
                Farbe
              </label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="color"
                  value={newPartieFarbe}
                  onChange={(e) => setNewPartieFarbe(e.target.value)}
                  className="h-11 w-16 rounded-md border bg-background cursor-pointer"
                />
                <div
                  className="h-11 flex-1 rounded-md flex items-center justify-center text-white text-sm font-semibold"
                  style={{ background: newPartieFarbe }}
                >
                  {newPartieName || "Vorschau"}
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">
                Vorarbeiter / Polier (optional)
              </label>
              <select
                value={newPartieleiterId}
                onChange={(e) => setNewPartieleiterId(e.target.value)}
                className="w-full h-11 rounded-md border bg-background px-3 text-sm mt-1"
              >
                <option value="">— später festlegen —</option>
                {profiles
                  .filter((p) => p.is_active !== false)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.vorname} {p.nachname}
                      {p.partie_id ? " (wechselt aus aktueller Partie)" : ""}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closePartieEditor}>
                Abbrechen
              </Button>
              <Button onClick={savePartie} disabled={!newPartieName.trim()}>
                <Plus className="h-4 w-4 mr-1.5" />
                {editingPartieId ? "Speichern" : "Partie anlegen"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Schwebender Ghost beim MA-Namen-Drag */}
      {nameDrag?.active && (
        <div
          className="fixed z-50 pointer-events-none rounded-md bg-primary text-primary-foreground text-[11px] font-semibold px-2 py-1 shadow-lg"
          style={{
            left: nameDrag.pos.x + 12,
            top: nameDrag.pos.y + 12,
          }}
        >
          {nameDrag.member.nachname} {nameDrag.member.vorname}
          {nameDrag.overPartieId !== undefined && (
            <span className="ml-1.5 font-normal opacity-80">
              →{" "}
              {partien.find((p) => p.id === nameDrag.overPartieId)?.name ?? "?"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Polier-Header (interaktiv) ───
function PolierHeader({
  partie,
  polier,
  bvhCount,
  members,
  allPartien,
  unassignedMembers,
  onAssign,
  onDeletePartie,
  onEditPartie,
  isAdmin,
  variant = "desktop",
  collapsed,
  onToggleCollapse,
}: {
  partie: Partie | null;
  polier: string | null;
  bvhCount: number;
  members: Profile[];
  allPartien: Partie[];
  unassignedMembers: Profile[];
  onAssign: (memberId: string, newPartieId: string | null) => void;
  onDeletePartie?: (partieId: string, partieName: string) => void;
  onEditPartie?: (partie: Partie) => void;
  isAdmin: boolean;
  variant?: "desktop" | "mobile";
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const isMobile = variant === "mobile";
  const farbe = partie?.farbcode ?? "#999";

  return (
    <div
      className={`${
        isMobile ? "rounded-t-md py-2 text-xs" : "border-b py-1.5"
      } px-3 flex flex-col justify-center`}
      style={{
        background: partie ? `${partie.farbcode}25` : "hsl(var(--muted))",
        color: partie?.farbcode ?? undefined,
        height: isMobile ? undefined : members.length > 0 ? 56 : 36,
      }}
    >
      <div className="flex items-center gap-2">
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="h-5 w-5 -ml-1 rounded flex items-center justify-center shrink-0 hover:bg-white/60 transition"
            style={{ color: farbe }}
            title={collapsed ? "Partie ausklappen" : "Partie einklappen"}
            aria-label={collapsed ? "Partie ausklappen" : "Partie einklappen"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        )}
        <span
          className={`inline-block ${
            isMobile ? "h-2.5 w-2.5" : "h-3 w-3"
          } rounded-full shrink-0`}
          style={{ background: farbe }}
        />
        <div
          className={`${
            isMobile ? "" : "text-xs"
          } font-bold uppercase flex-1 min-w-0 leading-tight`}
          title={partie ? (polier ? `${polier} · ${partie.name}` : partie.name) : polier ?? ""}
        >
          {polier ? (
            <div className="flex items-baseline gap-x-1.5 min-w-0">
              <span className="text-sm truncate min-w-0">{polier}</span>
              {partie && (
                <span className="text-[10px] font-normal opacity-70 normal-case truncate shrink min-w-0">
                  · {partie.name}
                </span>
              )}
            </div>
          ) : (
            <span className="truncate block">{partie?.name ?? "—"}</span>
          )}
        </div>
        <span className="text-[10px] opacity-70 shrink-0">{bvhCount} BVH</span>
        {isAdmin && partie && onEditPartie && (
          <button
            onClick={() => onEditPartie(partie)}
            className="h-6 w-6 rounded-full bg-white/70 hover:bg-white border flex items-center justify-center shrink-0 transition"
            style={{ color: farbe }}
            title={`Partie „${partie.name}" bearbeiten`}
            aria-label={`Partie ${partie.name} bearbeiten`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        {isAdmin && partie && onDeletePartie && (
          <button
            onClick={() => onDeletePartie(partie.id, partie.name)}
            className="h-6 w-6 rounded-full bg-white/70 hover:bg-destructive hover:text-destructive-foreground border flex items-center justify-center shrink-0 transition"
            style={{ color: farbe }}
            title={`Partie „${partie.name}" löschen`}
            aria-label={`Partie ${partie.name} löschen`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        {isAdmin && partie && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="h-6 w-6 rounded-full bg-white/70 hover:bg-white border flex items-center justify-center shrink-0"
                style={{ color: farbe }}
                title="Mitarbeiter hinzufügen"
              >
                <UserPlus className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-2 max-h-72 overflow-y-auto">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground px-2 pb-1">
                Mitarbeiter zu {partie.name} hinzufügen
              </div>
              {unassignedMembers.length === 0 ? (
                <div className="text-xs text-muted-foreground px-2 py-1.5 italic">
                  Alle Mitarbeiter sind bereits einer Partie zugeordnet.
                </div>
              ) : (
                <div className="space-y-0.5">
                  {unassignedMembers.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => onAssign(m.id, partie.id)}
                      className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted flex items-center gap-2"
                    >
                      <span
                        className="h-5 w-5 rounded-full text-white text-[9px] font-bold flex items-center justify-center shrink-0"
                        style={{ background: farbe }}
                      >
                        {m.vorname[0]}
                        {m.nachname[0]}
                      </span>
                      {m.vorname} {m.nachname}
                    </button>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>
        )}
      </div>
      {members.length > 0 && (
        <div
          className={`flex gap-1 ${
            isMobile ? "mt-1.5" : "mt-1"
          } overflow-x-auto whitespace-nowrap pb-0.5`}
        >
          {members.map((m) => (
            <MemberPill
              key={m.id}
              member={m}
              partie={partie}
              allPartien={allPartien}
              onAssign={onAssign}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Wrapper-Popover für Mitarbeiter-Aktion (Verschieben / Entfernen) ───
// Wird sowohl von MemberPill als auch von den Desktop-/Mobile-Reihen verwendet.
function MemberActionPopover({
  member,
  partie,
  allPartien,
  onAssign,
  children,
}: {
  member: Profile;
  partie: Partie | null;
  allPartien: Partie[];
  onAssign: (memberId: string, newPartieId: string | null) => void;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        <div className="text-xs font-semibold mb-2 px-1">
          {member.vorname} {member.nachname}
          {partie ? (
            <span className="ml-1.5 font-normal text-muted-foreground">
              · {partie.name}
            </span>
          ) : (
            <span className="ml-1.5 font-normal text-amber-700 italic">
              · ohne Partie
            </span>
          )}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground px-1 pb-1">
          {partie ? "In andere Partie verschieben" : "Partie zuordnen"}
        </div>
        <div className="space-y-0.5 mb-1">
          {allPartien.map((p) => {
            const isCurrent = p.id === partie?.id;
            return (
              <button
                key={p.id}
                onClick={() => !isCurrent && onAssign(member.id, p.id)}
                disabled={isCurrent}
                className={`w-full text-left text-xs px-2 py-1.5 rounded flex items-center gap-2 ${
                  isCurrent ? "bg-muted/60 cursor-default" : "hover:bg-muted"
                }`}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ background: p.farbcode }}
                />
                <span className="flex-1">{p.name}</span>
                {isCurrent && (
                  <span className="text-emerald-600 font-bold">✓</span>
                )}
              </button>
            );
          })}
        </div>
        {partie && (
          <button
            onClick={() => onAssign(member.id, null)}
            className="w-full text-left text-xs px-2 py-2 rounded border-t mt-1 pt-2 flex items-center gap-2 text-destructive hover:bg-destructive/10 font-medium"
          >
            <X className="h-3.5 w-3.5" />
            Aus Partie „{partie.name}" entfernen
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ─── Mitarbeiter-Pill mit Popover für Re-Assignment ───
function MemberPill({
  member,
  partie,
  allPartien,
  onAssign,
  isAdmin,
}: {
  member: Profile;
  partie: Partie | null;
  allPartien: Partie[];
  onAssign: (memberId: string, newPartieId: string | null) => void;
  isAdmin: boolean;
}) {
  const farbe = partie?.farbcode ?? "#999";

  if (!isAdmin) {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/60 text-[10px] font-medium shrink-0"
        style={{ color: farbe }}
        title={`${member.vorname} ${member.nachname}`}
      >
        <span
          className="h-3.5 w-3.5 rounded-full text-white text-[7px] font-bold flex items-center justify-center"
          style={{ background: farbe }}
        >
          {member.vorname[0]}
          {member.nachname[0]}
        </span>
        {member.vorname} {member.nachname[0]}.
      </span>
    );
  }

  const otherPartien = allPartien.filter((p) => p.id !== partie?.id);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/70 hover:bg-white text-[10px] font-medium shrink-0 cursor-pointer transition"
          style={{ color: farbe }}
          title="Klick zum Verschieben"
        >
          <span
            className="h-3.5 w-3.5 rounded-full text-white text-[7px] font-bold flex items-center justify-center"
            style={{ background: farbe }}
          >
            {member.vorname[0]}
            {member.nachname[0]}
          </span>
          {member.vorname} {member.nachname[0]}.
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <div className="text-xs font-semibold mb-2 px-1">
          {member.vorname} {member.nachname}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground px-1 pb-1">
          Verschieben nach
        </div>
        <div className="space-y-0.5">
          {otherPartien.map((p) => (
            <button
              key={p.id}
              onClick={() => onAssign(member.id, p.id)}
              className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted flex items-center gap-2"
            >
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ background: p.farbcode }}
              />
              {p.name}
            </button>
          ))}
          <button
            onClick={() => onAssign(member.id, null)}
            className="w-full text-left text-xs px-2 py-2 rounded border-t mt-1 pt-2 flex items-center gap-2 text-destructive hover:bg-destructive/10 font-medium"
          >
            <X className="h-3.5 w-3.5" />
            Aus Partie „{partie?.name ?? "—"}" entfernen
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Cell-Popover (Aktionen für ausgewählte Zellen) ───
function CellPopover({
  anchor,
  cells,
  baustellen,
  partien,
  fahrzeuge,
  profilesById,
  assignments,
  onAssignBaustelle,
  onSetFehlzeit,
  onClear,
  onSavedEinteilung,
  onClose,
  busy,
}: {
  anchor: { x: number; y: number };
  cells: { workerId: string; iso: string }[];
  baustellen: Baustelle[];
  partien: Partie[];
  fahrzeuge: Fahrzeug[];
  profilesById: Record<string, Profile>;
  assignments: Map<string, AssignmentCell>;
  onAssignBaustelle: (baustelleId: string) => void;
  onSetFehlzeit: (typ: string) => void;
  onClear: () => void;
  onSavedEinteilung: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  const { toast } = useToast();
  const hasExisting = cells.some((c) => assignments.get(cellKey(c.workerId, c.iso)));
  // Wenn alle ausgewählten Cells zur gleichen Einteilung gehören, zeigen wir den
  // Tätigkeit + Fahrzeug-Editor inline.
  const singleEinteilungId = useMemo(() => {
    const ids = new Set<string>();
    cells.forEach((c) => {
      const a = assignments.get(cellKey(c.workerId, c.iso));
      if (a?.source === "einteilung" && a.einteilungId) ids.add(a.einteilungId);
    });
    return ids.size === 1 ? Array.from(ids)[0] : null;
  }, [cells, assignments]);
  const [taetigkeit, setTaetigkeit] = useState("");
  const [selectedFahrzeuge, setSelectedFahrzeuge] = useState<Set<string>>(new Set());
  const [savingDetails, setSavingDetails] = useState(false);
  // Existierende Werte laden + Bauleiter-Auto-Vorschlag wenn leer.
  // Als benannte Funktion, damit sie nach einem Speicherfehler den
  // echten DB-Zustand zurückholen kann.
  const ladeDetails = async () => {
    if (!singleEinteilungId) {
      setTaetigkeit("");
      setSelectedFahrzeuge(new Set());
      return;
    }
    const [{ data: e }, { data: ef }] = await Promise.all([
      supabase
        .from("jahresplan_einteilungen")
        .select("taetigkeit")
        .eq("id", singleEinteilungId)
        .maybeSingle(),
      supabase
        .from("jahresplan_fahrzeuge")
        .select("fahrzeug_id")
        .eq("einteilung_id", singleEinteilungId),
    ]);
    setTaetigkeit((e?.taetigkeit as string) ?? "");
    const existing = new Set(
      ((ef ?? []) as any[]).map((r) => r.fahrzeug_id as string)
    );
    // Auto-Vorschlag: wenn keine Fahrzeuge gesetzt, aber ein
    // Bauleiter (Worker mit standard_fahrer_id auf einem
    // bauleiter-Fahrzeug) in den Zellen ist → vorschlagen
    if (existing.size === 0) {
      const workerIds = new Set(cells.map((c) => c.workerId));
      fahrzeuge.forEach((f) => {
        if (
          f.kategorie === "bauleiter" &&
          f.standard_fahrer_id &&
          workerIds.has(f.standard_fahrer_id)
        ) {
          existing.add(f.id);
        }
      });
    }
    setSelectedFahrzeuge(existing);
  };
  useEffect(() => {
    void ladeDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [singleEinteilungId, cells, fahrzeuge]);

  const saveDetails = async () => {
    if (!singleEinteilungId) return;
    setSavingDetails(true);
    try {
      // 1) Tätigkeit aktualisieren
      const { error: updErr } = await supabase
        .from("jahresplan_einteilungen")
        .update({ taetigkeit: taetigkeit.trim() || null })
        .eq("id", singleEinteilungId);
      if (updErr) {
        toast({ variant: "destructive", title: "Speichern fehlgeschlagen", description: updErr.message });
        return;
      }
      // 2) Fahrzeug-Set ersetzen (delete-all + insert) — jeder Schritt geprüft,
      // sonst verschwanden Fahrzeuge bei Teilfehlern stillschweigend
      const { error: delErr } = await supabase
        .from("jahresplan_fahrzeuge")
        .delete()
        .eq("einteilung_id", singleEinteilungId);
      if (delErr) {
        toast({ variant: "destructive", title: "Fahrzeuge speichern fehlgeschlagen", description: delErr.message });
        void ladeDetails(); // echten DB-Zustand anzeigen
        return;
      }
      if (selectedFahrzeuge.size > 0) {
        const { error: insErr } = await supabase
          .from("jahresplan_fahrzeuge")
          .insert(
            Array.from(selectedFahrzeuge).map((fid) => ({
              einteilung_id: singleEinteilungId,
              fahrzeug_id: fid,
            })) as any
          );
        if (insErr) {
          toast({ variant: "destructive", title: "Fahrzeuge speichern fehlgeschlagen", description: insErr.message });
          void ladeDetails(); // Delete war schon durch → echten DB-Zustand anzeigen
          return;
        }
      }
      onSavedEinteilung();
    } finally {
      setSavingDetails(false);
    }
  };
  const [w] = [320]; // popover width — breit genug für volle Baustellen-Namen
  // Position: clamp innerhalb viewport, mit margin oben + unten
  const margin = 12;
  const maxH = Math.min(window.innerHeight - 2 * margin, 600);
  const x = Math.min(Math.max(8, anchor.x - w / 2), window.innerWidth - w - 8);
  // y so platzieren, dass das Popover komplett sichtbar ist; bevorzugt unter dem
  // Klick, sonst über dem Klick, sonst am unteren Rand verankert.
  let y = anchor.y + margin;
  if (y + maxH > window.innerHeight - margin) {
    // passt nicht drunter — versuch's drüber
    const yAbove = anchor.y - maxH - margin;
    y = yAbove >= margin ? yAbove : window.innerHeight - maxH - margin;
  }

  const uniqueDates = useMemo(
    () => Array.from(new Set(cells.map((c) => c.iso))).sort(),
    [cells]
  );
  const uniqueWorkerIds = useMemo(
    () => Array.from(new Set(cells.map((c) => c.workerId))),
    [cells]
  );
  const dayPart =
    uniqueDates.length === 0
      ? ""
      : uniqueDates.length === 1
      ? new Date(uniqueDates[0]).toLocaleDateString("de-AT", {
          weekday: "short",
          day: "2-digit",
          month: "2-digit",
        })
      : `${new Date(uniqueDates[0]).toLocaleDateString("de-AT", {
          day: "2-digit",
          month: "2-digit",
        })} – ${new Date(uniqueDates[uniqueDates.length - 1]).toLocaleDateString("de-AT", {
          day: "2-digit",
          month: "2-digit",
        })} (${uniqueDates.length} Tage)`;
  const workerPart = (() => {
    if (uniqueWorkerIds.length === 0) return "";
    if (uniqueWorkerIds.length === 1) {
      const p = profilesById[uniqueWorkerIds[0]];
      return p ? `${p.vorname} ${p.nachname}` : "";
    }
    return `${uniqueWorkerIds.length} Mitarbeiter`;
  })();
  // Aktuelle Einteilung der Selektion (nur wenn alle Cells vorhanden + gleicher
  // Baustelle zugehörig)
  const currentBaustelleName = (() => {
    if (!singleEinteilungId) return null;
    const a = cells.map((c) => assignments.get(cellKey(c.workerId, c.iso))).find(Boolean);
    return a?.baustelleName ?? null;
  })();

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-card border-2 border-primary/30 rounded-lg shadow-xl p-3 overflow-y-auto overscroll-contain"
        style={{ left: x, top: y, width: w, maxHeight: maxH }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Kontext-Header: Wer + Wann + (falls vorhanden) aktuelle Baustelle */}
        <div className="mb-2 pb-2 border-b">
          {workerPart && (
            <div className="text-sm font-bold leading-tight">{workerPart}</div>
          )}
          <div className="text-[11px] text-muted-foreground">{dayPart}</div>
          {currentBaustelleName && (
            <div className="text-[11px] mt-1 inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
              <span className="opacity-70">aktuell:</span>
              <strong className="truncate max-w-[240px]">{currentBaustelleName}</strong>
            </div>
          )}
        </div>

        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          {hasExisting ? "Auf andere Baustelle verschieben" : "Auf Baustelle einteilen"}
        </div>
        <div className="space-y-1 max-h-44 overflow-y-auto mb-2">
          {baustellen.length === 0 ? (
            <div className="text-xs text-muted-foreground italic px-1">
              Keine aktiven Baustellen.
            </div>
          ) : (
            baustellen.map((b) => {
              const partie = b.partie_id ? partien.find((p) => p.id === b.partie_id) : null;
              return (
                <button
                  key={b.id}
                  onClick={() => onAssignBaustelle(b.id)}
                  className="w-full text-left text-xs px-2 py-2 rounded hover:bg-muted flex items-start gap-2"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0 mt-1"
                    style={{ background: partie?.farbcode ?? "#6b7280" }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium leading-tight break-words">{b.bvh_name}</div>
                    {(b.kostenstelle || b.ort) && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {[b.kostenstelle, b.ort].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 border-t pt-2">
          Fehlzeit
        </div>
        <div className="grid grid-cols-2 gap-1 mb-2">
          {Object.entries(FEHLZEIT_LABEL).map(([k, l]) => (
            <button
              key={k}
              onClick={() => onSetFehlzeit(k)}
              disabled={busy}
              className="text-xs px-2 py-2 rounded text-white font-medium disabled:opacity-50"
              style={{ background: FEHLZEIT_COLOR[k] }}
            >
              {k} · {l}
            </button>
          ))}
        </div>

        {/* Tätigkeit + Fahrzeuge — nur wenn alle markierten Cells zur gleichen
            Einteilung gehören (gleiche Baustelle + gleicher Tag) */}
        {singleEinteilungId && (
          <div className="border-t pt-2 mb-2 space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Tätigkeit & Fahrzeuge
            </div>
            <input
              type="text"
              value={taetigkeit}
              onChange={(e) => setTaetigkeit(e.target.value)}
              placeholder="z.B. Montage, Abbund, Streichen"
              className="w-full h-9 rounded-md border bg-background px-2 text-xs"
            />
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1.5">
              Fahrzeuge ({selectedFahrzeuge.size})
            </div>
            {fahrzeuge.length === 0 ? (
              <div className="text-[11px] text-muted-foreground italic">
                Keine aktiven Fahrzeuge — anlegen unter „Fahrzeuge".
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1 max-h-32 overflow-y-auto">
                {fahrzeuge.map((f) => {
                  const sel = selectedFahrzeuge.has(f.id);
                  return (
                    <button
                      key={f.id}
                      onClick={() => {
                        const next = new Set(selectedFahrzeuge);
                        if (sel) next.delete(f.id);
                        else next.add(f.id);
                        setSelectedFahrzeuge(next);
                      }}
                      className={`text-[11px] px-2 py-1.5 rounded border text-left transition truncate ${
                        sel
                          ? "border-primary bg-primary/10 text-primary font-semibold"
                          : "border-border hover:bg-muted"
                      }`}
                      title={`${f.kennzeichen}${f.bezeichnung ? ` · ${f.bezeichnung}` : ""}`}
                    >
                      {f.kennzeichen}
                      {f.bezeichnung && (
                        <span className="block text-[9px] opacity-70 truncate">
                          {f.bezeichnung}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <button
              onClick={saveDetails}
              disabled={savingDetails}
              className="w-full text-xs px-2 py-2 rounded bg-primary text-primary-foreground font-semibold hover:bg-primary/90 disabled:opacity-50"
            >
              {savingDetails ? "Speichert…" : "Tätigkeit & Fahrzeuge speichern"}
            </button>
          </div>
        )}

        {hasExisting && (
          <button
            onClick={onClear}
            disabled={busy}
            className="w-full text-xs px-2 py-2.5 rounded border border-destructive/40 text-destructive font-semibold hover:bg-destructive hover:text-destructive-foreground flex items-center justify-center gap-1.5 mb-1 transition disabled:opacity-50 disabled:pointer-events-none"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {(() => {
              if (uniqueWorkerIds.length === 1 && uniqueDates.length === 1) {
                const p = profilesById[uniqueWorkerIds[0]];
                return p
                  ? `${p.vorname} aus dieser Einteilung nehmen`
                  : "Aus Einteilung nehmen";
              }
              if (uniqueWorkerIds.length === 1 && uniqueDates.length > 1) {
                return `${uniqueDates.length} Tage entfernen`;
              }
              if (uniqueWorkerIds.length > 1 && uniqueDates.length === 1) {
                return `${uniqueWorkerIds.length} Mitarbeiter aus dieser Einteilung nehmen`;
              }
              return `${cells.length} Einteilungen entfernen`;
            })()}
          </button>
        )}
        <button
          onClick={onClose}
          className="w-full text-xs px-2 py-1.5 rounded hover:bg-muted text-muted-foreground"
        >
          Abbrechen
        </button>
      </div>
    </>
  );
}

// ─── Mobile: Worker-Plan kompakt ───
function MobileWorkerPlan({
  workerGroups,
  dayHeaders,
  assignments,
  selection,
  isAdmin,
  onCellPointerDown,
  partien,
  onAssignMember,
  onEditPartie,
}: {
  workerGroups: { partie: Partie | null; members: Profile[] }[];
  dayHeaders: any[];
  assignments: Map<string, AssignmentCell>;
  selection: Set<string>;
  isAdmin: boolean;
  onCellPointerDown: (e: React.PointerEvent, workerId: string, iso: string) => void;
  partien: Partie[];
  onAssignMember: (memberId: string, newPartieId: string | null) => void;
  onEditPartie?: (partie: Partie) => void;
}) {
  if (workerGroups.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          Keine Mitarbeiter in Partien zugeordnet.
        </CardContent>
      </Card>
    );
  }
  return (
    <>
      {workerGroups.map((g) => (
        <Card key={g.partie?.id ?? "ohne"} className="overflow-hidden">
          <div
            className="px-3 py-2 text-xs font-bold uppercase flex items-center gap-2"
            style={{
              background: g.partie ? `${g.partie.farbcode}25` : "hsl(var(--muted))",
              color: g.partie?.farbcode ?? undefined,
            }}
          >
            <span className="flex-1 truncate">{g.partie?.name ?? "—"}</span>
            {isAdmin && g.partie && onEditPartie && (
              <button
                onClick={() => onEditPartie(g.partie!)}
                className="h-7 w-7 rounded-full bg-white/70 hover:bg-white flex items-center justify-center shrink-0"
                style={{ color: g.partie.farbcode ?? undefined }}
                title={`Partie „${g.partie.name}" bearbeiten`}
                aria-label={`Partie ${g.partie.name} bearbeiten`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <div style={{ minWidth: dayHeaders.length * 22 + 120 }}>
              {/* Day-header */}
              <div
                className="grid border-b text-[9px] text-center"
                style={{
                  gridTemplateColumns: `120px repeat(${dayHeaders.length}, 22px)`,
                  background: "hsl(var(--muted))",
                }}
              >
                <div className="py-1 px-2 border-r font-semibold text-left">Mitarbeiter</div>
                {dayHeaders.map((d, i) => (
                  <div
                    key={i}
                    title={
                      d.feiertag
                        ? `${d.feiertag.name}${d.feiertag.scope === "kaernten" ? " (Kärnten)" : ""}`
                        : undefined
                    }
                    className={`py-1 ${
                      d.isToday
                        ? "bg-primary/20 text-primary font-semibold"
                        : d.feiertag
                        ? "bg-violet-200 text-violet-900 font-semibold"
                        : ""
                    }`}
                  >
                    {d.date.getDate()}
                  </div>
                ))}
              </div>
              {/* Rows */}
              {g.members.map((m) => (
                <div
                  key={m.id}
                  className="grid border-b text-[10px] items-center"
                  style={{
                    gridTemplateColumns: `120px repeat(${dayHeaders.length}, 22px)`,
                    height: 28,
                  }}
                >
                  {(() => {
                    const cell = (
                      <button
                        type="button"
                        className={`px-2 border-r truncate font-medium flex items-center gap-1.5 h-full text-left ${
                          isAdmin ? "hover:bg-muted active:bg-muted/70" : ""
                        }`}
                        title={
                          isAdmin
                            ? `${m.vorname} ${m.nachname} · tippen zum Verschieben/Entfernen`
                            : `${m.vorname} ${m.nachname}`
                        }
                      >
                        <span
                          className="h-4 w-4 rounded-full flex items-center justify-center text-white text-[7px] font-bold shrink-0"
                          style={{ background: g.partie?.farbcode ?? "#999" }}
                        >
                          {m.vorname[0]}
                          {m.nachname[0]}
                        </span>
                        <span className="truncate">{m.nachname}</span>
                      </button>
                    );
                    if (!isAdmin) return cell;
                    return (
                      <MemberActionPopover
                        member={m}
                        partie={g.partie}
                        allPartien={partien}
                        onAssign={onAssignMember}
                      >
                        {cell}
                      </MemberActionPopover>
                    );
                  })()}
                  {dayHeaders.map((d, i) => {
                    const iso = isoDate(d.date);
                    const a = assignments.get(cellKey(m.id, iso));
                    const isFeiertag = !!d.feiertag;
                    let bg = "transparent";
                    let label = "";
                    if (a) {
                      if (a.source === "fehlzeit") {
                        bg = FEHLZEIT_COLOR[a.fehlzeitTyp ?? "U"] ?? "#6b7280";
                        label = a.fehlzeitTyp ?? "";
                      } else {
                        bg = a.baustelleColor ?? "#6b7280";
                        label = (a.baustelleName ?? "").slice(0, 1);
                      }
                    } else if (isFeiertag) {
                      bg = "#8b5cf6";
                      label = "F";
                    }
                    const sel = selection.has(cellKey(m.id, iso));
                    const tooltipText = a
                      ? a.source === "fehlzeit"
                        ? `${FEHLZEIT_LABEL[a.fehlzeitTyp ?? ""] ?? a.fehlzeitTyp ?? ""} · ${new Date(
                            iso
                          ).toLocaleDateString("de-AT")}${
                            a.isReadOnly ? " (eingereicht)" : ""
                          }`
                        : `${a.baustelleName ?? "Baustelle"} · ${new Date(
                            iso
                          ).toLocaleDateString("de-AT")}${
                            a.isReadOnly ? " (eingereicht)" : ""
                          }`
                      : isFeiertag
                      ? `Feiertag: ${d.feiertag?.name} · ${new Date(iso).toLocaleDateString("de-AT")}`
                      : new Date(iso).toLocaleDateString("de-AT");
                    const ariaLbl = `${m.vorname} ${m.nachname} – ${tooltipText}`;
                    return (
                      <button
                        key={i}
                        data-cell="1"
                        data-worker={m.id}
                        data-iso={iso}
                        onPointerDown={(e) => onCellPointerDown(e, m.id, iso)}
                        disabled={!isAdmin}
                        title={tooltipText}
                        aria-label={ariaLbl}
                        className={`text-[9px] truncate font-medium ${
                          d.isToday ? "ring-1 ring-primary/40 ring-inset" : ""
                        } ${sel ? "ring-2 ring-primary ring-inset z-10" : ""}`}
                        style={{
                          height: "100%",
                          background: bg,
                          color: bg !== "transparent" ? "white" : undefined,
                          opacity: isFeiertag && !a ? 0.55 : a?.isReadOnly ? 0.65 : 1,
                          cursor: isAdmin ? "pointer" : "default",
                          touchAction: isAdmin ? "none" : undefined,
                          userSelect: "none",
                          position: "relative",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </Card>
      ))}
    </>
  );
}
