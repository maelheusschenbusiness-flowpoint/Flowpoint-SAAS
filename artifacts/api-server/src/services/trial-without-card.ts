/**
 * trial-without-card.ts — essai gratuit de 14 jours SANS carte bancaire.
 *
 * DERRIERE UN DRAPEAU. `TRIAL_WITHOUT_CARD=true` autorise la CREATION de
 * nouveaux essais sans carte (formulaire et Google). Toute autre valeur
 * (absente comprise) l'interdit : le parcours carte (pre-register → plan →
 * carte → finalize-checkout) reste le seul chemin d'inscription.
 *
 * Le drapeau ne pilote QUE la creation. Les protections des essais deja crees
 * (garde serveur 402, filtres des taches planifiees, passe d'expiration) se
 * fondent sur `organizations.trial_origin = 'cardless'`, pose a la creation, et
 * s'appliquent quel que soit l'etat du drapeau.
 *
 * MODELE CHOISI : essai porte par la base, pas par Stripe.
 *   organizations.subscription_status = 'trialing'
 *   organizations.trial_started_at    = NOW()
 *   organizations.trial_consumed_at   = NOW()   ← un seul essai par organisation
 *   organizations.trial_ends_at       = NOW() + TRIAL_DAYS
 *   stripe_customer_id / stripe_subscription_id = NULL
 *
 * Ce n'est PAS l'ancien « faux essai » supprime le 2026-07-26 : celui-la
 * n'avait pas de `trial_consumed_at`, ce qui le faisait normaliser en
 * `pending_billing`. `normalizeSubscriptionStatus` (lib/subscription-state.ts)
 * prevoit deja l'etat « trialing, sans abonnement, trial_consumed_at pose » :
 * `trialing` tant que `trial_ends_at` est dans le futur, puis `none` (aucun
 * client Stripe) — donc plus d'acces premium, exactement comme un essai Stripe
 * expire. Le SQL de normalisation (Fix 2) ne touche que les lignes SANS
 * `trial_consumed_at` : il laisse ces essais intacts.
 *
 * Aucun objet Stripe n'est cree a l'inscription : pas de client orphelin si le
 * prospect ne revient jamais. Le paiement passe ensuite par le checkout
 * existant (POST /billing/upgrade → Checkout sans client pre-cree, le webhook
 * ancre le client a l'organisation).
 */
import type { PoolClient } from "pg";
import { TRIAL_DAYS } from "./billing-quote.js";
import { normalizeFpLid } from "../lib/fp-lid.js";

/** Plan accorde pendant l'essai sans carte : le moins couteux (quotas IA/SEO les plus bas). */
export const CARDLESS_TRIAL_PLAN = "standard";

/** Stripe exige qu'un `trial_end` de Checkout soit a au moins 48 h. */
const STRIPE_MIN_TRIAL_END_MS = 48 * 60 * 60 * 1000;

export function isTrialWithoutCardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env["TRIAL_WITHOUT_CARD"] ?? "").trim().toLowerCase() === "true";
}

/**
 * Limite par domaine d'entreprise : au-dela de `max` essais demarres sur
 * `windowDays` jours pour un meme domaine, un nouvel essai est refuse.
 * Configurable : TRIAL_DOMAIN_MAX_TRIALS (defaut 3), TRIAL_DOMAIN_WINDOW_DAYS
 * (defaut 30). Valeurs invalides → defauts.
 */
export function trialDomainLimit(env: NodeJS.ProcessEnv = process.env): { max: number; windowDays: number } {
  const int = (raw: unknown, dflt: number, lo: number, hi: number) => {
    const n = Number(String(raw ?? "").trim());
    return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt;
  };
  return {
    max: int(env["TRIAL_DOMAIN_MAX_TRIALS"], 3, 1, 1000),
    windowDays: int(env["TRIAL_DOMAIN_WINDOW_DAYS"], 30, 1, 3650),
  };
}

