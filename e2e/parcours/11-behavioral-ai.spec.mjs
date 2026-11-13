import { createRequire } from "node:module";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { test, expect } from "@playwright/test";

const apiRequire = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
const { Pool } = apiRequire("pg");
const databaseUrl = process.env["FLOWPOINT_ADDON_CERT_DATABASE_URL"];
const expectedDb = process.env["FLOWPOINT_ADDON_CERT_EXPECTED_DB"];
const expectedHost = process.env["FLOWPOINT_ADDON_CERT_EXPECTED_HOST"];
const mailDir = process.env["TEST_MAIL_DIR"];
const emailA = `behavior-cert-a-${randomUUID()}@flowpoint-internal.test`;
const emailB = `behavior-cert-b-${randomUUID()}@flowpoint-internal.test`;
const userA = randomUUID();
const userB = randomUUID();
const orgA = randomUUID();
const orgB = randomUUID();
const siteA = "https://behavior-a.qa-fixture.invalid";
const siteB = "https://behavior-b.qa-fixture.invalid";
const sessionId = `e2e-behavior-${randomUUID()}`;
let db;

async function signIn(page, email) {
  const response = await page.request.post("/api/auth/login-request", { data: { email } });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.debugLink).toBeTruthy();

  const mail = readdirSync(mailDir)
    .filter(name => name.endsWith(".json"))
    .map(name => JSON.parse(readFileSync(`${mailDir}/${name}`, "utf8")))
    .find(message => message.to === email);
  expect(mail?.token).toBeTruthy();

  await page.goto(body.debugLink);
  await page.waitForURL(/dashboard\.html/, { timeout: 20_000 });
  await page.waitForSelector('[data-route="overview"]', { timeout: 20_000 });
  const skipTour = page.getByRole("button", { name: "Passer la visite" });
  if (await skipTour.isVisible().catch(() => false)) await skipTour.click();
}

function publicHeaders() {
  return { origin: siteA, "sec-fetch-site": "cross-site" };
}

async function postSessionEvent(page, token, eventType, pagePath) {
  const response = await page.request.post("/api/behavioral/event", {
    headers: publicHeaders(),
    data: {
      sessionId,
      siteUrl: siteA,
      page: pagePath,
      eventType,
      sessionToken: token,
      ts: Date.now(),
      nonce: randomUUID(),
    },
  });
  expect(response.ok(), `${eventType} event should be accepted`).toBe(true);
}

test.beforeAll(async () => {
  if (!databaseUrl || !expectedDb || !expectedHost || !mailDir || !process.env["ENABLE_TEST_MAILER"]) {
    throw new Error("Behavioral certification requires the isolated test database and test-mail transport.");
  }
  const parsedDbUrl = new URL(databaseUrl);
  if (parsedDbUrl.hostname !== expectedHost || !["127.0.0.1", "localhost"].includes(expectedHost)) {
    throw new Error("Unexpected PostgreSQL host; refusing to connect.");
  }

  db = new Pool({ connectionString: databaseUrl });
  const identity = await db.query("SELECT current_database() AS database_name");
  const marker = await db.query(
    "SELECT database_name,classification FROM public.flowpoint_test_database_guard WHERE purpose='addon-cert'",
  );
  if (
    identity.rows[0]?.database_name !== expectedDb ||
    marker.rows.length !== 1 ||
    marker.rows[0].database_name !== expectedDb ||
    marker.rows[0].classification !== "disposable"
  ) throw new Error("Disposable database attestation failed; refusing to seed.");

  await db.query(
    `INSERT INTO users (id,email,status,email_verified,auth_provider)
     VALUES ($1::uuid,$2,'active',true,'magic_link'),($3::uuid,$4,'active',true,'magic_link')`,
    [userA, emailA, userB, emailB],
  );
  await db.query(
    `INSERT INTO organizations
      (id,name,slug,owner_user_id,status,plan,subscription_status,trial_ends_at,trial_consumed_at)
     VALUES
      ($1::uuid,'Behavior certification A',$2,$3,'active','ultra','trialing',NOW()+INTERVAL '14 days',NOW()),
      ($4::uuid,'Behavior certification B',$5,$6,'active','standard','trialing',NOW()+INTERVAL '14 days',NOW())`,
    [orgA, `behavior-cert-a-${orgA}`, userA, orgB, `behavior-cert-b-${orgB}`, userB],
  );
  await db.query(
    `INSERT INTO organization_members (id,organization_id,user_id,role,status,joined_at)
     VALUES (gen_random_uuid(),$1::uuid,$2::uuid,'owner','active',NOW()),
            (gen_random_uuid(),$3::uuid,$4::uuid,'owner','active',NOW())`,
    [orgA, userA, orgB, userB],
  );
  await db.query(
    `INSERT INTO org_addons (id,org_id,addon_key,active,quantity,activated_at)
     VALUES ($1,$2,'behavioralAI',true,1,NOW())`,
    [`cert-${orgA}-behavioralAI`, orgA],
  );

  await db.query(
    `INSERT INTO behavior_site_tokens (token_hash,site_url,org_id,created_at)
     VALUES ($1,$2,$3,NOW())`,
    [createHash("sha256").update("foreign-fixture-token").digest("hex"), siteB, orgB],
  );
  await db.query(
    `INSERT INTO behavior_events (id,org_id,session_id,site_url,page,event_type,metadata,created_at)
     VALUES ($1,$2,'foreign-session',$3,'/foreign','page_view','{}'::jsonb,NOW())`,
    [randomUUID(), orgB, siteB],
  );
});

