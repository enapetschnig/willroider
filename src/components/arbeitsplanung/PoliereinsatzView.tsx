/**
 * Poliereinsatz-Ansicht — Wochenplanung nach MS-Project-Vorbild.
 *
 * Zeilen = Baustellen-Einsätze gruppiert nach Polier (Partie), Balken =
 * Einsatz-Zeitraum (poliereinsatz_zeitraeume), Balkenfarbe = Bauleiter
 * (profiles.planungsfarbe). Gestrichelte Balken = Starttermin noch nicht
 * fix (start_fix = false).
 *
 * Pro Partie: aufklappbares Panel mit Mitgliedern (verschieben), Urlaub-
 * Schnelleintrag (auch durch den Polier — schreibt echte stunden_tage)
 * und den Partie-Fahrzeugen. Urlaub-Zeile zeigt die echten Urlaubs-Tage
 * aus der Zeiterfassung. Unten: Urlaubs-Block der Bauleiter.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronRight as ChevronRightSmall,
  Plus,
  Trash2,
  Pencil,
  Sun,
  Truck,
  Undo2,
  Maximize2,
  Minimize2,
  Users2,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { localIso } from "@/lib/dateFmt";
import { useNavigate } from "react-router-dom";
import { feiertagAt } from "@/lib/feiertage";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Fahrzeug = Database["public"]["Tables"]["fahrzeuge"]["Row"];
type Zeitraum = Database["public"]["Tables"]["poliereinsatz_zeitraeume"]["Row"];

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_W = 22; // px pro Tag — wie die Mitarbeiter-Ansicht
const LEFT_W = 476; // linke Spaltengruppe (inkl. Zeitraum-Spalte)

/** „2026-09-14" → „14.09." — kompakt genug für die schmale Spalte. */
function kurzDatum(iso: string): string {
  return iso.slice(8, 10) + "." + iso.slice(5, 7) + ".";
}

function startOfISOWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay() || 7;
  if (day !== 1) date.setDate(date.getDate() - (day - 1));
  date.setHours(0, 0, 0, 0);
  return date;
}
function isoWeek(d: Date): number {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(
      ((date.getTime() - week1.getTime()) / DAY_MS - 3 + ((week1.getDay() + 6) % 7)) / 7,
    )
  );
}
const isoDate = (d: Date) => localIso(d);
const addDays = (iso: string, n: number): string => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return isoDate(d);
};
/** Montag (lokal-ISO) einer ISO-Kalenderwoche. */
function isoWeekMondayIso(jahr: number, kw: number): string {
  const jan4 = new Date(jahr, 0, 4);
  const jan4Dow = (jan4.getDay() + 6) % 7; // 0 = Montag
  const mon = new Date(jan4);
  mon.setDate(jan4.getDate() - jan4Dow + (kw - 1) * 7);
  return isoDate(mon);
}

