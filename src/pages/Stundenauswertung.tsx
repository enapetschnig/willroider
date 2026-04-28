import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  ChevronDown,
  ChevronUp,
  Download,
  ChevronLeft,
  ChevronRight,
  Factory,
  MapPin,
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

export default function Stundenauswertung() {
  const { user, profile, isAdmin } = useAuth();
  const [polierPartie, setPolierPartie] = useState<Partie | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const [partien, setPartien] = useState<Partie[]>([]);
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [rows, setRows] = useState<Stunde[]>([]);
  const [monat, setMonat] = useState<string>(() => new Date().toISOString().slice(0, 7));

  const mode: Mode = isAdmin ? "admin" : polierPartie ? "polier" : "self";

  // ─── Modus + Mitglieder laden ───
  useEffect(() => {
    if (!user) return;
    (async () => {
      if (isAdmin) {
        const [{ data: ms }, { data: ps }, { data: bs }] = await Promise.all([
          supabase.from("profiles").select("*").eq("is_active", true).order("nachname"),
          supabase.from("partien").select("*").order("name"),
          supabase.from("baustellen").select("*"),
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
      const [{ data: bs }] = await Promise.all([supabase.from("baustellen").select("*")]);
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

  // ─── Buchungen für gewählten Monat laden ───
  useEffect(() => {
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
  }, [user, monat, mode, members]);

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

  const exportCsv = () => {
    if (rows.length === 0) return;
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
    rows.forEach((r) => {
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
    a.download = `stundenauswertung_${monat}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <PageHeader
        title="Stunden-Auswertung"
        description={
          mode === "admin"
            ? "Monatsstunden aller aktiven Mitarbeiter"
            : mode === "polier"
            ? `Monatsstunden deiner Partie · ${polierPartie?.name}`
            : "Deine Monatsstunden"
        }
        actions={
          rows.length > 0 ? (
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="h-4 w-4 mr-2" /> CSV
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="p-3 flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => moveMonth(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="month"
            value={monat}
            onChange={(e) => setMonat(e.target.value)}
            className="h-10 text-center font-medium"
          />
          <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => moveMonth(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0 ml-1">
            {rows.length} Buchungen
          </span>
        </CardContent>
      </Card>

      <PersonenAuswertung
        rows={rows}
        baustellen={baustellen}
        members={members}
        partien={partien}
        ownUserId={user!.id}
        ownProfile={profile as any}
        mode={mode}
      />
    </div>
  );
}

function PersonenAuswertung({
  rows,
  baustellen,
  members,
  partien,
  ownUserId,
  ownProfile,
  mode,
}: {
  rows: Stunde[];
  baustellen: Baustelle[];
  members: Profile[];
  partien: Partie[];
  ownUserId: string;
  ownProfile: Profile | null;
  mode: Mode;
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
        baustelle: number; // Arbeit auf Baustelle (mit Diäten)
        firma: number; // Arbeit in der Firma (ohne Diäten)
        fahrt: number;
        fehl: number;
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
        rows: [],
      };
      const a = Number(r.arbeitsstunden ?? 0);
      if (r.in_firma) cur.firma += a;
      else cur.baustelle += a;
      cur.fahrt += Number(r.fahrstunden ?? 0);
      cur.fehl += Number(r.fehlzeit_stunden ?? 0);
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
          Keine Buchungen in diesem Monat.
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
            <div>
              <div className="text-2xl font-bold tabular-nums text-primary">
                {total.baustelle.toFixed(1)}
              </div>
              <div className="text-[10px] uppercase text-muted-foreground flex items-center justify-center gap-1">
                <MapPin className="h-3 w-3" />
                Baustelle
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums">{total.firma.toFixed(1)}</div>
              <div className="text-[10px] uppercase text-muted-foreground flex items-center justify-center gap-1">
                <Factory className="h-3 w-3" />
                Firma
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums">{total.fahrt.toFixed(1)}</div>
              <div className="text-[10px] uppercase text-muted-foreground">Fahrt</div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums">{total.fehl.toFixed(1)}</div>
              <div className="text-[10px] uppercase text-muted-foreground">Fehlzeit</div>
            </div>
          </CardContent>
        </Card>
      )}

      {grouped.map((g) => {
        const isOpen = expanded.has(g.person.id);
        const partie = partien.find((p) => p.id === g.person.partie_id);
        const arbeitTotal = g.baustelle + g.firma;
        const sigma = arbeitTotal + g.fahrt + g.fehl;
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
                <div title="Baustelle (mit Diäten)">
                  <div className="font-bold tabular-nums">{g.baustelle.toFixed(1)}</div>
                  <div className="text-[9px] text-muted-foreground uppercase">BVH</div>
                </div>
                <div title="Firma (ohne Diäten)">
                  <div className="font-bold tabular-nums">{g.firma.toFixed(1)}</div>
                  <div className="text-[9px] text-muted-foreground uppercase">Firma</div>
                </div>
                <div>
                  <div className="font-bold tabular-nums">{g.fehl.toFixed(1)}</div>
                  <div className="text-[9px] text-muted-foreground uppercase">Fehlz.</div>
                </div>
                <div>
                  <div className="font-bold tabular-nums text-primary">{sigma.toFixed(1)}</div>
                  <div className="text-[9px] text-muted-foreground uppercase">Σ</div>
                </div>
              </div>
              {isOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
            </button>
            {isOpen && (
              <div className="border-t bg-muted/20">
                {g.rows.map((r) => {
                  const b = baustellen.find((x) => x.id === r.baustelle_id);
                  return (
                    <div
                      key={r.id}
                      className="px-3 py-2 border-b last:border-0 flex items-center gap-2 text-xs"
                    >
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
                        <Badge
                          variant="secondary"
                          className="text-[9px] px-1 py-0 shrink-0 h-4"
                        >
                          <Factory className="h-2.5 w-2.5 mr-0.5" />
                          Firma
                        </Badge>
                      )}
                      <span className="truncate flex-1">
                        {r.fehlzeit_typ
                          ? `Fehlzeit ${r.fehlzeit_typ}`
                          : b?.bvh_name ?? (r.in_firma ? "Allgemein" : "—")}
                      </span>
                      <span className="font-bold tabular-nums shrink-0">
                        {Number(r.arbeitsstunden ?? r.fehlzeit_stunden ?? 0).toFixed(2)}h
                      </span>
                    </div>
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
