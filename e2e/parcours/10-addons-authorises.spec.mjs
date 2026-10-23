import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

const apiRequire = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
const { Pool } = apiRequire("pg");
const addonNames = [
  ["agencyPacks", "Agency Reporting Packs"],
  ["aiExecutiveReport", "AI Executive Reporting"],
  ["aiWorkspaceLaunch", "AI Workspace Launch"],
  ["abTestingAI", "AB Testing IA"],
  ["aiContentStrategist", "SEO Content Decay Radar"],
];

const connectionString = process.env["FLOWPOINT_ADDON_CERT_DATABASE_URL"];
const expectedDatabase = process.env["FLOWPOINT_ADDON_CERT_EXPECTED_DB"];
const expectedHost = process.env["FLOWPOINT_ADDON_CERT_EXPECTED_HOST"];
let pool;
let seededOrgId;

function qaOrgId() {
  return JSON.parse(readFileSync("e2e/.compte.json", "utf8")).orgId;
}

test.describe("cinq add-ons autorisés — parcours navigateur isolé", () => {
  test.skip(!connectionString, "Base Neon jetable de certification non configurée.");

  test.beforeAll(async () => {
    if (!connectionString || !expectedDatabase || !expectedHost) {
      throw new Error("Configuration de certification incomplète.");
    }
    if (new URL(connectionString).hostname !== expectedHost) {
      throw new Error("L’hôte Neon ne correspond pas à la cible de certification.");
    }

    pool = new Pool({ connectionString });
    const identity = await pool.query("SELECT current_database() AS database_name");
    if (identity.rows[0]?.database_name !== expectedDatabase) {
      throw new Error("Le nom de base Neon ne correspond pas à la cible de certification.");
    }
    const marker = await pool.query(
      `SELECT database_name, classification
         FROM public.flowpoint_test_database_guard
        WHERE purpose = $1`,
      ["addon-cert"],
    );
    if (
      marker.rows.length !== 1 ||
      marker.rows[0].database_name !== expectedDatabase ||
      marker.rows[0].classification !== "disposable"
    ) {
      throw new Error("Le marqueur de base jetable est absent ou invalide.");
    }

    seededOrgId = qaOrgId();
    for (const [addonKey] of addonNames) {
      await pool.query(
        `INSERT INTO org_addons
           (id, org_id, addon_key, active, quantity, activated_at, created_at, updated_at)
         VALUES ($1, $2, $3, true, 1, NOW(), NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET active=true, updated_at=NOW()`,
        [`qa-${seededOrgId}-${addonKey}`, seededOrgId, addonKey],
      );
    }
  });

  test.afterAll(async () => {
    if (pool && seededOrgId) {
      await pool.query(
        "DELETE FROM org_addons WHERE id = ANY($1::text[])",
        [addonNames.map(([key]) => `qa-${seededOrgId}-${key}`)],
      );
    }
    await pool?.end();
  });

  test("les cinq états actifs passent les routes protégées et restent visibles après rechargement", async ({ page }) => {
    await page.goto("/dashboard.html");
    await page.waitForSelector('[data-route="overview"]');

    const me = await page.request.get("/api/me");
    expect(me.ok()).toBe(true);
    const profile = await me.json();
    for (const [key] of addonNames) {
      expect(profile.addons?.[key], `${key} doit provenir de l’entitlement persisté`).toBeTruthy();
    }

    const gatedReads = [
      ["agencyPacks", "/api/reports/agency-packs"],
      ["aiWorkspaceLaunch", "/api/ai-workspace-launch/qa-session-absente"],
      ["abTestingAI", "/api/ab-testing/experiments?siteUrl=https%3A%2F%2Fqa-fixture.invalid"],
      ["aiContentStrategist", "/api/keywords/content-decay"],
    ];
    for (const [key, path] of gatedReads) {
      const response = await page.request.get(path);
      expect(response.status(), `${key} doit passer son requireAddon réel`).not.toBe(402);
      expect(response.status(), `${key} doit rester une réponse applicative`).toBeLessThan(500);
    }

    await page.locator('[data-route="billing"]').first().click();
    await page.waitForFunction(() => location.hash === "#billing", null, { timeout: 10_000 });
    let visible = await page.locator("body").innerText();
    for (const [, name] of addonNames) {
      expect(visible, `${name} doit être visible dans la gestion des add-ons`).toContain(name);
    }

    await page.reload();
    const afterReload = await page.request.get("/api/me");
    expect(afterReload.ok()).toBe(true);
    const persisted = await afterReload.json();
    for (const [key] of addonNames) {
      expect(persisted.addons?.[key], `${key} doit persister après rechargement`).toBeTruthy();
    }
  });
});
