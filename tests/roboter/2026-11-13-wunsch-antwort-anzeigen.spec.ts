// Probefahrt 13.11.2026: Die Antwort auf einen Änderungswunsch (feedback.admin_notiz) wird angezeigt —
// beim Melder unter „Meine Wünsche“ (nur seine eigenen), auf der Seite Änderungswünsche und in der
// Verwaltung (Reiter Änderungswünsche). Vorher stand die Antwort nur in der Datenbank.
// Läuft NUR gegen die Testumgebung (testumgebung.mjs start):
// TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=http://localhost:55810 npx playwright test -c tests/roboter/playwright.config.ts
import { expect, test } from "@playwright/test";

const API = process.env.TEST_API_URL ?? "";
const ANON = process.env.TEST_ANON_KEY ?? "";
const SR = process.env.TEST_SERVICE_ROLE_KEY ?? "";
const APP = process.env.TEST_APP_URL ?? "http://localhost:55210";

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
const PW = "Test1234!x";
async function konto(vorname: string, rolle: string) {
  const email = `${vorname.toLowerCase()}.${Date.now()}@test.local`;
  const u = await rest("/auth/v1/admin/users", "POST", { email, password: PW, email_confirm: true });
  await rest(`/rest/v1/profiles?id=eq.${u.id}`, "PATCH", { vorname, nachname: "Probe", is_active: true });
  await rest(`/rest/v1/user_roles?user_id=eq.${u.id}`, "DELETE");
  await rest("/rest/v1/user_roles", "POST", { user_id: u.id, role: rolle });
  const sitzung = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  }).then((r) => r.json());
  return { id: u.id as string, sitzung };
}

test("Antwort auf Änderungswunsch: Melder sieht sie bei eigenen Wünschen, Verwaltung überall", async ({ browser }) => {
  const stamp = Date.now();
  const ma = await konto(`Melder${stamp % 10000}`, "mitarbeiter");
  const andere = await konto(`Andere${stamp % 10000}`, "mitarbeiter");
  const gf = await konto(`Chef${stamp % 10000}`, "geschaeftsfuehrung");

  const antwortEigen = `Unter Stunden steht das jetzt oben ${stamp}`;
  const antwortFremd = `Fremde Antwort ${stamp}`;
  const [eigen] = await rest("/rest/v1/feedback", "POST", {
    erstellt_von: ma.id, text: `Mein Wunsch ${stamp}`, kategorie: "idee", status: "umgesetzt", admin_notiz: antwortEigen,
  });
  await rest("/rest/v1/feedback", "POST", {
    erstellt_von: ma.id, text: `Offener Wunsch ${stamp}`, kategorie: "problem", status: "neu",
  });
  await rest("/rest/v1/feedback", "POST", {
    erstellt_von: andere.id, text: `Wunsch von wem anderen ${stamp}`, kategorie: "idee", status: "umgesetzt", admin_notiz: antwortFremd,
  });

  // Rechte: der Melder liest admin_notiz nur bei eigenen Wünschen.
  const sicht = await fetch(`${API}/rest/v1/feedback?select=id,admin_notiz`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ma.sitzung.access_token}` },
  }).then((r) => r.json());
  expect(sicht.find((r: { id: string }) => r.id === eigen.id)?.admin_notiz).toBe(antwortEigen);
  expect(JSON.stringify(sicht)).not.toContain(antwortFremd);

  const schluessel = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
  const seite = async (sitzung: unknown) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const fehler: string[] = [];
    page.on("pageerror", (e) => fehler.push(e.message));
    await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [schluessel, JSON.stringify(sitzung)]);
    await page.addInitScript(() => localStorage.setItem("willroider:install-dismissed", "true"));
    return { page, fehler, ctx };
  };

  // 1) Melder: Änderungswunsch-Dialog → „Meine Wünsche“
  {
    const { page, fehler, ctx } = await seite(ma.sitzung);
    await page.goto(`${APP}/`);
    await page.getByRole("button", { name: /Änderungswunsch senden|Änderungswunsch/ }).first().click({ timeout: 20_000 });
    await page.getByRole("button", { name: "Meine Wünsche" }).click();
    const antwort = page.getByTestId("wunsch-antwort");
    await expect(antwort).toHaveCount(1);
    await expect(antwort).toContainText("Antwort:");
    await expect(antwort).toContainText(antwortEigen);
    await expect(page.getByText(`Offener Wunsch ${stamp}`)).toBeVisible();
    await expect(page.getByText(antwortFremd)).toHaveCount(0);
    expect(fehler).toEqual([]);
    await ctx.close();
  }

  // 2) Geschäftsführung: Seite Änderungswünsche → Erledigt
  {
    const { page, fehler, ctx } = await seite(gf.sitzung);
    await page.goto(`${APP}/aenderungswuensche`);
    await page.getByRole("button", { name: /^Erledigt/ }).first().click({ timeout: 20_000 });
    await expect(page.getByText(antwortEigen)).toBeVisible();
    await expect(page.getByText(antwortFremd)).toBeVisible();

    // 3) Verwaltung → Änderungswünsche → Umgesetzt
    await page.goto(`${APP}/admin`);
    await page.getByRole("button", { name: "Änderungswünsche" }).first().click({ timeout: 20_000 });
    await page.getByRole("button", { name: "Umgesetzt", exact: true }).click();
    await expect(page.getByText(antwortEigen)).toBeVisible();
    await expect(page.getByTestId("wunsch-antwort").first()).toContainText("Antwort:");
    expect(fehler).toEqual([]);
    await ctx.close();
  }

  await rest(`/rest/v1/feedback?text=like.*${stamp}`, "DELETE");
});
