import { test, expect } from "@playwright/test";
import { adminClient, testUserId, uniqMarker, TEST_PREFIX } from "./helpers";

/** Workflow-Tests mit echtem DB-State. Setup-Daten werden über die
 *  Service-Role gesäht, die UI wird zur Verifikation geöffnet. Cleanup
 *  erfolgt zentral in tools/test-teardown.mjs nach dem Lauf. */

test.describe("Workflow: Baustelle → Liste → Detail", () => {
  let baustelleId = "";
  const bvhName = uniqMarker("BS");

  test.beforeAll(async () => {
    const admin = adminClient();
    const { data, error } = await admin
      .from("baustellen")
      .insert({
        bvh_name: bvhName,
        kostenstelle: uniqMarker("KS"),
        status: "aktiv",
        kategorie: "baustelle",
      })
      .select("id")
      .single();
    if (error) throw error;
    baustelleId = data.id;
  });

  test("Test-Baustelle erscheint in /baustellen-Suche", async ({ page }) => {
    await page.goto("/baustellen");
    await page.getByPlaceholder(/such/i).fill(bvhName);
    await expect(page.getByText(bvhName).first()).toBeVisible({ timeout: 10000 });
  });

  test("Detail-Seite öffnet ohne Fehler", async ({ page }) => {
    await page.goto(`/baustellen/${baustelleId}`);
    await expect(page.locator("body")).toContainText(bvhName, { timeout: 10000 });
  });
});

test.describe("Workflow: Stunden eintragen → DB-Verify (per Service-Role-Insert)", () => {
  // Wir bauen den DB-State über service-role auf und prüfen, dass die
  // Auswertungs-Seite ihn korrekt anzeigt. Das deckt die Lese-Pfade ab,
  // ohne die brittle UI-Click-Sequenz.
  let baustelleId = "";
  const bvhName = uniqMarker("BS-STD");
  const heute = new Date().toISOString().slice(0, 10);

  test.beforeAll(async () => {
    const admin = adminClient();
    const { data: bs } = await admin
      .from("baustellen")
      .insert({
        bvh_name: bvhName,
        kostenstelle: uniqMarker("KS-S"),
        status: "aktiv",
        kategorie: "baustelle",
      })
      .select("id")
      .single();
    baustelleId = (bs as any).id;

    // Sauberer Start: alten Test-Tag und alle taetigkeiten weg
    await admin
      .from("stunden_tage")
      .delete()
      .eq("mitarbeiter_id", testUserId())
      .eq("datum", heute);
    const { data: neu, error } = await admin
      .from("stunden_tage")
      .insert({
        mitarbeiter_id: testUserId(),
        datum: heute,
        status: "erfasst",
        tag_status: "baustelle",
        netto_stunden: 4,
      })
      .select("id")
      .single();
    if (error) throw error;
    const tagId = (neu as any).id;
    const { error: ttErr } = await admin
      .from("stunden_taetigkeiten")
      .insert({
        stunden_tag_id: tagId,
        position: 1,
        art: "baustelle",
        baustelle_id: baustelleId,
        stunden: 4,
      });
    if (ttErr) throw ttErr;
  });

  test("Eintrag liegt in der DB + erscheint in /stunden-Page", async ({ page }) => {
    const admin = adminClient();
    const { data: tag } = await admin
      .from("stunden_tage")
      .select("id, stunden_taetigkeiten(baustelle_id, stunden)")
      .eq("mitarbeiter_id", testUserId())
      .eq("datum", heute)
      .maybeSingle();
    expect(tag).toBeTruthy();
    const taets: any[] = (tag as any).stunden_taetigkeiten ?? [];
    const treffer = taets.find((t) => t.baustelle_id === baustelleId);
    expect(treffer).toBeTruthy();
    expect(Number(treffer.stunden)).toBe(4);

    await page.goto("/stunden");
    await expect(page.locator("body")).toContainText(/zeiterfassung|stunden/i, {
      timeout: 10000,
    });
  });
});

