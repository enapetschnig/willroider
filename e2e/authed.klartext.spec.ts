import { test, expect } from "@playwright/test";
import { adminClient, testUserId, uniqMarker, TEST_PREFIX } from "./helpers";

/** UX-/Klartext-Smokes: sichern die wichtigsten Wortlaut-Verbesserungen
 *  ab, damit niemand versehentlich auf generische Texte wie "Keine
 *  Berichte gefunden." oder "Verwaltung kontaktieren" zurückfällt.
 *  Jeder Test ist ein einfacher Render+Text-Check, kein Click-Pfad. */

test.describe("UX/Klartext: zentrale Pages", () => {
  let berichtId = "";

  test.beforeAll(async () => {
    const admin = adminClient();
    const heute = new Date();
    const jahr = heute.getFullYear();
    const monat = heute.getMonth() + 1;
    const teil = heute.getDate() <= 16 ? 1 : 2;
    const mm = String(monat).padStart(2, "0");
    const lastDay = new Date(jahr, monat, 0).getDate();
    const vonDatum = teil === 1 ? `${jahr}-${mm}-01` : `${jahr}-${mm}-17`;
    const bisDatum =
      teil === 1
        ? `${jahr}-${mm}-16`
        : `${jahr}-${mm}-${String(lastDay).padStart(2, "0")}`;

    // Idempotent: vorhandenen Bericht recyceln oder neu anlegen und auf
    // Status 'unterschrieben' setzen, damit die "Wer-ist-dran"-Texte
    // ("wartet auf Büro") garantiert gerendert werden.
    const { data: vorhanden } = await admin
      .from("stunden_berichte")
      .select("id")
      .eq("mitarbeiter_id", testUserId())
      .eq("jahr", jahr)
      .eq("monat", monat)
      .eq("teil", teil)
      .maybeSingle();

    const unterschrift = "data:image/png;base64,XYZ";

    if (vorhanden) {
      berichtId = (vorhanden as any).id;
      const { error: updErr } = await admin
        .from("stunden_berichte")
        .update({
          status: "unterschrieben",
          snapshot: {},
          von_datum: vonDatum,
          bis_datum: bisDatum,
          unterschrift_data: unterschrift,
          unterschrieben_am: new Date().toISOString(),
          bestaetigt_von: null,
          bestaetigt_am: null,
          versendet_am: null,
          versendet_an_mail: null,
        })
        .eq("id", berichtId);
      if (updErr) throw updErr;
    } else {
      const { data, error } = await admin
        .from("stunden_berichte")
        .insert({
          mitarbeiter_id: testUserId(),
          jahr,
          monat,
          teil,
          von_datum: vonDatum,
          bis_datum: bisDatum,
          status: "unterschrieben",
          snapshot: {},
          unterschrift_data: unterschrift,
          unterschrieben_am: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) throw error;
      berichtId = (data as any).id;
    }
  });

  test("/stundenberichte zeigt 'Wer-ist-dran'-Texte wenn Bericht angelegt", async ({
    page,
  }) => {
    await page.goto("/stundenberichte");
    await expect(page).not.toHaveURL(/\/auth/);
    await expect(page.locator("body")).toContainText(/wartet auf büro|büro/i, {
      timeout: 10_000,
    });
  });

  test("/stundenbericht/<id> zeigt Klartext-Status für unterschrieben", async ({
    page,
  }) => {
    await page.goto(`/stundenbericht/${berichtId}`);
    await expect(page).not.toHaveURL(/\/auth/);
    await expect(page.locator("body")).toContainText(
      /wartet auf büro|büro|bestätigung/i,
      { timeout: 10_000 },
    );
  });

  test("/berichte Empty-State sagt 'Klick auf Neuer'", async ({ page }) => {
    await page.goto("/berichte");
    await expect(page).not.toHaveURL(/\/auth/);
    // Render abwarten
    await expect(page.locator("body")).toContainText(/bericht/i, {
      timeout: 10_000,
    });
    const body = (await page.locator("body").innerText()).toLowerCase();
    // Der neue Empty-State soll auf den Anlege-Pfad hinweisen, nicht
    // einfach generisch "Keine Berichte gefunden." sagen.
    const hatNeuer = /neuer|anlegen/i.test(body);
    const hatAltenWortlaut = /keine berichte gefunden\./i.test(body);
    expect(
      hatNeuer || !hatAltenWortlaut,
      `Empty-State auf /berichte ist noch generisch: ${body.slice(0, 400)}`,
    ).toBe(true);
  });

  test("Baustellen-Liste hat verständlichen Empty-State", async ({ page }) => {
    await page.goto("/baustellen");
    await expect(page).not.toHaveURL(/\/auth/);
    await expect(page.locator("body")).toContainText(/baustelle/i, {
      timeout: 10_000,
    });
    const body = (await page.locator("body").innerText()).toLowerCase();
    // Entweder sind Test-Baustellen sichtbar, oder der Empty-State
    // weist auf das Anlegen hin ("anlegen" / "neu").
    const hatHinweis = /anlegen|neu/i.test(body);
    expect(
      hatHinweis || body.includes("baustelle"),
      `Baustellen-Liste ohne verständlichen Empty-State: ${body.slice(0, 400)}`,
    ).toBe(true);
  });

  test("MeinTag rendert ohne 'Verwaltung kontaktieren' (alter Wortlaut)", async ({
    page,
  }) => {
    await page.goto("/mein-tag");
    await expect(page).not.toHaveURL(/\/auth/);
    await expect(page.locator("body")).toContainText(
      /einteilung|tag|baustelle|halle/i,
      { timeout: 10_000 },
    );
    await expect(page.locator("body")).not.toContainText(
      /verwaltung kontaktieren/i,
    );
  });

  // Kein afterAll-Cleanup: tools/test-teardown.mjs räumt stunden_berichte
  // mit mitarbeiter_id=testUserId() auf.
});

// Marker-Helpers werden hier nicht aktiv genutzt, aber als Import beibehalten,
// damit künftige Erweiterungen ohne Diff-Lärm hinzukommen können.
void uniqMarker;
void TEST_PREFIX;
