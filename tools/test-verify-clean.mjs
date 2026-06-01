// Verifiziert nach test-teardown.mjs, dass keine PWTEST-Datensätze
// in der DB übrig sind.

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, TEST_PREFIX, requireServiceKey } from "./test-config.mjs";

const admin = createClient(SUPABASE_URL, requireServiceKey(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function countLike(table, col, pattern) {
  const { count } = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .like(col, pattern);
  return count ?? 0;
}

const checks = [
  ["baustellen", "bvh_name", `${TEST_PREFIX}%`],
  ["baustellen", "kostenstelle", `${TEST_PREFIX}%`],
  ["angebote", "bvh_name", `${TEST_PREFIX}%`],
  ["einteilungen", "taetigkeit", `${TEST_PREFIX}%`],
  ["berichte", "freitext_besonderheiten", `${TEST_PREFIX}%`],
  ["evaluierungen", "notizen", `${TEST_PREFIX}%`],
];

let total = 0;
let any = false;
for (const [t, c, p] of checks) {
  const n = await countLike(t, c, p);
  console.log(`  · ${t}.${c}: ${n}`);
  total += n;
  if (n > 0) any = true;
}

const { data: testUsers } = await admin.auth.admin.listUsers({
  page: 1,
  perPage: 200,
});
const testUserIds = (testUsers?.users ?? [])
  .filter((u) => u.email?.startsWith("playwright-test-"))
  .map((u) => u.id);
console.log(`  · auth.users (playwright-test-*): ${testUserIds.length}`);
if (testUserIds.length > 0) any = true;

if (any) {
  console.error(`✗ Cleanup unvollständig — ${total} Daten + ${testUserIds.length} User übrig.`);
  process.exit(1);
} else {
  console.log("✓ DB komplett sauber — keine PWTEST-Reste, kein Test-User.");
}