/**
 * Predicat SQL (table `organizations`, sans alias) d'un essai sans carte EXPIRE :
 * `trialing`, aucun abonnement Stripe, essai consomme, echeance passee. C'est
 * exactement l'etat que normalizeSubscriptionStatus ramene a `none`/`incomplete`.
 */
/** Valeur de `organizations.trial_origin` posee a la creation d'un essai sans carte. */
export const CARDLESS_TRIAL_ORIGIN = "cardless";

export const CARDLESS_TRIAL_EXPIRED_WHERE =
  `trial_origin = 'cardless'
   AND subscription_status = 'trialing'
   AND COALESCE(stripe_subscription_id, '') = ''
   AND trial_consumed_at IS NOT NULL
   AND trial_ends_at IS NOT NULL
   AND trial_ends_at <= NOW()`;

/**
 * Parmi `orgIds`, celles dont l'essai sans carte a expire — pour que les taches
 * planifiees les sautent, QUEL QUE SOIT le drapeau. Ne leve jamais : en cas d'erreur, ensemble vide
 * (comportement d'avant : la tache tourne) et l'appelant journalise.
 */
export async function expiredCardlessTrialOrgIds(
  db: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<{ id: string }> }> },
  orgIds: Iterable<string>,
): Promise<Set<string>> {
  const ids = [...new Set([...orgIds].filter(id => /^[0-9a-f-]{36}$/i.test(String(id ?? ""))))];
  if (ids.length === 0) return new Set();
  try {
    const r = await db.query(
      `SELECT id::text AS id FROM organizations WHERE id::text = ANY($1::text[]) AND ${CARDLESS_TRIAL_EXPIRED_WHERE}`,
      [ids],
    );
    return new Set((r.rows ?? []).map(x => String(x.id)));
  } catch {
    return new Set();
  }
}

/**
 * Messageries grand public : le garde « un essai par domaine » ne s'y applique
 * pas (des milliers de personnes differentes partagent gmail.com). Le garde
 * par adresse canonique, lui, s'applique partout.
 */
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "outlook.fr", "outlook.be", "hotmail.com",
  "hotmail.fr", "hotmail.be", "live.com", "live.fr", "live.be", "msn.com", "yahoo.com",
  "yahoo.fr", "yahoo.be", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com",
  "orange.fr", "wanadoo.fr", "free.fr", "sfr.fr", "neuf.fr", "laposte.net", "bbox.fr",
  "numericable.fr", "gmx.fr", "gmx.com", "gmx.de", "gmx.net", "proton.me", "protonmail.com",
  "pm.me", "skynet.be", "telenet.be", "voo.be", "bluewin.ch", "web.de", "zoho.com", "mail.com",
  "hotmail.co.uk", "outlook.de", "hotmail.de", "hotmail.it", "hotmail.es", "live.co.uk", "yahoo.co.uk",
  "protonmail.ch", "proton.ch", "tutanota.com", "free.com", "club-internet.fr", "aliceadsl.fr",
]);

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export interface CanonicalEmail {
  local: string;
  domain: string;
  /** Adresse qui identifie une boite : `+etiquette` retiree, points retires chez Gmail. */
  canonical: string;
}

/**
 * `marie+essai2@agence.fr` et `marie@agence.fr` sont la meme boite ; chez Gmail
 * `m.a.r.i.e@gmail.com` aussi. Sans cette forme canonique, « un essai par
 * adresse » se contourne en ajoutant `+1`.
 */
export function canonicalTrialEmail(email: string): CanonicalEmail {
  const lower = String(email ?? "").trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  let local = at >= 0 ? lower.slice(0, at) : lower;
  let domain = at >= 0 ? lower.slice(at + 1).replace(/\.$/, "") : "";
  local = local.replace(/\+.*$/, "");
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return { local, domain, canonical: `${local}@${domain}` };
}

/** Le domaine soumis au garde « un essai par entreprise », ou null (messagerie grand public). */
export function trialGuardDomain(email: string): string | null {
  const { domain } = canonicalTrialEmail(email);
  if (!domain || FREE_MAIL_DOMAINS.has(domain)) return null;
  return domain;
}

