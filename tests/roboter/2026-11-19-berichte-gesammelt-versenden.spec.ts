// Probefahrt 19.11.2026 (J. Maurer, /berichte): „ein Funktion wo ich Berichte gesammelt versenden kann
// mit Auswahl Möglichkeiten“
//  → Knopf „Gesammelt versenden“, Berichte mit PDF per Häkchen (Auswahl bleibt beim Umschalten
//    Bautages-/Regiebericht erhalten), Entwürfe ohne PDF nicht wählbar, „Per Mail senden“ (nur Verwaltung)
//    schickt alle in einer Mail bzw. teilt große Auswahl auf mehrere Mails auf, „Herunterladen (ZIP)“.
//    Polier sieht nur den ZIP-Weg (dokument-versenden ist Verwaltung vorbehalten).
// Alle Daten künstlich, Mailversand wird im Browser abgefangen (keine echte Mail).
// Läuft NUR gegen die Testumgebung (testumgebung.mjs start):
// TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=http://localhost:55210 npx playwright test -c tests/roboter/playwright.config.ts
import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import { readFileSync } from "node:fs";

const API = process.env.TEST_API_URL ?? "";
const ANON = process.env.TEST_ANON_KEY ?? "";
const SR = process.env.TEST_SERVICE_ROLE_KEY ?? "";
const APP = process.env.TEST_APP_URL ?? "http://localhost:55110";

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
  const email = `${name}.${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.local`;
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

const MINI_PDF = "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n";

async function berichtMitPdf(bsId: string, datum: string, typ: string, polierId: string, groesse = 100) {
  const pfad = `${bsId}/2-schriftverkehr/${typ === "bautagesbericht" ? "tagesberichte" : "regieberichte"}/${datum}_${typ}.pdf`;
  const up = await fetch(`${API}/storage/v1/object/baustellen/${pfad}`, {
    method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/pdf", "x-upsert": "true" }, body: MINI_PDF + typ + datum,
  });
  if (!up.ok) throw new Error(`Upload: ${up.status} ${await up.text()}`);
  const [dok] = await rest("/rest/v1/dokumente", "POST", {
    baustelle_id: bsId, ordner: "2-schriftverkehr", subpath: "x", dateiname: `${datum}_${typ}.pdf`, storage_path: pfad, groesse, mimetype: "application/pdf",
  });
  const [ber] = await rest("/rest/v1/berichte", "POST", {
    baustelle_id: bsId, datum, typ, erfasst_von: polierId, status: "freigegeben", pdf_dokument_id: dok.id,
  });
  return { berId: ber.id as string, dokId: dok.id as string };
}

