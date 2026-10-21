/**
 * Conversion B — file d'attente durable des jalons envoyes a AI Lab.
 *
 * POURQUOI. Le tableau Acquisition tourne sur le plan gratuit de Render : il
 * s'endort apres quinze minutes sans trafic et met pres d'une minute a se
 * reveiller, alors qu'un envoi est abandonne apres deux secondes. Sans file,
 * tout jalon emis pendant un reveil etait perdu — definitivement pour une etape
 * navigateur, et sans rejeu pour Stripe.
 *
 * LE CONTRAT. Un jalon est inscrit dans PostgreSQL AVANT tout appel, puis
 * conserve jusqu'a ce qu'AI Lab en accuse reception (`sent` ou `duplicate`).
 * Un refus definitif — contrat invalide, `fp_lid` inconnu (400, 413, 422) — le
 * clot sans nouvel essai. Tout le reste (reseau, delai, 401 d'un secret pas
 * encore pose, 404 d'un endpoint pas encore deploye, 5xx, 429) est reessaye
 * avec un delai qui double, plafonne a une heure. Rien n'expire.
 *
 * LA DEDUPLICATION. L'identifiant d'evenement est la cle primaire : un jalon
 * inscrit deux fois ne l'est qu'une, et AI Lab deduplique de son cote.
 *
 * LA CONFIDENTIALITE. Le `fp_lid` n'est garde que le temps de la livraison : il
 * est efface des que la ligne est close. Aucun email, aucune URL, aucune IP.
 *
 * NE JAMAIS NUIRE. Aucune fonction de ce module ne leve. Si la base refuse
 * l'inscription, on retombe sur l'envoi direct d'avant.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger.js";
import {
  conversionConfiguree,
  emitConversionEvent,
  envoyerJalon,
  jalonValide,
  type ConversionEvent,
  type ConversionStage,
  type EmitOutcome,
} from "./conversion-events.js";

/** Le resultat d'une mise en file. `queued` : inscrit, livraison a venir. */
export type QueueOutcome = EmitOutcome | "queued";

/** Le worker laisse au service endormi le temps de se reveiller. */
const DELAI_WORKER_MS = 10_000;
const PLAFOND_BACKOFF_MIN = 60;
const LOT = 50;
/** Les refus que rien ne corrigera : on clot la ligne. */
const REFUS_DEFINITIFS = new Set([400, 413, 422]);

let tablePrete = false;
async function assurerTable(): Promise<void> {
  if (tablePrete) return;
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversion_event_outbox (
        event_id        TEXT        PRIMARY KEY,
        stage           TEXT        NOT NULL,
        source          TEXT        NOT NULL,
        fp_lid          TEXT,
        occurred_at     TIMESTAMPTZ NOT NULL,
        status          TEXT        NOT NULL DEFAULT 'pending',
        attempts        INTEGER     NOT NULL DEFAULT 0,
        last_status     TEXT,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        closed_at       TIMESTAMPTZ
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS conversion_event_outbox_due_idx
      ON conversion_event_outbox (next_attempt_at) WHERE status = 'pending'`);
    // Table interne au backend : RLS active, aucun acces des roles d'API.
    await client.query(`ALTER TABLE conversion_event_outbox ENABLE ROW LEVEL SECURITY`);
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          REVOKE ALL ON conversion_event_outbox FROM anon;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          REVOKE ALL ON conversion_event_outbox FROM authenticated;
        END IF;
      END $$`);
    tablePrete = true;
  } finally {
    client.release();
  }
}

interface Ligne {
  event_id: string;
  stage: ConversionStage;
  source: ConversionEvent["source"];
  fp_lid: string | null;
  occurred_at: Date | string;
  attempts: number;
}

function enJalon(l: Ligne): ConversionEvent | null {
  if (!l.fp_lid) return null;
  const at = l.occurred_at instanceof Date ? l.occurred_at.toISOString() : String(l.occurred_at);
  return { eventId: l.event_id, stage: l.stage, source: l.source, fpLid: l.fp_lid, occurredAt: at };
}

