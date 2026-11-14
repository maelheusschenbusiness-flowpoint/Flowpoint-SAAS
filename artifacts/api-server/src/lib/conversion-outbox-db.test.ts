/**
 * conversion-outbox-db.test.ts — la file durable des jalons Conversion B, sur
 * une vraie base.
 *
 * DEFAUT MESURE LE 21/10/2026 : le tableau Acquisition (plan gratuit Render)
 * s'endort apres quinze minutes et met pres d'une minute a se reveiller ; un
 * envoi etait abandonne apres deux secondes, et le jalon perdu. Ce qui est
 * verrouille ici : un jalon reste en base jusqu'a l'accuse de reception, un
 * service endormi est reessaye, un refus definitif est clos, rien n'est envoye
 * deux fois, et l'intention Stripe perdue entre deux ecritures est rattrapee.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { processConversionOutboxOnce, queueConversionEvent } from "./conversion-outbox.js";
import { logger } from "./logger.js";

const SECRET = "conversion-test-secret-at-least-32-characters";
const FP_LID = "TestLeadFp_0000000003C";
let dbOk = false;

/** Ce que repond le faux AI Lab : un statut, ou une panne reseau. */
let reponse: number | "panne" = 202;
let appels: Record<string, unknown>[] = [];

beforeAll(async () => {
  try { await pool.query("SELECT 1"); dbOk = true; } catch { dbOk = false; }
});

beforeEach(async () => {
  appels = [];
  reponse = 202;
  process.env["AI_LAB_CONVERSION_URL"] = "https://ai-lab.internal/events/conversion";
  process.env["CONVERSION_EVENT_SECRET"] = SECRET;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    appels.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    if (reponse === "panne") throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    return new Response(JSON.stringify({ recorded: reponse === 202, duplicate: false }), { status: reponse });
  });
  if (dbOk) await pool.query(`DELETE FROM conversion_event_outbox WHERE event_id LIKE 'test:%'`).catch(() => undefined);
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  delete process.env["AI_LAB_CONVERSION_URL"];
  delete process.env["CONVERSION_EVENT_SECRET"];
  if (dbOk) await pool.query(`DELETE FROM conversion_event_outbox WHERE event_id LIKE 'test:%'`).catch(() => undefined);
});

const jalon = (id = `test:${randomUUID()}`) => ({
  eventId: id, stage: "visit" as const, source: "marketing" as const,
  fpLid: FP_LID, occurredAt: "2026-10-21T10:00:00.000Z",
});

async function ligne(id: string) {
  const r = await pool.query(`SELECT * FROM conversion_event_outbox WHERE event_id = $1`, [id]);
  return r.rows[0] as Record<string, unknown> | undefined;
}
/** Le temps passe : la ligne est due maintenant. */
const echeance = (id: string) =>
  pool.query(`UPDATE conversion_event_outbox SET next_attempt_at = now() WHERE event_id = $1`, [id]);

