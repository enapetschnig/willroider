/**
 * Einmaliger Helfer: setzt für alle Surrogate-Accounts
 * (pers-<nr>@willroider.invalid) ein neues Backup-Passwort und
 * schreibt die Credentials-Datei nach ~/Downloads/.
 *
 * Wird gebraucht, weil der erste Apply-Lauf von import-personal
 * die Original-Profile als Duplikate angelegt hat und der zweite
 * Lauf die Credentials-Datei leer überschrieben hat — die
 * Surrogate-User selbst sind ok, nur die PWs fehlen lokal.
 */
import { writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./test-config.mjs";

const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY fehlt"); process.exit(1); }
const admin = createClient(SUPABASE_URL, key, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: page, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (error) throw error;
const surrogates = page.users.filter((u) => u.email?.endsWith("@willroider.invalid"));
console.log(`${surrogates.length} Surrogate-Accounts gefunden`);

const credentials = [];
for (const u of surrogates) {
  const pw = randomBytes(12).toString("base64").replace(/[+/=]/g, "x").slice(0, 16);
  await admin.auth.admin.updateUserById(u.id, { password: pw });
  const { data: p } = await admin.from("profiles").select("pers_nr, vorname, nachname").eq("id", u.id).single();
  credentials.push({
    pers_nr: p?.pers_nr ?? null,
    vorname: p?.vorname ?? "",
    nachname: p?.nachname ?? "",
    supabase_user_id: u.id,
    surrogate_email: u.email,
    initial_password: pw,
    notes: "Telefonnummer noch erfassen, dann SMS-Einladung neu senden.",
  });
  console.log(`  ${p?.pers_nr?.padEnd(8) ?? "?"} ${p?.vorname ?? ""} ${p?.nachname ?? ""}: ok`);
}
const path1 = join(homedir(), "Downloads", "willroider-import-credentials-20260625.json");
const path2 = "/tmp/willroider-import-credentials-20260625.json";
writeFileSync(path1, JSON.stringify(credentials, null, 2));
writeFileSync(path2, JSON.stringify(credentials, null, 2));
try { chmodSync(path1, 0o600); chmodSync(path2, 0o600); } catch {}
console.log(`\n${credentials.length} Credentials gespeichert in:`);
console.log("  " + path1);
console.log("  " + path2);
