// Probefahrt 20.11.2026 zu J. Maurer (Stundenberichte, Erschwerniszulage-Zettel Tripolt KW 47):
// „dann übernimmt er auch das x was alles verfällscht“ — am Zettel stand bei der Zulage „x“ statt Stunden, Gesamt 0,00.
//  - Eine Zulage wird nie ohne Stunden gespeichert: leer = Arbeitsstunden des Tages; bleibt nichts übrig
//    (Tag nur Schlechtwetter, oder 0 h), wird sie gar nicht gespeichert (App + Datenbank).
//  - Der Zettel druckt nie „x“ und zählt die Stunden in „Gesamt pro Woche“.
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

test("Zulage nie ohne Stunden, Erschwernis-Zettel ohne „x“", async ({ page }) => {
  const stamp = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  const ma = await konto(`Zx${stamp % 100000}`, "mitarbeiter");
  const [bst] = await rest("/rest/v1/baustellen", "POST", {
    bvh_name: `Zettel X Probe ${stamp}`, status: "aktiv", kostenstelle: `6${String(stamp).slice(-6)}`,
  });
  const abbruch = await typ("Abbruchzulage");
  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  await anmelden(page, ma.sitzung);

  // KW 47/2026 wie im Wunsch: Mo 9,5 h Baustelle, Di nur Schlechtwetter, Mi 8 h mit ausdrücklich 0 h Zulage.
  const mo = await tag(ma.id, "2026-11-16", bst.id, 9.5);
  await rest("/rest/v1/stunden_zulagen", "POST", { stunden_tag_id: mo, zulagen_typ_id: abbruch, stunden: null });
  expect(await zulagenStunden(mo)).toEqual([9.5]);

  const [di] = await rest("/rest/v1/stunden_tage", "POST", {
    mitarbeiter_id: ma.id, datum: "2026-11-17", tag_status: "baustelle", erfasst_von: ma.id,
  });
  await rest("/rest/v1/stunden_taetigkeiten", "POST", [
    { stunden_tag_id: di.id, position: 1, art: "schlechtwetter", baustelle_id: bst.id, stunden: 4 },
  ]);
  await rest("/rest/v1/stunden_zulagen", "POST", { stunden_tag_id: di.id, zulagen_typ_id: abbruch, stunden: null });
  expect(await zulagenStunden(di.id)).toEqual([]);

  const mi = await tag(ma.id, "2026-11-18", bst.id, 8);
  await rest("/rest/v1/stunden_zulagen", "POST", { stunden_tag_id: mi, zulagen_typ_id: abbruch, stunden: 0 });
  expect(await zulagenStunden(mi)).toEqual([]);

  // Zettel so, wie ihn Stundenberichte/Archiv erzeugen (Modul der laufenden App).
  await page.goto(`${APP}/`);
  const ergebnis = await page.evaluate(async (maId) => {
    const m = await import("/src/lib/erschwerniszulagePdf.ts");
    const doc = await m.ladeZulagenZettel({ mitarbeiterId: maId, von: "2026-11-16", bis: "2026-11-22" });
    // Reine Logik: eine Zulage mit 0 h (Altdaten) erzeugt kein „x“ und kein Blatt.
    const blaetter = m.zulagenBlaetter([
      { datum: "2026-11-16", arbeitsbeginn: null, kostenstellen: [], zulagen: [{ typId: "a", bezeichnung: "Abbruchzulage", stunden: 9.5 }] },
      { datum: "2026-11-17", arbeitsbeginn: null, kostenstellen: [], zulagen: [{ typId: "a", bezeichnung: "Abbruchzulage", stunden: 0 }] },
      { datum: "2026-11-24", arbeitsbeginn: null, kostenstellen: [], zulagen: [{ typId: "a", bezeichnung: "Abbruchzulage", stunden: null }] },
    ]);
    return {
      text: doc ? doc.output() : "",
      blaetter: blaetter.map((b: any) => ({ kw: b.kw, gesamt: b.gesamt, tage: b.tage.map((t: any) => t.stunden) })),
    };
  }, ma.id);
  expect(ergebnis.blaetter).toEqual([{ kw: 47, gesamt: 9.5, tage: [9.5, null, null, null, null, null, null] }]);
  const text = ergebnis.text;
  expect(text).toContain("Aufzeichnung Erschwerniszulage");
  expect(text).toContain("9,50 Std");
  expect(text).not.toContain("0,00 Std");
  expect(text).not.toContain("Zulage ohne Stundenangabe");
  // Einziges „x“ am Blatt ist das Kreuz bei „d) Schmutz- Abbrucharbeiten“, keines in der Summenzeile.
  expect(text.match(/\(x\) Tj/g)?.length ?? 0).toBe(1);

  expect(fehler).toEqual([]);
});
