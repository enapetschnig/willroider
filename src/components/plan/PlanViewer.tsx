/**
 * Plan-Viewer (Wunsch S. Egger, 18.11.2026): Pläne in Tabs wie in einem
 * PDF-Programm, zwei nebeneinander, Wischen am Tablet, Anmerkungen,
 * „Als Kopie speichern“ nach SharePoint, Teilen, offline.
 *
 * Liegt app-weit über allem (AppShell) und merkt sich die offenen Tabs —
 * nach einem Neustart sind dieselben Pläne wieder da.
 */
import { Component, useCallback, useEffect, useState, type ReactNode } from "react";
import { Columns2, X, FileText, Loader2, CloudUpload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { DocSendDialog, type DocSendItem } from "@/components/dokumente/DocSendDialog";
import { BAUSTELLEN_ORDNER } from "@/lib/baustellenOrdner";
import { ladeSharePointUnterordner, SP_PREFIX } from "@/lib/sharepoint";
import { planViewer, usePlanViewer, type PlanTab } from "@/lib/plan/planTabs";
import { planMitAnmerkungenAlsPdf } from "@/lib/plan/planExport";
import { beiKopienAenderung, kopieSpeichern, wartendeKopien } from "@/lib/plan/kopieAblegen";
import { PlanAnsicht, type PlanAktion } from "./PlanAnsicht";

type OrdnerOption = { key: string; sub: string; label: string };

const ordnerWert = (o: { key: string; sub: string }) => `${o.key}|${o.sub}`;

function ordnerLabel(key: string, sub: string): string {
  if (key.startsWith(SP_PREFIX)) {
    const top = key.slice(SP_PREFIX.length);
    return [top || "Baustellenordner", sub].filter(Boolean).join(" / ");
  }
  const l = BAUSTELLEN_ORDNER.find((o) => o.key === key)?.label ?? key;
  return [l, sub].filter(Boolean).join(" / ");
}

async function ladeOrdnerOptionen(baustelleId: string): Promise<OrdnerOption[]> {
  if (!navigator.onLine) return [];
  const { data: bst } = await supabase.from("baustellen").select("sharepoint_item_id").eq("id", baustelleId).maybeSingle();
  if ((bst as any)?.sharepoint_item_id) {
    const uo = await ladeSharePointUnterordner(baustelleId);
    return uo.map((o) => {
      const sub = o.pfad.split("/").slice(1).join("/");
      return { key: `${SP_PREFIX}${o.top}`, sub, label: o.pfad };
    });
  }
  const { data: m } = await supabase.from("dokument_ordner").select("ordner, subpath").eq("baustelle_id", baustelleId);
  const liste: OrdnerOption[] = BAUSTELLEN_ORDNER.filter((o) => o.key !== "00-baustelle").map((o) => ({
    key: o.key,
    sub: "",
    label: o.label,
  }));
  for (const x of (m as { ordner: string; subpath: string }[] | null) ?? []) {
    liste.push({ key: x.ordner, sub: x.subpath, label: ordnerLabel(x.ordner, x.subpath) });
  }
  return liste;
}

function vorschlagName(dateiname: string, vorname?: string | null, nachname?: string | null) {
  const basis = dateiname.replace(/\.[^.]+$/, "");
  const d = new Date();
  const datum = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const kuerzel = `${(vorname ?? "").trim().charAt(0)}${(nachname ?? "").trim().charAt(0)}`.toUpperCase() || "XX";
  return `${basis}_${datum}_${kuerzel}`;
}

/** Fängt Fehler im Viewer ab, damit nie die ganze App hängt. */
class ViewerSchutz extends Component<{ children: ReactNode }, { fehler: Error | null }> {
  state = { fehler: null as Error | null };
  static getDerivedStateFromError(fehler: Error) {
    return { fehler };
  }
  componentDidCatch(e: Error) {
    console.error("Plan-Viewer:", e);
  }
  render() {
    if (!this.state.fehler) return this.props.children;
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="font-semibold">Der Plan-Viewer hatte ein Problem.</div>
        <div className="text-sm text-muted-foreground max-w-md">{this.state.fehler.message}</div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              planViewer.allesSchliessen();
              this.setState({ fehler: null });
            }}
          >
            Alle Pläne schließen
          </Button>
          <Button
            onClick={() => {
              planViewer.schliessen();
              this.setState({ fehler: null });
            }}
          >
            Zurück zur App
          </Button>
        </div>
      </div>
    );
  }
}

