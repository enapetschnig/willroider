// Probefahrt 18.11.2026 (E. Winkler, Plan-Viewer wie ein normaler PDF-Viewer):
//  - Mehrseitiges PDF: alle Seiten untereinander, Seitenanzeige läuft beim Scrollen mit.
//  - Pfeil „Nächste Seite“ geht (vorher fing die Zeichenfläche den Klick ab).
//  - Mausrad scrollt (Zoom bleibt), Strg + Mausrad zoomt nur den Plan (App bleibt gleich groß).
//  - Finger: nach oben wischen → weiter unten im Dokument, zwei Finger zoomen.
//  - Kein „Verschieben“-Werkzeug mehr; Werkzeug nochmal antippen wählt es ab.
//  - Anmerkung auf Seite 2 landet auf Seite 2 (und bleibt dort beim Neuöffnen).
// Alle Daten künstlich. Läuft NUR gegen die Testumgebung:
// TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=http://localhost:55310 npx playwright test -c tests/roboter/playwright.config.ts
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const API = process.env.TEST_API_URL ?? "";
const ANON = process.env.TEST_ANON_KEY ?? "";
const SR = process.env.TEST_SERVICE_ROLE_KEY ?? "";
const APP = process.env.TEST_APP_URL ?? "http://localhost:55110";

test.skip(!API || !SR || !ANON, "nur mit Testumgebung");
test.use({ screenshot: "only-on-failure" });

