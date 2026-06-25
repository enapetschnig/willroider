/**
 * End-to-End-Verifier für den KW26-Import.
 *
 * Prüft:
 *  - 44 MA aktiv in `profiles` mit pers_nr aus Excel
 *  - Initial-Saldi für ZA + Urlaub
 *  - 17 KW26-Baustellen mit status='aktiv' + Import-Notiz
 *  - Jahresplan- + Tagesplanung-Einteilungen für 22.-28.06.2026
 *
 * Exit-Code 0 wenn alles passt, 1 bei Fehlern.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import { SUPABASE_URL } from "./test-config.mjs";

const SOURCE_FILE = join(homedir(), "Downloads", "Liste Zimmerei.xlsx");
const KW26_RANGE_START = "2026-06-22";
const KW26_RANGE_END = "2026-06-28";

const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.error("SUPABASE_SERVICE_ROLE_KEY fehlt.");
  process.exit(1);
}
const admin = createClient(SUPABASE_URL, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const wb = XLSX.read(readFileSync(SOURCE_FILE));
const rows = XLSX.utils
  .sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" })
  .slice(1)
  .filter((r) => r[0] && r[1]);
const expectedPersNr = rows.map((r) => String(r[0]).trim());

console.log("[4/5] Verify läuft …");

let fails = 0;
const check = (label, ok, details = "") => {
  if (ok) {
    console.log(`  ✓ ${label}${details ? "  (" + details + ")" : ""}`);
  } else {
    console.log(`  ✗ ${label}${details ? "  (" + details + ")" : ""}`);
    fails++;
  }
};

// 1) Profiles: alle 44 pers_nr aktiv
const { data: profs } = await admin
  .from("profiles")
  .select("id, pers_nr, vorname, nachname, is_active, geburtsdatum, wohn_plz, wohn_ort, qualifikation")
  .in("pers_nr", expectedPersNr);
const presentSet = new Set(profs.map((p) => p.pers_nr));
const missing = expectedPersNr.filter((p) => !presentSet.has(p));
check(`${expectedPersNr.length} MA in profiles`, missing.length === 0, missing.length ? `fehlend: ${missing.slice(0, 5).join(", ")}…` : "");
check(
  "alle MA sind aktiv",
  profs.every((p) => p.is_active),
  profs.filter((p) => !p.is_active).map((p) => p.pers_nr).join(", "),
);
check(
  "alle MA haben Geburtsdatum",
  profs.every((p) => p.geburtsdatum),
);
check(
  "alle MA haben Wohnadresse (PLZ+Ort)",
  profs.every((p) => p.wohn_plz && p.wohn_ort),
);
check(
  "alle MA haben Qualifikation",
  profs.every((p) => p.qualifikation),
);

// 2) Initial-Buchungen
const { data: zaB } = await admin.from("za_buchungen").select("mitarbeiter_id").eq("art", "initial");
const { data: urB } = await admin.from("urlaubs_buchungen").select("mitarbeiter_id").eq("art", "initial");
check("ZA-initial-Buchungen vorhanden", zaB.length >= 30, `n=${zaB.length}`);
check("Urlaub-initial-Buchungen vorhanden", urB.length >= 44, `n=${urB.length}`);

// 3) Baustellen
const { data: bs } = await admin
  .from("baustellen")
  .select("id, bvh_name, status, notizen")
  .like("notizen", "%Aus KW26.mpp importiert%");
check("17 KW26-Baustellen", bs.length === 17, `n=${bs.length}`);
check(
  "alle KW26-Baustellen status=aktiv",
  bs.every((b) => b.status === "aktiv"),
);

// 4) Jahresplan + Tagesplanung
const { data: jp } = await admin
  .from("jahresplan_einteilungen")
  .select("id, datum, taetigkeit")
  .gte("datum", KW26_RANGE_START)
  .lte("datum", KW26_RANGE_END)
  .like("taetigkeit", "KW26-import:%");
const { data: jpMa } = await admin
  .from("jahresplan_mitarbeiter")
  .select("einteilung_id, mitarbeiter_id");
const jpIds = new Set(jp.map((e) => e.id));
const jpJunctionCount = jpMa.filter((m) => jpIds.has(m.einteilung_id)).length;

const { data: tp } = await admin
  .from("einteilungen")
  .select("id, datum, taetigkeit")
  .gte("datum", KW26_RANGE_START)
  .lte("datum", KW26_RANGE_END)
  .like("taetigkeit", "KW26-import:%");
const { data: tpMa } = await admin
  .from("einteilung_mitarbeiter")
  .select("einteilung_id, mitarbeiter_id");
const tpIds = new Set(tp.map((e) => e.id));
const tpJunctionCount = tpMa.filter((m) => tpIds.has(m.einteilung_id)).length;

check("Jahresplan KW26-Einteilungen vorhanden", jp.length >= 18, `n=${jp.length}`);
check("Jahresplan MA-Verknüpfungen", jpJunctionCount >= jp.length, `n=${jpJunctionCount}`);
check("Tagesplanung KW26-Einteilungen vorhanden", tp.length >= 18, `n=${tp.length}`);
check("Tagesplanung MA-Verknüpfungen", tpJunctionCount >= tp.length, `n=${tpJunctionCount}`);

// 5) Stichprobe Augustin Thomas
const aug = profs.find((p) => p.pers_nr === "561");
check(
  "Stichprobe Augustin Thomas: Pers.Nr=561, Name=Thomas Augustin",
  aug && aug.vorname === "Thomas" && aug.nachname === "Augustin",
);

// 6) Credentials-Datei
const credPath = join(homedir(), "Downloads", "willroider-import-credentials-20260625.json");
let credsOk = false;
try {
  const c = JSON.parse(readFileSync(credPath, "utf8"));
  credsOk = Array.isArray(c) && c.length > 0;
} catch {}
check(`Credentials-Datei vorhanden (${credPath})`, credsOk);

console.log();
if (fails > 0) {
  console.log(`[4/5] FEHLER: ${fails} Verify-Checks fehlgeschlagen.`);
  process.exit(1);
} else {
  console.log("[4/5] ALLES OK ✓");
}
