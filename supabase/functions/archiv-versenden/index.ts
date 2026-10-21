// Berichte aus dem Archiv gesammelt per Mail verschicken — EINE Mail mit
// allen gewählten PDFs im Anhang (Wunsch J. Maurer: nicht 40 einzelne
// Mails ans Lohnbüro). Werden die Anhänge zu groß, gehen stattdessen
// Download-Links (7 Tage gültig).
//
// Aufruf (Bearer-Token des angemeldeten Users):
//   { archiv_ids: [...], empfaenger, cc?, betreff, text,
//     extra_anhaenge?: [{ filename, content(base64) }],   // z. B. Fahrtenbücher
//     mit_krankmeldungen?: boolean }
//
// Mitschicken (Wunsch J. Maurer, 21.10.2026): Kilometerberichte
// (Fahrtenbuch-PDFs, im Browser erzeugt wie beim Drucken) und die
// Krankmeldungen der Person, die in die Periode des Berichts fallen —
// bei Tätigkeitsberichten (21.–20.) wie bei Stundenberichten (Teil I/II).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.79.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });

/** Resend nimmt bis 40 MB je Mail — darunter bleiben, sonst Links. */
const MAX_ANHANG_BYTES = 25 * 1024 * 1024;

function b64(bytes: Uint8Array): string {
  let s = "";
  const block = 0x8000;
  for (let i = 0; i < bytes.length; i += block) {
    s += String.fromCharCode(...bytes.subarray(i, i + block));
  }
  return btoa(s);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authKopf = req.headers.get("authorization") ?? "";
  if (!authKopf.startsWith("Bearer ")) return json({ ok: false, fehler: "Nicht angemeldet" }, 401);
  const alsUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authKopf } }, auth: { persistSession: false },
  });
  const { data: u } = await alsUser.auth.getUser();
  if (!u?.user) return json({ ok: false, fehler: "Nicht angemeldet" }, 401);
  const { data: admin } = await alsUser.rpc("is_admin_role", { _user_id: u.user.id });
  const { data: frei } = await alsUser.rpc("has_permission", { _user_id: u.user.id, _schluessel: "stunden.taetigkeitsbericht.freigeben" });
  const { data: bsb } = await alsUser.rpc("has_permission", { _user_id: u.user.id, _schluessel: "stunden.bsb.bestaetigen" });
  if (!(admin === true || frei === true || bsb === true)) return json({ ok: false, fehler: "Nicht berechtigt" }, 403);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const ids = Array.isArray(body.archiv_ids) ? (body.archiv_ids as string[]) : [];
  const empfaenger = String(body.empfaenger ?? "").trim();
  const cc = typeof body.cc === "string" && body.cc.trim() ? body.cc.trim() : null;
  const betreff = String(body.betreff ?? "").trim() || "Berichte";
  const text = String(body.text ?? "");
  const extra = (Array.isArray(body.extra_anhaenge) ? (body.extra_anhaenge as unknown[]) : [])
    .filter((a): a is { filename: string; content: string } =>
      !!a && typeof (a as any).filename === "string" && typeof (a as any).content === "string")
    .slice(0, 100)
    .map((a) => ({ filename: a.filename.replace(/[\\/:*?"<>|]/g, "-").slice(0, 150), content: a.content }));
  const mitKrank = body.mit_krankmeldungen === true;
  if (ids.length === 0) return json({ ok: false, fehler: "Keine Berichte gewählt" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(empfaenger)) return json({ ok: false, fehler: "Empfänger ungültig" }, 400);

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json({ ok: false, fehler: "RESEND_API_KEY nicht konfiguriert" }, 500);
  const from = Deno.env.get("RESEND_FROM") ?? "berichte@willroider.app";
  const replyTo = Deno.env.get("RESEND_REPLY_TO") ?? "maurer@willroider.at";

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data: zeilen, error } = await sb
    .from("bericht_archiv")
    .select("id, art, mitarbeiter_id, jahr, monat, teil, dateiname, storage_pfad, periode_label, groesse, ueberholt_am")
    .in("id", ids);
  if (error) return json({ ok: false, fehler: error.message }, 500);
  const liste = (zeilen ?? []) as Array<{
    id: string; art: string; mitarbeiter_id: string; jahr: number; monat: number; teil: number | null;
    dateiname: string; storage_pfad: string; periode_label: string; groesse: number | null;
  }>;
  if (liste.length === 0) return json({ ok: false, fehler: "Berichte nicht gefunden" }, 404);
  const ueberholt = liste.filter((z) => (z as { ueberholt_am?: string | null }).ueberholt_am);
  if (ueberholt.length > 0) {
    return json({ ok: false, fehler: `${ueberholt[0].dateiname} ist überholt (Bericht wurde wieder geöffnet) und wird nicht versendet.` }, 400);
  }

  // ─── Krankmeldungen der Perioden ─────────────────────────────────────
  const pad = (n: number) => String(n).padStart(2, "0");
  const zeitraum = (z: (typeof liste)[number]): { von: string; bis: string } => {
    if (z.art === "taetigkeitsbericht") {
      const vm = z.monat === 1 ? 12 : z.monat - 1;
      const vj = z.monat === 1 ? z.jahr - 1 : z.jahr;
      return { von: `${vj}-${pad(vm)}-21`, bis: `${z.jahr}-${pad(z.monat)}-20` };
    }
    const letzter = new Date(Date.UTC(z.jahr, z.monat, 0)).getUTCDate();
    return z.teil === 2
      ? { von: `${z.jahr}-${pad(z.monat)}-17`, bis: `${z.jahr}-${pad(z.monat)}-${pad(letzter)}` }
      : { von: `${z.jahr}-${pad(z.monat)}-01`, bis: `${z.jahr}-${pad(z.monat)}-16` };
  };
  type Krank = { dokId: string; pfad: string; name: string; groesse: number };
  const krank: Krank[] = [];
  if (mitKrank) {
    const gesehen = new Set<string>();
    for (const z of liste) {
      const { von, bis } = zeitraum(z);
      const { data: km } = await sb
        .from("krankmeldungen")
        .select("von, bis, dokument_id, dokumente:dokument_id(storage_path, dateiname, groesse), profiles:mitarbeiter_id(vorname, nachname)")
        .eq("mitarbeiter_id", z.mitarbeiter_id)
        .lte("von", bis)
        .gte("bis", von)
        .not("dokument_id", "is", null);
      for (const k of (km ?? []) as any[]) {
        if (!k.dokumente?.storage_path || gesehen.has(k.dokument_id)) continue;
        gesehen.add(k.dokument_id);
        const ext = String(k.dokumente.dateiname ?? k.dokumente.storage_path).split(".").pop()?.toLowerCase() ?? "pdf";
        const wer = `${k.profiles?.vorname ?? ""} ${k.profiles?.nachname ?? ""}`.trim();
        const zeit = k.von === k.bis ? k.von : `${k.von} bis ${k.bis}`;
        krank.push({
          dokId: k.dokument_id,
          pfad: k.dokumente.storage_path,
          name: `Krankmeldung ${wer} ${zeit}.${ext}`.replace(/[\\/:*?"<>|]/g, "-"),
          groesse: Number(k.dokumente.groesse ?? 0),
        });
      }
    }
  }

  const extraBytes = extra.reduce((s, a) => s + Math.floor((a.content.length * 3) / 4), 0);
  const gesamt =
    liste.reduce((s, z) => s + (z.groesse ?? 0), 0) + krank.reduce((s, k) => s + k.groesse, 0) + extraBytes;
  const alsLinks = gesamt > MAX_ANHANG_BYTES;

  const attachments: Array<{ filename: string; content: string }> = [];
  const links: string[] = [];
  for (const z of liste) {
    if (alsLinks) {
      const { data: s } = await sb.storage.from("berichte-archiv").createSignedUrl(z.storage_pfad, 7 * 86400, { download: z.dateiname });
      if (s?.signedUrl) links.push(`${z.dateiname}: ${s.signedUrl}`);
    } else {
      const { data: datei, error: dErr } = await sb.storage.from("berichte-archiv").download(z.storage_pfad);
      if (dErr || !datei) return json({ ok: false, fehler: `Datei fehlt: ${z.dateiname}` }, 500);
      attachments.push({ filename: z.dateiname, content: b64(new Uint8Array(await datei.arrayBuffer())) });
    }
  }
  // Krankmeldungen (Speicher ma_dokumente) — wie die Berichte: Anhang oder Link.
  for (const k of krank) {
    if (alsLinks) {
      const { data: s } = await sb.storage.from("ma_dokumente").createSignedUrl(k.pfad, 7 * 86400, { download: k.name });
      if (s?.signedUrl) links.push(`${k.name}: ${s.signedUrl}`);
    } else {
      const { data: datei } = await sb.storage.from("ma_dokumente").download(k.pfad);
      if (datei) attachments.push({ filename: k.name, content: b64(new Uint8Array(await datei.arrayBuffer())) });
    }
  }
  // Fahrtenbücher: klein, immer als Anhang.
  attachments.push(...extra);

  const textVoll = alsLinks
    ? `${text}\n\nDie Berichte sind zu groß für den Anhang — Download-Links (7 Tage gültig):\n\n${links.join("\n")}`
    : text;
  const html = `<p style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-line">${
    textVoll.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>')
  }</p>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      reply_to: [replyTo],
      to: [empfaenger],
      ...(cc ? { cc: [cc] } : {}),
      subject: betreff,
      text: textVoll,
      html,
      ...(attachments.length > 0 ? { attachments } : {}),
    }),
  });
  const antwort = await res.json().catch(() => ({}));
  if (!res.ok) return json({ ok: false, fehler: (antwort as { message?: string })?.message ?? `Resend antwortet ${res.status}` }, 502);

  await sb
    .from("bericht_archiv")
    .update({ versendet_am: new Date().toISOString(), versendet_an: empfaenger })
    .in("id", liste.map((z) => z.id));

  return json({
    ok: true,
    anzahl: liste.length,
    fahrtenbuecher: extra.length,
    krankmeldungen: krank.length,
    empfaenger,
    als_links: alsLinks,
    mail_id: (antwort as { id?: string })?.id,
  });
});
