/**
 * Deep-Verify für KW26-Planung: vergleicht /tmp/KW26.json gegen die
 * importierten jahresplan_einteilungen + einteilungen Tag-für-Tag.
 *
 * Erwartung: pro Tag, pro Bauleiter, pro Baustelle eine Zeile mit
 * korrekter Verknüpfung.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./test-config.mjs";

const KW26_DAYS = [
  "2026-06-22","2026-06-23","2026-06-24","2026-06-25",
  "2026-06-26","2026-06-27","2026-06-28",
];

const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY fehlt"); process.exit(1); }
const admin = createClient(SUPABASE_URL, key, { auth: { autoRefreshToken: false, persistSession: false } });

const norm = (s) => (s ?? "").toString().toLowerCase().replace(/ß/g,"ss").replace(/ä/g,"a").replace(/ö/g,"o").replace(/ü/g,"u").trim();

// 1) MPP-Erwartung extrahieren
const d = JSON.parse(readFileSync("/tmp/KW26.json","utf8"));
const taskMap = new Map(d.tasks.map(t => [t.unique_id, t]));
const resMap = new Map(d.resources.map(r => [r.unique_id, r]));
const dayInRange = (s,e,d) => d >= s && d <= e;

// MPP-soll: Map<datum, Set<"bauleiter|baustelle">>
const soll = new Map();
KW26_DAYS.forEach(day => soll.set(day, new Set()));
for (const t of d.tasks) {
  if (!t.notes) continue;
  const bauleiter = t.notes.trim();
  const ass = d.assignments.find(a => a.task_unique_id === t.unique_id);
  if (!ass) continue;
  const res = resMap.get(ass.resource_unique_id);
  if (!res) continue;
  const lowName = (res.name||"").toLowerCase().trim();
  if (["urlaub","krank","bvh","bauhof","lager","werkstatt"].includes(lowName)) continue;
  for (const sp of t.work_splits || []) {
    const s = sp.start?.slice(0,10), e = sp.end?.slice(0,10);
    if (!s || !e) continue;
    for (const day of KW26_DAYS) {
      if (dayInRange(s,e,day)) {
        soll.get(day).add(`${bauleiter}|${res.name.trim()}`);
      }
    }
  }
}

// 2) DB-IST holen
const [{ data: profiles }, { data: baustellen }, { data: jp }, { data: jpMa }, { data: tp }, { data: tpMa }] = await Promise.all([
  admin.from("profiles").select("id, vorname, nachname"),
  admin.from("baustellen").select("id, bvh_name"),
  admin.from("jahresplan_einteilungen").select("id, datum, baustelle_id, taetigkeit").gte("datum", KW26_DAYS[0]).lte("datum", KW26_DAYS[6]).like("taetigkeit", "KW26-import:%"),
  admin.from("jahresplan_mitarbeiter").select("einteilung_id, mitarbeiter_id"),
  admin.from("einteilungen").select("id, datum, baustelle_id, taetigkeit").gte("datum", KW26_DAYS[0]).lte("datum", KW26_DAYS[6]).like("taetigkeit", "KW26-import:%"),
  admin.from("einteilung_mitarbeiter").select("einteilung_id, mitarbeiter_id"),
]);

const profilesById = new Map(profiles.map(p => [p.id, p]));
const baustellenById = new Map(baustellen.map(b => [b.id, b]));

function buildIst(planungen, mas) {
  // planungen + junction → Map<datum, Set<"bauleiter|baustelle">>
  const ist = new Map();
  KW26_DAYS.forEach(d => ist.set(d, new Set()));
  const byEinteilung = new Map();
  planungen.forEach(p => byEinteilung.set(p.id, p));
  for (const m of mas) {
    const e = byEinteilung.get(m.einteilung_id);
    if (!e) continue;
    const bs = baustellenById.get(e.baustelle_id);
    const ma = profilesById.get(m.mitarbeiter_id);
    if (!bs || !ma) continue;
    if (!ist.has(e.datum)) continue;
    ist.get(e.datum).add(`${ma.nachname}|${bs.bvh_name.trim()}`);
  }
  return ist;
}

const jahresplanIst = buildIst(jp, jpMa);
const tagesplanIst = buildIst(tp, tpMa);

function diffSets(sollSet, istSet, label) {
  const sollNorm = new Set([...sollSet].map(norm));
  const istNorm = new Set([...istSet].map(norm));
  const fehlt = [...sollSet].filter(x => !istNorm.has(norm(x)));
  const zuviel = [...istSet].filter(x => !sollNorm.has(norm(x)));
  return { fehlt, zuviel };
}

console.log("\n=== Jahresplan vs MPP ===");
let totalFehlt = 0, totalZuviel = 0;
for (const day of KW26_DAYS) {
  const { fehlt, zuviel } = diffSets(soll.get(day), jahresplanIst.get(day), `${day} JP`);
  if (fehlt.length || zuviel.length) {
    console.log(`  ${day}: ${jahresplanIst.get(day).size} Einträge | ${soll.get(day).size} im MPP`);
    fehlt.forEach(f => { console.log(`    FEHLT in DB: ${f}`); totalFehlt++; });
    zuviel.forEach(z => { console.log(`    ZUVIEL in DB: ${z}`); totalZuviel++; });
  } else {
    console.log(`  ${day}: ✓ ${jahresplanIst.get(day).size} Einträge — exakt`);
  }
}
console.log(`Jahresplan-Summe: ${totalFehlt} fehlend, ${totalZuviel} zuviel`);

console.log("\n=== Tagesplanung vs MPP ===");
let totalFehltT = 0, totalZuvielT = 0;
for (const day of KW26_DAYS) {
  const { fehlt, zuviel } = diffSets(soll.get(day), tagesplanIst.get(day), `${day} TP`);
  if (fehlt.length || zuviel.length) {
    console.log(`  ${day}: ${tagesplanIst.get(day).size} Einträge | ${soll.get(day).size} im MPP`);
    fehlt.forEach(f => { console.log(`    FEHLT in DB: ${f}`); totalFehltT++; });
    zuviel.forEach(z => { console.log(`    ZUVIEL in DB: ${z}`); totalZuvielT++; });
  } else {
    console.log(`  ${day}: ✓ ${tagesplanIst.get(day).size} Einträge — exakt`);
  }
}
console.log(`Tagesplanung-Summe: ${totalFehltT} fehlend, ${totalZuvielT} zuviel`);

const ok = totalFehlt === 0 && totalZuviel === 0 && totalFehltT === 0 && totalZuvielT === 0;
console.log(`\n${ok ? "✓ ALLES PERFEKT" : "✗ DIFFS gefunden"}`);
process.exit(ok ? 0 : 1);