/**
 * Une tentative, et la trace qu'elle laisse. `clos` : la ligne est terminee
 * (livree ou refusee definitivement) ; sinon elle reste en file.
 */
async function livrer(l: Ligne, timeoutMs?: number): Promise<{ outcome: EmitOutcome; clos: boolean }> {
  const jalon = enJalon(l);
  if (!jalon) return { outcome: "invalid-input", clos: true };
  const { outcome, status } = await envoyerJalon(jalon, timeoutMs);
  if (outcome === "not-configured") {
    // La configuration a disparu : on garde la ligne, sans compter d'essai.
    await pool.query(`UPDATE conversion_event_outbox
      SET next_attempt_at = now() + interval '10 minutes' WHERE event_id = $1`, [l.event_id]);
    return { outcome, clos: false };
  }
  if (outcome === "sent" || outcome === "duplicate"
      || outcome === "invalid-input"
      || (outcome === "rejected" && status !== undefined && REFUS_DEFINITIFS.has(status))) {
    const clos = outcome === "sent" || outcome === "duplicate" ? "delivered" : "rejected";
    await pool.query(`UPDATE conversion_event_outbox
      SET status = $2, last_status = $3, attempts = attempts + 1,
          closed_at = now(), fp_lid = NULL
      WHERE event_id = $1`, [l.event_id, clos, `${outcome}${status ? `:${status}` : ""}`]);
    return { outcome, clos: true };
  }
  const backoff = Math.min(PLAFOND_BACKOFF_MIN, 2 ** Math.min(l.attempts, 6));
  await pool.query(`UPDATE conversion_event_outbox
    SET attempts = attempts + 1, last_status = $2,
        next_attempt_at = now() + ($3 || ' minutes')::interval
    WHERE event_id = $1`, [l.event_id, `${outcome}${status ? `:${status}` : ""}`, String(backoff)]);
  return { outcome, clos: false };
}

/**
 * Inscrit un jalon, puis tente de le livrer tout de suite. Ne leve jamais.
 *
 * `sent`/`duplicate` : AI Lab l'a. `queued` : il est en base et sera relivre.
 * `rejected` : refus definitif. `not-configured`/`invalid-input` : rien n'est
 * inscrit, exactement comme avant.
 */
export async function queueConversionEvent(event: ConversionEvent): Promise<QueueOutcome> {
  if (!conversionConfiguree()) return "not-configured";
  if (!jalonValide(event)) return "invalid-input";
  let ligne: Ligne | undefined;
  try {
    await assurerTable();
    const r = await pool.query<Ligne & { status: string }>(
      `INSERT INTO conversion_event_outbox (event_id, stage, source, fp_lid, occurred_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id, stage, source, fp_lid, occurred_at, attempts, status`,
      [event.eventId, event.stage, event.source, event.fpLid, event.occurredAt]);
    ligne = r.rows[0];
    if (!ligne) return "duplicate";
  } catch (err) {
    logger.warn({ err: (err as Error)?.name, stage: event.stage },
      "[AI Lab] conversion outbox unavailable — direct emission (non-fatal)");
    return emitConversionEvent(event);
  }
  try {
    // La ligne vient d'etre creee par cet appel : personne d'autre ne la tient.
    await pool.query(`UPDATE conversion_event_outbox
      SET next_attempt_at = now() + interval '2 minutes' WHERE event_id = $1`, [ligne.event_id]);
    const { outcome, clos } = await livrer(ligne);
    // Un refus passager laisse la ligne en file : c'est `queued`, pas un echec.
    return clos ? outcome : "queued";
  } catch (err) {
    logger.warn({ err: (err as Error)?.name, stage: event.stage },
      "[AI Lab] conversion outbox delivery deferred (non-fatal)");
    return "queued";
  }
}

