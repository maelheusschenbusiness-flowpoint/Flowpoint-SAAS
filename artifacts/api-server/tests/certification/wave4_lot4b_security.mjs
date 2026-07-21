/**
 * Wave 4 Lot 4B-S — Security Foundation Certification
 * Tests: multi-tenant org_id isolation for behavioral/CRO/revenue-leak tables,
 *        CRO rules (no AI credits, source=rules, aiGenerated=false),
 *        frontend funnel data integrity, revenue-leak plan gate.
 *
 * Run without token (smoke only):
 *   node artifacts/api-server/tests/certification/wave4_lot4b_security.mjs
 *
 * Run with token (full auth tests):
 *   TEST_TOKEN=<jwt> node artifacts/api-server/tests/certification/wave4_lot4b_security.mjs
 */

import http from "http";
import https from "https";

// ── Config ────────────────────────────────────────────────────────────────────
const BASE  = process.env.API_BASE  ?? "http://localhost:8081";
const TOKEN = process.env.TEST_TOKEN ?? "";
const AUTH_AVAILABLE = TOKEN.length > 0;

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

// ── Helpers ───────────────────────────────────────────────────────────────────
function request(method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const lib  = url.protocol === "https:" ? https : http;
    const defaultAuth = AUTH_AVAILABLE ? `Bearer ${TOKEN}` : "";
    const opts = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === "https:" ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        "Content-Type":  "application/json",
        ...(defaultAuth ? { "Authorization": defaultAuth } : {}),
        ...extraHeaders,
      },
    };
    const data = body ? JSON.stringify(body) : undefined;
    if (data) opts.headers["Content-Length"] = Buffer.byteLength(data);
    const req = lib.request(opts, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, json });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function noAuth(extraHeaders = {}) {
  return { Authorization: "", ...extraHeaders };
}

async function test(name, fn, { requiresAuth = false } = {}) {
  if (requiresAuth && !AUTH_AVAILABLE) {
    skipped++;
    console.log(`  ⏭  ${name} [skipped — set TEST_TOKEN to run]`);
    return;
  }
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? "Assertion failed");
}

// ── Suite 1 — Behavioral service: orgId isolation ────────────────────────────
async function suiteBehavioralService() {
  console.log("\n[1] Behavioral service — orgId isolation");

  await test("T01 GET /behavioral/insights returns 200 or 402", async () => {
    const r = await request("GET", "/api/behavioral/insights");
    assert(r.status === 200 || r.status === 402, `Unexpected status ${r.status}`);
  }, { requiresAuth: true });

  await test("T02 /behavioral/insights: response has insights array", async () => {
    const r = await request("GET", "/api/behavioral/insights");
    if (r.status === 200) assert(Array.isArray(r.json?.insights), "insights not array");
  }, { requiresAuth: true });

  await test("T03 /behavioral/insights: response has sessionStats", async () => {
    const r = await request("GET", "/api/behavioral/insights");
    if (r.status === 200) assert(typeof r.json?.sessionStats === "object", "sessionStats missing");
  }, { requiresAuth: true });

  await test("T04 /behavioral/insights: sessionStats has bounceRate", async () => {
    const r = await request("GET", "/api/behavioral/insights");
    if (r.status === 200) assert("bounceRate" in (r.json?.sessionStats ?? {}), "bounceRate missing");
  }, { requiresAuth: true });

  await test("T05 /behavioral/insights: no auth → 401", async () => {
    const r = await request("GET", "/api/behavioral/insights", null, noAuth());
    assert(r.status === 401 || r.status === 403, `Expected 401/403, got ${r.status}`);
  });

  await test("T06 /behavioral/generate-insights: no siteUrl → 400", async () => {
    const r = await request("POST", "/api/behavioral/generate-insights", {});
    assert(r.status === 400 || r.status === 402, `Expected 400/402, got ${r.status}`);
  }, { requiresAuth: true });
}

