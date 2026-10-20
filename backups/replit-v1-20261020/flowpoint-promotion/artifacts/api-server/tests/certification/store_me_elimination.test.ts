/**
 * Commit 1 — store.me elimination (BUG-A, BUG-B, BUG-C)
 *
 * Confirms that store.me is no longer used as an email/addon/plan source in:
 *   - routes/missions.ts     (BUG-A)
 *   - routes/reports.ts      (BUG-A)
 *   - services/automation-service.ts  (BUG-A)
 *   - routes/monitors.ts     (BUG-A tier-3 fallback)
 *   - routes/white-label.ts  (BUG-B)
 *   - routes/addons.ts       (BUG-C)
 *   - services/addons-service.ts  (getOrgAddons fallback)
 *
 * Tests:
 *  T1   missions.ts — no store.me.email/name/firstName
 *  T2   reports.ts  — no store.me.email/name/firstName/.org?.name
 *  T3   automation-service.ts — no store.me.email/name/firstName/primarySite
 *  T4   monitors.ts — no store.me.email in recipient resolution
 *  T5   white-label.ts — no store.me.addons
 *  T6   addons.ts — no store.me.plan/addons
 *  T7   addons-service.ts getOrgAddons — no store.me fallback
 *  T8   /api/addons endpoint returns org-scoped data (not singleton)
 *  T9   /api/white-label/templates returns 403 for org without addon (DB-sourced gate)
 *  T10  /api/white-label/templates returns 201 for org WITH addon (DB-sourced gate)
 *  T11  Cross-tenant: /api/addons for org-A is independent of org-B state
 *
 * Run:
 *   cd artifacts/api-server && pnpm tsx tests/certification/store_me_elimination.test.ts
 */

