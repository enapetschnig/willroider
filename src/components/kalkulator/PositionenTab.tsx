/**
 * PositionenTab — Mengen- und Preiserfassung aller Bereiche
 * (Dach / Decken / Wände / Regie). Pro Bereich eine Tabelle mit:
 *   - EP-Anzeige (Basispreis oder K7-überschrieben)
 *   - Mengen-Eingabe
 *   - (optional) K7-Eingabe-Spalten AW / Material / Geräte / Fremd
 *
 * Regie-Positionen sind enthalten, werden aber laut Vorgabe in der
 * Gesamt-Zusammenfassung NICHT mitgerechnet (siehe Hinweis im Tab).
 */

import { useMemo } from "react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  displayEP,
  eur,
  gz,
  k7Calc,
  mlp,
  num,
  type K3Satz,
  type K7Override,
  type ProjektDaten,
} from "@/lib/kalkulator/calc";
import {
  BEREICHE,
  type Bereich,
  type Position,
} from "@/lib/kalkulator/positionen";

type K3State = Record<Bereich | "clt", K3Satz>;

interface KalkulatorState {
  projekt: ProjektDaten;
  k3: K3State;
  mengen: Record<string, number>;
  overrides: Record<string, K7Override>;
  stuetzeLen: number;
}

interface TabProps {
  state: KalkulatorState;
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
  canCalc?: boolean;
}

/** Tab-Reihenfolge fix wie in der Vorgabe — Dach zuerst, Regie zuletzt. */
const TAB_ORDER: Bereich[] = ["dach", "decken", "waende", "regie"];
const TAB_LABEL: Record<Bereich, string> = {
  dach: "Dach",
  decken: "Decken",
  waende: "Wände",
  regie: "Regie",
};

