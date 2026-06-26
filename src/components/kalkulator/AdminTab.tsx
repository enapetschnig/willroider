/**
 * AdminTab — K3-Sätze (Mittellohn + Zuschlagskalkulation) je Gruppe,
 * CLT-Aufschlag und Auer-Referenzpreise (mit optionalem ONLV-Import).
 *
 * Schreibrechte für K3 nur Geschäftsführung/Büro (RLS regelt das DB-
 * seitig). Andere User sehen die Sätze lesend; CLT-Aufschlag und
 * Auer-Import bleiben dann lokal im Browser.
 */

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Upload } from "lucide-react";
import { mlp, gz, num, eur, type K3Satz } from "@/lib/kalkulator/calc";
import type { Bereich } from "@/lib/kalkulator/positionen";
import { AUER_BUILTIN, type AuerRow } from "@/lib/kalkulator/auer";
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
  setCltAufschlag?: (v: number) => void;
  setAuerImport?: (rows: AuerRow[]) => void;
}

export default function AdminTab({
  state,
  setK3,
  k3SyncStatus,
  setCltAufschlag,
  setAuerImport,
}: TabProps) {
  const { hasPermission } = useAuth();
  const canWriteK3 = hasPermission("kalkulator.edit_k3");
  const { toast } = useToast();
  const [q, setQ] = useState("");

  // Sync-Status farblich aufdröseln
  const statusTone = (() => {
    if (!k3SyncStatus) return "text-muted-foreground";
    if (k3SyncStatus.startsWith("Fehler")) return "text-destructive";
    if (k3SyncStatus.toLowerCase().includes("lokal")) return "text-amber-600";
    return "text-emerald-600";
  })();

  const auerList = useMemo<AuerRow[]>(
    () => (state.auerImport.length > 0 ? state.auerImport : AUER_BUILTIN),
    [state.auerImport],
  );
  const auerGefiltert = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return auerList.slice(0, 40);
    return auerList.filter((r) => r.bez.toLowerCase().includes(qq)).slice(0, 40);
  }, [auerList, q]);

  const handleOnlvImport = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const xml = new DOMParser().parseFromString(
          rd.result as string,
          "application/xml",
        );
        const NS = "http://www.oenorm.at/schema/A2063/2021-03-01";
        const pes = xml.getElementsByTagNameNS(NS, "pos-eigenschaften");
        const out: AuerRow[] = [];
        for (let i = 0; i < pes.length; i++) {
          const pe = pes[i];
          const sw = pe.getElementsByTagNameNS(NS, "stichwort")[0];
          const eh = pe.getElementsByTagNameNS(NS, "einheit")[0];
          const preis = pe.getElementsByTagNameNS(NS, "preis")[0];
          if (!preis || !sw || !sw.textContent?.trim()) continue;
          const g = (v: string) => {
            const e = preis.getElementsByTagNameNS(NS, v)[0];
            return e ? parseFloat(e.textContent ?? "0") || 0 : 0;
          };
          const ges = g("gesamt");
          if (ges > 0) {
            out.push({
              bez: sw.textContent.trim(),
              eh: eh?.textContent?.trim() ?? "",
              lohn: Math.round(g("preisanteil1") * 100) / 100,
              sonst: Math.round(g("preisanteil2") * 100) / 100,
              ep: Math.round(ges * 100) / 100,
              quelle: file.name,
            });
          }
        }
        const seen = new Set<string>();
        const uniq: AuerRow[] = [];
        for (const r of out) {
          const k = r.bez + r.eh;
          if (!seen.has(k)) {
            seen.add(k);
            uniq.push(r);
          }
        }
        if (uniq.length === 0) {
          toast({
            variant: "destructive",
            title: "Keine Positionen gefunden",
            description:
              "Die Datei enthält keine ÖNORM-A2063-Positionen mit Preisen.",
          });
          return;
        }
        setAuerImport?.(uniq);
        toast({
          title: "Import erfolgreich",
          description: `${uniq.length} Positionen aus ${file.name} importiert.`,
        });
      } catch (e) {
        toast({
          variant: "destructive",
          title: "ONLV-Import fehlgeschlagen",
          description: (e as Error).message,
        });
      } finally {
        ev.target.value = "";
      }
    };
    rd.readAsText(file);
  };

  return (
    <div className="space-y-4">
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
                        MLP:{" "}
                        <span className="font-medium text-foreground">
                          {eur(mlp(k3))}
                        </span>
                        /h · Gesamtzuschlag:{" "}
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

            <Card className="border-muted">
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-base font-semibold">
                    CLT (ZMP) — Handelsware
                  </h3>
                </div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Aufschlag auf ZMP-Listenpreis
                </div>
                <div className="flex items-end gap-3 flex-wrap">
                  <NumberField
                    id="clt-aufschlag"
                    label="Aufschlag %"
                    value={state.cltAufschlag}
                    step={0.5}
                    onChange={(v) => setCltAufschlag?.(v)}
                  />
                  <p className="text-xs text-muted-foreground max-w-md flex-1 min-w-[200px] pb-2">
                    0 % = ZMP-Preisliste 1:1. Höher = Willroider-Aufschlag auf
                    Platten, Zusatzleistungen und Transport.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className={`text-sm ${statusTone}`}>
            Server-Sync: {k3SyncStatus || "Bereit."}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4 sm:p-6">
          <header className="space-y-1">
            <h2 className="text-lg font-semibold">
              Auer-Daten — Referenzpreise
            </h2>
            <p className="text-sm text-muted-foreground">
              {state.auerImport.length > 0
                ? `${state.auerImport.length} Positionen aus deinem letzten ONLV-Import.`
                : `${AUER_BUILTIN.length} eingebaute Auer-Holzbaupositionen (Lohn/Sonstiges aus echten Projekten).`}
            </p>
          </header>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex">
              <input
                type="file"
                accept=".onlv,.xml"
                onChange={handleOnlvImport}
                className="hidden"
              />
              <span className="inline-flex items-center gap-1.5 h-11 px-4 rounded-md border bg-card cursor-pointer hover:bg-muted text-sm font-semibold">
                <Upload className="h-4 w-4" /> ONLV-Datei importieren
              </span>
            </label>
            <Input
              placeholder="Position suchen …"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-11 flex-1 min-w-[200px]"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2 font-semibold">
                    Bezeichnung
                  </th>
                  <th className="text-center py-2 px-2 font-semibold w-[60px]">
                    EH
                  </th>
                  <th className="text-right py-2 px-2 font-semibold w-[100px]">
                    Lohn
                  </th>
                  <th className="text-right py-2 px-2 font-semibold w-[100px]">
                    Sonstiges
                  </th>
                  <th className="text-right py-2 px-2 font-semibold w-[100px]">
                    EP
                  </th>
                </tr>
              </thead>
              <tbody>
                {auerGefiltert.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="text-center text-sm text-muted-foreground p-6"
                    >
                      Keine Treffer.
                    </td>
                  </tr>
                ) : (
                  auerGefiltert.map((r, i) => (
                    <tr key={i} className="border-b">
                      <td className="py-2 px-2">{r.bez}</td>
                      <td className="text-center py-2 px-2">{r.eh}</td>
                      <td className="text-right tabular-nums py-2 px-2">
                        {eur(r.lohn)}
                      </td>
                      <td className="text-right tabular-nums py-2 px-2">
                        {eur(r.sonst)}
                      </td>
                      <td className="text-right tabular-nums font-bold py-2 px-2">
                        {eur(r.ep)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground italic">
            Max. 40 Treffer. Diese Werte sind Vergleichspreise (keine
            automatische Übernahme in die K7-Berechnung).
          </p>
        </CardContent>
      </Card>
    </div>
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
