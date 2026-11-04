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
  /** Krankenzettel der Berichts-Perioden mitschicken (J. Maurer, 04.11.2026). */
  mit_krankmeldungen?: boolean;
}

/** Resend nimmt bis 40 MB je Mail — darunter bleiben, sonst Links (wie archiv-versenden). */
const MAX_ANHANG_BYTES = 25 * 1024 * 1024;

function b64(bytes: Uint8Array): string {
  let s = "";
  const block = 0x8000;
  for (let i = 0; i < bytes.length; i += block) {
    s += String.fromCharCode(...bytes.subarray(i, i + block));
  }
  return btoa(s);
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
      .select("id, status, mitarbeiter_id, von_datum, bis_datum")
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

    // Krankenzettel der Perioden aus dem Speicher ma_dokumente.
    const anhaenge = body.attachments.map((a) => ({
      filename: a.filename,
      content: a.contentBase64,
    }));
    let anhangBytes = anhaenge.reduce((s, a) => s + Math.floor((a.content.length * 3) / 4), 0);
    let mailText = body.text;
    let krankmeldungen = 0;
    if (body.mit_krankmeldungen) {
      const gesehen = new Set<string>();
      const links: string[] = [];
      for (const b of berichteRows ?? []) {
        const { data: km, error: kmErr } = await admin
          .from("krankmeldungen")
          .select("von, bis, dokument_id, dokumente:dokument_id(storage_path, dateiname), profiles:mitarbeiter_id(vorname, nachname)")
          .eq("mitarbeiter_id", b.mitarbeiter_id)
          .lte("von", b.bis_datum)
          .gte("bis", b.von_datum)
          .not("dokument_id", "is", null);
        if (kmErr) {
          return jsonResponse({ ok: false, error: `Krankenzettel nicht lesbar: ${kmErr.message}` }, 500);
        }
        for (const k of (km ?? []) as any[]) {
          if (!k.dokumente?.storage_path || gesehen.has(k.dokument_id)) continue;
          gesehen.add(k.dokument_id);
          const ext = String(k.dokumente.dateiname ?? k.dokumente.storage_path).split(".").pop()?.toLowerCase() ?? "pdf";
          const wer = `${k.profiles?.vorname ?? ""} ${k.profiles?.nachname ?? ""}`.trim();
          const zeit = k.von === k.bis ? k.von : `${k.von} bis ${k.bis}`;
          const name = `Krankmeldung ${wer} ${zeit}.${ext}`.replace(/[\\/:*?"<>|]/g, "-");
          const { data: datei } = await admin.storage.from("ma_dokumente").download(k.dokumente.storage_path);
          if (!datei) {
            return jsonResponse({ ok: false, error: `Krankenzettel fehlt: ${name}` }, 500);
          }
          const bytes = new Uint8Array(await datei.arrayBuffer());
          krankmeldungen++;
          if (anhangBytes + bytes.length > MAX_ANHANG_BYTES) {
            const { data: s } = await admin.storage
              .from("ma_dokumente")
              .createSignedUrl(k.dokumente.storage_path, 7 * 86400, { download: name });
            if (s?.signedUrl) links.push(`${name}: ${s.signedUrl}`);
          } else {
            anhangBytes += bytes.length;
            anhaenge.push({ filename: name, content: b64(bytes) });
          }
        }
      }
      if (links.length > 0) {
        mailText = `${mailText}\n\nZu groß für den Anhang — Download-Links (7 Tage gültig):\n\n${links.join("\n")}`;
      }
    }

    // Resend-Payload
    const payload: Record<string, unknown> = {
      from: FROM,
      reply_to: [REPLY_TO],
      to: [body.empfaenger.trim()],
      subject: body.betreff,
      text: mailText,
      attachments: anhaenge,
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
      krankmeldungen,
    });
  } catch (e) {
    return jsonResponse(
      { ok: false, error: (e as Error).message ?? "Unbekannter Fehler" },
      500,
    );
  }
});
