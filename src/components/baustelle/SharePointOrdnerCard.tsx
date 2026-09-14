/**
 * Der SharePoint-Ordner dieser Baustelle.
 *
 * Zeigt, welcher Ordner in den Teams der Bauleiter zu dieser Baustelle
 * gehört, wie viele Dateien von dort in der App zu sehen sind und wann
 * zuletzt abgeglichen wurde. Vorschläge lassen sich bestätigen, fehlende
 * Zuordnungen von Hand setzen.
 *
 * In SharePoint wird von hier aus nichts angelegt, nichts geändert und
 * nichts gelöscht. „Verknüpfung lösen" trennt nur die Verbindung in der
 * App; der Ordner in SharePoint bleibt unberührt.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
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

type OrdnerTreffer = {
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
  const [suche, setSuche] = useState("");
  const [treffer, setTreffer] = useState<OrdnerTreffer[]>([]);

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

  // Vorschlag für die Suche: Kostenstelle, sonst der Name der Baustelle.
  useEffect(() => {
    if (sucheOffen && !suche) setSuche((kostenstelle ?? bvhName).slice(0, 20));
  }, [sucheOffen, suche, kostenstelle, bvhName]);

  useEffect(() => {
    if (!sucheOffen) return;
    const begriff = suche.trim();
    if (begriff.length < 3) {
      setTreffer([]);
      return;
    }
    let aktiv = true;
    const t = setTimeout(async () => {
      const { data } = await (supabase as any)
        .from("sharepoint_ordner")
        .select("item_id, site_id, site_name, drive_id, name, pfad, web_url, variante, archiv")
        .ilike("name", `%${begriff}%`)
        .order("archiv")
        .limit(25);
      if (aktiv) setTreffer((data as OrdnerTreffer[]) ?? []);
    }, 250);
    return () => {
      aktiv = false;
      clearTimeout(t);
    };
  }, [suche, sucheOffen]);

  const setzen = async (o: {
    site_id: string;
    site_name: string;
    drive_id: string;
    item_id: string;
    pfad: string;
    web_url: string | null;
    variante: string | null;
  }) => {
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
      toast({ variant: "destructive", title: "Nicht gespeichert", description: error.message });
      setArbeitet(false);
      return;
    }
    setSucheOffen(false);
    setSuche("");
    toast({ title: "Ordner verknüpft", description: o.pfad });
    await abgleichen(true);
  };

  const abgleichen = async (still = false) => {
    setArbeitet(true);
    const { data, error } = await supabase.functions.invoke("sharepoint-sync", {
      body: { modus: "spiegeln", baustelle_id: baustelleId },
    });
    setArbeitet(false);
    if (error) {
      toast({ variant: "destructive", title: "Abgleich fehlgeschlagen", description: error.message });
    } else if (!still) {
      toast({
        title: "Abgeglichen",
        description: `${data?.neu ?? 0} neu, ${data?.geaendert ?? 0} geändert.`,
      });
    }
    void laden_();
  };

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
            Noch kein Ordner zugeordnet.
          </div>
        )}

        {darfAendern && !status.verknuepft && (
          <div className="pt-1">
            {!sucheOffen ? (
              <Button variant="outline" size="sm" className="h-8" onClick={() => setSucheOffen(true)}>
                <Link2 className="h-3.5 w-3.5 mr-1.5" /> Ordner auswählen
              </Button>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={suche}
                    onChange={(e) => setSuche(e.target.value)}
                    placeholder="Ordner suchen — Kostenstelle oder Name"
                    className="h-9 text-sm pl-8"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto rounded-md border divide-y">
                  {treffer.length === 0 ? (
                    <div className="p-3 text-xs text-muted-foreground">
                      {suche.trim().length < 3 ? "Mindestens drei Zeichen." : "Nichts gefunden."}
                    </div>
                  ) : (
                    treffer.map((o) => (
                      <button
                        key={o.item_id}
                        type="button"
                        disabled={arbeitet}
                        onClick={() => setzen(o)}
                        className="w-full text-left p-2 hover:bg-muted/60 disabled:opacity-50"
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
                <Button variant="ghost" size="sm" className="h-7" onClick={() => setSucheOffen(false)}>
                  Abbrechen
                </Button>
              </div>
            )}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground border-t pt-2">
          Die Dateien aus diesem Ordner erscheinen in den Unterlagen der Baustelle. In SharePoint
          ändert die App nichts — dort wird weder etwas angelegt noch gelöscht.
        </p>
      </CardContent>
    </Card>
  );
}
