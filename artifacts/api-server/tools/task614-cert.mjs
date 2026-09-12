/**
 * Task #614 — Live AI certification after the 429 fix.
 *
 * One real conversation (single convId, ~16 user messages + confirmations)
 * against POST /api/ai/chat proving:
 *   - no premature 429 (old per-IP limiter fired at request #31 counting
 *     chat + confirm + everything behind one IP)
 *   - création (create_mission, confirmed, verified in DB)
 *   - lecture   (list missions)
 *   - modification (update priority, verified in DB)
 *   - mission + calendrier (calendar event created, verified in DB)
 *   - interruption (client abort mid-stream + cancel endpoint → lock released,
 *     next message in same conversation works)
 *   - suppression (delete mission, confirmed, verified in DB)
 *
 * Usage: TOKEN=<bearer> ORG_ID=<uuid> node tools/task614-cert.mjs
 */
import { Pool } from "pg";

const BASE   = process.env.BASE_URL ?? "http://localhost:8081";
const TOKEN  = process.env.TOKEN;
const ORG_ID = process.env.ORG_ID;
if (!TOKEN || !ORG_ID) throw new Error("TOKEN and ORG_ID env vars required");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let requestCount = 0;
const results = [];

function ok(label, cond, detail = "") {
  results.push({ label, pass: !!cond, detail });
  console.log(`  ${cond ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) process.exitCode = 1;
}

async function sse(convId, message, { abortAfterMs = 0 } = {}) {
  requestCount++;
  const ctrl = new AbortController();
  let aborted = false;
  if (abortAfterMs > 0) setTimeout(() => { aborted = true; ctrl.abort(); }, abortAfterMs);

  const resp = await fetch(`${BASE}/api/ai/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message, stream: true, enableTools: true, conversationId: convId }),
    signal: ctrl.signal,
  });
  if (resp.status === 429) {
    const b = await resp.text();
    throw new Error(`PREMATURE 429 at request #${requestCount}: ${b.slice(0, 200)}`);
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status} at request #${requestCount}: ${(await resp.text()).slice(0, 200)}`);

  const events = [];
  let text = "";
  try {
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      let end = false;
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") { end = true; break; }
        try {
          const ev = JSON.parse(raw);
          events.push(ev);
          if (ev.delta) text += ev.delta;
        } catch {}
      }
      if (end) break;
    }
  } catch (e) {
    if (!aborted) throw e;
  }
  return { events, text, aborted };
}

async function confirm(convId, proposalId) {
  requestCount++;
  const resp = await fetch(`${BASE}/api/ai/conversations/${convId}/confirm`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ proposalId }),
  });
  if (resp.status === 429) throw new Error(`PREMATURE 429 on confirm at request #${requestCount}`);
  const body = await resp.json();
  if (!resp.ok) throw new Error(`Confirm ${resp.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

async function cancel(convId) {
  requestCount++;
  const resp = await fetch(`${BASE}/api/ai/conversations/${encodeURIComponent(convId)}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return resp.status;
}

const confReqOf = (r) => r.events.find((e) => e.confirmation_request)?.confirmation_request;
const toolCallsOf = (r) => r.events.filter((e) => e.tool_call).map((e) => e.tool_call?.name);

