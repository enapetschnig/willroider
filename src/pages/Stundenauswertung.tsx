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
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
} from "lucide-react";
import type { Database, TagStatus, BuchungStatus } from "@/integrations/supabase/types";
import { useStundenTageList } from "@/hooks/useStundenTag";
import { usePausenConfig, useArbeitszeitLimits, useTaetigkeitenStamm, useZulagenTypen } from "@/hooks/useStammdatenStunden";
import { berechneTagZeiten, fmtH, fmtHNum } from "@/lib/zeiterfassung";
import {
  aggregiereTaetigkeiten,
  aggregiereZulagen,
  aggregiereTaggeld,
  fmtEur,
  TAGGELD_SATZ_KURZ_EUR,
  TAGGELD_SATZ_LANG_EUR,
} from "@/lib/stundenAggregation";
import {
  makeStundenzettelPdf,
  makeAlleStundenzettelPdf,
  type StundenzettelData,
} from "@/lib/stundenZettelPdf";
import { FileText } from "lucide-react";

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

const STATUS_BADGE: Record<BuchungStatus, { label: string; cls: string }> = {
  erfasst: { label: "Erfasst", cls: "bg-blue-100 text-blue-900 border-blue-300" },
  ma_bestaetigt: { label: "Best.", cls: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  zm_freigabe: { label: "ZM", cls: "bg-purple-100 text-purple-900 border-purple-300" },
  buero_freigabe: { label: "Büro", cls: "bg-orange-100 text-orange-900 border-orange-300" },
  exportiert: { label: "Export.", cls: "bg-gray-300 text-gray-900 border-gray-400" },
  abgelehnt: { label: "Abgel.", cls: "bg-red-100 text-red-900 border-red-300" },
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

function monatRange(monat: string) {
  const [y, m] = monat.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

export default function Stundenauswertung() {
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const [monat, setMonat] = useState(currentMonth());
  const [members, setMembers] = useState<Profile[]>([]);
  const [partien, setPartien] = useState<Partie[]>([]);
  const [partieFilter, setPartieFilter] = useState<string>("");
  const [expandedUid, setExpandedUid] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: m }, { data: p }] = await Promise.all([
        supabase
          .from("profiles")
          .select("*")
          .eq("is_active", true)
          .order("nachname"),
        supabase.from("partien").select("*").order("name"),
      ]);
      setMembers((m as Profile[]) ?? []);
      setPartien((p as Partie[]) ?? []);
    })();
  }, []);

  const { from, to } = monatRange(monat);
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

  // Soll-Stunden pro MA aus Konto-Settings + Werktagen
  const [pks, setPks] = useState<
    Map<string, { tagesnorm: number; beschaeftigungsgrad: number; za_faktor: number }>
  >(new Map());
  useEffect(() => {
    (async () => {
      if (memberIds.length === 0) return;
      const { data } = await supabase
        .from("profile_konten_settings")
        .select("profile_id, tagesnorm_stunden, beschaeftigungsgrad, za_faktor")
        .in("profile_id", memberIds);
      const map = new Map<string, any>();
      (data ?? []).forEach((r: any) => {
        map.set(r.profile_id, {
          tagesnorm: Number(r.tagesnorm_stunden ?? 8),
          beschaeftigungsgrad: Number(r.beschaeftigungsgrad ?? 1),
          za_faktor: Number(r.za_faktor ?? 1),
        });
      });
      setPks(map);
    })();
  }, [JSON.stringify(memberIds), monat]);

  const werktage = useMemo(() => {
    const [y, m] = monat.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    let count = 0;
    for (let d = 1; d <= last; d++) {
      const dow = new Date(y, m - 1, d).getDay();
      if (dow !== 0 && dow !== 6) count++;
    }
    return count;
  }, [monat]);

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
        const soll = werktage * tagesnorm * beschgrad;
        const ist = list.reduce((a, t) => a + Number(t.tag.netto_stunden), 0);
        return { uid, ma: m, list, soll, ist, diff: ist - soll };
      })
      .filter((r) => r.ma);
  }, [tage, memberIds, members, pks, werktage]);

  const moveMonat = (delta: number) => {
    const [y, m] = monat.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonat(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

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
      "Mitarbeiter;Datum;Status;Netto;Brutto;Von;Bis;Anwesenheit (min);Tätigkeiten;Zulagen;Taggeld_kurz;Taggeld_lang;Anmerkung;Workflow",
    );
    // IDs aller buero_freigabe-Tage sammeln — diese werden nach Export auf 'exportiert' gesetzt
    const idsZuExportieren: string[] = [];
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
        const tgKurz = Number(t.fahrt?.taggeld_kurz ?? 0);
        const tgLang = Number(t.fahrt?.taggeld_lang ?? 0);
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
            STATUS_BADGE[t.tag.status].label,
          ].join(";"),
        );
        if (t.tag.status === "buero_freigabe") {
          idsZuExportieren.push(t.tag.id);
        }
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

    // Nach erfolgreichem Export: buero_freigabe-Tage auf 'exportiert' setzen
    if (idsZuExportieren.length > 0) {
      if (
        window.confirm(
          `${idsZuExportieren.length} freigegebene Tage als „exportiert" markieren?\n` +
            `(Verhindert Doppel-Export beim nächsten Mal)`,
        )
      ) {
        const { error } = await supabase
          .from("stunden_tage")
          .update({ status: "exportiert" })
          .in("id", idsZuExportieren);
        if (error) {
          toast({
            variant: "destructive",
            title: "Status-Update fehlgeschlagen",
            description: error.message,
          });
        } else {
          toast({
            title: `${idsZuExportieren.length} Tage als „exportiert" markiert`,
          });
        }
      }
    }
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
              {monatLabel(monat)} · {werktage} Werktage
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

      {/* MA-Übersicht */}
      {isLoading ? (
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
                  <TableHead className="text-right">Ist (Netto)</TableHead>
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
                              limits={limits}
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
      )}
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
  limits,
}: {
  list: ReturnType<typeof useStundenTageList>["data"];
  soll: number;
  ist: number;
  diff: number;
  taetigkeitenStamm: Database["public"]["Tables"]["taetigkeiten_stamm"]["Row"][];
  zulagenTypen: Database["public"]["Tables"]["zulagen_typen"]["Row"][];
  pausen: { vm: any; mittag: any } | undefined;
  limits: any;
}) {
  const tage = list ?? [];
  const aggTaet = aggregiereTaetigkeiten(tage, taetigkeitenStamm);
  const aggZul = aggregiereZulagen(tage, zulagenTypen);
  const aggTg = aggregiereTaggeld(tage);

  return (
    <div className="p-3 space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Datum</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-xs text-right">Netto</TableHead>
            <TableHead className="text-xs text-right">Brutto</TableHead>
            <TableHead className="text-xs text-right">Von-Bis</TableHead>
            <TableHead className="text-xs">Tätigkeiten / Zulagen</TableHead>
            <TableHead className="text-xs text-center">Taggeld</TableHead>
            <TableHead className="text-xs">Workflow</TableHead>
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
            const tgKurz = Number(t.fahrt?.taggeld_kurz ?? 0);
            const tgLang = Number(t.fahrt?.taggeld_lang ?? 0);
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
                <TableCell className="text-xs">
                  <Badge variant="outline" className={`text-[10px] ${STATUS_BADGE[t.tag.status].cls}`}>
                    {STATUS_BADGE[t.tag.status].label}
                  </Badge>
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
              <span>Ist (Netto)</span>
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
