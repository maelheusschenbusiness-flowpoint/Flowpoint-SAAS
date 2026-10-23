import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { test, expect } from "@playwright/test";

const apiRequire = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
const { Pool } = apiRequire("pg");
const addonKeys = ["agencyPacks", "aiExecutiveReport", "aiWorkspaceLaunch", "abTestingAI", "aiContentStrategist"];
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
    [profileA, orgA, sessionA, JSON.stringify([{ title: "Fixture mission roadmap" }])],
  );
  await db.query(
    `INSERT INTO ai_generated_missions (id,org_id,profile_id,title,category,priority)
     VALUES ($1,$2,$3,'Synthetic persisted mission','seo',1)`,
    [missionA, orgA, profileA],
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

test("authentifie normalement et certifie les cinq add-ons avec données synthétiques tenant-isolées", async ({ page }) => {
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
