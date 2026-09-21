// Push-Nachricht an Personen schicken.
//
//   { an_mich: true, titel?, text? }             → Testnachricht an die eigenen Geräte
//   { user_ids: [...], titel, text, url?, art? } → Verwaltung / Cron (Sync-Geheimnis)
//
// Versand selbst: _shared/push.ts (Push auf jedes Gerät, Protokoll).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.79.0";
import { pushKonfiguriert, sendeAnPerson } from "../_shared/push.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const geheimnis = Deno.env.get("SYNC_SECRET");
  const authKopf = req.headers.get("authorization") ?? "";
  const system =
    (!!geheimnis && req.headers.get("x-sync-secret") === geheimnis) ||
    authKopf.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? " ");

  let userId: string | null = null;
  let admin = false;
  if (!system && authKopf.startsWith("Bearer ")) {
    const alsUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authKopf } }, auth: { persistSession: false } },
    );
    const { data: u } = await alsUser.auth.getUser();
    if (u?.user) {
      userId = u.user.id;
      const { data: a } = await alsUser.rpc("is_admin_role", { _user_id: u.user.id });
      admin = a === true;
    }
  }
  if (!system && !userId) return json({ ok: false, fehler: "Nicht angemeldet" }, 401);
  if (!pushKonfiguriert()) return json({ ok: false, fehler: "Push nicht konfiguriert (VAPID)" }, 500);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Testnachricht an sich selbst — darf jeder.
  if (body.an_mich === true) {
    if (!userId) return json({ ok: false, fehler: "Nur als angemeldete Person" }, 400);
    const r = await sendeAnPerson(sb, userId, {
      titel: (body.titel as string) || "Willroider App",
      text: (body.text as string) || "Benachrichtigungen funktionieren auf diesem Gerät.",
      url: "/",
      art: "test",
    });
    return json({ ok: r.kanal === "push", ...r });
  }

  if (!system && !admin) return json({ ok: false, fehler: "Nicht berechtigt" }, 403);
  const ids = Array.isArray(body.user_ids) ? (body.user_ids as string[]) : [];
  if (ids.length === 0 || !body.titel) return json({ ok: false, fehler: "user_ids und titel fehlen" }, 400);

  const ergebnis: Record<string, unknown> = {};
  for (const id of ids) {
    ergebnis[id] = await sendeAnPerson(sb, id, {
      titel: String(body.titel),
      text: String(body.text ?? ""),
      url: typeof body.url === "string" ? body.url : undefined,
      art: typeof body.art === "string" ? body.art : "manuell",
      bezug: typeof body.bezug === "string" ? body.bezug : null,
    }, { mailErsatz: body.mail_ersatz === true });
  }
  return json({ ok: true, ergebnis });
});
