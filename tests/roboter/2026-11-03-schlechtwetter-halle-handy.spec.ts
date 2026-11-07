// Probefahrt Nachtschicht-Gegenprobe 03.11.2026 zu „SW muss der Baustelle zugewiesen sein mit Adresse“
// (J. Maurer 02.11.):
//  1) Halle-/Werk-Erfassung: Schlechtwetter hat eine Baustellenauswahl (echte Baustellen, keine Maschinen)
//     und lässt sich ohne Baustelle nicht speichern; gespeichert wird die gewählte Baustelle.
//  2) Stundenbericht am Handy (Kartenliste): SW zeigt Baustelle und Adresse wie Tabelle/PDF.
// Läuft NUR gegen die Testumgebung (testumgebung.mjs start), App mit VITE_SUPABASE_URL auf die Testumgebung:
// TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=http://localhost:55110 npx playwright test -c tests/roboter/playwright.config.ts
import { devices, expect, test } from "@playwright/test";

const API = process.env.TEST_API_URL ?? "";
const ANON = process.env.TEST_ANON_KEY ?? "";
const SR = process.env.TEST_SERVICE_ROLE_KEY ?? "";
const APP = process.env.TEST_APP_URL ?? "http://localhost:55110";

test.skip(!API || !SR || !ANON, "nur mit Testumgebung");
test.use({ ...devices["Pixel 7"], launchOptions: { executablePath: process.env.TEST_CHROME ?? "/usr/bin/google-chrome" } });

const kopf = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
async function rest(pfad: string, methode: string, daten?: unknown) {
  const r = await fetch(`${API}${pfad}`, { method: methode, headers: { ...kopf, Prefer: "return=representation" }, body: daten ? JSON.stringify(daten) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${methode} ${pfad}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}
const PW = "Test1234!x";
async function konto(name: string, rolle: string) {
  const email = `${name}.${Date.now()}@test.local`;
  const u = await rest("/auth/v1/admin/users", "POST", { email, password: PW, email_confirm: true });
  await rest(`/rest/v1/profiles?id=eq.${u.id}`, "PATCH", { vorname: name, nachname: "Test", is_active: true });
  await rest(`/rest/v1/user_roles?user_id=eq.${u.id}`, "DELETE");
  await rest("/rest/v1/user_roles", "POST", { user_id: u.id, role: rolle });
  const sitzung = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }),
  }).then((r) => r.json());
  return { id: u.id as string, sitzung };
}
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("Schlechtwetter in der Halle mit Baustelle, Handy-Bericht mit Adresse", async ({ page }) => {
  const ma = await konto("Halle", "mitarbeiter");
  const stamp = Date.now();
  await rest("/rest/v1/baustellen", "POST", { bvh_name: `Säge ${stamp}`, kategorie: "maschine", status: "aktiv" });
  const [bs] = await rest("/rest/v1/baustellen", "POST", {
    bvh_name: `SW Probe ${stamp}`, status: "aktiv", kostenstelle: `9${String(stamp).slice(-6)}`, baustellen_adresse: "Teststraße 1", plz: "9500", ort: "Villach",
  });

  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  const schluessel = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [schluessel, JSON.stringify(ma.sitzung)]);
  // Der Installations-Hinweis geht am Handy nach 800 ms auf und verdeckt die Seite — hier nicht das Thema.
  await page.addInitScript(() => localStorage.setItem("willroider:install-dismissed", "true"));

  // 1) Halle: SW antippen → Baustellenauswahl da, Werk-Ziel-Feld nicht
  await page.goto(`${APP}/halle`);
  await page.getByRole("button", { name: "Schlechtwetter" }).first().click();
  const sektion = page.locator("div.rounded-md.border-l-4").filter({ hasText: "Schlechtwetter" });
  await expect(sektion.getByRole("combobox")).toContainText("Baustelle wählen");
  await expect(sektion.getByText("Für welche Baustelle?")).toHaveCount(0);
  await sektion.locator('input[inputmode="decimal"]').fill("4");
  await sektion.locator('input[inputmode="decimal"]').blur(); // das Stundenfeld übernimmt beim Verlassen
  await expect(sektion.getByText("Bitte die Baustelle wählen, auf der Schlechtwetter war.")).toBeVisible();

  // ohne Baustelle speichern → abgelehnt, nichts gespeichert
  await page.getByRole("button", { name: "Tag speichern" }).last().click();
  await expect(page.getByText("Bitte bei Schlechtwetter die Baustelle wählen.").first()).toBeVisible();
  expect(await rest(`/rest/v1/stunden_tage?mitarbeiter_id=eq.${ma.id}&select=id`, "GET")).toHaveLength(0);

  // Baustelle wählen (Maschinen stehen nicht in der Liste) und speichern
  await sektion.getByRole("combobox").click();
  await expect(page.getByRole("option", { name: new RegExp(`Säge ${stamp}`) })).toHaveCount(0);
  await page.getByRole("option", { name: new RegExp(`SW Probe ${stamp}`) }).click();
  await page.getByRole("button", { name: "Tag speichern" }).last().click();
  await expect(page.getByText("Halle-Stunden gespeichert").first()).toBeVisible();
  const heute = iso(new Date());
  const tage = await rest(`/rest/v1/stunden_tage?mitarbeiter_id=eq.${ma.id}&select=id,datum,stunden_taetigkeiten(art,baustelle_id,stunden)`, "GET");
  expect(tage).toHaveLength(1);
  expect(tage[0].datum).toBe(heute);
  expect(tage[0].stunden_taetigkeiten).toEqual([{ art: "schlechtwetter", baustelle_id: bs.id, stunden: 4 }]);

  // 2) Stundenbericht am Handy: SW mit Baustelle und Adresse
  const d = new Date();
  const teil = d.getDate() <= 15 ? 1 : 2;
  const von = new Date(d.getFullYear(), d.getMonth(), teil === 1 ? 1 : 16);
  const bis = teil === 1 ? new Date(d.getFullYear(), d.getMonth(), 15) : new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const [ber] = await rest("/rest/v1/stunden_berichte", "POST", {
    mitarbeiter_id: ma.id, jahr: d.getFullYear(), monat: d.getMonth() + 1, teil, von_datum: iso(von), bis_datum: iso(bis),
  });
  await page.goto(`${APP}/stundenbericht/${ber.id}`);
  const karten = page.locator("div.lg\\:hidden").first();
  await expect(karten.getByText(`Schlechtwetter – SW Probe ${stamp}, Teststraße 1, 9500 Villach`)).toBeVisible({ timeout: 20_000 });
  await expect(karten.getByText(`KST 9${String(stamp).slice(-6)}`)).toBeVisible();
  expect(fehler).toEqual([]);
});
