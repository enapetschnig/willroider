/**
 * Anmerkungsebene des Plan-Viewers.
 *
 * Koordinaten in „Planeinheiten“: bei PDFs PDF-Punkte der Seite so, wie
 * sie angezeigt wird (1/72 Zoll, Ursprung links oben), bei Bildern Pixel.
 * Damit passt die Ebene bei jeder Zoomstufe und lässt sich ins PDF übertragen.
 *
 * Gespeichert wird zuerst lokal (IndexedDB, geht auch offline), danach in
 * `plan_anmerkungen` (je Person und Plan). Was noch nicht oben ist, trägt
 * das Kennzeichen „ausstehend“ und wird nachgeholt, sobald Netz da ist.
 */
import { supabase } from "@/integrations/supabase/client";
import { nutzerId, speicher } from "./planSpeicher";

export type Grund = { id: string; farbe: string; breite: number };
export type Form =
  | (Grund & { typ: "stift"; punkte: number[] })
  | (Grund & { typ: "pfeil" | "rechteck" | "wolke" | "laenge"; x1: number; y1: number; x2: number; y2: number })
  | (Grund & { typ: "flaeche"; punkte: number[] })
  | (Grund & { typ: "text"; x: number; y: number; text: string; groesse: number })
  | (Grund & { typ: "foto"; x: number; y: number; bild: string; notiz?: string });

export type Massstab = {
  /** Meter je Planeinheit. */
  meterProEinheit: number;
  quelle: "massstab" | "kalibriert";
  /** bei „massstab“: N aus 1:N */
  n?: number;
};

export type AnmerkungsDaten = {
  version: 1;
  seiten: Record<string, Form[]>;
  massstab?: Massstab | null;
};

export const leereDaten = (): AnmerkungsDaten => ({ version: 1, seiten: {} });

type Lokal = {
  daten: AnmerkungsDaten;
  geaendertAm: string;
  ausstehend: boolean;
  baustelleId: string | null;
  dateiname: string | null;
};

export type SyncStatus = "synchronisiert" | "ausstehend" | "speichert";
const zuhoerer = new Set<() => void>();
export const beiSyncAenderung = (fn: () => void) => {
  zuhoerer.add(fn);
  return () => {
    zuhoerer.delete(fn);
  };
};
const melden = () => zuhoerer.forEach((f) => f());

const lokalerSchluessel = async (dateiSchluessel: string) => `${(await nutzerId()) ?? "ohne"}|${dateiSchluessel}`;

export async function ladeAnmerkungen(dateiSchluessel: string): Promise<{ daten: AnmerkungsDaten; status: SyncStatus }> {
  const k = await lokalerSchluessel(dateiSchluessel);
  const lokal = await speicher.lesen<Lokal>("anmerkungen", k);
  if (lokal?.ausstehend) {
    // Noch nicht oben → lokale Fassung gilt und wird gleich nachgeschoben.
    void hochladen(dateiSchluessel, lokal);
    return { daten: lokal.daten, status: "ausstehend" };
  }
  if (navigator.onLine) {
    const { data, error } = await (supabase as any)
      .from("plan_anmerkungen")
      .select("daten, geaendert_am")
      .eq("datei_schluessel", dateiSchluessel)
      .maybeSingle();
    if (!error) {
      if (data?.daten && (!lokal || data.geaendert_am >= lokal.geaendertAm)) {
        const d = data.daten as AnmerkungsDaten;
        await speicher.schreiben("anmerkungen", k, {
          daten: d,
          geaendertAm: data.geaendert_am,
          ausstehend: false,
          baustelleId: lokal?.baustelleId ?? null,
          dateiname: lokal?.dateiname ?? null,
        } satisfies Lokal);
        return { daten: { ...leereDaten(), ...d }, status: "synchronisiert" };
      }
      if (!data && !lokal) return { daten: leereDaten(), status: "synchronisiert" };
    }
  }
  return { daten: lokal?.daten ?? leereDaten(), status: lokal?.ausstehend ? "ausstehend" : "synchronisiert" };
}