test.afterAll(async () => {
  if (!db) return;
  try {
    for (const orgId of [orgA, orgB]) {
      await db.query("DELETE FROM behavior_events WHERE org_id=$1", [orgId]).catch(() => {});
      await db.query("DELETE FROM behavior_sessions WHERE org_id=$1", [orgId]).catch(() => {});
      await db.query("DELETE FROM behavior_insights WHERE org_id=$1", [orgId]).catch(() => {});
      await db.query("DELETE FROM behavior_site_tokens WHERE org_id=$1", [orgId]).catch(() => {});
      await db.query("DELETE FROM ai_alerts WHERE org_id::text=$1", [orgId]).catch(() => {});
      await db.query("DELETE FROM ai_monthly_usage WHERE org_id::text=$1", [orgId]).catch(() => {});
      await db.query("DELETE FROM org_addons WHERE org_id=$1", [orgId]).catch(() => {});
      await db.query("DELETE FROM organization_members WHERE organization_id::text=$1", [orgId]).catch(() => {});
      await db.query("DELETE FROM organizations WHERE id=$1::uuid", [orgId]).catch(() => {});
    }
    for (const email of [emailA, emailB]) {
      await db.query("DELETE FROM magic_link_tokens WHERE lower(email)=lower($1)", [email]).catch(() => {});
    }
    const columns = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='user_sessions'",
    ).catch(() => ({ rows: [] }));
    const names = new Set(columns.rows.map(row => row.column_name));
    for (const userId of [userA, userB]) {
      if (names.has("user_id_v2")) {
        await db.query("DELETE FROM user_sessions WHERE user_id_v2::text=$1", [userId]).catch(() => {});
      } else if (names.has("user_id")) {
        await db.query("DELETE FROM user_sessions WHERE user_id::text=$1", [userId]).catch(() => {});
      }
      await db.query("DELETE FROM users WHERE id=$1::uuid", [userId]).catch(() => {});
    }
  } finally {
    await db.end();
  }
});

