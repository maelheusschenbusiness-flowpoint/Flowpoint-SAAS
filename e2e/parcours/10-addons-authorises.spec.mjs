import { createRequire } from "node:module";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { test, expect } from "@playwright/test";
import {
  getAddonCertDatabaseConfig,
  getLocalAddonCertDatabaseConfig,
} from "../../artifacts/api-server/tools/addon-cert-db-guard.mjs";

const apiRequire = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
const { Pool } = apiRequire("pg");
const Stripe = apiRequire("stripe");
const addonKeys = [
  "agencyPacks",
  "globalMonitoring",
  "aiExecutiveReport",
  "aiWorkspaceLaunch",
  "abTestingAI",
  "aiContentStrategist",
  "gbpPerformanceLeads",
  "localPresenceOptimizer",
  "localLandingOpportunities",
  "seoChangeImpact",
  "agencyPortfolioPriorities",
  "technicalSeoFixVerification",
  "organicCampaignTracker",
];
const databaseUrl = process.env["FLOWPOINT_ADDON_CERT_DATABASE_URL"];
const expectedDb = process.env["FLOWPOINT_ADDON_CERT_EXPECTED_DB"];
const expectedHost = process.env["FLOWPOINT_ADDON_CERT_EXPECTED_HOST"];
const mailDir = process.env["TEST_MAIL_DIR"];
const email = `addon-cert-${randomUUID()}@flowpoint-internal.test`;
const userId = randomUUID();
const readerEmail = `addon-cert-viewer-${randomUUID()}@flowpoint-internal.test`;
const readerUserId = randomUUID();
const orgA = randomUUID();
const orgB = randomUUID();
const sessionA = `e2e-awl-${randomUUID()}`;
const profileA = `e2e-awl-${randomUUID()}`;
const missionA = `e2e-awl-${randomUUID()}`;
const gbpLocationA = `e2e-gbp-${randomUUID()}`;
const gbpLocationB = `e2e-gbp-${randomUUID()}`;
const experimentA = randomUUID();
const experimentB = randomUUID();
const auditBeforeA = randomUUID();
const auditAfterA = randomUUID();
const auditForeignB = randomUUID();
const siteA = "https://addon-a.qa-fixture.invalid";
const siteB = "https://addon-b.qa-fixture.invalid";
const pageA = "/pricing";
let db;

async function findStripeEvent(stripe, type, objectId) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const events = await stripe.events.list({ type, limit: 100 });
    const match = events.data.find(event => event.data?.object?.id === objectId);
    if (match) return match;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Stripe TEST event was not found: ${type}`);
}

async function postSignedStripeEvent(page, event, secret, signatureOverride) {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signatureOverride ?? createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`, "utf8")
    .digest("hex");
  return page.request.post("/api/webhooks/stripe", {
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${timestamp},v1=${signature}`,
    },
    data: payload,
  });
}

test.beforeAll(async () => {
  if (!databaseUrl || !expectedDb || !expectedHost || !mailDir || !process.env["ENABLE_TEST_MAILER"]) {
    throw new Error("Certification requires an attested disposable database and isolated test-mail transport.");
  }
  const localOnly = process.env["FLOWPOINT_ADDON_CERT_LOCAL_ONLY"] === "1";
  const certConfig = localOnly
    ? getLocalAddonCertDatabaseConfig()
    : getAddonCertDatabaseConfig();
  if (localOnly) {
    const e2eUrl = new URL(process.env["E2E_BASE_URL"] ?? "");
    if (e2eUrl.protocol !== "http:" || e2eUrl.hostname !== "127.0.0.1") {
      throw new Error("Refusing local certification: E2E_BASE_URL must use local HTTP on 127.0.0.1.");
    }
  }
  if (certConfig.expectedDatabase !== expectedDb) throw new Error("Unexpected certification database name.");
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
  ) throw new Error("Disposable-database attestation failed; refusing to seed.");

  await db.query(
    `INSERT INTO users (id,email,status,email_verified,auth_provider)
     VALUES ($1::uuid,$2,'active',true,'magic_link'),
            ($3::uuid,$4,'active',true,'magic_link')`,
    [userId, email, readerUserId, readerEmail],
  );
  await db.query(
    `INSERT INTO organizations
      (id,name,slug,owner_user_id,status,plan,subscription_status,trial_ends_at,trial_consumed_at)
     VALUES ($1::uuid,'Addon certification A',$2,$3,'active','standard','trialing',NOW()+INTERVAL '14 days',NOW()),
            ($4::uuid,'Addon certification B',$5,$6,'active','standard','trialing',NOW()+INTERVAL '14 days',NOW())`,
    [orgA, `addon-cert-a-${orgA}`, userId, orgB, `addon-cert-b-${orgB}`, randomUUID()],
  );
  await db.query(
    `INSERT INTO organization_members (id,organization_id,user_id,role,status,joined_at)
     VALUES (gen_random_uuid(),$1::uuid,$2::uuid,'owner','active',NOW()),
            (gen_random_uuid(),$1::uuid,$3::uuid,'viewer','active',NOW())`,
    [orgA, userId, readerUserId],
  );
  await db.query(
    `INSERT INTO user_prefs (org_id,settings)
     VALUES ($1,$2::jsonb)`,
    [orgA, JSON.stringify({ onboardingCompletedAt: new Date().toISOString() })],
  );
  for (const key of addonKeys) {
    await db.query(
      `INSERT INTO org_addons (id,org_id,addon_key,active,quantity,activated_at)
       VALUES ($1,$2,$3,true,1,NOW())`,
      [`cert-${orgA}-${key}`, orgA, key],
    );
  }

  await db.query(
    `INSERT INTO onboarding_sessions (id,org_id,user_id,status,site_url,business_name,metadata)
     VALUES ($1,$2,$3,'completed',$4,'Synthetic workspace','{}'::jsonb)`,
    [sessionA, orgA, userId, siteA],
  );
  await db.query(
    `INSERT INTO ai_workspace_profiles
      (id,org_id,session_id,business_name,generated_roadmap,generated_strategy,seo_score)
     VALUES ($1,$2,$3,'Synthetic workspace',$4::jsonb,'Synthetic strategy',73)`,
    [profileA, orgA, sessionA, JSON.stringify([{ priority: 1, label: "Fixture mission roadmap", title: "Fixture mission roadmap" }])],
  );
  await db.query(
    `INSERT INTO ai_generated_missions (id,org_id,profile_id,title,category,priority)
     VALUES ($1,$2,$3,'Synthetic persisted mission','seo',1)`,
    [missionA, orgA, profileA],
  );
  await db.query(
    `INSERT INTO google_locations (id,org_id,location_id,name,raw_data)
     VALUES ($1,$2,'locations/e2e-a','Synthetic GBP location A',$3::jsonb),
            ($4,$5,'locations/e2e-b','Foreign GBP location B','{"name":"locations/e2e-b"}'::jsonb)`,
    [
      gbpLocationA,
      orgA,
      JSON.stringify({
        name: "locations/e2e-a",
        title: "Synthetic Dentist",
        primaryCategory: { displayName: "Dentist" },
        websiteUri: "https://addon-a.qa-fixture.invalid",
        regularHours: { periods: [{ openDay: "MONDAY" }] },
        profile: { description: "Synthetic business profile for certification." },
      }),
      gbpLocationB,
      orgB,
    ],
  );
  await db.query(
    `INSERT INTO gsc_keyword_data (id,org_id,keyword,date,impressions,clicks,ctr,position)
     VALUES ($1,$2,'dentiste urgence Bruxelles',to_char(CURRENT_DATE - INTERVAL '2 days','YYYY-MM-DD'),120,12,0.1,8),
            ($3,$4,'dentiste urgence Bruxelles',to_char(CURRENT_DATE - INTERVAL '2 days','YYYY-MM-DD'),999,99,0.099,7)`,
    [randomUUID(), orgA, randomUUID(), orgB],
  );

  for (const [orgId, page, daysAgo, clicks, position] of [
    [orgA, "https://addon-a.qa-fixture.invalid/decay", 40, 100, 4],
    [orgA, "https://addon-a.qa-fixture.invalid/decay", 5, 50, 8],
    [orgB, "https://addon-b.qa-fixture.invalid/foreign", 5, 999, 1],
  ]) {
    await db.query(
      `INSERT INTO gsc_page_data (id,org_id,page,date,clicks,impressions,position)
       VALUES ($1,$2,$3,to_char(CURRENT_DATE-($4::int*INTERVAL '1 day'),'YYYY-MM-DD'),$5,1000,$6)`,
      [randomUUID(), orgId, page, daysAgo, clicks, position],
    );
  }

  for (const [id, orgId, site, page] of [
    [experimentA, orgA, siteA, pageA],
    [experimentB, orgB, siteB, "/foreign"],
  ]) {
    await db.query(
      `INSERT INTO cro_experiments (id,org_id,site_url,page,name,variant_a,variant_b,status)
       VALUES ($1,$2,$3,$4,'Synthetic experiment','{"label":"A"}'::jsonb,'{"label":"B"}'::jsonb,'running')`,
      [id, orgId, site, page],
    );
  }
  for (const [orgId, experimentId, variant, eventType, sessionId, site, page] of [
    [orgA, experimentA, "A", "experiment_exposure", "a-1", siteA, pageA],
    [orgA, experimentA, "A", "experiment_conversion", "a-1", siteA, pageA],
    [orgA, experimentA, "B", "experiment_exposure", "b-1", siteA, pageA],
    [orgB, experimentB, "B", "experiment_exposure", "foreign-1", siteB, "/foreign"],
  ]) {
    await db.query(
      `INSERT INTO behavior_events (id,org_id,session_id,site_url,page,event_type,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [randomUUID(), orgId, sessionId, site, page, eventType, JSON.stringify({ experimentId, variant })],
    );
  }

  await db.query(
    `INSERT INTO audits (id,org_id,url,score,issues,speed,status,created_at)
     VALUES ($1,$2,$3,58,10,42,'ok',NOW()-INTERVAL '12 days'),
            ($4,$2,$3,78,4,76,'ok',NOW()-INTERVAL '2 days'),
            ($5,$6,$7,31,18,28,'warn',NOW()-INTERVAL '1 day')`,
    [auditBeforeA, orgA, `${siteA}/services/dentist`, auditAfterA, auditForeignB, orgB, `${siteB}/foreign`],
  );
});

