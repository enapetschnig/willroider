// Microsoft Graph — Zugriff auf die SharePoint-Teams der Bauleiter.
//
// WICHTIG, gilt ausnahmslos: Dieses Modul kennt nur Lese-Aufrufe. Es gibt
// hier bewusst kein DELETE, kein PUT und kein PATCH. In SharePoint wird
// nichts gelöscht und nichts verändert — die App spiegelt nur.
//
// Anmeldung als Anwendung („IntraFit für OneDrive"), Berechtigungen
// Sites.Read.All / Files.Read.All. Das Geheimnis läuft am 13.03.2027 ab.

const TENANT = Deno.env.get("GRAPH_TENANT_ID") ?? "";
const CLIENT = Deno.env.get("GRAPH_CLIENT_ID") ?? "";
const SECRET = Deno.env.get("GRAPH_CLIENT_SECRET") ?? "";

let token: { wert: string; bis: number } | null = null;

export function graphKonfiguriert(): boolean {
  return !!(TENANT && CLIENT && SECRET);
}

export async function graphToken(): Promise<string> {
  if (token && token.bis > Date.now() + 60_000) return token.wert;
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT,
      client_secret: SECRET,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    throw new Error(`Graph-Anmeldung fehlgeschlagen (${r.status}): ${j.error_description ?? j.error ?? ""}`);
  }
  token = { wert: j.access_token, bis: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return token.wert;
}

/** Ein GET auf Graph. Andere Methoden gibt es hier absichtlich nicht. */
export async function graphGet<T = Record<string, unknown>>(
  pfadOderUrl: string,
): Promise<T & { status: number }> {
  const url = pfadOderUrl.startsWith("http")
    ? pfadOderUrl
    : `https://graph.microsoft.com/v1.0${pfadOderUrl}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${await graphToken()}` } });
  const text = await r.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { rohtext: text };
  }
  return { ...body, status: r.status } as T & { status: number };
}

export type GraphItem = {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  eTag?: string;
  lastModifiedDateTime?: string;
  lastModifiedBy?: { user?: { displayName?: string } };
  folder?: { childCount?: number };
  file?: { mimeType?: string };
  "@microsoft.graph.downloadUrl"?: string;
};

/** Kinder eines Ordners, über alle Seiten. Nur lesend. */
export async function kinder(driveId: string, itemId: string): Promise<GraphItem[]> {
  const felder = "id,name,size,webUrl,eTag,lastModifiedDateTime,lastModifiedBy,folder,file";
  let url: string | null =
    `/drives/${driveId}/items/${itemId}/children?$select=${felder}&$top=999`;
  const alle: GraphItem[] = [];
  while (url) {
    const r = await graphGet<{ value?: GraphItem[]; "@odata.nextLink"?: string }>(url);
    if (r.status !== 200) {
      throw new Error(`Graph ${r.status} bei ${url.slice(0, 80)}`);
    }
    alle.push(...(r.value ?? []));
    url = r["@odata.nextLink"] ?? null;
  }
  return alle;
}

/** Ordner über seinen Pfad finden, z. B. "/General". Nur lesend. */
export async function itemNachPfad(driveId: string, pfad: string): Promise<GraphItem | null> {
  const enc = pfad.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const r = await graphGet<GraphItem>(
    `/drives/${driveId}/root:/${enc}:?$select=id,name,folder,webUrl`,
  );
  return r.status === 200 ? r : null;
}

/** Kurzlebige Download-Adresse einer Datei (gültig ca. eine Stunde). */
export async function downloadUrl(driveId: string, itemId: string): Promise<string | null> {
  const r = await graphGet<GraphItem>(
    `/drives/${driveId}/items/${itemId}?$select=id,name,@microsoft.graph.downloadUrl`,
  );
  if (r.status !== 200) return null;
  return r["@microsoft.graph.downloadUrl"] ?? null;
}
