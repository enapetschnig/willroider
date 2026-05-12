// Edge Function: GPT-Analyse einer Unterweisung
// Akzeptiert {text, hint?} JSON, gibt strukturiertes Evaluierungs-Schema zurück.
// Auth: Supabase-JWT + Admin-Rolle erforderlich.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `Du bist ein erfahrener Assistent für Holzbau-Sicherheits­unterweisungen in Österreich.
Analysiere den vom Anwender hochgeladenen Unterweisungstext und antworte AUSSCHLIESSLICH mit einem JSON-Objekt mit folgenden Feldern:
{
  "typ": "werkstatt" | "baustelle" | "fertigteilmontage",
  "titel": kurzer prägnanter Titel der Unterweisung (max 80 Zeichen),
  "checkliste": [
    { "key": kurzer technischer Schlüssel snake_case (z.B. "absturzsicherung"),
      "label": menschenlesbare Beschreibung (Frage oder Aussage, max 120 Zeichen),
      "required": true | false (true wenn essentiell/Pflicht) },
    ... 5 bis 12 Items, decken Hauptpunkte ab
  ],
  "zusammenfassung": klare 2-4 Satz-Zusammenfassung (max 600 Zeichen)
}
Wenn der Typ unklar ist, wähle "baustelle". Keine zusätzlichen Felder, kein Markdown, kein erläuternder Text — nur das JSON.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

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

  // Optional: Admin-Check (KI nur für Admins)
  const { data: isAdmin } = await supabase.rpc("is_admin_role" as any, {
    _user_id: userResp.user.id,
  });
  if (!isAdmin) {
    return json({ error: "Forbidden: admin required" }, 403);
  }

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);

  let body: { text?: string; hint?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const text = (body.text ?? "").trim();
  if (!text) return json({ error: "text empty" }, 400);
  // Cap auf 50 KB (Tokenlimit-Schutz)
  const capped = text.length > 50_000 ? text.slice(0, 50_000) : text;

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `${body.hint ? `Hinweis: ${body.hint}\n\n` : ""}Unterweisungs-Inhalt:\n\n${capped}`,
          },
        ],
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      return json({ error: `OpenAI: ${errText.slice(0, 200)}` }, 502);
    }
    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ error: "AI returned invalid JSON", raw }, 502);
    }
    // Defensive Sanitierung
    const result = {
      typ: ["werkstatt", "baustelle", "fertigteilmontage"].includes(parsed.typ)
        ? parsed.typ
        : "baustelle",
      titel: String(parsed.titel ?? "").slice(0, 200),
      checkliste: Array.isArray(parsed.checkliste)
        ? parsed.checkliste
            .filter((i: any) => i && typeof i === "object")
            .slice(0, 30)
            .map((i: any, idx: number) => ({
              key:
                String(i.key ?? `item_${idx + 1}`)
                  .toLowerCase()
                  .replace(/[^a-z0-9_]+/g, "_")
                  .slice(0, 60) || `item_${idx + 1}`,
              label: String(i.label ?? "").slice(0, 300),
              required: !!i.required,
            }))
            .filter((i: any) => i.label)
        : [],
      zusammenfassung: String(parsed.zusammenfassung ?? "").slice(0, 2000),
    };
    return json(result, 200);
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
