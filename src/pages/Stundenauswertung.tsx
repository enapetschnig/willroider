import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { TimePickerInput } from "@/components/TimePickerInput";
import {
  ChevronDown,
  ChevronUp,
  Download,
  ChevronLeft,
  ChevronRight,
  Factory,
  MapPin,
  Building2,
  Edit,
  Users,
  Trash2,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Stunde = Database["public"]["Tables"]["stundenbuchungen"]["Row"];
type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];

type Mode = "self" | "polier" | "admin";

const initials = (p: { vorname: string; nachname: string }) =>
  `${p.vorname[0] ?? ""}${p.nachname[0] ?? ""}`.toUpperCase();
const fmtTime = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

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
function snap15(t: string): string {
  if (!t) return t;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return t;
  const total = h * 60 + m;
  const rounded = Math.round(total / 15) * 15;
  const clamped = Math.max(0, Math.min(23 * 60 + 45, rounded));
  return minToTime(clamped);
}
function calcArbeit(s?: string | null, e?: string | null, pv?: string | null, pb?: string | null) {
  if (!s || !e) return 0;
  const sm = timeToMin(s);
  const em = timeToMin(e);
  if (em <= sm) return 0;
  let total = em - sm;
  if (pv && pb) {
    const pvm = timeToMin(pv);
    const pbm = timeToMin(pb);
    if (pbm > pvm) total -= Math.max(0, Math.min(em, pbm) - Math.max(sm, pvm));
  }
  return Math.max(0, total) / 60;
}

