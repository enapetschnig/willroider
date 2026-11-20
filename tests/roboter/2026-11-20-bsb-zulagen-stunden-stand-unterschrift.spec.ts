// Probefahrt 20.11.2026 zu J. Maurer (Berichte-Archiv, BSB): „Bei den Zulagen kein Hacken oder Kreuz sondern hier
// müssen auch stunden eingetragen werden … ist es ein Zufall das fast bei allen der letzte Tag eine Änderung aufweisst
// oder ist das ein fehler im System ?“
//  - Zulagen werden immer mit Stunden gespeichert: leer („alle“) im Formular = Arbeitsstunden des Tages; die Datenbank
//    füllt fehlende Stunden nach (ältere App-Stände). Im Stundenbericht steht die Stundenzahl, kein ✓/x.
//  - Der letzte Tag wurde markiert, weil der Bericht am 16. um 19:00 entsteht und der Tag erst danach geschrieben wird.
//    Vor der Unterschrift zählen neu geschriebene Tage nicht als Änderung; beim Unterschreiben wird der Vergleichsstand
//    neu festgehalten, danach ist jede Änderung markiert („nach der Unterschrift geändert“).
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
  const r = await fetch(`${API}${pfad}`, {
    method: methode,
    headers: { ...kopf, Prefer: "return=representation" },
    body: daten ? JSON.stringify(daten) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${methode} ${pfad}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}
const PW = "Test1234!x";
async function konto(vorname: string, rolle: string) {
  const email = `${vorname.toLowerCase()}.${Date.now()}${Math.random().toString(36).slice(2, 7)}@test.local`;
  const u = await rest("/auth/v1/admin/users", "POST", { email, password: PW, email_confirm: true });
  await rest(`/rest/v1/profiles?id=eq.${u.id}`, "PATCH", { vorname, nachname: "Bsb", is_active: true });
  await rest(`/rest/v1/user_roles?user_id=eq.${u.id}`, "DELETE");
  await rest("/rest/v1/user_roles", "POST", { user_id: u.id, role: rolle });
  const sitzung = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  }).then((r) => r.json());
  return { id: u.id as string, sitzung };
}
async function anmelden(page: Page, sitzung: unknown) {
  const schluessel = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [schluessel, JSON.stringify(sitzung)]);
  await page.addInitScript(() => localStorage.setItem("willroider:install-dismissed", "true"));
}
async function typ(bezeichnung: string): Promise<string> {
  const [t] = await rest(`/rest/v1/zulagen_typen?bezeichnung=eq.${bezeichnung}&select=id`, "GET");
  return t.id;
}
async function tag(maId: string, datum: string, baustelleId: string, stunden: number) {
  const [t] = await rest("/rest/v1/stunden_tage", "POST", {
    mitarbeiter_id: maId, datum, tag_status: "baustelle", erfasst_von: maId,
  });
  await rest("/rest/v1/stunden_taetigkeiten", "POST", [
    { stunden_tag_id: t.id, position: 1, art: "baustelle", baustelle_id: baustelleId, stunden },
  ]);
  return t.id as string;
}
async function zulagenStunden(tagId: string): Promise<(number | null)[]> {
  const rows = await rest(`/rest/v1/stunden_zulagen?stunden_tag_id=eq.${tagId}&select=stunden`, "GET");
  return rows.map((r: any) => (r.stunden == null ? null : Number(r.stunden)));
}

