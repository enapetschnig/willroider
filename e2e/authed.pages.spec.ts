import { test, expect } from "@playwright/test";

/** Lädt eine Route + verifiziert dass keine harten Render-Fehler auftreten
 *  und nicht zurück nach /auth umgeleitet wird (= Auth funktioniert). */
async function smokePage(
  page: import("@playwright/test").Page,
  path: string,
  expectVisible: RegExp,
) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(path);
  await expect(page).not.toHaveURL(/\/auth/);
  await expect(page.locator("body")).toContainText(expectVisible, {
    timeout: 10_000,
  });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const echte = errors.filter(
    (e) =>
      !/supabase|JWT|401|aborted|Failed to load resource|net::ERR/i.test(e),
  );
  expect(echte, `Render-Fehler auf ${path}: ${echte.join("; ")}`).toEqual([]);
}

test.describe("Authentifizierte Seiten-Smokes", () => {
  test("Dashboard lädt + Admin-Sidebar sichtbar", async ({ page }) => {
    await smokePage(page, "/", /hallo|willkommen|dashboard/i);
    // Schnellzugriff-Cards müssen rendern
    await expect(
      page.getByRole("link", { name: /stunden erfassen/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /halle/i }).first(),
    ).toBeVisible();
  });

  test("Stunden-Seite lädt", async ({ page }) => {
    await smokePage(page, "/stunden", /zeiterfassung|stunden|arbeitsbeginn/i);
  });

  test("Halle-Seite lädt + zeigt Werk/Maschine-Label", async ({ page }) => {
    await smokePage(page, "/halle", /halle|werkstatt/i);
    // Toggle-Button-Leiste sollte "Werk/Maschine" anzeigen
    await expect(page.locator("body")).toContainText(/werk.?\/.?maschine/i, {
      timeout: 5000,
    });
  });

  test("Baustellen-Seite lädt", async ({ page }) => {
    await smokePage(page, "/baustellen", /baustellen/i);
  });

  test("Angebote-Seite lädt (Admin)", async ({ page }) => {
    await smokePage(page, "/angebote", /angebot/i);
  });

  test("Arbeitsplanung lädt", async ({ page }) => {
    await smokePage(page, "/arbeitsplanung", /planung|jahresplan|gantt/i);
  });

  test("Tagesplanung lädt", async ({ page }) => {
    await smokePage(page, "/tagesplanung", /tagesplan/i);
  });

  test("Stundenberichte-Liste lädt", async ({ page }) => {
    await smokePage(page, "/stundenberichte", /bericht/i);
  });

  test("Stundenauswertung lädt", async ({ page }) => {
    await smokePage(page, "/stunden/auswertung", /auswertung|csv|export/i);
  });

  test("Berichte lädt", async ({ page }) => {
    await smokePage(page, "/berichte", /berichte|bautag|regie/i);
  });

  test("MeinTag lädt", async ({ page }) => {
    await smokePage(page, "/mein-tag", /tag|einteilung|baustelle/i);
  });

  test("Admin/Verwaltung lädt", async ({ page }) => {
    await smokePage(page, "/admin", /verwaltung|stammdaten|mitarbeiter/i);
  });
});