test.afterAll(async () => {
  if (!db) return;
  for (const orgId of [orgA, orgB]) {
    await db.query("DELETE FROM organic_campaign_goals WHERE org_id=$1", [orgId]);
    await db.query("DELETE FROM technical_seo_fix_verifications WHERE org_id=$1", [orgId]);
    await db.query("DELETE FROM agency_portfolio_priority_settings WHERE org_id=$1", [orgId]);
    await db.query("DELETE FROM seo_change_impact_settings WHERE org_id=$1", [orgId]);
    await db.query("DELETE FROM conversion_opportunity_settings WHERE org_id=$1", [orgId]);
    await db.query("DELETE FROM behavior_events WHERE org_id=$1", [orgId]);
    await db.query("DELETE FROM cro_experiments WHERE org_id=$1", [orgId]);
    await db.query("DELETE FROM gsc_page_data WHERE org_id=$1", [orgId]);
    await db.query("DELETE FROM gsc_keyword_data WHERE org_id=$1", [orgId]);
    await db.query("DELETE FROM gbp_performance_settings WHERE org_id=$1", [orgId]);
    await db.query("DELETE FROM google_locations WHERE org_id=$1", [orgId]);
    await db.query("DELETE FROM user_prefs WHERE org_id=$1", [orgId]);
    await db.query("DELETE FROM ai_generated_missions WHERE org_id=$1", [orgId]);
    await db.query("DELETE FROM ai_workspace_profiles WHERE org_id=$1", [orgId]);
    await db.query("DELETE FROM onboarding_sessions WHERE org_id=$1", [orgId]);
    await db.query("DELETE FROM reports WHERE org_id=$1", [orgId]);
    await db.query("DELETE FROM audits WHERE org_id=$1", [orgId]);
    await db.query("DELETE FROM org_addons WHERE org_id=$1", [orgId]);
    await db.query("DELETE FROM organization_members WHERE organization_id::text=$1", [orgId]);
    await db.query("DELETE FROM organizations WHERE id=$1::uuid", [orgId]);
  }
  await db.query("DELETE FROM magic_link_tokens WHERE lower(email)=ANY($1::text[])", [[email, readerEmail]]);
  const sessionColumns = await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='user_sessions'",
  );
  const sessionColumnNames = new Set(sessionColumns.rows.map(row => row.column_name));
  if (sessionColumnNames.has("user_id_v2")) {
    await db.query("DELETE FROM user_sessions WHERE user_id_v2::text=ANY($1::text[])", [[userId, readerUserId]]);
  }
  if (sessionColumnNames.has("user_id")) {
    await db.query("DELETE FROM user_sessions WHERE user_id::text=ANY($1::text[])", [[userId, readerUserId]]);
  }
  await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[userId, readerUserId]]);
  await db.end();
});

