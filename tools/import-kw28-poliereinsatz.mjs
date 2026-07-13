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

// ─── Feld-Mapping (via --dump verifiziert, Stand KW28) ─────────────────
// Struktur der MPP: FLACHE Liste (alle outline_level 1).
//   Task MIT name        = Polier-Gruppe (Sandner, Gruber CH, …)
//   Task OHNE name       = Baustellen-Zeile; der BVH-Name ist die
//                          zugewiesene RESSOURCE (assignments→resources).
//   notes = Bauleiter    text3 = KST    text2 = "x" (Baustelle)
//   Echte Balken = work_splits (start/finish sind nur die Task-Hülle).
//   text1 ist ein Farb-Flag (−1 ≈ Maurer) — KEIN Start-fix-Signal;
//   start_fix wird nach dem Import in der App gepflegt.
const FELD_KST = ["text3"];
const FELD_X = ["text2"];
/** Nur Splits, die in/nach dieser Woche enden (KW28-Planung, keine Historie). */
const SPLIT_AB = process.env.KW28_AB ?? "2026-07-06";

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

function readProject() {
  const d = JSON.parse(readFileSync(JSON_PATH, "utf8"));
  const tasks = (d.tasks ?? [])
    .filter((t) => t.wbs && t.wbs !== "0")
    .sort((a, b) => Number(a.wbs) - Number(b.wbs));
  const resources = Object.fromEntries(
    (d.resources ?? []).map((r) => [r.unique_id, (r.name ?? "").trim()]),
  );
  // task_unique_id → BVH-Name (erste zugewiesene Ressource)
  const bvhByTask = {};
  for (const a of d.assignments ?? []) {
    if (!(a.task_unique_id in bvhByTask)) {
      bvhByTask[a.task_unique_id] = resources[a.resource_unique_id] ?? "";
    }
  }
  return { tasks, bvhByTask };
}
const readTasks = () => readProject().tasks;

function firstField(t, keys) {
  for (const k of keys) {
    const v = (t[k] ?? "").toString().trim();
    if (v) return v;
  }
  return "";
}

/** Einsätze extrahieren: flache Liste, name-Tasks = Polier-Gruppen,
 *  namenlose Tasks = Baustellen (BVH via Ressource), Balken = work_splits.
 *  Je Split (ab SPLIT_AB) EIN Zeitraum. */
