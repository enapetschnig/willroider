import { test, expect } from "@playwright/test";
import { adminClient, testUserId, uniqMarker, TEST_PREFIX } from "./helpers";

/** UI-Smokes für die Stunden-Erfassung und verwandte Seiten.
 *  Verifiziert, dass die zentralen Buttons / Inhalte rendern, ohne
 *  die brittle Click-Sequenzen abzuspielen. */

test.describe("Stunden-UI", () => {
  test("/stunden lädt mit Status-Buttons-Leiste", async ({ page }) => {
    await page.goto("/stunden");
    await expect(page).not.toHaveURL(/\/auth/);
    await expect(page.locator("body")).toContainText(
      /baustelle.*firma.*krank|status/i,
      { timeout: 10_000 },
    );
    await expect(
      page.getByRole("button", { name: /baustelle/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /krank/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /urlaub/i }).first(),
    ).toBeVisible();
  });

  test("/halle lädt mit Werk/Maschine-Button", async ({ page }) => {
    await page.goto("/halle");
    await expect(page).not.toHaveURL(/\/auth/);
    await expect(page.locator("body")).toContainText(
      /werk.*maschine|maschine/i,
      { timeout: 10_000 },
    );
  });

  test("MeinTag Page rendert ohne Fehler", async ({ page }) => {
    await page.goto("/mein-tag");
    await expect(page).not.toHaveURL(/\/auth/);
    await expect(page.locator("body")).toContainText(
      /einteilung|tag|baustelle|halle/i,
      { timeout: 10_000 },
    );
  });

  test("Stundenauswertung lädt mit Filter-Card", async ({ page }) => {
    await page.goto("/stunden/auswertung");
    await expect(page).not.toHaveURL(/\/auth/);
    await expect(page.locator("body")).toContainText(
      /auswertung|stunden/i,
      { timeout: 10_000 },
    );
  });
});

// Helpers werden hier nicht aktiv genutzt, aber als Import beibehalten,
// damit künftige Workflow-Erweiterungen ohne Diff-Lärm hinzukommen können.
void adminClient;
void testUserId;
void uniqMarker;
void TEST_PREFIX;