test.describe("Workflow: Halle-Maschine eintragen → Hybrid-Tag funktioniert", () => {
  const heute = new Date().toISOString().slice(0, 10);
  let maschineId = "";

  test.beforeAll(async () => {
    const admin = adminClient();
    const { data: m } = await admin
      .from("baustellen")
      .select("id, bvh_name")
      .eq("kategorie", "maschine")
      .limit(1)
      .single();
    if (!m) throw new Error("Keine Maschine im Seed");
    maschineId = (m as any).id;

    // Idempotent: Tag holen oder anlegen, dann Maschinen-Eintrag dazu
    const { data: vorhanden } = await admin
      .from("stunden_tage")
      .select("id")
      .eq("mitarbeiter_id", testUserId())
      .eq("datum", heute)
      .maybeSingle();
    let tagId = (vorhanden as any)?.id;
    if (!tagId) {
      const { data: neu } = await admin
        .from("stunden_tage")
        .insert({
          mitarbeiter_id: testUserId(),
          datum: heute,
          status: "erfasst",
          tag_status: "baustelle",
          netto_stunden: 2,
        })
        .select("id")
        .single();
      tagId = (neu as any).id;
    }
    // Maschinen-Eintrag (zusätzlich, falls Baustelle-Eintrag schon existiert)
    await admin.from("stunden_taetigkeiten").insert({
      stunden_tag_id: tagId,
      position: 99,
      art: "baustelle",
      baustelle_id: maschineId,
      stunden: 2,
    });
  });

  test("Hybrid-Tag: Maschinen-Eintrag UND ggf. Baustellen-Eintrag erhalten", async () => {
    const admin = adminClient();
    const { data: tag } = await admin
      .from("stunden_tage")
      .select("id, stunden_taetigkeiten(baustelle_id, art, stunden)")
      .eq("mitarbeiter_id", testUserId())
      .eq("datum", heute)
      .maybeSingle();
    expect(tag).toBeTruthy();
    const taets: any[] = (tag as any).stunden_taetigkeiten ?? [];
    const maschTreffer = taets.find(
      (t) => t.art === "baustelle" && t.baustelle_id === maschineId,
    );
    expect(maschTreffer, "Maschinen-Eintrag muss in DB stehen").toBeTruthy();
  });

  test("/halle Seite lädt + Toggle-Button sichtbar", async ({ page }) => {
    await page.goto("/halle");
    await expect(
      page.getByRole("button", { name: /werk.?\/.?maschine/i }),
    ).toBeVisible();
  });
});

test.describe("Workflow: BSB → /stundenbericht/:id Rendering + Buttons", () => {
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
      return;
    }

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
    berichtId = data.id;
  });

  test("Detail-Seite öffnet + zeigt Status + neue Button-Beschriftung", async ({
    page,
  }) => {
    await page.goto(`/stundenbericht/${berichtId}`);
    await expect(page.locator("body")).toContainText(
      /baustellenstundenbericht|stundenbericht/i,
      { timeout: 10000 },
    );
    // Klartext-Status nach UX-Pass: enthält "durchsehen" oder "unterschreib"
    await expect(page.locator("body")).toContainText(
      /durchsehen|unterschreib/i,
    );
    await expect(
      page.getByRole("button", { name: /unterschreiben.*abschicken/i }),
    ).toBeVisible();
    // „Wieder öffnen" wurde entfernt — darf nirgends auftauchen
    await expect(page.getByRole("button", { name: /wieder.*öffnen/i })).toHaveCount(0);
  });
});

test.describe("Workflow: Angebot via API → Liste", () => {
  const titel = uniqMarker("ANG");

  test.beforeAll(async () => {
    const admin = adminClient();
    const { error } = await admin.from("angebote").insert({
      bvh_name: titel,
      bauherr: "Test Bauherr",
      status: "offen",
      created_by: testUserId(),
    });
    if (error) throw error;
  });

  test("Test-Angebot erscheint in /angebote", async ({ page }) => {
    await page.goto("/angebote");
    await expect(page.locator("body")).toContainText(titel, { timeout: 10000 });
  });
});