export function extractEinsaetze() {
  const { tasks, bvhByTask } = readProject();
  const rows = [];
  let polier = null;
  for (const t of tasks) {
    const name = (t.name ?? "").trim();
    if (name) {
      // Gruppen-Task (Polier) — die "Urlaube:"-Sektion beendet die Gruppen.
      polier = name.replace(/:$/, "").trim();
      continue;
    }
    if (!polier || normalize(polier) === "urlaube") continue;
    const bvh = (bvhByTask[t.unique_id] ?? "").trim();
    if (!bvh || bvh.toLowerCase() === "urlaub") continue;
    const splits = (t.work_splits ?? [])
      .map((s) => ({ von: iso(s.start), bis: iso(s.end) }))
      .filter((s) => s.von && s.bis && s.bis >= SPLIT_AB);
    for (const s of splits) {
      rows.push({
        polier,
        bvh,
        kst: firstField(t, FELD_KST),
        bauleiter: (t.notes ?? "").trim(),
        x: firstField(t, FELD_X),
        von: s.von,
        bis: s.bis,
        // Kein verlässliches Signal in der MPP — wird in der App gepflegt.
        startFix: true,
        taskId: t.id,
      });
    }
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

/** BVH (+KST) → Baustelle.
 *  App-KSTs sind lang ("1404030-2602" = Präfix 140 + Kurz-KST + Lfd-Nr.),
 *  die MPP führt nur die Kurz-KST ("4030"). Match: Kurz-KST steckt am
 *  Anfang der App-KST (nach dem 140-Präfix). Sammel-KSTs (4020/4030/4040)
 *  haben mehrere Kandidaten → Name entscheidet. */
function kstMatches(appKst, kurzKst) {
  const app = (appKst ?? "").trim().replace(/^140/, "");
  return app.startsWith(kurzKst.trim());
}
function nameOverlap(a, b) {
  // Token-basiert: alle Wörter des kürzeren Namens kommen im längeren vor.
  // includes-Vergleich nur bei Tokens ≥4 Zeichen — sonst matcht "in" auf
  // "Dietrichsteiner" und produziert Falsch-Treffer.
  const ta = normalize(a).split(" ").filter((w) => w.length >= 3);
  const tb = normalize(b).split(" ").filter((w) => w.length >= 3);
  if (ta.length === 0 || tb.length === 0) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((w) =>
    long.some((lw) => {
      if (lw === w) return true;
      if (Math.min(lw.length, w.length) < 4) return false;
      return lw.includes(w) || w.includes(lw);
    }),
  );
}
/** Sammel-KSTs (Stadtgebiete) decken viele verschiedene BVHs ab — dort
 *  reicht die KST allein NICHT als Beweis, der Name muss mitpassen. */
const SAMMEL_KST = new Set(["4020", "4030", "4040", "4060", "4070"]);

function matchBaustelle(bvh, kst, baustellen) {
  if (kst) {
    const byKst = baustellen.filter((b) => kstMatches(b.kostenstelle, kst));
    const brauchtName = SAMMEL_KST.has(kst.trim());
    if (byKst.length === 1 && !brauchtName) return byKst[0];
    if (byKst.length >= 1) {
      const byName = byKst.filter((b) => nameOverlap(b.bvh_name, bvh));
      if (byName.length === 1) return byName[0];
    }
    // Spezifische KST vorhanden, aber kein Kandidat passt → NICHT auf den
    // Namens-Fallback ausweichen (Verwechslungsgefahr, lieber neu anlegen).
    if (!SAMMEL_KST.has(kst.trim()) && byKst.length === 0) {
      const n0 = normalize(bvh);
      const exact0 = baustellen.filter((b) => normalize(b.bvh_name) === n0);
      return exact0.length === 1 ? exact0[0] : null;
    }
  }
  const n = normalize(bvh);
  const exact = baustellen.filter((b) => normalize(b.bvh_name) === n);
  if (exact.length === 1) return exact[0];
  // Reiner Namens-Fallback: streng — nur wenn ein Name den anderen als
  // PRÄFIX enthält ("Pichele Hof" ↔ "Pichelehof"), kein Suffix-Raten
  // ("Hochmüller" darf NICHT auf "EFH Familie Müller" fallen).
  const partial = baustellen.filter((b) => {
    const bn = normalize(b.bvh_name).replace(/ /g, "");
    const qn = n.replace(/ /g, "");
    return bn.startsWith(qn) || qn.startsWith(bn);
  });
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
    // Dokument-Konvention der Wochenplanung: "Egger" ohne Initial meint
    // Eckart Egger (Sebastian wird stets als "Egger S" geführt).
    if (nachname === "egger") {
      const eckart = cands.find((p) => normalize(p.vorname).startsWith("eckar"));
      if (eckart) return eckart;
    }
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

  // ── Fehlendes anlegen (wie beim KW26-Import): Partien + Baustellen ──
  console.log("\n── Anlegen fehlender Stammdaten ──");
  const partieCache = new Map();
  const bstCache = new Map();
  for (const r of todo) {
    // Partie (z.B. "Tripold") — ohne Leiter, graue Farbe
    if (!r.partie && r.polier) {
      const key = normalize(r.polier);
      if (!partieCache.has(key)) {
        const { data: np, error } = await supa
          .from("partien")
          .insert({ name: r.polier, farbcode: "#6b7280" })
          .select("*")
          .single();
        if (error) {
          console.error(`  ✗ Partie '${r.polier}': ${error.message}`);
          partieCache.set(key, null);
        } else {
          console.log(`  + Partie '${r.polier}' angelegt (ohne Leiter)`);
          partieCache.set(key, np);
          partien.push(np);
        }
      }
      r.partie = partieCache.get(key);
    }
    // Baustelle — KST im App-Format (Präfix 140), Bauleiter gleich mit
    if (!r.baustelle && r.bvh) {
      const key = normalize(r.bvh) + "|" + (r.kst ?? "");
      if (!bstCache.has(key)) {
        let { data: nb, error } = await supa
          .from("baustellen")
          .insert({
            bvh_name: r.bvh,
            kostenstelle: r.kst ? `140${r.kst}` : null,
            status: "aktiv",
            bauleiter_id: r.bauleiter?.id ?? null,
            notizen: NOTE_TAG,
          })
          .select("*")
          .single();
        if (error && error.message.includes("baustellen_kostenstelle_key")) {
          // Sammel-KST schon vergeben (UNIQUE) → ohne KST anlegen,
          // Kurz-KST wandert in die Notiz; das Büro vergibt die Unternummer.
          ({ data: nb, error } = await supa
            .from("baustellen")
            .insert({
              bvh_name: r.bvh,
              kostenstelle: null,
              status: "aktiv",
              bauleiter_id: r.bauleiter?.id ?? null,
              notizen: `${NOTE_TAG} · KST laut Planung: ${r.kst}`,
            })
            .select("*")
            .single());
        }
        if (error) {
          console.error(`  ✗ Baustelle '${r.bvh}': ${error.message}`);
          bstCache.set(key, null);
        } else {
          console.log(`  + Baustelle '${r.bvh}' (${nb.kostenstelle ?? "ohne KST"}) angelegt`);
          bstCache.set(key, nb);
          baustellen.push(nb);
        }
      }
      r.baustelle = bstCache.get(key);
    }
    if (r.partie && r.baustelle) {
      r.probleme = [];
      ok.push(r);
    }
  }
  const restTodo = todo.filter((r) => r.probleme.length > 0);

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
      `${blSet} Bauleiter an Baustellen gesetzt, ${restTodo.length} TODO-Zeilen offen.`,
  );
  for (const r of restTodo) {
    console.log(`  offen: ${r.polier} | ${r.bvh} — ${r.probleme.join("; ")}`);
  }
}

const mode = process.argv[2];
if (mode === "--dump") dump();
else if (mode === "--inspect") await inspectOrImport(false);
else if (mode === "--import") await inspectOrImport(true);
else {
  console.log("Aufruf: node tools/import-kw28-poliereinsatz.mjs --dump | --inspect | --import");
}
