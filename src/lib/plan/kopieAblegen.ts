/**
 * „Als Kopie speichern“ aus dem Plan-Viewer: die neue PDF landet wie jeder
 * Upload im Dokumente-Reiter (Storage + Zeile in `dokumente`) und wandert
 * von dort mit `sharepoint-schreiben` nach SharePoint — dort immer als
 * NEUE Datei (gleicher Name → SharePoint hängt eine Nummer an). Bestehende
 * Dateien werden nie überschrieben (Grundregel SharePoint).
 *
 * Ohne Netz kommt die Kopie in die Warteschlange (IndexedDB) und wird beim
 * Wiederverbinden hochgeladen.
 */
import { supabase } from "@/integrations/supabase/client";
import { sanitizeFolderName, sanitizeStorageName } from "@/lib/uploadHelpers";
import { pfadKlasse, speicherPfadTeil } from "@/lib/ordnerKlasse";
import { SP_PREFIX, sharePointHochladenAnstossen } from "@/lib/sharepoint";
import { speicher } from "./planSpeicher";

export type KopieZiel = {
  baustelleId: string;
  /** Ordner wie im Dokumente-Reiter: „sp:<oberster Ordner>“, „sp:“ oder App-Ordner („91-plaene“). */
  ordnerKey: string;
  subpath: string;
};

type Wartend = KopieZiel & { blob: Blob; dateiname: string; erstelltAm: string };

const zuhoerer = new Set<() => void>();
export const beiKopienAenderung = (fn: () => void) => {
  zuhoerer.add(fn);
  return () => {
    zuhoerer.delete(fn);
  };
};
const melden = () => zuhoerer.forEach((f) => f());

/** Lädt hoch; gibt die neue Dokument-ID zurück. Wirft bei Fehler. */
export async function kopieHochladen(ziel: KopieZiel, blob: Blob, dateiname: string): Promise<{ id: string; storage_path: string }> {
  const { data: u } = await supabase.auth.getUser();
  const sub = ziel.subpath ? ziel.subpath.split("/").map(sanitizeFolderName).filter(Boolean).join("/") : "";
  const subStorage = sub ? `${sub.split("/").map(speicherPfadTeil).join("/")}/` : "";
  const spTop = ziel.ordnerKey.startsWith(SP_PREFIX) ? ziel.ordnerKey.slice(SP_PREFIX.length) : null;
  const klasse = spTop !== null ? pfadKlasse(spTop, sub) : ziel.ordnerKey;
  const path = `${ziel.baustelleId}/${klasse}/${subStorage}${Date.now()}_${sanitizeStorageName(dateiname)}`;
  const { error: upErr } = await supabase.storage
    .from("baustellen")
    .upload(path, blob, { contentType: "application/pdf" });
  if (upErr) throw new Error(upErr.message);
  const { data, error } = await supabase
    .from("dokumente")
    .insert({
      baustelle_id: ziel.baustelleId,
      ordner: klasse,
      subpath: sub || null,
      sharepoint_ziel_pfad: spTop === null ? null : spTop || "/",
      dateiname,
      storage_path: path,
      mimetype: "application/pdf",
      groesse: blob.size,
      hochgeladen_von: u.user?.id ?? null,
    } as any)
    .select("id")
    .single();
  if (error || !data) {
    await supabase.storage.from("baustellen").remove([path]);
    throw new Error(error?.message ?? "Speichern fehlgeschlagen");
  }
  sharePointHochladenAnstossen(ziel.baustelleId);
  return { id: (data as any).id as string, storage_path: path };
}

/** Speichern — online sofort, sonst in die Warteschlange. */
export async function kopieSpeichern(
  ziel: KopieZiel,
  blob: Blob,
  dateiname: string,
): Promise<{ status: "hochgeladen"; id: string; storage_path: string } | { status: "ausstehend" }> {
  if (navigator.onLine) {
    try {
      const r = await kopieHochladen(ziel, blob, dateiname);
      return { status: "hochgeladen", ...r };
    } catch (e) {
      // Netzfehler → wie offline behandeln; echte Rechtefehler melden
      if (navigator.onLine && !/fetch|network|Failed/i.test((e as Error).message)) throw e;
    }
  }
  const w: Wartend = { ...ziel, blob, dateiname, erstelltAm: new Date().toISOString() };
  await speicher.schreiben("kopien", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, w);
  melden();
  return { status: "ausstehend" };
}

export async function wartendeKopien(): Promise<{ key: string; dateiname: string; erstelltAm: string }[]> {
  return (await speicher.alle<Wartend>("kopien")).map(({ key, wert }) => ({
    key,
    dateiname: wert.dateiname,
    erstelltAm: wert.erstelltAm,
  }));
}

let laeuft = false;
/** Wartende Kopien hochladen. Gibt die Anzahl der hochgeladenen zurück. */
export async function wartendeKopienHochladen(): Promise<number> {
  if (laeuft || !navigator.onLine) return 0;
  laeuft = true;
  let n = 0;
  try {
    for (const { key, wert } of await speicher.alle<Wartend>("kopien")) {
      try {
        await kopieHochladen(wert, wert.blob, wert.dateiname);
        await speicher.entfernen("kopien", key);
        n++;
      } catch {
        /* nächstes Mal wieder */
      }
    }
  } finally {
    laeuft = false;
    if (n) melden();
  }
  return n;
}
