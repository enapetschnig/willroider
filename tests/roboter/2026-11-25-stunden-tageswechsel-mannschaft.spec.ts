// Probefahrt 25.11.2026 zu J. A. Hallegger (/stunden: „Wenn ich … zwischen den Tagen wechsle, dann werden die
// Stunden bzw. Einträge immer geändert … Außerdem sind teilweise Mitarbeiter bei mir, die an diesen Tagen nicht bei
// mir waren. Das passiert nur, wenn ich aktuell diesen Mitarbeiter bei mir habe.“)
// Ursache: beim Datumswechsel wurde die Personenauswahl aus dem Plan des VORHER offenen Tages gebaut (im ersten
// Render nach dem Wechsel stand noch der alte Plan drin) und auch die Vorbelegung lief darauf.
//  Heute: Polier + Helfer + Springer auf Baustelle A geplant.
//  Vergangener Tag: Polier + Helfer auf A (vom Polier geschrieben), Springer auf R eingeteilt und hat dort selbst
//  „Firma“ geschrieben. Wechselt der Polier von heute auf diesen Tag, darf der Springer NICHT erscheinen,
//  Polier und Helfer stehen genau wie gespeichert da; Speichern ohne Änderung legt nichts Neues an.
// Läuft NUR gegen die Testumgebung (testumgebung.mjs start).
import { expect, test } from "@playwright/test";

const API = process.env.TEST_API_URL ?? "";
const ANON = process.env.TEST_ANON_KEY ?? "";
const SR = process.env.TEST_SERVICE_ROLE_KEY ?? "";
const APP = process.env.TEST_APP_URL ?? "http://localhost:55210";

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
  await rest(`/rest/v1/profiles?id=eq.${u.id}`, "PATCH", { vorname, nachname: "Probe", is_active: true });
  await rest(`/rest/v1/user_roles?user_id=eq.${u.id}`, "DELETE");
  await rest("/rest/v1/user_roles", "POST", { user_id: u.id, role: rolle });
  const sitzung = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  }).then((r) => r.json());
  return { id: u.id as string, sitzung };
}
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function vergangenerWerktag(): string {
  const d = new Date();
  d.setDate(d.getDate() - 4);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return iso(d);
}

async function tagAnlegen(maId: string, datum: string, vonId: string, art: string, zeilen: Array<{ art: string; baustelle_id: string; stunden: number }>) {
  const [tag] = await rest("/rest/v1/stunden_tage", "POST", {
    mitarbeiter_id: maId,
    datum,
    tag_status: art,
    erfasst_von: vonId,
  });
  await rest(
    "/rest/v1/stunden_taetigkeiten",
    "POST",
    zeilen.map((z, i) => ({ stunden_tag_id: tag.id, position: i + 1, ...z })),
  );
  return tag.id as string;
}

