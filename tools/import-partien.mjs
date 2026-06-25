/**
 * Legt die 8 Polier-Partien an basierend auf Workflow-Analyse aus
 * `Arbeitseinteilung Zimmerei 2026.docx` + MS-Project-Überschriften.
 *
 * Pro Partie:
 *  - Partie-Eintrag (name + farbcode)
 *  - partieleiter_id zeigt auf den Polier
 *  - profiles.partie_id setzen für Polier + Mannschaft
 *  - is_partieleiter=true für die Poliere
 *
 * Aufruf:
 *   SUPABASE_SERVICE_ROLE_KEY=... node tools/import-partien.mjs           # Dry
 *   SUPABASE_SERVICE_ROLE_KEY=... node tools/import-partien.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./test-config.mjs";

const APPLY = process.argv.includes("--apply");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY fehlt"); process.exit(1); }
const admin = createClient(SUPABASE_URL, key, { auth: { autoRefreshToken: false, persistSession: false } });

/**
 * Partien-Definition. Pers.Nrn aus Liste Zimmerei.xlsx.
 *  - polier_pers_nr → wird Polier (is_partieleiter=true, partieleiter_id)
 *  - mannschaft     → wird der Partie zugeordnet (partie_id)
 *  - farbe          → Farbcode für Gantt-Chart
 */
const PARTIEN = [
  {
    name: "Sandner",
    farbcode: "#3b82f6",
    polier_pers_nr: "566",  // Paul Sandner
    mannschaft_pers_nr: ["539", "524"],  // Rüting, Felix Sandner
  },
  {
    name: "Hinteregger",
    farbcode: "#10b981",
    polier_pers_nr: "508",
    mannschaft_pers_nr: ["538", "515", "563"],  // Hanschitz, Brunner, Seebacher
  },
  {
    name: "Hallegger",
    farbcode: "#f59e0b",
    polier_pers_nr: "513",
    mannschaft_pers_nr: ["562", "548", "512", "523"],  // Bürger, Wrolich, Fischer, Tripolt
  },
  {
    name: "Gruber CH",
    farbcode: "#ef4444",
    polier_pers_nr: "506",  // Gruber Christian
    mannschaft_pers_nr: ["542", "560"],  // Granitzer, Gerzabek
  },
  {
    name: "Tauchhammer",
    farbcode: "#8b5cf6",
    polier_pers_nr: "521",
    mannschaft_pers_nr: ["525", "529"],  // Schaar, Schuller
  },
  {
    name: "Koplenig",
    farbcode: "#ec4899",
    polier_pers_nr: "537",
    mannschaft_pers_nr: ["503", "555", "557"],  // Steinwender, Petritz, Pirker
  },
  {
    name: "Produktion / Werkstatt",
    farbcode: "#6b7280",
    polier_pers_nr: "504",  // Krainer
    mannschaft_pers_nr: ["10069", "541", "556", "547", "535", "533", "564", "10083"],
    // Lampersberger, Nikolic, Snagic, Sikora, Matschek, Edlinger, Trinker, Reibnegger
  },
  {
    name: "Köfeler",
    farbcode: "#14b8a6",
    polier_pers_nr: "574",
    mannschaft_pers_nr: [],
  },
];

console.log(`[Partien] Modus: ${APPLY ? "APPLY" : "DRY-RUN"}`);
console.log(`[Partien] Supabase: ${SUPABASE_URL}`);
console.log();

// Profile laden
const { data: profiles, error } = await admin
  .from("profiles")
  .select("id, vorname, nachname, pers_nr, partie_id, is_partieleiter");
if (error) { console.error(error); process.exit(1); }
const byPersNr = new Map();
for (const p of profiles) {
  if (p.pers_nr) byPersNr.set(String(p.pers_nr).trim(), p);
}

// Pre-Check: alle Pers.Nrn auflösbar?
const fehlend = [];
for (const P of PARTIEN) {
  for (const pn of [P.polier_pers_nr, ...P.mannschaft_pers_nr]) {
    if (!byPersNr.has(pn)) fehlend.push({ partie: P.name, pers_nr: pn });
  }
}
if (fehlend.length > 0) {
  console.error("FEHLER: nicht auflösbare Pers.Nrn:");
  fehlend.forEach(f => console.error(`  Partie '${f.partie}': pers_nr ${f.pers_nr} nicht in profiles`));
  process.exit(1);
}

// Bestehende Partien
const { data: existingPartien } = await admin.from("partien").select("id, name, farbcode, partieleiter_id");
const byName = new Map(existingPartien.map(p => [p.name.toLowerCase().trim(), p]));

// Plan zeigen
console.log("=== PLAN ===");
for (const P of PARTIEN) {
  const polier = byPersNr.get(P.polier_pers_nr);
  const exists = byName.get(P.name.toLowerCase());
  console.log(`${exists ? "[UPD]" : "[NEU]"} ${P.name.padEnd(28)} Polier: ${polier.vorname} ${polier.nachname}`);
  for (const pn of P.mannschaft_pers_nr) {
    const m = byPersNr.get(pn);
    console.log(`        ${m.vorname.padEnd(20)} ${m.nachname}`);
  }
}

if (!APPLY) {
  console.log("\nDRY-RUN beendet. Mit --apply ausführen.");
  process.exit(0);
}

console.log("\n=== APPLY ===");
let cP = 0, cMa = 0;

for (const P of PARTIEN) {
  const polier = byPersNr.get(P.polier_pers_nr);
  const exists = byName.get(P.name.toLowerCase());

  // 1) Partie upsert (per name-Match)
  let partieId;
  if (exists) {
    const { error: uErr } = await admin
      .from("partien")
      .update({ farbcode: P.farbcode, partieleiter_id: polier.id })
      .eq("id", exists.id);
    if (uErr) { console.error(`Partie UPDATE Fehler ${P.name}:`, uErr.message); continue; }
    partieId = exists.id;
    console.log(`  [UPD-Partie] ${P.name} → partieleiter=${polier.vorname} ${polier.nachname}`);
  } else {
    const { data: ins, error: iErr } = await admin
      .from("partien")
      .insert({ name: P.name, farbcode: P.farbcode, partieleiter_id: polier.id })
      .select("id")
      .single();
    if (iErr) { console.error(`Partie INSERT Fehler ${P.name}:`, iErr.message); continue; }
    partieId = ins.id;
    console.log(`  [NEU-Partie] ${P.name}`);
  }
  cP++;

  // 2) Polier-Profil: is_partieleiter=true, partie_id setzen
  await admin
    .from("profiles")
    .update({ is_partieleiter: true, partie_id: partieId })
    .eq("id", polier.id);

  // 3) Mannschaft zuordnen
  for (const pn of P.mannschaft_pers_nr) {
    const m = byPersNr.get(pn);
    await admin
      .from("profiles")
      .update({ partie_id: partieId, is_partieleiter: false })
      .eq("id", m.id);
    cMa++;
  }
}

console.log(`\n[Partien] FERTIG: ${cP} Partien, ${cMa} Mannschafts-MA zugeordnet`);
