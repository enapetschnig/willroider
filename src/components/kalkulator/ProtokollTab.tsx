/**
 * Lokales Protokoll der Logins + gespeicherten Anfragen — nur im
 * aktuellen Browser. Server-seitig liegen die Anfragen in
 * kalkulator_anfragen (eigene Page).
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trash2 } from "lucide-react";
import type { K3Satz, K7Override, ProjektDaten } from "@/lib/kalkulator/calc";
import type { KalkulatorState, EventlogEntry } from "@/hooks/useKalkulator";

type K3State = KalkulatorState["k3"];

interface TabProps {
  state: KalkulatorState;
  setProjekt: (patch: Partial<ProjektDaten>) => void;
  setMenge: (posKey: string, value: number) => void;
  setOverride: (posKey: string, field: keyof K7Override, value: number | undefined) => void;
  setStuetzeLen: (len: number) => void;
  setK3: (gruppe: keyof K3State, patch: Partial<K3Satz>) => void;
  k3SyncStatus: string;
  addEvent?: (entry: EventlogEntry) => void;
  clearEventlog?: () => void;
}

function badgeFor(typ: string) {
  if (typ === "Anfrage")
    return (
      <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white">
        Anfrage
      </Badge>
    );
  if (typ === "Login")
    return (
      <Badge className="bg-blue-600 hover:bg-blue-700 text-white">Login</Badge>
    );
  return <Badge variant="outline">{typ}</Badge>;
}

export default function ProtokollTab({ state, clearEventlog }: TabProps) {
  const log = state.eventlog;

  return (
    <Card>
      <CardContent className="p-4 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-xl sm:text-2xl font-semibold">
              Zugriffe &amp; Anfragen (lokal)
            </h2>
            <p className="text-sm text-muted-foreground">
              Eintragungen aus diesem Browser. Zentrale Speicherung der
              Anfragen erfolgt automatisch in der App-Datenbank
              (siehe „Anfragen" im Menü).
            </p>
          </div>
          {log.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (window.confirm("Lokales Protokoll wirklich leeren?"))
                  clearEventlog?.();
              }}
              className="min-h-[44px] text-destructive border-destructive/40"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Lokales Protokoll leeren
            </Button>
          )}
        </div>

        {log.length === 0 ? (
          <p className="text-sm text-muted-foreground italic py-6 text-center">
            Noch keine Einträge auf diesem Browser.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2 font-semibold w-[140px]">
                    Zeitpunkt
                  </th>
                  <th className="text-left py-2 px-2 font-semibold w-[90px]">
                    Typ
                  </th>
                  <th className="text-left py-2 px-2 font-semibold w-[180px]">
                    Wer
                  </th>
                  <th className="text-left py-2 px-2 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody>
                {log.map((e, i) => (
                  <tr key={i} className="border-b align-top">
                    <td className="py-2 px-2 whitespace-nowrap text-xs">
                      {e.zeit}
                    </td>
                    <td className="py-2 px-2">{badgeFor(e.typ)}</td>
                    <td className="py-2 px-2">
                      <span className="font-medium">{e.name || "?"}</span>{" "}
                      {e.rolle && (
                        <span className="text-xs text-muted-foreground">
                          ({e.rolle})
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2">
                      {e.typ === "Anfrage" ? (
                        <div className="space-y-1">
                          <div className="text-xs">
                            {e.positionen ?? 0} Pos. · {e.eigene ?? 0} eigene ·{" "}
                            <strong>{e.summe ?? ""}</strong>
                          </div>
                          {e.bedarf && (
                            <pre className="text-[11px] whitespace-pre-wrap bg-muted/40 border rounded p-2 max-h-32 overflow-auto">
                              {e.bedarf}
                            </pre>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
