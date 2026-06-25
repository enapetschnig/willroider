/**
 * Schreibt die KW26-Einteilungen in jahresplan_einteilungen +
 * jahresplan_mitarbeiter UND einteilungen + einteilung_mitarbeiter.
 *
 * Quelle: `/tmp/KW26.json` (MPXJ-Konvertierung). Pro Sub-Task mit
 * Bauleiter-Notiz und work_split in KW26 wird eine Einteilungs-Zeile
 * pro Tag angelegt:
 *
 *   baustelle  := match(assignment.resource.name, baustellen.bvh_name)
 *   mitarbeiter := match(task.notes, profiles.nachname)
 *
 * Idempotent: vor INSERT werden alle vorherigen KW26-Import-Einteilungen
 * gelöscht (taetigkeit LIKE 'KW26-import:%').
 *
 * Aufruf:
 *   SUPABASE_SERVICE_ROLE_KEY=... node tools/import-kw26-planung.mjs           # Dry-Run
 *   SUPABASE_SERVICE_ROLE_KEY=... node tools/import-kw26-planung.mjs --apply   # Real
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./test-config.mjs";

const APPLY = process.argv.includes("--apply");
const JSON_PATH = "/tmp/KW26.json";
const KW26_DAYS = [
  "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25",
  "2026-06-26", "2026-06-27", "2026-06-28",
];

function requireKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) {
    console.error("FEHLER: SUPABASE_SERVICE_ROLE_KEY fehlt.");
    process.exit(1);
  }
  return k;
}

function normalize(s) {
  return (s ?? "")
    .toString()
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .trim();
}

async function main() {
  const key = requireKey();
  const admin = createClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`[3/5] KW26.json: ${JSON_PATH}`);
  console.log(`[3/5] Supabase:  ${SUPABASE_URL}`);
  console.log(`[3/5] Mode:      ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log();

  // 1) JSON laden
  const d = JSON.parse(readFileSync(JSON_PATH, "utf8"));
  const taskMap = new Map(d.tasks.map((t) => [t.unique_id, t]));
  const resMap = new Map(d.resources.map((r) => [r.unique_id, r]));

  // 2) Profile + Baustellen laden
  const { data: profiles, error: pErr } = await admin
    .from("profiles")
    .select("id, vorname, nachname, pers_nr")
    .eq("is_active", true);
  if (pErr) throw pErr;
  const { data: baustellen, error: bErr } = await admin
    .from("baustellen")
    .select("id, bvh_name, kostenstelle");
  if (bErr) throw bErr;
  const byBvh = new Map(baustellen.map((b) => [normalize(b.bvh_name), b]));

  // 3) Bauleiter-Match (Egger S → Sebastian, Egger → Eckart)
  const matchBauleiter = (notes) => {
    const raw = (notes || "").trim();
    if (!raw) return { match: null, candidates: [] };
    const norm = normalize(raw);
    // „Egger S" oder „Egger S." → Sebastian Egger
    if (/^egger s\.?$/i.test(raw)) {
      return {
        match: profiles.find(
          (p) =>
            normalize(p.nachname) === "egger" &&
            normalize(p.vorname).startsWith("sebastian"),
        ) ?? null,
        candidates: [],
      };
    }
    if (norm === "egger") {
      // bare Egger → Eckart
      return {
        match: profiles.find(
          (p) =>
            normalize(p.nachname) === "egger" &&
            normalize(p.vorname).startsWith("eckart"),
        ) ?? null,
        candidates: [],
      };
    }
    const cand = profiles.filter((p) => normalize(p.nachname) === norm);
    if (cand.length === 1) return { match: cand[0], candidates: cand };
    return { match: null, candidates: cand };
  };

  // 4) Pro KW26-Tag, pro Sub-Task mit work_split → Einteilungs-Zeile
  const dayInRange = (s, e, d) => d >= s && d <= e;
  const planRows = [];
  for (const t of d.tasks) {
    if (!t.notes) continue;
    const ml = matchBauleiter(t.notes);
    if (!ml.match) continue;
    // Resource via Assignment ermitteln
    const ass = d.assignments.find((a) => a.task_unique_id === t.unique_id);
    if (!ass) continue;
    const res = resMap.get(ass.resource_unique_id);
    if (!res) continue;
    const bs = byBvh.get(normalize(res.name));
    if (!bs) continue;
    for (const split of t.work_splits || []) {
      const sd = split.start?.slice(0, 10);
      const ed = split.end?.slice(0, 10);
      if (!sd || !ed) continue;
      for (const day of KW26_DAYS) {
        if (dayInRange(sd, ed, day)) {
          planRows.push({
            datum: day,
            baustelle_id: bs.id,
            baustelle_name: bs.bvh_name,
            mitarbeiter_id: ml.match.id,
            mitarbeiter_name: `${ml.match.vorname} ${ml.match.nachname}`,
            taetigkeit: `KW26-import:${res.name.trim()}`,
          });
        }
      }
    }
  }
  console.log(`[3/5] PLAN: ${planRows.length} Einteilungs-Zeilen über ${KW26_DAYS.length} Tage`);

  // Pro Tag eine Übersicht
  for (const day of KW26_DAYS) {
    const rows = planRows.filter((r) => r.datum === day);
    if (rows.length === 0) continue;
    console.log(`\n  ${day}:`);
    rows.forEach((r) =>
      console.log(`    ${r.mitarbeiter_name.padEnd(22)} → ${r.baustelle_name}`),
    );
  }

  if (!APPLY) {
    console.log();
    console.log("[3/5] DRY-RUN beendet. Mit --apply real anwenden.");
    return;
  }

  console.log();
  console.log("[3/5] APPLY läuft …");

  // 5) Idempotenz: alle bestehenden KW26-Import-Einträge löschen
  for (const day of KW26_DAYS) {
    await admin
      .from("jahresplan_einteilungen")
      .delete()
      .eq("datum", day)
      .like("taetigkeit", "KW26-import:%");
    await admin
      .from("einteilungen")
      .delete()
      .eq("datum", day)
      .like("taetigkeit", "KW26-import:%");
  }
  console.log(`[3/5] Alte KW26-Import-Einteilungen gelöscht`);

  // 6) Pro (datum, baustelle, taetigkeit) eine Einteilung anlegen (oder
  //    finden) — Mitarbeiter dann via Junction. Gruppieren erst.
  const grouped = new Map(); // key = `${datum}|${baustelle_id}|${taetigkeit}` → { …, ma_ids: Set }
  for (const r of planRows) {
    const k = `${r.datum}|${r.baustelle_id}|${r.taetigkeit}`;
    if (!grouped.has(k)) {
      grouped.set(k, {
        datum: r.datum,
        baustelle_id: r.baustelle_id,
        taetigkeit: r.taetigkeit,
        ma_ids: new Set(),
      });
    }
    grouped.get(k).ma_ids.add(r.mitarbeiter_id);
  }

  let cJp = 0, cTp = 0, cErr = 0;
  for (const g of grouped.values()) {
    try {
      // 6a) Jahresplan
      const { data: jp, error: jpErr } = await admin
        .from("jahresplan_einteilungen")
        .insert({
          datum: g.datum,
          baustelle_id: g.baustelle_id,
          taetigkeit: g.taetigkeit,
        })
        .select("id")
        .single();
      if (jpErr) throw jpErr;
      for (const mid of g.ma_ids) {
        const { error: jmErr } = await admin
          .from("jahresplan_mitarbeiter")
          .insert({ einteilung_id: jp.id, mitarbeiter_id: mid });
        if (jmErr) throw jmErr;
      }
      cJp++;

      // 6b) Tagesplanung (gleiche Struktur)
      const { data: tp, error: tpErr } = await admin
        .from("einteilungen")
        .insert({
          datum: g.datum,
          baustelle_id: g.baustelle_id,
          taetigkeit: g.taetigkeit,
        })
        .select("id")
        .single();
      if (tpErr) throw tpErr;
      for (const mid of g.ma_ids) {
        const { error: emErr } = await admin
          .from("einteilung_mitarbeiter")
          .insert({ einteilung_id: tp.id, mitarbeiter_id: mid });
        if (emErr) throw emErr;
      }
      cTp++;
    } catch (e) {
      cErr++;
      console.error(`  [ERR] ${g.datum} | ${g.taetigkeit}: ${e.message}`);
    }
  }
  console.log();
  console.log(
    `[3/5] FERTIG: Jahresplan=${cJp}, Tagesplanung=${cTp}, Fehler=${cErr}`,
  );
  if (cErr > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