test("Berichte gesammelt versenden: Auswahl über Typen, Mail (auch aufgeteilt), ZIP, Polier sieht Auswahl und ZIP", async ({ page, browser }) => {
  await fetch(`${API}/storage/v1/bucket`, { method: "POST", headers: kopf, body: JSON.stringify({ id: "baustellen", name: "baustellen", public: false }) });
  const stamp = String(Math.floor(Math.random() * 1e6)).padStart(6, "0") + Math.random().toString(36).slice(2, 5);
  const polier = await konto("Polier", "bauleiter");
  const chef = await konto("Chef", "geschaeftsfuehrung");
  const name = `Probe BVH Sammel ${stamp}`;
  const [bs] = await rest("/rest/v1/baustellen", "POST", { bvh_name: name, kostenstelle: `14077${stamp.slice(0, 6)}`, status: "aktiv" });
  const tag = (n: number) => { const x = new Date(); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
  const b1 = await berichtMitPdf(bs.id, tag(3), "bautagesbericht", polier.id, 16 * 1024 * 1024); // groß → eigene Mail
  const b2 = await berichtMitPdf(bs.id, tag(2), "bautagesbericht", polier.id);
  const r1 = await berichtMitPdf(bs.id, tag(2), "regiebericht", polier.id);
  await rest("/rest/v1/berichte", "POST", { baustelle_id: bs.id, datum: tag(1), typ: "bautagesbericht", erfasst_von: polier.id, status: "entwurf" });
  // Wieder geöffneter Bericht: Entwurf, hat aber noch das alte PDF → darf nicht mitgehen
  const alt = await berichtMitPdf(bs.id, tag(4), "bautagesbericht", polier.id);
  await rest(`/rest/v1/berichte?id=eq.${alt.berId}`, "PATCH", { status: "entwurf" });

  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  const mails: Array<{ betreff: string; attachments: Array<{ filename: string }>; dokumentIds: string[] }> = [];
  await page.route("**/functions/v1/dokument-versenden", async (route) => {
    const body = route.request().postDataJSON();
    mails.push(body);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await anmelden(page, chef.sitzung);

  await page.goto(`${APP}/berichte?typ=bautagesbericht&baustelle=${bs.id}&from=${tag(10)}&to=${tag(0)}`);
  await page.getByRole("button", { name: "Gesammelt versenden" }).click();
  const zeilen = page.getByTestId("sammel-bericht");
  await expect(zeilen).toHaveCount(4, { timeout: 30_000 });
  // Entwürfe (auch mit altem PDF) nicht wählbar
  const entwurf = zeilen.filter({ hasText: "noch nicht freigegeben" });
  await expect(entwurf).toHaveCount(2);
  for (const z of await entwurf.all()) {
    await expect(z).toHaveAttribute("aria-disabled", "true");
    await z.click({ force: true });
  }
  await expect(page.getByTestId("sammel-anzahl")).toHaveText("0 ausgewählt");
  await page.getByRole("button", { name: "Alle in der Liste (2)" }).click();
  await expect(page.getByTestId("sammel-anzahl")).toHaveText("2 ausgewählt");

  // Umschalten auf Regiebericht: Auswahl bleibt, Regiebericht dazu
  await page.getByRole("button", { name: "Regiebericht", exact: true }).click();
  await expect(zeilen).toHaveCount(1);
  await zeilen.first().click();
  await expect(page.getByTestId("sammel-anzahl")).toHaveText("3 ausgewählt");

  // ZIP
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Herunterladen (ZIP)" }).click()]);
  const zip = await JSZip.loadAsync(readFileSync(await dl.path()));
  const namen = Object.keys(zip.files).sort();
  expect(namen).toEqual([
    `Bautagesbericht ${name} ${tag(3)}.pdf`,
    `Bautagesbericht ${name} ${tag(2)}.pdf`,
    `Regiebericht ${name} ${tag(2)}.pdf`,
  ].sort());

  // Mail: 16 MB + 2 kleine → 2 Mails
  await page.getByRole("button", { name: "Per Mail senden" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("3 Dokumente per Mail senden")).toBeVisible();
  await expect(dialog.getByText(/geht als 2 Mails raus/)).toBeVisible();
  await expect(dialog.getByLabel("Betreff")).toHaveValue(new RegExp(`^Berichte ${name} `));
  await dialog.getByLabel(/Empfänger/).fill("buero@test.invalid");
  await dialog.getByRole("button", { name: "Jetzt senden" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  expect(mails).toHaveLength(2);
  expect(mails[0].betreff).toMatch(/\(Teil 1\/2\)$/);
  expect(mails[0].attachments.map((a) => a.filename)).toEqual([`Bautagesbericht ${name} ${tag(3)}.pdf`]);
  expect(mails[1].attachments.map((a) => a.filename).sort()).toEqual([`Bautagesbericht ${name} ${tag(2)}.pdf`, `Regiebericht ${name} ${tag(2)}.pdf`].sort());
  expect([...mails[0].dokumentIds, ...mails[1].dokumentIds].sort()).toEqual([b1.dokId, b2.dokId, r1.dokId].sort());
  expect(fehler).toEqual([]);

  // Polier: Auswahl + ZIP, aber kein Mailversand
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await anmelden(p2, polier.sitzung);
  await p2.goto(`${APP}/berichte?typ=bautagesbericht&baustelle=${bs.id}&from=${tag(10)}&to=${tag(0)}`);
  await p2.getByRole("button", { name: "Gesammelt versenden" }).click();
  await expect(p2.getByTestId("sammel-bericht")).toHaveCount(4, { timeout: 30_000 });
  await expect(p2.getByRole("button", { name: "Herunterladen (ZIP)" })).toBeVisible();
  // Mail-Knopf genau dann, wenn dokument-versenden es zulässt (is_admin_role). Im Kundensystem
  // sind Poliere (Rolle bauleiter) keine Verwaltung; die Testumgebung kann das anders vorbelegen.
  const polierIstVerwaltung = await rest("/rest/v1/rpc/is_admin_role", "POST", { _user_id: polier.id });
  await expect(p2.getByRole("button", { name: "Per Mail senden" })).toHaveCount(polierIstVerwaltung === true ? 1 : 0);
  await ctx.close();
});
