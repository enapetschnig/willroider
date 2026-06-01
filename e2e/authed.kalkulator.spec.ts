import { test, expect } from "@playwright/test";

/** Bausatz-Kalkulator — native React-Page mit 4 Tabs.
 *  Wir prüfen: Route lädt, Tabs sind sichtbar, Default-Tab zeigt das
 *  Projekt-Formular, Wechsel auf Positionen + Admin funktioniert.
 *  Nav-Eintrag in der Sidebar ist sichtbar. */

test.describe("Bausatz-Kalkulator (native React)", () => {
  test("/kalkulator rendert mit 4 Tabs + Projekt-Default", async ({ page }) => {
    await page.goto("/kalkulator");
    await expect(page.locator("body")).toContainText(
      /bausatz-kalkulator/i,
      { timeout: 10000 },
    );
    // Tabs sichtbar
    await expect(page.getByRole("tab", { name: /projektdaten/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /positionen/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /zusammenfassung/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /k3-sätze/i })).toBeVisible();
    // Default-Inhalt: Projektdaten + BGK
    await expect(page.locator("body")).toContainText(
      /baustellengemeinkosten|BGK GESAMT/i,
    );
  });

  test("Tab-Wechsel zu Positionen zeigt Dach/Decken/Wände/Regie", async ({
    page,
  }) => {
    await page.goto("/kalkulator");
    await page.getByRole("tab", { name: /positionen/i }).click();
    // Innere Bereich-Tabs
    await expect(page.getByRole("tab", { name: /^Dach$/i }).first()).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByRole("tab", { name: /^Decken$/i }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: /^Wände$/i }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: /^Regie$/i }).first()).toBeVisible();
  });

  test("Tab-Wechsel zu Admin zeigt K3-Sätze", async ({ page }) => {
    await page.goto("/kalkulator");
    await page.getByRole("tab", { name: /k3-sätze/i }).click();
    await expect(page.locator("body")).toContainText(
      /mittellohnpreis|gesamtzuschlag/i,
      { timeout: 8000 },
    );
  });

  test("Nav-Eintrag Kalkulator sichtbar fuer Geschaeftsfuehrung", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: /^Kalkulator$/i }).first(),
    ).toBeVisible();
  });

  test("/kalkulator/anfragen rendert die Anfragen-Liste", async ({ page }) => {
    await page.goto("/kalkulator/anfragen");
    await expect(page.locator("body")).toContainText(
      /bausatz-anfragen|anfragen/i,
      { timeout: 10000 },
    );
    await expect(page.locator("body")).toContainText(
      /noch keine anfragen|kunde|status/i,
    );
  });
});