test("Zulagen immer mit Stunden, letzter Tag nicht als geändert markiert", async ({ page }) => {
  const stamp = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  const ma = await konto(`Bsb${stamp % 100000}`, "mitarbeiter");
  const [bst] = await rest("/rest/v1/baustellen", "POST", {
    bvh_name: `BSB Stand Probe ${stamp}`, status: "aktiv", kostenstelle: `7${String(stamp).slice(-6)}`,
  });
  const abbruch = await typ("Abbruchzulage");
  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  page.on("dialog", (d) => d.accept());
  await anmelden(page, ma.sitzung);

  // Eigener Monat je Lauf (Bericht ist je Person/Monat/Teil eindeutig, Person ist neu → genügt ein fester Monat).
  const jahr = 2026, monat = 10;
  const tag1 = await tag(ma.id, "2026-10-05", bst.id, 8);

  // 1) Datenbank-Netz: Zulage ohne Stunden (ältere App-Stände) bekommt die Arbeitsstunden des Tages.
  await rest("/rest/v1/stunden_zulagen", "POST", { stunden_tag_id: tag1, zulagen_typ_id: abbruch, stunden: null });
  expect(await zulagenStunden(tag1)).toEqual([8]);

  // 2) Bericht wird erzeugt, als nur der 5. geschrieben war (Stand vom Abend des 16.) …
  const [bericht] = await rest("/rest/v1/stunden_berichte", "POST", {
    mitarbeiter_id: ma.id, jahr, monat, teil: 1, von_datum: "2026-10-01", bis_datum: "2026-10-16", status: "offen",
    snapshot: {
      "2026-10-05": [{ art: "baustelle", baustelle_id: bst.id, ziel_baustelle_id: null, ort: "baustelle",
        taetigkeit_id: null, taetigkeit_freitext: null, stunden: 8 }],
    },
  });
  // … der 16. kommt erst danach (wie bei fast allen im November).
  const tag16 = await tag(ma.id, "2026-10-16", bst.id, 9.5);
  await rest("/rest/v1/stunden_zulagen", "POST", { stunden_tag_id: tag16, zulagen_typ_id: abbruch, stunden: null });
  expect(await zulagenStunden(tag16)).toEqual([9.5]);

  await page.goto(`${APP}/stundenbericht/${bericht.id}`);
  const zeile = page.locator("tr", { has: page.getByText("Abbruchzulage", { exact: true }) }).first();
  await expect(zeile).toBeVisible({ timeout: 20_000 });
  await expect(zeile).toContainText("9,50");
  await expect(zeile).toContainText("17,50"); // Summe 8 + 9,5
  await expect(zeile).not.toContainText("✓");
  await expect(page.getByText(/wurden? nach (Erstellung|der Unterschrift) geändert/)).toHaveCount(0);

  // 3) Mitarbeiter unterschreibt → Vergleichsstand = unterschriebener Stand, keine Markierung.
  const rpc = await fetch(`${API}/rest/v1/rpc/stunden_bericht_unterschreiben`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${(ma.sitzung as any).access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_id: bericht.id, p_unterschrift: "data:image/png;base64,iVBORw0KGgo=" }),
  });
  expect(rpc.ok).toBeTruthy();
  const [nachher] = await rest(`/rest/v1/stunden_berichte?id=eq.${bericht.id}&select=snapshot,status`, "GET");
  expect(nachher.status).toBe("unterschrieben");
  expect(Object.keys(nachher.snapshot).sort()).toEqual(["2026-10-05", "2026-10-16"]);
  await page.reload();
  await expect(zeile).toContainText("9,50", { timeout: 20_000 });
  await expect(page.getByText(/wurden? nach (Erstellung|der Unterschrift) geändert/)).toHaveCount(0);

  // 4) Änderung NACH der Unterschrift bleibt markiert.
  await rest(`/rest/v1/stunden_taetigkeiten?stunden_tag_id=eq.${tag16}`, "PATCH", { stunden: 7 });
  await page.reload();
  await expect(page.getByText("1 Tag wurde nach der Unterschrift geändert")).toBeVisible({ timeout: 20_000 });

  // 5) Formular: Zulagen-Stunden leer („alle“) → gespeichert mit den Arbeitsstunden.
  const tag3Datum = "2026-10-07";
  const tag3 = await tag(ma.id, tag3Datum, bst.id, 6);
  await page.goto(`${APP}/stunden?datum=${tag3Datum}`);
  const chip = page.getByRole("button", { name: /^Abbruchzulage(\s?· .*)?$/ });
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await chip.click();
  await page.getByLabel("Zulagen-Stunden").first().fill("");
  await page.getByRole("button", { name: /speichern/i }).last().click();
  await expect(page.getByText(/\d+ (Eintrag|Einträge) gespeichert/).first()).toBeVisible();
  expect(await zulagenStunden(tag3)).toEqual([6]);

  expect(fehler).toEqual([]);
});
