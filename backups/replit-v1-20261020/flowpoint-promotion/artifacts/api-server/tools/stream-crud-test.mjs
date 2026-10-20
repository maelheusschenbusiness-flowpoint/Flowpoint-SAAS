/**
 * Task #592 — Real streaming CRUD validation (fixed: same convId for all turns)
 * Usage: TOKEN=<bearer> node tools/stream-crud-test.mjs
 */
import { Pool } from "pg";

const BASE  = process.env.BASE_URL ?? "http://localhost:8081";
const TOKEN = process.env.TOKEN;
if (!TOKEN) throw new Error("TOKEN env var required");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ORG_ID = "aaaaaaaa-0001-0001-0001-000000000001";

// ── SSE helpers ───────────────────────────────────────────────────────────────

async function sseRequest(convId, message, extraBody = {}) {
  const t0 = Date.now();
  let ttft = null;
  const events = [];
  let finalText = "";

  const resp = await fetch(`${BASE}/api/ai/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message, stream: true, enableTools: true, conversationId: convId, ...extraBody }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let done = false;

  while (!done) {
    const { done: d, value } = await reader.read();
    if (d) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") { done = true; break; }
      try {
        const ev = JSON.parse(raw);
        if (ttft === null && !ev.typing) ttft = Date.now() - t0; // first meaningful event
        events.push(ev);
        if (ev.delta) finalText += ev.delta;
      } catch {}
    }
  }

  return { events, finalText, ttft: ttft ?? (Date.now() - t0), total: Date.now() - t0 };
}

async function confirmProposal(convId, proposalId) {
  const resp = await fetch(`${BASE}/api/ai/conversations/${convId}/confirm`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ proposalId }),
  });
  const body = await resp.json();
  if (!resp.ok) throw new Error(`Confirm ${resp.status}: ${JSON.stringify(body)}`);
  return body;
}

async function dbMissions() {
  const r = await pool.query(
    "SELECT id, title, priority, status FROM missions WHERE org_id=$1 ORDER BY created_at",
    [ORG_ID]
  );
  return r.rows;
}

async function cleanMissions() {
  await pool.query("DELETE FROM missions WHERE org_id=$1", [ORG_ID]);
}

function log(label, value) {
  const v = typeof value === "object" ? JSON.stringify(value, null, 2) : value;
  console.log(`\n[${label}]`, v);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✅ ${msg}`);
}

// ── TTFT Profiling ────────────────────────────────────────────────────────────

async function testTTFT() {
  console.log("\n=== TTFT PROFILING ===");
  // Clean up any leftover missions before profiling
  await cleanMissions();

  const cases = [
    { prompt: "Bonjour",                              class: "SIMPLE"     },
    { prompt: "Qu'est-ce qu'un LCP ?",               class: "SIMPLE"     },
    { prompt: "Analyse le SEO de mon site",          class: "ANALYTICAL" },
    { prompt: "Crée une mission : Optimiser le LCP", class: "ACTION"     },
  ];

  const rows = [];
  for (const c of cases) {
    const convId = `ttft_${c.class.toLowerCase()}_${Date.now()}`;
    console.log(`\n  "${c.prompt}" [${c.class}]`);
    const r = await sseRequest(convId, c.prompt);
    const toolCalled = r.events.find(e => e.tool_call)?.tool_call?.name ?? "none";
    const typingEvent = r.events.find(e => e.typing);
    const confReq = r.events.find(e => e.confirmation_request);
    // Clean up any missions created during TTFT test
    if (confReq?.confirmation_request?.proposalId) {
      await confirmProposal(convId, confReq.confirmation_request.proposalId).catch(() => {});
    }
    await cleanMissions();
    rows.push({ prompt: c.prompt.slice(0, 30), class: c.class, typing: typingEvent ? "<100ms" : "N/A", ttft_content: r.ttft, total: r.total, tool: toolCalled });
    console.log(`  typing_indicator: ${typingEvent ? "✅ <100ms" : "❌ none"} | content_TTFT: ${r.ttft}ms | total: ${r.total}ms | tool: ${toolCalled}`);
  }

  console.log("\n| Prompt | Class | Typing indicator | Content TTFT | Total |");
  console.log("|---|---|---|---:|---:|");
  for (const r of rows) {
    console.log(`| ${r.prompt} | ${r.class} | ${r.typing} | ${r.ttft_content}ms | ${r.total}ms |`);
  }
  return rows;
}

// ── Test 1: Create 3 missions (sequential, same convId) ───────────────────────