export interface CardlessTrialState {
  rawSubscriptionStatus: string | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  trialConsumedAt: string | null;
  trialEndsAt: string | null;
}

/** Une organisation en essai sans carte : essai consomme, aucun objet Stripe. */
export function isCardlessTrial(ctx: CardlessTrialState): boolean {
  return ctx.rawSubscriptionStatus === "trialing"
    && !String(ctx.stripeSubscriptionId ?? "").trim()
    && !String(ctx.stripeCustomerId ?? "").trim()
    && !!ctx.trialConsumedAt;
}

/**
 * Quand un essai sans carte passe au paiement avant la fin de l'essai, le
 * premier prelevement doit tomber a la fin de l'essai deja promis — pas
 * aujourd'hui. Renvoie le `trial_end` (secondes Unix) a transmettre a Stripe
 * Checkout, ou `undefined` quand il n'y a rien a reporter (pas un essai sans
 * carte, essai termine, ou moins de 48 h restantes : Stripe refuserait, on
 * facture alors tout de suite).
 */
export function cardlessTrialEndForCheckout(ctx: CardlessTrialState, now: Date = new Date()): number | undefined {
  if (!isCardlessTrial(ctx) || !ctx.trialEndsAt) return undefined;
  const end = new Date(ctx.trialEndsAt).getTime();
  if (!Number.isFinite(end) || end - now.getTime() < STRIPE_MIN_TRIAL_END_MS) return undefined;
  return Math.floor(end / 1000);
}

export type TrialAbuseVerdict =
  | { ok: true }
  | { ok: false; code: "TRIAL_ALREADY_USED_EMAIL" | "TRIAL_DOMAIN_LIMIT"; domain?: string };

type Queryable = Pick<PoolClient, "query">;

/**
 * Un essai par boite mail canonique, et une limite par domaine d'entreprise.
 *
 * - Boite : toute organisation dont le proprietaire a la meme adresse
 *   canonique bloque (meme apres expiration ou paiement : un seul essai).
 * - Domaine d'entreprise (jamais pour une messagerie grand public) : refus
 *   seulement quand `max` essais ont deja demarre sur ce domaine dans les
 *   `windowDays` derniers jours. Plusieurs personnes d'une meme entreprise
 *   peuvent donc chacune essayer, sans enchainement illimite.
 */