const kopf = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
async function rest(pfad: string, methode: string, daten?: unknown) {
  const r = await fetch(`${API}${pfad}`, { method: methode, headers: { ...kopf, Prefer: "return=representation" }, body: daten ? JSON.stringify(daten) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${methode} ${pfad}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}
const PW = "Test1234!x";
async function konto(vorname: string, nachname: string, rolle: string) {
  const email = `pv-seiten-${vorname}.${Date.now()}${Math.random().toString(36).slice(2, 7)}@test.local`;
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
async function mehrseitigesPdf(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    const s = d.addPage([595, 842]); // A4 hoch
    s.drawText(`Montageanweisung Seite ${i}`, { x: 60, y: 760, size: 28, font: f });
    s.drawRectangle({ x: 60, y: 80, width: 475, height: 640, borderWidth: 3, borderColor: rgb(0, 0, 0) });
  }
  return d.save();
}
/** Bildschirm-Rechteck einer Seite (nach Zoom/Scrollen). */
const seitenBox = (page: Page, nr: number) => page.locator(`[data-plan-seite="${nr}"]`).first().boundingBox();

test("Plan-Viewer: alle Seiten untereinander, Rad scrollt, Strg+Rad zoomt, Pfeile, Finger", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
  const buero = await konto("Elias", `Seiten${stamp}`, "buero");
  const [bs] = await rest("/rest/v1/baustellen", "POST", { bvh_name: `PV-Seiten ${stamp}`, kostenstelle: `14066${stamp}`, status: "aktiv" });
  await fetch(`${API}/storage/v1/bucket`, {
    method: "POST", headers: kopf, body: JSON.stringify({ id: "baustellen", name: "baustellen", public: false }),
  });
  const bytes = await mehrseitigesPdf();
  const pfad = `${bs.id}/91-plaene/${Date.now()}_mehrseitig.pdf`;
  const up = await fetch(`${API}/storage/v1/object/baustellen/${pfad}`, {
    method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/pdf" }, body: bytes,
  });
  expect(up.ok).toBeTruthy();
  await rest("/rest/v1/dokumente", "POST", {
    baustelle_id: bs.id, ordner: "91-plaene", dateiname: "Montageanweisung.pdf", storage_path: pfad,
    mimetype: "application/pdf", groesse: bytes.length, hochgeladen_von: buero.id,
  });

  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  await page.setViewportSize({ width: 1400, height: 900 });
  await anmelden(page, buero.sitzung);
  await page.goto(`${APP}/baustellen/${bs.id}?tab=dokumente&ordner=91-plaene`);
  await page.getByText("Montageanweisung.pdf", { exact: true }).first().click();
  await expect(page.getByTestId("plan-viewer")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Plan wird geladen…")).toHaveCount(0, { timeout: 20_000 });

  // Drei Seiten im Dokument, Anzeige 1 / 3
  await expect(page.locator("[data-plan-seite]")).toHaveCount(3);
  const anzeige = page.getByTestId("plan-seite");
  await expect(anzeige).toHaveText("Seite 1 / 3");
  // Kein Hand-Werkzeug mehr
  await expect(page.getByRole("button", { name: "Verschieben" })).toHaveCount(0);

  // ── Pfeil „Nächste Seite“ ──
  await page.getByRole("button", { name: "Nächste Seite" }).click();
  await expect(anzeige).toHaveText("Seite 2 / 3");
  // Grundbild der Seite 2 ist gezeichnet
  await expect
    .poll(() => page.locator('[data-plan-seite="2"] canvas').evaluate((c: HTMLCanvasElement) => c.width), { timeout: 15_000 })
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Vorige Seite" }).click();
  await expect(anzeige).toHaveText("Seite 1 / 3");

  // ── Mausrad scrollt (Breite gleich, Seite wandert nach oben) ──
  const flaeche = page.getByTestId("plan-flaeche").first();
  const fb = (await flaeche.boundingBox())!;
  await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
  const vorher = (await seitenBox(page, 1))!;
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 200);
  await expect(anzeige).not.toHaveText("Seite 1 / 3");
  const nachRad = (await seitenBox(page, 1))!;
  expect(Math.abs(nachRad.width - vorher.width)).toBeLessThan(1);
  expect(nachRad.y).toBeLessThan(vorher.y - 1000);
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 300);
  await expect(anzeige).toHaveText("Seite 3 / 3");
  await page.keyboard.press("Home");
  await expect(anzeige).toHaveText("Seite 1 / 3");

  // ── Strg + Rad zoomt nur den Plan ──
  const knopfVorher = (await page.getByRole("button", { name: "Rückgängig" }).first().boundingBox())!;
  const breiteVorher = (await seitenBox(page, 1))!.width;
  await page.keyboard.down("Control");
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  const breiteNachher = (await seitenBox(page, 1))!.width;
  expect(breiteNachher).toBeGreaterThan(breiteVorher * 1.5);
  const knopfNachher = (await page.getByRole("button", { name: "Rückgängig" }).first().boundingBox())!;
  expect(Math.abs(knopfNachher.width - knopfVorher.width)).toBeLessThan(0.5);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  await page.getByRole("button", { name: "Ganzer Plan" }).click();

  // ── Finger: nach oben wischen = weiter nach unten; zwei Finger zoomen ──
  const finger = (schritte: { typ: string; id: number; x: number; y: number }[]) =>
    flaeche.evaluate((el, st) => {
      for (const s of st)
        el.dispatchEvent(new PointerEvent(s.typ, { bubbles: true, pointerId: s.id, pointerType: "touch", clientX: s.x, clientY: s.y, isPrimary: s.id === 1, button: 0 }));
    }, schritte);
  const mx = fb.x + fb.width / 2;
  const yVorWisch = (await seitenBox(page, 1))!.y;
  await finger([
    { typ: "pointerdown", id: 1, x: mx, y: fb.y + fb.height * 0.8 },
    { typ: "pointermove", id: 1, x: mx, y: fb.y + fb.height * 0.6 },
    { typ: "pointermove", id: 1, x: mx, y: fb.y + fb.height * 0.3 },
    { typ: "pointerup", id: 1, x: mx, y: fb.y + fb.height * 0.3 },
  ]);
  await page.waitForTimeout(600);
  expect((await seitenBox(page, 1))!.y).toBeLessThan(yVorWisch - fb.height * 0.4);
  const bZwei = (await seitenBox(page, 1))!.width;
  const my = fb.y + fb.height / 2;
  await finger([
    { typ: "pointerdown", id: 1, x: mx - 40, y: my },
    { typ: "pointerdown", id: 2, x: mx + 40, y: my },
    { typ: "pointermove", id: 1, x: mx - 120, y: my },
    { typ: "pointermove", id: 2, x: mx + 120, y: my },
    { typ: "pointerup", id: 1, x: mx - 120, y: my },
    { typ: "pointerup", id: 2, x: mx + 120, y: my },
  ]);
  expect((await seitenBox(page, 1))!.width).toBeGreaterThan(bZwei * 2);
  await page.getByRole("button", { name: "Ganzer Plan" }).click();

  // ── Anmerkung auf Seite 2 ──
  await page.keyboard.press("Home");
  await expect(anzeige).toHaveText("Seite 1 / 3");
  await page.getByRole("button", { name: "Nächste Seite" }).click();
  await expect(anzeige).toHaveText("Seite 2 / 3");
  const rechteck = page.getByRole("button", { name: "Rechteck" });
  await rechteck.click();
  await expect(rechteck).toHaveAttribute("aria-pressed", "true");
  const s2 = (await seitenBox(page, 2))!;
  await page.mouse.move(s2.x + s2.width * 0.3, s2.y + s2.height * 0.3);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(s2.x + s2.width * (0.3 + 0.05 * i), s2.y + s2.height * (0.3 + 0.04 * i));
  await page.mouse.up();
  await expect(page.locator('[data-testid="plan-ebene"][data-seite="2"]')).toHaveAttribute("data-anzahl", "1");
  await expect(page.locator('[data-testid="plan-ebene"][data-seite="1"]')).toHaveAttribute("data-anzahl", "0");
  // Werkzeug nochmal antippen → abgewählt (wieder verschieben/scrollen)
  await rechteck.click();
  await expect(rechteck).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('[data-sync="synchronisiert"]').first()).toBeVisible({ timeout: 15_000 });

  // Gespeichert auf Seite 2
  await expect
    .poll(async () => {
      const r = await rest(`/rest/v1/plan_anmerkungen?user_id=eq.${buero.id}&select=daten`, "GET");
      return r?.[0]?.daten?.seiten?.["2"]?.length ?? 0;
    }, { timeout: 15_000 })
    .toBe(1);

  expect(fehler).toEqual([]);

  // Aufräumen
  await rest(`/rest/v1/plan_anmerkungen?user_id=eq.${buero.id}`, "DELETE").catch(() => null);
  await rest(`/rest/v1/dokumente?baustelle_id=eq.${bs.id}`, "DELETE").catch(() => null);
  await rest(`/rest/v1/baustellen?id=eq.${bs.id}`, "DELETE").catch(() => null);
  await rest(`/auth/v1/admin/users/${buero.id}`, "DELETE").catch(() => null);
});

