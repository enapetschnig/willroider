/**
 * Inhalt eines Plans holen — direkt, ohne dass der Nutzer etwas herunterlädt.
 * Mit Netz frisch aus SharePoint bzw. Storage (eine offline gespeicherte
 * Fassung wird dabei aufgefrischt), ohne Netz aus dem lokalen Speicher.
 */
import { supabase } from "@/integrations/supabase/client";
import { sharePointDateiUrl } from "@/lib/sharepoint";
import { speicher, type GespeicherterPlan } from "./planSpeicher";
import type { PlanTab } from "./planTabs";

export type PlanInhalt = { blob: Blob; istPdf: boolean; webUrl: string | null; ausSpeicher: boolean };

const imSpeicher = new Map<string, PlanInhalt>();
const zuhoerer = new Set<() => void>();
export const beiOfflineAenderung = (fn: () => void) => {
  zuhoerer.add(fn);
  return () => {
    zuhoerer.delete(fn);
  };
};
const melden = () => zuhoerer.forEach((f) => f());

const istPdfName = (name: string, mt: string | null | undefined) =>
  (mt ?? "").toLowerCase() === "application/pdf" || /\.pdf$/i.test(name);

async function frischHolen(tab: PlanTab): Promise<{ blob: Blob; istPdf: boolean; webUrl: string | null }> {
  if (tab.key.startsWith("sp:")) {
    const ziel = await sharePointDateiUrl(tab.key);
    if (!ziel) throw new Error("Datei in SharePoint nicht erreichbar");
    const r = await fetch(ziel.url);
    if (!r.ok) throw new Error(`Laden fehlgeschlagen (${r.status})`);
    const roh = await r.blob();
    const istPdf = ziel.als_pdf || istPdfName(ziel.dateiname, ziel.mimetype) || roh.type === "application/pdf";
    const typ = istPdf ? "application/pdf" : roh.type || ziel.mimetype || "image/jpeg";
    return { blob: roh.type === typ ? roh : new Blob([roh], { type: typ }), istPdf, webUrl: ziel.web_url };
  }
  if (!tab.storagePath) throw new Error("Datei ohne Speicherort");
  const { data, error } = await supabase.storage.from("baustellen").download(tab.storagePath);
  if (error || !data) throw new Error(error?.message ?? "Laden fehlgeschlagen");
  const istPdf = istPdfName(tab.dateiname, tab.mimetype) || data.type === "application/pdf";
  const typ = istPdf ? "application/pdf" : data.type || tab.mimetype || "image/jpeg";
  // Bereits in SharePoint gespiegelt? Dann gibt es dort einen Link zum Teilen.
  let webUrl: string | null = null;
  const { data: sp } = await (supabase as any)
    .from("sharepoint_dateien")
    .select("web_url")
    .eq("dokument_id", tab.key.slice(4))
    .is("verschwunden_am", null)
    .limit(1)
    .maybeSingle();
  webUrl = sp?.web_url ?? null;
  return { blob: data.type === typ ? data : new Blob([data], { type: typ }), istPdf, webUrl };
}

export async function ladePlan(tab: PlanTab, erzwingen = false): Promise<PlanInhalt> {
  if (!erzwingen && imSpeicher.has(tab.key)) return imSpeicher.get(tab.key)!;
  const lokal = await speicher.lesen<GespeicherterPlan>("dateien", tab.key);
  if (navigator.onLine) {
    try {
      const f = await frischHolen(tab);
      const inhalt: PlanInhalt = { ...f, ausSpeicher: false };
      imSpeicher.set(tab.key, inhalt);
      if (lokal?.offline) {
        await speicher.schreiben("dateien", tab.key, {
          ...lokal,
          blob: f.blob,
          webUrl: f.webUrl,
          gespeichertAm: new Date().toISOString(),
        } satisfies GespeicherterPlan);
      }
      // Speicher klein halten
      if (imSpeicher.size > 12) imSpeicher.delete(imSpeicher.keys().next().value!);
      return inhalt;
    } catch (e) {
      if (!lokal) throw e;
    }
  }
  if (!lokal) throw new Error("Ohne Netz nicht verfügbar — der Plan wurde nicht offline gespeichert.");
  const inhalt: PlanInhalt = {
    blob: lokal.blob,
    istPdf: istPdfName(lokal.dateiname, lokal.mimetype) || lokal.blob.type === "application/pdf",
    webUrl: lokal.webUrl ?? null,
    ausSpeicher: true,
  };
  imSpeicher.set(tab.key, inhalt);
  return inhalt;
}

export async function istOffline(key: string): Promise<boolean> {
  const l = await speicher.lesen<GespeicherterPlan>("dateien", key);
  return !!l?.offline;
}

/** Plan für die Nutzung ohne Netz ablegen. */
export async function offlineSpeichern(tab: PlanTab): Promise<void> {
  const inhalt = await ladePlan(tab);
  await speicher.schreiben("dateien", tab.key, {
    blob: inhalt.blob,
    dateiname: tab.dateiname,
    mimetype: inhalt.istPdf ? "application/pdf" : inhalt.blob.type,
    baustelleId: tab.baustelleId,
    baustelleName: tab.baustelleName ?? null,
    offline: true,
    gespeichertAm: new Date().toISOString(),
    ordnerKey: tab.ordnerKey ?? null,
    subpath: tab.subpath ?? null,
    webUrl: inhalt.webUrl,
    storagePath: tab.storagePath ?? null,
  } as GespeicherterPlan & { storagePath: string | null });
  // Der PDF-Baustein (Worker) liegt nicht im Vorab-Cache der App — einmal
  // abrufen, damit ihn der Service Worker für die Nutzung ohne Netz behält.
  void pdfWorkerVorladen();
  // Speicher dauerhaft anfordern, damit der Browser ihn nicht wegräumt
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* egal */
  }
  melden();
}

let workerGeladen = false;
async function pdfWorkerVorladen() {
  if (workerGeladen) return;
  try {
    const url = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
    await fetch(url);
    workerGeladen = true;
  } catch {
    /* nächstes Mal */
  }
}

export async function offlineEntfernen(key: string): Promise<void> {
  await speicher.entfernen("dateien", key);
  melden();
}

export type OfflinePlan = PlanTab & { gespeichertAm: string; groesse: number };
export async function offlinePlaene(): Promise<OfflinePlan[]> {
  return (await speicher.alle<GespeicherterPlan & { storagePath?: string | null }>("dateien"))
    .filter((x) => x.wert.offline)
    .map(({ key, wert }) => ({
      key,
      dateiname: wert.dateiname,
      mimetype: wert.mimetype,
      baustelleId: wert.baustelleId,
      baustelleName: wert.baustelleName ?? null,
      storagePath: wert.storagePath ?? null,
      ordnerKey: wert.ordnerKey ?? null,
      subpath: wert.subpath ?? null,
      gespeichertAm: wert.gespeichertAm,
      groesse: wert.blob.size,
    }));
}
