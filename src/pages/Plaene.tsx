/**
 * „Pläne“: zuletzt offene Pläne und die offline gespeicherten — geht auch
 * ganz ohne Netz (Plan-Viewer, Wunsch S. Egger 18.11.2026).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, HardDriveDownload, CloudOff, CloudUpload, Trash2, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { planViewer, usePlanViewer } from "@/lib/plan/planTabs";
import { beiOfflineAenderung, offlineEntfernen, offlinePlaene, type OfflinePlan } from "@/lib/plan/planQuelle";
import { beiKopienAenderung, wartendeKopien } from "@/lib/plan/kopieAblegen";

export default function Plaene() {
  const z = usePlanViewer();
  const [offline, setOffline] = useState<OfflinePlan[]>([]);
  const [wartend, setWartend] = useState<{ key: string; dateiname: string; erstelltAm: string }[]>([]);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const laden = () => {
      offlinePlaene().then(setOffline);
      wartendeKopien().then(setWartend);
    };
    laden();
    const a = beiOfflineAenderung(laden);
    const b = beiKopienAenderung(laden);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      a();
      b();
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const gruppen = useMemo(() => {
    const m = new Map<string, { name: string; plaene: OfflinePlan[] }>();
    for (const p of offline) {
      const g = m.get(p.baustelleId) ?? { name: p.baustelleName || "Baustelle", plaene: [] };
      g.plaene.push(p);
      m.set(p.baustelleId, g);
    }
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, "de"));
  }, [offline]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pläne"
        description="Zuletzt geöffnete und offline gespeicherte Pläne. Pläne öffnest du in der Baustelle unter Dokumente mit einem Klick."
      />
      {!online && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <CloudOff className="h-4 w-4 shrink-0" />
          Keine Verbindung — offline gespeicherte Pläne lassen sich ansehen und bearbeiten, Anmerkungen werden später hochgeladen.
        </div>
      )}

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">Zuletzt offen</div>
            {z.tabs.length > 0 && (
              <Button size="sm" onClick={() => planViewer.zeigen()}>
                Plan-Viewer öffnen ({z.tabs.length})
              </Button>
            )}
          </div>
          {z.tabs.length === 0 ? (
            <div className="text-sm text-muted-foreground">Kein Plan offen.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {z.tabs.map((t) => (
                <button
                  key={t.key}
                  className="inline-flex items-center gap-1.5 rounded border bg-background px-2 py-1 text-xs hover:border-primary"
                  onClick={() => planViewer.oeffnen(t)}
                >
                  <FileText className="h-3.5 w-3.5 text-primary" />
                  <span className="max-w-[220px] truncate">{t.dateiname}</span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 font-semibold">
            <HardDriveDownload className="h-4 w-4" /> Offline gespeichert
          </div>
          {gruppen.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Noch nichts offline. In der Baustelle unter Dokumente → Pläne „Alle Pläne offline speichern“ tippen, oder im
              Plan-Viewer über ⋮ → „Offline speichern“.
            </div>
          ) : (
            gruppen.map(([id, g]) => (
              <div key={id} className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {g.name}
                  {online && (
                    <Link to={`/baustellen/${id}?tab=dokumente`} className="text-xs text-primary inline-flex items-center gap-0.5">
                      <ExternalLink className="h-3 w-3" /> Baustelle
                    </Link>
                  )}
                </div>
                <div className="divide-y rounded border bg-background">
                  {g.plaene.map((p) => (
                    <div key={p.key} className="flex items-center gap-2 px-2 py-1.5">
                      <button className="flex-1 min-w-0 flex items-center gap-2 text-left" onClick={() => planViewer.oeffnen(p)}>
                        <FileText className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate text-sm">{p.dateiname}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {(p.groesse / 1024 / 1024).toFixed(1)} MB · {new Date(p.gespeichertAm).toLocaleDateString("de-AT")}
                        </span>
                      </button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        aria-label="Offline-Fassung entfernen"
                        title="Offline-Fassung entfernen (in SharePoint bleibt alles)"
                        onClick={() => offlineEntfernen(p.key)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {wartend.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 font-semibold">
              <CloudUpload className="h-4 w-4" /> Warten auf Hochladen
            </div>
            {wartend.map((w) => (
              <div key={w.key} className="text-sm flex items-center gap-2">
                <span className="truncate">{w.dateiname}</span>
                <span className="text-[11px] text-muted-foreground">ausstehend seit {new Date(w.erstelltAm).toLocaleString("de-AT")}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
