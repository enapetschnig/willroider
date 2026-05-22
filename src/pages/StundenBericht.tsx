/**
 * Baustellenstundenbericht — Durchsicht-/Unterschrift-/Kontroll-Ansicht.
 *
 * Zeigt einen Halbmonats-Bericht eines Mitarbeiters als Raster
 * (Baustellen × Tage), handytauglich. Geänderte Tage (Abweichung vom
 * Snapshot bei Erzeugung) sind gelb. Workflow: offen → unterschrieben →
 * bestaetigt.
 */

import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  ChevronLeft,
  Loader2,
  PenLine,
  CheckCircle2,
  Unlock,
  AlertTriangle,
  History,
  FileText,
} from "lucide-react";
import type { Database, TagStatus, BuchungStatus, StundenBerichtStatus } from "@/integrations/supabase/types";
import { localIso } from "@/lib/dateFmt";
import { fmtHNum } from "@/lib/zeiterfassung";
import { useStundenTageList, type StundenTagFull } from "@/hooks/useStundenTag";
import {
  useStundenBericht,
  useStundenBerichtAktionen,
  logBerichtAenderung,
} from "@/hooks/useStundenBericht";
import { geaenderteTage, type BerichtSnapshot } from "@/lib/stundenBerichtDiff";
import { AdminTagEditModal } from "@/components/admin/AdminTagEditModal";
import { UnterschriftDialog } from "@/components/UnterschriftDialog";
import { useZulagenTypen } from "@/hooks/useStammdatenStunden";
import { aggregiereZulagen } from "@/lib/stundenAggregation";
import {
  makeBaustellenstundenberichtPdf,
  type BsbPdfRow,
} from "@/lib/baustellenstundenberichtPdf";

const STATUS_LABEL: Record<TagStatus, string> = {
  baustelle: "Baustelle",
  firma: "Firma",
  krank: "Krank",
  urlaub: "Urlaub",
  schlechtwetter: "Schlechtwetter",
  feiertag: "Feiertag",
};
const ABWESEND_KUERZEL: Partial<Record<TagStatus, string>> = {
  urlaub: "U",
  krank: "K",
  schlechtwetter: "SW",
  feiertag: "F",
};
const ART_ORDER: Record<TagStatus, number> = {
  baustelle: 0,
  firma: 1,
  urlaub: 2,
  krank: 3,
  schlechtwetter: 4,
  feiertag: 5,
};

const STATUS_BADGE: Record<
  StundenBerichtStatus,
  { label: string; cls: string }
> = {
  offen: {
    label: "Offen — bitte durchsehen",
    cls: "bg-slate-100 text-slate-800 border-slate-300",
  },
  unterschrieben: {
    label: "Unterschrieben — bei der Kontrolle",
    cls: "bg-blue-100 text-blue-900 border-blue-300",
  },
  bestaetigt: {
    label: "Bestätigt & abgeschlossen",
    cls: "bg-emerald-100 text-emerald-900 border-emerald-300",
  },
  versendet: {
    label: "An die Lohnverrechnung versendet",
    cls: "bg-emerald-100 text-emerald-900 border-emerald-300",
  },
};

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function fmtTag(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
}

/** Synthetischer leerer Tag — für das Erfassen eines bisher leeren Datums. */
function leererTag(mitarbeiterId: string, datum: string): StundenTagFull {
  return {
    tag: {
      id: "",
      mitarbeiter_id: mitarbeiterId,
      datum,
      tag_status: "baustelle",
      netto_stunden: 0,
      vm_pause: false,
      mittag_pause: false,
      arbeitsbeginn: null,
      anmerkung: null,
      status: "erfasst" as BuchungStatus,
      erfasst_von: null,
      bestaetigt_am: null,
      freigegeben_zm_id: null,
      freigegeben_zm_am: null,
      freigegeben_buero_id: null,
      freigegeben_buero_am: null,
      abgelehnt_grund: null,
      created_at: "",
      updated_at: "",
    },
    taetigkeiten: [],
    zulagen: [],
    fahrt: null,
  };
}

interface RasterRow {
  key: string;
  art: TagStatus;
  label: string;
  kostenstelle: string;
  perDay: Map<string, number>;
}

