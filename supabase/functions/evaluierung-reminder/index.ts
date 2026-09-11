// Erinnerung bei überfälligen Unterweisungen — SMS an Bauleiter und Polier.
//
// Läuft alle 5 Minuten per pg_cron (net.http_post mit x-reminder-secret aus
// dem Vault). Die Function entscheidet selbst, ob gerade etwas zu tun ist:
//
//   • fällig = status 'offen' und faellig_am <= jetzt (v_unterweisung_faellig)
//   • erste SMS sofort nach Fälligkeit (Regel A: 08:00 → SMS 08:00–08:05;
//     Regel B/C: 30 Minuten nach Zuteilung), nur Mo–Sa 06:00–18:00 Wien
//   • Wiederholung um 10:00 und 12:00, solange offen — danach Ruhe bis
//     zum nächsten Tag. Max. drei SMS je Fall und Tag.
//   • eine SMS je Empfänger und Baustelle, mit den Namen der Säumigen
//   • Empfänger: Bauleiter der Baustelle, Polier der Baustelle, dazu jeder
//     Partieleiter, der heute dort eingeteilt ist — nur mit Handynummer
//
// Antwort: { ok, faellig, sms, empfaenger_ohne_nummer, uebersprungen }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.79.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-reminder-secret",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

/** Wiederholungs-Fenster (Wien): Beginn-Minute des Tages, 10 Minuten breit. */
const WIEDERHOLUNG_MIN = [10 * 60, 12 * 60];
const FENSTER_BREITE_MIN = 10;

interface FaelligRow {
  unterschrift_id: string;
  mitarbeiter_id: string;
  faellig_am: string;
  reminder_geschickt_am: string | null;
  baustelle_id: string;
  bvh_name: string | null;
  bauleiter_id: string | null;
  polier_id: string | null;
  vorname: string | null;
  nachname: string | null;
}

