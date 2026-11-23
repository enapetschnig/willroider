// Probefahrt zu J. Maurer 23.11.2026 (Berichte-Archiv, Tätigkeitsberichte):
// „Bei den Berichten fehlen die Kilometer optimal wäre eine PDF je Mitarbeiter mit
//  Tätigkeitsbericht Kilometerbuch und Krankscheine“.
//  1) Zeile zeigt „Fahrtenbuch (2 Fahrten)“.
//  2) Download der Zeile = EINE PDF: Bericht + Fahrtenbuch + Krankenzettel (Foto und PDF) als Seiten.
//  3) ZIP der markierten: je Mitarbeiter genau eine PDF.
//  4) Mail: dieselbe PDF als Anhang, Bericht/Krankenzettel nicht doppelt (ersetzt_ids), kein eigenes Fahrtenbuch.
// Keine echte Mail: archiv-versenden ist abgefangen. Läuft NUR gegen die Testumgebung.
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";

const API = process.env.TEST_API_URL ?? "";
const ANON = process.env.TEST_ANON_KEY ?? "";
const SR = process.env.TEST_SERVICE_ROLE_KEY ?? "";
const APP = process.env.TEST_APP_URL ?? "http://localhost:55410";

test.skip(!API || !SR || !ANON, "nur mit Testumgebung");
test.use({ serviceWorkers: "block", acceptDownloads: true });