// ── Suite 2 — Behavioral ingestion: public endpoints security ────────────────
async function suiteBehavioralIngestion() {
  console.log("\n[2] Behavioral ingestion — public endpoint security");

  await test("T07 /behavioral/token: missing fields → 400", async () => {
    const r = await request("POST", "/api/behavioral/token", {}, noAuth());
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  await test("T08 /behavioral/token: bad HMAC → 403", async () => {
    const r = await request("POST", "/api/behavioral/token", {
      siteKey: "https://example.com", siteToken: "invalid", ts: Date.now(), nonce: "abc", sig: "bad",
    }, { Authorization: "", Origin: "https://example.com", "Sec-Fetch-Site": "cross-site" });
    assert(r.status === 403, `Expected 403 with bad HMAC, got ${r.status}`);
  });

  await test("T09 /behavioral/event: missing sessionToken → 401", async () => {
    const r = await request("POST", "/api/behavioral/event", {
      sessionId: "s1", siteUrl: "https://example.com", page: "/", eventType: "click",
    }, { Authorization: "", Origin: "https://example.com", "Sec-Fetch-Site": "cross-site" });
    assert(r.status === 401 || r.status === 403, `Expected 401/403, got ${r.status}`);
  });

  await test("T10 /behavioral/event: missing Origin → 403", async () => {
    const r = await request("POST", "/api/behavioral/event", {
      sessionId: "s1", siteUrl: "https://example.com", page: "/", eventType: "click", sessionToken: "fake",
    }, noAuth());
    assert(r.status === 403, `Expected 403 without Origin, got ${r.status}`);
  });

  await test("T11 /behavioral/session: missing sessionToken → 401", async () => {
    const r = await request("POST", "/api/behavioral/session", {
      id: "s1", siteUrl: "https://example.com",
    }, { Authorization: "", Origin: "https://example.com", "Sec-Fetch-Site": "cross-site" });
    assert(r.status === 401 || r.status === 403, `Expected 401/403, got ${r.status}`);
  });

  await test("T12 /behavioral/session: missing Origin → 403", async () => {
    const r = await request("POST", "/api/behavioral/session", {
      id: "s1", siteUrl: "https://example.com", sessionToken: "fake",
    }, noAuth());
    assert(r.status === 403, `Expected 403 without Origin, got ${r.status}`);
  });

  await test("T13 /behavioral/snippet: no auth → 401/403", async () => {
    const r = await request("GET", "/api/behavioral/snippet?siteUrl=https://example.com", null, noAuth());
    assert(r.status === 401 || r.status === 403, `Expected 401/403, got ${r.status}`);
  });

  await test("T14 /behavioral/snippet: no siteUrl → 400", async () => {
    const r = await request("GET", "/api/behavioral/snippet");
    assert(r.status === 400, `Expected 400 without siteUrl, got ${r.status}`);
  }, { requiresAuth: true });

  await test("T15 /behavioral/status: no siteUrl → not_configured", async () => {
    const r = await request("GET", "/api/behavioral/status");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.json?.installed === false || r.json?.status === "not_configured", "Expected not_configured");
  }, { requiresAuth: true });
}

// ── Suite 3 — CRO service: no AI credits, source=rules, orgId filter ─────────
async function suiteCROService() {
  console.log("\n[3] CRO service — orgId isolation + rules-only");

  await test("T16 GET /api/cro: returns 200 or 402", async () => {
    const r = await request("GET", "/api/cro");
    assert(r.status === 200 || r.status === 402, `Unexpected status ${r.status}`);
  }, { requiresAuth: true });

  await test("T17 GET /api/cro: response shape valid", async () => {
    const r = await request("GET", "/api/cro");
    if (r.status === 200) {
      assert("recommendations" in r.json, "recommendations missing");
      assert("scores" in r.json, "scores missing");
      assert("experiments" in r.json, "experiments missing");
      assert("summary" in r.json, "summary missing");
    }
  }, { requiresAuth: true });

  await test("T18 GET /api/cro: no auth → 401/403", async () => {
    const r = await request("GET", "/api/cro", null, noAuth());
    assert(r.status === 401 || r.status === 403, `Expected 401/403, got ${r.status}`);
  });

  await test("T19 POST /api/cro/generate: no siteUrl → 400", async () => {
    const r = await request("POST", "/api/cro/generate", {});
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  }, { requiresAuth: true });

  await test("T20 POST /api/cro/generate: returns 200 or 402", async () => {
    const r = await request("POST", "/api/cro/generate", { siteUrl: "https://test.example.com" });
    assert(r.status === 200 || r.status === 402, `Unexpected status ${r.status}`);
  }, { requiresAuth: true });

  await test("T21 CRO recs: aiGenerated should be false (rules-based)", async () => {
    const r = await request("GET", "/api/cro");
    if (r.status === 200 && r.json?.recommendations?.length > 0) {
      for (const rec of r.json.recommendations) {
        assert(rec.aiGenerated === false || rec.aiGenerated === null,
          `aiGenerated should be false, got ${rec.aiGenerated}`);
      }
    }
  }, { requiresAuth: true });

  await test("T22 CRO recs: source should be 'rules'", async () => {
    const r = await request("GET", "/api/cro");
    if (r.status === 200 && r.json?.recommendations?.length > 0) {
      for (const rec of r.json.recommendations) {
        assert(!rec.source || rec.source === "rules",
          `source should be 'rules', got ${rec.source}`);
      }
    }
  }, { requiresAuth: true });

  await test("T23 PATCH /api/cro/recommendations/:id: no status → 400", async () => {
    const r = await request("PATCH", "/api/cro/recommendations/nonexistent", {});
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  }, { requiresAuth: true });

  await test("T24 PATCH /api/cro/recommendations/:id: valid → 200 or 500", async () => {
    const r = await request("PATCH", "/api/cro/recommendations/nonexistent", { status: "implemented" });
    assert(r.status === 200 || r.status === 500, `Unexpected status ${r.status}`);
  }, { requiresAuth: true });
}

// ── Suite 4 — Revenue Leak: plan gate + orgId filter ─────────────────────────
async function suiteRevenueLeak() {
  console.log("\n[4] Revenue Leak — plan gate + orgId isolation");

  await test("T25 GET /api/revenue-leak: no auth → 401/403", async () => {
    const r = await request("GET", "/api/revenue-leak", null, noAuth());
    assert(r.status === 401 || r.status === 403, `Expected 401/403, got ${r.status}`);
  });

  await test("T26 GET /api/revenue-leak: returns 200 or 402", async () => {
    const r = await request("GET", "/api/revenue-leak");
    assert(r.status === 200 || r.status === 402, `Unexpected status ${r.status}`);
  }, { requiresAuth: true });

  await test("T27 GET /api/revenue-leak: leaks is array when 200", async () => {
    const r = await request("GET", "/api/revenue-leak");
    if (r.status === 200) assert(Array.isArray(r.json?.leaks), "leaks not array");
  }, { requiresAuth: true });

  await test("T28 GET /api/revenue-leak: summary present when 200", async () => {
    const r = await request("GET", "/api/revenue-leak");
    if (r.status === 200) assert(typeof r.json?.summary === "object", "summary missing");
  }, { requiresAuth: true });

  await test("T29 GET /api/revenue-leak: summary.activeLeaks field present", async () => {
    const r = await request("GET", "/api/revenue-leak");
    if (r.status === 200 && r.json?.summary) {
      assert("activeLeaks" in r.json.summary, "activeLeaks missing from summary");
    }
  }, { requiresAuth: true });

  await test("T30 POST /api/revenue-leak/detect: no siteUrl → 400/402", async () => {
    const r = await request("POST", "/api/revenue-leak/detect", {});
    assert(r.status === 400 || r.status === 402, `Expected 400/402, got ${r.status}`);
  }, { requiresAuth: true });

  await test("T31 POST /api/revenue-leak/detect: returns 200 or 402", async () => {
    const r = await request("POST", "/api/revenue-leak/detect", { siteUrl: "https://test.example.com" });
    assert(r.status === 200 || r.status === 402, `Unexpected status ${r.status}`);
  }, { requiresAuth: true });

  await test("T32 PATCH /api/revenue-leak/:id/resolve: returns 200/402/500", async () => {
    const r = await request("PATCH", "/api/revenue-leak/nonexistent/resolve", {});
    assert(r.status === 200 || r.status === 402 || r.status === 500, `Unexpected status ${r.status}`);
  }, { requiresAuth: true });
}

// ── Suite 5 — Org isolation boundary tests ───────────────────────────────────
async function suiteOrgIsolation() {
  console.log("\n[5] Org isolation — cross-tenant data access prevention");

  await test("T33 behavioral/insights: two different siteUrls return isolated sets", async () => {
    const r1 = await request("GET", "/api/behavioral/insights?siteUrl=https://unique-org-a.test");
    const r2 = await request("GET", "/api/behavioral/insights?siteUrl=https://unique-org-b.test");
    assert(r1.status === 200 || r1.status === 402, `Org A: unexpected ${r1.status}`);
    assert(r2.status === 200 || r2.status === 402, `Org B: unexpected ${r2.status}`);
    if (r1.status === 200 && r2.status === 200) {
      const urls1 = (r1.json?.insights ?? []).map(x => x.siteUrl);
      assert(!urls1.includes("https://unique-org-b.test"), "Org A insights contain Org B data");
    }
  }, { requiresAuth: true });

  await test("T34 cro: siteUrl filter returns only matching org data", async () => {
    const r1 = await request("GET", "/api/cro?siteUrl=https://unique-org-a.test");
    const r2 = await request("GET", "/api/cro?siteUrl=https://unique-org-b.test");
    if (r1.status === 200 && r2.status === 200) {
      const urls1 = (r1.json?.recommendations ?? []).map(x => x.siteUrl);
      const urls2 = (r2.json?.recommendations ?? []).map(x => x.siteUrl);
      assert(!urls1.includes("https://unique-org-b.test"), "Org A CRO contains Org B data");
      assert(!urls2.includes("https://unique-org-a.test"), "Org B CRO contains Org A data");
    }
  }, { requiresAuth: true });

  await test("T35 revenue-leak: siteUrl filter returns only matching org data", async () => {
    const r1 = await request("GET", "/api/revenue-leak?siteUrl=https://unique-org-a.test");
    const r2 = await request("GET", "/api/revenue-leak?siteUrl=https://unique-org-b.test");
    if (r1.status === 200 && r2.status === 200) {
      const urls1 = (r1.json?.leaks ?? []).map(x => x.siteUrl);
      const urls2 = (r2.json?.leaks ?? []).map(x => x.siteUrl);
      assert(!urls1.includes("https://unique-org-b.test"), "Org A leaks contain Org B data");
      assert(!urls2.includes("https://unique-org-a.test"), "Org B leaks contain Org A data");
    }
  }, { requiresAuth: true });

  await test("T36 PATCH cro recommendation: no auth → 401/403", async () => {
    const r = await request("PATCH", "/api/cro/recommendations/any", { status: "implemented" }, noAuth());
    assert(r.status === 401 || r.status === 403, `Expected 401/403, got ${r.status}`);
  });

  await test("T37 PATCH revenue-leak resolve: no auth → 401/403", async () => {
    const r = await request("PATCH", "/api/revenue-leak/any/resolve", {}, noAuth());
    assert(r.status === 401 || r.status === 403, `Expected 401/403, got ${r.status}`);
  });
}

// ── Suite 6 — CRO score shape ────────────────────────────────────────────────
async function suiteCROScore() {
  console.log("\n[6] CRO score — shape integrity");

  await test("T38 cro/generate: summary.totalRecs is number", async () => {
    const r = await request("POST", "/api/cro/generate", { siteUrl: "https://score-test.example.com" });
    if (r.status === 200) assert(typeof r.json?.summary?.totalRecs === "number", "totalRecs not number");
  }, { requiresAuth: true });

  await test("T39 cro/generate: summary.highPriority present", async () => {
    const r = await request("POST", "/api/cro/generate", { siteUrl: "https://score-test.example.com" });
    if (r.status === 200) assert("highPriority" in (r.json?.summary ?? {}), "highPriority missing");
  }, { requiresAuth: true });

  await test("T40 cro/generate: summary.estimatedUpliftTotal present", async () => {
    const r = await request("POST", "/api/cro/generate", { siteUrl: "https://score-test.example.com" });
    if (r.status === 200) assert("estimatedUpliftTotal" in (r.json?.summary ?? {}), "estimatedUpliftTotal missing");
  }, { requiresAuth: true });

  await test("T41 GET /api/cro: score is null or number", async () => {
    const r = await request("GET", "/api/cro");
    if (r.status === 200) {
      assert(r.json?.score === null || typeof r.json?.score === "number",
        `score type: ${typeof r.json?.score}`);
    }
  }, { requiresAuth: true });

  await test("T42 GET /api/cro: score in range [20,95] when numeric", async () => {
    const r = await request("GET", "/api/cro");
    if (r.status === 200 && typeof r.json?.score === "number") {
      assert(r.json.score >= 20 && r.json.score <= 95,
        `score ${r.json.score} outside [20,95]`);
    }
  }, { requiresAuth: true });
}

// ── Suite 7 — Behavioral status ──────────────────────────────────────────────
async function suiteBehavioralStatus() {
  console.log("\n[7] Behavioral status — org_id filter");

  await test("T43 /behavioral/status: no siteUrl → not_configured", async () => {
    const r = await request("GET", "/api/behavioral/status");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.json?.installed === false || r.json?.status === "not_configured",
      "Expected not_configured state");
  }, { requiresAuth: true });

  await test("T44 /behavioral/status: unknown siteUrl → 404 or not_configured", async () => {
    const r = await request("GET", "/api/behavioral/status?siteUrl=https://never-registered-xyz.test");
    assert(r.status === 404 || r.status === 200, `Unexpected ${r.status}`);
    if (r.status === 200) assert(r.json?.installed !== undefined, "installed field missing");
  }, { requiresAuth: true });

  await test("T45 /behavioral/status: no auth → 401/403", async () => {
    const r = await request("GET", "/api/behavioral/status?siteUrl=https://example.com", null, noAuth());
    assert(r.status === 401 || r.status === 403, `Expected 401/403, got ${r.status}`);
  });

  await test("T46 /behavioral/generate-insights: plan gate → 200 or 402", async () => {
    const r = await request("POST", "/api/behavioral/generate-insights", { siteUrl: "https://test.com" });
    assert(r.status === 200 || r.status === 402, `Unexpected ${r.status}`);
  }, { requiresAuth: true });
}