export default function StundenBericht() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();

  const { data: bericht, isLoading } = useStundenBericht(id);
  const aktionen = useStundenBerichtAktionen();

  const { data: tage = [] } = useStundenTageList({
    fromDate: bericht?.von_datum ?? "2000-01-01",
    toDate: bericht?.bis_datum ?? "2000-01-01",
    mitarbeiterIds: bericht?.mitarbeiter_id ? [bericht.mitarbeiter_id] : [],
    enabled: !!bericht,
  });

  const { data: baustellen = [] } = useQuery({
    queryKey: ["baustellen_kostenstelle"],
    queryFn: async () => {
      const { data } = await supabase
        .from("baustellen")
        .select("id, bvh_name, kostenstelle");
      return (data as { id: string; bvh_name: string; kostenstelle: string | null }[]) ?? [];
    },
  });
  const baustelleMap = useMemo(
    () => new Map(baustellen.map((b) => [b.id, b])),
    [baustellen],
  );

  const { data: zulagenTypen = [] } = useZulagenTypen();

  const [editTag, setEditTag] = useState<StundenTagFull | null>(null);
  const [signOpen, setSignOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const geaendert = useMemo(
    () => geaenderteTage(bericht?.snapshot as BerichtSnapshot | undefined, tage),
    [bericht?.snapshot, tage],
  );

  const tagByIso = useMemo(() => {
    const m = new Map<string, StundenTagFull>();
    for (const t of tage) m.set(t.tag.datum, t);
    return m;
  }, [tage]);

  const periodeTage = useMemo(() => {
    if (!bericht) return [] as { iso: string; tag: number; wd: string; frei: boolean }[];
    const out: { iso: string; tag: number; wd: string; frei: boolean }[] = [];
    const d = new Date(bericht.von_datum + "T00:00:00");
    const end = new Date(bericht.bis_datum + "T00:00:00");
    while (d <= end) {
      const iso = localIso(d);
      const dow = d.getDay();
      out.push({ iso, tag: d.getDate(), wd: WD[dow], frei: dow === 0 || dow === 6 });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [bericht]);

  const rows = useMemo(() => {
    const map = new Map<string, RasterRow>();
    for (const t of tage) {
      for (const e of t.taetigkeiten) {
        let key: string;
        let label: string;
        let kst = "";
        if (e.art === "baustelle") {
          key = `b:${e.baustelle_id ?? "none"}`;
          const b = e.baustelle_id ? baustelleMap.get(e.baustelle_id) : null;
          label = b?.bvh_name ?? "Baustelle";
          kst = b?.kostenstelle ?? "";
        } else if (e.art === "firma") {
          key = "firma";
          label = "Firma";
        } else {
          key = e.art;
          label = STATUS_LABEL[e.art];
        }
        let row = map.get(key);
        if (!row) {
          row = { key, art: e.art, label, kostenstelle: kst, perDay: new Map() };
          map.set(key, row);
        }
        row.perDay.set(
          t.tag.datum,
          (row.perDay.get(t.tag.datum) ?? 0) + Number(e.stunden || 0),
        );
      }
    }
    return [...map.values()].sort(
      (a, b) =>
        ART_ORDER[a.art] - ART_ORDER[b.art] || a.label.localeCompare(b.label),
    );
  }, [tage, baustelleMap]);

  const zulagenAgg = useMemo(
    () => aggregiereZulagen(tage, zulagenTypen),
    [tage, zulagenTypen],
  );

  if (isLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Lade Bericht…
      </div>
    );
  }
  if (!bericht) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-muted-foreground">
          Bericht nicht gefunden oder kein Zugriff.
        </p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Zurück
        </Button>
      </div>
    );
  }

  const istEigentuemer = bericht.mitarbeiter_id === user?.id;
  const editierbar =
    (bericht.status === "offen" && istEigentuemer) ||
    (bericht.status === "unterschrieben" && isAdmin);
  const kannUnterschreiben = bericht.status === "offen" && istEigentuemer;
  const kannBestaetigen = bericht.status === "unterschrieben" && isAdmin;
  const kannWiederOeffnen = bericht.status === "bestaetigt" && isAdmin;

  const maName = bericht.mitarbeiter
    ? `${bericht.mitarbeiter.vorname ?? ""} ${bericht.mitarbeiter.nachname ?? ""}`.trim()
    : "Mitarbeiter";
  const monatName = new Date(bericht.jahr, bericht.monat - 1, 1).toLocaleDateString(
    "de-AT",
    { month: "long" },
  );
  const teilLabel =
    bericht.teil === 1 ? "Teil I (1.–16.)" : "Teil II (17.–Monatsende)";
  const badge = STATUS_BADGE[bericht.status];

  const openTag = (iso: string) => {
    if (!editierbar) return;
    setEditTag(tagByIso.get(iso) ?? leererTag(bericht.mitarbeiter_id, iso));
  };

  const onTagSaved = async (iso: string) => {
    await qc.invalidateQueries({ queryKey: ["stunden_tage_list"] });
    await logBerichtAenderung(
      bericht.id,
      "tag_geaendert",
      `Tag ${fmtTag(iso)} bearbeitet`,
    );
    qc.invalidateQueries({ queryKey: ["stunden_bericht", bericht.id] });
  };

  const handleUnterschrift = async (dataUrl: string) => {
    try {
      await aktionen.unterschreiben.mutateAsync({ id: bericht.id, unterschrift: dataUrl });
      setSignOpen(false);
      toast({ title: "Unterschrieben", description: "Der Bericht geht jetzt an die Kontrolle." });
    } catch (e) {
      toast({ variant: "destructive", title: "Fehler", description: (e as Error).message });
    }
  };

  const handleBestaetigen = async () => {
    if (!window.confirm("Bericht bestätigen? Die Periode wird damit abgeschlossen (ZA-Buchung)."))
      return;
    try {
      await aktionen.bestaetigen.mutateAsync(bericht.id);
      toast({ title: "Bestätigt", description: "Periode abgeschlossen, ZA gebucht." });
    } catch (e) {
      toast({ variant: "destructive", title: "Fehler", description: (e as Error).message });
    }
  };

  const handleWiederOeffnen = async () => {
    if (!window.confirm("Bericht wieder öffnen? Die ZA-Buchung wird zurückgenommen."))
      return;
    try {
      await aktionen.wiederOeffnen.mutateAsync(bericht.id);
      toast({ title: "Wieder geöffnet" });
    } catch (e) {
      toast({ variant: "destructive", title: "Fehler", description: (e as Error).message });
    }
  };

  const handlePdf = async () => {
    setPdfBusy(true);
    try {
      const pdfRows: BsbPdfRow[] = rows.map((row) => {
        const arbeit = row.art === "baustelle" || row.art === "firma";
        return {
          kostenstelle: row.kostenstelle,
          baustelle: row.label,
          zellen: periodeTage.map((d) => {
            const v = row.perDay.get(d.iso);
            return v === undefined
              ? ""
              : arbeit
              ? fmtHNum(v)
              : ABWESEND_KUERZEL[row.art] ?? "✓";
          }),
          summe: arbeit
            ? fmtHNum([...row.perDay.values()].reduce((s, v) => s + v, 0))
            : "",
        };
      });
      const summenZeile = periodeTage.map((d) => {
        let s = 0;
        for (const r of rows) {
          if (r.art === "baustelle" || r.art === "firma")
            s += r.perDay.get(d.iso) ?? 0;
        }
        return s > 0 ? fmtHNum(s) : "";
      });
      const summeGesamt = fmtHNum(
        rows
          .filter((r) => r.art === "baustelle" || r.art === "firma")
          .reduce(
            (s, r) => s + [...r.perDay.values()].reduce((a, v) => a + v, 0),
            0,
          ),
      );
      const doc = await makeBaustellenstundenberichtPdf({
        teilLabel:
          bericht.teil === 1
            ? "Teil I v. 1. bis 16."
            : "Teil II v. 17. bis Monatsende",
        monat: monatName,
        jahr: bericht.jahr,
        name: maName,
        persNr: bericht.mitarbeiter?.pers_nr ?? "",
        eintritt: bericht.eintrittsdatum
          ? new Date(bericht.eintrittsdatum).toLocaleDateString("de-AT")
          : "",
        austritt: "",
        tage: periodeTage.map((d) => d.tag),
        tageIso: periodeTage.map((d) => d.iso),
        geaendert,
        rows: pdfRows,
        summenZeile,
        summeGesamt,
        zulagen: zulagenAgg.map(
          (z) => `${z.bezeichnung} ${fmtHNum(z.summe_stunden)} h`,
        ),
        unterschrift: bericht.unterschrift_data,
        unterschriebenAm: bericht.unterschrieben_am
          ? new Date(bericht.unterschrieben_am).toLocaleDateString("de-AT")
          : null,
        bestaetigtAm: bericht.bestaetigt_am
          ? new Date(bericht.bestaetigt_am).toLocaleDateString("de-AT")
          : null,
      });
      window.open(doc.output("bloburl") as unknown as string, "_blank");
    } catch (e) {
      toast({
        variant: "destructive",
        title: "PDF-Fehler",
        description: (e as Error).message,
      });
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-28 lg:pb-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <PageHeader title="Baustellenstundenbericht" />
      </div>

      {/* Kopf */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <div className="text-base font-bold">
                {monatName} {bericht.jahr} · {teilLabel}
              </div>
              <div className="text-sm text-muted-foreground">{maName}</div>
            </div>
            <Badge variant="outline" className={badge.cls}>
              {badge.label}
            </Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div>
              <div className="text-muted-foreground">Pers.-Nr.</div>
              <div className="font-medium">{bericht.mitarbeiter?.pers_nr ?? "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Eintritt</div>
              <div className="font-medium">
                {bericht.eintrittsdatum
                  ? new Date(bericht.eintrittsdatum).toLocaleDateString("de-AT")
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Austritt</div>
              <div className="font-medium">—</div>
            </div>
            <div>
              <div className="text-muted-foreground">Zeitraum</div>
              <div className="font-medium">
                {new Date(bericht.von_datum).toLocaleDateString("de-AT")} –{" "}
                {new Date(bericht.bis_datum).toLocaleDateString("de-AT")}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Geändert-Hinweis */}
      {geaendert.size > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
          <span className="text-sm text-amber-900">
            {geaendert.size === 1
              ? "1 Tag wurde nach Erstellung geändert"
              : `${geaendert.size} Tage wurden nach Erstellung geändert`}{" "}
            — gelb markiert.
          </span>
        </div>
      )}

      {/* Raster */}
      <Card>
        <CardContent className="p-0">
          {editierbar && (
            <div className="px-3 pt-3 text-xs text-muted-foreground">
              Tippen auf eine Tages-Spalte öffnet den Tages-Editor.
            </div>
          )}
          <div className="overflow-x-auto p-3">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-card text-left px-2 py-1 border-r min-w-[150px] z-10">
                    Kostenstelle / Baustelle
                  </th>
                  {periodeTage.map((d) => (
                    <th
                      key={d.iso}
                      onClick={() => openTag(d.iso)}
                      className={`px-1 py-1 border text-center w-9 ${
                        editierbar ? "cursor-pointer" : ""
                      } ${
                        geaendert.has(d.iso)
                          ? "bg-amber-200"
                          : d.frei
                          ? "bg-muted-foreground/10 text-muted-foreground"
                          : ""
                      }`}
                    >
                      <div className="font-semibold">{d.tag}</div>
                      <div className="text-[9px] font-normal">{d.wd}</div>
                    </th>
                  ))}
                  <th className="px-2 py-1 border text-right">Σ</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={periodeTage.length + 2}
                      className="text-center text-sm text-muted-foreground p-6"
                    >
                      Keine Stunden in dieser Periode erfasst.
                    </td>
                  </tr>
                )}
                {rows.map((row) => {
                  const istArbeit = row.art === "baustelle" || row.art === "firma";
                  const summe = [...row.perDay.values()].reduce((s, v) => s + v, 0);
                  return (
                    <tr key={row.key} className="border-t">
                      <td className="sticky left-0 bg-card px-2 py-1 border-r z-10">
                        <div className="font-medium leading-tight">{row.label}</div>
                        {row.kostenstelle && (
                          <div className="text-[10px] text-muted-foreground">
                            KST {row.kostenstelle}
                          </div>
                        )}
                      </td>
                      {periodeTage.map((d) => {
                        const v = row.perDay.get(d.iso);
                        return (
                          <td
                            key={d.iso}
                            onClick={() => openTag(d.iso)}
                            className={`border text-center tabular-nums ${
                              editierbar ? "cursor-pointer hover:bg-primary/5" : ""
                            } ${
                              geaendert.has(d.iso)
                                ? "bg-amber-100"
                                : d.frei
                                ? "bg-muted-foreground/5"
                                : ""
                            }`}
                          >
                            {v === undefined
                              ? ""
                              : istArbeit
                              ? fmtHNum(v)
                              : ABWESEND_KUERZEL[row.art] ?? "✓"}
                          </td>
                        );
                      })}
                      <td className="border px-2 text-right tabular-nums font-semibold">
                        {istArbeit ? fmtHNum(summe) : ""}
                      </td>
                    </tr>
                  );
                })}
                {rows.length > 0 && (
                  <tr className="border-t-2 bg-muted/40 font-semibold">
                    <td className="sticky left-0 bg-muted/40 px-2 py-1 border-r z-10">
                      Summe
                    </td>
                    {periodeTage.map((d) => {
                      let s = 0;
                      for (const r of rows) {
                        if (r.art === "baustelle" || r.art === "firma")
                          s += r.perDay.get(d.iso) ?? 0;
                      }
                      return (
                        <td
                          key={d.iso}
                          className={`border text-center tabular-nums text-[10px] ${
                            geaendert.has(d.iso) ? "bg-amber-100" : ""
                          }`}
                        >
                          {s > 0 ? fmtHNum(s) : ""}
                        </td>
                      );
                    })}
                    <td className="border px-2 text-right tabular-nums">
                      {fmtHNum(
                        rows
                          .filter((r) => r.art === "baustelle" || r.art === "firma")
                          .reduce(
                            (s, r) =>
                              s + [...r.perDay.values()].reduce((a, v) => a + v, 0),
                            0,
                          ),
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Legende */}
          <div className="px-3 pb-3 text-[11px] text-muted-foreground">
            ZA = Zeitausgleich · K = Krankenstand · U = Urlaub · F = Feiertag ·
            SW = Schlechtwetter · S = Sozialstunden
          </div>
        </CardContent>
      </Card>

      {/* Zulagen */}
      {zulagenAgg.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-1">
            <div className="text-xs font-semibold uppercase text-muted-foreground">
              Zulagen
            </div>
            {zulagenAgg.map((z) => (
              <div key={z.bezeichnung} className="flex justify-between text-sm tabular-nums">
                <span>{z.bezeichnung}</span>
                <span className="font-medium">
                  {fmtHNum(z.summe_stunden)} h · {z.anzahl_tage} Tag
                  {z.anzahl_tage === 1 ? "" : "e"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Unterschriften */}
      <Card>
        <CardContent className="p-4 grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="text-xs font-semibold uppercase text-muted-foreground">
              Aufgestellt (Mitarbeiter)
            </div>
            {bericht.unterschrift_data ? (
              <>
                <img
                  src={bericht.unterschrift_data}
                  alt="Unterschrift"
                  className="h-16 border rounded bg-white"
                />
                <div className="text-xs text-muted-foreground">
                  {maName} ·{" "}
                  {bericht.unterschrieben_am
                    ? new Date(bericht.unterschrieben_am).toLocaleDateString("de-AT")
                    : ""}
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground italic">
                Noch nicht unterschrieben
              </div>
            )}
          </div>
          <div className="space-y-1">
            <div className="text-xs font-semibold uppercase text-muted-foreground">
              Geprüft (Büro)
            </div>
            {bericht.bestaetigt_am ? (
              <div className="text-sm">
                Bestätigt am{" "}
                {new Date(bericht.bestaetigt_am).toLocaleDateString("de-AT")}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">
                Noch nicht geprüft
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Audit */}
      {bericht.aenderungen.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-1.5">
            <div className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
              <History className="h-3.5 w-3.5" /> Änderungen
            </div>
            {bericht.aenderungen.map((a) => (
              <div key={a.id} className="text-xs flex gap-2">
                <span className="text-muted-foreground tabular-nums shrink-0">
                  {new Date(a.zeitpunkt).toLocaleString("de-AT", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span>{a.details ?? a.art}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Aktionen */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={handlePdf}
          disabled={pdfBusy}
          className="min-w-[140px]"
        >
          {pdfBusy ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <FileText className="h-4 w-4 mr-1.5" />
          )}
          PDF ansehen
        </Button>
        {kannUnterschreiben && (
          <Button onClick={() => setSignOpen(true)} className="flex-1 min-w-[200px] h-12">
            <PenLine className="h-4 w-4 mr-1.5" />
            Durchgesehen & unterschreiben
          </Button>
        )}
        {kannBestaetigen && (
          <Button
            onClick={handleBestaetigen}
            disabled={aktionen.bestaetigen.isPending}
            className="flex-1 min-w-[200px] h-12"
          >
            {aktionen.bestaetigen.isPending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
            )}
            Bestätigen &amp; abschließen
          </Button>
        )}
        {kannWiederOeffnen && (
          <Button
            variant="outline"
            onClick={handleWiederOeffnen}
            disabled={aktionen.wiederOeffnen.isPending}
          >
            <Unlock className="h-4 w-4 mr-1.5" />
            Wieder öffnen
          </Button>
        )}
      </div>

      {/* Tag-Editor */}
      <AdminTagEditModal
        open={!!editTag}
        onOpenChange={(v) => !v && setEditTag(null)}
        tag={editTag}
        mitarbeiterName={maName}
        onSaved={() => {
          if (editTag) onTagSaved(editTag.tag.datum);
        }}
      />

      {/* Unterschrift */}
      <UnterschriftDialog
        open={signOpen}
        onOpenChange={setSignOpen}
        onSave={handleUnterschrift}
        titel="Bericht unterschreiben"
        busy={aktionen.unterschreiben.isPending}
      />
    </div>
  );
}
