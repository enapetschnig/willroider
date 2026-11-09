// Probefahrt 09.11.2026 zu N. Gwenger („Wenn Stunden geschrieben sind und diese geändert werden, dann löscht
// er immer die geschriebenen Stunden und das BVH … durch das ersetzt, bei dem die Poliere eingetragen sind“):
//  Polier und ein Mitarbeiter seiner Partie haben am Tag schon Stunden auf Baustelle B, geplant sind beide
//  auf Baustelle A. Öffnet der Polier den Tag über „Ändern“ (/stunden?datum=…), müssen bei BEIDEN die
//  geschriebenen Baustellen und Stunden im Formular stehen — nicht A aus der Planung und nicht 0 Stunden.
//  Ändert er nur eine Zahl beim Mitarbeiter, bleibt der Rest so, wie er war.
// Läuft NUR gegen die Testumgebung (testumgebung.mjs start):
// TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=http://localhost:55210 npx playwright test -c tests/roboter/playwright.config.ts
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
  const email = `${vorname.toLowerCase()}.${Date.now()}@test.local`;
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

/** Ein Werktag vor ein paar Tagen (nicht heute — „Ändern“ eines alten Tages). */
function vergangenerWerktag(): string {
  const d = new Date();
  d.setDate(d.getDate() - 3);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return iso(d);
}

async function tagAnlegen(maId: string, datum: string, vonId: string, zeilen: Array<{ art: string; baustelle_id: string; stunden: number }>) {
  const [tag] = await rest("/rest/v1/stunden_tage", "POST", {
    mitarbeiter_id: maId,
    datum,
    tag_status: "baustelle",
    erfasst_von: vonId,
  });
  await rest(
    "/rest/v1/stunden_taetigkeiten",
    "POST",
    zeilen.map((z, i) => ({ stunden_tag_id: tag.id, position: i + 1, ...z })),
  );
  return tag.id as string;
}

test("Ändern zeigt bei allen mitgebuchten Personen die geschriebenen Stunden und Baustellen", async ({ page }) => {
  const stamp = Date.now();
  const polier = await konto(`Polier${stamp % 10000}`, "bauleiter");
  const ma = await konto(`Helfer${stamp % 10000}`, "mitarbeiter");
  const [partie] = await rest("/rest/v1/partien", "POST", { name: `Partie Probe ${stamp}`, partieleiter_id: polier.id });
  await rest(`/rest/v1/profiles?id=in.(${polier.id},${ma.id})`, "PATCH", { partie_id: partie.id });

  const [bstA] = await rest("/rest/v1/baustellen", "POST", {
    bvh_name: `Geplant A ${stamp}`, status: "aktiv", kostenstelle: `8${String(stamp).slice(-6)}`,
  });
  const [bstB] = await rest("/rest/v1/baustellen", "POST", {
    bvh_name: `Geschrieben B ${stamp}`, status: "aktiv", kostenstelle: `7${String(stamp).slice(-6)}`,
  });

  const datum = vergangenerWerktag();
  // Planung: beide auf A
  const [ein] = await rest("/rest/v1/einteilungen", "POST", { datum, baustelle_id: bstA.id });
  await rest("/rest/v1/einteilung_mitarbeiter", "POST", [
    { einteilung_id: ein.id, mitarbeiter_id: polier.id },
    { einteilung_id: ein.id, mitarbeiter_id: ma.id },
  ]);
  // Geschrieben: beide auf B (der Polier hat für den Mitarbeiter mitgebucht)
  await tagAnlegen(polier.id, datum, polier.id, [{ art: "baustelle", baustelle_id: bstB.id, stunden: 6 }]);
  await tagAnlegen(ma.id, datum, polier.id, [
    { art: "baustelle", baustelle_id: bstB.id, stunden: 6.5 },
    { art: "baustelle", baustelle_id: bstA.id, stunden: 1.5 },
  ]);

  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  const schluessel = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [schluessel, JSON.stringify(polier.sitzung)]);
  await page.addInitScript(() => localStorage.setItem("willroider:install-dismissed", "true"));
  // Langsames Netz nachstellen: Soll und „wer hat schon“ kommen spät — genau dann wurde vorher
  // mit Planungs-Baustelle und 0 Stunden vorbelegt.
  await page.route("**/rest/v1/**", async (r) => {
    const u = r.request().url();
    if (u.includes("profile_konten_settings") || u.includes("arbeitszeitkalender")) {
      await new Promise((x) => setTimeout(x, 2500));
    }
    await r.continue();
  });

  await page.goto(`${APP}/stunden?datum=${datum}`);

  const block = (name: string) =>
    // innerster Block (die äußere Karte enthält alle Personen)
    page.locator("div.rounded-lg.border.bg-card").filter({
      has: page.getByRole("button", { name: new RegExp(name) }),
    }).last();
  const maBlock = block(`Helfer${stamp % 10000}`);
  const polierBlock = block(`Polier${stamp % 10000}`);
  await expect(maBlock).toBeVisible({ timeout: 20_000 });
  await expect(polierBlock).toBeVisible();
  await page.waitForTimeout(4000); // spät eintreffendes Soll darf nichts mehr umstellen

  const werte = async (b: ReturnType<typeof block>) =>
    b.locator('input[inputmode="decimal"]').evaluateAll((es) => es.map((e) => (e as HTMLInputElement).value));
  expect(await werte(maBlock)).toEqual(["6,5", "1,5"]);
  expect(await werte(polierBlock)).toEqual(["6"]);
  await expect(maBlock.getByRole("combobox").first()).toContainText(`Geschrieben B ${stamp}`);
  await expect(polierBlock.getByRole("combobox").first()).toContainText(`Geschrieben B ${stamp}`);

  // Nur eine Zahl beim Mitarbeiter ändern: 6,5 → 7
  const feld = maBlock.locator('input[inputmode="decimal"]').first();
  await feld.fill("7");
  await feld.blur();
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /speichern/i }).last().click();
  await expect(page.getByText(/\d+ Einträge? gespeichert/).first()).toBeVisible();

  const tage = await rest(
    `/rest/v1/stunden_tage?datum=eq.${datum}&mitarbeiter_id=in.(${polier.id},${ma.id})&select=mitarbeiter_id,netto_stunden,stunden_taetigkeiten(art,baustelle_id,stunden,position)`,
    "GET",
  );
  const von = (id: string) => tage.find((t: any) => t.mitarbeiter_id === id);
  const sortiert = (t: any) =>
    [...t.stunden_taetigkeiten].sort((a: any, b: any) => a.position - b.position).map((x: any) => [x.baustelle_id, Number(x.stunden)]);
  expect(sortiert(von(ma.id))).toEqual([[bstB.id, 7], [bstA.id, 1.5]]);
  expect(sortiert(von(polier.id))).toEqual([[bstB.id, 6]]);
  expect(fehler).toEqual([]);
});