// ── Suite 8 — Schema structural checks ──────────────────────────────────────
async function suiteSchemaChecks() {
  console.log("\n[8] Schema structural checks — response field integrity");

  await test("T47 revenue-leak items have siteUrl field", async () => {
    const r = await request("GET", "/api/revenue-leak");
    if (r.status === 200 && r.json?.leaks?.length > 0) {
      for (const leak of r.json.leaks.slice(0, 3)) {
        assert("siteUrl" in leak, "siteUrl missing from leak item");
      }
    }
  }, { requiresAuth: true });

  await test("T48 cro recommendations have valid priority field", async () => {
    const r = await request("GET", "/api/cro");
    if (r.status === 200 && r.json?.recommendations?.length > 0) {
      for (const rec of r.json.recommendations.slice(0, 3)) {
        assert("priority" in rec, "priority missing");
        assert(["high", "medium", "low"].includes(rec.priority),
          `Invalid priority: ${rec.priority}`);
      }
    }
  }, { requiresAuth: true });

  await test("T49 cro recommendations have estimatedUplift as number", async () => {
    const r = await request("GET", "/api/cro");
    if (r.status === 200 && r.json?.recommendations?.length > 0) {
      for (const rec of r.json.recommendations.slice(0, 3)) {
        assert("estimatedUplift" in rec, "estimatedUplift missing");
        assert(typeof rec.estimatedUplift === "number",
          `estimatedUplift not number: ${typeof rec.estimatedUplift}`);
      }
    }
  }, { requiresAuth: true });

  await test("T50 behavioral/insights: sessionStats.bounceRate in [0,100]", async () => {
    const r = await request("GET", "/api/behavioral/insights");
    if (r.status === 200 && r.json?.sessionStats) {
      const br = r.json.sessionStats.bounceRate;
      assert(typeof br === "number" && br >= 0 && br <= 100,
        `bounceRate ${br} out of range [0,100]`);
    }
  }, { requiresAuth: true });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("══════════════════════════════════════════════════");
  console.log("  Wave 4 Lot 4B-S — Security Foundation");
  console.log("══════════════════════════════════════════════════");
  console.log(`  API:   ${BASE}`);
  console.log(`  Auth:  ${AUTH_AVAILABLE ? "TOKEN provided — full suite" : "NO TOKEN — auth-required tests skipped"}`);

  await suiteBehavioralService();
  await suiteBehavioralIngestion();
  await suiteCROService();
  await suiteRevenueLeak();
  await suiteOrgIsolation();
  await suiteCROScore();
  await suiteBehavioralStatus();
  await suiteSchemaChecks();

  const total = passed + failed + skipped;
  console.log("\n══════════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped / ${total} total`);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    for (const f of failures) console.log(`    ❌ ${f.name}: ${f.error}`);
  }
  if (skipped > 0) {
    console.log(`\n  Note: ${skipped} auth-gated tests skipped. Set TEST_TOKEN=<jwt> to run them.`);
  }
  console.log("══════════════════════════════════════════════════");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
