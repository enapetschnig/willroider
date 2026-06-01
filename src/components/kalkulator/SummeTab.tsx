/**
 * SummeTab — Übersicht der Kalkulation + Anfrage SPEICHERN.
 *
 * Kein Mail-Versand mehr. „Anfrage speichern" legt einen Entwurf in
 * kalkulator_anfragen an (oder updated den bereits geladenen Entwurf,
 * falls state.anfrageId gesetzt ist). Anfragen sind dann in der
 * Anfragen-Liste sicht- und bearbeitbar.
 */

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Printer, Save } from "lucide-react";
import {
  calcBGK,
  displayEP,
  eur,
  type K3Satz,
  type K7Override,
  type ProjektDaten,
} from "@/lib/kalkulator/calc";
import {
  BEREICHE,
  FIRMA,
  alleBereichPositionen,
  type Bereich,
  type Position,
} from "@/lib/kalkulator/positionen";
import type { KalkulatorState } from "@/hooks/useKalkulator";

type K3State = KalkulatorState["k3"];

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
  setAnfrageId?: (id: string | null) => void;
}

function bereichSumme(bereich: Bereich, state: KalkulatorState): number {
  const positionen = alleBereichPositionen(bereich);
  const k3 = state.k3[bereich];
  let s = 0;
  for (const p of positionen) {
    const menge = state.mengen[p.pos] ?? 0;
    if (menge <= 0) continue;
    const ep = displayEP(p, k3, state.overrides[p.pos], state.stuetzeLen);
    s += ep * menge;
  }
  return s;
}

function eingetragenePositionen(
  state: KalkulatorState,
): Array<{ p: Position; menge: number; ep: number; summe: number }> {
  const out: Array<{ p: Position; menge: number; ep: number; summe: number }> = [];
  for (const def of BEREICHE) {
    const k3 = state.k3[def.key];
    for (const sek of def.sektionen) {
      for (const p of sek.positionen) {
        const menge = state.mengen[p.pos] ?? 0;
        if (menge <= 0) continue;
        const ep = displayEP(p, k3, state.overrides[p.pos], state.stuetzeLen);
        out.push({ p, menge, ep, summe: ep * menge });
      }
    }
  }
  return out;
}

function buildBedarfText(
  state: KalkulatorState,
  kundenName: string,
  summen: { bgk: number; dach: number; decken: number; waende: number; regie: number; netto: number },
): string {
  const L: string[] = [];
  L.push("Anfrage Bausatz-Kalkulator");
  L.push(`Kunde: ${kundenName}`);
  L.push("");
  L.push("Projekt:");
  L.push(`  Wandfläche: ${state.projekt.wandflaeche} m²`);
  L.push(`  Wandtypen: ${state.projekt.wandtypen}`);
  L.push(`  Geschosse: ${state.projekt.geschosse}`);
  if (state.projekt.laser) L.push(`  Laser-Einmessung (${state.projekt.std3d} h 3D)`);
  if (state.projekt.punktwolke) L.push(`  Punktwolke`);
  L.push("");
  L.push("Positionen:");
  const pos = eingetragenePositionen(state);
  if (pos.length === 0) L.push("  (keine Positionen eingetragen)");
  else
    for (const e of pos)
      L.push(`  ${e.p.pos}  ${e.p.bez} — ${e.menge} ${e.p.eh} × ${eur(e.ep)} = ${eur(e.summe)}`);
  L.push("");
  L.push("Summen (netto, exkl. MwSt.):");
  L.push(`  36 01 Baustellengemeinkosten: ${eur(summen.bgk)}`);
  L.push(`  36 12 Dachkonstruktionen:     ${eur(summen.dach)}`);
  L.push(`  36 14 Decken:                 ${eur(summen.decken)}`);
  L.push(`  36 15 Riegelwände:            ${eur(summen.waende)}`);
  L.push("  ------------------------------------------");
  L.push(`  GESAMTSUMME NETTO:            ${eur(summen.netto)}`);
  L.push(`  36 90 Regie (separat):        ${eur(summen.regie)}`);
  L.push("");
  L.push(`— ${FIRMA.name}`);
  return L.join("\n");
}

