// Probefahrt zu J. Maurer 04.11.2026 (Berichte-Archiv):
//  1) Mehrere Downloads hintereinander liefern je die Datei der angeklickten Person, ohne neues Fenster.
//  2) Hat die Person Zulagen/Krankenzettel, kommt eine ZIP mit Bericht, ausgefülltem Zettel und Krankenzettel.
//  3) Archiv-Mail und „Ans Büro senden“ haben den Zettel im Anhang und bitten um die Krankenzettel.
//  4) Die Zeile weist auf Krank-Tage ohne Zettel hin. Keine echte Mail: beide Functions sind abgefangen.
// Läuft NUR gegen die Testumgebung (testumgebung.mjs start), App mit VITE_SUPABASE_URL auf die Testumgebung:
// TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=http://localhost:55410 npx playwright test -c tests/roboter/playwright.config.ts
import { expect, test, type Download } from "@playwright/test";
import fs from "node:fs";
import JSZip from "jszip";

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
const stamp = Date.now();
const KST = `9${String(stamp).slice(-6)}`;
async function konto(vorname: string, nachname: string, rolle: string) {
  const email = `${vorname.toLowerCase()}.${stamp}@test.local`;
  const u = await rest("/auth/v1/admin/users", "POST", { email, password: PW, email_confirm: true });
  await rest(`/rest/v1/profiles?id=eq.${u.id}`, "PATCH", { vorname, nachname, is_active: true, pers_nr: "542" });
  await rest(`/rest/v1/user_roles?user_id=eq.${u.id}`, "DELETE");
  await rest("/rest/v1/user_roles", "POST", { user_id: u.id, role: rolle });
  return { id: u.id as string, email };
}
async function hochladen(bucket: string, pfad: string, inhalt: string, typ: string) {
  const r = await fetch(`${API}/storage/v1/object/${bucket}/${pfad.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": typ }, body: inhalt,
  });
  if (!r.ok) throw new Error(`Upload ${pfad}: ${r.status} ${await r.text()}`);
}
const pdfVon = (name: string) => `%PDF-1.3\n% Name: ${name}\n`;

test("Archiv: je Klick die richtige Datei, Zettel und Krankenzettel in ZIP und Mail", async ({ page, context }) => {
  const chef = await konto("Chef", `Archiv${stamp}`, "geschaeftsfuehrung");
  const mitZulage = await konto("Anna", `Zulage${stamp}`, "mitarbeiter");
  const ohne = await konto("Otto", `Ohne${stamp}`, "mitarbeiter");
  const dritte = await konto("Dora", `Dritte${stamp}`, "mitarbeiter");
  const [bs] = await rest("/rest/v1/baustellen", "POST", { bvh_name: `Probe ${stamp}`, status: "aktiv", kostenstelle: KST });
  const typ = (await rest(`/rest/v1/zulagen_typen?bezeichnung=eq.Hoehenzulage`, "GET"))[0]
    ?? (await rest("/rest/v1/zulagen_typen", "POST", { bezeichnung: "Hoehenzulage", is_active: true }))[0];

  // Periode Oktober 2026 Teil II: Zulage in zwei Kalenderwochen, ein Krank-Tag mit und einer ohne Zettel.
  const tag = async (ma: string, datum: string, status: string, netto: number) =>
    (await rest("/rest/v1/stunden_tage", "POST", { mitarbeiter_id: ma, datum, tag_status: status, netto_stunden: netto }))[0].id as string;
  const t1 = await tag(mitZulage.id, "2026-10-21", "baustelle", 9.5);
  const t2 = await tag(mitZulage.id, "2026-10-27", "baustelle", 10);
  await tag(mitZulage.id, "2026-10-22", "krank", 0);
  await tag(mitZulage.id, "2026-10-28", "krank", 0);
  for (const [t, h] of [[t1, 9.5], [t2, 10]] as const) {
    await rest("/rest/v1/stunden_taetigkeiten", "POST", { stunden_tag_id: t, art: "baustelle", baustelle_id: bs.id, stunden: h });
    await rest("/rest/v1/stunden_zulagen", "POST", { stunden_tag_id: t, zulagen_typ_id: typ.id, stunden: h });
  }
  const krankPfad = `${mitZulage.id}/krankmeldungen/${stamp}_zettel.pdf`;
  await hochladen("ma_dokumente", krankPfad, "%PDF-1.3\n% Krankenzettel\n", "application/pdf");
  const [dok] = await rest("/rest/v1/dokumente", "POST", {
    mitarbeiter_id: mitZulage.id, ordner: "krankmeldung", typ: "krankmeldung", dateiname: "zettel.pdf", storage_path: krankPfad, groesse: 24, mimetype: "application/pdf",
  });
  await rest("/rest/v1/krankmeldungen", "POST", { mitarbeiter_id: mitZulage.id, von: "2026-10-22", bis: "2026-10-22", dokument_id: dok.id });

  const personen = [
    { p: mitZulage, datei: `Stundenbericht 2026-10 Teil II Anna Zulage.pdf` },
    { p: ohne, datei: `Stundenbericht 2026-10 Teil II Otto Ohne.pdf` },
    { p: dritte, datei: `Stundenbericht 2026-10 Teil II Dora Dritte.pdf` },
  ];
  for (const { p, datei } of personen) {
    const pfad = `stundenbericht/2026/${p.id}/${stamp} ${datei}`;
    await hochladen("berichte-archiv", pfad, pdfVon(datei), "application/pdf");
    await rest("/rest/v1/bericht_archiv", "POST", {
      art: "stundenbericht", mitarbeiter_id: p.id, jahr: 2026, monat: 10, teil: 2,
      periode_label: "Oktober 2026 · Teil II", storage_pfad: pfad, dateiname: datei, groesse: 40,
    });
  }

  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  const neueFenster: string[] = [];
  context.on("page", (p) => { if (p !== page) neueFenster.push(p.url()); });

  await page.goto(`${APP}/auth`);
  const sitzung = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: chef.email, password: PW }),
  }).then((r) => r.json());
  const schluessel = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [schluessel, JSON.stringify(sitzung)]);
  await page.goto(`${APP}/berichte-archiv?art=stundenbericht&jahr=2026&monat=10&teil=2`);

  const laden = async (nachname: string): Promise<Download> => {
    const warte = page.waitForEvent("download");
    await page.getByRole("button", { name: `${nachname} herunterladen` }).click();
    return warte;
  };
  await expect(page.getByRole("button", { name: `Ohne${stamp} herunterladen` })).toBeVisible();

  // Hinweise in der Zeile
  const zeile = page.locator("div.px-3", { hasText: `Zulage${stamp}` }).first();
  await expect(zeile.getByText("Zulagen-Zettel")).toBeVisible();
  await expect(zeile.getByText("Krankenzettel")).toBeVisible();
  await expect(zeile.getByText("1 Krank-Tag ohne Zettel")).toBeVisible();

  // 1) Nacheinander: jede Datei die eigene, kein Fenster.
  const a = await laden(`Dritte${stamp}`);
  expect(a.suggestedFilename()).toBe(personen[2].datei);
  expect(fs.readFileSync(await a.path(), "utf8")).toContain("Dora Dritte");
  const b = await laden(`Ohne${stamp}`);
  expect(b.suggestedFilename()).toBe(personen[1].datei);
  expect(fs.readFileSync(await b.path(), "utf8")).toContain("Otto Ohne");
  const c = await laden(`Dritte${stamp}`);
  expect(fs.readFileSync(await c.path(), "utf8")).toContain("Dora Dritte");
  expect(neueFenster).toEqual([]);

  // 2) Mit Zulage und Krankenzettel: ZIP mit allen dreien.
  const z = await laden(`Zulage${stamp}`);
  expect(z.suggestedFilename()).toBe("Stundenbericht 2026-10 Teil II Anna Zulage.zip");
  const zip = await JSZip.loadAsync(fs.readFileSync(await z.path()));
  const namen = Object.keys(zip.files);
  expect(namen).toContain(personen[0].datei);
  expect(namen).toContain("Erschwerniszulage 2026-10 Teil II Anna Zulage.pdf");
  expect(namen.some((n) => n.startsWith("Krankmeldung ") && n.includes("2026-10-22") && n.endsWith(".pdf"))).toBe(true);
  const zettelText = await zip.file("Erschwerniszulage 2026-10 Teil II Anna Zulage.pdf")!.async("string");
  expect(zettelText).toContain("Aufzeichnung Erschwerniszulage");
  expect(zettelText).toContain(KST);
  expect(zettelText).toContain("9,50");
  expect(zettelText).toContain("Hoehenzulage");
  // zwei Kalenderwochen, ein Blatt je Woche
  expect(zettelText.match(/Aufzeichnung Erschwerniszulage/g)!.length).toBe(2);

  // 3) Mail aus dem Archiv: Zettel im Anhang, Krankenzettel bestellt, nichts geht wirklich raus.
  let archivBody: any = null;
  await page.route("**/functions/v1/archiv-versenden", async (route) => {
    archivBody = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, anzahl: 1, krankmeldungen: 1, empfaenger: "test@test.local" } });
  });
  await zeile.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Gesammelt per Mail senden" }).click();
  await expect(page.getByText("Für 1 Krank-Tag liegt noch kein Zettel in der App")).toBeVisible();
  await page.getByRole("dialog").locator('input[type="email"]').fill("test@test.local");
  await page.getByRole("dialog").getByRole("button", { name: "Senden" }).click();
  await expect.poll(() => archivBody?.extra_anhaenge?.map((x: any) => x.filename)).toEqual(["Erschwerniszulage 2026-10 Teil II Anna Zulage.pdf"]);
  expect(archivBody.mit_krankmeldungen).toBe(true);

  // 4) „Ans Büro senden“ im Stundenbericht: gleiche Beilagen.
  const [bericht] = await rest("/rest/v1/stunden_berichte", "POST", {
    mitarbeiter_id: mitZulage.id, jahr: 2026, monat: 10, teil: 2, von_datum: "2026-10-17", bis_datum: "2026-10-31", status: "bestaetigt",
  });
  let bueroBody: any = null;
  await page.route("**/functions/v1/stundenbericht-versenden", async (route) => {
    bueroBody = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, count: 1, versendet: [bericht.id], fehler: [] } });
  });
  await page.goto(`${APP}/stundenbericht/${bericht.id}`);
  await page.getByRole("button", { name: /Ans Büro senden/ }).first().click();
  await expect(page.getByText(/Dazu kommen 1 Zulagen-Zettel/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("dialog").locator('input[type="email"]').first().fill("test@test.local");
  await page.getByRole("dialog").getByRole("button", { name: /Senden|senden/ }).last().click();
  await expect.poll(() => bueroBody?.attachments?.length).toBe(2);
  expect(bueroBody.attachments.map((x: any) => x.filename)).toContain("Erschwerniszulage Anna_Zulage" + stamp + "_2026-10_Teil2.pdf");
  expect(bueroBody.mit_krankmeldungen).toBe(true);

  // Download im Bericht: fürs Büro ebenfalls als ZIP mit Beilagen.
  await page.goto(`${APP}/stundenbericht/${bericht.id}`);
  const warte = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF herunterladen" }).first().click();
  const d = await warte;
  expect(d.suggestedFilename()).toMatch(/\.zip$/);

  expect(fehler).toEqual([]);
});
