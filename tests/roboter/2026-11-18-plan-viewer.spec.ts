// Probefahrt 18.11.2026 (S. Egger, Plan-Viewer):
//  - Plan öffnet mit EINEM Klick direkt im Viewer (kein Download), 5 Pläne als Tabs, Wechsel per Klick
//    und per Wischen (Finger), zwei nebeneinander, Tabs nach Neuladen wieder da.
//  - Anmerkungen: Freihand, Rechteck, Text, Länge (Maßstab 1:100), Foto-Pin; Rückgängig/Wiederholen;
//    Ebene ausblenden; gespeichert in plan_anmerkungen (nur für den Ersteller sichtbar); Original unverändert.
//  - „Als Kopie speichern“: Namensvorschlag Name_JJJJ-MM-TT_Kürzel, neue PDF im Ordner des Plans
//    (dokumente + Storage, eine Seite mehr für die Fotos), Original bleibt.
//  - Offline: Plan offline speichern → ohne Netz über „Pläne“ öffnen, Anmerkung „ausstehend“,
//    Kopie wartet; mit Netz wird beides hochgeladen.
// Alle Daten künstlich (PDFs werden hier erzeugt). Läuft NUR gegen die Testumgebung:
// TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=http://localhost:55110 npx playwright test -c tests/roboter/playwright.config.ts
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createHash } from "node:crypto";

const API = process.env.TEST_API_URL ?? "";
const ANON = process.env.TEST_ANON_KEY ?? "";
const SR = process.env.TEST_SERVICE_ROLE_KEY ?? "";
const APP = process.env.TEST_APP_URL ?? "http://localhost:55110";

test.skip(!API || !SR || !ANON, "nur mit Testumgebung");
test.use({ screenshot: "only-on-failure" });

