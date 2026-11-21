// Probefahrt 21.11.2026 (Nachtschicht-Gegenprobe zu J. Maurer 20.11. „Bei den Zulagen … stunden eintragen“):
// Seit „alle“ als feste Zahl gespeichert wird, blieb eine Ganztags-Zulage beim Nachbearbeiten stehen
// (Tag 8 h → auf 6 h gekürzt, Zulage weiter 8 h). Jetzt wandert sie mit; Teilstunden bleiben, nie mehr als der Tag.
// Läuft NUR gegen die Testumgebung (testumgebung.mjs start).
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

async function aufStundenSeiteKuerzen(page: Page, datum: string, neu: string) {
  await page.goto(`${APP}/stunden?datum=${datum}`);
  const feld = page.locator('input[inputmode="decimal"]').first();
  await expect(feld).toHaveValue("8", { timeout: 20_000 });
  await expect(page.getByLabel("Zulagen-Stunden").first()).toBeVisible();
  await page.waitForTimeout(1000);
  await feld.fill(neu);
  await page.getByRole("button", { name: /speichern/i }).last().click();
  await expect(page.getByText(/\d+ (Eintrag|Einträge) gespeichert/).first()).toBeVisible();
}

test("Ganztags-Zulage wandert beim Kürzen mit, Teilstunden bleiben", async ({ page }) => {
  const stamp = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  const ma = await konto(`Zn${stamp % 100000}`, "mitarbeiter");
  const [bst] = await rest("/rest/v1/baustellen", "POST", {
    bvh_name: `Zulage Nachbearbeiten ${stamp}`, status: "aktiv", kostenstelle: `8${String(stamp).slice(-6)}`,
  });
  const abbruch = await typ("Abbruchzulage");
  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  page.on("dialog", (d) => d.accept());
  await anmelden(page, ma.sitzung);

  // 1) Ganzer Tag („alle“ → 8 gespeichert), auf 6 h gekürzt → Zulage 6 h.
  const a = await tag(ma.id, "2026-10-12", bst.id, 8);
  await rest("/rest/v1/stunden_zulagen", "POST", { stunden_tag_id: a, zulagen_typ_id: abbruch, stunden: null });
  expect(await zulagenStunden(a)).toEqual([8]);
  await aufStundenSeiteKuerzen(page, "2026-10-12", "6");
  expect(await zulagenStunden(a)).toEqual([6]);

  // 2) Teilstunden (3 von 8) bleiben beim Kürzen auf 6 h stehen.
  const b = await tag(ma.id, "2026-10-13", bst.id, 8);
  await rest("/rest/v1/stunden_zulagen", "POST", { stunden_tag_id: b, zulagen_typ_id: abbruch, stunden: 3 });
  await aufStundenSeiteKuerzen(page, "2026-10-13", "6");
  expect(await zulagenStunden(b)).toEqual([3]);

  // 3) Teilstunden über dem neuen Tag (5 von 8, gekürzt auf 4 h) → höchstens die Arbeitsstunden.
  const c = await tag(ma.id, "2026-10-14", bst.id, 8);
  await rest("/rest/v1/stunden_zulagen", "POST", { stunden_tag_id: c, zulagen_typ_id: abbruch, stunden: 5 });
  await aufStundenSeiteKuerzen(page, "2026-10-14", "4");
  expect(await zulagenStunden(c)).toEqual([4]);

  expect(fehler).toEqual([]);
});
