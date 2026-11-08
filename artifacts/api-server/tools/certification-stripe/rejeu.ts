/**
 * Rejeu d'un evenement Stripe TEST vers l'application LOCALE (Mode L), signe avec le secret du listener.
 * Prouve l'idempotence : N livraisons du meme evenement => UNE souscription.
 * Refuse toute URL non locale (Mode R : rejouer depuis le tableau de bord Stripe) et toute cle non test.
 */
import { assertCleSecreteTest, assertSecretWebhookTest, CleRefusee } from "./garde-cles.ts";

export interface ResultatRejeu { statuts: number[]; evenement: string; type: string }

export function verifierUrlLocale(url: string): URL {
  const u = new URL(url);
  if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname)) throw new CleRefusee(`Rejeu signe refuse vers ${u.hostname} : uniquement local (Mode R : utiliser le tableau de bord Stripe).`);
  if (!/^\/api\/(billing\/webhook|webhooks\/stripe)$/.test(u.pathname)) throw new CleRefusee("Le chemin doit etre /api/billing/webhook ou /api/webhooks/stripe.");
  return u;
}

export async function rejouerEvenement(o: { evenementId: string; url: string; fois: number; env?: Record<string, string | undefined> }): Promise<ResultatRejeu> {
  const env = o.env ?? process.env;
  const u = verifierUrlLocale(o.url);
  const cle = assertCleSecreteTest(env["STRIPE_TEST_SECRET_KEY"]);
  const secret = assertSecretWebhookTest(env["STRIPE_TEST_WEBHOOK_SECRET"], env);
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(cle);
  const evt = await stripe.events.retrieve(o.evenementId);
  if (evt.livemode !== false) throw new CleRefusee("Evenement livemode != false : refuse.");
  const payload = JSON.stringify(evt);
  const statuts: number[] = [];
  for (let i = 0; i < o.fois; i += 1) {
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": header }, body: payload });
    statuts.push(r.status);
  }
  return { statuts, evenement: evt.id, type: evt.type };
}
