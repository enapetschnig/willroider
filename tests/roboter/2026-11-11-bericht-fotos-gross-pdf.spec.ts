// Probefahrt 11.11.2026 (J. Maurer: „Bilder nicht ersichtlich sollen sich auch beim anklicken größer öffnen lassen direkt hier“):
// Im echten Bericht war unter „Fotos“ eine PDF (Plan) statt eines Bildes angehängt → leere Kachel.
//  1) Verwaltung öffnet einen Bericht mit einem JPG-Foto und einer PDF: beide Kacheln zeigen ein Bild, die PDF trägt „PDF“.
//  2) Klick auf das Foto öffnet es groß im Betrachter, Klick auf die PDF öffnet die PDF.
//  3) Das Bericht-PDF bettet Foto und erste PDF-Seite als Bild ein (kein „Foto konnte nicht geladen werden“).
// Alle Dateien werden im Test künstlich erzeugt (keine Kundendaten).
// Läuft NUR gegen die Testumgebung (testumgebung.mjs start), App mit VITE_SUPABASE_URL auf die Testumgebung:
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

/** Kleine, gültige PDF (Querformat, rotes Rechteck) — wie ein Plan statt eines Fotos. */
function probePdf(): Buffer {
  const inhalt = "1 0 0 rg 50 50 500 300 re f";
  const objekte = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Contents 4 0 R >>",
    `<< /Length ${inhalt.length} >>\nstream\n${inhalt}\nendstream`,
  ];
  let s = "%PDF-1.4\n";
  const off: number[] = [];
  objekte.forEach((o, i) => {
    off.push(s.length);
    s += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = s.length;
  s += `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n`;
  off.forEach((o) => (s += `${String(o).padStart(10, "0")} 00000 n \n`));
  s += `trailer\n<< /Size ${objekte.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(s, "latin1");
}

async function hochladen(pfad: string, typ: string, daten: Buffer) {
  const r = await fetch(`${API}/storage/v1/object/baustellen/${pfad}`, {
    method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": typ }, body: daten,
  });
  expect(r.ok).toBeTruthy();
}

test("Bericht-Fotos: Klick öffnet groß, PDF-Anhang hat Vorschau und landet im Bericht-PDF", async ({ page }) => {
  const polier = await konto("Polier", "bauleiter");
  const chef = await konto("Chef", "geschaeftsfuehrung");
  const [bs] = await rest("/rest/v1/baustellen", "POST", { bvh_name: "Probe BVH Grossansicht", status: "aktiv" });
  const [ber] = await rest("/rest/v1/berichte", "POST", { baustelle_id: bs.id, datum: "2031-05-12", typ: "bautagesbericht", erfasst_von: polier.id, status: "eingereicht" });
  await fetch(`${API}/storage/v1/bucket`, { method: "POST", headers: kopf, body: JSON.stringify({ id: "baustellen", name: "baustellen", public: false }) });

  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  await anmelden(page, chef.sitzung);
  await page.goto(`${APP}/`);

  // künstliches 800×600-JPG im Browser zeichnen
  const jpgB64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 800; c.height = 600;
    const g = c.getContext("2d")!;
    g.fillStyle = "#3a7"; g.fillRect(0, 0, 800, 600);
    return c.toDataURL("image/jpeg", 0.8).split(",")[1];
  });
  const jpgPfad = `${bs.id}/fotos/2031-05-12/1_probe.jpg`;
  const pdfPfad = `${bs.id}/fotos/2031-05-12/2_plan.pdf`;
  await hochladen(jpgPfad, "image/jpeg", Buffer.from(jpgB64, "base64"));
  await hochladen(pdfPfad, "application/pdf", probePdf());
  const [d1] = await rest("/rest/v1/dokumente", "POST", { baustelle_id: bs.id, ordner: "fotos", subpath: "2031-05-12", dateiname: "probe.jpg", storage_path: jpgPfad, groesse: 1000, mimetype: "image/jpeg" });
  const [d2] = await rest("/rest/v1/dokumente", "POST", { baustelle_id: bs.id, ordner: "fotos", subpath: "2031-05-12", dateiname: "Plan Probe.pdf", storage_path: pdfPfad, groesse: 500, mimetype: "application/pdf" });
  await rest("/rest/v1/bericht_fotos", "POST", { bericht_id: ber.id, dokument_id: d1.id, position: 1 });
  await rest("/rest/v1/bericht_fotos", "POST", { bericht_id: ber.id, dokument_id: d2.id, position: 2 });

  // 1) Kacheln: beide sind gezeichnete Bilder, PDF ist markiert
  await page.goto(`${APP}/berichte/${ber.id}`);
  await expect(page.getByText("Fotos (2)")).toBeVisible({ timeout: 30_000 });
  const kacheln = page.locator("img.object-cover");
  await expect(kacheln).toHaveCount(2, { timeout: 30_000 });
  await expect
    .poll(async () => kacheln.evaluateAll((els) => els.map((e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0)), { timeout: 30_000 })
    .toEqual([true, true]);
  await expect(page.getByText("PDF", { exact: true })).toBeVisible();
  await expect(page.getByText("Foto konnte nicht geladen werden")).toHaveCount(0);

  // 2) Klick aufs Foto → groß im Betrachter
  await kacheln.nth(0).click();
  const dlg = page.getByRole("dialog");
  const gross = dlg.locator('img[alt="probe.jpg"]');
  await expect(gross).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => gross.evaluate((e) => (e as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBe(800);
  const box = await gross.boundingBox();
  expect(box!.width).toBeGreaterThan(400); // deutlich größer als die Kachel
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);

  // Klick auf die PDF → PDF im Betrachter
  await kacheln.nth(1).click();
  await expect(page.getByRole("dialog").getByText("Plan Probe.pdf")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("dialog").locator('iframe[title="Plan Probe.pdf"]')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");

  // 3) Bericht-PDF: Foto und PDF-Seite werden als Bild eingebettet
  const ergebnis = await page.evaluate(async ({ api, anon, jpgPfad, pdfPfad, berId, bsId }) => {
    const sitz = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith("-auth-token"))!)!);
    const h = { apikey: anon, Authorization: `Bearer ${sitz.access_token}`, "Content-Type": "application/json" };
    const sign = async (p: string) => {
      const r = await fetch(`${api}/storage/v1/object/sign/baustellen/${p}`, { method: "POST", headers: h, body: JSON.stringify({ expiresIn: 600 }) }).then((x) => x.json());
      return `${api}/storage/v1${r.signedURL}`;
    };
    const bericht = (await fetch(`${api}/rest/v1/berichte?id=eq.${berId}`, { headers: h }).then((x) => x.json()))[0];
    const baustelle = (await fetch(`${api}/rest/v1/baustellen?id=eq.${bsId}`, { headers: h }).then((x) => x.json()))[0];
    // @ts-expect-error — Vite-Modul im Browser
    const mod = await import("/src/lib/berichtPdf.ts");
    const doc = await mod.makeBerichtPdf({
      bericht, baustelle, polier: null, mitarbeiter: [], taetigkeiten: [], aufmass: [],
      fotos: [
        { signedUrl: await sign(jpgPfad), pfad: jpgPfad, bildunterschrift: "Foto" },
        { signedUrl: await sign(pdfPfad), pfad: pdfPfad, bildunterschrift: "Plan" },
      ],
    });
    const roh = doc.output() as string;
    return { bilder: (roh.match(/\/Subtype \/Image/g) ?? []).length, platzhalter: roh.includes("Foto konnte nicht geladen werden") };
  }, { api: API, anon: ANON, jpgPfad, pdfPfad, berId: ber.id, bsId: bs.id });
  expect(ergebnis.platzhalter).toBe(false);
  expect(ergebnis.bilder).toBeGreaterThanOrEqual(2);

  expect(fehler).toEqual([]);
});
