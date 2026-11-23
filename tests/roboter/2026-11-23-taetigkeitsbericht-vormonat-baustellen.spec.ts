// Wunsch N. Gwenger 23.11.2026: „Baustellen aus Tätigkeitsbericht von Vor Monat gehören mit übernommen.“
// Der Tätigkeitsbericht der aktuellen Periode zeigt die Kostenstellen, auf denen die Person in der
// Vorperiode Stunden hatte, gleich als (leere) Zeilen — nur noch aktive/geplante Baustellen.
// Abgeschlossene Baustellen und fremde Berichte bleiben draußen; die Zeile lässt sich entfernen.
// Läuft NUR gegen die Testumgebung (testumgebung.mjs start).
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
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function neuerAngestellter(vorname: string) {
  const email = `tbvor.${Date.now()}${Math.random().toString(36).slice(2, 7)}@test.local`;
  const u = await rest("/auth/v1/admin/users", "POST", { email, password: PW, email_confirm: true });
  await rest(`/rest/v1/profiles?id=eq.${u.id}`, "PATCH", { vorname, nachname: "Vormonat", is_active: true, zeiterfassung_typ: "angestellter" });
  await rest(`/rest/v1/user_roles?user_id=eq.${u.id}`, "DELETE");
  await rest("/rest/v1/user_roles", "POST", { user_id: u.id, role: "mitarbeiter" });
  return { id: u.id as string, email };
}

test("Baustellen aus der Vorperiode stehen als Zeilen im neuen Tätigkeitsbericht", async ({ page }) => {
  const ich = await neuerAngestellter("Tb");
  const anderer = await neuerAngestellter("Fremd");
  const stamp = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  const kst = (n: number) => `7${n}${String(stamp).slice(-5)}`;
  const neueBaustelle = async (n: number, name: string, status: string) => {
    const [b] = await rest("/rest/v1/baustellen", "POST", { bvh_name: `${name} ${stamp}`, status, kostenstelle: kst(n) });
    return b.id as string;
  };
  const aktiv = await neueBaustelle(1, "Uebernahme Aktiv", "aktiv");
  const fertig = await neueBaustelle(2, "Uebernahme Fertig", "abgeschlossen");
  const fremd = await neueBaustelle(3, "Uebernahme Fremd", "aktiv");

  // Ein Tag in der Vorperiode (aktuelle Periode = 21. Vormonat – 20.; Vorperiode einen Monat davor)
  const h = new Date();
  const start = h.getDate() <= 20 ? new Date(h.getFullYear(), h.getMonth() - 1, 21) : new Date(h.getFullYear(), h.getMonth(), 21);
  const vorTag = iso(new Date(start.getFullYear(), start.getMonth() - 1, 25));
  const eintrag = async (ma: string, baustellen: string[]) => {
    const [tag] = await rest("/rest/v1/stunden_tage", "POST", { mitarbeiter_id: ma, datum: vorTag, tag_status: "baustelle", status: "erfasst" });
    await rest("/rest/v1/stunden_taetigkeiten", "POST", baustellen.map((id, i) => ({ stunden_tag_id: tag.id, position: i + 1, art: "baustelle", baustelle_id: id, stunden: 2 })));
  };
  await eintrag(ich.id, [aktiv, fertig]);
  await eintrag(anderer.id, [fremd]);

  const sitzung = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: ich.email, password: PW }),
  }).then((r) => r.json());
  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  const schluessel = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [schluessel, JSON.stringify(sitzung)]);

  await page.goto(`${APP}/taetigkeitsbericht`);
  const zeile = (name: string) => page.locator("tr", { hasText: `${name} ${stamp}` });
  await expect(zeile("Uebernahme Aktiv")).toHaveCount(1, { timeout: 20_000 });
  await expect(zeile("Uebernahme Aktiv").locator('input[data-tb-zeile]').first()).toBeVisible();
  await expect(zeile("Uebernahme Fertig")).toHaveCount(0);
  await expect(zeile("Uebernahme Fremd")).toHaveCount(0);

  // In der Vorperiode selbst steht die Zeile mit ihren Stunden (kein doppelter Eintrag)
  await page.getByRole("button").filter({ has: page.locator("svg.lucide-chevron-left") }).first().click();
  await expect(zeile("Uebernahme Aktiv")).toHaveCount(1, { timeout: 20_000 });
  await expect(zeile("Uebernahme Fertig")).toHaveCount(1);

  // Zurück: übernommene leere Zeile lässt sich entfernen und bleibt weg
  await page.getByRole("button").filter({ has: page.locator("svg.lucide-chevron-right") }).first().click();
  await expect(zeile("Uebernahme Aktiv")).toHaveCount(1, { timeout: 20_000 });
  await zeile("Uebernahme Aktiv").getByTitle("Zeile entfernen").click();
  await expect(zeile("Uebernahme Aktiv")).toHaveCount(0);
  await page.waitForTimeout(1000);
  await expect(zeile("Uebernahme Aktiv")).toHaveCount(0);
  expect(fehler).toEqual([]);
});
