/**
 * Setzt die App-Rollen entsprechend Holzbau-Setup:
 *  - Johannes Maurer (Pers 10005) → 'geschaeftsfuehrung' (sieht alles)
 *  - Poliere (is_partieleiter=true mit pers_nr aus Personalliste)
 *    → 'zimmermeister' (= Vorarbeiter)
 *  - Alle anderen bleiben wie sie sind
 *
 * Idempotent: DELETE alle bisherigen Rollen pro User, dann INSERT neu.
 */
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./test-config.mjs";

const APPLY = process.argv.includes("--apply");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY fehlt"); process.exit(1); }
const admin = createClient(SUPABASE_URL, key, { auth: { autoRefreshToken: false, persistSession: false } });

// Manuelle Festlegung:
const GF_PERS_NRN = ["10005"]; // Maurer Johannes

// Echte Poliere (aus is_partieleiter=true + bekannte Persons; Pließnig
// bleibt bauleiter — er ist historisch geflaggt aber kein Polier).
const POLIER_PERS_NRN = [
  "566",   // Paul Sandner
  "508",   // Norbert Hinteregger
  "513",   // Jörg Anton Hallegger
  "506",   // Christian Gruber
  "521",   // Dirk Tauchhammer
  "537",   // Timo Koplenig
  "504",   // Wolfgang Krainer
  "574",   // Thomas Köfeler
];

console.log(`[Rollen] Mode: ${APPLY ? "APPLY" : "DRY"}`);

const { data: profiles } = await admin
  .from("profiles")
  .select("id, vorname, nachname, pers_nr")
  .not("pers_nr", "is", null);
const byPersNr = new Map(profiles.map(p => [String(p.pers_nr).trim(), p]));

const plan = [];
for (const pn of GF_PERS_NRN) {
  const p = byPersNr.get(pn);
  if (p) plan.push({ ...p, neueRolle: "geschaeftsfuehrung" });
}
for (const pn of POLIER_PERS_NRN) {
  const p = byPersNr.get(pn);
  if (p) plan.push({ ...p, neueRolle: "zimmermeister" });
}

console.log(`\nPLAN (${plan.length} Updates):`);
plan.forEach(p => console.log(`  ${p.pers_nr.padEnd(8)} ${p.vorname.padEnd(20)} ${p.nachname.padEnd(20)} → ${p.neueRolle}`));

if (!APPLY) {
  console.log("\nDRY-RUN beendet. Mit --apply ausführen.");
  process.exit(0);
}

console.log("\nAPPLY läuft …");
let ok = 0;
for (const p of plan) {
  // Lösche alle alten Rollen, setze die neue
  const { error: dErr } = await admin.from("user_roles").delete().eq("user_id", p.id);
  if (dErr) { console.error(`  DELETE ${p.nachname}:`, dErr.message); continue; }
  const { error: iErr } = await admin.from("user_roles").insert({ user_id: p.id, role: p.neueRolle });
  if (iErr) { console.error(`  INSERT ${p.nachname}:`, iErr.message); continue; }
  console.log(`  ✓ ${p.vorname} ${p.nachname} → ${p.neueRolle}`);
  ok++;
}
console.log(`\nFERTIG: ${ok}/${plan.length} aktualisiert`);
