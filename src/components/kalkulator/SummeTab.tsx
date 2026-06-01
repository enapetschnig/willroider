/**
 * SummeTab — Übersicht der gesamten Kalkulation.
 *
 * Zeigt die Summen pro Bereich (BGK, Dach, Decken, Wände), die
 * Gesamt-Nettosumme (ohne Regie!) und Regie separat. Erlaubt das
 * Versenden einer Anfrage ans Büro über die Edge-Function
 * `kalkulator-bridge` (Action `anfrage`). Empfänger-Default wird aus
 * app_einstellungen.bsb_buero_mail gelesen, Fallback maurer@willroider.at.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Loader2, Mail, Printer } from "lucide-react";
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
}

const FALLBACK_EMPFAENGER = "maurer@willroider.at";

/** Summiert alle Positionen eines Bereichs (Menge > 0) auf. */
function bereichSumme(
  bereich: Bereich,
  state: KalkulatorState,
): number {
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

/** Liste aller Positionen mit Menge > 0 (für Textauflistung). */
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

function buildAnfrageText(
  state: KalkulatorState,
  kundenName: string,
  summen: { bgk: number; dach: number; decken: number; waende: number; regie: number; netto: number },
): string {
  const lines: string[] = [];
  lines.push(`Anfrage Bausatz-Kalkulator`);
  lines.push(`Kunde: ${kundenName}`);
  lines.push("");
  lines.push(`Projekt:`);
  lines.push(`  Wandfläche: ${state.projekt.wandflaeche} m²`);
  lines.push(`  Wandtypen: ${state.projekt.wandtypen}`);
  lines.push(`  Geschosse: ${state.projekt.geschosse}`);
  if (state.projekt.laser) lines.push(`  Laser-Einmessung (${state.projekt.std3d} h 3D)`);
  if (state.projekt.punktwolke) lines.push(`  Punktwolke`);
  lines.push("");
  lines.push(`Positionen:`);
  const pos = eingetragenePositionen(state);
  if (pos.length === 0) {
    lines.push(`  (keine Positionen eingetragen)`);
  } else {
    for (const e of pos) {
      lines.push(
        `  ${e.p.pos}  ${e.p.bez} — ${e.menge} ${e.p.eh} × ${eur(e.ep)} = ${eur(e.summe)}`,
      );
    }
  }
  lines.push("");
  lines.push(`Summen (netto, exkl. MwSt.):`);
  lines.push(`  36 01 Baustellengemeinkosten: ${eur(summen.bgk)}`);
  lines.push(`  36 12 Dachkonstruktionen:     ${eur(summen.dach)}`);
  lines.push(`  36 14 Decken:                 ${eur(summen.decken)}`);
  lines.push(`  36 15 Riegelwände:            ${eur(summen.waende)}`);
  lines.push(`  ------------------------------------------`);
  lines.push(`  GESAMTSUMME NETTO:            ${eur(summen.netto)}`);
  lines.push(`  36 90 Regie (separat):        ${eur(summen.regie)}`);
  lines.push("");
  lines.push(`Bitte um Angebot.`);
  lines.push("");
  lines.push(`— ${FIRMA.name}`);
  return lines.join("\n");
}

export default function SummeTab({ state }: TabProps) {
  const { toast } = useToast();
  const { profile, user } = useAuth();

  // Berechnete Summen
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

  // Kunden-Name (für Betreff und Body)
  const kundenName = useMemo(() => {
    if (!profile) return user?.email ?? "Unbekannt";
    const n = `${profile.vorname ?? ""} ${profile.nachname ?? ""}`.trim();
    return n || profile.email || user?.email || "Unbekannt";
  }, [profile, user]);

  // Dialog-State
  const [open, setOpen] = useState(false);
  const [empfaenger, setEmpfaenger] = useState("");
  const [betreff, setBetreff] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingDefaults, setLoadingDefaults] = useState(false);

  // Beim Öffnen Default-Empfänger holen + Body neu generieren
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoadingDefaults(true);
      try {
        const { data: setting } = await supabase
          .from("app_einstellungen")
          .select("wert")
          .eq("schluessel", "bsb_buero_mail")
          .maybeSingle();
        const mail = ((setting as any)?.wert as string) || FALLBACK_EMPFAENGER;
        if (cancelled) return;
        setEmpfaenger(mail);
      } catch {
        if (!cancelled) setEmpfaenger(FALLBACK_EMPFAENGER);
      } finally {
        if (!cancelled) setLoadingDefaults(false);
      }
      if (cancelled) return;
      setBetreff(`Anfrage Bausatz-Kalkulator — ${kundenName}`);
      setBody(
        buildAnfrageText(state, kundenName, {
          bgk,
          dach: sumDach,
          decken: sumDecken,
          waende: sumWaende,
          regie: sumRegie,
          netto,
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const empfaengerValid = useMemo(
    () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(empfaenger.trim()),
    [empfaenger],
  );

  const handleOeffnen = useCallback(() => {
    if (positionenAnzahl === 0) {
      toast({
        variant: "destructive",
        title: "Keine Positionen",
        description: "Bitte mindestens eine Position eintragen.",
      });
      return;
    }
    setOpen(true);
  }, [positionenAnzahl, toast]);

  const handleSend = useCallback(async () => {
    if (!empfaengerValid) {
      toast({
        variant: "destructive",
        title: "Empfänger ungültig",
        description: "Bitte gültige E-Mail-Adresse eintragen.",
      });
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "kalkulator-bridge",
        {
          body: {
            action: "anfrage",
            kunde_name: kundenName,
            summe_netto: netto,
            positionen_anzahl: positionenAnzahl,
            eigene_anzahl: 0,
            bedarf_text: body,
            projekt: state.projekt,
            empfaenger: empfaenger.trim(),
            betreff,
          },
        },
      );
      if (error) throw error;
      const res = data as any;
      if (res && res.ok === false) {
        throw new Error(res.error ?? "Versand fehlgeschlagen");
      }
      toast({
        title: "Anfrage gesendet",
        description: "Das Büro hat sie erhalten.",
      });
      setOpen(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Versand nicht durchgekommen",
        description:
          (e as Error).message ||
          "Bitte später noch einmal versuchen oder Admin informieren.",
      });
    } finally {
      setSending(false);
    }
  }, [
    empfaenger,
    empfaengerValid,
    betreff,
    body,
    kundenName,
    netto,
    positionenAnzahl,
    state.projekt,
    toast,
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 sm:p-6 space-y-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-semibold">
              Projektkalkulation — Übersicht
            </h2>
            <p className="text-sm text-muted-foreground">
              Alle Preise exkl. MwSt. · gültig vorbehaltlich Prüfung
            </p>
          </div>

          {/* Sumrows */}
          <div className="space-y-0">
            <SumRow label="36 01 · Baustellengemeinkosten" value={bgk} />
            <SumRow label="36 12 · Dachkonstruktionen" value={sumDach} />
            <SumRow label="36 14 · Decken" value={sumDecken} />
            <SumRow label="36 15 · Riegelwände" value={sumWaende} />

            {/* Gesamtsumme — fett, groß, grün */}
            <div className="flex items-baseline justify-between gap-3 py-3 border-b-2 border-emerald-600">
              <span className="text-base sm:text-lg font-bold text-emerald-700 dark:text-emerald-400">
                GESAMTSUMME NETTO
              </span>
              <span className="text-lg sm:text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                {eur(netto)}
              </span>
            </div>

            {/* Regie separat */}
            <div className="flex items-baseline justify-between gap-3 py-2 text-xs sm:text-sm italic text-muted-foreground">
              <span>
                36 90 · Regieleistungen{" "}
                <span className="not-italic">(separat, nur auf Anordnung)</span>
              </span>
              <span className="tabular-nums">{eur(sumRegie)}</span>
            </div>
            <div className="text-[11px] text-muted-foreground italic">
              Regie ist nicht in der Gesamtsumme enthalten.
            </div>
          </div>

          {/* Aktionen */}
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <Button
              type="button"
              onClick={handleOeffnen}
              className="min-h-[44px]"
            >
              <Mail className="h-4 w-4 mr-2" />
              Anfrage ans Büro senden
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => window.print()}
              className="min-h-[44px]"
            >
              <Printer className="h-4 w-4 mr-2" />
              Drucken / PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Versenden-Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Anfrage ans Büro senden
            </DialogTitle>
          </DialogHeader>

          {loadingDefaults ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Vorbereiten …
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Empfänger (Büro) *</Label>
                <Input
                  type="email"
                  value={empfaenger}
                  onChange={(e) => setEmpfaenger(e.target.value)}
                  placeholder="maurer@willroider.at"
                  className={
                    !empfaengerValid && empfaenger.length > 0
                      ? "border-destructive"
                      : undefined
                  }
                />
                {!empfaengerValid && empfaenger.length > 0 && (
                  <div className="text-[11px] text-destructive">
                    Ungültige E-Mail-Adresse
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Betreff</Label>
                <Input
                  value={betreff}
                  onChange={(e) => setBetreff(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Nachricht</Label>
                <Textarea
                  rows={14}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="font-mono text-xs"
                />
                <div className="text-[11px] text-muted-foreground">
                  {positionenAnzahl} Position
                  {positionenAnzahl === 1 ? "" : "en"} · Netto {eur(netto)}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={sending}
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleSend}
              disabled={
                sending || loadingDefaults || !empfaengerValid || !body.trim()
              }
            >
              {sending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Mail className="h-4 w-4 mr-1.5" />
              )}
              Jetzt senden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SumRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b">
      <span className="text-sm">{label}</span>
      <span className="text-sm font-medium tabular-nums">{eur(value)}</span>
    </div>
  );
}
