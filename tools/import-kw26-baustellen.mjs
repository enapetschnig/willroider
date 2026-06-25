/**
 * Legt fehlende Baustellen aus `/tmp/KW26.json` an.
 *
 * MS-Project-Resources sind die echten Baustellen-Namen
 * (z. B. „HMH Wadl", „Pointinger"). Jede Sub-Task mit `notes`
 * (Bauleiter-Nachname) ist via `assignment.resource_unique_id` an
 * eine Resource gebunden. Wir nehmen diese Resource als Baustelle.
 *
 * Kostenstelle wird aus `task.text3` (z. B. „4030") rekonstruiert
 * mit dem App-Präfix `"140" + text3` → „1404030" — matcht das
 * Format der bestehenden Baustellen.
 *
 * Idempotent über `kostenstelle` UNIQUE-Index — re-runs upserten.
 *
 * Aufruf:
 *   SUPABASE_SERVICE_ROLE_KEY=... node tools/import-kw26-baustellen.mjs           # Dry-Run
 *   SUPABASE_SERVICE_ROLE_KEY=... node tools/import-kw26-baustellen.mjs --apply   # Real
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./test-config.mjs";

const APPLY = process.argv.includes("--apply");
const JSON_PATH = "/tmp/KW26.json";
const NOTE_TAG = "Aus KW26.mpp importiert am 2026-06-25";
const SKIP_RESOURCES = new Set(
  ["urlaub", "krank", "bvh", "bauhof", "lager", "werkstatt"].map((s) => s),
);

function requireKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) {
    console.error("FEHLER: SUPABASE_SERVICE_ROLE_KEY-Env-Var fehlt.");
    process.exit(1);
  }
  return k;
}

function normKstFromText3(text3) {
  // Excel-MPP-text3 ist 4-stellig („4030"). App-Format ist „1404030"
  // (140 = Mandant). Wir prefixen, falls Kürzel kürzer als 7 Zeichen.
  const t = String(text3 ?? "").trim();
  if (!t) return null;
  if (t.startsWith("140") && t.length >= 6) return t;
  return "140" + t;
}

async function main() {
  const key = requireKey();
  const admin = createClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`[2/5] KW26.json: ${JSON_PATH}`);
  console.log(`[2/5] Supabase:  ${SUPABASE_URL}`);
  console.log(`[2/5] Mode:      ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log();

  // 1) JSON parsen, Assignments für KW26 (22.-28.06.) filtern
  const d = JSON.parse(readFileSync(JSON_PATH, "utf8"));
  const taskMap = new Map(d.tasks.map((t) => [t.unique_id, t]));
  const resMap = new Map(d.resources.map((r) => [r.unique_id, r]));
  const inKw26 = (assignment) => {
    const s = assignment.start?.slice(0, 10);
    const f = assignment.finish?.slice(0, 10);
    if (!s || !f) return false;
    return f >= "2026-06-22" && s <= "2026-06-28";
  };

  // Nur Tasks mit einem work_split, der KW26 (22.-28.06.) abdeckt.
  // Das filtert die Jahresplanung auf die wirklich aktive Woche.
  const dayInRange = (s, e, day) => day >= s && day <= e;
  const KW26_DAYS = [
    "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25",
    "2026-06-26", "2026-06-27", "2026-06-28",
  ];
  const taskHasKw26Split = (task) =>
    (task.work_splits || []).some((sp) => {
      const s = sp.start?.slice(0, 10);
      const e = sp.end?.slice(0, 10);
      if (!s || !e) return false;
      return KW26_DAYS.some((day) => dayInRange(s, e, day));
    });

  const seen = new Map(); // lowercase bvh_name → { kst, bvh_name }
  for (const a of d.assignments) {
    if (!inKw26(a)) continue;
    const task = taskMap.get(a.task_unique_id);
    const res = resMap.get(a.resource_unique_id);
    if (!task || !res) continue;
    if (!task.notes) continue;
    if (!taskHasKw26Split(task)) continue;
    const lowName = (res.name || "").toLowerCase().trim();
    if (!lowName || SKIP_RESOURCES.has(lowName)) continue;
    const kst = normKstFromText3(task.text3);
    const cur = seen.get(lowName);
    if (!cur) {
      seen.set(lowName, { kst, bvh_name: res.name.trim() });
    } else if (!cur.kst && kst) {
      cur.kst = kst;
    }
  }
  const planList = [...seen.values()];
  console.log(`[2/5] PLAN: ${planList.length} distinkte Baustellen aus KW26-Assignments`);
  planList.forEach((p) =>
    console.log(`  ${String(p.kst).padEnd(8)} | ${p.bvh_name}`),
  );

  // 2) Bestehende Baustellen abgleichen
  const { data: existing, error: bErr } = await admin
    .from("baustellen")
    .select("id, bvh_name, kostenstelle, status");
  if (bErr) {
    console.error("baustellen-Read-Fehler:", bErr.message);
    process.exit(1);
  }
  const byKst = new Map(
    existing
      .filter((b) => b.kostenstelle)
      .map((b) => [b.kostenstelle, b]),
  );
  const byName = new Map(
    existing.map((b) => [b.bvh_name.toLowerCase().trim(), b]),
  );

  // Konservatives Matching: NUR wenn der bvh_name (case-insensitive)
  // direkt einer DB-Baustelle entspricht, machen wir UPDATE. Sonst neu
  // anlegen — eine andere KST auf gleichem 4-Ziffern-Suffix darf nicht
  // dazu führen, dass die App-Baustelle „Balkone Mittewald" plötzlich
  // als „Perkonig" doppelbelegt wird.
  const toCreate = [], toUpdate = [], kstConflicts = [];
  for (const p of planList) {
    const existName = byName.get(p.bvh_name.toLowerCase());
    if (existName) {
      toUpdate.push({ ...p, existing: existName });
      continue;
    }
    // KST-Konflikt erkennen, aber NICHT als Match werten — neu anlegen
    // mit kst=null (App hält die alte Baustelle mit der KST), und wir
    // loggen den Konflikt explizit, damit der User später per UI
    // entscheidet, ob er sie zusammenführen will.
    if (p.kst && byKst.has(p.kst)) {
      kstConflicts.push({ ...p, existing: byKst.get(p.kst) });
      toCreate.push({ ...p, kst: null });
    } else {
      toCreate.push(p);
    }
  }
  console.log();
  console.log(`[2/5] ${toCreate.length} NEU, ${toUpdate.length} UPDATE, ${kstConflicts.length} KST-Konflikt(e)`);
  console.log();
  console.log("--- NEU ---");
  toCreate.forEach((p) => console.log(`  ${String(p.kst ?? "null").padEnd(8)} | ${p.bvh_name}`));
  console.log("--- UPDATE (name-match) ---");
  toUpdate.forEach((u) =>
    console.log(
      `  ${String(u.kst ?? "null").padEnd(8)} | ${u.bvh_name}  → ${u.existing.bvh_name} (status: ${u.existing.status})`,
    ),
  );
  if (kstConflicts.length > 0) {
    console.log();
    console.log("--- KST-KONFLIKTE (gleiche Kostenstelle, anderer Name — neu als kst=null angelegt) ---");
    kstConflicts.forEach((c) =>
      console.log(
        `  ${c.kst} | MPP-Name '${c.bvh_name}' vs. DB-Name '${c.existing.bvh_name}' → manuell prüfen`,
      ),
    );
  }

  if (!APPLY) {
    console.log();
    console.log("[2/5] DRY-RUN beendet. Mit --apply real anwenden.");
    return;
  }

  console.log();
  console.log("[2/5] APPLY läuft …");

  let cNew = 0, cUpd = 0, cErr = 0;

  // Pro Apply: KST-Slots tracken (existierende + neu eingefügte),
  // damit wir bei einem zweiten Insert mit gleicher KST auf kst=null
  // ausweichen statt UNIQUE-Constraint zu reißen.
  const usedKst = new Set(existing.filter((b) => b.kostenstelle).map((b) => b.kostenstelle));
  for (const p of toCreate) {
    let kst = p.kst;
    if (kst && usedKst.has(kst)) {
      console.log(`  [NOTE] KST ${kst} kollidiert, lege ${p.bvh_name} mit kst=null an`);
      kst = null;
    }
    try {
      const { error } = await admin.from("baustellen").insert({
        bvh_name: p.bvh_name,
        kostenstelle: kst,
        status: "aktiv",
        notizen: NOTE_TAG,
      });
      if (error) throw error;
      if (kst) usedKst.add(kst);
      cNew++;
      console.log(`  [NEU] ${String(kst ?? "null").padEnd(8)} | ${p.bvh_name}`);
    } catch (e) {
      cErr++;
      console.error(`  [ERR] ${p.bvh_name}: ${e.message}`);
    }
  }
  for (const u of toUpdate) {
    try {
      const newNotes = u.existing.notizen
        ? u.existing.notizen.includes(NOTE_TAG)
          ? u.existing.notizen
          : u.existing.notizen + "\n" + NOTE_TAG
        : NOTE_TAG;
      // Kst nur setzen wenn vorher leer UND nicht schon woanders verbraucht
      const fields = { status: "aktiv", notizen: newNotes };
      if (!u.existing.kostenstelle && u.kst && !usedKst.has(u.kst)) {
        fields.kostenstelle = u.kst;
        usedKst.add(u.kst);
      }
      const { error } = await admin
        .from("baustellen")
        .update(fields)
        .eq("id", u.existing.id);
      if (error) throw error;
      cUpd++;
      console.log(`  [UPD] ${u.existing.bvh_name}`);
    } catch (e) {
      cErr++;
      console.error(`  [ERR] ${u.bvh_name}: ${e.message}`);
    }
  }

  console.log();
  console.log(`[2/5] FERTIG: ${cNew} neu, ${cUpd} aktualisiert, ${cErr} Fehler`);
  if (cErr > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
