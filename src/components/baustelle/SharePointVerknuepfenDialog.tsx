/**
 * Eine Baustelle mit ihrem Ordner in SharePoint verknüpfen.
 *
 * Gesucht wird im Verzeichnis der Baustellenordner, das die App regelmäßig
 * einliest. Beim Öffnen wird es zusätzlich frisch aus SharePoint geholt —
 * sonst fehlt ein Ordner, der gerade erst angelegt wurde (Vorfall 13.10.,
 * N. Gwenger: „Painter Carport" nicht gefunden). Angelegt wird in SharePoint nichts — der Ordner wird dort wie
 * gewohnt von Hand erstellt und hier nur ausgewählt.
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Cloud, FolderPlus, Loader2, Search } from "lucide-react";
import { sharePointNachAnlegen } from "@/lib/sharepoint";

export type OrdnerTreffer = {
  item_id: string;
  site_id: string;
  site_name: string;
  drive_id: string;
  name: string;
  pfad: string;
  web_url: string | null;
  variante: string | null;
  archiv: boolean;
};

export function SharePointVerknuepfenDialog({
  open,
  onClose,
  baustelleId,
  kostenstelle,
  bvhName,
  onVerknuepft,
}: {
  open: boolean;
  onClose: () => void;
  baustelleId: string;
  kostenstelle: string | null;
  bvhName: string;
  onVerknuepft?: () => void;
}) {
  const { toast } = useToast();
  const [suche, setSuche] = useState("");
  const [treffer, setTreffer] = useState<OrdnerTreffer[]>([]);
  const [sucht, setSucht] = useState(false);
  const [arbeitet, setArbeitet] = useState(false);
  const [frischt, setFrischt] = useState(false);
  const [aufgefrischt, setAufgefrischt] = useState(0);
  /** Bauleiter dieser Baustelle hat die neue Ordnerstruktur → „Neu anlegen" anbieten. */
  const [darfNeu, setDarfNeu] = useState(false);

  useEffect(() => {
    if (!open) return;
    let aktiv = true;
    (async () => {
      const [{ data: b }, { data: st }] = await Promise.all([
        supabase.from("baustellen").select("bauleiter_id, art").eq("id", baustelleId).maybeSingle(),
        (supabase as any).from("app_settings").select("value").eq("key", "sharepoint_neue_struktur").maybeSingle(),
      ]);
      const v = (st?.value ?? null) as { alle?: boolean; bauleiter_ids?: string[] } | null;
      const bl = (b as { bauleiter_id?: string | null; art?: string | null } | null) ?? null;
      if (!aktiv) return;
      setDarfNeu(
        !!v && !!bl?.bauleiter_id && (bl.art ?? "ausfuehrung") === "ausfuehrung" &&
          (v.alle === true || (v.bauleiter_ids ?? []).includes(bl.bauleiter_id)),
      );
    })();
    return () => {
      aktiv = false;
    };
  }, [open, baustelleId]);

  const neuAnlegen = async () => {
    setArbeitet(true);
    const r = await sharePointNachAnlegen(baustelleId);
    setArbeitet(false);
    if (r?.angelegt || r?.schon_da) {
      toast({ title: r.angelegt ? "Ordner angelegt" : "Ordner verknüpft", description: r.pfad });
      onVerknuepft?.();
      onClose();
    } else {
      toast({
        variant: "destructive",
        title: "Nicht angelegt",
        description: r?.hinweis ?? r?.fehler ?? "Unbekannter Fehler",
      });
    }
  };

  // Verzeichnis beim Öffnen auffrischen (die Funktion überspringt, wenn es
  // jünger als eine Minute ist), danach die Suche erneut laufen lassen.
  useEffect(() => {
    if (!open) return;
    let aktiv = true;
    setFrischt(true);
    supabase.functions
      .invoke("sharepoint-sync", { body: { modus: "ordner" } })
      .catch(() => undefined)
      .finally(() => {
        if (!aktiv) return;
        setFrischt(false);
        setAufgefrischt((n) => n + 1);
      });
    return () => {
      aktiv = false;
    };
  }, [open]);

  // Beim Öffnen mit dem naheliegendsten Suchbegriff starten.
  useEffect(() => {
    if (open) setSuche((kostenstelle || bvhName || "").slice(0, 24));
    else setTreffer([]);
  }, [open, kostenstelle, bvhName]);

  useEffect(() => {
    if (!open) return;
    const begriff = suche.trim();
    if (begriff.length < 3) {
      setTreffer([]);
      return;
    }
    let aktiv = true;
    setSucht(true);
    const t = setTimeout(async () => {
      const { data } = await (supabase as any)
        .from("sharepoint_ordner")
        .select("item_id, site_id, site_name, drive_id, name, pfad, web_url, variante, archiv")
        .ilike("name", `%${begriff}%`)
        .order("archiv")
        .limit(30);
      if (!aktiv) return;
      setTreffer((data as OrdnerTreffer[]) ?? []);
      setSucht(false);
    }, 250);
    return () => {
      aktiv = false;
      clearTimeout(t);
    };
  }, [suche, open, aufgefrischt]);

  const verknuepfen = async (o: OrdnerTreffer) => {
    setArbeitet(true);
    const { error } = await (supabase as any).rpc("sharepoint_zuordnung_setzen", {
      p_baustelle: baustelleId,
      p_site_id: o.site_id,
      p_site_name: o.site_name,
      p_drive_id: o.drive_id,
      p_item_id: o.item_id,
      p_pfad: o.pfad,
      p_web_url: o.web_url,
      p_variante: o.variante,
    });
    if (error) {
      setArbeitet(false);
      toast({ variant: "destructive", title: "Nicht verknüpft", description: error.message });
      return;
    }
    // Gleich abgleichen, damit die Unterlagen sofort da sind.
    await supabase.functions
      .invoke("sharepoint-sync", { body: { modus: "spiegeln", baustelle_id: baustelleId } })
      .catch(() => undefined);
    setArbeitet(false);
    toast({ title: "Ordner verknüpft", description: o.pfad });
    onVerknuepft?.();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !arbeitet && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-primary" />
            Ordner verknüpfen
          </DialogTitle>
          <DialogDescription>
            {bvhName}
            {kostenstelle ? ` · ${kostenstelle}` : ""} — such den Ordner aus SharePoint und tipp ihn
            an. In SharePoint wird dabei nichts angelegt und nichts verändert.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              placeholder="Kostenstelle oder Name"
              className="h-10 pl-8"
            />
          </div>
          <div className="max-h-72 overflow-y-auto rounded-md border divide-y">
            {suche.trim().length < 3 ? (
              <div className="p-3 text-xs text-muted-foreground">Mindestens drei Zeichen.</div>
            ) : sucht ? (
              <div className="p-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 inline mr-1.5 animate-spin" />
                Suche …
              </div>
            ) : treffer.length === 0 && frischt ? (
              <div className="p-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 inline mr-1.5 animate-spin" />
                SharePoint wird nach neuen Ordnern durchsucht …
              </div>
            ) : treffer.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">
                Nichts gefunden. Anderen Begriff versuchen — oder den Ordner zuerst in SharePoint
                anlegen, er taucht dann hier auf.
              </div>
            ) : (
              treffer.map((o) => (
                <button
                  key={o.item_id}
                  type="button"
                  disabled={arbeitet}
                  onClick={() => verknuepfen(o)}
                  className="w-full text-left p-2.5 hover:bg-muted/60 disabled:opacity-50"
                >
                  <div className="text-sm font-medium truncate">{o.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {o.site_name} · {o.pfad}
                    {o.archiv ? " · abgerechnet" : ""}
                  </div>
                </button>
              ))
            )}
          </div>
          {darfNeu && (
            <Button variant="outline" className="w-full" onClick={neuAnlegen} disabled={arbeitet}>
              {arbeitet ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FolderPlus className="h-4 w-4 mr-2" />}
              Neuen Ordner nach Vorlage anlegen
            </Button>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">
              {frischt && treffer.length > 0 ? (
                <>
                  <Loader2 className="h-3 w-3 inline mr-1 animate-spin" />
                  SharePoint wird nach neuen Ordnern durchsucht …
                </>
              ) : null}
            </span>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={arbeitet}>
              Abbrechen
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
