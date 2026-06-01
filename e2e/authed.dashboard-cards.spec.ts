import { test, expect } from "@playwright/test";
import { adminClient, testUserId } from "./helpers";

/** Verifiziert die UX-Fixes der Dashboard-Cards:
 *  - Begrüssung + Schnellzugriff rendern.
 *  - StundenBerichtHintCard erscheint als Banner, wenn ein offener
 *    Baustellenstundenbericht des Test-Users existiert.
 *  - Halle/Werkstatt-Card ist im Schnellzugriff sichtbar.
 *  - BerichteHintCard (Bauleiter/Admin-Variante) erscheint NUR, wenn
 *    eingereichte Berichte existieren. */

test.describe("Dashboard-Cards (UX-Fixes)", () => {
  test("Dashboard rendert + Hallo-Greeting + Schnellzugriff-Cards", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/auth/);
    await expect(page.locator("body")).toContainText(
      /schnellzugriff|hallo/i,
      { timeout: 10_000 },
    );
  });

  test.describe("StundenBerichtHintCard mit offenem BSB", () => {
    let berichtId = "";
    const heute = new Date();
    const jahr = heute.getFullYear();
    const monat = heute.getMonth() + 1;
    const tag = heute.getDate();
    const teil = tag <= 16 ? 1 : 2;
    const mm = String(monat).padStart(2, "0");
    const lastDay = new Date(jahr, monat, 0).getDate();
    const vonDatum =
      teil === 1 ? `${jahr}-${mm}-01` : `${jahr}-${mm}-17`;
    const bisDatum =
      teil === 1
        ? `${jahr}-${mm}-16`
        : `${jahr}-${mm}-${String(lastDay).padStart(2, "0")}`;

    test.beforeEach(async () => {
      const admin = adminClient();

      // Idempotent: existierenden Bericht für (User, Jahr, Monat, Teil)
      // auf 'offen' zurücksetzen oder neu anlegen.
      const { data: vorhanden } = await admin
        .from("stunden_berichte")
        .select("id")
        .eq("mitarbeiter_id", testUserId())
        .eq("jahr", jahr)
        .eq("monat", monat)
        .eq("teil", teil)
        .maybeSingle();

      if (vorhanden) {
        berichtId = (vorhanden as any).id;
        const { error: updErr } = await admin
          .from("stunden_berichte")
          .update({
            status: "offen",
            snapshot: {},
            von_datum: vonDatum,
            bis_datum: bisDatum,
            unterschrift_data: null,
            unterschrieben_am: null,
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
            status: "offen",
            snapshot: {},
          })
          .select("id")
          .single();
        if (error) throw error;
        berichtId = (data as any).id;
      }
    });

    test.afterEach(async () => {
      if (!berichtId) return;
      const admin = adminClient();
      await admin.from("stunden_berichte").delete().eq("id", berichtId);
      berichtId = "";
    });

    test("StundenBerichtHintCard erscheint als Banner wenn offener BSB existiert", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page).not.toHaveURL(/\/auth/);
      // Banner-Text + CTA "Jetzt öffnen" müssen sichtbar sein.
      await expect(page.locator("body")).toContainText(
        /wartet auf deine durchsicht|stundenbericht/i,
        { timeout: 10_000 },
      );
      await expect(page.locator("body")).toContainText(/jetzt öffnen/i, {
        timeout: 10_000,
      });
    });
  });

  test("Halle-Card erscheint im Schnellzugriff", async ({ page }) => {
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/auth/);
    await expect(page.locator("body")).toContainText(/halle|werkstatt/i, {
      timeout: 10_000,
    });
  });

  test("Bauleiter-/Admin-Variante BerichteHintCard erscheint NUR wenn eingereichte Berichte existieren", async ({
    page,
  }) => {
    const admin = adminClient();

    // Sicherstellen, dass aktuell KEINE eingereichten Berichte existieren —
    // andernfalls Test überspringen statt fremde Daten zu manipulieren.
    const { count } = await admin
      .from("berichte")
      .select("id", { count: "exact", head: true })
      .eq("status", "eingereicht");

    test.skip(
      (count ?? 0) > 0,
      `Es existieren bereits eingereichte Berichte (${count}) — Negativ-Test nicht möglich.`,
    );

    await page.goto("/");
    await expect(page).not.toHaveURL(/\/auth/);
    // Card-Text der BerichteHintCard darf nicht erscheinen.
    await expect(page.locator("body")).not.toContainText(
      /warten auf deine freigabe/i,
      { timeout: 5_000 },
    );
  });
});
