// Probefahrt 25.11.2026 (J. Maurer, Berichte):
//  „Regieberichte müssen auch mehrere am Tag möglich sein weiters braucht es die Möglichkeit das Datum zu ändern“
//  a) „Neuer Regiebericht“ zweimal für denselben Tag/dieselbe Baustelle → beim zweiten Mal Auswahl
//     „Vorhandenen öffnen“ / „Weiteren Regiebericht anlegen“ → zwei Regieberichte, Liste zeigt Nr. 1 / Nr. 2.
//  b) „In Regiebericht übernehmen“ legt auch einen dritten an, wenn gewünscht.
//  c) PDF-Ablage: zweiter Regiebericht am Tag bekommt einen eigenen Dateinamen (_2), überschreibt nicht den ersten.
//  d) Datum ändern als Polier im eigenen Entwurf (RLS), Verlauf zeigt „Datum: … → …“.
//  e) Bautagesbericht bleibt einmal je Tag: Datum auf einen belegten Tag → klare Meldung, nichts geändert.
// Alle Daten künstlich. Läuft NUR gegen die Testumgebung (testumgebung.mjs start), Dev-Server (import von /src/lib).
import { expect, test, type Page } from "@playwright/test";

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

test("Mehrere Regieberichte am Tag, Datum ändern, Bautagesbericht bleibt einmal je Tag", async ({ page }) => {
  const stamp = String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
  const name = `Probe BVH MehrRegie ${stamp.replace(/\d/g, (z) => "abcdefghij"[Number(z)])}`;
  const polier = await konto("Polier", "bauleiter");
  const chef = await konto("Chef", "geschaeftsfuehrung");
  const [bs] = await rest("/rest/v1/baustellen", "POST", { bvh_name: name, kostenstelle: `14077${stamp}`, status: "aktiv" });
  const heute = new Date();
  const d = (n: number) => { const x = new Date(heute); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
  const tag = d(2);

  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  page.on("dialog", (dl) => dl.accept());
  await anmelden(page, chef.sitzung);

  // a) Zweimal „Neuer Regiebericht“ für denselben Tag
  const neuerRegie = async () => {
    await page.goto(`${APP}/berichte?typ=regiebericht&baustelle=${bs.id}`);
    await page.getByRole("button", { name: "Neuer Regiebericht" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.locator('input[type="date"]').fill(tag);
    await dlg.locator('button[role="combobox"]').click();
    await page.getByPlaceholder("Baustelle suchen…").fill(name);
    await page.getByRole("option", { name: new RegExp(name) }).click();
    // Auswahlliste erst ganz zu — sonst landet der Klick u. U. auf der Berichtzeile dahinter
    await expect(page.getByPlaceholder("Baustelle suchen…")).toHaveCount(0);
    await expect(dlg.locator('button[role="combobox"]')).toContainText(name);
    await dlg.getByRole("button", { name: "Öffnen / Anlegen" }).click();
    return dlg;
  };
  await neuerRegie();
  await expect(page).toHaveURL(/\/berichte\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /Regiebericht/ })).toBeVisible({ timeout: 30_000 });
  const r1 = page.url().split("/berichte/")[1];

  const dlg2 = await neuerRegie();
  await expect(dlg2.getByTestId("regie-vorhanden")).toBeVisible();
  await dlg2.getByRole("button", { name: "Weiteren Regiebericht anlegen" }).click();
  await expect(page).toHaveURL(new RegExp(`/berichte/(?!${r1})[0-9a-f-]{36}$`), { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /Regiebericht/ })).toBeVisible({ timeout: 30_000 });
  const r2 = page.url().split("/berichte/")[1];
  expect(r2).not.toBe(r1);
  await expect(page.getByText("2 Regieberichte an diesem Tag")).toBeVisible();
  let alle = await rest(`/rest/v1/berichte?baustelle_id=eq.${bs.id}&typ=eq.regiebericht&datum=eq.${tag}&select=id`, "GET");
  expect(alle).toHaveLength(2);

  // Liste unterscheidet die beiden
  await page.goto(`${APP}/berichte?typ=regiebericht&baustelle=${bs.id}`);
  await expect(page.getByText("Regiebericht Nr. 1")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Regiebericht Nr. 2")).toBeVisible();

  // b) Aus Bautagesbericht einen dritten übernehmen
  const [btb] = await rest("/rest/v1/berichte", "POST", { baustelle_id: bs.id, datum: tag, typ: "bautagesbericht", erfasst_von: polier.id, status: "entwurf", freitext_besonderheiten: "Probe Btb" });
  await rest("/rest/v1/bericht_taetigkeiten", "POST", { bericht_id: btb.id, position: 1, bezeichnung: "Probe Schalung", summe_stunden: 4, aus_zeiterfassung: false });
  await page.goto(`${APP}/berichte/${btb.id}`);
  await page.getByRole("button", { name: "In Regiebericht übernehmen" }).click();
  await expect(page.getByRole("button", { name: "Nr. 2 öffnen" })).toBeVisible();
  await page.getByRole("button", { name: "Weiteren Regiebericht anlegen" }).click();
  await expect(page).toHaveURL(new RegExp(`/berichte/(?!${btb.id})[0-9a-f-]{36}$`), { timeout: 30_000 });
  alle = await rest(`/rest/v1/berichte?baustelle_id=eq.${bs.id}&typ=eq.regiebericht&datum=eq.${tag}&select=id,freitext_besonderheiten,bericht_taetigkeiten(bezeichnung)`, "GET");
  expect(alle).toHaveLength(3);
  const r3 = alle.find((x: any) => x.freitext_besonderheiten === "Probe Btb");
  expect(r3.bericht_taetigkeiten.map((t: any) => t.bezeichnung)).toEqual(["Probe Schalung"]);

  // c) PDF-Pfade: der erste hat schon ein PDF unter dem Grundnamen, der zweite bekommt _2
  const ordner = `${bs.id}/2-schriftverkehr/regieberichte/`;
  const [dok1] = await rest("/rest/v1/dokumente", "POST", { baustelle_id: bs.id, ordner: "2-schriftverkehr", subpath: "regieberichte", dateiname: `${tag}_regiebericht.pdf`, storage_path: `${ordner}${tag}_regiebericht.pdf`, groesse: 10, mimetype: "application/pdf" });
  await rest(`/rest/v1/berichte?id=eq.${r1}`, "PATCH", { pdf_dokument_id: dok1.id });
  const pfade = await page.evaluate(async ([bid, t, a, b]) => {
    // @ts-expect-error — Vite-Pfad im Browser
    const mod = await import("/src/lib/berichtPdf.ts");
    const p1 = await mod.berichtPdfPfad({ datum: t, typ: "regiebericht", pdf_dokument_id: a }, bid, "regieberichte");
    const p2 = await mod.berichtPdfPfad({ datum: t, typ: "regiebericht", pdf_dokument_id: b }, bid, "regieberichte");
    return [p1.storagePath, p2.storagePath];
  }, [bs.id, tag, dok1.id, null] as const);
  expect(pfade[0]).toBe(`${ordner}${tag}_regiebericht.pdf`);
  expect(pfade[1]).toBe(`${ordner}${tag}_regiebericht_2.pdf`);

  // d) Datum ändern als Polier im eigenen Entwurf
  const [eigen] = await rest("/rest/v1/berichte", "POST", { baustelle_id: bs.id, datum: tag, typ: "regiebericht", erfasst_von: polier.id, status: "entwurf", freitext_besonderheiten: "Probe Polier" });
  // Zeilen wie aus „In Regiebericht übernehmen“ (aus_zeiterfassung) — am neuen Tag gibt es keine Stunden:
  // sie müssen stehen bleiben, auch wenn jede Rückfrage bestätigt wird.
  await rest("/rest/v1/bericht_mitarbeiter", "POST", { bericht_id: eigen.id, mitarbeiter_id: polier.id, position: 1, stunden_netto: 7, aus_zeiterfassung: true });
  await rest("/rest/v1/bericht_taetigkeiten", "POST", { bericht_id: eigen.id, position: 1, bezeichnung: "Probe Regiearbeit", summe_stunden: 7, aus_zeiterfassung: true });
  const p2 = await page.context().browser()!.newPage();
  p2.on("dialog", (dl) => dl.accept());
  p2.on("pageerror", (e) => fehler.push(e.message));
  await anmelden(p2, polier.sitzung);
  await p2.goto(`${APP}/berichte/${eigen.id}`);
  await p2.getByRole("button", { name: "Datum ändern" }).click();
  await p2.locator("#bericht-neues-datum").fill(d(5));
  await p2.getByRole("button", { name: "Datum speichern" }).click();
  await expect(p2.getByText(/Datum auf .* geändert/).first()).toBeVisible({ timeout: 15_000 });
  const [nach] = await rest(`/rest/v1/berichte?id=eq.${eigen.id}&select=datum,bericht_aenderungen(details)`, "GET");
  expect(nach.datum).toBe(d(5));
  expect(nach.bericht_aenderungen.some((a: any) => /^Datum: /.test(a.details ?? ""))).toBe(true);
  const behalten = await rest(`/rest/v1/berichte?id=eq.${eigen.id}&select=bericht_mitarbeiter(id),bericht_taetigkeiten(bezeichnung)`, "GET");
  expect(behalten[0].bericht_mitarbeiter).toHaveLength(1);
  expect(behalten[0].bericht_taetigkeiten.map((t: any) => t.bezeichnung)).toEqual(["Probe Regiearbeit"]);

  // e) Bautagesbericht auf einen Tag, an dem es schon einen gibt → Meldung, Datum bleibt
  const [btb2] = await rest("/rest/v1/berichte", "POST", { baustelle_id: bs.id, datum: d(6), typ: "bautagesbericht", erfasst_von: polier.id, status: "entwurf" });
  await p2.goto(`${APP}/berichte/${btb2.id}`);
  await p2.getByRole("button", { name: "Datum ändern" }).click();
  await p2.locator("#bericht-neues-datum").fill(tag);
  await p2.getByRole("button", { name: "Datum speichern" }).click();
  await expect(p2.getByText(/gibt es auf dieser Baustelle schon einen Bautagesbericht/).first()).toBeVisible({ timeout: 15_000 });
  const [unveraendert] = await rest(`/rest/v1/berichte?id=eq.${btb2.id}&select=datum`, "GET");
  expect(unveraendert.datum).toBe(d(6));
  // Datenbank lässt einen zweiten Bautagesbericht am selben Tag auch direkt nicht zu
  const dop = await fetch(`${API}/rest/v1/berichte`, { method: "POST", headers: kopf, body: JSON.stringify({ baustelle_id: bs.id, datum: tag, typ: "bautagesbericht" }) });
  expect(dop.status).toBe(409);
  await p2.close();

  expect(fehler).toEqual([]);
});
