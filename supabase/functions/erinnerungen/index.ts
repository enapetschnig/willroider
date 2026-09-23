// Tägliche Erinnerungen (Cron „erinnerungen", Mo–Sa 07:00 UTC).
//
// Wer bekommt was — jeweils als Push auf die angemeldeten Geräte, ohne
// Gerät als E-Mail:
//   tb_unterschrift  Angestellte: Tätigkeitsbericht der abgelaufenen Periode
//                    (21.–20.) nicht unterschrieben → am 21., 24. und 28.
//   tb_luecke        Angestellte: seit 3 Arbeitstagen kein Eintrag im
//                    Tätigkeitsbericht → alle 3 Tage (Feiertage, Betriebs-
//                    urlaub laut Arbeitszeitkalender zählen nicht)
//   bsb_unterschrift Bauarbeiter: Stundenbericht seit 2 Tagen offen → alle 3 Tage
//   unterweisung     fällige Unterweisung (höchstens 14 Tage alt) nicht bestätigt → täglich
//   tb_freigabe      Freigeber: N Tätigkeitsberichte warten → täglich
//   bsb_kontrolle    Büro: N Stundenberichte warten auf Kontrolle → täglich
//
// Doppelte Nachrichten verhindert benachrichtigungen_log (schonGeschickt).
// Antwort: { ok, geschickt: {art: n}, kanaele: {push, mail, keiner} }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.79.0";
import { sendeAnPerson, schonGeschickt, type Nachricht } from "../_shared/push.ts";
import { isWerktag } from "../_shared/feiertage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });

const MONATE = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function heuteWien(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Vienna" });
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Montag einer ISO-Kalenderwoche. */
function kwMontag(jahr: number, kw: number): string {
  const jan4 = new Date(Date.UTC(jahr, 0, 4));
  const wd = (jan4.getUTCDay() + 6) % 7;
  jan4.setUTCDate(jan4.getUTCDate() - wd + (kw - 1) * 7);
  return jan4.toISOString().slice(0, 10);
}

/** Arbeitstag = Werktag ohne Feiertag und nicht frei laut Arbeitszeitkalender
 *  (Betriebsurlaub, kurze Woche). Sonst gäbe es über Weihnachten Erinnerungen. */
function istArbeitstag(iso: string, frei: Set<string>): boolean {
  return isWerktag(iso) && !frei.has(iso);
}

/** n Arbeitstage zurück — für „seit 3 Arbeitstagen nichts eingetragen". */
function arbeitstageZurueck(iso: string, n: number, frei: Set<string>): string {
  let d = iso;
  let rest = n;
  let schutz = 0;
  while (rest > 0 && schutz++ < 60) {
    d = addDays(d, -1);
    if (istArbeitstag(d, frei)) rest--;
  }
  return d;
}
/** Abgelaufene Tätigkeitsbericht-Periode (21.–20.) zum Stichtag. */
function letztePeriode(iso: string): { jahr: number; monat: number; von: string; bis: string; titel: string } {
  const j = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const t = Number(iso.slice(8, 10));
  // Periode „monat" endet am 20. des Monats. Ab dem 21. ist die des laufenden
  // Monats abgelaufen, davor die des Vormonats.
  let jahr = j, monat = m;
  if (t <= 20) { monat = m === 1 ? 12 : m - 1; jahr = m === 1 ? j - 1 : j; }
  const vonMonat = monat === 1 ? 12 : monat - 1;
  const vonJahr = monat === 1 ? jahr - 1 : jahr;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    jahr, monat,
    von: `${vonJahr}-${pad(vonMonat)}-21`,
    bis: `${jahr}-${pad(monat)}-20`,
    titel: `${MONATE[vonMonat - 1]} - ${MONATE[monat - 1]} ${jahr}`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const geheimnis = Deno.env.get("SYNC_SECRET");
  const authKopf = req.headers.get("authorization") ?? "";
  let erlaubt =
    (!!geheimnis && req.headers.get("x-sync-secret") === geheimnis) ||
    authKopf.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? " ");
  if (!erlaubt && authKopf.startsWith("Bearer ")) {
    const alsUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authKopf } }, auth: { persistSession: false },
    });
    const { data: u } = await alsUser.auth.getUser();
    if (u?.user) {
      const { data: a } = await alsUser.rpc("is_admin_role", { _user_id: u.user.id });
      erlaubt = a === true;
    }
  }
  if (!erlaubt) return json({ ok: false, fehler: "Nicht berechtigt" }, 401);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const probe = body.probe === true; // nur zählen, nichts schicken
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const heute = heuteWien();
  const tag = Number(heute.slice(8, 10));

  // Scharf erst ab dem Datum in app_settings.erinnerungen_ab (Rollout
  // 01.10.2026) — vorher nur Probeläufe, damit vor dem Start niemand
  // Nachrichten zu alten Berichten bekommt.
  const { data: ab } = await sb.from("app_settings").select("value").eq("key", "erinnerungen_ab").maybeSingle();
  const abDatum = typeof ab?.value === "string" ? ab.value : null;
  // Fehlt die Einstellung, wird NICHT verschickt — lieber still als ein
  // Schwall alter Nachrichten.
  if (!probe && (!abDatum || heute < abDatum)) {
    return json({ ok: true, heute, uebersprungen: abDatum ? `Erinnerungen starten am ${abDatum}` : "app_settings.erinnerungen_ab fehlt" });
  }

  // Freie Tage laut Arbeitszeitkalender (Betriebsurlaub, Fenstertage, kurze Woche)
  const frei = new Set<string>();
  {
    const j = Number(heute.slice(0, 4));
    const { data: kal } = await sb
      .from("arbeitszeitkalender")
      .select("jahr, kw, wochentyp, soll_mo, soll_di, soll_mi, soll_do, soll_fr")
      .in("jahr", [j - 1, j]);
    for (const r of (kal ?? []) as Array<Record<string, unknown>>) {
      const mon = kwMontag(Number(r.jahr), Number(r.kw));
      const perDay = [r.soll_mo, r.soll_di, r.soll_mi, r.soll_do, r.soll_fr];
      for (let wd = 0; wd < 5; wd++) {
        if (r.wochentyp === "BU" || (perDay[wd] != null && Number(perDay[wd]) === 0)) frei.add(addDays(mon, wd));
      }
    }
  }
  const geschickt: Record<string, number> = {};
  const kanaele = { push: 0, mail: 0, keiner: 0 };
  const geplant: Array<{ userId: string; n: Nachricht; stunden: number }> = [];

  const { data: leute } = await sb
    .from("profiles")
    .select("id, vorname, nachname, zeiterfassung_typ, is_active")
    .eq("is_active", true)
    .range(0, 999);
  const alle = (leute ?? []) as Array<{ id: string; vorname: string; nachname: string; zeiterfassung_typ: string | null }>;
  const angestellte = alle.filter((p) => p.zeiterfassung_typ === "angestellter");

  // ── tb_unterschrift: abgelaufene Periode nicht unterschrieben ──────────
  if ([21, 24, 28].includes(tag)) {
    const per = letztePeriode(heute);
    const { data: unterschrieben } = await sb
      .from("taetigkeitsbericht_unterschriften")
      .select("mitarbeiter_id")
      .eq("jahr", per.jahr)
      .eq("monat", per.monat);
    const hat = new Set((unterschrieben ?? []).map((r: { mitarbeiter_id: string }) => r.mitarbeiter_id));
    for (const p of angestellte) {
      if (hat.has(p.id)) continue;
      geplant.push({
        userId: p.id,
        stunden: 20,
        n: {
          art: "tb_unterschrift",
          bezug: `${per.jahr}-${per.monat}`,
          titel: "Tätigkeitsbericht unterschreiben",
          text: `Dein Tätigkeitsbericht ${per.titel} ist noch nicht unterschrieben. Bitte kontrollieren und unterschreiben.`,
          url: "/taetigkeitsbericht",
        },
      });
    }
  }

  // ── tb_luecke: seit 3 Werktagen kein Eintrag ───────────────────────────
  {
    if (istArbeitstag(heute, frei) && angestellte.length > 0) {
      const seit = arbeitstageZurueck(heute, 3, frei);
      const { data: tage } = await sb
        .from("stunden_tage")
        .select("mitarbeiter_id")
        .in("mitarbeiter_id", angestellte.map((p) => p.id))
        .gte("datum", seit)
        .range(0, 9999);
      const hat = new Set((tage ?? []).map((r: { mitarbeiter_id: string }) => r.mitarbeiter_id));
      for (const p of angestellte) {
        if (hat.has(p.id)) continue;
        geplant.push({
          userId: p.id,
          stunden: 24 * 3 - 2,
          n: {
            art: "tb_luecke",
            bezug: null,
            titel: "Tätigkeitsbericht nachtragen",
            text: "Seit drei Arbeitstagen steht nichts in deinem Tätigkeitsbericht. Bitte die Tage nachtragen.",
            url: "/taetigkeitsbericht",
          },
        });
      }
    }
  }

  // ── bsb_unterschrift: Stundenbericht seit 2 Tagen offen ────────────────
  // Nur Berichte der letzten drei Wochen — der Rückstand aus der Zeit vor
  // dem Rollout wird nicht angemahnt.
  {
    const grenze = new Date(Date.now() - 2 * 86400 * 1000).toISOString();
    const aeltestens = new Date(Date.now() - 21 * 86400 * 1000).toISOString();
    const { data: offen } = await sb
      .from("stunden_berichte")
      .select("id, mitarbeiter_id, jahr, monat, teil")
      .eq("status", "offen")
      .lte("created_at", grenze)
      .gte("created_at", aeltestens)
      .range(0, 999);
    for (const b of (offen ?? []) as Array<{ id: string; mitarbeiter_id: string; jahr: number; monat: number; teil: number }>) {
      if (!alle.some((p) => p.id === b.mitarbeiter_id)) continue;
      geplant.push({
        userId: b.mitarbeiter_id,
        stunden: 24 * 3 - 2,
        n: {
          art: "bsb_unterschrift",
          bezug: b.id,
          titel: "Stundenbericht unterschreiben",
          text: `Dein Baustellenstundenbericht ${MONATE[b.monat - 1]} ${b.jahr}, Teil ${b.teil === 1 ? "I" : "II"} wartet auf deine Unterschrift.`,
          url: `/stundenbericht/${b.id}`,
        },
      });
    }
  }

  // ── unterweisung: fällig und nicht bestätigt ───────────────────────────
  {
    const { data: faellig } = await sb
      .from("evaluierung_unterschriften")
      .select("id, mitarbeiter_id, evaluierung_id, evaluierungen(baustelle_id, baustellen(bvh_name))")
      .eq("status", "offen")
      .is("unterschrift_data", null)
      .lte("faellig_am", new Date().toISOString())
      // Nur die letzten zwei Wochen — alte Altlasten werden nicht am ersten
      // Tag alle auf einmal angemahnt.
      .gte("faellig_am", new Date(Date.now() - 14 * 86400 * 1000).toISOString())
      .range(0, 999);
    for (const u of (faellig ?? []) as Array<any>) {
      if (!alle.some((p) => p.id === u.mitarbeiter_id)) continue;
      const bvh = u.evaluierungen?.baustellen?.bvh_name ?? "Baustelle";
      geplant.push({
        userId: u.mitarbeiter_id,
        stunden: 20,
        n: {
          art: "unterweisung",
          bezug: u.id,
          titel: "Unterweisung bestätigen",
          text: `Die Sicherheitsunterweisung für ${bvh} ist fällig. Bitte in der App lesen und unterschreiben.`,
          url: "/",
        },
      });
    }
  }

  // ── tb_freigabe: Freigeber, wenn Berichte warten ───────────────────────
  {
    const { data: warten } = await sb
      .from("taetigkeitsbericht_unterschriften")
      .select("id")
      .eq("status", "unterschrieben");
    const n = warten?.length ?? 0;
    if (n > 0) {
      for (const p of alle) {
        const { data: darf } = await sb.rpc("has_permission", { _user_id: p.id, _schluessel: "stunden.taetigkeitsbericht.freigeben" });
        if (darf !== true) continue;
        geplant.push({
          userId: p.id,
          stunden: 20,
          n: {
            art: "tb_freigabe",
            bezug: heute,
            titel: `${n} Tätigkeitsbericht${n === 1 ? "" : "e"} warten auf Freigabe`,
            text: "Unterschriebene Tätigkeitsberichte der Angestellten warten auf deine Freigabe.",
            url: "/taetigkeitsberichte",
          },
        });
      }
    }
  }

  // ── bsb_kontrolle: Büro, wenn Stundenberichte warten ───────────────────
  {
    const { data: warten } = await sb.from("stunden_berichte").select("id").eq("status", "unterschrieben");
    const n = warten?.length ?? 0;
    if (n > 0) {
      for (const p of alle) {
        const { data: darf } = await sb.rpc("has_permission", { _user_id: p.id, _schluessel: "stunden.bsb.bestaetigen" });
        if (darf !== true) continue;
        geplant.push({
          userId: p.id,
          stunden: 20,
          n: {
            art: "bsb_kontrolle",
            bezug: heute,
            titel: `${n} Stundenbericht${n === 1 ? "" : "e"} warten auf Kontrolle`,
            text: "Unterschriebene Baustellenstundenberichte warten auf Prüfung und Bestätigung.",
            url: "/stundenberichte?status=unterschrieben",
          },
        });
      }
    }
  }

  // ── Versand ────────────────────────────────────────────────────────────
  const vorschau: Array<{ userId: string; art: string; bezug: string | null }> = [];
  for (const g of geplant) {
    if (await schonGeschickt(sb, g.userId, g.n.art, g.n.bezug ?? null, g.stunden)) continue;
    if (probe) {
      vorschau.push({ userId: g.userId, art: g.n.art, bezug: g.n.bezug ?? null });
      continue;
    }
    const r = await sendeAnPerson(sb, g.userId, g.n, { mailErsatz: true });
    geschickt[g.n.art] = (geschickt[g.n.art] ?? 0) + 1;
    kanaele[r.kanal]++;
  }

  return json({ ok: true, heute, geplant: geplant.length, geschickt, kanaele, ...(probe ? { vorschau } : {}) });
});