export default function PlanViewerMitSchutz() {
  return (
    <ViewerSchutz>
      <PlanViewer />
    </ViewerSchutz>
  );
}

function PlanViewer() {
  const z = usePlanViewer();
  const { toast } = useToast();
  const { profile } = useAuth();
  const [fokus, setFokus] = useState<"links" | "rechts">("links");
  const [kopie, setKopie] = useState<{ a: PlanAktion; name: string; ziel: string; optionen: OrdnerOption[] } | null>(null);
  const [kopieLaeuft, setKopieLaeuft] = useState(false);
  const [mail, setMail] = useState<DocSendItem[] | null>(null);
  const [wartend, setWartend] = useState(0);
  const [breit, setBreit] = useState(() => window.innerWidth >= 768);

  useEffect(() => {
    const r = () => setBreit(window.innerWidth >= 768);
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);

  useEffect(() => {
    const zaehlen = () => wartendeKopien().then((l) => setWartend(l.length));
    zaehlen();
    return beiKopienAenderung(zaehlen);
  }, []);

  // Seite der App nicht mitscrollen lassen
  useEffect(() => {
    const alt = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = alt;
    };
  }, []);

  useEffect(() => {
    if (!z.split) setFokus("links");
  }, [z.split]);

  const tabLinks = z.tabs.find((t) => t.key === z.links) ?? null;
  const tabRechts = z.split ? z.tabs.find((t) => t.key === z.rechts) ?? null : null;

  const kopieOeffnen = useCallback(
    async (a: PlanAktion) => {
      const start: OrdnerOption = {
        key: a.tab.ordnerKey ?? "91-plaene",
        sub: a.tab.subpath ?? "",
        label: ordnerLabel(a.tab.ordnerKey ?? "91-plaene", a.tab.subpath ?? ""),
      };
      const name = vorschlagName(a.tab.dateiname, (profile as any)?.vorname, (profile as any)?.nachname);
      setKopie({ a, name, ziel: ordnerWert(start), optionen: [start] });
      const weitere = await ladeOrdnerOptionen(a.tab.baustelleId).catch(() => []);
      setKopie((k) => {
        if (!k || k.a !== a) return k;
        const alle = [start, ...weitere.filter((o) => ordnerWert(o) !== ordnerWert(start))];
        return { ...k, optionen: alle };
      });
    },
    [profile],
  );

  const kopieSpeichernJetzt = async () => {
    if (!kopie) return;
    const name = kopie.name.trim().replace(/[\\/:*?"<>|]/g, "-");
    if (!name) return;
    const dateiname = /\.pdf$/i.test(name) ? name : `${name}.pdf`;
    const [key, ...rest] = kopie.ziel.split("|");
    const sub = rest.join("|");
    setKopieLaeuft(true);
    try {
      const blob = await planMitAnmerkungenAlsPdf({
        original: kopie.a.inhalt.blob,
        istPdf: kopie.a.inhalt.istPdf,
        daten: kopie.a.daten,
        titel: kopie.a.tab.dateiname,
      });
      const r = await kopieSpeichern({ baustelleId: kopie.a.tab.baustelleId, ordnerKey: key, subpath: sub }, blob, dateiname);
      const tab = kopie.a.tab;
      setKopie(null);
      if (r.status === "hochgeladen") {
        const neu: PlanTab = {
          key: `dok:${r.id}`,
          dateiname,
          mimetype: "application/pdf",
          baustelleId: tab.baustelleId,
          baustelleName: tab.baustelleName,
          storagePath: r.storage_path,
          ordnerKey: key,
          subpath: sub,
        };
        toast({
          title: "Kopie gespeichert",
          description: `„${dateiname}“ liegt in ${ordnerLabel(key, sub)} und wird jetzt nach SharePoint übertragen.`,
          action: (
            <ToastAction altText="Kopie öffnen" onClick={() => planViewer.oeffnen(neu, fokus)}>
              Öffnen
            </ToastAction>
          ),
        });
      } else {
        toast({
          title: "Kopie wartet auf Netz",
          description: `„${dateiname}“ wird hochgeladen, sobald wieder eine Verbindung besteht.`,
        });
      }
    } catch (e) {
      toast({ variant: "destructive", title: "Kopie nicht gespeichert", description: (e as Error).message });
    } finally {
      setKopieLaeuft(false);
    }
  };

  const perMail = async (a: PlanAktion, mitAnmerkungen: boolean) => {
    try {
      if (!mitAnmerkungen && a.tab.key.startsWith("dok:") && a.tab.storagePath) {
        setMail([
          { id: a.tab.key.slice(4), bucket: "baustellen", storage_path: a.tab.storagePath, dateiname: a.tab.dateiname, mimetype: a.tab.mimetype },
        ]);
        return;
      }
      const blob = mitAnmerkungen
        ? await planMitAnmerkungenAlsPdf({ original: a.inhalt.blob, istPdf: a.inhalt.istPdf, daten: a.daten, titel: a.tab.dateiname })
        : a.inhalt.blob;
      const name = mitAnmerkungen ? `${a.tab.dateiname.replace(/\.[^.]+$/, "")}_mit_Anmerkungen.pdf` : a.tab.dateiname;
      setMail([{ bucket: "", storage_path: "", dateiname: name, blob, groesse: blob.size, mimetype: blob.type }]);
    } catch (e) {
      toast({ variant: "destructive", title: "PDF konnte nicht erstellt werden", description: (e as Error).message });
    }
  };

  const linkTeilen = async (a: PlanAktion) => {
    const url = a.inhalt.webUrl;
    if (!url) {
      toast({
        title: "Noch kein SharePoint-Link",
        description: "Diese Datei liegt (noch) nicht in SharePoint. Neue Dateien sind nach dem nächsten Abgleich dort.",
      });
      return;
    }
    try {
      if (navigator.share && /Android|iPhone|iPad|Macintosh/.test(navigator.userAgent) && "ontouchend" in document) {
        await navigator.share({ title: a.tab.dateiname, url });
        return;
      }
    } catch {
      /* abgebrochen → Zwischenablage */
    }
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link kopiert", description: "Öffnen können ihn alle mit Zugriff auf den SharePoint-Ordner." });
    } catch {
      window.prompt("SharePoint-Link:", url);
    }
  };

  if (!z.offen || !tabLinks) return null;

  const ansicht = (tab: PlanTab, seite: "links" | "rechts") => (
    <PlanAnsicht
      key={tab.key}
      tab={tab}
      aktiv={fokus === seite}
      onFokus={() => setFokus(seite)}
      onWischen={(r) => planViewer.blaettern(seite, r)}
      onKopieSpeichern={kopieOeffnen}
      onPerMail={perMail}
      onLinkTeilen={linkTeilen}
    />
  );

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col" role="dialog" aria-label="Plan-Viewer" data-testid="plan-viewer">
      {/* Tab-Leiste */}
      <div className="flex items-stretch border-b bg-muted/60 shrink-0 pt-[env(safe-area-inset-top)]">
        <div className="flex-1 flex items-end gap-0.5 overflow-x-auto px-1 pt-1 [scrollbar-width:thin]" role="tablist">
          {z.tabs.map((t) => {
            const istLinks = t.key === z.links;
            const istRechts = z.split && t.key === z.rechts;
            const sichtbar = istLinks || istRechts;
            return (
              <div
                key={t.key}
                role="tab"
                aria-selected={sichtbar}
                title={`${t.dateiname}${t.baustelleName ? ` · ${t.baustelleName}` : ""}`}
                className={`group flex items-center gap-1 max-w-[220px] min-w-[110px] h-9 pl-2.5 pr-1 rounded-t-md border border-b-0 text-xs cursor-pointer select-none ${
                  sichtbar ? "bg-background font-medium" : "bg-muted hover:bg-background/70 text-muted-foreground"
                }`}
                onClick={() => planViewer.aktivieren(t.key, z.split ? fokus : "links")}
                onAuxClick={(e) => {
                  if (e.button === 1) planViewer.schliessenTab(t.key);
                }}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                {z.split && sichtbar && (
                  <span className="shrink-0 rounded bg-primary/15 text-primary px-1 text-[9px] font-bold">{istLinks ? "L" : "R"}</span>
                )}
                <span className="truncate flex-1">{t.dateiname}</span>
                <button
                  className="h-6 w-6 shrink-0 rounded hover:bg-muted-foreground/20 flex items-center justify-center"
                  aria-label={`${t.dateiname} schließen`}
                  onClick={(e) => {
                    e.stopPropagation();
                    planViewer.schliessenTab(t.key);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-1 px-1.5 shrink-0">
          {wartend > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-[11px]"
              title="Kopien, die hochgeladen werden, sobald Netz da ist"
            >
              <CloudUpload className="h-3.5 w-3.5" /> {wartend} ausstehend
            </span>
          )}
          <Button
            size="sm"
            variant={z.split ? "default" : "outline"}
            className="h-8"
            disabled={z.tabs.length < 2}
            onClick={() => planViewer.nebeneinander(!z.split)}
            title="Zwei Pläne nebeneinander"
          >
            <Columns2 className="h-4 w-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Nebeneinander</span>
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => planViewer.schliessen()} aria-label="Plan-Viewer schließen">
            <X className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Schließen</span>
          </Button>
        </div>
      </div>

      {/* Pläne */}
      <div className={`flex-1 min-h-0 flex ${breit ? "flex-row" : "flex-col"}`}>
        <div className={`flex-1 min-h-0 min-w-0 ${tabRechts ? (breit ? "border-r-2" : "border-b-2") : ""} ${z.split && fokus === "links" ? "border-primary/60" : "border-border"}`}>
          {ansicht(tabLinks, "links")}
        </div>
        {tabRechts && <div className="flex-1 min-h-0 min-w-0">{ansicht(tabRechts, "rechts")}</div>}
      </div>

      {/* Als Kopie speichern */}
      <Dialog open={!!kopie} onOpenChange={(o) => !o && !kopieLaeuft && setKopie(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Als Kopie speichern</DialogTitle>
          </DialogHeader>
          {kopie && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="kopie-name">Dateiname</Label>
                <div className="flex items-center gap-1">
                  <Input id="kopie-name" value={kopie.name} onChange={(e) => setKopie({ ...kopie, name: e.target.value })} />
                  <span className="text-sm text-muted-foreground">.pdf</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Speicherort</Label>
                <Select value={kopie.ziel} onValueChange={(v) => setKopie({ ...kopie, ziel: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {kopie.optionen.map((o, i) => (
                      <SelectItem key={ordnerWert(o)} value={ordnerWert(o)}>
                        {o.label}
                        {i === 0 ? " (Ordner des Plans)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Neue PDF mit Plan und allen Anmerkungen. Das Original bleibt unverändert; in SharePoint wird nichts überschrieben —
                gibt es den Namen schon, hängt SharePoint eine Nummer an.
              </p>
            </div>
          )}
          <DialogFooter className="flex-row gap-2">
            <Button variant="outline" className="flex-1" disabled={kopieLaeuft} onClick={() => setKopie(null)}>
              Abbrechen
            </Button>
            <Button className="flex-1" disabled={kopieLaeuft || !kopie?.name.trim()} onClick={kopieSpeichernJetzt}>
              {kopieLaeuft && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DocSendDialog open={!!mail} onOpenChange={(o) => !o && setMail(null)} items={mail ?? []} />
    </div>
  );
}
