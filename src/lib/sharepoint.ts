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
  siteId?: string | null,
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
    body: {
      modus: "ordner",
      baustelle_id: baustelleId,
      trotzdem_anlegen: trotzdemAnlegen,
      ...(siteId ? { site_id: siteId } : {}),
    },
  });
  if (error) return { ok: false, fehler: error.message };
  return data;
}

/** Die Teams, in denen Baustellenordner liegen (für die Auswahl von Hand). */
export async function ladeSharePointTeams(): Promise<
  { site_id: string; site_name: string; bauleiter_id: string | null }[]
> {
  const { data } = await (supabase as any)
    .from("sharepoint_teams")
    .select("site_id, site_name, bauleiter_id")
    .eq("aktiv", true)
    .order("site_name");
  return data ?? [];
}

/**
 * Kurzlebige Adressen zu einer Datei: eine zum Ansehen und eine zum
 * Herunterladen. Word- und Excel-Dateien kommen als PDF zum Ansehen
 * zurück, weil der Browser sie sonst nicht darstellen kann; zum
 * Herunterladen gibt es weiterhin das Original.
 */
export async function sharePointDateiUrl(dateiId: string): Promise<{
  url: string;
  download_url: string;
  als_pdf: boolean;
  dateiname: string;
  mimetype: string | null;
} | null> {
  const roh = dateiId.startsWith(SP_PREFIX) ? dateiId.slice(SP_PREFIX.length) : dateiId;
  const { data, error } = await supabase.functions.invoke("sharepoint-datei", {
    body: { datei_id: roh },
  });
  if (error || !data?.ok) return null;
  return {
    url: data.url,
    download_url: data.download_url ?? data.url,
    als_pdf: !!data.als_pdf,
    dateiname: data.dateiname,
    mimetype: data.mimetype ?? null,
  };
}

/** Eine Adresse zum Herunterladen anbieten, ohne Pop-up-Blocker zu wecken. */
export function dateiHerunterladen(url: string, dateiname: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = dateiname;
  a.rel = "noopener";
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
