/**
 * Ergänzt die KW26-Einteilungen um Polier-Partie + Mannschaft.
 *
 * Bisheriger Stand: pro Sub-Task war nur der Bauleiter (task.notes)
 * eingetragen. Jetzt: zusätzlich der Polier der Parent-Überschrift +
 * alle Mannschafts-MA seiner Partie.
 *
 * Pro KW26-Tag pro Sub-Task mit work_split:
 *   parent.name     → Polier-Partie (DB-Match per name)
 *   task.notes      → Bauleiter-Nachname (Egger-Disambig: 'Egger S.' = Sebastian)
 *   resource.name   → Baustelle (DB-Match per bvh_name)
 *   Set aller MA    = Partie-Mitglieder (Polier + Mannschaft) + Bauleiter
 *
 * Idempotent: nutzt jahresplan_mitarbeiter UNIQUE(einteilung_id, mitarbeiter_id).
 *
 * Sonderfälle (Parent-Überschrift ohne klare Partie):
 *  - Tripold      → nur Martin Tripolt (Pers 523) + Bauleiter, keine Mannschaft
 *  - Reibnegger   → nur Andreas Reibnegger (10083) + Bauleiter
 *  - Flocken      → nur Bauleiter
 *  - Abbund K2/SC4, Supunternehmer, Urlaube:, KW13 → nur Bauleiter
 *
 * Aufruf:
 *   SUPABASE_SERVICE_ROLE_KEY=… node tools/import-kw26-mannschaft.mjs           # Dry
 *   SUPABASE_SERVICE_ROLE_KEY=… node tools/import-kw26-mannschaft.mjs --apply
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./test-config.mjs";

const APPLY = process.argv.includes("--apply");
const JSON_PATH = "/tmp/KW26.json";
const KW26_DAYS = [
  "2026-06-22","2026-06-23","2026-06-24","2026-06-25",
  "2026-06-26","2026-06-27","2026-06-28",
];

const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY fehlt"); process.exit(1); }
const admin = createClient(SUPABASE_URL, key, { auth: { autoRefreshToken: false, persistSession: false } });

const norm = (s) => (s ?? "").toString().toLowerCase().replace(/ß/g,"ss").replace(/ä/g,"a").replace(/ö/g,"o").replace(/ü/g,"u").trim();

console.log(`[Mannschaft] Mode: ${APPLY ? "APPLY" : "DRY"}`);

// 1) MPP laden + nach outline_number sortieren
const d = JSON.parse(readFileSync(JSON_PATH, "utf8"));
const tasksSorted = d.tasks.filter((t) => t.outline_number).sort((a,b) => {
  const an = String(a.outline_number).split(".").map(Number);
  const bn = String(b.outline_number).split(".").map(Number);
  for (let i=0; i<Math.max(an.length,bn.length); i++) {
    const x = an[i]||0, y = bn[i]||0;
    if (x !== y) return x-y;
  }
  return 0;
});
const resMap = new Map(d.resources.map((r) => [r.unique_id, r]));
const assignByTaskUid = new Map(d.assignments.map((a) => [a.task_unique_id, a]));

// 2) Pro Sub-Task: parent setzen + Sub-Tasks bauen
let currentParent = null;
const subTasks = [];
for (const t of tasksSorted) {
  if (t.name && t.name.trim()) {
    currentParent = t.name.trim();
    continue;
  }
  if (!t.notes) continue;
  const ass = assignByTaskUid.get(t.unique_id);
  if (!ass) continue;
  const res = resMap.get(ass.resource_unique_id);
  if (!res) continue;
  subTasks.push({
    parent: currentParent,
    bauleiter: t.notes.trim(),
    baustelle: res.name.trim(),
    work_splits: t.work_splits ?? [],
  });
}
console.log(`[Mannschaft] ${subTasks.length} Sub-Tasks mit Bauleiter-Notiz`);

// 3) DB-Lookups
const [profilesRes, partienRes, baustellenRes, jpRes, jpMaRes, tpRes, tpMaRes] = await Promise.all([
  admin.from("profiles").select("id, vorname, nachname, pers_nr, partie_id, is_partieleiter, qualifikation"),
  admin.from("partien").select("id, name"),
  admin.from("baustellen").select("id, bvh_name"),
  admin.from("jahresplan_einteilungen").select("id, datum, baustelle_id, taetigkeit").gte("datum", KW26_DAYS[0]).lte("datum", KW26_DAYS[6]).like("taetigkeit", "KW26-import:%"),
  admin.from("jahresplan_mitarbeiter").select("einteilung_id, mitarbeiter_id"),
  admin.from("einteilungen").select("id, datum, baustelle_id, taetigkeit").gte("datum", KW26_DAYS[0]).lte("datum", KW26_DAYS[6]).like("taetigkeit", "KW26-import:%"),
  admin.from("einteilung_mitarbeiter").select("einteilung_id, mitarbeiter_id"),
]);
const profiles = profilesRes.data;
const partien = partienRes.data;
const baustellen = baustellenRes.data;

// 4) Polier-Partie-Mapping: Parent-Name → Partie-MA-Liste
const partieByName = new Map(partien.map(p => [norm(p.name), p]));
const profilesByPartie = new Map();
for (const p of profiles) {
  if (!p.partie_id) continue;
  if (!profilesByPartie.has(p.partie_id)) profilesByPartie.set(p.partie_id, []);
  profilesByPartie.get(p.partie_id).push(p);
}

function resolvePartie(parentName) {
  // direkter Match
  const direct = partieByName.get(norm(parentName));
  if (direct) return profilesByPartie.get(direct.id) ?? [];
  // Sonderfälle ohne eigene Partie:
  if (norm(parentName) === "tripold") {
    // Nur Martin Tripolt (Pers 523), keine Mannschaft
    const p = profiles.find(x => String(x.pers_nr ?? "").trim() === "523");
    return p ? [p] : [];
  }
  if (norm(parentName) === "reibnegger") {
    const p = profiles.find(x => String(x.pers_nr ?? "").trim() === "10083");
    return p ? [p] : [];
  }
  // Flocken, Abbund K2/SC4, Supunternehmer, Urlaube:, KW13 → leer
  return [];
}

// 5) Bauleiter auflösen (mit Egger-Disambig)
function resolveBauleiter(notes) {
  const raw = (notes||"").trim();
  if (!raw) return null;
  if (/^egger s\.?$/i.test(raw)) {
    return profiles.find(p => norm(p.nachname) === "egger" && norm(p.vorname).startsWith("sebastian")) ?? null;
  }
  if (norm(raw) === "egger") {
    return profiles.find(p => norm(p.nachname) === "egger" && norm(p.vorname).startsWith("eckart")) ?? null;
  }
  // Eindeutiger Nachname?
  const cands = profiles.filter(p => norm(p.nachname) === norm(raw));
  if (cands.length === 1) return cands[0];
  // Mehrdeutig — bei Bauleitern eigentlich nicht (sind alle GE)
  const ges = cands.filter(p => p.qualifikation === "Gehalt (GE)");
  if (ges.length === 1) return ges[0];
  return null;
}

// 6) Pro KW26-Tag pro Sub-Task die Soll-MA berechnen
const dayInRange = (s, e, day) => day >= s && day <= e;
const baustelleByName = new Map(baustellen.map(b => [norm(b.bvh_name), b]));

const sollPerKey = new Map(); // key = `${datum}|${baustelleId}` → Set<profileId>
const issuesSammlung = [];

for (const st of subTasks) {
  const bs = baustelleByName.get(norm(st.baustelle));
  if (!bs) { issuesSammlung.push(`Baustelle nicht in DB: ${st.baustelle}`); continue; }
  const bauleiter = resolveBauleiter(st.bauleiter);
  const partieMA = resolvePartie(st.parent);
  if (!bauleiter && partieMA.length === 0) {
    issuesSammlung.push(`Weder Bauleiter noch Partie auflösbar: parent=${st.parent} notes=${st.bauleiter} baustelle=${st.baustelle}`);
    continue;
  }
  for (const sp of st.work_splits) {
    const sd = sp.start?.slice(0,10), ed = sp.end?.slice(0,10);
    if (!sd || !ed) continue;
    for (const day of KW26_DAYS) {
      if (!dayInRange(sd, ed, day)) continue;
      const key = `${day}|${bs.id}`;
      if (!sollPerKey.has(key)) sollPerKey.set(key, new Set());
      const set = sollPerKey.get(key);
      partieMA.forEach(p => set.add(p.id));
      if (bauleiter) set.add(bauleiter.id);
    }
  }
}

console.log(`[Mannschaft] ${sollPerKey.size} (datum, baustelle)-Pärchen mit Soll-MA berechnet`);
if (issuesSammlung.length > 0) {
  console.log(`\n[Mannschaft] ${issuesSammlung.length} Issues:`);
  [...new Set(issuesSammlung)].forEach(i => console.log(`  • ${i}`));
}

// 7) Aktuelle DB-Einteilungen indizieren
const profById = new Map(profiles.map(p => [p.id, p]));
function indexEinteilungen(arr, junctionArr) {
  const out = new Map(); // `${datum}|${baustelleId}` → { id, currentMa: Set<profileId> }
  arr.forEach(e => {
    const key = `${e.datum}|${e.baustelle_id}`;
    if (!out.has(key)) out.set(key, { ids: [], currentMa: new Set() });
    out.get(key).ids.push(e.id);
  });
  junctionArr.forEach(m => {
    for (const [key, val] of out) {
      if (val.ids.includes(m.einteilung_id)) val.currentMa.add(m.mitarbeiter_id);
    }
  });
  return out;
}
const jpIdx = indexEinteilungen(jpRes.data, jpMaRes.data);
const tpIdx = indexEinteilungen(tpRes.data, tpMaRes.data);

// 8) Diff berechnen + Pläne
const planJp = [], planTp = [];
for (const [key, sollSet] of sollPerKey) {
  const jp = jpIdx.get(key);
  const tp = tpIdx.get(key);
  if (jp) {
    for (const maId of sollSet) {
      if (!jp.currentMa.has(maId)) {
        for (const eid of jp.ids) planJp.push({ einteilung_id: eid, mitarbeiter_id: maId });
      }
    }
  }
  if (tp) {
    for (const maId of sollSet) {
      if (!tp.currentMa.has(maId)) {
        for (const eid of tp.ids) planTp.push({ einteilung_id: eid, mitarbeiter_id: maId });
      }
    }
  }
}
console.log(`\n[Mannschaft] PLAN: ${planJp.length} jahresplan_mitarbeiter ergänzen, ${planTp.length} einteilung_mitarbeiter ergänzen`);

// Beispiel-Anzeige pro Datum
const byDay = {};
for (const [key, set] of sollPerKey) {
  const [day, bsId] = key.split("|");
  const bs = baustellen.find(b => b.id === bsId);
  byDay[day] = byDay[day] || [];
  byDay[day].push({ baustelle: bs?.bvh_name ?? "?", maNames: [...set].map(id => profById.get(id)).filter(Boolean).map(p => `${p.vorname} ${p.nachname}`) });
}
for (const day of KW26_DAYS) {
  if (!byDay[day]) continue;
  console.log(`\n  ${day}:`);
  byDay[day].forEach(e => console.log(`    ${e.baustelle.padEnd(28)} | ${e.maNames.join(", ")}`));
}

if (!APPLY) {
  console.log("\nDRY-RUN beendet. Mit --apply ausführen.");
  process.exit(0);
}

// 9) Apply (Batch-Inserts mit Conflict-Ignore)
console.log("\n[Mannschaft] APPLY läuft …");
async function batchInsertJunction(table, rows) {
  if (rows.length === 0) return 0;
  let success = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const { error } = await admin.from(table).insert(chunk);
    if (error) {
      // UNIQUE-Violation einzeln retryen
      if (error.code === "23505") {
        for (const r of chunk) {
          const { error: e2 } = await admin.from(table).insert(r);
          if (!e2) success++;
          else if (e2.code !== "23505") console.error(`  ${table} Fehler:`, e2.message);
          else success++; // bereits da → ok
        }
      } else {
        console.error(`  Batch-Fehler:`, error.message);
      }
    } else {
      success += chunk.length;
    }
  }
  return success;
}
const okJp = await batchInsertJunction("jahresplan_mitarbeiter", planJp);
const okTp = await batchInsertJunction("einteilung_mitarbeiter", planTp);
console.log(`\n[Mannschaft] FERTIG: +${okJp} jahresplan_mitarbeiter, +${okTp} einteilung_mitarbeiter`);
