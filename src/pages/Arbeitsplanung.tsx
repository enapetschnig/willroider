import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, ChevronLeft, ChevronRight, Filter, Building2, UserPlus, X, Users, Trash2, Pencil, FileText, Download } from "lucide-react";
import {
  generateTagesplanDocx,
  shareOrDownloadDocx,
  type TagesplanData,
  type EinteilungBlock,
  type SpezialBlock,
} from "@/lib/arbeitseinteilungDocx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BaustellenmeldungForm } from "@/components/BaustellenmeldungForm";
import { useToast } from "@/hooks/use-toast";
import type { Database, BaustellenStatus } from "@/integrations/supabase/types";
import { feiertagAt, type FeiertagInfo } from "@/lib/feiertage";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];
type Termin = Database["public"]["Tables"]["baustellen_termine"]["Row"];
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

const STATUS_COLOR: Record<BaustellenStatus, string> = {
  aktiv: "bg-emerald-500",
  geplant: "bg-blue-500",
  pausiert: "bg-amber-500",
  abgeschlossen: "bg-gray-400",
};

const STATUS_DOT: Record<BaustellenStatus, string> = {
  aktiv: "#10b981",
  geplant: "#3b82f6",
  pausiert: "#f59e0b",
  abgeschlossen: "#9ca3af",
};

const STATUS_LABEL: Record<BaustellenStatus, string> = {
  aktiv: "Aktiv",
  geplant: "Geplant",
  pausiert: "Pausiert",
  abgeschlossen: "Abgeschlossen",
};

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

