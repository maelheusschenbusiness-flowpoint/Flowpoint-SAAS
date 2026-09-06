/**
 * Browser certification for a fresh authenticated account:
 * first dashboard load → onboarding modal → every step → final action →
 * durable onboardingCompletedAt.
 *
 * This test creates only local development DB fixtures. It never calls Stripe.
 */
import { chromium } from "playwright";
import pgPkg from "/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js";
import { randomBytes, randomUUID } from "node:crypto";

const { Pool } = pgPkg;
const BASE = process.env.TEST_BASE_URL || "http://127.0.0.1:8081";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase")
    ? { rejectUnauthorized: false }
    : false,
});

const run = Date.now();
const orgId = randomUUID();
const userId = randomUUID();
const token = randomBytes(32).toString("hex");
const email = `qa-onboarding-${run}@flowpoint.test`;
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`✅ ${message}`);
};

try {
  await pool.query(
    `INSERT INTO users
      (id,email,first_name,last_name,status,created_at,updated_at)
     VALUES ($1,$2,'QA','Onboarding','active',NOW(),NOW())`,
    [userId, email],
  );
  await pool.query(
    `INSERT INTO organizations
      (id,name,slug,owner_user_id,status,plan,subscription_status,
       stripe_customer_id,stripe_subscription_id,owner_email,created_at,updated_at)
     VALUES ($1,'QA Onboarding',$2,$3,'active','pro','active',
       'cus_qa_onboarding','sub_qa_onboarding',$4,NOW(),NOW())`,
    [orgId, `qa-onboarding-${run}`, userId, email],
  );
  await pool.query(
    `INSERT INTO user_sessions
      (token,user_id,org_id,email,role,expires_at,created_at,user_id_v2)
     VALUES ($1,$2,$3,$4,'owner',NOW()+INTERVAL '1 hour',NOW(),$5)`,
    [token, userId, orgId, email, userId],
  );
  await pool.query(
    `INSERT INTO user_prefs (org_id,settings,updated_at)
     VALUES ($1,'{}'::jsonb,NOW())
     ON CONFLICT (org_id) DO UPDATE
       SET settings = user_prefs.settings - 'onboardingCompletedAt',
           updated_at = NOW()`,
    [orgId],
  );

  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addInitScript((sessionToken) => {
    sessionStorage.setItem("fp_session_token", sessionToken);
    localStorage.setItem("fp_token", sessionToken);
  }, token);
  const page = await context.newPage();

  await page.goto(`${BASE}/dashboard.html`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  try {
    await page.waitForFunction(() => {
      const modal = document.querySelector("#fp-onboarding");
      return modal && !modal.hasAttribute("hidden");
    }, undefined, { timeout: 30_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      url: location.href,
      modal: document.querySelector("#fp-onboarding")?.outerHTML.slice(0, 500) ?? null,
      me: window.STATE?.me ?? null,
      onboardingComplete: window.STATE?.onboardingComplete ?? null,
      bodyText: document.body.innerText.slice(0, 500),
    }));
    console.error("Onboarding modal diagnostic:", JSON.stringify(diagnostic));
    throw error;
  }

  assert(page.url().includes("dashboard.html"), "first authenticated load reaches dashboard");
  const seenSteps = new Set();
  for (let i = 0; i < 12; i += 1) {
    const progress = await page.locator("#fp-onboarding .fp-ob-progress").textContent();
    assert(progress, `onboarding step ${i + 1} is rendered`);
    seenSteps.add(progress.trim());
    const [currentStep, totalSteps] = progress.trim().split("/").map((value) => Number(value.trim()));
    const next = page.locator("#fp-onboarding .fp-ob-next");
    await next.click();
    if (currentStep === totalSteps) {
      await page.waitForFunction(
        () => document.querySelector("#fp-onboarding")?.hasAttribute("hidden") === true,
        undefined,
        { timeout: 15_000 },
      );
      break;
    }
    await page.waitForTimeout(50);
  }

  assert(seenSteps.size >= 3, "all onboarding sections are reachable before completion");
  await page.waitForFunction(
    () => document.querySelector("#fp-onboarding")?.hasAttribute("hidden") === true,
    undefined,
    { timeout: 10_000 },
  );

  const me = await page.evaluate(async (sessionToken) => {
    const response = await fetch("/api/me", {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    return { status: response.status, body: await response.json() };
  }, token);
  assert(me.status === 200, "first-login session remains authenticated after completion");
  assert(
    typeof me.body.onboardingCompletedAt === "string" &&
      me.body.onboardingCompletedAt.length > 0,
    "onboardingCompletedAt is returned persistently by /api/me",
  );

  const db = await pool.query(
    `SELECT settings->>'onboardingCompletedAt' AS completed_at
     FROM user_prefs WHERE org_id=$1`,
    [orgId],
  );
  assert(
    typeof db.rows[0]?.completed_at === "string" &&
      db.rows[0].completed_at.length > 0,
    "onboardingCompletedAt is persisted in user_prefs",
  );

  await browser.close();
  console.log("PASS: real-browser first-login onboarding certification; no Stripe calls.");
} finally {
  await pool.query("DELETE FROM user_prefs WHERE org_id=$1", [orgId]).catch(() => {});
  await pool.query("DELETE FROM user_sessions WHERE token=$1", [token]).catch(() => {});
  await pool.query("DELETE FROM organizations WHERE id=$1", [orgId]).catch(() => {});
  await pool.query("DELETE FROM users WHERE id=$1", [userId]).catch(() => {});
  await pool.end();
}