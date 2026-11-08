// Probefahrt 08.11.2026 (J. Maurer: „die bilder müssen beim prüfen sichtbar sein“):
// Handy-Fotos im HEIC-Format kann Chrome/Edge nicht anzeigen und jsPDF nicht einbetten.
//  1) Polier lädt ein HEIC-Foto in seinen Bericht → landet als JPG (Pfad .jpg, image/jpeg) und ist sichtbar.
//  2) Ein schon gespeichertes HEIC-Foto (alter Stand) wird beim Prüfen durch die Verwaltung angezeigt.
// probe-synthetisch.heic ist ein künstliches 800×600-Testbild (keine Kundendaten).
// Läuft NUR gegen die Testumgebung (testumgebung.mjs start), App mit VITE_SUPABASE_URL auf die Testumgebung:
// TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=http://localhost:55410 npx playwright test -c tests/roboter/playwright.config.ts
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = process.env.TEST_API_URL ?? "";
const ANON = process.env.TEST_ANON_KEY ?? "";
const SR = process.env.TEST_SERVICE_ROLE_KEY ?? "";
const APP = process.env.TEST_APP_URL ?? "http://localhost:55410";
const HEIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "probe-synthetisch.heic");

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
/** Alle Foto-Vorschauen im Bericht sind wirklich gezeichnet (Breite > 0). */
async function fotosSichtbar(page: Page, anzahl: number) {
  const bilder = page.locator("img.object-cover");
  await expect(bilder).toHaveCount(anzahl, { timeout: 30_000 });
  await expect
    .poll(async () => bilder.evaluateAll((els) => els.map((e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth)), { timeout: 30_000 })
    .toEqual(Array(anzahl).fill(800));
}

test("HEIC-Fotos im Bericht: Upload wird JPG, alte HEIC werden angezeigt", async ({ page, browser }) => {
  const polier = await konto("Polier", "bauleiter");
  const chef = await konto("Chef", "geschaeftsfuehrung");
  const [bs] = await rest("/rest/v1/baustellen", "POST", { bvh_name: "Probe BVH Fotos", status: "aktiv" });
  const [ber] = await rest("/rest/v1/berichte", "POST", { baustelle_id: bs.id, datum: "2031-04-07", typ: "bautagesbericht", erfasst_von: polier.id });

  // Bucket wie im echten Projekt (privat); fehlt in der Testumgebung, weil er nicht per Migration angelegt wurde
  await fetch(`${API}/storage/v1/bucket`, { method: "POST", headers: kopf, body: JSON.stringify({ id: "baustellen", name: "baustellen", public: false }) });

  // alter Stand: HEIC liegt schon so im Speicher, wie es bis heute hochgeladen wurde
  const altPfad = `${bs.id}/fotos/2031-04-07/1_alt.heic`;
  const up = await fetch(`${API}/storage/v1/object/baustellen/${altPfad}`, {
    method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "image/heic" }, body: fs.readFileSync(HEIC),
  });
  expect(up.ok).toBeTruthy();
  const [doc] = await rest("/rest/v1/dokumente", "POST", { baustelle_id: bs.id, ordner: "fotos", subpath: "2031-04-07", dateiname: "alt.heic", storage_path: altPfad, groesse: 969, mimetype: "image/heic" });
  await rest("/rest/v1/bericht_fotos", "POST", { bericht_id: ber.id, dokument_id: doc.id, position: 1 });

  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));

  // 1) Polier lädt ein HEIC aus der Galerie hoch
  await anmelden(page, polier.sitzung);
  await page.goto(`${APP}/berichte/${ber.id}`);
  await expect(page.getByText("Fotos (1)")).toBeVisible({ timeout: 30_000 });
  await fotosSichtbar(page, 1);
  await page.locator('input[type=file][accept="image/*"]:not([capture])').setInputFiles(HEIC);
  await expect(page.getByText("Fotos (2)")).toBeVisible({ timeout: 60_000 });
  await fotosSichtbar(page, 2);

  const fotos = await rest(`/rest/v1/bericht_fotos?bericht_id=eq.${ber.id}&select=position,dokumente(storage_path,mimetype,dateiname)&order=position`, "GET");
  const neu = fotos[1].dokumente;
  expect(neu.mimetype).toBe("image/jpeg");
  expect(neu.storage_path).toMatch(/\.jpg$/);
  expect(neu.dateiname).toBe("probe-synthetisch.jpg");

  // 2) Verwaltung prüft den Bericht: beide Fotos sichtbar
  const p2 = await browser.newPage();
  p2.on("pageerror", (e) => fehler.push(e.message));
  await anmelden(p2, chef.sitzung);
  await p2.goto(`${APP}/berichte/${ber.id}`);
  await expect(p2.getByText("Fotos (2)")).toBeVisible({ timeout: 30_000 });
  await fotosSichtbar(p2, 2);
  await expect(p2.getByText("Foto konnte nicht geladen werden")).toHaveCount(0);

  expect(fehler).toEqual([]);
});
