/**
 * Zentraler Kalkulator-Hook. Hält Projektdaten, K3-Sätze, Mengen pro
 * Position, K7-Overrides und Stützenlänge. Synchronisiert K3-Sätze mit
 * Supabase (Tabelle `kalkulator_k3_saetze`) — der Rest bleibt im
 * Component-State (Anfragen werden beim Versenden in `kalkulator_anfragen`
 * persistiert).
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  DEFAULT_K3,
  DEFAULT_PROJEKT,
  type K3Satz,
  type K7Override,
  type ProjektDaten,
} from "@/lib/kalkulator/calc";
import type { Bereich } from "@/lib/kalkulator/positionen";

type K3State = Record<Bereich | "clt", K3Satz>;
type MengenState = Record<string, number>;
type OverridesState = Record<string, K7Override>;

export interface KalkulatorState {
  projekt: ProjektDaten;
  k3: K3State;
  mengen: MengenState;
  overrides: OverridesState;
  stuetzeLen: number;
}

const INITIAL_STATE: KalkulatorState = {
  projekt: DEFAULT_PROJEKT,
  k3: DEFAULT_K3,
  mengen: {},
  overrides: {},
  stuetzeLen: 3,
};

const LS_KEY = "willroider:kalkulator:v1";

function loadFromStorage(): Partial<KalkulatorState> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function saveToStorage(s: KalkulatorState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function useKalkulator(canWriteK3: boolean) {
  const { toast } = useToast();
  const [state, setState] = useState<KalkulatorState>(() => ({
    ...INITIAL_STATE,
    ...loadFromStorage(),
  }));
  const [k3SyncStatus, setK3SyncStatus] = useState<string>("");

  // K3-Sätze beim Start aus Supabase laden (überschreibt localStorage,
  // weil das die geteilte Wahrheit ist).
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("kalkulator_k3_saetze")
        .select("*");
      if (error || !data) return;
      setState((s) => {
        const k3 = { ...s.k3 };
        for (const row of data as any[]) {
          if (k3[row.gruppe as keyof K3State]) {
            k3[row.gruppe as keyof K3State] = {
              grundlohn: Number(row.grundlohn),
              lnk: Number(row.lnk),
              unprod: Number(row.unprod),
              ggk: Number(row.ggk),
              bauzinsen: Number(row.bauzinsen),
              wagnis: Number(row.wagnis),
              gewinn: Number(row.gewinn),
            };
          }
        }
        return { ...s, k3 };
      });
    })();
  }, []);

  // Auto-Persist in localStorage bei Änderungen
  useEffect(() => {
    saveToStorage(state);
  }, [state]);

  const setProjekt = useCallback((patch: Partial<ProjektDaten>) => {
    setState((s) => ({ ...s, projekt: { ...s.projekt, ...patch } }));
  }, []);

  const setMenge = useCallback((posKey: string, value: number) => {
    setState((s) => ({
      ...s,
      mengen: { ...s.mengen, [posKey]: value },
    }));
  }, []);

  const setOverride = useCallback(
    (posKey: string, field: keyof K7Override, value: number | undefined) => {
      setState((s) => {
        const prev = s.overrides[posKey] ?? {};
        const next = { ...prev, [field]: value };
        // Wenn alle Felder leer → ganz entfernen
        const empty =
          (next.aw == null || next.aw === 0) &&
          (next.material == null || next.material === 0) &&
          (next.geraete == null || next.geraete === 0) &&
          (next.fremd == null || next.fremd === 0);
        const overrides = { ...s.overrides };
        if (empty) delete overrides[posKey];
        else overrides[posKey] = next;
        return { ...s, overrides };
      });
    },
    [],
  );

  const setStuetzeLen = useCallback((len: number) => {
    setState((s) => ({ ...s, stuetzeLen: Math.max(0.1, len || 0.1) }));
  }, []);

  /** K3-Satz einer Gruppe ändern + sofort an Server pushen, falls erlaubt. */
  const setK3 = useCallback(
    async (gruppe: keyof K3State, patch: Partial<K3Satz>) => {
      const nextK3 = { ...state.k3, [gruppe]: { ...state.k3[gruppe], ...patch } };
      setState((s) => ({ ...s, k3: nextK3 }));
      if (!canWriteK3) {
        setK3SyncStatus("Lokal gespeichert (keine Schreibrechte)");
        return;
      }
      // Direkter Supabase-Update — RLS lässt nur Geschäftsführung/Büro durch
      const { error } = await supabase
        .from("kalkulator_k3_saetze")
        .update({
          grundlohn: nextK3[gruppe].grundlohn,
          lnk: nextK3[gruppe].lnk,
          unprod: nextK3[gruppe].unprod,
          ggk: nextK3[gruppe].ggk,
          bauzinsen: nextK3[gruppe].bauzinsen,
          wagnis: nextK3[gruppe].wagnis,
          gewinn: nextK3[gruppe].gewinn,
        })
        .eq("gruppe", gruppe);
      if (error) {
        setK3SyncStatus("Fehler: " + error.message);
        toast({
          variant: "destructive",
          title: "K3-Satz nicht synchronisiert",
          description: error.message,
        });
      } else {
        setK3SyncStatus("Auf Server gespeichert");
      }
    },
    [state.k3, canWriteK3, toast],
  );

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return {
    state,
    setProjekt,
    setMenge,
    setOverride,
    setStuetzeLen,
    setK3,
    k3SyncStatus,
    reset,
  };
}
