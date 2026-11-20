// Probefahrt 18.11.2026 (J. Maurer: „Bilder nach öffnen eines Bildes eine weiter Klick Funktion“):
//  1) Bericht mit 3 Fotos: Klick aufs 1. Foto öffnet es groß mit „1 / 3“.
//  2) Pfeil „Nächste“ → 2. Foto, Taste → → 3. Foto, danach wieder 1. Foto; Taste ← zurück zum 3.
//  3) Bericht mit nur 1 Foto: keine Pfeile.
// Alle Dateien werden im Test künstlich erzeugt (keine Kundendaten). Läuft NUR gegen die Testumgebung.
import { expect, test, type Page } from "@playwright/test";

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
async function konto(name: string, rolle: string) {
  const email = `${name}.${Date.now()}${Math.random().toString(36).slice(2, 7)}@test.local`;
  const u = await rest("/auth/v1/admin/users", "POST", { email, password: PW, email_confirm: true });
  await rest(`/rest/v1/profiles?id=eq.${u.id}`, "PATCH", { vorname: name, nachname: "Test", is_active: true });
  await rest(`/rest/v1/user_roles?user_id=eq.${u.id}`, "DELETE");
  await rest("/rest/v1/user_roles", "POST", { user_id: u.id, role: rolle });
  const sitzung = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }),
  }).then((r) => r.json());
  return { id: u.id as string, sitzung };
}
async function anmelden(page: Page, sitzung: unknown) {
  const schluessel = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [schluessel, JSON.stringify(sitzung)]);
}

async function hochladen(pfad: string, typ: string, daten: Buffer) {
  const r = await fetch(`${API}/storage/v1/object/baustellen/${pfad}`, {
    method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": typ }, body: daten,
  });
  expect(r.ok).toBeTruthy();
}

async function jpg(page: Page, farbe: string) {
  const b64 = await page.evaluate((f) => {
    const c = document.createElement("canvas");
    c.width = 640; c.height = 480;
    const g = c.getContext("2d")!;
    g.fillStyle = f; g.fillRect(0, 0, 640, 480);
    return c.toDataURL("image/jpeg", 0.8).split(",")[1];
  }, farbe);
  return Buffer.from(b64, "base64");
}

test("Bericht-Fotos: in der Großansicht weiterblättern", async ({ page }) => {
  const polier = await konto("Polier", "bauleiter");
  const chef = await konto("Chef", "geschaeftsfuehrung");
  const [bs] = await rest("/rest/v1/baustellen", "POST", { bvh_name: "Probe BVH Blaettern", status: "aktiv" });
  const [ber] = await rest("/rest/v1/berichte", "POST", { baustelle_id: bs.id, datum: "2031-06-02", typ: "bautagesbericht", erfasst_von: polier.id, status: "eingereicht" });
  const [ber1] = await rest("/rest/v1/berichte", "POST", { baustelle_id: bs.id, datum: "2031-06-03", typ: "bautagesbericht", erfasst_von: polier.id, status: "eingereicht" });
  await fetch(`${API}/storage/v1/bucket`, { method: "POST", headers: kopf, body: JSON.stringify({ id: "baustellen", name: "baustellen", public: false }) });

  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  await anmelden(page, chef.sitzung);
  await page.goto(`${APP}/`);

  const farben = ["#c33", "#3a7", "#36c"];
  for (let i = 0; i < 3; i++) {
    const pfad = `${bs.id}/fotos/2031-06-02/${i}_blatt${i + 1}.jpg`;
    await hochladen(pfad, "image/jpeg", await jpg(page, farben[i]));
    const [d] = await rest("/rest/v1/dokumente", "POST", { baustelle_id: bs.id, ordner: "fotos", subpath: "2031-06-02", dateiname: `blatt${i + 1}.jpg`, storage_path: pfad, groesse: 1000, mimetype: "image/jpeg" });
    await rest("/rest/v1/bericht_fotos", "POST", { bericht_id: ber.id, dokument_id: d.id, position: i + 1 });
    if (i === 0) await rest("/rest/v1/bericht_fotos", "POST", { bericht_id: ber1.id, dokument_id: d.id, position: 1 });
  }

  await page.goto(`${APP}/berichte/${ber.id}`);
  await expect(page.getByText("Fotos (3)")).toBeVisible({ timeout: 30_000 });
  const kacheln = page.locator("img.object-cover");
  await expect(kacheln).toHaveCount(3, { timeout: 30_000 });
  await kacheln.nth(0).click();
  const dlg = page.getByRole("dialog");
  const bildIst = async (n: number) => {
    await expect(dlg.getByTestId("viewer-position")).toHaveText(`${n} / 3`);
    const img = dlg.locator(`img[alt="blatt${n}.jpg"]`);
    await expect(img).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => img.evaluate((e) => (e as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBe(640);
  };
  await bildIst(1);
  await dlg.getByRole("button", { name: "Nächste Datei" }).click();
  await bildIst(2);
  await page.keyboard.press("ArrowRight");
  await bildIst(3);
  await dlg.getByRole("button", { name: "Nächste Datei" }).click();
  await bildIst(1);
  await page.keyboard.press("ArrowLeft");
  await bildIst(3);
  await dlg.getByRole("button", { name: "Vorige Datei" }).click();
  await bildIst(2);
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);

  // nur 1 Foto → keine Pfeile
  await page.goto(`${APP}/berichte/${ber1.id}`);
  await expect(page.getByText("Fotos (1)")).toBeVisible({ timeout: 30_000 });
  await page.locator("img.object-cover").first().click();
  await expect(page.getByRole("dialog").locator('img[alt="blatt1.jpg"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Nächste Datei" })).toHaveCount(0);
  await expect(page.getByTestId("viewer-position")).toHaveCount(0);

  expect(fehler).toEqual([]);
});
