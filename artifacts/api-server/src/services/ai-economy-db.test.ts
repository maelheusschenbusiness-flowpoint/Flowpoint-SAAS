/**
 * ai-economy-db.test.ts
 *
 * Tests d'intégration DB réelle pour getOrgUsageStatus().
 *
 * Objectif : prouver que la limite effective = planLimit + crédits issus de
 * ai_credit_purchases, et NON d'un argument injecté dans une fonction pure.
 *
 * Isolation : chaque test utilise un org_id unique (timestamp) inexistant en
 * production. Les données sont supprimées dans afterAll via DELETE WHERE org_id.
 *
 * Stratégie mock :
 *   - @workspace/db → importOriginal() pour que withOrgDb et pool soient RÉELS.
 *   - ./store.js     → stub minimal (store.me.plan = null → fallback "standard").
 *   - ./logger.js    → stub silencieux (pas de console bruit pendant les tests).
 *   Les autres modules (ai-engine.ts, org-settings.ts, ai-economy.ts) sont réels.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// ── Override global mocks (définis dans vitest.setup.ts) ──────────────────────
// Les deux mocks ci-dessous doivent précéder tous les imports pour que le
// hoisting de vitest les applique avant que les modules soient chargés.

vi.mock("@workspace/db", async (importOriginal) => {
  return importOriginal<typeof import("@workspace/db")>();
});

vi.mock("./store.js", () => ({
  store: {
    me: { plan: null, email: null, name: null },
    broadcast:        vi.fn(),
    addSseClient:     vi.fn(),
    removeSseClient:  vi.fn(),
    broadcastPlanUpdate: vi.fn(),
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Imports réels ─────────────────────────────────────────────────────────────
import { pool } from "@workspace/db";
import { getOrgUsageStatus } from "./ai-economy.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const RUN_ID = Date.now();

/** org_id unique par exécution — évite toute collision avec les données réelles */
const ORG_WITH_EXTRA = `test-econ-int-extra-${RUN_ID}`;
const ORG_NO_EXTRA   = `test-econ-int-noextra-${RUN_ID}`;

// ─────────────────────────────────────────────────────────────────────────────
// Suite principale
// ─────────────────────────────────────────────────────────────────────────────