async function hochladen(dateiSchluessel: string, lokal: Lokal): Promise<boolean> {
  if (!navigator.onLine) return false;
  const { data: s } = await supabase.auth.getSession();
  const uid = s.session?.user.id;
  if (!uid) return false;
  const { error } = await (supabase as any).from("plan_anmerkungen").upsert(
    {
      user_id: uid,
      datei_schluessel: dateiSchluessel,
      baustelle_id: lokal.baustelleId,
      dateiname: lokal.dateiname,
      daten: lokal.daten,
      geaendert_am: lokal.geaendertAm,
    },
    { onConflict: "user_id,datei_schluessel" },
  );
  if (error) return false;
  const k = `${uid}|${dateiSchluessel}`;
  const aktuell = await speicher.lesen<Lokal>("anmerkungen", k);
  // Nur als erledigt markieren, wenn inzwischen nichts Neueres dazukam.
  if (aktuell && aktuell.geaendertAm === lokal.geaendertAm) {
    await speicher.schreiben("anmerkungen", k, { ...aktuell, ausstehend: false });
  }
  melden();
  return true;
}

export async function speichereAnmerkungen(
  dateiSchluessel: string,
  daten: AnmerkungsDaten,
  meta: { baustelleId: string | null; dateiname: string | null },
): Promise<SyncStatus> {
  const k = await lokalerSchluessel(dateiSchluessel);
  const lokal: Lokal = {
    daten,
    geaendertAm: new Date().toISOString(),
    ausstehend: true,
    baustelleId: meta.baustelleId,
    dateiname: meta.dateiname,
  };
  await speicher.schreiben("anmerkungen", k, lokal);
  melden();
  const ok = await hochladen(dateiSchluessel, lokal).catch(() => false);
  return ok ? "synchronisiert" : "ausstehend";
}

export async function syncStatus(dateiSchluessel: string): Promise<SyncStatus> {
  const k = await lokalerSchluessel(dateiSchluessel);
  const lokal = await speicher.lesen<Lokal>("anmerkungen", k);
  return lokal?.ausstehend ? "ausstehend" : "synchronisiert";
}

/** Alles Ausstehende nachschieben (beim Wiederverbinden). */
export async function ausstehendeAnmerkungenHochladen(): Promise<number> {
  const uid = await nutzerId();
  if (!uid) return 0;
  let n = 0;
  for (const { key, wert } of await speicher.alle<Lokal>("anmerkungen")) {
    if (!wert.ausstehend || !key.startsWith(`${uid}|`)) continue;
    if (await hochladen(key.slice(uid.length + 1), wert).catch(() => false)) n++;
  }
  return n;
}

/** Länge in Planeinheiten → Text in Metern. */
export function laengeText(einheiten: number, m?: Massstab | null): string {
  if (!m) return "Maßstab fehlt";
  const meter = einheiten * m.meterProEinheit;
  return `${meter.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
}
export function flaecheText(einheiten2: number, m?: Massstab | null): string {
  if (!m) return "Maßstab fehlt";
  const qm = einheiten2 * m.meterProEinheit * m.meterProEinheit;
  return `${qm.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
}
export function polygonFlaeche(p: number[]): number {
  let s = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1];
  }
  return Math.abs(s) / 2;
}
/** PDF-Punkt = 1/72 Zoll → Meter auf dem Papier; mal N = Natur. */
export const PUNKT_IN_METER = 0.0254 / 72;

/** Revisionswolke: Bögen entlang des Rechtecks, als Punktliste (für SVG und PDF gleich). */
export function wolkenPunkte(x1: number, y1: number, x2: number, y2: number, bogen: number): number[][] {
  const xa = Math.min(x1, x2), xb = Math.max(x1, x2), ya = Math.min(y1, y2), yb = Math.max(y1, y2);
  const ecken = [[xa, ya], [xb, ya], [xb, yb], [xa, yb]];
  const boegen: number[][] = [];
  for (let k = 0; k < 4; k++) {
    const [ax, ay] = ecken[k];
    const [bx, by] = ecken[(k + 1) % 4];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(len / bogen));
    for (let i = 0; i < n; i++) {
      const sx = ax + ((bx - ax) * i) / n, sy = ay + ((by - ay) * i) / n;
      const ex = ax + ((bx - ax) * (i + 1)) / n, ey = ay + ((by - ay) * (i + 1)) / n;
      const mx = (sx + ex) / 2, my = (sy + ey) / 2;
      const r = Math.hypot(ex - sx, ey - sy) / 2;
      // Umlauf im Uhrzeigersinn (y nach unten) → steigender Winkel wölbt nach außen.
      const pts: number[] = [];
      const steps = 8;
      const a0 = Math.atan2(sy - my, sx - mx);
      for (let t = 0; t <= steps; t++) {
        const a = a0 + (Math.PI * t) / steps;
        pts.push(mx + r * Math.cos(a), my + r * Math.sin(a));
      }
      boegen.push(pts);
    }
  }
  return boegen;
}
