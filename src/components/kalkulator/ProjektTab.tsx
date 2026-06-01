/**
 * ProjektTab — Eingabeformular für die Projektstammdaten und Anzeige
 * der daraus berechneten Baustellengemeinkosten (BGK 36 01).
 *
 * Spiegelt 1:1 die viewProj()-Logik aus dem ursprünglichen HTML-
 * Kalkulator: Statik (€/m²), Werkplanung (Stunden × 85 €), 3D-Aufmaß
 * (Stunden × 99 €), Punktwolke-Pauschale.
 */

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  calcBGK,
  eur,
  num,
  type K3Satz,
  type K7Override,
  type ProjektDaten,
} from "@/lib/kalkulator/calc";
import type { Bereich } from "@/lib/kalkulator/positionen";

type K3State = Record<Bereich | "clt", K3Satz>;

interface KalkulatorStateShape {
  projekt: ProjektDaten;
  k3: K3State;
  mengen: Record<string, number>;
  overrides: Record<string, K7Override>;
  stuetzeLen: number;
}

interface TabProps {
  state: KalkulatorStateShape;
  setProjekt: (patch: Partial<ProjektDaten>) => void;
  setMenge: (posKey: string, value: number) => void;
  setOverride: (
    posKey: string,
    field: keyof K7Override,
    value: number | undefined,
  ) => void;
  setStuetzeLen: (len: number) => void;
  setK3: (gruppe: keyof K3State, patch: Partial<K3Satz>) => void;
  k3SyncStatus: string;
}

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, hint, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5 min-w-[220px] flex-1">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      {hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

interface SumRowProps {
  label: string;
  value: string;
  muted?: boolean;
}

function SumRow({ label, value, muted }: SumRowProps) {
  return (
    <div
      className={
        "flex items-center justify-between py-2 px-3 rounded-md border " +
        (muted
          ? "border-dashed border-muted bg-muted/30 text-muted-foreground"
          : "border-border bg-background")
      }
    >
      <span className="text-sm">{label}</span>
      <span className="text-sm font-mono tabular-nums">{value}</span>
    </div>
  );
}

export default function ProjektTab(props: TabProps) {
  const { state, setProjekt } = props;
  const p = state.projekt;
  const bgk = calcBGK(p);

  return (
    <Card>
      <CardContent className="pt-6 space-y-6">
        <div>
          <h2 className="text-lg font-semibold">
            Projektdaten &amp; Baustellengemeinkosten (36 01)
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Die BGK werden aus deinen Angaben automatisch berechnet.
          </p>
        </div>

        <div className="flex flex-wrap gap-4">
          <Field label="Gesamte Wandfläche (m²)" hint="Basis Statik 0,81 €/m²">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={p.wandflaeche}
              onChange={(e) =>
                setProjekt({ wandflaeche: num(e.target.value) })
              }
              className="h-11"
            />
          </Field>

          <Field label="Anzahl Wandtypen" hint="je Typ 2 Werkplanungsstunden">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={p.wandtypen}
              onChange={(e) =>
                setProjekt({ wandtypen: num(e.target.value) })
              }
              className="h-11"
            />
          </Field>

          <Field label="Anzahl Geschosse" hint="2 → +1h · 3+ → +2h">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={p.geschosse}
              onChange={(e) =>
                setProjekt({ geschosse: Math.max(1, num(e.target.value)) })
              }
              className="h-11"
            />
          </Field>

          <Field label="3D Laseraufmaß?" hint="EP 99,00 €/h · +2h Werkplanung">
            <div className="flex items-center h-11">
              <Switch
                checked={p.laser}
                onCheckedChange={(v) => setProjekt({ laser: v })}
              />
            </div>
          </Field>

          <Field label="Stunden 3D-Aufmaß" hint="Default 3h">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={p.std3d}
              onChange={(e) => setProjekt({ std3d: num(e.target.value) })}
              disabled={!p.laser}
              className="h-11"
            />
          </Field>

          <Field label="Punktwolke (e57)?" hint="Pauschal 446,88 €">
            <div className="flex items-center h-11">
              <Switch
                checked={p.punktwolke}
                onCheckedChange={(v) => setProjekt({ punktwolke: v })}
              />
            </div>
          </Field>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            BGK-Aufstellung
          </h3>

          <div className="space-y-2">
            <SumRow
              label={`36 01 01 A · Konstruktive Statik (${num(p.wandflaeche).toLocaleString("de-AT")} m² × 0,81)`}
              value={eur(bgk.statik)}
            />
            <SumRow
              label={`36 01 01 B · Werkplanung (${bgk.werkplanH} h × 85,00)`}
              value={eur(bgk.werkplan)}
            />
            {p.laser ? (
              <SumRow
                label={`36 01 01 C · 3D Laseraufmaß (${num(p.std3d)} h × 99,00)`}
                value={eur(bgk.laser)}
              />
            ) : (
              <SumRow
                label="36 01 01 C · 3D Laseraufmaß"
                value="(nein)"
                muted
              />
            )}
            {p.punktwolke ? (
              <SumRow
                label="36 01 01 D · Punktwolke (Pauschal)"
                value={eur(bgk.punkt)}
              />
            ) : (
              <SumRow label="36 01 01 D · Punktwolke" value="(nein)" muted />
            )}
          </div>

          <div className="flex items-center justify-between py-3 px-4 rounded-md border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800">
            <span className="font-bold text-emerald-900 dark:text-emerald-200">
              BGK GESAMT (36 01)
            </span>
            <span className="font-bold text-emerald-900 dark:text-emerald-200 font-mono tabular-nums text-base">
              {eur(bgk.total)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