describe("un jalon n'est perdu ni par un service endormi, ni par un redemarrage", () => {
  it("livre tout de suite quand AI Lab repond, et efface le fp_lid", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const j = jalon();
    expect(await queueConversionEvent(j)).toBe("sent");
    const l = await ligne(j.eventId);
    expect(l).toMatchObject({ status: "delivered", fp_lid: null, attempts: 1 });
  });

  it("service endormi : le jalon reste en base, puis part au reveil", async (ctx) => {
    if (!dbOk) return ctx.skip();
    reponse = "panne";
    const j = jalon();
    expect(await queueConversionEvent(j)).toBe("queued");
    expect(await ligne(j.eventId)).toMatchObject({ status: "pending", fp_lid: FP_LID, attempts: 1 });

    // Pas encore du : le worker n'y touche pas.
    await processConversionOutboxOnce();
    expect(appels).toHaveLength(1);

    reponse = 202;
    await echeance(j.eventId);
    expect(await processConversionOutboxOnce()).toBeGreaterThanOrEqual(1);
    expect(await ligne(j.eventId)).toMatchObject({ status: "delivered", fp_lid: null, attempts: 2 });
    expect(appels).toHaveLength(2);
  });

  for (const statut of [401, 404, 429, 503]) it(`un refus passager (${statut}) est reessaye avec un delai qui double`, async (ctx) => {
    if (!dbOk) return ctx.skip();
    reponse = statut;
    const j = jalon();
    expect(await queueConversionEvent(j)).toBe("queued");
    await echeance(j.eventId);
    await processConversionOutboxOnce();
    const l = await ligne(j.eventId);
    expect(l).toMatchObject({ status: "pending", attempts: 2, last_status: `rejected:${statut}` });
    const delai = await pool.query<{ minutes: number }>(
      `SELECT round(extract(epoch FROM next_attempt_at - now()) / 60)::int AS minutes
         FROM conversion_event_outbox WHERE event_id = $1`, [j.eventId]);
    expect(delai.rows[0]!.minutes).toBe(2);
  });

  it("un refus definitif (422) est clos, sans nouvel essai", async (ctx) => {
    if (!dbOk) return ctx.skip();
    reponse = 422;
    const j = jalon();
    expect(await queueConversionEvent(j)).toBe("rejected");
    expect(await ligne(j.eventId)).toMatchObject({ status: "rejected", fp_lid: null });
    await echeance(j.eventId);
    await processConversionOutboxOnce();
    expect(appels).toHaveLength(1);
  });

  it("un 400 est reessaye sur une fenetre bornee, se livre si le prospect devient connu", async (ctx) => {
    if (!dbOk) return ctx.skip();
    reponse = 400;
    const j = jalon();
    expect(await queueConversionEvent(j)).toBe("queued");
    expect(await ligne(j.eventId)).toMatchObject({ status: "pending", fp_lid: FP_LID, attempts: 1, last_status: "rejected:400" });
    reponse = 202; // le prospect a ete synchronise cote acquisition
    await echeance(j.eventId);
    await processConversionOutboxOnce();
    expect(await ligne(j.eventId)).toMatchObject({ status: "delivered", fp_lid: null, attempts: 2 });
  });

  it("un 400 persistant est abandonne apres 5 essais, sans rejeu infini et sans fp_lid conserve", async (ctx) => {
    if (!dbOk) return ctx.skip();
    reponse = 400;
    const j = jalon();
    await queueConversionEvent(j);
    for (let i = 0; i < 6; i++) { await echeance(j.eventId); await processConversionOutboxOnce(); }
    expect(await ligne(j.eventId)).toMatchObject({
      status: "rejected", fp_lid: null, attempts: 5, last_status: "rejected:400:exhausted",
    });
    expect(appels).toHaveLength(5);
  });

  it("les echecs reseau (service endormi) ne consomment pas les essais reserves aux 400", async (ctx) => {
    if (!dbOk) return ctx.skip();
    // Un reveil Render long : quatre tentatives sans reponse, puis AI Lab repond 400
    // (prospect pas encore synchronise). Le 400 doit ouvrir SA fenetre de reprise, pas clore la ligne.
    reponse = "panne";
    const j = jalon();
    await queueConversionEvent(j);
    for (let i = 0; i < 3; i++) { await echeance(j.eventId); await processConversionOutboxOnce(); }
    expect(await ligne(j.eventId)).toMatchObject({ status: "pending", attempts: 4 });
    reponse = 400;
    await echeance(j.eventId); await processConversionOutboxOnce();
    expect(await ligne(j.eventId)).toMatchObject({ status: "pending", fp_lid: FP_LID, last_status: "rejected:400" });
    const delai = await pool.query<{ minutes: number }>(
      `SELECT round(extract(epoch FROM next_attempt_at - now()) / 60)::int AS minutes
         FROM conversion_event_outbox WHERE event_id = $1`, [j.eventId]);
    expect(delai.rows[0]!.minutes).toBe(15);
    // Le prospect devient connu : la ligne se livre.
    reponse = 202;
    await echeance(j.eventId); await processConversionOutboxOnce();
    expect(await ligne(j.eventId)).toMatchObject({ status: "delivered", fp_lid: null });
  });

  it("un jalon abandonne ne repart jamais, ne se duplique pas et ne laisse aucune donnee personnelle dans le journal", async (ctx) => {
    if (!dbOk) return ctx.skip();
    vi.clearAllMocks();
    reponse = 400;
    const j = jalon();
    await queueConversionEvent(j);
    for (let i = 0; i < 6; i++) { await echeance(j.eventId); await processConversionOutboxOnce(); }
    expect(appels).toHaveLength(5);
    // Re-inscrire le meme jalon : doublon, aucun nouvel envoi, une seule ligne.
    expect(await queueConversionEvent(j)).toBe("duplicate");
    for (let i = 0; i < 3; i++) { await echeance(j.eventId); await processConversionOutboxOnce(); }
    expect(appels).toHaveLength(5);
    const n = await pool.query(`SELECT count(*)::int n FROM conversion_event_outbox WHERE event_id = $1`, [j.eventId]);
    expect(n.rows[0].n).toBe(1);
    // Aucun fp_lid ni secret dans AUCUN appel du logger (l'identifiant d'evenement
    // est un condensat opaque, journalise par conception).
    const journal = JSON.stringify([
      ...(logger.warn as ReturnType<typeof vi.fn>).mock.calls,
      ...(logger.info as ReturnType<typeof vi.fn>).mock.calls,
      ...(logger.error as ReturnType<typeof vi.fn>).mock.calls,
    ]);
    expect(journal).not.toContain(FP_LID);
    expect(journal).not.toContain(SECRET);
    expect(journal).not.toMatch(/fp_lid|fpLid/i);
    expect(journal).toContain("conversion_event_abandoned");
    // Un seul abandon journalise, avec des champs bornes.
    const abandons = (logger.warn as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => (c[0] as { event?: string })?.event === "conversion_event_abandoned");
    expect(abandons).toHaveLength(1);
    expect(Object.keys(abandons[0]![0] as object).sort()).toEqual(["attempts", "event", "source", "stage"]);
  });

  it("un meme jalon inscrit deux fois n'existe et ne part qu'une fois", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const j = jalon();
    expect(await queueConversionEvent(j)).toBe("sent");
    expect(await queueConversionEvent(j)).toBe("duplicate");
    const n = await pool.query(`SELECT count(*)::int n FROM conversion_event_outbox WHERE event_id = $1`, [j.eventId]);
    expect(n.rows[0].n).toBe(1);
    expect(appels).toHaveLength(1);
  });

  it("deux workers en parallele ne livrent jamais deux fois la meme ligne", async (ctx) => {
    if (!dbOk) return ctx.skip();
    reponse = "panne";
    const ids = await Promise.all([1, 2, 3, 4, 5].map(async () => {
      const j = jalon(); await queueConversionEvent(j); return j.eventId;
    }));
    reponse = 202;
    appels = [];
    for (const id of ids) await echeance(id);
    await Promise.all([processConversionOutboxOnce(), processConversionOutboxOnce()]);
    const envoyes = appels.map((a) => a["event_id"]).filter((id) => ids.includes(String(id)));
    expect(envoyes.sort()).toEqual([...ids].sort());
  });

  it("sans configuration, rien n'est inscrit ni envoye", async (ctx) => {
    if (!dbOk) return ctx.skip();
    delete process.env["CONVERSION_EVENT_SECRET"];
    const j = jalon();
    expect(await queueConversionEvent(j)).toBe("not-configured");
    expect(await ligne(j.eventId)).toBeUndefined();
    expect(appels).toHaveLength(0);
  });
});

