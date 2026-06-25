/**
 * Deep-Verify: stellt für JEDE Datenzeile in Liste Zimmerei.xlsx
 * sicher, dass die exakten Werte in der DB ankommen.
 *
 * Was geprüft wird:
 *   1) profiles: pers_nr, vorname, nachname, geburtsdatum, adresse,
 *      qualifikation, is_active
 *   2) profiles_sensitive.sv_nr endet mit den 4 Excel-Ziffern
 *   3) za_buchungen.initial.stunden == Excel ZA (NULL → kein
 *      Eintrag erwartet, 0 → Eintrag mit 0)
 *   4) urlaubs_buchungen.initial.tage == Excel Urlaub
 *   5) user_roles.role: GE → bauleiter, LO/LE → mitarbeiter
 *
 * Listet pro MA alle Abweichungen.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./test-config.mjs";
import { parseAddress } from "./lib/addressParser.mjs";

const SOURCE_FILE = join(homedir(), "Downloads", "Liste Zimmerei.xlsx");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.error("SUPABASE_SERVICE_ROLE_KEY fehlt");
  process.exit(1);
}
const admin = createClient(SUPABASE_URL, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function excelDateToIso(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${String(d.y).padStart(4, "0")}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  return null;
}

// Excel lesen
const wb = XLSX.read(readFileSync(SOURCE_FILE));
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils
  .sheet_to_json(sheet, { header: 1, raw: true, defval: "" })
  .slice(1)
  .filter((r) => r[0] && r[1]);

const excelMA = rows.map((r) => {
  const fullname = String(r[1]).trim();
  const parts = fullname.split(/\s+/);
  return {
    pers_nr: String(r[0]).trim(),
    nachname: parts[0],
    vorname: parts.slice(1).join(" "),
    sv_last4: String(r[2] ?? "").trim(),
    geburtsdatum: excelDateToIso(r[3]),
    adresse_raw: String(r[4] ?? "").trim(),
    code: String(r[5] ?? "").trim().toUpperCase(),
    za_excel: r[6] === "" || r[6] == null ? null : Number(r[6]),
    urlaub_excel: r[7] === "" || r[7] == null ? 0 : Number(r[7]),
  };
});

const QUAL_LABEL = {
  GE: "Gehalt (GE)",
  LO: "Lohn (LO)",
  LE: "Lehrling (LE)",
  PK: "Pauschalkraft (PK)",
};

const [profilesRes, sensRes, kontenRes, urlBuchRes, zaBuchRes, rollenRes] =
  await Promise.all([
    admin
      .from("profiles")
      .select("id,pers_nr,vorname,nachname,geburtsdatum,wohn_strasse,wohn_plz,wohn_ort,qualifikation,is_active"),
    admin.from("profiles_sensitive").select("profile_id,sv_nr"),
    admin.from("profile_konten_settings").select("profile_id,eintrittsdatum,za_faktor,arbeitszeitmodell"),
    admin.from("urlaubs_buchungen").select("mitarbeiter_id,tage").eq("art", "initial"),
    admin.from("za_buchungen").select("mitarbeiter_id,stunden").eq("art", "initial"),
    admin.from("user_roles").select("user_id,role"),
  ]);

const profilesByPersNr = new Map();
for (const p of profilesRes.data) {
  if (p.pers_nr) profilesByPersNr.set(String(p.pers_nr).trim(), p);
}
const sensById = new Map(sensRes.data.map((s) => [s.profile_id, s]));
const kontenById = new Map(kontenRes.data.map((k) => [k.profile_id, k]));
const urlById = new Map(urlBuchRes.data.map((u) => [u.mitarbeiter_id, u.tage]));
const zaById = new Map(zaBuchRes.data.map((u) => [u.mitarbeiter_id, u.stunden]));
const rolleById = new Map(rollenRes.data.map((r) => [r.user_id, r.role]));

const issues = [];
let perfekt = 0;

for (const m of excelMA) {
  const errs = [];
  const p = profilesByPersNr.get(m.pers_nr);
  if (!p) {
    issues.push({ ma: m, errs: ["MISSING profile"] });
    continue;
  }
  if (p.vorname !== m.vorname)
    errs.push(`vorname '${p.vorname}' ≠ '${m.vorname}'`);
  if (p.nachname !== m.nachname)
    errs.push(`nachname '${p.nachname}' ≠ '${m.nachname}'`);
  if (p.geburtsdatum !== m.geburtsdatum)
    errs.push(`geburtsdatum '${p.geburtsdatum}' ≠ '${m.geburtsdatum}'`);
  if (!p.is_active) errs.push(`is_active=false`);
  const adr = parseAddress(m.adresse_raw);
  if (adr && p.wohn_plz !== adr.plz)
    errs.push(`wohn_plz '${p.wohn_plz}' ≠ '${adr.plz}'`);
  if (adr && p.wohn_ort !== adr.ort)
    errs.push(`wohn_ort '${p.wohn_ort}' ≠ '${adr.ort}'`);
  if (adr && p.wohn_strasse !== adr.strasse)
    errs.push(`wohn_strasse '${p.wohn_strasse}' ≠ '${adr.strasse}'`);
  const expQual = QUAL_LABEL[m.code];
  if (p.qualifikation !== expQual)
    errs.push(`qualifikation '${p.qualifikation}' ≠ '${expQual}'`);

  // Sensitive
  const sens = sensById.get(p.id);
  const expSv = m.sv_last4 ? `------${m.sv_last4}` : null;
  if (expSv && sens?.sv_nr !== expSv)
    errs.push(`sv_nr '${sens?.sv_nr ?? "(none)"}' ≠ '${expSv}'`);

  // Konten-Settings
  const k = kontenById.get(p.id);
  if (!k) errs.push("profile_konten_settings fehlt");
  else {
    const expFaktor = m.code === "GE" ? 0 : 1;
    if (Number(k.za_faktor) !== expFaktor)
      errs.push(`za_faktor '${k.za_faktor}' ≠ '${expFaktor}'`);
    if (k.arbeitszeitmodell !== "zimmerei_sommer")
      errs.push(`arbeitszeitmodell '${k.arbeitszeitmodell}' ≠ 'zimmerei_sommer'`);
  }

  // Initial-Saldi
  const dbUrl = urlById.get(p.id);
  if (Number(dbUrl) !== m.urlaub_excel)
    errs.push(`urlaubs_buchungen.initial.tage ${dbUrl} ≠ excel ${m.urlaub_excel}`);
  const dbZa = zaById.has(p.id) ? Number(zaById.get(p.id)) : null;
  if (m.za_excel == null) {
    if (dbZa != null)
      errs.push(`unerwartete ZA-Buchung ${dbZa} (Excel ZA leer)`);
  } else {
    if (dbZa !== m.za_excel)
      errs.push(`za_buchungen.initial.stunden ${dbZa} ≠ excel ${m.za_excel}`);
  }

  // Rolle
  const rolle = rolleById.get(p.id);
  const expRolle = m.code === "GE" ? "bauleiter" : "mitarbeiter";
  if (rolle !== expRolle)
    errs.push(`user_roles.role '${rolle}' ≠ '${expRolle}'`);

  if (errs.length === 0) perfekt++;
  else issues.push({ ma: m, errs });
}

console.log(`\n[Deep-Verify] ${perfekt}/${excelMA.length} MA exakt korrekt`);
if (issues.length === 0) {
  console.log("\n✓ ALLES PERFEKT — kein Diff zwischen Excel und DB.");
  process.exit(0);
}
console.log(`\n${issues.length} MA mit Diffs:`);
for (const { ma, errs } of issues) {
  console.log(`\n  ${ma.pers_nr.padEnd(8)} ${ma.vorname} ${ma.nachname} (${ma.code}):`);
  errs.forEach((e) => console.log(`    ✗ ${e}`));
}
process.exit(1);
