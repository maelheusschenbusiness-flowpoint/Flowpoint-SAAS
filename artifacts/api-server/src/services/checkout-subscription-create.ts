/**
 * #410 a introduit ce module avec sa propre copie de `createSubscriptionForAttempt`.
 * #390 porte deja la meme fonction (meme verrou PostgreSQL, meme cle d'idempotence
 * Stripe, plus la liberation du bail en cas d'echec de creation) dans
 * services/signup-subscription.ts. Une SEULE implementation doit exister, sinon
 * finalize-checkout et le webhook pourraient diverger : ce module la reexporte.
 */
export { createSubscriptionForAttempt } from "./signup-subscription.js";
