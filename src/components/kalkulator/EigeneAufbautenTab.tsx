/**
 * Eigene Aufbauten — Custom-Konstruktionen mit Schichten und Material-
 * Auswahl. Preis wird vom System NICHT berechnet (steht „Auf Anfrage"
 * und landet in der gespeicherten Anfrage als Hinweistext).
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import {
  MATERIALIEN,
  EIGENE_GRUPPE_LABEL,
  type EigeneGruppe,
} from "@/lib/kalkulator/positionen";
import { num, type K3Satz, type K7Override, type ProjektDaten } from "@/lib/kalkulator/calc";
import type { KalkulatorState, EigenerAufbau } from "@/hooks/useKalkulator";

type K3State = KalkulatorState["k3"];

interface TabProps {
  state: KalkulatorState;
  setProjekt: (patch: Partial<ProjektDaten>) => void;
  setMenge: (posKey: string, value: number) => void;
  setOverride: (posKey: string, field: keyof K7Override, value: number | undefined) => void;
  setStuetzeLen: (len: number) => void;
  setK3: (gruppe: keyof K3State, patch: Partial<K3Satz>) => void;
  k3SyncStatus: string;
  addEigenerAufbau?: () => void;
  updateEigenerAufbau?: (i: number, patch: Partial<EigenerAufbau>) => void;
  setSchichtenAnzahl?: (i: number, n: number) => void;
  removeEigenerAufbau?: (i: number) => void;
}

const SCHICHTEN_OPTS = [1, 2, 3, 4, 5, 6, 7, 8];

export default function EigeneAufbautenTab({
  state,
  addEigenerAufbau,
  updateEigenerAufbau,
  setSchichtenAnzahl,
  removeEigenerAufbau,
}: TabProps) {
  const eigene = state.eigeneAufbauten;

  const setSchicht = (i: number, l: number, val: string) => {
    if (!updateEigenerAufbau) return;
    const e = eigene[i];
    if (!e) return;
    const next = [...e.schichten];
    next[l] = val;
    updateEigenerAufbau(i, { schichten: next });
  };

  return (
    <Card>
      <CardContent className="p-4 sm:p-6 space-y-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-semibold">Eigene Aufbauten</h2>
          <p className="text-sm text-muted-foreground">
            Stelle eigene Wand-/Decken-/Dach-Aufbauten zusammen — Bezeichnung
            eingeben, Anzahl Schichten wählen, je Schicht das Material aus
            der Liste. Der Preis wird auf Anfrage von Holzbau Willroider
            kalkuliert (nicht in der Gesamtsumme enthalten).
          </p>
        </div>

        {eigene.length === 0 ? (
          <div className="text-center py-8 space-y-3">
            <p className="text-sm text-muted-foreground italic">
              Noch kein eigener Aufbau angelegt.
            </p>
            <Button onClick={() => addEigenerAufbau?.()} className="min-h-[44px]">
              <Plus className="h-4 w-4 mr-1.5" /> Eigenen Aufbau hinzufügen
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {eigene.map((e, i) => (
              <Card key={i} className="border-2 bg-muted/30">
                <CardContent className="p-3 sm:p-4 space-y-3">
                  <div className="flex flex-wrap gap-2 items-end">
                    <div className="flex-1 min-w-[180px]">
                      <Label className="text-xs">Bezeichnung</Label>
                      <Input
                        type="text"
                        value={e.name}
                        onChange={(ev) =>
                          updateEigenerAufbau?.(i, { name: ev.target.value })
                        }
                        placeholder="z. B. Wandtyp Nord"
                        className="h-11"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Schichten</Label>
                      <select
                        value={e.schichten.length}
                        onChange={(ev) =>
                          setSchichtenAnzahl?.(i, parseInt(ev.target.value))
                        }
                        className="h-11 px-3 rounded-md border bg-background text-sm"
                      >
                        {SCHICHTEN_OPTS.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Gruppe</Label>
                      <select
                        value={e.gruppe}
                        onChange={(ev) =>
                          updateEigenerAufbau?.(i, {
                            gruppe: ev.target.value as EigeneGruppe,
                          })
                        }
                        className="h-11 px-3 rounded-md border bg-background text-sm"
                      >
                        <option value="waende">{EIGENE_GRUPPE_LABEL.waende}</option>
                        <option value="decken">{EIGENE_GRUPPE_LABEL.decken}</option>
                        <option value="dach">{EIGENE_GRUPPE_LABEL.dach}</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Menge (m²)</Label>
                      <Input
                        type="number"
                        min={0}
                        step={0.5}
                        value={e.menge || ""}
                        onChange={(ev) =>
                          updateEigenerAufbau?.(i, { menge: num(ev.target.value) })
                        }
                        className="h-11 w-24"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-11 w-11 p-0 text-destructive border-destructive/40 hover:bg-destructive hover:text-destructive-foreground"
                      onClick={() => removeEigenerAufbau?.(i)}
                      aria-label="Aufbau löschen"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="space-y-1.5">
                    {e.schichten.map((s, l) => (
                      <div key={l} className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-20 shrink-0">
                          Schicht {l + 1}
                        </span>
                        <select
                          value={s}
                          onChange={(ev) => setSchicht(i, l, ev.target.value)}
                          className="flex-1 max-w-[360px] h-9 px-2 rounded-md border bg-background text-sm"
                        >
                          <option value="">— wählen —</option>
                          {MATERIALIEN.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>

                  <div className="text-xs font-bold text-destructive">
                    EP: Auf Anfrage
                  </div>
                </CardContent>
              </Card>
            ))}

            <Button
              variant="outline"
              onClick={() => addEigenerAufbau?.()}
              className="min-h-[44px]"
            >
              <Plus className="h-4 w-4 mr-1.5" /> Weiteren Aufbau hinzufügen
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