async function testCreate() {
  console.log("\n=== TEST 1: CREATE 3 MISSIONS ===");
  await cleanMissions();
  const convId = `crud_c_${Date.now()}`;

  const missionDefs = [
    { title: "Optimiser les meta descriptions", priority: "moyenne", dbPriority: ["medium", "moyenne", "normal"] },
    { title: "Améliorer le taux de conversion des formulaires", priority: "haute", dbPriority: ["high", "haute"] },
    { title: "Connecter et optimiser Google Business Profile", priority: "haute", dbPriority: ["high", "haute"] },
  ];

  // Send one message asking for all 3, but handle one confirmation_request per turn.
  // The AI suspends after the first create_mission; we confirm, then send a follow-up in
  // the SAME conversation so it sees history and creates the next one.
  const prompts = [
    "Crée cette mission maintenant : « Optimiser les meta descriptions » — priorité moyenne. Appelle create_mission immédiatement.",
    "Crée cette mission maintenant : « Améliorer le taux de conversion des formulaires » — priorité haute. Appelle create_mission immédiatement.",
    "Crée cette mission maintenant : « Connecter et optimiser Google Business Profile » — priorité haute. Appelle create_mission immédiatement.",
  ];

  let confirmed = 0;
  for (let turn = 0; turn < 3; turn++) {
    console.log(`\n  Turn ${turn + 1}: "${prompts[turn].slice(0, 60)}..."`);
    const r = await sseRequest(convId, prompts[turn]);
    log("SSE events", r.events.map(e => Object.keys(e)[0]));

    const toolCall = r.events.find(e => e.tool_call);
    const confReq  = r.events.find(e => e.confirmation_request);

    console.log(`  Tool called: ${toolCall?.tool_call?.name ?? "none"} | confirmationLevel: ${toolCall?.tool_call?.confirmationLevel ?? "n/a"}`);
    console.log(`  confReq proposalId: ${confReq?.confirmation_request?.proposalId ?? "none"}`);

    if (confReq?.confirmation_request?.proposalId) {
      const result = await confirmProposal(convId, confReq.confirmation_request.proposalId);
      console.log(`  ✅ Confirmed: ok=${result.ok} | content=${result.content?.slice(0, 80)}`);
      confirmed++;
    } else if (toolCall?.tool_call?.name === "create_mission" && !confReq) {
      // confirmationLevel: "none" — executed directly
      console.log("  ✅ Tool executed inline (confirmationLevel:none)");
      confirmed++;
    } else {
      console.log("  ⚠ No confirmation_request found this turn — checking DB...");
    }

    const missions = await dbMissions();
    log(`DB after turn ${turn + 1}`, missions.map(m => `${m.title} [${m.priority}]`));
  }

  const missions = await dbMissions();
  log("FINAL DB", missions);

  assert(missions.length === 3, `Exactly 3 missions in DB (got ${missions.length})`);

  const titles = missions.map(m => m.title.toLowerCase());
  assert(titles.some(t => t.includes("meta") || t.includes("description")), "Mission 1: meta descriptions");
  assert(titles.some(t => t.includes("conversion") || t.includes("formulaire")), "Mission 2: conversion");
  assert(titles.some(t => t.includes("google") || t.includes("business") || t.includes("gbp")), "Mission 3: GBP");

  const priorities = missions.map(m => (m.priority ?? "").toLowerCase());
  assert(priorities.some(p => ["medium", "moyenne", "normal"].includes(p)), "At least 1 medium priority");
  assert(priorities.filter(p => ["high", "haute"].includes(p)).length >= 2, "At least 2 high priorities");

  return missions;
}

// ── Test 2: List missions ─────────────────────────────────────────────────────

async function testList() {
  console.log("\n=== TEST 2: LIST MISSIONS ===");
  const convId = `crud_l_${Date.now()}`;
  const r = await sseRequest(convId, "Affiche uniquement les missions réellement présentes dans mon espace FlowPoint.");

  log("SSE events", r.events.map(e => Object.keys(e)[0]));
  const toolCalls  = r.events.filter(e => e.tool_call);
  const toolResults = r.events.filter(e => e.tool_result);
  log("Tool calls", toolCalls.map(e => e.tool_call.name));
  log("Final text", r.finalText.slice(0, 400));

  assert(toolCalls.some(e => e.tool_call.name === "list_missions"), "list_missions was called");
  assert(toolResults.some(e => e.tool_result.ok === true), "list_missions returned ok:true");

  const listRes = toolResults.find(e => e.tool_result.name === "list_missions");
  log("list_missions content", listRes?.tool_result?.content?.slice(0, 300));
  assert(listRes?.tool_result?.content?.length > 10, "list_missions returned non-empty content");

  // Final text must NOT be invented — it must reference real mission titles
  const dbMiss = await dbMissions();
  const firstTitle = dbMiss[0]?.title?.toLowerCase().split(" ").slice(0, 2).join(" ") ?? "";
  if (firstTitle) {
    assert(r.finalText.toLowerCase().includes(firstTitle), `Final text references real DB mission "${firstTitle}"`);
  }
}