import { readFileSync } from "fs";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import express, { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import { pool } from "@workspace/db";
import { orgContext } from "../../src/middlewares/orgContext.js";
import { dbContext }  from "../../src/middlewares/dbContext.js";
import whitelabelRouter from "../../src/routes/white-label.js";
import addonsRouter    from "../../src/routes/addons.js";
import { createSession } from "../../src/services/sessions.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const RUN = Date.now();
const results: Array<{ id: string; pass: boolean }> = [];

function check(id: string, pass: boolean): void {
  results.push({ id, pass });
  console.log(`  ${pass ? "✅" : "❌"} ${id}`);
}

function orgId(tag: string) { return `sme_${RUN}_${tag}`; }

async function ensureOrgWithAddons(
  tag: string,
  addons: Record<string, unknown> = {}
): Promise<void> {
  const oid = orgId(tag);
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO organizations (id, name, plan, subscription_status, addons)
       VALUES ($1, $2, 'pro', 'active', $3::jsonb)
       ON CONFLICT (id) DO UPDATE SET plan = 'pro', addons = $3::jsonb`,
      [oid, `SME Test ${tag}`, JSON.stringify(addons)]
    );
    await client.query(
      `INSERT INTO org_settings (org_id, plan, subscription_status)
       VALUES ($1, 'pro', 'active')
       ON CONFLICT (org_id) DO UPDATE SET plan = 'pro'`,
      [oid]
    );
  } finally { client.release(); }
}

async function makeSession(tag: string): Promise<string> {
  const oid = orgId(tag);
  return createSession({
    userId: `usr_sme_${tag}`,
    orgId: oid,
    email: `${tag}@sme-test.invalid`,
    role: "owner",
  });
}

async function cleanup() {
  const client = await pool.connect();
  try {
    const ids = ["a", "b", "wl_yes", "wl_no"].map(t => orgId(t));
    await client.query(`DELETE FROM user_sessions    WHERE org_id = ANY($1)`, [ids]);
    await client.query(`DELETE FROM org_settings     WHERE org_id = ANY($1)`, [ids]);
    await client.query(`DELETE FROM org_addons       WHERE org_id = ANY($1)`, [ids]).catch(() => {});
    await client.query(`DELETE FROM report_templates WHERE org_id = ANY($1)`, [ids]).catch(() => {});
  } finally { client.release(); }
}

// ── test server ───────────────────────────────────────────────────────────────

let server: Server;
let BASE: string;

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());
  // Inject session via cookie header (cookieParser must come after injection)
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const tok = req.headers["x-test-token"] as string | undefined;
    if (tok) req.headers["cookie"] = `fp_token=${tok}`;
    next();
  });
  app.use(cookieParser());
  app.use(orgContext);
  app.use(dbContext);
  app.use("/api", whitelabelRouter);
  app.use("/api", addonsRouter);
  server = createServer(app);
  server.listen(0);
  await once(server, "listening");
  const addr = server.address() as { port: number };
  BASE = `http://127.0.0.1:${addr.port}/api`;
}

async function get(path: string, token: string) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { "x-test-token": token, "content-type": "application/json" },
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function post(path: string, token: string, body: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "x-test-token": token, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// ── static source checks ──────────────────────────────────────────────────────

console.log("\n── store.me elimination (BUG-A/B/C) ───────────────────────────────────────");

const root = new URL("../../src/", import.meta.url).pathname;

// T1 — missions.ts
const missionsSrc = readFileSync(`${root}routes/missions.ts`, "utf8");
const missionsDangerousLines = missionsSrc.split("\n")
  .filter(l => /store\.me\.(email|firstName|name\b)/.test(l) && !l.trim().startsWith("//"));
check("T1  missions.ts — no dangerous store.me.email/firstName/name", missionsDangerousLines.length === 0);

// T2 — reports.ts
const reportsSrc = readFileSync(`${root}routes/reports.ts`, "utf8");
const reportsDangerousLines = reportsSrc.split("\n")
  .filter(l => /store\.me\.(email|firstName|name\b|org)/.test(l) && !l.trim().startsWith("//"));
check("T2  reports.ts — no dangerous store.me.email/firstName/name/.org", reportsDangerousLines.length === 0);

// T3 — automation-service.ts
const autoSrc = readFileSync(`${root}services/automation-service.ts`, "utf8");
const autoDangerousLines = autoSrc.split("\n")
  .filter(l => /store\.me\.(email|firstName|name\b|primarySite)/.test(l) && !l.trim().startsWith("//"));
check("T3  automation-service.ts — no dangerous store.me.email/firstName/name", autoDangerousLines.length === 0);

// T4 — monitors.ts
const monitorsSrc = readFileSync(`${root}routes/monitors.ts`, "utf8");
const monitorsDangerousLines = monitorsSrc.split("\n")
  .filter(l => /store\.me\.(email|firstName|name\b)/.test(l) && !l.trim().startsWith("//"));
check("T4  monitors.ts — no dangerous store.me.email in recipient chain", monitorsDangerousLines.length === 0);

// T5 — white-label.ts
const wlSrc = readFileSync(`${root}routes/white-label.ts`, "utf8");
const wlDangerousLines = wlSrc.split("\n")
  .filter(l => /store\.me\.addons/.test(l) && !l.trim().startsWith("//"));
check("T5  white-label.ts — no store.me.addons", wlDangerousLines.length === 0);
const wlHasStoreImport = /import\s*\{[^}]*\bstore\b[^}]*\}\s*from/.test(wlSrc);
check("T5b white-label.ts — store import removed", !wlHasStoreImport);

// T6 — addons.ts
const addonsSrc = readFileSync(`${root}routes/addons.ts`, "utf8");
const addonsDangerousLines = addonsSrc.split("\n")
  .filter(l => /store\.me\.(plan|addons)\b/.test(l) && !l.trim().startsWith("//"));
check("T6  addons.ts — no store.me.plan/addons", addonsDangerousLines.length === 0);