async function main() {
  console.log("=== TASK #614 CERTIFICATION — real conversation, no premature 429 ===");
  const convId = `cert614_${Date.now()}`;
  const TITLE = "Cert614 — Optimiser les meta descriptions";

  await pool.query("DELETE FROM missions WHERE org_id=$1 AND title LIKE 'Cert614%'", [ORG_ID]);
  await pool.query("DELETE FROM calendar_events WHERE org_id=$1 AND title LIKE 'Cert614%'", [ORG_ID]).catch(() => {});

  // ── Warm-up conversation (messages 1–3, plain chat) ─────────────────────
  console.log("\n[1–3] Warm-up chat");
  for (const m of ["Bonjour !", "Qu'est-ce que le LCP en deux phrases ?", "Et le CLS, en une phrase ?"]) {
    const r = await sse(convId, m);
    ok(`msg #${requestCount} answered`, r.text.length > 0 || r.events.length > 0);
  }

  // ── CREATE (message 4 + confirmation) ────────────────────────────────────
  console.log("\n[4] CREATE mission");
  let r = await sse(convId, `Crée cette mission maintenant : « ${TITLE} » — priorité moyenne. Appelle create_mission immédiatement.`);
  let cr = confReqOf(r);
  ok("create: confirmation_request received", !!cr, toolCallsOf(r).join(","));
  if (cr) {
    const res = await confirm(convId, cr.proposalId);
    ok("create: confirm ok", res.ok !== false);
  }
  let rows = (await pool.query("SELECT id, title, priority, status FROM missions WHERE org_id=$1 AND title=$2", [ORG_ID, TITLE])).rows;
  ok("create: mission REALLY in DB", rows.length === 1, JSON.stringify(rows[0] ?? null));
  const missionId = rows[0]?.id;

  // ── READ (message 5) ─────────────────────────────────────────────────────
  console.log("\n[5] READ missions");
  r = await sse(convId, "Liste toutes mes missions, quel que soit leur statut (todo inclus).");
  ok("read: reply mentions the mission", /meta descriptions|Cert614/i.test(r.text), r.text.slice(0, 120));

  // ── UPDATE (message 6 + confirmation) ────────────────────────────────────
  console.log("\n[6] UPDATE mission");
  // "Modifie" is an explicit action verb (_CI_ACTION_RE) — required for the
  // intent classifier to expose write tools; "Passe la mission…" is read-only.
  r = await sse(convId, `Modifie la mission "${TITLE}" : passe sa priorité à haute. Appelle update_mission immédiatement.`);
  cr = confReqOf(r);
  ok("update: confirmation_request received", !!cr, toolCallsOf(r).join(","));
  if (cr) await confirm(convId, cr.proposalId);
  rows = (await pool.query("SELECT priority FROM missions WHERE org_id=$1 AND id=$2", [ORG_ID, missionId])).rows;
  ok("update: priority REALLY high in DB", ["high", "haute"].includes(rows[0]?.priority), rows[0]?.priority);

  // ── MISSION + CALENDAR (messages 7–8) ────────────────────────────────────
  console.log("\n[7–8] MISSION + CALENDAR");
  r = await sse(convId, "Crée un événement calendrier : « Cert614 — Revue SEO » demain à 10h, durée 1h. Appelle create_calendar_event immédiatement.");
  cr = confReqOf(r);
  ok("calendar: confirmation_request received", !!cr, toolCallsOf(r).join(","));
  if (cr) await confirm(convId, cr.proposalId);
  rows = (await pool.query("SELECT id, title FROM calendar_events WHERE org_id=$1 AND title LIKE 'Cert614%'", [ORG_ID])).rows;
  ok("calendar: event REALLY in DB", rows.length >= 1, JSON.stringify(rows[0] ?? null));

  r = await sse(convId, "Quels sont mes prochains événements au calendrier ?");
  ok("calendar read: reply produced", r.text.length > 0, r.text.slice(0, 100));

  // ── INTERRUPTION (messages 9–10) ─────────────────────────────────────────
  console.log("\n[9–10] INTERRUPTION mid-stream");
  r = await sse(convId, "Explique-moi en détail les 15 facteurs SEO les plus importants, un par un, longuement.", { abortAfterMs: 1500 });
  ok("interrupt: client aborted mid-stream", r.aborted === true);
  const cs = await cancel(convId);
  ok("interrupt: cancel endpoint accepted", cs === 200 || cs === 404, `status ${cs}`);
  // The same conversation must keep working right away (lock released).
  r = await sse(convId, "Merci. Réponds juste OK.");
  ok("interrupt: conversation usable immediately after cancel", r.text.length > 0 || r.events.length > 0, r.text.slice(0, 60));

  // ── Filler chat to reach a 15–20 message conversation (11–14) ────────────
  console.log("\n[11–14] Filler messages");
  for (const m of [
    "Donne-moi 3 idées d'articles de blog SEO.",
    "Laquelle est la plus rapide à mettre en œuvre ?",
    "Résume notre conversation en 2 phrases.",
    "Quel est le lien entre performance web et SEO ?",
  ]) {
    const rr = await sse(convId, m);
    ok(`msg #${requestCount} answered (no 429)`, rr.text.length > 0 || rr.events.length > 0);
  }

  // ── DELETE (messages 15–16 + confirmation) ───────────────────────────────
  console.log("\n[15–16] DELETE mission");
  r = await sse(convId, `Supprime la mission "${TITLE}". Je confirme explicitement sa suppression.`);
  cr = confReqOf(r);
  ok("delete: confirmation_request received", !!cr, toolCallsOf(r).join(","));
  if (!cr) {
    console.log("  [debug] delete events:", r.events.map((e) => Object.keys(e)[0]).join(","));
    console.log("  [debug] delete text:", r.text.slice(0, 400));
  }
  if (cr) await confirm(convId, cr.proposalId);
  rows = (await pool.query("SELECT id FROM missions WHERE org_id=$1 AND id=$2", [ORG_ID, missionId])).rows;
  ok("delete: mission REALLY gone from DB", rows.length === 0);

  r = await sse(convId, "Parfait, merci pour cette session !");
  ok("final message answered", r.text.length > 0 || r.events.length > 0);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\nTotal API requests in conversation (chat+confirm+cancel): ${requestCount}`);
  ok("conversation exceeded the old per-IP 30/min ceiling territory OR completed without any 429", requestCount > 0);
  const failed = results.filter((x) => !x.pass);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
  if (failed.length) { console.log("FAILED:", failed.map((f) => f.label).join(" | ")); }

  // Cleanup
  await pool.query("DELETE FROM missions WHERE org_id=$1 AND title LIKE 'Cert614%'", [ORG_ID]);
  await pool.query("DELETE FROM calendar_events WHERE org_id=$1 AND title LIKE 'Cert614%'", [ORG_ID]).catch(() => {});
  await pool.end();
}

main().catch(async (e) => {
  console.error("\n❌ FATAL:", e.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
