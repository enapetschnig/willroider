/**
 * Berichte-Archiv — fertige Tätigkeitsberichte (freigegeben) und
 * Stundenberichte (bestätigt) als PDF. Von hier aus: nachsehen,
 * herunterladen, gesammelt ans Lohnbüro mailen (eine Mail, alle PDFs).
 * Abgestimmt mit Johannes Maurer am 21.09.2026.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { edgeFunctionErrorMessage } from "@/lib/edgeError";
import { archivDownloadUrl } from "@/lib/berichtArchiv";
import { Archive, Cloud, CloudOff, Download, Loader2, Mail, CheckCircle2, AlertTriangle } from "lucide-react";

type Zeile = {
  id: string;
  art: "taetigkeitsbericht" | "stundenbericht";
  mitarbeiter_id: string;
  jahr: number;
  monat: number;
  teil: number | null;
  periode_label: string;
  storage_pfad: string;
  dateiname: string;
  groesse: number | null;
  sharepoint_item_id: string | null;
  sharepoint_fehler: string | null;
  versendet_am: string | null;
  versendet_an: string | null;
  erstellt_am: string;
  /** Bericht wurde danach wieder geöffnet — dieses PDF gilt nicht mehr. */
  ueberholt_am: string | null;
  mitarbeiter: { vorname: string; nachname: string } | null;
};

const MONATE = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";

