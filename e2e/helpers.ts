import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const SUPABASE_URL = "https://ylqbxnsxksbtsqrcwtuq.supabase.co";

/** Per-Run-Marker, mit dem alle Test-Daten getaggt werden. Aus dem
 *  Environment kommt der Service-Role-Key (vom Wrapper-Skript gesetzt). */
export const TEST_RUN_ID = process.env.PWTEST_RUN_ID || "run";
export const TEST_PREFIX = `PWTEST_${TEST_RUN_ID}_`;

export function adminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY env-var fehlt.");
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function testUserId(): string {
  const meta = JSON.parse(readFileSync("e2e/.auth/admin-meta.json", "utf8"));
  return meta.userId as string;
}

export function uniqMarker(label: string): string {
  return `${TEST_PREFIX}${label}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}
