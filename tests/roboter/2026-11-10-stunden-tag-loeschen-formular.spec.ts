// Probefahrt 10.11.2026 (Gegenprobe zum „Ändern“-Fix vom 09.11.): Löscht der Polier in „Meine Stunden“
// den Tag des gerade gewählten Datums, muss das Formular leer werden. Vorher blieb der gelöschte Tag über
// die Abfrage „stunden_tage_fuer_datum“ (bis 30 s im Cache) im Formular stehen und wäre neu gespeichert worden.
// Läuft NUR gegen die Testumgebung (testumgebung.mjs start):
// TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=http://localhost:55410 npx playwright test -c tests/roboter/playwright.config.ts
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
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Ein Werktag vor ein paar Tagen (nicht heute — „Ändern“ eines alten Tages). */
function vergangenerWerktag(): string {
  const d = new Date();
  d.setDate(d.getDate() - 3);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return iso(d);
}

async function tagAnlegen(maId: string, datum: string, vonId: string, zeilen: Array<{ art: string; baustelle_id: string; stunden: number }>) {
  const [tag] = await rest("/rest/v1/stunden_tage", "POST", {
    mitarbeiter_id: maId,
    datum,
    tag_status: "baustelle",
    erfasst_von: vonId,
  });
  await rest(
    "/rest/v1/stunden_taetigkeiten",
    "POST",
    zeilen.map((z, i) => ({ stunden_tag_id: tag.id, position: i + 1, ...z })),
  );
  return tag.id as string;
}

test("Tag des gewählten Datums in der Liste löschen leert das Formular", async ({ page }) => {
  const stamp = Date.now();
  const polier = await konto(`Polier${stamp % 10000}`, "bauleiter");
  const [partie] = await rest("/rest/v1/partien", "POST", { name: `Partie Loesch ${stamp}`, partieleiter_id: polier.id });
  await rest(`/rest/v1/profiles?id=eq.${polier.id}`, "PATCH", { partie_id: partie.id });
  const [bst] = await rest("/rest/v1/baustellen", "POST", {
    bvh_name: `Loesch B ${stamp}`, status: "aktiv", kostenstelle: `6${String(stamp).slice(-6)}`,
  });
  const datum = vergangenerWerktag();
  const tagId = await tagAnlegen(polier.id, datum, polier.id, [{ art: "baustelle", baustelle_id: bst.id, stunden: 6.5 }]);

  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  page.on("dialog", (d) => d.accept());
  const schluessel = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [schluessel, JSON.stringify(polier.sitzung)]);
  await page.addInitScript(() => localStorage.setItem("willroider:install-dismissed", "true"));

  await page.goto(`${APP}/stunden?datum=${datum}`);
  const block = page.locator("div.rounded-lg.border.bg-card").filter({
    has: page.getByRole("button", { name: new RegExp(`Polier${stamp % 10000}`) }),
  }).last();
  await expect(block).toBeVisible({ timeout: 20_000 });
  const werte = () =>
    block.locator('input[inputmode="decimal"]').evaluateAll((es) => es.map((e) => (e as HTMLInputElement).value));
  await expect.poll(werte).toEqual(["6,5"]);

  // In „Meine Stunden“ genau diesen Tag löschen
  await page.getByRole("button", { name: "Tag löschen" }).first().click();
  await expect(page.getByText("Tag gelöscht").first()).toBeVisible();
  expect(await rest(`/rest/v1/stunden_tage?id=eq.${tagId}&select=id`, "GET")).toEqual([]);

  // Der gelöschte Tag darf nicht mehr im Formular stehen (vorher blieb er über den Fallback stehen)
  await expect.poll(werte, { timeout: 10_000 }).not.toContain("6,5");
  await page.waitForTimeout(1500);
  expect(await werte()).not.toContain("6,5");
  expect(fehler).toEqual([]);
});
