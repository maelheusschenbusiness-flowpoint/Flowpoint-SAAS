import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

const apiRequire = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
const { Pool } = apiRequire("pg");
const databaseUrl = process.env["FLOWPOINT_ADDON_CERT_DATABASE_URL"];
const expectedDb = process.env["FLOWPOINT_ADDON_CERT_EXPECTED_DB"];
const expectedHost = process.env["FLOWPOINT_ADDON_CERT_EXPECTED_HOST"];
const mailDir = process.env["TEST_MAIL_DIR"];
const email = `backlink-cert-${randomUUID()}@flowpoint-internal.test`;
const userId = randomUUID();
const orgId = randomUUID();
const auditId = randomUUID();
const site = "https://backlink.qa-fixture.invalid";
let db;

test.beforeAll(async () => {
  if (!databaseUrl || !expectedDb || !expectedHost || !mailDir || process.env["ENABLE_TEST_MAILER"] !== "true") {
    throw new Error("Backlink browser certification requires an attested disposable database and isolated test-mail transport.");
  }
  if (process.env["FLOWPOINT_ADDON_CERT_LOCAL_ONLY"] !== "1") {
    throw new Error("Backlink browser certification only runs against the local disposable database.");
  }
  const parsedDatabaseUrl = new URL(databaseUrl);
  const e2eUrl = new URL(process.env["E2E_BASE_URL"] ?? "");
  const databaseFromUrl = decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\/+/, ""));
  if (
    process.env["DATABASE_URL"] !== databaseUrl ||
    !["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol) ||
    parsedDatabaseUrl.hostname !== "127.0.0.1" ||
    expectedHost !== "127.0.0.1" ||
    expectedDb !== "flowpoint_ci" ||
    databaseFromUrl !== expectedDb ||
    !parsedDatabaseUrl.port ||
    e2eUrl.protocol !== "http:" ||
    e2eUrl.hostname !== "127.0.0.1"
  ) {
    throw new Error("Local Backlink certification target did not match the expected disposable loopback services.");
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
  ) throw new Error("Disposable-database attestation failed; refusing to seed Backlink fixtures.");

  await db.query(
    `INSERT INTO users (id,email,status,email_verified,auth_provider)
     VALUES ($1::uuid,$2,'active',true,'magic_link')`,
    [userId, email],
  );
  await db.query(
    `INSERT INTO organizations
      (id,name,slug,owner_user_id,status,plan,subscription_status,trial_ends_at,trial_consumed_at)
     VALUES ($1::uuid,'Backlink certification',$2,$3::uuid,'active','standard','trialing',NOW()+INTERVAL '14 days',NOW())`,
    [orgId, `backlink-cert-${orgId}`, userId],
  );
  await db.query(
    `INSERT INTO organization_members (id,organization_id,user_id,role,status,joined_at)
     VALUES (gen_random_uuid(),$1::uuid,$2::uuid,'owner','active',NOW())`,
    [orgId, userId],
  );
  await db.query(
    `INSERT INTO user_prefs (org_id,settings)
     VALUES ($1,$2::jsonb)`,
    [orgId, JSON.stringify({ onboardingCompletedAt: new Date().toISOString() })],
  );
  await db.query(
    `INSERT INTO org_addons (id,org_id,addon_key,active,quantity,activated_at)
     VALUES ($1,$2,'backlinkIntelligence',true,1,NOW())`,
    [`cert-${orgId}-backlinkIntelligence`, orgId],
  );
  await db.query(
    `INSERT INTO audits (id,org_id,url,score,issues,speed,status,created_at)
     VALUES ($1,$2,$3,72,4,81,'ok',NOW())`,
    [auditId, orgId, `${site}/services`],
  );
});

