// Löscht ALLE Test-Daten + den Test-User wieder.
// Aufruf: SUPABASE_SERVICE_ROLE_KEY=... node tools/test-teardown.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import {
  SUPABASE_URL,
  TEST_EMAIL,
  TEST_PREFIX,
  requireServiceKey,
} from "./test-config.mjs";

const serviceKey = requireServiceKey();
const admin = createClient(SUPABASE_URL, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function getTestUserId() {
  if (existsSync("e2e/.auth/admin-meta.json")) {
    return JSON.parse(readFileSync("e2e/.auth/admin-meta.json", "utf8")).userId;
  }
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  return data?.users?.find((u) => u.email === TEST_EMAIL)?.id ?? null;
}

/** Manche Tabellen haben kein „id"-Feld (Composite/Other-PK). pkCol passt es an. */
async function deleteRows(table, query, pkCol = "id") {
  const { data, error } = await query.select(pkCol);
  if (error) {
    console.warn(`  ⚠ ${table}: delete fehler`, error.message);
    return 0;
  }
  return (data ?? []).length;
}

async function main() {
  console.log("→ Test-User-ID ermitteln …");
  const userId = await getTestUserId();
  console.log("  userId =", userId);

  // 1) Alle Daten mit PWTEST-Marker im Namen (kaskadiert oder breit gefasst)
  console.log(`→ Lösche Datensätze mit Marker '${TEST_PREFIX}' …`);

  // Berichte (Bautagesberichte etc.) der Test-Baustellen
  if (userId) {
    const { data: testBs } = await admin
      .from("baustellen")
      .select("id")
      .like("bvh_name", `${TEST_PREFIX}%`);
    const ids = (testBs ?? []).map((b) => b.id);
    if (ids.length > 0) {
      const n1 = await deleteRows(
        "berichte",
        admin.from("berichte").delete().in("baustelle_id", ids),
      );
      console.log(`  · berichte (Test-Baustellen): ${n1}`);
      const n2 = await deleteRows(
        "stunden_taetigkeiten",
        admin.from("stunden_taetigkeiten").delete().in("baustelle_id", ids),
      );
      console.log(`  · stunden_taetigkeiten (Test-Baustellen): ${n2}`);
    }
  }

  // Angebote mit PWTEST-Marker
  const nAng = await deleteRows(
    "angebote",
    admin.from("angebote").delete().like("bvh_name", `${TEST_PREFIX}%`),
  );
  console.log(`  · angebote: ${nAng}`);

  // Einteilungen mit PWTEST-Tätigkeit (kaskadiert auf einteilung_mitarbeiter)
  const nEin = await deleteRows(
    "einteilungen",
    admin.from("einteilungen").delete().like("taetigkeit", `${TEST_PREFIX}%`),
  );
  console.log(`  · einteilungen: ${nEin}`);

  // tagesplanung_freigaben vom Test-User
  if (userId) {
    const nFG = await deleteRows(
      "tagesplanung_freigaben",
      admin
        .from("tagesplanung_freigaben")
        .delete()
        .eq("freigegeben_von", userId),
      "datum",
    );
    console.log(`  · tagesplanung_freigaben: ${nFG}`);
  }

  // Baustellen mit PWTEST-Marker (BVH-Name oder Kostenstelle)
  const nBs1 = await deleteRows(
    "baustellen",
    admin.from("baustellen").delete().like("bvh_name", `${TEST_PREFIX}%`),
  );
  const nBs2 = await deleteRows(
    "baustellen",
    admin.from("baustellen").delete().like("kostenstelle", `${TEST_PREFIX}%`),
  );
  console.log(`  · baustellen (bvh+ks): ${nBs1 + nBs2}`);

  // 2) Daten, die am Test-User hängen
  if (userId) {
    console.log("→ Lösche alle Daten am Test-User …");
    // stunden_taetigkeiten haben stunden_tag_id → über stunden_tage löschen
    const { data: tage } = await admin
      .from("stunden_tage")
      .select("id")
      .eq("mitarbeiter_id", userId);
    const tageIds = (tage ?? []).map((t) => t.id);
    if (tageIds.length > 0) {
      const nT1 = await deleteRows(
        "stunden_taetigkeiten",
        admin.from("stunden_taetigkeiten").delete().in("stunden_tag_id", tageIds),
      );
      console.log(`  · stunden_taetigkeiten (User): ${nT1}`);
      const nT2 = await deleteRows(
        "stunden_zulagen",
        admin.from("stunden_zulagen").delete().in("stunden_tag_id", tageIds),
      );
      console.log(`  · stunden_zulagen (User): ${nT2}`);
      const nT3 = await deleteRows(
        "stunden_fahrt",
        admin.from("stunden_fahrt").delete().in("stunden_tag_id", tageIds),
        "stunden_tag_id",
      );
      console.log(`  · stunden_fahrt (User): ${nT3}`);
    }
    const nTage = await deleteRows(
      "stunden_tage",
      admin.from("stunden_tage").delete().eq("mitarbeiter_id", userId),
    );
    console.log(`  · stunden_tage: ${nTage}`);
    const nBer = await deleteRows(
      "stunden_berichte",
      admin.from("stunden_berichte").delete().eq("mitarbeiter_id", userId),
    );
    console.log(`  · stunden_berichte: ${nBer}`);
    const nBerichte = await deleteRows(
      "berichte",
      admin.from("berichte").delete().eq("erfasst_von", userId),
    );
    console.log(`  · berichte (User): ${nBerichte}`);
    const nAngU = await deleteRows(
      "angebote",
      admin.from("angebote").delete().eq("created_by", userId),
    );
    console.log(`  · angebote (User): ${nAngU}`);

    // 3) User-Roles + Profile + Auth-User
    await admin.from("user_roles").delete().eq("user_id", userId);
    await admin.from("profiles").delete().eq("id", userId);
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.warn("  ⚠ deleteUser fehler", error.message);
    else console.log("  · Auth-User gelöscht");
  }

  console.log("✓ Teardown fertig.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
