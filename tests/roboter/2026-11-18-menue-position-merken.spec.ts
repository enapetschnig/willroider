// Probefahrt 18.11.2026 (E. Winkler, „letzte Position pro Menüpunkt merken, wie im Explorer“):
//  Baustellen → Baustelle → Dokumente → Ordner → Unterordner, dann „Pläne“ und wieder „Baustellen“
//  → man ist wieder im Unterordner. Zurück-Knopf führt zur Baustellen-Liste (nicht zu „Pläne“).
//  Nochmal auf den Menüpunkt, in dem man gerade ist → Übersicht. Neu laden behält den Ordner.
//  Gelöschte Baustelle als gemerkte Position → Liste statt Dauer-Laden.
//  Mit OneDrive verknüpfte Baustelle (Ordner aus dem SharePoint-Spiegel, wie beim Kunden) und eine unverknüpfte.
//  Seite ohne eigenen Menüpunkt (/evaluierung) bleibt beim richtigen Menüpunkt (keine Falle).
//  Zurück aus einer Baustelle, die man aus einem anderen Menüpunkt geöffnet hat → wieder dorthin.
// Alle Daten künstlich. Läuft NUR gegen die Testumgebung:
// TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=http://localhost:55310 npx playwright test -c tests/roboter/playwright.config.ts
import { expect, test, type Page } from "@playwright/test";

const API = process.env.TEST_API_URL ?? "";
const ANON = process.env.TEST_ANON_KEY ?? "";
const SR = process.env.TEST_SERVICE_ROLE_KEY ?? "";
const APP = process.env.TEST_APP_URL ?? "http://localhost:55110";

test.skip(!API || !SR || !ANON, "nur mit Testumgebung");
test.use({ screenshot: "only-on-failure", viewport: { width: 1400, height: 900 } });

const kopf = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
async function rest(pfad: string, methode: string, daten?: unknown) {
  const r = await fetch(`${API}${pfad}`, { method: methode, headers: { ...kopf, Prefer: "return=representation" }, body: daten ? JSON.stringify(daten) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${methode} ${pfad}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}
const PW = "Test1234!x";
async function konto(vorname: string, nachname: string, rolle: string) {
  const email = `menue-pos-${vorname}.${Date.now()}${Math.random().toString(36).slice(2, 7)}@test.local`;
  const u = await rest("/auth/v1/admin/users", "POST", { email, password: PW, email_confirm: true });
  await rest(`/rest/v1/profiles?id=eq.${u.id}`, "PATCH", { vorname, nachname, is_active: true });
  await rest(`/rest/v1/user_roles?user_id=eq.${u.id}`, "DELETE");
  await rest("/rest/v1/user_roles", "POST", { user_id: u.id, role: rolle });
  const sitzung = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }),
  }).then((r) => r.json());
  return { id: u.id as string, sitzung };
}
async function anmelden(page: Page, sitzung: unknown) {
  const schluessel = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, [schluessel, JSON.stringify(sitzung)]);
}
const menue = (page: Page, name: string) => page.locator("aside nav, nav").first().getByRole("link", { name, exact: true });

