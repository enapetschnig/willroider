// Eine gespiegelte SharePoint-Datei zum Ansehen holen.
//
// Die App speichert nur die Angaben zur Datei, nicht den Inhalt. Wer eine
// Datei öffnet, bekommt hier eine kurzlebige Download-Adresse von
// Microsoft (gültig etwa eine Stunde, nur für diese eine Datei).
//
// Geprüft wird mit dem Zugang des Angemeldeten: Die Zeile wird über den
// Benutzer-Token gelesen, damit dieselben Ordnerrechte greifen wie bei den
// eigenen Dokumenten (darf_ordner_sehen). Wer die Datei nicht sehen darf,
// bekommt sie auch hier nicht.
//
// Gelesen wird ausschließlich. In SharePoint verändert diese Funktion nichts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.79.0";
import { downloadUrl, graphKonfiguriert, pdfAnsichtUrl } from "../_shared/graph.ts";

/** Dateiarten, die sich nur als PDF ansehen lassen. */
const OFFICE = /\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf)$/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ ok: false, fehler: "Nicht angemeldet" }, 401);
  if (!graphKonfiguriert()) return json({ ok: false, fehler: "Graph-Zugangsdaten fehlen" }, 500);

  const { datei_id } = await req.json().catch(() => ({ datei_id: null }));
  if (!datei_id) return json({ ok: false, fehler: "datei_id fehlt" }, 400);

  // Bewusst mit dem Token des Anwenders: Die Ordnerrechte der Datenbank
  // entscheiden, ob die Zeile überhaupt sichtbar ist.
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } },
  );

  const { data, error } = await sb
    .from("sharepoint_dateien")
    .select("drive_id, item_id, dateiname, mimetype, groesse")
    .eq("id", datei_id)
    .maybeSingle();

  if (error) return json({ ok: false, fehler: error.message }, 500);
  if (!data) return json({ ok: false, fehler: "Datei nicht gefunden oder nicht freigegeben" }, 404);

  const original = await downloadUrl(data.drive_id as string, data.item_id as string);
  if (!original) return json({ ok: false, fehler: "Datei liegt nicht mehr in SharePoint" }, 404);

  // Word und Excel kann der Browser nicht anzeigen — dafür rechnet
  // Microsoft die Datei in ein PDF um. Das Original bleibt unberührt,
  // es entsteht nur eine Ansicht.
  let ansicht = original;
  let alsPdf = false;
  if (OFFICE.test(String(data.dateiname))) {
    const pdf = await pdfAnsichtUrl(data.drive_id as string, data.item_id as string);
    if (pdf) {
      ansicht = pdf;
      alsPdf = true;
    }
  }

  return json({
    ok: true,
    url: ansicht,
    download_url: original,
    als_pdf: alsPdf,
    dateiname: data.dateiname,
    mimetype: alsPdf ? "application/pdf" : data.mimetype,
    groesse: data.groesse,
  });
});
