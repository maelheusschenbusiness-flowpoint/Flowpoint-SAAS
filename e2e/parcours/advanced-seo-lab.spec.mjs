import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { test, expect } from "@playwright/test";

const apiRequire = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
const { Pool } = apiRequire("pg");
const databaseUrl = process.env["FLOWPOINT_ADDON_CERT_DATABASE_URL"];
const expectedDb = process.env["FLOWPOINT_ADDON_CERT_EXPECTED_DB"];
const expectedHost = process.env["FLOWPOINT_ADDON_CERT_EXPECTED_HOST"];
const mailDir = process.env["TEST_MAIL_DIR"];

const orgId = randomUUID();
const ownerId = randomUUID();
const viewerId = randomUUID();
const ownerEmail = `advanced-seo-owner-${randomUUID()}@flowpoint-internal.test`;
const viewerEmail = `advanced-seo-viewer-${randomUUID()}@flowpoint-internal.test`;
const siteUrl = "https://advanced-seo.qa-fixture.invalid/page";
const auditId = `asla_${randomUUID()}`;
const addonId = `cert-${orgId}-advancedSeoLab`;
let db;

test.beforeAll(async () => {
  if (!databaseUrl || !expectedDb || !expectedHost || !mailDir || !process.env["ENABLE_TEST_MAILER"]) {
    throw new Error("Advanced SEO Lab certification requires the isolated disposable database and test-mail transport.");
  }
  if (new URL(databaseUrl).hostname !== expectedHost) throw new Error("Unexpected disposable database host.");

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
    [ownerId, ownerEmail, viewerId, viewerEmail],
  );
  await db.query(
    `INSERT INTO organizations
      (id,name,slug,owner_user_id,status,plan,subscription_status,trial_ends_at,trial_consumed_at)
     VALUES ($1::uuid,'Advanced SEO Lab certification',$2,$3::uuid,'active','standard','trialing',NOW()+INTERVAL '14 days',NOW())`,
    [orgId, `advanced-seo-cert-${orgId}`, ownerId],
  );
  await db.query(
    `INSERT INTO organization_members (id,organization_id,user_id,role,status,joined_at)
     VALUES (gen_random_uuid(),$1,$2::uuid,'owner','active',NOW()),
            (gen_random_uuid(),$1,$3::uuid,'viewer','active',NOW())`,
    [orgId, ownerId, viewerId],
  );
  await db.query(
    `INSERT INTO user_prefs (org_id,settings)
     VALUES ($1,$2::jsonb)`,
    [orgId, JSON.stringify({ onboardingCompletedAt: new Date().toISOString() })],
  );
  await db.query(
    `INSERT INTO org_addons (id,org_id,addon_key,active,quantity,activated_at)
     VALUES ($1,$2::uuid,'advancedSeoLab',true,1,NOW())`,
    [addonId, orgId],
  );
  await db.query(
    `INSERT INTO audits (id,org_id,url,name,score,status,speed,date,issues,origin,created_by,created_at)
     VALUES ($1,$2,$3,'Advanced SEO fixture',72,'completed',81,CURRENT_DATE::text,2,'manual',$4,NOW())`,
    [auditId, orgId, siteUrl, ownerId],
  );
});

test.afterAll(async () => {
  if (!db) return;
  await db.query("DELETE FROM mission_history WHERE org_id=$1", [orgId]);
  await db.query("DELETE FROM missions WHERE org_id=$1", [orgId]);
  await db.query("DELETE FROM audits WHERE org_id=$1", [orgId]);
  await db.query("DELETE FROM org_addons WHERE org_id=$1::uuid", [orgId]);
  await db.query("DELETE FROM user_prefs WHERE org_id=$1", [orgId]);
  await db.query("DELETE FROM organization_members WHERE organization_id=$1", [orgId]);
  await db.query("DELETE FROM organizations WHERE id=$1::uuid", [orgId]);
  await db.query("DELETE FROM magic_link_tokens WHERE lower(email) IN (lower($1),lower($2))", [ownerEmail, viewerEmail]);
  const columns = await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='user_sessions'",
  );
  const names = new Set(columns.rows.map(row => row.column_name));
  if (names.has("user_id_v2")) {
    await db.query("DELETE FROM user_sessions WHERE user_id_v2::text IN ($1,$2)", [ownerId, viewerId]);
  } else if (names.has("user_id")) {
    await db.query("DELETE FROM user_sessions WHERE user_id::text IN ($1,$2)", [ownerId, viewerId]);
  }
  await db.query("DELETE FROM users WHERE id IN ($1::uuid,$2::uuid)", [ownerId, viewerId]);
  await db.end();
});