test("Behavioral AI collects, persists, isolates, and displays visitor behavior", async ({ page }) => {
  await signIn(page, emailA);

  const me = await page.request.get("/api/me");
  expect(me.status()).toBe(200);
  expect((await me.json()).addons?.behavioralAI).toBeTruthy();

  const snippetResponse = await page.request.get(
    `/api/behavioral/snippet?siteUrl=${encodeURIComponent(siteA)}`,
  );
  expect(snippetResponse.status()).toBe(200);
  const snippet = (await snippetResponse.json()).snippet;
  const siteToken = snippet.match(/,\s*'([a-f0-9]{64})'\);/i)?.[1];
  expect(siteToken).toBeTruthy();

  const ts = Date.now();
  const nonce = randomUUID();
  const signature = createHmac("sha256", siteToken)
    .update(`${siteA}|${siteA}|${ts}|${nonce}`)
    .digest("hex");
  const tokenResponse = await page.request.post("/api/behavioral/token", {
    headers: publicHeaders(),
    data: { siteKey: siteA, siteToken, ts, nonce, sig: signature },
  });
  expect(tokenResponse.status()).toBe(200);
  const { sessionToken } = await tokenResponse.json();
  expect(sessionToken).toBeTruthy();

  const sessionResponse = await page.request.post("/api/behavioral/session", {
    headers: publicHeaders(),
    data: {
      id: sessionId,
      siteUrl: siteA,
      deviceType: "mobile",
      sessionToken,
      ts: Date.now(),
      nonce: randomUUID(),
    },
  });
  expect(sessionResponse.status()).toBe(201);

  await postSessionEvent(page, sessionToken, "page_view", "/pricing");
  await new Promise(resolve => setTimeout(resolve, 60));
  await postSessionEvent(page, sessionToken, "rage_click", "/pricing");
  await new Promise(resolve => setTimeout(resolve, 60));
  await postSessionEvent(page, sessionToken, "form_submit", "/contact");

  const status = await page.request.get(
    `/api/behavioral/status?siteUrl=${encodeURIComponent(siteA)}`,
  );
  expect(status.status()).toBe(200);
  expect((await status.json()).totalEvents).toBe(3);

  const insightsResponse = await page.request.get(
    `/api/behavioral/insights?siteUrl=${encodeURIComponent(siteA)}&periodDays=30`,
  );
  expect(insightsResponse.status()).toBe(200);
  const insights = await insightsResponse.json();
  expect(insights.analysis.sessionsWithPageView).toBe(1);
  expect(insights.analysis.sessionsWithFormSubmit).toBe(1);
  expect(insights.analysis.friction.some(item => item.page === "/pricing")).toBe(true);

  const foreignSite = await page.request.get(
    `/api/behavioral/insights?siteUrl=${encodeURIComponent(siteB)}&periodDays=30`,
  );
  expect(foreignSite.status()).toBe(404);

  await page.evaluate(siteUrl => {
    window.STATE.siteUrl = siteUrl;
  }, siteA);
  await page.locator('.fp-nav-item[data-route="data-explorer"]').click();
  await page.getByText("User Behavior Lab", { exact: true }).click();
  await page.evaluate(async siteUrl => {
    await window.FP_BEHAVIORAL_API.load(siteUrl, 30);
    window.render();
  }, siteA);
  await expect(page.locator("#fp-behavior-funnel-steps")).toBeVisible();
  await page.locator("#fp-behavior-funnel-steps").fill("page_view:/pricing, form_submit:/contact");
  const funnelResponsePromise = page.waitForResponse(response =>
    response.url().includes("/api/behavioral/funnels/analyze") &&
    response.request().method() === "POST",
  );
  await page.locator("#fp-behavior-funnel-steps").locator("xpath=..").locator("button[type=submit]").click();
  const funnelResponse = await funnelResponsePromise;
  expect(funnelResponse.status()).toBe(200);
  const funnel = await funnelResponse.json();
  expect(funnel.steps.map(step => step.sessions)).toEqual([1, 1]);
  await page.waitForFunction(() =>
    window.FP_DATA?.behavioral?.customFunnel?.steps?.length === 2,
  );

  for (let index = 0; index < 10; index += 1) {
    await postSessionEvent(page, sessionToken, "rage_click", "/pricing");
  }
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  await db.query(
    `INSERT INTO ai_monthly_usage
       (id,org_id,month,credits_used,cost_eur,request_count,tokens_used,reset_at,updated_at)
     VALUES ($1,$2,$3,1000000000,0,1,0,NOW(),NOW())
     ON CONFLICT (org_id,month) DO UPDATE
       SET credits_used=EXCLUDED.credits_used,
           cost_eur=EXCLUDED.cost_eur,
           request_count=EXCLUDED.request_count,
           tokens_used=EXCLUDED.tokens_used,
           reset_at=EXCLUDED.reset_at,
           updated_at=EXCLUDED.updated_at`,
    [`cert-amu-${orgA}-${month}`, orgA, month],
  );
  await page.evaluate(async siteUrl => {
    await window.FP_BEHAVIORAL_API.load(siteUrl, 30);
    window.render();
  }, siteA);
  const generateResponsePromise = page.waitForResponse(response =>
    response.url().includes("/api/behavioral/generate-insights") &&
    response.request().method() === "POST",
  );
  const refreshedInsightsResponsePromise = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/behavioral/insights" &&
      url.searchParams.get("siteUrl") === siteA &&
      url.searchParams.get("periodDays") === "30" &&
      response.request().method() === "GET";
  });
  await expect(page.getByText("11 rage clicks détectés", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Générer" }).click();
  const generateResponse = await generateResponsePromise;
  expect(generateResponse.status()).toBe(200);
  expect(await generateResponse.json()).toMatchObject({
    ok: true,
    aiGenerated: false,
    count: 1,
  });
  const refreshedInsightsResponse = await refreshedInsightsResponsePromise;
  expect(refreshedInsightsResponse.status()).toBe(200);
  const refreshedInsights = await refreshedInsightsResponse.json();
  expect(refreshedInsights.insights.some(item => item.title === "11 rage clicks détectés")).toBe(true);
  await expect(page.getByText("11 rage clicks détectés", { exact: true })).toBeVisible();
  const persistedInsightsResponse = await page.request.get(
    `/api/behavioral/insights?siteUrl=${encodeURIComponent(siteA)}&periodDays=30&_cert=${randomUUID()}`,
  );
  expect(persistedInsightsResponse.status()).toBe(200);
  const persistedInsights = await persistedInsightsResponse.json();
  expect(persistedInsights.insights.some(item => item.title === "11 rage clicks détectés")).toBe(true);
  const quotaAlert = await db.query(
    "SELECT count(*)::int AS count FROM ai_alerts WHERE org_id::text=$1 AND alert_type='quota_100pct'",
    [orgA],
  );
  expect(quotaAlert.rows[0]?.count).toBeGreaterThan(0);

  await signIn(page, emailB);
  const denied = await page.request.get(
    `/api/behavioral/insights?siteUrl=${encodeURIComponent(siteA)}&periodDays=30`,
  );
  expect([402, 403]).toContain(denied.status());
});
