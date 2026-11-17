// Probefahrt 17.11.2026 (J. Maurer, Berichte):
//  a) „aus einem Bautagesbericht einen Regiebericht erstellen zb. Übernehmen in Regiebericht“
//     → Knopf im Bautagesbericht legt den Regiebericht an, übernimmt MA/Tätigkeiten/Aufmaß/Fotos/Wetter,
//       gehört dem Polier; zweiter Klick öffnet den vorhandenen. Löschen des Regieberichts löscht die
//       gemeinsamen Fotos NICHT (Bautagesbericht behält sie). Polier kann es selbst (RLS).
//  b) „bei Baustelle eine suchfunktion Kst und Bst name“ → Baustellen-Filter mit Suche nach KST.
//  c) „wenn ich hier zurück gehe sollte die letzte auswahl da sein“ → Zurück-Pfeil landet mit Typ + Baustelle.
//  d) ZE-Kürzel erklärt sich per Tooltip.
// Alle Daten künstlich. Läuft NUR gegen die Testumgebung (testumgebung.mjs start):
// TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=http://localhost:55110 npx playwright test -c tests/roboter/playwright.config.ts
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

async function btbMitInhalt(bsId: string, datum: string, polierId: string, maId: string) {
  const [ber] = await rest("/rest/v1/berichte", "POST", {
    baustelle_id: bsId, datum, typ: "bautagesbericht", erfasst_von: polierId, status: "entwurf",
    wetter_beschreibung: "Probewetter heiter", temperatur_min: 2, temperatur_max: 9, freitext_besonderheiten: "Probe Besonderheit",
  });
  await rest("/rest/v1/bericht_mitarbeiter", "POST", { bericht_id: ber.id, mitarbeiter_id: maId, position: 1, stunden_netto: 8.5, aus_zeiterfassung: true, taetigkeit_notiz: "Probe Notiz MA" });
  await rest("/rest/v1/bericht_taetigkeiten", "POST", { bericht_id: ber.id, position: 1, bezeichnung: "Probe Dachstuhl abbinden", summe_stunden: 8.5, aus_zeiterfassung: true });
  const [auf] = await rest("/rest/v1/bericht_aufmass", "POST", { bericht_id: ber.id, position: 1, beschreibung: "Probe Sparren", menge: 12, einheit: "Stk" });
  const [dok] = await rest("/rest/v1/dokumente", "POST", { baustelle_id: bsId, ordner: "fotos", subpath: datum, dateiname: "probe.jpg", storage_path: `${bsId}/fotos/${datum}/probe.jpg`, groesse: 100, mimetype: "image/jpeg" });
  await rest("/rest/v1/bericht_fotos", "POST", { bericht_id: ber.id, dokument_id: dok.id, position: 1, aufmass_position_id: auf.id, bildunterschrift: "Probe Foto" });
  return { berId: ber.id as string, dokId: dok.id as string, aufId: auf.id as string };
}

