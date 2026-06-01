import { test, expect } from "@playwright/test";
import { adminClient, testUserId, uniqMarker, TEST_PREFIX } from "./helpers";

/** Evaluierungen / Unterweisungen: Liste, Vorlagen-Card und Karenzfrist-
 *  Verhalten des EvaluierungSignatureGate. Setup-Daten werden via
 *  Service-Role gesäht (DB-Tag PWTEST_*), UI dient nur der Verifikation.
 *  Cleanup erfolgt in tools/test-teardown.mjs. */
test.describe("Workflow: Evaluierung → Admin-Liste + Vorlagen + Gate-Karenz", () => {
  const heute = new Date().toISOString().slice(0, 10);
  const bvhName = uniqMarker("BS-EVAL");
  const notiz = uniqMarker("EVAL-NOTIZ");
  let baustelleId = "";
  let evalId = "";

  test.beforeAll(async () => {
    const admin = adminClient();

    // 1) Baustelle
    const { data: bs, error: bsErr } = await admin
      .from("baustellen")
      .insert({
        bvh_name: bvhName,
        kostenstelle: uniqMarker("KS-EVAL"),
        status: "aktiv",
        kategorie: "baustelle",
      })
      .select("id")
      .single();
    if (bsErr) throw bsErr;
    baustelleId = (bs as any).id;

    // 2) Evaluierung (typ='baustelle' ist im Enum evaluierung_typ enthalten)
    const { data: ev, error: evErr } = await admin
      .from("evaluierungen")
      .insert({
        baustelle_id: baustelleId,
        datum: heute,
        typ: "baustelle",
        vortragender_id: testUserId(),
        notizen: notiz,
        checkliste: {},
        abgeschlossen: false,
      })
      .select("id")
      .single();
    if (evErr) throw evErr;
    evalId = (ev as any).id;

    // 3) Unterschrift (status='offen', falls Spalte da; sonst ohne)
    const baseRow: Record<string, unknown> = {
      evaluierung_id: evalId,
      mitarbeiter_id: testUserId(),
      unterschrift_data: null,
    };
    const { error: sigErr } = await admin
      .from("evaluierung_unterschriften")
      .insert({ ...baseRow, status: "offen" });
    if (sigErr) {
      // Fallback falls status-Spalte (noch) nicht existiert
      const msg = String((sigErr as any).message ?? "");
      if (/status/i.test(msg)) {
        const { error: sigErr2 } = await admin
          .from("evaluierung_unterschriften")
          .insert(baseRow);
        if (sigErr2) throw sigErr2;
      } else {
        throw sigErr;
      }
    }
  });

  test("/admin?tab=evaluierung Liste zeigt Test-Evaluierung", async ({ page }) => {
    await page.goto("/admin?tab=evaluierung");
    await expect(page.locator("body")).toContainText(
      new RegExp(`${notiz}|${bvhName}`),
      { timeout: 10000 },
    );
  });

  test("Vorlagen-Card sichtbar", async ({ page }) => {
    await page.goto("/admin?tab=evaluierung");
    await expect(page.locator("body")).toContainText(
      /Unterweisungs-Vorlagen|Vorlage/i,
      { timeout: 10000 },
    );
  });

  test("EvaluierungSignatureGate erscheint nicht beim Login (Karenzfrist gilt)", async ({
    page,
  }) => {
    await page.goto("/");
    // Heute angelegt → tage_offen=0 → harter Vollbild-Gate darf nicht greifen.
    // Wir prüfen sowohl auf den Overlay-Container als auch auf den Text.
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await expect(
      page.locator("div.fixed.inset-0.z-50"),
    ).toHaveCount(0);
    await expect(
      page.getByText(/Bitte lies die Unterweisung sorgfältig/i),
    ).toHaveCount(0);
  });
});

// TEST_PREFIX wird in helpers exportiert — hier nur referenziert, falls
// spätere Erweiterungen ihn brauchen (Lint-stumm halten).
void TEST_PREFIX;