test("authentifie normalement et certifie les add-ons historiques avec des données synthétiques tenant-isolées", async ({ page }) => {
  const login = await page.request.post("/api/auth/login-request", { data: { email } });
  expect(login.ok()).toBe(true);
  const loginBody = await login.json();
  expect(loginBody.debugLink).toBeTruthy();

  const captured = readdirSync(mailDir).filter(name => name.endsWith(".json"));
  expect(captured).toHaveLength(1);
  const capturedMessage = JSON.parse(readFileSync(`${mailDir}/${captured[0]}`, "utf8"));
  expect(capturedMessage.to).toBe(email);
  expect(capturedMessage.token).toBeTruthy();

  await page.goto(loginBody.debugLink);
  await page.waitForURL(/dashboard\.html/, { timeout: 20_000 });
  await page.waitForSelector('[data-route="overview"]', { timeout: 20_000 });
  const meResponse = await page.request.get("/api/me");
  expect(meResponse.status()).toBe(200);
  const me = await meResponse.json();
  for (const key of addonKeys) expect(me.addons?.[key]).toBeTruthy();

  const packs = await page.request.post("/api/reports/agency-packs/generate", {
    data: { clientName: "Synthetic agency customer", auditId: auditAfterA, dateStart: "2026-10-01", dateEnd: "2026-10-22" },
  });
  expect(packs.status()).toBe(201);
  const pack = await packs.json();
  expect(pack.verifiedCount).toBe(3);
  const persistedReports = await page.request.get("/api/reports");
  expect(persistedReports.status()).toBe(200);
  const agencyReports = (await persistedReports.json()).filter(row =>
    row.org_id === orgA && row.name.includes("Synthetic agency customer")
  );
  expect(agencyReports).toHaveLength(3);
  expect(agencyReports.map(row => row.template_key).sort()).toEqual(["executive", "local", "seo"]);
  expect(agencyReports.every(row => row.audit_id === auditAfterA)).toBe(true);
  const pdf = await page.request.get(`/api/reports/${pack.reports[0].id}/download`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");

  const workspace = await page.request.get(`/api/ai-workspace-launch/${sessionA}`);
  expect(workspace.status()).toBe(200);
  const workspaceBody = await workspace.json();
  expect(workspaceBody.missions?.map(row => row.id)).toContain(missionA);

  const experiments = await page.request.get(`/api/ab-testing/experiments?siteUrl=${encodeURIComponent(siteA)}`);
  expect(experiments.status()).toBe(200);
  const experimentRows = (await experiments.json()).experiments;
  expect(experimentRows.map(row => row.id)).toEqual([experimentA]);
  expect(experimentRows[0].measurements).toEqual({
    A: { exposures: 1, conversions: 1 },
    B: { exposures: 1, conversions: 0 },
  });

  const decay = await page.request.get("/api/keywords/content-decay");
  expect(decay.status()).toBe(200);
  const decayPages = (await decay.json()).opportunities.map(row => row.page);
  expect(decayPages).toContain("https://addon-a.qa-fixture.invalid/decay");
  expect(decayPages).not.toContain("https://addon-b.qa-fixture.invalid/foreign");
});

async function signInToDashboard(page) {
  const login = await page.request.post("/api/auth/login-request", { data: { email } });
  expect(login.ok()).toBe(true);
  const loginBody = await login.json();
  expect(loginBody.debugLink).toBeTruthy();
  await page.goto(loginBody.debugLink);
  await page.waitForURL(/dashboard\.html/, { timeout: 20_000 });
  await page.waitForSelector('[data-route="overview"]', { timeout: 20_000 });
  await page.waitForFunction(() => typeof window.navigate === "function");
  const meResponse = await page.request.get("/api/me");
  expect(meResponse.status()).toBe(200);
  const me = await meResponse.json();
  expect(me.addons?.gbpPerformanceLeads).toBe(true);
  expect(me.addons?.localPresenceOptimizer).toBe(true);
  expect(me.addons?.localLandingOpportunities).toBe(true);
  for (const key of [
    "seoChangeImpact",
    "agencyPortfolioPriorities",
    "technicalSeoFixVerification",
    "organicCampaignTracker",
  ]) expect(me.addons?.[key]).toBe(true);
  await page.waitForFunction(
    () => Boolean(window.STATE?.me?.orgId && window.STATE?.me?.userId),
    null,
    { timeout: 20_000 },
  );
  await page.evaluate(() => window.navigate("overview"));
  await page.waitForFunction(() => window.STATE?.route === "overview", null, { timeout: 20_000 });
  await page.waitForFunction(
    () => Boolean(window.FP_DATA?.gbpPerformance || window.FP_DATA?.gbpPerformanceError),
    null,
    { timeout: 20_000 },
  );
  await page.waitForFunction(() => window.STATE?.loading === false, null, { timeout: 20_000 });
  await page.waitForFunction(
    () => window.STATE?.dataLoadComplete === true && window.STATE?.reportsLoaded === true,
    null,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    ({ orgId, userId }) =>
      localStorage.getItem("fp:last-account-id") === `${orgId}|${userId}`,
    { orgId: me.orgId, userId: me.userId },
    { timeout: 30_000 },
  );
  return me;
}

test("Agency Reporting Packs quota is atomic and viewer access is denied", async ({ page }) => {
  await signInToDashboard(page);

  await db.query("DELETE FROM reports WHERE org_id=$1", [orgA]);
  await page.evaluate(() => window.navigate("reports"));
  await page.waitForFunction(() => window.STATE?.route === "reports", null, { timeout: 20_000 });
  const card = page.locator("section.fp-card").filter({ has: page.locator("#fp-agency-packs-result") });
  const loadPacksButton = card.getByRole("button", { name: /Charger les packs|Actualiser les packs|Load packs/i });
  await expect(loadPacksButton).toBeVisible();
  expect(await page.evaluate(() => typeof window.FP_V1_ADDON_PANELS?.loadAgencyPacks)).toBe("function");
  const packsResponsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/reports/agency-packs" &&
    response.request().method() === "GET",
    { timeout: 15_000 },
  );
  await loadPacksButton.evaluate(button => button.click());
  const packsResponse = await packsResponsePromise;
  expect(packsResponse.status()).toBe(200);
  const loadedPacks = await packsResponse.json();
  expect(loadedPacks.audits.map(audit => String(audit.id))).toContain(auditAfterA);
  const result = page.locator("#fp-agency-packs-result");
  await result.locator('input[type="text"]').fill("Quota baseline customer");
  await result.locator("select").selectOption(auditAfterA);
  const refreshResponsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/reports" &&
    response.request().method() === "GET",
    { timeout: 15_000 },
  );
  await page.evaluate(() => window._fpReportsAPI.load({ force: true }));
  expect((await refreshResponsePromise).status()).toBe(200);
  await expect(result.locator('input[type="text"]')).toHaveValue("Quota baseline customer");
  await expect(result.locator("select")).toHaveValue(auditAfterA);
  const createButton = result.locator("button.fp-btn-primary").first();
  const formState = await result.evaluate(element => ({
    buttons: Array.from(element.querySelectorAll("button")).map(button => ({
      text: button.textContent?.trim(),
      disabled: button.disabled,
    })),
  }));
  expect(formState.buttons[0]).toMatchObject({
    text: expect.stringMatching(/Créer le pack complet|Create complete pack/i),
    disabled: false,
  });
  const baselineResponsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/reports/agency-packs/generate" &&
    response.request().method() === "POST",
  );
  await createButton.click();
  const baselineResponse = await baselineResponsePromise;
  expect(baselineResponse.status()).toBe(201);
  const baselineBundle = await baselineResponse.json();
  expect(baselineBundle.verifiedCount).toBe(3);
  expect(baselineBundle.reports).toHaveLength(3);
  expect(new Set(baselineBundle.reports.map(report => report.template_key))).toEqual(
    new Set(["executive", "seo", "local"]),
  );
  await expect(page.locator("#fp-toast-container .fp-toast.success").first())
    .toContainText(/Pack créé|Pack created/i);
  const persistedBaseline = await db.query(
    `SELECT id,template_key,audit_id FROM reports
      WHERE org_id=$1 AND name LIKE 'Quota baseline customer%'`,
    [orgA],
  );
  expect(persistedBaseline.rows).toHaveLength(3);
  expect(persistedBaseline.rows.map(row => row.audit_id)).toEqual([auditAfterA, auditAfterA, auditAfterA]);
  expect(new Set(persistedBaseline.rows.map(row => row.template_key))).toEqual(
    new Set(["executive", "seo", "local"]),
  );
  expect(new Set(persistedBaseline.rows.map(row => row.id))).toEqual(
    new Set(baselineBundle.reports.map(report => report.id)),
  );
  await expect(result.locator('input[type="text"]')).toBeVisible({ timeout: 5_000 });

  const beforeQuota = await db.query(
    "SELECT COUNT(*)::int AS count FROM reports WHERE org_id=$1 AND created_at > date_trunc('month',now())",
    [orgA],
  );
  expect(Number(beforeQuota.rows[0]?.count)).toBe(3);

  const quotaPrefix = `QA quota fixture ${randomUUID()}`;
  await db.query(
    `INSERT INTO reports
       (id,org_id,name,type,template_key,date,pages,shared,audit_id,white_label,pdf_ready,
        meeting_notes_json,date_start,date_end,created_by)
     SELECT 'r_quota_' || gen_random_uuid()::text,$1,$2 || ' ' || n,'PDF','executive',
            NOW()::text,0,false,$3,false,true,'[]','','',$4
       FROM generate_series(1,25) AS n`,
    [orgA, quotaPrefix, auditAfterA, userId],
  );

  try {
    const atQuota = await db.query(
      "SELECT COUNT(*)::int AS count FROM reports WHERE org_id=$1 AND created_at > date_trunc('month',now())",
      [orgA],
    );
    expect(Number(atQuota.rows[0]?.count)).toBe(28);

    await result.locator('input[type="text"]').fill("Quota blocked customer");
    await result.locator("select").selectOption(auditAfterA);
    await expect(createButton).toBeEnabled();
    const quotaResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === "/api/reports/agency-packs/generate" &&
      response.request().method() === "POST"
    );
    await createButton.click({ timeout: 5_000 });
    expect((await quotaResponse).status()).toBe(402);
    await expect(page.locator("#fp-toast-container .fp-toast.error").first())
      .toContainText(/could not be created|n’a pas pu être créé/i);
    await expect(createButton).toBeEnabled();
    const quotaReports = await db.query(
      "SELECT COUNT(*)::int AS count FROM reports WHERE org_id=$1 AND name LIKE 'Quota blocked customer%'",
      [orgA],
    );
    expect(Number(quotaReports.rows[0]?.count)).toBe(0);
    const countAfterRejectedPack = await db.query(
      "SELECT COUNT(*)::int AS count FROM reports WHERE org_id=$1 AND created_at > date_trunc('month',now())",
      [orgA],
    );
    expect(Number(countAfterRejectedPack.rows[0]?.count)).toBe(28);
  } finally {
    await db.query("DELETE FROM reports WHERE org_id=$1 AND name LIKE $2", [orgA, `${quotaPrefix}%`]);
  }

  const browser = page.context().browser();
  const viewerContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const viewerPage = await viewerContext.newPage();
  try {
    const login = await viewerPage.request.post("/api/auth/login-request", { data: { email: readerEmail } });
    expect(login.ok()).toBe(true);
    const loginBody = await login.json();
    expect(loginBody.debugLink).toBeTruthy();
    const capturedMessages = readdirSync(mailDir)
      .filter(name => name.endsWith(".json"))
      .map(name => JSON.parse(readFileSync(`${mailDir}/${name}`, "utf8")));
    expect(capturedMessages.some(message => message.to === readerEmail && message.token)).toBe(true);

    await viewerPage.goto(loginBody.debugLink);
    await viewerPage.waitForURL(/dashboard\.html/, { timeout: 20_000 });
    await viewerPage.waitForSelector('[data-route="overview"]', { timeout: 20_000 });
    const viewerMe = await viewerPage.request.get("/api/me");
    expect(viewerMe.status()).toBe(200);
    const viewerData = await viewerMe.json();
    expect(viewerData.addons?.agencyPacks).toBe(true);

    const denied = await viewerPage.request.post("/api/reports/agency-packs/generate", {
      data: { clientName: "Viewer blocked customer", auditId: auditAfterA },
    });
    expect(denied.status()).toBe(403);
    const viewerReports = await db.query(
      "SELECT COUNT(*)::int AS count FROM reports WHERE org_id=$1 AND name LIKE 'Viewer blocked customer%'",
      [orgA],
    );
    expect(Number(viewerReports.rows[0]?.count)).toBe(0);
  } finally {
    await viewerContext.close();
  }
});