test("Seitenleiste merkt sich je Menüpunkt die letzte Position (Baustelle → Dokumente → Ordner)", async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
  const buero = await konto("Elias", `Menue${stamp}`, "buero");
  const name = `Menü-Probe ${stamp}`;
  const [bs] = await rest("/rest/v1/baustellen", "POST", { bvh_name: name, kostenstelle: `14055${stamp}`, status: "aktiv", sharepoint_item_id: `probe-${stamp}` });
  const [ohne] = await rest("/rest/v1/baustellen", "POST", { bvh_name: `Menü-Ohne ${stamp}`, kostenstelle: `14057${stamp}`, status: "aktiv" });
  const [weg] = await rest("/rest/v1/baustellen", "POST", { bvh_name: `Menü-Weg ${stamp}`, kostenstelle: `14056${stamp}`, status: "aktiv" });
  // Verknüpft: Ordner und Datei kommen aus dem SharePoint-Spiegel
  const top = "1-Baustellenmanagement";
  await rest("/rest/v1/sharepoint_unterordner", "POST", [
    { baustelle_id: bs.id, drive_id: "d", item_id: `o1-${stamp}`, pfad: top, name: top, top, ordner: "1-baustellenmanagement", tiefe: 1 },
    { baustelle_id: bs.id, drive_id: "d", item_id: `o2-${stamp}`, pfad: `${top}/Bauzeitplan`, name: "Bauzeitplan", top, ordner: "1-baustellenmanagement", tiefe: 2 },
  ]);
  await rest("/rest/v1/sharepoint_dateien", "POST", {
    baustelle_id: bs.id, drive_id: "d", item_id: `f1-${stamp}`, ordner: "1-baustellenmanagement", subpath: "Bauzeitplan",
    sp_pfad: `${top}/Bauzeitplan/Zeitplan-${stamp}.pdf`, dateiname: `Zeitplan-${stamp}.pdf`, mimetype: "application/pdf", groesse: 10,
  });
  // Unverknüpft: App-eigene Ordner
  await rest("/rest/v1/dokumente", "POST", {
    baustelle_id: ohne.id, ordner: "91-plaene", subpath: "Werkplanung", dateiname: `Werkplan-${stamp}.pdf`,
    storage_path: `${ohne.id}/91-plaene/x-${stamp}.pdf`, mimetype: "application/pdf", groesse: 10, hochgeladen_von: buero.id,
  });

  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  await anmelden(page, buero.sitzung);

  // Baustellen → Baustelle → Dokumente → 1-Baustellenmanagement → Bauzeitplan
  await page.goto(`${APP}/baustellen`);
  await page.getByPlaceholder(/Suche/).first().fill(name);
  await page.getByText(name, { exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`/baustellen/${bs.id}`));
  await page.getByText("1-Baustellenmanagement", { exact: true }).first().click();
  await page.getByText("Bauzeitplan", { exact: true }).first().click();
  await expect(page.getByText(`Zeitplan-${stamp}.pdf`).first()).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/dok=sp%3A1-Baustellenmanagement/);
  await expect(page).toHaveURL(/pfad=Bauzeitplan/);

  // → Pläne → zurück zu Baustellen: wieder im Unterordner
  await menue(page, "Pläne").click();
  await expect(page).toHaveURL(/\/plaene$/);
  await menue(page, "Baustellen").click();
  await expect(page).toHaveURL(new RegExp(`/baustellen/${bs.id}\\?.*dok=sp%3A1-Baustellenmanagement`));
  await expect(page.getByText(`Zeitplan-${stamp}.pdf`).first()).toBeVisible({ timeout: 15_000 });

  // Neu laden behält den Ordner
  await page.reload();
  await expect(page.getByText(`Zeitplan-${stamp}.pdf`).first()).toBeVisible({ timeout: 15_000 });

  // Reiter wird auch gemerkt
  await page.getByRole("tab", { name: /Stammdaten/ }).or(page.getByRole("button", { name: /Stammdaten/ })).first().click();
  await expect(page).toHaveURL(/tab=info/);
  await menue(page, "Pläne").click();
  await menue(page, "Baustellen").click();
  await expect(page).toHaveURL(/tab=info/);

  // Zurück-Knopf → Baustellen-Liste, nicht „Pläne“
  await page.getByRole("button", { name: "Zurück" }).first().click();
  await expect(page).toHaveURL(/\/baustellen$/);

  // Erneut in die Baustelle, dann auf „Baustellen“ (gleicher Menüpunkt) → Übersicht
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/baustellen/${bs.id}`));
  await menue(page, "Baustellen").click();
  await expect(page).toHaveURL(/\/baustellen$/);

  // Unverknüpfte Baustelle: Pläne → Werkplanung, hin und zurück
  await page.goto(`${APP}/baustellen/${ohne.id}`);
  await page.getByText("91-Pläne", { exact: true }).first().click();
  await page.getByText("Werkplanung", { exact: true }).first().click();
  await expect(page.getByText(`Werkplan-${stamp}.pdf`).first()).toBeVisible({ timeout: 15_000 });
  await menue(page, "Pläne").click();
  await menue(page, "Baustellen").click();
  await expect(page).toHaveURL(/dok=91-plaene&pfad=Werkplanung/);
  await expect(page.getByText(`Werkplan-${stamp}.pdf`).first()).toBeVisible({ timeout: 15_000 });

  // Seite ohne Menüpunkt (Evaluierung aus der Baustelle): bleibt bei „Baustellen“, kein Hängenbleiben
  await page.getByRole("button", { name: /Unterweisung/ }).first().click();
  await page.getByRole("button", { name: "Neue Evaluierung" }).first().click();
  await expect(page).toHaveURL(/\/evaluierung\?baustelle=/);
  await page.getByRole("dialog").getByRole("button", { name: "Abbrechen" }).click(); // Dialog „Neue Evaluierung“
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await menue(page, "Pläne").click();
  await menue(page, "Baustellen").click();
  await expect(page).toHaveURL(/\/evaluierung\?baustelle=/);
  await page.getByRole("dialog").getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await menue(page, "Baustellen").click(); // gleicher Menüpunkt → Übersicht
  await expect(page).toHaveURL(/\/baustellen$/);

  // Baustelle aus einem anderen Menüpunkt geöffnet → Zurück führt wieder dorthin
  await menue(page, "Pläne").click();
  await page.goto(`${APP}/baustellen/${ohne.id}`); // wie ein Link aus „Mein Tag“/Dashboard
  await expect(page).toHaveURL(new RegExp(`/baustellen/${ohne.id}`));
  await page.getByRole("button", { name: "Zurück" }).first().click();
  await expect(page).toHaveURL(/\/plaene$/);

  // Gemerkte Baustelle wurde inzwischen gelöscht → Liste statt Dauer-Laden
  await page.goto(`${APP}/baustellen/${weg.id}?tab=dokumente`);
  await expect(page.getByText(`Menü-Weg ${stamp}`).first()).toBeVisible({ timeout: 15_000 });
  await menue(page, "Pläne").click();
  await rest(`/rest/v1/baustellen?id=eq.${weg.id}`, "DELETE");
  await menue(page, "Baustellen").click();
  await expect(page).toHaveURL(/\/baustellen$/, { timeout: 15_000 });

  expect(fehler).toEqual([]);

  await rest(`/rest/v1/dokumente?baustelle_id=eq.${ohne.id}`, "DELETE").catch(() => null);
  for (const id of [bs.id, ohne.id]) await rest(`/rest/v1/baustellen?id=eq.${id}`, "DELETE").catch(() => null);
  await rest(`/auth/v1/admin/users/${buero.id}`, "DELETE").catch(() => null);
});
