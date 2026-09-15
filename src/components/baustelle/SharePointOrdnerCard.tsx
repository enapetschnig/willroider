/**
 * Der SharePoint-Ordner dieser Baustelle.
 *
 * Zeigt, welcher Ordner in den Teams der Bauleiter zu dieser Baustelle
 * gehört, wie viele Dateien von dort in der App zu sehen sind und wann
 * zuletzt abgeglichen wurde. Vorschläge lassen sich bestätigen, fehlende
 * Zuordnungen von Hand setzen.
 *
 * Ordner werden in SharePoint nicht angelegt — die Verknüpfung mit einem
 * vorhandenen Ordner passiert hier von Hand. Gelöscht, überschrieben oder
 * umbenannt wird dort nie. „Verknüpfung lösen" trennt nur die Verbindung
 * in der App; der Ordner in SharePoint bleibt unberührt.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { SharePointVerknuepfenDialog } from "@/components/baustelle/SharePointVerknuepfenDialog";
import {
  Cloud,
  CloudOff,
  ExternalLink,
  Link2,
  Link2Off,
  Loader2,
  RefreshCw,
  Search,
  Check,
  X,
} from "lucide-react";

type Status = {
  baustelle_id: string;
  verknuepft: boolean;
  dateien: number;
  sharepoint_site_name: string | null;
  sharepoint_pfad: string | null;
  sharepoint_web_url: string | null;
  sharepoint_variante: string | null;
  sharepoint_abgleich_am: string | null;
  vorschlag_pfad: string | null;
  vorschlag_site: string | null;
  vorschlag_item_id: string | null;
  vorschlag_drive_id: string | null;
  vorschlag_site_id: string | null;
  vorschlag_web_url: string | null;
  vorschlag_variante: string | null;
  vorschlag_grund: string | null;
};

const zeit = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("de-AT", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "noch nie";

export function SharePointOrdnerCard({
  baustelleId,
  kostenstelle,
  bvhName,
  darfAendern,
}: {
  baustelleId: string;
  kostenstelle: string | null;
  bvhName: string;
  darfAendern: boolean;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [laden, setLaden] = useState(true);
  const [arbeitet, setArbeitet] = useState(false);
  const [sucheOffen, setSucheOffen] = useState(false);

  const laden_ = useCallback(async () => {
    setLaden(true);
    const { data } = await (supabase as any)
      .from("v_sharepoint_status")
      .select("*")
      .eq("baustelle_id", baustelleId)
      .maybeSingle();
    setStatus((data as Status) ?? null);
    setLaden(false);
  }, [baustelleId]);

  useEffect(() => {
    void laden_();
  }, [laden_]);

  const loesen = async () => {
    if (
      !window.confirm(
        "Verknüpfung lösen? In SharePoint bleibt alles unverändert — in der App werden die gespiegelten Dateien nur nicht mehr angezeigt.",
      )
    )
      return;
    setArbeitet(true);
    const { error } = await (supabase as any).rpc("sharepoint_zuordnung_loesen", {
      p_baustelle: baustelleId,
    });
    setArbeitet(false);
    if (error) toast({ variant: "destructive", title: "Nicht gelöst", description: error.message });
    else toast({ title: "Verknüpfung gelöst" });
    void laden_();
  };

  const vorschlagAblehnen = async () => {
    await (supabase as any).from("sharepoint_vorschlaege").delete().eq("baustelle_id", baustelleId);
    toast({ title: "Vorschlag verworfen" });
    void laden_();
  };

  const variantenText = useMemo(() => {
    const v = status?.sharepoint_variante;
    if (!v) return "Ordner ohne die übliche Unterteilung — alles landet in 92-Sonstiges.";
    return v === "A"
      ? "Unterordner wie in der App."
      : v === "B"
        ? "Ältere Vorlage — 4-Kalkulation, 7-Abrechnung und 9-Pläne werden umgesetzt."
        : "Vorlage Eckart Egger — 8-DHP und 9-Pläne werden umgesetzt.";
  }, [status?.sharepoint_variante]);

  if (laden) {
    return (
      <Card>
        <CardContent className="p-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 inline mr-2 animate-spin" />
          SharePoint …
        </CardContent>
      </Card>
    );
  }
  if (!status) return null;

  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground flex-1">
            SharePoint-Ordner
          </div>
          {status.verknuepft && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-[10px] font-medium text-sky-800">
              <Cloud className="h-3 w-3" />
              {status.dateien} Datei{status.dateien === 1 ? "" : "en"}
            </span>
          )}
        </div>

        {status.verknuepft ? (
          <>
            <div className="text-sm font-medium break-all">{status.sharepoint_pfad}</div>
            <div className="text-[11px] text-muted-foreground">
              {status.sharepoint_site_name} · letzter Abgleich {zeit(status.sharepoint_abgleich_am)}
            </div>
            <div className="text-[11px] text-muted-foreground">{variantenText}</div>
            <div className="flex flex-wrap gap-2 pt-1">
              {status.sharepoint_web_url && (
                <Button asChild variant="outline" size="sm" className="h-8">
                  <a href={status.sharepoint_web_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> In SharePoint öffnen
                  </a>
                </Button>
              )}
              {darfAendern && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={arbeitet}
                    onClick={() => abgleichen()}
                  >
                    {arbeitet ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    Jetzt abgleichen
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-muted-foreground"
                    disabled={arbeitet}
                    onClick={loesen}
                  >
                    <Link2Off className="h-3.5 w-3.5 mr-1.5" /> Verknüpfung lösen
                  </Button>
                </>
              )}
            </div>
          </>
        ) : status.vorschlag_item_id ? (
          <>
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 space-y-1">
              <div className="text-xs font-semibold text-amber-900">Passt dieser Ordner?</div>
              <div className="text-sm break-all">{status.vorschlag_pfad}</div>
              <div className="text-[11px] text-amber-800">
                {status.vorschlag_site} · erkannt über {status.vorschlag_grund}
              </div>
            </div>
            {darfAendern && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="h-8"
                  disabled={arbeitet}
                  onClick={() =>
                    setzen({
                      site_id: status.vorschlag_site_id!,
                      site_name: status.vorschlag_site!,
                      drive_id: status.vorschlag_drive_id!,
                      item_id: status.vorschlag_item_id!,
                      pfad: status.vorschlag_pfad!,
                      web_url: status.vorschlag_web_url,
                      variante: status.vorschlag_variante,
                    })
                  }
                >
                  <Check className="h-3.5 w-3.5 mr-1.5" /> Ja, verknüpfen
                </Button>
                <Button variant="outline" size="sm" className="h-8" onClick={vorschlagAblehnen}>
                  <X className="h-3.5 w-3.5 mr-1.5" /> Passt nicht
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <CloudOff className="h-4 w-4 shrink-0" />
            Noch kein Ordner verknüpft. Der Ordner wird wie gewohnt in SharePoint angelegt und
            hier ausgewählt.
          </div>
        )}

        {darfAendern && !status.verknuepft && (
          <div className="pt-1">
            <Button size="sm" className="h-8" onClick={() => setSucheOffen(true)}>
              <Link2 className="h-3.5 w-3.5 mr-1.5" /> Mit OneDrive verknüpfen
            </Button>
          </div>
        )}

        <SharePointVerknuepfenDialog
          open={sucheOffen}
          onClose={() => setSucheOffen(false)}
          baustelleId={baustelleId}
          kostenstelle={kostenstelle}
          bvhName={bvhName}
          onVerknuepft={laden_}
        />

        <p className="text-[11px] text-muted-foreground border-t pt-2">
          Die Dateien aus diesem Ordner erscheinen in den Unterlagen der Baustelle, und was in der
          App hochgeladen wird, wandert dorthin. Gelöscht wird in SharePoint nie: Was du in der App
          löschst, bleibt dort bestehen.
        </p>
      </CardContent>
    </Card>
  );
}