test("Tageswechsel: Mannschaft und Stunden des Tages, nicht die von heute", async ({ page }) => {
  const stamp = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  const k = stamp % 100000;
  const polier = await konto(`Polier${k}`, "bauleiter");
  const helfer = await konto(`Helfer${k}`, "mitarbeiter");
  const springer = await konto(`Springer${k}`, "mitarbeiter");
  const [partie] = await rest("/rest/v1/partien", "POST", { name: `Partie Wechsel ${stamp}`, partieleiter_id: polier.id });
  await rest(`/rest/v1/profiles?id=in.(${polier.id},${helfer.id},${springer.id})`, "PATCH", { partie_id: partie.id });

  const [bstA] = await rest("/rest/v1/baustellen", "POST", {
    bvh_name: `Wechsel A ${stamp}`, status: "aktiv", kostenstelle: `6${String(stamp).slice(-6)}`,
  });
  const [bstR] = await rest("/rest/v1/baustellen", "POST", {
    bvh_name: `Woanders R ${stamp}`, status: "aktiv", kostenstelle: `5${String(stamp).slice(-6)}`,
  });

  const heute = iso(new Date());
  const frueher = vergangenerWerktag();
  // Heute: alle drei auf A
  const [einH] = await rest("/rest/v1/einteilungen", "POST", { datum: heute, baustelle_id: bstA.id });
  await rest("/rest/v1/einteilung_mitarbeiter", "POST", [polier, helfer, springer].map((p) => ({ einteilung_id: einH.id, mitarbeiter_id: p.id })));
  // Früher: Polier + Helfer auf A, Springer auf R
  const [einF] = await rest("/rest/v1/einteilungen", "POST", { datum: frueher, baustelle_id: bstA.id });
  await rest("/rest/v1/einteilung_mitarbeiter", "POST", [polier, helfer].map((p) => ({ einteilung_id: einF.id, mitarbeiter_id: p.id })));
  const [einR] = await rest("/rest/v1/einteilungen", "POST", { datum: frueher, baustelle_id: bstR.id });
  await rest("/rest/v1/einteilung_mitarbeiter", "POST", { einteilung_id: einR.id, mitarbeiter_id: springer.id });
  // Geschrieben: Polier für sich und den Helfer, Springer selbst in der Firma
  await tagAnlegen(polier.id, frueher, polier.id, "baustelle", [{ art: "baustelle", baustelle_id: bstA.id, stunden: 7.5 }]);
  await tagAnlegen(helfer.id, frueher, polier.id, "baustelle", [{ art: "baustelle", baustelle_id: bstA.id, stunden: 7.5 }]);
  await tagAnlegen(springer.id, frueher, springer.id, "firma", [{ art: "firma", baustelle_id: bstR.id, stunden: 9.5 }]);

  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  const schluessel = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(([kk, v]) => localStorage.setItem(kk, v), [schluessel, JSON.stringify(polier.sitzung)]);
  await page.addInitScript(() => localStorage.setItem("willroider:install-dismissed", "true"));
  // Plan des neuen Tages kommt spät — genau dann stand vorher noch der alte Plan drin.
  await page.route("**/rest/v1/rpc/plan_fuer_tag", async (r) => {
    await new Promise((x) => setTimeout(x, 1500));
    await r.continue();
  });

  await page.goto(`${APP}/stunden`);
  const block = (name: string) =>
    page.locator("div.rounded-lg.border.bg-card").filter({
      has: page.getByRole("button", { name: new RegExp(name) }),
    }).last();
  // Heute: Springer ist dabei
  await expect(block(`Springer${k}`)).toBeVisible({ timeout: 20_000 });

  // Auf den früheren Tag wechseln
  await page.locator('input[type="date"]').fill(frueher);
  await expect(block(`Helfer${k}`)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(4000);
  await expect(page.getByRole("button", { name: new RegExp(`Springer${k}`) })).toHaveCount(0);
  const werte = async (b: ReturnType<typeof block>) =>
    b.locator('input[inputmode="decimal"]').evaluateAll((es) => es.map((e) => (e as HTMLInputElement).value));
  expect(await werte(block(`Helfer${k}`))).toEqual(["7,5"]);
  expect(await werte(block(`Polier${k}`))).toEqual(["7,5"]);

  // Zurück auf heute und wieder auf den Tag: gleich wie vorher
  await page.getByRole("button", { name: "Heute", exact: true }).click();
  await expect(block(`Springer${k}`)).toBeVisible({ timeout: 20_000 });
  await page.locator('input[type="date"]').fill(frueher);
  await expect(block(`Helfer${k}`)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(4000);
  await expect(page.getByRole("button", { name: new RegExp(`Springer${k}`) })).toHaveCount(0);
  expect(await werte(block(`Helfer${k}`))).toEqual(["7,5"]);

  // Unverändert speichern: Springer bleibt unberührt, nichts Neues
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /speichern/i }).last().click();
  await expect(page.getByText(/gespeichert/).first()).toBeVisible();
  const tage = await rest(
    `/rest/v1/stunden_tage?datum=eq.${frueher}&mitarbeiter_id=in.(${polier.id},${helfer.id},${springer.id})&select=mitarbeiter_id,tag_status,stunden_taetigkeiten(art,baustelle_id,stunden)`,
    "GET",
  );
  expect(tage).toHaveLength(3);
  const sp = tage.find((t: any) => t.mitarbeiter_id === springer.id);
  expect(sp.tag_status).toBe("firma");
  expect(sp.stunden_taetigkeiten.map((x: any) => [x.art, x.baustelle_id, Number(x.stunden)])).toEqual([["firma", bstR.id, 9.5]]);
  const he = tage.find((t: any) => t.mitarbeiter_id === helfer.id);
  expect(he.stunden_taetigkeiten.map((x: any) => [x.baustelle_id, Number(x.stunden)])).toEqual([[bstA.id, 7.5]]);
  expect(fehler).toEqual([]);
});