export async function checkTrialAbuse(
  db: Queryable,
  email: string,
  limit: { max: number; windowDays: number } = trialDomainLimit(),
): Promise<TrialAbuseVerdict> {
  const c = canonicalTrialEmail(email);
  const domains = c.domain === "gmail.com" ? ["gmail.com", "googlemail.com"] : [c.domain];
  const sameMailbox = await db.query(
    `SELECT 1 FROM organizations
      WHERE lower(split_part(owner_email, '@', 2)) = ANY($2::text[])
        AND (CASE WHEN lower(split_part(owner_email, '@', 2)) IN ('gmail.com', 'googlemail.com')
                  THEN replace(regexp_replace(lower(split_part(owner_email, '@', 1)), '\\+.*$', ''), '.', '')
                  ELSE regexp_replace(lower(split_part(owner_email, '@', 1)), '\\+.*$', '')
             END) = $1
      LIMIT 1`,
    [c.local, domains],
  );
  if ((sameMailbox.rows?.length ?? 0) > 0) return { ok: false, code: "TRIAL_ALREADY_USED_EMAIL" };

  const domain = trialGuardDomain(email);
  if (domain) {
    const extra = await activeDomainExtraTrials(db, domain);
    const recent = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM organizations
        WHERE lower(split_part(owner_email, '@', 2)) = $1
          AND trial_started_at IS NOT NULL
          AND trial_started_at > NOW() - ($2::int * INTERVAL '1 day')`,
      [domain, limit.windowDays],
    );
    if (Number(recent.rows?.[0]?.n ?? 0) >= limit.max + extra) return { ok: false, code: "TRIAL_DOMAIN_LIMIT", domain };
  }
  return { ok: true };
}

export interface CardlessTrialInput {
  email: string;
  firstName: string;
  companyName: string;
  sellerId: string | null;
  /** Valeur brute recue ; normalisee ici. */
  rawFpLid: unknown;
  preToken: string;
  orgId: string;
  userId: string;
  /** 'magic_link' (formulaire) ou 'google' (OAuth). */
  authProvider?: "magic_link" | "google";
}

export type CardlessTrialResult =
  | { ok: false; verdict: Exclude<TrialAbuseVerdict, { ok: true }> }
  | {
      ok: true;
      orgId: string;
      userId: string;
      trialEndsAt: string;
      trialStartedAt: string;
      signupCreatedAt: string;
      fpLid: string | null;
      staleCustomerIds: string[];
    };

/**
 * Cree utilisateur + organisation en essai + appartenance, dans UNE
 * transaction, sous un verrou consultatif sur la cle du garde (domaine
 * d'entreprise, sinon adresse canonique) : deux inscriptions simultanees ne
 * peuvent pas ouvrir deux essais.
 *
 * Une ligne `pending_signups` est inscrite deja consommee : elle garde la
 * lignee Conversion B (`pending_signups.fp_lid → organizations.fp_lid`, la
 * premiere attribution gagne) et l'horodatage persiste du jalon `signup`.
 */
export async function activateCardlessTrial(client: PoolClient, input: CardlessTrialInput): Promise<CardlessTrialResult> {
  const email = input.email.trim().toLowerCase();
  const lockKey = `fp-cardless-trial:${trialGuardDomain(email) ?? canonicalTrialEmail(email).canonical}`;
  await client.query("BEGIN");
  try {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [lockKey]);

    const verdict = await checkTrialAbuse(client, email);
    if (!verdict.ok) {
      await client.query("ROLLBACK");
      return { ok: false, verdict };
    }

    // Tentatives abandonnees (parcours carte) : meme nettoyage que pre-register.
    const cleaned = await client.query<{ stripe_customer_id: string | null; fp_lid: string | null }>(
      `DELETE FROM pending_signups
        WHERE lower(email) = lower($1) AND consumed_at IS NULL
        RETURNING stripe_customer_id, fp_lid`,
      [email],
    );
    const earlierFpLid = (cleaned.rows ?? [])
      .map(r => normalizeFpLid(r.fp_lid))
      .find((v): v is string => v !== null) ?? null;
    const staleCustomerIds = (cleaned.rows ?? [])
      .map(r => r.stripe_customer_id)
      .filter((id): id is string => Boolean(id));

    const pending = await client.query<{ created_at: Date; fp_lid: string | null }>(
      `INSERT INTO pending_signups
         (token, email, first_name, last_name, company_name, seller_id, fp_lid, created_at, expires_at, consumed_at)
       VALUES ($1, $2, $3, '', $4, $5, $6, NOW(), NOW() + INTERVAL '2 hours', NOW())
       RETURNING created_at, fp_lid`,
      [input.preToken, email, input.firstName, input.companyName, input.sellerId,
       earlierFpLid ?? normalizeFpLid(input.rawFpLid)],
    );
    const fpLid = normalizeFpLid(pending.rows[0]?.fp_lid);

    const user = await client.query<{ id: string }>(
      `INSERT INTO users (id, email, first_name, last_name, auth_provider, email_verified, status)
       VALUES ($1, $2, $3, '', $4, TRUE, 'active')
       ON CONFLICT (email) DO UPDATE
         SET status = 'active', email_verified = TRUE,
             first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), users.first_name), updated_at = NOW()
         WHERE users.status = 'pending'
       RETURNING id`,
      [input.userId, email, input.firstName, input.authProvider ?? "magic_link"],
    );
    const userId = user.rows[0]?.id;
    // Pas de ligne rendue : un compte non `pending` existe deja (course avec une
    // autre inscription). On n'ecrase jamais un compte actif ou suspendu.
    if (!userId) throw Object.assign(new Error("account already exists"), { code: "ACCOUNT_EXISTS" });

    // trial_started_email_sent_at = NOW() : l'email d'activation « essai sans
    // carte » EST l'avis de debut d'essai. Sans cela, un paiement pendant l'essai
    // (webhook subscription.created trialing) rendrait l'org eligible a l'email
    // « essai demarre » et la passe de relance (retryLifecycleEmails) l'enverrait.
    const org = await client.query<{ trial_ends_at: Date; trial_started_at: Date }>(
      `INSERT INTO organizations
         (id, name, slug, owner_user_id, status, plan, subscription_status, owner_email, owner_first_name,
          stripe_customer_id, stripe_subscription_id, trial_started_at, trial_consumed_at, trial_ends_at,
          seller_id, fp_lid, trial_started_email_sent_at, trial_origin)
       VALUES ($1, $2, $3, $4, 'active', $5, 'trialing', $6, $7,
               NULL, NULL, NOW(), NOW(), NOW() + ($8::int * INTERVAL '1 day'),
               $9, $10, NOW(), 'cardless')
       RETURNING trial_ends_at, trial_started_at`,
      [input.orgId, input.companyName,
       input.orgId.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 60),
       userId, CARDLESS_TRIAL_PLAN, email, input.firstName, TRIAL_DAYS,
       input.sellerId, fpLid],
    );

    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'active', role = 'owner', updated_at = NOW()`,
      [input.orgId, userId],
    );

    await client.query("COMMIT");
    return {
      ok: true,
      orgId: input.orgId,
      userId,
      trialEndsAt: new Date(org.rows[0]!.trial_ends_at).toISOString(),
      trialStartedAt: new Date(org.rows[0]!.trial_started_at).toISOString(),
      signupCreatedAt: new Date(pending.rows[0]!.created_at).toISOString(),
      fpLid,
      staleCustomerIds,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}