const kopf = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
async function rest(pfad: string, methode: string, daten?: unknown) {
  const r = await fetch(`${API}${pfad}`, { method: methode, headers: { ...kopf, Prefer: "return=representation" }, body: daten ? JSON.stringify(daten) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${methode} ${pfad}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}
const PW = "Test1234!x";
const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
async function konto(vorname: string, nachname: string, rolle: string, typ?: string) {
  const email = `${vorname.toLowerCase()}.${stamp}@test.local`;
  const u = await rest("/auth/v1/admin/users", "POST", { email, password: PW, email_confirm: true });
  await rest(`/rest/v1/profiles?id=eq.${u.id}`, "PATCH", { vorname, nachname, is_active: true, ...(typ ? { zeiterfassung_typ: typ } : {}) });
  await rest(`/rest/v1/user_roles?user_id=eq.${u.id}`, "DELETE");
  await rest("/rest/v1/user_roles", "POST", { user_id: u.id, role: rolle });
  return { id: u.id as string, email };
}
async function hochladen(bucket: string, pfad: string, inhalt: Uint8Array | Buffer, typ: string) {
  const r = await fetch(`${API}/storage/v1/object/${bucket}/${pfad.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": typ }, body: inhalt,
  });
  if (!r.ok) throw new Error(`Upload ${pfad}: ${r.status} ${await r.text()}`);
}
// Eigene Seitengrößen, damit man die Teile in der Gesamt-PDF wiederfindet.
async function pdfMitText(text: string, seiten: number, groesse: [number, number]): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < seiten; i++) d.addPage(groesse).drawText(`${text} ${i + 1}`, { x: 20, y: 40, size: 14, font: f });
  return d.save({ useObjectStreams: false });
}

test("Archiv Tätigkeitsbericht: eine PDF je Mitarbeiter mit Fahrtenbuch und Krankenzetteln", async ({ page }) => {
  const chef = await konto("Chef", `TbArchiv${stamp}`, "geschaeftsfuehrung");
  const anna = await konto("Anna", `Km${stamp}`, "mitarbeiter", "angestellter");
  const jahr = 2031;
  const monat = 3; // Periode 21.02.–20.03.2031

  await rest("/rest/v1/fahrtenbuch_eintraege", "POST", [
    { mitarbeiter_id: anna.id, datum: "2031-02-24", reiseweg: `Villach – Probe ${stamp}`, km: 42 },
    { mitarbeiter_id: anna.id, datum: "2031-03-10", reiseweg: "Villach – Spittal", km: 77 },
  ]);

  // Krankenzettel: ein Handyfoto (JPG) und eine PDF.
  const foto = await page.screenshot({ type: "jpeg" });
  const fotoPfad = `${anna.id}/krankmeldungen/${stamp}_foto.jpg`;
  await hochladen("ma_dokumente", fotoPfad, foto, "image/jpeg");
  const [dokFoto] = await rest("/rest/v1/dokumente", "POST", {
    mitarbeiter_id: anna.id, ordner: "krankmeldung", typ: "krankmeldung", dateiname: "foto.jpg", storage_path: fotoPfad, groesse: foto.length, mimetype: "image/jpeg",
  });
  await rest("/rest/v1/krankmeldungen", "POST", { mitarbeiter_id: anna.id, von: "2031-03-03", bis: "2031-03-04", dokument_id: dokFoto.id });
  const kPdf = await pdfMitText("Krankenzettel", 1, [400, 600]);
  const kPfad = `${anna.id}/krankmeldungen/${stamp}_zettel.pdf`;
  await hochladen("ma_dokumente", kPfad, kPdf, "application/pdf");
  const [dokPdf] = await rest("/rest/v1/dokumente", "POST", {
    mitarbeiter_id: anna.id, ordner: "krankmeldung", typ: "krankmeldung", dateiname: "zettel.pdf", storage_path: kPfad, groesse: kPdf.length, mimetype: "application/pdf",
  });
  await rest("/rest/v1/krankmeldungen", "POST", { mitarbeiter_id: anna.id, von: "2031-03-12", bis: "2031-03-12", dokument_id: dokPdf.id });

  const datei = `Tätigkeitsbericht 2031-03 Anna Km${stamp}.pdf`;
  const tb = await pdfMitText("Taetigkeitsbericht", 2, [500, 700]);
  const tbPfad = `taetigkeitsbericht/2031/${anna.id}/${stamp}.pdf`;
  await hochladen("berichte-archiv", tbPfad, tb, "application/pdf");
  const [archiv] = await rest("/rest/v1/bericht_archiv", "POST", {
    art: "taetigkeitsbericht", mitarbeiter_id: anna.id, jahr, monat, periode_label: "Februar - März 2031",
    storage_pfad: tbPfad, dateiname: datei, groesse: tb.length,
  });

  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  await page.goto(`${APP}/auth`);
  const sitzung = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: chef.email, password: PW }),
  }).then((r) => r.json());
  const schluessel = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [schluessel, JSON.stringify(sitzung)]);
  await page.goto(`${APP}/berichte-archiv?art=taetigkeitsbericht&jahr=${jahr}&monat=${monat}`);

  // 1) Hinweis in der Zeile
  const zeile = page.locator("div.px-3", { hasText: `Km${stamp}` }).first();
  await expect(zeile.getByText("Fahrtenbuch (2 Fahrten)")).toBeVisible();
  await expect(zeile.getByText("2 Krankenzettel")).toBeVisible();

  // 2) Eine PDF: 2 Seiten Bericht + Fahrtenbuch + Foto-Seite + Zettel-Seite
  const warte = page.waitForEvent("download");
  await page.getByRole("button", { name: `Km${stamp} herunterladen` }).click();
  const d = await warte;
  expect(d.suggestedFilename()).toBe(datei);
  const bytes = fs.readFileSync(await d.path());
  const gesamt = await PDFDocument.load(bytes);
  const roh = bytes.toString("latin1");
  expect(roh).toContain("FAHRTENBUCH");
  expect(roh).toContain(`Anna Km${stamp}`); // Name im Fahrtenbuch-Kopf (der Probe-Bericht enthält ihn nicht)
  const groessen = gesamt.getPages().map((s) => s.getSize()).map((g) => `${Math.round(g.width)}x${Math.round(g.height)}`);
  // Reihenfolge: Bericht (2 Seiten) → Fahrtenbuch (A4 quer) → Krankenzettel (Foto auf A4 + PDF 400x600)
  expect(groessen.slice(0, 2)).toEqual(["500x700", "500x700"]);
  expect(groessen[2]).toBe("842x595");
  expect(groessen.slice(-2)).toContain("400x600");
  expect(groessen.slice(-2).filter((g) => g === "842x595" || g === "595x842").length).toBe(1); // Foto-Seite A4
  expect(groessen.length).toBeGreaterThanOrEqual(5);
  expect(roh).toMatch(/\/Subtype\s*\/Image/);

  // 3) ZIP: genau eine Datei für Anna
  await zeile.getByRole("checkbox").click();
  const warteZip = page.waitForEvent("download");
  await page.getByRole("button", { name: "Herunterladen (ZIP)" }).click();
  const z = await warteZip;
  const zip = await JSZip.loadAsync(fs.readFileSync(await z.path()));
  expect(Object.keys(zip.files)).toEqual([datei]);
  const ausZip = await PDFDocument.load(await zip.file(datei)!.async("uint8array"));
  expect(ausZip.getPageCount()).toBe(gesamt.getPageCount());

  // 4) Mail: eine PDF, nichts doppelt
  let body: any = null;
  await page.route("**/functions/v1/archiv-versenden", async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, anzahl: 1, krankmeldungen: 0, empfaenger: "test@test.local" } });
  });
  await page.getByRole("button", { name: "Gesammelt per Mail senden" }).click();
  await expect(page.getByText("Tätigkeitsberichte gehen als eine PDF je Mitarbeiter")).toBeVisible();
  await page.getByRole("dialog").locator('input[type="email"]').fill("test@test.local");
  await page.getByRole("dialog").getByRole("button", { name: "Senden" }).click();
  await expect.poll(() => body?.extra_anhaenge?.map((x: any) => x.filename)).toEqual([datei]);
  expect(body.ersetzt_ids).toEqual([archiv.id]);
  expect(body.archiv_ids).toEqual([archiv.id]);
  const mailPdf = await PDFDocument.load(Buffer.from(body.extra_anhaenge[0].content, "base64"));
  expect(mailPdf.getPageCount()).toBe(gesamt.getPageCount());

  expect(fehler).toEqual([]);
});
