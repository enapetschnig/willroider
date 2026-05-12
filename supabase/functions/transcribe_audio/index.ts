// Edge Function: Whisper-Proxy
// Akzeptiert Audio-Blob (multipart/form-data, Feld "audio"),
// transkribiert via OpenAI Whisper-1, gibt {text} zurück.
// Auth: Supabase-JWT erforderlich.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Auth-Check
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: userResp, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !userResp?.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return json({ error: "Invalid form-data" }, 400);
  }
  const audio = formData.get("audio");
  if (!(audio instanceof File) && !(audio instanceof Blob)) {
    return json({ error: "audio missing or invalid" }, 400);
  }

  const outForm = new FormData();
  // Whisper braucht einen erkennbaren Dateinamen
  const fname =
    audio instanceof File ? audio.name : `recording.webm`;
  outForm.append("file", audio, fname);
  outForm.append("model", "whisper-1");
  outForm.append("language", "de");
  outForm.append("response_format", "json");

  try {
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: outForm,
    });
    if (!r.ok) {
      const errText = await r.text();
      return json({ error: `OpenAI: ${errText.slice(0, 200)}` }, 502);
    }
    const data = await r.json();
    return json({ text: (data.text ?? "").trim() }, 200);
  } catch (e) {
    return json({ error: `Network: ${String(e).slice(0, 200)}` }, 502);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
