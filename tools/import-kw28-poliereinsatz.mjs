// Import der MS-Project-Wochenplanung (KW28.mpp) in die neue
// Poliereinsatz-Ansicht (poliereinsatz_zeitraeume + baustellen.bauleiter_id).
//
// Die MPP hat die Struktur des Ausdrucks "ZIMMEREI - POLIEREINSATZ":
//   Summary-Task je Polier (Sandner, Gruber CH, Köfeler, …)
//     └ Task je Baustelle: Name = BVH, Zeitraum = start/finish,
//       Custom-Felder: KST, "x" (Baustelle), Bauleiter
//
// Voraussetzung — MPP nach JSON konvertieren (Pfade ggf. anpassen):
//   SCRATCH=/private/tmp/claude-501/-Users-christophnapetschnig-Developer-willroider/2c0be7c9-7d34-4fa0-8c0e-0373766de09f/scratchpad
//   "$SCRATCH/jdk-21.0.11+10/Contents/Home/bin/java" \
//     -cp "$SCRATCH/mpxj/mpxj.jar:$SCRATCH/mpxj/lib/*" \
//     org.mpxj.sample.MpxjConvert "$SCRATCH/KW28.mpp" /tmp/KW28.json
//
// Modi:
//   node tools/import-kw28-poliereinsatz.mjs --dump      Feldstruktur ansehen
//   SUPABASE_SERVICE_ROLE_KEY=… node … --inspect         Vorschau + Matching
//   SUPABASE_SERVICE_ROLE_KEY=… node … --import          Zeiträume schreiben
//
// Der Import ist idempotent: bestehende Zeiträume derselben
// (partie, baustelle, von, bis)-Kombination werden übersprungen.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./test-config.mjs";

const JSON_PATH = process.env.KW28_JSON ?? "/tmp/KW28.json";
const NOTE_TAG = `Aus KW28.mpp importiert am ${new Date().toISOString().slice(0, 10)}`;

// ─── Feld-Mapping (nach --dump verifizieren/anpassen!) ─────────────────
// In MS Project sind KST/Baustelle-x/Bauleiter Custom-Text-Spalten.
// Kandidaten laut KW26: text1..text10. --dump zeigt die echten Belegungen.
const FELD_KST = ["text3", "text1", "text2"]; // erster nicht-leerer gewinnt
const FELD_BAULEITER = ["text4", "text5", "text2"];
const FELD_X = ["text6", "text7"];

// Bekannte Sonder-Gruppen, die KEINE Partie im App-Sinn sind (Halle etc.) —
// werden importiert, wenn eine gleichnamige Partie existiert, sonst TODO.
const iso = (s) => (s ? String(s).slice(0, 10) : null);

