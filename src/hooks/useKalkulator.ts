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
import type { Bereich, EigeneGruppe } from "@/lib/kalkulator/positionen";
import { CLT_INITIAL, type CltState } from "@/lib/kalkulator/clt";
import type { AuerRow } from "@/lib/kalkulator/auer";

type K3State = Record<Bereich | "clt", K3Satz>;
type MengenState = Record<string, number>;
type OverridesState = Record<string, K7Override>;

export interface EigenerAufbau {
  name: string;
  gruppe: EigeneGruppe;
  schichten: string[]; // jede Schicht: Material-Name aus MATERIALIEN, leer = nicht gewählt
  menge: number; // m²
}

export interface EventlogEntry {
  typ: "Login" | "Anfrage" | string;
  zeit: string;
  name: string;
  rolle?: string;
  positionen?: number;
  eigene?: number;
  summe?: string;
  bedarf?: string;
}

export interface KalkulatorState {
  projekt: ProjektDaten;
  k3: K3State;
  mengen: MengenState;
  overrides: OverridesState;
  stuetzeLen: number;
  /** Pro Anfrage angelegte Custom-Aufbauten (Schichten-Auswahl, Preis
   *  „auf Anfrage"). */
  eigeneAufbauten: EigenerAufbau[];
  /** CLT-Konfigurator-State (Platten + Zusatz + Transport). */
  clt: CltState;
  /** Aufschlag % auf ZMP-CLT-Listenpreis. */
  cltAufschlag: number;
  /** Importierte Auer-Positionen (ONLV-Upload überschreibt AUER_BUILTIN). */
  auerImport: AuerRow[];
  /** Lokales Eventlog (Login + Anfrage), max. 500 Einträge. */
  eventlog: EventlogEntry[];
  /** Wenn gesetzt: wir bearbeiten eine bereits in der DB gespeicherte
   *  Anfrage; Speichern UPDATEt diesen Datensatz statt einen neuen
   *  anzulegen. */
  anfrageId: string | null;
}

const INITIAL_STATE: KalkulatorState = {
  projekt: DEFAULT_PROJEKT,
  k3: DEFAULT_K3,
  mengen: {},
  overrides: {},
  stuetzeLen: 3,
  eigeneAufbauten: [],
  clt: CLT_INITIAL,
  cltAufschlag: 0,
  auerImport: [],
  eventlog: [],
  anfrageId: null,
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

  /** Lädt eine gespeicherte Anfrage komplett in den State (Projekt,
   *  Mengen, Overrides, Stützenlänge, anfrageId). K3-Sätze werden NICHT
   *  überschrieben — die sind global. */
  const loadAnfrage = useCallback(async (anfrageId: string) => {
    const { data, error } = await supabase
      .from("kalkulator_anfragen")
      .select("id, kunde_name, raw_anfrage")
      .eq("id", anfrageId)
      .maybeSingle();
    if (error || !data) {
      toast({
        variant: "destructive",
        title: "Anfrage nicht gefunden",
        description: error?.message ?? "Bitte aus der Liste neu öffnen.",
      });
      return;
    }
    const raw = (data as any).raw_anfrage ?? {};
    setState((s) => ({
      ...s,
      projekt: { ...DEFAULT_PROJEKT, ...(raw.projekt ?? {}) },
      mengen: raw.mengen ?? {},
      overrides: raw.overrides ?? {},
      stuetzeLen: raw.stuetzeLen ?? 3,
      eigeneAufbauten: Array.isArray(raw.eigeneAufbauten) ? raw.eigeneAufbauten : [],
      clt: raw.clt ?? CLT_INITIAL,
      cltAufschlag: typeof raw.cltAufschlag === "number" ? raw.cltAufschlag : 0,
      anfrageId: (data as any).id,
    }));
  }, [toast]);

  /** Setzt anfrageId für den aktuellen State. Wird beim Speichern in
   *  SummeTab gefüllt, damit der nächste „Speichern"-Klick updated
   *  statt neu anzulegen. */
  const setAnfrageId = useCallback((id: string | null) => {
    setState((s) => ({ ...s, anfrageId: id }));
  }, []);

  // ─── Eigene Aufbauten ────────────────────────────────────────────────
  const addEigenerAufbau = useCallback(() => {
    setState((s) => ({
      ...s,
      eigeneAufbauten: [
        ...s.eigeneAufbauten,
        { name: "", gruppe: "waende", schichten: ["", "", ""], menge: 0 },
      ],
    }));
  }, []);

  const updateEigenerAufbau = useCallback(
    (i: number, patch: Partial<EigenerAufbau>) => {
      setState((s) => {
        const arr = [...s.eigeneAufbauten];
        if (!arr[i]) return s;
        arr[i] = { ...arr[i], ...patch };
        return { ...s, eigeneAufbauten: arr };
      });
    },
    [],
  );

  const setSchichtenAnzahl = useCallback((i: number, n: number) => {
    setState((s) => {
      const arr = [...s.eigeneAufbauten];
      const e = arr[i];
      if (!e) return s;
      const next = [...e.schichten];
      while (next.length < n) next.push("");
      if (n < next.length) {
        const verlier = next.slice(n).filter((x) => x);
        if (verlier.length > 0) {
          // eslint-disable-next-line no-alert
          if (!window.confirm(
            `${verlier.length} ausgefüllte Schicht${verlier.length === 1 ? "" : "en"} werden gelöscht:\n\n• ${verlier.join("\n• ")}\n\nFortfahren?`,
          )) return s;
        }
      }
      next.length = n;
      arr[i] = { ...e, schichten: next };
      return { ...s, eigeneAufbauten: arr };
    });
  }, []);

  const removeEigenerAufbau = useCallback((i: number) => {
    setState((s) => ({
      ...s,
      eigeneAufbauten: s.eigeneAufbauten.filter((_, idx) => idx !== i),
    }));
  }, []);

  // ─── CLT ──────────────────────────────────────────────────────────────
  const setCltState = useCallback((patch: Partial<CltState>) => {
    setState((s) => ({ ...s, clt: { ...s.clt, ...patch } }));
  }, []);
  const setCltAufschlag = useCallback((v: number) => {
    setState((s) => ({ ...s, cltAufschlag: v }));
  }, []);

  // ─── Auer-Import ──────────────────────────────────────────────────────
  const setAuerImport = useCallback((rows: AuerRow[]) => {
    setState((s) => ({ ...s, auerImport: rows }));
  }, []);

  // ─── Eventlog (lokal) ─────────────────────────────────────────────────
  const addEvent = useCallback((entry: EventlogEntry) => {
    setState((s) => ({
      ...s,
      eventlog: [entry, ...s.eventlog].slice(0, 500),
    }));
  }, []);
  const clearEventlog = useCallback(() => {
    setState((s) => ({ ...s, eventlog: [] }));
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
    loadAnfrage,
    setAnfrageId,
    // Eigene Aufbauten
    addEigenerAufbau,
    updateEigenerAufbau,
    setSchichtenAnzahl,
    removeEigenerAufbau,
    // CLT
    setCltState,
    setCltAufschlag,
    // Auer
    setAuerImport,
    // Eventlog
    addEvent,
    clearEventlog,
  };
}
