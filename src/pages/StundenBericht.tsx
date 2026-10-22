/**
 * Baustellenstundenbericht — Durchsicht-/Unterschrift-/Kontroll-Ansicht.
 *
 * Zeigt einen Halbmonats-Bericht eines Mitarbeiters als Raster
 * (Baustellen × Tage), handytauglich. Geänderte Tage (Abweichung vom
 * Snapshot bei Erzeugung) sind gelb. Workflow: offen → unterschrieben →
 * bestaetigt. Einmal unterschrieben (= abgeschickt) ist kein Wieder-Öffnen
 * mehr möglich; vor dem Abschicken nochmal genau kontrollieren.
 */

import { useEffect, useMemo, useState } from "react";
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
  ChevronRight,
  ChevronDown,
  Loader2,
  Download,
  BellRing,
  Check,
  PenLine,
  CheckCircle2,
  AlertTriangle,
  History,
  FileText,
  Mail,
} from "lucide-react";
import type { Database, TagStatus, BuchungStatus, StundenBerichtStatus } from "@/integrations/supabase/types";
import { localIso } from "@/lib/dateFmt";
import { fmtHNum } from "@/lib/zeiterfassung";
import { useStundenTageList, type StundenTagFull } from "@/hooks/useStundenTag";
import {
  useStundenBericht,
  useStundenBerichteList,
  useStundenBerichtAktionen,
  logBerichtAenderung,
} from "@/hooks/useStundenBericht";
import { StundenberichtErinnernDialog, useLetzteErinnerung } from "@/components/StundenberichtErinnernDialog";
import { geaenderteTage, type BerichtSnapshot } from "@/lib/stundenBerichtDiff";
import { TagBearbeitenDialog } from "@/components/TagBearbeitenDialog";
import { UnterschriftDialog } from "@/components/UnterschriftDialog";
import { BsbVersendenDialog } from "@/components/BsbVersendenDialog";
import { useZulagenTypen } from "@/hooks/useStammdatenStunden";
import { aggregiereFahrtgeld, aggregiereZulagen } from "@/lib/stundenAggregation";
import { buildBerichtPdf } from "@/lib/bsbPdfHelper";
import { archiviereBericht } from "@/lib/berichtArchiv";

const STATUS_LABEL: Record<TagStatus, string> = {
  baustelle: "Baustelle",
  firma: "Firma",
  krank: "Krank",
  urlaub: "Urlaub",
  schlechtwetter: "Schlechtwetter",
  feiertag: "Feiertag",
  berufsschule: "Berufsschule",
  polierschule: "Polierschule",
};
const ABWESEND_KUERZEL: Partial<Record<TagStatus, string>> = {
  urlaub: "U",
  krank: "K",
  schlechtwetter: "SW",
  feiertag: "F",
  berufsschule: "BS",
  polierschule: "PS",
};
const ART_ORDER: Record<TagStatus, number> = {
  baustelle: 0,
  firma: 1,
  berufsschule: 2,
  polierschule: 2,
  urlaub: 3,
  krank: 4,
  schlechtwetter: 5,
  feiertag: 6,
};

/** Kurzform für die Auswahl in der Prüf-Leiste. */
const STATUS_KURZ: Record<StundenBerichtStatus, string> = {
  offen: "MA unterschreibt noch",
  unterschrieben: "wartet auf Büro",
  bestaetigt: "bestätigt, nicht versendet",
  versendet: "versendet",
};

/** Beim Durchprüfen „Passt" markierte Berichte — überlebt das Hin- und
 *  Herspringen und einen Abstecher in die Liste (nur in diesem Tab). */
const VORMERK_KEY = "bsb-vorgemerkt";
const NUR_WARTENDE_KEY = "bsb-pruefen-nur-wartende";
const ladeSession = <T,>(key: string, ersatz: T): T => {
  try {
    const v = sessionStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : ersatz;
  } catch {
    return ersatz;
  }
};
const speichereSession = (key: string, wert: unknown) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(wert));
  } catch {
    /* privater Modus — dann eben nur bis zum Neuladen */
  }
};

const STATUS_BADGE: Record<
  StundenBerichtStatus,
  { label: string; cls: string }
> = {
  offen: {
    label: "Bitte durchsehen und unterschreiben",
    cls: "bg-slate-100 text-slate-800 border-slate-300",
  },
  unterschrieben: {
    label: "Wartet auf Büro-Bestätigung",
    cls: "bg-blue-100 text-blue-900 border-blue-300",
  },
  bestaetigt: {
    label: "Bestätigt — bereit zum Versand",
    cls: "bg-emerald-100 text-emerald-900 border-emerald-300",
  },
  versendet: {
    label: "Abgeschlossen — versendet",
    cls: "bg-emerald-600 text-white border-emerald-700",
  },
};

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function fmtTag(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
}