export default function PositionenTab(props: TabProps) {
  const { state, setMenge, setOverride, setStuetzeLen } = props;
  const canCalc = props.canCalc ?? true;

  const bereicheSorted = useMemo(
    () =>
      TAB_ORDER.map((k) => BEREICHE.find((b) => b.key === k)).filter(
        (b): b is (typeof BEREICHE)[number] => Boolean(b),
      ),
    [],
  );

  return (
    <Tabs defaultValue="dach" className="w-full">
      <TabsList className="flex w-full flex-wrap justify-start gap-1 h-auto">
        {bereicheSorted.map((b) => (
          <TabsTrigger
            key={b.key}
            value={b.key}
            className="min-h-[44px] px-4"
          >
            {TAB_LABEL[b.key]}
          </TabsTrigger>
        ))}
      </TabsList>

      {bereicheSorted.map((b) => (
        <TabsContent key={b.key} value={b.key} className="mt-4">
          <BereichCard
            bereichKey={b.key}
            titel={b.titel}
            sektionen={b.sektionen}
            state={state}
            canCalc={canCalc}
            setMenge={setMenge}
            setOverride={setOverride}
            setStuetzeLen={setStuetzeLen}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}

interface BereichCardProps {
  bereichKey: Bereich;
  titel: string;
  sektionen: (typeof BEREICHE)[number]["sektionen"];
  state: KalkulatorState;
  canCalc: boolean;
  setMenge: TabProps["setMenge"];
  setOverride: TabProps["setOverride"];
  setStuetzeLen: TabProps["setStuetzeLen"];
}

function BereichCard({
  bereichKey,
  titel,
  sektionen,
  state,
  canCalc,
  setMenge,
  setOverride,
  setStuetzeLen,
}: BereichCardProps) {
  const k3 = state.k3[bereichKey];
  const mlpVal = mlp(k3);
  const gzVal = gz(k3);

  // Bereichs-Summe (über alle Positionen mit Menge > 0)
  const summe = useMemo(() => {
    let total = 0;
    for (const s of sektionen) {
      for (const p of s.positionen) {
        const menge = num(state.mengen[p.pos]);
        if (menge <= 0) continue;
        const ep = displayEP(p, k3, state.overrides[p.pos], state.stuetzeLen);
        total += ep * menge;
      }
    }
    return total;
  }, [sektionen, state.mengen, state.overrides, state.stuetzeLen, k3]);

  // Spaltenanzahl für colspan der Section-Header-Zeile
  // Basis: Pos · Bezeichnung · EH · EP · Menge · Gesamt = 6
  // + 6 K7-Spalten (AW, Material, Geräte, Fremd, Lohn, Sonst) wenn canCalc
  const colCount = canCalc ? 12 : 6;

  return (
    <Card>
      <CardContent className="p-4 sm:p-6 space-y-4">
        <div className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold">{titel}</h3>
          {bereichKey === "regie" && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              Regie-Stunden nur auf gesonderte Anordnung — werden in der
              Zusammenfassung NICHT zur Summe gerechnet.
            </p>
          )}
          {canCalc && (
            <p className="text-xs text-muted-foreground bg-muted/40 border border-muted rounded px-3 py-2 leading-relaxed">
              K7-Preisermittlung — AW × Mittellohnpreis ({eur(mlpVal)}/h) =
              Lohn. Material + Geräte + Fremd = Sonstiges. EP ={" "}
              (Lohn + Sonst) × (1 + Gesamtzuschlag{" "}
              {gzVal.toLocaleString("de-AT", {
                minimumFractionDigits: 1,
                maximumFractionDigits: 2,
              })}
              %). Felder leer → Basispreis gilt.
            </p>
          )}
        </div>

        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full text-sm border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-muted text-left">
                <th className="px-2 py-2 font-medium whitespace-nowrap">
                  Pos-Nr
                </th>
                <th className="px-2 py-2 font-medium">Bezeichnung</th>
                <th className="px-2 py-2 font-medium whitespace-nowrap">
                  EH
                </th>
                {canCalc && (
                  <>
                    <th className="px-2 py-2 font-medium whitespace-nowrap">
                      AW (h/EH)
                    </th>
                    <th className="px-2 py-2 font-medium whitespace-nowrap">
                      Material
                    </th>
                    <th className="px-2 py-2 font-medium whitespace-nowrap">
                      Geräte
                    </th>
                    <th className="px-2 py-2 font-medium whitespace-nowrap">
                      Fremd
                    </th>
                    <th className="px-2 py-2 font-medium whitespace-nowrap">
                      Lohn
                    </th>
                    <th className="px-2 py-2 font-medium whitespace-nowrap">
                      Sonst.
                    </th>
                  </>
                )}
                <th className="px-2 py-2 font-medium whitespace-nowrap text-right">
                  EP
                </th>
                <th className="px-2 py-2 font-medium whitespace-nowrap">
                  Menge
                </th>
                <th className="px-2 py-2 font-medium whitespace-nowrap text-right">
                  Gesamt
                </th>
              </tr>
            </thead>
            <tbody>
              {sektionen.flatMap((sek) => [
                <SektionHeaderRow
                  key={`sek-${sek.pos}`}
                  pos={sek.pos}
                  colSpan={colCount}
                />,
                ...sek.positionen.map((p) => (
                  <PosRow
                    key={p.pos}
                    position={p}
                    k3={k3}
                    canCalc={canCalc}
                    menge={state.mengen[p.pos]}
                    override={state.overrides[p.pos]}
                    stuetzeLen={state.stuetzeLen}
                    setMenge={setMenge}
                    setOverride={setOverride}
                    setStuetzeLen={setStuetzeLen}
                  />
                )),
              ])}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-emerald-700/40">
                <td
                  colSpan={colCount - 1}
                  className="px-2 py-3 text-right font-semibold text-emerald-800"
                >
                  Summe {TAB_LABEL[bereichKey]}
                  {bereichKey === "regie" && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      (nicht in Gesamt-Zusammenfassung)
                    </span>
                  )}
                </td>
                <td className="px-2 py-3 text-right font-bold text-emerald-800">
                  {eur(summe)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function SektionHeaderRow({
  pos,
  colSpan,
}: {
  pos: string;
  colSpan: number;
}) {
  return (
    <tr className="bg-emerald-50">
      <td
        colSpan={colSpan}
        className="px-2 py-2 text-xs font-semibold text-emerald-900 uppercase tracking-wide"
      >
        {pos}
      </td>
    </tr>
  );
}

interface PosRowProps {
  position: Position;
  k3: K3Satz;
  canCalc: boolean;
  menge: number | undefined;
  override: K7Override | undefined;
  stuetzeLen: number;
  setMenge: TabProps["setMenge"];
  setOverride: TabProps["setOverride"];
  setStuetzeLen: TabProps["setStuetzeLen"];
}

function PosRow({
  position: p,
  k3,
  canCalc,
  menge,
  override,
  stuetzeLen,
  setMenge,
  setOverride,
  setStuetzeLen,
}: PosRowProps) {
  const { toast } = useToast();
  const ep = displayEP(p, k3, override, stuetzeLen);
  const mengeNum = num(menge);
  const gesamt = ep * mengeNum;
  const calc = k7Calc(k3, override);

  // Hilfs-Handler für K7-Inputs: Negativwerte zurückweisen
  const handleOverrideChange = (
    field: keyof K7Override,
    raw: string,
  ) => {
    if (raw === "") {
      setOverride(p.pos, field, undefined);
      return;
    }
    const v = num(raw);
    if (v < 0) {
      toast({
        variant: "destructive",
        title: "Negative Werte nicht erlaubt",
        description: "Bitte 0 oder positive Zahl eingeben.",
      });
      // Wert zurücksetzen — auf bisherigen oder undefined
      setOverride(p.pos, field, override?.[field]);
      return;
    }
    setOverride(p.pos, field, v);
  };

  return (
    <tr className="border-b border-border/60 align-top hover:bg-muted/30">
      <td className="px-2 py-2 font-mono text-xs whitespace-nowrap">
        {p.pos}
      </td>
      <td className="px-2 py-2 min-w-[180px]">
        <div className="font-medium">{p.bez}</div>
        {p.aufbau && (
          <div className="text-xs text-muted-foreground whitespace-pre-line">
            {p.aufbau}
          </div>
        )}
        {p.isStuetze && (
          <div className="mt-2 flex items-center gap-2">
            <label className="text-xs text-muted-foreground whitespace-nowrap">
              Stützenlänge (m):
            </label>
            <Input
              type="number"
              min={0.1}
              step={0.1}
              value={stuetzeLen}
              onChange={(e) => setStuetzeLen(num(e.target.value))}
              className="h-9 w-24"
            />
          </div>
        )}
      </td>
      <td className="px-2 py-2 whitespace-nowrap">{p.eh}</td>

      {canCalc && (
        <>
          <td className="px-2 py-2">
            <Input
              type="number"
              min={0}
              step={0.01}
              value={override?.aw ?? ""}
              onChange={(e) => handleOverrideChange("aw", e.target.value)}
              className="h-9 w-20"
              placeholder="—"
            />
          </td>
          <td className="px-2 py-2">
            <Input
              type="number"
              min={0}
              step={0.01}
              value={override?.material ?? ""}
              onChange={(e) =>
                handleOverrideChange("material", e.target.value)
              }
              className="h-9 w-24"
              placeholder="—"
            />
          </td>
          <td className="px-2 py-2">
            <Input
              type="number"
              min={0}
              step={0.01}
              value={override?.geraete ?? ""}
              onChange={(e) =>
                handleOverrideChange("geraete", e.target.value)
              }
              className="h-9 w-24"
              placeholder="—"
            />
          </td>
          <td className="px-2 py-2">
            <Input
              type="number"
              min={0}
              step={0.01}
              value={override?.fremd ?? ""}
              onChange={(e) =>
                handleOverrideChange("fremd", e.target.value)
              }
              className="h-9 w-24"
              placeholder="—"
            />
          </td>
          <td className="px-2 py-2 whitespace-nowrap text-right tabular-nums">
            {calc ? eur(calc.lohn) : "—"}
          </td>
          <td className="px-2 py-2 whitespace-nowrap text-right tabular-nums">
            {calc ? eur(calc.sonst) : "—"}
          </td>
        </>
      )}

      <td className="px-2 py-2 whitespace-nowrap text-right tabular-nums">
        {eur(ep)}
      </td>
      <td className="px-2 py-2">
        <Input
          type="number"
          min={0}
          step={0.5}
          value={menge ?? ""}
          onChange={(e) => setMenge(p.pos, num(e.target.value))}
          className="h-9 w-24"
          placeholder="0"
        />
      </td>
      <td className="px-2 py-2 whitespace-nowrap text-right font-semibold tabular-nums">
        {mengeNum > 0 ? eur(gesamt) : "—"}
      </td>
    </tr>
  );
}