test("Bautagesbericht → Regiebericht übernehmen, Baustellen-Suche, Zurück mit letzter Auswahl", async ({ page }) => {
  const stamp = Date.now().toString().slice(-6);
  const polier = await konto("Polier", "bauleiter");
  const chef = await konto("Chef", "geschaeftsfuehrung");
  const kst = `14099${stamp}`;
  const [bs] = await rest("/rest/v1/baustellen", "POST", { bvh_name: `Probe BVH Regie ${stamp}`, kostenstelle: kst, status: "aktiv" });
  await rest("/rest/v1/baustellen", "POST", { bvh_name: `Probe BVH Andere ${stamp}`, kostenstelle: `14088${stamp}`, status: "aktiv" });
  const heute = new Date();
  const d = (n: number) => { const x = new Date(heute); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
  const a = await btbMitInhalt(bs.id, d(2), polier.id, polier.id);

  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  page.on("dialog", (dl) => dl.accept());
  await anmelden(page, chef.sitzung);

  // d) ZE-Tooltip + a) Übernehmen als Verwaltung
  await page.goto(`${APP}/berichte/${a.berId}`);
  await expect(page.getByRole("heading", { name: /Bautagesbericht/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[title^="ZE = aus der Zeiterfassung"]').first()).toBeVisible();
  await page.getByRole("button", { name: "In Regiebericht übernehmen" }).click();
  await expect(page.getByRole("heading", { name: /Regiebericht/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "In Regiebericht übernehmen" })).toHaveCount(0);
  const regieId = page.url().split("/berichte/")[1];
  expect(regieId).not.toBe(a.berId);

  const [regie] = await rest(`/rest/v1/berichte?id=eq.${regieId}&select=*,bericht_mitarbeiter(*),bericht_taetigkeiten(*),bericht_aufmass(*),bericht_fotos(*)`, "GET");
  expect(regie.typ).toBe("regiebericht");
  expect(regie.status).toBe("entwurf");
  expect(regie.erfasst_von).toBe(polier.id); // gehört dem Polier, damit er weiterschreiben kann
  expect(regie.datum).toBe(d(2));
  expect(regie.wetter_beschreibung).toBe("Probewetter heiter");
  expect(regie.freitext_besonderheiten).toBe("Probe Besonderheit");
  expect(regie.bericht_mitarbeiter).toHaveLength(1);
  expect(Number(regie.bericht_mitarbeiter[0].stunden_netto)).toBe(8.5);
  expect(regie.bericht_mitarbeiter[0].taetigkeit_notiz).toBe("Probe Notiz MA");
  expect(regie.bericht_taetigkeiten.map((t: any) => t.bezeichnung)).toEqual(["Probe Dachstuhl abbinden"]);
  expect(regie.bericht_aufmass).toHaveLength(1);
  expect(regie.bericht_fotos).toHaveLength(1);
  expect(regie.bericht_fotos[0].dokument_id).toBe(a.dokId);
  expect(regie.bericht_fotos[0].aufmass_position_id).toBe(regie.bericht_aufmass[0].id);
  // Quelle unverändert
  const [quelle] = await rest(`/rest/v1/berichte?id=eq.${a.berId}&select=typ,bericht_mitarbeiter(id),bericht_fotos(id)`, "GET");
  expect(quelle.typ).toBe("bautagesbericht");
  expect(quelle.bericht_mitarbeiter).toHaveLength(1);
  expect(quelle.bericht_fotos).toHaveLength(1);

  // zweiter Klick öffnet den vorhandenen statt einen neuen
  await page.goto(`${APP}/berichte/${a.berId}`);
  await page.getByRole("button", { name: "In Regiebericht übernehmen" }).click();
  await expect(page).toHaveURL(new RegExp(`/berichte/${regieId}$`), { timeout: 30_000 });
  const alle = await rest(`/rest/v1/berichte?baustelle_id=eq.${bs.id}&typ=eq.regiebericht&select=id`, "GET");
  expect(alle).toHaveLength(1);

  // Regiebericht löschen → Foto-Dokument bleibt für den Bautagesbericht
  await page.getByRole("button", { name: "Bericht löschen" }).click();
  await expect(page).toHaveURL(/\/berichte(\?|$)/, { timeout: 30_000 });
  expect(await rest(`/rest/v1/berichte?id=eq.${regieId}&select=id`, "GET")).toHaveLength(0);
  expect(await rest(`/rest/v1/dokumente?id=eq.${a.dokId}&select=id`, "GET")).toHaveLength(1);
  expect(await rest(`/rest/v1/bericht_fotos?bericht_id=eq.${a.berId}&select=id`, "GET")).toHaveLength(1);

  // b) Suche bei Baustelle nach KST, c) Zurück mit letzter Auswahl
  await page.goto(`${APP}/berichte`);
  await page.getByRole("button", { name: /Regiebericht/ }).first().click();
  await page.locator('button[role="combobox"]').first().click();
  await page.getByPlaceholder("Baustelle suchen…").fill(kst);
  await expect(page.getByRole("option", { name: new RegExp(`Probe BVH Andere ${stamp}`) })).toHaveCount(0);
  await page.getByRole("option", { name: new RegExp(`Probe BVH Regie ${stamp}`) }).click();
  await expect(page).toHaveURL(new RegExp(`baustelle=${bs.id}`));
  await expect(page).toHaveURL(/typ=regiebericht/);
  // Regiebericht anlegen über „Neuer Regiebericht“-Dialog mit Suche
  await page.getByRole("button", { name: "Neuer Regiebericht" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.locator('button[role="combobox"]').click();
  await page.getByPlaceholder("Baustelle suchen…").fill(`Regie ${stamp}`);
  await page.getByRole("option", { name: new RegExp(`Probe BVH Regie ${stamp}`) }).click();
  await dlg.getByRole("button", { name: "Öffnen / Anlegen" }).click();
  await expect(page.getByRole("heading", { name: /Regiebericht/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "Zurück zu den Berichten" }).click();
  await expect(page).toHaveURL(/typ=regiebericht/);
  await expect(page).toHaveURL(new RegExp(`baustelle=${bs.id}`));
  await expect(page.getByRole("button", { name: "Neuer Regiebericht" })).toBeVisible();
  // Menüpunkt Berichte holt die Auswahl ebenfalls zurück
  await page.goto(`${APP}/berichte`);
  await expect(page).toHaveURL(/typ=regiebericht/);
  await expect(page).toHaveURL(new RegExp(`baustelle=${bs.id}`));

  // a) Polier übernimmt seinen eigenen Bautagesbericht selbst (RLS)
  const b = await btbMitInhalt(bs.id, d(3), polier.id, polier.id);
  const p2 = await page.context().browser()!.newPage();
  p2.on("dialog", (dl) => dl.accept());
  p2.on("pageerror", (e) => fehler.push(e.message));
  await anmelden(p2, polier.sitzung);
  await p2.goto(`${APP}/berichte/${b.berId}`);
  await p2.getByRole("button", { name: "In Regiebericht übernehmen" }).click();
  await expect(p2.getByRole("heading", { name: /Regiebericht/ })).toBeVisible({ timeout: 30_000 });
  const [r2] = await rest(`/rest/v1/berichte?baustelle_id=eq.${bs.id}&datum=eq.${d(3)}&typ=eq.regiebericht&select=erfasst_von,bericht_mitarbeiter(id),bericht_fotos(id),bericht_aufmass(id)`, "GET");
  expect(r2.erfasst_von).toBe(polier.id);
  expect(r2.bericht_mitarbeiter).toHaveLength(1);
  expect(r2.bericht_fotos).toHaveLength(1);
  expect(r2.bericht_aufmass).toHaveLength(1);
  await p2.close();

  expect(fehler).toEqual([]);
});
