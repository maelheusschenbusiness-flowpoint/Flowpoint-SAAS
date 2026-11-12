import { randomUUID } from "node:crypto";
    import { createRequire } from "node:module";
    import { test, expect } from "@playwright/test";
    import { getAddonCertDatabaseConfig, getLocalAddonCertDatabaseConfig } from "../../artifacts/api-server/tools/addon-cert-db-guard.mjs";

    const apiRequire = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
    const { Pool } = apiRequire("pg");
    const databaseUrl = process.env["FLOWPOINT_ADDON_CERT_DATABASE_URL"];
    const expectedDb = process.env["FLOWPOINT_ADDON_CERT_EXPECTED_DB"];
    const expectedHost = process.env["FLOWPOINT_ADDON_CERT_EXPECTED_HOST"];
    const mailDir = process.env["TEST_MAIL_DIR"];
    const ownerEmail = "exec-owner-" + randomUUID() + "@flowpoint-internal.test";
    const viewerEmail = "exec-viewer-" + randomUUID() + "@flowpoint-internal.test";
    const ownerId = randomUUID();
    const viewerId = randomUUID();
    const orgA = randomUUID();
    const orgB = randomUUID();
    const reportId = "r_exec_" + randomUUID();
    const foreignReportId = "r_foreign_" + randomUUID();
    const reportName = "Synthèse exécutive IA — Acquisition organique — QA";
    let db;

    test.setTimeout(120_000);

    test.beforeAll(async () => {
      if (!databaseUrl || !expectedDb || !expectedHost || !mailDir || !process.env["ENABLE_TEST_MAILER"]) {
        throw new Error("Certification requires an attested disposable database and isolated test-mail transport.");
      }
      const localOnly = process.env["FLOWPOINT_ADDON_CERT_LOCAL_ONLY"] === "1";
      const certConfig = localOnly ? getLocalAddonCertDatabaseConfig() : getAddonCertDatabaseConfig();
      if (localOnly) {
        const e2eUrl = new URL(process.env["E2E_BASE_URL"] ?? "");
        if (e2eUrl.protocol !== "http:" || e2eUrl.hostname !== "127.0.0.1") {
          throw new Error("Refusing local certification: E2E_BASE_URL must use local HTTP on 127.0.0.1.");
        }
      }
      if (certConfig.expectedDatabase !== expectedDb) throw new Error("Unexpected certification database name.");
      db = new Pool({ connectionString: databaseUrl });
      const identity = await db.query("SELECT current_database() AS database_name");
      const marker = await db.query("SELECT database_name,classification FROM public.flowpoint_test_database_guard WHERE purpose='addon-cert'");
      if (identity.rows[0]?.database_name !== expectedDb || marker.rows.length !== 1 || marker.rows[0].database_name !== expectedDb || marker.rows[0].classification !== "disposable") {
        throw new Error("Disposable-database attestation failed; refusing to seed.");
      }
      await db.query("INSERT INTO users (id,email,status,email_verified,auth_provider) VALUES ($1::uuid,$2,'active',true,'magic_link'),($3::uuid,$4,'active',true,'magic_link')", [ownerId, ownerEmail, viewerId, viewerEmail]);
      await db.query("INSERT INTO organizations (id,name,slug,owner_user_id,status,plan,subscription_status,trial_ends_at,trial_consumed_at,website) VALUES ($1::uuid,'Executive certification owner',$2,$3,'active','standard','trialing',NOW()+INTERVAL '14 days',NOW(),$7),($4::uuid,'Executive foreign workspace',$5,$6,'active','standard','trialing',NOW()+INTERVAL '14 days',NOW(),NULL)", [orgA, "exec-cert-a-" + orgA, ownerId, orgB, "exec-cert-b-" + orgB, ownerId, "https://exec-cert.qa-fixture.invalid"]);
      await db.query("INSERT INTO org_settings (org_id,org_name,website) VALUES ($1,'Executive certification',$2)", [orgA, "https://exec-cert.qa-fixture.invalid"]);
      await db.query("INSERT INTO organization_members (id,organization_id,user_id,role,status,joined_at) VALUES (gen_random_uuid(),$1::uuid,$2::uuid,'owner','active',NOW()),(gen_random_uuid(),$1::uuid,$3::uuid,'viewer','active',NOW())", [orgA, ownerId, viewerId]);
      await db.query("INSERT INTO user_prefs (org_id,settings) VALUES ($1,$2::jsonb)", [orgA, JSON.stringify({ onboardingCompletedAt: new Date().toISOString() })]);
      await db.query("INSERT INTO org_addons (id,org_id,addon_key,active,quantity,activated_at) VALUES ($1,$2,'aiExecutiveReport',true,1,NOW())", ["exec-cert-" + orgA, orgA]);
      const notes = JSON.stringify([{ title: "Acquisition organique — résultats du rapport de test", date: new Date().toISOString(), notes: "Sujet demandé : Acquisition organique\n\nSynthèse basée sur les données enregistrées pour ce test." }]);
      const foreignNotes = JSON.stringify([{ title: "Foreign report", date: new Date().toISOString(), notes: "Foreign tenant fixture." }]);
      await db.query("INSERT INTO reports (id,org_id,name,type,template_key,date,pages,shared,audit_id,white_label,pdf_ready,meeting_notes_json,date_start,date_end,created_by) VALUES ($1,$2,$3,'PDF','executive',NOW(),0,false,'',false,true,$4::jsonb,'','',$5),($6,$7,'Foreign executive report','PDF','executive',NOW(),0,false,'',false,true,$8::jsonb,'','',NULL)", [reportId, orgA, reportName, notes, ownerId, foreignReportId, orgB, foreignNotes]);
    });

    test.afterAll(async () => {
      if (!db) return;
      const cleanupErrors = [];
      try {
        for (const orgId of [orgA, orgB]) {
          await db.query("DELETE FROM reports WHERE org_id=$1", [orgId]);
          await db.query("DELETE FROM org_addons WHERE org_id=$1", [orgId]);
          await db.query("DELETE FROM user_prefs WHERE org_id=$1", [orgId]);
          await db.query("DELETE FROM org_settings WHERE org_id=$1", [orgId]);
          await db.query("DELETE FROM organization_members WHERE organization_id::text=$1", [orgId]);
          await db.query("DELETE FROM organizations WHERE id=$1::uuid", [orgId]);
        }
        await db.query("DELETE FROM magic_link_tokens WHERE lower(email)=ANY($1::text[])", [[ownerEmail, viewerEmail]]);
        const sessionColumns = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='user_sessions'");
        const columns = new Set(sessionColumns.rows.map(row => row.column_name));
        if (columns.has("user_id_v2")) await db.query("DELETE FROM user_sessions WHERE user_id_v2::text=ANY($1::text[])", [[ownerId, viewerId]]);
        if (columns.has("user_id")) await db.query("DELETE FROM user_sessions WHERE user_id::text=ANY($1::text[])", [[ownerId, viewerId]]);
        await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[ownerId, viewerId]]);
      } catch (error) {
        cleanupErrors.push(error);
      } finally {
        try { await db.end(); } catch (error) { cleanupErrors.push(error); }
      }
      if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Executive Reporting E2E cleanup failed.");
    });

    async function signIn(page, email) {
      const login = await page.request.post("/api/auth/login-request", { data: { email } });
      expect(login.ok()).toBe(true);
      const loginBody = await login.json();
      expect(loginBody.debugLink).toBeTruthy();
      await page.goto(loginBody.debugLink);
      await page.waitForURL(/dashboard\.html/, { timeout: 20_000 });
      await page.waitForSelector('[data-route="overview"]', { timeout: 20_000 });
      await page.waitForFunction(() => typeof window.navigate === "function");
      await page.waitForFunction(() => Boolean(window.STATE?.me?.orgId && window.STATE?.me?.userId), null, { timeout: 20_000 });
    }

    test("authenticated owners can personalize, view, and download reports; viewers and other tenants stay isolated", async ({ page, browser }) => {
      await signIn(page, ownerEmail);
      const meResponse = await page.request.get("/api/me");
      expect(meResponse.status()).toBe(200);
      expect((await meResponse.json()).addons?.aiExecutiveReport).toBe(true);
      await page.evaluate(() => window.navigate("reports"));
      await page.waitForFunction(() => window.STATE?.currentSection === "reports");
      await page.evaluate(() => window.navigateSub("exec"));
      await page.waitForFunction(() => window.STATE?.subRoute === "exec");
      await page.waitForSelector("#fp-ai-exec-subject");
      let submittedSubject = null;
      let simulateNoData = false;
      await page.route("**/api/reports/ai-executive-summary", async route => {
        submittedSubject = route.request().postDataJSON()?.subject ?? null;
        if (simulateNoData) {
          await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "Ajoutez des audits, monitors ou données analytiques avant de générer une synthèse.", code: "NO_REAL_DATA" }) });
          return;
        }
        await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, reportId, name: reportName, subject: submittedSubject, templateKey: "executive", summary: { headline: "Acquisition organique — résultats", summary: "Synthèse du rapport de test.", priorities: [] }, measured: {} }) });
      });
      await page.locator("#fp-ai-exec-subject").fill("Acquisition organique");
      await page.locator("#fp-ai-exec-generate").click();
      await page.waitForFunction(id => Array.isArray(window.STATE?.reports) && window.STATE.reports.some(row => String(row.id) === id), reportId);
      expect(submittedSubject).toBe("Acquisition organique");
      await expect(page.locator("#fp-ai-exec-subject")).toHaveValue("");
      simulateNoData = true;
      await page.locator("#fp-ai-exec-generate").click();
      await expect(page.getByText("Ajoutez des audits, monitors ou données analytiques avant de générer une synthèse.")).toBeVisible();
      simulateNoData = false;
      await page.evaluate(() => window.navigateSub(""));
      await page.waitForFunction(() => !window.STATE?.subRoute);
      await page.locator('[data-report-view="' + reportId + '"]').click();
      await expect(page.getByText("Sujet demandé : Acquisition organique")).toBeVisible();
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Télécharger le PDF" }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toContain("Acquisition organique");
      const pdf = await page.request.get("/api/reports/" + encodeURIComponent(reportId) + "/download");
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()["content-type"]).toContain("application/pdf");
      expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
      const ownerReports = await page.request.get("/api/reports");
      expect((await ownerReports.json()).some(row => row.id === foreignReportId)).toBe(false);
      expect((await page.request.get("/api/reports/" + encodeURIComponent(foreignReportId))).status()).toBe(404);
      expect((await page.request.get("/api/reports/" + encodeURIComponent(foreignReportId) + "/download")).status()).toBe(404);
      const viewerContext = await browser.newContext({ baseURL: process.env["E2E_BASE_URL"] ?? "http://127.0.0.1:8083", locale: "fr-FR", timezoneId: "Europe/Brussels" });
      try {
        const viewerPage = await viewerContext.newPage();
        await signIn(viewerPage, viewerEmail);
        expect((await viewerPage.request.get("/api/reports/" + encodeURIComponent(reportId))).status()).toBe(200);
        const denied = await viewerPage.request.post("/api/reports/ai-executive-summary", { data: { subject: "Acquisition organique" } });
        expect(denied.status()).toBe(403);
      } finally {
        await viewerContext.close();
      }
    });
    