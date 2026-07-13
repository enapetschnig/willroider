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
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { localIso } from "@/lib/dateFmt";
import { feiertagAt } from "@/lib/feiertage";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Fahrzeug = Database["public"]["Tables"]["fahrzeuge"]["Row"];
type Zeitraum = Database["public"]["Tables"]["poliereinsatz_zeitraeume"]["Row"];

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_W = 22; // px pro Tag — wie die Mitarbeiter-Ansicht
const LEFT_W = 380; // linke Spaltengruppe

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

export function PoliereinsatzView({
  baustellen,
  partien,
  profiles,
  fahrzeuge,
  canEdit,
  userId,
  onReload,
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
}) {
  const { toast } = useToast();
  const [zeitraeume, setZeitraeume] = useState<Zeitraum[]>([]);
  const [urlaubByMa, setUrlaubByMa] = useState<Map<string, Set<string>>>(new Map());
  const [weeksVisible] = useState(26);
  const [anchorWeek, setAnchorWeek] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return startOfISOWeek(d);
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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

  // Urlaub-Schnelleintrag
  const [urlaubDialog, setUrlaubDialog] = useState<{
    partieId: string;
    maId: string;
    von: string;
    bis: string;
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
  } | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    id: string;
    von: string;
    bis: string;
  } | null>(null);

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
        .select("mitarbeiter_id, datum")
        .eq("tag_status", "urlaub")
        .gte("datum", rangeStartIso)
        .lte("datum", rangeEndIso),
    ]);
    if (zErr) {
      toast({ variant: "destructive", title: "Laden fehlgeschlagen", description: zErr.message });
      return;
    }
    setZeitraeume((zs as Zeitraum[]) ?? []);
    const m = new Map<string, Set<string>>();
    ((urlaub as any[]) ?? []).forEach((r) => {
      if (!m.has(r.mitarbeiter_id)) m.set(r.mitarbeiter_id, new Set());
      m.get(r.mitarbeiter_id)!.add(r.datum);
    });
    setUrlaubByMa(m);
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

  // ─── Zeitachse ───────────────────────────────────────────────────────
  const days = useMemo(() => {
    const res: { iso: string; date: Date; isMonday: boolean; isToday: boolean; isWeekend: boolean; feiertag: boolean }[] = [];
    const today = localIso(new Date());
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(anchorWeek.getTime() + i * DAY_MS);
      const iso = isoDate(d);
      res.push({
        iso,
        date: d,
        isMonday: d.getDay() === 1,
        isToday: iso === today,
        isWeekend: d.getDay() === 0 || d.getDay() === 6,
        feiertag: !!feiertagAt(iso),
      });
    }
    return res;
  }, [anchorWeek, totalDays]);

  const idxByIso = useMemo(() => {
    const m = new Map<string, number>();
    days.forEach((d, i) => m.set(d.iso, i));
    return m;
  }, [days]);

  const weeks = useMemo(() => {
    const res: { label: string; startIdx: number }[] = [];
    days.forEach((d, i) => {
      if (d.isMonday || i === 0) {
        res.push({ label: `KW ${isoWeek(d.date)}`, startIdx: i });
      }
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

  /** Urlaubs-Segmente eines MA (zusammenhängende Tage). */
  const urlaubSegmente = (maId: string): { von: string; bis: string }[] => {
    const tage = [...(urlaubByMa.get(maId) ?? [])].sort();
    const segs: { von: string; bis: string }[] = [];
    for (const iso of tage) {
      const last = segs[segs.length - 1];
      if (last && addDays(last.bis, 1) === iso) last.bis = iso;
      else segs.push({ von: iso, bis: iso });
    }
    return segs;
  };

  // ─── Gruppen: Partien mit Leiter oder Einsätzen ──────────────────────
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
      .sort((a, b) => a.partie.name.localeCompare(b.partie.name));
  }, [partien, zeitraeume, profiles, profilesById]);

  const bauleiter = useMemo(
    () => profiles.filter((p) => p.planungsfarbe).sort((a, b) => a.nachname.localeCompare(b.nachname)),
    [profiles],
  );

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
    };
    const onUp = async (ev: PointerEvent) => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      const d = dragRef.current;
      dragRef.current = null;
      setDragPreview(null);
      if (!d) return;
      if (!d.moved) {
        // Reiner Klick → Info-Popup
        setBarInfo({ z: d.z, anchor: { x: ev.clientX, y: ev.clientY } });
        return;
      }
      if (d.previewVon === d.z.von_datum && d.previewBis === d.z.bis_datum) return;
      const { data: upd, error } = await supabase
        .from("poliereinsatz_zeitraeume")
        .update({ von_datum: d.previewVon, bis_datum: d.previewBis })
        .eq("id", d.z.id)
        .select("id");
      if (error || !upd || upd.length === 0) {
        toast({
          variant: "destructive",
          title: "Verschieben fehlgeschlagen",
          description: error?.message ?? "Keine Berechtigung.",
        });
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
    toast({ title: d.id ? "Einsatz aktualisiert" : "Einsatz angelegt" });
    setEditDialog(null);
    void load();
  };

  const deleteEinsatz = async (id: string) => {
    if (!confirm("Einsatz aus der Planung entfernen?")) return;
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
    setEditDialog(null);
    setBarInfo(null);
    void load();
  };

  /** Urlaub-Schnelleintrag: schreibt echte stunden_tage (nur Werktage,
   *  keine bestehenden Tage überschreiben, kein Konto-Abzug). */
  const saveUrlaub = async () => {
    const d = urlaubDialog;
    if (!d || !d.maId || !d.von || !d.bis || d.bis < d.von) return;
    setBusy(true);
    try {
      const tage: string[] = [];
      let cur = d.von;
      while (cur <= d.bis) {
        const dt = new Date(cur + "T00:00:00");
        const wd = dt.getDay();
        if (wd !== 0 && wd !== 6 && !feiertagAt(cur)) tage.push(cur);
        cur = addDays(cur, 1);
      }
      if (tage.length === 0) {
        toast({ variant: "destructive", title: "Keine Werktage im Zeitraum" });
        return;
      }
      // Gesperrte Monate (Lohnabschluss) ausschließen — sonst würde ein
      // bereits abgerechneter Zeitraum nachträglich verändert.
      const { data: sperren } = await supabase
        .from("monatsabschluss")
        .select("von_datum, bis_datum")
        .eq("mitarbeiter_id", d.maId);
      const istGesperrt = (iso: string) =>
        ((sperren as any[]) ?? []).some(
          (s) => iso >= s.von_datum && iso <= s.bis_datum,
        );
      const gesperrt = tage.filter(istGesperrt);
      const offen = tage.filter((t) => !istGesperrt(t));

      const { data: existing } = await supabase
        .from("stunden_tage")
        .select("datum")
        .eq("mitarbeiter_id", d.maId)
        .in("datum", offen.length > 0 ? offen : ["1900-01-01"]);
      const skip = new Set(((existing as any[]) ?? []).map((r) => r.datum));
      const neu = offen.filter((t) => !skip.has(t));
      if (neu.length > 0) {
        const { error } = await supabase.from("stunden_tage").insert(
          neu.map((datum) => ({
            mitarbeiter_id: d.maId,
            datum,
            tag_status: "urlaub" as const,
            netto_stunden: 0,
            status: "erfasst" as const,
          })),
        );
        if (error) {
          toast({ variant: "destructive", title: "Eintragen fehlgeschlagen", description: error.message });
          return;
        }
      }
      toast({
        title: `${neu.length} Urlaubstag(e) eingetragen`,
        description:
          (skip.size > 0 ? `${skip.size} bereits erfasst. ` : "") +
          (gesperrt.length > 0
            ? `${gesperrt.length} übersprungen (Monat abgeschlossen). `
            : "") +
          "Hinweis: kein Urlaubskonto-Abzug — dafür Urlaubsantrag verwenden.",
      });
      setUrlaubDialog(null);
      void load();
    } finally {
      setBusy(false);
    }
  };

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
    const geo = barGeo(von, bis);
    if (!geo) return null;
    const color = barColor(z);
    return (
      <div
        className="absolute rounded flex items-center px-1.5 text-[10px] font-semibold text-white shadow-sm select-none"
        style={{
          left: geo.left,
          width: geo.width,
          top: 3,
          height: ROW_H - 6,
          background: z.start_fix
            ? color
            : // gestrichelt: Start noch nicht fix
              `repeating-linear-gradient(45deg, ${color}, ${color} 6px, ${color}55 6px, ${color}55 12px)`,
          border: z.start_fix ? "none" : `1.5px dashed ${color}`,
          cursor: canEdit ? "grab" : "pointer",
          touchAction: "none",
        }}
        title={`${label} · ${von} – ${bis}${z.start_fix ? "" : " (Start nicht fix)"}`}
        onPointerDown={(e) => canEdit && onBarPointerDown(e, z, "move")}
        onClick={(e) => {
          if (canEdit) return; // Klick läuft über den Drag-Pfad
          e.stopPropagation();
          setBarInfo({ z, anchor: { x: e.clientX, y: e.clientY } });
        }}
      >
        {canEdit && (
          <>
            <div
              className="absolute left-0 top-0 bottom-0"
              style={{ width: 7, cursor: "ew-resize" }}
              onPointerDown={(e) => onBarPointerDown(e, z, "resize-l")}
            />
            <div
              className="absolute right-0 top-0 bottom-0"
              style={{ width: 7, cursor: "ew-resize" }}
              onPointerDown={(e) => onBarPointerDown(e, z, "resize-r")}
            />
          </>
        )}
        <span className="truncate pointer-events-none">
          {geo.width < 50 ? "" : label}
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-3">
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
        </CardContent>
      </Card>

      <Card className="overflow-hidden hidden md:block">
        <CardContent className="p-0">
          <div className="flex">
            {/* Linke Spaltengruppe */}
            <div className="shrink-0 border-r bg-card z-10" style={{ width: LEFT_W }}>
              {/* Kopfzeile */}
              <div
                className="border-b bg-muted/60 flex items-end px-2 text-[10px] font-semibold uppercase tracking-wide"
                style={{ height: 42 }}
              >
                <div className="flex-1 pb-1">Polier / BVH</div>
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
                        {(canEdit ||
                          (userId && g.partie.partieleiter_id === userId)) && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] px-2"
                            onClick={() =>
                              setUrlaubDialog({
                                partieId: g.partie.id,
                                maId: g.member[0]?.id ?? "",
                                von: localIso(new Date()),
                                bis: localIso(new Date()),
                              })
                            }
                          >
                            <Sun className="h-3 w-3 mr-1" /> Urlaub eintragen
                          </Button>
                        )}
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
                    <span className="pl-5">Urlaub</span>
                  </div>
                  {/* Einsatz-Zeilen */}
                  {g.einsaetze.map((z) => {
                    const b = baustellenById[z.baustelle_id];
                    const bl = b?.bauleiter_id ? profilesById[b.bauleiter_id] : null;
                    const istBaustelle = b && b.kategorie !== "maschine";
                    return (
                      <div
                        key={z.id}
                        className="border-b flex items-center px-2 text-[11px] hover:bg-muted/30"
                        style={{ height: ROW_H }}
                      >
                        <div className="flex-1 truncate pl-5" title={b?.bvh_name ?? "?"}>
                          {b?.bvh_name ?? "?"}
                        </div>
                        <div className="w-12 text-[10px] text-muted-foreground tabular-nums">
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
              {/* Bauleiter-Urlaubs-Block */}
              <div
                className="border-b bg-muted/60 flex items-center px-2 text-[12px] font-bold"
                style={{ height: ROW_H }}
              >
                Urlaube (Bauleiter / Büro)
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
            </div>

            {/* Zeitachse + Balken */}
            <div className="flex-1 overflow-x-auto">
              <div style={{ width: totalDays * DAY_W, position: "relative" }}>
                {/* Wochen-Header */}
                <div className="flex border-b bg-muted/60" style={{ height: 21 }}>
                  {weeks.map((w, i) => {
                    const nextStart = weeks[i + 1]?.startIdx ?? totalDays;
                    return (
                      <div
                        key={i}
                        className="text-[10px] font-semibold flex items-center justify-center border-r"
                        style={{ width: (nextStart - w.startIdx) * DAY_W }}
                      >
                        {w.label}
                      </div>
                    );
                  })}
                </div>
                {/* Tages-Header */}
                <div className="flex border-b" style={{ height: 21 }}>
                  {days.map((d, i) => (
                    <div
                      key={i}
                      className={`text-[8px] flex items-center justify-center border-r ${
                        d.isWeekend || d.feiertag ? "bg-muted/50 text-muted-foreground" : ""
                      }`}
                      style={{ width: DAY_W }}
                    >
                      {d.date.getDate()}
                    </div>
                  ))}
                </div>

                {/* Zeilen (parallel zur linken Spalte) */}
                {gruppen.map((g) => (
                  <div key={g.partie.id}>
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
                                background: "#0891b2",
                              }}
                              title={`${m.vorname} ${m.nachname} · Urlaub ${seg.von} – ${seg.bis}`}
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
                {/* Bauleiter-Urlaube */}
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
                            background: b.planungsfarbe ?? "#0891b2",
                          }}
                          title={`Urlaub ${seg.von} – ${seg.bis}`}
                        >
                          {geo.width >= 44 ? "Urlaub" : ""}
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

      <div className="md:hidden text-sm text-muted-foreground italic px-1">
        Die Poliereinsatz-Ansicht ist für größere Bildschirme ausgelegt — bitte
        Tablet quer oder PC verwenden.
      </div>

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
                  className="w-full mt-2 h-9"
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
      <Dialog open={!!urlaubDialog} onOpenChange={(o) => !o && setUrlaubDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Urlaub eintragen</DialogTitle>
          </DialogHeader>
          {urlaubDialog && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Mitarbeiter</Label>
                <select
                  className="w-full h-10 border rounded bg-background px-2 text-sm"
                  value={urlaubDialog.maId}
                  onChange={(e) =>
                    setUrlaubDialog({ ...urlaubDialog, maId: e.target.value })
                  }
                >
                  {profiles
                    .filter((p) => p.partie_id === urlaubDialog.partieId && p.is_active !== false)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.vorname} {p.nachname}
                      </option>
                    ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Von</Label>
                  <Input
                    type="date"
                    value={urlaubDialog.von}
                    onChange={(e) =>
                      setUrlaubDialog({ ...urlaubDialog, von: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label className="text-xs">Bis</Label>
                  <Input
                    type="date"
                    value={urlaubDialog.bis}
                    onChange={(e) =>
                      setUrlaubDialog({ ...urlaubDialog, bis: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Schreibt Urlaubs-Tage direkt in die Zeiterfassung (nur Werktage).
                Kein Urlaubskonto-Abzug — dafür den Urlaubsantrag verwenden.
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setUrlaubDialog(null)}>
              Abbrechen
            </Button>
            <Button onClick={saveUrlaub} disabled={busy || !urlaubDialog?.maId}>
              Eintragen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Grid-Hintergrund einer Zeile (Wochenend-/Feiertags-Schattierung). */
function GridBg({ days }: { days: { isWeekend: boolean; feiertag: boolean }[] }) {
  return (
    <div className="absolute inset-0 flex pointer-events-none">
      {days.map((d, i) => (
        <div
          key={i}
          className={`border-r ${d.isWeekend || d.feiertag ? "bg-muted/40" : ""}`}
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
