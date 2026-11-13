/**
 * Un checkout = un abonnement, meme sous concurrence.
 *
 * Le garde historique de finalize-checkout lit les abonnements du client puis
 * en cree un si aucun ne convient. Entre la lecture et l'ecriture il n'y a rien :
 * trois appels simultanes du meme checkout (double-clic, onglet reouvert, retry
 * d'un proxy, relance apres timeout) lisent tous les trois « aucun abonnement »
 * et creent tous les trois le leur. Mesure sur Stripe en mode test, trois appels
 * concurrents : trois abonnements `trialing` sur le meme prix, donc trois
 * facturations a la fin de l'essai.
 *
 * Deux barrieres independantes ferment la fenetre, et il en faut deux :
 *
 *  1. PostgreSQL — une ligne par tentative de checkout, posee en INSERT
 *     ... ON CONFLICT. L'INSERT est atomique : un seul appel repart
 *     proprietaire, les autres attendent l'identifiant d'abonnement que le
 *     proprietaire inscrira. C'est la barriere qui evite meme l'appel reseau
 *     en double.
 *
 *  2. La cle d'idempotence Stripe — derivee de la meme tentative de checkout,
 *     donc stable d'un appel a l'autre et d'un processus a l'autre. Elle couvre
 *     ce que PostgreSQL ne peut pas couvrir : base injoignable, table absente,
 *     processus tue entre la creation Stripe et l'ecriture du resultat. Stripe
 *     renvoie alors l'abonnement deja cree au lieu d'en creer un second.
 *
 * Le bail est ce qui permet la reprise apres interruption : un proprietaire qui
 * meurt sans conclure laisse une ligne sans identifiant, dont le bail expire ;
 * le suivant la reprend. Sans bail, un processus tue bloquerait le checkout
 * pour toujours ; avec un bail mais sans cle Stripe, la reprise pourrait creer
 * un second abonnement. Les deux ensemble, ni blocage ni doublon.
 *
 * Aucun appel ici ne fait echouer le checkout : le client a paye. Une panne de
 * la table degrade vers « barriere Stripe seule », journalisee en ERROR.
 */

import { createHash } from "node:crypto";
import { logger } from "../lib/logger.js";

const LOG = "[CheckoutClaim]";

export const CLAIM_TABLE = "checkout_subscription_claims";

/** Duree du bail d'un proprietaire. Au-dela, la tentative est reprenable. */
export const CLAIM_LEASE_MS = 120_000;
/** Temps qu'un suiveur accorde au proprietaire avant d'envisager la reprise. */
export const FOLLOWER_WAIT_MS = 8_000;
const FOLLOWER_POLL_MS = 200;