// ── Exceptions par domaine (deblocage administrateur du seuil) ──────────────
//
// Une exception AJOUTE `extra_trials` essais au seuil d'un domaine
// d'entreprise, jusqu'a `expires_at`. Elle ne touche JAMAIS le garde par boite
// canonique : checkTrialAbuse le verifie AVANT le domaine et n'y consulte
// aucune exception. Chaque creation / revocation ecrit une ligne d'audit dans
// la meme transaction.

export const DOMAIN_EXCEPTION_DDL = [
  `CREATE TABLE IF NOT EXISTS trial_domain_exceptions (
     id            TEXT        PRIMARY KEY,
     domain        TEXT        NOT NULL,
     extra_trials  INTEGER     NOT NULL CHECK (extra_trials BETWEEN 1 AND 1000),
     expires_at    TIMESTAMPTZ NOT NULL,
     reason        TEXT        NOT NULL,
     created_by    TEXT        NOT NULL,
     created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     revoked_at    TIMESTAMPTZ,
     revoked_by    TEXT,
     revoke_reason TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS trial_domain_exceptions_domain_idx ON trial_domain_exceptions (lower(domain))`,
  `CREATE TABLE IF NOT EXISTS trial_domain_exception_audit (
     id           BIGSERIAL   PRIMARY KEY,
     exception_id TEXT        NOT NULL,
     action       TEXT        NOT NULL,
     actor        TEXT        NOT NULL,
     details      JSONB       NOT NULL DEFAULT '{}'::jsonb,
     at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
];

type DbLike = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }> };

export async function ensureDomainExceptionTables(db: DbLike): Promise<void> {
  for (const ddl of DOMAIN_EXCEPTION_DDL) await db.query(ddl);
}

/** Essais supplementaires actifs pour un domaine (0 si aucune exception ou table absente). */
export async function activeDomainExtraTrials(db: Queryable, domain: string): Promise<number> {
  try {
    const r = await (db as unknown as DbLike).query(
      `SELECT COALESCE(SUM(extra_trials), 0)::int AS n FROM trial_domain_exceptions
        WHERE lower(domain) = lower($1) AND revoked_at IS NULL AND expires_at > NOW()`,
      [domain],
    );
    return Number(r.rows?.[0]?.["n"] ?? 0);
  } catch {
    return 0; // table absente / base indisponible : seuil de base, jamais plus permissif
  }
}

export type DomainExceptionInput = { domain: string; extraTrials: number; expiresAt: string; reason: string; actor: string };

/** Validation stricte ; renvoie un message d'erreur ou null. */
export function validateDomainException(input: Partial<DomainExceptionInput>, now: Date = new Date()): string | null {
  const domain = String(input.domain ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) return "domain invalide";
  if (FREE_MAIL_DOMAINS.has(domain) || GMAIL_DOMAINS.has(domain)) return "messagerie grand public : aucune regle de domaine ne s'y applique";
  const extra = Number(input.extraTrials);
  if (!Number.isInteger(extra) || extra < 1 || extra > 1000) return "extraTrials doit etre un entier entre 1 et 1000";
  const exp = new Date(String(input.expiresAt ?? ""));
  if (!Number.isFinite(exp.getTime()) || exp <= now) return "expiresAt doit etre une date future";
  if (exp.getTime() - now.getTime() > 366 * 86400_000) return "expiresAt ne peut depasser 1 an";
  if (String(input.reason ?? "").trim().length < 5) return "reason requis (5 caracteres minimum)";
  if (String(input.actor ?? "").trim().length < 2) return "actor (auteur) requis";
  return null;
}

async function inTx<T>(client: PoolClient, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try { const out = await fn(); await client.query("COMMIT"); return out; }
  catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
}

export async function createDomainException(client: PoolClient, input: DomainExceptionInput, id: string): Promise<Record<string, unknown>> {
  await ensureDomainExceptionTables(client as unknown as DbLike);
  return inTx(client, async () => {
    const r = await client.query(
      `INSERT INTO trial_domain_exceptions (id, domain, extra_trials, expires_at, reason, created_by)
       VALUES ($1, lower($2), $3, $4::timestamptz, $5, $6) RETURNING *`,
      [id, input.domain.trim(), input.extraTrials, input.expiresAt, input.reason.trim(), input.actor.trim()],
    );
    await client.query(
      `INSERT INTO trial_domain_exception_audit (exception_id, action, actor, details) VALUES ($1, 'create', $2, $3::jsonb)`,
      [id, input.actor.trim(), JSON.stringify({ domain: input.domain.trim().toLowerCase(), extraTrials: input.extraTrials,
        expiresAt: input.expiresAt, reason: input.reason.trim() })],
    );
    return r.rows[0] as Record<string, unknown>;
  });
}

export async function revokeDomainException(client: PoolClient, id: string, actor: string, reason: string): Promise<boolean> {
  await ensureDomainExceptionTables(client as unknown as DbLike);
  return inTx(client, async () => {
    const r = await client.query(
      `UPDATE trial_domain_exceptions SET revoked_at = NOW(), revoked_by = $2, revoke_reason = $3
        WHERE id = $1 AND revoked_at IS NULL RETURNING id`, [id, actor.trim(), reason.trim()]);
    if (!r.rowCount) return false;
    await client.query(
      `INSERT INTO trial_domain_exception_audit (exception_id, action, actor, details) VALUES ($1, 'revoke', $2, $3::jsonb)`,
      [id, actor.trim(), JSON.stringify({ reason: reason.trim() })]);
    return true;
  });
}

export async function listDomainExceptions(db: DbLike, domain?: string): Promise<{ exceptions: unknown[]; audit: unknown[] }> {
  await ensureDomainExceptionTables(db);
  const ex = await db.query(
    `SELECT *, (revoked_at IS NULL AND expires_at > NOW()) AS active FROM trial_domain_exceptions
      WHERE ($1::text IS NULL OR lower(domain) = lower($1)) ORDER BY created_at DESC LIMIT 200`, [domain ?? null]);
  const au = await db.query(
    `SELECT a.* FROM trial_domain_exception_audit a JOIN trial_domain_exceptions e ON e.id = a.exception_id
      WHERE ($1::text IS NULL OR lower(e.domain) = lower($1)) ORDER BY a.at DESC LIMIT 500`, [domain ?? null]);
  return { exceptions: ex.rows, audit: au.rows };
}