describe("getOrgUsageStatus — intégration DB réelle", () => {
  const month = currentMonth();

  // ── Setup : insérer des données de test directement via pool (BYPASSRLS) ───

  beforeAll(async () => {
    // ── Cas 1 : planLimit=100000, additionalCredits=50000, used=120000 ────────
    // org_settings → plan="standard" (100 000 crédits inclus)
    await pool.query(
      `INSERT INTO org_settings (org_id, plan)
       VALUES ($1, 'standard')
       ON CONFLICT (org_id) DO UPDATE SET plan = 'standard'`,
      [ORG_WITH_EXTRA],
    );

    // ai_monthly_usage → credits_used=120 000 pour le mois en cours
    await pool.query(
      `INSERT INTO ai_monthly_usage
         (id, org_id, month, credits_used, cost_eur, request_count,
          tokens_used, reset_at, updated_at)
       VALUES ($1,$2,$3,120000,12.00,5,0,NOW()+INTERVAL '30 days',NOW())
       ON CONFLICT (org_id, month) DO UPDATE SET credits_used = 120000`,
      [`amu-${ORG_WITH_EXTRA}-${month}`, ORG_WITH_EXTRA, month],
    );

    // ai_credit_purchases → deux achats valides totalisant 50 000 crédits
    // (prouve que c'est la SUM de la table, pas un argument injecté)
    await pool.query(
      `INSERT INTO ai_credit_purchases
         (id, org_id, pack, credits, amount_eur_cents,
          stripe_session_id, stripe_payment_intent)
       VALUES
         ($1, $2, 'aiCreditsPack200k', 30000, 2900, $3, $3),
         ($4, $2, 'aiCreditsPack200k', 20000, 1900, $5, $5)
       ON CONFLICT (id) DO NOTHING`,
      [
        `tcp-a-${RUN_ID}`, ORG_WITH_EXTRA, `ses_a_${RUN_ID}`,
        `tcp-b-${RUN_ID}`,                 `ses_b_${RUN_ID}`,
      ],
    );

    // ── Cas 2 : planLimit=100000, additionalCredits=0, used=30000 ─────────────
    await pool.query(
      `INSERT INTO org_settings (org_id, plan)
       VALUES ($1, 'standard')
       ON CONFLICT (org_id) DO UPDATE SET plan = 'standard'`,
      [ORG_NO_EXTRA],
    );

    await pool.query(
      `INSERT INTO ai_monthly_usage
         (id, org_id, month, credits_used, cost_eur, request_count,
          tokens_used, reset_at, updated_at)
       VALUES ($1,$2,$3,30000,3.00,3,0,NOW()+INTERVAL '30 days',NOW())
       ON CONFLICT (org_id, month) DO UPDATE SET credits_used = 30000`,
      [`amu-${ORG_NO_EXTRA}-${month}`, ORG_NO_EXTRA, month],
    );
    // Aucune ligne dans ai_credit_purchases pour ORG_NO_EXTRA → extra = 0
  }, 30_000);

  // ── Cleanup : supprime uniquement les données de test ─────────────────────

  afterAll(async () => {
    await pool.query(
      `DELETE FROM ai_monthly_usage WHERE org_id IN ($1,$2)`,
      [ORG_WITH_EXTRA, ORG_NO_EXTRA],
    );
    await pool.query(
      `DELETE FROM ai_credit_purchases WHERE org_id IN ($1,$2)`,
      [ORG_WITH_EXTRA, ORG_NO_EXTRA],
    );
    await pool.query(
      `DELETE FROM org_settings WHERE org_id IN ($1,$2)`,
      [ORG_WITH_EXTRA, ORG_NO_EXTRA],
    );
  }, 30_000);

  // ── Test 1 : crédits additionnels viennent réellement de ai_credit_purchases

  it(
    "Cas avec crédits additionnels — planLimit=100 000 + 50 000 extra, used=120 000",
    async () => {
      // getOrgUsageStatus → getOrCreateMonthlyUsage → withOrgDb (RÉEL)
      // Lit ai_monthly_usage (used=120 000) et ai_credit_purchases (SUM=50 000).
      // totalAvailable = PLAN_AI_CREDITS.standard(100 000) + creditsExtra(50 000)
      const status = await getOrgUsageStatus(ORG_WITH_EXTRA);

      // Limite effective = planLimit + achats dans ai_credit_purchases
      expect(status.limit).toBe(150_000);
      expect(status.used).toBe(120_000);
      expect(status.remaining).toBe(30_000);

      // usagePercent = (120 000 / 150 000) × 100 = 80.0
      // getOrgUsageStatus : Math.min((used/total)*100, 100) — pas arrondi
      expect(status.usagePercent).toBeCloseTo(80, 5);

      // DEFAULT_THRESHOLDS : optimizedAt=70, economyAt=85
      // 80 ≥ 70 (optimizedAt) et 80 < 85 (economyAt) → OPTIMIZED
      expect(status.economyTier).toBe("OPTIMIZED");
    },
    30_000,
  );

  // ── Test 2 : sans crédits additionnels dans ai_credit_purchases

  it(
    "Cas sans crédits additionnels — planLimit=100 000, used=30 000",
    async () => {
      // Aucune ligne dans ai_credit_purchases → SUM = 0 → creditsExtra = 0
      const status = await getOrgUsageStatus(ORG_NO_EXTRA);

      // totalAvailable = 100 000 + 0 = 100 000
      expect(status.limit).toBe(100_000);
      expect(status.used).toBe(30_000);
      expect(status.remaining).toBe(70_000);

      // usagePercent = (30 000 / 100 000) × 100 = 30.0
      expect(status.usagePercent).toBeCloseTo(30, 5);

      // 30 < optimizedAt(70) → NORMAL
      expect(status.economyTier).toBe("NORMAL");
    },
    30_000,
  );
});