function normalize(s) {
  return (s ?? "")
    .toString()
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function readTasks() {
  const d = JSON.parse(readFileSync(JSON_PATH, "utf8"));
  return (d.tasks ?? [])
    .filter((t) => t.outline_number)
    .sort((a, b) => {
      const an = String(a.outline_number).split(".").map(Number);
      const bn = String(b.outline_number).split(".").map(Number);
      for (let i = 0; i < Math.max(an.length, bn.length); i++) {
        const da = an[i] || 0;
        const db = bn[i] || 0;
        if (da !== db) return da - db;
      }
      return 0;
    });
}

function firstField(t, keys) {
  for (const k of keys) {
    const v = (t[k] ?? "").toString().trim();
    if (v) return v;
  }
  return "";
}

/** Gruppen (Polier) + deren Baustellen-Tasks extrahieren.
 *  Level 1 = Polier-Summary, tiefere Level mit Name+Zeitraum = Einsatz. */
export function extractEinsaetze() {
  const tasks = readTasks();
  const rows = [];
  let polier = null;
  for (const t of tasks) {
    const level = String(t.outline_number).split(".").length;
    const name = (t.name ?? "").trim();
    if (level === 1) {
      polier = name || polier;
      continue;
    }
    if (!name || name.toLowerCase() === "urlaub") continue;
    const von = iso(t.start);
    const bis = iso(t.finish);
    if (!von || !bis) continue;
    rows.push({
      polier,
      bvh: name,
      kst: firstField(t, FELD_KST),
      bauleiter: firstField(t, FELD_BAULEITER),
      x: firstField(t, FELD_X),
      von,
      bis,
      // MS-Project: manuell geplante/geschätzte Tasks ≈ Start nicht fix.
      startFix: !(t.estimated === true || t.manual === true),
      taskId: t.id,
    });
  }
  return rows;
}

function dump() {
  const tasks = readTasks();
  console.log(`${tasks.length} Tasks. Erste 40 mit allen nicht-leeren Feldern:\n`);
  for (const t of tasks.slice(0, 40)) {
    const fields = Object.fromEntries(
      Object.entries(t).filter(
        ([k, v]) =>
          v !== null &&
          v !== "" &&
          v !== false &&
          !["predecessors", "successors", "resource_assignments", "work_splits"].includes(k),
      ),
    );
    console.log(JSON.stringify(fields));
    console.log("---");
  }
}

async function lookups() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    console.error("SUPABASE_SERVICE_ROLE_KEY fehlt.");
    process.exit(1);
  }
  const supa = createClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const [partien, baustellen, profiles] = await Promise.all([
    supa.from("partien").select("id, name, partieleiter_id"),
    supa.from("baustellen").select("id, bvh_name, kostenstelle, status, bauleiter_id"),
    supa.from("profiles").select("id, vorname, nachname, planungsfarbe, is_active"),
  ]);
  for (const r of [partien, baustellen, profiles]) {
    if (r.error) throw r.error;
  }
  return { supa, partien: partien.data, baustellen: baustellen.data, profiles: profiles.data };
}

/** Polier-Gruppenname → Partie. Match über Partie-Name ODER Leiter-Nachname. */
function matchPartie(polier, partien, profiles) {
  const n = normalize(polier);
  const byId = Object.fromEntries(profiles.map((p) => [p.id, p]));
  const exact = partien.filter((p) => {
    if (normalize(p.name) === n) return true;
    const leiter = p.partieleiter_id ? byId[p.partieleiter_id] : null;
    return leiter && normalize(leiter.nachname) === n;
  });
  if (exact.length === 1) return exact[0];
  // Teiltreffer (z.B. "Gruber CH" ↔ Partie "Gruber CH")
  const partial = partien.filter(
    (p) => normalize(p.name).includes(n) || n.includes(normalize(p.name)),
  );
  return partial.length === 1 ? partial[0] : null;
}

/** BVH (+KST) → Baustelle. KST ist der stärkste Schlüssel. */
function matchBaustelle(bvh, kst, baustellen) {
  if (kst) {
    const byKst = baustellen.filter((b) => (b.kostenstelle ?? "").trim() === kst.trim());
    if (byKst.length === 1) return byKst[0];
    if (byKst.length > 1) {
      const n = normalize(bvh);
      const both = byKst.filter((b) => normalize(b.bvh_name) === n);
      if (both.length === 1) return both[0];
    }
  }
  const n = normalize(bvh);
  const byName = baustellen.filter((b) => normalize(b.bvh_name) === n);
  if (byName.length === 1) return byName[0];
  const partial = baustellen.filter(
    (b) => normalize(b.bvh_name).includes(n) || n.includes(normalize(b.bvh_name)),
  );
  return partial.length === 1 ? partial[0] : null;
}

/** Bauleiter-Kürzel ("Maurer", "Egger S", "Egger") → Profil. */
function matchBauleiter(raw, profiles) {
  if (!raw) return null;
  const m = raw.trim().match(/^(\S+)(?:\s+([A-ZÄÖÜ]))?\.?$/);
  if (!m) return null;
  const nachname = normalize(m[1]);
  const vorInitial = m[2] ? normalize(m[2]) : null;
  const cands = profiles.filter((p) => normalize(p.nachname) === nachname);
  if (cands.length === 1) return cands[0];
  if (cands.length > 1 && vorInitial) {
    const withInit = cands.filter((p) => normalize(p.vorname).startsWith(vorInitial));
    if (withInit.length === 1) return withInit[0];
  }
  // Ohne Initial: bevorzuge Profil mit planungsfarbe (= etablierter Bauleiter)
  if (cands.length > 1) {
    const mitFarbe = cands.filter((p) => p.planungsfarbe);
    if (mitFarbe.length === 1) return mitFarbe[0];
  }
  return null;
}

