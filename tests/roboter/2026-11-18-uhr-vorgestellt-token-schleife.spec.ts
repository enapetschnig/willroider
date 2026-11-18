// Probefahrt 18.11.2026: Geht die Uhr am Gerät vor (hier +2 h), hält supabase-js jedes frische
// Token sofort für abgelaufen. Früher lud die App bei jeder Token-Erneuerung Profil, Rolle und
// Rechte neu – das löste die nächste Erneuerung aus: Schleife mit ~10 Erneuerungen/s, dann 429,
// dann liefen Abfragen ohne Anmeldung („permission denied for function …“, Mac am 17.11.).
// Erwartet: Im Leerlauf wächst die Zahl der Erneuerungen nicht weiter.
// Läuft NUR gegen die Testumgebung (testumgebung.mjs start):
// TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=http://localhost:55110 npx playwright test -c tests/roboter/playwright.config.ts
import { expect, test } from "@playwright/test";

const API = process.env.TEST_API_URL ?? "";
const ANON = process.env.TEST_ANON_KEY ?? "";
const SR = process.env.TEST_SERVICE_ROLE_KEY ?? "";
const APP = process.env.TEST_APP_URL ?? "http://localhost:55110";

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

test("Uhr am Gerät 2 h vor: keine Endlosschleife beim Token-Erneuern", async ({ browser }) => {
  const stamp = Date.now();
  const email = `uhr.${stamp}@test.local`;
  const PW = "Test1234!x";
  const u = await rest("/auth/v1/admin/users", "POST", { email, password: PW, email_confirm: true });
  await rest(`/rest/v1/profiles?id=eq.${u.id}`, "PATCH", { vorname: "Uhr", nachname: "Probe", is_active: true });
  await rest(`/rest/v1/user_roles?user_id=eq.${u.id}`, "DELETE");
  await rest("/rest/v1/user_roles", "POST", { user_id: u.id, role: "bauleiter" });
  const sitzung = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  }).then((r) => r.json());

  const ctx = await browser.newContext({ serviceWorkers: "block" });
  const page = await ctx.newPage();
  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  let erneuerungen = 0;
  let ohneAnmeldung = 0;
  page.on("request", (r) => {
    const url = r.url();
    if (url.includes("grant_type=refresh_token")) erneuerungen++;
    if (url.includes("/rest/v1/") && (r.headers()["authorization"] ?? "") === `Bearer ${ANON}`) ohneAnmeldung++;
  });
  let rechteGeladen = 0;
  page.on("response", (r) => {
    if (r.url().includes("/rpc/my_permissions") && r.status() === 200) rechteGeladen++;
  });
  const schluessel = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(() => {
    // Geräteuhr 2 h vor
    const vor = 2 * 60 * 60 * 1000;
    const EchtDate = Date;
    const jetzt = () => EchtDate.now() + vor;
    class FalschDate extends EchtDate {
      constructor(...a: unknown[]) {
        // @ts-expect-error variadisch
        super(...(a.length ? a : [jetzt()]));
      }
      static now() {
        return jetzt();
      }
    }
    // @ts-expect-error global ersetzen
    globalThis.Date = FalschDate;
  });
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [schluessel, JSON.stringify(sitzung)]);
  await page.addInitScript(() => localStorage.setItem("willroider:install-dismissed", "true"));

  await page.goto(`${APP}/`);
  await page.waitForTimeout(8000);
  const nachStart = erneuerungen;
  await page.waitForTimeout(10000);
  const imLeerlauf = erneuerungen - nachStart;
  console.log(`Erneuerungen beim Start: ${nachStart}, danach in 10 s Leerlauf: ${imLeerlauf}, Abfragen ohne Anmeldung: ${ohneAnmeldung}`);
  expect(rechteGeladen).toBeGreaterThan(0); // App hat das Backend wirklich erreicht
  expect(imLeerlauf).toBeLessThanOrEqual(3);
  expect(ohneAnmeldung).toBe(0);
  expect(fehler).toEqual([]);
  await ctx.close();
  await rest(`/auth/v1/admin/users/${u.id}`, "DELETE");
});
