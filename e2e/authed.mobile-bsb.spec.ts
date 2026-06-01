import { test, expect } from "@playwright/test";
import { adminClient, testUserId } from "./helpers";

/** Mobile-Sanity-Check für die BSB-Detail-Seite — kein horizontaler
 *  Scroll, Sticky-Footer sichtbar. Wir bleiben bei Chromium und setzen
 *  nur Viewport + Mobile-Flag, damit kein zusätzlicher Browser
 *  installiert werden muss. */

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test("BSB-Detail auf 390px: kein horizontaler Scroll, Footer sichtbar", async ({
  page,
}) => {
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

  // Idempotent: existierenden Bericht hernehmen oder anlegen
  const { data: vorh } = await admin
    .from("stunden_berichte")
    .select("id")
    .eq("mitarbeiter_id", testUserId())
    .eq("jahr", jahr)
    .eq("monat", monat)
    .eq("teil", teil)
    .maybeSingle();
  let berichtId: string;
  if (vorh) {
    berichtId = (vorh as any).id;
    // Idempotent: Status auf 'offen' zurücksetzen — Mobile-Test braucht
    // den "Tippen auf eine Tages-Card"-Hinweis (editierbar=true) und den
    // "Unterschreiben & abschicken"-Button (status='offen' für Eigentümer).
    await admin
      .from("stunden_berichte")
      .update({
        status: "offen",
        unterschrift_data: null,
        unterschrieben_am: null,
        bestaetigt_am: null,
        bestaetigt_von: null,
        versendet_am: null,
        versendet_an_mail: null,
      })
      .eq("id", berichtId);
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
        snapshot: { taetigkeiten: [] },
      })
      .select("id")
      .single();
    if (error) throw error;
    berichtId = (data as any).id;
  }

  await page.goto(`/stundenbericht/${berichtId}`);

  // Tag-Card-Liste muss da sein, nicht die Tabelle
  await expect(
    page.locator("body").getByText(/Tippen auf eine Tages-Card/i),
  ).toBeVisible({ timeout: 10000 });

  // Sticky-Footer-CTA muss sichtbar sein (kann doppelt vorkommen: Desktop + Mobile Sticky-Footer)
  await expect(
    page.getByRole("button", { name: /unterschreiben.*abschicken/i }).first(),
  ).toBeVisible();

  // Kein horizontaler Scroll: documentElement.scrollWidth ≤ clientWidth + 1px Toleranz
  const overflow = await page.evaluate(() => {
    return (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
  });
  expect(overflow, "kein horizontaler Scroll").toBeLessThanOrEqual(1);

  // Storage state nicht via diesen Browser-Context auth.json zurücksetzen
});
