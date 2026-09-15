/**
 * Dateien, die in SharePoint liegen und in der App nur gezeigt werden.
 *
 * Die App speichert davon ausschließlich die Angaben zur Datei (Name,
 * Ordner, Größe, Datum) — der Inhalt bleibt in SharePoint. Beim Öffnen
 * holt die Edge Function `sharepoint-datei` eine kurzlebige Adresse.
 *
 * In SharePoint wird von der App aus nichts gelöscht und nichts geändert.
 * Deshalb sind diese Dateien hier bewusst schreibgeschützt: kein Löschen,
 * kein Umbenennen, kein Verschieben.
 */
import { supabase } from "@/integrations/supabase/client";

export type SharePointDatei = {
  id: string;
  baustelle_id: string;
  ordner: string | null;
  subpath: string | null;
  sp_pfad: string;
  dateiname: string;
  groesse: number | null;
  mimetype: string | null;
  web_url: string | null;
  geaendert_am: string | null;
  geaendert_von: string | null;
};

/** Kennzeichnung im Frontend: gespiegelte Dateien tragen dieses Präfix. */
export const SP_PREFIX = "sp:";
export const istSharePointId = (id: string) => id.startsWith(SP_PREFIX);

export async function ladeSharePointDateien(baustelleId: string): Promise<SharePointDatei[]> {
  const { data, error } = await (supabase as any)
    .from("sharepoint_dateien")
    .select("id, baustelle_id, ordner, subpath, sp_pfad, dateiname, groesse, mimetype, web_url, geaendert_am, geaendert_von")
    .eq("baustelle_id", baustelleId)
    .is("verschwunden_am", null)
    // Dateien, die aus der App stammen, stehen dort schon — sonst doppelt.
    .is("dokument_id", null);
  if (error) return [];
  return (data as SharePointDatei[]) ?? [];
}

/**
 * Stößt an, dass neue App-Dateien dieser Baustelle nach SharePoint
 * wandern. Läuft im Hintergrund; ein Fehlschlag ist unkritisch, weil der
 * Zeitplan es ohnehin alle zehn Minuten nachholt.
 */
export function sharePointHochladenAnstossen(baustelleId: string): void {
  void supabase.functions
    .invoke("sharepoint-schreiben", { body: { modus: "hochladen", baustelle_id: baustelleId } })
    .catch(() => undefined);
}

/** Ordner für eine Baustelle suchen und, wenn es keinen gibt, anlegen. */
export async function sharePointOrdnerAnlegen(
  baustelleId: string,
  trotzdemAnlegen = false,
): Promise<{
  ok: boolean;
  angelegt?: boolean;
  schon_da?: boolean;
  unklar?: boolean;
  pfad?: string;
  hinweis?: string;
  fehler?: string;
  dateien?: { hochgeladen: number; verknuepft: number };
}> {
  const { data, error } = await supabase.functions.invoke("sharepoint-schreiben", {
    body: { modus: "ordner", baustelle_id: baustelleId, trotzdem_anlegen: trotzdemAnlegen },
  });
  if (error) return { ok: false, fehler: error.message };
  return data;
}

/** Kurzlebige Adresse zum Ansehen oder Herunterladen. */
export async function sharePointDateiUrl(
  dateiId: string,
): Promise<{ url: string; dateiname: string; mimetype: string | null } | null> {
  const roh = dateiId.startsWith(SP_PREFIX) ? dateiId.slice(SP_PREFIX.length) : dateiId;
  const { data, error } = await supabase.functions.invoke("sharepoint-datei", {
    body: { datei_id: roh },
  });
  if (error || !data?.ok) return null;
  return { url: data.url, dateiname: data.dateiname, mimetype: data.mimetype ?? null };
}