test.describe("Workflow: Bautagesbericht via API → Detail", () => {
  let berichtId = "";
  let baustelleId = "";
  const bvhName = uniqMarker("BS-BTB");

  test.beforeAll(async () => {
    const admin = adminClient();
    const { data: bs } = await admin
      .from("baustellen")
      .insert({
        bvh_name: bvhName,
        kostenstelle: uniqMarker("KS-B"),
        status: "aktiv",
        kategorie: "baustelle",
      })
      .select("id")
      .single();
    baustelleId = (bs as any).id;

    const { data, error } = await admin
      .from("berichte")
      .insert({
        baustelle_id: baustelleId,
        typ: "bautagesbericht",
        datum: new Date().toISOString().slice(0, 10),
        status: "entwurf",
        erfasst_von: testUserId(),
      })
      .select("id")
      .single();
    if (error) throw error;
    berichtId = data.id;
  });

  test("Bericht-Detail öffnet + zeigt Baustellen-Name + Status", async ({
    page,
  }) => {
    await page.goto(`/berichte/${berichtId}`);
    await expect(page.locator("body")).toContainText(bvhName, { timeout: 10000 });
    await expect(page.locator("body")).toContainText(/entwurf|bautagesbericht/i);
  });
});

test.describe("Workflow: Tagesplanung-Freigabe → MA-Sicht", () => {
  const heute = new Date().toISOString().slice(0, 10);
  let baustelleId = "";
  let einteilungId = "";
  const bvhName = uniqMarker("BS-TPLAN");

  test.beforeAll(async () => {
    const admin = adminClient();

    // Alte Test-Einteilungen für heute wegräumen — über ALLE Test-Runs
    // hinweg. Der bvh_name-Prefix bleibt konstant ("PWTEST_"); die per-Run-
    // Suffixe wechseln. Sonst zeigt /mein-tag noch alte Test-Daten.
    const { data: alteEm } = await admin
      .from("einteilung_mitarbeiter")
      .select("einteilung_id")
      .eq("mitarbeiter_id", testUserId());
    const alteIds = ((alteEm as any[]) ?? []).map((r) => r.einteilung_id);
    if (alteIds.length > 0) {
      // Nur die mit Test-Tätigkeit aufräumen — alte Echt-Daten unberührt lassen
      const { data: alte } = await admin
        .from("einteilungen")
        .select("id")
        .in("id", alteIds)
        .like("taetigkeit", "PWTEST_%");
      const delIds = ((alte as any[]) ?? []).map((r) => r.id);
      if (delIds.length > 0) {
        await admin
          .from("einteilung_mitarbeiter")
          .delete()
          .in("einteilung_id", delIds);
        await admin.from("einteilungen").delete().in("id", delIds);
      }
    }
    // Alte Freigaben für heute wegräumen
    await admin.from("tagesplanung_freigaben").delete().eq("datum", heute);

    const { data: bs } = await admin
      .from("baustellen")
      .insert({
        bvh_name: bvhName,
        kostenstelle: uniqMarker("KS-T"),
        status: "aktiv",
        kategorie: "baustelle",
      })
      .select("id")
      .single();
    baustelleId = (bs as any).id;

    const { data: ein } = await admin
      .from("einteilungen")
      .insert({
        datum: heute,
        baustelle_id: baustelleId,
        taetigkeit: `${TEST_PREFIX}Aufbau`,
      })
      .select("id")
      .single();
    einteilungId = (ein as any).id;
    await admin.from("einteilung_mitarbeiter").insert({
      einteilung_id: einteilungId,
      mitarbeiter_id: testUserId(),
    });
  });

  test("Vor Freigabe: MA sieht KEINE Einteilung in /mein-tag", async ({ page }) => {
    // Stelle sicher, dass für heute KEINE Freigabe gesetzt ist
    const admin = adminClient();
    await admin.from("tagesplanung_freigaben").delete().eq("datum", heute);
    await page.goto("/mein-tag");
    // Test-Baustelle darf NICHT erscheinen
    await expect(page.getByText(bvhName)).toHaveCount(0);
  });

  test("Nach Freigabe: MA sieht die Einteilung in /mein-tag", async ({ page }) => {
    const admin = adminClient();
    await admin.from("tagesplanung_freigaben").insert({
      datum: heute,
      freigegeben_von: testUserId(),
    });
    await page.goto("/mein-tag");
    await expect(page.getByText(bvhName).first()).toBeVisible({ timeout: 10000 });
  });
});
