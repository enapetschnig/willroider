/**
 * Tagesplanung im klassischen Word-Layout der bestehenden Excel-/Word-Vorlage.
 * Serif-Font, schwarze 1px-Borders, fett-kursive Header.
 *
 * Page-Aufbau:
 *   - Titel-Box "Arbeitseinteilung Zimmerei"
 *   - Datum mittig (Wochentag DD.MM.YYYY)
 *   - Tabelle: BVH | Fahrz. | Tätigkeit | Mitarbeiter
 *   - Sonderfälle-Sektion (Urlaub, Krank, Schlechtwetter, Sonstige Hinweise)
 *
 * UI-Chrome (Datum-Switcher, Druck-/Freigabe-Buttons) ist via print:hidden
 * beim Drucken weg → das gedruckte Blatt sieht 1:1 wie das Original aus.
 */

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ChevronLeft,
  ChevronRight,
  Printer,
  Send,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  X,
  Copy,
  Eye,
  ClipboardList,
  Users,
  HeartPulse,
  Sun,
  CloudRain,
  ArrowRight,
  Building2,
  Download,
  Share2,
} from "lucide-react";
import { makeTagesplanungPdf } from "@/lib/tagesplanungPdf";
import { teilenOderDownload, downloadDatei } from "@/lib/teilen";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { localIso } from "@/lib/dateFmt";
import { BaustelleCombobox } from "@/components/stunden/BaustelleCombobox";
import { useTagesplanung, type EinteilungMitDetails } from "@/hooks/useTagesplanung";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Fahrzeug = Database["public"]["Tables"]["fahrzeuge"]["Row"];

const todayIso = () => localIso();

const WOCHENTAG = [
  "Sonntag",
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
];

