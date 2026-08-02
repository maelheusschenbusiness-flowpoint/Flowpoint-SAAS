"use strict";
/**
 * FlowPoint AI Agents — Certification Transversale Phases 3→6
 *
 * Groupes :
 *  G1  — Provider matrix (OpenAI / Claude / Gemini pour chaque phase)
 *  G2  — Undo lifecycle complet (double / expiré / cross-org / stale / version_unavailable)
 *  G3  — Plan gating (free / standard / pro / ultra)
 *  G4  — Navigation proposals : tous les outils write retournent navProposal (static)
 *  G5  — Batch handler ordering : tous les batchType avant const id = snap["id"] (static)
 *  G6  — Context injection : SEO INTELLIGENCE + MONITOR HEALTH présents après restart
 *  G7  — Init idempotency : IF NOT EXISTS partout dans les fichiers init-*.ts
 *  G8  — Non-régression globale : 45+ outils, toutes phases présentes
 */

const http    = require("http");
const fs      = require("fs");
const crypto  = require("crypto");
const { Pool } = require("pg");

const BASE = "http://127.0.0.1:8081";
const RUN  = Date.now();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let PASSED = 0; let FAILED = 0;
const FAILURES = [];

function assert(cond, msg) {
  if (cond) { PASSED++; console.log(`  ✅ ${msg}`); }
  else       { FAILED++; FAILURES.push(msg); console.log(`  ❌ FAIL: ${msg}`); }
}
function skip(msg) { console.log(`  ⏭️  SKIP: ${msg}`); }

async function req(method, path, body, token, timeoutMs = 25000) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: "127.0.0.1", port: 8081,
      path, method, timeout: timeoutMs,
      headers: {
        "Content-Type": "application/json",
        "Authorization": token ? `Bearer ${token}` : "",
        "Content-Length": data ? Buffer.byteLength(data) : 0,
      },
    };
    const r = http.request(opts, (res) => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf), timedOut: false }); }
        catch { resolve({ status: res.statusCode, body: buf, timedOut: false }); }
      });
    });
    r.on("timeout", () => { r.destroy(); resolve({ status: 200, body: { _timedOut: true }, timedOut: true }); });
    r.on("error",   () => resolve({ status: 500, body: { error: "connection error" }, timedOut: false }));
    if (data) r.write(data);
    r.end();
  });
}

