/**
 * Certification REELLE de la transmission SaaS -> AI Lab, preuves des deux cotes.
 *
 * Emetteur : le vrai code (`queueConversionEvent`, file durable `conversion_event_outbox`,
 * worker) sur la base SaaS pointee par DATABASE_URL (TEST uniquement).
 * Recepteur : le vrai service AI Lab (`POST /events/conversion`, `record_event`) sur sa base,
 * lue via AI_LAB_VERIFY_DATABASE_URL (lecture seule suffit).
 *
 * Variables (jamais journalisees) :
 *   AI_LAB_CONVERSION_URL, CONVERSION_EVENT_SECRET   comme sur flowpoint-test
 *   CERT_FP_LID                                       fp_lid emis par AI Lab pour un prospect synthetique
 *   AI_LAB_VERIFY_DATABASE_URL                        base AI Lab (preuve cote recepteur)
 *   CERT_DEAD_URL (optionnel)                         URL injoignable pour la panne (defaut : port ferme local)
 * Sortie : un JSON de preuves dans PROOF_OUT (defaut ./conversion-proof.json), le journal applicatif restant sur stdout. Le fp_lid n'y figure que sous forme d'empreinte.
 */
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import pg from "pg";
import { pool } from "@workspace/db";
import { queueConversionEvent, processConversionOutboxOnce } from "../../src/lib/conversion-outbox.js";

const need = (k: string) => { const v = process.env[k]; if (!v) { console.error(`variable manquante: ${k}`); process.exit(2); } return v; };
const LIVE_URL = need("AI_LAB_CONVERSION_URL");
need("CONVERSION_EVENT_SECRET");
const FP_LID = need("CERT_FP_LID");
const DEAD_URL = process.env["CERT_DEAD_URL"] ?? "http://127.0.0.1:9/events/conversion";
const recv = new pg.Pool({ connectionString: need("AI_LAB_VERIFY_DATABASE_URL"), max: 1 });

const RUN = randomUUID().slice(0, 8);
const STAGES: [string, string][] = [["visit", "saas"], ["signup_page", "saas"], ["signup_started", "saas"],
  ["signup", "saas"], ["checkout", "saas"], ["trial", "stripe"], ["paid", "stripe"]];
const base = Date.now() - 30 * 60_000;
const events = STAGES.map(([stage, source], i) => ({
  eventId: `cert:${RUN}:${stage}`, stage: stage as never, source: source as never, fpLid: FP_LID,
  occurredAt: new Date(base + i * 60_000).toISOString(),
}));
const ids = events.map(e => e.eventId);

async function receiver() {
  const r = await recv.query(
    `SELECT cfe.stage, cfe.source, cfe.event_id, cfe.occurred_at FROM conversion_funnel_events cfe
       JOIN lead_tokens lt ON lt.prospect_id = cfe.prospect_id WHERE lt.fp_lid = $1 ORDER BY cfe.occurred_at`, [FP_LID]);
  return r.rows;
}
const sender = async () => (await pool.query(
  `SELECT event_id, stage, status, attempts, last_status, fp_lid IS NULL AS fp_lid_erased
     FROM conversion_event_outbox WHERE event_id = ANY($1) ORDER BY occurred_at`, [ids])).rows;
const proof: Record<string, unknown> = { run: RUN, fp_lid_sha256_prefix: createHash("sha256").update(FP_LID).digest("hex").slice(0, 8) };

async function main() {
  // 1. Livraison nominale : la file durable envoie, AI Lab accuse et persiste.
  const outcomes: Record<string, string> = {};
  for (const e of events) outcomes[e.stage] = await queueConversionEvent(e);
  const s1 = await sender(), r1 = await receiver();
  proof["1_nominal"] = { queue_outcomes: outcomes, sender_rows: s1, receiver_rows: r1.map(x => ({ stage: x.stage, source: x.source })) };

  // 2. Rejeu : memes event_id.
  const replay: Record<string, string> = {};
  for (const e of events) replay[e.stage] = await queueConversionEvent(e);
  const r2 = await receiver();
  proof["2_replay"] = { outcomes: replay, receiver_count_before: r1.length, receiver_count_after: r2.length };

  // 3. Panne d'AI Lab : nouveaux evenements (autres event_id) vers une URL injoignable.
  process.env["AI_LAB_CONVERSION_URL"] = DEAD_URL;
  const outageId = `cert:${RUN}:outage`;
  const outage = { ...events[0]!, eventId: outageId, stage: "click" as never, source: "marketing" as never };
  const t0 = Date.now();
  const q = await queueConversionEvent(outage);
  const quick = Date.now() - t0;
  const dead = await pool.query(`SELECT status, attempts, last_status, next_attempt_at > now() AS future FROM conversion_event_outbox WHERE event_id=$1`, [outageId]);
  await pool.query(`UPDATE conversion_event_outbox SET next_attempt_at = now() - interval '1 second' WHERE event_id=$1`, [outageId]);
  for (let i = 0; i < 6; i++) { await processConversionOutboxOnce(); await pool.query(`UPDATE conversion_event_outbox SET next_attempt_at = now() - interval '1 second' WHERE event_id=$1 AND status='pending'`, [outageId]); }
  const still = await pool.query(`SELECT status, attempts, last_status FROM conversion_event_outbox WHERE event_id=$1`, [outageId]);
  // 4. Reprise : AI Lab revient.
  process.env["AI_LAB_CONVERSION_URL"] = LIVE_URL;
  await processConversionOutboxOnce();
  const after = await pool.query(`SELECT status, attempts, last_status FROM conversion_event_outbox WHERE event_id=$1`, [outageId]);
  const r3 = await receiver();
  await processConversionOutboxOnce(); await queueConversionEvent(outage);
  const r4 = await receiver();
  proof["3_outage"] = {
    first_outcome: q, returned_in_ms: quick, row_after_first_attempt: dead.rows[0],
    after_6_failed_retries: still.rows[0], not_exhausted: still.rows[0]?.status === "pending",
  };
  proof["4_recovery"] = {
    row_after_recovery: after.rows[0], receiver_stages: r3.map(x => x.stage),
    receiver_count_after_recovery: r3.length, receiver_count_after_second_replay: r4.length,
    duplicates: r4.length - new Set(r4.map(x => x.event_id)).size,
  };
  writeFileSync(process.env["PROOF_OUT"] ?? "conversion-proof.json", JSON.stringify(proof, null, 2) + "\n");
}
main().catch(e => { console.error("echec:", (e as Error).name); process.exitCode = 1; }).finally(async () => { await pool.end(); await recv.end(); });
