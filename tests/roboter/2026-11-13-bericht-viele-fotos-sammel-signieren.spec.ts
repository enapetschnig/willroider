// Probefahrt 13.11.2026 (Supabase-Protokoll 12.11.: 34× 429/544/500 auf /storage/v1/object/sign/baustellen/…):
// Ein Bericht mit 34 Fotos hat je Foto einen eigenen Signier-Aufruf gleichzeitig abgeschickt → Storage überlastet,
// Fotos blieben leer. Jetzt holt die Bericht-Seite alle Links in einem Sammelaufruf (createSignedUrls).
//  1) Verwaltung öffnet einen Bericht mit 40 Fotos: alle 40 Kacheln zeigen ein Bild.
//  2) Dabei gibt es keinen einzigen Einzel-Signier-Aufruf, höchstens einen Sammelaufruf.
// Alle Dateien werden im Test künstlich erzeugt (keine Kundendaten).
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

test("Bericht mit vielen Fotos: alle Links in einem Sammelaufruf, alle Kacheln sichtbar", async ({ page }) => {
  const polier = await konto("Polier", "bauleiter");
  const chef = await konto("Chef", "geschaeftsfuehrung");
  const [bs] = await rest("/rest/v1/baustellen", "POST", { bvh_name: "Probe BVH Viele Fotos", status: "aktiv" });
  const [ber] = await rest("/rest/v1/berichte", "POST", { baustelle_id: bs.id, datum: "2031-06-03", typ: "bautagesbericht", erfasst_von: polier.id, status: "eingereicht" });
  await fetch(`${API}/storage/v1/bucket`, { method: "POST", headers: kopf, body: JSON.stringify({ id: "baustellen", name: "baustellen", public: false }) });

  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  await anmelden(page, chef.sitzung);
  await page.goto(`${APP}/`);

  const jpgB64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 320; c.height = 240;
    const g = c.getContext("2d")!;
    g.fillStyle = "#37a"; g.fillRect(0, 0, 320, 240);
    return c.toDataURL("image/jpeg", 0.7).split(",")[1];
  });
  const ANZAHL = 40;
  for (let i = 1; i <= ANZAHL; i++) {
    const pfad = `${bs.id}/fotos/2031-06-03/${i}_probe.jpg`;
    await hochladen(pfad, "image/jpeg", Buffer.from(jpgB64, "base64"));
    const [d] = await rest("/rest/v1/dokumente", "POST", { baustelle_id: bs.id, ordner: "fotos", subpath: "2031-06-03", dateiname: `probe${i}.jpg`, storage_path: pfad, groesse: 1000, mimetype: "image/jpeg" });
    await rest("/rest/v1/bericht_fotos", "POST", { bericht_id: ber.id, dokument_id: d.id, position: i });
  }

  const einzeln: string[] = [];
  let sammel = 0;
  page.on("request", (r) => {
    if (r.method() !== "POST") return; // GET …/sign/…?token= ist das Laden des Bildes selbst
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/storage/v1/object/sign/baustellen")) return;
    if (u.pathname === "/storage/v1/object/sign/baustellen" || u.pathname === "/storage/v1/object/sign/baustellen/") sammel++;
    else einzeln.push(u.pathname);
  });

  await page.goto(`${APP}/berichte/${ber.id}`);
  await expect(page.getByText(`Fotos (${ANZAHL})`)).toBeVisible({ timeout: 30_000 });
  const kacheln = page.locator("img.object-cover");
  await expect(kacheln).toHaveCount(ANZAHL, { timeout: 30_000 });
  // Kacheln laden „lazy“ → einmal alle in den Blick scrollen
  for (let i = 0; i < ANZAHL; i++) await kacheln.nth(i).scrollIntoViewIfNeeded();
  await expect
    .poll(async () => kacheln.evaluateAll((els) => els.filter((e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0).length), { timeout: 30_000 })
    .toBe(ANZAHL);
  await expect(page.getByText("Foto konnte nicht geladen werden")).toHaveCount(0);

  expect(einzeln).toEqual([]);
  expect(sammel).toBeGreaterThanOrEqual(1);
  expect(sammel).toBeLessThanOrEqual(2); // React-StrictMode o. Ä. darf höchstens doppelt laden
  expect(fehler).toEqual([]);
});
