/**
 * Signierte URL für eine Wunsch-Datei — nur fürs epower-CRM.
 *
 * Bildschirmfotos und Sprachnachrichten liegen in den privaten Buckets
 * `feedback-dateien` und `feedback-audio`. Das CRM hat bewusst KEINE
 * Supabase-Schlüssel dieser App; wenn es eine Datei zeigen will, fragt es
 * hier an — mit demselben Geheimnis, mit dem die App ihre Wünsche schickt
 * (COCKPIT_SECRET).
 *
 * Willroider-Eigenheit: zwei Buckets statt einem. Der Trigger schickt den
 * Bucket deshalb als Präfix im Pfad:
 *
 *   POST { pfad: "feedback-dateien/<uid>/123.jpg" }  →  { url: "<1 h gültig>" }
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cockpit-secret",
};

const ERLAUBTE_BUCKETS = new Set(["feedback-dateien", "feedback-audio"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const erwartet = Deno.env.get("COCKPIT_SECRET");
  if (!erwartet || req.headers.get("x-cockpit-secret") !== erwartet) {
    return new Response(JSON.stringify({ error: "Nicht erlaubt." }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const { pfad } = await req.json();
    // bucket/uid/dateiname — nichts Konstruiertes.
    const m = typeof pfad === "string"
      ? pfad.match(/^([a-z-]+)\/([0-9a-f-]{36}\/[\w.-]+)$/i)
      : null;
    if (!m || !ERLAUBTE_BUCKETS.has(m[1])) {
      throw new Error("Ungültiger Pfad.");
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await supabase.storage
      .from(m[1])
      .createSignedUrl(m[2], 3600);
    if (error || !data?.signedUrl) {
      throw new Error(error?.message || "Signieren fehlgeschlagen.");
    }
    return new Response(JSON.stringify({ url: data.signedUrl }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
