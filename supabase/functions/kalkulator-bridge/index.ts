// Bridge zwischen dem Bausatz-Kalkulator (HTML/JS, /kalkulator) und der
// App-Datenbank. Drei Endpunkte:
//
//   GET  /?action=k3                       -> alle K3-Sätze als Array
//   POST /  body={action:'k3', gruppe, ...} -> Satz pro Gruppe upserten
//   POST /  body={action:'anfrage', ...}    -> Kundenanfrage speichern +
//                                              Bestätigungs-Mail ans Büro
//
// CORS offen — die HTML-Datei lädt im Browser ohne Bearer-Token. Schreib-
// Schutz für K3-Sätze: nur authentifizierte User mit role IN
// (geschaeftsfuehrung, buero). Insert auf Anfragen ist absichtlich offen,
// damit das Tool auch von extern (Kunden) funktioniert.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.79.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "berichte@willroider.app";
const RESEND_REPLY_TO =
  Deno.env.get("RESEND_REPLY_TO") ?? "maurer@willroider.at";
const KALK_MAIL_TO =
  Deno.env.get("KALKULATOR_MAIL_TO") ?? "maurer@willroider.at";

// Sehr einfacher In-Memory-Rate-Limit (pro IP) für action=anfrage. Soll
// verhindern, dass jemand das Büro-Postfach via offenem POST-Endpoint
// flutet. 5 Anfragen pro 10 Minuten pro IP. Beim Cold-Start der Function
// resettet sich das — das ist OK, der Schutz greift nur in den Bursts.
const RL_WINDOW_MS = 10 * 60 * 1000;
const RL_LIMIT = 5;
const rateBuckets = new Map<string, number[]>();
function rateLimitOk(ip: string): boolean {
  const now = Date.now();
  const arr = (rateBuckets.get(ip) ?? []).filter((t) => now - t < RL_WINDOW_MS);
  if (arr.length >= RL_LIMIT) {
    rateBuckets.set(ip, arr);
    return false;
  }
  arr.push(now);
  rateBuckets.set(ip, arr);
  return true;
}

async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ ok: boolean; err?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { ok: false, err: "RESEND_API_KEY nicht konfiguriert" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      reply_to: [RESEND_REPLY_TO],
      to: [opts.to],
      subject: opts.subject,
      text: opts.text,
    }),
  });
  if (!res.ok) return { ok: false, err: await res.text() };
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // ── GET: K3-Sätze auslesen ────────────────────────────────────────────
  if (req.method === "GET") {
    const { data, error } = await admin
      .from("kalkulator_k3_saetze")
      .select("*");
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, saetze: data });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body kein JSON" }, 400);
  }

  // ── POST action=k3: Sätze speichern (nur authentifizierte GF/Büro) ──
  if (body?.action === "k3") {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return json({ ok: false, error: "Auth fehlt" }, 401);
    }
    const token = auth.replace("Bearer ", "");
    const {
      data: { user },
      error: userErr,
    } = await admin.auth.getUser(token);
    if (userErr || !user) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }
    const { data: rolle } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (
      !rolle ||
      !["geschaeftsfuehrung", "buero"].includes((rolle as any).role)
    ) {
      return json({ ok: false, error: "Nur Geschäftsführung/Büro" }, 403);
    }

    const erlaubt = ["dach", "decken", "waende", "regie", "clt"];
    if (!erlaubt.includes(body.gruppe)) {
      return json({ ok: false, error: "Ungültige Gruppe" }, 400);
    }
    const { error } = await admin
      .from("kalkulator_k3_saetze")
      .update({
        grundlohn: Number(body.grundlohn),
        lnk: Number(body.lnk),
        unprod: Number(body.unprod),
        ggk: Number(body.ggk),
        bauzinsen: Number(body.bauzinsen),
        wagnis: Number(body.wagnis),
        gewinn: Number(body.gewinn),
      })
      .eq("gruppe", body.gruppe);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  // ── POST action=anfrage: Kundenanfrage SPEICHERN (neu oder update). ─
  // KEIN Mail-Versand mehr — Anfragen sind Entwürfe, das Büro öffnet sie
  // bei Bedarf und kann sie weiter bearbeiten.
  if (body?.action === "anfrage" || body?.typ === "Anfrage") {
    // Rate-Limit pro IP (siehe Top-of-File)
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("cf-connecting-ip") ??
      "unknown";
    if (!rateLimitOk(ip)) {
      return json(
        {
          ok: false,
          error:
            "Zu viele Speicherversuche in kurzer Zeit. Bitte später erneut versuchen.",
        },
        429,
      );
    }
    const a = body;
    const kundeName: string =
      a.kunde_name ?? a.name ?? "Unbekannter Kunde";
    if (!kundeName || kundeName.trim().length < 2) {
      return json({ ok: false, error: "Kunde-Name fehlt" }, 400);
    }
    if (
      (!a.positionen_anzahl || a.positionen_anzahl === 0) &&
      (!a.eigene_anzahl || a.eigene_anzahl === 0)
    ) {
      return json(
        { ok: false, error: "Anfrage enthält keine Positionen" },
        400,
      );
    }
    const summe =
      typeof a.summe_netto === "number"
        ? a.summe_netto
        : Number(String(a.summe ?? "").replace(/[^\d,.-]/g, "").replace(",", ".")) ||
          null;

    const payload = {
      kunde_name: kundeName,
      kunde_rolle: a.rolle ?? a.kunde_rolle ?? null,
      kunde_code: a.code ?? a.kunde_code ?? null,
      summe_netto: summe,
      positionen_anzahl: a.positionen ?? a.positionen_anzahl ?? null,
      eigene_anzahl: a.eigene ?? a.eigene_anzahl ?? null,
      bedarf_text: a.bedarf ?? a.bedarf_text ?? null,
      raw_anfrage: a,
    };

    // Wenn anfrageId mitgegeben → Update. Sonst Insert mit Default-Status.
    if (a.anfrageId && typeof a.anfrageId === "string") {
      const { error } = await admin
        .from("kalkulator_anfragen")
        .update(payload)
        .eq("id", a.anfrageId);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, anfrageId: a.anfrageId, updated: true });
    }
    const { data: row, error } = await admin
      .from("kalkulator_anfragen")
      .insert({ ...payload, status: "eingegangen" })
      .select("id")
      .single();
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, anfrageId: (row as any).id, updated: false });
  }

  // ── POST action=login (Audit): kleines Tracking, nicht in DB ────────
  if (body?.action === "login" || body?.typ === "Login") {
    return json({ ok: true });
  }

  return json({ ok: false, error: "Unbekannte action" }, 400);
});
