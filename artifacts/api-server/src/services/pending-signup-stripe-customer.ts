import { createHash } from "node:crypto";
import type Stripe from "stripe";

type PendingSignup = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  country: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  stripe_customer_id: string | null;
};

function stableKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Resolve a signup's Stripe Customer only after Stripe has confirmed a
 * PaymentIntent or SetupIntent. The pending row lock and Stripe idempotency key
 * make webhook/finalize races converge on one Customer.
 */
export async function ensurePendingSignupStripeCustomer(
  stripe: Stripe,
  preRegisterToken: string,
  paymentMethodId: string | null,
  customerIdHint: string | null = null,
  sellerCode: string | null = null,
): Promise<{ customerId: string; hasSubscriptionHistory: boolean }> {
  if (!preRegisterToken) throw new Error("pending_signup_token_required");

  const { pool } = await import("@workspace/db");
  const client = await pool.connect();
  let txActive = false;

  try {
    await client.query("BEGIN");
    txActive = true;
    const result = await client.query<PendingSignup>(
      `SELECT email, first_name, last_name, company_name, country, address,
              city, postal_code, stripe_customer_id
         FROM pending_signups
        WHERE token = $1
        LIMIT 1
        FOR UPDATE`,
      [preRegisterToken],
    );
    const signup = result.rows[0];
    if (!signup) throw new Error("pending_signup_not_found");

    const originalCustomerId = signup.stripe_customer_id?.trim() || null;
    let customerId = originalCustomerId;
    if (customerId && customerIdHint && customerId !== customerIdHint) {
      throw new Error("pending_signup_customer_mismatch");
    }
    if (customerId) {
      const anchored = await stripe.customers.retrieve(customerId);
      if ((anchored as Stripe.DeletedCustomer).deleted) customerId = null;
    }

    if (!customerId && customerIdHint) {
      const hinted = await stripe.customers.retrieve(customerIdHint);
      const hintedCustomer = hinted as unknown as Stripe.Customer | Stripe.DeletedCustomer;
      if (!hintedCustomer.deleted) {
        const metadata = hintedCustomer.metadata;
        const emailMatches = (hintedCustomer as Stripe.Customer).email?.toLowerCase() === signup.email.toLowerCase();
        const belongsToSignup =
          metadata["pre_register_token"] === preRegisterToken ||
          (emailMatches &&
            (metadata["orgId"] === signup.email || metadata["org_id"] === signup.email));
        if (!belongsToSignup) throw new Error("pending_signup_customer_hint_unverified");
        customerId = customerIdHint;
      }
    }

    if (!customerId) {
      // Reuse an existing Customer with the exact signup email where possible.
      // This search is deliberately after confirmed payment/setup, never during
      // pre-registration or intent creation.
      const matches = await stripe.customers.list({ email: signup.email, limit: 10 });
      const liveMatches = matches.data;
      const tokenMatch = liveMatches.find(
        (candidate) => candidate.metadata["pre_register_token"] === preRegisterToken,
      );
      const customer = tokenMatch ?? liveMatches[0];

      if (customer) {
        customerId = customer.id;
      } else {
        const generation = originalCustomerId
          ? `_recovery_${stableKey(originalCustomerId).slice(0, 12)}`
          : "";
        const created = await stripe.customers.create(
          {
            email: signup.email,
            metadata: {
              source: "checkout_payment",
              orgId: signup.email,
              org_id: signup.email,
              pre_register_token: preRegisterToken,
              environment: process.env["NODE_ENV"] === "production" ? "production" : "development",
            },
          },
          {
            idempotencyKey: `fp_signup_customer_${stableKey(preRegisterToken).slice(0, 40)}${generation}`,
          },
        );
        customerId = created.id;
      }
    }

    const displayName =
      `${signup.first_name ?? ""} ${signup.last_name ?? ""}`.trim() ||
      signup.company_name ||
      signup.email;
    const customerUpdate: Parameters<typeof stripe.customers.update>[1] = {
      name: displayName,
      preferred_locales: ["fr"],
      ...(signup.company_name ? { description: signup.company_name } : {}),
      ...(signup.address || signup.city || signup.country
        ? {
            address: {
              line1: signup.address ?? "",
              city: signup.city ?? "",
              postal_code: signup.postal_code ?? "",
              country: signup.country ?? "",
            },
          }
        : {}),
    };
    if (paymentMethodId) {
      const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
      const attachedCustomer =
        typeof paymentMethod.customer === "string"
          ? paymentMethod.customer
          : paymentMethod.customer?.id ?? null;
      if (attachedCustomer && attachedCustomer !== customerId) {
        throw new Error("payment_method_customer_mismatch");
      }
      if (!attachedCustomer) {
        await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
      }
      customerUpdate.invoice_settings = { default_payment_method: paymentMethodId };
    }
    if (sellerCode) {
      customerUpdate.metadata = { seller_id: sellerCode, seller_attribution: "ref_link" };
    }
    if (Object.keys(customerUpdate).length > 0) {
      await stripe.customers.update(customerId, customerUpdate);
    }

    await client.query(
      `UPDATE pending_signups
          SET stripe_customer_id = $1
        WHERE token = $2`,
      [customerId, preRegisterToken],
    );
    await client.query("COMMIT");
    txActive = false;

    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 1,
    });
    return {
      customerId,
      hasSubscriptionHistory: subscriptions.data.length > 0,
    };
  } catch (error) {
    if (txActive) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
