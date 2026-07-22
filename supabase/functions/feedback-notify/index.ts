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

const DRINGLICHKEIT: Record<string, { label: string; farbe: string }> = {
  sofort: { label: "🔴 Dringend — blockiert mich", farbe: "#dc2626" },
  normal: { label: "🟡 Normal", farbe: "#b45309" },
  besprechen: { label: "💬 Zuerst besprechen", farbe: "#7c3aed" },
  irgendwann: { label: "💡 Nur eine Idee", farbe: "#64748b" },
};

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
      .select("id, erstellt_von, text, kategorie, seiten_kontext, app_version, audio_pfad, audio_sekunden, anhang_pfad, anhang_name, anhang_typ, dringlichkeit, created_at")
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

    // Anhang (Foto/Screenshot/Datei): signierte URL (7 Tage) — Bilder werden
    // direkt in der Mail angezeigt, andere Dateien als Download-Link.
    let anhangUrl: string | null = null;
    if (fb.anhang_pfad) {
      const { data: signed } = await admin.storage
        .from("feedback-dateien")
        .createSignedUrl(fb.anhang_pfad, 7 * 24 * 3600);
      anhangUrl = signed?.signedUrl ?? null;
    }
    const istBild = !!fb.anhang_typ?.startsWith("image/");
    const anhangHtml = anhangUrl
      ? istBild
        ? `<div style="margin:0 0 16px"><img src="${anhangUrl}" alt="${esc(fb.anhang_name ?? "Anhang")}" style="max-width:100%;border-radius:8px;border:1px solid #ddd" /><div style="font-size:12px;color:#666;margin-top:4px"><a href="${anhangUrl}">${esc(fb.anhang_name ?? "Bild in voller Größe öffnen")}</a></div></div>`
        : `<p style="margin:0 0 16px">📎 <a href="${anhangUrl}">${esc(fb.anhang_name ?? "Anhang öffnen")}</a></p>`
      : "";

    // Dringlichkeit — Einschätzung des Melders, prominent im Kopf der Mail.
    const dr = DRINGLICHKEIT[fb.dringlichkeit ?? "normal"] ?? DRINGLICHKEIT.normal;

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:0 auto">
        <h2 style="margin:0 0 4px">Neuer Änderungswunsch</h2>
        <p style="margin:0 0 12px">
          <span style="display:inline-block;border:1px solid ${dr.farbe};color:${dr.farbe};border-radius:999px;padding:3px 10px;font-size:13px;font-weight:600">${dr.label}</span>
        </p>
        <p style="color:#666;margin:0 0 16px">Kategorie: <strong>${esc(kat)}</strong></p>
        <div style="background:#f6f6f7;border-radius:8px;padding:14px 16px;margin-bottom:16px">
          <div style="white-space:pre-wrap;line-height:1.5">${inhalt}</div>
          ${hatAudio && fb.text ? `<div style="margin-top:10px;color:#555">${audioHinweis}</div>` : ""}
        </div>
        ${anhangHtml}
        <p style="color:#666;font-size:13px;margin:0 0 4px">Von: <strong>${esc(name)}</strong></p>
        ${fb.seiten_kontext ? `<p style="color:#666;font-size:13px;margin:0 0 4px">Seite: ${esc(fb.seiten_kontext)}</p>` : ""}
        ${fb.app_version ? `<p style="color:#666;font-size:13px;margin:0 0 16px">Version: ${esc(fb.app_version)}</p>` : ""}
        <a href="${link}" style="display:inline-block;background:#B0353C;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px">In der App öffnen</a>
      </div>`;

    const textBody = `Neuer Änderungswunsch (${kat}) — ${dr.label}\n\n${fb.text ?? (audioHinweis || "(kein Text)")}\n${anhangUrl ? `\n📎 Anhang: ${fb.anhang_name ?? "Datei"} — ${anhangUrl}\n` : ""}\nVon: ${name}\n${fb.seiten_kontext ? `Seite: ${fb.seiten_kontext}\n` : ""}\nÖffnen: ${link}`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [empfaenger],
        subject: `${fb.dringlichkeit === "sofort" ? "DRINGEND: " : ""}Änderungswunsch – ${kat}${hatAudio ? " 🎤" : ""}${anhangUrl ? " 📎" : ""}`,
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
