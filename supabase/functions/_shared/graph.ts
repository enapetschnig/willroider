// Microsoft Graph — Zugriff auf die SharePoint-Teams der Bauleiter.
//
// WICHTIG, gilt ausnahmslos: Dieses Modul löscht nichts und überschreibt
// nichts. Es gibt hier kein DELETE, kein PATCH und kein Verschieben oder
// Umbenennen. Geschrieben wird nur auf zwei Arten, beide ohne Verlust:
//   • einen neuen Ordner anlegen (schlägt fehl, wenn er schon da ist)
//   • eine neue Datei hochladen (bei Namensgleichheit legt SharePoint sie
//     daneben, die vorhandene bleibt unangetastet)
//
// Anmeldung als Anwendung („IntraFit für OneDrive"), Berechtigungen
// Sites.ReadWrite.All / Files.ReadWrite.All. Das Geheimnis läuft am
// 13.03.2027 ab.

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

// ───────────────────────── Schreiben ─────────────────────────
// Alles hier drunter legt an. Nichts davon löscht, ersetzt oder benennt um.

async function graphPost<T = Record<string, unknown>>(
  pfad: string,
  koerper: unknown,
): Promise<T & { status: number; location?: string }> {
  const r = await fetch(`https://graph.microsoft.com/v1.0${pfad}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await graphToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(koerper),
  });
  const text = await r.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { rohtext: text };
  }
  return { ...body, status: r.status, location: r.headers.get("location") ?? undefined } as T & {
    status: number;
    location?: string;
  };
}

/** Kind eines Ordners nach Namen suchen (Groß-/Kleinschreibung egal). */
export async function kindMitNamen(
  driveId: string,
  elternId: string,
  name: string,
): Promise<GraphItem | null> {
  const treffer = await kinder(driveId, elternId);
  const klein = name.toLowerCase();
  return treffer.find((k) => k.name.toLowerCase() === klein) ?? null;
}

/**
 * Ordner anlegen. Gibt es ihn schon, wird der vorhandene zurückgegeben —
 * angelegt wird dann nichts (`neu: false`).
 */
export async function ordnerAnlegen(
  driveId: string,
  elternId: string,
  name: string,
): Promise<{ item: GraphItem; neu: boolean }> {
  const da = await kindMitNamen(driveId, elternId, name);
  if (da?.folder) return { item: da, neu: false };
  const r = await graphPost<GraphItem>(`/drives/${driveId}/items/${elternId}/children`, {
    name,
    folder: {},
    "@microsoft.graph.conflictBehavior": "fail",
  });
  if (r.status === 409) {
    const nochmal = await kindMitNamen(driveId, elternId, name);
    if (nochmal) return { item: nochmal, neu: false };
  }
  if (r.status !== 201) throw new Error(`Ordner „${name}" nicht angelegt (${r.status})`);
  return { item: r, neu: true };
}

/** Pfad unterhalb eines Ordners sicherstellen, Ebene für Ebene. */
export async function pfadAnlegen(
  driveId: string,
  wurzelId: string,
  pfad: string,
): Promise<{ id: string; angelegt: string[] }> {
  let aktuell = wurzelId;
  const angelegt: string[] = [];
  for (const teil of pfad.split("/").map((t) => t.trim()).filter(Boolean)) {
    const { item, neu } = await ordnerAnlegen(driveId, aktuell, teil);
    if (neu) angelegt.push(teil);
    aktuell = item.id;
  }
  return { id: aktuell, angelegt };
}

/**
 * Vorlagenordner kopieren — so, wie es die Bauleiter von Hand machen.
 * Microsoft arbeitet das im Hintergrund ab; die Funktion wartet, bis der
 * Ordner da ist. Kopiert wird nur, nichts wird überschrieben.
 */
export async function vorlageKopieren(
  driveId: string,
  vorlageId: string,
  zielOrdnerId: string,
  name: string,
): Promise<GraphItem> {
  const r = await graphPost(`/drives/${driveId}/items/${vorlageId}/copy`, {
    parentReference: { driveId, id: zielOrdnerId },
    name,
    "@microsoft.graph.conflictBehavior": "fail",
  });
  if (r.status !== 202 && r.status !== 200 && r.status !== 201) {
    throw new Error(`Vorlage nicht kopiert (${r.status})`);
  }
  // Auf das Ergebnis warten: Microsoft meldet den Fortschritt getrennt.
  for (let i = 0; i < 40; i++) {
    await new Promise((f) => setTimeout(f, 1500));
    const fertig = await kindMitNamen(driveId, zielOrdnerId, name);
    if (fertig) return fertig;
    if (r.location) {
      const m = await fetch(r.location);
      if (m.ok) {
        const j = await m.json().catch(() => ({}));
        if (j.status === "failed") throw new Error(`Kopie fehlgeschlagen: ${j.errorCode ?? ""}`);
      }
    }
  }
  throw new Error("Kopie der Vorlage dauert ungewöhnlich lange");
}

/**
 * Datei hochladen. Eine vorhandene Datei wird nie ersetzt: Bei gleichem
 * Namen hängt SharePoint eine Nummer an (conflictBehavior „rename").
 */
export async function dateiHochladen(
  driveId: string,
  elternId: string,
  name: string,
  inhalt: Uint8Array,
  mime?: string | null,
): Promise<GraphItem> {
  const sicher = name.replace(/[<>:"/\\|?*]/g, "_").slice(0, 240);
  const token = await graphToken();

  if (inhalt.byteLength <= 4 * 1024 * 1024) {
    const url =
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${elternId}:/` +
      `${encodeURIComponent(sicher)}:/content?@microsoft.graph.conflictBehavior=rename`;
    const r = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": mime || "application/octet-stream",
      },
      body: inhalt,
    });
    if (!r.ok) throw new Error(`Hochladen fehlgeschlagen (${r.status})`);
    return await r.json();
  }

  // Größere Dateien in Blöcken.
  const sitzung = await graphPost<{ uploadUrl?: string }>(
    `/drives/${driveId}/items/${elternId}:/${encodeURIComponent(sicher)}:/createUploadSession`,
    { item: { "@microsoft.graph.conflictBehavior": "rename" } },
  );
  if (!sitzung.uploadUrl) throw new Error(`Hochladen nicht gestartet (${sitzung.status})`);
  const block = 5 * 1024 * 1024;
  for (let pos = 0; pos < inhalt.byteLength; pos += block) {
    const ende = Math.min(pos + block, inhalt.byteLength);
    const r = await fetch(sitzung.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(ende - pos),
        "Content-Range": `bytes ${pos}-${ende - 1}/${inhalt.byteLength}`,
      },
      body: inhalt.subarray(pos, ende),
    });
    if (r.status === 200 || r.status === 201) return await r.json();
    if (r.status !== 202) throw new Error(`Block nicht angenommen (${r.status})`);
  }
  throw new Error("Hochladen unvollständig");
}