// Nachgezogen 18.11.: PDFs außerhalb der Baustellen-Dokumente (Angebot, Bericht) öffnen in der Großansicht
// mit derselben Bedienung (nur ansehen, ohne Zeichenwerkzeuge) statt im eingebetteten Browser-PDF.
test("Angebot-PDF: Seiten untereinander, Seitenpfeile, Strg+Rad zoomt nur das PDF", async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
  const buero = await konto("Elias", `Angebot${stamp}`, "buero");
  const [ang] = await rest("/rest/v1/angebote", "POST", { bvh_name: `PV-Angebot ${stamp}` });
  const bytes = await mehrseitigesPdf();
  const pfad = `${ang.id}/plaene/${Date.now()}_ausschreibung.pdf`;
  const up = await fetch(`${API}/storage/v1/object/angebote/${pfad}`, {
    method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/pdf" }, body: bytes,
  });
  expect(up.ok).toBeTruthy();
  await rest("/rest/v1/angebot_dokumente", "POST", {
    angebot_id: ang.id, ordner: "plaene", dateiname: "Ausschreibung.pdf", storage_path: pfad,
    mimetype: "application/pdf", groesse: bytes.length, hochgeladen_von: buero.id,
  });

  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  await page.setViewportSize({ width: 1400, height: 900 });
  await anmelden(page, buero.sitzung);
  await page.goto(`${APP}/angebote/${ang.id}?dok=plaene`);
  await page.getByText("Ausschreibung.pdf", { exact: true }).first().click();
  const ansicht = page.getByTestId("pdf-ansicht");
  await expect(ansicht).toBeVisible({ timeout: 20_000 });
  await expect(ansicht.locator("iframe")).toHaveCount(0);
  await expect(ansicht.locator("[data-plan-seite]")).toHaveCount(3, { timeout: 20_000 });
  // Nur ansehen: keine Zeichenwerkzeuge
  await expect(page.getByRole("button", { name: "Rechteck" })).toHaveCount(0);
  const anzeige = page.getByTestId("plan-seite");
  await expect(anzeige).toHaveText("Seite 1 / 3");
  await page.getByRole("button", { name: "Nächste Seite" }).click();
  await expect(anzeige).toHaveText("Seite 2 / 3");
  // Strg + Rad zoomt nur das PDF
  const b = (await ansicht.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  const vorher = (await seitenBox(page, 2))!.width;
  await page.keyboard.down("Control");
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  expect((await seitenBox(page, 2))!.width).toBeGreaterThan(vorher * 1.5);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  // Rad scrollt weiter zur letzten Seite
  await page.getByRole("button", { name: "Ganzer Plan" }).click();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 300);
  await expect(anzeige).toHaveText("Seite 3 / 3");
  expect(fehler).toEqual([]);

  await rest(`/rest/v1/angebot_dokumente?angebot_id=eq.${ang.id}`, "DELETE").catch(() => null);
  await rest(`/rest/v1/angebote?id=eq.${ang.id}`, "DELETE").catch(() => null);
  await rest(`/auth/v1/admin/users/${buero.id}`, "DELETE").catch(() => null);
});