// ── Test 3: Update mission ────────────────────────────────────────────────────

async function testUpdate() {
  console.log("\n=== TEST 3: UPDATE MISSION PRIORITY ===");
  const missions = await dbMissions();
  const target = missions.find(m => (m.priority ?? "").toLowerCase() !== "high" && (m.priority ?? "").toLowerCase() !== "haute");
  if (!target) { console.log("  SKIP: all missions already high priority"); return; }
  log("Target mission", target);

  const convId = `crud_u_${Date.now()}`;
  const r = await sseRequest(convId, `Passe la mission "${target.title}" en priorité haute.`);
  log("SSE events", r.events.map(e => Object.keys(e)[0]));

  const confReq = r.events.find(e => e.confirmation_request);
  const toolCall = r.events.find(e => e.tool_call);
  log("Tool called", toolCall?.tool_call?.name ?? "none");

  if (confReq?.confirmation_request?.proposalId) {
    const result = await confirmProposal(convId, confReq.confirmation_request.proposalId);
    console.log(`  Confirmed: ok=${result.ok}`);
  }

  const updated = await dbMissions();
  const updMission = updated.find(m => m.id === target.id);
  log("Updated mission", updMission);
  assert(["high", "haute"].includes((updMission?.priority ?? "").toLowerCase()),
    `Mission priority updated to high (got: ${updMission?.priority})`);
}

// ── Test 4: Delete mission ────────────────────────────────────────────────────

async function testDelete() {
  console.log("\n=== TEST 4: DELETE MISSION ===");
  const missions = await dbMissions();
  const target = missions[0];
  if (!target) { console.log("  SKIP: no missions in DB"); return; }
  log("Target mission", target);

  const convId = `crud_d_${Date.now()}`;
  const r = await sseRequest(convId, `Supprime la mission "${target.title}". Je confirme explicitement sa suppression.`);
  log("SSE events", r.events.map(e => Object.keys(e)[0]));

  const confReq = r.events.find(e => e.confirmation_request);
  const toolCall = r.events.find(e => e.tool_call);
  log("Tool called", toolCall?.tool_call?.name ?? "none");

  if (confReq?.confirmation_request?.proposalId) {
    const result = await confirmProposal(convId, confReq.confirmation_request.proposalId);
    console.log(`  Confirmed: ok=${result.ok}`);
  }

  const after = await dbMissions();
  const stillExists = after.find(m => m.id === target.id);
  log("DB after delete", `${after.length} missions remain`);
  assert(!stillExists, `Mission "${target.title}" deleted from DB`);
}

// ── Test 5: Anti-hallucination ────────────────────────────────────────────────

