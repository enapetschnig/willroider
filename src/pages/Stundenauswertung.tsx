/**
 * Stundenauswertung (Phase A) — liest jetzt aus stunden_tage statt der
 * alten stundenbuchungen-Tabelle. Kompakt gehalten:
 *  - Monats-Picker
 *  - Pro Mitarbeiter: Soll / Ist (Netto) / Diff + Tages-Tabelle
 *  - CSV-Export für Lohnverrechnung
 */

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { isWerktag, feiertagAt } from "@/lib/feiertage";
import {
  periodeSoll,
  tagesSoll,
  ladeKalenderMap,
  type TagessollKalender,
  type ArbeitszeitModell,
} from "@/lib/konten";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Pencil,
  Lock,
  Unlock,
} from "lucide-react";
import type { Database, TagStatus } from "@/integrations/supabase/types";
import { useStundenTageList } from "@/hooks/useStundenTag";
import { usePausenConfig, useArbeitszeitLimits, useTaetigkeitenStamm, useZulagenTypen } from "@/hooks/useStammdatenStunden";
import { berechneTagZeiten, fmtH, fmtHNum } from "@/lib/zeiterfassung";
import {
  aggregiereTaetigkeiten,
  aggregiereZulagen,
  aggregiereTaggeld,
  taggeldFuerTag,
  fmtEur,
  TAGGELD_SATZ_KURZ_EUR,
  TAGGELD_SATZ_LANG_EUR,
  type PausenDauer,
} from "@/lib/stundenAggregation";
import {
  makeStundenzettelPdf,
  makeAlleStundenzettelPdf,
  type StundenzettelData,
} from "@/lib/stundenZettelPdf";
import { FileText } from "lucide-react";
import { AdminTagEditModal } from "@/components/admin/AdminTagEditModal";
import { useQueryClient } from "@tanstack/react-query";
import type { StundenTagFull } from "@/hooks/useStundenTag";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];

const STATUS_LABEL: Record<TagStatus, string> = {
  baustelle: "Baustelle",
  firma: "Firma",
  krank: "Krank",
  urlaub: "Urlaub",
  schlechtwetter: "SW",
  feiertag: "Feiertag",
};

/** Kurzzeichen für Abwesenheits-Tage in der Monatstabelle. */
const RASTER_KUERZEL: Record<string, string> = {
  urlaub: "U",
  krank: "K",
  schlechtwetter: "SW",
  feiertag: "F",
};

