#!/usr/bin/env node

// Read-only inventory for the Render Test Stripe account.
// Uses Node's native fetch and only sends GET requests to Stripe.
const EXPECTED_ACCOUNT_ID = "acct_1StVIr9eqtbj6iPB";

const specs = [
  {
    addon: "gbpPerformanceLeads",
    name: "GBP Performance & Leads",
    aliases: ["GBP performance leads", "Google Business Profile performance"],
    amountEur: 15,
    reuseOnly: true
  },
  {
    addon: "localPresenceOptimizer",
    name: "Local Presence Optimizer",
    aliases: ["local presence", "presence optimizer", "GBP presence optimizer"],
    amountEur: 9
  },
  {
    addon: "localLandingOpportunities",
    name: "Local Landing Opportunities",
    aliases: ["local landing", "landing opportunities", "location landing"],
    amountEur: 15
  },
  {
    addon: "conversionOpportunityEngine",
    name: "Conversion Opportunity Engine",
    aliases: ["conversion opportunity", "conversion engine", "GA4 conversion opportunity"],
    amountEur: 12
  },
  {
    addon: "seoChangeImpact",
    name: "SEO Change Impact",
    aliases: ["SEO change", "change impact", "SEO impact"],
    amountEur: 15
  },
  {
    addon: "agencyPortfolioPriorities",
    name: "Agency Portfolio Priorities",
    aliases: ["agency portfolio", "portfolio priorities", "client portfolio priorities"],
    amountEur: 19
  },
  {
    addon: "technicalSeoFixVerification",
    name: "Technical SEO Fix Verification",
    aliases: ["technical SEO fix", "SEO fix verification", "technical SEO verification"],
    amountEur: 19
  },
  {
    addon: "organicCampaignTracker",
    name: "Organic Campaign Tracker",
    aliases: ["organic campaign", "GSC campaign tracker", "organic growth tracker"],
    amountEur: 12
  }
];

const env = process.env;
const key = env.STRIPE_TEST_KEY || env.STRIPE_TEST_SECRET_KEY || "";

