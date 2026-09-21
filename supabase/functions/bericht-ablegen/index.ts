// Fertige Berichte (Tätigkeitsbericht nach Freigabe, Stundenbericht nach
// Bestätigung) als Kopie nach SharePoint legen. Das PDF liegt vorher schon
// im Bucket „berichte-archiv" (Zeile in bericht_archiv); hier kommt nur
// noch die Kopie in den SharePoint-Ordner dazu — nie überschreiben, nie
// löschen (conflictBehavior rename).
//
// Ziel je Art aus app_settings.bericht_ablage:
//   { "taetigkeitsbericht": { "drive_id", "wurzel_item_id", "unterordner": "{jahr}" },
//     "stundenbericht":     { "drive_id", "wurzel_item_id", "unterordner": "Stundenlisten {jahr}" } }
// Der Jahres-Unterordner wird angelegt, wenn er fehlt (Wunsch J. Maurer: „immer jährlich").
//
// Aufrufe:
//   { modus: "ablegen", archiv_id }   → eine Zeile (vom Frontend direkt nach dem Speichern)
//   { modus: "nachholen" }            → Cron: alles, was noch keine SharePoint-Kopie hat
//   { modus: "suche", name }          → Verwaltung: SharePoint-Site samt Laufwerk/Wurzel finden

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.79.0";
import { dateiHochladen, graphGet, graphKonfiguriert, kinder, kindMitNamen, ordnerAnlegen } from "../_shared/graph.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sync-secret, x-supabase-api-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });

type Ziel = { drive_id: string; wurzel_item_id: string; unterordner?: string };
type ArchivZeile = {
  id: string;
  art: "taetigkeitsbericht" | "stundenbericht";
  jahr: number;
  storage_pfad: string;
  dateiname: string;
  sharepoint_item_id: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const geheimnis = Deno.env.get("SYNC_SECRET");
  const authKopf = req.headers.get("authorization") ?? "";
  let erlaubt =
    (!!geheimnis && req.headers.get("x-sync-secret") === geheimnis) ||
    authKopf.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? " ");
  let userId: string | null = null;
  if (!erlaubt && authKopf.startsWith("Bearer ")) {
    const alsUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authKopf } }, auth: { persistSession: false },
    });
    const { data: u } = await alsUser.auth.getUser();
    if (u?.user) {
      userId = u.user.id;
      const { data: admin } = await alsUser.rpc("is_admin_role", { _user_id: u.user.id });
      const { data: frei } = await alsUser.rpc("has_permission", { _user_id: u.user.id, _schluessel: "stunden.taetigkeitsbericht.freigeben" });
      const { data: bsb } = await alsUser.rpc("has_permission", { _user_id: u.user.id, _schluessel: "stunden.bsb.bestaetigen" });
      erlaubt = admin === true || frei === true || bsb === true;
    }
  }
  if (!erlaubt) return json({ ok: false, fehler: "Nicht berechtigt" }, 401);
  if (!graphKonfiguriert()) return json({ ok: false, fehler: "Graph-Zugangsdaten fehlen" }, 500);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const modus = (body.modus as string) ?? "ablegen";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // ── Site finden (einmalig für die Einrichtung) ─────────────────────────
  if (modus === "suche") {
    const name = String(body.name ?? "");
    const r = await graphGet<{ value?: Array<{ id: string; displayName: string; webUrl: string }> }>(
      `/sites?search=${encodeURIComponent(name)}`,
    );
    const sites = [];
    for (const s of r.value ?? []) {
      const d = await graphGet<{ value?: Array<{ id: string; name: string; webUrl: string }> }>(`/sites/${s.id}/drives`);
      const drives = [];
      for (const dr of d.value ?? []) {
        const root = await kinder(dr.id, "root").catch(() => []);
        drives.push({ id: dr.id, name: dr.name, webUrl: dr.webUrl, wurzel: root.map((k) => ({ id: k.id, name: k.name, ordner: !!k.folder })) });
      }
      sites.push({ id: s.id, name: s.displayName, webUrl: s.webUrl, drives });
    }
    return json({ ok: true, sites });
  }

  const { data: konf } = await sb.from("app_settings").select("value").eq("key", "bericht_ablage").maybeSingle();
  const ziele = (konf?.value ?? {}) as Record<string, Ziel>;

  const ablegen = async (z: ArchivZeile): Promise<{ ok: boolean; fehler?: string }> => {
    const ziel = ziele[z.art];
    if (!ziel?.drive_id || !ziel?.wurzel_item_id) return { ok: false, fehler: `Kein SharePoint-Ziel für ${z.art}` };
    // Datei aus dem Bucket holen
    const { data: datei, error: dErr } = await sb.storage.from("berichte-archiv").download(z.storage_pfad);
    if (dErr || !datei) return { ok: false, fehler: `Datei fehlt: ${dErr?.message ?? z.storage_pfad}` };
    const bytes = new Uint8Array(await datei.arrayBuffer());
    // Jahres-Unterordner (anlegen, wenn er fehlt)
    let elternId = ziel.wurzel_item_id;
    const unterName = (ziel.unterordner ?? "{jahr}").replace("{jahr}", String(z.jahr)).trim();
    if (unterName) {
      const vorhanden = await kindMitNamen(ziel.drive_id, elternId, unterName);
      if (vorhanden?.folder) elternId = vorhanden.id;
      else if (!vorhanden) {
        const neu = await ordnerAnlegen(ziel.drive_id, elternId, unterName);
        elternId = neu.id;
        // Frisch angelegter Ordner: SharePoint braucht einen Moment, sonst
        // antwortet der erste Upload mit 400 (so beim ersten Test gesehen).
        await new Promise((r) => setTimeout(r, 2500));
      } else return { ok: false, fehler: `„${unterName}" ist in SharePoint eine Datei, kein Ordner` };
    }
    try {
      const item = await dateiHochladen(ziel.drive_id, elternId, z.dateiname, bytes, "application/pdf");
      await sb
        .from("bericht_archiv")
        .update({ sharepoint_item_id: item.id, sharepoint_web_url: item.webUrl ?? null, sharepoint_fehler: null, sharepoint_am: new Date().toISOString() })
        .eq("id", z.id);
      return { ok: true };
    } catch (e) {
      const fehler = (e as Error).message;
      await sb.from("bericht_archiv").update({ sharepoint_fehler: fehler.slice(0, 300) }).eq("id", z.id);
      return { ok: false, fehler };
    }
  };

  if (modus === "ablegen") {
    const id = String(body.archiv_id ?? "");
    const { data: z } = await sb.from("bericht_archiv").select("id, art, jahr, storage_pfad, dateiname, sharepoint_item_id").eq("id", id).maybeSingle();
    if (!z) return json({ ok: false, fehler: "Archiv-Eintrag nicht gefunden" }, 404);
    if ((z as ArchivZeile).sharepoint_item_id) return json({ ok: true, schon: true });
    return json(await ablegen(z as ArchivZeile));
  }

  if (modus === "nachholen") {
    const { data: offen } = await sb
      .from("bericht_archiv")
      .select("id, art, jahr, storage_pfad, dateiname, sharepoint_item_id")
      .is("sharepoint_item_id", null)
      .order("erstellt_am")
      .limit(25);
    const ergebnis: Record<string, string> = {};
    for (const z of (offen ?? []) as ArchivZeile[]) {
      const r = await ablegen(z);
      ergebnis[z.dateiname] = r.ok ? "abgelegt" : (r.fehler ?? "Fehler");
    }
    return json({ ok: true, anzahl: (offen ?? []).length, ergebnis, aufrufer: userId });
  }

  return json({ ok: false, fehler: `Unbekannter Modus ${modus}` }, 400);
});