test("Agency Reporting Packs enforce the report quota atomically and deny viewers — Stripe TEST lifecycle", async ({ page }) => {
  test.setTimeout(150_000);
  if (process.env["FLOWPOINT_AGENCY_PACKS_STRIPE_TEST"] !== "1") {
    test.skip(true, "Requires the explicit --stripe-test runner option.");
  }

  const stripeKey = process.env["STRIPE_TEST_KEY"];
  const priceId = process.env["STRIPE_TEST_PRICE_ID_ADDON_AGENCY_PACKS"];
  expect(stripeKey).toMatch(/^sk_test_/);
  expect(priceId).toMatch(/^price_/);

  const stripe = new Stripe(stripeKey);
  const price = await stripe.prices.retrieve(priceId);
  expect(price.livemode).toBe(false);
  expect(price.active).toBe(true);
  expect(price.currency).toBe("eur");
  expect(price.unit_amount).toBe(1200);
  expect(price.recurring?.interval).toBe("month");

  let testClock;
  let customer;
  let addonSubscriptionId;
  try {
    const frozenTime = Math.floor(Date.now() / 1000) - 60;
    testClock = await stripe.testHelpers.testClocks.create({ frozen_time: frozenTime });
    customer = await stripe.customers.create({
      email,
      test_clock: testClock.id,
      metadata: { flowpoint_addon_cert: "agencyPacks", orgId: orgA },
    });
    const paymentMethod = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: paymentMethod.id },
    });

    await db.query(
      `UPDATE organizations
       SET stripe_customer_id=$1, subscription_status='trialing', plan='standard'
       WHERE id=$2::uuid`,
      [customer.id, orgA],
    );
    await db.query("DELETE FROM org_addons WHERE org_id=$1 AND addon_key='agencyPacks'", [orgA]);

    await signInToDashboard(page);
    const activation = await page.request.post("/api/addons/agencyPacks/activate", {
      data: { quantity: 1 },
    });
    expect(activation.status()).toBe(200);
    expect(await activation.json()).toMatchObject({
      ok: true,
      addonKey: "agencyPacks",
      stripe: { synced: true },
    });

    const entitlementAfterActivation = await db.query(
      "SELECT active FROM org_addons WHERE org_id=$1 AND addon_key='agencyPacks'",
      [orgA],
    );
    expect(entitlementAfterActivation.rows[0]?.active).toBe(true);

    const listed = await stripe.subscriptions.list({
      customer: customer.id,
      status: "all",
      limit: 100,
      expand: ["data.items.data.price"],
    });
    const addonSubscription = listed.data.find(
      (subscription) =>
        subscription.metadata?.addonSub === "true" &&
        subscription.metadata?.orgId === orgA,
    );
    expect(addonSubscription).toBeTruthy();
    addonSubscriptionId = addonSubscription.id;
    expect(["active", "trialing"]).toContain(addonSubscription.status);
    expect(
      addonSubscription.items.data.some((item) => item.price.id === priceId),
    ).toBe(true);

    const invoiceSubscriptionId = (invoice) => {
      const reference = invoice.subscription ?? invoice.parent?.subscription_details?.subscription;
      return typeof reference === "string" ? reference : reference?.id;
    };
    const paidInvoicesBefore = await stripe.invoices.list({ customer: customer.id, limit: 100 });
    expect(
      paidInvoicesBefore.data.filter(
        (invoice) => invoice.status === "paid" && invoiceSubscriptionId(invoice) === addonSubscriptionId,
      ).length,
    ).toBeGreaterThanOrEqual(1);

    await stripe.testHelpers.testClocks.advance(testClock.id, {
      frozen_time: frozenTime + 40 * 24 * 60 * 60,
    });
    const deadline = Date.now() + 90_000;
    let clockStatus = "advancing";
    while (Date.now() < deadline && clockStatus !== "ready") {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      testClock = await stripe.testHelpers.testClocks.retrieve(testClock.id);
      clockStatus = testClock.status;
    }
    expect(clockStatus).toBe("ready");

    const renewedSubscription = await stripe.subscriptions.retrieve(addonSubscriptionId);
    expect(renewedSubscription.status).toBe("active");
    const paidInvoicesAfter = await stripe.invoices.list({ customer: customer.id, limit: 100 });
    expect(
      paidInvoicesAfter.data.filter(
        (invoice) => invoice.status === "paid" && invoiceSubscriptionId(invoice) === addonSubscriptionId,
      ).length,
    ).toBeGreaterThanOrEqual(2);

    const deactivation = await page.request.post("/api/addons/agencyPacks/deactivate", { data: {} });
    expect(deactivation.status()).toBe(200);
    expect((await deactivation.json()).stripe).toMatchObject({ synced: true });
    const entitlementAfterCancellation = await db.query(
      "SELECT active FROM org_addons WHERE org_id=$1 AND addon_key='agencyPacks'",
      [orgA],
    );
    expect(entitlementAfterCancellation.rows[0]?.active).toBe(false);
    expect((await stripe.subscriptions.retrieve(addonSubscriptionId)).status).toBe("canceled");
  } finally {
    if (addonSubscriptionId) {
      try {
        await stripe.subscriptions.cancel(addonSubscriptionId);
      } catch {}
    }
    if (customer?.id) {
      try {
        await stripe.customers.del(customer.id);
      } catch {}
    }
    if (testClock?.id) {
      try {
        await stripe.testHelpers.testClocks.del(testClock.id);
      } catch {}
    }
    await db.query(
      "UPDATE organizations SET stripe_customer_id='', subscription_status='trialing' WHERE id=$1::uuid",
      [orgA],
    ).catch(() => {});
    await db.query(
      "DELETE FROM org_addons WHERE org_id=$1 AND addon_key='agencyPacks'",
      [orgA],
    ).catch(() => {});
  }
});