test.afterAll(async () => {
  if (!db) return;
  try {
    await db.query("DELETE FROM audits WHERE org_id=$1", [orgId]);
    await db.query("DELETE FROM org_addons WHERE org_id=$1", [orgId]);
    await db.query("DELETE FROM user_prefs WHERE org_id=$1", [orgId]);
    await db.query("DELETE FROM organization_members WHERE organization_id::text=$1", [orgId]);
    await db.query("DELETE FROM organizations WHERE id=$1::uuid", [orgId]);
    await db.query("DELETE FROM magic_link_tokens WHERE lower(email)=lower($1)", [email]);
    const sessionColumns = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='user_sessions'",
    );
    const names = new Set(sessionColumns.rows.map(row => row.column_name));
    if (names.has("user_id_v2")) await db.query("DELETE FROM user_sessions WHERE user_id_v2::text=$1", [userId]);
    if (names.has("user_id")) await db.query("DELETE FROM user_sessions WHERE user_id::text=$1", [userId]);
    await db.query("DELETE FROM users WHERE id=$1::uuid", [userId]);
  } finally {
    await db.end();
  }
});

test("Backlink Intelligence shows provider-unavailable states without synthetic metrics", async ({ page }) => {
  const login = await page.request.post("/api/auth/login-request", { data: { email } });
  expect(login.ok()).toBe(true);
  const loginBody = await login.json();
  expect(loginBody.debugLink).toBeTruthy();

  const messageFile = readdirSync(mailDir).find(name => {
    if (!name.endsWith(".json")) return false;
    try {
      return JSON.parse(readFileSync(`${mailDir}/${name}`, "utf8")).to === email;
    } catch {
      return false;
    }
  });
  expect(messageFile).toBeTruthy();

  await page.goto(loginBody.debugLink);
  await page.waitForURL(/dashboard\.html/, { timeout: 20_000 });
  await page.waitForSelector('[data-route="overview"]', { timeout: 20_000 });
  await page.waitForFunction(
    () => window.STATE?.loading === false && window.STATE?.dataLoadComplete === true,
    null,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    id => window.STATE?.audits?.some(audit => String(audit.id) === id),
    auditId,
    { timeout: 20_000 },
  );
  await page.evaluate(() => {
    window.STATE.audits = [];
    window.STATE.backlinks = null;
  });

  await page.locator('[data-route="competitor"]').click();
  await page.waitForFunction(() => window.STATE?.route === "competitor", null, { timeout: 20_000 });
  await page.locator('[data-sub-route="backlinks"]').click();
  await page.waitForFunction(() => window.STATE?.subRoute === "backlinks", null, { timeout: 20_000 });

  const summaryButton = page.locator('button[onclick*="fpLoadBacklinkSummary"]');
  await expect(summaryButton).toBeVisible();
  await expect(page.getByText(/Backlink Intelligence add-on is required|L’add-on Backlink Intelligence est nécessaire/)).toHaveCount(0);
  await expect(summaryButton).toBeEnabled({ timeout: 15_000 });

  const auditsResponsePromise = page.waitForResponse(response =>
    response.request().method() === "GET" && new URL(response.url()).pathname === "/api/audits",
  );
  const summaryResponse = page.waitForResponse(response =>
    response.request().method() === "GET" && response.url().includes("/api/seo/backlinks?"),
  );
  await summaryButton.click();
  const [auditsResponse, summaryHttpResponse] = await Promise.all([auditsResponsePromise, summaryResponse]);
  expect(auditsResponse.status()).toBe(200);
  const audits = await auditsResponse.json();
  expect(audits.some(audit => audit.url === `${site}/services`)).toBe(true);
  expect(summaryHttpResponse.status()).toBe(200);
  const summary = await summaryHttpResponse.json();
  expect(summary).toMatchObject({
    domain: "backlink.qa-fixture.invalid",
    available: false,
    reason: "not_configured",
    backlinks: null,
    referring_domains: null,
    domain_rank: null,
  });
  await expect(page.locator(".fp-stat-row")).toContainText("—");
  await page.waitForFunction(() => window.STATE?.backlinks?.reason === "not_configured", null, { timeout: 15_000 });
  await expect(page.getByText(/DataForSEO (n’est pas configuré pour cette organisation\.|is not configured for this organization\.)/).first()).toBeVisible();
});
