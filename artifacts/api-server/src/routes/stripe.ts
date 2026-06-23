/**
 * FlowPoint — Reusable Stripe client wrapper
 * Singleton, typed helpers, webhook validation.
 */

import Stripe from "stripe";
import { logger } from "../logger.js";
import { TIMEOUTS } from "../config.js";

let _stripe: Stripe | null = null;
let _stripeKey: string | undefined;

export function getStripeClient(): Stripe | null {
  const key = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  if (!key) return null;
  if (!_stripe || _stripeKey !== key) {
    _stripeKey = key;
    _stripe = new Stripe(key, {
      apiVersion: '2025-04-30.basil',
      timeout: TIMEOUTS.stripe,
      maxNetworkRetries: 2,
    });
  }
  return _stripe;
}

export function getStripeKey(): string | null {
  return process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"] || null;
}

export function requireStripe(): Stripe {
  const s = getStripeClient();
  if (!s) throw new Error('Stripe is not configured (missing STRIPE_SECRET_KEY)');
  return s;
}

export function validateWebhookSignature(payload: Buffer | string, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? process.env.STRIPE_WEBHOOK_SECRET_RENDER;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not configured');
  const stripe = requireStripe();
  return stripe.webhooks.constructEvent(payload, signature, secret);
}

export async function getCustomer(customerId: string): Promise<Stripe.Customer | null> {
  const stripe = getStripeClient();
  if (!stripe || !customerId) return null;
  try {
    const c = await stripe.customers.retrieve(customerId);
    return c.deleted ? null : c as Stripe.Customer;
  } catch (err) {
    logger.warn({ err, customerId }, '[Stripe] Failed to retrieve customer');
    return null;
  }
}

export async function getActiveSubscription(customerId: string): Promise<Stripe.Subscription | null> {
  const stripe = getStripeClient();
  if (!stripe || !customerId) return null;
  try {
    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 1 });
    return subs.data[0] ?? null;
  } catch (err) {
    logger.warn({ err, customerId }, '[Stripe] Failed to list subscriptions');
    return null;
  }
}

export async function createPortalSession(customerId: string, returnUrl: string): Promise<string> {
  const stripe = requireStripe();
  const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
  return session.url;
}

export async function createCheckoutSession(params: {
  customerId?: string; priceId: string; successUrl: string; cancelUrl: string;
  metadata?: Record<string, string>; mode?: 'subscription' | 'payment';
}): Promise<string> {
  const stripe = requireStripe();
  const session = await stripe.checkout.sessions.create({
    mode: params.mode ?? 'subscription',
    customer: params.customerId,
    line_items: [{ price: params.priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url:  params.cancelUrl,
    metadata:    params.metadata,
    allow_promotion_codes: true,
  });
  return session.url ?? '';
}