async function inspectOrImport(doImport) {
  const rows = extractEinsaetze();
  const { supa, partien, baustellen, profiles } = await lookups();

  const ok = [];
  const todo = [];
  for (const r of rows) {
    const partie = r.polier ? matchPartie(r.polier, partien, profiles) : null;
    const baustelle = matchBaustelle(r.bvh, r.kst, baustellen);
    const bauleiter = matchBauleiter(r.bauleiter, profiles);
    const probleme = [];
    if (!partie) probleme.push(`Polier '${r.polier}' → keine Partie`);
    if (!baustelle) probleme.push(`BVH '${r.bvh}' (KST ${r.kst || "—"}) → keine Baustelle`);
    if (r.bauleiter && !bauleiter) probleme.push(`Bauleiter '${r.bauleiter}' → kein Profil`);
    (probleme.length ? todo : ok).push({ ...r, partie, baustelle, bauleiter, probleme });
  }

  console.log(`\n${rows.length} Einsätze gelesen — ${ok.length} eindeutig, ${todo.length} unklar.\n`);
  console.log("── Eindeutig ──");
  for (const r of ok) {
    console.log(
      `  ${r.polier ?? "?"} | ${r.bvh} → ${r.baustelle.bvh_name} (${r.baustelle.kostenstelle ?? "—"})` +
        ` | ${r.von}–${r.bis}${r.startFix ? "" : " [Start unfix]"}` +
        (r.bauleiter ? ` | BL ${r.bauleiter.nachname}` : ""),
    );
  }
  if (todo.length) {
    console.log("\n── TODO (nicht importierbar) ──");
    for (const r of todo) {
      console.log(`  ${r.polier ?? "?"} | ${r.bvh} | ${r.von}–${r.bis}`);
      for (const p of r.probleme) console.log(`      ⚠ ${p}`);
    }
  }

  if (!doImport) return;

  console.log("\n── Import ──");
  let inserted = 0;
  let skipped = 0;
  let blSet = 0;
  for (const r of ok) {
    // Idempotenz: gleicher Zeitraum schon vorhanden?
    const { data: existing } = await supa
      .from("poliereinsatz_zeitraeume")
      .select("id")
      .eq("partie_id", r.partie.id)
      .eq("baustelle_id", r.baustelle.id)
      .eq("von_datum", r.von)
      .eq("bis_datum", r.bis)
      .limit(1);
    if (existing && existing.length > 0) {
      skipped++;
      continue;
    }
    const { error } = await supa.from("poliereinsatz_zeitraeume").insert({
      partie_id: r.partie.id,
      baustelle_id: r.baustelle.id,
      von_datum: r.von,
      bis_datum: r.bis,
      start_fix: r.startFix,
      notiz: NOTE_TAG,
    });
    if (error) {
      console.error(`  ✗ ${r.bvh}: ${error.message}`);
      continue;
    }
    inserted++;
    // Bauleiter an der Baustelle setzen, wenn im MPP angegeben und noch leer
    if (r.bauleiter && !r.baustelle.bauleiter_id) {
      const { error: blErr } = await supa
        .from("baustellen")
        .update({ bauleiter_id: r.bauleiter.id })
        .eq("id", r.baustelle.id);
      if (!blErr) blSet++;
    }
  }
  console.log(
    `\nFertig: ${inserted} Zeiträume angelegt, ${skipped} übersprungen (schon vorhanden), ` +
      `${blSet} Bauleiter an Baustellen gesetzt, ${todo.length} TODO-Zeilen offen.`,
  );
}

const mode = process.argv[2];
if (mode === "--dump") dump();
else if (mode === "--inspect") await inspectOrImport(false);
else if (mode === "--import") await inspectOrImport(true);
else {
  console.log("Aufruf: node tools/import-kw28-poliereinsatz.mjs --dump | --inspect | --import");
}
