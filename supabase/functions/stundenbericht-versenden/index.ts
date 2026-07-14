// Versendet einen oder mehrere Baustellenstundenberichte per Mail an
// das Büro (eine Mail mit mehreren PDF-Anhängen). Setzt anschließend
// pro Bericht den Status auf `versendet` via RPC.
//
// Aufruf vom Frontend mit Bearer-Token des angemeldeten Admin-Users.
// PDF-Generierung passiert im Browser (jsPDF), die Function bekommt die
// Bytes als base64 — Deno müsste sonst eine eigene PDF-Lib hosten.

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
  berichtIds: string[];
  /** Base64-DataURL einer Büro-Unterschrift; falls gesetzt, wird sie
   *  pro Bericht in der RPC stunden_bericht_versenden mitgespeichert. */
  bueroSignature?: string | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

const FROM = Deno.env.get("RESEND_FROM") ?? "berichte@willroider.app";
const REPLY_TO = Deno.env.get("RESEND_REPLY_TO") ?? "maurer@willroider.at";

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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);
    // User-scoped Client: die RPC stunden_bericht_versenden prüft intern
    // is_admin_role(auth.uid()) — mit dem Service-Role-Client wäre
    // auth.uid() NULL und die RPC wirft IMMER 'nicht berechtigt'.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });

    const token = auth.replace("Bearer ", "");
    const {
      data: { user },
      error: userErr,
    } = await admin.auth.getUser(token);
    if (userErr || !user) {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    }
    const { data: isAdmin } = await admin.rpc("is_admin_role", {
      _user_id: user.id,
    });
    if (!isAdmin) {
      return jsonResponse({ ok: false, error: "Forbidden: Admin only" }, 403);
    }

    const body = (await req.json()) as VersendenRequest;
    if (!body?.empfaenger || !body.attachments?.length || !body.berichtIds?.length) {
      return jsonResponse({ ok: false, error: "Felder fehlen" }, 400);
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return jsonResponse(
        { ok: false, error: "RESEND_API_KEY nicht konfiguriert" },
        500,
      );
    }

    // Vorab-Validierung ALLER Berichte, BEVOR die Mail rausgeht — sonst ist
    // bei einem Status-Konflikt die Mail schon versendet, der Status aber
    // nicht gesetzt, und ein Retry erzeugt eine Doppel-Mail beim Büro.
    const { data: berichteRows, error: berichteErr } = await admin
      .from("stunden_berichte")
      .select("id, status")
      .in("id", body.berichtIds);
    if (berichteErr) {
      return jsonResponse(
        { ok: false, error: `Berichte-Check fehlgeschlagen: ${berichteErr.message}` },
        500,
      );
    }
    const rowById = new Map((berichteRows ?? []).map((r) => [r.id, r]));
    const vorabFehler: { id: string; err: string }[] = [];
    for (const id of body.berichtIds) {
      const row = rowById.get(id);
      if (!row) vorabFehler.push({ id, err: "Bericht nicht gefunden" });
      else if (row.status === "offen")
        vorabFehler.push({
          id,
          err: "Bericht ist noch offen — der Mitarbeiter muss zuerst unterschreiben",
        });
      else if (row.status === "versendet")
        // Schon versendet (z.B. Teil-Erfolg eines früheren Laufs) → NICHT
        // erneut mitschicken, sonst bekommt das Büro eine Doppel-Mail.
        vorabFehler.push({
          id,
          err: "Bericht wurde bereits versendet",
        });
    }
    if (vorabFehler.length > 0) {
      return jsonResponse({
        ok: false,
        error: `${vorabFehler.length} Bericht(e) nicht versendbar: ${vorabFehler[0].err}`,
        fehler: vorabFehler,
      });
    }

    // Resend-Payload
    const payload: Record<string, unknown> = {
      from: FROM,
      reply_to: [REPLY_TO],
      to: [body.empfaenger.trim()],
      subject: body.betreff,
      text: body.text,
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

    // Status pro Bericht auf 'versendet' setzen — mit dem USER-Client,
    // damit auth.uid() in der RPC den echten Admin liefert.
    const versendet: string[] = [];
    const fehler: { id: string; err: string }[] = [];
    for (const id of body.berichtIds) {
      const { error } = await userClient.rpc("stunden_bericht_versenden" as any, {
        p_id: id,
        p_mail: body.empfaenger.trim(),
        p_unterschrift: body.bueroSignature ?? null,
      });
      if (error) fehler.push({ id, err: error.message });
      else versendet.push(id);
    }

    return jsonResponse({
      ok: true,
      sentTo: body.empfaenger,
      count: versendet.length,
      resendId: resendJson?.id,
      versendet,
      fehler,
    });
  } catch (e) {
    return jsonResponse(
      { ok: false, error: (e as Error).message ?? "Unbekannter Fehler" },
      500,
    );
  }
});
