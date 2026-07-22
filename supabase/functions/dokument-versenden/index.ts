// Versendet beliebige Dateien (PDF, DOCX, XLSX, Bilder, ZIP, …) per Mail
// an einen frei wählbaren Empfänger. Anhänge kommen base64-kodiert
// rein (Frontend lädt sie aus Supabase Storage und kodiert sie clientseitig).
//
// Aufruf vom Frontend mit Bearer-Token irgendeines angemeldeten Users —
// jede Rolle darf eigene Dokumente versenden (RLS schützt schon vorher
// die Storage-Reads).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.79.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface VersendenRequest {
  empfaenger: string;
  cc?: string;
  betreff: string;
  text: string;
  html?: string;
  attachments: { filename: string; contentBase64: string }[];
  /** IDs der versendeten Dokumente — für den Versand-Nachweis. Optional,
   *  damit ältere Aufrufer weiter funktionieren. */
  dokumentIds?: string[];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

const FROM = Deno.env.get("RESEND_FROM") ?? "dokumente@willroider.app";
const REPLY_TO = Deno.env.get("RESEND_REPLY_TO") ?? "hallo@willroider.at";

// E-Mail-RegEx einfach gehalten, Resend validiert nochmal richtig.
const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return jsonResponse({ ok: false, error: "Kein Authorization-Header" }, 401);
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const token = auth.replace("Bearer ", "");
    const {
      data: { user },
      error: userErr,
    } = await admin.auth.getUser(token);
    if (userErr || !user) {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    }

    // Rollen-Check: ohne den war die Function ein offenes Mail-Relay über
    // die Firmendomain — jeder authentifizierte User konnte beliebige
    // Anhänge an beliebige Adressen schicken.
    const { data: isAdmin } = await admin.rpc("is_admin_role", {
      _user_id: user.id,
    });
    if (!isAdmin) {
      return jsonResponse({ ok: false, error: "Forbidden: Admin only" }, 403);
    }

    const body = (await req.json()) as VersendenRequest;
    if (!body?.empfaenger || !body.attachments?.length) {
      return jsonResponse({ ok: false, error: "Felder fehlen" }, 400);
    }
    const empfaenger = body.empfaenger.trim();
    if (!MAIL_RE.test(empfaenger)) {
      return jsonResponse(
        { ok: false, error: `Ungültige Empfänger-Adresse: ${empfaenger}` },
        400,
      );
    }
    if (body.cc && body.cc.trim() && !MAIL_RE.test(body.cc.trim())) {
      return jsonResponse(
        { ok: false, error: `Ungültige CC-Adresse: ${body.cc}` },
        400,
      );
    }

    // Anhang-Größen prüfen (Resend-Limit ~40 MB pro Mail)
    const totalBytes = body.attachments.reduce(
      (sum, a) => sum + Math.floor((a.contentBase64?.length ?? 0) * 0.75),
      0,
    );
    if (totalBytes > 35 * 1024 * 1024) {
      return jsonResponse(
        {
          ok: false,
          error: `Anhänge zu groß (${(totalBytes / 1024 / 1024).toFixed(1)} MB) — max. 35 MB pro Mail.`,
        },
        400,
      );
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return jsonResponse(
        { ok: false, error: "RESEND_API_KEY nicht konfiguriert" },
        500,
      );
    }

    // Wer schickt? Echten Namen aus profiles holen für Reply-To-Display
    const { data: profile } = await admin
      .from("profiles")
      .select("vorname, nachname, email")
      .eq("id", user.id)
      .maybeSingle();
    const senderName =
      profile?.vorname || profile?.nachname
        ? `${profile?.vorname ?? ""} ${profile?.nachname ?? ""}`.trim()
        : (user.email ?? "Holzbau Willroider");
    const senderMail = profile?.email ?? user.email ?? REPLY_TO;

    const payload: Record<string, unknown> = {
      from: `Holzbau Willroider <${FROM}>`,
      reply_to: [senderMail],
      to: [empfaenger],
      subject: body.betreff,
      text:
        body.text +
        `\n\n—\nVersendet von ${senderName} über die Holzbau-Willroider-App`,
      attachments: body.attachments.map((a) => ({
        filename: a.filename,
        content: a.contentBase64,
      })),
    };
    if (body.cc && body.cc.trim()) payload.cc = [body.cc.trim()];
    if (body.html) payload.html = body.html;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!resendRes.ok) {
      const errText = await resendRes.text();
      return jsonResponse(
        { ok: false, error: `Resend-Fehler: ${errText}` },
        500,
      );
    }
    const resendJson = await resendRes.json();

    // Versand-Nachweis schreiben — ERST nach erfolgreichem Mailversand,
    // damit nie ein "versendet" ohne tatsächliche Mail entsteht. Ein Fehler
    // hier darf den Versand nicht als gescheitert melden (die Mail IST raus).
    let protokolliert = 0;
    if (body.dokumentIds?.length) {
      try {
        const { error: logErr, count } = await admin
          .from("dokument_versand")
          .insert(
            body.dokumentIds.map((id) => ({
              dokument_id: id,
              empfaenger,
              betreff: body.betreff,
              versendet_von: user?.id ?? null,
            })),
            { count: "exact" },
          );
        if (logErr) console.error("Versand-Protokoll:", logErr.message);
        else protokolliert = count ?? body.dokumentIds.length;
      } catch (e) {
        console.error("Versand-Protokoll:", (e as Error).message);
      }
    }

    return jsonResponse({
      ok: true,
      sentTo: empfaenger,
      count: body.attachments.length,
      resendId: resendJson?.id,
      protokolliert,
    });
  } catch (e) {
    return jsonResponse(
      { ok: false, error: (e as Error).message ?? "Unbekannter Fehler" },
      500,
    );
  }
});
