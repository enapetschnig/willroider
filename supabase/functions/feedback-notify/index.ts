// Schickt eine E-Mail-Benachrichtigung, wenn ein neuer Änderungswunsch
// eingeht. Wird vom Frontend direkt nach dem Insert aufgerufen (mit der
// feedback-Id des GERADE angelegten Eintrags). Nur der Ersteller darf für
// seinen eigenen Eintrag benachrichtigen — verhindert Missbrauch/Spam.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.79.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FROM = Deno.env.get("RESEND_FROM") ?? "berichte@willroider.app";
const APP_URL = Deno.env.get("APP_URL") ?? "https://willroider.app";
const FALLBACK_MAIL = "napetschnig.chris@gmail.com";

const KAT_LABEL: Record<string, string> = {
  idee: "Idee / Wunsch",
  problem: "Problem / Fehler",
  lob: "Lob",
  sonstiges: "Sonstiges",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ ok: false, error: "Kein Authorization-Header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const token = auth.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !user) return json({ ok: false, error: "Unauthorized" }, 401);

    const { feedbackId } = (await req.json()) as { feedbackId?: string };
    if (!feedbackId) return json({ ok: false, error: "feedbackId fehlt" }, 400);

    // Eintrag laden (Service-Role) + prüfen, dass er dem Aufrufer gehört.
    const { data: fb, error: fbErr } = await admin
      .from("feedback")
      .select("id, erstellt_von, text, kategorie, seiten_kontext, app_version, audio_pfad, audio_sekunden, created_at")
      .eq("id", feedbackId)
      .maybeSingle();
    if (fbErr || !fb) return json({ ok: false, error: "Eintrag nicht gefunden" }, 404);
    if (fb.erstellt_von !== user.id) return json({ ok: false, error: "Nicht dein Eintrag" }, 403);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return json({ ok: false, error: "RESEND_API_KEY nicht konfiguriert" }, 200);

    // Empfänger aus app_einstellungen (überschreibbar), sonst Fallback.
    const { data: setting } = await admin
      .from("app_einstellungen")
      .select("wert")
      .eq("schluessel", "feedback_notify_mail")
      .maybeSingle();
    const empfaenger = ((setting?.wert as string) || FALLBACK_MAIL).trim();

    // Name des Erstellers
    let name = "Unbekannt";
    if (fb.erstellt_von) {
      const { data: p } = await admin
        .from("profiles")
        .select("vorname, nachname")
        .eq("id", fb.erstellt_von)
        .maybeSingle();
      if (p) name = `${p.vorname ?? ""} ${p.nachname ?? ""}`.trim() || name;
    }

    const kat = KAT_LABEL[fb.kategorie] ?? fb.kategorie;
    const hatAudio = !!fb.audio_pfad;
    const audioHinweis = hatAudio
      ? `🎤 Sprachnachricht${fb.audio_sekunden ? ` (${fb.audio_sekunden}s)` : ""} — in der App anhören`
      : "";
    const inhalt = fb.text ? esc(fb.text) : audioHinweis || "(kein Text)";
    const link = `${APP_URL}/admin?tab=feedback`;

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:0 auto">
        <h2 style="margin:0 0 4px">Neuer Änderungswunsch</h2>
        <p style="color:#666;margin:0 0 16px">Kategorie: <strong>${esc(kat)}</strong></p>
        <div style="background:#f6f6f7;border-radius:8px;padding:14px 16px;margin-bottom:16px">
          <div style="white-space:pre-wrap;line-height:1.5">${inhalt}</div>
          ${hatAudio && fb.text ? `<div style="margin-top:10px;color:#555">${audioHinweis}</div>` : ""}
        </div>
        <p style="color:#666;font-size:13px;margin:0 0 4px">Von: <strong>${esc(name)}</strong></p>
        ${fb.seiten_kontext ? `<p style="color:#666;font-size:13px;margin:0 0 4px">Seite: ${esc(fb.seiten_kontext)}</p>` : ""}
        ${fb.app_version ? `<p style="color:#666;font-size:13px;margin:0 0 16px">Version: ${esc(fb.app_version)}</p>` : ""}
        <a href="${link}" style="display:inline-block;background:#B0353C;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px">In der App öffnen</a>
      </div>`;

    const textBody = `Neuer Änderungswunsch (${kat})\n\n${fb.text ?? (audioHinweis || "(kein Text)")}\n\nVon: ${name}\n${fb.seiten_kontext ? `Seite: ${fb.seiten_kontext}\n` : ""}\nÖffnen: ${link}`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [empfaenger],
        subject: `Neuer Änderungswunsch – ${kat}${hatAudio ? " 🎤" : ""}`,
        text: textBody,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return json({ ok: false, error: `Resend: ${err}` }, 200);
    }
    return json({ ok: true, empfaenger });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 200);
  }
});
