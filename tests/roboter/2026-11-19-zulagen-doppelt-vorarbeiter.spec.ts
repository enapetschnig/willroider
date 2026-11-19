// Probefahrt 19.11.2026 zu J. Maurer („Für dieselbe Tätigkeit nur eine Zulage … Beide Zulagen für dieselbe
// Stunde und denselben Umstand zu zahlen, wäre eine Doppelabgeltung“ + „Vorarbeiterzulage … nur für Tripold
// Martin zum Auswählen“):
//  - Schmutz- und Abbruchzulage für dieselben Stunden lässt sich nicht mehr speichern: Antippen der zweiten
//    schaltet um bzw. gibt ihr nur die restlichen Stunden; ein alter Doppel-Tag zeigt den Hinweis und wird
//    nicht gespeichert.
//  - Vorarbeiterzulage sehen nur Zugeteilte; wer nur sie zugeteilt hat, behält alle normalen Zulagen; die
//    Datenbank lässt sie bei Nicht-Zugeteilten weg.
// Läuft NUR gegen die Testumgebung (testumgebung.mjs start):
// TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=http://localhost:55410 npx playwright test -c tests/roboter/playwright.config.ts
import { expect, test, type Page } from "@playwright/test";

const API = process.env.TEST_API_URL ?? "";
const ANON = process.env.TEST_ANON_KEY ?? "";
const SR = process.env.TEST_SERVICE_ROLE_KEY ?? "";
const APP = process.env.TEST_APP_URL ?? "http://localhost:55410";

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
  await rest(`/rest/v1/profiles?id=eq.${u.id}`, "PATCH", { vorname, nachname: "Zulage", is_active: true });
  await rest(`/rest/v1/user_roles?user_id=eq.${u.id}`, "DELETE");
  await rest("/rest/v1/user_roles", "POST", { user_id: u.id, role: rolle });
  const sitzung = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  }).then((r) => r.json());
  return { id: u.id as string, sitzung };
}
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function vergangenerWerktag(tageZurueck: number): string {
  const d = new Date();
  d.setDate(d.getDate() - tageZurueck);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return iso(d);
}

async function typ(bezeichnung: string): Promise<string> {
  const [t] = await rest(`/rest/v1/zulagen_typen?bezeichnung=eq.${bezeichnung}&select=id`, "GET");
  return t.id;
}
async function tagMit8h(maId: string, datum: string, baustelleId: string) {
  const [tag] = await rest("/rest/v1/stunden_tage", "POST", {
    mitarbeiter_id: maId, datum, tag_status: "baustelle", erfasst_von: maId,
  });
  await rest("/rest/v1/stunden_taetigkeiten", "POST", [
    { stunden_tag_id: tag.id, position: 1, art: "baustelle", baustelle_id: baustelleId, stunden: 8 },
  ]);
  return tag.id as string;
}
async function zulagenVon(tagId: string) {
  const rows = await rest(
    `/rest/v1/stunden_zulagen?stunden_tag_id=eq.${tagId}&select=stunden,zulagen_typen(bezeichnung)`,
    "GET",
  );
  return rows
    .map((r: any) => `${r.zulagen_typen.bezeichnung}:${r.stunden == null ? "-" : Number(r.stunden)}`)
    .sort();
}

