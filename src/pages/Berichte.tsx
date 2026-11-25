/**
 * Berichte-Übersicht (Bautages- + Regieberichte).
 * - Filter: Baustelle / Datum / Status / Typ / Polier
 * - „Neuer Bericht"-Modal: wenn schon vorhanden für Tag+Baustelle+Typ → öffnen statt erstellen
 * - „Gesammelt versenden“ (J. Maurer, 19.11.2026): Berichte mit PDF über die
 *   Filter + Häkchen auswählen (Auswahl bleibt beim Umschalten von Typ/Filter
 *   erhalten), dann in einer Mail senden (Verwaltung) oder als ZIP laden.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Plus, Building2, FileCheck2, Loader2, ChevronRight, Hammer, ClipboardList, Mail, Download, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { DocSendDialog, type DocSendItem } from "@/components/dokumente/DocSendDialog";
import { zipHerunterladen } from "@/lib/zipDownload";
import type { Database, BerichtStatus, BerichtTyp } from "@/integrations/supabase/types";
import { useBerichteList } from "@/hooks/useBerichte";
import { getBaustellenForMaToday } from "@/lib/tagesplanung";
import { findeOderErstelleBerichtMitVorausfuellung, ladeRegieberichteAmTag } from "@/hooks/useBericht";
import { BaustelleCombobox } from "@/components/stunden/BaustelleCombobox";
import { BERICHTE_AUSWAHL_KEY } from "@/lib/berichteAuswahl";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const TYP_LABEL: Record<BerichtTyp, string> = {
  bautagesbericht: "Bautagesbericht",
  regiebericht: "Regiebericht",
};

const STATUS_BADGE: Record<BerichtStatus, { label: string; cls: string }> = {
  entwurf: {
    label: "Entwurf — wird vom Polier geschrieben",
    cls: "bg-slate-100 text-slate-900 border-slate-300",
  },
  eingereicht: {
    label: "Eingereicht — wartet auf Bauleiter-Freigabe",
    cls: "bg-blue-100 text-blue-900 border-blue-300",
  },
  freigegeben: {
    label: "Freigegeben",
    cls: "bg-emerald-100 text-emerald-900 border-emerald-300",
  },
  archiviert: {
    label: "Archiviert",
    cls: "bg-gray-200 text-gray-900 border-gray-400",
  },
};

/** Für den Sammelversand gemerkter Bericht (bleibt beim Filterwechsel erhalten). */
interface BerichtWahl {
  id: string;
  pdfDokumentId: string;
  datum: string;
  typ: BerichtTyp;
  baustelle: string;
  kst: string | null;
  /** Nr. des Regieberichts am Tag, nur wenn es mehrere gibt (seit 25.11.2026). */
  nr?: number | null;
}

const dateiSicher = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
const fmtDatum = (iso: string) => new Date(iso).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Dateiname im Anhang/ZIP, z. B. „Bautagesbericht HMH Obersteiner 2026-11-18.pdf“. */
function berichtDateiname(w: Pick<BerichtWahl, "typ" | "baustelle" | "datum" | "nr">): string {
  return `${dateiSicher(`${TYP_LABEL[w.typ]} ${w.baustelle}`)} ${w.datum}${w.nr ? ` (${w.nr})` : ""}.pdf`;
}

/** Mehrere Regieberichte am selben Tag und auf derselben Baustelle bekommen eine
 *  laufende Nummer (älteste = 1), damit man sie in Liste und Anhang unterscheidet. */
function regieNummern(
  liste: { id: string; typ: string; baustelle_id: string; datum: string; created_at: string }[],
): Map<string, number> {
  const gruppen = new Map<string, { id: string; created_at: string }[]>();
  for (const b of liste) {
    if (b.typ !== "regiebericht") continue;
    const k = `${b.baustelle_id}|${b.datum}`;
    gruppen.set(k, [...(gruppen.get(k) ?? []), b]);
  }
  const nr = new Map<string, number>();
  for (const g of gruppen.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    g.forEach((b, i) => nr.set(b.id, i + 1));
  }
  return nr;
}

const fmtShortDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" });
};

function statusChangeInfo(b: {
  status: BerichtStatus;
  eingereicht_am: string | null;
  freigegeben_am: string | null;
  archiviert_am: string | null;
  updated_at: string;
  created_at: string;
}): string | null {
  switch (b.status) {
    case "entwurf": {
      const d = fmtShortDate(b.updated_at) ?? fmtShortDate(b.created_at);
      return d ? `Entwurf seit ${d}` : null;
    }
    case "eingereicht": {
      const d = fmtShortDate(b.eingereicht_am) ?? fmtShortDate(b.updated_at);
      return d ? `Eingereicht am ${d}` : null;
    }
    case "freigegeben": {
      const d = fmtShortDate(b.freigegeben_am) ?? fmtShortDate(b.updated_at);
      return d ? `Freigegeben am ${d}` : null;
    }
    case "archiviert": {
      const d = fmtShortDate(b.archiviert_am) ?? fmtShortDate(b.updated_at);
      return d ? `Archiviert am ${d}` : null;
    }
    default:
      return null;
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function Berichte() {
  const [params, setParams] = useSearchParams();
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [openNeu, setOpenNeu] = useState(false);
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [auswahlModus, setAuswahlModus] = useState(false);
  const [auswahl, setAuswahl] = useState<Map<string, BerichtWahl>>(new Map());
  const [sendItems, setSendItems] = useState<DocSendItem[] | null>(null);
  const [ladeSammel, setLadeSammel] = useState<"mail" | "zip" | null>(null);

  // Letzte Auswahl (Typ, Zeitraum, Status, Baustelle) merken, damit der
  // Zurück-Pfeil im Bericht und der Menüpunkt wieder genau hier landen
  // (J. Maurer, 17.11.2026). Kommt man ohne Parameter auf die Seite, wird
  // die gemerkte Auswahl wiederhergestellt.
  const paramStr = params.toString();
  useEffect(() => {
    try {
      if (paramStr) {
        sessionStorage.setItem(BERICHTE_AUSWAHL_KEY, paramStr);
      } else {
        const gemerkt = sessionStorage.getItem(BERICHTE_AUSWAHL_KEY);
        if (gemerkt) setParams(new URLSearchParams(gemerkt), { replace: true });
      }
    } catch {
      /* sessionStorage nicht verfügbar — dann eben ohne Merken */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramStr]);

  // Tab-State: default Bautagesbericht. Wird im URL-Param gespiegelt.
  const aktiverTyp: BerichtTyp =
    (params.get("typ") as BerichtTyp) === "regiebericht" ? "regiebericht" : "bautagesbericht";

  const filter = {
    fromDate: params.get("from") ?? daysAgo(30),
    toDate: params.get("to") ?? todayIso(),
    status: (params.get("status") as BerichtStatus) || undefined,
    typ: aktiverTyp,
    baustelleId: params.get("baustelle") ?? undefined,
  };
  const { data: berichte = [], isLoading } = useBerichteList(filter);
  const regieNr = useMemo(() => regieNummern(berichte), [berichte]);

  useEffect(() => {
    (async () => {
      const [{ data: bs }, { data: ps }] = await Promise.all([
        supabase
          .from("baustellen")
          .select("*")
          .order("bvh_name"),
        supabase
          .from("profiles")
          .select("id, vorname, nachname")
          .eq("is_active", true)
          .order("nachname"),
      ]);
      setBaustellen((bs as Baustelle[]) ?? []);
      setProfiles((ps as Profile[]) ?? []);
    })();
  }, []);

  const baustelleById = useMemo(
    () => new Map(baustellen.map((b) => [b.id, b])),
    [baustellen],
  );
  const profileById = useMemo(
    () => new Map(profiles.map((p) => [p.id, p])),
    [profiles],
  );

  // Nur fertige Berichte: ein wieder geöffneter Entwurf hat evtl. noch das alte PDF.
  const versendbar = (b: (typeof berichte)[number]) =>
    !!b.pdf_dokument_id && (b.status === "freigegeben" || b.status === "archiviert");
  const wahlAus = (b: (typeof berichte)[number]): BerichtWahl | null => {
    if (!versendbar(b) || !b.pdf_dokument_id) return null;
    const bs = baustelleById.get(b.baustelle_id);
    return {
      id: b.id,
      pdfDokumentId: b.pdf_dokument_id,
      datum: b.datum,
      typ: b.typ,
      baustelle: bs?.bvh_name ?? "Baustelle",
      kst: bs?.kostenstelle ?? null,
      nr: regieNr.get(b.id) ?? null,
    };
  };
  const umschalten = (b: (typeof berichte)[number]) => {
    const w = wahlAus(b);
    if (!w) return;
    setAuswahl((alt) => {
      const neu = new Map(alt);
      if (neu.has(w.id)) neu.delete(w.id);
      else neu.set(w.id, w);
      return neu;
    });
  };
  const mitPdfInListe = berichte.filter(versendbar);
  const alleInListeGewaehlt = mitPdfInListe.length > 0 && mitPdfInListe.every((b) => auswahl.has(b.id));
  const alleInListe = (an: boolean) => {
    setAuswahl((alt) => {
      const neu = new Map(alt);
      for (const b of mitPdfInListe) {
        const w = wahlAus(b);
        if (!w) continue;
        if (an) neu.set(w.id, w);
        else neu.delete(w.id);
      }
      return neu;
    });
  };

  /** Gewählte Berichte sortiert (Baustelle, Datum, Typ) mit Speicherort des PDFs. */
  const sammelDateien = async (): Promise<DocSendItem[]> => {
    const liste = [...auswahl.values()].sort(
      (a, b) =>
        a.baustelle.localeCompare(b.baustelle, "de") ||
        a.datum.localeCompare(b.datum) ||
        a.typ.localeCompare(b.typ),
    );
    const ids = liste.map((w) => w.pdfDokumentId);
    const { data, error } = await supabase
      .from("dokumente")
      .select("id, storage_path, groesse")
      .in("id", ids);
    if (error) throw error;
    const jeId = new Map(((data ?? []) as { id: string; storage_path: string; groesse: number | null }[]).map((d) => [d.id, d]));
    const fehlt = liste.filter((w) => !jeId.get(w.pdfDokumentId)?.storage_path);
    if (fehlt.length > 0) {
      throw new Error(
        `Zu ${fehlt.length === 1 ? "einem Bericht" : `${fehlt.length} Berichten`} fehlt das PDF (${fehlt
          .slice(0, 3)
          .map((w) => `${w.baustelle} ${fmtDatum(w.datum)}`)
          .join(", ")}). Im Bericht „PDF neu erstellen“ drücken.`,
      );
    }
    return liste.map((w) => {
      const d = jeId.get(w.pdfDokumentId)!;
      return {
        id: d.id,
        bucket: "baustellen",
        storage_path: d.storage_path,
        dateiname: berichtDateiname(w),
        groesse: d.groesse,
        mimetype: "application/pdf",
      };
    });
  };

  const sammelBetreff = useMemo(() => {
    const liste = [...auswahl.values()];
    if (liste.length === 0) return "";
    const typen = new Set(liste.map((w) => w.typ));
    const art =
      typen.size > 1 ? "Berichte" : typen.has("regiebericht") ? "Regieberichte" : "Bautagesberichte";
    const orte = [...new Set(liste.map((w) => w.baustelle))];
    const daten = liste.map((w) => w.datum).sort();
    const zeit =
      daten[0] === daten[daten.length - 1]
        ? fmtDatum(daten[0])
        : `${fmtDatum(daten[0])} – ${fmtDatum(daten[daten.length - 1])}`;
    return `${liste.length === 1 ? TYP_LABEL[liste[0].typ] : art} ${orte.length === 1 ? orte[0] : `${orte.length} Baustellen`} ${zeit}`;
  }, [auswahl]);

  const sammelText = useMemo(() => {
    const liste = [...auswahl.values()].sort(
      (a, b) => a.baustelle.localeCompare(b.baustelle, "de") || a.datum.localeCompare(b.datum),
    );
    const zeilen = liste.map((w) => `- ${TYP_LABEL[w.typ]}${w.nr ? ` Nr. ${w.nr}` : ""} ${w.baustelle} vom ${fmtDatum(w.datum)}`);
    return `Hallo,\n\nim Anhang ${liste.length === 1 ? "der Bericht" : `${liste.length} Berichte`}:\n${zeilen.join("\n")}\n\nMit freundlichen Grüßen`;
  }, [auswahl]);

  const perMail = async () => {
    setLadeSammel("mail");
    try {
      setSendItems(await sammelDateien());
    } catch (e) {
      toast({ variant: "destructive", title: "Versand nicht möglich", description: (e as Error).message });
    } finally {
      setLadeSammel(null);
    }
  };

  const alsZip = async () => {
    setLadeSammel("zip");
    try {
      const items = await sammelDateien();
      const dateien: { name: string; inhalt: Blob }[] = [];
      for (const it of items) {
        const { data, error } = await supabase.storage.from(it.bucket).download(it.storage_path);
        if (error || !data) throw new Error(`„${it.dateiname}“ konnte nicht geladen werden.`);
        dateien.push({ name: it.dateiname, inhalt: data });
      }
      await zipHerunterladen(dateien, dateiSicher(sammelBetreff || "Berichte"));
    } catch (e) {
      toast({ variant: "destructive", title: "Herunterladen fehlgeschlagen", description: (e as Error).message });
    } finally {
      setLadeSammel(null);
    }
  };

  const setFilter = (key: string, val: string | null) => {
    const next = new URLSearchParams(params);
    if (val === null || val === "") next.delete(key);
    else next.set(key, val);
    // typ immer mitschreiben: eine leere URL würde die gemerkte Auswahl
    // zurückholen und „alle“ ließe sich nicht mehr wählen.
    if (!next.get("typ")) next.set("typ", aktiverTyp);
    setParams(next, { replace: true });
  };

  // Sind echte Filter aktiv (über die Default-Werte hinaus)? Default = letzte 30 Tage,
  // alle Status, alle Baustellen — wenn nichts davon abweicht, gilt der Empty-State
  // als "noch keine Berichte angelegt" statt "Filter-leer".
  const hatAktiveFilter =
    !!params.get("status") ||
    !!params.get("baustelle") ||
    (params.get("from") != null && params.get("from") !== daysAgo(30)) ||
    (params.get("to") != null && params.get("to") !== todayIso());

  const resetFilter = () => {
    // typ immer setzen: leere Parameter würden die gemerkte Auswahl zurückholen.
    const next = new URLSearchParams();
    next.set("typ", aktiverTyp);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <PageHeader
        title="Berichte"
        actions={
          <div className="flex flex-wrap gap-2 justify-end">
            {!auswahlModus && (
              <Button variant="outline" onClick={() => setAuswahlModus(true)}>
                <Mail className="h-4 w-4 mr-1.5" />
                Gesammelt versenden
              </Button>
            )}
            <Button onClick={() => setOpenNeu(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              {aktiverTyp === "bautagesbericht" ? "Neuer Bautagesbericht" : "Neuer Regiebericht"}
            </Button>
          </div>
        }
      />

      {/* Typ-Tabs — bewusste Wahl als Erstes */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setFilter("typ", "bautagesbericht")}
          className={`h-14 rounded-lg border-2 text-base font-semibold flex items-center justify-center gap-2 transition ${
            aktiverTyp === "bautagesbericht"
              ? "bg-primary text-primary-foreground border-primary shadow-sm"
              : "bg-card border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          <Hammer className="h-5 w-5" />
          Bautagesbericht
        </button>
        <button
          type="button"
          onClick={() => setFilter("typ", "regiebericht")}
          className={`h-14 rounded-lg border-2 text-base font-semibold flex items-center justify-center gap-2 transition ${
            aktiverTyp === "regiebericht"
              ? "bg-primary text-primary-foreground border-primary shadow-sm"
              : "bg-card border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          <ClipboardList className="h-5 w-5" />
          Regiebericht
        </button>
      </div>

      {/* Filter */}
      <Card>
        <CardContent className="p-4 grid sm:grid-cols-4 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Von</Label>
            <Input
              type="date"
              value={filter.fromDate}
              onChange={(e) => setFilter("from", e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Bis</Label>
            <Input
              type="date"
              value={filter.toDate}
              onChange={(e) => setFilter("to", e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <select
              value={filter.status ?? ""}
              onChange={(e) => setFilter("status", e.target.value || null)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="">alle</option>
              <option value="entwurf">Entwurf</option>
              <option value="eingereicht">Eingereicht</option>
              <option value="freigegeben">Freigegeben</option>
              <option value="archiviert">Archiviert</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Baustelle</Label>
<BaustelleCombobox
              baustellen={baustellen}
              value={filter.baustelleId ?? ""}
              onChange={(id) => setFilter("baustelle", id || null)}
              allowClear
              clearLabel="alle Baustellen"
              placeholder="alle"
              triggerClassName="h-9 text-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* Sammelversand: Auswahl-Leiste */}
      {auswahlModus && (
        <Card className="border-primary/40 bg-primary/5" data-testid="sammel-leiste">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm">
                <div className="font-semibold">Berichte gesammelt versenden</div>
                <div className="text-xs text-muted-foreground">
                  Mit Typ, Zeitraum, Status und Baustelle die Liste eingrenzen und Berichte abhaken.
                  Die Auswahl bleibt beim Umschalten erhalten — so gehen auch Bautages- und
                  Regieberichte zusammen. Auswählbar sind freigegebene Berichte (mit PDF).
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Sammelversand beenden"
                onClick={() => {
                  setAuswahlModus(false);
                  setAuswahl(new Map());
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium tabular-nums" data-testid="sammel-anzahl">
                {auswahl.size} ausgewählt
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={mitPdfInListe.length === 0}
                onClick={() => alleInListe(!alleInListeGewaehlt)}
              >
                {alleInListeGewaehlt ? "Liste abwählen" : `Alle in der Liste (${mitPdfInListe.length})`}
              </Button>
              {auswahl.size > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setAuswahl(new Map())}>
                  Auswahl leeren
                </Button>
              )}
              <div className="flex-1" />
              {isAdmin && (
                <Button size="sm" disabled={auswahl.size === 0 || !!ladeSammel} onClick={perMail}>
                  {ladeSammel === "mail" ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Mail className="h-4 w-4 mr-1.5" />
                  )}
                  Per Mail senden
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={auswahl.size === 0 || !!ladeSammel} onClick={alsZip}>
                {ladeSammel === "zip" ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-1.5" />
                )}
                Herunterladen (ZIP)
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Liste */}
      {isLoading ? (
        <Card>
          <CardContent className="p-6 flex items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Lade…
          </CardContent>
        </Card>
      ) : berichte.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center text-sm text-muted-foreground space-y-3">
            <FileText className="h-10 w-10 mx-auto opacity-30" />
            {hatAktiveFilter ? (
              <>
                <div>Keine Treffer für deinen Filter. Filter ändern oder zurücksetzen.</div>
                <Button size="sm" variant="outline" onClick={resetFilter}>
                  Filter zurücksetzen
                </Button>
              </>
            ) : (
              <div>
                Noch keine{" "}
                {aktiverTyp === "bautagesbericht" ? "Bautagesberichte" : "Regieberichte"}{" "}
                angelegt. Klick auf „Neuer{" "}
                {aktiverTyp === "bautagesbericht" ? "Bautagesbericht" : "Regiebericht"}" um
                einen{" "}
                {aktiverTyp === "bautagesbericht" ? "Bautagesbericht" : "Regiebericht"} zu
                starten.
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {berichte.map((b) => {
            const bs = baustelleById.get(b.baustelle_id);
            const polier = b.erfasst_von ? profileById.get(b.erfasst_von) : null;
            const sb = STATUS_BADGE[b.status];
            const statusInfo = statusChangeInfo(b);
              const inhalt = (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm tabular-nums">
                        {new Date(b.datum).toLocaleDateString("de-AT", {
                          weekday: "short",
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {TYP_LABEL[b.typ]}
                        {regieNr.get(b.id) ? ` Nr. ${regieNr.get(b.id)}` : ""}
                      </Badge>
                      <Badge variant="outline" className={`text-[10px] ${sb.cls}`}>
                        {sb.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1 truncate">
                      <Building2 className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{bs?.bvh_name ?? "—"}</span>
                    </div>
                    {statusInfo && (
                      <div className="text-[11px] text-muted-foreground tabular-nums">
                        {statusInfo}
                      </div>
                    )}
                    {polier && (
                      <div className="text-[11px] text-muted-foreground">
                        Polier: {polier.vorname} {polier.nachname}
                      </div>
                    )}
                  </div>
                  {!auswahlModus && (
                    <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                  )}
                </div>
              );
              if (!auswahlModus) {
                return (
                  <Link
                    key={b.id}
                    to={`/berichte/${b.id}`}
                    className="block rounded-md border bg-card hover:bg-muted/40 transition p-3"
                  >
                    {inhalt}
                  </Link>
                );
              }
              const gewaehlt = auswahl.has(b.id);
              const hatPdf = versendbar(b);
              return (
                <div
                  key={b.id}
                  role="checkbox"
                  aria-checked={gewaehlt}
                  aria-disabled={!hatPdf}
                  tabIndex={hatPdf ? 0 : -1}
                  data-testid="sammel-bericht"
                  onClick={() => umschalten(b)}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      umschalten(b);
                    }
                  }}
                  className={`flex items-start gap-3 rounded-md border p-3 transition ${
                    hatPdf ? "cursor-pointer hover:bg-muted/40" : "opacity-60"
                  } ${gewaehlt ? "bg-primary/5 border-primary/50" : "bg-card"}`}
                >
                  <Checkbox
                    checked={gewaehlt}
                    disabled={!hatPdf}
                    tabIndex={-1}
                    className="mt-1 pointer-events-none"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    {inhalt}
                    {!hatPdf && (
                      <div className="text-[11px] text-muted-foreground italic mt-0.5">
                        noch nicht freigegeben — erst danach auswählbar
                      </div>
                    )}
                  </div>
                </div>
              );
          })}
        </div>
      )}

      <DocSendDialog
        open={!!sendItems}
        onOpenChange={(o) => !o && setSendItems(null)}
        items={sendItems ?? []}
        defaultBetreff={sammelBetreff}
        defaultBody={sammelText}
        onSent={() => {
          setAuswahl(new Map());
          setAuswahlModus(false);
        }}
      />

      <NeuerBerichtDialog
        open={openNeu}
        onClose={() => setOpenNeu(false)}
        baustellen={baustellen}
        typ={aktiverTyp}
      />
    </div>
  );
}

// ─── Neuer-Bericht-Modal ──────────────────────────────────────────────────

function NeuerBerichtDialog({
  open,
  onClose,
  baustellen,
  typ,
}: {
  open: boolean;
  onClose: () => void;
  baustellen: Baustelle[];
  typ: BerichtTyp;
}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [datum, setDatum] = useState(todayIso());
  const [baustelleId, setBaustelleId] = useState("");
  const [loading, setLoading] = useState(false);
  // Regiebericht: schon vorhandene am gewählten Tag → fragen, ob öffnen oder
  // weiteren anlegen (mehrere je Tag seit 25.11.2026, J. Maurer).
  const [vorhandene, setVorhandene] = useState<{ id: string; created_at: string }[] | null>(null);

  useEffect(() => {
    if (open) {
      setDatum(todayIso());
      setBaustelleId("");
    }
    setVorhandene(null);
  }, [open]);

  useEffect(() => {
    setVorhandene(null);
  }, [datum, baustelleId]);

  // Vorauswahl der Baustelle aus der Tagesplanung des Polier/Admin für das gewählte Datum
  useEffect(() => {
    if (!open || !datum) return;
    let cancelled = false;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user?.id) return;
      const eint = await getBaustellenForMaToday(u.user.id, datum);
      if (!cancelled && eint[0]?.baustelle_id) {
        setBaustelleId((cur) => cur || eint[0].baustelle_id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, datum]);

  const anlegen = async (opts: { neu?: boolean; oeffnen?: string } = {}) => {
    if (!baustelleId) return;
    if (opts.oeffnen) {
      onClose();
      navigate(`/berichte/${opts.oeffnen}`);
      return;
    }
    setLoading(true);
    try {
      if (typ === "regiebericht" && !opts.neu) {
        const da = await ladeRegieberichteAmTag(baustelleId, datum);
        if (da.length > 0) {
          setVorhandene(da);
          return;
        }
      }
      const { id, created, importiert, ausPlan } = await findeOderErstelleBerichtMitVorausfuellung(
        baustelleId,
        datum,
        typ,
        { neu: typ === "regiebericht" },
      );
      toast({
        title: created
          ? importiert > 0
            ? `Bericht angelegt · ${importiert} MA aus Zeiterfassung übernommen`
            : ausPlan > 0
              ? `Bericht angelegt · ${ausPlan} MA aus dem Tagesplan vorbelegt`
              : "Bericht angelegt"
          : "Bericht existiert bereits — geöffnet",
      });
      onClose();
      navigate(`/berichte/${id}`);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: (e as Error).message,
      });
    } finally {
      setLoading(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void anlegen();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !loading && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck2 className="h-5 w-5 text-primary" />
            Neuer {typ === "bautagesbericht" ? "Bautagesbericht" : "Regiebericht"}
          </DialogTitle>
          <DialogDescription>
            {typ === "bautagesbericht"
              ? "Datum + Baustelle wählen. Wenn für diese Kombination schon ein Bautagesbericht existiert, wird der vorhandene geöffnet — kein Duplikat."
              : "Datum + Baustelle wählen. Gibt es für den Tag schon einen Regiebericht, kannst du ihn öffnen oder einen weiteren anlegen."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label>Datum</Label>
            <Input
              type="date"
              value={datum}
              onChange={(e) => setDatum(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>Baustelle</Label>
<BaustelleCombobox
              baustellen={baustellen}
              value={baustelleId}
              onChange={setBaustelleId}
              placeholder="— wählen (Name oder KST suchen) —"
              triggerClassName="h-10"
            />
            {baustelleId && (
              <div className="text-[10px] text-muted-foreground italic">
                Aus Tagesplanung vorausgewählt — kannst du frei ändern.
              </div>
            )}
          </div>
          {vorhandene && vorhandene.length > 0 ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2" data-testid="regie-vorhanden">
              <div className="text-sm text-amber-900">
                Für diesen Tag gibt es auf der Baustelle schon{" "}
                {vorhandene.length === 1 ? "einen Regiebericht" : `${vorhandene.length} Regieberichte`}.
              </div>
              <div className="flex flex-wrap gap-2">
                {vorhandene.map((v, i) => (
                  <Button
                    key={v.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => anlegen({ oeffnen: v.id })}
                  >
                    {vorhandene.length === 1 ? "Vorhandenen öffnen" : `Nr. ${i + 1} öffnen`}
                  </Button>
                ))}
                <Button type="button" size="sm" onClick={() => anlegen({ neu: true })} disabled={loading}>
                  {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Weiteren Regiebericht anlegen
                </Button>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Abbrechen
            </Button>
            {!vorhandene?.length && (
              <Button type="submit" disabled={!baustelleId || loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Öffnen / Anlegen
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
