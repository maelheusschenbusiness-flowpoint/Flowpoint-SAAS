const TEST_EMAIL_SUFFIXES = ["@dev.flowpoint.test", "@flowpoint-internal.test"];
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(["canceled", "incomplete_expired"]);
const RESOURCE_PREFIXES = {
  checkoutSession: "cs_test_",
  customer: "cus_",
  event: "evt_",
  invoice: "in_",
  paymentIntent: "pi_",
  paymentMethod: "pm_",
  setupIntent: "seti_",
  subscription: "sub_",
  testClock: "clock_",
};

function stripeObjectId(value) {
  return typeof value === "string" ? value : value?.id;
}

function isMissingResource(error) {
  return error?.code === "resource_missing" || error?.statusCode === 404;
}

function isUnexpectedState(error) {
  return error?.code === "payment_intent_unexpected_state" ||
    error?.code === "setup_intent_unexpected_state";
}

async function listAll(endpoint, params) {
  const data = [];
  let starting_after;
  do {
    const page = await endpoint.list({
      ...params,
      limit: 100,
      ...(starting_after ? { starting_after } : {}),
    });
    data.push(...page.data);
    if (!page.has_more || page.data.length === 0) break;
    starting_after = page.data.at(-1).id;
  } while (starting_after);
  return data;
}

