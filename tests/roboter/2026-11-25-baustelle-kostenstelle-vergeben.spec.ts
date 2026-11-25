// Supabase-Protokoll 24.11.2026: zweimal „duplicate key value violates unique constraint
// baustellen_kostenstelle_key“ beim Anlegen einer Baustelle – die App zeigte nur die rohe DB-Meldung.
// Jetzt: vorher prüfen, verständlicher Hinweis mit dem Bauvorhaben, nichts wird angelegt;
// mit freier Kostenstelle geht es danach normal durch.
// Läuft NUR gegen die Testumgebung (testumgebung.mjs start).
import { expect, test } from "@playwright/test";

const API = process.env.TEST_API_URL ?? "";
const ANON = process.env.TEST_ANON_KEY ?? "";
const SR = process.env.TEST_SERVICE_ROLE_KEY ?? "";
const APP = process.env.TEST_APP_URL ?? "http://localhost:55410";

test.skip(!API || !SR || !ANON, "nur mit Testumgebung");

const kopf = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
async function rest(pfad: string, methode: string, daten?: unknown) {
  const r = await fetch(`${API}${pfad}`, { method: methode, headers: { ...kopf, Prefer: "return=representation" }, body: daten ? JSON.stringify(daten) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${methode} ${pfad}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}
const PW = "Test1234!x";

test("Neue Planung mit schon vergebener Kostenstelle: klarer Hinweis statt DB-Meldung", async ({ page }) => {
  const email = `kstdup.${Date.now()}${Math.random().toString(36).slice(2, 7)}@test.local`;
  const u = await rest("/auth/v1/admin/users", "POST", { email, password: PW, email_confirm: true });
  await rest(`/rest/v1/profiles?id=eq.${u.id}`, "PATCH", { vorname: "Kst", nachname: "Test", is_active: true });
  await rest(`/rest/v1/user_roles?user_id=eq.${u.id}`, "DELETE");
  await rest("/rest/v1/user_roles", "POST", { user_id: u.id, role: "geschaeftsfuehrung" });
  const sitzung = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }),
  }).then((r) => r.json());

  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const kst = `1404895-${stamp}`;
  await rest("/rest/v1/baustellen", "POST", { bvh_name: `Vorhanden Kst ${stamp}`, status: "geplant", art: "planung", kostenstelle: kst });

  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  const schluessel = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [schluessel, JSON.stringify(sitzung)]);

  await page.goto(`${APP}/baustellen?tab=planung`);
  await page.getByRole("button", { name: "Neue Planung" }).click();
  const dialog = page.getByRole("dialog");
  const kstFeld = dialog.locator('input[placeholder^="z.B. 1404895"]');
  // Automatische Vergabe abwarten, sonst überschreibt sie die Eingabe
  await expect(kstFeld).toHaveValue(/^1404895-\d+/, { timeout: 20_000 });
  await dialog.locator("input").first().fill(`Neu Kst ${stamp}`);
  await kstFeld.fill(kst);
  await dialog.locator('button[type="submit"]').click();

  await expect(page.getByText("Kostenstelle schon vergeben").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(`Vorhanden Kst ${stamp}`).first()).toBeVisible();
  await expect(page.getByText("duplicate key")).toHaveCount(0);
  await expect(dialog).toBeVisible();
  const zeilen = await rest(`/rest/v1/baustellen?kostenstelle=eq.${encodeURIComponent(kst)}&select=bvh_name`, "GET");
  expect(zeilen.map((z: { bvh_name: string }) => z.bvh_name)).toEqual([`Vorhanden Kst ${stamp}`]);
  expect(fehler).toEqual([]);
});