const kopf = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
async function rest(pfad: string, methode: string, daten?: unknown) {
  const r = await fetch(`${API}${pfad}`, { method: methode, headers: { ...kopf, Prefer: "return=representation" }, body: daten ? JSON.stringify(daten) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${methode} ${pfad}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}
const PW = "Test1234!x";
async function konto(vorname: string, nachname: string, rolle: string) {
  const email = `${vorname}.${Date.now()}@test.local`;
  const u = await rest("/auth/v1/admin/users", "POST", { email, password: PW, email_confirm: true });
  await rest(`/rest/v1/profiles?id=eq.${u.id}`, "PATCH", { vorname, nachname, is_active: true });
  await rest(`/rest/v1/user_roles?user_id=eq.${u.id}`, "DELETE");
  await rest("/rest/v1/user_roles", "POST", { user_id: u.id, role: rolle });
  const sitzung = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }),
  }).then((r) => r.json());
  return { id: u.id as string, sitzung };
}
async function anmelden(page: Page, sitzung: unknown) {
  const schluessel = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, [schluessel, JSON.stringify(sitzung)]);
}
async function planPdf(titel: string, breite: number, hoehe: number): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const s = d.addPage([breite, hoehe]);
  s.drawText(titel, { x: 60, y: hoehe - 120, size: 60, font: f });
  s.drawRectangle({ x: 100, y: 100, width: breite - 200, height: hoehe - 300, borderWidth: 4, borderColor: rgb(0, 0, 0) });
  return d.save();
}
async function hochladen(pfad: string, bytes: Uint8Array) {
  const r = await fetch(`${API}/storage/v1/object/baustellen/${pfad}`, {
    method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/pdf" }, body: bytes,
  });
  if (!r.ok) throw new Error(`Upload ${pfad}: ${r.status} ${await r.text()}`);
}
async function herunterladen(pfad: string) {
  const r = await fetch(`${API}/storage/v1/object/baustellen/${pfad}`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
  if (!r.ok) throw new Error(`Download ${pfad}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Ziehen auf der Planfläche (Maus), Anteile 0..1 der Fläche. */
async function ziehen(page: Page, flaeche: ReturnType<Page["locator"]>, von: [number, number], bis: [number, number]) {
  const b = (await flaeche.boundingBox())!;
  await page.mouse.move(b.x + b.width * von[0], b.y + b.height * von[1]);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(b.x + b.width * (von[0] + ((bis[0] - von[0]) * i) / 8), b.y + b.height * (von[1] + ((bis[1] - von[1]) * i) / 8));
  }
  await page.mouse.up();
}

test("Plan-Viewer: Ein-Klick, Tabs, Wischen, Anmerkungen, Kopie, offline", async ({ page, context }) => {
  test.setTimeout(240_000);
  const stamp = Date.now().toString().slice(-6);
  const polier = await konto("Sebastian", "Probe", "bauleiter");
  const andere = await konto("Andere", "Person", "bauleiter");
  const [bs] = await rest("/rest/v1/baustellen", "POST", { bvh_name: `Probe BVH Plan ${stamp}`, kostenstelle: `14077${stamp}`, status: "aktiv" });
  await rest("/rest/v1/baustellen_mitarbeiter", "POST", { baustelle_id: bs.id, mitarbeiter_id: polier.id }).catch(() => null);

  // Bucket „baustellen“ gibt es in der Testumgebung nicht von selbst (in echt im Dashboard angelegt)
  await fetch(`${API}/storage/v1/bucket`, {
    method: "POST", headers: kopf, body: JSON.stringify({ id: "baustellen", name: "baustellen", public: false }),
  });
  const namen = ["Grundriss EG", "Schnitt A-A", "Ansicht Nord", "Dachdraufsicht", "Detail Traufe"];
  const pfade: string[] = [];
  const originalHash: string[] = [];
  for (let i = 0; i < namen.length; i++) {
    // erster Plan in A0 (3370 × 2384 pt), die anderen A3
    const bytes = await planPdf(namen[i], i === 0 ? 3370 : 1191, i === 0 ? 2384 : 842);
    const pfad = `${bs.id}/91-plaene/${Date.now()}_${i}.pdf`;
    await hochladen(pfad, bytes);
    pfade.push(pfad);
    originalHash.push(sha(bytes));
    await rest("/rest/v1/dokumente", "POST", {
      baustelle_id: bs.id, ordner: "91-plaene", dateiname: `${namen[i]}.pdf`, storage_path: pfad,
      mimetype: "application/pdf", groesse: bytes.length, hochgeladen_von: polier.id,
      created_at: new Date(Date.now() - i * 60_000).toISOString(),
    });
  }
  const [dokEg] = await rest(`/rest/v1/dokumente?storage_path=eq.${encodeURIComponent(pfade[0])}&select=id`, "GET");

  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  await anmelden(page, polier.sitzung);

  await page.goto(`${APP}/baustellen/${bs.id}?tab=dokumente&ordner=91-plaene`);
  const viewer = page.getByTestId("plan-viewer");
  // ── 3.1 Ein Klick öffnet, kein Download ──
  for (const n of namen) {
    if (await viewer.isVisible()) await page.getByRole("button", { name: "Plan-Viewer schließen" }).click();
    await page.getByText(`${n}.pdf`, { exact: true }).first().click();
    await expect(viewer).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("tab", { name: new RegExp(n) })).toHaveAttribute("aria-selected", "true");
  }
  await expect(page.getByRole("tab")).toHaveCount(5);
  await expect(page.getByText("Plan wird geladen…")).toHaveCount(0, { timeout: 20_000 });

  // ── 3.2 Wechsel per Klick auf den Tab ──
  await page.getByRole("tab", { name: /Grundriss EG/ }).click();
  await expect(page.getByRole("tab", { name: /Grundriss EG/ })).toHaveAttribute("aria-selected", "true");
  const flaeche = page.getByTestId("plan-flaeche").first();
  await expect(page.getByText("Plan wird geladen…")).toHaveCount(0, { timeout: 20_000 });

  // Wischen mit dem Finger (Gesamtansicht) → nächster Plan
  await flaeche.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const ev = (typ: string, x: number) =>
      el.dispatchEvent(new PointerEvent(typ, { bubbles: true, pointerId: 77, pointerType: "touch", clientX: x, clientY: y, isPrimary: true, button: 0 }));
    ev("pointerdown", r.left + r.width * 0.8);
    ev("pointermove", r.left + r.width * 0.6);
    ev("pointermove", r.left + r.width * 0.3);
    ev("pointerup", r.left + r.width * 0.3);
  });
  await expect(page.getByRole("tab", { name: /Schnitt A-A/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: /Grundriss EG/ }).click();
  await expect(page.getByText("Plan wird geladen…")).toHaveCount(0, { timeout: 20_000 });

  // ── 3.4 Werkzeuge ──
  const ebene = page.getByTestId("plan-ebene").first();
  await page.getByRole("button", { name: "Freihand" }).click();
  await ziehen(page, flaeche, [0.3, 0.3], [0.5, 0.45]);
  await expect(ebene).toHaveAttribute("data-anzahl", "1");
  await page.getByRole("button", { name: "Rechteck" }).click();
  await ziehen(page, flaeche, [0.55, 0.3], [0.7, 0.5]);
  await expect(ebene).toHaveAttribute("data-anzahl", "2");
  await page.getByRole("button", { name: "Revisionswolke" }).click();
  await ziehen(page, flaeche, [0.2, 0.55], [0.35, 0.7]);
  await expect(ebene).toHaveAttribute("data-anzahl", "3");
  await page.getByRole("button", { name: "Rückgängig" }).click();
  await expect(ebene).toHaveAttribute("data-anzahl", "2");
  await page.getByRole("button", { name: "Wiederholen" }).click();
  await expect(ebene).toHaveAttribute("data-anzahl", "3");

  await page.getByRole("button", { name: "Text" }).click();
  const fb = (await flaeche.boundingBox())!;
  await page.mouse.click(fb.x + fb.width * 0.4, fb.y + fb.height * 0.75);
  await page.getByPlaceholder("Text").fill("Achtung Öffnung prüfen");
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await expect(ebene).toHaveAttribute("data-anzahl", "4");
  await expect(ebene.locator("text", { hasText: "Achtung Öffnung prüfen" })).toHaveCount(1);

  // Maßstab 1:100, dann Länge messen
  await page.getByRole("button", { name: "Maßstab", exact: true }).click();
  await page.getByPlaceholder("z. B. 100").fill("100");
  await page.getByRole("button", { name: "Setzen" }).click();
  await page.getByRole("button", { name: "Länge messen" }).click();
  await ziehen(page, flaeche, [0.3, 0.85], [0.6, 0.85]);
  await expect(ebene).toHaveAttribute("data-anzahl", "5");
  await expect(ebene.locator("text", { hasText: / m$/ })).toHaveCount(1);

  // Foto-Pin
  await page.getByRole("button", { name: "Foto-Pin" }).click();
  const [auswahl] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.mouse.click(fb.x + fb.width * 0.65, fb.y + fb.height * 0.65),
  ]);
  // 1×1-JPEG
  const jpg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
    "base64",
  );
  await auswahl.setFiles({ name: "foto.jpg", mimeType: "image/jpeg", buffer: jpg });
  await expect(ebene).toHaveAttribute("data-anzahl", "6", { timeout: 10_000 });
  await expect(ebene.locator("[data-foto-pin]")).toHaveCount(1);

  // 3.5 Ebene ausblenden
  await page.getByRole("button", { name: "Anmerkungen ausblenden" }).click();
  await expect(ebene.locator("path, rect, text, g")).toHaveCount(0);
  await page.getByRole("button", { name: "Anmerkungen einblenden" }).click();

  // gespeichert (nur für den Ersteller)
  await expect(page.locator('[data-sync="synchronisiert"]').first()).toBeVisible({ timeout: 15_000 });
  const zeilen = await rest(`/rest/v1/plan_anmerkungen?datei_schluessel=eq.dok:${dokEg.id}&select=user_id,daten`, "GET");
  expect(zeilen).toHaveLength(1);
  expect(zeilen[0].user_id).toBe(polier.id);
  expect(zeilen[0].daten.seiten["1"]).toHaveLength(6);
  expect(zeilen[0].daten.massstab.n).toBe(100);
  const fremd = await fetch(`${API}/rest/v1/plan_anmerkungen?select=id`, {
    headers: { apikey: ANON, Authorization: `Bearer ${andere.sitzung.access_token}` },
  }).then((r) => r.json());
  expect(fremd).toHaveLength(0);
  // Original unverändert
  expect(sha(await herunterladen(pfade[0]))).toBe(originalHash[0]);

  // ── 3.6 Als Kopie speichern ──
  await page.getByRole("button", { name: "Weitere Aktionen" }).first().click();
  await page.getByRole("menuitem", { name: "Als Kopie speichern" }).click();
  const name = page.getByLabel("Dateiname");
  const heute = new Date();
  const datum = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, "0")}-${String(heute.getDate()).padStart(2, "0")}`;
  await expect(name).toHaveValue(`Grundriss EG_${datum}_SP`);
  await name.fill(`Grundriss EG Probe ${stamp}`);
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByText("Kopie gespeichert").first()).toBeVisible({ timeout: 30_000 });
  const [kopie] = await rest(`/rest/v1/dokumente?baustelle_id=eq.${bs.id}&dateiname=eq.${encodeURIComponent(`Grundriss EG Probe ${stamp}.pdf`)}&select=*`, "GET");
  expect(kopie.ordner).toBe("91-plaene");
  expect(kopie.hochgeladen_von).toBe(polier.id);
  const kopieBytes = await herunterladen(kopie.storage_path);
  const kopieDoc = await PDFDocument.load(kopieBytes);
  expect(kopieDoc.getPageCount()).toBe(2); // Plan + Fotoseite
  expect(Math.round(kopieDoc.getPage(0).getWidth())).toBe(3370);
  expect(sha(await herunterladen(pfade[0]))).toBe(originalHash[0]);

  // ── 3.2 Nebeneinander ──
  await page.getByRole("button", { name: "Nebeneinander" }).click();
  await expect(page.getByTestId("plan-flaeche")).toHaveCount(2);

  // ── Tabs nach Neuladen wieder da ──
  await page.reload();
  await expect(viewer).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("tab")).toHaveCount(5);
  await expect(page.getByTestId("plan-flaeche")).toHaveCount(2);
  await page.getByRole("button", { name: "Nebeneinander" }).click();
  await expect(page.getByTestId("plan-flaeche")).toHaveCount(1);
  await page.getByRole("tab", { name: /Grundriss EG/ }).click();
  await expect(page.getByTestId("plan-ebene").first()).toHaveAttribute("data-anzahl", "6", { timeout: 20_000 });

  // ── 3.8 Offline ──
  await page.getByRole("button", { name: "Weitere Aktionen" }).first().click();
  await page.getByRole("menuitem", { name: "Offline speichern" }).click();
  await expect(page.getByText("Offline gespeichert").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Plan-Viewer schließen" }).click();
  // Alle Pläne der Baustelle offline
  await page.getByRole("button", { name: /Alle Pläne offline speichern/ }).click();
  await expect(page.getByText("6 von 6 Plänen offline gespeichert").first()).toBeVisible({ timeout: 30_000 });

  // Netz weg — App neu starten (Service Worker liefert die App) und unter „Pläne“ öffnen
  // (Mit Produktions-Build gibt es den Service Worker → echter Neustart; am Dev-Server nur Seitenwechsel.)
  const mitSw = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator) || !(await navigator.serviceWorker.getRegistration())) return false;
    await navigator.serviceWorker.ready;
    return !!navigator.serviceWorker.controller;
  });
  await context.setOffline(true);
  if (mitSw) {
    await page.goto(`${APP}/plaene`);
  } else {
    // Dev-Server: Bausteine kommen nicht aus dem Cache → Viewer vorher öffnen, dann Netz weg
    await context.setOffline(false);
    await page.getByRole("button", { name: /Offene Pläne/ }).click();
    await expect(page.getByTestId("plan-ebene").first()).toHaveAttribute("data-anzahl", "6", { timeout: 20_000 });
    await context.setOffline(true);
  }
  if (mitSw) {
    await expect(page.getByText("Keine Verbindung")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Grundriss EG\.pdf.*MB/ }).click();
  }
  await expect(viewer).toBeVisible();
  if (mitSw) await expect(page.getByText("Offline-Fassung")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("plan-ebene").first()).toHaveAttribute("data-anzahl", "6");
  await page.getByRole("button", { name: "Pfeil" }).click();
  await ziehen(page, page.getByTestId("plan-flaeche").first(), [0.4, 0.2], [0.5, 0.3]);
  await expect(page.getByTestId("plan-ebene").first()).toHaveAttribute("data-anzahl", "7");
  await expect(page.locator('[data-sync="ausstehend"]').first()).toBeVisible({ timeout: 15_000 });
  // Kopie ohne Netz → wartet
  await page.getByRole("button", { name: "Weitere Aktionen" }).first().click();
  await page.getByRole("menuitem", { name: "Als Kopie speichern" }).click();
  await page.getByLabel("Dateiname").fill(`Offline Kopie ${stamp}`);
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByText("Kopie wartet auf Netz").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("1 ausstehend")).toBeVisible();

  // Netz wieder da → alles hoch
  await context.setOffline(false);
  await expect(page.locator('[data-sync="synchronisiert"]').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("1 ausstehend")).toHaveCount(0, { timeout: 30_000 });
  const nach = await rest(`/rest/v1/plan_anmerkungen?datei_schluessel=eq.dok:${dokEg.id}&select=daten`, "GET");
  expect(nach[0].daten.seiten["1"]).toHaveLength(7);
  const offKopie = await rest(`/rest/v1/dokumente?baustelle_id=eq.${bs.id}&dateiname=eq.${encodeURIComponent(`Offline Kopie ${stamp}.pdf`)}&select=id,ordner`, "GET");
  expect(offKopie).toHaveLength(1);
  expect(offKopie[0].ordner).toBe("91-plaene");

  expect(fehler, fehler.join("\n")).toHaveLength(0);
});