export default function SummeTab({ state, setAnfrageId }: TabProps) {
  const { toast } = useToast();
  const { profile, user } = useAuth();

  const bgk = useMemo(() => calcBGK(state.projekt).total, [state.projekt]);
  const sumDach = useMemo(() => bereichSumme("dach", state), [state]);
  const sumDecken = useMemo(() => bereichSumme("decken", state), [state]);
  const sumWaende = useMemo(() => bereichSumme("waende", state), [state]);
  const sumRegie = useMemo(() => bereichSumme("regie", state), [state]);
  const netto = useMemo(
    () => bgk + sumDach + sumDecken + sumWaende,
    [bgk, sumDach, sumDecken, sumWaende],
  );
  const positionenAnzahl = useMemo(
    () => eingetragenePositionen(state).length,
    [state],
  );

  const kundenName = useMemo(() => {
    if (!profile) return user?.email ?? "Unbekannt";
    const n = `${profile.vorname ?? ""} ${profile.nachname ?? ""}`.trim();
    return n || profile.email || user?.email || "Unbekannt";
  }, [profile, user]);

  // Dialog
  const [open, setOpen] = useState(false);
  const [titel, setTitel] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const oeffnen = useCallback(() => {
    if (positionenAnzahl === 0) {
      toast({
        variant: "destructive",
        title: "Keine Positionen",
        description: "Bitte mindestens eine Position eintragen.",
      });
      return;
    }
    setTitel((t) =>
      t || `Bausatz-Kalkulation ${new Date().toLocaleDateString("de-AT")}`,
    );
    setBody(
      buildBedarfText(state, kundenName, {
        bgk,
        dach: sumDach,
        decken: sumDecken,
        waende: sumWaende,
        regie: sumRegie,
        netto,
      }),
    );
    setOpen(true);
  }, [positionenAnzahl, toast, state, kundenName, bgk, sumDach, sumDecken, sumWaende, sumRegie, netto]);

  const speichern = useCallback(async () => {
    setSaving(true);
    try {
      // Snapshot: kompletter State + Klartext-Bedarf
      const snapshot = {
        projekt: state.projekt,
        mengen: state.mengen,
        overrides: state.overrides,
        stuetzeLen: state.stuetzeLen,
        // K3 mit-speichern, damit der Snapshot auch in 6 Monaten
        // identisch nachgerechnet werden kann, falls sich die Sätze ändern.
        k3_snapshot: state.k3,
        titel,
      };
      const { data, error } = await supabase.functions.invoke(
        "kalkulator-bridge",
        {
          body: {
            action: "anfrage",
            anfrageId: state.anfrageId ?? undefined,
            kunde_name: titel.trim() || kundenName,
            summe_netto: netto,
            positionen_anzahl: positionenAnzahl,
            eigene_anzahl: 0,
            bedarf_text: body,
            ...snapshot,
          },
        },
      );
      if (error) throw error;
      const res = data as any;
      if (res?.ok === false) throw new Error(res.error ?? "Speichern fehlgeschlagen");
      if (res?.anfrageId && setAnfrageId) {
        setAnfrageId(res.anfrageId);
      }
      toast({
        title: res?.updated ? "Anfrage aktualisiert" : "Anfrage gespeichert",
        description:
          "Die Anfrage liegt in der Anfragen-Liste und kann jederzeit weiter bearbeitet werden.",
      });
      setOpen(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Speichern fehlgeschlagen",
        description: (e as Error).message || "Bitte später nochmal probieren.",
      });
    } finally {
      setSaving(false);
    }
  }, [
    state.projekt,
    state.mengen,
    state.overrides,
    state.stuetzeLen,
    state.k3,
    state.anfrageId,
    titel,
    kundenName,
    netto,
    positionenAnzahl,
    body,
    setAnfrageId,
    toast,
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <h2 className="text-xl sm:text-2xl font-semibold">
                Projektkalkulation — Übersicht
              </h2>
              <p className="text-sm text-muted-foreground">
                Alle Preise exkl. MwSt. · gültig vorbehaltlich Prüfung
              </p>
            </div>
            {state.anfrageId && (
              <Badge variant="outline" className="text-[11px]">
                Bearbeite gespeicherte Anfrage
              </Badge>
            )}
          </div>

          <div className="space-y-0">
            <SumRow label="36 01 · Baustellengemeinkosten" value={bgk} />
            <SumRow label="36 12 · Dachkonstruktionen" value={sumDach} />
            <SumRow label="36 14 · Decken" value={sumDecken} />
            <SumRow label="36 15 · Riegelwände" value={sumWaende} />
            <div className="flex justify-between items-baseline border-b-2 border-emerald-600 pt-3 pb-2">
              <span className="text-lg font-bold text-emerald-700">
                GESAMTSUMME NETTO
              </span>
              <span className="text-lg font-bold text-emerald-700 tabular-nums">
                {eur(netto)}
              </span>
            </div>
            <div className="flex justify-between text-sm text-muted-foreground italic pt-2">
              <span>36 90 · Regie (separat, nur auf Anordnung)</span>
              <span className="tabular-nums">{eur(sumRegie)} (nicht in Summe)</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              onClick={oeffnen}
              disabled={positionenAnzahl === 0}
              className="min-h-[44px]"
            >
              <Save className="h-4 w-4 mr-1.5" />
              {state.anfrageId ? "Änderungen speichern" : "Anfrage speichern"}
            </Button>
            <Button
              variant="outline"
              onClick={() => window.print()}
              className="min-h-[44px]"
            >
              <Printer className="h-4 w-4 mr-1.5" /> Drucken / PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => !o && !saving && setOpen(false)}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {state.anfrageId
                ? "Anfrage aktualisieren"
                : "Anfrage speichern"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Die Anfrage wird in der App gespeichert. Du findest sie unter
              „Anfragen" — dort kannst du sie öffnen, weiter bearbeiten und
              später bei Bedarf manuell ans Büro weiterleiten.
            </p>
            <div>
              <Label htmlFor="anf-titel">Bezeichnung</Label>
              <Input
                id="anf-titel"
                value={titel}
                onChange={(e) => setTitel(e.target.value)}
                placeholder="z. B. EFH Müller · Velden"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="anf-body">Bedarfstext (wird im Detail angezeigt)</Label>
              <Textarea
                id="anf-body"
                rows={12}
                className="mt-1 font-mono text-xs"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Abbrechen
            </Button>
            <Button onClick={speichern} disabled={saving || !titel.trim()}>
              {saving ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1.5" />
              )}
              {state.anfrageId ? "Aktualisieren" : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SumRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between items-baseline py-2 border-b border-border/60">
      <span className="text-sm">{label}</span>
      <span className="font-semibold tabular-nums">{eur(value)}</span>
    </div>
  );
}