function emit(report) {
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function safeError(result) {
  return {
    httpStatus: result.httpStatus ?? null,
    errorType: result.body?.error?.type ?? null,
    errorCode: result.body?.error?.code ?? null,
    networkError: result.networkError ?? null
  };
}

async function stripeGet(path) {
  try {
    const response = await fetch(`https://api.stripe.com${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(15000)
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, httpStatus: response.status, body };
  } catch (error) {
    return {
      ok: false,
      httpStatus: null,
      body: {},
      networkError: error?.name || "FetchError"
    };
  }
}

async function listAll(path, filters, stage) {
  const items = [];
  let cursor = null;

  while (true) {
    const query = new URLSearchParams({ ...filters, limit: "100" });
    if (cursor) query.set("starting_after", cursor);

    const response = await stripeGet(`${path}?${query}`);
    if (!response.ok) {
      const error = new Error();
      error.safe = { stage, ...safeError(response) };
      throw error;
    }

    const page = Array.isArray(response.body?.data) ? response.body.data : [];
    items.push(...page);
    if (!response.body?.has_more) return items;

    cursor = page.at(-1)?.id;
    if (!cursor) {
      const error = new Error();
      error.safe = { stage, reason: "pagination_incomplete" };
      throw error;
    }
  }
}

function classifyProduct(product, spec) {
  const normalizedName = normalize(product?.name);
  const normalizedAddon = normalize(spec.addon);
  const normalizedTitle = normalize(spec.name);
  const aliases = spec.aliases.map(normalize).filter(Boolean);
  const metadata = product?.metadata || {};
  const metadataEntries = Object.entries(metadata).map(([key, value]) => [
    normalize(key),
    normalize(value)
  ]);

  const exactName = normalizedName === normalizedTitle;
  const exactMetadata = metadataEntries.some(([key, value]) =>
    value === normalizedAddon ||
    value === normalizedTitle ||
    key === normalizedAddon ||
    (["addonkey", "flowpointaddonkey"].includes(key) && value === normalizedAddon)
  );
  const aliasName = aliases.some(alias => normalizedName.includes(alias));
  const aliasMetadata = metadataEntries.some(([, value]) =>
    aliases.some(alias => value.includes(alias))
  );

  const signals = [];
  if (exactName) signals.push("exact_name");
  if (exactMetadata) signals.push("addon_metadata");
  if (aliasName) signals.push("name_alias");
  if (aliasMetadata) signals.push("metadata_alias");

  return {
    matchType: exactName || exactMetadata ? "strong" : signals.length ? "possible" : "none",
    signals
  };
}

function priceAmountCents(price) {
  if (typeof price?.unit_amount === "number") return price.unit_amount;
  if (price?.unit_amount_decimal != null) {
    const value = Number(price.unit_amount_decimal);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

async function main() {
  if (env.NODE_ENV === "production") {
    return emit({ mode: "DRY_RUN", status: "refused", reason: "NODE_ENV_is_production" });
  }
  if (env.STRIPE_TEST_MODE !== "true") {
    return emit({ mode: "DRY_RUN", status: "refused", reason: "STRIPE_TEST_MODE_is_not_true" });
  }
  if (!key.startsWith("sk_test_")) {
    return emit({
      mode: "DRY_RUN",
      status: "refused",
      reason: "test_key_missing_or_not_sk_test",
      keySource: env.STRIPE_TEST_KEY
        ? "STRIPE_TEST_KEY"
        : env.STRIPE_TEST_SECRET_KEY
          ? "STRIPE_TEST_SECRET_KEY"
          : null
    });
  }

  const account = await stripeGet("/v1/account");
  if (!account.ok) {
    return emit({
      mode: "DRY_RUN",
      status: "failed",
      reason: "could_not_verify_test_account",
      stripe: safeError(account)
    });
  }

  const accountId = account.body?.id ?? null;
  if (accountId !== EXPECTED_ACCOUNT_ID) {
    return emit({
      mode: "DRY_RUN",
      status: "refused",
      reason: "account_id_does_not_match_render_test",
      expectedAccountId: EXPECTED_ACCOUNT_ID,
      actualAccountId: accountId
    });
  }

  const products = [
    ...await listAll("/v1/products", { active: "true" }, "list_active_products"),
    ...await listAll("/v1/products", { active: "false" }, "list_inactive_products")
  ];
  const uniqueProducts = [...new Map(products.map(product => [product.id, product])).values()];
  const addons = [];

  for (const spec of specs) {
    const candidates = uniqueProducts
      .map(product => ({ product, ...classifyProduct(product, spec) }))
      .filter(item => item.matchType !== "none");
    const strong = candidates.filter(item => item.matchType === "strong");
    const possible = candidates.filter(item => item.matchType === "possible");
    const safeCandidates = candidates.map(item => ({
      name: item.product.name || null,
      active: item.product.active === true,
      matchType: item.matchType,
      matchSignals: item.signals,
      metadataKeys: Object.keys(item.product.metadata || {})
    }));

    if (possible.length || strong.length > 1 || (strong.length && possible.length)) {
      addons.push({
        addon: spec.addon,
        targetAmountEurMonthly: spec.amountEur,
        productExists: true,
        productCandidates: safeCandidates,
        activeMonthlyEurPrices: [],
        inactiveMonthlyEurPrices: [],
        decision: "BLOCKED_REVIEW",
        blockers: ["possible_or_ambiguous_equivalent_product"]
      });
      continue;
    }

    if (!strong.length) {
      addons.push({
        addon: spec.addon,
        targetAmountEurMonthly: spec.amountEur,
        productExists: false,
        productCandidates: [],
        activeMonthlyEurPrices: [],
        inactiveMonthlyEurPrices: [],
        decision: spec.reuseOnly ? "BLOCKED_REQUIRED_EXISTING_PRICE_NOT_FOUND" : "CREATE_PRODUCT_AND_PRICE",
        blockers: spec.reuseOnly ? ["GBP_must_be_reused_not_created"] : []
      });
      continue;
    }

    const product = strong[0].product;
    const [activePrices, inactivePrices] = await Promise.all([
      listAll("/v1/prices", { product: product.id, active: "true" }, `active_prices_${spec.addon}`),
      listAll("/v1/prices", { product: product.id, active: "false" }, `inactive_prices_${spec.addon}`)
    ]);

    const monthlyEur = [...activePrices, ...inactivePrices].filter(price =>
      price.currency?.toLowerCase() === "eur" &&
      price.recurring?.interval === "month" &&
      (price.recurring?.interval_count ?? 1) === 1
    );
    const equivalent = monthlyEur.filter(price =>
      priceAmountCents(price) === spec.amountEur * 100
    );
    const activeEquivalent = equivalent.filter(price =>
      price.active === true && price.livemode === false
    );
    const inactiveEquivalent = equivalent.filter(price => price.active !== true);
    const blockers = [];
    let decision;

    if (product.active !== true) {
      blockers.push("matching_product_is_inactive");
      decision = "BLOCKED";
    } else if (equivalent.length > 1) {
      blockers.push("multiple_equivalent_prices_exist");
      decision = "BLOCKED";
    } else if (inactiveEquivalent.length === 1) {
      blockers.push("equivalent_price_exists_but_is_inactive");
      decision = "BLOCKED";
    } else if (equivalent.length === 1 && activeEquivalent.length === 1) {
      decision = "REUSE";
    } else if (spec.reuseOnly) {
      blockers.push("GBP_must_be_reused_not_created");
      decision = "BLOCKED";
    } else {
      decision = "CREATE_PRICE_ONLY";
    }

    addons.push({
      addon: spec.addon,
      targetAmountEurMonthly: spec.amountEur,
      productExists: true,
      productActive: product.active === true,
      productCandidates: safeCandidates,
      activeMonthlyEurPrices: monthlyEur
        .filter(price => price.active === true)
        .map(price => ({
          amountCents: priceAmountCents(price),
          livemode: typeof price.livemode === "boolean" ? price.livemode : null
        })),
      inactiveMonthlyEurPrices: monthlyEur
        .filter(price => price.active !== true)
        .map(price => ({
          amountCents: priceAmountCents(price),
          livemode: typeof price.livemode === "boolean" ? price.livemode : null
        })),
      equivalentTargetPriceCount: equivalent.length,
      decision,
      blockers
    });
  }

  emit({
    mode: "DRY_RUN",
    status: addons.some(item => item.decision.startsWith("BLOCKED"))
      ? "review_required"
      : "preflight_complete",
    readOnly: true,
    stripeHttpMethodsUsed: ["GET"],
    accountId,
    productsScanned: uniqueProducts.length,
    addons,
    note: "No Price IDs, secrets, customer data, or raw Stripe metadata values are output."
  });
}

try {
  await main();
} catch (error) {
  emit({
    mode: "DRY_RUN",
    status: "failed",
    details: error?.safe || { reason: "unexpected_error" },
    readOnly: true
  });
}
