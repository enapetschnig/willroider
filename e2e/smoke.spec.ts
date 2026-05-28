import { test, expect } from "@playwright/test";

test.describe("Smoke — public routes", () => {
  test("Root redirects nicht eingeloggter User zu /auth", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/auth/);
    await expect(page.getByRole("heading", { name: /willroider/i }).first()).toBeVisible();
  });

  test("/stunden ist geschützt und leitet zu /auth", async ({ page }) => {
    await page.goto("/stunden");
    await expect(page).toHaveURL(/\/auth/);
  });

  test("/halle ist geschützt und leitet zu /auth", async ({ page }) => {
    await page.goto("/halle");
    await expect(page).toHaveURL(/\/auth/);
  });

  test("/baustellen ist geschützt", async ({ page }) => {
    await page.goto("/baustellen");
    await expect(page).toHaveURL(/\/auth/);
  });

  test("/admin ist geschützt", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/auth/);
  });

  test("Unbekannte Route führt zu NotFound", async ({ page }) => {
    await page.goto("/auth"); // erst auf erlaubte Seite
    await page.goto("/foo-bar-baz");
    await expect(page.locator("body")).toContainText(/404|nicht gefunden|not found/i, {
      timeout: 5000,
    });
  });
});

test.describe("Auth-Page UI", () => {
  test("Tabs Telefon/E-Mail sind sichtbar", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.getByRole("button", { name: /telefon/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /e-?mail/i }).first()).toBeVisible();
  });

  test("E-Mail-Tab zeigt Login-Formular", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("button", { name: /e-?mail/i }).first().click();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test("E-Mail-Login mit leeren Feldern wird verhindert", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("button", { name: /e-?mail/i }).first().click();
    const submit = page.getByRole("button", { name: /anmelden|einloggen/i }).first();
    await submit.click();
    // Browser-native required-Validation oder UI bleibt auf /auth
    await expect(page).toHaveURL(/\/auth/);
  });
});

test.describe("Build/Asset-Smoke", () => {
  test("Index lädt ohne JS-Fehler", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // Supabase 401 ist in /auth-Flow normal — filtern wir aus
    const echte = errors.filter(
      (e) => !/supabase|JWT|401|aborted/i.test(e) && !/Failed to load resource/i.test(e),
    );
    expect(echte).toEqual([]);
  });
});
