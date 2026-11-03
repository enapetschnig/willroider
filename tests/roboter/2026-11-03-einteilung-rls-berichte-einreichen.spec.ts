// Probefahrt Nachtschicht 03.11.2026 (Supabase-Fehlerprotokolle):
//  1) Tagesplan-Sichtbarkeit (einteilung_mitarbeiter / einteilungen) nach dem Umbau auf
//     sichtbare_einteilungen() — gleiche Regeln wie vorher, nur ohne Zeitüberschreitung.
//  2) Polier kann seinen eigenen Bautagesbericht einreichen (vorher RLS-Fehler), aber nicht freigeben.
//  3) „Berichte erzeugen" (BSB) sieht nur die Verwaltung — Poliere bekamen „nicht berechtigt".
// Läuft NUR gegen die Testumgebung (testumgebung.mjs start), App mit VITE_SUPABASE_URL auf die Testumgebung:
// TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=http://localhost:55110 npx playwright test -c tests/roboter/playwright.config.ts
import { expect, test } from "@playwright/test";

const API = process.env.TEST_API_URL ?? "";
const ANON = process.env.TEST_ANON_KEY ?? "";
const SR = process.env.TEST_SERVICE_ROLE_KEY ?? "";
const APP = process.env.TEST_APP_URL ?? "http://localhost:55110";

test.skip(!API || !SR || !ANON, "nur mit Testumgebung");

const kopf = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
async function rest(pfad: string, methode: string, daten?: unknown, extra: Record<string, string> = {}) {
  const r = await fetch(`${API}${pfad}`, { method: methode, headers: { ...kopf, Prefer: "return=representation", ...extra }, body: daten ? JSON.stringify(daten) : undefined });
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
  return { id: u.id as string, email, sitzung };
}
function alsNutzer(sitzung: any) {
  return async (pfad: string, methode = "GET", daten?: unknown) => {
    const r = await fetch(`${API}${pfad}`, {
      method: methode,
      headers: { apikey: ANON, Authorization: `Bearer ${sitzung.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: daten ? JSON.stringify(daten) : undefined,
    });
    const t = await r.text();
    return { status: r.status, daten: t ? JSON.parse(t) : null };
  };
}

test("Tagesplan-Sichtbarkeit, Bericht einreichen, BSB erzeugen nur Verwaltung", async ({ page }) => {
  const buero = await konto("Buero", "buero");
  const ma = await konto("Arbeiter", "mitarbeiter");
  const kollege = await konto("Kollege", "mitarbeiter");
  const polier = await konto("Polier", "mitarbeiter");
  const [bsb] = await rest("/rest/v1/berechtigungen?schluessel=eq.stunden.bsb.bestaetigen&select=id", "GET");
  await rest("/rest/v1/user_berechtigungen", "POST", { user_id: polier.id, berechtigung_id: bsb.id, erlaubt: true });

  const [bs] = await rest("/rest/v1/baustellen", "POST", { bvh_name: "Probe BVH", status: "aktiv" });
  const d1 = "2031-03-03", d2 = "2031-03-04";
  const [eEigen] = await rest("/rest/v1/einteilungen", "POST", { datum: d1, baustelle_id: bs.id });
  const [eFremd] = await rest("/rest/v1/einteilungen", "POST", { datum: d2, baustelle_id: bs.id });
  await rest("/rest/v1/einteilung_mitarbeiter", "POST", [
    { einteilung_id: eEigen.id, mitarbeiter_id: ma.id },
    { einteilung_id: eEigen.id, mitarbeiter_id: kollege.id },
    { einteilung_id: eFremd.id, mitarbeiter_id: kollege.id },
  ]);

  // genau die Abfrage aus den Protokollen (Embed einteilung!inner mit Datumsfilter)
  const q = (d: string) => `/rest/v1/einteilung_mitarbeiter?select=*,einteilung:einteilungen!inner(datum)&einteilung.datum=eq.${d}`;
  const alsMa = alsNutzer(ma.sitzung);
  let r = await alsMa(q(d1));
  expect(r.status).toBe(200);
  expect(r.daten.map((x: any) => x.mitarbeiter_id).sort()).toEqual([ma.id, kollege.id].sort()); // ganze eigene Einteilung
  r = await alsMa(q(d2));
  expect(r.status).toBe(200);
  expect(r.daten).toHaveLength(0); // fremde, nicht freigegebene Einteilung: unsichtbar
  expect((await alsMa(`/rest/v1/einteilungen?id=eq.${eFremd.id}`)).daten).toHaveLength(0);
  // nach Freigabe des Tages sieht jeder den Tagesplan
  await rest("/rest/v1/tagesplanung_freigaben", "POST", { datum: d2, freigegeben_am: new Date().toISOString() });
  r = await alsMa(q(d2));
  expect(r.daten.map((x: any) => x.mitarbeiter_id)).toEqual([kollege.id]);
  expect((await alsMa(`/rest/v1/einteilungen?id=eq.${eFremd.id}`)).daten).toHaveLength(1);
  // Verwaltung sieht alles; Mitarbeiter darf nichts ändern
  expect((await alsNutzer(buero.sitzung)(q(d1))).daten).toHaveLength(2);
  r = await alsMa(`/rest/v1/einteilungen?id=eq.${eEigen.id}`, "PATCH", { notizen: "x" });
  expect(r.daten ?? []).toHaveLength(0);

  // Bericht: Ersteller (kein Admin) reicht ein — genau der Patch aus useSetBerichtStatus
  const [ber] = await rest("/rest/v1/berichte", "POST", { baustelle_id: bs.id, datum: d1, typ: "bautagesbericht", erfasst_von: polier.id });
  const alsPolier = alsNutzer(polier.sitzung);
  r = await alsPolier(`/rest/v1/berichte?id=eq.${ber.id}`, "PATCH", { status: "eingereicht", eingereicht_am: new Date().toISOString() });
  expect(r.status, JSON.stringify(r.daten)).toBe(200);
  expect(r.daten[0].status).toBe("eingereicht");
  // freigeben darf er nicht (Zeile ist nicht mehr Entwurf → 0 Zeilen)
  r = await alsPolier(`/rest/v1/berichte?id=eq.${ber.id}`, "PATCH", { status: "freigegeben" });
  expect(r.daten ?? []).toHaveLength(0);
  // fremder Entwurf direkt auf freigegeben: abgelehnt
  const [ber2] = await rest("/rest/v1/berichte", "POST", { baustelle_id: bs.id, datum: d2, typ: "bautagesbericht", erfasst_von: polier.id });
  r = await alsPolier(`/rest/v1/berichte?id=eq.${ber2.id}`, "PATCH", { status: "freigegeben" });
  expect(r.status).toBe(403);

  // UI: Polier mit BSB-Recht sieht „Berichte erzeugen" nicht, Büro schon
  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  const schluessel = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [schluessel, JSON.stringify(polier.sitzung)]);
  await page.goto(`${APP}/stundenberichte`);
  await expect(page.getByRole("button", { name: "17.–Ende" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Berichte erzeugen" })).toHaveCount(0);

  const p2 = await page.context().browser()!.newPage();
  p2.on("pageerror", (e) => fehler.push(e.message));
  await p2.addInitScript(([k, v]) => localStorage.setItem(k, v), [schluessel, JSON.stringify(buero.sitzung)]);
  await p2.goto(`${APP}/stundenberichte`);
  await expect(p2.getByRole("button", { name: "Berichte erzeugen" })).toBeVisible({ timeout: 20_000 });
  expect(fehler).toEqual([]);
});
