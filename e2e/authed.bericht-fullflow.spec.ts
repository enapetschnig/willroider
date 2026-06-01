import { test, expect } from "@playwright/test";
import { adminClient, testUserId, uniqMarker } from "./helpers";

/**
 * Voller Status-Flow eines Bautagesberichts:
 *   entwurf → eingereicht
 * Setup-Daten werden via Service-Role gesäht, die UI verifiziert die
 * Render-Pfade. Cleanup erfolgt zentral in tools/test-teardown.mjs.
 *
 * Schema-Referenz: supabase/migrations/20260523000000_berichte.sql
 *   - NOT NULL: baustelle_id, datum, typ, status (Default 'entwurf')
 *   - wetter_beschreibung + freitext_besonderheiten sind nullable, daher
 *     hier nicht zwingend nötig — wir setzen sie trotzdem als realistische
 *     Inhalte, damit die Detail-Seite was zum Rendern hat.
 */

test.describe("Workflow: Bautagesbericht Status-Übergänge (entwurf → eingereicht)", () => {
  let baustelleId = "";
  let berichtId = "";
  const bvhName = uniqMarker("BS-RPT");
  const heute = new Date().toISOString().slice(0, 10);

  test.beforeAll(async () => {
    const admin = adminClient();

    const { data: bs, error: bsErr } = await admin
      .from("baustellen")
      .insert({
        bvh_name: bvhName,
        kostenstelle: uniqMarker("KS-R"),
        status: "aktiv",
        kategorie: "baustelle",
      })
      .select("id")
      .single();
    if (bsErr) throw bsErr;
    baustelleId = (bs as { id: string }).id;

    const { data: bericht, error: brErr } = await admin
      .from("berichte")
      .insert({
        baustelle_id: baustelleId,
        datum: heute,
        typ: "bautagesbericht",
        status: "entwurf",
        erfasst_von: testUserId(),
        wetter_beschreibung: "sonnig",
        freitext_besonderheiten:
          "Allgemeine Tätigkeiten: Wandaufbau, Verputzarbeiten EG.",
      })
      .select("id")
      .single();
    if (brErr) throw brErr;
    berichtId = (bericht as { id: string }).id;
  });

  test("Berichte-Liste zeigt den neuen Bericht", async ({ page }) => {
    await page.goto("/berichte");
    await expect(page.locator("body")).toContainText(bvhName, {
      timeout: 10000,
    });
  });

  test("Bericht-Detail zeigt Klartext-Status 'Entwurf' und Buttons", async ({
    page,
  }) => {
    await page.goto(`/berichte/${berichtId}`);
    await expect(page.locator("body")).toContainText(bvhName, {
      timeout: 10000,
    });
    await expect(page.locator("body")).toContainText(/entwurf/i);
    // Der „Einreichen"-Button ist nur im Entwurf-Status sichtbar
    await expect(
      page.getByRole("button", { name: /einreichen/i }).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("Status auf 'eingereicht' setzen → Liste zeigt neuen Status", async ({
    page,
  }) => {
    const admin = adminClient();
    const { error } = await admin
      .from("berichte")
      .update({
        status: "eingereicht",
        eingereicht_am: new Date().toISOString(),
      })
      .eq("id", berichtId);
    if (error) throw error;

    await page.goto("/berichte");
    // Erst den Eintrag finden (per bvh_name), dann den Status-Text prüfen.
    await expect(page.locator("body")).toContainText(bvhName, {
      timeout: 10000,
    });
    await expect(page.locator("body")).toContainText(/eingereicht/i);
  });
});