test("Agency checkout CTA completes a new-customer Stripe TEST purchase", async ({ page }) => {
  test.setTimeout(240_000);
  const stripeKey = process.env["STRIPE_TEST_KEY"];
  const standardPriceId = process.env["STRIPE_TEST_PRICE_ID_STANDARD"];
  const agencyPriceId = process.env["STRIPE_TEST_PRICE_ID_ADDON_AGENCY_PACKS"];
  const webhookSecret = process.env["STRIPE_TEST_WEBHOOK_SECRET"];
  expect(stripeKey).toMatch(/^sk_test_/);
  expect(standardPriceId).toMatch(/^price_/);
  expect(agencyPriceId).toMatch(/^price_/);
  expect(webhookSecret).toMatch(/^whsec_/);

  const stripe = new Stripe(stripeKey);
  const [standardPrice, agencyPrice] = await Promise.all([
    stripe.prices.retrieve(standardPriceId),
    stripe.prices.retrieve(agencyPriceId),
  ]);
  expect(standardPrice.livemode).toBe(false);
  expect(agencyPrice.livemode).toBe(false);
  expect(agencyPrice.unit_amount).toBe(1200);
  expect(agencyPrice.currency).toBe("eur");
  expect(agencyPrice.recurring?.interval).toBe("month");

  const signupEmail = `agency-checkout-${randomUUID()}@flowpoint-internal.test`;
  const signupToken = randomBytes(32).toString("hex");
  let customerId;
  let paymentIntentId;
  let failureCustomerId;
  let failurePaymentIntentId;
  let failureEmail;
  const paymentMethodIds = new Set();
  const subscriptionsToClean = new Set();

  await db.query(
    `INSERT INTO pending_signups (token,email,first_name,last_name,company_name,country)
     VALUES ($1,$2,'Checkout','Buyer','Agency QA','BE')`,
    [signupToken, signupEmail],
  );

  try {
    await page.addInitScript((token) => {
      sessionStorage.setItem("fp_pre_reg_token", token);
    }, signupToken);
    await page.goto("/pricing.html");
    await page.evaluate(() => localStorage.removeItem("fp_cart"));
    await page.reload();
    await page.waitForFunction(
      () => Boolean(window._FP_ADDON_CATALOG_STATES?.agencyPacks),
      null,
      { timeout: 20_000 },
    );
    const agencyCard = page.locator('[data-addon-card-key="agencyPacks"]');
    if (!(await agencyCard.isVisible())) await page.locator("#fp-addon-toggle").click();
    const purchaseButton = agencyCard.locator('button[data-addon-action="add"]');
    await expect(purchaseButton).toBeEnabled();
    await purchaseButton.click();
    await expect(purchaseButton).toContainText(/Dans le panier|In cart/);
    await expect.poll(
      () => page.evaluate(() => {
        try {
          return JSON.parse(localStorage.getItem("fp_cart") || "{}").addons?.agencyPacks;
        } catch {
          return undefined;
        }
      }),
    ).toBe(1);

    // Continue as a pre-registered new customer with no signed-in account.
    // The real Agency CTA writes the add-on to the cart before Standard is selected.
    await page.evaluate(() => {
      const cart = JSON.parse(localStorage.getItem("fp_cart") || "{}");
      cart.plan = "standard";
      cart._v = 1;
      cart._updatedAt = Date.now();
      localStorage.setItem("fp_cart", JSON.stringify(cart));
    });

    const quoteResponsePromise = page.waitForResponse(response =>
      response.url().includes("/api/billing/quote") &&
      response.request().method() === "POST",
    );
    await page.goto("/checkout.html?plan=standard");
    const quoteResponse = await quoteResponsePromise;
    expect(quoteResponse.status()).toBe(200);
    const quotePayload = await quoteResponse.json();
    expect(quotePayload.quote.trialEligible).toBe(true);
    expect(quotePayload.quote.trialDays).toBe(14);
    expect(quotePayload.quote.paymentIntentAmountMinor).toBe(1200);
    await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 20_000 });

    const paymentIntentResponsePromise = page.waitForResponse(response =>
      response.url().includes("/api/public/payment-intent") &&
      response.request().method() === "POST",
    );
    await page.locator("#fp-pay-btn").click();
    const paymentIntentResponse = await paymentIntentResponsePromise;
    expect(paymentIntentResponse.status()).toBe(200);
    const paymentIntentPayload = await paymentIntentResponse.json();
    expect(paymentIntentPayload.quote.trialEligible).toBe(true);
    expect(paymentIntentPayload.quote.trialDays).toBe(14);
    expect(paymentIntentPayload.quote.paymentIntentAmountMinor).toBe(1200);
    paymentIntentId = paymentIntentPayload.paymentIntentId;
    expect(paymentIntentId).toMatch(/^pi_/);

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    expect(paymentIntent.livemode).toBe(false);
    expect(paymentIntent.amount).toBe(1200);
    customerId = typeof paymentIntent.customer === "string"
      ? paymentIntent.customer
      : paymentIntent.customer?.id;
    expect(customerId).toMatch(/^cus_/);

    const accountBeforePayment = await db.query(
      `SELECT id FROM organizations WHERE lower(owner_email)=lower($1)`,
      [signupEmail],
    );
    expect(accountBeforePayment.rows).toHaveLength(0);

    const paymentMethod = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" },
    });
    paymentMethodIds.add(paymentMethod.id);
    await stripe.paymentMethods.attach(paymentMethod.id, { customer: customerId });
    const confirmedIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
      payment_method: paymentMethod.id,
    });
    expect(confirmedIntent.status).toBe("succeeded");

    const finalizeResponsePromise = page.waitForResponse(response =>
      response.url().includes("/api/public/finalize-checkout") &&
      response.request().method() === "POST",
    );
    await page.goto(
      `/checkout-return.html?payment_intent=${encodeURIComponent(paymentIntentId)}&redirect_status=succeeded`,
    );
    const finalizeResponse = await finalizeResponsePromise;
    expect(finalizeResponse.status()).toBe(200);
    expect(await finalizeResponse.json()).toMatchObject({ success: true });

    const orgResult = await db.query(
      `SELECT id::text, subscription_status, trial_consumed_at, stripe_customer_id
       FROM organizations WHERE lower(owner_email)=lower($1) LIMIT 1`,
      [signupEmail],
    );
    expect(orgResult.rows).toHaveLength(1);
    const org = orgResult.rows[0];
    expect(org.trial_consumed_at).toBeTruthy();
    expect(org.stripe_customer_id).toBe(customerId);

    const addonGrantBeforeWebhook = await db.query(
      `SELECT active FROM org_addons
       WHERE org_id=$1::uuid AND addon_key='agencyPacks'`,
      [org.id],
    );
    expect(addonGrantBeforeWebhook.rows.some(row => row.active === true)).toBe(false);

    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
      expand: ["data.items.data.price"],
    });
    const planSubscription = subscriptions.data.find(subscription =>
      subscription.metadata?.addonSub !== "true" &&
      subscription.items.data.some(item => item.price.id === standardPriceId),
    );
    const addonSubscription = subscriptions.data.find(subscription =>
      subscription.metadata?.source === "checkout_payment_addons" &&
      subscription.items.data.some(item => item.price.id === agencyPriceId),
    );
    expect(planSubscription).toBeTruthy();
    expect(addonSubscription).toBeTruthy();
    subscriptionsToClean.add(planSubscription.id);
    subscriptionsToClean.add(addonSubscription.id);
    expect(planSubscription.status).toBe("trialing");
    expect(planSubscription.trial_end - paymentIntent.created).toBe(14 * 24 * 60 * 60);
    expect(addonSubscription.status).toBe("trialing");
    expect(addonSubscription.trial_end).toBeGreaterThan(Math.floor(Date.now() / 1000) + 29 * 24 * 60 * 60);
    expect(planSubscription.items.data.some(item => item.price.id === agencyPriceId)).toBe(false);

    // Access is granted only after a verified Stripe event. Deliver the newer
    // add-on subscription event before the older plan/payment events to exercise
    // ordering, signature validation, and replay protection.
    const planSubscriptionEvent = await findStripeEvent(
      stripe,
      "customer.subscription.created",
      planSubscription.id,
    );
    const addonSubscriptionEvent = await findStripeEvent(
      stripe,
      "customer.subscription.created",
      addonSubscription.id,
    );
    const paymentEvent = await findStripeEvent(
      stripe,
      "payment_intent.succeeded",
      paymentIntentId,
    );
    const invalidSignature = await postSignedStripeEvent(
      page,
      paymentEvent,
      webhookSecret,
      "0".repeat(64),
    );
    expect(invalidSignature.status()).toBe(400);

    const outOfOrderDelivery = await postSignedStripeEvent(page, addonSubscriptionEvent, webhookSecret);
    expect(outOfOrderDelivery.status()).toBe(200);
    const addonGrant = await db.query(
      `SELECT active FROM org_addons
       WHERE org_id=$1::uuid AND addon_key='agencyPacks'`,
      [org.id],
    );
    expect(addonGrant.rows[0]?.active).toBe(true);

    const planDelivery = await postSignedStripeEvent(page, planSubscriptionEvent, webhookSecret);
    expect(planDelivery.status()).toBe(200);
    const paymentDelivery = await postSignedStripeEvent(page, paymentEvent, webhookSecret);
    expect(paymentDelivery.status()).toBe(200);
    const replay = await postSignedStripeEvent(page, paymentEvent, webhookSecret);
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toMatchObject({ received: true, duplicate: true });

    // Cancel the TEST subscriptions, then remove local trial markers to prove
    // the email-to-Stripe history check still blocks a former subscriber.
    for (const subscriptionId of subscriptionsToClean) {
      await stripe.subscriptions.cancel(subscriptionId);
    }
    await db.query(
      `UPDATE organizations
       SET stripe_subscription_id='', trial_consumed_at=NULL
       WHERE id=$1::uuid`,
      [org.id],
    );
    await db.query(
      `UPDATE org_settings
       SET stripe_subscription_id='', trial_consumed_at=NULL
       WHERE lower(org_id)=lower($1)`,
      [signupEmail],
    ).catch(() => {});
    const returningToken = randomBytes(32).toString("hex");
    await db.query(
      `INSERT INTO pending_signups (token,email,first_name,last_name,company_name,country)
       VALUES ($1,$2,'Returning','Buyer','Agency QA','BE')`,
      [returningToken, signupEmail],
    );
    const returningQuoteResponse = await page.request.post("/api/billing/quote", {
      data: { plan: "standard", addons: {}, preRegisterToken: returningToken },
    });
    expect(returningQuoteResponse.status()).toBe(200);
    const returningQuote = await returningQuoteResponse.json();
    expect(returningQuote.quote.trialEligible).toBe(false);
    expect(returningQuote.quote.trialDays).toBe(0);

    // A declined TEST card must not create a signup or grant Agency access.
    failureEmail = `agency-failed-${randomUUID()}@flowpoint-internal.test`;
    const failureToken = randomBytes(32).toString("hex");
    await db.query(
      `INSERT INTO pending_signups (token,email,first_name,last_name,company_name,country)
       VALUES ($1,$2,'Failed','Buyer','Agency QA','BE')`,
      [failureToken, failureEmail],
    );
    const failedIntentResponse = await page.request.post("/api/public/payment-intent", {
      data: { plan: "standard", addons: { agencyPacks: 1 }, preRegisterToken: failureToken },
    });
    expect(failedIntentResponse.status()).toBe(200);
    const failedIntentPayload = await failedIntentResponse.json();
    failurePaymentIntentId = failedIntentPayload.paymentIntentId;
    const pendingIntent = await stripe.paymentIntents.retrieve(failurePaymentIntentId);
    failureCustomerId = typeof pendingIntent.customer === "string"
      ? pendingIntent.customer
      : pendingIntent.customer?.id;
    try {
      await stripe.paymentIntents.confirm(failurePaymentIntentId, {
        payment_method_data: {
          type: "card",
          card: { token: "tok_chargeDeclined" },
        },
      });
    } catch {
      // Stripe may return either the failed PaymentIntent or a card error.
    }
    const failedIntent = await stripe.paymentIntents.retrieve(failurePaymentIntentId);
    expect(failedIntent.status).not.toBe("succeeded");
    const failedPaymentMethod = failedIntent.payment_method;
    const failedPaymentMethodId = typeof failedPaymentMethod === "string"
      ? failedPaymentMethod
      : failedPaymentMethod?.id;
    if (failedPaymentMethodId) paymentMethodIds.add(failedPaymentMethodId);
    const failedPaymentEvent = await findStripeEvent(
      stripe,
      "payment_intent.payment_failed",
      failurePaymentIntentId,
    );
    const failureWebhook = await postSignedStripeEvent(page, failedPaymentEvent, webhookSecret);
    expect(failureWebhook.status()).toBe(200);
    const failedSignup = await db.query(
      `SELECT id FROM organizations WHERE lower(owner_email)=lower($1)`,
      [failureEmail],
    );
    expect(failedSignup.rows).toHaveLength(0);
    const failedAddon = await db.query(
      `SELECT active FROM org_addons
       WHERE org_id IN (SELECT id FROM organizations WHERE lower(owner_email)=lower($1))
         AND addon_key='agencyPacks' AND active=true`,
      [failureEmail],
    );
    expect(failedAddon.rows).toHaveLength(0);
  } finally {
    for (const intentId of [paymentIntentId, failurePaymentIntentId].filter(Boolean)) {
      try {
        const intent = await stripe.paymentIntents.retrieve(intentId);
        if (intent.status !== "succeeded" && intent.status !== "canceled") {
          await stripe.paymentIntents.cancel(intentId);
        }
      } catch {}
    }
    for (const customerToClean of [customerId, failureCustomerId].filter(Boolean)) {
      try {
        const remaining = await stripe.subscriptions.list({
          customer: customerToClean,
          status: "all",
          limit: 100,
        });
        for (const subscription of remaining.data) {
          if (subscription.status !== "canceled" && subscription.status !== "incomplete_expired") {
            await stripe.subscriptions.cancel(subscription.id).catch(() => {});
          }
        }
      } catch {}
      await stripe.customers.del(customerToClean).catch(() => {});
    }
    for (const paymentMethodId of paymentMethodIds) {
      await stripe.paymentMethods.detach(paymentMethodId).catch(() => {});
    }
    await db.query("DELETE FROM pending_signups WHERE email = ANY($1::text[])", [
      [signupEmail, failureEmail].filter(Boolean),
    ]).catch(() => {});
  }
});

