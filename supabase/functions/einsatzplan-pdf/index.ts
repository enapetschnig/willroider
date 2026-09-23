// Arbeitseinteilung (Poliereinsatz) als PDF ins Archiv legen.
//
// Läuft jede Woche automatisch (Cron „einsatzplan-woche“, Mittwoch früh) und
// auf Knopfdruck aus der Arbeitsplanung. Das PDF ist dasselbe wie der
// Ausdruck am Bildschirm (gleiches Modul, siehe _shared/poliereinsatzPdf.ts)
// und landet
//   1. im Storage-Bucket „einsatzplaene“ (Archiv in der App, Tabelle
//      einsatzplan_archiv — dort kann man frühere Kalenderwochen aufrufen),
//   2. im SharePoint-Ordner aus app_settings.einsatzplan_sharepoint
//      („Einsatzplanung PDF 2026“). Dort wird nie etwas ersetzt oder gelöscht;
//      bei gleichem Namen hängt SharePoint eine Nummer an.
//
// Aufrufe:
//   { modus: "woche" }                       → Cron: aktuelle KW, nur einmal je KW
//   { modus: "jetzt", von?, bis?, format? }  → manuell (Arbeitsplanung bearbeiten)
//
// Zeitraum-Vorgabe: Montag der laufenden Woche + 12 Wochen, Querformat A3.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.79.0";
import { dateiHochladen, graphKonfiguriert, kindMitNamen, ordnerAnlegen } from "../_shared/graph.ts";
import {
  makePoliereinsatzPdf,
  type PdfAbwesenheit,
  type PdfBaustelle,
  type PoliereinsatzPdfInput,
} from "../_shared/poliereinsatzPdf.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sync-secret, x-supabase-api-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });

const WOCHEN_VORAUS = 12;