function fmtHeaderDatum(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${WOCHENTAG[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}.${String(
    d.getMonth() + 1,
  ).padStart(2, "0")}.${d.getFullYear()}`;
}

function moveDate(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return localIso(d);
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function Tagesplanung() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [datum, setDatum] = useState<string>(todayIso());
  const [view, setView] = useState<"baustellen" | "mitarbeiter">("baustellen");
  const { data: plan, isLoading } = useTagesplanung(datum);

  /** Direkt nach jeder Mutation aufrufen — invalidiert den useTagesplanung-Cache
   *  damit das UI sofort die neuen Daten zeigt (ohne auf Realtime zu warten). */
  const refresh = () => qc.invalidateQueries({ queryKey: ["tagesplan", datum] });

  /** Setzt manuell_geaendert=true mit silent-Fail. Wenn die Spalte (noch) nicht
   *  existiert (Schema-Cache veraltet oder Migration nicht durchgelaufen), wird
   *  der Fehler stillschweigend ignoriert — die App funktioniert trotzdem. */
  async function markManuell(
    table: "einteilungen" | "einteilung_mitarbeiter",
    id: string,
  ) {
    try {
      await supabase
        .from(table)
        .update({ manuell_geaendert: true } as any)
        .eq("id", id);
    } catch {
      /* ignore — Spalte fehlt oder Schema-Cache veraltet */
    }
  }

  const baustellen = useMemo(() => {
    // alle aktiven/geplanten Baustellen für „Einteilung hinzufügen"-Dialog
    return plan?.einteilungen.map((e) => e.baustelle).filter(Boolean) ?? [];
  }, [plan]);
  const [allBaustellen, setAllBaustellen] = useState<Baustelle[]>([]);
  const [allFahrzeuge, setAllFahrzeuge] = useState<Fahrzeug[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: bs }, { data: fz }] = await Promise.all([
        supabase
          .from("baustellen")
          .select("*")
          .in("status", ["aktiv", "geplant"])
          .order("bvh_name"),
        supabase.from("fahrzeuge").select("*").order("kennzeichen"),
      ]);
      setAllBaustellen((bs as Baustelle[]) ?? []);
      setAllFahrzeuge((fz as Fahrzeug[]) ?? []);
    })();
  }, []);

  // Abwesende-IDs für den MA-Picker filtern
  const abwesendIds = useMemo(
    () => new Set((plan?.abwesende ?? []).map((a) => a.ma.id)),
    [plan?.abwesende],
  );
  // Bereits eingeteilte IDs für den MA-Picker filtern
  const eingeteilteIds = useMemo(() => {
    const s = new Set<string>();
    plan?.einteilungen.forEach((e) =>
      e.mitarbeiter.forEach((m) => s.add(m.ma.mitarbeiter_id)),
    );
    return s;
  }, [plan?.einteilungen]);

  // ─── Mutationen ─────────────────────────────────────────────────────────

  async function updateTaetigkeit(einteilungId: string, val: string) {
    await supabase
      .from("einteilungen")
      .update({ taetigkeit: val || null })
      .eq("id", einteilungId);
    await markManuell("einteilungen", einteilungId);
    refresh();
  }

  async function updateFahrzeuge(einteilungId: string, fahrzeugIds: string[]) {
    // delete-all + insert (einfach + idempotent)
    await supabase.from("einteilung_fahrzeuge").delete().eq("einteilung_id", einteilungId);
    if (fahrzeugIds.length > 0) {
      await supabase.from("einteilung_fahrzeuge").insert(
        fahrzeugIds.map((fid) => ({
          einteilung_id: einteilungId,
          fahrzeug_id: fid,
        })),
      );
    }
    await markManuell("einteilungen", einteilungId);
    refresh();
  }

  async function addMitarbeiter(einteilungId: string, maIds: string[]) {
    if (maIds.length === 0) return;
    const { data: inserted, error } = await supabase
      .from("einteilung_mitarbeiter")
      .insert(
        maIds.map((mid) => ({
          einteilung_id: einteilungId,
          mitarbeiter_id: mid,
        })),
      )
      .select("id");
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    await markManuell("einteilungen", einteilungId);
    for (const r of inserted ?? []) {
      await markManuell("einteilung_mitarbeiter", (r as any).id);
    }
    refresh();
  }

  async function removeMitarbeiter(emId: string, einteilungId: string) {
    await supabase.from("einteilung_mitarbeiter").delete().eq("id", emId);
    await markManuell("einteilungen", einteilungId);
    refresh();
  }

  async function addEinteilung(input: {
    baustelle_id: string;
    taetigkeit: string;
    mitarbeiterIds: string[];
    fahrzeugIds: string[];
  }) {
    const { data: e, error } = await supabase
      .from("einteilungen")
      .insert({
        datum,
        baustelle_id: input.baustelle_id,
        taetigkeit: input.taetigkeit || null,
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (error || !e) {
      toast({ variant: "destructive", title: "Fehler", description: error?.message });
      return;
    }
    await markManuell("einteilungen", e.id);
    if (input.mitarbeiterIds.length > 0) {
      const { data: emInserted } = await supabase
        .from("einteilung_mitarbeiter")
        .insert(
          input.mitarbeiterIds.map((mid) => ({
            einteilung_id: e.id,
            mitarbeiter_id: mid,
          })),
        )
        .select("id");
      for (const r of emInserted ?? []) {
        await markManuell("einteilung_mitarbeiter", (r as any).id);
      }
    }
    if (input.fahrzeugIds.length > 0) {
      await supabase.from("einteilung_fahrzeuge").insert(
        input.fahrzeugIds.map((fid) => ({
          einteilung_id: e.id,
          fahrzeug_id: fid,
        })),
      );
    }
    refresh();
  }

  async function deleteEinteilung(einteilungId: string) {
    if (!window.confirm("Diese Einteilung wirklich entfernen?")) return;
    await supabase.from("einteilungen").delete().eq("id", einteilungId);
    refresh();
  }

  /** Bewegt eine einteilung_mitarbeiter-Zeile in eine andere Einteilung.
   *  Prüft vorher, ob der MA in der Ziel-Einteilung schon existiert — dann wird
   *  die Quell-Zeile gelöscht (statt UNIQUE-Constraint-Verletzung). */
  async function moveMitarbeiter(emId: string, neueEinteilungId: string) {
    // 1) Welcher MA ist das? Existiert er schon in der Ziel-Einteilung?
    const { data: source } = await supabase
      .from("einteilung_mitarbeiter")
      .select("mitarbeiter_id, einteilung_id")
      .eq("id", emId)
      .maybeSingle();
    if (!source) {
      refresh();
      return;
    }
    if (source.einteilung_id === neueEinteilungId) {
      // Drop auf gleiche Einteilung → no-op
      return;
    }
    const { data: existsInTarget } = await supabase
      .from("einteilung_mitarbeiter")
      .select("id")
      .eq("einteilung_id", neueEinteilungId)
      .eq("mitarbeiter_id", source.mitarbeiter_id)
      .maybeSingle();
    if (existsInTarget) {
      // MA ist schon in der Ziel-Einteilung → einfach Quell-Zeile löschen
      await supabase.from("einteilung_mitarbeiter").delete().eq("id", emId);
    } else {
      const { error } = await supabase
        .from("einteilung_mitarbeiter")
        .update({ einteilung_id: neueEinteilungId })
        .eq("id", emId);
      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: error.message });
        return;
      }
      await markManuell("einteilung_mitarbeiter", emId);
    }
    await markManuell("einteilungen", neueEinteilungId);
    refresh();
  }

  /** Entfernt einen MA aus allen heutigen Einteilungen. */
  async function removeMaFromAllEinteilungenForToday(maId: string) {
    const einteilungIds = (plan?.einteilungen ?? []).map((e) => e.einteilung.id);
    if (einteilungIds.length === 0) return;
    await supabase
      .from("einteilung_mitarbeiter")
      .delete()
      .eq("mitarbeiter_id", maId)
      .in("einteilung_id", einteilungIds);
    refresh();
  }

  /** Zuteilung: MA in eine Baustelle für heute einteilen. Legt Einteilung an
   *  wenn (datum, baustelle) noch keine existiert; sonst MA dort einfügen.
   *  Entfernt vorher alte Zuteilungen des MA für heute (atomarer Wechsel). */
  async function assignMaToBaustelle(maId: string, baustelleId: string) {
    // 1) Existiert bereits Einteilung für (datum, baustelle)?
    const { data: ex } = await supabase
      .from("einteilungen")
      .select("id")
      .eq("datum", datum)
      .eq("baustelle_id", baustelleId)
      .maybeSingle();

    let einteilungId = ex?.id as string | undefined;
    if (!einteilungId) {
      const { data: neu, error } = await supabase
        .from("einteilungen")
        .insert({
          datum,
          baustelle_id: baustelleId,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (error || !neu) {
        toast({ variant: "destructive", title: "Fehler", description: error?.message });
        return;
      }
      einteilungId = neu.id;
    }
    await markManuell("einteilungen", einteilungId);

    // 2) MA aus eventuellen anderen heutigen Einteilungen entfernen (ohne Refresh dazwischen)
    const altEinteilungIds = (plan?.einteilungen ?? []).map((e) => e.einteilung.id);
    if (altEinteilungIds.length > 0) {
      await supabase
        .from("einteilung_mitarbeiter")
        .delete()
        .eq("mitarbeiter_id", maId)
        .in("einteilung_id", altEinteilungIds);
    }

    // 3) In neue Einteilung einfügen
    const { data: inserted } = await supabase
      .from("einteilung_mitarbeiter")
      .insert({
        einteilung_id: einteilungId,
        mitarbeiter_id: maId,
      })
      .select("id")
      .single();
    if (inserted) {
      await markManuell("einteilung_mitarbeiter", (inserted as any).id);
    }
    refresh();
  }

  async function saveSonstigeHinweise(text: string) {
    await supabase.from("tagesplanung_freigaben").upsert(
      {
        datum,
        notiz: text || null,
        freigegeben_von: plan?.freigabe?.freigegeben_von ?? user?.id ?? null,
        freigegeben_am: plan?.freigabe?.freigegeben_am ?? new Date().toISOString(),
      },
      { onConflict: "datum" },
    );
    refresh();
  }

  /** Kopiert alle Einteilungen vom letzten Werktag (oder Vortag) auf den aktuellen Tag.
   *  Skippt MA, die heute krank/Urlaub/SW haben — die werden in der Sonderfälle-Sektion gezeigt. */
  const [copyBusy, setCopyBusy] = useState(false);
  async function uebernehmePlanVomVortag() {
    if (copyBusy) return;
    setCopyBusy(true);
    try {
    // Letzten Werktag mit Einteilungen finden (max. 7 Tage zurück)
    let quellDatum: string | null = null;
    let einteilungenVomQuell: any[] = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(datum + "T00:00:00");
      d.setDate(d.getDate() - i);
      const iso = localIso(d);
      const { data } = await supabase
        .from("einteilungen")
        .select("id, baustelle_id, taetigkeit, treffpunkt, abfahrtszeit")
        .eq("datum", iso);
      if (data && data.length > 0) {
        quellDatum = iso;
        einteilungenVomQuell = data;
        break;
      }
    }
    if (!quellDatum) {
      toast({ variant: "destructive", title: "Kein Vortags-Plan gefunden" });
      return;
    }
    if (
      !window.confirm(
        `Alle ${einteilungenVomQuell.length} Einteilungen vom ${new Date(quellDatum).toLocaleDateString("de-AT")} übernehmen?`,
      )
    )
      return;

    const quellIds = einteilungenVomQuell.map((e) => e.id);
    const [{ data: ems }, { data: efs }] = await Promise.all([
      supabase
        .from("einteilung_mitarbeiter")
        .select("einteilung_id, mitarbeiter_id, rolle")
        .in("einteilung_id", quellIds),
      supabase
        .from("einteilung_fahrzeuge")
        .select("einteilung_id, fahrzeug_id")
        .in("einteilung_id", quellIds),
    ]);

    // Pro Quell-Einteilung neue Einteilung anlegen
    let saved = 0;
    let skipped = 0;
    for (const quell of einteilungenVomQuell) {
      if (!quell.baustelle_id) {
        skipped++;
        continue;
      }
      // Existiert schon? Skip wenn ja.
      const { data: existing } = await supabase
        .from("einteilungen")
        .select("id")
        .eq("datum", datum)
        .eq("baustelle_id", quell.baustelle_id)
        .maybeSingle();
      if (existing) {
        skipped++;
        continue;
      }
      const { data: neu } = await supabase
        .from("einteilungen")
        .insert({
          datum,
          baustelle_id: quell.baustelle_id,
          taetigkeit: quell.taetigkeit,
          treffpunkt: quell.treffpunkt,
          abfahrtszeit: quell.abfahrtszeit,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (!neu) continue;

      // MA übernehmen (abwesende skippen)
      const maForQuell = (ems ?? [])
        .filter((m: any) => m.einteilung_id === quell.id)
        .filter((m: any) => !abwesendIds.has(m.mitarbeiter_id));
      if (maForQuell.length > 0) {
        await supabase.from("einteilung_mitarbeiter").insert(
          maForQuell.map((m: any) => ({
            einteilung_id: neu.id,
            mitarbeiter_id: m.mitarbeiter_id,
            rolle: m.rolle,
          })),
        );
      }
      // Fahrzeuge übernehmen
      const fzForQuell = (efs ?? []).filter((f: any) => f.einteilung_id === quell.id);
      if (fzForQuell.length > 0) {
        await supabase.from("einteilung_fahrzeuge").insert(
          fzForQuell.map((f: any) => ({
            einteilung_id: neu.id,
            fahrzeug_id: f.fahrzeug_id,
          })),
        );
      }
      saved++;
    }
    toast({
      title: `${saved} Einteilungen übernommen`,
      description: skipped > 0 ? `${skipped} übersprungen (existieren bereits)` : undefined,
    });
    refresh();
    } finally {
      setCopyBusy(false);
    }
  }

  function pdfFilename(): string {
    return `Arbeitseinteilung_${datum}.pdf`;
  }
  function pdfTeilenText(): string {
    return `Arbeitseinteilung ${fmtHeaderDatum(datum)}`;
  }

  /** Lädt die Tagesplanung als PDF herunter. */
  function downloadPdf() {
    if (!plan) {
      toast({ variant: "destructive", title: "Plan noch nicht geladen" });
      return;
    }
    const doc = makeTagesplanungPdf(plan);
    const blob = doc.output("blob");
    downloadDatei(blob, pdfFilename());
    toast({ title: "PDF heruntergeladen" });
  }

  /** Teilt die PDF via Share-API (Mobile) oder Download + WhatsApp Web (Desktop). */
  async function teilePdf() {
    if (!plan) {
      toast({ variant: "destructive", title: "Plan noch nicht geladen" });
      return;
    }
    const doc = makeTagesplanungPdf(plan);
    const blob = doc.output("blob");
    const ok = await teilenOderDownload({
      blob,
      filename: pdfFilename(),
      text: pdfTeilenText(),
    });
    if (ok) {
      toast({ title: "Geteilt" });
    } else {
      toast({
        title: "PDF heruntergeladen",
        description: "WhatsApp Web wurde geöffnet — PDF einfach ins Chat-Fenster ziehen.",
      });
    }
  }

  async function freigeben() {
    const { error } = await supabase.from("tagesplanung_freigaben").upsert(
      {
        datum,
        freigegeben_am: new Date().toISOString(),
        freigegeben_von: user?.id ?? null,
        notiz: plan?.freigabe?.notiz ?? null,
      },
      { onConflict: "datum" },
    );
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Plan für " + fmtHeaderDatum(datum) + " freigegeben" });
    refresh();
  }

  const freigegeben = !!plan?.freigabe;

  // ─── Drag & Drop ────────────────────────────────────────────────────────

  const [dragActive, setDragActive] = useState<{ name: string; emId: string; fromEinteilungId: string } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as
      | { type: "ma"; emId: string; einteilungId: string; name: string }
      | undefined;
    if (data?.type === "ma") {
      setDragActive({ name: data.name, emId: data.emId, fromEinteilungId: data.einteilungId });
    }
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setDragActive(null);
    const active = e.active.data.current as any;
    const over = e.over?.data.current as any;
    if (!active || !over) return;
    if (active.type !== "ma" || over.type !== "zeile") return;
    if (active.einteilungId === over.einteilungId) return;
    await moveMitarbeiter(active.emId, over.einteilungId);
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <div className="text-center py-16 text-sm text-muted-foreground">
        Nur für Verwaltung/Admin zugänglich.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Tagesplanung" />

      {/* Control-Bar (print:hidden) */}
      <div className="flex items-center justify-between gap-2 print:hidden flex-wrap">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10"
            onClick={() => setDatum(moveDate(datum, -1))}
            aria-label="Tag zurück"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Input
            type="date"
            value={datum}
            onChange={(e) => setDatum(e.target.value)}
            className="w-40 h-10 text-center font-medium"
          />
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10"
            onClick={() => setDatum(moveDate(datum, 1))}
            aria-label="Tag vor"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
          <Button
            size="sm"
            variant={datum === todayIso() ? "default" : "outline"}
            onClick={() => setDatum(todayIso())}
          >
            Heute
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDatum(moveDate(todayIso(), 1))}
          >
            Morgen
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={uebernehmePlanVomVortag}
            disabled={copyBusy}
          >
            <Copy className="h-4 w-4 mr-1.5" /> Plan vom Vortag
          </Button>
          <Button variant="outline" size="sm" onClick={downloadPdf}>
            <Download className="h-4 w-4 mr-1.5" /> PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={teilePdf}
            className="border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
          >
            <Share2 className="h-4 w-4 mr-1.5" /> WhatsApp
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1.5" /> Drucken
          </Button>
          {freigegeben ? (
            <Button
              size="sm"
              variant="outline"
              className="border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
              onClick={freigeben}
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              Freigegeben · erneut
            </Button>
          ) : (
            <Button size="sm" onClick={freigeben}>
              <Send className="h-4 w-4 mr-1.5" /> Plan freigeben
            </Button>
          )}
        </div>
      </div>

      {/* Tab-Switch zwischen Baustellen-Sicht und Mitarbeiter-Sicht */}
      <div className="flex items-center gap-2 print:hidden">
        <Button
          variant={view === "baustellen" ? "default" : "outline"}
          size="sm"
          onClick={() => setView("baustellen")}
          className="flex-1 sm:flex-none"
        >
          <ClipboardList className="h-4 w-4 mr-1.5" /> Baustellen
        </Button>
        <Button
          variant={view === "mitarbeiter" ? "default" : "outline"}
          size="sm"
          onClick={() => setView("mitarbeiter")}
          className="flex-1 sm:flex-none"
        >
          <Users className="h-4 w-4 mr-1.5" /> Alle Mitarbeiter
        </Button>
      </div>

      {/* Mitarbeiter-Sicht (nur sichtbar wenn view='mitarbeiter') */}
      {view === "mitarbeiter" && (
        <div className="print:hidden">
          <MitarbeiterSicht
            plan={plan ?? null}
            alleBaustellen={allBaustellen}
            partienById={Object.fromEntries((plan?.partien ?? []).map((p) => [p.id, p]))}
            onAssign={assignMaToBaustelle}
            onRemove={removeMaFromAllEinteilungenForToday}
          />
        </div>
      )}

      {/* Word-Layout-Block — mit DndContext für MA-Drag&Drop zwischen Zeilen.
          Auf Bildschirm nur sichtbar wenn view='baustellen', beim Drucken IMMER sichtbar. */}
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div
        className={`bg-white p-6 sm:p-8 border print:border-0 print:p-0 mx-auto ${view === "mitarbeiter" ? "hidden print:block" : ""}`}
        style={{
          fontFamily: '"Times New Roman", Times, serif',
          maxWidth: "210mm",
        }}
      >
        {/* Titel-Box */}
        <div className="border-2 border-black py-2 px-4 text-center mb-6">
          <div
            className="text-2xl font-bold"
            style={{ fontStyle: "italic", textDecoration: "underline" }}
          >
            Arbeitseinteilung Zimmerei
          </div>
        </div>

        {/* Datum */}
        <div className="text-center mb-4">
          <span
            className="text-xl font-bold"
            style={{ textDecoration: "underline" }}
          >
            {fmtHeaderDatum(datum)}
          </span>
        </div>

        {/* Tabelle im Word-Look */}
        <table
          className="w-full"
          style={{
            borderCollapse: "collapse",
            border: "1px solid black",
          }}
        >
          <thead>
            <tr>
              <th style={th()}>
                <span style={{ fontStyle: "italic", textDecoration: "underline" }}>
                  BVH:
                </span>
              </th>
              <th style={{ ...th(), width: "20%" }}>
                <span style={{ fontStyle: "italic", textDecoration: "underline" }}>
                  Fahrz.
                </span>
              </th>
              <th style={{ ...th(), width: "18%" }}>
                <span style={{ fontStyle: "italic", textDecoration: "underline" }}>
                  Tätigkeit
                </span>
              </th>
              <th style={{ ...th(), width: "37%" }}>
                <span style={{ fontStyle: "italic", textDecoration: "underline" }}>
                  Mitarbeiter
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(plan?.einteilungen ?? []).map((e) => (
              <EinteilungsZeile
                key={e.einteilung.id}
                e={e}
                allFahrzeuge={allFahrzeuge}
                alleMa={plan?.alleMa ?? []}
                abwesendIds={abwesendIds}
                eingeteilteIds={eingeteilteIds}
                onTaetigkeit={updateTaetigkeit}
                onFahrzeuge={updateFahrzeuge}
                onAddMa={addMitarbeiter}
                onRemoveMa={removeMitarbeiter}
                onDelete={deleteEinteilung}
              />
            ))}
            {(plan?.einteilungen?.length ?? 0) === 0 && !isLoading && (
              <tr>
                <td
                  colSpan={4}
                  className="py-4 text-center text-muted-foreground"
                  style={td()}
                >
                  Noch keine Einteilungen für diesen Tag.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-3 print:hidden">
          <AddEinteilungDialog
            baustellen={allBaustellen}
            fahrzeuge={allFahrzeuge}
            alleMa={plan?.alleMa ?? []}
            abwesendIds={abwesendIds}
            eingeteilteIds={eingeteilteIds}
            onAdd={addEinteilung}
          />
        </div>

        {/* Sonderfälle */}
        <div className="mt-6">
          <SonderfaelleBlock
            abwesende={plan?.abwesende ?? []}
            notiz={plan?.freigabe?.notiz ?? ""}
            onNotizChange={saveSonstigeHinweise}
          />
        </div>

        {/* Footer mit Freigabe-Info (auch beim Druck sichtbar) */}
        {freigegeben && (
          <div
            className="mt-6 text-xs text-center"
            style={{ fontStyle: "italic" }}
          >
            Plan freigegeben am{" "}
            {new Date(plan!.freigabe!.freigegeben_am).toLocaleString("de-AT", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        )}
      </div>
      <DragOverlay>
        {dragActive ? (
          <div className="bg-primary text-primary-foreground px-2 py-1 rounded shadow-lg text-sm font-medium">
            {dragActive.name}
          </div>
        ) : null}
      </DragOverlay>
      </DndContext>

      {/* Print-Styles */}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          body { background: white !important; }
          .print\\:hidden, header, nav { display: none !important; }
        }
      `}</style>
    </div>
  );
}