test("AI Workspace Launch restores a persisted strategy through the browser UI", async ({ page }) => {
  const me = await signInToDashboard(page);
  await page.evaluate(({ orgId, userId, sessionId }) => {
    localStorage.setItem(`fp:${orgId}:${userId}:ai-workspace-launch:last-session`, sessionId);
  }, { orgId: me.orgId, userId: me.userId, sessionId: sessionA });
  await page.waitForFunction(() => typeof window.openAIWorkspaceLaunch === "function");
  await page.evaluate(() => window.openAIWorkspaceLaunch());
  await expect(page.locator("#fp-awl-overlay")).toBeVisible();
  await expect(page.locator("#awl-load-last")).toBeVisible();

  const responsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/ai-workspace-launch/${sessionA}` &&
    response.request().method() === "GET"
  );
  await page.locator("#awl-load-last").click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  await expect(page.locator("#fp-awl-s5")).toBeVisible();
  await expect(page.locator("#awl-res-sub")).toContainText("Synthetic workspace");
  await expect(page.locator("#awl-roadmap")).toContainText("Fixture mission roadmap");
});

test("GBP settings save from the dashboard and survive reload without cross-tenant locations", async ({ page }) => {
  await signInToDashboard(page);
  await page.evaluate(() => { window.location.hash = "#reports/local"; });
  await page.waitForFunction(
    () => window.STATE?.route === "reports" && window.STATE?.subRoute === "local",
    null,
    { timeout: 20_000 },
  );
  const panel = page.locator('section[aria-labelledby="fp-gbp-performance-title"]');
  await expect(panel).toBeVisible();
  const form = panel.locator("form[data-fp-gbp-performance-settings]");
  await expect(form).toBeVisible();
  await expect(form.locator('select[name="locationId"] option')).toHaveText(["Synthetic GBP location A"]);
  await expect(panel.getByRole("status")).toContainText("Connectez Google Business Profile");

  await form.locator('select[name="locationId"]').selectOption(gbpLocationA);
  await form.locator('select[name="periodDays"]').selectOption("7");
  await form.locator('input[name="alertDropPercent"]').fill("15");
  await form.locator('input[name="CALL_CLICKS"]').fill("12");
  await form.locator('input[name="WEBSITE_CLICKS"]').fill("20");
  const savePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/gbp-performance/settings" &&
    response.request().method() === "PUT"
  );
  await form.getByRole("button", { name: "Enregistrer les objectifs" }).click();
  const saveResponse = await savePromise;
  expect(saveResponse.status()).toBe(200);
  await expect(form.locator('select[name="locationId"]')).toHaveValue(gbpLocationA);
  await expect(form.locator('select[name="periodDays"]')).toHaveValue("7");
  await expect(form.locator('input[name="alertDropPercent"]')).toHaveValue("15");
  await expect(form.locator('input[name="CALL_CLICKS"]')).toHaveValue("12");
  await expect(form.locator('input[name="WEBSITE_CLICKS"]')).toHaveValue("20");

  await page.reload();
  await page.waitForSelector('[data-route="overview"]', { timeout: 20_000 });
  await page.evaluate(() => { window.location.hash = "#reports/local"; });
  await page.waitForFunction(
    () => window.STATE?.route === "reports" && window.STATE?.subRoute === "local",
    null,
    { timeout: 20_000 },
  );
  const reloadedForm = page.locator('form[data-fp-gbp-performance-settings]');
  await expect(reloadedForm).toBeVisible();
  await expect(reloadedForm.locator('select[name="locationId"]')).toHaveValue(gbpLocationA);
  await expect(reloadedForm.locator('select[name="periodDays"]')).toHaveValue("7");
  await expect(reloadedForm.locator('input[name="alertDropPercent"]')).toHaveValue("15");
  await expect(reloadedForm.locator('input[name="CALL_CLICKS"]')).toHaveValue("12");
  await expect(reloadedForm.locator('input[name="WEBSITE_CLICKS"]')).toHaveValue("20");

  const persisted = await page.request.get("/api/gbp-performance");
  expect(persisted.status()).toBe(200);
  const data = await persisted.json();
  expect(data.settings).toMatchObject({
    locationId: gbpLocationA,
    periodDays: 7,
    alertDropPercent: 15,
    goals: { CALL_CLICKS: 12, WEBSITE_CLICKS: 20 },
  });
});

test("Local Presence Optimizer saves tracked GBP criteria and reloads them", async ({ page }) => {
  await signInToDashboard(page);
  await page.evaluate(() => { window.location.hash = "#local-seo/presence"; });
  await page.waitForFunction(
    () => window.STATE?.route === "local-seo" && window.STATE?.subRoute === "presence",
    null,
    { timeout: 20_000 },
  );
  const panel = page.locator('section[aria-labelledby="fp-local-presence-title"]');
  await expect(panel).toBeVisible();
  const form = panel.locator("form[data-fp-local-presence-settings]");
  await expect(form).toBeVisible();
  await expect(form.locator('select[name="locationId"] option')).toHaveText(["Synthetic GBP location A"]);

  for (const checkbox of await form.locator('input[name="trackedFields"]').all()) {
    const key = await checkbox.getAttribute("value");
    if (key === "title" || key === "phone") await checkbox.check();
    else await checkbox.uncheck();
  }
  await form.locator('select[name="locationId"]').selectOption(gbpLocationA);
  const savePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/local-presence/settings" &&
    response.request().method() === "PUT"
  );
  await form.locator('button[type="submit"]').click();
  const saveResponse = await savePromise;
  expect(saveResponse.status()).toBe(200);
  await expect(panel).toContainText("50%");

  await page.reload();
  await page.waitForSelector('[data-route="overview"]', { timeout: 20_000 });
  await page.evaluate(() => { window.location.hash = "#local-seo/presence"; });
  await page.waitForFunction(
    () => window.STATE?.route === "local-seo" && window.STATE?.subRoute === "presence",
    null,
    { timeout: 20_000 },
  );
  const reloadedForm = page.locator('form[data-fp-local-presence-settings]');
  await expect(reloadedForm).toBeVisible();
  await expect(reloadedForm.locator('select[name="locationId"]')).toHaveValue(gbpLocationA);
  await expect(reloadedForm.locator('input[name="trackedFields"][value="title"]')).toBeChecked();
  await expect(reloadedForm.locator('input[name="trackedFields"][value="phone"]')).toBeChecked();
  await expect(reloadedForm.locator('input[name="trackedFields"]:checked')).toHaveCount(2);
  await expect(page.locator('section[aria-labelledby="fp-local-presence-title"]')).toContainText("50%");
});

test("Local Landing Opportunities saves filters and reloads tenant-scoped GSC signals", async ({ page }) => {
  await signInToDashboard(page);
  await page.evaluate(() => { window.location.hash = "#local-seo/opportunities"; });
  await page.waitForFunction(
    () => window.STATE?.route === "local-seo" && window.STATE?.subRoute === "opportunities",
    null,
    { timeout: 20_000 },
  );
  const panel = page.locator('section[aria-labelledby="fp-local-landing-title"]');
  await expect(panel).toBeVisible();
  const form = panel.locator("form[data-fp-local-landing-settings]");
  await expect(form).toBeVisible();
  await form.locator('input[name="services"]').fill("dentiste");
  await form.locator('input[name="locations"]').fill("Bruxelles");
  await form.locator('input[name="minimumImpressions"]').fill("20");
  await form.locator('input[name="maximumPosition"]').fill("20");
  const savePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/local-landing-opportunities/settings" &&
    response.request().method() === "PUT"
  );
  await form.locator('button[type="submit"]').click();
  const saveResponse = await savePromise;
  expect(saveResponse.status()).toBe(200);
  await expect(panel).toContainText("dentiste urgence Bruxelles");
  await expect(panel).toContainText("120 impressions");
  await expect(panel).not.toContainText("999 impressions");

  await page.reload();
  await page.waitForSelector('[data-route="overview"]', { timeout: 20_000 });
  await page.evaluate(() => { window.location.hash = "#local-seo/opportunities"; });
  await page.waitForFunction(
    () => window.STATE?.route === "local-seo" && window.STATE?.subRoute === "opportunities",
    null,
    { timeout: 20_000 },
  );
  const reloadedPanel = page.locator('section[aria-labelledby="fp-local-landing-title"]');
  const reloadedForm = reloadedPanel.locator("form[data-fp-local-landing-settings]");
  await expect(reloadedForm).toBeVisible();
  await expect(reloadedForm.locator('input[name="services"]')).toHaveValue("dentiste");
  await expect(reloadedForm.locator('input[name="locations"]')).toHaveValue("Bruxelles");
  await expect(reloadedForm.locator('input[name="minimumImpressions"]')).toHaveValue("20");
  await expect(reloadedForm.locator('input[name="maximumPosition"]')).toHaveValue("20");
  await expect(reloadedPanel).toContainText("dentiste urgence Bruxelles");
  await expect(reloadedPanel).toContainText("120 impressions");
  await expect(reloadedPanel).not.toContainText("999 impressions");
});

test("the four remaining replacement add-ons save, measure, and reload in one tenant-isolated session", async ({ page }) => {
  await signInToDashboard(page);
  const goTo = async (route, selector) => {
    await page.evaluate(value => { window.location.hash = `#${value}`; }, route);
    await page.waitForFunction(
      ({ expectedRoute, rootSelector }) =>
        window.STATE?.route === expectedRoute && Boolean(document.querySelector(rootSelector)),
      { expectedRoute: route, rootSelector: selector },
      { timeout: 20_000 },
    );
  };

  await goTo("seo-change-impact", "#fp-addon-seo-change-impact");
  const seo = page.locator("#fp-addon-seo-change-impact");
  await expect(seo).toContainText(`${siteA}/services/dentist`);
  await expect(seo).toContainText("58 → 78 (+20)");
  await expect(seo).not.toContainText(siteB);
  const seoForm = seo.locator("form[data-sci-settings]");
  await seoForm.locator('input[name="lookbackDays"]').fill("60");
  await seoForm.locator('input[name="minimumScoreChange"]').fill("5");
  const seoSave = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/seo-change-impact/settings" &&
    response.request().method() === "PUT"
  );
  await seoForm.locator('button[type="submit"]').click();
  expect((await seoSave).status()).toBe(200);
  await expect(seo.locator('input[name="lookbackDays"]')).toHaveValue("60");
  await expect(seo.locator('input[name="minimumScoreChange"]')).toHaveValue("5");

  await goTo("technical-seo-fix-verification", "#fp-addon-technical-seo-fix-verification");
  const technical = page.locator("#fp-addon-technical-seo-fix-verification");
  const technicalForm = technical.locator("form[data-tsfv-form]");
  await technicalForm.locator('select[name="beforeAuditId"]').selectOption(auditBeforeA);
  await technicalForm.locator('select[name="afterAuditId"]').selectOption(auditAfterA);
  const verify = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/technical-seo-fix-verification/verify" &&
    response.request().method() === "POST"
  );
  await technicalForm.locator('button[type="submit"]').click();
  expect((await verify).status()).toBe(200);
  await expect(technical).toContainText(/10\s*→\s*4\s+(problèmes|issues)/i);
  await expect(technical).toContainText(/(amélioration mesurée|measured improvement)/i);
  await expect(technical).not.toContainText(siteB);

  await goTo("organic-campaign-tracker", "#fp-addon-organic-campaign-tracker");
  const organic = page.locator("#fp-addon-organic-campaign-tracker");
  const organicForm = organic.locator("form[data-oct-form]");
  await organicForm.locator('input[name="keyword"]').fill("dentiste urgence Bruxelles");
  await organicForm.locator('input[name="targetPosition"]').fill("10");
  await organicForm.locator('input[name="minimumClicks"]').fill("5");
  const goalSave = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/organic-campaign-tracker" &&
    response.request().method() === "POST"
  );
  await organicForm.locator('button[type="submit"]').click();
  expect((await goalSave).status()).toBe(200);
  await expect(organic).toContainText(/12\s+(clics|clicks)/i);
  await expect(organic).toContainText(/8\.0\s+(position moyenne|average position)/i);
  await expect(organic).not.toContainText(/99\s+(clics|clicks)/i);

  await goTo("agency-portfolio-priorities", "#fp-addon-agency-portfolio-priorities");
  const agency = page.locator("#fp-addon-agency-portfolio-priorities");
  await expect(agency).toContainText("addon-a.qa-fixture.invalid");
  await expect(agency).not.toContainText("addon-b.qa-fixture.invalid");
  await expect(agency).toContainText(/(clics GSC \/ 30 jours|GSC clicks \/ 30 days)/i);
  await agency.locator('select[name="addon-a.qa-fixture.invalid"]').selectOption("5");
  const prioritySave = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/agency-portfolio-priorities/settings" &&
    response.request().method() === "PUT"
  );
  await agency.locator('button[type="submit"]').click();
  expect((await prioritySave).status()).toBe(200);

  await page.reload();
  await page.waitForSelector('[data-route="overview"]', { timeout: 20_000 });
  await page.waitForFunction(() => window.STATE?.loading === false, null, { timeout: 20_000 });
  await goTo("seo-change-impact", "#fp-addon-seo-change-impact");
  await expect(page.locator("#fp-addon-seo-change-impact").locator('input[name="lookbackDays"]')).toHaveValue("60");
  await expect(page.locator("#fp-addon-seo-change-impact").locator('input[name="minimumScoreChange"]')).toHaveValue("5");
  await expect(page.locator("#fp-addon-seo-change-impact")).toContainText("58 → 78 (+20)");

  await goTo("technical-seo-fix-verification", "#fp-addon-technical-seo-fix-verification");
  await expect(page.locator("#fp-addon-technical-seo-fix-verification")).toContainText(
    /10\s*→\s*4\s+(problèmes|issues)/i,
  );

  await goTo("organic-campaign-tracker", "#fp-addon-organic-campaign-tracker");
  await expect(page.locator("#fp-addon-organic-campaign-tracker")).toContainText(/dentiste urgence bruxelles/i);
  await expect(page.locator("#fp-addon-organic-campaign-tracker")).toContainText(/12\s+(clics|clicks)/i);

  await goTo("agency-portfolio-priorities", "#fp-addon-agency-portfolio-priorities");
  const reloadedAgency = page.locator("#fp-addon-agency-portfolio-priorities");
  await expect(reloadedAgency.locator('select[name="addon-a.qa-fixture.invalid"]')).toHaveValue("5");
  await expect(reloadedAgency).not.toContainText("addon-b.qa-fixture.invalid");

  await goTo("reports", "#fp-agency-packs-result");
  const agencyPacksCard = page.locator("section.fp-card").filter({ has: page.locator("#fp-agency-packs-result") });
  await agencyPacksCard.getByRole("button", { name: /Charger les packs|Load packs/i }).click();
  const packsResult = page.locator("#fp-agency-packs-result");
  await packsResult.locator('input[type="text"]').fill("Synthetic UI customer");
  await packsResult.locator("select").selectOption(auditAfterA);
  const packResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/reports/agency-packs/generate" &&
    response.request().method() === "POST"
  );
  await packsResult.locator("button.fp-btn-primary").first().click();
  const generatedPack = await packResponse;
  expect(generatedPack.status()).toBe(201);
  expect((await generatedPack.json()).verifiedCount).toBe(3);
  await expect(page.locator("#fp-page")).toContainText("Synthetic UI customer");
  const persistedAgencyReports = await page.request.get("/api/reports");
  expect(
    (await persistedAgencyReports.json())
      .filter(row => row.org_id === orgA && row.name.includes("Synthetic UI customer"))
      .map(row => row.template_key)
      .sort(),
  ).toEqual(["executive", "local", "seo"]);

});

test("Global Monitoring fails closed without provider data and shows no fabricated metrics", async ({ page }) => {
  await signInToDashboard(page);
  await page.evaluate(() => window.navigate("monitors"));
  await page.waitForFunction(
    () => window.STATE?.route === "monitors" && Boolean(document.querySelector("#fp-global-monitoring-result")),
    null,
    { timeout: 20_000 },
  );

  const card = page.locator("section.fp-card").filter({ has: page.locator("#fp-global-monitoring-result") });
  const responsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/betterstack/global-overview"
  );
  const loadOverviewButton = card.locator("button.fp-btn-ghost").first();
  await expect(loadOverviewButton).toBeVisible();
  await loadOverviewButton.evaluate(button => button.click());
  const response = await responsePromise;
  expect(response.status()).toBe(503);
  expect(await response.json()).toMatchObject({ configured: false });

  const result = page.locator("#fp-global-monitoring-result");
  await expect(result).toContainText(/Impossible de charger les régions|Could not load regions/i);
  await expect(result).not.toContainText(/99\.9|QA monitor|configuredRegionCount/i);
});
