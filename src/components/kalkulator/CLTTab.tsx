/**
 * CLT-Konfigurator (ZMP / Stora Enso). 3 Karten:
 *  1. CLT-Elemente: Plattentyp + Qualität + Abbund + m² → EP/Gesamt
 *  2. Zusatzleistungen (Abbund, Hebemittel, Bohrungen, …)
 *  3. Transport-Pauschale
 *
 *  EP-Berechnung: cltVKM2 = Listenpreis nach Qualität + Abbund-Aufschlag,
 *  alles × (1 + cltAufschlag/100). Aufschlag wird im Admin gesetzt.
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import {
  CLT_PANELS,
  CLT_ABBUND,
  CLT_ZUSATZ,
  CLT_TRANSPORT,
  CLT_QUAL_LABEL,
  cltVKM2,
  cltSum,
  cltFak,
  type CltZeile,
  type CltQualitaet,
  type CltState,
} from "@/lib/kalkulator/clt";
import { eur, num, type K3Satz, type K7Override, type ProjektDaten } from "@/lib/kalkulator/calc";
import type { KalkulatorState } from "@/hooks/useKalkulator";

type K3State = KalkulatorState["k3"];

interface TabProps {
  state: KalkulatorState;
  setProjekt: (patch: Partial<ProjektDaten>) => void;
  setMenge: (posKey: string, value: number) => void;
  setOverride: (posKey: string, field: keyof K7Override, value: number | undefined) => void;
  setStuetzeLen: (len: number) => void;
  setK3: (gruppe: keyof K3State, patch: Partial<K3Satz>) => void;
  k3SyncStatus: string;
  setCltState?: (patch: Partial<CltState>) => void;
}

export default function CLTTab({ state, setCltState }: TabProps) {
  const clt = state.clt;
  const aufschlag = state.cltAufschlag;

  const updateZeile = (i: number, patch: Partial<CltZeile>) => {
    if (!setCltState) return;
    const next = clt.zeilen.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    setCltState({ zeilen: next });
  };
  const addZeile = () => {
    if (!setCltState) return;
    setCltState({
      zeilen: [
        ...clt.zeilen,
        { typId: CLT_PANELS[0]?.id ?? 0, qual: "nvi", abbund: "", menge: 0 },
      ],
    });
  };
  const delZeile = (i: number) => {
    if (!setCltState) return;
    setCltState({ zeilen: clt.zeilen.filter((_, idx) => idx !== i) });
  };
  const setZusatz = (i: number, value: number) => {
    if (!setCltState) return;
    setCltState({ zusatz: { ...clt.zusatz, [i]: value } });
  };

  const gesamt = cltSum(clt, aufschlag);
  const f = cltFak(aufschlag);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-semibold">
              CLT Massivholz — ZMP / Stora Enso Sylva
            </h2>
            <p className="text-sm text-muted-foreground">
              Brettsperrholz-Elemente konfigurieren: Plattentyp (Stärke + C
              quer / L längs), Sichtqualität und Abbund wählen, Fläche (m²)
              eintragen. Preise aus ZMP-Preisliste Q1-Q2 2025
              {aufschlag > 0 ? (
                <strong> zzgl. {aufschlag.toFixed(1)} % Aufschlag</strong>
              ) : (
                <strong> (ohne Aufschlag)</strong>
              )}.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2 font-semibold">Plattentyp</th>
                  <th className="text-left py-2 px-2 font-semibold w-[170px]">Qualität</th>
                  <th className="text-left py-2 px-2 font-semibold w-[210px]">Abbund</th>
                  <th className="text-right py-2 px-2 font-semibold w-[100px]">EP €/m²</th>
                  <th className="text-right py-2 px-2 font-semibold w-[90px]">m²</th>
                  <th className="text-right py-2 px-2 font-semibold w-[110px]">Gesamt</th>
                  <th className="w-[44px]"></th>
                </tr>
              </thead>
              <tbody>
                {clt.zeilen.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center text-sm text-muted-foreground p-6">
                      Noch kein CLT-Element. Unten hinzufügen.
                    </td>
                  </tr>
                )}
                {clt.zeilen.map((r, i) => {
                  const ep = cltVKM2(r, aufschlag);
                  const menge = num(r.menge);
                  const ges = ep * menge;
                  return (
                    <tr key={i} className="border-b">
                      <td className="py-2 px-2">
                        <select
                          value={r.typId}
                          onChange={(e) => updateZeile(i, { typId: parseInt(e.target.value) })}
                          className="w-full h-9 px-2 rounded border bg-background text-sm"
                        >
                          {CLT_PANELS.map((p) => (
                            <option key={p.id} value={p.id}>
                              CLT {p.nenn} {p.typ} ({p.schichten}-schichtig)
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-2">
                        <select
                          value={r.qual}
                          onChange={(e) =>
                            updateZeile(i, { qual: e.target.value as CltQualitaet })
                          }
                          className="w-full h-9 px-2 rounded border bg-background text-sm"
                        >
                          {(Object.keys(CLT_QUAL_LABEL) as CltQualitaet[]).map((q) => (
                            <option key={q} value={q}>
                              {CLT_QUAL_LABEL[q]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-2">
                        <select
                          value={r.abbund}
                          onChange={(e) => updateZeile(i, { abbund: e.target.value })}
                          className="w-full h-9 px-2 rounded border bg-background text-sm"
                        >
                          <option value="">— ohne Abbund —</option>
                          {CLT_ABBUND.map((a) => (
                            <option key={a.name} value={a.name}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="text-right tabular-nums text-emerald-700 font-semibold py-2 px-2">
                        {eur(ep)}
                      </td>
                      <td className="py-2 px-2">
                        <Input
                          type="number"
                          min={0}
                          step={0.5}
                          value={r.menge || ""}
                          onChange={(e) => updateZeile(i, { menge: num(e.target.value) })}
                          className="h-9 text-right"
                        />
                      </td>
                      <td className="text-right tabular-nums font-bold py-2 px-2">
                        {menge > 0 ? eur(ges) : "—"}
                      </td>
                      <td className="py-2 px-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 w-9 p-0 text-destructive border-destructive/40 hover:bg-destructive hover:text-destructive-foreground"
                          onClick={() => delZeile(i)}
                          aria-label="Element löschen"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Button variant="outline" onClick={addZeile} className="min-h-[44px]">
            <Plus className="h-4 w-4 mr-1.5" /> CLT-Element hinzufügen
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <h3 className="text-lg font-semibold">
            Zusatzleistungen (Abbund / Bohrungen / Hebemittel)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2 font-semibold">Leistung</th>
                  <th className="text-center py-2 px-2 font-semibold w-[60px]">EH</th>
                  <th className="text-right py-2 px-2 font-semibold w-[100px]">EP</th>
                  <th className="text-right py-2 px-2 font-semibold w-[90px]">Anzahl</th>
                  <th className="text-right py-2 px-2 font-semibold w-[110px]">Gesamt</th>
                </tr>
              </thead>
              <tbody>
                {CLT_ZUSATZ.map((z, i) => {
                  const ep = z.preis * f;
                  const cnt = num(clt.zusatz[i]);
                  return (
                    <tr key={i} className="border-b">
                      <td className="py-2 px-2">{z.name}</td>
                      <td className="text-center py-2 px-2">{z.eh}</td>
                      <td className="text-right tabular-nums py-2 px-2">{eur(ep)}</td>
                      <td className="py-2 px-2">
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={clt.zusatz[i] || ""}
                          onChange={(e) => setZusatz(i, num(e.target.value))}
                          className="h-9 text-right"
                        />
                      </td>
                      <td className="text-right tabular-nums font-bold py-2 px-2">
                        {cnt > 0 ? eur(ep * cnt) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <h3 className="text-lg font-semibold">Transport / Logistik</h3>
          <div className="flex items-center gap-3 flex-wrap">
            <Label className="font-semibold">Transport-Pauschale</Label>
            <select
              value={clt.transport}
              onChange={(e) => setCltState?.({ transport: e.target.value })}
              className="h-11 px-3 rounded border bg-background text-sm flex-1 min-w-[280px]"
            >
              <option value="">— kein Transport —</option>
              {CLT_TRANSPORT.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} ({eur(t.preis * f)})
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-violet-50 border-violet-300">
        <CardContent className="p-4 flex items-center justify-between">
          <span className="text-lg font-bold text-violet-900">
            CLT GESAMT (ZMP)
          </span>
          <span className="text-lg font-bold text-violet-900 tabular-nums">
            {eur(gesamt)}
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
