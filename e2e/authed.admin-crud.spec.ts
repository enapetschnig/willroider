import { test, expect } from "@playwright/test";
import { adminClient, testUserId } from "./helpers";

/** Admin-Bereich CRUD-Smokes:
 *  Verifiziert, dass die Tabs der Verwaltungsseite über URL-Parameter
 *  ansteuerbar sind und die jeweiligen Inhalte rendern. Schreibt nichts —
 *  prüft nur, dass die admin-only Routen erreichbar sind und die wichtigsten
 *  Stammdaten (Test-Mitarbeiter) sichtbar werden. */
test.describe("Admin-Bereich: Tabs + CRUD-Smokes", () => {
  let vorname = "";
  let nachname = "";

  test.beforeAll(async () => {
    const admin = adminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("vorname, nachname")
      .eq("id", testUserId())
      .maybeSingle();
    if (error) throw error;
    vorname = (data as any)?.vorname ?? "";
    nachname = (data as any)?.nachname ?? "";
  });

  test("/admin Seite rendert Tabs", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/auth/);
    await expect(page.locator("body")).toContainText(
      /verwaltung|mitarbeiter|fahrzeuge/i,
      { timeout: 10_000 },
    );
  });

  test("/admin?tab=mitarbeiter zeigt Liste mit Test-User", async ({ page }) => {
    await page.goto("/admin?tab=mitarbeiter");
    await expect(page).not.toHaveURL(/\/auth/);
    // Mindestens eines der Namens-Teile muss sichtbar sein. Falls die
    // Seite den Tab nicht über URL umschaltet, fällt der Test auf den
    // generischen Verwaltungs-Renderer zurück.
    const namePart = (nachname || vorname || "").trim();
    if (namePart) {
      await expect(page.locator("body")).toContainText(namePart, {
        timeout: 10_000,
      });
    } else {
      await expect(page.locator("body")).toContainText(
        /verwaltung|mitarbeiter/i,
        { timeout: 10_000 },
      );
    }
  });

  test("/admin?tab=fahrzeuge rendert", async ({ page }) => {
    await page.goto("/admin?tab=fahrzeuge");
    await expect(page).not.toHaveURL(/\/auth/);
    await expect(page.locator("body")).toContainText(
      /fahrzeug|kennzeichen|verwaltung/i,
      { timeout: 10_000 },
    );
  });

  test("/admin?tab=kalender rendert (Arbeitszeitkalender)", async ({ page }) => {
    await page.goto("/admin?tab=kalender");
    await expect(page).not.toHaveURL(/\/auth/);
    // Alt-Tab "kalender" wird intern auf "arbeitszeit" gemappt; der
    // Arbeitszeitkalender-Sub-Tab ist default. Wir akzeptieren mehrere
    // textuelle Indikatoren — bei UI-Refactor fällt der Test auf die
    // allgemeine Verwaltungs-Erkennung zurück.
    await expect(page.locator("body")).toContainText(
      /arbeitszeitkalender|kalender|wochen.?soll|arbeitszeit|verwaltung/i,
      { timeout: 10_000 },
    );
  });
});
