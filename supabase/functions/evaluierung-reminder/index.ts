// Tägliche Reminder-Function für offene Unterweisungs-Unterschriften.
//
// Logik:
//  • aus v_offene_unterschriften_mit_alter alle Rows mit tage_offen ≥ 3 holen
//  • über v_offene_unterschriften den/die Verantwortlichen ermitteln
//    (Polier + Bauleiter pro Baustelle)
//  • pro Verantwortlichem: zugehörige Unterschriften nur reminderfähig
//    wenn `reminder_geschickt_am` NULL ODER älter als 24h ist
//  • optional Twilio-SMS oder Push (falls Env-Vars gesetzt sind), sonst
//    nur DB-Flag setzen → das Frontend nutzt das Flag für die rote
//    Banner-Variante als minimaler Fallback
//
// Aufruf via pg_cron — die Function selbst läuft idempotent.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.79.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

const KARENZ_TAGE = 3;
const REMINDER_COOLDOWN_H = 24;

interface OffeneRow {
  unterschrift_id: string;
  evaluierung_id: string;
  mitarbeiter_id: string;
  baustelle_id: string;
  tage_offen: number;
  reminder_geschickt_am: string | null;
}

interface VerantwortlichRow {
  unterschrift_id: string;
  verantwortlich_id: string;
  bvh_name: string;
  rolle: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  // 1) Überfällige offene Unterschriften
  const { data: offene, error: e1 } = await admin
    .from("v_offene_unterschriften_mit_alter")
    .select(
      "unterschrift_id, evaluierung_id, mitarbeiter_id, baustelle_id, tage_offen, reminder_geschickt_am",
    )
    .gte("tage_offen", KARENZ_TAGE);
  if (e1) return jsonResponse({ ok: false, error: e1.message }, 500);
  const rows = (offene ?? []) as OffeneRow[];
  if (rows.length === 0) {
    return jsonResponse({ ok: true, reminders: 0, message: "Keine überfälligen Fälle." });
  }

  // 2) Filtern: nur reminderfähig (noch nie oder Cooldown abgelaufen)
  const cooldownMs = REMINDER_COOLDOWN_H * 60 * 60 * 1000;
  const now = Date.now();
  const reminderfaehig = rows.filter((r) => {
    if (!r.reminder_geschickt_am) return true;
    return now - new Date(r.reminder_geschickt_am).getTime() > cooldownMs;
  });
  if (reminderfaehig.length === 0) {
    return jsonResponse({
      ok: true,
      reminders: 0,
      message: "Alle überfälligen Fälle sind im Cooldown.",
    });
  }

  // 3) Verantwortliche pro unterschrift_id ermitteln
  const ids = reminderfaehig.map((r) => r.unterschrift_id);
  const { data: vrows, error: e2 } = await admin
    .from("v_offene_unterschriften")
    .select("unterschrift_id, verantwortlich_id, bvh_name, rolle")
    .in("unterschrift_id", ids);
  if (e2) return jsonResponse({ ok: false, error: e2.message }, 500);
  const verantwortliche = (vrows ?? []) as VerantwortlichRow[];

  // 4) Gruppieren pro verantwortlich_id
  type Gruppe = { name: string; faelle: { bvh_name: string; rolle: string }[] };
  const proVerantw = new Map<string, Gruppe>();
  for (const v of verantwortliche) {
    const g = proVerantw.get(v.verantwortlich_id) ?? {
      name: "",
      faelle: [],
    };
    g.faelle.push({ bvh_name: v.bvh_name, rolle: v.rolle });
    proVerantw.set(v.verantwortlich_id, g);
  }
  // Namen der Verantwortlichen nachladen
  if (proVerantw.size > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, vorname, nachname, telefonnummer")
      .in("id", Array.from(proVerantw.keys()));
    for (const p of (profiles ?? []) as any[]) {
      const g = proVerantw.get(p.id);
      if (g) g.name = `${p.vorname} ${p.nachname}`.trim();
    }
  }

  // 5) Optional SMS via Twilio — nur wenn alle Twilio-ENV-Vars gesetzt sind
  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioFrom = Deno.env.get("TWILIO_FROM");
  const smsAktiv = !!twilioSid && !!twilioToken && !!twilioFrom;
  let smsSent = 0;
  if (smsAktiv) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, telefonnummer")
      .in("id", Array.from(proVerantw.keys()));
    for (const p of (profiles ?? []) as any[]) {
      const g = proVerantw.get(p.id);
      if (!g || !p.telefonnummer) continue;
      const baustellen = Array.from(new Set(g.faelle.map((f) => f.bvh_name))).slice(0, 4);
      const msg = `Holzbau Willroider: ${g.faelle.length} offene Unterweisung(en) auf ${baustellen.join(", ")}. Bitte im Dashboard prüfen.`;
      try {
        const r = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              From: twilioFrom!,
              To: p.telefonnummer,
              Body: msg,
            }),
          },
        );
        if (r.ok) smsSent++;
      } catch (err) {
        console.error("twilio fehler", err);
      }
    }
  }

  // 6) reminder_geschickt_am für alle reminderfähigen Rows hochsetzen
  const { error: e3 } = await admin
    .from("evaluierung_unterschriften")
    .update({ reminder_geschickt_am: new Date().toISOString() })
    .in("id", ids);
  if (e3) return jsonResponse({ ok: false, error: e3.message }, 500);

  return jsonResponse({
    ok: true,
    reminders: ids.length,
    verantwortliche: proVerantw.size,
    smsSent,
    smsAktiv,
  });
});