/**
 * Les jalons Stripe dont l'intention est inscrite dans `billing_events` mais qui
 * n'ont jamais atteint la file : un processus arrete entre la marque
 * `processed` et l'emission. Ils sont inscrits ici, et marques comme confies.
 */
async function rattraperStripe(): Promise<number> {
  const r = await pool.query<{ stripe_event_id: string; stages: string[]; at: string; fp_lid: string | null }>(
    `SELECT be.stripe_event_id,
            ARRAY(SELECT jsonb_array_elements_text(be.metadata->'aiLabStages')) AS stages,
            be.metadata->>'aiLabOccurredAt' AS at, o.fp_lid
       FROM billing_events be JOIN organizations o ON o.id::text = be.org_id
      WHERE be.metadata ? 'aiLabStages'
        AND coalesce(be.metadata->>'aiLabEmitted', 'false') <> 'true'
        AND be.created_at < now() - interval '2 minutes'
        AND be.stripe_event_id IS NOT NULL
      LIMIT $1`, [LOT]);
  let n = 0;
  for (const row of r.rows) {
    if (!row.fp_lid || !row.at) continue;
    let tous = true;
    for (const stage of row.stages) {
      const outcome = await queueConversionEvent({
        eventId: `stripe:${row.stripe_event_id}:${stage}`,
        stage: stage as ConversionStage, source: "stripe", fpLid: row.fp_lid, occurredAt: row.at,
      });
      if (outcome === "not-configured" || outcome === "invalid-input" || outcome === "unreachable") tous = false;
    }
    if (tous) {
      await pool.query(`UPDATE billing_events
        SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"aiLabEmitted": true, "aiLabQueued": true}'::jsonb
        WHERE stripe_event_id = $1`, [row.stripe_event_id]);
      n++;
    }
  }
  return n;
}

/** Une passe : les jalons dus, puis le rattrapage Stripe. Rend le nombre livre. */
export async function processConversionOutboxOnce(limit = LOT): Promise<number> {
  if (!conversionConfiguree()) return 0;
  await assurerTable();
  // Le bail : une ligne prise par une instance ne l'est pas par l'autre pendant
  // un deploiement sans coupure. Un double envoi resterait sans effet chez AI
  // Lab, mais il n'a aucune raison d'exister.
  const dues = await pool.query<Ligne>(
    `UPDATE conversion_event_outbox SET next_attempt_at = now() + interval '5 minutes'
      WHERE event_id IN (
        SELECT event_id FROM conversion_event_outbox
         WHERE status = 'pending' AND next_attempt_at <= now()
         ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING event_id, stage, source, fp_lid, occurred_at, attempts`, [limit]);
  let livres = 0;
  for (const l of dues.rows) {
    const { outcome } = await livrer(l, DELAI_WORKER_MS);
    if (outcome === "sent" || outcome === "duplicate") livres++;
  }
  await rattraperStripe().catch((err) =>
    logger.warn({ err: (err as Error)?.name }, "[AI Lab] stripe milestone catch-up skipped (non-fatal)"));
  return livres;
}

let workerDemarre = false;
let passeEnCours = false;
/** Le worker periodique, demarre une fois au lancement du serveur. */
export function startConversionOutboxWorker(intervalMs = 60_000): void {
  if (workerDemarre) return;
  workerDemarre = true;
  const t = setInterval(() => {
    if (passeEnCours) return;
    passeEnCours = true;
    processConversionOutboxOnce()
      .then((n) => { if (n > 0) logger.info({ delivered: n }, "[AI Lab] conversion outbox: delivered pending milestones"); })
      .catch((err) => logger.warn({ err: (err as Error)?.name }, "[AI Lab] conversion outbox tick failed (non-fatal)"))
      .finally(() => { passeEnCours = false; });
  }, intervalMs);
  (t as { unref?: () => void }).unref?.();
}
