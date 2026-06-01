/**
 * AdminTab — K3-Sätze (Mittellohn + Zuschlagskalkulation) je Gruppe.
 *
 * Schreibt direkt via setK3() in den Hook, der seinerseits an Supabase
 * pusht, falls der/die User:in Schreibrechte hat (Geschäftsführung/Büro).
 * Ohne Schreibrechte bleibt es lokal — wird oben deutlich beschriftet.
 */

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { mlp, gz, num, eur, type K3Satz } from "@/lib/kalkulator/calc";
import type { Bereich } from "@/lib/kalkulator/positionen";
import type { KalkulatorState } from "@/hooks/useKalkulator";

// Gruppen, die wir hier verwalten (CLT lassen wir bewusst weg).
const GRUPPEN: { key: Bereich; label: string }[] = [
  { key: "dach", label: "Dachkonstruktionen" },
  { key: "decken", label: "Decken" },
  { key: "waende", label: "Wände" },
  { key: "regie", label: "Regiearbeiten" },
];

type K3State = KalkulatorState["k3"];

interface TabProps {
  state: KalkulatorState;
  setProjekt: (patch: Partial<KalkulatorState["projekt"]>) => void;
  setMenge: (posKey: string, value: number) => void;
  setOverride: (
    posKey: string,
    field: keyof KalkulatorState["overrides"][string],
    value: number | undefined,
  ) => void;
  setStuetzeLen: (len: number) => void;
  setK3: (gruppe: keyof K3State, patch: Partial<K3Satz>) => void;
  k3SyncStatus: string;
}

export default function AdminTab({ state, setK3, k3SyncStatus }: TabProps) {
  const { role } = useAuth();
  const canWriteK3 = role === "geschaeftsfuehrung" || role === "buero";

  // Sync-Status farblich aufdröseln
  const statusTone = (() => {
    if (!k3SyncStatus) return "text-muted-foreground";
    if (k3SyncStatus.startsWith("Fehler")) return "text-destructive";
    if (k3SyncStatus.toLowerCase().includes("lokal")) return "text-amber-600";
    return "text-emerald-600";
  })();

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold">
            K3 — Kalkulationssätze je Gruppe (ÖNORM B2061)
          </h2>
          <p className="text-sm text-muted-foreground">
            Mittellohnpreis = Grundlohn × (1 + Lohnnebenkosten) × (1 + unprod.
            Zeiten). Gesamtzuschlag = GGK + Bauzinsen + Wagnis + Gewinn. Je
            Gruppe getrennt.
          </p>
          {!canWriteK3 && (
            <p className="text-sm text-amber-600">
              Du siehst die Sätze nur lesend — Änderungen sind lokal.
            </p>
          )}
        </header>

        <div className="space-y-4">
          {GRUPPEN.map(({ key, label }) => {
            const k3 = state.k3[key];
            return (
              <Card key={key} className="border-muted">
                <CardContent className="space-y-4 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-base font-semibold">{label}</h3>
                    <div className="text-sm text-muted-foreground">
                      MLP: <span className="font-medium text-foreground">
                        {eur(mlp(k3))}
                      </span>/h · Gesamtzuschlag:{" "}
                      <span className="font-medium text-foreground">
                        {gz(k3).toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* Section 1 — Mittellohnpreis */}
                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      K3 · Mittellohnpreis
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <NumberField
                        id={`${key}-grundlohn`}
                        label="Grundlohn €/h"
                        value={k3.grundlohn}
                        step={0.01}
                        onChange={(v) => setK3(key, { grundlohn: v })}
                      />
                      <NumberField
                        id={`${key}-lnk`}
                        label="Lohnnebenkosten %"
                        value={k3.lnk}
                        step={0.1}
                        onChange={(v) => setK3(key, { lnk: v })}
                      />
                      <NumberField
                        id={`${key}-unprod`}
                        label="Unprod. Zeiten %"
                        value={k3.unprod}
                        step={0.1}
                        onChange={(v) => setK3(key, { unprod: v })}
                      />
                    </div>
                  </div>

                  {/* Section 2 — Zuschlagskalkulation (K2) */}
                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      K3 · Zuschlagskalkulation (K2)
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <NumberField
                        id={`${key}-ggk`}
                        label="Geschäftsgemeinkosten %"
                        value={k3.ggk}
                        step={0.1}
                        onChange={(v) => setK3(key, { ggk: v })}
                      />
                      <NumberField
                        id={`${key}-bauzinsen`}
                        label="Bauzinsen %"
                        value={k3.bauzinsen}
                        step={0.1}
                        onChange={(v) => setK3(key, { bauzinsen: v })}
                      />
                      <NumberField
                        id={`${key}-wagnis`}
                        label="Wagnis %"
                        value={k3.wagnis}
                        step={0.1}
                        onChange={(v) => setK3(key, { wagnis: v })}
                      />
                      <NumberField
                        id={`${key}-gewinn`}
                        label="Gewinn %"
                        value={k3.gewinn}
                        step={0.1}
                        onChange={(v) => setK3(key, { gewinn: v })}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className={`text-sm ${statusTone}`}>
          {k3SyncStatus || "Bereit."}
        </div>
      </CardContent>
    </Card>
  );
}

/** Kleiner Number-Input mit Label im selben Block, 44px Touch-Höhe. */
function NumberField({
  id,
  label,
  value,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step ?? 0.1}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(num(e.target.value))}
        className="h-11"
      />
    </div>
  );
}