export function createStripeTestResourceCleanup(stripe, stripeTestKey, label) {
  if (!stripeTestKey?.startsWith("sk_test_")) {
    throw new Error("Stripe TEST cleanup refuses any key that is not sk_test_.");
  }

  const emails = new Map();
  const customerIds = new Set();
  const subscriptionIds = new Set();
  const subscriptionCustomers = new Map();
  const checkoutSessionIds = new Set();
  const setupIntentIds = new Set();
  const paymentIntentIds = new Set();
  const paymentMethodIds = new Set();
  const testClockIds = new Set();
  const eventIds = new Set();
  const invoiceIds = new Set();
  let cleanupInProgress = false;

  function addId(kind, value) {
    const id = stripeObjectId(value);
    if (!id) return;
    const prefix = RESOURCE_PREFIXES[kind];
    if (!prefix || !id.startsWith(prefix)) {
      throw new Error(`Refusing to register an unexpected Stripe ${kind} ID.`);
    }
    const set = {
      checkoutSession: checkoutSessionIds,
      customer: customerIds,
      event: eventIds,
      invoice: invoiceIds,
      paymentIntent: paymentIntentIds,
      paymentMethod: paymentMethodIds,
      setupIntent: setupIntentIds,
      subscription: subscriptionIds,
      testClock: testClockIds,
    }[kind];
    if (!set.has(id)) {
      set.add(id);
      console.log(`[Stripe TEST cleanup:${label}] registered ${kind} ${id}`);
    }
    return id;
  }

  function assertTestMode(object, description) {
    if (object?.livemode === true) {
      throw new Error(`Refusing to mutate LIVE Stripe ${description}.`);
    }
  }

  async function registerEmail(email) {
    if (!TEST_EMAIL_SUFFIXES.some((suffix) => email.endsWith(suffix))) {
      throw new Error("Stripe TEST cleanup accepts only the certification's reserved email domains.");
    }
    if (emails.has(email)) return;
    const existing = await listAll(stripe.customers, { email });
    const existingIds = new Set(existing.filter((customer) => !customer.deleted).map(({ id }) => id));
    if (existingIds.size) {
      throw new Error("Refusing to run Stripe TEST cleanup for an email with a pre-existing Customer.");
    }
    emails.set(email, existingIds);
  }

  function registerCustomer(id, email) {
    if (email && !emails.has(email)) {
      throw new Error("Register a fresh certification email before tracking its Stripe Customer.");
    }
    return addId("customer", id);
  }

  function registerSubscription(id, customerId) {
    const subscriptionId = addId("subscription", id);
    const ownerId = stripeObjectId(customerId);
    if (subscriptionId && ownerId) {
      if (!customerIds.has(ownerId)) {
        throw new Error("Refusing to track a subscription whose Customer was not created by this certification.");
      }
      subscriptionCustomers.set(subscriptionId, ownerId);
    }
    return subscriptionId;
  }

  async function retrieveOrMissing(retrieve, id) {
    try {
      return await retrieve(id);
    } catch (error) {
      if (isMissingResource(error)) return null;
      throw error;
    }
  }

  async function cleanup() {
    if (cleanupInProgress) return;
    cleanupInProgress = true;
    const failures = [];
    const notes = [];
    const attempt = async (description, operation) => {
      try {
        await operation();
      } catch (error) {
        failures.push(`${description}: ${error?.message ?? String(error)}`);
      }
    };

    try {
      for (const [email, baselineIds] of emails) {
        await attempt(`discover test Customer for ${email.split("@")[0]}`, async () => {
          const customers = await listAll(stripe.customers, { email });
          for (const customer of customers.filter((row) => !row.deleted)) {
            if (baselineIds.has(customer.id)) continue;
            assertTestMode(customer, "Customer");
            addId("customer", customer.id);
          }
        });
      }

      for (const customerId of customerIds) {
        await attempt(`discover subscriptions for ${customerId}`, async () => {
          const subscriptions = await listAll(stripe.subscriptions, {
            customer: customerId,
            status: "all",
          });
          for (const subscription of subscriptions) {
            assertTestMode(subscription, "Subscription");
            registerSubscription(subscription.id, customerId);
          }
        });
      }

      for (const subscriptionId of subscriptionIds) {
        await attempt(`cancel Subscription ${subscriptionId}`, async () => {
          let subscription = await retrieveOrMissing(
            (id) => stripe.subscriptions.retrieve(id),
            subscriptionId,
          );
          if (!subscription) {
            notes.push(`Subscription ${subscriptionId} was already absent.`);
            return;
          }
          assertTestMode(subscription, "Subscription");
          if (!TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.status)) {
            subscription = await stripe.subscriptions.cancel(subscriptionId, {
              invoice_now: false,
              prorate: false,
            });
          }
          assertTestMode(subscription, "Subscription");
          if (!TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.status)) {
            throw new Error(`Subscription remains ${subscription.status}.`);
          }
        });
      }

      for (const sessionId of checkoutSessionIds) {
        await attempt(`expire Checkout Session ${sessionId}`, async () => {
          let session = await retrieveOrMissing(
            (id) => stripe.checkout.sessions.retrieve(id),
            sessionId,
          );
          if (!session) return;
          assertTestMode(session, "Checkout Session");
          if (session.status === "open") {
            session = await stripe.checkout.sessions.expire(sessionId);
          }
          if (session.status === "open") throw new Error("Checkout Session is still open.");
        });
      }

      for (const intentId of paymentIntentIds) {
        await attempt(`cancel PaymentIntent ${intentId}`, async () => {
          let intent = await retrieveOrMissing(
            (id) => stripe.paymentIntents.retrieve(id),
            intentId,
          );
          if (!intent) return;
          assertTestMode(intent, "PaymentIntent");
          if (intent.status === "succeeded") {
            notes.push(`Succeeded PaymentIntent ${intentId} is immutable and remains in Stripe TEST.`);
            return;
          }
          if (intent.status !== "canceled") {
            try {
              intent = await stripe.paymentIntents.cancel(intentId);
            } catch (error) {
              if (!isUnexpectedState(error)) throw error;
              intent = await stripe.paymentIntents.retrieve(intentId);
            }
          }
          if (!["canceled", "succeeded"].includes(intent.status)) {
            throw new Error(`PaymentIntent remains ${intent.status}.`);
          }
        });
      }

      for (const intentId of setupIntentIds) {
        await attempt(`cancel SetupIntent ${intentId}`, async () => {
          let intent = await retrieveOrMissing(
            (id) => stripe.setupIntents.retrieve(id),
            intentId,
          );
          if (!intent) return;
          assertTestMode(intent, "SetupIntent");
          if (intent.status === "succeeded") {
            notes.push(`Succeeded SetupIntent ${intentId} is immutable and remains in Stripe TEST.`);
            return;
          }
          if (intent.status !== "canceled") {
            try {
              intent = await stripe.setupIntents.cancel(intentId);
            } catch (error) {
              if (!isUnexpectedState(error)) throw error;
              intent = await stripe.setupIntents.retrieve(intentId);
            }
          }
          if (!["canceled", "succeeded"].includes(intent.status)) {
            notes.push(`SetupIntent ${intentId} remains ${intent.status}; Stripe did not permit cancellation.`);
          }
        });
      }

      for (const customerId of customerIds) {
        await attempt(`clean invoices for ${customerId}`, async () => {
          const invoices = await listAll(stripe.invoices, { customer: customerId });
          for (const invoice of invoices) {
            assertTestMode(invoice, "Invoice");
            addId("invoice", invoice.id);
            if (invoice.status === "draft") {
              await stripe.invoices.del(invoice.id);
              notes.push(`Draft Invoice ${invoice.id} deleted.`);
            } else if (invoice.status === "open") {
              await stripe.invoices.voidInvoice(invoice.id);
              notes.push(`Open Invoice ${invoice.id} voided.`);
            } else {
              notes.push(`Invoice ${invoice.id} (${invoice.status}) cannot be deleted by this cleanup.`);
            }
          }
        });
      }

      for (const paymentMethodId of paymentMethodIds) {
        await attempt(`detach PaymentMethod ${paymentMethodId}`, async () => {
          const paymentMethod = await retrieveOrMissing(
            (id) => stripe.paymentMethods.retrieve(id),
            paymentMethodId,
          );
          if (!paymentMethod) return;
          assertTestMode(paymentMethod, "PaymentMethod");
          const attachedCustomer = stripeObjectId(paymentMethod.customer);
          if (!attachedCustomer) {
            notes.push(`Unattached PaymentMethod ${paymentMethodId} has no Stripe delete operation.`);
            return;
          }
          if (!customerIds.has(attachedCustomer)) {
            throw new Error("PaymentMethod is attached to a Customer not created by this certification.");
          }
          const detached = await stripe.paymentMethods.detach(paymentMethodId);
          assertTestMode(detached, "PaymentMethod");
          if (stripeObjectId(detached.customer)) {
            throw new Error("PaymentMethod is still attached.");
          }
        });
      }

      for (const customerId of customerIds) {
        await attempt(`verify subscriptions for ${customerId}`, async () => {
          const subscriptions = await listAll(stripe.subscriptions, {
            customer: customerId,
            status: "all",
          });
          const active = subscriptions.filter(
            (subscription) => !TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.status),
          );
          if (active.length) {
            throw new Error(`Active test subscriptions remain: ${active.map(({ id }) => id).join(", ")}`);
          }
        });
      }

      for (const customerId of customerIds) {
        await attempt(`delete Customer ${customerId}`, async () => {
          const customer = await retrieveOrMissing(
            (id) => stripe.customers.retrieve(id),
            customerId,
          );
          if (!customer || customer.deleted) return;
          assertTestMode(customer, "Customer");
          const deleted = await stripe.customers.del(customerId);
          if (!deleted.deleted) throw new Error("Stripe did not confirm Customer deletion.");
        });
      }

      for (const clockId of testClockIds) {
        await attempt(`delete Test Clock ${clockId}`, async () => {
          const clock = await retrieveOrMissing(
            (id) => stripe.testHelpers.testClocks.retrieve(id),
            clockId,
          );
          if (!clock) return;
          if (clock.status === "advancing") {
            throw new Error("Test Clock is still advancing; refusing deletion.");
          }
          await stripe.testHelpers.testClocks.del(clockId);
        });
      }

      for (const eventId of eventIds) {
        notes.push(`Event ${eventId} is immutable in Stripe TEST and cannot be deleted.`);
      }

      for (const note of notes) console.log(`[Stripe TEST cleanup:${label}] ${note}`);
      if (failures.length) {
        throw new AggregateError(
          failures.map((failure) => new Error(failure)),
          `Stripe TEST cleanup failed for ${label}.`,
        );
      }

      console.log(
        `[Stripe TEST cleanup:${label}] verified no active temporary subscriptions; ` +
        `customers=${customerIds.size}, subscriptions=${subscriptionIds.size}, ` +
        `paymentIntents=${paymentIntentIds.size}, setupIntents=${setupIntentIds.size}, ` +
        `checkoutSessions=${checkoutSessionIds.size}, invoices=${invoiceIds.size}, ` +
        `events=${eventIds.size}.`,
      );
      emails.clear();
      customerIds.clear();
      subscriptionIds.clear();
      subscriptionCustomers.clear();
      checkoutSessionIds.clear();
      setupIntentIds.clear();
      paymentIntentIds.clear();
      paymentMethodIds.clear();
      testClockIds.clear();
      eventIds.clear();
      invoiceIds.clear();
    } finally {
      cleanupInProgress = false;
    }
  }

  return {
    registerEmail,
    registerCustomer,
    registerSubscription,
    registerCheckoutSession: (id) => addId("checkoutSession", id),
    registerEvent: (id) => addId("event", id),
    registerInvoice: (id) => addId("invoice", id),
    registerPaymentIntent: (id) => addId("paymentIntent", id),
    registerPaymentMethod: (id) => addId("paymentMethod", id),
    registerSetupIntent: (id) => addId("setupIntent", id),
    registerTestClock: (id) => addId("testClock", id),
    cleanup,
  };
}