/** Le strict minimum attendu d'un pool pg — garde le module testable. */
export type Queryable = {
  query: (
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
};

export type ClaimRole =
  /** Cet appel doit creer l'abonnement. */
  | "owner"
  /** Le bail d'un proprietaire mort a ete repris : creer, Stripe dedoublonnera. */
  | "takeover"
  /** L'abonnement existe deja pour cette tentative : le reutiliser. */
  | "settled"
  /** Un proprietaire vivant travaille : attendre son resultat. */
  | "pending";

export type ClaimOutcome = {
  role: ClaimRole;
  subscriptionId: string | null;
};

/**
 * Identite d'une tentative de checkout.
 *
 * L'ancre est l'intent Stripe : il est cree une fois par tentative, le
 * navigateur le renvoie tel quel a chaque appel de finalize-checkout, et il
 * survit au rechargement de la page comme au redemarrage du serveur. Le plan et
 * le prix entrent dans la cle pour qu'un changement de panier reste une
 * tentative distincte. La cle sert aussi de cle d'idempotence Stripe : meme
 * materiau, meme decision des deux cotes.
 */
export function subscriptionAttemptKey(parts: {
  scope: string;
  intentId: string;
  plan: string;
  priceId: string;
}): string {
  const material = [
    "checkout_subscription",
    parts.scope,
    parts.intentId,
    parts.plan,
    parts.priceId,
  ].join("|");
  return "fp_sub_" + createHash("sha256").update(material).digest("hex").slice(0, 48);
}

/**
 * Pose la table si elle manque — auto-reparation pour un deploiement anterieur
 * a la migration. Backend-only : RLS active et forcee, aucune policy publique,
 * donc deni implicite pour anon/authenticated (meme traitement que
 * pending_signups et checkout_post_tokens).
 */
export async function ensureClaimTable(db: Queryable): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${CLAIM_TABLE} (
      attempt_key      TEXT PRIMARY KEY,
      intent_id        TEXT        NOT NULL,
      plan             TEXT        NOT NULL DEFAULT '',
      price_id         TEXT        NOT NULL DEFAULT '',
      org_ref          TEXT,
      subscription_id  TEXT,
      attempts         INTEGER     NOT NULL DEFAULT 1,
      claimed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      claim_expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      settled_at       TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(
    `CREATE INDEX IF NOT EXISTS ${CLAIM_TABLE}_intent_idx ON ${CLAIM_TABLE}(intent_id);`
  );
  await db.query(`ALTER TABLE ${CLAIM_TABLE} ENABLE ROW LEVEL SECURITY;`);
  await db.query(`ALTER TABLE ${CLAIM_TABLE} FORCE ROW LEVEL SECURITY;`);
}

/**
 * Revendique la creation, atomiquement.
 *
 * Tout tient dans un seul INSERT ... ON CONFLICT : c'est ce qui rend la
 * decision indivisible. `xmax = 0` distingue l'insertion de la mise a jour,
 * donc le premier proprietaire d'une reprise de bail. La clause WHERE du
 * DO UPDATE refuse de reprendre une tentative deja conclue ou dont le bail
 * court toujours — dans ce cas aucune ligne ne revient et l'appelant est un
 * suiveur.
 */
export async function claimSubscriptionCreation(
  db: Queryable,
  args: {
    attemptKey: string;
    intentId: string;
    plan: string;
    priceId: string;
    orgRef?: string | null;
    leaseMs?: number;
  }
): Promise<ClaimOutcome> {
  const leaseSecs = Math.max(1, Math.round((args.leaseMs ?? CLAIM_LEASE_MS) / 1000));
  const claimed = await db.query(
    `INSERT INTO ${CLAIM_TABLE}
       (attempt_key, intent_id, plan, price_id, org_ref, claimed_at, claim_expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW() + make_interval(secs => $6::double precision))
     ON CONFLICT (attempt_key) DO UPDATE
        SET claimed_at       = NOW(),
            claim_expires_at = NOW() + make_interval(secs => $6::double precision),
            attempts         = ${CLAIM_TABLE}.attempts + 1
      WHERE ${CLAIM_TABLE}.subscription_id IS NULL
        AND ${CLAIM_TABLE}.claim_expires_at <= NOW()
     RETURNING subscription_id, (xmax = 0) AS inserted`,
    [args.attemptKey, args.intentId, args.plan, args.priceId, args.orgRef ?? null, leaseSecs]
  );

  const row = claimed.rows[0];
  if (row) {
    return {
      role: row["inserted"] === true ? "owner" : "takeover",
      subscriptionId: (row["subscription_id"] as string | null) ?? null,
    };
  }

  // Aucune ligne : la tentative est conclue, ou un proprietaire vivant travaille.
  const existing = await db.query(
    `SELECT subscription_id FROM ${CLAIM_TABLE} WHERE attempt_key = $1`,
    [args.attemptKey]
  );
  const subscriptionId = (existing.rows[0]?.["subscription_id"] as string | null) ?? null;
  return subscriptionId
    ? { role: "settled", subscriptionId }
    : { role: "pending", subscriptionId: null };
}

/**
 * Inscrit l'abonnement cree — le premier ecrivain gagne.
 *
 * Le COALESCE est la pour le cas pathologique ou deux abonnements ont malgre
 * tout ete crees : la tentative garde le premier et l'appelant apprend, par la
 * valeur de retour, que le sien est en trop. Sans ce retour, le doublon
 * passerait inapercu.
 */
export async function settleSubscriptionClaim(
  db: Queryable,
  attemptKey: string,
  subscriptionId: string
): Promise<string | null> {
  const res = await db.query(
    `UPDATE ${CLAIM_TABLE}
        SET subscription_id = COALESCE(subscription_id, $2),
            settled_at      = COALESCE(settled_at, NOW())
      WHERE attempt_key = $1
      RETURNING subscription_id`,
    [attemptKey, subscriptionId]
  );
  return (res.rows[0]?.["subscription_id"] as string | null) ?? null;
}

/** Attend que le proprietaire inscrive son resultat. `null` = il n'a pas conclu. */
export async function waitForClaimedSubscription(
  db: Queryable,
  attemptKey: string,
  opts?: { timeoutMs?: number; pollMs?: number }
): Promise<string | null> {
  const timeoutMs = opts?.timeoutMs ?? FOLLOWER_WAIT_MS;
  const pollMs = opts?.pollMs ?? FOLLOWER_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await db.query(
      `SELECT subscription_id FROM ${CLAIM_TABLE} WHERE attempt_key = $1`,
      [attemptKey]
    );
    const found = (res.rows[0]?.["subscription_id"] as string | null) ?? null;
    if (found) return found;
    if (Date.now() + pollMs > deadline) return null;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/**
 * Deux requetes qui partagent une cle d'idempotence et arrivent ensemble : la
 * seconde se voit refuser par Stripe (`idempotency_in_progress`) le temps que
 * la premiere aboutisse. Abandonner la ferait repartir sans cle et creerait le
 * doublon ; on attend donc la reponse memorisee. Toute autre erreur remonte
 * telle quelle.
 */
export async function createWithIdempotency<T>(
  create: (idempotencyKey: string) => Promise<T>,
  idempotencyKey: string,
  opts?: { attempts?: number; delayMs?: number }
): Promise<T> {
  const attempts = opts?.attempts ?? 6;
  const delayMs = opts?.delayMs ?? 700;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await create(idempotencyKey);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      const inFlight = code === "idempotency_in_progress" || code === "lock_timeout";
      if (!inFlight) throw err;
      lastErr = err;
      logger.warn(
        { attempt: i + 1, code },
        `${LOG} tentative concurrente en vol chez Stripe — attente de la reponse memorisee`
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