async function anmelden(page: Page, sitzung: unknown) {
  const schluessel = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [schluessel, JSON.stringify(sitzung)]);
  await page.addInitScript(() => localStorage.setItem("willroider:install-dismissed", "true"));
}
const chip = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name}(\\s?· .*)?$`) });
async function speichern(page: Page) {
  await page.getByRole("button", { name: /speichern/i }).last().click();
}

test("Schmutz- und Abbruchzulage nie für dieselben Stunden", async ({ page }) => {
  const stamp = Date.now();
  const ma = await konto(`Zul${stamp % 100000}`, "mitarbeiter");
  const [bst] = await rest("/rest/v1/baustellen", "POST", {
    bvh_name: `Zulagen Probe ${stamp}`, status: "aktiv", kostenstelle: `6${String(stamp).slice(-6)}`,
  });
  const schmutz = await typ("Schmutzzulage");
  const abbruch = await typ("Abbruchzulage");
  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  page.on("dialog", (d) => d.accept());
  await anmelden(page, ma.sitzung);

  // 1) Ganzer Tag Schmutz, dann Abbruch antippen → umgeschaltet, gespeichert nur Abbruch.
  const tag1Datum = vergangenerWerktag(3);
  const tag1 = await tagMit8h(ma.id, tag1Datum, bst.id);
  await page.goto(`${APP}/stunden?datum=${tag1Datum}`);
  await expect(chip(page, "Schmutzzulage")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await chip(page, "Schmutzzulage").click();
  await expect(page.getByRole("button", { name: /^Schmutzzulage\s?· 8h$/ })).toBeVisible();
  await chip(page, "Abbruchzulage").click();
  await expect(page.getByRole("button", { name: /^Abbruchzulage\s?· 8h$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Schmutzzulage", exact: true })).toBeVisible();
  await speichern(page);
  await expect(page.getByText(/\d+ (Eintrag|Einträge) gespeichert/).first()).toBeVisible();
  expect(await zulagenVon(tag1)).toEqual(["Abbruchzulage:8"]);

  // 2) Schmutz nur 5 Std. → Abbruch bekommt die restlichen 3 Std., beide werden gespeichert.
  await rest(`/rest/v1/stunden_zulagen?stunden_tag_id=eq.${tag1}`, "DELETE");
  await rest("/rest/v1/stunden_zulagen", "POST", { stunden_tag_id: tag1, zulagen_typ_id: schmutz, stunden: 5 });
  await page.goto(`${APP}/stunden?datum=${tag1Datum}`);
  await expect(page.getByRole("button", { name: /^Schmutzzulage\s?· 5h$/ })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await chip(page, "Abbruchzulage").click();
  await expect(page.getByRole("button", { name: /^Abbruchzulage\s?· 3h$/ })).toBeVisible();
  await speichern(page);
  await expect(page.getByText(/\d+ (Eintrag|Einträge) gespeichert/).first()).toBeVisible();
  expect(await zulagenVon(tag1)).toEqual(["Abbruchzulage:3", "Schmutzzulage:5"]);

  // 3) Alter Doppel-Tag (beide 8 Std.) → Hinweis, Speichern gesperrt, nichts verändert.
  const tag2Datum = vergangenerWerktag(10);
  const tag2 = await tagMit8h(ma.id, tag2Datum, bst.id);
  await rest("/rest/v1/stunden_zulagen", "POST", [
    { stunden_tag_id: tag2, zulagen_typ_id: schmutz, stunden: 8 },
    { stunden_tag_id: tag2, zulagen_typ_id: abbruch, stunden: 8 },
  ]);
  await page.goto(`${APP}/stunden?datum=${tag2Datum}`);
  await expect(page.getByRole("button", { name: /^Abbruchzulage\s?· 8h$/ })).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByText(/Schmutzzulage und Abbruchzulage gibt es nicht für dieselben Stunden/).first(),
  ).toBeVisible();
  await speichern(page);
  await expect(page.getByText("Zulagen doppelt").first()).toBeVisible();
  expect(await zulagenVon(tag2)).toEqual(["Abbruchzulage:8", "Schmutzzulage:8"]);
  expect(fehler).toEqual([]);
});

test("Vorarbeiterzulage nur für zugeteilte Mitarbeiter", async ({ page }) => {
  const stamp = Date.now();
  const vorarbeiter = await konto(`Vor${stamp % 100000}`, "mitarbeiter");
  const anderer = await konto(`And${stamp % 100000}`, "mitarbeiter");
  const [bst] = await rest("/rest/v1/baustellen", "POST", {
    bvh_name: `Vorarbeiter Probe ${stamp}`, status: "aktiv", kostenstelle: `5${String(stamp).slice(-6)}`,
  });
  const vz = await typ("Vorarbeiterzulage");
  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  page.on("dialog", (d) => d.accept());
  await anmelden(page, vorarbeiter.sitzung);

  const datum = vergangenerWerktag(4);
  const tag = await tagMit8h(vorarbeiter.id, datum, bst.id);

  // Ohne Zuteilung: alle normalen Zulagen, keine Vorarbeiterzulage.
  await page.goto(`${APP}/stunden?datum=${datum}`);
  await expect(chip(page, "Schmutzzulage")).toBeVisible({ timeout: 20_000 });
  await expect(chip(page, "Vorarbeiterzulage")).toHaveCount(0);

  // Büro teilt ihm nur die Vorarbeiterzulage zu → sie kommt dazu, die normalen bleiben.
  await rest("/rest/v1/mitarbeiter_zulagen", "POST", { mitarbeiter_id: vorarbeiter.id, zulagen_typ_id: vz });
  await page.goto(`${APP}/stunden?datum=${datum}`);
  await expect(chip(page, "Vorarbeiterzulage")).toBeVisible({ timeout: 20_000 });
  await expect(chip(page, "Schmutzzulage")).toBeVisible();
  await expect(chip(page, "Hoehenzulage")).toBeVisible();
  await page.waitForTimeout(1500);
  await chip(page, "Vorarbeiterzulage").click();
  await speichern(page);
  await expect(page.getByText(/\d+ (Eintrag|Einträge) gespeichert/).first()).toBeVisible();
  expect(await zulagenVon(tag)).toEqual(["Vorarbeiterzulage:8"]);

  // Datenbank: bei einem nicht Zugeteilten wird sie weggelassen (ältere App-Stände).
  const tagAnderer = await tagMit8h(anderer.id, datum, bst.id);
  await rest("/rest/v1/stunden_zulagen", "POST", { stunden_tag_id: tagAnderer, zulagen_typ_id: vz, stunden: 8 });
  expect(await zulagenVon(tagAnderer)).toEqual([]);
  expect(fehler).toEqual([]);
});
