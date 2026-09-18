/**
 * Archiv der Arbeitseinteilung — die wöchentlich automatisch abgelegten
 * PDFs (Edge Function einsatzplan-pdf, Cron mittwochs) plus manuelle Läufe.
 * Änderungswunsch f40a078a (Sebastian Egger / Johannes Maurer): vergangene
 * Kalenderwochen aufrufen können, Ausdruck automatisiert, Optik wie am Schirm.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Archive, Cloud, CloudOff, Download, Loader2, RefreshCw } from "lucide-react";

type ArchivZeile = {
  id: string;
  jahr: number;
  kw: number;
  von_datum: string;
  bis_datum: string;
  format: string;
  storage_pfad: string;
  dateiname: string;
  sharepoint_item_id: string | null;
  sharepoint_fehler: string | null;
  automatisch: boolean;
  erzeugt_am: string;
};

const fmt = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" });

export function EinsatzplanArchiv({
  canEdit,
  format,
}: {
  canEdit: boolean;
  /** Papierformat für den manuellen Lauf — dasselbe wie im Dialog gewählt. */
  format: "a4" | "a3" | "a2";
}) {
  const { toast } = useToast();
  const [zeilen, setZeilen] = useState<ArchivZeile[]>([]);
  const [laden, setLaden] = useState(true);
  const [busy, setBusy] = useState(false);
  const [oeffne, setOeffne] = useState<string | null>(null);

  const load = async () => {
    const { data } = await (supabase as any)
      .from("einsatzplan_archiv")
      .select("*")
      .order("erzeugt_am", { ascending: false })
      .limit(60);
    setZeilen((data as ArchivZeile[]) ?? []);
    setLaden(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const oeffnen = async (z: ArchivZeile) => {
    setOeffne(z.id);
    try {
      const { data, error } = await supabase.storage
        .from("einsatzplaene")
        .createSignedUrl(z.storage_pfad, 120, { download: z.dateiname });
      if (error || !data?.signedUrl) throw error ?? new Error("Kein Link");
      window.open(data.signedUrl, "_blank", "noopener");
    } catch (e) {
      toast({ variant: "destructive", title: "Öffnen fehlgeschlagen", description: (e as Error).message });
    } finally {
      setOeffne(null);
    }
  };

  const jetztAblegen = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("einsatzplan-pdf", {
        body: { modus: "jetzt", format },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.fehler ?? "Unbekannter Fehler");
      toast({
        title: `KW ${data.kw} ins Archiv gelegt`,
        description:
          data.sharepoint === "abgelegt"
            ? "Auch im SharePoint-Ordner „Einsatzplanung PDF“ abgelegt."
            : `SharePoint: ${data.sharepoint}`,
      });
      await load();
    } catch (e) {
      toast({ variant: "destructive", title: "Ablegen fehlgeschlagen", description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Archive className="h-3.5 w-3.5" />
          Archiv (jede Woche automatisch)
        </div>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={jetztAblegen} disabled={busy} className="h-8">
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            )}
            Jetzt ablegen
          </Button>
        )}
      </div>
      <div className="text-[11px] text-muted-foreground">
        Mittwochs früh wird die Einteilung ab Montag der laufenden Woche für 12 Wochen als
        A3-PDF abgelegt — hier und im SharePoint-Ordner „Einsatzplanung PDF“. So lassen
        sich frühere Kalenderwochen jederzeit aufrufen.
      </div>
      {laden ? (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Lade…
        </div>
      ) : zeilen.length === 0 ? (
        <div className="text-xs text-muted-foreground">Noch nichts abgelegt.</div>
      ) : (
        <div className="max-h-52 overflow-y-auto divide-y rounded border">
          {zeilen.map((z) => (
            <div key={z.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-medium">
                  KW {z.kw} / {z.jahr}
                  <span className="text-xs text-muted-foreground font-normal ml-2">
                    {fmt(z.von_datum)} – {fmt(z.bis_datum)} · {z.format.toUpperCase()}
                    {z.automatisch ? "" : " · manuell"}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {new Date(z.erzeugt_am).toLocaleString("de-AT", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
              {z.sharepoint_item_id ? (
                <Cloud className="h-4 w-4 text-sky-600 shrink-0" aria-label="In SharePoint abgelegt" />
              ) : (
                <CloudOff
                  className="h-4 w-4 text-muted-foreground shrink-0"
                  aria-label={z.sharepoint_fehler ?? "Nicht in SharePoint"}
                />
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={() => oeffnen(z)}
                disabled={oeffne === z.id}
                title="PDF öffnen"
              >
                {oeffne === z.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
