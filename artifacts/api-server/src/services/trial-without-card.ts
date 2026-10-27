/**
 * trial-without-card.ts — essai gratuit de 14 jours SANS carte bancaire.
 *
 * DERRIERE UN DRAPEAU. `TRIAL_WITHOUT_CARD=true` l'active ; toute autre valeur
 * (absente comprise) le laisse eteint, et le parcours existant (pre-register →
 * plan → carte → finalize-checkout) reste le seul chemin d'inscription.
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
  | { ok: false; code: "TRIAL_ALREADY_USED_EMAIL" | "TRIAL_ALREADY_USED_DOMAIN"; domain?: string };

type Queryable = Pick<PoolClient, "query">;

/**
 * Un essai par boite mail canonique, et un par domaine d'entreprise.
 *
 * Interroge `organizations` (source de verite) : toute organisation dont le
 * proprietaire a la meme adresse canonique bloque ; pour un domaine
 * d'entreprise, toute organisation existante de ce domaine bloque — l'equipe
 * rejoint l'espace existant par invitation au lieu d'enchainer les essais.
 */
export async function checkTrialAbuse(db: Queryable, email: string): Promise<TrialAbuseVerdict> {
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
    const sameCompany = await db.query(
      `SELECT 1 FROM organizations
        WHERE lower(split_part(owner_email, '@', 2)) = $1
        LIMIT 1`,
      [domain],
    );
    if ((sameCompany.rows?.length ?? 0) > 0) return { ok: false, code: "TRIAL_ALREADY_USED_DOMAIN", domain };
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
       VALUES ($1, $2, $3, '', 'magic_link', TRUE, 'active')
       ON CONFLICT (email) DO UPDATE
         SET status = 'active', email_verified = TRUE,
             first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), users.first_name), updated_at = NOW()
         WHERE users.status = 'pending'
       RETURNING id`,
      [input.userId, email, input.firstName],
    );
    const userId = user.rows[0]?.id;
    // Pas de ligne rendue : un compte non `pending` existe deja (course avec une
    // autre inscription). On n'ecrase jamais un compte actif ou suspendu.
    if (!userId) throw Object.assign(new Error("account already exists"), { code: "ACCOUNT_EXISTS" });

    const org = await client.query<{ trial_ends_at: Date; trial_started_at: Date }>(
      `INSERT INTO organizations
         (id, name, slug, owner_user_id, status, plan, subscription_status, owner_email, owner_first_name,
          stripe_customer_id, stripe_subscription_id, trial_started_at, trial_consumed_at, trial_ends_at,
          seller_id, fp_lid)
       VALUES ($1, $2, $3, $4, 'active', $5, 'trialing', $6, $7,
               NULL, NULL, NOW(), NOW(), NOW() + ($8::int * INTERVAL '1 day'),
               $9, $10)
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
