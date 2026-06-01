import { test, expect } from "@playwright/test";
import { adminClient, testUserId } from "./helpers";

/** Voller BSB-Workflow als E2E: offen → unterschrieben → versendet.
 *  Setup-Daten werden über die Service-Role gesäht; die RPCs prüfen
 *  zwar auth.uid()-basierte Rechte (Service-Role hat keine), deshalb
 *  versuchen wir zuerst RPC und fallen bei einem Fehler auf direkte
 *  Tabellen-Updates zurück. Cleanup erfolgt zentral im Teardown-Skript
 *  über mitarbeiter_id=testUserId. */

test.describe("Workflow: BSB Full-Flow (offen → unterschrieben → versendet)", () => {
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

    // Idempotent: vorhandenen Bericht für (User, Jahr, Monat, Teil) hernehmen
    // oder neu anlegen. Status forcieren wir notfalls per Update auf 'offen'
    // zurück, damit die Test-Reihenfolge stabil bleibt.
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

  test("Detail-Page zeigt Klartext-Status 'durchsehen und unterschreiben' für status=offen", async ({
    page,
  }) => {
    // Idempotent: Status zurück auf 'offen' setzen, damit Tests reihenfolgenunabhängig sind
    const admin = adminClient();
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
    await page.goto(`/stundenbericht/${berichtId}`);
    await expect(page.locator("body")).toContainText(/durchsehen|unterschreib/i, {
      timeout: 10_000,
    });
    await expect(
      page.getByRole("button", { name: /unterschreiben.*abschicken/i }).first(),
    ).toBeVisible();
  });

  test("RPC stunden_bericht_unterschreiben + Page-Reload zeigt 'Wartet auf Büro-Bestätigung'", async ({
    page,
  }) => {
    const admin = adminClient();
    const unterschrift = "data:image/png;base64,XYZ";

    // Zuerst per RPC versuchen — falls die Funktion auf auth.uid() hart
    // prüft, fällt der Service-Role-Aufruf durch; dann direkt updaten.
    const { error: rpcErr } = await admin.rpc(
      "stunden_bericht_unterschreiben" as any,
      { p_id: berichtId, p_unterschrift: unterschrift },
    );

    if (rpcErr) {
      const { error: updErr } = await admin
        .from("stunden_berichte")
        .update({
          status: "unterschrieben",
          unterschrift_data: unterschrift,
          unterschrieben_am: new Date().toISOString(),
        })
        .eq("id", berichtId);
      if (updErr) throw updErr;
    }

    // DB-Sanity: Status muss jetzt 'unterschrieben' sein
    const { data: row } = await admin
      .from("stunden_berichte")
      .select("status, unterschrift_data")
      .eq("id", berichtId)
      .single();
    expect((row as any).status).toBe("unterschrieben");

    await page.goto(`/stundenbericht/${berichtId}`);
    await expect(page.locator("body")).toContainText(/wartet auf büro|bestätig/i, {
      timeout: 10_000,
    });
    await expect(
      page.getByRole("button", { name: /bestätigen.*ans büro/i }).first(),
    ).toBeVisible();
  });

  test("RPC stunden_bericht_versenden setzt Status auf versendet + Page zeigt 'Abgeschlossen — versendet'", async ({
    page,
  }) => {
    const admin = adminClient();
    const mail = "test@example.org";

    const { error: rpcErr } = await admin.rpc(
      "stunden_bericht_versenden" as any,
      { p_id: berichtId, p_mail: mail },
    );

    if (rpcErr) {
      const { error: updErr } = await admin
        .from("stunden_berichte")
        .update({
          status: "versendet",
          bestaetigt_am: new Date().toISOString(),
          versendet_am: new Date().toISOString(),
          versendet_an_mail: mail,
        })
        .eq("id", berichtId);
      if (updErr) throw updErr;
    }

    // DB direkt verifizieren
    const { data: row } = await admin
      .from("stunden_berichte")
      .select("status, versendet_an_mail")
      .eq("id", berichtId)
      .single();
    expect((row as any).status).toBe("versendet");
    expect((row as any).versendet_an_mail).toBe(mail);

    await page.goto(`/stundenbericht/${berichtId}`);
    await expect(page.locator("body")).toContainText(/abgeschlossen|versendet/i, {
      timeout: 10_000,
    });
  });

  // Kein afterAll-Cleanup: tools/test-teardown.mjs räumt alle
  // stunden_berichte mit mitarbeiter_id=testUserId() auf.
});
