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
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";
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
  const [datum, setDatum] = useState<string>(todayIso());
  const { data: plan, isLoading } = useTagesplanung(datum);

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

  async function setManuellFlag(einteilungId: string) {
    await supabase
      .from("einteilungen")
      .update({ manuell_geaendert: true })
      .eq("id", einteilungId);
  }

  async function updateTaetigkeit(einteilungId: string, val: string) {
    await supabase
      .from("einteilungen")
      .update({ taetigkeit: val || null, manuell_geaendert: true })
      .eq("id", einteilungId);
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
    await setManuellFlag(einteilungId);
  }

  async function addMitarbeiter(einteilungId: string, maIds: string[]) {
    if (maIds.length === 0) return;
    await supabase.from("einteilung_mitarbeiter").insert(
      maIds.map((mid) => ({
        einteilung_id: einteilungId,
        mitarbeiter_id: mid,
        manuell_geaendert: true,
      })),
    );
    await setManuellFlag(einteilungId);
  }

  async function removeMitarbeiter(emId: string, einteilungId: string) {
    await supabase.from("einteilung_mitarbeiter").delete().eq("id", emId);
    await setManuellFlag(einteilungId);
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
        manuell_geaendert: true,
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (error || !e) {
      toast({ variant: "destructive", title: "Fehler", description: error?.message });
      return;
    }
    if (input.mitarbeiterIds.length > 0) {
      await supabase.from("einteilung_mitarbeiter").insert(
        input.mitarbeiterIds.map((mid) => ({
          einteilung_id: e.id,
          mitarbeiter_id: mid,
          manuell_geaendert: true,
        })),
      );
    }
    if (input.fahrzeugIds.length > 0) {
      await supabase.from("einteilung_fahrzeuge").insert(
        input.fahrzeugIds.map((fid) => ({
          einteilung_id: e.id,
          fahrzeug_id: fid,
        })),
      );
    }
  }

  async function deleteEinteilung(einteilungId: string) {
    if (!window.confirm("Diese Einteilung wirklich entfernen?")) return;
    await supabase.from("einteilungen").delete().eq("id", einteilungId);
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
  }

  const freigegeben = !!plan?.freigabe;

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

      {/* Word-Layout-Block */}
      <div
        className="bg-white p-6 sm:p-8 border print:border-0 print:p-0 mx-auto"
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
  const [taetEdit, setTaetEdit] = useState(false);
  const [taetVal, setTaetVal] = useState(e.einteilung.taetigkeit ?? "");

  useEffect(() => {
    setTaetVal(e.einteilung.taetigkeit ?? "");
  }, [e.einteilung.taetigkeit]);

  const b = e.baustelle;
  const fzIds = e.fahrzeuge.map((f) => f.id);

  return (
    <tr>
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
              <div
                key={m.ma.id}
                className="flex items-center justify-between group"
                style={{ fontSize: "0.95em" }}
              >
                <span style={{ fontWeight: 500 }}>
                  {m.profil.nachname} {m.profil.vorname}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveMa(m.ma.id, e.einteilung.id)}
                  className="print:hidden opacity-0 group-hover:opacity-100 text-red-700 hover:bg-red-50 rounded p-0.5 transition"
                  title="Entfernen"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
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