const cellKey = (workerId: string, iso: string) => `${workerId}:${iso}`;
// Lokale ISO-Konvertierung (KEIN toISOString — sonst Timezone-Bug:
// 1. Mai 00:00 lokal wird in CEST zu 30. April 22:00 UTC → falsches Datum)
const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function Arbeitsplanung() {
  const { canCreateBaustelle, isAdmin } = useAuth();
  const { toast } = useToast();
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [partien, setPartien] = useState<Partie[]>([]);
  const [termine, setTermine] = useState<Termin[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [fahrzeuge, setFahrzeuge] = useState<Fahrzeug[]>([]);
  const [filterPartie, setFilterPartie] = useState<string>("alle");
  const [weeksVisible, setWeeksVisible] = useState(20);
  const [anchorWeek, setAnchorWeek] = useState<Date>(() => {
    const today = new Date();
    today.setDate(today.getDate() - 14); // start 2 weeks ago
    return startOfISOWeek(today);
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Baustelle> | null>(null);
  const [partieDialog, setPartieDialog] = useState(false);
  const [tagesplanDate, setTagesplanDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [tagesplanBusy, setTagesplanBusy] = useState(false);
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
  const dayWidth = 22; // px

  const load = async () => {
    const [bs, p, t, pr, fz] = await Promise.all([
      supabase.from("baustellen").select("*").order("start_datum", { ascending: true }),
      supabase.from("partien").select("*").order("name"),
      supabase.from("baustellen_termine").select("*"),
      supabase.from("profiles").select("*"),
      supabase.from("fahrzeuge").select("*").eq("aktiv", true).order("kennzeichen"),
    ]);
    setBaustellen((bs.data as Baustelle[]) ?? []);
    setPartien((p.data as Partie[]) ?? []);
    setTermine((t.data as Termin[]) ?? []);
    setProfiles((pr.data as Profile[]) ?? []);
    setFahrzeuge((fz.data as Fahrzeug[]) ?? []);
  };

  const loadAssignments = async () => {
    const startIso = isoDate(rangeStart);
    const endIso = isoDate(new Date(rangeStart.getTime() + (totalDays - 1) * DAY_MS));
    const [{ data: emRows }, { data: fzRows }] = await Promise.all([
      supabase
        .from("einteilung_mitarbeiter")
        .select(
          "id, mitarbeiter_id, einteilung_id, einteilungen!inner(id, datum, baustelle_id, baustellen(bvh_name))"
        )
        .gte("einteilungen.datum", startIso)
        .lte("einteilungen.datum", endIso),
      supabase
        .from("stundenbuchungen")
        .select("id, mitarbeiter_id, datum, fehlzeit_typ, status")
        .gte("datum", startIso)
        .lte("datum", endIso)
        .not("fehlzeit_typ", "is", null),
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
        fehlzeitTyp: r.fehlzeit_typ,
        status: r.status,
        isReadOnly: r.status !== "offen",
      });
    });
    setAssignments(map);
  };

  useEffect(() => {
    load();

    const ch = supabase
      .channel("planung-bs")
      .on("postgres_changes", { event: "*", schema: "public", table: "baustellen" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "baustellen_termine" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "einteilungen" }, () => loadAssignments())
      .on("postgres_changes", { event: "*", schema: "public", table: "einteilung_mitarbeiter" }, () => loadAssignments())
      .on("postgres_changes", { event: "*", schema: "public", table: "stundenbuchungen" }, () => loadAssignments())
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
  const bauleiterShort = (id: string | null) => {
    if (!id) return "—";
    const p = profilesById[id];
    return p ? p.nachname : "—";
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
        : filterPartie === "ohne"
        ? []
        : partien.filter((p) => p.id === filterPartie);
    filtered.forEach((p) => {
      const members = (membersByPartie[p.id] ?? []).filter((m) => m.is_active !== false);
      if (members.length > 0) groups.push({ partie: p, members });
    });
    return groups;
  }, [partien, membersByPartie, filterPartie]);

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
    startIdx: number; // Index in dayHeaders
    endIdx: number;   // inklusive
    color: string;
    label: string; // BVH-Name oder Fehlzeit-Typ-Label
    source: "einteilung" | "fehlzeit";
    baustelleId?: string | null;
    fehlzeitTyp?: string;
    isReadOnly: boolean;
    einteilungIds: Set<string>;
  };
  const barsByWorker = useMemo(() => {
    const result = new Map<string, Bar[]>();
    if (workerGroups.length === 0 || dayHeaders.length === 0) return result;
    for (const g of workerGroups) {
      for (const m of g.members) {
        const bars: Bar[] = [];
        let cur: Bar | null = null;
        for (let i = 0; i < dayHeaders.length; i++) {
          const iso = isoDate(dayHeaders[i].date);
          const a = assignments.get(cellKey(m.id, iso));
          if (!a) {
            cur = null;
            continue;
          }
          // Kontinuitäts-Schlüssel: gleiche Quelle + gleiche Baustelle/Fehlzeit
          const key =
            a.source === "fehlzeit"
              ? `f:${a.fehlzeitTyp ?? ""}`
              : `e:${a.baustelleId ?? "x"}`;
          if (cur && (cur as any)._key === key && cur.endIdx === i - 1) {
            cur.endIdx = i;
            if (a.einteilungId) cur.einteilungIds.add(a.einteilungId);
            cur.isReadOnly = cur.isReadOnly && !!a.isReadOnly;
            continue;
          }
          // Neuer Bar
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
          };
          (cur as any)._key = key;
          bars.push(cur);
        }
        if (bars.length > 0) result.set(m.id, bars);
      }
    }
    return result;
  }, [workerGroups, dayHeaders, assignments]);

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
    const dates: string[] = [];
    for (let t = s; t <= e; t += DAY_MS) dates.push(isoDate(new Date(t)));
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

  // ─── Tagesplan-Daten aggregieren + DOCX generieren ───
  const buildTagesplanData = async (iso: string): Promise<TagesplanData> => {
    // 1) Einteilungen am Tag mit Baustelle, Tätigkeit, Mitarbeiter, Fahrzeuge
    const { data: einteilungenRaw } = await supabase
      .from("einteilungen")
      .select(
        "id, baustelle_id, taetigkeit, baustellen(bvh_name, kostenstelle), einteilung_mitarbeiter(mitarbeiter_id, profiles(vorname, nachname)), einteilung_fahrzeuge(fahrzeug_id, fahrzeuge(kennzeichen, bezeichnung))"
      )
      .eq("datum", iso);

    type Block = {
      bvhName: string;
      kostenstelle: string | null;
      fahrzeuge: string[];
      taetigkeit: string | null;
      mitarbeiter: string[];
    };
    const blocks: Block[] = [];
    const polierschuleNames: string[] = [];
    for (const e of (einteilungenRaw ?? []) as any[]) {
      const baustelleName = e.baustellen?.bvh_name ?? "—";
      const kostenstelle = e.baustellen?.kostenstelle ?? null;
      const taet: string | null = e.taetigkeit ?? null;
      const mitarbeiter = (e.einteilung_mitarbeiter ?? [])
        .map((em: any) =>
          em.profiles ? `${em.profiles.vorname} ${em.profiles.nachname}`.trim() : null
        )
        .filter(Boolean) as string[];
      const fahrzeuge = (e.einteilung_fahrzeuge ?? [])
        .map((ef: any) => {
          const kz = ef.fahrzeuge?.kennzeichen ?? "";
          const bez = ef.fahrzeuge?.bezeichnung;
          return bez ? `${kz} (${bez})` : kz;
        })
        .filter(Boolean) as string[];

      // Spezialfall: Polierschule/Berufsschule/Bundesheer als Tätigkeit ohne Baustelle
      if (
        !e.baustelle_id &&
        taet &&
        /polierschule|berufsschule|bundesheer/i.test(taet)
      ) {
        polierschuleNames.push(...mitarbeiter);
        continue;
      }

      blocks.push({
        bvhName: baustelleName,
        kostenstelle,
        fahrzeuge,
        taetigkeit: taet,
        mitarbeiter,
      });
    }

    // 2) Fehlzeiten am Tag → Urlaub / Krank
    const { data: fz } = await supabase
      .from("stundenbuchungen")
      .select("fehlzeit_typ, mitarbeiter_id, profiles(vorname, nachname)")
      .eq("datum", iso)
      .not("fehlzeit_typ", "is", null);

    const urlaubNames: string[] = [];
    const krankNames: string[] = [];
    for (const r of (fz ?? []) as any[]) {
      const name = r.profiles
        ? `${r.profiles.vorname} ${r.profiles.nachname}`.trim()
        : null;
      if (!name) continue;
      if (r.fehlzeit_typ === "U") urlaubNames.push(name);
      else if (r.fehlzeit_typ === "K") krankNames.push(name);
    }

    // 3) Spezialblöcke nur wenn nicht leer
    const polierschule: SpezialBlock | null =
      polierschuleNames.length > 0
        ? {
            label: "Polierschule:\nBerufsschule:\nBundesheer",
            fahrzeuge: [],
            taetigkeit: null,
            mitarbeiter: polierschuleNames,
          }
        : null;
    const urlaub: SpezialBlock | null =
      urlaubNames.length > 0
        ? { label: "Urlaub:", fahrzeuge: [], taetigkeit: null, mitarbeiter: urlaubNames }
        : null;
    const krank: SpezialBlock | null =
      krankNames.length > 0
        ? { label: "Krank:", fahrzeuge: [], taetigkeit: null, mitarbeiter: krankNames }
        : null;

    return {
      datum: iso,
      einteilungen: blocks as EinteilungBlock[],
      urlaub,
      polierschule,
      krank,
    };
  };

  const exportTagesplan = async () => {
    if (tagesplanBusy) return;
    setTagesplanBusy(true);
    try {
      const data = await buildTagesplanData(tagesplanDate);
      const blob = await generateTagesplanDocx(data);
      const fileName = `Arbeitseinteilung ${tagesplanDate}.docx`;
      await shareOrDownloadDocx(blob, fileName);
      toast({ title: `Tagesplan ${tagesplanDate} erstellt` });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Tagesplan-Export fehlgeschlagen",
        description: err?.message ?? String(err),
      });
    } finally {
      setTagesplanBusy(false);
    }
  };

  // ─── Cell-Aktionen: Mitarbeiter pro Tag einteilen / Fehlzeit setzen ───
  const clearCellsRaw = async (cells: { workerId: string; iso: string }[]) => {
    if (cells.length === 0) return;
    const workerIds = Array.from(new Set(cells.map((c) => c.workerId)));
    const dates = Array.from(new Set(cells.map((c) => c.iso)));
    // Einteilung-Mitarbeiter-Einträge für (worker, datum) löschen
    const { data: emToDelete } = await supabase
      .from("einteilung_mitarbeiter")
      .select("id, mitarbeiter_id, einteilung_id, einteilungen!inner(datum)")
      .in("mitarbeiter_id", workerIds)
      .in("einteilungen.datum", dates);
    const emIds = (emToDelete ?? [])
      .filter((r: any) =>
        cells.some(
          (c) => c.workerId === r.mitarbeiter_id && c.iso === r.einteilungen?.datum
        )
      )
      .map((r: any) => r.id);
    if (emIds.length > 0) {
      await supabase.from("einteilung_mitarbeiter").delete().in("id", emIds);
    }
    // Fehlzeit-Einträge mit Status offen löschen
    const { data: fzToDelete } = await supabase
      .from("stundenbuchungen")
      .select("id, mitarbeiter_id, datum")
      .in("mitarbeiter_id", workerIds)
      .in("datum", dates)
      .not("fehlzeit_typ", "is", null)
      .eq("status", "offen");
    const fzIds = (fzToDelete ?? [])
      .filter((r: any) => cells.some((c) => c.workerId === r.mitarbeiter_id && c.iso === r.datum))
      .map((r: any) => r.id);
    if (fzIds.length > 0) {
      await supabase.from("stundenbuchungen").delete().in("id", fzIds);
    }
  };

  const assignBaustelle = async (
    cells: { workerId: string; iso: string }[],
    baustelleId: string
  ) => {
    if (!isAdmin || cells.length === 0) return;
    await clearCellsRaw(cells);

    // Einteilungen pro datum sicherstellen, dann einteilung_mitarbeiter Insert
    const inserts: { mitarbeiter_id: string; einteilung_id: string }[] = [];
    const datesSeen = new Map<string, string>(); // iso -> einteilung_id
    for (const c of cells) {
      let einteilungId = datesSeen.get(c.iso);
      if (!einteilungId) {
        const { data: existing } = await supabase
          .from("einteilungen")
          .select("id")
          .eq("datum", c.iso)
          .eq("baustelle_id", baustelleId)
          .maybeSingle();
        if (existing?.id) {
          einteilungId = existing.id;
        } else {
          const { data: created, error } = await supabase
            .from("einteilungen")
            .insert({ datum: c.iso, baustelle_id: baustelleId })
            .select("id")
            .single();
          if (error) {
            toast({ variant: "destructive", title: "Fehler", description: error.message });
            return;
          }
          einteilungId = created!.id;
        }
        datesSeen.set(c.iso, einteilungId!);
      }
      inserts.push({ mitarbeiter_id: c.workerId, einteilung_id: einteilungId! });
    }
    if (inserts.length > 0) {
      const { error } = await supabase.from("einteilung_mitarbeiter").insert(inserts as any);
      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: error.message });
        return;
      }
    }
    toast({ title: `${cells.length} Tag${cells.length === 1 ? "" : "e"} eingeteilt` });
    loadAssignments();
  };

  const setFehlzeit = async (cells: { workerId: string; iso: string }[], typ: string) => {
    if (!isAdmin || cells.length === 0) return;
    await clearCellsRaw(cells);
    const rows = cells.map((c) => ({
      mitarbeiter_id: c.workerId,
      datum: c.iso,
      fehlzeit_typ: typ,
      fehlzeit_stunden: 8,
      arbeitsstunden: 0,
      status: "offen",
    }));
    const { error } = await supabase.from("stundenbuchungen").insert(rows as any);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({
      title: `${FEHLZEIT_LABEL[typ] ?? typ} für ${cells.length} Tag${cells.length === 1 ? "" : "e"} gesetzt`,
    });
    loadAssignments();
  };

  const clearCells = async (cells: { workerId: string; iso: string }[]) => {
    if (!isAdmin || cells.length === 0) return;
    await clearCellsRaw(cells);
    toast({ title: `${cells.length} Eintrag${cells.length === 1 ? "" : "e"} entfernt` });
    loadAssignments();
  };

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

  const positionFor = (b: Baustelle) => {
    if (!b.start_datum) return null;
    const start = new Date(b.start_datum);
    start.setHours(0, 0, 0, 0);
    const end = b.end_datum ? new Date(b.end_datum) : new Date(start.getTime() + 7 * DAY_MS);
    end.setHours(0, 0, 0, 0);
    if (end < rangeStart || start > rangeEnd) return null;
    const clampedStart = start < rangeStart ? rangeStart : start;
    const clampedEnd = end > rangeEnd ? rangeEnd : end;
    const left = ((clampedStart.getTime() - rangeStart.getTime()) / DAY_MS) * dayWidth;
    const width = ((clampedEnd.getTime() - clampedStart.getTime()) / DAY_MS + 1) * dayWidth;
    return { left, width };
  };

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
          {/* Tagesplan-Export */}
          {isAdmin && (
            <div className="flex items-center gap-1.5 border-l pl-2 ml-1">
              <input
                type="date"
                value={tagesplanDate}
                onChange={(e) => setTagesplanDate(e.target.value)}
                className="h-8 rounded-md border bg-background px-2 text-xs"
                aria-label="Datum für Tagesplan"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={exportTagesplan}
                disabled={tagesplanBusy}
                title="Tagesplan als Word-Dokument exportieren / teilen"
              >
                <FileText className="h-4 w-4 mr-1.5" />
                {tagesplanBusy ? "Erstelle…" : "Tagesplan"}
                <Download className="h-3.5 w-3.5 ml-1.5 opacity-60" />
              </Button>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={filterPartie} onValueChange={setFilterPartie}>
              <SelectTrigger className="w-44 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alle">Alle Partien</SelectItem>
                <SelectItem value="ohne">Ohne Partie</SelectItem>
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
              return (
                <div key={g.partie?.id ?? "ohne"}>
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
                  />
                  {g.members.map((m) => {
                    const row = (
                      <button
                        type="button"
                        className={`border-b flex items-center gap-2 px-2 text-[11px] w-full text-left transition ${
                          isAdmin
                            ? "hover:bg-muted cursor-pointer"
                            : "cursor-default"
                        }`}
                        style={{ height: 28 }}
                        title={
                          isAdmin
                            ? `${m.vorname} ${m.nachname} · klick zum Verschieben/Entfernen`
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
                {workerGroups.map((g) => (
                  <div key={g.partie?.id ?? "ohne"}>
                    <div
                      className="border-b"
                      style={{
                        height: 36,
                        background: g.partie ? `${g.partie.farbcode}25` : "hsl(var(--muted))",
                      }}
                    />
                    {g.members.map((m) => {
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
                          {/* Bars */}
                          {bars.map((bar, bi) => {
                            const left = bar.startIdx * dayWidth + 1;
                            const width = (bar.endIdx - bar.startIdx + 1) * dayWidth - 2;
                            const days = bar.endIdx - bar.startIdx + 1;
                            const startDate = dayHeaders[bar.startIdx].date;
                            const endDate = dayHeaders[bar.endIdx].date;
                            const dateRange =
                              days === 1
                                ? startDate.toLocaleDateString("de-AT")
                                : `${startDate.toLocaleDateString("de-AT")} – ${endDate.toLocaleDateString("de-AT")}`;
                            return (
                              <div
                                key={bi}
                                className="absolute pointer-events-none rounded-md flex items-center px-1.5 text-[10px] font-semibold text-white truncate shadow-sm"
                                style={{
                                  left,
                                  width,
                                  top: 2,
                                  height: 24,
                                  background: bar.color,
                                  opacity: bar.isReadOnly ? 0.6 : 1,
                                }}
                                title={`${bar.label} · ${dateRange}${bar.isReadOnly ? " (eingereicht)" : ""}`}
                              >
                                <span className="truncate">{width < 60 ? (bar.label.slice(0, 2)) : bar.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                ))}
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingPartieId ? "Partie bearbeiten" : "Neue Partie anlegen"}
            </DialogTitle>
          </DialogHeader>
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
        <span
          className={`inline-block ${
            isMobile ? "h-2.5 w-2.5" : "h-3 w-3"
          } rounded-full shrink-0`}
          style={{ background: farbe }}
        />
        <div className={`${isMobile ? "" : "text-xs"} font-bold uppercase flex-1 min-w-0 leading-tight`}>
          {polier ? (
            <span className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-base sm:text-sm">{polier}</span>
              {partie && (
                <span className="text-[10px] font-normal opacity-70 normal-case">
                  · {partie.name}
                </span>
              )}
            </span>
          ) : (
            partie?.name ?? "Ohne Partie"
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
  const otherPartien = allPartien.filter((p) => p.id !== partie?.id);
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        <div className="text-xs font-semibold mb-2 px-1">
          {member.vorname} {member.nachname}
          {partie && (
            <span className="ml-1.5 font-normal text-muted-foreground">
              · {partie.name}
            </span>
          )}
        </div>
        {otherPartien.length > 0 && (
          <>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground px-1 pb-1">
              In andere Partie verschieben
            </div>
            <div className="space-y-0.5 mb-1">
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
            </div>
          </>
        )}
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
}) {
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
  // Existierende Werte laden
  useEffect(() => {
    if (!singleEinteilungId) {
      setTaetigkeit("");
      setSelectedFahrzeuge(new Set());
      return;
    }
    (async () => {
      const [{ data: e }, { data: ef }] = await Promise.all([
        supabase
          .from("einteilungen")
          .select("taetigkeit")
          .eq("id", singleEinteilungId)
          .maybeSingle(),
        supabase
          .from("einteilung_fahrzeuge")
          .select("fahrzeug_id")
          .eq("einteilung_id", singleEinteilungId),
      ]);
      setTaetigkeit((e?.taetigkeit as string) ?? "");
      setSelectedFahrzeuge(new Set((ef ?? []).map((r: any) => r.fahrzeug_id as string)));
    })();
  }, [singleEinteilungId]);

  const saveDetails = async () => {
    if (!singleEinteilungId) return;
    setSavingDetails(true);
    // 1) Tätigkeit aktualisieren
    await supabase
      .from("einteilungen")
      .update({ taetigkeit: taetigkeit.trim() || null })
      .eq("id", singleEinteilungId);
    // 2) Fahrzeug-Set ersetzen (delete-all + insert)
    await supabase
      .from("einteilung_fahrzeuge")
      .delete()
      .eq("einteilung_id", singleEinteilungId);
    if (selectedFahrzeuge.size > 0) {
      await supabase
        .from("einteilung_fahrzeuge")
        .insert(
          Array.from(selectedFahrzeuge).map((fid) => ({
            einteilung_id: singleEinteilungId,
            fahrzeug_id: fid,
          })) as any
        );
    }
    setSavingDetails(false);
    onSavedEinteilung();
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
              className="text-xs px-2 py-2 rounded text-white font-medium"
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
            className="w-full text-xs px-2 py-2.5 rounded border border-destructive/40 text-destructive font-semibold hover:bg-destructive hover:text-destructive-foreground flex items-center justify-center gap-1.5 mb-1 transition"
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
            <span className="flex-1 truncate">{g.partie?.name ?? "Ohne Partie"}</span>
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