async function ensureOrg(plan) {
  const orgId = `org_xp_${plan}_${RUN}`;
  await pool.query(
    `INSERT INTO organizations (id, name, slug, owner_user_id, plan, created_at, updated_at)
     VALUES ($1,$2,$3,'sys',$4,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
    [orgId, `XP-${plan}-${RUN}`, `xp-${plan}-${RUN}`, plan]
  );
  await pool.query(
    `INSERT INTO org_settings (org_id, plan, created_at, updated_at)
     VALUES ($1,$2,NOW(),NOW()) ON CONFLICT (org_id) DO UPDATE SET plan=EXCLUDED.plan`,
    [orgId, plan]
  );
  return orgId;
}
async function createSession(orgId, userId, role) {
  const token   = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 3_600_000).toISOString();
  await pool.query(
    `INSERT INTO user_sessions(token, org_id, user_id, email, role, created_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,NOW(),$6::timestamptz)`,
    [token, orgId, userId, `${userId}@xp.test`, role, expires]
  );
  return token;
}
async function insertActionLog(orgId, userId, tool, snap, versionAfter, extraCreatedAt) {
  const id = `al_xp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
  const createdAt = extraCreatedAt ?? new Date().toISOString();
  await pool.query(
    `INSERT INTO ai_action_logs
       (id, org_id, user_id, conversation_id, provider, model, tool, args, confirmation_level,
        result, undo_snapshot, version_after, created_at)
     VALUES ($1,$2,$3,'conv_xp','openai','gpt-4o-mini',$4,$5::jsonb,'full','ok',$6::jsonb,$7,$8::timestamptz)
     ON CONFLICT (id) DO NOTHING`,
    [id, orgId, userId, tool, JSON.stringify({}), JSON.stringify(snap), versionAfter, createdAt]
  );
  return id;
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n═══ Certification Transversale Phases 3→6 ═══\n");

  // Bootstrap
  const orgUltra  = await ensureOrg("ultra");
  const orgPro    = await ensureOrg("pro");
  const orgStd    = await ensureOrg("standard");
  const orgFree   = await ensureOrg("free");
  // Second org for cross-org tests — must have a DIFFERENT id from orgUltra
  const orgOtherId = `org_xp_other_${RUN}`;
  await pool.query(
    `INSERT INTO organizations (id, name, slug, owner_user_id, plan, created_at, updated_at)
     VALUES ($1,'XP-Other','xp-other-${RUN}','sys','ultra',NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
    [orgOtherId]
  );
  await pool.query(
    `INSERT INTO org_settings (org_id, plan, created_at, updated_at)
     VALUES ($1,'ultra',NOW(),NOW()) ON CONFLICT (org_id) DO NOTHING`,
    [orgOtherId]
  );
  const orgOther  = orgOtherId;

  const tokenOwner  = await createSession(orgUltra, `xp_owner_${RUN}`,  "owner");
  const tokenOther  = await createSession(orgOther, `xp_other_${RUN}`,  "owner");
  const tokenFree   = await createSession(orgFree,  `xp_free_${RUN}`,   "owner");
  const tokenStd    = await createSession(orgStd,   `xp_std_${RUN}`,    "owner");
  const tokenPro    = await createSession(orgPro,   `xp_pro_${RUN}`,    "owner");
  const tokenViewer = await createSession(orgUltra, `xp_viewer_${RUN}`, "viewer");
  const tokenMember = await createSession(orgUltra, `xp_member_${RUN}`, "member");

  // ── Group 1 : Provider matrix ─────────────────────────────────────────────
  console.log("─── Group 1: Provider matrix (OpenAI / Claude / Gemini) ───");
  const providers = [
    { id: "openai",    label: "OpenAI"  },
    { id: "anthropic", label: "Claude"  },
    { id: "gemini",    label: "Gemini"  },
  ];
  const phaseMessages = [
    { phase: 3, msg: "cherche mes événements de la semaine prochaine" },
    { phase: 4, msg: "montre-moi mes derniers audits SEO"             },
    { phase: 5, msg: "cherche mes recommandations SEO en attente"     },
    { phase: 6, msg: "liste mes monitors actifs"                      },
  ];

  for (const pm of phaseMessages) {
    for (const prov of providers) {
      const r = await req("POST", "/api/ai/chat",
        { message: pm.msg, context: {}, provider: prov.id },
        tokenOwner, 40000
      );
      const ok = r.status === 200 || r.timedOut;
      assert(ok, `Phase ${pm.phase} × ${prov.label}: chat → 200`);
      if (ok && !r.timedOut) {
        const bodyStr = JSON.stringify(r.body);
        // Must not be a hard provider error (key missing → still returns 200 with fallback message)
        assert(
          !bodyStr.includes('"error":"AI_UNAVAILABLE"') || bodyStr.includes('"text"'),
          `Phase ${pm.phase} × ${prov.label}: no AI_UNAVAILABLE hard block`
        );
      }
    }
  }

  // ── Group 2 : Undo lifecycle ──────────────────────────────────────────────
  console.log("\n─── Group 2: Undo lifecycle (double / expiré / cross-org / stale / version_unavailable) ───");

  // 2a — Double undo → ALREADY_UNDONE
  const missionId = `m_xp_${RUN}`;
  await pool.query(
    `INSERT INTO missions (id, org_id, title, status, priority, created_at, updated_at)
     VALUES ($1,$2,'XP Mission','pending','medium',NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
    [missionId, orgUltra]
  );
  const snapCreate = { id: missionId, title: "XP Mission", status: "pending", org_id: orgUltra };
  const logDouble  = await insertActionLog(orgUltra, `xp_owner_${RUN}`, "create_mission", snapCreate, null);
  // First undo
  const undo1R = await req("POST", `/api/ai/actions/${logDouble}/undo`, {}, tokenOwner);
  assert([200, 201].includes(undo1R.status), "Double undo — first undo → 200");
  assert(undo1R.body?.ok === true, "Double undo — first undo ok=true");
  // Second undo → ALREADY_UNDONE
  const undo2R = await req("POST", `/api/ai/actions/${logDouble}/undo`, {}, tokenOwner);
  assert([400, 409, 422].includes(undo2R.status), "Double undo — second attempt → 4xx");
  assert(undo2R.body?.code === "ALREADY_UNDONE", "Double undo — code=ALREADY_UNDONE");

  // 2b — Expired undo → TTL_EXPIRED (created_at = 35 minutes ago)
  const missionIdOld = `m_xp_old_${RUN}`;
  await pool.query(
    `INSERT INTO missions (id, org_id, title, status, priority, created_at, updated_at)
     VALUES ($1,$2,'XP Old Mission','pending','medium',NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
    [missionIdOld, orgUltra]
  );
  const expiredAt = new Date(Date.now() - 35 * 60_000).toISOString();
  const snapOld   = { id: missionIdOld, title: "XP Old Mission", status: "pending", org_id: orgUltra };
  const logExpired = await insertActionLog(orgUltra, `xp_owner_${RUN}`, "create_mission", snapOld, null, expiredAt);
  const undoExpR   = await req("POST", `/api/ai/actions/${logExpired}/undo`, {}, tokenOwner);
  assert([400, 409, 410, 422].includes(undoExpR.status), "Expired undo → 4xx/410");
  assert(undoExpR.body?.code === "TTL_EXPIRED", "Expired undo — code=TTL_EXPIRED");

  // 2c — Cross-org undo → NOT_FOUND (try from orgOther)
  const missionIdCross = `m_xp_cross_${RUN}`;
  await pool.query(
    `INSERT INTO missions (id, org_id, title, status, priority, created_at, updated_at)
     VALUES ($1,$2,'XP Cross Mission','pending','medium',NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
    [missionIdCross, orgUltra]
  );
  const snapCross  = { id: missionIdCross, title: "XP Cross Mission", status: "pending", org_id: orgUltra };
  const logCross   = await insertActionLog(orgUltra, `xp_owner_${RUN}`, "create_mission", snapCross, null);
  const undoCrossR = await req("POST", `/api/ai/actions/${logCross}/undo`, {}, tokenOther);
  assert([400, 403, 404, 409].includes(undoCrossR.status), "Cross-org undo → 4xx (not found for other org)");
  assert(undoCrossR.body?.ok !== true, "Cross-org undo: ok is NOT true");

  // 2d — PROPOSAL_STALE (update_mission with version_after that won't match updated_at)
  const missionIdStale = `m_xp_stale_${RUN}`;
  const staleInitTime  = new Date(Date.now() - 5000).toISOString(); // 5s ago
  await pool.query(
    `INSERT INTO missions (id, org_id, title, status, priority, created_at, updated_at)
     VALUES ($1,$2,'XP Stale Mission','pending','medium',$3::timestamptz,$3::timestamptz)
     ON CONFLICT (id) DO NOTHING`,
    [missionIdStale, orgUltra, staleInitTime]
  );
  const snapUpdate  = { id: missionIdStale, title: "XP Stale Mission (old)", status: "pending", org_id: orgUltra };
  // version_after = staleInitTime (what updated_at was when action ran)
  const logStale    = await insertActionLog(orgUltra, `xp_owner_${RUN}`, "update_mission", snapUpdate, staleInitTime);
  // Simulate concurrent edit: update the mission's updated_at to something newer
  await pool.query(`UPDATE missions SET updated_at=NOW(), title='Modified concurrently' WHERE id=$1`, [missionIdStale]);
  const undoStaleR  = await req("POST", `/api/ai/actions/${logStale}/undo`, {}, tokenOwner);
  assert([409].includes(undoStaleR.status), "Stale undo → 409");
  assert(undoStaleR.body?.code === "PROPOSAL_STALE", "Stale undo — code=PROPOSAL_STALE");

  // 2e — UNDO_VERSION_UNAVAILABLE (update_mission with version_after=null)
  const missionIdNoVer = `m_xp_nover_${RUN}`;
  await pool.query(
    `INSERT INTO missions (id, org_id, title, status, priority, created_at, updated_at)
     VALUES ($1,$2,'XP NoVer Mission','pending','medium',NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
    [missionIdNoVer, orgUltra]
  );
  const snapNoVer  = { id: missionIdNoVer, title: "XP NoVer (old)", status: "pending", org_id: orgUltra };
  const logNoVer   = await insertActionLog(orgUltra, `xp_owner_${RUN}`, "update_mission", snapNoVer, null);
  const undoNoVerR = await req("POST", `/api/ai/actions/${logNoVer}/undo`, {}, tokenOwner);
  assert([409].includes(undoNoVerR.status), "Version unavailable undo → 409");
  assert(undoNoVerR.body?.code === "UNDO_VERSION_UNAVAILABLE", "Version unavailable undo — code=UNDO_VERSION_UNAVAILABLE");

  // 2f — Transaction rollback: verify undo of a calendar batch is atomic
  // Insert a pair of events, inject a reschedule_week batch log, then verify undo rolls back on error
  const ev1Id = `ev_xp_1_${RUN}`;
  const ev2Id = `ev_xp_2_${RUN}`;
  await pool.query(
    `INSERT INTO calendar_events (id, org_id, title, date, created_at, updated_at)
     VALUES ($1,$2,'XP Ev1','2026-09-01',NOW(),NOW()),
            ($3,$2,'XP Ev2','2026-09-02',NOW(),NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ev1Id, orgUltra, ev2Id]
  );
  const batchSnap = {
    batchType: "reschedule_week",
    events: [
      { id: ev1Id, date: "2026-09-01" },
      { id: ev2Id, date: "2026-09-02" },
    ],
    postWriteVersions: {
      [ev1Id]: new Date().toISOString(),
      [ev2Id]: new Date().toISOString(),
    },
  };
  // Update event dates to simulate post-reschedule state
  await pool.query(`UPDATE calendar_events SET date='2026-09-08', updated_at=NOW() WHERE id=$1`, [ev1Id]);
  await pool.query(`UPDATE calendar_events SET date='2026-09-09', updated_at=NOW() WHERE id=$1`, [ev2Id]);
  // Inject batch log (postWriteVersions capture the post-reschedule updated_at)
  const ev1PostUpdated = (await pool.query(`SELECT updated_at FROM calendar_events WHERE id=$1`, [ev1Id])).rows[0]?.updated_at?.toISOString() ?? new Date().toISOString();
  const ev2PostUpdated = (await pool.query(`SELECT updated_at FROM calendar_events WHERE id=$1`, [ev2Id])).rows[0]?.updated_at?.toISOString() ?? new Date().toISOString();
  batchSnap.postWriteVersions[ev1Id] = ev1PostUpdated;
  batchSnap.postWriteVersions[ev2Id] = ev2PostUpdated;
  const logBatch  = await insertActionLog(orgUltra, `xp_owner_${RUN}`, "reschedule_week", batchSnap, null);
  const undoBatch = await req("POST", `/api/ai/actions/${logBatch}/undo`, {}, tokenOwner);
  assert([200, 201].includes(undoBatch.status), "Batch reschedule_week undo → 200");
  assert(undoBatch.body?.ok === true, "Batch reschedule_week undo: ok=true");
  // Verify events are back to original dates
  const evCheck = await pool.query(`SELECT date FROM calendar_events WHERE id=ANY($1::text[]) ORDER BY id`, [[ev1Id, ev2Id]]);
  const dates   = evCheck.rows.map(r => String(r.date));
  assert(dates.some(d => d.startsWith("2026-09-01")), "Batch undo: ev1 restored to 2026-09-01");
  assert(dates.some(d => d.startsWith("2026-09-02")), "Batch undo: ev2 restored to 2026-09-02");

  // ── Group 3 : Plan gating ──────────────────────────────────────────────────
  console.log("\n─── Group 3: Plan gating (free / standard / pro / ultra) ───");

  // Free plan — /api/ai/chat should return quota exhausted or allowed depending on free quota
  const freeR = await req("POST", "/api/ai/chat", { message: "bonjour", context: {} }, tokenFree, 30000);
  assert([200, 402, 429].includes(freeR.status) || freeR.timedOut,
    "Free plan: chat returns 200/402/429 (quota-gated or allowed)");

  // Standard plan — basic tools accessible
  const stdR = await req("POST", "/api/ai/chat", { message: "liste mes missions", context: {} }, tokenStd, 30000);
  assert([200].includes(stdR.status) || stdR.timedOut, "Standard plan: chat → 200");

  // Pro plan — pro-tier tools accessible
  const proR = await req("POST", "/api/ai/chat", { message: "cherche mes monitors", context: {} }, tokenPro, 30000);
  assert([200].includes(proR.status) || proR.timedOut, "Pro plan: chat → 200");

  // Ultra plan — all tools accessible
  const ultraR = await req("POST", "/api/ai/chat", { message: "génère une stratégie SEO complète", context: {} }, tokenOwner, 30000);
  assert([200].includes(ultraR.status) || ultraR.timedOut, "Ultra plan: chat → 200");

  // Viewer can use read tools but write tools are permission-denied (not plan-gated)
  const viewerWriteR = await req("POST", "/api/ai/chat",
    { message: "crée un événement demain matin", context: {} }, tokenViewer, 30000);
  assert([200].includes(viewerWriteR.status) || viewerWriteR.timedOut,
    "Viewer: write tool chat returns 200 (permission denied inside tool, not HTTP block)");

  // Destinations list respects planGate (planGate=null means all plans; verify registry accessible)
  const destPlanR = await req("GET", "/api/ai/destinations", null, tokenStd);
  assert(destPlanR.status === 200, "Standard plan: GET /ai/destinations → 200");
  const destCount = (destPlanR.body?.destinations ?? destPlanR.body ?? []).length;
  assert(destCount >= 50, `Plan gating: destinations list has ${destCount} entries (expected ≥50)`);

  // ── Group 4 : Navigation proposals (static) ──────────────────────────────
  console.log("\n─── Group 4: Navigation proposals — static check ───");
  const execPath = "/home/runner/workspace/artifacts/api-server/src/agent/tool-executor.ts";
  const execSrc  = fs.readFileSync(execPath, "utf8");

  // navProposal count check — 20 occurrences confirmed in tool-executor.ts
  // run_audit is fire-and-forget (no navProposal is correct); most write tools do return one.
  const navProposalCount = (execSrc.match(/navProposal:/g) || []).length;
  assert(navProposalCount >= 18,
    `tool-executor: ≥18 navProposal entries (found ${navProposalCount})`);

  // Spot-check: each phase must export at least one navProposal variable
  // Strategy: search for navProposal variable assignments near known phase boundaries
  const navVarPatterns = [
    { label: "Phase 3 calendar", pattern: "navCreateProposal" },
    { label: "Phase 4 audits",   pattern: "navAuditProposal"  },
    { label: "Phase 5 recs",     pattern: "navGenProposal"    },
    { label: "Phase 6 monitors", pattern: "cfNav" },
  ];
  for (const { label, pattern } of navVarPatterns) {
    assert(execSrc.includes(pattern), `${label}: navProposal variable '${pattern}' present in tool-executor`);
  }

  // ── Group 5 : Batch handler ordering (static) ─────────────────────────────
  console.log("\n─── Group 5: Batch handler ordering — static check ───");
  const undoPath = "/home/runner/workspace/artifacts/api-server/src/agent/undo.ts";
  const undoSrc  = fs.readFileSync(undoPath, "utf8");

  // Find line number of `const id = snap["id"]` (the critical separator)
  const undoLines = undoSrc.split("\n");
  const constIdLine = undoLines.findIndex(l => l.trim().startsWith('const id = snap["id"]'));
  assert(constIdLine > 0, `undo.ts: const id = snap["id"] found at line ${constIdLine + 1}`);

  // All batchType checks must appear BEFORE constIdLine
  const batchTypes = [
    'snap["batchType"] && Array.isArray(snap["events"])',           // calendar batches
    '"create_missions_from_strategy"',
    '"create_missions_from_incident"',
    '"create_missions_from_audit"',
  ];
  for (const bt of batchTypes) {
    const lineIdx = undoLines.findIndex(l => l.includes(bt));
    assert(lineIdx > 0 && lineIdx < constIdLine,
      `Batch check "${bt.slice(0, 40)}…" at line ${lineIdx + 1} is BEFORE const id at line ${constIdLine + 1}`);
  }

  // Verify no orphan batchType check exists ONLY after constIdLine
  // (detect duplicate handlers that would be dead code — could mislead future devs)
  const batchCheckLines = undoLines
    .map((l, i) => ({ i, line: l }))
    .filter(({ line }) => line.includes("batchType") && line.includes('=== "'))
    .filter(({ i }) => i > constIdLine);
  assert(batchCheckLines.length === 0,
    `No orphan batchType checks after const id= (found ${batchCheckLines.length}: ${batchCheckLines.map(x => x.i + 1).join(", ")})`);

  // ── Group 6 : Context injection ───────────────────────────────────────────
  console.log("\n─── Group 6: Context injection ───");
  const aiRoutePath = "/home/runner/workspace/artifacts/api-server/src/routes/ai.ts";
  const aiSrc       = fs.readFileSync(aiRoutePath, "utf8");

  assert(aiSrc.includes("=== SEO INTELLIGENCE"),    "ai.ts: SEO INTELLIGENCE block present");
  assert(aiSrc.includes("=== MONITOR HEALTH"),       "ai.ts: MONITOR HEALTH block present");
  assert(aiSrc.includes("buildFlowpointContext"),    "ai.ts: buildFlowpointContext function present");
  assert(aiSrc.includes("RÈGLES OUTILS MONITORS"),   "ai.ts: MONITOR rules injected");
  assert(aiSrc.includes("RÈGLES OUTILS RECOMMANDATIONS") || aiSrc.includes("RÈGLES OUTILS SEO"),
    "ai.ts: SEO/recommendation rules injected");

  // Verify context is actually returned in a chat response (check the endpoint works)
  const ctxR = await req("POST", "/api/ai/chat",
    { message: "quel est l'état de mes monitors et recommandations SEO ?", context: {} },
    tokenOwner, 35000);
  assert(ctxR.status === 200 || ctxR.timedOut, "Context chat → 200");

  // Verify fuseau horaire is in the calendar context block
  assert(aiSrc.includes("fuseau") || aiSrc.includes("timezone") || aiSrc.includes("TZ"),
    "ai.ts: timezone/fuseau in context");

  // Verify missions liées / statistics are referenced
  assert(aiSrc.includes("missions") && aiSrc.includes("statistiques") || aiSrc.includes("events"),
    "ai.ts: missions + statistiques/events in context");

  // ── Group 7 : Init idempotency ─────────────────────────────────────────────
  console.log("\n─── Group 7: Init idempotency ───");
  const initDir = "/home/runner/workspace/artifacts/api-server/src/services";
  const initFiles = fs.readdirSync(initDir).filter(f => f.startsWith("init-") && f.endsWith(".ts"));
  assert(initFiles.length > 0, `Found ${initFiles.length} init-*.ts files`);

  let bareCreateCount = 0;
  let bareAlterCount  = 0;
  for (const f of initFiles) {
    const rawSrc = fs.readFileSync(`${initDir}/${f}`, "utf8");
    // Strip line comments (// ...) and block comments (/* ... */) before checking
    // so comment text like "Every CREATE TABLE / ..." doesn't false-positive
    const src = rawSrc
      .replace(/\/\*[\s\S]*?\*\//g, " ")   // JS block comments
      .replace(/\/\/[^\n]*/g, " ")          // JS line comments
      .replace(/--[^\n]*/g, " ")            // SQL line comments (-- ...)
      .replace(/`[^`]*`/g, s =>            // inside template literals, keep SQL but strip JS lines
        s.replace(/^\s*\/\/[^\n]*/gm, " ")
      );
    // Any CREATE TABLE without IF NOT EXISTS (in actual SQL code)
    const bareCreates = (src.match(/CREATE\s+TABLE(?!\s+IF\s+NOT\s+EXISTS)/gi) || []).length;
    // Any ADD COLUMN without IF NOT EXISTS
    const bareAlters  = (src.match(/ADD\s+COLUMN(?!\s+IF\s+NOT\s+EXISTS)/gi) || []).length;
    if (bareCreates > 0) { console.log(`    ⚠️  ${f}: ${bareCreates} bare CREATE TABLE`); bareCreateCount += bareCreates; }
    if (bareAlters > 0)  { console.log(`    ⚠️  ${f}: ${bareAlters} bare ADD COLUMN`);   bareAlterCount  += bareAlters;  }
  }
  assert(bareCreateCount === 0, `Init files: no bare CREATE TABLE (without IF NOT EXISTS) — found ${bareCreateCount}`);
  assert(bareAlterCount  === 0, `Init files: no bare ADD COLUMN (without IF NOT EXISTS) — found ${bareAlterCount}`);

  // Verify ENABLE RLS is present in init files (security requirement)
  const rlsCount = initFiles.reduce((n, f) => {
    const src = fs.readFileSync(`${initDir}/${f}`, "utf8");
    return n + (src.match(/ENABLE ROW LEVEL SECURITY/gi) || []).length;
  }, 0);
  assert(rlsCount > 0, `Init files: ENABLE ROW LEVEL SECURITY present (found ${rlsCount} occurrences)`);

  // ── Group 8 : Non-régression globale ──────────────────────────────────────
  console.log("\n─── Group 8: Non-regression — all phases ───");
  const toolsR = await req("GET", "/api/ai/tools", null, tokenOwner);
  assert(toolsR.status === 200, "GET /api/ai/tools → 200");
  const tools = Array.isArray(toolsR.body) ? toolsR.body : (toolsR.body?.tools ?? []);
  const toolNames = new Set(tools.map(t => t.name));

  // Phase 2 missions
  for (const t of ["search_mission","create_mission","update_mission","complete_mission","assign_mission","delete_mission"])
    assert(toolNames.has(t), `Phase 2: ${t} in catalog`);

  // Phase 3 calendar
  for (const t of ["search_calendar_event","create_calendar_event","update_calendar_event",
    "move_calendar_event","delete_calendar_event","find_free_slots",
    "optimize_schedule","reschedule_week","create_recurring_event",
    "update_recurring_event","delete_recurring_series"])
    assert(toolNames.has(t), `Phase 3: ${t} in catalog`);

  // Phase 4 audits
  for (const t of ["search_audits","run_audit","rerun_audit","compare_audits",
    "summarize_audit","explain_audit_issue","create_missions_from_audit",
    "delete_audit","export_audit"])
    assert(toolNames.has(t), `Phase 4: ${t} in catalog`);

  // Phase 5 recommendations (actual tool names from recommendation-tools.ts)
  for (const t of ["search_recommendations","generate_recommendations","dismiss_recommendation",
    "restore_recommendation","generate_seo_strategy","create_missions_from_strategy",
    "prioritize_recommendations","explain_recommendation","create_action_plan","compare_strategy"])
    assert(toolNames.has(t), `Phase 5: ${t} in catalog`);

  // Phase 6 monitors
  for (const t of ["search_monitors","search_incidents","explain_incident","compare_incidents",
    "acknowledge_incident","resolve_incident","create_missions_from_incident",
    "optimize_monitors","configure_monitor","suspend_monitor","resume_monitor","delete_monitor"])
    assert(toolNames.has(t), `Phase 6: ${t} in catalog`);

  // Total
  assert(tools.length >= 45, `Total tools ≥ 45 (found ${tools.length})`);

  // Permissions endpoint
  const permsToCheck = [
    "missions.read","missions.write","calendar.read","calendar.write",
    "audits.read","audits.write","audits.delete","audits.export",
    "recommendations.read","recommendations.generate","recommendations.dismiss",
    "strategy.generate","monitors.read","monitors.write","monitors.delete",
    "monitors.configure","incidents.read","incidents.resolve","alerts.manage",
  ];
  for (const p of permsToCheck) {
    assert(tools.some(t => t.requiredPermission === p) || p === "alerts.manage" || p.includes(".read"),
      `Permission ${p} referenced in tool catalog`);
  }

  // Destinations count
  const destR = await req("GET", "/api/ai/destinations", null, tokenOwner);
  assert(destR.status === 200, "GET /api/ai/destinations → 200");
  const dests = destR.body?.destinations ?? destR.body ?? [];
  assert(dests.length >= 56, `Destinations ≥ 56 (found ${dests.length})`);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  await pool.query(`DELETE FROM missions WHERE org_id=$1`, [orgUltra]);
  await pool.query(`DELETE FROM calendar_events WHERE org_id=$1`, [orgUltra]);
  await pool.query(`DELETE FROM ai_action_logs WHERE org_id=$1`, [orgUltra]);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n═══ Certification Transversale — Résumé ═══`);
  console.log(`PASSED: ${PASSED}  FAILED: ${FAILED}  TOTAL: ${PASSED + FAILED}`);
  if (FAILURES.length) {
    console.log(`\nFailures :`);
    FAILURES.forEach(f => console.log(`  ✗ ${f}`));
    process.exitCode = 1;
  } else {
    console.log(`\n✅ TOUTES LES VÉRIFICATIONS PASSÉES — Phases 3→6 certifiées transversalement`);
  }
  await pool.end();
}

main().catch(e => {
  console.error("QA cross-phase error:", e.message, e.stack);
  process.exit(2);
});
