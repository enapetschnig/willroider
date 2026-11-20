// Probefahrt 18.11.2026: Die Änderungswunsch-Listen (Seite Änderungswünsche, Verwaltung → Änderungswünsche)
// signierten je Anhang einen eigenen Link, alle gleichzeitig und bei jeder Änderung neu → Storage 429/544
// (17.11.). Jetzt ein Sammelaufruf je Bucket; die Bilder müssen weiterhin erscheinen.
// Läuft NUR gegen die Testumgebung (testumgebung.mjs start):
// TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=http://localhost:55110 npx playwright test -c tests/roboter/playwright.config.ts
import { expect, test } from "@playwright/test";

const API = process.env.TEST_API_URL ?? "";
const ANON = process.env.TEST_ANON_KEY ?? "";
const SR = process.env.TEST_SERVICE_ROLE_KEY ?? "";
const APP = process.env.TEST_APP_URL ?? "http://localhost:55110";

test.skip(!API || !SR || !ANON, "nur mit Testumgebung");

const kopf = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
async function rest(pfad: string, methode: string, daten?: unknown) {
  const r = await fetch(`${API}${pfad}`, {
    method: methode,
    headers: { ...kopf, Prefer: "return=representation" },
    body: daten ? JSON.stringify(daten) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${methode} ${pfad}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}
// 1×1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const ANZAHL = 30;

test("Änderungswünsche: viele Anhänge mit einem Sammelaufruf signiert, Bilder sichtbar", async ({ browser }) => {
  const stamp = Date.now() * 1000 + Math.floor(Math.random() * 1000); // eindeutig auch bei gleichzeitigen Läufen
  const PW = "Test1234!x";
  const email = `chef.${stamp}${Math.random().toString(36).slice(2, 7)}@test.local`;
  const u = await rest("/auth/v1/admin/users", "POST", { email, password: PW, email_confirm: true });
  await rest(`/rest/v1/profiles?id=eq.${u.id}`, "PATCH", { vorname: "Chef", nachname: "Probe", is_active: true });
  await rest(`/rest/v1/user_roles?user_id=eq.${u.id}`, "DELETE");
  await rest("/rest/v1/user_roles", "POST", { user_id: u.id, role: "geschaeftsfuehrung" });
  const sitzung = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  }).then((r) => r.json());

  const pfade: string[] = [];
  for (let i = 0; i < ANZAHL; i++) {
    const pfad = `${u.id}/probe-${stamp}-${i}.png`;
    const r = await fetch(`${API}/storage/v1/object/feedback-dateien/${pfad}`, {
      method: "POST",
      headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "image/png" },
      body: PNG,
    });
    if (!r.ok) throw new Error(`Upload: ${r.status} ${await r.text()}`);
    pfade.push(pfad);
    await rest("/rest/v1/feedback", "POST", {
      erstellt_von: u.id, text: `Anhang-Wunsch ${i} ${stamp}`, kategorie: "problem", status: "neu",
      anhang_pfad: pfad, anhang_typ: "image/png", anhang_name: `bild-${stamp}-${i}.png`,
    });
  }

  const schluessel = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  const page = await ctx.newPage();
  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  let signierAufrufe = 0;
  page.on("request", (r) => {
    if (r.url().includes("/storage/v1/object/sign/feedback-dateien") && r.method() === "POST") signierAufrufe++;
  });
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [schluessel, JSON.stringify(sitzung)]);
  await page.addInitScript(() => localStorage.setItem("willroider:install-dismissed", "true"));

  const bilderSichtbar = async () => {
    const bilder = page.locator(`img[alt^="bild-${stamp}-"]`);
    await expect(bilder).toHaveCount(ANZAHL, { timeout: 20_000 });
    await expect
      .poll(() =>
        bilder.evaluateAll((els) => els.filter((e) => (e as HTMLImageElement).naturalWidth > 0).length),
      )
      .toBe(ANZAHL);
  };

  // 1) Seite Änderungswünsche
  await page.goto(`${APP}/aenderungswuensche`);
  await bilderSichtbar();
  console.log(`Änderungswünsche: ${signierAufrufe} Signier-Aufrufe für ${ANZAHL} Anhänge`);
  expect(signierAufrufe).toBeLessThanOrEqual(2);

  // 2) Verwaltung → Änderungswünsche
  signierAufrufe = 0;
  await page.goto(`${APP}/admin`);
  await page.getByRole("button", { name: "Änderungswünsche" }).first().click({ timeout: 20_000 });
  await bilderSichtbar();
  console.log(`Verwaltung: ${signierAufrufe} Signier-Aufrufe für ${ANZAHL} Anhänge`);
  expect(signierAufrufe).toBeLessThanOrEqual(2);

  expect(fehler).toEqual([]);
  await ctx.close();
  await rest(`/rest/v1/feedback?text=like.*${stamp}`, "DELETE");
  await fetch(`${API}/storage/v1/object/feedback-dateien`, {
    method: "DELETE",
    headers: kopf,
    body: JSON.stringify({ prefixes: pfade }),
  });
  await rest(`/auth/v1/admin/users/${u.id}`, "DELETE");
});