// ─── Style-Helper für Tabellen-Zellen ──────────────────────────────────

function th(): React.CSSProperties {
  return {
    border: "1px solid black",
    padding: "6px 8px",
    fontWeight: "bold",
    textAlign: "left",
    background: "white",
  };
}
function td(): React.CSSProperties {
  return {
    border: "1px solid black",
    padding: "8px 10px",
    verticalAlign: "top",
  };
}

// ─── Eine Tabellen-Zeile (eine Einteilung) ────────────────────────────

function EinteilungsZeile({
  e,
  allFahrzeuge,
  alleMa,
  abwesendIds,
  eingeteilteIds,
  onTaetigkeit,
  onFahrzeuge,
  onAddMa,
  onRemoveMa,
  onDelete,
}: {
  e: EinteilungMitDetails;
  allFahrzeuge: Fahrzeug[];
  alleMa: Profile[];
  abwesendIds: Set<string>;
  eingeteilteIds: Set<string>;
  onTaetigkeit: (id: string, val: string) => Promise<void>;
  onFahrzeuge: (id: string, ids: string[]) => Promise<void>;
  onAddMa: (id: string, ids: string[]) => Promise<void>;
  onRemoveMa: (emId: string, einteilungId: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `zeile-${e.einteilung.id}`,
    data: { type: "zeile", einteilungId: e.einteilung.id },
  });
  const [taetEdit, setTaetEdit] = useState(false);
  const [taetVal, setTaetVal] = useState(e.einteilung.taetigkeit ?? "");

  useEffect(() => {
    setTaetVal(e.einteilung.taetigkeit ?? "");
  }, [e.einteilung.taetigkeit]);

  const b = e.baustelle;
  const fzIds = e.fahrzeuge.map((f) => f.id);

  return (
    <tr ref={setDropRef as any} style={isOver ? { background: "rgba(182, 86, 103, 0.08)" } : undefined}>
      {/* BVH */}
      <td style={td()}>
        {b ? (
          <>
            <div
              style={{
                fontWeight: "bold",
                textDecoration: "underline",
                fontSize: "0.95em",
              }}
            >
              {b.bvh_name}
            </div>
            {b.kostenstelle && (
              <div style={{ fontSize: "0.78em", fontStyle: "italic", marginTop: 2 }}>
                {b.kostenstelle}
              </div>
            )}
          </>
        ) : (
          <span className="text-muted-foreground" style={{ fontStyle: "italic" }}>
            (intern)
          </span>
        )}
        <button
          type="button"
          onClick={() => onDelete(e.einteilung.id)}
          className="print:hidden mt-2 text-[10px] text-red-700 hover:underline opacity-60 hover:opacity-100"
          title="Einteilung löschen"
        >
          <Trash2 className="h-3 w-3 inline" /> entfernen
        </button>
      </td>

      {/* Fahrz. */}
      <td style={td()}>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="w-full text-left hover:bg-amber-50 transition-colors print:hover:bg-transparent"
              style={{ fontWeight: "bold", fontSize: "0.95em" }}
            >
              {e.fahrzeuge.length > 0
                ? e.fahrzeuge.map((f) => (
                    <div key={f.id}>{f.kennzeichen}</div>
                  ))
                : (
                  <span
                    className="text-muted-foreground print:hidden"
                    style={{ fontStyle: "italic", fontWeight: "normal" }}
                  >
                    – wählen –
                  </span>
                )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 max-h-80 overflow-y-auto" align="start">
            <FahrzeugPicker
              all={allFahrzeuge}
              selected={fzIds}
              onChange={(ids) => onFahrzeuge(e.einteilung.id, ids)}
            />
          </PopoverContent>
        </Popover>
      </td>

      {/* Tätigkeit */}
      <td style={td()}>
        {taetEdit ? (
          <Textarea
            autoFocus
            value={taetVal}
            onChange={(ev) => setTaetVal(ev.target.value)}
            onBlur={async () => {
              if (taetVal !== (e.einteilung.taetigkeit ?? "")) {
                await onTaetigkeit(e.einteilung.id, taetVal);
              }
              setTaetEdit(false);
            }}
            rows={3}
            className="text-sm font-serif italic"
            style={{ fontFamily: '"Times New Roman", serif' }}
          />
        ) : (
          <div
            onClick={() => setTaetEdit(true)}
            className="cursor-text hover:bg-amber-50 transition-colors print:hover:bg-transparent min-h-[1.5em] whitespace-pre-line"
            style={{ fontStyle: "italic", fontSize: "0.92em" }}
          >
            {e.einteilung.taetigkeit || (
              <span className="text-muted-foreground print:hidden">– klicken –</span>
            )}
          </div>
        )}
      </td>

      {/* Mitarbeiter */}
      <td style={td()}>
        <div className="space-y-0.5">
          {e.mitarbeiter.map((m) =>
            m.profil ? (
              <DraggableMa
                key={m.ma.id}
                emId={m.ma.id}
                einteilungId={e.einteilung.id}
                name={`${m.profil.nachname} ${m.profil.vorname}`}
                gelesen={!!m.ma.gelesen_am}
                onRemove={() => onRemoveMa(m.ma.id, e.einteilung.id)}
              />
            ) : null,
          )}
          <div className="print:hidden">
            <MaPicker
              alleMa={alleMa}
              abwesendIds={abwesendIds}
              eingeteilteIds={eingeteilteIds}
              onAdd={(ids) => onAddMa(e.einteilung.id, ids)}
              trigger={
                <button
                  type="button"
                  className="text-xs text-primary hover:underline mt-1 flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" /> Mitarbeiter
                </button>
              }
            />
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─── Mitarbeiter-zentrierte Sicht ─────────────────────────────────────

function MitarbeiterSicht({
  plan,
  alleBaustellen,
  partienById,
  onAssign,
  onRemove,
}: {
  plan: ReturnType<typeof useTagesplanung>["data"] extends infer T ? T | null : null;
  alleBaustellen: Baustelle[];
  partienById: Record<string, Database["public"]["Tables"]["partien"]["Row"]>;
  onAssign: (maId: string, baustelleId: string) => Promise<void>;
  onRemove: (maId: string) => Promise<void>;
}) {
  if (!plan) return null;

  // Eingeteilte MA: maId -> { ma, einteilung, baustelle }
  type MaZeile = {
    ma: Profile;
    einteilungId: string | null;
    baustelle: Baustelle | null;
  };
  const eingeteilt: MaZeile[] = [];
  const eingeteiltIds = new Set<string>();
  for (const e of plan.einteilungen) {
    for (const m of e.mitarbeiter) {
      if (m.profil && !eingeteiltIds.has(m.profil.id)) {
        eingeteiltIds.add(m.profil.id);
        eingeteilt.push({ ma: m.profil, einteilungId: e.einteilung.id, baustelle: e.baustelle });
      }
    }
  }

  const abwesendIds = new Set(plan.abwesende.map((a) => a.ma.id));
  const nichtEingeteilt: MaZeile[] = plan.alleMa
    .filter((m) => !eingeteiltIds.has(m.id) && !abwesendIds.has(m.id))
    .map((m) => ({ ma: m, einteilungId: null, baustelle: null }));

  // Eingeteilte nach Baustelle gruppieren
  const groupedByBaustelle = new Map<string, { baustelle: Baustelle | null; rows: MaZeile[] }>();
  for (const z of eingeteilt) {
    const key = z.baustelle?.id ?? "ohne-baustelle";
    if (!groupedByBaustelle.has(key))
      groupedByBaustelle.set(key, { baustelle: z.baustelle, rows: [] });
    groupedByBaustelle.get(key)!.rows.push(z);
  }
  const groupList = Array.from(groupedByBaustelle.values()).sort((a, b) =>
    (a.baustelle?.bvh_name ?? "zzz").localeCompare(b.baustelle?.bvh_name ?? "zzz"),
  );

  // Heutige Baustellen (für den Picker — Quick-Aktionen)
  const heutigeBaustellen = plan.einteilungen
    .map((e) => e.baustelle)
    .filter((b): b is Baustelle => !!b);
  const heutigeBaustellenWithCounts = heutigeBaustellen.map((b) => ({
    baustelle: b,
    anzahl: plan.einteilungen.find((e) => e.baustelle?.id === b.id)?.mitarbeiter.length ?? 0,
  }));

  const partieDot = (maId: string) => {
    const ma = plan.alleMa.find((p) => p.id === maId);
    const partie = ma?.partie_id ? partienById[ma.partie_id] : null;
    return (
      <span
        className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
        style={{ background: partie?.farbcode ?? "#cbd5e1" }}
        title={partie?.name ?? "ohne Partie"}
      />
    );
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="font-bold tabular-nums">{eingeteilt.length}</span>
            <span className="text-muted-foreground">eingeteilt</span>
          </div>
          <span className="text-muted-foreground">·</span>
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="font-bold tabular-nums">{nichtEingeteilt.length}</span>
            <span className="text-muted-foreground">nicht eingeteilt</span>
          </div>
          <span className="text-muted-foreground">·</span>
          <div className="flex items-center gap-1.5">
            <HeartPulse className="h-4 w-4 text-red-500" />
            <span className="font-bold tabular-nums">{plan.abwesende.length}</span>
            <span className="text-muted-foreground">abwesend</span>
          </div>
        </CardContent>
      </Card>

      {/* Nicht eingeteilt */}
      {nichtEingeteilt.length > 0 && (
        <Card className="border-amber-300">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
              <AlertTriangle className="h-4 w-4" />
              Nicht eingeteilt heute ({nichtEingeteilt.length})
            </div>
            <div className="divide-y divide-amber-100">
              {nichtEingeteilt.map((z) => (
                <div key={z.ma.id} className="flex items-center gap-2 py-1.5">
                  {partieDot(z.ma.id)}
                  <span className="font-medium text-sm flex-1 min-w-0 truncate">
                    {z.ma.nachname} {z.ma.vorname}
                  </span>
                  <BaustellenPickerPopover
                    label="→ Baustelle wählen"
                    alleBaustellen={alleBaustellen}
                    heutigeBaustellen={heutigeBaustellenWithCounts}
                    onPick={(bsId) => onAssign(z.ma.id, bsId)}
                    onRemove={null}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Eingeteilt (nach Baustelle gruppiert) */}
      {eingeteilt.length > 0 && (
        <Card>
          <CardContent className="p-3 space-y-3">
            <div className="text-sm font-semibold">
              Eingeteilt ({eingeteilt.length})
            </div>
            <div className="space-y-3">
              {groupList.map((g) => (
                <div key={g.baustelle?.id ?? "x"}>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground border-b pb-1 mb-1">
                    <Building2 className="h-3.5 w-3.5" />
                    {g.baustelle?.bvh_name ?? "Ohne Baustelle"}
                    {g.baustelle?.kostenstelle && (
                      <span className="font-normal italic">
                        · {g.baustelle.kostenstelle}
                      </span>
                    )}
                    <span className="font-normal ml-auto">
                      {g.rows.length} MA
                    </span>
                  </div>
                  <div className="divide-y divide-border/60">
                    {g.rows.map((z) => (
                      <div key={z.ma.id} className="flex items-center gap-2 py-1.5">
                        {partieDot(z.ma.id)}
                        <span className="text-sm flex-1 min-w-0 truncate">
                          {z.ma.nachname} {z.ma.vorname}
                        </span>
                        <BaustellenPickerPopover
                          label="ändern"
                          alleBaustellen={alleBaustellen}
                          heutigeBaustellen={heutigeBaustellenWithCounts.filter(
                            (h) => h.baustelle.id !== g.baustelle?.id,
                          )}
                          onPick={(bsId) => onAssign(z.ma.id, bsId)}
                          onRemove={() => onRemove(z.ma.id)}
                          compact
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Abwesend */}
      {plan.abwesende.length > 0 && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="text-sm font-semibold">
              Abwesend ({plan.abwesende.length})
            </div>
            <div className="divide-y">
              {plan.abwesende.map((a) => (
                <div key={a.ma.id} className="flex items-center gap-2 py-1.5 text-sm">
                  {partieDot(a.ma.id)}
                  <span className="flex-1 min-w-0 truncate">
                    {a.ma.nachname} {a.ma.vorname}
                  </span>
                  <span className="text-xs italic text-muted-foreground inline-flex items-center gap-1">
                    {a.status === "urlaub" && <Sun className="h-3.5 w-3.5" />}
                    {a.status === "krank" && <HeartPulse className="h-3.5 w-3.5" />}
                    {a.status === "schlechtwetter" && <CloudRain className="h-3.5 w-3.5" />}
                    {a.status === "urlaub" && "Urlaub"}
                    {a.status === "krank" && "Krank"}
                    {a.status === "schlechtwetter" && "Schlechtwetter"}
                    {a.bis && ` bis ${new Date(a.bis).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" })}`}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Baustellen-Picker Popover für MA-Sicht ───────────────────────────

function BaustellenPickerPopover({
  label,
  alleBaustellen,
  heutigeBaustellen,
  onPick,
  onRemove,
  compact = false,
}: {
  label: string;
  alleBaustellen: Baustelle[];
  heutigeBaustellen: { baustelle: Baustelle; anzahl: number }[];
  onPick: (baustelleId: string) => Promise<void> | void;
  onRemove: (() => Promise<void> | void) | null;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const handlePick = async (bsId: string) => {
    await onPick(bsId);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant={compact ? "ghost" : "outline"}
          className={compact ? "h-7 text-xs" : "h-8 text-xs"}
        >
          {label}
          <ArrowRight className="h-3 w-3 ml-1" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="end">
        <div className="space-y-2">
          {heutigeBaustellen.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-[10px] uppercase text-muted-foreground px-1">
                Heutige Einteilungen
              </div>
              {heutigeBaustellen.map((h) => (
                <button
                  key={h.baustelle.id}
                  type="button"
                  onClick={() => handlePick(h.baustelle.id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-sm text-left"
                >
                  <Plus className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="flex-1 truncate">{h.baustelle.bvh_name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {h.anzahl} MA
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase text-muted-foreground px-1">
              Alle Baustellen
            </div>
            <div className="max-h-48 overflow-y-auto">
              {alleBaustellen
                .filter((b) => !heutigeBaustellen.some((h) => h.baustelle.id === b.id))
                .map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => handlePick(b.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-sm text-left"
                  >
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate">{b.bvh_name}</span>
                    {b.kostenstelle && (
                      <span className="text-[10px] italic text-muted-foreground">
                        {b.kostenstelle}
                      </span>
                    )}
                  </button>
                ))}
            </div>
          </div>
          {onRemove && (
            <div className="border-t pt-2">
              <button
                type="button"
                onClick={async () => {
                  await onRemove();
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-red-50 text-sm text-left text-red-700"
              >
                <X className="h-3.5 w-3.5 shrink-0" />
                Aus Einteilung entfernen
              </button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Draggable MA-Karte ───────────────────────────────────────────────

function DraggableMa({
  emId,
  einteilungId,
  name,
  gelesen,
  onRemove,
}: {
  emId: string;
  einteilungId: string;
  name: string;
  gelesen: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `ma-${emId}`,
    data: { type: "ma", emId, einteilungId, name },
  });

  return (
    <div
      ref={setNodeRef}
      className="flex items-center justify-between group"
      style={{
        fontSize: "0.95em",
        opacity: isDragging ? 0.3 : 1,
        cursor: "grab",
        touchAction: "none",
      }}
      {...attributes}
      {...listeners}
    >
      <span style={{ fontWeight: 500 }}>
        {name}
        {gelesen && (
          <span
            className="ml-1.5 inline-flex items-center text-emerald-700"
            title="Plan vom Mitarbeiter zur Kenntnis genommen"
          >
            <CheckCircle2 className="h-3 w-3" />
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={(ev) => {
          ev.stopPropagation();
          onRemove();
        }}
        onPointerDown={(ev) => ev.stopPropagation()}
        className="print:hidden opacity-0 group-hover:opacity-100 text-red-700 hover:bg-red-50 rounded p-0.5 transition"
        title="Entfernen"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─── Fahrzeug-Multi-Picker ────────────────────────────────────────────

function FahrzeugPicker({
  all,
  selected,
  onChange,
}: {
  all: Fahrzeug[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set(selected));
  useEffect(() => setSel(new Set(selected)), [selected.join(",")]); // eslint-disable-line

  const toggle = (id: string) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSel(next);
  };

  const apply = () => onChange(Array.from(sel));

  const byKat = useMemo(() => {
    const out = new Map<string, Fahrzeug[]>();
    for (const f of all) {
      const k = f.kategorie ?? "sonstige";
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push(f);
    }
    return Array.from(out.entries());
  }, [all]);

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase text-muted-foreground">
        Fahrzeuge auswählen
      </div>
      {byKat.map(([kat, list]) => (
        <div key={kat}>
          <div className="text-[10px] text-muted-foreground mb-0.5">{kat}</div>
          <div className="space-y-0.5">
            {list.map((f) => (
              <label
                key={f.id}
                className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5"
              >
                <input
                  type="checkbox"
                  checked={sel.has(f.id)}
                  onChange={() => toggle(f.id)}
                />
                <span className="font-medium">{f.kennzeichen}</span>
                {f.bezeichnung && (
                  <span className="text-xs text-muted-foreground truncate">
                    {f.bezeichnung}
                  </span>
                )}
              </label>
            ))}
          </div>
        </div>
      ))}
      <Button size="sm" onClick={apply} className="w-full">
        Übernehmen
      </Button>
    </div>
  );
}

// ─── MA-Picker als Dialog ──────────────────────────────────────────────

function MaPicker({
  alleMa,
  abwesendIds,
  eingeteilteIds,
  onAdd,
  trigger,
}: {
  alleMa: Profile[];
  abwesendIds: Set<string>;
  eingeteilteIds: Set<string>;
  onAdd: (ids: string[]) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return alleMa
      .filter((m) => !abwesendIds.has(m.id) && !eingeteilteIds.has(m.id))
      .filter(
        (m) =>
          !s ||
          `${m.vorname} ${m.nachname}`.toLowerCase().includes(s) ||
          `${m.nachname} ${m.vorname}`.toLowerCase().includes(s),
      );
  }, [alleMa, abwesendIds, eingeteilteIds, search]);

  const apply = () => {
    if (sel.size === 0) {
      setOpen(false);
      return;
    }
    onAdd(Array.from(sel));
    setSel(new Set());
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mitarbeiter hinzufügen</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          placeholder="Suchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10"
        />
        <div className="max-h-72 overflow-y-auto space-y-0.5">
          {visible.map((m) => (
            <label
              key={m.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer text-sm"
            >
              <input
                type="checkbox"
                checked={sel.has(m.id)}
                onChange={() => {
                  const next = new Set(sel);
                  if (next.has(m.id)) next.delete(m.id);
                  else next.add(m.id);
                  setSel(next);
                }}
              />
              <span className="font-medium">
                {m.nachname} {m.vorname}
              </span>
            </label>
          ))}
          {visible.length === 0 && (
            <div className="text-center py-4 text-sm text-muted-foreground">
              Keine freien Mitarbeiter
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Abbrechen
          </Button>
          <Button onClick={apply} disabled={sel.size === 0}>
            {sel.size > 0 ? `${sel.size} hinzufügen` : "Hinzufügen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dialog „Einteilung hinzufügen" ──────────────────────────────────

function AddEinteilungDialog({
  baustellen,
  fahrzeuge,
  alleMa,
  abwesendIds,
  eingeteilteIds,
  onAdd,
}: {
  baustellen: Baustelle[];
  fahrzeuge: Fahrzeug[];
  alleMa: Profile[];
  abwesendIds: Set<string>;
  eingeteilteIds: Set<string>;
  onAdd: (input: {
    baustelle_id: string;
    taetigkeit: string;
    mitarbeiterIds: string[];
    fahrzeugIds: string[];
  }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [bsId, setBsId] = useState<string>("");
  const [taet, setTaet] = useState("");
  const [maIds, setMaIds] = useState<Set<string>>(new Set());
  const [fzIds, setFzIds] = useState<Set<string>>(new Set());

  const reset = () => {
    setBsId("");
    setTaet("");
    setMaIds(new Set());
    setFzIds(new Set());
  };

  const submit = async () => {
    if (!bsId) return;
    await onAdd({
      baustelle_id: bsId,
      taetigkeit: taet,
      mitarbeiterIds: Array.from(maIds),
      fahrzeugIds: Array.from(fzIds),
    });
    reset();
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="h-4 w-4 mr-1.5" /> Einteilung hinzufügen
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Neue Einteilung</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-sm">Baustelle</Label>
            <BaustelleCombobox
              baustellen={baustellen}
              value={bsId}
              onChange={(v) => setBsId(v ?? "")}
              allowClear
            />
          </div>
          <div>
            <Label className="text-sm">Tätigkeit</Label>
            <Textarea
              value={taet}
              onChange={(e) => setTaet(e.target.value)}
              rows={2}
              placeholder="z.B. Montage, Produktion, Service…"
            />
          </div>
          <div>
            <Label className="text-sm">Fahrzeuge</Label>
            <div className="max-h-32 overflow-y-auto border rounded p-2 text-sm">
              {fahrzeuge.map((f) => (
                <label
                  key={f.id}
                  className="flex items-center gap-2 hover:bg-muted/50 rounded px-1 py-0.5 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={fzIds.has(f.id)}
                    onChange={() => {
                      const next = new Set(fzIds);
                      if (next.has(f.id)) next.delete(f.id);
                      else next.add(f.id);
                      setFzIds(next);
                    }}
                  />
                  <span className="font-medium">{f.kennzeichen}</span>
                  {f.bezeichnung && (
                    <span className="text-xs text-muted-foreground">
                      {f.bezeichnung}
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-sm">Mitarbeiter</Label>
            <div className="max-h-44 overflow-y-auto border rounded p-2 text-sm space-y-0.5">
              {alleMa
                .filter((m) => !abwesendIds.has(m.id) && !eingeteilteIds.has(m.id))
                .map((m) => (
                  <label
                    key={m.id}
                    className="flex items-center gap-2 hover:bg-muted/50 rounded px-1 py-0.5 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={maIds.has(m.id)}
                      onChange={() => {
                        const next = new Set(maIds);
                        if (next.has(m.id)) next.delete(m.id);
                        else next.add(m.id);
                        setMaIds(next);
                      }}
                    />
                    <span>
                      {m.nachname} {m.vorname}
                    </span>
                  </label>
                ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Abbrechen
          </Button>
          <Button onClick={submit} disabled={!bsId}>
            Einteilung anlegen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sonderfälle-Block ────────────────────────────────────────────────

function SonderfaelleBlock({
  abwesende,
  notiz,
  onNotizChange,
}: {
  abwesende: { ma: Profile; status: string; seit?: string; bis?: string }[];
  notiz: string;
  onNotizChange: (val: string) => void;
}) {
  const urlaub = abwesende.filter((a) => a.status === "urlaub");
  const krank = abwesende.filter((a) => a.status === "krank");
  const sw = abwesende.filter((a) => a.status === "schlechtwetter");

  const [notizVal, setNotizVal] = useState(notiz);
  const [notizTimer, setNotizTimer] = useState<any>(null);

  useEffect(() => {
    setNotizVal(notiz);
  }, [notiz]);

  const handleChange = (v: string) => {
    setNotizVal(v);
    if (notizTimer) clearTimeout(notizTimer);
    setNotizTimer(setTimeout(() => onNotizChange(v), 600));
  };

  const renderListe = (
    list: typeof abwesende,
  ): React.ReactNode => {
    if (list.length === 0) return <span style={{ fontStyle: "italic" }}>—</span>;
    return list
      .map((a) => {
        const name = `${a.ma.nachname} ${a.ma.vorname}`;
        const suffix = a.seit && a.bis
          ? ` (${formatRange(a.seit, a.bis)})`
          : a.seit
          ? ` (seit ${shortDate(a.seit)})`
          : "";
        return `${name}${suffix}`;
      })
      .join(" · ");
  };

  return (
    <div
      style={{
        border: "1px solid black",
        padding: "10px 12px",
        fontSize: "0.92em",
      }}
    >
      <div
        style={{
          fontWeight: "bold",
          textDecoration: "underline",
          marginBottom: 8,
          fontStyle: "italic",
        }}
      >
        Sonderfälle:
      </div>
      <div className="space-y-1.5">
        <div className="flex gap-2">
          <span style={{ fontWeight: "bold", minWidth: 110 }}>Urlaub / ZA:</span>
          <span>{renderListe(urlaub)}</span>
        </div>
        <div className="flex gap-2">
          <span style={{ fontWeight: "bold", minWidth: 110 }}>Krank:</span>
          <span>{renderListe(krank)}</span>
        </div>
        <div className="flex gap-2">
          <span style={{ fontWeight: "bold", minWidth: 110 }}>Schlechtwetter:</span>
          <span>{renderListe(sw)}</span>
        </div>
        <div className="pt-2 border-t border-black/20 mt-2">
          <div
            style={{ fontWeight: "bold", marginBottom: 4 }}
          >
            Sonstige Hinweise:
          </div>
          <Textarea
            value={notizVal}
            onChange={(e) => handleChange(e.target.value)}
            rows={3}
            placeholder="z.B. Polierschule, Berufsschule, Bundesheer, Stempeln …"
            className="text-sm print:border-0 print:p-0"
            style={{
              fontFamily: '"Times New Roman", serif',
              background: "transparent",
            }}
          />
        </div>
      </div>
    </div>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}
function formatRange(von: string, bis: string): string {
  return `${shortDate(von)} – ${shortDate(bis)}`;
}