export default function BerichteArchiv() {
  const { toast } = useToast();
  const heute = new Date();
  const [art, setArt] = useState<"taetigkeitsbericht" | "stundenbericht">("taetigkeitsbericht");
  const [jahr, setJahr] = useState(heute.getFullYear());
  const [monat, setMonat] = useState(heute.getMonth() + 1);
  const [teil, setTeil] = useState<0 | 1 | 2>(0);
  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const [laden, setLaden] = useState(true);
  const [ausgewaehlt, setAusgewaehlt] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  /** Vollständigkeit: wie viele Personen/Berichte gehören zur Periode. */
  const [soll, setSoll] = useState<{ ist: number; soll: number; text: string } | null>(null);

  // Mail-Dialog
  const [mailOffen, setMailOffen] = useState(false);
  const [empfaenger, setEmpfaenger] = useState("");
  const [betreff, setBetreff] = useState("");
  const [text, setText] = useState("");
  const [sende, setSende] = useState(false);

  const load = useCallback(async () => {
    setLaden(true);
    let q = (supabase as any)
      .from("bericht_archiv")
      .select("*, mitarbeiter:profiles!mitarbeiter_id(vorname, nachname)")
      .eq("art", art)
      .eq("jahr", jahr)
      .eq("monat", monat)
      .order("erstellt_am", { ascending: false });
    if (art === "stundenbericht" && teil) q = q.eq("teil", teil);
    const { data } = await q;
    const liste = (data as Zeile[]) ?? [];
    setZeilen(liste);
    setAusgewaehlt(new Set());

    // Vollständigkeit — nur gültige (nicht überholte) Dateien zählen.
    const personen = new Set(liste.filter((z) => !z.ueberholt_am).map((z) => `${z.mitarbeiter_id}|${z.teil ?? ""}`)).size;
    if (art === "taetigkeitsbericht") {
      const { count } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .eq("zeiterfassung_typ", "angestellter" as any);
      setSoll({ ist: personen, soll: count ?? 0, text: "Angestellte" });
    } else {
      let bq = supabase.from("stunden_berichte").select("id", { count: "exact", head: true }).eq("jahr", jahr).eq("monat", monat);
      if (teil) bq = bq.eq("teil", teil);
      const { count } = await bq;
      setSoll({ ist: personen, soll: count ?? 0, text: "Stundenberichte der Periode" });
    }
    setLaden(false);
  }, [art, jahr, monat, teil]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    supabase
      .from("app_einstellungen")
      .select("wert")
      .eq("schluessel", "bsb_buero_mail")
      .maybeSingle()
      .then(({ data }) => setEmpfaenger(((data as any)?.wert as string) ?? ""));
  }, []);

  /** Je Person (und Teil) nur die neueste Datei — ältere Stände bleiben aufklappbar. */
  const neueste = useMemo(() => {
    const seen = new Set<string>();
    return zeilen.filter((z) => {
      const k = `${z.mitarbeiter_id}|${z.teil ?? ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [zeilen]);
  const aeltere = zeilen.length - neueste.length;

  const gueltige = neueste.filter((z) => !z.ueberholt_am);
  const alleGewaehlt = gueltige.length > 0 && gueltige.every((z) => ausgewaehlt.has(z.id));
  const toggleAlle = () =>
    setAusgewaehlt(alleGewaehlt ? new Set() : new Set(gueltige.map((z) => z.id)));
  const toggle = (id: string) =>
    setAusgewaehlt((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const herunterladen = async (z: Zeile) => {
    setBusy(z.id);
    try {
      window.open(await archivDownloadUrl(z.storage_pfad, z.dateiname), "_blank", "noopener");
    } catch (e) {
      toast({ variant: "destructive", title: "Download fehlgeschlagen", description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const periodeText =
    art === "taetigkeitsbericht"
      ? `${MONATE[(monat + 10) % 12]} - ${MONATE[monat - 1]} ${jahr}`
      : `${MONATE[monat - 1]} ${jahr}${teil ? ` · Teil ${teil === 1 ? "I" : "II"}` : ""}`;

  const mailOeffnen = () => {
    const n = ausgewaehlt.size;
    setBetreff(`${art === "taetigkeitsbericht" ? "Tätigkeitsberichte" : "Stundenberichte"} ${periodeText}`);
    setText(
      `Im Anhang ${n === 1 ? "der Bericht" : `die ${n} Berichte`} (${art === "taetigkeitsbericht" ? "Tätigkeitsberichte" : "Baustellenstundenberichte"}) für ${periodeText}.\n\nBei Rückfragen bitte melden.`,
    );
    setMailOffen(true);
  };

  const senden = async () => {
    setSende(true);
    try {
      const { data, error } = await supabase.functions.invoke("archiv-versenden", {
        body: { archiv_ids: Array.from(ausgewaehlt), empfaenger: empfaenger.trim(), betreff, text },
      });
      if (error) throw new Error(await edgeFunctionErrorMessage(error));
      if (!data?.ok) throw new Error(data?.fehler ?? "Versand fehlgeschlagen");
      toast({
        title: `${data.anzahl} Bericht${data.anzahl === 1 ? "" : "e"} versendet`,
        description: `an ${data.empfaenger}${data.als_links ? " (als Download-Links, weil zu groß für den Anhang)" : ""}`,
      });
      setMailOffen(false);
      void load();
    } catch (e) {
      toast({ variant: "destructive", title: "Versand nicht durchgekommen", description: (e as Error).message });
    } finally {
      setSende(false);
    }
  };

  const unvollstaendig = !!soll && soll.ist < soll.soll;

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <PageHeader
        title="Berichte-Archiv"
        description="Freigegebene Tätigkeitsberichte und bestätigte Stundenberichte — hier und als Kopie in SharePoint."
      />

      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="inline-flex rounded-lg border p-0.5 bg-muted/40">
              {(
                [
                  ["taetigkeitsbericht", "Tätigkeitsberichte"],
                  ["stundenbericht", "Stundenberichte"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setArt(k)}
                  className={`px-4 h-9 rounded-md text-sm font-medium transition ${
                    art === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div>
              <Label className="text-xs">Jahr</Label>
              <Input type="number" value={jahr} onChange={(e) => setJahr(Number(e.target.value) || jahr)} className="h-9 w-24" />
            </div>
            <div>
              <Label className="text-xs">{art === "taetigkeitsbericht" ? "Periode (endet am 20.)" : "Monat"}</Label>
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm block"
                value={monat}
                onChange={(e) => setMonat(Number(e.target.value))}
              >
                {MONATE.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {art === "taetigkeitsbericht" ? `${MONATE[(i + 11) % 12]} - ${m}` : m}
                  </option>
                ))}
              </select>
            </div>
            {art === "stundenbericht" && (
              <div>
                <Label className="text-xs">Teil</Label>
                <div className="flex gap-1">
                  {([0, 1, 2] as const).map((t) => (
                    <Button key={t} size="sm" variant={teil === t ? "default" : "outline"} className="h-9" onClick={() => setTeil(t)}>
                      {t === 0 ? "Beide" : t === 1 ? "1.–16." : "17.–Ende"}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {soll && (
            <div className={`text-sm flex items-center gap-2 ${unvollstaendig ? "text-amber-800" : "text-emerald-800"}`}>
              {unvollstaendig ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {soll.ist} von {soll.soll} {soll.text} im Archiv
              {unvollstaendig && " — noch nicht alle erfasst; gesammelt versenden geht trotzdem, wenn du willst."}
            </div>
          )}
        </CardContent>
      </Card>

      {ausgewaehlt.size > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-3 flex items-center gap-3 flex-wrap">
            <div className="text-sm">
              <strong>{ausgewaehlt.size}</strong> Bericht{ausgewaehlt.size === 1 ? "" : "e"} markiert
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAusgewaehlt(new Set())}>
                Auswahl löschen
              </Button>
              <Button size="sm" onClick={mailOeffnen}>
                <Mail className="h-3.5 w-3.5 mr-1.5" /> Gesammelt per Mail senden
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {laden ? (
            <div className="p-4 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Lade…
            </div>
          ) : neueste.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <Archive className="h-6 w-6 mx-auto mb-2 opacity-50" />
              Noch nichts im Archiv für {periodeText}. Berichte landen hier nach der{" "}
              {art === "taetigkeitsbericht" ? "Freigabe" : "Bestätigung und dem Versand"}.
            </div>
          ) : (
            <div className="divide-y">
              <div className="flex items-center gap-3 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                <Checkbox checked={alleGewaehlt} onCheckedChange={toggleAlle} aria-label="Alle auswählen" />
                <span className="flex-1">Mitarbeiter</span>
                <span>SharePoint · Versand</span>
              </div>
              {neueste.map((z) => (
                <div key={z.id} className="flex items-center gap-3 px-3 py-2">
                  <Checkbox
                    checked={ausgewaehlt.has(z.id)}
                    onCheckedChange={() => toggle(z.id)}
                    disabled={!!z.ueberholt_am}
                    aria-label="Bericht auswählen"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {z.mitarbeiter ? `${z.mitarbeiter.nachname} ${z.mitarbeiter.vorname}` : "—"}
                      <span className="text-xs text-muted-foreground font-normal ml-2">{z.periode_label}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {z.dateiname} · abgelegt {fmt(z.erstellt_am)}
                      {z.groesse ? ` · ${Math.round(z.groesse / 1024)} KB` : ""}
                    </div>
                  </div>
                  {z.sharepoint_item_id ? (
                    <Cloud className="h-4 w-4 text-sky-600 shrink-0" aria-label="In SharePoint abgelegt" />
                  ) : (
                    <CloudOff className="h-4 w-4 text-muted-foreground shrink-0" aria-label={z.sharepoint_fehler ?? "SharePoint-Kopie folgt"} />
                  )}
                  {z.ueberholt_am ? (
                    <Badge variant="outline" className="bg-amber-100 text-amber-900 border-amber-300 text-[10px]" title="Der Bericht wurde danach wieder geöffnet — neu freigeben/bestätigen, dann kommt ein neues PDF.">
                      überholt
                    </Badge>
                  ) : z.versendet_am ? (
                    <Badge variant="outline" className="bg-emerald-100 text-emerald-900 border-emerald-300 text-[10px]">
                      versendet {fmt(z.versendet_am)}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      nicht versendet
                    </Badge>
                  )}
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => herunterladen(z)} disabled={busy === z.id} title="PDF öffnen">
                    {busy === z.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  </Button>
                </div>
              ))}
              {aeltere > 0 && (
                <div className="px-3 py-2 text-[11px] text-muted-foreground">
                  {aeltere} ältere{aeltere === 1 ? "r Stand" : " Stände"} (vor „Wieder öffnen“) bleiben im Archiv und in SharePoint erhalten.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={mailOffen} onOpenChange={setMailOffen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" /> {ausgewaehlt.size} Bericht{ausgewaehlt.size === 1 ? "" : "e"} in einer Mail senden
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {unvollstaendig && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 flex gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Es sind erst {soll?.ist} von {soll?.soll} {soll?.text} im Archiv. Wenn du wartest, bis alle da sind, braucht das Büro nur eine Mail.
              </div>
            )}
            <div>
              <Label className="text-xs">Empfänger</Label>
              <Input type="email" value={empfaenger} onChange={(e) => setEmpfaenger(e.target.value)} placeholder="buero@willroider.at" className="h-10" />
            </div>
            <div>
              <Label className="text-xs">Betreff</Label>
              <Input value={betreff} onChange={(e) => setBetreff(e.target.value)} className="h-10" />
            </div>
            <div>
              <Label className="text-xs">Text</Label>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} />
            </div>
          </div>
          <DialogFooter className="flex-row gap-2">
            <Button variant="outline" onClick={() => setMailOffen(false)} className="flex-1" disabled={sende}>
              Abbrechen
            </Button>
            <Button onClick={senden} className="flex-1" disabled={sende || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(empfaenger.trim())}>
              {sende ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Mail className="h-4 w-4 mr-1.5" />}
              Senden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