function monatLabel(monat: string) {
  const [y, m] = monat.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("de-AT", {
    year: "numeric",
    month: "long",
  });
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export type Periode = "voll" | "h1" | "h2";

/** Liefert den Datums-Range fuer einen Monat + gewaehlte Periode.
 *   voll = ganzer Monat, h1 = 1.-15., h2 = 16.-Monatsende. */
function monatRange(monat: string, periode: Periode = "voll") {
  const [y, m] = monat.split("-").map(Number);
  const mm = String(m).padStart(2, "0");
  const lastDay = new Date(y, m, 0).getDate();
  if (periode === "h1") {
    return { from: `${y}-${mm}-01`, to: `${y}-${mm}-15` };
  }
  if (periode === "h2") {
    return { from: `${y}-${mm}-16`, to: `${y}-${mm}-${String(lastDay).padStart(2, "0")}` };
  }
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

function periodeLabel(monat: string, periode: Periode): string {
  const base = monatLabel(monat);
  if (periode === "h1") return `Erster Halbmonat · ${base}`;
  if (periode === "h2") return `Zweiter Halbmonat · ${base}`;
  return base;
}

export default function Stundenauswertung() {
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [monat, setMonat] = useState(currentMonth());
  const [periode, setPeriode] = useState<Periode>("voll");
  const [members, setMembers] = useState<Profile[]>([]);
  const [partien, setPartien] = useState<Partie[]>([]);
  const [baustellenMap, setBaustellenMap] = useState<Map<string, string>>(new Map());
  const [partieFilter, setPartieFilter] = useState<string>("");
  const [ansicht, setAnsicht] = useState<
    "uebersicht" | "raster" | "baustellen"
  >("uebersicht");
  const [selectedBaustelle, setSelectedBaustelle] = useState<string>("");
  const [expandedUid, setExpandedUid] = useState<string | null>(null);
  const [editTag, setEditTag] = useState<{
    tag: StundenTagFull;
    mitarbeiterName: string;
  } | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: m }, { data: p }, { data: b }] = await Promise.all([
        supabase
          .from("profiles")
          .select("*")
          .eq("is_active", true)
          .order("nachname"),
        supabase.from("partien").select("*").order("name"),
        supabase.from("baustellen").select("id, bvh_name"),
      ]);
      setMembers((m as Profile[]) ?? []);
      setPartien((p as Partie[]) ?? []);
      setBaustellenMap(
        new Map(((b as any[]) ?? []).map((x) => [x.id as string, (x.bvh_name as string) ?? "Baustelle"])),
      );
    })();
  }, []);

  const { from, to } = monatRange(monat, periode);
  const memberIds = isAdmin
    ? members
        .filter((m) => !partieFilter || m.partie_id === partieFilter)
        .map((m) => m.id)
    : user
    ? [user.id]
    : [];

  const { data: tage = [], isLoading } = useStundenTageList({
    fromDate: from,
    toDate: to,
    mitarbeiterIds: memberIds,
    enabled: memberIds.length > 0,
  });
  const { data: pausen } = usePausenConfig();
  const { data: limits } = useArbeitszeitLimits();
  const { data: taetigkeitenStamm = [] } = useTaetigkeitenStamm();
  const { data: zulagenTypen = [] } = useZulagenTypen();

  // Pausen-Dauern für Brutto-/Taggeld-Berechnung
  const pausenDauer: PausenDauer = {
    vmDauerMin: pausen?.vm.dauer_minuten ?? 0,
    mittagDauerMin: pausen?.mittag.dauer_minuten ?? 0,
  };

  // Soll-Stunden pro MA aus Konto-Settings (Tagesnorm/Grad/Modell/ZA-Faktor)
  const [pks, setPks] = useState<
    Map<
      string,
      {
        tagesnorm: number;
        beschaeftigungsgrad: number;
        za_faktor: number;
        modell: ArbeitszeitModell;
      }
    >
  >(new Map());
  useEffect(() => {
    (async () => {
      if (memberIds.length === 0) return;
      const { data } = await supabase
        .from("profile_konten_settings")
        .select(
          "profile_id, tagesnorm_stunden, beschaeftigungsgrad, za_faktor, arbeitszeitmodell",
        )
        .in("profile_id", memberIds);
      const map = new Map<
        string,
        {
          tagesnorm: number;
          beschaeftigungsgrad: number;
          za_faktor: number;
          modell: ArbeitszeitModell;
        }
      >();
      (data ?? []).forEach((r: any) => {
        map.set(r.profile_id, {
          tagesnorm: Number(r.tagesnorm_stunden ?? 8),
          beschaeftigungsgrad: Number(r.beschaeftigungsgrad ?? 1),
          za_faktor: Number(r.za_faktor ?? 1),
          modell: (r.arbeitszeitmodell ?? "zimmerei_sommer") as ArbeitszeitModell,
        });
      });
      setPks(map);
    })();
  }, [JSON.stringify(memberIds), monat]);

  // Arbeitszeitkalender (L/K-Wochen) — Basis der kalenderbasierten
  // Soll-Berechnung. Genau dieselbe Quelle, die auch der Abschluss-RPC nutzt.
  const [kalender, setKalender] = useState<Map<string, TagessollKalender>>(
    new Map(),
  );
  useEffect(() => {
    ladeKalenderMap(Number(monat.slice(0, 4))).then(setKalender);
  }, [monat]);

  const werktage = useMemo(() => {
    // Werktage im aktiven Periode-Range — Wochenenden UND Feiertage zählen
    // nicht als Soll-Tag (sonst ist das Soll in Feiertagsmonaten zu hoch).
    const start = new Date(from + "T00:00:00");
    const end = new Date(to + "T00:00:00");
    let count = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (isWerktag(d)) count++;
    }
    return count;
  }, [from, to]);

  // Gruppieren pro MA
  const byMa = useMemo(() => {
    const map = new Map<string, typeof tage>();
    for (const t of tage) {
      const list = map.get(t.tag.mitarbeiter_id) ?? [];
      list.push(t);
      map.set(t.tag.mitarbeiter_id, list);
    }
    return memberIds
      .map((uid) => {
        const m = members.find((x) => x.id === uid);
        const list = (map.get(uid) ?? []).sort((a, b) =>
          a.tag.datum.localeCompare(b.tag.datum),
        );
        const setting = pks.get(uid);
        const tagesnorm = setting?.tagesnorm ?? 8;
        const beschgrad = setting?.beschaeftigungsgrad ?? 1;
        const zaFaktor = setting?.za_faktor ?? 1;
        const modell = setting?.modell ?? "zimmerei_sommer";
        // Soll: kalenderbasiert (L/K-Wochen) über die gewählte Periode.
        const soll = periodeSoll(from, to, kalender, modell, tagesnorm, beschgrad);
        // Ist: gearbeitete Tage = Netto; Abwesenheit (Urlaub/Krank/SW/
        // Feiertag) wird mit dem Tages-Soll gutgeschrieben → kein Minus für
        // Abwesenheit, egal was als Stundenzahl erfasst wurde.
        const ist = list.reduce((a, t) => {
          const worked =
            t.tag.tag_status === "baustelle" || t.tag.tag_status === "firma";
          return (
            a +
            (worked
              ? Number(t.tag.netto_stunden)
              : tagesSoll(t.tag.datum, kalender, modell, tagesnorm, beschgrad))
          );
        }, 0);
        // Differenz = ZA-wirksame Differenz (× za_faktor) — identisch zu dem,
        // was der Abschluss-RPC bucht.
        const diff = Math.round((ist - soll) * zaFaktor * 100) / 100;
        return { uid, ma: m, list, soll, ist, diff };
      })
      .filter((r) => r.ma);
  }, [tage, memberIds, members, pks, kalender, from, to]);

  // ─── Daten für Raster- + Baustellen-Ansicht ──────────────────────────
  const nameByUid = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of members) {
      m.set(p.id, `${p.nachname ?? ""} ${p.vorname ?? ""}`.trim() || "—");
    }
    return m;
  }, [members]);

  // Tage der gewählten Periode — Spalten der Monatstabelle.
  const periodeTage = useMemo(() => {
    const out: { iso: string; tag: number; kuerzel: string; frei: boolean }[] =
      [];
    const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
    const d = new Date(from + "T00:00:00");
    const end = new Date(to + "T00:00:00");
    while (d <= end) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const dow = d.getDay();
      out.push({
        iso,
        tag: d.getDate(),
        kuerzel: WD[dow],
        frei: dow === 0 || dow === 6 || !!feiertagAt(iso),
      });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [from, to]);

  // Schneller Zugriff Raster-Zelle: uid → iso → Tag.
  const tagByUidIso = useMemo(() => {
    const m = new Map<string, Map<string, StundenTagFull>>();
    for (const t of tage) {
      let inner = m.get(t.tag.mitarbeiter_id);
      if (!inner) {
        inner = new Map();
        m.set(t.tag.mitarbeiter_id, inner);
      }
      inner.set(t.tag.datum, t);
    }
    return m;
  }, [tage]);

  // ─── Baustellenauswertung ────────────────────────────────────────────
  const baustellenMitBuchungen = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tage)
      for (const tt of t.taetigkeiten)
        if (tt.baustelle_id) ids.add(tt.baustelle_id);
    return [...ids]
      .map((id) => ({ id, name: baustellenMap.get(id) ?? "Baustelle" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tage, baustellenMap]);

  const baustelleRows = useMemo(() => {
    if (!selectedBaustelle) return [];
    const m = new Map<string, number>();
    for (const t of tage) {
      for (const tt of t.taetigkeiten) {
        if (tt.baustelle_id === selectedBaustelle) {
          m.set(
            t.tag.mitarbeiter_id,
            (m.get(t.tag.mitarbeiter_id) ?? 0) + Number(tt.stunden ?? 0),
          );
        }
      }
    }
    return [...m.entries()]
      .map(([uid, stunden]) => ({
        uid,
        name: nameByUid.get(uid) ?? "—",
        stunden,
      }))
      .sort((a, b) => b.stunden - a.stunden);
  }, [tage, selectedBaustelle, nameByUid]);

  const moveMonat = (delta: number) => {
    const [y, m] = monat.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonat(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  // ─── Monatsabschluss-Section ────────────────────────────────────────
  // Lädt für die aktuelle Periode (von/bis) die bereits gebuchten
  // monatsabschluss-Einträge pro MA — basis für die Abschluss-Section
  // am Ende der Page.
  const [abschluss, setAbschluss] = useState<Record<string, { za_buchung_id: string | null }>>({});
  const [abschlussBusy, setAbschlussBusy] = useState(false);

  async function ladeAbschluesse() {
    if (memberIds.length === 0) {
      setAbschluss({});
      return;
    }
    const { data } = await supabase
      .from("monatsabschluss")
      .select("mitarbeiter_id, za_buchung_id, von_datum, bis_datum")
      .eq("von_datum", from)
      .eq("bis_datum", to)
      .in("mitarbeiter_id", memberIds);
    const map: Record<string, { za_buchung_id: string | null }> = {};
    ((data as any[]) ?? []).forEach((r) => {
      map[r.mitarbeiter_id] = { za_buchung_id: r.za_buchung_id };
    });
    setAbschluss(map);
  }
  useEffect(() => {
    ladeAbschluesse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, JSON.stringify(memberIds)]);

  const periodeKurzLabel =
    periode === "h1" ? "1.–15." : periode === "h2" ? "16.–Ende" : "Ganzer Monat";

  const offeneAbschluesse = byMa.filter((r) => !abschluss[r.uid]);

  async function schliesseAlleAb() {
    if (offeneAbschluesse.length === 0) return;
    if (
      !window.confirm(
        `Periode (${periodeKurzLabel}, ${monatLabel(monat)}) für ${offeneAbschluesse.length} Mitarbeiter abschließen?`,
      )
    )
      return;
    setAbschlussBusy(true);
    const { error } = await supabase.rpc("monatsabschluss_durchfuehren" as any, {
      p_von_datum: from,
      p_bis_datum: to,
      p_mitarbeiter_id: null,
    });
    setAbschlussBusy(false);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: `Periode abgeschlossen` });
    ladeAbschluesse();
    qc.invalidateQueries({ queryKey: ["stunden_tage_list"] });
  }

  async function schliesseEinenAb(uid: string) {
    if (!window.confirm(`Periode (${periodeKurzLabel}, ${monatLabel(monat)}) für diesen Mitarbeiter abschließen?`))
      return;
    const { error } = await supabase.rpc("monatsabschluss_durchfuehren" as any, {
      p_von_datum: from,
      p_bis_datum: to,
      p_mitarbeiter_id: uid,
    });
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Abgeschlossen" });
    ladeAbschluesse();
  }

  async function oeffneEinen(uid: string) {
    if (
      !window.confirm(
        `Periode wieder öffnen?\nDie ZA-Buchung wird gelöscht.`,
      )
    )
      return;
    const { error } = await supabase.rpc("monatsabschluss_oeffnen" as any, {
      p_von_datum: from,
      p_bis_datum: to,
      p_mitarbeiter_id: uid,
    });
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Periode geöffnet" });
    ladeAbschluesse();
  }

  function buildStundenzettel(r: typeof byMa[number]): StundenzettelData {
    return {
      mitarbeiter: { id: r.ma!.id, vorname: r.ma!.vorname ?? "", nachname: r.ma!.nachname ?? "" },
      monat,
      tage: r.list ?? [],
      soll: r.soll,
      ist: r.ist,
      diff: r.diff,
      taetigkeitenStamm,
      zulagenTypen,
      pausen: pausenDauer,
    };
  }

  const exportPdfEinzeln = (r: typeof byMa[number]) => {
    const data = buildStundenzettel(r);
    const doc = makeStundenzettelPdf(data);
    const safeName = `${data.mitarbeiter.nachname}_${data.mitarbeiter.vorname}`.replace(/\s+/g, "");
    doc.save(`Stundenzettel_${monat}_${safeName}.pdf`);
  };

  const exportPdfAlle = () => {
    if (byMa.length === 0) return;
    const alleData = byMa.map(buildStundenzettel);
    const doc = makeAlleStundenzettelPdf(alleData);
    doc.save(`Stundenzettel_${monat}_alle.pdf`);
    toast({ title: `${alleData.length} Stundenzettel erstellt` });
  };

  const exportCsv = async () => {
    const lines: string[] = [];
    lines.push(
      "Mitarbeiter;Datum;Status;Netto;Brutto;Von;Bis;Anwesenheit (min);Tätigkeiten;Zulagen;Taggeld_kurz;Taggeld_lang;Anmerkung",
    );
    const taetById = new Map(taetigkeitenStamm.map((s) => [s.id, s.bezeichnung]));
    const zulById = new Map(zulagenTypen.map((s) => [s.id, s.bezeichnung]));
    const cleanCsv = (s: string) => s.replace(/[;\n]/g, " ");
    for (const { ma, list } of byMa) {
      for (const t of list) {
        const isArbeit = t.tag.tag_status === "baustelle" || t.tag.tag_status === "firma";
        const zeiten =
          isArbeit && pausen
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
        const taetStr = t.taetigkeiten
          .map((tt) => {
            const bez = (tt.taetigkeit_id && taetById.get(tt.taetigkeit_id)) || tt.taetigkeit_freitext || "—";
            return `${bez} ${Number(tt.stunden ?? 0)}h`;
          })
          .join(", ");
        const zulStr = t.zulagen
          .map((z) => {
            const bez = zulById.get(z.zulagen_typ_id) ?? "Zulage";
            return z.stunden != null ? `${bez} ${Number(z.stunden)}h` : bez;
          })
          .join(", ");
        const tg = taggeldFuerTag(t, pausenDauer);
        const tgKurz = tg.kurz;
        const tgLang = tg.lang;
        lines.push(
          [
            `${ma!.nachname} ${ma!.vorname}`,
            t.tag.datum,
            STATUS_LABEL[t.tag.tag_status],
            fmtHNum(Number(t.tag.netto_stunden)),
            zeiten ? fmtHNum(zeiten.bruttoAnwesenheit) : "",
            zeiten?.von ?? "",
            zeiten?.bis ?? "",
            zeiten?.pausenMinuten ?? "",
            cleanCsv(taetStr),
            cleanCsv(zulStr),
            tgKurz,
            tgLang,
            cleanCsv(t.tag.anmerkung ?? ""),
          ].join(";"),
        );
      }
    }
    const csv = lines.join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stundenauswertung_${monat}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "CSV heruntergeladen" });
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Stundenauswertung" />

      {/* Monats-Navigation */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => moveMonat(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="month"
              value={monat}
              onChange={(e) => setMonat(e.target.value)}
              className="h-10 text-center font-medium"
            />
            <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => moveMonat(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm text-muted-foreground">
              {periodeLabel(monat, periode)} · {werktage} Werktage
            </div>
            <div className="flex items-center gap-1 ml-2">
              <Button
                size="sm"
                variant={periode === "voll" ? "default" : "outline"}
                onClick={() => setPeriode("voll")}
                className="h-8 px-2 text-xs"
              >
                Ganzer Monat
              </Button>
              <Button
                size="sm"
                variant={periode === "h1" ? "default" : "outline"}
                onClick={() => setPeriode("h1")}
                className="h-8 px-2 text-xs"
              >
                1.–15.
              </Button>
              <Button
                size="sm"
                variant={periode === "h2" ? "default" : "outline"}
                onClick={() => setPeriode("h2")}
                className="h-8 px-2 text-xs"
              >
                16.–Ende
              </Button>
            </div>
            {isAdmin && partien.length > 0 && (
              <div className="flex items-center gap-2">
                <Label className="text-xs">Partie</Label>
                <select
                  value={partieFilter}
                  onChange={(e) => setPartieFilter(e.target.value)}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">— alle —</option>
                  {partien.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={exportPdfAlle} disabled={byMa.length === 0}>
                <FileText className="h-4 w-4 mr-1.5" /> Alle Stundenzettel (PDF)
              </Button>
              <Button size="sm" variant="outline" onClick={exportCsv} disabled={byMa.length === 0}>
                <Download className="h-4 w-4 mr-1.5" /> CSV
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ansicht-Umschalter */}
      <div className="flex items-center gap-2 print:hidden flex-wrap">
        <Button
          variant={ansicht === "uebersicht" ? "default" : "outline"}
          size="sm"
          onClick={() => setAnsicht("uebersicht")}
        >
          Mitarbeiter-Übersicht
        </Button>
        <Button
          variant={ansicht === "raster" ? "default" : "outline"}
          size="sm"
          onClick={() => setAnsicht("raster")}
        >
          Monatstabelle
        </Button>
        <Button
          variant={ansicht === "baustellen" ? "default" : "outline"}
          size="sm"
          onClick={() => setAnsicht("baustellen")}
        >
          Baustellen
        </Button>
      </div>

      {/* MA-Übersicht */}
      {ansicht === "uebersicht" &&
        (isLoading ? (
        <Card>
          <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lade…
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Mitarbeiter</TableHead>
                  <TableHead className="text-right">Soll</TableHead>
                  <TableHead className="text-right">Ist</TableHead>
                  <TableHead className="text-right">Diff</TableHead>
                  <TableHead className="text-right w-20">PDF</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byMa.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground p-6">
                      Keine Mitarbeiter im Filter.
                    </TableCell>
                  </TableRow>
                )}
                {byMa.map((r) => {
                  const expanded = expandedUid === r.uid;
                  return (
                    <>
                      <TableRow
                        key={r.uid}
                        className="cursor-pointer hover:bg-muted/40"
                        onClick={() => setExpandedUid(expanded ? null : r.uid)}
                      >
                        <TableCell>
                          {expanded ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          {r.ma!.nachname} {r.ma!.vorname}
                          <div className="text-[10px] text-muted-foreground">
                            {r.list.length} Tag{r.list.length === 1 ? "" : "e"}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtH(r.soll)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {fmtH(r.ist)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums font-bold ${
                            r.diff > 0 ? "text-emerald-700" : r.diff < 0 ? "text-amber-700" : ""
                          }`}
                        >
                          {r.diff > 0 ? "+" : ""}
                          {fmtHNum(r.diff)} h
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              exportPdfEinzeln(r);
                            }}
                            title="Stundenzettel als PDF"
                          >
                            <FileText className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow>
                          <TableCell colSpan={6} className="bg-muted/20 p-0">
                            <DetailMa
                              list={r.list}
                              soll={r.soll}
                              ist={r.ist}
                              diff={r.diff}
                              taetigkeitenStamm={taetigkeitenStamm}
                              zulagenTypen={zulagenTypen}
                              pausen={pausen}
                              pausenDauer={pausenDauer}
                              limits={limits}
                              onEditTag={(t) =>
                                setEditTag({
                                  tag: t,
                                  mitarbeiterName: `${r.ma!.vorname ?? ""} ${r.ma!.nachname ?? ""}`.trim(),
                                })
                              }
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        ))}

      {/* Monatstabelle: Tagesraster Mitarbeiter × Tag */}
      {ansicht === "raster" &&
        (isLoading ? (
          <Card>
            <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Lade…
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="text-xs border-collapse w-full">
                  <thead>
                    <tr className="bg-muted">
                      <th className="sticky left-0 bg-muted text-left px-2 py-1.5 border-r min-w-[140px] z-10">
                        Mitarbeiter
                      </th>
                      {periodeTage.map((d) => (
                        <th
                          key={d.iso}
                          className={`px-1 py-1 border text-center w-9 ${
                            d.frei ? "bg-muted-foreground/10 text-muted-foreground" : ""
                          }`}
                        >
                          <div className="font-semibold">{d.tag}</div>
                          <div className="text-[9px] font-normal">{d.kuerzel}</div>
                        </th>
                      ))}
                      <th className="px-2 py-1 border text-right">Ist</th>
                      <th className="px-2 py-1 border text-right">Soll</th>
                      <th className="px-2 py-1 border text-right">Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byMa.length === 0 && (
                      <tr>
                        <td
                          colSpan={periodeTage.length + 4}
                          className="text-center text-sm text-muted-foreground p-6"
                        >
                          Keine Mitarbeiter im Filter.
                        </td>
                      </tr>
                    )}
                    {byMa.map((r) => (
                      <tr key={r.uid} className="border-t">
                        <td className="sticky left-0 bg-card px-2 py-1 border-r font-medium whitespace-nowrap z-10">
                          {r.ma!.nachname} {r.ma!.vorname}
                        </td>
                        {periodeTage.map((d) => {
                          const cell = tagByUidIso.get(r.uid)?.get(d.iso);
                          if (!cell) {
                            return (
                              <td
                                key={d.iso}
                                className={`border text-center text-muted-foreground/40 ${
                                  d.frei ? "bg-muted-foreground/10" : ""
                                }`}
                              >
                                ·
                              </td>
                            );
                          }
                          const worked =
                            cell.tag.tag_status === "baustelle" ||
                            cell.tag.tag_status === "firma";
                          return (
                            <td
                              key={d.iso}
                              onClick={() =>
                                setEditTag({
                                  tag: cell,
                                  mitarbeiterName: `${r.ma!.vorname ?? ""} ${r.ma!.nachname ?? ""}`.trim(),
                                })
                              }
                              title={`${STATUS_LABEL[cell.tag.tag_status]} — bearbeiten`}
                              className={`border text-center tabular-nums cursor-pointer hover:bg-primary/10 ${
                                worked
                                  ? ""
                                  : "bg-amber-50 text-amber-900 font-semibold"
                              }`}
                            >
                              {worked
                                ? fmtHNum(Number(cell.tag.netto_stunden))
                                : RASTER_KUERZEL[cell.tag.tag_status] ?? "?"}
                            </td>
                          );
                        })}
                        <td className="border px-2 text-right tabular-nums font-semibold">
                          {fmtHNum(r.ist)}
                        </td>
                        <td className="border px-2 text-right tabular-nums">
                          {fmtHNum(r.soll)}
                        </td>
                        <td
                          className={`border px-2 text-right tabular-nums font-bold ${
                            r.diff > 0
                              ? "text-emerald-700"
                              : r.diff < 0
                              ? "text-amber-700"
                              : ""
                          }`}
                        >
                          {r.diff > 0 ? "+" : ""}
                          {fmtHNum(r.diff)}
                        </td>
                      </tr>
                    ))}
                    {byMa.length > 0 && (
                      <tr className="border-t-2 bg-muted/40 font-semibold">
                        <td className="sticky left-0 bg-muted/40 px-2 py-1 border-r z-10">
                          Summe
                        </td>
                        {periodeTage.map((d) => {
                          let s = 0;
                          for (const r of byMa) {
                            const c = tagByUidIso.get(r.uid)?.get(d.iso);
                            if (
                              c &&
                              (c.tag.tag_status === "baustelle" ||
                                c.tag.tag_status === "firma")
                            )
                              s += Number(c.tag.netto_stunden);
                          }
                          return (
                            <td
                              key={d.iso}
                              className={`border text-center tabular-nums text-[10px] ${
                                d.frei ? "bg-muted-foreground/10" : ""
                              }`}
                            >
                              {s > 0 ? fmtHNum(s) : ""}
                            </td>
                          );
                        })}
                        <td className="border px-2 text-right tabular-nums">
                          {fmtHNum(byMa.reduce((a, r) => a + r.ist, 0))}
                        </td>
                        <td className="border px-2 text-right tabular-nums">
                          {fmtHNum(byMa.reduce((a, r) => a + r.soll, 0))}
                        </td>
                        <td className="border px-2 text-right tabular-nums">
                          {fmtHNum(byMa.reduce((a, r) => a + r.diff, 0))}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="p-2 text-[10px] text-muted-foreground">
                Zahl = gebuchte Stunden · U Urlaub · K Krank · SW Schlechtwetter ·
                F Feiertag · Klick auf eine Zelle öffnet den Tag.
              </div>
            </CardContent>
          </Card>
        ))}

      {/* Baustellenauswertung: Stunden je Mitarbeiter auf einer Baustelle */}
      {ansicht === "baustellen" && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Label className="text-xs">Baustelle</Label>
              <select
                value={selectedBaustelle}
                onChange={(e) => setSelectedBaustelle(e.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm min-w-[220px]"
              >
                <option value="">— Baustelle wählen —</option>
                {baustellenMitBuchungen.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              {baustellenMitBuchungen.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  Keine gebuchten Stunden im Zeitraum.
                </span>
              )}
            </div>

            {selectedBaustelle && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mitarbeiter</TableHead>
                    <TableHead className="text-right">Stunden</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baustelleRows.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={2}
                        className="text-center text-sm text-muted-foreground p-6"
                      >
                        Keine Stunden auf dieser Baustelle.
                      </TableCell>
                    </TableRow>
                  )}
                  {baustelleRows.map((r) => (
                    <TableRow key={r.uid}>
                      <TableCell className="text-sm font-medium">
                        {r.name}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {fmtHNum(r.stunden)} h
                      </TableCell>
                    </TableRow>
                  ))}
                  {baustelleRows.length > 0 && (
                    <TableRow className="bg-muted/30 font-semibold">
                      <TableCell className="text-right text-sm">Gesamt</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtHNum(
                          baustelleRows.reduce((s, r) => s + r.stunden, 0),
                        )}{" "}
                        h
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Monatsabschluss-Section am Ende der Auswertung */}
      {isAdmin && byMa.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <Lock className="h-4 w-4 text-primary" />
                  Periode abschließen
                </h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-xl">
                  Bucht die Differenz Soll/Ist als ZA-Buchung pro Mitarbeiter und
                  sperrt die Periode gegen nachträgliche Änderungen. Periode kann
                  später wieder geöffnet werden.
                </p>
              </div>
              <Button
                size="sm"
                onClick={schliesseAlleAb}
                disabled={offeneAbschluesse.length === 0 || abschlussBusy}
              >
                {abschlussBusy && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                <Lock className="h-3.5 w-3.5 mr-1" />
                Alle offenen abschließen ({offeneAbschluesse.length})
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Mitarbeiter</TableHead>
                  <TableHead className="text-xs text-right">Soll</TableHead>
                  <TableHead className="text-xs text-right">Ist</TableHead>
                  <TableHead className="text-xs text-right">Differenz</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">Aktion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byMa.map((r) => {
                  const ab = abschluss[r.uid];
                  return (
                    <TableRow key={r.uid}>
                      <TableCell className="text-sm">
                        {r.ma!.nachname} {r.ma!.vorname}
                      </TableCell>
                      <TableCell className="text-sm text-right tabular-nums">
                        {fmtHNum(r.soll)} h
                      </TableCell>
                      <TableCell className="text-sm text-right tabular-nums">
                        {fmtHNum(r.ist)} h
                      </TableCell>
                      <TableCell
                        className={`text-sm text-right tabular-nums font-bold ${
                          r.diff > 0 ? "text-emerald-700" : r.diff < 0 ? "text-amber-700" : ""
                        }`}
                      >
                        {r.diff > 0 ? "+" : ""}
                        {fmtHNum(r.diff)} h
                      </TableCell>
                      <TableCell>
                        {ab ? (
                          <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-900 border-emerald-300">
                            Abgeschlossen
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-900 border-amber-300">
                            Offen
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {ab ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => oeffneEinen(r.uid)}
                            className="h-7 px-2"
                          >
                            <Unlock className="h-3.5 w-3.5 mr-1" /> Öffnen
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => schliesseEinenAb(r.uid)}
                            className="h-7 px-2"
                          >
                            <Lock className="h-3.5 w-3.5 mr-1" /> Abschließen
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Tag-Edit-Modal */}
      <AdminTagEditModal
        open={!!editTag}
        onOpenChange={(v) => !v && setEditTag(null)}
        tag={editTag?.tag ?? null}
        mitarbeiterName={editTag?.mitarbeiterName ?? ""}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["stunden_tage_list"] });
          ladeAbschluesse();
        }}
      />
    </div>
  );
}

function DetailMa({
  list,
  soll,
  ist,
  diff,
  taetigkeitenStamm,
  zulagenTypen,
  pausen,
  pausenDauer,
  limits,
  onEditTag,
}: {
  list: ReturnType<typeof useStundenTageList>["data"];
  soll: number;
  ist: number;
  diff: number;
  taetigkeitenStamm: Database["public"]["Tables"]["taetigkeiten_stamm"]["Row"][];
  zulagenTypen: Database["public"]["Tables"]["zulagen_typen"]["Row"][];
  pausen: { vm: any; mittag: any } | undefined;
  pausenDauer: PausenDauer;
  limits: any;
  onEditTag?: (t: StundenTagFull) => void;
}) {
  const tage = list ?? [];
  const aggTaet = aggregiereTaetigkeiten(tage, taetigkeitenStamm);
  const aggZul = aggregiereZulagen(tage, zulagenTypen);
  const aggTg = aggregiereTaggeld(tage, pausenDauer);

  return (
    <div className="p-3 space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Datum</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-xs text-right">Netto</TableHead>
            <TableHead className="text-xs text-right">Pause</TableHead>
            <TableHead className="text-xs text-right">Brutto</TableHead>
            <TableHead className="text-xs text-right">Von-Bis</TableHead>
            <TableHead className="text-xs">Tätigkeiten / Zulagen</TableHead>
            <TableHead className="text-xs text-center">Taggeld</TableHead>
            <TableHead className="text-xs text-right w-16">Edit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tage.map((t) => {
            const isArbeit = t.tag.tag_status === "baustelle" || t.tag.tag_status === "firma";
            const zeiten =
              isArbeit && pausen
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
            const tg = taggeldFuerTag(t, pausenDauer);
            const tgKurz = tg.kurz;
            const tgLang = tg.lang;
            return (
              <TableRow key={t.tag.id}>
                <TableCell className="text-xs tabular-nums">
                  {new Date(t.tag.datum).toLocaleDateString("de-AT", {
                    weekday: "short",
                    day: "2-digit",
                    month: "2-digit",
                  })}
                </TableCell>
                <TableCell className="text-xs">
                  <Badge variant="outline" className="text-[10px]">
                    {STATUS_LABEL[t.tag.tag_status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-right tabular-nums">
                  {fmtH(Number(t.tag.netto_stunden))}
                </TableCell>
                <TableCell className="text-xs text-right tabular-nums">
                  {zeiten && zeiten.pausenMinuten > 0
                    ? `${zeiten.pausenMinuten} min`
                    : "—"}
                </TableCell>
                <TableCell className="text-xs text-right tabular-nums">
                  {zeiten ? fmtH(zeiten.bruttoAnwesenheit) : "—"}
                </TableCell>
                <TableCell className="text-xs text-right tabular-nums">
                  {zeiten ? `${zeiten.von}–${zeiten.bis}` : "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {t.taetigkeiten
                    .map(
                      (tt) =>
                        taetigkeitenStamm.find((s) => s.id === tt.taetigkeit_id)?.bezeichnung ??
                        tt.taetigkeit_freitext ??
                        "—",
                    )
                    .join(", ")}
                  {t.zulagen.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {t.zulagen.map((z) => {
                        const typ = zulagenTypen.find((x) => x.id === z.zulagen_typ_id);
                        return (
                          <span
                            key={z.id}
                            className="text-[9px] px-1 rounded bg-amber-50 text-amber-900 border border-amber-200"
                          >
                            {typ?.bezeichnung ?? "Zulage"}
                            {z.stunden !== null && ` ${z.stunden}h`}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-xs text-center tabular-nums">
                  {tgLang > 0 ? (
                    <span className="px-1 rounded bg-sky-100 text-sky-900 border border-sky-300 text-[10px]">
                      {tgLang}× lang
                    </span>
                  ) : tgKurz > 0 ? (
                    <span className="px-1 rounded bg-sky-50 text-sky-900 border border-sky-200 text-[10px]">
                      {tgKurz}× kurz
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {onEditTag && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => onEditTag(t)}
                      title="Tag bearbeiten"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Aggregations-Block am Ende der Detail-View */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <Card>
          <CardContent className="p-3 space-y-1">
            <div className="font-semibold text-muted-foreground uppercase text-[10px]">
              Tätigkeiten im Monat
            </div>
            {aggTaet.length === 0 ? (
              <div className="text-muted-foreground italic">Keine Tätigkeiten erfasst</div>
            ) : (
              aggTaet.map((a) => (
                <div key={a.bezeichnung} className="flex justify-between tabular-nums">
                  <span className="truncate pr-2">{a.bezeichnung}</span>
                  <span className="font-medium">{fmtHNum(a.summe_stunden)} h</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 space-y-1">
            <div className="font-semibold text-muted-foreground uppercase text-[10px]">Zulagen</div>
            {aggZul.length === 0 ? (
              <div className="text-muted-foreground italic">Keine Zulagen</div>
            ) : (
              aggZul.map((z) => (
                <div key={z.bezeichnung} className="flex justify-between tabular-nums">
                  <span className="truncate pr-2">{z.bezeichnung}</span>
                  <span className="font-medium">
                    {fmtHNum(z.summe_stunden)} h · {z.anzahl_tage} Tag{z.anzahl_tage === 1 ? "" : "e"}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 space-y-1">
            <div className="font-semibold text-muted-foreground uppercase text-[10px]">Taggeld</div>
            <div className="flex justify-between tabular-nums">
              <span>Kurz ({fmtEur(TAGGELD_SATZ_KURZ_EUR)})</span>
              <span className="font-medium">
                {aggTg.kurz_anzahl}× · {fmtEur(aggTg.kurz_eur)}
              </span>
            </div>
            <div className="flex justify-between tabular-nums">
              <span>Lang ({fmtEur(TAGGELD_SATZ_LANG_EUR)})</span>
              <span className="font-medium">
                {aggTg.lang_anzahl}× · {fmtEur(aggTg.lang_eur)}
              </span>
            </div>
            <div className="flex justify-between tabular-nums pt-1 border-t font-semibold">
              <span>Summe</span>
              <span>{fmtEur(aggTg.total_eur)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 space-y-1">
            <div className="font-semibold text-muted-foreground uppercase text-[10px]">
              Soll · Ist · Differenz
            </div>
            <div className="flex justify-between tabular-nums">
              <span>Soll (Kalender)</span>
              <span className="font-medium">{fmtHNum(soll)} h</span>
            </div>
            <div className="flex justify-between tabular-nums">
              <span>Ist (inkl. Abwesenheit)</span>
              <span className="font-medium">{fmtHNum(ist)} h</span>
            </div>
            <div className="flex justify-between tabular-nums pt-1 border-t font-semibold">
              <span>Differenz</span>
              <span className={diff > 0 ? "text-emerald-700" : diff < 0 ? "text-amber-700" : ""}>
                {diff > 0 ? "+" : ""}
                {fmtHNum(diff)} h
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground pt-1">
              → wird beim Monatsabschluss als ZA-Buchung gespeichert.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
