import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { test, expect } from "@playwright/test";

const apiRequire = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
const { Pool } = apiRequire("pg");
const addonKeys = ["agencyPacks", "aiExecutiveReport", "aiWorkspaceLaunch", "abTestingAI", "aiContentStrategist", "gbpPerformanceLeads", "localPresenceOptimizer", "localLandingOpportunities"];
const databaseUrl = process.env["FLOWPOINT_ADDON_CERT_DATABASE_URL"];
const expectedDb = process.env["FLOWPOINT_ADDON_CERT_EXPECTED_DB"];
const expectedHost = process.env["FLOWPOINT_ADDON_CERT_EXPECTED_HOST"];
const mailDir = process.env["TEST_MAIL_DIR"];
const email = `addon-cert-${randomUUID()}@flowpoint-internal.test`;
const userId = randomUUID();
const orgA = randomUUID();
const orgB = randomUUID();
const sessionA = `e2e-awl-${randomUUID()}`;
const profileA = `e2e-awl-${randomUUID()}`;
const missionA = `e2e-awl-${randomUUID()}`;
const gbpLocationA = `e2e-gbp-${randomUUID()}`;
const gbpLocationB = `e2e-gbp-${randomUUID()}`;
const experimentA = randomUUID();
const experimentB = randomUUID();
const siteA = "https://addon-a.qa-fixture.invalid";
const siteB = "https://addon-b.qa-fixture.invalid";
const pageA = "/pricing";
let db;

test.beforeAll(async () => {
  if (!databaseUrl || !expectedDb || !expectedHost || !mailDir || !process.env["ENABLE_TEST_MAILER"]) {
    throw new Error("Certification requires Neon target guards and the isolated test-mail transport.");
  }
  if (new URL(databaseUrl).hostname !== expectedHost) throw new Error("Unexpected Neon host.");
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
  ) throw new Error("Neon disposable-database attestation failed; refusing to seed.");

  await db.query(
    "INSERT INTO users (id,email,status,email_verified,auth_provider) VALUES ($1::uuid,$2,'active',true,'magic_link')",
    [userId, email],
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
     VALUES (gen_random_uuid(),$1::uuid,$2::uuid,'owner','active',NOW())`,
    [orgA, userId],
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

  for (const [orgId, page, date, clicks, position] of [
    [orgA, "https://addon-a.qa-fixture.invalid/decay", "2026-09-01", 100, 4],
    [orgA, "https://addon-a.qa-fixture.invalid/decay", "2026-10-01", 50, 8],
    [orgB, "https://addon-b.qa-fixture.invalid/foreign", "2026-10-01", 999, 1],
  ]) {
    await db.query(
      `INSERT INTO gsc_page_data (id,org_id,page,date,clicks,impressions,position)
       VALUES ($1,$2,$3,$4, $5,1000,$6)`,
      [randomUUID(), orgId, page, date, clicks, position],
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
});

test.afterAll(async () => {
  if (!db) return;
  for (const orgId of [orgA, orgB]) {
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
  await db.query("DELETE FROM magic_link_tokens WHERE lower(email)=lower($1)", [email]);
  const sessionColumns = await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='user_sessions'",
  );
  const sessionColumnNames = new Set(sessionColumns.rows.map(row => row.column_name));
  if (sessionColumnNames.has("user_id_v2")) {
    await db.query("DELETE FROM user_sessions WHERE user_id_v2::text=$1", [userId]);
  } else if (sessionColumnNames.has("user_id")) {
    await db.query("DELETE FROM user_sessions WHERE user_id::text=$1", [userId]);
  }
  await db.query("DELETE FROM users WHERE id=$1::uuid", [userId]);
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
    data: { clientName: "Synthetic agency customer", dateStart: "2026-10-01", dateEnd: "2026-10-22" },
  });
  expect(packs.status()).toBe(201);
  const pack = await packs.json();
  expect(pack.verifiedCount).toBe(3);
  const persistedReports = await page.request.get("/api/reports");
  expect(persistedReports.status()).toBe(200);
  expect((await persistedReports.json()).filter(row => row.org_id === orgA)).toHaveLength(3);
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
  return me;
}

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

test("GBP Performance renders connected location metrics and decline indicators", async ({ page }) => {
      await page.route("**/api/gbp-performance*", async route => {
        if (route.request().method() !== "GET") {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            configured: true,
            settings: { locationId: gbpLocationA, periodDays: 30, alertDropPercent: 20, goals: { CALL_CLICKS: 30 } },
            locations: [{ id: gbpLocationA, name: "Synthetic GBP location A" }],
            location: { id: gbpLocationA, name: "Synthetic GBP location A" },
            period: { days: 30, start: "2026-10-01T00:00:00.000Z", end: "2026-10-31T00:00:00.000Z" },
            current: { CALL_CLICKS: 5, WEBSITE_CLICKS: 12, BUSINESS_DIRECTION_REQUESTS: 3, BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 100, BUSINESS_IMPRESSIONS_MOBILE_MAPS: 150 },
            previous: { CALL_CLICKS: 20, WEBSITE_CLICKS: 10, BUSINESS_DIRECTION_REQUESTS: 3, BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 90, BUSINESS_IMPRESSIONS_MOBILE_MAPS: 150 },
            goals: { CALL_CLICKS: 30 },
            drops: { CALL_CLICKS: 75 },
          }),
        });
      });
      await signInToDashboard(page);
      await page.evaluate(() => { window.location.hash = "#reports/local"; });
      await page.waitForFunction(
        () => window.STATE?.route === "reports" && window.STATE?.subRoute === "local",
        null,
        { timeout: 20_000 },
      );
      const panel = page.locator('section[aria-labelledby="fp-gbp-performance-title"]');
      await expect(panel).toBeVisible();
      const cards = panel.locator("article");
      await expect(cards).toHaveCount(5);
      const calls = cards.filter({ hasText: "Appels depuis la fiche" });
      await expect(calls).toContainText("5");
      await expect(calls).toContainText("Baisse observée de 75%");
      await expect(panel).toContainText("Les clics ne sont pas assimilés à des conversions.");
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
