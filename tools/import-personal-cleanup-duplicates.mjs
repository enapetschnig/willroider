/**
 * One-shot Cleanup: löscht die 8 fälschlich doppelt angelegten
 * Auth-Accounts mit Surrogate-Email @willroider.invalid, deren
 * Original-Profile schon mit echter Email existieren.
 *
 * Cascade killt automatisch: profiles, profiles_sensitive,
 * profile_konten_settings, user_roles, urlaubs_buchungen,
 * za_buchungen.
 *
 * Nur ein Pass — Email-Filter `@willroider.invalid` + Match auf
 * existierendes Profil mit gleichem Nachname+Vorname.
 */
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./test-config.mjs";

const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY fehlt"); process.exit(1); }
const admin = createClient(SUPABASE_URL, key, { auth: { autoRefreshToken: false, persistSession: false } });

const normalize = (s) => (s||"").toLowerCase().replace(/ß/g,"ss").replace(/ä/g,"a").replace(/ö/g,"o").replace(/ü/g,"u").trim();

const { data: profiles, error } = await admin.from("profiles").select("id, vorname, nachname, email");
if (error) throw error;

// Gruppieren nach (nachname, vorname-first-token)
const groups = {};
profiles.forEach(p => {
  const k = normalize(p.nachname) + "|" + normalize((p.vorname||"").split(/\s+/)[0]);
  (groups[k] = groups[k] || []).push(p);
});
const dups = Object.entries(groups).filter(([_, arr]) => arr.length > 1);
console.log(`${dups.length} Duplikat-Gruppen gefunden`);

let removed = 0;
for (const [k, arr] of dups) {
  // Die mit @willroider.invalid soll weg, die andere bleibt
  const surrogate = arr.find(p => p.email?.endsWith("@willroider.invalid"));
  const original = arr.find(p => p !== surrogate);
  if (!surrogate || !original) {
    console.log("SKIP", k, "— kein eindeutiges Surrogate/Original-Paar");
    continue;
  }
  console.log(`  delete surrogate ${surrogate.id.slice(0,8)}… (${surrogate.email}) — keep ${original.id.slice(0,8)}… (${original.email})`);
  const { error: dErr } = await admin.auth.admin.deleteUser(surrogate.id);
  if (dErr) {
    console.error("    FEHLER:", dErr.message);
    continue;
  }
  removed++;
}
console.log(`Fertig: ${removed} Surrogate-Accounts gelöscht`);