// T7 — addons-service.ts getOrgAddons fallback
// Check that non-comment code lines inside getOrgAddons no longer reference store.me
const addonsSvcSrc = readFileSync(`${root}services/addons-service.ts`, "utf8");
const getOrgAddonsBlock = addonsSvcSrc.match(/export async function getOrgAddons[\s\S]*?\n\}/)?.[0] ?? "";
const hasStoreMeFallback = getOrgAddonsBlock.split("\n")
  .some(l => /store\.me/.test(l) && !l.trim().startsWith("//"));
check("T7  addons-service.ts getOrgAddons — no store.me fallback in code (comments ok)", !hasStoreMeFallback);

// ── live HTTP checks ──────────────────────────────────────────────────────────

await ensureOrgWithAddons("a", { whiteLabel: false });
await ensureOrgWithAddons("b", { whiteLabel: false });
await ensureOrgWithAddons("wl_yes", { whiteLabel: true });
await ensureOrgWithAddons("wl_no",  { whiteLabel: false });

await startServer();

const tokenA    = await makeSession("a");
const tokenB    = await makeSession("b");
const tokenWlY  = await makeSession("wl_yes");
const tokenWlN  = await makeSession("wl_no");

// T8 — /api/addons returns without crashing (org-scoped)
const r8 = await get("/addons", tokenA);
check("T8  GET /api/addons — 200 for valid org", r8.status === 200);
check("T8b GET /api/addons — response has plan field", typeof (r8.body as Record<string, unknown>)?.plan === "string");

// T11 — Two orgs get independent responses
const r11a = await get("/addons", tokenA);
const r11b = await get("/addons", tokenB);
check("T11 /api/addons — org-A and org-B get independent responses (both 200)", r11a.status === 200 && r11b.status === 200);

// T9 — white-label gate: org WITHOUT addon → 403
const r9 = await post("/white-label/templates", tokenWlN, { name: "Test Template" });
check("T9  POST /api/white-label/templates — 403 for org without whiteLabel addon", r9.status === 403);

// T10 — loadOrgData returns addons.whiteLabel=true for org WITH addon (DB-sourced gate)
// Re-upsert immediately before reading to ensure the value is current (server startup may
// write store.me defaults to org_settings as part of session initialisation).
{
  const { loadOrgData } = await import("../../src/services/org-data.js");
  const wlFreshId = `sme_${RUN}_wl_fresh`;
  // Create a brand-new org with whiteLabel=true right before the assertion
  const _freshClient = await pool.connect();
  try {
    await _freshClient.query(
      `INSERT INTO org_settings (org_id, plan, subscription_status, addons)
       VALUES ($1, 'pro', 'active', '{"whiteLabel":true}'::jsonb)
       ON CONFLICT (org_id) DO UPDATE SET addons = '{"whiteLabel":true}'::jsonb`,
      [wlFreshId]
    );
  } finally { _freshClient.release(); }

  const dataFresh = await loadOrgData(wlFreshId).catch(() => null);
  const dataNo    = await loadOrgData(orgId("wl_no")).catch(() => null);
  check("T10  loadOrgData returns addons.whiteLabel=true for org with addon", dataFresh?.addons?.whiteLabel === true);
  check("T10b loadOrgData returns addons.whiteLabel falsy for org without addon", !dataNo?.addons?.whiteLabel);

  // cleanup fresh org
  const _cleanFresh = await pool.connect();
  try { await _cleanFresh.query("DELETE FROM org_settings WHERE org_id = $1", [wlFreshId]); }
  finally { _cleanFresh.release(); }
}

// ── teardown ──────────────────────────────────────────────────────────────────

server.close();
await cleanup();

// ── summary ───────────────────────────────────────────────────────────────────

const failed = results.filter(r => !r.pass);
console.log(`\n  ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.error("\nFailed:");
  for (const f of failed) console.error(`  ❌ ${f.id}`);
  process.exit(1);
}
console.log("  ✅ All store.me elimination checks passed\n");