describe("l'intention Stripe perdue entre deux ecritures est rattrapee", () => {
  it("un billing_event marque mais jamais confie est inscrit, livre, puis marque", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const org = randomUUID();
    const stripeId = `evt_test_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    await pool.query(`INSERT INTO organizations (id, name, owner_email, created_at, fp_lid)
      VALUES ($1::uuid, 'Org file Conversion B', 'outbox@flowpoint-test.internal', NOW(), $2)`, [org, FP_LID]);
    try {
      await pool.query(`INSERT INTO billing_events (org_id, type, stripe_event_id, metadata, created_at)
        VALUES ($1, 'invoice.paid', $2, $3::jsonb, NOW() - interval '10 minutes')`,
        [org, stripeId, JSON.stringify({ aiLabStages: ["checkout", "trial"],
          aiLabOccurredAt: "2026-10-21T09:00:00.000Z", aiLabEmitted: false })]);
      await processConversionOutboxOnce();
      const recus = appels.filter((a) => String(a["event_id"]).startsWith(`stripe:${stripeId}:`));
      expect(recus.map((a) => a["stage"]).sort()).toEqual(["checkout", "trial"]);
      const be = await pool.query(`SELECT metadata FROM billing_events WHERE stripe_event_id = $1`, [stripeId]);
      expect(be.rows[0].metadata).toMatchObject({ aiLabEmitted: true, aiLabQueued: true });
      // Une seconde passe ne renvoie rien.
      appels = [];
      await processConversionOutboxOnce();
      expect(appels.filter((a) => String(a["event_id"]).startsWith(`stripe:${stripeId}:`))).toHaveLength(0);
    } finally {
      await pool.query(`DELETE FROM conversion_event_outbox WHERE event_id LIKE $1`, [`stripe:${stripeId}:%`]);
      await pool.query(`DELETE FROM billing_events WHERE stripe_event_id = $1`, [stripeId]);
      await pool.query(`DELETE FROM organizations WHERE id = $1::uuid`, [org]);
    }
  });
});
