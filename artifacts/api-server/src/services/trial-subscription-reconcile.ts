/**
 * A-09 — detection et rattrapage des essais SANS souscription Stripe.
 *
 * - `findTrialingOrgsWithoutSubscription` : LECTURE SEULE (meme requete que
 *   migrations/diagnostics/a09_trialing_sans_souscription.sql).
 * - `reconcileOrphanTrials` : rattrapage borne et idempotent, `dryRun` PAR DEFAUT.
 *   Il n'est branche sur aucun cron ni webhook : creer un abonnement pour un
 *   client existant, c'est decider d'un prelevement futur sur sa carte — decision
 *   humaine. Il ne cree rien hors fenetre d'essai (trial_ends_at a plus d'un jour)
 *   et reutilise la creation du webhook (meme cle d'idempotence : jamais de doublon).
 */
import { logger } from "../lib/logger.js";
import { provisionSubscriptionFromIntent, type StripeClient } from "./signup-subscription.js";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }> };

export const ORPHAN_TRIAL_SQL = `
  SELECT o.id::text AS id, o.owner_email, o.plan, o.stripe_customer_id, o.trial_ends_at
    FROM organizations o
   WHERE o.subscription_status = 'trialing'
     AND (o.stripe_subscription_id IS NULL OR btrim(o.stripe_subscription_id) = '')
     AND o.status IS DISTINCT FROM 'deleted'
   ORDER BY o.trial_ends_at ASC NULLS FIRST
   LIMIT $1`;

export type OrphanTrial = {
  id: string; owner_email: string | null; plan: string | null;
  stripe_customer_id: string | null; trial_ends_at: Date | null;
};

export async function findTrialingOrgsWithoutSubscription(db: Db, limit = 100): Promise<OrphanTrial[]> {
  const r = await db.query(ORPHAN_TRIAL_SQL, [Math.max(1, Math.min(500, limit))]);
  return r.rows as unknown as OrphanTrial[];
}

export type ReconcileAction =
  | { orgId: string; action: "adopt_existing"; subscriptionId: string; applied: boolean }
  | { orgId: string; action: "create_from_setup_intent"; intentId: string; subscriptionId: string | null; applied: boolean }
  | { orgId: string; action: "manual_review"; reason: "no_customer" | "no_intent" | "trial_window_closed" | "unresolved" };

const LIVE = new Set(["trialing", "active", "past_due"]);

export async function reconcileOrphanTrials(args: {
  stripe: StripeClient;
  db: Db;
  dryRun?: boolean;
  limit?: number;
  now?: Date;
}): Promise<ReconcileAction[]> {
  const dryRun = args.dryRun !== false;
  const now = args.now ?? new Date();
  const out: ReconcileAction[] = [];
  const orphans = await findTrialingOrgsWithoutSubscription(args.db, Math.min(args.limit ?? 25, 100));

  const adopt = async (orgId: string, sub: { id: string; status: string; trial_end?: number | null }): Promise<void> => {
    await args.db.query(
      `UPDATE organizations
          SET stripe_subscription_id = $2,
              subscription_status = $3,
              trial_ends_at = COALESCE($4::timestamptz, trial_ends_at),
              trial_consumed_at = COALESCE(trial_consumed_at, NOW()),
              updated_at = NOW()
        WHERE id = $1::uuid AND (stripe_subscription_id IS NULL OR btrim(stripe_subscription_id) = '')`,
      [orgId, sub.id, sub.status === "active" ? "active" : "trialing",
        sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null],
    );
  };

  for (const org of orphans) {
    if (!org.stripe_customer_id) { out.push({ orgId: org.id, action: "manual_review", reason: "no_customer" }); continue; }
    const subs = await args.stripe.subscriptions.list({ customer: org.stripe_customer_id, status: "all", limit: 10 });
    const live = (subs.data as Array<{ id: string; status: string; trial_end?: number | null; cancel_at_period_end?: boolean }>)
      .find((s) => LIVE.has(s.status) && !s.cancel_at_period_end);
    if (live) {
      if (!dryRun) await adopt(org.id, live);
      out.push({ orgId: org.id, action: "adopt_existing", subscriptionId: live.id, applied: !dryRun });
      continue;
    }
    const windowOpen = org.trial_ends_at ? org.trial_ends_at.getTime() > now.getTime() + 86_400_000 : false;
    if (!windowOpen) { out.push({ orgId: org.id, action: "manual_review", reason: "trial_window_closed" }); continue; }
    const intents = await args.stripe.setupIntents.list({ customer: org.stripe_customer_id, limit: 10 });
    const si = (intents.data as Array<{ id: string; status: string; metadata?: Record<string, string> }>)
      .find((i) => i.status === "succeeded" && i.metadata?.["plan"]);
    if (!si) { out.push({ orgId: org.id, action: "manual_review", reason: "no_intent" }); continue; }
    if (dryRun) { out.push({ orgId: org.id, action: "create_from_setup_intent", intentId: si.id, subscriptionId: null, applied: false }); continue; }
    const res = await provisionSubscriptionFromIntent({
      stripe: args.stripe,
      intent: si as never,
      preRegisterToken: si.metadata?.["pre_register_token"] ?? "",
      orgRefOverride: org.owner_email,
      caller: "reconcile",
    });
    if (res.kind !== "ready") {
      logger.error({ orgId: org.id, reason: res.reason }, "[A-09/reconcile] rattrapage impossible");
      out.push({ orgId: org.id, action: "manual_review", reason: "unresolved" });
      continue;
    }
    await adopt(org.id, { id: res.subscription.subscriptionId, status: res.subscription.status, trial_end: res.subscription.trialEndUnix });
    out.push({ orgId: org.id, action: "create_from_setup_intent", intentId: si.id, subscriptionId: res.subscription.subscriptionId, applied: true });
  }
  return out;
}
