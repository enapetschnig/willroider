// Legt einen Test-Admin-User an + dumpt die Supabase-Session als
// storageState für Playwright.
// Aufruf: SUPABASE_SERVICE_ROLE_KEY=... node tools/test-setup.mjs

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "fs";
import {
  SUPABASE_URL,
  SUPABASE_ANON,
  TEST_EMAIL,
  TEST_PASSWORD,
  TEST_VORNAME,
  TEST_NACHNAME,
  requireServiceKey,
} from "./test-config.mjs";

const serviceKey = requireServiceKey();
const admin = createClient(SUPABASE_URL, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findExistingUser(email) {
  // listUsers ist paginiert; für unsere Zwecke reicht Seite 1.
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  return data?.users?.find((u) => u.email === email) ?? null;
}

async function main() {
  console.log("→ Test-User anlegen / sicherstellen …");
  let userId;
  const existing = await findExistingUser(TEST_EMAIL);
  if (existing) {
    console.log("  → existiert, Passwort/E-Mail-Bestätigung sichern");
    userId = existing.id;
    await admin.auth.admin.updateUserById(userId, {
      password: TEST_PASSWORD,
      email_confirm: true,
    });
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { vorname: TEST_VORNAME, nachname: TEST_NACHNAME },
    });
    if (error) throw error;
    userId = data.user.id;
    console.log("  → neu angelegt", userId);
  }

  console.log("→ Profile aktivieren + Geschäftsführung-Rolle setzen …");
  await admin.from("profiles").upsert(
    {
      id: userId,
      email: TEST_EMAIL,
      vorname: TEST_VORNAME,
      nachname: TEST_NACHNAME,
      is_active: true,
    },
    { onConflict: "id" },
  );
  // Rolle hart auf Geschäftsführung setzen (Admin-Vollrechte).
  await admin.from("user_roles").delete().eq("user_id", userId);
  await admin
    .from("user_roles")
    .insert({ user_id: userId, role: "geschaeftsfuehrung" });

  console.log("→ Session via Anon-Key holen + storageState dumpen …");
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: sess, error: sessErr } = await anon.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (sessErr) throw sessErr;
  const session = sess.session;
  if (!session) throw new Error("Keine Session zurück");

  // Supabase-JS legt das Token in localStorage unter
  //   "sb-<ref>-auth-token" als JSON ab. Wir bauen genau dieses Objekt nach,
  //   damit das Web-App-Frontend nach Page-Load eingeloggt ist.
  const projectRef = "ylqbxnsxksbtsqrcwtuq";
  const stored = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: session.token_type,
    user: session.user,
  };
  const storageState = {
    cookies: [],
    origins: [
      {
        origin: "http://localhost:8080",
        localStorage: [
          {
            name: `sb-${projectRef}-auth-token`,
            value: JSON.stringify(stored),
          },
          // Install-Prompt-Dialog dauerhaft dismissen — verdeckt sonst die UI
          {
            name: "willroider:install-dismissed",
            value: "true",
          },
        ],
      },
    ],
  };
  mkdirSync("e2e/.auth", { recursive: true });
  writeFileSync(
    "e2e/.auth/admin.json",
    JSON.stringify(storageState, null, 2),
  );
  writeFileSync(
    "e2e/.auth/admin-meta.json",
    JSON.stringify(
      { userId, email: TEST_EMAIL, role: "geschaeftsfuehrung" },
      null,
      2,
    ),
  );
  console.log("✓ Setup fertig, userId =", userId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