/** Heute in Wien als ISO-Datum. Deno läuft in UTC. */
function heuteWien(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Vienna" });
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function montagVon(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const wd = (d.getUTCDay() + 6) % 7; // Mo = 0
  return addDays(iso, -wd);
}

/** ISO-Kalenderwoche + zugehöriges Jahr. */
function isoWoche(iso: string): { jahr: number; kw: number } {
  const d = new Date(iso + "T00:00:00Z");
  const t = new Date(d.valueOf());
  const day = (d.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const jahr = t.getUTCFullYear();
  const first = new Date(Date.UTC(jahr, 0, 4));
  const kw =
    1 +
    Math.round(
      ((t.getTime() - first.getTime()) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7,
    );
  return { jahr, kw };
}

function isoWeekMondayIso(jahr: number, kw: number): string {
  const jan4 = new Date(Date.UTC(jahr, 0, 4));
  const wd = (jan4.getUTCDay() + 6) % 7;
  const mon = new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate() - wd + (kw - 1) * 7);
  return mon.toISOString().slice(0, 10);
}

type PartieRow = {
  id: string;
  name: string;
  farbcode: string | null;
  partieleiter_id: string | null;
  sort_order: number | null;
};

/** Reihenfolge wie am Bildschirm (src/lib/tagesplanung.ts → vergleichePartien). */
function vergleichePartien(a: PartieRow, b: PartieRow): number {
  const sa = a.sort_order ?? 9999;
  const sb = b.sort_order ?? 9999;
  if (sa !== sb) return sa - sb;
  return (a.name ?? "zzz").localeCompare(b.name ?? "zzz");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const geheimnis = Deno.env.get("SYNC_SECRET") ?? Deno.env.get("REMINDER_SECRET");
  const authKopf = req.headers.get("authorization") ?? "";
  let erlaubt =
    (!!geheimnis && req.headers.get("x-sync-secret") === geheimnis) ||
    authKopf.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? " ");
  let alsUserId: string | null = null;

  if (!erlaubt && authKopf.startsWith("Bearer ")) {
    const alsUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authKopf } }, auth: { persistSession: false } },
    );
    const { data: u } = await alsUser.auth.getUser();
    if (u?.user) {
      alsUserId = u.user.id;
      const { data: admin } = await alsUser.rpc("is_admin_role", { _user_id: u.user.id });
      const { data: darf } = await alsUser.rpc("has_permission", {
        _user_id: u.user.id,
        _schluessel: "arbeitsplanung.edit",
      });
      erlaubt = admin === true || darf === true;
    }
  }
  if (!erlaubt) return json({ ok: false, fehler: "Nicht berechtigt" }, 401);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const modus = (body.modus as string) ?? "jetzt";
  const automatisch = modus === "woche";

  const heute = heuteWien();
  const von = (typeof body.von === "string" && body.von) || montagVon(heute);
  const bis = (typeof body.bis === "string" && body.bis) || addDays(von, WOCHEN_VORAUS * 7 - 1);
  const format = (["a4", "a3", "a2"].includes(body.format as string) ? body.format : "a3") as
    | "a4"
    | "a3"
    | "a2";
  if (bis < von) return json({ ok: false, fehler: "Bis liegt vor Von" }, 400);
  const tage = (new Date(bis + "T00:00:00Z").getTime() - new Date(von + "T00:00:00Z").getTime()) / 86400000 + 1;
  if (tage > 120) return json({ ok: false, fehler: "Zeitraum zu lang (max. 120 Tage)" }, 400);

  const { jahr, kw } = isoWoche(von);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Cron: nur einmal je Kalenderwoche.
  if (automatisch) {
    const { data: schon } = await sb
      .from("einsatzplan_archiv")
      .select("id")
      .eq("jahr", jahr)
      .eq("kw", kw)
      .eq("automatisch", true)
      .limit(1);
    if (schon && schon.length > 0) return json({ ok: true, uebersprungen: true, jahr, kw });
  }

  // ── Daten laden — dieselben Quellen wie der Bildschirm-Export ──────────
  const [bsRes, paRes, prRes, zRes, abwRes] = await Promise.all([
    sb.from("baustellen").select("id, bvh_name, kostenstelle, bauleiter_id, kategorie").range(0, 9999),
    sb.from("partien").select("id, name, farbcode, partieleiter_id, sort_order"),
    sb
      .from("profiles")
      .select("id, vorname, nachname, partie_id, planungsfarbe, ist_bauleiter, is_active")
      .range(0, 9999),
    // Ohne obere Grenze: auch Einsätze, die erst nach dem Zeitraum beginnen,
    // stehen in der Liste (wie am Bildschirm, nur ohne Balken).
    sb.from("poliereinsatz_zeitraeume").select("*").gte("bis_datum", von).range(0, 9999),
    sb
      .from("stunden_tage")
      .select("mitarbeiter_id, datum, tag_status")
      .in("tag_status", ["urlaub", "krank", "schlechtwetter", "berufsschule"])
      .gte("datum", von)
      .lte("datum", bis)
      .range(0, 9999),
  ]);
  const fehler = bsRes.error ?? paRes.error ?? prRes.error ?? zRes.error ?? abwRes.error;
  if (fehler) return json({ ok: false, fehler: fehler.message }, 500);

  const baustellen = (bsRes.data ?? []) as Array<Record<string, unknown>>;
  const partien = (paRes.data ?? []) as PartieRow[];
  const profiles = (prRes.data ?? []) as Array<{
    id: string;
    vorname: string;
    nachname: string;
    partie_id: string | null;
    planungsfarbe: string | null;
    ist_bauleiter: boolean | null;
    is_active: boolean | null;
  }>;
  const zeitraeume = (zRes.data ?? []) as Array<Record<string, unknown>>;
  const profilesById = Object.fromEntries(profiles.map((p) => [p.id, p]));

  // Arbeitszeitkalender: kurze Wochen und Betriebsurlaub als freie Tage.
  const jahre = Array.from(new Set([Number(von.slice(0, 4)), Number(bis.slice(0, 4))]));
  const { data: kal } = await sb
    .from("arbeitszeitkalender")
    .select("jahr, kw, wochentyp, soll_mo, soll_di, soll_mi, soll_do, soll_fr")
    .in("jahr", jahre);
  const frei = new Set<string>();
  const bu = new Set<string>();
  for (const r of (kal ?? []) as Array<Record<string, unknown>>) {
    const mon = isoWeekMondayIso(Number(r.jahr), Number(r.kw));
    const perDay = [r.soll_mo, r.soll_di, r.soll_mi, r.soll_do, r.soll_fr];
    for (let wd = 0; wd < 5; wd++) {
      const tag = addDays(mon, wd);
      if (r.wochentyp === "BU") {
        frei.add(tag);
        bu.add(tag);
      } else if (perDay[wd] != null && Number(perDay[wd]) === 0) {
        frei.add(tag);
      }
    }
  }

  const abwMap = new Map<string, Map<string, string>>();
  for (const r of (abwRes.data ?? []) as Array<{ mitarbeiter_id: string; datum: string; tag_status: string }>) {
    if (!abwMap.has(r.mitarbeiter_id)) abwMap.set(r.mitarbeiter_id, new Map());
    abwMap.get(r.mitarbeiter_id)!.set(r.datum, r.tag_status);
  }

  const baustellenMap: Record<string, PdfBaustelle> = {};
  for (const b of baustellen) {
    const bl = b.bauleiter_id ? profilesById[b.bauleiter_id as string] : null;
    baustellenMap[b.id as string] = {
      bvh_name: (b.bvh_name as string) ?? null,
      kostenstelle: (b.kostenstelle as string) ?? null,
      bauleiterName: bl ? bl.nachname : null,
      farbe: bl?.planungsfarbe ?? "#6b7280",
      istBaustelle: b.kategorie !== "maschine",
    };
  }

  // Gruppen wie am Bildschirm: Partien mit Leiter oder mit Einsatz.
  const partienMitEinsatz = new Set(zeitraeume.map((z) => z.partie_id as string));
  const pdfPartien = partien
    .filter((p) => p.partieleiter_id || partienMitEinsatz.has(p.id))
    .sort(vergleichePartien);
  const inGruppe = new Set<string>();
  for (const p of pdfPartien) {
    for (const m of profiles) if (m.partie_id === p.id && m.is_active !== false) inGruppe.add(m.id);
  }
  const bauleiterIds = new Set(
    profiles.filter((p) => p.ist_bauleiter === true && p.is_active !== false).map((p) => p.id),
  );

  const abwesenheiten: PdfAbwesenheit[] = profiles
    .filter((p) => abwMap.has(p.id) || bauleiterIds.has(p.id))
    .map((p) => ({
      name: p.nachname,
      vollname: `${p.vorname} ${p.nachname}`,
      partieId: p.partie_id,
      tage: abwMap.get(p.id) ?? new Map<string, string>(),
      planungsfarbe: p.planungsfarbe ?? null,
      imUnterenBlock: bauleiterIds.has(p.id) || !inGruppe.has(p.id),
      immerZeigen: bauleiterIds.has(p.id),
    }));

  const input: PoliereinsatzPdfInput = {
    von,
    bis,
    format,
    partien: pdfPartien.map((p) => ({
      id: p.id,
      name: p.name,
      farbcode: p.farbcode,
      leiterName: p.partieleiter_id ? (profilesById[p.partieleiter_id]?.nachname ?? null) : null,
    })),
    zeitraeume: zeitraeume.map((z) => ({
      id: z.id as string,
      partie_id: z.partie_id as string,
      baustelle_id: z.baustelle_id as string,
      von_datum: z.von_datum as string,
      bis_datum: z.bis_datum as string,
      start_fix: (z.start_fix as boolean | null) ?? null,
    })),
    baustellen: baustellenMap,
    abwesenheiten,
    heute,
    freieTage: [...frei],
    buTage: [...bu],
  };

  let bytes: Uint8Array;
  try {
    const doc = makePoliereinsatzPdf(input);
    bytes = new Uint8Array(doc.output("arraybuffer"));
  } catch (e) {
    return json({ ok: false, fehler: `PDF: ${(e as Error).message}` }, 500);
  }

  // ── Ablage 1: Storage-Archiv ────────────────────────────────────────────
  // „2026-09-18 1352“ — Datum und Uhrzeit, damit manuelle Läufe unterscheidbar bleiben.
  const stempel = new Date()
    .toLocaleString("sv-SE", { timeZone: "Europe/Vienna" })
    .slice(0, 16)
    .replace(":", "");
  const dateiname = automatisch ? `KW${kw}.pdf` : `KW${kw} ${von} bis ${bis} (${stempel}).pdf`;
  const storagePfad = `${jahr}/${dateiname}`;
  const up = await sb.storage
    .from("einsatzplaene")
    .upload(storagePfad, bytes, { contentType: "application/pdf", upsert: false });
  if (up.error) return json({ ok: false, fehler: `Ablage: ${up.error.message}` }, 500);

  // ── Ablage 2: SharePoint (nie ersetzen — conflictBehavior rename) ───────
  let spItemId: string | null = null;
  let spWebUrl: string | null = null;
  let spFehler: string | null = null;
  const { data: ziel } = await sb
    .from("app_settings")
    .select("value")
    .eq("key", "einsatzplan_sharepoint")
    .maybeSingle();
  // Ziel: entweder fester Ordner (item_id) oder — seit 23.09.2026 — ein
  // Elternordner mit Jahresmuster („Einsatzplanung PDF {jahr}"), damit 2027
  // nicht im 2026er Ordner landet. Der Jahresordner wird angelegt, wenn er fehlt.
  const zielWert = (ziel?.value ?? null) as {
    drive_id?: string;
    item_id?: string;
    eltern_item_id?: string;
    ordner_muster?: string;
  } | null;
  // Nur-Archiv-Lauf (Prüfung): { ohne_sharepoint: true } lässt SharePoint aus.
  const ohneSharePoint = body.ohne_sharepoint === true;
  if (ohneSharePoint) {
    spFehler = "ausgelassen (nur Archiv)";
  } else if (zielWert?.drive_id && (zielWert?.item_id || zielWert?.eltern_item_id)) {
    if (!graphKonfiguriert()) {
      spFehler = "Graph-Zugangsdaten fehlen";
    } else {
      try {
        let ordnerId = zielWert.item_id ?? "";
        if (zielWert.eltern_item_id && zielWert.ordner_muster) {
          const name = zielWert.ordner_muster.replace("{jahr}", String(jahr));
          const da = await kindMitNamen(zielWert.drive_id, zielWert.eltern_item_id, name);
          if (da && !da.folder) throw new Error(`„${name}" ist eine Datei, kein Ordner`);
          ordnerId = da?.id ?? (await ordnerAnlegen(zielWert.drive_id, zielWert.eltern_item_id, name)).item.id;
        }
        const item = await dateiHochladen(
          zielWert.drive_id,
          ordnerId,
          dateiname,
          bytes,
          "application/pdf",
        );
        spItemId = item.id ?? null;
        spWebUrl = (item as { webUrl?: string }).webUrl ?? null;
      } catch (e) {
        spFehler = (e as Error).message;
      }
    }
  }

  const { data: zeile, error: insErr } = await sb
    .from("einsatzplan_archiv")
    .insert({
      jahr,
      kw,
      von_datum: von,
      bis_datum: bis,
      format,
      storage_pfad: storagePfad,
      dateiname,
      groesse: bytes.byteLength,
      sharepoint_item_id: spItemId,
      sharepoint_web_url: spWebUrl,
      sharepoint_fehler: spFehler,
      automatisch,
      erzeugt_von: alsUserId,
    })
    .select("id")
    .single();
  if (insErr) return json({ ok: false, fehler: `Archiv-Eintrag: ${insErr.message}` }, 500);

  return json({
    ok: true,
    id: zeile?.id,
    jahr,
    kw,
    von,
    bis,
    format,
    dateiname,
    groesse: bytes.byteLength,
    sharepoint: spItemId ? "abgelegt" : spFehler ?? "kein Ziel",
  });
});