async function signIn(page, email) {
  const login = await page.request.post("/api/auth/login-request", { data: { email } });
  expect(login.ok()).toBe(true);
  const loginBody = await login.json();
  expect(loginBody.debugLink).toBeTruthy();

  const messages = readdirSync(mailDir)
    .filter(name => name.endsWith(".json"))
    .map(name => JSON.parse(readFileSync(`${mailDir}/${name}`, "utf8")))
    .filter(message => message.to === email);
  expect(messages).toHaveLength(1);
  expect(messages[0].token).toBeTruthy();

  await page.goto(loginBody.debugLink);
  await page.waitForURL(/dashboard\.html/, { timeout: 20_000 });
  await page.waitForSelector('[data-route="overview"]', { timeout: 20_000 });
  await page.waitForFunction(() => Boolean(window.STATE?.me?.orgId && window.STATE?.me?.userId), null, { timeout: 20_000 });
  await page.waitForFunction(
    () => window.STATE?.loading === false && Boolean(document.getElementById("fp-global-anims")),
    null,
    { timeout: 30_000 },
  );
  return page.request.get("/api/me");
}

test("Advanced SEO Lab exposes real actions, enforces access, and persists generated missions", async ({ page, browser }) => {
  const ownerMeResponse = await signIn(page, ownerEmail);
  expect(ownerMeResponse.status()).toBe(200);
  const ownerMe = await ownerMeResponse.json();
  expect(ownerMe.addons?.advancedSeoLab).toBe(true);

  // The local cert launcher strips provider credentials. This proves an
  // unconfigured provider fails explicitly and cannot fabricate a score.
  const unavailable = await page.request.post("/api/seo/content-optimization", { data: { url: siteUrl } });
  expect(unavailable.status()).toBe(503);
  expect(await unavailable.json()).toMatchObject({ ok: false, code: "DATAFORSEO_NOT_CONFIGURED" });

  await page.locator('.fp-nav-item[data-route="audits"]').click();
  await page.waitForFunction(() => window.STATE?.route === "audits", null, { timeout: 20_000 });
  await expect(page.locator("#audit-search")).toBeVisible();
  await page.waitForFunction(
    id => window.STATE?.audits?.some(audit => String(audit.id) === id),
    auditId,
    { timeout: 20_000 },
  );
  const viewAudit = page.locator(`button.audit-view[title="View"][data-id="${auditId}"]`);
  await expect(viewAudit).toBeVisible();
  await viewAudit.click();
  await expect(page.locator("#fp-float-panel")).toBeVisible();
  await expect(page.locator("#audit-panel-content-optimization")).toBeVisible();
  await expect(page.locator("#audit-panel-seo-missions")).toBeVisible();
  await page.waitForFunction(
    () => String(window._generateLocalMissions || "").includes("/api/seo/generate-missions"),
    null,
    { timeout: 20_000 },
  );

  page.on("dialog", dialog => dialog.accept());
  await page.route("**/api/seo/content-optimization", async route => {
    expect(route.request().postDataJSON()).toEqual({ url: siteUrl });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        score: 82,
        wordCount: 640,
        headings: 9,
        recommendations: ["Clarifier le titre de la page"],
      }),
    });
  });
  await page.locator("#audit-panel-content-optimization").click();
  await expect(page.locator("#audit-panel-content-optimization-result")).toContainText("82/100");
  await expect(page.locator("#audit-panel-content-optimization-result")).toContainText("Clarifier le titre de la page");

  let generationPayload;
  await page.route("**/api/seo/generate-missions", async route => {
    generationPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        domain: "advanced-seo.qa-fixture.invalid",
        missions: [{
          keyword: "contenu SEO Bruxelles",
          difficulty: 22,
          volume: 410,
          actionPlan: ["Créer une page ciblée", "Ajouter des preuves locales"],
        }],
      }),
    });
  });
  const keyword = "contenu SEO Bruxelles";
  const missionPost = page.waitForResponse(response => {
    if (new URL(response.url()).pathname !== "/api/missions" || response.request().method() !== "POST") return false;
    try {
      const body = response.request().postDataJSON();
      return body?.source === "dataforseo" && String(body?.title || "").endsWith(keyword);
    } catch {
      return false;
    }
  });
  const generationResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/seo/generate-missions" &&
    response.request().method() === "POST",
  );
  await page.locator("#audit-panel-seo-missions").click();
  const generated = await generationResponse;
  expect(generated.status()).toBe(200);
  expect(generationPayload).toMatchObject({ domain: "advanced-seo.qa-fixture.invalid" });
  const missionResponse = await missionPost;
  expect(missionResponse.status()).toBe(201);
  const createdMission = await missionResponse.json();
  expect(createdMission.id).toBeTruthy();
  const missionTitle = createdMission.title;
  expect(missionTitle).toMatch(new RegExp(`${keyword}$`));
  await page.waitForFunction(() => window.STATE?.route === "missions", null, { timeout: 20_000 });
  await expect(page.locator("body")).toContainText(missionTitle);

  const persisted = await db.query(
    `SELECT id,org_id,title,source_type,steps
       FROM missions
      WHERE id=$1 AND org_id=$2`,
    [createdMission.id, orgId],
  );
  expect(persisted.rows).toHaveLength(1);
  expect(persisted.rows[0]).toMatchObject({
    id: createdMission.id,
    org_id: orgId,
    title: missionTitle,
    source_type: "dataforseo",
  });
  expect(persisted.rows[0].steps).toEqual(["Créer une page ciblée", "Ajouter des preuves locales"]);

  await page.reload();
  await page.waitForSelector('[data-route="overview"]', { timeout: 20_000 });
  await page.waitForFunction(
    () => window.STATE?.loading === false && Boolean(document.getElementById("fp-global-anims")),
    null,
    { timeout: 30_000 },
  );
  await page.locator('.fp-nav-item[data-route="missions"]').click();
  await page.waitForFunction(() => window.STATE?.route === "missions", null, { timeout: 20_000 });
  await expect(page.locator("body")).toContainText(missionTitle);

  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  const viewerMeResponse = await signIn(viewerPage, viewerEmail);
  expect(viewerMeResponse.status()).toBe(200);
  expect((await viewerMeResponse.json()).addons?.advancedSeoLab).toBe(true);
  const viewerAnalysis = await viewerPage.request.post("/api/seo/content-optimization", { data: { url: siteUrl } });
  expect(viewerAnalysis.status()).toBe(403);
  const viewerMissions = await viewerPage.request.post("/api/seo/generate-missions", { data: { domain: "advanced-seo.qa-fixture.invalid" } });
  expect(viewerMissions.status()).toBe(403);
  await viewerContext.close();

  await db.query("DELETE FROM org_addons WHERE id=$1", [addonId]);
  const deniedAnalysis = await page.request.post("/api/seo/content-optimization", { data: { url: siteUrl } });
  expect(deniedAnalysis.status()).toBe(403);
  const deniedMissions = await page.request.post("/api/seo/generate-missions", { data: { domain: "advanced-seo.qa-fixture.invalid" } });
  expect(deniedMissions.status()).toBe(402);
  expect(await deniedMissions.json()).toMatchObject({ code: "ADDON_REQUIRED", addonKey: "advancedSeoLab" });
});