export function PoliereinsatzView({
  baustellen,
  partien,
  profiles,
  fahrzeuge,
  canEdit,
  userId,
  onReload,
  onNeueBaustelle,
}: {
  baustellen: Baustelle[];
  partien: Partie[];
  profiles: Profile[];
  fahrzeuge: Fahrzeug[];
  /** arbeitsplanung.edit — darf Einsätze anlegen/ändern/verschieben */
  canEdit: boolean;
  userId: string | null;
  /** Lädt die Stammdaten (u.a. profiles) im Parent neu — nach Umzügen. */
  onReload?: () => void;
  /** Öffnet die "Neue Baustelle"-Oberfläche des Parents. */
  onNeueBaustelle?: () => void;
}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [zeitraeume, setZeitraeume] = useState<Zeitraum[]>([]);
  const [urlaubByMa, setUrlaubByMa] = useState<Map<string, Map<string, string>>>(
    new Map(),
  );
  /** Arbeitsfreie Werktage laut Arbeitszeitkalender (kurze Woche = Fr frei). */
  const [kalenderFrei, setKalenderFrei] = useState<Set<string>>(new Set());
  /** Betriebsurlaub-Tage (wochentyp='BU') — ganze Woche gesperrt. */
  const [buTage, setBuTage] = useState<Set<string>>(new Set());
  const [weeksVisible] = useState(26);
  const [anchorWeek, setAnchorWeek] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return startOfISOWeek(d);
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** Vollbild-Modus der Poliereinsatz-Ansicht. */
  const [vollbild, setVollbild] = useState(false);
  const [busy, setBusy] = useState(false);

  // Neu/Bearbeiten-Dialog
  const [editDialog, setEditDialog] = useState<{
    id: string | null; // null = neu
    partieId: string;
    baustelleId: string;
    von: string;
    bis: string;
    startFix: boolean;
    suche: string;
  } | null>(null);


  // Info-Popup am Balken
  const [barInfo, setBarInfo] = useState<{
    z: Zeitraum;
    anchor: { x: number; y: number };
  } | null>(null);

  // Drag (move / resize)
  const dragRef = useRef<{
    z: Zeitraum;
    mode: "move" | "resize-l" | "resize-r";
    startX: number;
    moved: boolean;
    previewVon: string;
    previewBis: string;
    previewPartie: string | null;
  } | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    id: string;
    von: string;
    bis: string;
  } | null>(null);
  /** Ziel-Partie beim vertikalen Balken-Drag (Highlight). */
  const [dropPartieId, setDropPartieId] = useState<string | null>(null);
  /** Mitlaufender Chip am Cursor beim Verschieben (zeigt Ziel-Partie). */
  const [dragChip, setDragChip] = useState<{ x: number; y: number; text: string } | null>(null);

  // ─── Undo-Stack (Schritte zurück bei falschem Verschieben) ───────────
  type UndoAktion =
    | { typ: "update"; id: string; vorher: { von_datum: string; bis_datum: string; partie_id: string; start_fix: boolean } }
    | { typ: "insert"; id: string } // rückgängig = löschen
    | { typ: "delete"; zeile: Zeitraum }; // rückgängig = wieder anlegen
  const [undoStack, setUndoStack] = useState<UndoAktion[]>([]);
  const pushUndo = (a: UndoAktion) =>
    setUndoStack((s) => [...s.slice(-19), a]); // max. 20 Schritte

  const totalDays = weeksVisible * 7;
  const rangeStartIso = isoDate(anchorWeek);
  const rangeEndIso = addDays(rangeStartIso, totalDays - 1);

  const profilesById = useMemo(
    () => Object.fromEntries(profiles.map((p) => [p.id, p])),
    [profiles],
  );
  const baustellenById = useMemo(
    () => Object.fromEntries(baustellen.map((b) => [b.id, b])),
    [baustellen],
  );

  const load = async () => {
    const [{ data: zs, error: zErr }, { data: urlaub }] = await Promise.all([
      supabase
        .from("poliereinsatz_zeitraeume")
        .select("*")
        .lte("von_datum", rangeEndIso)
        .gte("bis_datum", rangeStartIso)
        .order("von_datum"),
      supabase
        .from("stunden_tage")
        .select("mitarbeiter_id, datum, tag_status")
        // Nicht nur Urlaub: ein Krankenstand blieb hier sonst unsichtbar und
        // der Polier plante jemanden ein, der gar nicht da ist.
        .in("tag_status", ["urlaub", "krank", "schlechtwetter"])
        .gte("datum", rangeStartIso)
        .lte("datum", rangeEndIso)
        // PostgREST kappt standardmäßig bei 1000 Zeilen — bei vielen
        // Urlauben (26-Wochen-Fenster × 47 MA) würden Balken fehlen.
        .range(0, 9999),
    ]);
    if (zErr) {
      toast({ variant: "destructive", title: "Laden fehlgeschlagen", description: zErr.message });
      return;
    }
    setZeitraeume((zs as Zeitraum[]) ?? []);
    const m = new Map<string, Map<string, string>>();
    ((urlaub as any[]) ?? []).forEach((r) => {
      if (!m.has(r.mitarbeiter_id)) m.set(r.mitarbeiter_id, new Map());
      m.get(r.mitarbeiter_id)!.set(r.datum, r.tag_status);
    });
    setUrlaubByMa(m);

    // Arbeitszeitkalender der sichtbaren Jahre: kurze Wochen (Fr frei) +
    // Betriebsurlaub (ganze Woche) als arbeitsfreie Tage aufbauen.
    const jahre = Array.from(
      new Set([Number(rangeStartIso.slice(0, 4)), Number(rangeEndIso.slice(0, 4))]),
    );
    const { data: kal } = await supabase
      .from("arbeitszeitkalender")
      .select("jahr, kw, wochentyp, soll_mo, soll_di, soll_mi, soll_do, soll_fr")
      .in("jahr", jahre);
    const frei = new Set<string>();
    const bu = new Set<string>();
    ((kal as any[]) ?? []).forEach((r) => {
      const mon = isoWeekMondayIso(r.jahr, r.kw);
      const perDay = [r.soll_mo, r.soll_di, r.soll_mi, r.soll_do, r.soll_fr];
      for (let wd = 0; wd < 5; wd++) {
        const tag = addDays(mon, wd);
        if (r.wochentyp === "BU") {
          frei.add(tag);
          bu.add(tag);
        } else if (perDay[wd] != null && Number(perDay[wd]) === 0) {
          frei.add(tag);
        }
      }
    });
    setKalenderFrei(frei);
    setBuTage(bu);
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("poliereinsatz")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "poliereinsatz_zeitraeume" },
        () => void load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStartIso, rangeEndIso]);

  // Vollbild per Escape verlassen — aber NICHT, wenn ein Dialog das Esc
  // schon konsumiert hat (Radix ruft preventDefault beim Dialog-Schließen).
  useEffect(() => {
    if (!vollbild) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") setVollbild(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vollbild]);

  // ─── Zeitachse ───────────────────────────────────────────────────────
  const days = useMemo(() => {
    const res: { iso: string; date: Date; isMonday: boolean; isToday: boolean; isWeekend: boolean; feiertag: boolean; frei: boolean; bu: boolean }[] = [];
    const today = localIso(new Date());
    for (let i = 0; i < totalDays; i++) {
      // ISO-Kette statt Millisekunden-Addition — sonst erzeugt die
      // Sommerzeit-Umstellung (23-/25-h-Tage) einen Doppel-/Fehltag.
      const iso = addDays(rangeStartIso, i);
      const d = new Date(iso + "T00:00:00");
      res.push({
        iso,
        date: d,
        isMonday: d.getDay() === 1,
        isToday: iso === today,
        isWeekend: d.getDay() === 0 || d.getDay() === 6,
        feiertag: !!feiertagAt(iso),
        // Arbeitsfrei laut Kalender (kurze Woche Fr / Betriebsurlaub)
        frei: kalenderFrei.has(iso),
        bu: buTage.has(iso),
      });
    }
    return res;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStartIso, totalDays, kalenderFrei, buTage]);

  const idxByIso = useMemo(() => {
    const m = new Map<string, number>();
    days.forEach((d, i) => m.set(d.iso, i));
    return m;
  }, [days]);

  const weeks = useMemo(() => {
    const res: { label: string; startIdx: number; feiertage: number; freie: number; bu: boolean }[] = [];
    days.forEach((d, i) => {
      if (d.isMonday || i === 0) {
        res.push({ label: `KW ${isoWeek(d.date)}`, startIdx: i, feiertage: 0, freie: 0, bu: false });
      }
      const w = res[res.length - 1];
      if (!w) return;
      // Feiertage + kalender-freie Werktage der laufenden Woche → "kurze Woche"
      if (!d.isWeekend) {
        if (d.feiertag) w.feiertage += 1;
        else if (d.frei) w.freie += 1;
      }
      if (d.bu) w.bu = true;
    });
    return res;
  }, [days]);

  /** Balken-Geometrie für einen Zeitraum — geklemmt aufs sichtbare Fenster. */
  const barGeo = (von: string, bis: string): { left: number; width: number } | null => {
    if (bis < rangeStartIso || von > rangeEndIso) return null;
    const vIdx = von <= rangeStartIso ? 0 : idxByIso.get(von) ?? 0;
    const bIdx = bis >= rangeEndIso ? totalDays - 1 : idxByIso.get(bis) ?? totalDays - 1;
    return { left: vIdx * DAY_W + 1, width: (bIdx - vIdx + 1) * DAY_W - 2 };
  };

  /** Arbeitstag-Segmente eines Zeitraums [von,bis]: nur Mo–Fr ohne Feiertag,
   *  zusammenhängende Tage zu einem Balken-Stück. Wochenenden/Feiertage
   *  erzeugen echte Lücken — der Balken sitzt nur auf Arbeitstagen. */
  const arbeitstagSegmente = (
    von: string,
    bis: string,
  ): { left: number; width: number }[] => {
    const segs: { start: number; end: number }[] = [];
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (d.iso < von || d.iso > bis) continue;
      // Wochenende, Feiertag UND kalender-freie Tage (kurze-Woche-Freitag /
      // Betriebsurlaub) sind keine Arbeitstage → echte Balken-Lücke.
      if (d.isWeekend || d.feiertag || d.frei) continue;
      const last = segs[segs.length - 1];
      if (last && last.end === i - 1) last.end = i;
      else segs.push({ start: i, end: i });
    }
    return segs.map((s) => ({
      left: s.start * DAY_W + 1,
      width: (s.end - s.start + 1) * DAY_W - 2,
    }));
  };

  /** Abwesenheits-Segmente eines MA: zusammenhängende Tage GLEICHER Art.
   *  Ein Wechsel Krank→Urlaub bricht das Segment, damit die Farbe stimmt. */
  const urlaubSegmente = (
    maId: string,
  ): { von: string; bis: string; typ: string }[] => {
    const tage = [...(urlaubByMa.get(maId)?.entries() ?? [])].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    const segs: { von: string; bis: string; typ: string }[] = [];
    for (const [iso, typ] of tage) {
      const last = segs[segs.length - 1];
      if (last && last.typ === typ && addDays(last.bis, 1) === iso) last.bis = iso;
      else segs.push({ von: iso, bis: iso, typ });
    }
    return segs;
  };

  const ABW_FARBE: Record<string, string> = {
    urlaub: "#0891b2",
    krank: "#ef4444",
    schlechtwetter: "#f59e0b",
  };
  const ABW_LABEL: Record<string, string> = {
    urlaub: "Urlaub",
    krank: "Krank",
    schlechtwetter: "Schlechtwetter",
  };

  // ─── Gruppen: Partien mit Leiter oder Einsätzen ──────────────────────
  /** Heute als ISO — trennt abgeschlossene von künftigen Einsätzen. */
  const heuteIso = localIso(new Date());

  const gruppen = useMemo(() => {
    const byPartie = new Map<string, Zeitraum[]>();
    zeitraeume.forEach((z) => {
      if (!byPartie.has(z.partie_id)) byPartie.set(z.partie_id, []);
      byPartie.get(z.partie_id)!.push(z);
    });
    return partien
      .filter((p) => p.partieleiter_id || byPartie.has(p.id))
      .map((p) => ({
        partie: p,
        leiter: p.partieleiter_id ? profilesById[p.partieleiter_id] : null,
        member: profiles.filter((m) => m.partie_id === p.id && m.is_active !== false),
        einsaetze: (byPartie.get(p.id) ?? []).sort((a, b) =>
          a.von_datum.localeCompare(b.von_datum),
        ),
      }))
      // Reihenfolge wie im MS-Project-Ausdruck: sort_order zuerst, dann Name.
      .sort((a, b) => {
        const sa = a.partie.sort_order ?? 9999;
        const sb = b.partie.sort_order ?? 9999;
        if (sa !== sb) return sa - sb;
        return a.partie.name.localeCompare(b.partie.name);
      });
  }, [partien, zeitraeume, profiles, profilesById]);

  const bauleiter = useMemo(
    () =>
      profiles
        .filter((p) => p.planungsfarbe && p.is_active !== false)
        .sort((a, b) => a.nachname.localeCompare(b.nachname)),
    [profiles],
  );

  /** Urlauber, die sonst nirgends sichtbar wären: weder Mitglied einer
   *  angezeigten Polier-Gruppe noch Bauleiter (z.B. Werkvorfertigung/Büro)
   *  — wie die „Urlaube:"-Liste unten im MS-Project-Ausdruck. */
  const sonstigeUrlauber = useMemo(() => {
    const abgedeckt = new Set<string>();
    gruppen.forEach((g) => g.member.forEach((m) => abgedeckt.add(m.id)));
    bauleiter.forEach((b) => abgedeckt.add(b.id));
    return profiles
      .filter((p) => p.is_active !== false && !abgedeckt.has(p.id))
      .filter((p) => (urlaubByMa.get(p.id)?.size ?? 0) > 0)
      .sort((a, b) => a.nachname.localeCompare(b.nachname));
  }, [profiles, gruppen, bauleiter, urlaubByMa]);

  const barColor = (z: Zeitraum): string => {
    const b = baustellenById[z.baustelle_id];
    const bl = b?.bauleiter_id ? profilesById[b.bauleiter_id] : null;
    return bl?.planungsfarbe ?? "#6b7280";
  };

  // ─── Drag ────────────────────────────────────────────────────────────
  const onBarPointerDown = (
    e: React.PointerEvent,
    z: Zeitraum,
    mode: "move" | "resize-l" | "resize-r",
  ) => {
    if (!canEdit) return;
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = {
      z,
      mode,
      startX: e.clientX,
      moved: false,
      previewVon: z.von_datum,
      previewBis: z.bis_datum,
      previewPartie: null,
    };

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const deltaDays = Math.round((ev.clientX - d.startX) / DAY_W);
      if (Math.abs(ev.clientX - d.startX) > 4) d.moved = true;
      let von = d.z.von_datum;
      let bis = d.z.bis_datum;
      if (d.mode === "move") {
        von = addDays(d.z.von_datum, deltaDays);
        bis = addDays(d.z.bis_datum, deltaDays);
      } else if (d.mode === "resize-r") {
        bis = addDays(d.z.bis_datum, deltaDays);
        if (bis < von) bis = von;
      } else {
        von = addDays(d.z.von_datum, deltaDays);
        if (von > bis) von = bis;
      }
      d.previewVon = von;
      d.previewBis = bis;
      setDragPreview({ id: d.z.id, von, bis });

      // Vertikal: über welcher Partie-Gruppe schwebt der Zeiger? (nur beim
      // Move, nicht beim Resize) → Ziel-Highlight für Umzug zwischen Partien.
      if (d.mode === "move") {
        const el = document
          .elementsFromPoint(ev.clientX, ev.clientY)
          .find((n) => (n as HTMLElement).dataset?.partie) as HTMLElement | undefined;
        const ziel = el?.dataset.partie ?? null;
        d.previewPartie = ziel && ziel !== d.z.partie_id ? ziel : null;
        setDropPartieId(d.previewPartie);
        // Auch ein reiner Vertikal-Drag auf eine andere Partie zählt als
        // "bewegt" — sonst würde nur das Info-Popup aufgehen.
        if (d.previewPartie) d.moved = true;
        // Mitlaufendes Feedback am Cursor, damit klar ist, dass verschoben wird.
        if (d.moved) {
          const zielName = d.previewPartie
            ? partien.find((p) => p.id === d.previewPartie)?.name ?? "Partie"
            : null;
          setDragChip({
            x: ev.clientX,
            y: ev.clientY,
            text: zielName ? `→ ${zielName}` : "Verschieben …",
          });
        }
      }
    };
    const onUp = async (ev: PointerEvent) => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      const d = dragRef.current;
      dragRef.current = null;
      setDragPreview(null);
      const zielPartie = d?.previewPartie ?? null;
      setDropPartieId(null);
      setDragChip(null);
      if (!d) return;
      if (!d.moved) {
        // Reiner Klick → Info-Popup
        setBarInfo({ z: d.z, anchor: { x: ev.clientX, y: ev.clientY } });
        return;
      }
      const partieWechsel =
        d.mode === "move" && zielPartie && zielPartie !== d.z.partie_id;
      const datumWechsel =
        d.previewVon !== d.z.von_datum || d.previewBis !== d.z.bis_datum;
      if (!partieWechsel && !datumWechsel) return;

      const patch: Record<string, unknown> = {
        von_datum: d.previewVon,
        bis_datum: d.previewBis,
      };
      if (partieWechsel) patch.partie_id = zielPartie;

      const { data: upd, error } = await supabase
        .from("poliereinsatz_zeitraeume")
        .update(patch)
        .eq("id", d.z.id)
        .select("id");
      if (error || !upd || upd.length === 0) {
        toast({
          variant: "destructive",
          title: "Verschieben fehlgeschlagen",
          description: error?.message ?? "Keine Berechtigung.",
        });
      } else {
        // Undo-Eintrag: alter Zustand des Zeitraums
        pushUndo({
          typ: "update",
          id: d.z.id,
          vorher: {
            von_datum: d.z.von_datum,
            bis_datum: d.z.bis_datum,
            partie_id: d.z.partie_id,
            start_fix: d.z.start_fix,
          },
        });
        if (partieWechsel) {
          const zp = partien.find((p) => p.id === zielPartie);
          toast({ title: `Baustelle zu ${zp?.name ?? "Partie"} verschoben` });
        }
      }
      void load();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  // ─── Speichern / Löschen ─────────────────────────────────────────────
  const saveEinsatz = async () => {
    const d = editDialog;
    if (!d || !d.baustelleId || !d.von || !d.bis) return;
    if (d.bis < d.von) {
      toast({ variant: "destructive", title: "Ende liegt vor dem Beginn" });
      return;
    }
    setBusy(true);
    const payload = {
      partie_id: d.partieId,
      baustelle_id: d.baustelleId,
      von_datum: d.von,
      bis_datum: d.bis,
      start_fix: d.startFix,
    };
    // vorher-Zustand für Undo (nur beim Update)
    const vorher = d.id ? zeitraeume.find((z) => z.id === d.id) : null;
    const { data: saved, error } = d.id
      ? await supabase
          .from("poliereinsatz_zeitraeume")
          .update(payload)
          .eq("id", d.id)
          .select("id")
      : await supabase
          .from("poliereinsatz_zeitraeume")
          .insert({ ...payload, erstellt_von: userId })
          .select("id");
    setBusy(false);
    if (error || !saved || saved.length === 0) {
      toast({
        variant: "destructive",
        title: "Speichern fehlgeschlagen",
        description: error?.message ?? "Keine Berechtigung.",
      });
      return;
    }
    if (d.id && vorher) {
      pushUndo({
        typ: "update",
        id: d.id,
        vorher: {
          von_datum: vorher.von_datum,
          bis_datum: vorher.bis_datum,
          partie_id: vorher.partie_id,
          start_fix: vorher.start_fix,
        },
      });
    } else if (saved[0]?.id) {
      pushUndo({ typ: "insert", id: saved[0].id });
    }
    toast({ title: d.id ? "Einsatz aktualisiert" : "Einsatz angelegt" });
    setEditDialog(null);
    void load();
  };

  /** Ein-Klick: Starttermin fix ↔ noch nicht fix (gestrichelter Balken).
   *  Direkt aus dem Balken-Popup, ohne den ganzen Bearbeiten-Dialog. */
  const toggleStartFix = async (z: Zeitraum) => {
    if (!canEdit) return;
    const neu = !z.start_fix;
    const { data: saved, error } = await supabase
      .from("poliereinsatz_zeitraeume")
      .update({ start_fix: neu })
      .eq("id", z.id)
      .select("id");
    if (error || !saved || saved.length === 0) {
      toast({
        variant: "destructive",
        title: "Umschalten fehlgeschlagen",
        description: error?.message ?? "Keine Berechtigung.",
      });
      return;
    }
    // Rückgängig-fähig: alten Zustand (inkl. start_fix) in den Undo-Stack.
    pushUndo({
      typ: "update",
      id: z.id,
      vorher: {
        von_datum: z.von_datum,
        bis_datum: z.bis_datum,
        partie_id: z.partie_id,
        start_fix: z.start_fix,
      },
    });
    toast({
      title: neu
        ? "Starttermin fix"
        : "Starttermin noch nicht fix – Balken wird gestrichelt",
    });
    setBarInfo(null);
    void load();
  };

  const deleteEinsatz = async (id: string) => {
    if (!confirm("Einsatz aus der Planung entfernen?")) return;
    const zeile = zeitraeume.find((z) => z.id === id) ?? null;
    const { data: deleted, error } = await supabase
      .from("poliereinsatz_zeitraeume")
      .delete()
      .eq("id", id)
      .select("id");
    if (error || !deleted || deleted.length === 0) {
      toast({
        variant: "destructive",
        title: "Löschen fehlgeschlagen",
        description: error?.message ?? "Keine Berechtigung.",
      });
      return;
    }
    if (zeile) pushUndo({ typ: "delete", zeile });
    setEditDialog(null);
    setBarInfo(null);
    void load();
  };

  /** Urlaub-Schnelleintrag: schreibt echte stunden_tage (nur Werktage,
   *  keine bestehenden Tage überschreiben, kein Konto-Abzug). */

  const moveMember = async (maId: string, partieId: string | null) => {
    // .select() erzwingt Row-Count: ein RLS-Block liefert 0 Zeilen ohne
    // error — ohne diese Prüfung würde ein stiller Fehlschlag als Erfolg
    // gemeldet. Nach Erfolg lädt der Parent die Profile neu (onReload),
    // damit der MA sofort in der Zielpartie erscheint.
    const { data: updated, error } = await supabase
      .from("profiles")
      .update({ partie_id: partieId })
      .eq("id", maId)
      .select("id");
    if (error || !updated || updated.length === 0) {
      toast({
        variant: "destructive",
        title: "Verschieben fehlgeschlagen",
        description:
          error?.message ??
          "Keine Berechtigung — das dürfen nur Administratoren.",
      });
      return;
    }
    toast({ title: "Mitarbeiter verschoben" });
    onReload?.();
  };

  /** Letzten Schritt rückgängig machen. */
  const [undoBusy, setUndoBusy] = useState(false);
  const undo = async () => {
    if (undoBusy) return;
    const a = undoStack[undoStack.length - 1];
    if (!a) return;
    setUndoBusy(true);
    try {
      let error: any = null;
      let betroffen = 1;
      if (a.typ === "update") {
        const { data, error: e } = await supabase
          .from("poliereinsatz_zeitraeume")
          .update(a.vorher)
          .eq("id", a.id)
          .select("id");
        error = e;
        betroffen = data?.length ?? 0;
      } else if (a.typ === "insert") {
        const { data, error: e } = await supabase
          .from("poliereinsatz_zeitraeume")
          .delete()
          .eq("id", a.id)
          .select("id");
        error = e;
        betroffen = data?.length ?? 0;
      } else {
        // delete rückgängig → Zeile mit gleicher id wieder anlegen
        const z = a.zeile;
        const { data, error: e } = await supabase
          .from("poliereinsatz_zeitraeume")
          .insert({
            id: z.id,
            partie_id: z.partie_id,
            baustelle_id: z.baustelle_id,
            von_datum: z.von_datum,
            bis_datum: z.bis_datum,
            start_fix: z.start_fix,
            notiz: z.notiz,
            erstellt_von: z.erstellt_von,
          })
          .select("id");
        error = e;
        betroffen = data?.length ?? 0;
      }
      if (error || betroffen === 0) {
        toast({
          variant: "destructive",
          title: "Rückgängig fehlgeschlagen",
          description:
            error?.message ??
            "Der Eintrag wurde inzwischen anderweitig geändert.",
        });
        return; // Schritt bleibt im Stack, damit nichts verloren geht
      }
      setUndoStack((s) => s.slice(0, -1));
      toast({ title: "Rückgängig gemacht" });
      void load();
    } finally {
      setUndoBusy(false);
    }
  };

  const shiftWeeks = (n: number) =>
    setAnchorWeek((w) => new Date(w.getTime() + n * 7 * DAY_MS));

  // ─── Render ──────────────────────────────────────────────────────────
  const ROW_H = 28;
  const MEMBER_H = 26; // feste Höhe je Mitglieder-Zeile im Panel
  const PANEL_PAD = 12; // py-1.5 oben+unten
  const PANEL_ACTION_H = 34; // Aktionszeile (Urlaub-Button + Fahrzeuge)
  /** Exakte Höhe des aufgeklappten Mitglieder-Panels — EINE Quelle für
   *  linke Spalte UND rechten Grid-Platzhalter, damit die Zeilen fluchten. */
  const panelHeight = (memberCount: number) =>
    Math.max(memberCount, 1) * MEMBER_H + PANEL_ACTION_H + PANEL_PAD;

  const renderBar = (
    z: Zeitraum,
    label: string,
  ): React.ReactNode => {
    const von = dragPreview?.id === z.id ? dragPreview.von : z.von_datum;
    const bis = dragPreview?.id === z.id ? dragPreview.bis : z.bis_datum;
    // Balken nur an Arbeitstagen — Wochenenden/Feiertage sind echte Lücken.
    const segmente = arbeitstagSegmente(von, bis);
    const color = barColor(z);
    // Liegt der Einsatz KOMPLETT auf arbeitsfreien Tagen, bleibt sonst kein
    // Balken übrig → nicht mehr anklick-/löschbar. Dann einen schmalen
    // Klick-Stub über dem Rohbereich zeigen (nur zum Öffnen des Popups).
    if (segmente.length === 0) {
      const roh = barGeo(von, bis);
      if (!roh) return null;
      return (
        <div
          className="absolute rounded border border-dashed flex items-center justify-center text-[9px] cursor-pointer"
          style={{
            left: roh.left,
            width: Math.max(roh.width, 14),
            top: 3,
            height: ROW_H - 6,
            borderColor: color,
            color,
            background: `${color}22`,
          }}
          title={`${label} · nur an arbeitsfreien Tagen (${von} – ${bis})`}
          onClick={(e) => {
            e.stopPropagation();
            setBarInfo({ z, anchor: { x: e.clientX, y: e.clientY } });
          }}
        >
          !
        </div>
      );
    }
    const breitestes = segmente.reduce((a, b) => (b.width > a.width ? b : a));
    // Passt der Name in den breitesten Balken? Sonst wird er RECHTS daneben
    // geschrieben (statt abgeschnitten) — wie im MS-Project-Ausdruck.
    const zeigtLabelInnen = breitestes.width >= 46;
    const letztesSeg = segmente[segmente.length - 1];
    return (
      <>
        {segmente.map((geo, si) => {
          const istErstes = si === 0;
          const istLetztes = si === segmente.length - 1;
          const zeigtLabel = geo === breitestes && zeigtLabelInnen;
          return (
            <div
              key={si}
              className="absolute rounded flex items-center px-1.5 text-[10px] font-semibold text-white shadow-sm select-none"
              style={{
                left: geo.left,
                width: geo.width,
                top: 3,
                height: ROW_H - 6,
                background: z.start_fix
                  ? color
                  : `repeating-linear-gradient(45deg, ${color}, ${color} 6px, ${color}55 6px, ${color}55 12px)`,
                border: z.start_fix ? "none" : `1.5px dashed ${color}`,
                cursor: canEdit ? "grab" : "pointer",
                touchAction: "none",
              }}
              title={`${label} · ${von} – ${bis}${z.start_fix ? "" : " (Start nicht fix)"}`}
              onPointerDown={(e) => canEdit && onBarPointerDown(e, z, "move")}
              onClick={(e) => {
                if (canEdit) return;
                e.stopPropagation();
                setBarInfo({ z, anchor: { x: e.clientX, y: e.clientY } });
              }}
            >
              {canEdit && istErstes && (
                <div
                  className="absolute left-0 top-0 bottom-0"
                  style={{ width: 7, cursor: "ew-resize" }}
                  onPointerDown={(e) => onBarPointerDown(e, z, "resize-l")}
                />
              )}
              {canEdit && istLetztes && (
                <div
                  className="absolute right-0 top-0 bottom-0"
                  style={{ width: 7, cursor: "ew-resize" }}
                  onPointerDown={(e) => onBarPointerDown(e, z, "resize-r")}
                />
              )}
              {zeigtLabel && (
                <span className="truncate pointer-events-none">{label}</span>
              )}
            </div>
          );
        })}
        {/* Name rechts neben dem Balken, wenn er innen nicht reinpasst —
            als deckender Chip, damit er beim Scrollen nicht mit Raster/
            anderen Zeilen verschwimmt. */}
        {!zeigtLabelInnen && (() => {
          const labelLeft = letztesSeg.left + letztesSeg.width + 3;
          // Am Rasterende kappen — sonst vergrößert das Label die Scrollbreite.
          const maxW = Math.max(0, Math.min(220, totalDays * DAY_W - labelLeft - 2));
          if (maxW < 24) return null;
          return (
            <div
              className="absolute text-[10px] font-medium whitespace-nowrap pointer-events-none px-1 rounded bg-card/95 border truncate"
              style={{
                left: labelLeft,
                maxWidth: maxW,
                top: 4,
                height: ROW_H - 8,
                lineHeight: `${ROW_H - 10}px`,
                color: barColor(z),
                borderColor: `${barColor(z)}66`,
              }}
            >
              {label}
            </div>
          );
        })()}
      </>
    );
  };

  return (
    <div
      className={
        vollbild
          ? "fixed inset-0 z-50 bg-background overflow-auto p-3 space-y-3"
          : "space-y-3"
      }
      // Im Vollbild deckt die Ansicht den ganzen Schirm — ohne Safe-Area
      // läge die Navigationsleiste unter Statusleiste bzw. Home-Indikator.
      style={
        vollbild
          ? {
              paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))",
              paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))",
              paddingLeft: "calc(0.75rem + env(safe-area-inset-left, 0px))",
              paddingRight: "calc(0.75rem + env(safe-area-inset-right, 0px))",
            }
          : undefined
      }
    >
      {/* Kopf: Navigation + Legende */}
      <Card>
        <CardContent className="p-2 flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => shiftWeeks(-4)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const d = new Date();
              d.setDate(d.getDate() - 7);
              setAnchorWeek(startOfISOWeek(d));
            }}
          >
            Heute
          </Button>
          <Button variant="outline" size="sm" onClick={() => shiftWeeks(4)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={undo}
              disabled={undoStack.length === 0 || undoBusy}
              title="Letzten Schritt rückgängig machen"
            >
              <Undo2 className="h-4 w-4 mr-1" /> Rückgängig
              {undoStack.length > 0 ? ` (${undoStack.length})` : ""}
            </Button>
          )}
          <div className="flex items-center gap-2 flex-wrap ml-2 text-[11px]">
            {bauleiter.map((b) => (
              <span key={b.id} className="inline-flex items-center gap-1">
                <span
                  className="h-2.5 w-2.5 rounded-full inline-block"
                  style={{ background: b.planungsfarbe! }}
                />
                {b.nachname}
              </span>
            ))}
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <span
                className="h-2.5 w-6 rounded inline-block"
                style={{
                  background:
                    "repeating-linear-gradient(45deg, #6b7280, #6b7280 4px, #6b728055 4px, #6b728055 8px)",
                }}
              />
              Start nicht fix
            </span>
          </div>
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => navigate("/admin?tab=mitarbeiter&sub=partien")}
              title="Partien anlegen, umbenennen, Leiter und Mitglieder ändern — zentral in der Verwaltung"
            >
              <Users2 className="h-4 w-4" />
              <span className="hidden sm:inline ml-1.5">Partien verwalten</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className={canEdit ? "" : "ml-auto"}
            onClick={() => setVollbild((v) => !v)}
            title={vollbild ? "Vollbild verlassen (Esc)" : "Vollbild"}
          >
            {vollbild ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            <span className="hidden sm:inline ml-1.5">{vollbild ? "Vollbild aus" : "Vollbild"}</span>
          </Button>
          {onNeueBaustelle && (
            <Button size="sm" onClick={onNeueBaustelle}>
              <Plus className="h-4 w-4 mr-1.5" /> Neue Baustelle
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden hidden md:block">
        <CardContent className="p-0">
          {/* Eigener Scroll-Bereich: linke Spalte + Kopfzeile bleiben beim
              Scrollen fixiert (sticky). Höhe an den Viewport gekoppelt. */}
          <div
            className={`flex relative overflow-auto ${
              vollbild ? "max-h-[calc(100vh-6rem)]" : "max-h-[calc(100vh-11rem)]"
            }`}
          >
            {/* Linke Spaltengruppe — horizontal fixiert */}
            <div className="shrink-0 border-r bg-card sticky left-0 z-20" style={{ width: LEFT_W }}>
              {/* Kopfzeile — Ecke: horizontal + vertikal fixiert */}
              <div
                className="border-b bg-muted/60 flex items-end px-2 text-[10px] font-semibold uppercase tracking-wide sticky top-0 z-30"
                style={{ height: 42 }}
              >
                <div className="flex-1 pb-1">Polier / BVH</div>
                <div className="w-24 pb-1 text-right pr-1">Zeitraum</div>
                <div className="w-12 pb-1">KST</div>
                <div className="w-6 pb-1 text-center" title="x = Baustelle, leer = Firma/Halle">B</div>
                <div className="w-16 pb-1">Bauleiter</div>
              </div>
              {gruppen.map((g) => (
                <div key={g.partie.id}>
                  {/* Gruppenkopf */}
                  <button
                    className="w-full border-b flex items-center gap-1.5 px-2 text-left text-[12px] font-bold hover:bg-muted/40"
                    style={{ height: ROW_H, background: `${g.partie.farbcode}18` }}
                    onClick={() =>
                      setExpanded((s) => {
                        const n = new Set(s);
                        if (n.has(g.partie.id)) n.delete(g.partie.id);
                        else n.add(g.partie.id);
                        return n;
                      })
                    }
                  >
                    {expanded.has(g.partie.id) ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <ChevronRightSmall className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ background: g.partie.farbcode }}
                    />
                    <span className="truncate">
                      {g.leiter
                        ? `${g.leiter.nachname}`
                        : g.partie.name}
                    </span>
                    <span className="text-[10px] font-normal text-muted-foreground truncate">
                      {g.partie.name}
                    </span>
                    {canEdit && (
                      <span
                        role="button"
                        tabIndex={0}
                        className="ml-auto shrink-0 inline-flex items-center justify-center h-5 w-5 rounded hover:bg-muted"
                        title="Einsatz hinzufügen"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditDialog({
                            id: null,
                            partieId: g.partie.id,
                            baustelleId: "",
                            von: localIso(new Date()),
                            bis: addDays(localIso(new Date()), 4),
                            startFix: true,
                            suche: "",
                          });
                        }}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </button>
                  {/* Aufgeklappt: Mitglieder-Panel — feste Höhe (panelHeight),
                      damit die rechte Grid-Seite exakt gleich hoch bleibt. */}
                  {expanded.has(g.partie.id) && (
                    <div
                      className="border-b bg-muted/20 px-2 py-1.5 overflow-y-auto"
                      style={{ height: panelHeight(g.member.length) }}
                    >
                      {g.member.length === 0 && (
                        <div className="text-[10px] italic text-muted-foreground">
                          Keine Mitarbeiter zugeordnet.
                        </div>
                      )}
                      {g.member.map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center gap-1.5 text-[11px]"
                          style={{ height: MEMBER_H }}
                        >
                          <span className="truncate flex-1">
                            {m.vorname} {m.nachname}
                            {m.is_partieleiter ? " ★" : ""}
                          </span>
                          {canEdit && (
                            <select
                              className="h-6 text-[10px] border rounded bg-background max-w-[110px]"
                              value={g.partie.id}
                              onChange={(e) => void moveMember(m.id, e.target.value)}
                              title="In andere Partie verschieben"
                            >
                              {partien.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      ))}
                      <div className="flex items-center gap-2 pt-1">
                        {/* Urlaub wird NICHT mehr hier eingetragen — nur noch
                            in der Jahresplanung → Reiter „Mitarbeiter"
                            (eine Pflege-Stelle für Abwesenheiten). */}
                        {fahrzeuge
                          .filter(
                            (f) =>
                              f.standard_fahrer_id &&
                              g.member.some((m) => m.id === f.standard_fahrer_id),
                          )
                          .map((f) => (
                            <span
                              key={f.id}
                              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
                              title={f.bezeichnung ?? ""}
                            >
                              <Truck className="h-3 w-3" /> {f.kennzeichen}
                            </span>
                          ))}
                      </div>
                    </div>
                  )}
                  {/* Urlaub-Zeile der Partie */}
                  <div
                    className="border-b flex items-center px-2 text-[10px] italic text-muted-foreground"
                    style={{ height: ROW_H }}
                  >
                    <span className="pl-5">Abwesend</span>
                  </div>
                  {/* Einsatz-Zeilen */}
                  {g.einsaetze.map((z) => {
                    const b = baustellenById[z.baustelle_id];
                    const bl = b?.bauleiter_id ? profilesById[b.bauleiter_id] : null;
                    const istBaustelle = b && b.kategorie !== "maschine";
                    return (
                      <div
                        key={z.id}
                        // bg-card: die Zeile muss deckend sein, sonst
                        // scheinen beim Scrollen nach rechts Balken durch,
                        // die unter die fixierte Spalte wandern.
                        className={`border-b flex items-center px-2 text-[11px] bg-card hover:bg-muted/30 ${
                          z.bis_datum < heuteIso ? "opacity-50" : ""
                        }`}
                        style={{ height: ROW_H }}
                      >
                        <div className="flex-1 truncate pl-5" title={b?.bvh_name ?? "?"}>
                          {b?.bvh_name ?? "?"}
                        </div>
                        {/* Zeitraum im Klartext. Ohne ihn standen bei einer
                            Partie mit vielen Einsätzen lauter Zeilen OHNE
                            Balken da (deren Termin liegt außerhalb des
                            sichtbaren Ausschnitts) — man sah nicht, ob sie
                            ungeplant sind oder nur weiter rechts liegen. */}
                        <div
                          className={`w-24 text-[9px] tabular-nums whitespace-nowrap text-right pr-1 ${
                            z.von_datum > heuteIso
                              ? "text-muted-foreground"
                              : "text-foreground font-medium"
                          }`}
                          title={`${z.von_datum} – ${z.bis_datum}`}
                        >
                          {kurzDatum(z.von_datum)}–{kurzDatum(z.bis_datum)}
                        </div>
                        {/* Einzeilig + abgeschnitten — lange Unter-KSTs
                            (1404030-2602) brachen sonst in die Nachbarzeile um */}
                        <div
                          className="w-12 text-[9px] text-muted-foreground tabular-nums whitespace-nowrap overflow-hidden"
                          title={b?.kostenstelle ?? ""}
                        >
                          {b?.kostenstelle ?? ""}
                        </div>
                        <div className="w-6 text-center text-[10px]">
                          {istBaustelle ? "x" : ""}
                        </div>
                        <div className="w-16 truncate text-[10px]" title={bl ? `${bl.vorname} ${bl.nachname}` : ""}>
                          {bl ? bl.nachname : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              {/* Urlaubs-Block: Bauleiter/Büro + alle sonst nicht sichtbaren Urlauber */}
              <div
                className="border-b bg-muted/60 flex items-center px-2 text-[12px] font-bold"
                style={{ height: ROW_H }}
              >
                Urlaube / Abwesenheiten
              </div>
              {bauleiter.map((b) => (
                <div
                  key={b.id}
                  className="border-b flex items-center gap-1.5 px-2 text-[11px]"
                  style={{ height: ROW_H }}
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: b.planungsfarbe! }}
                  />
                  <span className="truncate">
                    {b.vorname} {b.nachname}
                  </span>
                </div>
              ))}
              {sonstigeUrlauber.map((p) => (
                <div
                  key={p.id}
                  className="border-b flex items-center gap-1.5 px-2 text-[11px]"
                  style={{ height: ROW_H }}
                >
                  <span className="h-2 w-2 rounded-full shrink-0 bg-muted-foreground/50" />
                  <span className="truncate">
                    {p.vorname} {p.nachname}
                  </span>
                </div>
              ))}
            </div>

            {/* Zeitachse + Balken — scrollt mit dem Außen-Container */}
            <div className="shrink-0">
              <div style={{ width: totalDays * DAY_W, position: "relative" }}>
                {/* Wochen-Header — vertikal fixiert. z-10 (unter der linken
                    z-20-Spalte, sonst übermalt er beim Horizontal-Scroll die Ecke) */}
                <div className="flex border-b bg-muted sticky top-0 z-10" style={{ height: 21 }}>
                  {weeks.map((w, i) => {
                    const nextStart = weeks[i + 1]?.startIdx ?? totalDays;
                    // Kurze Woche = Feiertag ODER kalender-freier Werktag
                    // (z.B. Freitag frei). Betriebsurlaub-Woche extra.
                    const kurz = w.feiertage > 0 || w.freie > 0;
                    const titel = w.bu
                      ? "Betriebsurlaub"
                      : kurz
                        ? `Kurze Woche${w.freie > 0 ? " — Freitag frei" : ""}${w.feiertage > 0 ? ` — ${w.feiertage} Feiertag(e)` : ""}`
                        : undefined;
                    // Monat/Datum wie im MS-Project-Ausdruck: "KW 28 · 6. Jul"
                    // (+ Jahr beim Jahreswechsel)
                    const MONAT = ["Jän", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
                    const wd = days[w.startIdx]?.date;
                    const heuteJahr = new Date().getFullYear();
                    const datumLabel = wd
                      ? `${wd.getDate()}. ${MONAT[wd.getMonth()]}${wd.getFullYear() !== heuteJahr ? ` '${String(wd.getFullYear()).slice(-2)}` : ""}`
                      : "";
                    return (
                      <div
                        key={i}
                        className={`text-[10px] font-semibold flex items-center justify-center gap-1 border-r whitespace-nowrap overflow-hidden ${
                          w.bu
                            ? "bg-violet-100 text-violet-900"
                            : kurz
                              ? "bg-amber-100 text-amber-900"
                              : ""
                        }`}
                        style={{ width: (nextStart - w.startIdx) * DAY_W }}
                        title={titel}
                      >
                        {w.label}
                        {datumLabel && (
                          <span className="font-normal text-muted-foreground">· {datumLabel}</span>
                        )}
                        {w.bu ? (
                          <span className="text-violet-600">BU</span>
                        ) : (
                          kurz && <span className="text-amber-600">●</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* Tages-Header: Wochentags-Buchstabe + Datum, Feiertag rot — vertikal fixiert unter dem Wochen-Header */}
                <div className="flex border-b bg-card sticky top-[21px] z-10" style={{ height: 21 }}>
                  {days.map((d, i) => {
                    const wdBuchstabe = ["S", "M", "D", "M", "D", "F", "S"][d.date.getDay()];
                    return (
                      <div
                        key={i}
                        className={`text-[8px] flex flex-col items-center justify-center border-r leading-none ${
                          d.feiertag
                            ? "bg-red-100 text-red-700 font-semibold"
                            : d.bu
                              ? "bg-violet-100 text-violet-800"
                              : d.frei
                                ? "bg-amber-100 text-amber-800"
                                : d.isWeekend
                                  ? "bg-muted/70 text-muted-foreground"
                                  : ""
                        }`}
                        style={{ width: DAY_W }}
                        title={
                          d.feiertag
                            ? (feiertagAt(d.iso)?.name ?? "Feiertag")
                            : d.bu
                              ? "Betriebsurlaub"
                              : d.frei
                                ? "Kurze Woche — frei"
                                : undefined
                        }
                      >
                        <span>{wdBuchstabe}</span>
                        <span>{d.date.getDate()}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Zeilen (parallel zur linken Spalte).
                    data-partie: Ziel-Erkennung beim Balken-Drag zwischen Partien. */}
                {gruppen.map((g) => (
                  <div
                    key={g.partie.id}
                    data-partie={g.partie.id}
                    className={
                      dropPartieId === g.partie.id
                        ? "ring-2 ring-primary ring-inset"
                        : ""
                    }
                  >
                    {/* Gruppenkopf-Zeile (leer, nur Grid) */}
                    <GridRow days={days} height={ROW_H} shade={`${g.partie.farbcode}10`} />
                    {expanded.has(g.partie.id) && (
                      <div
                        className="border-b bg-muted/20"
                        style={{ height: panelHeight(g.member.length) }}
                      />
                    )}
                    {/* Urlaub-Zeile: Segmente aller Partie-MA */}
                    <div className="relative border-b" style={{ height: ROW_H }}>
                      <GridBg days={days} />
                      {g.member.flatMap((m) =>
                        urlaubSegmente(m.id).map((seg, si) => {
                          const geo = barGeo(seg.von, seg.bis);
                          if (!geo) return null;
                          return (
                            <div
                              key={`${m.id}-${si}`}
                              className="absolute rounded flex items-center px-1 text-[9px] font-medium text-white truncate"
                              style={{
                                left: geo.left,
                                width: geo.width,
                                top: 4,
                                height: ROW_H - 8,
                                background: ABW_FARBE[seg.typ] ?? "#0891b2",
                              }}
                              title={`${m.vorname} ${m.nachname} · ${ABW_LABEL[seg.typ] ?? seg.typ} ${seg.von} – ${seg.bis}`}
                            >
                              {geo.width >= 44 ? m.nachname : ""}
                            </div>
                          );
                        }),
                      )}
                    </div>
                    {/* Einsatz-Zeilen */}
                    {g.einsaetze.map((z) => {
                      const b = baustellenById[z.baustelle_id];
                      return (
                        <div key={z.id} className="relative border-b" style={{ height: ROW_H }}>
                          <GridBg days={days} />
                          {renderBar(z, b?.bvh_name ?? "?")}
                        </div>
                      );
                    })}
                  </div>
                ))}
                {/* Urlaube: Bauleiter/Büro + sonst nicht sichtbare Urlauber */}
                <GridRow days={days} height={ROW_H} shade="hsl(var(--muted))" />
                {bauleiter.map((b) => (
                  <div key={b.id} className="relative border-b" style={{ height: ROW_H }}>
                    <GridBg days={days} />
                    {urlaubSegmente(b.id).map((seg, si) => {
                      const geo = barGeo(seg.von, seg.bis);
                      if (!geo) return null;
                      return (
                        <div
                          key={si}
                          className="absolute rounded flex items-center px-1 text-[9px] font-medium text-white truncate"
                          style={{
                            left: geo.left,
                            width: geo.width,
                            top: 4,
                            height: ROW_H - 8,
                            // Krank/SW behalten ihre Signalfarbe, sonst die
                            // persönliche Planungsfarbe des Bauleiters.
                            background:
                              seg.typ === "urlaub"
                                ? (b.planungsfarbe ?? ABW_FARBE.urlaub)
                                : (ABW_FARBE[seg.typ] ?? ABW_FARBE.urlaub),
                          }}
                          title={`${ABW_LABEL[seg.typ] ?? seg.typ} ${seg.von} – ${seg.bis}`}
                        >
                          {geo.width >= 44 ? (ABW_LABEL[seg.typ] ?? seg.typ) : ""}
                        </div>
                      );
                    })}
                  </div>
                ))}
                {sonstigeUrlauber.map((p) => (
                  <div key={p.id} className="relative border-b" style={{ height: ROW_H }}>
                    <GridBg days={days} />
                    {urlaubSegmente(p.id).map((seg, si) => {
                      const geo = barGeo(seg.von, seg.bis);
                      if (!geo) return null;
                      return (
                        <div
                          key={si}
                          className="absolute rounded flex items-center px-1 text-[9px] font-medium text-white truncate"
                          style={{
                            left: geo.left,
                            width: geo.width,
                            top: 4,
                            height: ROW_H - 8,
                            background: ABW_FARBE[seg.typ] ?? "#0891b2",
                          }}
                          title={`${p.vorname} ${p.nachname} · ${ABW_LABEL[seg.typ] ?? seg.typ} ${seg.von} – ${seg.bis}`}
                        >
                          {geo.width >= 44 ? (ABW_LABEL[seg.typ] ?? seg.typ) : ""}
                        </div>
                      );
                    })}
                  </div>
                ))}

                {/* Heute-Linie */}
                {(() => {
                  const i = days.findIndex((d) => d.isToday);
                  if (i < 0) return null;
                  return (
                    <div
                      className="absolute top-0 bottom-0 pointer-events-none"
                      style={{ left: i * DAY_W, width: 2, background: "#dc2626", zIndex: 5 }}
                    />
                  );
                })()}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mobile: schlanke Lese-Liste + Urlaub-Eintrag (kein Gantt) */}
      <div className="md:hidden space-y-3">
        <div className="text-[11px] text-muted-foreground px-1">
          Übersicht der laufenden und kommenden Einsätze. Balken verschieben
          am Tablet/PC.
        </div>
        {gruppen.map((g) => {
          // Nur Einsätze anzeigen, die noch nicht vorbei sind
          const heute = localIso(new Date());
          const aktuelle = g.einsaetze
            .filter((z) => z.bis_datum >= heute)
            .sort((a, b) => a.von_datum.localeCompare(b.von_datum));
          return (
            <Card key={g.partie.id}>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ background: g.partie.farbcode }}
                  />
                  <span className="font-bold text-sm truncate">
                    {g.leiter ? g.leiter.nachname : g.partie.name}
                  </span>
                  <span className="text-[11px] text-muted-foreground truncate">
                    {g.partie.name}
                  </span>
                </div>
                {aktuelle.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground italic">
                    Keine laufenden Einsätze.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {aktuelle.map((z) => {
                      const b = baustellenById[z.baustelle_id];
                      const bl = b?.bauleiter_id ? profilesById[b.bauleiter_id] : null;
                      return (
                        <div
                          key={z.id}
                          className="flex items-center gap-2 text-[12px] border-l-2 pl-2"
                          style={{ borderColor: barColor(z) }}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">
                              {b?.bvh_name ?? "?"}
                              {!z.start_fix && (
                                <span className="text-amber-600 text-[10px]"> · Start offen</span>
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {[b?.kostenstelle, bl?.nachname].filter(Boolean).join(" · ")}
                            </div>
                          </div>
                          <div className="text-[10px] text-muted-foreground text-right shrink-0 tabular-nums">
                            {new Date(z.von_datum).toLocaleDateString("de-AT", {
                              day: "2-digit",
                              month: "2-digit",
                            })}
                            –
                            {new Date(z.bis_datum).toLocaleDateString("de-AT", {
                              day: "2-digit",
                              month: "2-digit",
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Mitlaufender Chip beim Verschieben zwischen Partien */}
      {dragChip && (
        <div
          className="fixed z-[60] pointer-events-none rounded-md bg-primary text-primary-foreground text-xs font-medium px-2.5 py-1 shadow-lg"
          style={{ left: dragChip.x + 14, top: dragChip.y + 14 }}
        >
          {dragChip.text}
        </div>
      )}

      {/* Info-Popup am Balken */}
      {barInfo && (() => {
        const b = baustellenById[barInfo.z.baustelle_id];
        const bl = b?.bauleiter_id ? profilesById[b.bauleiter_id] : null;
        const w = 280;
        const px = Math.min(Math.max(8, barInfo.anchor.x - w / 2), window.innerWidth - w - 8);
        const py = Math.min(barInfo.anchor.y + 10, window.innerHeight - 220);
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setBarInfo(null)} />
            <div
              className="fixed z-50 bg-card border rounded-lg shadow-xl p-3"
              style={{ left: px, top: py, width: w }}
            >
              <div className="flex items-start gap-2">
                <span
                  className="h-3 w-3 rounded-full shrink-0 mt-1"
                  style={{ background: barColor(barInfo.z) }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold leading-tight break-words">
                    {b?.bvh_name ?? "?"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {[b?.kostenstelle, b?.ort].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {!barInfo.z.start_fix && (
                  <Badge variant="outline" className="text-[9px] shrink-0 border-amber-400 text-amber-700">
                    Start nicht fix
                  </Badge>
                )}
              </div>
              <div className="mt-2 pt-2 border-t text-[11px] text-muted-foreground space-y-0.5">
                {bl && (
                  <div>
                    Bauleiter: {bl.vorname} {bl.nachname}
                  </div>
                )}
                <div>
                  {new Date(barInfo.z.von_datum).toLocaleDateString("de-AT")} –{" "}
                  {new Date(barInfo.z.bis_datum).toLocaleDateString("de-AT")}
                </div>
              </div>
              {canEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full h-9 mt-2 justify-start gap-2"
                  onClick={() => toggleStartFix(barInfo.z)}
                  title="Starttermin fix ↔ noch nicht fix (gestrichelt)"
                >
                  <span
                    className="h-2.5 w-6 rounded-sm shrink-0"
                    style={{
                      background: barInfo.z.start_fix
                        ? barColor(barInfo.z)
                        : "transparent",
                      border: barInfo.z.start_fix
                        ? "none"
                        : `1.5px dashed ${barColor(barInfo.z)}`,
                    }}
                  />
                  {barInfo.z.start_fix
                    ? "Start noch nicht fix setzen"
                    : "Start als fix setzen"}
                </Button>
              )}
              {canEdit && (
                <div className="flex gap-2 mt-2">
                  <Button
                    size="sm"
                    className="flex-1 h-9"
                    onClick={() => {
                      setEditDialog({
                        id: barInfo.z.id,
                        partieId: barInfo.z.partie_id,
                        baustelleId: barInfo.z.baustelle_id,
                        von: barInfo.z.von_datum,
                        bis: barInfo.z.bis_datum,
                        startFix: barInfo.z.start_fix,
                        suche: "",
                      });
                      setBarInfo(null);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1.5" /> Bearbeiten
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 text-destructive border-destructive/40 hover:bg-destructive hover:text-destructive-foreground"
                    onClick={() => deleteEinsatz(barInfo.z.id)}
                    title="Einsatz aus der Planung entfernen"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </>
        );
      })()}

      {/* Neu/Bearbeiten-Dialog */}
      <Dialog open={!!editDialog} onOpenChange={(o) => !o && setEditDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editDialog?.id ? "Einsatz bearbeiten" : "Einsatz anlegen"}
            </DialogTitle>
          </DialogHeader>
          {editDialog && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Baustelle</Label>
                <Input
                  placeholder="Suchen…"
                  value={editDialog.suche}
                  onChange={(e) =>
                    setEditDialog({ ...editDialog, suche: e.target.value })
                  }
                  className="mb-1"
                />
                <div className="max-h-40 overflow-y-auto border rounded">
                  {baustellen
                    .filter((b) => b.status === "aktiv" || b.status === "geplant")
                    .filter(
                      (b) =>
                        !editDialog.suche ||
                        b.bvh_name.toLowerCase().includes(editDialog.suche.toLowerCase()) ||
                        (b.kostenstelle ?? "").includes(editDialog.suche),
                    )
                    .slice(0, 30)
                    .map((b) => (
                      <button
                        key={b.id}
                        className={`w-full text-left text-xs px-2 py-1.5 hover:bg-muted flex items-center gap-2 ${
                          editDialog.baustelleId === b.id ? "bg-primary/10 font-semibold" : ""
                        }`}
                        onClick={() =>
                          setEditDialog({ ...editDialog, baustelleId: b.id })
                        }
                      >
                        <span className="flex-1 truncate">{b.bvh_name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {b.kostenstelle ?? ""}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Von</Label>
                  <Input
                    type="date"
                    value={editDialog.von}
                    onChange={(e) => setEditDialog({ ...editDialog, von: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Bis</Label>
                  <Input
                    type="date"
                    value={editDialog.bis}
                    onChange={(e) => setEditDialog({ ...editDialog, bis: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between rounded border px-3 py-2">
                <div>
                  <div className="text-sm font-medium">Starttermin fix</div>
                  <div className="text-[11px] text-muted-foreground">
                    Aus = Balken wird gestrichelt dargestellt
                  </div>
                </div>
                <Switch
                  checked={editDialog.startFix}
                  onCheckedChange={(v) => setEditDialog({ ...editDialog, startFix: v })}
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            {editDialog?.id && (
              <Button
                variant="outline"
                className="text-destructive mr-auto"
                onClick={() => deleteEinsatz(editDialog.id!)}
              >
                <Trash2 className="h-4 w-4 mr-1" /> Entfernen
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditDialog(null)}>
              Abbrechen
            </Button>
            <Button onClick={saveEinsatz} disabled={busy || !editDialog?.baustelleId}>
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Urlaub-Schnelleintrag */}
    </div>
  );
}

/** Grid-Hintergrund einer Zeile (Wochenend-/Feiertags-/Kalender-Schattierung). */
function GridBg({
  days,
}: {
  days: { isWeekend: boolean; feiertag: boolean; frei?: boolean; bu?: boolean }[];
}) {
  return (
    <div className="absolute inset-0 flex pointer-events-none">
      {days.map((d, i) => (
        <div
          key={i}
          className={`border-r ${
            d.feiertag
              ? "bg-red-500/15"
              : d.bu
                ? "bg-violet-500/15"
                : d.frei
                  ? "bg-amber-500/15"
                  : d.isWeekend
                    ? "bg-muted-foreground/15"
                    : ""
          }`}
          style={{ width: DAY_W }}
        />
      ))}
    </div>
  );
}

/** Leere Zeile mit Grid + optionaler Färbung (Gruppenköpfe). */
function GridRow({
  days,
  height,
  shade,
}: {
  days: { isWeekend: boolean; feiertag: boolean }[];
  height: number;
  shade?: string;
}) {
  return (
    <div className="relative border-b" style={{ height, background: shade }}>
      <GridBg days={days} />
    </div>
  );
}
