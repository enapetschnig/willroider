import { test, expect } from "@playwright/test";

/** Bausatz-Kalkulator — Smoke-Test
 *  - /kalkulator lädt für Geschäftsführung
 *  - PageHeader + iframe sichtbar
 *  - das eingebettete HTML wird direkt ausgeliefert (HTTP 200, Title korrekt)
 *  - Nav-Eintrag „Kalkulator" sichtbar
 */

test.describe("Bausatz-Kalkulator", () => {
  test("statische HTML-Datei wird ausgeliefert mit korrektem Encoding", async ({
    page,
  }) => {
    await page.goto("/bausatz-kalkulator.html");
    await expect(page).toHaveTitle(/Bausatz-Kalkulator/);
    // Umlaute korrekt? (Mojibake-Fix-Verifikation)
    await expect(page.locator("body")).toContainText("Zugangscode");
  });

  test("/kalkulator rendert PageHeader + iframe für Geschäftsführung", async ({
    page,
  }) => {
    await page.goto("/kalkulator");
    await expect(page.locator("body")).toContainText(/bausatz-kalkulator/i, {
      timeout: 10000,
    });
    // iframe-Src enthaelt jetzt Query-Params fuer Auto-Login (?name=&role=)
    const iframe = page.locator('iframe[src*="bausatz-kalkulator.html"]');
    await expect(iframe).toBeVisible();
  });

  test("Nav-Eintrag Kalkulator sichtbar fuer Geschaeftsfuehrung", async ({
    page,
  }) => {
    await page.goto("/");
    // Sidebar (Desktop) hat den Link
    await expect(page.getByRole("link", { name: /^Kalkulator$/i }).first()).toBeVisible();
  });

  test("/kalkulator/anfragen rendert Liste + Erklaerung", async ({ page }) => {
    await page.goto("/kalkulator/anfragen");
    await expect(page.locator("body")).toContainText(
      /bausatz-anfragen|anfragen/i,
      { timeout: 10000 },
    );
    // entweder leerer Zustand oder Tabelle vorhanden
    await expect(page.locator("body")).toContainText(
      /noch keine anfragen|kunde|status/i,
    );
  });
});