/** Wiener Uhrzeit als Minuten seit Mitternacht + Wochentag + Datum. */
function wien(now: Date) {
  const parts = new Intl.DateTimeFormat("de-AT", {
    timeZone: "Europe/Vienna",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const minuten = Number(get("hour")) * 60 + Number(get("minute"));
  return {
    minuten,
    wochentag: get("weekday"), // "Mo." … "So."
    datum: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Nur der Cron (oder ein Admin mit dem Secret) darf auslösen — sonst
  // könnte jeder mit dem öffentlichen Key SMS auf Firmenkosten anstoßen.
  const secret = Deno.env.get("REMINDER_SECRET");
  if (!secret || req.headers.get("x-reminder-secret") !== secret) {
    return jsonResponse({ ok: false, error: "Nicht erlaubt" }, 401);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = new Date();
  const w = wien(now);
  if (w.wochentag.startsWith("So") || w.minuten < 6 * 60 || w.minuten >= 18 * 60) {
    return jsonResponse({ ok: true, faellig: 0, sms: 0, uebersprungen: "außerhalb 06–18 Uhr / Sonntag" });
  }
  const imWiederholungsfenster = WIEDERHOLUNG_MIN.some(
    (start) => w.minuten >= start && w.minuten < start + FENSTER_BREITE_MIN,
  );
  const fensterStart = WIEDERHOLUNG_MIN.find(
    (start) => w.minuten >= start && w.minuten < start + FENSTER_BREITE_MIN,
  );

  // 1) Alles, was fällig ist
  const { data, error } = await admin
    .from("v_unterweisung_faellig")
    .select(
      "unterschrift_id, mitarbeiter_id, faellig_am, reminder_geschickt_am, baustelle_id, bvh_name, bauleiter_id, polier_id, vorname, nachname",
    )
    .lte("faellig_am", now.toISOString());
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);
  const faellig = (data ?? []) as FaelligRow[];
  if (faellig.length === 0) return jsonResponse({ ok: true, faellig: 0, sms: 0 });

  // 2) Reminderfähig: noch nie erinnert — oder im Wiederholungsfenster und
  //    die letzte Erinnerung liegt vor diesem Fenster.
  const fensterBeginn = (startMin: number) => {
    // Zeitpunkt „heute (Wien) um startMin" als UTC-Date
    const [y, m, d] = w.datum.split("-").map(Number);
    const hh = String(Math.floor(startMin / 60)).padStart(2, "0");
    const mm = String(startMin % 60).padStart(2, "0");
    // Offset von Wien zu UTC über einen Rundweg bestimmen
    const probe = new Date(Date.UTC(y, m - 1, d, Number(hh), Number(mm)));
    const wienStr = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Vienna", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(probe);
    const [wh, wm] = wienStr.split(":").map(Number);
    const diffMin = (wh * 60 + wm) - startMin;
    return new Date(probe.getTime() - diffMin * 60_000);
  };
  const reminderfaehig = faellig.filter((r) => {
    if (!r.reminder_geschickt_am) return true;
    if (!imWiederholungsfenster || fensterStart === undefined) return false;
    return new Date(r.reminder_geschickt_am) < fensterBeginn(fensterStart);
  });
  if (reminderfaehig.length === 0) {
    return jsonResponse({ ok: true, faellig: faellig.length, sms: 0, uebersprungen: "alle bereits erinnert" });
  }

  // 3) Empfänger je Baustelle: Bauleiter, Polier, heute eingeteilte Partieleiter
  const baustellen = [...new Set(reminderfaehig.map((r) => r.baustelle_id))];
  const { data: heuteLeiter } = await admin
    .from("einteilungen")
    .select("baustelle_id, einteilung_mitarbeiter(mitarbeiter_id, profiles!einteilung_mitarbeiter_mitarbeiter_id_fkey(is_partieleiter))")
    .eq("datum", w.datum)
    .in("baustelle_id", baustellen);

  const empfaengerJeBaustelle = new Map<string, Set<string>>();
  for (const r of reminderfaehig) {
    const set = empfaengerJeBaustelle.get(r.baustelle_id) ?? new Set<string>();
    if (r.bauleiter_id) set.add(r.bauleiter_id);
    if (r.polier_id) set.add(r.polier_id);
    empfaengerJeBaustelle.set(r.baustelle_id, set);
  }
  for (const e of (heuteLeiter ?? []) as any[]) {
    const set = empfaengerJeBaustelle.get(e.baustelle_id);
    if (!set) continue;
    for (const em of e.einteilung_mitarbeiter ?? []) {
      if (em.profiles?.is_partieleiter) set.add(em.mitarbeiter_id);
    }
  }

  const alleEmpfaenger = [...new Set([...empfaengerJeBaustelle.values()].flatMap((s) => [...s]))];
  const { data: profile } = await admin
    .from("profiles")
    .select("id, vorname, telefon")
    .in("id", alleEmpfaenger);
  const telefonVon = new Map((profile ?? []).map((p: any) => [p.id, p.telefon as string | null]));

  // 4) SMS je Empfänger und Baustelle
  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioFrom = Deno.env.get("TWILIO_PHONE_NUMBER");
  const smsAktiv = !!twilioSid && !!twilioToken && !!twilioFrom;

  let gesendet = 0;
  const ohneNummer: string[] = [];
  const fehler: string[] = [];
  for (const [baustelleId, empfaenger] of empfaengerJeBaustelle) {
    const faelle = reminderfaehig.filter((r) => r.baustelle_id === baustelleId);
    const namen = faelle
      .map((r) => `${r.vorname ?? ""} ${r.nachname ?? ""}`.trim() || "Unbekannt")
      .sort((a, b) => a.localeCompare(b, "de"));
    const bvh = faelle[0]?.bvh_name ?? "Baustelle";
    const seit = new Date(faelle[0].faellig_am).toLocaleTimeString("de-AT", {
      timeZone: "Europe/Vienna", hour: "2-digit", minute: "2-digit",
    });
    const text =
      `Willroider-App: Baustelle ${bvh} — ${namen.length === 1 ? "1 Unterweisung offen" : `${namen.length} Unterweisungen offen`} ` +
      `(fällig seit ${seit}): ${namen.join(", ")}. Bitte am Tablet nachholen lassen.`;

    for (const uid of empfaenger) {
      const tel = telefonVon.get(uid);
      if (!tel) { ohneNummer.push(uid); continue; }
      if (!smsAktiv) continue;
      try {
        const res = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ To: tel, From: twilioFrom!, Body: text }),
          },
        );
        if (res.ok) gesendet++;
        else fehler.push(`${uid}: ${(await res.json())?.message ?? res.status}`);
      } catch (e) {
        fehler.push(`${uid}: ${e instanceof Error ? e.message : "Fehler"}`);
      }
    }
  }

  // 5) Erinnert markieren — auch wenn niemand eine Nummer hat, sonst
  //    versucht es der Cron alle 5 Minuten aufs Neue.
  await admin
    .from("evaluierung_unterschriften")
    .update({ reminder_geschickt_am: now.toISOString() })
    .in("id", reminderfaehig.map((r) => r.unterschrift_id));

  return jsonResponse({
    ok: true,
    faellig: faellig.length,
    erinnert: reminderfaehig.length,
    sms: gesendet,
    empfaenger_ohne_nummer: [...new Set(ohneNummer)].length,
    fehler,
  });
});