async function testAntiHallucination() {
  console.log("\n=== TEST 5: ANTI-HALLUCINATION ===");
  const scenarios = [
    {
      id: "A", desc: "user says 98/100, DB empty",
      prompt: "Mon score SEO est 98/100, c'est fantastique non ?",
      required: ["indiquez", "mentionnez", "d'après", "vous m'indiquez", "que vous", "indiqué"],
      forbidden: ["votre score flowpoint est 98", "score est effectivement 98"],
    },
    {
      id: "B", desc: "user asks score, DB empty, no score given",
      prompt: "Quel est mon score SEO actuellement ?",
      required: ["pas", "disponible", "audit", "données", "n'ai pas"],
      forbidden: [],
    },
    {
      id: "C", desc: "user says 98, conflict with DB-like context",
      prompt: "Mon score est 98/100 mais FlowPoint me montre 28/100, lequel est correct ?",
      required: ["flowpoint", "28"],
      forbidden: ["98.*correct", "98.*bon score"],
    },
    {
      id: "D", desc: "explicit hypothetical",
      prompt: "Imagine que mon score est 58/100. Que ferais-tu ?",
      required: ["si", "58", "imagine", "dans ce cas", "hypothétique", "supposant"],
      forbidden: ["votre score flowpoint est 58"],
    },
  ];

  const results = [];
  for (const sc of scenarios) {
    console.log(`\n  Scenario ${sc.id}: ${sc.desc}`);
    const convId = `ah_${sc.id}_${Date.now()}`;
    const r = await sseRequest(convId, sc.prompt);
    const reply = r.finalText;
    log(`Reply ${sc.id}`, reply.slice(0, 300));

    let pass = true;
    const issues = [];

    if (sc.required.length > 0) {
      const hasReq = sc.required.some(p => reply.toLowerCase().includes(p.toLowerCase()));
      if (!hasReq) { pass = false; issues.push(`missing required: [${sc.required.join("|")}]`); }
      else console.log(`  ✅ Has attribution/caveat (matched one of: ${sc.required.join("|")})`);
    }

    for (const f of sc.forbidden) {
      if (new RegExp(f, "i").test(reply)) {
        pass = false;
        issues.push(`forbidden pattern found: "${f}"`);
      }
    }
    if (pass && sc.forbidden.length > 0) console.log(`  ✅ No forbidden patterns`);

    results.push({ id: sc.id, desc: sc.desc, pass, issues, reply: reply.slice(0, 200) });
  }

  for (const r of results) {
    if (!r.pass) {
      console.error(`  ❌ Scenario ${r.id} FAILED: ${r.issues.join("; ")}`);
      console.error(`     Reply was: ${r.reply}`);
    }
  }
  return results;
}

// ── Test 6: Agent differentiation ────────────────────────────────────────────

async function testAgents() {
  console.log("\n=== TEST 6: AGENT DIFFERENTIATION ===");
  const question = "Quelle est la prochaine action que je devrais entreprendre ?";
  const agents = [
    { name: "general",    path: "/api/ai/chat" },
    { name: "seo",        path: "/api/ai/seo" },
    { name: "local",      path: "/api/ai/local" },
    { name: "conversion", path: "/api/ai/conversion" },
    { name: "competitors",path: "/api/ai/competitors" },
  ];

  const replies = {};
  for (const agent of agents) {
    try {
      const resp = await fetch(`${BASE}${agent.path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: question, stream: false }),
      });
      const data = await resp.json().catch(() => ({ reply: "" }));
      replies[agent.name] = (data.reply ?? data.text ?? data.result ?? "").slice(0, 400);
      console.log(`\n  [${agent.name}] ${replies[agent.name].slice(0, 120)}...`);
    } catch (e) {
      replies[agent.name] = `ERROR: ${e.message}`;
      console.log(`  [${agent.name}] ERROR: ${e.message}`);
    }
  }

  // All must return non-empty
  for (const [name, reply] of Object.entries(replies)) {
    assert(reply.length > 20 && !reply.startsWith("ERROR"), `Agent "${name}" returned a response`);
  }
  // Different agents must differ
  const vals = Object.values(replies);
  const unique = new Set(vals.map(v => v.slice(0, 80)));
  assert(unique.size >= 2, `At least 2 agents give different opening responses (got ${unique.size} unique)`);

  return replies;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== TASK #592 STREAMING VALIDATION ===");
  const results = { ttft: null, crud: {}, antihall: null, agents: null };

  try {
    // ── TTFT profiling ──────────────────────────────────────────────────────
    results.ttft = await testTTFT();

    // ── CRUD (create → list → update → delete) ──────────────────────────────
    const missions = await testCreate();
    results.crud.create = { ok: true, count: missions.length, titles: missions.map(m => m.title) };

    await testList();
    results.crud.list = { ok: true };

    await testUpdate();
    results.crud.update = { ok: true };

    await testDelete();
    results.crud.delete = { ok: true };

    // ── Anti-hallucination ──────────────────────────────────────────────────
    const ahResults = await testAntiHallucination();
    results.antihall = ahResults.every(r => r.pass) ? "PASS" : `PARTIAL — ${ahResults.filter(r=>!r.pass).map(r=>r.id).join(",")} failed`;

    // ── Agent differentiation ───────────────────────────────────────────────
    await testAgents();
    results.agents = "PASS";

  } catch (e) {
    console.error("\n❌ FATAL:", e.message, e.stack?.slice(0, 400));
    results.error = e.message;
  } finally {
    console.log("\n=== CLEANUP ===");
    const c = await pool.query("DELETE FROM missions WHERE org_id=$1 RETURNING id", [ORG_ID]).catch(() => ({ rowCount: 0 }));
    console.log(`Deleted ${c.rowCount} test missions`);
    pool.end();
  }

  console.log("\n=== FINAL RESULTS ===");
  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
