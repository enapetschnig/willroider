import { test, expect } from "@playwright/test";
import { adminClient, testUserId } from "./helpers";

/** Bulk-Versand-UI für Baustellenstundenberichte.
 *
 *  Wir können kein zweites Profil per Service-Role erzeugen (Test-User
 *  ist alleiniger MA), deshalb fokussieren wir auf den UI-Render der
 *  Liste mit Checkbox-Spalte, Status-Label und der Bulk-Action-Bar nach
 *  einem Klick auf eine Zeilen-Checkbox.
 *
 *  Hinweis: shadcn/Radix-Checkboxes rendern als
 *  <button role="checkbox"> ohne <form>-Wrap, daher selektieren wir
 *  über `[role="checkbox"]` statt `input[type=checkbox]`.
 */

test.describe("Workflow: BSB → /stundenberichte Bulk-Versand-UI", () => {
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

  test.beforeAll(async () => {
    const admin = adminClient();

    // Idempotent: existierenden Bericht hernehmen und auf "bestaetigt"
    // setzen, oder einen neuen direkt mit status="bestaetigt" anlegen.
    const { data: vorh } = await admin
      .from("stunden_berichte")
      .select("id")
      .eq("mitarbeiter_id", testUserId())
      .eq("jahr", jahr)
      .eq("monat", monat)
      .eq("teil", teil)
      .maybeSingle();

    if (vorh) {
      const { error } = await admin
        .from("stunden_berichte")
        .update({ status: "bestaetigt" })
        .eq("id", (vorh as any).id);
      if (error) throw error;
    } else {
      const { error } = await admin
        .from("stunden_berichte")
        .insert({
          mitarbeiter_id: testUserId(),
          jahr,
          monat,
          teil,
          von_datum: vonDatum,
          bis_datum: bisDatum,
          status: "bestaetigt",
          snapshot: {},
        });
      if (error) throw error;
    }
  });

  test("/stundenberichte-Liste zeigt Checkbox-Spalte", async ({ page }) => {
    await page.goto("/stundenberichte");

    // Period steht per Default schon auf dem aktuellen Monat+Teil (siehe
    // StundenBerichteListe.tsx) — kein Setzen nötig.

    await expect(page.locator("body")).toContainText("Baustellenstundenberichte", {
      timeout: 10000,
    });

    // Mindestens eine Checkbox im Header der Tabelle (Select-All)
    await expect(
      page.locator('thead [role="checkbox"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("Status-Label 'Bestätigt (noch nicht versendet)' wird angezeigt für status=bestaetigt", async ({
    page,
  }) => {
    // Idempotent: Status auf 'bestaetigt' setzen
    const admin = adminClient();
    await admin
      .from("stunden_berichte")
      .update({
        status: "bestaetigt",
        versendet_am: null,
        versendet_an_mail: null,
        unterschrift_data: "data:image/png;base64,XYZ",
        unterschrieben_am: new Date().toISOString(),
        bestaetigt_am: new Date().toISOString(),
      })
      .eq("mitarbeiter_id", testUserId())
      .eq("jahr", jahr)
      .eq("monat", monat)
      .eq("teil", teil);
    await page.goto("/stundenberichte");
    await expect(page.locator("body")).toContainText(
      /bestätigt.*noch nicht versendet/i,
      { timeout: 10000 },
    );
  });

  test("Markieren eines Berichts zeigt die Bulk-Action-Bar", async ({ page }) => {
    // Idempotent: sicherstellen dass der Bericht versendbar ist
    const admin = adminClient();
    await admin
      .from("stunden_berichte")
      .update({ status: "bestaetigt", versendet_am: null, versendet_an_mail: null })
      .eq("mitarbeiter_id", testUserId())
      .eq("jahr", jahr)
      .eq("monat", monat)
      .eq("teil", teil);
    await page.goto("/stundenberichte");

    // Warte bis die Liste gerendert ist (Tabellenzeile mit Status-Badge)
    await expect(
      page.locator("body").getByText(/bestätigt.*noch nicht versendet/i).first(),
    ).toBeVisible({ timeout: 10000 });

    // Erste Zeilen-Checkbox anklicken (nicht die im thead)
    const rowCheckbox = page.locator('tbody [role="checkbox"]').first();
    await expect(rowCheckbox).toBeVisible();
    await rowCheckbox.click();

    // Bulk-Action-Bar muss erscheinen: "<N> Bericht(e) markiert"
    await expect(page.locator("body")).toContainText(/markiert/i, {
      timeout: 10000,
    });

    // Button "Markierte ans Büro senden"
    await expect(
      page.getByRole("button", { name: /markierte ans büro senden/i }),
    ).toBeVisible();
  });
});