export default function Stundenauswertung() {
  const { user, profile, isAdmin } = useAuth();
  const [polierPartie, setPolierPartie] = useState<Partie | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const [partien, setPartien] = useState<Partie[]>([]);
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [rows, setRows] = useState<Stunde[]>([]);
  const [monat, setMonat] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [selectedPersons, setSelectedPersons] = useState<Set<string>>(new Set()); // empty = alle
  const [selectedBaustellen, setSelectedBaustellen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Stunde | null>(null);

  const mode: Mode = isAdmin ? "admin" : polierPartie ? "polier" : "self";

  // ─── Modus + Mitglieder laden ───
  useEffect(() => {
    if (!user) return;
    (async () => {
      if (isAdmin) {
        const [{ data: ms }, { data: ps }, { data: bs }] = await Promise.all([
          supabase.from("profiles").select("*").eq("is_active", true).order("nachname"),
          supabase.from("partien").select("*").order("name"),
          supabase.from("baustellen").select("*").order("bvh_name"),
        ]);
        setMembers((ms as Profile[]) ?? []);
        setPartien((ps as Partie[]) ?? []);
        setBaustellen((bs as Baustelle[]) ?? []);
        setPolierPartie(null);
        return;
      }
      const { data: p } = await supabase
        .from("partien")
        .select("*")
        .eq("partieleiter_id", user.id)
        .maybeSingle();
      const [{ data: bs }] = await Promise.all([
        supabase.from("baustellen").select("*").order("bvh_name"),
      ]);
      setBaustellen((bs as Baustelle[]) ?? []);
      if (p) {
        setPolierPartie(p as Partie);
        setPartien([p as Partie]);
        const { data: ms } = await supabase
          .from("profiles")
          .select("*")
          .eq("partie_id", p.id)
          .eq("is_active", true)
          .order("nachname");
        setMembers((ms as Profile[]) ?? []);
      } else {
        setPolierPartie(null);
        setMembers([]);
      }
    })();
  }, [user, isAdmin]);

  // ─── Buchungen laden ───
  const reload = () => {
    if (!user) return;
    const monthStart = `${monat}-01`;
    const next = new Date(monthStart);
    next.setMonth(next.getMonth() + 1);
    const monthEnd = next.toISOString().slice(0, 10);

    let q = supabase
      .from("stundenbuchungen")
      .select("*")
      .gte("datum", monthStart)
      .lt("datum", monthEnd)
      .order("datum", { ascending: false });
    if (mode === "admin") {
      // alle
    } else if (mode === "polier" && members.length > 0) {
      const ids = [user.id, ...members.map((m) => m.id)];
      q = q.in("mitarbeiter_id", Array.from(new Set(ids)));
    } else {
      q = q.eq("mitarbeiter_id", user.id);
    }
    q.then(({ data }) => setRows((data as Stunde[]) ?? []));
  };
  useEffect(reload, [user, monat, mode, members]);

  const allPersons = useMemo(() => {
    const map = new Map<string, Profile>();
    members.forEach((m) => map.set(m.id, m));
    if (profile && user) {
      map.set(user.id, { ...(profile as any), id: user.id });
    }
    return map;
  }, [members, profile, user]);

  const moveMonth = (d: number) => {
    const date = new Date(monat + "-01");
    date.setMonth(date.getMonth() + d);
    setMonat(date.toISOString().slice(0, 7));
  };

  // ─── Gefilterte Rows je nach Tab ───
  const filteredByPerson = useMemo(() => {
    if (selectedPersons.size === 0) return rows;
    return rows.filter((r) => selectedPersons.has(r.mitarbeiter_id));
  }, [rows, selectedPersons]);

  const filteredByBaustelle = useMemo(() => {
    if (selectedBaustellen.size === 0) return rows;
    return rows.filter((r) => r.baustelle_id && selectedBaustellen.has(r.baustelle_id));
  }, [rows, selectedBaustellen]);

  const togglePerson = (id: string) =>
    setSelectedPersons((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleBaustelle = (id: string) =>
    setSelectedBaustellen((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const exportCsv = (kind: "person" | "baustelle") => {
    const data = kind === "person" ? filteredByPerson : filteredByBaustelle;
    if (data.length === 0) return;
    const header = [
      "Datum",
      "Mitarbeiter",
      "PersNr",
      "Partie",
      "Arbeitsort",
      "Baustelle",
      "Kostenstelle",
      "Start",
      "Ende",
      "Pause von",
      "Pause bis",
      "Arbeitsstunden",
      "Fahrstunden",
      "TG_kurz",
      "TG_lang",
      "KM",
      "Fehlzeit",
      "Fz_Stunden",
      "Tätigkeit",
      "Status",
    ];
    const lines = [header.join(";")];
    data.forEach((r) => {
      const p = allPersons.get(r.mitarbeiter_id);
      const partie = p?.partie_id ? partien.find((x) => x.id === p.partie_id) : null;
      const b = baustellen.find((x) => x.id === r.baustelle_id);
      lines.push(
        [
          r.datum,
          p ? `${p.nachname} ${p.vorname}` : r.mitarbeiter_id,
          p?.pers_nr ?? "",
          partie?.name ?? "",
          r.fehlzeit_typ ? "" : r.in_firma ? "Firma" : "Baustelle",
          b?.bvh_name ?? "",
          b?.kostenstelle ?? "",
          fmtTime(r.start_zeit),
          fmtTime(r.end_zeit),
          fmtTime(r.pause_von),
          fmtTime(r.pause_bis),
          (r.arbeitsstunden ?? 0).toString().replace(".", ","),
          (r.fahrstunden ?? 0).toString().replace(".", ","),
          r.taggeld_kurz ?? 0,
          r.taggeld_lang ?? 0,
          r.km_gefahren ?? 0,
          r.fehlzeit_typ ?? "",
          (r.fehlzeit_stunden ?? 0).toString().replace(".", ","),
          (r.taetigkeit ?? "").replace(/[;\n]/g, " "),
          r.status,
        ].join(";")
      );
    });
    const csv = "﻿" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auswertung_${kind}_${monat}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Welche Personen sind im aktuellen Monat überhaupt vorhanden (für Filter-Chips)
  const personIdsInMonth = useMemo(() => {
    const ids = new Set(rows.map((r) => r.mitarbeiter_id));
    return Array.from(ids);
  }, [rows]);

  const baustelleIdsInMonth = useMemo(() => {
    const ids = new Set(rows.filter((r) => r.baustelle_id).map((r) => r.baustelle_id as string));
    return Array.from(ids);
  }, [rows]);

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <PageHeader
        title="Stunden-Auswertung"
        description={
          mode === "admin"
            ? "Monatsstunden aller aktiven Mitarbeiter"
            : mode === "polier"
            ? `Monatsstunden deiner Partie · ${polierPartie?.name}`
            : "Deine Monatsstunden"
        }
      />

      {/* Monats-Switcher */}
      <Card>
        <CardContent className="p-3 flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0"
            onClick={() => moveMonth(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="month"
            value={monat}
            onChange={(e) => setMonat(e.target.value)}
            className="h-10 text-center font-medium"
          />
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0"
            onClick={() => moveMonth(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0 ml-1">
            {rows.length} Buchungen
          </span>
        </CardContent>
      </Card>

      <Tabs defaultValue="person">
        <TabsList className="grid grid-cols-2 w-full">
          <TabsTrigger value="person" className="gap-1.5">
            <Users className="h-4 w-4" />
            Mitarbeiter
          </TabsTrigger>
          <TabsTrigger value="baustelle" className="gap-1.5">
            <Building2 className="h-4 w-4" />
            Baustellen
          </TabsTrigger>
        </TabsList>

        {/* ────────── MITARBEITER-TAB ────────── */}
        <TabsContent value="person" className="space-y-3 mt-3">
          {personIdsInMonth.length > 1 && (
            <FilterChips
              title="Mitarbeiter"
              all={personIdsInMonth.map((id) => {
                const p = allPersons.get(id);
                return {
                  id,
                  label: p ? `${p.vorname} ${p.nachname[0] ?? ""}.` : id.slice(0, 6),
                  full: p ? `${p.vorname} ${p.nachname}` : id,
                  color: partien.find((pa) => pa.id === p?.partie_id)?.farbcode ?? "#888",
                };
              })}
              selected={selectedPersons}
              onToggle={togglePerson}
              onClear={() => setSelectedPersons(new Set())}
            />
          )}

          <div className="flex justify-end">
            {filteredByPerson.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => exportCsv("person")}>
                <Download className="h-4 w-4 mr-2" />
                CSV ({filteredByPerson.length})
              </Button>
            )}
          </div>

          <PersonenAuswertung
            rows={filteredByPerson}
            baustellen={baustellen}
            members={members}
            partien={partien}
            ownUserId={user!.id}
            ownProfile={profile as any}
            mode={mode}
            isAdmin={isAdmin}
            onEdit={(r) => setEditing(r)}
            onDelete={async (r) => {
              if (!confirm("Buchung löschen?")) return;
              await supabase.from("stundenbuchungen").delete().eq("id", r.id);
              reload();
            }}
          />
        </TabsContent>

        {/* ────────── BAUSTELLEN-TAB ────────── */}
        <TabsContent value="baustelle" className="space-y-3 mt-3">
          {baustelleIdsInMonth.length > 1 && (
            <FilterChips
              title="Baustellen"
              all={baustelleIdsInMonth.map((id) => {
                const b = baustellen.find((x) => x.id === id);
                return {
                  id,
                  label: b?.bvh_name ?? id.slice(0, 6),
                  full: b ? `${b.bvh_name}${b.kostenstelle ? ` · ${b.kostenstelle}` : ""}` : id,
                  color: "#dc2626",
                };
              })}
              selected={selectedBaustellen}
              onToggle={toggleBaustelle}
              onClear={() => setSelectedBaustellen(new Set())}
            />
          )}

          <div className="flex justify-end">
            {filteredByBaustelle.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => exportCsv("baustelle")}>
                <Download className="h-4 w-4 mr-2" />
                CSV ({filteredByBaustelle.length})
              </Button>
            )}
          </div>

          <BaustellenAuswertung
            rows={filteredByBaustelle}
            baustellen={baustellen}
            persons={allPersons}
            partien={partien}
            isAdmin={isAdmin}
            onEdit={(r) => setEditing(r)}
            onDelete={async (r) => {
              if (!confirm("Buchung löschen?")) return;
              await supabase.from("stundenbuchungen").delete().eq("id", r.id);
              reload();
            }}
          />
        </TabsContent>
      </Tabs>

      {/* Edit-Dialog (Admin) */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Buchung bearbeiten</DialogTitle>
          </DialogHeader>
          {editing && (
            <EditBuchungForm
              row={editing}
              baustellen={baustellen}
              person={allPersons.get(editing.mitarbeiter_id)}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                reload();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Filter-Chips: durchsuchbare Multi-Select-Pills ───
function FilterChips({
  title,
  all,
  selected,
  onToggle,
  onClear,
}: {
  title: string;
  all: { id: string; label: string; full: string; color: string }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            {title} filtern{" "}
            <span className="font-normal opacity-70">
              {selected.size === 0 ? "(alle)" : `(${selected.size}/${all.length})`}
            </span>
          </Label>
          {selected.size > 0 && (
            <button
              onClick={onClear}
              className="text-[11px] text-primary hover:underline"
            >
              Alle anzeigen
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {all
            .sort((a, b) => a.full.localeCompare(b.full))
            .map((it) => {
              const active = selected.has(it.id);
              return (
                <button
                  key={it.id}
                  onClick={() => onToggle(it.id)}
                  title={it.full}
                  className={`px-2.5 py-1 rounded-full text-xs border transition flex items-center gap-1.5 ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background hover:bg-muted"
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: it.color }}
                  />
                  <span className="truncate max-w-[140px]">{it.label}</span>
                </button>
              );
            })}
        </div>
      </CardContent>
    </Card>
  );
}

// ════════════════════════════ MITARBEITER-AUSWERTUNG ════════════════════════════
function PersonenAuswertung({
  rows,
  baustellen,
  members,
  partien,
  ownUserId,
  ownProfile,
  mode,
  isAdmin,
  onEdit,
  onDelete,
}: {
  rows: Stunde[];
  baustellen: Baustelle[];
  members: Profile[];
  partien: Partie[];
  ownUserId: string;
  ownProfile: Profile | null;
  mode: Mode;
  isAdmin: boolean;
  onEdit: (r: Stunde) => void;
  onDelete: (r: Stunde) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const allPersons = useMemo(() => {
    const map = new Map<string, Profile>();
    members.forEach((m) => map.set(m.id, m));
    if (ownProfile) map.set(ownUserId, { ...(ownProfile as any), id: ownUserId });
    return map;
  }, [members, ownProfile, ownUserId]);

  const grouped = useMemo(() => {
    const byPerson = new Map<
      string,
      {
        person: Profile;
        baustelle: number;
        firma: number;
        fahrt: number;
        fehl: number;
        taggeldKurz: number;
        taggeldLang: number;
        km: number;
        rows: Stunde[];
      }
    >();
    rows.forEach((r) => {
      const p = allPersons.get(r.mitarbeiter_id);
      if (!p) return;
      const cur = byPerson.get(r.mitarbeiter_id) ?? {
        person: p,
        baustelle: 0,
        firma: 0,
        fahrt: 0,
        fehl: 0,
        taggeldKurz: 0,
        taggeldLang: 0,
        km: 0,
        rows: [],
      };
      const a = Number(r.arbeitsstunden ?? 0);
      if (r.in_firma) cur.firma += a;
      else cur.baustelle += a;
      cur.fahrt += Number(r.fahrstunden ?? 0);
      cur.fehl += Number(r.fehlzeit_stunden ?? 0);
      cur.taggeldKurz += Number(r.taggeld_kurz ?? 0);
      cur.taggeldLang += Number(r.taggeld_lang ?? 0);
      cur.km += Number(r.km_gefahren ?? 0);
      cur.rows.push(r);
      byPerson.set(r.mitarbeiter_id, cur);
    });
    return [...byPerson.values()].sort((a, b) =>
      a.person.nachname.localeCompare(b.person.nachname)
    );
  }, [rows, allPersons]);

  if (grouped.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Keine Buchungen gefunden.
        </CardContent>
      </Card>
    );
  }

  const total = grouped.reduce(
    (s, g) => ({
      baustelle: s.baustelle + g.baustelle,
      firma: s.firma + g.firma,
      fahrt: s.fahrt + g.fahrt,
      fehl: s.fehl + g.fehl,
    }),
    { baustelle: 0, firma: 0, fahrt: 0, fehl: 0 }
  );

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  return (
    <div className="space-y-2">
      {(mode === "admin" || mode === "polier") && grouped.length > 1 && (
        <Card>
          <CardContent className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
            <SumCell value={total.baustelle} label="Baustelle" icon={<MapPin className="h-3 w-3" />} highlight />
            <SumCell value={total.firma} label="Firma" icon={<Factory className="h-3 w-3" />} />
            <SumCell value={total.fahrt} label="Fahrt" />
            <SumCell value={total.fehl} label="Fehlzeit" />
          </CardContent>
        </Card>
      )}

      {grouped.map((g) => {
        const isOpen = expanded.has(g.person.id);
        const partie = partien.find((p) => p.id === g.person.partie_id);
        const arbeit = g.baustelle + g.firma;
        const sigma = arbeit + g.fahrt + g.fehl;
        return (
          <Card key={g.person.id}>
            <button
              onClick={() => toggle(g.person.id)}
              className="w-full p-3 flex items-center gap-3 text-left hover:bg-muted/40 transition"
            >
              <div
                className="h-10 w-10 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                style={{ background: partie?.farbcode ?? "#999" }}
              >
                {initials(g.person)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">
                  {g.person.vorname} {g.person.nachname}
                  {g.person.id === ownUserId && (
                    <Badge variant="outline" className="ml-1.5 text-[9px]">
                      Ich
                    </Badge>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {[g.person.pers_nr, partie?.name].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-xs shrink-0 mr-1">
                <CompactCell value={g.baustelle} label="BVH" />
                <CompactCell value={g.firma} label="Firma" />
                <CompactCell value={g.fehl} label="Fehlz." />
                <CompactCell value={sigma} label="Σ" highlight />
              </div>
              {isOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
            </button>
            {isOpen && (
              <div className="border-t bg-muted/20">
                {/* Extras-Zeile */}
                {(g.taggeldKurz > 0 || g.taggeldLang > 0 || g.km > 0 || g.fahrt > 0) && (
                  <div className="px-3 py-2 border-b text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                    {g.fahrt > 0 && (
                      <span>
                        Fahrt <strong>{g.fahrt.toFixed(1)} h</strong>
                      </span>
                    )}
                    {g.taggeldKurz > 0 && (
                      <span>
                        TG kurz <strong>{g.taggeldKurz.toFixed(0)}</strong>
                      </span>
                    )}
                    {g.taggeldLang > 0 && (
                      <span>
                        TG lang <strong>{g.taggeldLang.toFixed(0)}</strong>
                      </span>
                    )}
                    {g.km > 0 && (
                      <span>
                        KM <strong>{g.km.toFixed(0)}</strong>
                      </span>
                    )}
                  </div>
                )}
                {g.rows.map((r) => {
                  const b = baustellen.find((x) => x.id === r.baustelle_id);
                  return (
                    <BuchungRow
                      key={r.id}
                      r={r}
                      baustelle={b}
                      isAdmin={isAdmin}
                      onEdit={() => onEdit(r)}
                      onDelete={() => onDelete(r)}
                    />
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ════════════════════════════ BAUSTELLEN-AUSWERTUNG ════════════════════════════
function BaustellenAuswertung({
  rows,
  baustellen,
  persons,
  partien,
  isAdmin,
  onEdit,
  onDelete,
}: {
  rows: Stunde[];
  baustellen: Baustelle[];
  persons: Map<string, Profile>;
  partien: Partie[];
  isAdmin: boolean;
  onEdit: (r: Stunde) => void;
  onDelete: (r: Stunde) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const byBaustelle = new Map<
      string,
      {
        baustelle: Baustelle | null; // null = "ohne Baustelle"
        baustelleStd: number; // Stunden auf der Baustelle (in_firma=false)
        firmaStd: number; // Stunden in Firma, aber Bezug auf diese BVH
        fahrt: number;
        rows: Stunde[];
        perPerson: Map<string, { person: Profile; baustelle: number; firma: number }>;
      }
    >();
    rows
      .filter((r) => !r.fehlzeit_typ) // Fehlzeiten sind keiner BVH zugeordnet
      .forEach((r) => {
        const key = r.baustelle_id ?? "__none__";
        const cur =
          byBaustelle.get(key) ??
          {
            baustelle: r.baustelle_id ? baustellen.find((b) => b.id === r.baustelle_id) ?? null : null,
            baustelleStd: 0,
            firmaStd: 0,
            fahrt: 0,
            rows: [],
            perPerson: new Map<
              string,
              { person: Profile; baustelle: number; firma: number }
            >(),
          };
        const a = Number(r.arbeitsstunden ?? 0);
        if (r.in_firma) cur.firmaStd += a;
        else cur.baustelleStd += a;
        cur.fahrt += Number(r.fahrstunden ?? 0);
        cur.rows.push(r);

        const p = persons.get(r.mitarbeiter_id);
        if (p) {
          const pp = cur.perPerson.get(r.mitarbeiter_id) ?? {
            person: p,
            baustelle: 0,
            firma: 0,
          };
          if (r.in_firma) pp.firma += a;
          else pp.baustelle += a;
          cur.perPerson.set(r.mitarbeiter_id, pp);
        }

        byBaustelle.set(key, cur);
      });
    return [...byBaustelle.values()].sort(
      (a, b) =>
        b.baustelleStd + b.firmaStd - (a.baustelleStd + a.firmaStd)
    );
  }, [rows, baustellen, persons]);

  if (grouped.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Keine Baustellen-Buchungen gefunden.
        </CardContent>
      </Card>
    );
  }

  const total = grouped.reduce(
    (s, g) => ({
      baustelle: s.baustelle + g.baustelleStd,
      firma: s.firma + g.firmaStd,
      fahrt: s.fahrt + g.fahrt,
    }),
    { baustelle: 0, firma: 0, fahrt: 0 }
  );

  const toggle = (key: string) => {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpanded(next);
  };

  return (
    <div className="space-y-2">
      {grouped.length > 1 && (
        <Card>
          <CardContent className="p-3 grid grid-cols-3 gap-2 text-center text-xs">
            <SumCell value={total.baustelle} label="Auswärts" icon={<MapPin className="h-3 w-3" />} highlight />
            <SumCell value={total.firma} label="In Firma" icon={<Factory className="h-3 w-3" />} />
            <SumCell value={total.fahrt} label="Fahrt" />
          </CardContent>
        </Card>
      )}

      {grouped.map((g) => {
        const key = g.baustelle?.id ?? "__none__";
        const isOpen = expanded.has(key);
        const total = g.baustelleStd + g.firmaStd;
        return (
          <Card key={key}>
            <button
              onClick={() => toggle(key)}
              className="w-full p-3 flex items-center gap-3 text-left hover:bg-muted/40 transition"
            >
              <div className="h-10 w-10 rounded bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Building2 className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate">
                  {g.baustelle?.bvh_name ?? "Ohne Baustelle"}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {g.baustelle
                    ? [g.baustelle.kostenstelle, g.baustelle.ort, g.baustelle.bauherr]
                        .filter(Boolean)
                        .join(" · ")
                    : "Allgemeine Firma-Buchungen ohne BVH-Bezug"}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs shrink-0 mr-1">
                <CompactCell value={g.baustelleStd} label="BVH" />
                <CompactCell value={g.firmaStd} label="Firma" />
                <CompactCell value={total} label="Σ" highlight />
              </div>
              {isOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
            </button>
            {isOpen && (
              <div className="border-t bg-muted/20">
                {/* Mitarbeiter-Aufschlüsselung */}
                <div className="p-3 border-b">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Mitarbeiter
                  </Label>
                  <div className="space-y-1 mt-1.5">
                    {[...g.perPerson.values()]
                      .sort((a, b) =>
                        b.baustelle + b.firma - (a.baustelle + a.firma)
                      )
                      .map((pp) => {
                        const partie = partien.find((p) => p.id === pp.person.partie_id);
                        return (
                          <div
                            key={pp.person.id}
                            className="flex items-center gap-2 text-xs bg-background rounded px-2 py-1.5"
                          >
                            <div
                              className="h-6 w-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0"
                              style={{ background: partie?.farbcode ?? "#999" }}
                            >
                              {initials(pp.person)}
                            </div>
                            <span className="flex-1 truncate font-medium">
                              {pp.person.vorname} {pp.person.nachname}
                            </span>
                            {pp.baustelle > 0 && (
                              <span
                                className="text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-primary/10 text-primary inline-flex items-center gap-0.5"
                                title="Auswärts (mit Diäten)"
                              >
                                <MapPin className="h-2.5 w-2.5" />
                                {pp.baustelle.toFixed(1)}h
                              </span>
                            )}
                            {pp.firma > 0 && (
                              <span
                                className="text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-muted inline-flex items-center gap-0.5"
                                title="In Firma (ohne Diäten)"
                              >
                                <Factory className="h-2.5 w-2.5" />
                                {pp.firma.toFixed(1)}h
                              </span>
                            )}
                            <span className="text-xs font-bold tabular-nums shrink-0">
                              {(pp.baustelle + pp.firma).toFixed(1)}h
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </div>

                {/* Einzelbuchungen */}
                {g.rows.map((r) => {
                  const p = persons.get(r.mitarbeiter_id);
                  return (
                    <BuchungRow
                      key={r.id}
                      r={r}
                      baustelle={g.baustelle ?? undefined}
                      personLabel={p ? `${p.vorname} ${p.nachname}` : "—"}
                      isAdmin={isAdmin}
                      onEdit={() => onEdit(r)}
                      onDelete={() => onDelete(r)}
                    />
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ─── Hilfs-Components ───
function SumCell({
  value,
  label,
  icon,
  highlight = false,
}: {
  value: number;
  label: string;
  icon?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div>
      <div
        className={`text-2xl font-bold tabular-nums ${
          highlight ? "text-primary" : ""
        }`}
      >
        {value.toFixed(1)}
      </div>
      <div className="text-[10px] uppercase text-muted-foreground flex items-center justify-center gap-1">
        {icon}
        {label}
      </div>
    </div>
  );
}

function CompactCell({
  value,
  label,
  highlight = false,
}: {
  value: number;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className={`font-bold tabular-nums ${highlight ? "text-primary" : ""}`}>
        {value.toFixed(1)}
      </div>
      <div className="text-[9px] text-muted-foreground uppercase">{label}</div>
    </div>
  );
}

function BuchungRow({
  r,
  baustelle,
  personLabel,
  isAdmin,
  onEdit,
  onDelete,
}: {
  r: Stunde;
  baustelle?: Baustelle;
  personLabel?: string;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="px-3 py-2 border-b last:border-0 flex items-center gap-2 text-xs">
      <span className="font-medium tabular-nums shrink-0">
        {new Date(r.datum).toLocaleDateString("de-AT", {
          day: "2-digit",
          month: "2-digit",
        })}
      </span>
      {r.start_zeit && r.end_zeit && (
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
          {fmtTime(r.start_zeit)}–{fmtTime(r.end_zeit)}
        </span>
      )}
      {r.in_firma && !r.fehlzeit_typ && (
        <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0 h-4">
          <Factory className="h-2.5 w-2.5 mr-0.5" />
          Firma
        </Badge>
      )}
      <span className="truncate flex-1">
        {personLabel
          ? personLabel
          : r.fehlzeit_typ
          ? `Fehlzeit ${r.fehlzeit_typ}`
          : baustelle?.bvh_name ?? (r.in_firma ? "Allgemein" : "—")}
      </span>
      <span className="font-bold tabular-nums shrink-0">
        {Number(r.arbeitsstunden ?? r.fehlzeit_stunden ?? 0).toFixed(2)}h
      </span>
      {isAdmin && r.status === "offen" && (
        <div className="flex shrink-0">
          <button
            onClick={onEdit}
            className="text-muted-foreground hover:text-primary p-1"
            aria-label="Bearbeiten"
          >
            <Edit className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive p-1"
            aria-label="Löschen"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {isAdmin && r.status !== "offen" && (
        <Badge variant="outline" className="text-[9px] shrink-0">
          {r.status}
        </Badge>
      )}
    </div>
  );
}

// ─── Edit-Form (Admin kann alle Felder editieren) ───
function EditBuchungForm({
  row,
  baustellen,
  person,
  onClose,
  onSaved,
}: {
  row: Stunde;
  baustellen: Baustelle[];
  person?: Profile;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [datum, setDatum] = useState<string>(row.datum);
  const [baustelleId, setBaustelleId] = useState<string>(row.baustelle_id ?? "");
  const [inFirma, setInFirma] = useState<boolean>(!!row.in_firma);
  const [fehlzeitTyp, setFehlzeitTyp] = useState<string>(row.fehlzeit_typ ?? "");
  const [startZeit, setStartZeit] = useState<string>(fmtTime(row.start_zeit) || "07:00");
  const [endZeit, setEndZeit] = useState<string>(fmtTime(row.end_zeit) || "15:30");
  const [hasPause, setHasPause] = useState<boolean>(!!row.pause_von && !!row.pause_bis);
  const [pauseVon, setPauseVon] = useState<string>(fmtTime(row.pause_von) || "12:00");
  const [pauseBis, setPauseBis] = useState<string>(fmtTime(row.pause_bis) || "12:30");
  const [fehlzeitHours, setFehlzeitHours] = useState<number>(Number(row.fehlzeit_stunden ?? 8));
  const [taetigkeit, setTaetigkeit] = useState<string>(row.taetigkeit ?? "");
  const [fahrstunden, setFahrstunden] = useState<number>(Number(row.fahrstunden ?? 0));
  const [taggeldKurz, setTaggeldKurz] = useState<number>(Number(row.taggeld_kurz ?? 0));
  const [taggeldLang, setTaggeldLang] = useState<number>(Number(row.taggeld_lang ?? 0));
  const [km, setKm] = useState<number>(Number(row.km_gefahren ?? 0));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const update: any = {
      datum,
      taetigkeit: taetigkeit || null,
      fahrstunden,
      taggeld_kurz: !fehlzeitTyp && inFirma ? 0 : taggeldKurz,
      taggeld_lang: !fehlzeitTyp && inFirma ? 0 : taggeldLang,
      km_gefahren: km,
    };
    if (fehlzeitTyp) {
      update.fehlzeit_typ = fehlzeitTyp;
      update.fehlzeit_stunden = fehlzeitHours;
      update.start_zeit = null;
      update.end_zeit = null;
      update.pause_von = null;
      update.pause_bis = null;
      update.arbeitsstunden = 0;
      update.baustelle_id = null;
      update.in_firma = false;
    } else {
      const sStart = snap15(startZeit);
      const sEnd = snap15(endZeit);
      const sPV = hasPause ? snap15(pauseVon) : null;
      const sPB = hasPause ? snap15(pauseBis) : null;
      update.fehlzeit_typ = null;
      update.fehlzeit_stunden = 0;
      update.start_zeit = sStart;
      update.end_zeit = sEnd;
      update.pause_von = sPV;
      update.pause_bis = sPB;
      update.arbeitsstunden = calcArbeit(sStart, sEnd, sPV, sPB);
      update.baustelle_id = baustelleId || null;
      update.in_firma = inFirma;
    }

    const { error } = await supabase
      .from("stundenbuchungen")
      .update(update)
      .eq("id", row.id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Buchung aktualisiert" });
    onSaved();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {person && (
        <div className="text-xs text-muted-foreground">
          Mitarbeiter: <strong>{person.vorname} {person.nachname}</strong>
          {person.pers_nr && ` (${person.pers_nr})`}
        </div>
      )}

      <div>
        <Label>Datum</Label>
        <Input
          type="date"
          value={datum}
          onChange={(e) => setDatum(e.target.value)}
          required
        />
      </div>

      {/* Mode */}
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => setFehlzeitTyp("")}
          className={`h-9 rounded-md border text-sm font-medium ${
            !fehlzeitTyp
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background"
          }`}
        >
          Arbeit
        </button>
        <select
          value={fehlzeitTyp}
          onChange={(e) => setFehlzeitTyp(e.target.value)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">— Fehlzeit —</option>
          <option value="U">Urlaub</option>
          <option value="K">Krank</option>
          <option value="F">Feiertag</option>
          <option value="SW">Schlechtwetter</option>
        </select>
      </div>

      {!fehlzeitTyp ? (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setInFirma(false)}
              className={`h-9 rounded-md border text-xs font-medium flex items-center justify-center gap-1 ${
                !inFirma
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background"
              }`}
            >
              <MapPin className="h-3.5 w-3.5" /> Auf Baustelle
            </button>
            <button
              type="button"
              onClick={() => setInFirma(true)}
              className={`h-9 rounded-md border text-xs font-medium flex items-center justify-center gap-1 ${
                inFirma
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background"
              }`}
            >
              <Factory className="h-3.5 w-3.5" /> In Firma
            </button>
          </div>

          <div>
            <Label>Baustelle{inFirma && " (optional)"}</Label>
            <select
              value={baustelleId}
              onChange={(e) => setBaustelleId(e.target.value)}
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">— keine —</option>
              {baustellen.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.bvh_name}
                  {b.kostenstelle ? ` · ${b.kostenstelle}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <TimePickerInput label="Start" value={startZeit} onChange={setStartZeit} />
            <TimePickerInput label="Ende" value={endZeit} onChange={setEndZeit} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={hasPause} onCheckedChange={setHasPause} />
            <Label>Pause</Label>
          </div>
          {hasPause && (
            <div className="grid grid-cols-2 gap-2">
              <TimePickerInput label="Pause von" value={pauseVon} onChange={setPauseVon} />
              <TimePickerInput label="Pause bis" value={pauseBis} onChange={setPauseBis} />
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Berechnete Arbeitszeit:{" "}
            <strong>
              {calcArbeit(
                startZeit,
                endZeit,
                hasPause ? pauseVon : null,
                hasPause ? pauseBis : null
              ).toFixed(2)}{" "}
              h
            </strong>
          </div>

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
              <Label className="text-xs">KM</Label>
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
                TG kurz {inFirma && <span className="opacity-60">(0)</span>}
              </Label>
              <Input
                inputMode="numeric"
                type="number"
                step="1"
                disabled={inFirma}
                value={inFirma ? 0 : taggeldKurz}
                onChange={(e) => setTaggeldKurz(Number(e.target.value))}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">
                TG lang {inFirma && <span className="opacity-60">(0)</span>}
              </Label>
              <Input
                inputMode="numeric"
                type="number"
                step="1"
                disabled={inFirma}
                value={inFirma ? 0 : taggeldLang}
                onChange={(e) => setTaggeldLang(Number(e.target.value))}
                className="h-9"
              />
            </div>
          </div>
        </>
      ) : (
        <div>
          <Label>Stunden ({fehlzeitTyp})</Label>
          <Input
            inputMode="decimal"
            type="number"
            step="0.25"
            value={fehlzeitHours}
            onChange={(e) => setFehlzeitHours(Number(e.target.value))}
            required
          />
        </div>
      )}

      <div>
        <Label>Tätigkeit</Label>
        <Input
          value={taetigkeit}
          onChange={(e) => setTaetigkeit(e.target.value)}
          placeholder="optional"
        />
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