/** Lesbarer Zeitstempel "dd.mm.yyyy, HH:MM" aus ISO-Timestamp. */
function fmtTs(ts: string | null | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const [archivBusy, setArchivBusy] = useState(false);
  const qc = useQueryClient();

  const { data: bericht, isLoading } = useStundenBericht(id);
  /** Anzahl gültiger Archiv-PDFs dieses Berichts (null = noch unbekannt). */
  const { data: archivStand = null } = useQuery({
    queryKey: ["bericht_archiv_stand", id],
    enabled: !!id,
    queryFn: async () => {
      const { count } = await (supabase as any)
        .from("bericht_archiv")
        .select("id", { count: "exact", head: true })
        .eq("art", "stundenbericht")
        .eq("bericht_id", id)
        .is("ueberholt_am", null);
      return (count ?? 0) as number;
    },
  });
  const aktionen = useStundenBerichtAktionen();

  const { data: tage = [] } = useStundenTageList({
    fromDate: bericht?.von_datum ?? "2000-01-01",
    toDate: bericht?.bis_datum ?? "2000-01-01",
    mitarbeiterIds: bericht?.mitarbeiter_id ? [bericht.mitarbeiter_id] : [],
    enabled: !!bericht,
  });

  const { data: baustellen = [] } = useQuery({
    queryKey: ["baustellen_kostenstelle", "mit_kategorie"],
    queryFn: async () => {
      const { data } = await supabase
        .from("baustellen")
        .select("id, bvh_name, kostenstelle, kategorie");
      return (data as { id: string; bvh_name: string; kostenstelle: string | null; kategorie: string }[]) ?? [];
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
  const [versendenOpen, setVersendenOpen] = useState(false);
  /** Wenn gesetzt: Büro-User hat im Bestätigen-Dialog unterschrieben und
   *  der Versand-Dialog soll mit dieser Signatur an die RPC. */
  const [bueroSignature, setBueroSignature] = useState<string | null>(null);
  const [bueroSignOpen, setBueroSignOpen] = useState(false);
  /** Mehrere auf einmal versenden (vorgemerkte) — null = nur dieser Bericht. */
  const [versandIds, setVersandIds] = useState<string[] | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [erinnernOffen, setErinnernOffen] = useState(false);

  // ─── Prüf-Leiste (Wunsch J. Maurer, 22.10.2026) ──────────────────────
  // Alle Berichte derselben Periode alphabetisch nacheinander prüfen, ohne
  // zurück in die Liste; „Passt" merkt vor, am Ende alle auf einmal mit
  // einer Unterschrift bestätigen und versenden.
  const { data: periodeBerichte = [] } = useStundenBerichteList({
    jahr: bericht?.jahr,
    monat: bericht?.monat,
    teil: bericht?.teil,
    enabled: !!bericht && isAdmin,
  });
  const [nurWartende, setNurWartende] = useState<boolean>(() => ladeSession(NUR_WARTENDE_KEY, true));
  const [vorgemerkt, setVorgemerkt] = useState<string[]>(() => ladeSession(VORMERK_KEY, [] as string[]));
  useEffect(() => speichereSession(VORMERK_KEY, vorgemerkt), [vorgemerkt]);
  useEffect(() => speichereSession(NUR_WARTENDE_KEY, nurWartende), [nurWartende]);
  const reihe = useMemo(() => {
    const name = (b: (typeof periodeBerichte)[number]) =>
      `${b.mitarbeiter?.nachname ?? ""} ${b.mitarbeiter?.vorname ?? ""}`.trim();
    return [...periodeBerichte]
      .filter(
        (b) => !nurWartende || b.status === "unterschrieben" || b.status === "bestaetigt" || b.id === id,
      )
      .sort((a, b) => name(a).localeCompare(name(b), "de-AT"));
  }, [periodeBerichte, nurWartende, id]);
  const vorgemerktOffen = periodeBerichte.filter(
    (b) => vorgemerkt.includes(b.id) && (b.status === "unterschrieben" || b.status === "bestaetigt"),
  );
  // Neuer Bericht in der Reihe: oben anfangen.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [id]);
  const { letzte: letzteErinnerung, vermerken: erinnerungVermerken } = useLetzteErinnerung(
    bericht?.status === "offen" && isAdmin ? [bericht.mitarbeiter_id] : [],
  );

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
          // Werk-Stunden laufen auf die Baustelle, für die vorgefertigt
          // wurde; die Maschine steht in Klammern dahinter.
          const zielId = (e as any).ziel_baustelle_id ?? e.baustelle_id;
          // In der Firma gearbeitet: eigene Zeile, damit es am Bericht
          // ersichtlich ist (N. Gwenger 05.10.).
          const inFirma = (e as any).ort === "firma";
          key = `b:${zielId ?? "none"}${inFirma ? "|firma" : ""}`;
          const b = zielId ? baustelleMap.get(zielId) : null;
          label = b?.bvh_name ?? "Baustelle";
          kst = b?.kostenstelle ?? "";
          if ((e as any).ziel_baustelle_id && e.baustelle_id) {
            const mName = baustelleMap.get(e.baustelle_id)?.bvh_name;
            if (mName) label = `${label} (${mName})`;
          }
          if (inFirma) label = `${label} (in der Firma)`;
        } else if (e.art === "firma" && e.baustelle_id) {
          // Firma mit Kostenstelle (N. Gwenger 08.10.): interne Kostenstelle
          // unter ihrem Namen, Baustelle als „… (in der Firma)" — dieselbe
          // Zeile wie früher die Baustellen-Zeilen mit Ort „Firma".
          const b = baustelleMap.get(e.baustelle_id);
          const intern = b?.kategorie === "intern";
          key = intern ? `b:${e.baustelle_id}` : `b:${e.baustelle_id}|firma`;
          label = b?.bvh_name ?? "Firma";
          if (!intern) label = `${label} (in der Firma)`;
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
  const fahrtgeldAgg = useMemo(() => aggregiereFahrtgeld(tage), [tage]);

  /** Kompakte Versand-Vorschau: Stunden pro Baustelle + Gesamtsumme. Nur
   *  Arbeit (Baustelle/Firma) wird summiert — Abwesenheiten zählen nicht. */
  const versandPreview = useMemo(() => {
    const arbeit = rows.filter(
      (r) => r.art === "baustelle" || r.art === "firma",
    );
    const items = arbeit.map((r) => ({
      key: r.key,
      label: r.label,
      kostenstelle: r.kostenstelle,
      stunden: [...r.perDay.values()].reduce((s, v) => s + v, 0),
    }));
    const gesamt = items.reduce((s, i) => s + i.stunden, 0);
    return { items, gesamt };
  }, [rows]);

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

  // Versendet, aber nicht im Archiv (Ablage im Browser gescheitert oder
  // Bericht von vor dem Archiv)? Dann kann das Büro es hier nachholen.
  const archivFehlt = archivStand === 0 && bericht.status === "versendet" && isAdmin;
  const insArchiv = async () => {
    setArchivBusy(true);
    try {
      const { doc, maName: name } = await buildBerichtPdf(bericht.id);
      const monatLang = new Date(bericht.jahr, bericht.monat - 1, 1).toLocaleDateString("de-AT", { month: "long", year: "numeric" });
      await archiviereBericht({
        art: "stundenbericht",
        mitarbeiterId: bericht.mitarbeiter_id,
        jahr: bericht.jahr,
        monat: bericht.monat,
        teil: bericht.teil,
        periodeLabel: `${monatLang} · Teil ${bericht.teil === 1 ? "I" : "II"}`,
        dateiname: `Stundenbericht ${bericht.jahr}-${String(bericht.monat).padStart(2, "0")} Teil ${bericht.teil === 1 ? "I" : "II"} ${name}.pdf`,
        doc,
        berichtId: bericht.id,
      });
      toast({ title: "Im Archiv abgelegt", description: "Die Kopie nach SharePoint folgt automatisch." });
      qc.invalidateQueries({ queryKey: ["bericht_archiv_stand", bericht.id] });
    } catch (e) {
      toast({ variant: "destructive", title: "Nicht archiviert", description: (e as Error).message });
    } finally {
      setArchivBusy(false);
    }
  };

  const istEigentuemer = bericht.mitarbeiter_id === user?.id;
  const editierbar =
    (bericht.status === "offen" && istEigentuemer) ||
    (bericht.status === "unterschrieben" && isAdmin);
  /** Vom Büro bestätigt — die geänderten Tage werden grün statt gelb,
   *  weil sie nochmal durchgeschaut + freigegeben wurden. */
  const geprueft =
    bericht.status === "bestaetigt" || bericht.status === "versendet";
  const kannUnterschreiben = bericht.status === "offen" && istEigentuemer;
  const kannBestaetigen = bericht.status === "unterschrieben" && isAdmin;
  // NUR 'bestaetigt' zeigt den Senden-Knopf. Für 'versendet' blendete die
  // App früher „Erneut ans Büro senden" ein — die Edge Function lehnt einen
  // bereits versendeten Bericht aber IMMER ab (Doppel-Mail-Schutz), der
  // Knopf schlug also garantiert fehl. Ein echtes Re-Send bräuchte einen
  // eigenen, bewussten Weg; bis dahin kein irreführender Knopf.
  const kannReVersenden = bericht.status === "bestaetigt" && isAdmin;

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
    if (
      !window.confirm(
        "Bericht unterschreiben und abschicken? Nach dem Abschicken ist kein Wieder-Öffnen mehr möglich.",
      )
    )
      return;
    try {
      await aktionen.unterschreiben.mutateAsync({ id: bericht.id, unterschrift: dataUrl });
      setSignOpen(false);
      toast({
        title: "Abgeschickt",
        description: "Der Bericht wurde unterschrieben und an das Büro übermittelt.",
      });
    } catch (e) {
      toast({ variant: "destructive", title: "Fehler", description: (e as Error).message });
    }
  };

  /** Klick auf „Bestätigen & ans Büro senden" — zuerst Unterschrift des
   *  Büro-/Maurer-Users sammeln, dann Versand-Dialog öffnen. Die
   *  Signatur wird mit dem Versand zur RPC durchgereicht. */
  const handleBestaetigen = () => {
    setVersandIds(null);
    setBueroSignOpen(true);
  };
  const vorgemerkteVersenden = () => {
    setVersandIds(vorgemerktOffen.map((b) => b.id));
    setBueroSignOpen(true);
  };

  const idx = reihe.findIndex((b) => b.id === bericht.id);
  const vorher = idx > 0 ? reihe[idx - 1] : null;
  const naechster = idx >= 0 && idx < reihe.length - 1 ? reihe[idx + 1] : null;
  const springe = (zielId: string) => navigate(`/stundenbericht/${zielId}`, { replace: true });
  const istVorgemerkt = vorgemerkt.includes(bericht.id);
  /** Vormerken geht für alles, was noch nicht raus ist — auch schon
   *  bestätigte (der Sammelversand bestätigt bei Bedarf mit). */
  const kannVormerken =
    isAdmin && (bericht.status === "unterschrieben" || bericht.status === "bestaetigt");
  const passtWeiter = () => {
    setVorgemerkt((v) => (v.includes(bericht.id) ? v : [...v, bericht.id]));
    if (naechster) springe(naechster.id);
    else
      toast({
        title: "Das war der letzte",
        description: "Jetzt „Vorgemerkte bestätigen & senden“ — eine Unterschrift für alle.",
      });
  };

  const handleDownload = async () => {
    setDownloadBusy(true);
    try {
      const { doc, fileName } = await buildBerichtPdf(bericht.id);
      doc.save(fileName);
    } catch (e) {
      toast({ variant: "destructive", title: "PDF-Fehler", description: (e as Error).message });
    } finally {
      setDownloadBusy(false);
    }
  };

  const handleBueroUnterschrift = (dataUrl: string) => {
    setBueroSignature(dataUrl);
    setBueroSignOpen(false);
    setVersendenOpen(true);
  };

  const periodeLabel = `${new Date(bericht.von_datum).toLocaleDateString(
    "de-AT",
  )} – ${new Date(bericht.bis_datum).toLocaleDateString("de-AT")}`;

  /** Kompakte Versand-Vorschau für „Bestätigen & ans Büro senden". Wird
   *  oberhalb der Aktionen (Desktop) und im Mobile-Sticky-Footer gerendert. */
  const versandPreviewBlock =
    kannBestaetigen && versandPreview.items.length > 0 ? (
      <div className="rounded-lg border bg-muted/40 p-3 space-y-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Versand-Vorschau · {periodeLabel}
        </div>
        <div className="space-y-0.5 text-xs">
          {versandPreview.items.map((it) => (
            <div
              key={it.key}
              className="flex items-center justify-between gap-2 tabular-nums"
            >
              <span className="truncate">
                BVH {it.label}
                {it.kostenstelle ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · KST {it.kostenstelle}
                  </span>
                ) : null}
              </span>
              <span className="font-medium shrink-0">
                {fmtHNum(it.stunden)} h
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t pt-1.5 text-sm font-semibold tabular-nums">
          <span>Gesamt</span>
          <span>{fmtHNum(versandPreview.gesamt)} h</span>
        </div>
      </div>
    ) : null;

  const handlePdf = async () => {
    setPdfBusy(true);
    try {
      const { doc } = await buildBerichtPdf(bericht.id);
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
    <div className="space-y-4 max-w-5xl mx-auto pb-44 lg:pb-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <PageHeader title="Baustellenstundenbericht" />
      </div>

      {isAdmin && reihe.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="h-9 w-9 p-0"
                disabled={!vorher}
                onClick={() => vorher && springe(vorher.id)}
                aria-label="Vorheriger Bericht"
                title={vorher ? `${vorher.mitarbeiter?.nachname ?? ""} ${vorher.mitarbeiter?.vorname ?? ""}` : undefined}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <select
                className="h-9 flex-1 min-w-[12rem] rounded-md border bg-background px-2 text-sm"
                value={bericht.id}
                onChange={(e) => springe(e.target.value)}
                aria-label="Bericht wählen"
              >
                {reihe.map((b, i) => (
                  <option key={b.id} value={b.id}>
                    {i + 1}/{reihe.length} · {b.mitarbeiter?.nachname ?? ""} {b.mitarbeiter?.vorname ?? ""}
                    {vorgemerkt.includes(b.id) ? " ✓" : ""} — {STATUS_KURZ[b.status]}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                className="h-9 w-9 p-0"
                disabled={!naechster}
                onClick={() => naechster && springe(naechster.id)}
                aria-label="Nächster Bericht"
                title={naechster ? `${naechster.mitarbeiter?.nachname ?? ""} ${naechster.mitarbeiter?.vorname ?? ""}` : undefined}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={nurWartende}
                  onChange={(e) => setNurWartende(e.target.checked)}
                />
                nur „Wartet auf Büro“
              </label>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {kannVormerken &&
                (istVorgemerkt ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 border-emerald-400 text-emerald-800"
                    onClick={() => setVorgemerkt((v) => v.filter((x) => x !== bericht.id))}
                    title="Vormerkung zurücknehmen"
                  >
                    <Check className="h-4 w-4 mr-1.5" /> Passt — vorgemerkt
                  </Button>
                ) : (
                  <Button size="sm" className="h-9" onClick={passtWeiter}>
                    <Check className="h-4 w-4 mr-1.5" /> Passt{naechster ? " — weiter" : ""}
                    {naechster && <ChevronRight className="h-4 w-4 ml-0.5" />}
                  </Button>
                ))}
              {vorgemerktOffen.length > 0 && (
                <Button size="sm" variant={kannVormerken && !istVorgemerkt ? "outline" : "default"} className="h-9" onClick={vorgemerkteVersenden}>
                  <Mail className="h-4 w-4 mr-1.5" />
                  Vorgemerkte bestätigen &amp; senden ({vorgemerktOffen.length})
                </Button>
              )}
              <span className="text-[11px] text-muted-foreground">
                {kannVormerken
                  ? "„Passt“ merkt vor und springt zum Nächsten — am Ende alle mit einer Unterschrift versenden."
                  : "Alphabetisch durch die Berichte dieser Periode blättern."}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

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
            <div className="flex flex-col items-end gap-1.5">
              <Badge variant="outline" className={badge.cls}>
                {badge.label}
              </Badge>
              {isAdmin && bericht.status === "offen" && (
                <Button size="sm" variant="outline" className="h-8" onClick={() => setErinnernOffen(true)}>
                  <BellRing className="h-3.5 w-3.5 mr-1.5" /> An Unterschrift erinnern
                </Button>
              )}
              {isAdmin && bericht.status === "offen" && letzteErinnerung[bericht.mitarbeiter_id] && (
                <span className="text-[11px] text-muted-foreground">
                  zuletzt erinnert am {fmtTs(letzteErinnerung[bericht.mitarbeiter_id])}
                </span>
              )}
            </div>
          </div>
          {(bericht.unterschrieben_am ||
            bericht.bestaetigt_am ||
            bericht.versendet_am) && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-1">
              {bericht.unterschrieben_am && (
                <div>
                  Du hast am{" "}
                  <span className="font-semibold">
                    {fmtTs(bericht.unterschrieben_am)}
                  </span>{" "}
                  unterschrieben.
                </div>
              )}
              {bericht.bestaetigt_am && (
                <div>
                  Vom Büro bestätigt am{" "}
                  <span className="font-semibold">
                    {fmtTs(bericht.bestaetigt_am)}
                  </span>
                  .
                </div>
              )}
              {bericht.versendet_am && (
                <div>
                  Ans Büro versendet am{" "}
                  <span className="font-semibold">
                    {fmtTs(bericht.versendet_am)}
                  </span>
                  {bericht.versendet_an_mail ? (
                    <>
                      {" "}
                      an{" "}
                      <span className="font-semibold">
                        {bericht.versendet_an_mail}
                      </span>
                    </>
                  ) : null}
                  .
                </div>
              )}
            </div>
          )}
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

      {archivFehlt && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex items-center gap-2 flex-wrap text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
          <span className="flex-1">Versendet, aber noch nicht im Berichte-Archiv.</span>
          <Button size="sm" className="h-8" onClick={insArchiv} disabled={archivBusy}>
            Ins Archiv legen
          </Button>
        </div>
      )}

      {/* Geändert-Hinweis — gelb solange offen, grün sobald Büro bestätigt hat */}
      {geaendert.size > 0 && (() => {
        const geprueft =
          bericht.status === "bestaetigt" || bericht.status === "versendet";
        const cls = geprueft
          ? "border-emerald-400 bg-emerald-50 text-emerald-900"
          : "border-amber-300 bg-amber-50 text-amber-900";
        const iconCls = geprueft ? "text-emerald-700" : "text-amber-700";
        const text =
          geaendert.size === 1
            ? "1 Tag wurde nach Erstellung geändert"
            : `${geaendert.size} Tage wurden nach Erstellung geändert`;
        return (
          <div className={`rounded-lg border p-3 flex items-center gap-2 ${cls}`}>
            <AlertTriangle className={`h-4 w-4 shrink-0 ${iconCls}`} />
            <span className="text-sm">
              {text}
              {geprueft
                ? " — vom Büro bestätigt, grün markiert."
                : " — gelb markiert, bitte vor dem Abschicken nochmal prüfen."}
            </span>
          </div>
        );
      })()}

      {/* Mobile: Tag-Card-Liste (vertikal) */}
      <div className="lg:hidden space-y-2">
        {editierbar && (
          <div className="text-xs text-muted-foreground px-1">
            Tippen auf eine Tages-Card öffnet den Tages-Editor.
          </div>
        )}
        {periodeTage.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Keine Periode geladen.
            </CardContent>
          </Card>
        )}
        {periodeTage.map((d) => {
          const tag = tagByIso.get(d.iso);
          const istGeaendert = geaendert.has(d.iso);
          const istFrei = d.frei;
          const summe =
            tag?.taetigkeiten.reduce(
              (s, e) =>
                e.art === "baustelle" || e.art === "firma"
                  ? s + Number(e.stunden || 0)
                  : s,
              0,
            ) ?? 0;
          const datumLabel = new Date(d.iso + "T00:00:00").toLocaleDateString(
            "de-AT",
            { day: "2-digit", month: "2-digit" },
          );
          return (
            <Card
              key={d.iso}
              onClick={() => openTag(d.iso)}
              className={`${editierbar ? "cursor-pointer active:scale-[0.995] transition" : ""} ${
                istGeaendert
                  ? geprueft
                    ? "border-emerald-400 bg-emerald-50"
                    : "border-amber-400 bg-amber-50"
                  : istFrei
                  ? "bg-muted/30"
                  : ""
              }`}
            >
              <CardContent className="p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-bold">
                    {d.wd} {datumLabel}
                  </div>
                  {istGeaendert && (
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        geprueft
                          ? "border-emerald-500 text-emerald-800 bg-emerald-100"
                          : "border-amber-500 text-amber-800 bg-amber-100"
                      }`}
                    >
                      {geprueft ? "geprüft" : "geändert"}
                    </Badge>
                  )}
                  {istFrei && !tag?.taetigkeiten.length && (
                    <span className="text-[11px] text-muted-foreground">
                      Wochenende
                    </span>
                  )}
                  {summe > 0 && (
                    <div className="ml-auto text-sm font-semibold tabular-nums">
                      Σ {fmtHNum(summe)} h
                    </div>
                  )}
                </div>
                {tag && tag.taetigkeiten.length > 0 ? (
                  <div className="space-y-1">
                    {tag.taetigkeiten.map((e, idx) => {
                      const istArbeit =
                        e.art === "baustelle" || e.art === "firma";
                      const baustelle = e.baustelle_id
                        ? baustelleMap.get(e.baustelle_id)
                        : null;
                      const label =
                        e.art === "baustelle"
                          ? baustelle?.bvh_name ?? "Baustelle"
                          : STATUS_LABEL[e.art];
                      const kst = baustelle?.kostenstelle ?? "";
                      return (
                        <div
                          key={e.id ?? idx}
                          className="flex items-center gap-2 text-xs border-l-2 border-primary/30 pl-2"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{label}</div>
                            {kst && (
                              <div className="text-[10px] text-muted-foreground">
                                KST {kst}
                              </div>
                            )}
                          </div>
                          {istArbeit ? (
                            <div className="font-medium tabular-nums shrink-0">
                              {fmtHNum(Number(e.stunden || 0))} h
                            </div>
                          ) : (
                            <Badge variant="outline" className="text-[10px] shrink-0">
                              {ABWESEND_KUERZEL[e.art] ?? STATUS_LABEL[e.art]}
                            </Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  !istFrei && (
                    <div className="text-xs text-muted-foreground italic">
                      Kein Eintrag
                    </div>
                  )
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Desktop: Raster Baustelle × Tag */}
      <Card className="hidden lg:block">
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
                          ? geprueft
                            ? "bg-emerald-200"
                            : "bg-amber-200"
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
                                ? geprueft
                                  ? "bg-emerald-100"
                                  : "bg-amber-100"
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
                            geaendert.has(d.iso)
                              ? geprueft
                                ? "bg-emerald-100"
                                : "bg-amber-100"
                              : ""
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
      {(zulagenAgg.length > 0 || fahrtgeldAgg.stunden > 0) && (
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
            {fahrtgeldAgg.stunden > 0 && (
              <div className="flex justify-between text-sm tabular-nums">
                <span>Fahrtgeld</span>
                <span className="font-medium">
                  {fmtHNum(fahrtgeldAgg.stunden)} h · {fahrtgeldAgg.tage} Tag
                  {fahrtgeldAgg.tage === 1 ? "" : "e"}
                </span>
              </div>
            )}
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
            {(bericht as any).bestaetigt_unterschrift_data ? (
              <>
                <img
                  src={(bericht as any).bestaetigt_unterschrift_data}
                  alt="Büro-Unterschrift"
                  className="h-16 border rounded bg-white"
                />
                <div className="text-xs text-muted-foreground">
                  Bestätigt am{" "}
                  {bericht.bestaetigt_am
                    ? new Date(bericht.bestaetigt_am).toLocaleDateString("de-AT")
                    : ""}
                </div>
              </>
            ) : bericht.bestaetigt_am ? (
              <div className="text-sm">
                Bestätigt am{" "}
                {new Date(bericht.bestaetigt_am).toLocaleDateString("de-AT")}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">
                Noch nicht geprüft
              </div>
            )}
            {bericht.versendet_am && (
              <div className="text-xs text-emerald-700">
                Versendet am{" "}
                {new Date(bericht.versendet_am).toLocaleDateString("de-AT")}
                {bericht.versendet_an_mail
                  ? ` an ${bericht.versendet_an_mail}`
                  : ""}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Audit — Mobile: in <details> ein-/ausklappbar mit Tap; Desktop:
          immer aufgeklappt (open + summary als reiner Header). */}
      {bericht.aenderungen.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <details open className="group">
              <summary className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1.5 cursor-pointer lg:cursor-default list-none [&::-webkit-details-marker]:hidden">
                <History className="h-3.5 w-3.5" />
                <span>Änderungen ({bericht.aenderungen.length})</span>
                <ChevronDown className="h-3.5 w-3.5 ml-auto transition-transform group-open:rotate-180 lg:hidden" />
              </summary>
              <div className="space-y-1.5 mt-2">
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
              </div>
            </details>
          </CardContent>
        </Card>
      )}

      {/* Versand-Vorschau (Desktop) — direkt über den Aktionen, wenn der Büro-
          User bestätigen darf. So sieht er vorher, was insgesamt gebucht wird. */}
      {versandPreviewBlock && (
        <div className="hidden lg:block">{versandPreviewBlock}</div>
      )}

      {/* Aktionen — Desktop inline, Mobile als Sticky-Footer mit Safe-Area */}
      <div className="hidden lg:flex flex-wrap gap-2">
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
        <Button variant="outline" onClick={handleDownload} disabled={downloadBusy} className="min-w-[140px]">
          {downloadBusy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
          PDF herunterladen
        </Button>
        {kannUnterschreiben && (
          <Button onClick={() => setSignOpen(true)} className="flex-1 min-w-[200px] h-12">
            <PenLine className="h-4 w-4 mr-1.5" />
            Unterschreiben & abschicken
          </Button>
        )}
        {kannBestaetigen && (
          <Button
            onClick={handleBestaetigen}
            className="flex-1 min-w-[200px] h-12"
          >
            <Mail className="h-4 w-4 mr-1.5" />
            Bestätigen &amp; ans Büro senden
          </Button>
        )}
        {kannReVersenden && (
          <Button
            variant="outline"
            onClick={() => {
              setVersandIds(null);
              setVersendenOpen(true);
            }}
            className="min-w-[180px] h-12"
          >
            <Mail className="h-4 w-4 mr-1.5" />
            Ans Büro senden
          </Button>
        )}
      </div>

      {/* Mobile-Sticky-Footer mit Safe-Area-Padding */}
      <div
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t shadow-[0_-2px_10px_-2px_rgba(0,0,0,0.08)]"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 10px)" }}
      >
        <div className="px-3 pt-3 pb-1 space-y-2">
          {versandPreviewBlock}
          {kannUnterschreiben && (
            <Button
              onClick={() => setSignOpen(true)}
              className="w-full h-12 text-base font-semibold"
            >
              <PenLine className="h-5 w-5 mr-2" />
              Unterschreiben & abschicken
            </Button>
          )}
          {kannBestaetigen && (
            <Button
              onClick={handleBestaetigen}
              className="w-full h-12 text-base font-semibold"
            >
              <Mail className="h-5 w-5 mr-2" />
              Bestätigen &amp; ans Büro senden
            </Button>
          )}
          {kannReVersenden && (
            <Button
              variant="outline"
              onClick={() => {
                setVersandIds(null);
                setVersendenOpen(true);
              }}
              className="w-full h-11 text-base font-semibold"
            >
              <Mail className="h-5 w-5 mr-2" />
              Ans Büro senden
            </Button>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handlePdf}
              disabled={pdfBusy}
              className="flex-1 h-10"
            >
              {pdfBusy ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <FileText className="h-4 w-4 mr-1.5" />
              )}
              PDF ansehen
            </Button>
            <Button variant="outline" onClick={handleDownload} disabled={downloadBusy} className="flex-1 h-10">
              {downloadBusy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
              Herunterladen
            </Button>
          </div>
        </div>
      </div>

      {/* Tag-Editor */}
      <TagBearbeitenDialog
        open={!!editTag}
        onOpenChange={(v) => !v && setEditTag(null)}
        tag={editTag?.tag.id ? editTag : null}
        mitarbeiterId={bericht.mitarbeiter_id}
        datum={editTag?.tag.datum ?? ""}
        mitarbeiterName={maName}
        onSaved={() => {
          if (editTag) onTagSaved(editTag.tag.datum);
        }}
      />

      {/* MA-Unterschrift („aufgestellt") */}
      <UnterschriftDialog
        open={signOpen}
        onOpenChange={setSignOpen}
        onSave={handleUnterschrift}
        titel="Bericht unterschreiben"
        busy={aktionen.unterschreiben.isPending}
      />

      {/* Büro/Maurer-Unterschrift („geprüft") — Schritt 1 von „Bestätigen
          & ans Büro senden": erst Signatur sammeln, dann Versand-Dialog. */}
      <UnterschriftDialog
        open={bueroSignOpen}
        onOpenChange={setBueroSignOpen}
        onSave={handleBueroUnterschrift}
        titel="Bestätigung unterschreiben"
      />

      {/* Versenden ans Büro (bestätigt im selben Schritt, falls nötig) */}
      <BsbVersendenDialog
        open={versendenOpen}
        onOpenChange={(o) => {
          setVersendenOpen(o);
          if (!o) setBueroSignature(null);
        }}
        berichtIds={versandIds ?? [bericht.id]}
        bueroSignature={bueroSignature}
        onSent={() => {
          const raus = versandIds ?? [bericht.id];
          setBueroSignature(null);
          setVersandIds(null);
          setVorgemerkt((v) => v.filter((x) => !raus.includes(x)));
          qc.invalidateQueries({ queryKey: ["stunden_bericht"] });
          qc.invalidateQueries({ queryKey: ["stunden_berichte"] });
        }}
      />

      <StundenberichtErinnernDialog
        open={erinnernOffen}
        onOpenChange={setErinnernOffen}
        berichte={bericht.status === "offen" ? [bericht] : []}
        onGesendet={erinnerungVermerken}
      />
    </div>
  );
}
