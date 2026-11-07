// Probefahrt 07.11.2026 zur Protokoll-Meldung „duplicate key … stunden_tage_mitarbeiter_id_datum_key“ (06.11.):
// Im Tätigkeitsbericht schnell von Zelle zu Zelle tippen, während die Liste noch nicht neu geladen ist.
//  1) Neuer Tag: kein zweites INSERT (409), beide Werte stehen in der Datenbank.
//  2) Bestehender Tag: die vorige Zelle geht nicht verloren.
// Läuft NUR gegen die Testumgebung (testumgebung.mjs start), App mit VITE_SUPABASE_URL auf die Testumgebung:
// TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=http://localhost:55310 npx playwright test -c tests/roboter/playwright.config.ts
import { expect, test } from "@playwright/test";

const API = process.env.TEST_API_URL ?? "";
const ANON = process.env.TEST_ANON_KEY ?? "";
const SR = process.env.TEST_SERVICE_ROLE_KEY ?? "";
const APP = process.env.TEST_APP_URL ?? "http://localhost:55310";

test.skip(!API || !SR || !ANON, "nur mit Testumgebung");

const kopf = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
async function rest(pfad: string, methode: string, daten?: unknown) {
  const r = await fetch(`${API}${pfad}`, { method: methode, headers: { ...kopf, Prefer: "return=representation" }, body: daten ? JSON.stringify(daten) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${methode} ${pfad}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}
const PW = "Test1234!x";
const pad = (n: number) => String(n).padStart(2, "0");

test("Schnell eintippen: kein doppelter Tag, kein verlorener Wert", async ({ page }) => {
  const email = `tb.${Date.now()}@test.local`;
  const u = await rest("/auth/v1/admin/users", "POST", { email, password: PW, email_confirm: true });
  await rest(`/rest/v1/profiles?id=eq.${u.id}`, "PATCH", { vorname: "Tb", nachname: "Test", is_active: true, zeiterfassung_typ: "angestellter" });
  await rest(`/rest/v1/user_roles?user_id=eq.${u.id}`, "DELETE");
  await rest("/rest/v1/user_roles", "POST", { user_id: u.id, role: "mitarbeiter" });
  const sitzung = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }),
  }).then((r) => r.json());

  // Aktuelle Periode (21. Vormonat – 20.): Spalte 0 = bestehender Tag, Spalte 3 = neuer Tag
  const h = new Date();
  const start = h.getDate() <= 20 ? new Date(h.getFullYear(), h.getMonth() - 1, 21) : new Date(h.getFullYear(), h.getMonth(), 21);
  const tagIso = (s: number) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + s);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  // Zwei Kostenstellen-Zeilen über einen schon erfassten Tag
  const stamp = Date.now();
  const baustellen = await Promise.all([1, 2].map(async (n) => {
    const [b] = await rest("/rest/v1/baustellen", "POST", { bvh_name: `TB Probe ${n} ${stamp}`, status: "aktiv", kostenstelle: `8${n}${String(stamp).slice(-5)}` });
    return b.id as string;
  }));
  const [tag0] = await rest("/rest/v1/stunden_tage", "POST", { mitarbeiter_id: u.id, datum: tagIso(0), tag_status: "baustelle", status: "erfasst" });
  await rest("/rest/v1/stunden_taetigkeiten", "POST", baustellen.map((id, i) => ({ stunden_tag_id: tag0.id, position: i + 1, art: "baustelle", baustelle_id: id, stunden: 1 })));

  const fehler: string[] = [];
  const konflikte: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  page.on("response", (r) => { if (r.status() === 409) konflikte.push(r.url()); });
  const schluessel = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [schluessel, JSON.stringify(sitzung)]);

  await page.goto(`${APP}/taetigkeitsbericht`);
  const zelle = (z: number, s: number) => page.locator(`input[data-tb-zeile="${z}"][data-tb-spalte="${s}"]`);
  await expect(zelle(1, 3)).toBeVisible({ timeout: 20_000 });

  // Ab hier hängt das Neuladen der Liste hinterher — wie am 06.11., als Realtime sie laufend neu startete.
  await page.route(/\/rest\/v1\/stunden_tage\?.*datum=gte/, async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await route.continue().catch(() => {});
  });

  const tippeZwei = async (s: number, a: string, b: string) => {
    await zelle(0, s).click();
    await page.keyboard.type(a);
    await page.keyboard.press("Enter"); // springt in die Zeile darunter, Blur speichert
    await page.waitForTimeout(600); // das Speichern der ersten Zelle ist durch, die Liste noch alt
    await page.keyboard.type(b);
    await zelle(0, s + 1).click(); // Blur speichert die zweite Zelle
  };
  const stunden = async (datum: string) => {
    const t = await rest(`/rest/v1/stunden_tage?mitarbeiter_id=eq.${u.id}&datum=eq.${datum}&select=stunden_taetigkeiten(stunden)`, "GET");
    return (t[0]?.stunden_taetigkeiten ?? []).map((x: { stunden: number }) => Number(x.stunden)).sort();
  };

  // 1) Neuer Tag
  await tippeZwei(3, "2", "3");
  await expect.poll(() => stunden(tagIso(3)), { timeout: 15_000 }).toEqual([2, 3]);
  expect(konflikte).toEqual([]);
  await expect(page.getByText("Nicht gespeichert")).toHaveCount(0);

  // 2) Bestehender Tag: zwei weitere Kostenstellen dazu — die vorige Zelle und die schon
  //    gespeicherten Zeilen (je 1 Std) müssen stehen bleiben.
  await page.keyboard.press("Escape");
  await tippeZwei(0, "4", "5");
  await expect.poll(() => stunden(tagIso(0)), { timeout: 15_000 }).toEqual([1, 1, 4, 5]);
  await page.waitForTimeout(1500);
  expect(await stunden(tagIso(0))).toEqual([1, 1, 4, 5]);

  // Genau ein Tag je Datum, und die Anzeige stimmt nach dem Neuladen
  expect(await rest(`/rest/v1/stunden_tage?mitarbeiter_id=eq.${u.id}&datum=eq.${tagIso(3)}&select=id`, "GET")).toHaveLength(1);
  await page.unroute(/\/rest\/v1\/stunden_tage\?.*datum=gte/);
  await page.goto(`${APP}/taetigkeitsbericht`);
  // Zeilen mit Stunden sortieren sich neu, deshalb die ganze Spalte des neuen Tages prüfen.
  await expect(zelle(0, 3)).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await page.locator('input[data-tb-spalte="3"]').evaluateAll((e) => e.map((x) => (x as HTMLInputElement).value))).filter(Boolean).sort(), { timeout: 15_000 }).toEqual(["2,0", "3,0"]);
  expect(konflikte).toEqual([]);
  expect(fehler).toEqual([]);
});
