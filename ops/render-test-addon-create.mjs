#!/usr/bin/env node

// Creates only the approved replacement products/prices in Render Test Stripe.
// It never writes to customers, subscriptions, checkout sessions, or entitlements.
const EXPECTED_ACCOUNT_ID = "acct_1StVIr9eqtbj6iPB";
const env = process.env;
const key = env.STRIPE_TEST_KEY || env.STRIPE_TEST_SECRET_KEY || "";
const usedMethods = new Set();

const specs = [
  {
    addon: "gbpPerformanceLeads",
    name: "GBP Performance & Leads",
    aliases: ["GBP performance leads", "Google Business Profile performance"],
    amountEur: 15,
    envVar: "STRIPE_TEST_PRICE_ID_ADDON_GBP_PERFORMANCE",
    reuseOnly: true
  },
  {
    addon: "localPresenceOptimizer",
    name: "Local Presence Optimizer",
    aliases: ["local presence", "presence optimizer", "GBP presence optimizer"],
    description: "Prioritise missing information on Google Business Profile listings.",
    amountEur: 9,
    envVar: "STRIPE_TEST_PRICE_ID_ADDON_LOCAL_PRESENCE"
  },
  {
    addon: "localLandingOpportunities",
    name: "Local Landing Opportunities",
    aliases: ["local landing", "landing opportunities", "location landing"],
    description: "Find real local searches that justify a service or location page.",
    amountEur: 15,
    envVar: "STRIPE_TEST_PRICE_ID_ADDON_LOCAL_LANDING"
  },
  {
    addon: "conversionOpportunityEngine",
    name: "Conversion Opportunity Engine",
    aliases: ["conversion opportunity", "conversion engine", "GA4 conversion opportunity"],
    description: "Identify pages to improve from measured GA4 sessions and conversions.",
    amountEur: 12,
    envVar: "STRIPE_TEST_PRICE_ID_ADDON_CONVERSION_OPPORTUNITY"
  },
  {
    addon: "seoChangeImpact",
    name: "SEO Change Impact",
    aliases: ["SEO change", "change impact", "SEO impact"],
    description: "Compare measured changes between completed SEO audits.",
    amountEur: 15,
    envVar: "STRIPE_TEST_PRICE_ID_ADDON_SEO_CHANGE_IMPACT"
  },
  {
    addon: "agencyPortfolioPriorities",
    name: "Agency Portfolio Priorities",
    aliases: ["agency portfolio", "portfolio priorities", "client portfolio priorities"],
    description: "Prioritise client sites using measured SEO audits and organic clicks.",
    amountEur: 19,
    envVar: "STRIPE_TEST_PRICE_ID_ADDON_AGENCY_PORTFOLIO_PRIORITIES"
  },
  {
    addon: "technicalSeoFixVerification",
    name: "Technical SEO Fix Verification",
    aliases: ["technical SEO fix", "SEO fix verification", "technical SEO verification"],
    description: "Compare reported issues between two audits of the same URL.",
    amountEur: 19,
    envVar: "STRIPE_TEST_PRICE_ID_ADDON_TECHNICAL_SEO_FIX_VERIFICATION"
  },
  {
    addon: "organicCampaignTracker",
    name: "Organic Campaign Tracker",
    aliases: ["organic campaign", "GSC campaign tracker", "organic growth tracker"],
    description: "Track click and position goals from measured Search Console data.",
    amountEur: 12,
    envVar: "STRIPE_TEST_PRICE_ID_ADDON_ORGANIC_CAMPAIGN_TRACKER"
  }
];

function emit(report) {
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function safeError(error) {
  return error?.safe || { reason: "unexpected_error" };
}

async function stripeRequest(method, path, params = {}, idempotencyKey = null) {
  if (method !== "GET" && method !== "POST") {
    throw Object.assign(new Error(), { safe: { reason: "unsupported_http_method" } });
  }

  usedMethods.add(method);
  let url = `https://api.stripe.com${path}`;
  const headers = {
    Authorization: `Bearer ${key}`,
    Accept: "application/json"
  };
  const options = { method, headers, signal: AbortSignal.timeout(20000) };

  if (method === "GET") {
    const query = new URLSearchParams(params);
    if (query.size) url += `?${query}`;
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    options.body = new URLSearchParams(params);
  }

  let response;
  let body = {};
  try {
    response = await fetch(url, options);
    body = await response.json().catch(() => ({}));
  } catch (error) {
    throw Object.assign(new Error(), {
      safe: { stage: path, networkError: error?.name || "FetchError" }
    });
  }

  if (!response.ok) {
    throw Object.assign(new Error(), {
      safe: {
        stage: path,
        httpStatus: response.status,
        errorType: body?.error?.type ?? null,
        errorCode: body?.error?.code ?? null
      }
    });
  }
  return body;
}

async function listAll(path, filters, stage) {
  const items = [];
  let cursor = null;

  while (true) {
    const query = { ...filters, limit: "100" };
    if (cursor) query.starting_after = cursor;
    let page;
    try {
      page = await stripeRequest("GET", path, query);
    } catch (error) {
      error.safe = { stage, ...safeError(error) };
      throw error;
    }

    const rows = Array.isArray(page.data) ? page.data : [];
    items.push(...rows);
    if (!page.has_more) return items;
    cursor = rows.at(-1)?.id;
    if (!cursor) {
      throw Object.assign(new Error(), {
        safe: { stage, reason: "pagination_incomplete" }
      });
    }
  }
}

function classifyProduct(product, spec) {
  const name = normalize(product?.name);
  const title = normalize(spec.name);
  const addon = normalize(spec.addon);
  const aliases = spec.aliases.map(normalize).filter(Boolean);
  const metadata = product?.metadata || {};
  const canonicalMetadata = normalize(
    metadata.flowpoint_addon_key || metadata.addon_key || metadata.addonKey || ""
  );
  const metadataValues = Object.values(metadata).map(normalize);
  const exactName = name === title;
  const exactMetadata = canonicalMetadata === addon ||
    metadataValues.includes(addon) ||
    metadataValues.includes(title);
  const aliasMatch = aliases.some(alias =>
    name.includes(alias) || metadataValues.some(value => value.includes(alias))
  );
  const metadataConflict = Boolean(canonicalMetadata && canonicalMetadata !== addon);

  if (metadataConflict && (exactName || aliasMatch)) {
    return { type: "possible", reason: "name_conflicts_with_addon_metadata" };
  }
  if (exactName || exactMetadata) return { type: "strong", reason: "exact_name_or_addon_metadata" };
  if (aliasMatch) return { type: "possible", reason: "name_or_metadata_alias" };
  return { type: "none", reason: null };
}

function amountCents(price) {
  if (typeof price?.unit_amount === "number") return price.unit_amount;
  if (price?.unit_amount_decimal != null) {
    const parsed = Number(price.unit_amount_decimal);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function inspectPrices(product, spec) {
  const [active, inactive] = await Promise.all([
    listAll("/v1/prices", { product: product.id, active: "true" }, `active_prices_${spec.addon}`),
    listAll("/v1/prices", { product: product.id, active: "false" }, `inactive_prices_${spec.addon}`)
  ]);
  const monthlyEur = [...active, ...inactive].filter(price =>
    price.currency?.toLowerCase() === "eur" &&
    price.recurring?.interval === "month" &&
    (price.recurring?.interval_count ?? 1) === 1
  );
  const equivalents = monthlyEur.filter(price =>
    amountCents(price) === spec.amountEur * 100
  );
  return {
    equivalents,
    activeTestEquivalent: equivalents.filter(
      price => price.active === true && price.livemode === false
    ),
    inactiveEquivalent: equivalents.filter(price => price.active !== true),
    nonTestActiveEquivalent: equivalents.filter(
      price => price.active === true && price.livemode !== false
    )
  };
}

function productCreateParams(spec) {
  return {
    name: spec.name,
    description: spec.description,
    active: "true",
    "metadata[flowpoint_addon_key]": spec.addon,
    "metadata[flowpoint_environment]": "render-test"
  };
}

function priceCreateParams(productId, spec) {
  return {
    product: productId,
    currency: "eur",
    unit_amount: String(spec.amountEur * 100),
    "recurring[interval]": "month",
    "metadata[flowpoint_addon_key]": spec.addon,
    "metadata[flowpoint_environment]": "render-test"
  };
}

function validateCreatedPrice(price, productId, spec) {
  return Boolean(
    typeof price?.id === "string" &&
    price.id.startsWith("price_") &&
    price.product === productId &&
    price.currency?.toLowerCase() === "eur" &&
    amountCents(price) === spec.amountEur * 100 &&
    price.recurring?.interval === "month" &&
    (price.recurring?.interval_count ?? 1) === 1 &&
    price.active === true &&
    price.livemode === false
  );
}

async function main() {
  if (!process.argv.includes("--confirm")) {
    return emit({ status: "refused", reason: "pass_--confirm_to_allow_test_account_writes" });
  }
  if (env.STRIPE_TEST_MODE !== "true") {
    return emit({ status: "refused", reason: "STRIPE_TEST_MODE_is_not_true" });
  }
  if (!key.startsWith("sk_test_")) {
    return emit({
      status: "refused",
      reason: "test_key_missing_or_not_sk_test",
      keySource: env.STRIPE_TEST_KEY
        ? "STRIPE_TEST_KEY"
        : env.STRIPE_TEST_SECRET_KEY
          ? "STRIPE_TEST_SECRET_KEY"
          : null
    });
  }

  let account;
  try {
    account = await stripeRequest("GET", "/v1/account");
  } catch (error) {
    return emit({ status: "failed", reason: "could_not_verify_test_account", details: safeError(error) });
  }
  if (account?.id !== EXPECTED_ACCOUNT_ID) {
    return emit({
      status: "refused",
      reason: "account_id_does_not_match_render_test",
      expectedAccountId: EXPECTED_ACCOUNT_ID,
      actualAccountId: account?.id ?? null
    });
  }

  let products;
  try {
    products = [
      ...await listAll("/v1/products", { active: "true" }, "list_active_products"),
      ...await listAll("/v1/products", { active: "false" }, "list_inactive_products")
    ];
  } catch (error) {
    return emit({ status: "failed", reason: "product_preflight_failed", details: safeError(error) });
  }
  const uniqueProducts = [...new Map(products.map(product => [product.id, product])).values()];
  const plans = [];
  const blockers = [];

  for (const spec of specs) {
    let candidates = uniqueProducts
      .map(product => ({ product, match: classifyProduct(product, spec) }))
      .filter(item => item.match.type !== "none");
    const strong = candidates.filter(item => item.match.type === "strong");
    const possible = candidates.filter(item => item.match.type === "possible");

    if (possible.length || strong.length > 1) {
      blockers.push({
        addon: spec.addon,
        reason: "possible_or_ambiguous_product_match",
        candidateNames: candidates.map(item => item.product.name || null)
      });
      continue;
    }

    if (!strong.length) {
      if (spec.reuseOnly) {
        blockers.push({ addon: spec.addon, reason: "required_existing_gbp_product_not_found" });
      } else {
        plans.push({ spec, product: null, productAction: "create", priceId: null, priceAction: "create" });
      }
      continue;
    }

    const product = strong[0].product;
    if (product.active !== true) {
      blockers.push({
        addon: spec.addon,
        reason: "matching_product_is_inactive",
        candidateNames: [product.name || null]
      });
      continue;
    }

    let priceInfo;
    try {
      priceInfo = await inspectPrices(product, spec);
    } catch (error) {
      blockers.push({ addon: spec.addon, reason: "price_preflight_failed", details: safeError(error) });
      continue;
    }

    if (
      priceInfo.equivalents.length > 1 ||
      priceInfo.inactiveEquivalent.length ||
      priceInfo.nonTestActiveEquivalent.length
    ) {
      blockers.push({
        addon: spec.addon,
        reason: "equivalent_price_is_ambiguous_inactive_or_not_test",
        candidateNames: [product.name || null]
      });
      continue;
    }

    if (priceInfo.activeTestEquivalent.length === 1) {
      plans.push({
        spec,
        product,
        productAction: "reuse",
        priceId: priceInfo.activeTestEquivalent[0].id,
        priceAction: "reuse"
      });
    } else if (spec.reuseOnly) {
      blockers.push({
        addon: spec.addon,
        reason: "required_existing_active_test_price_not_found",
        candidateNames: [product.name || null]
      });
    } else {
      plans.push({ spec, product, productAction: "reuse", priceId: null, priceAction: "create" });
    }
  }

  if (blockers.length) {
    return emit({
      status: "blocked",
      accountId: account.id,
      productsScanned: uniqueProducts.length,
      blockers,
      writesPerformed: false
    });
  }

  const progress = [];
  const envVars = [];
  const changedResources = new Set();

  try {
    for (const plan of plans) {
      const { spec } = plan;
      let product = plan.product;
      let productAction = plan.productAction;
      let priceId = plan.priceId;
      let priceAction = plan.priceAction;
      const entry = { addon: spec.addon, productAction, priceAction: "pending" };
      progress.push(entry);

      if (!product) {
        entry.productAction = "create_attempted";
        product = await stripeRequest(
          "POST",
          "/v1/products",
          productCreateParams(spec),
          `render-test-addon-v1-product-${spec.addon}`
        );
        if (
          typeof product?.id !== "string" ||
          !product.id.startsWith("prod_") ||
          product.name !== spec.name ||
          product.active !== true ||
          product.livemode !== false
        ) {
          throw Object.assign(new Error(), {
            safe: { stage: `verify_product_${spec.addon}`, reason: "created_product_failed_test_validation" }
          });
        }
        productAction = "created";
        entry.productAction = productAction;
        changedResources.add("products");
      }

      if (priceAction === "create") {
        entry.priceAction = "create_attempted";
        const createdPrice = await stripeRequest(
          "POST",
          "/v1/prices",
          priceCreateParams(product.id, spec),
          `render-test-addon-v1-price-${spec.addon}`
        );
        if (!validateCreatedPrice(createdPrice, product.id, spec)) {
          throw Object.assign(new Error(), {
            safe: { stage: `verify_price_${spec.addon}`, reason: "created_price_failed_test_validation" }
          });
        }
        priceId = createdPrice.id;
        priceAction = "created";
        entry.priceAction = priceAction;
        changedResources.add("prices");
      } else {
        entry.priceAction = "reuse";
      }

      envVars.push({ name: spec.envVar, priceId, action: priceAction });
      entry.productAction = productAction;
    }
  } catch (error) {
    return emit({
      status: progress.length ? "partial_failure" : "failed",
      accountId: account.id,
      writesPerformed: usedMethods.has("POST"),
      completed: progress,
      rerunIsIdempotent: true,
      details: safeError(error)
    });
  }

  return emit({
    status: "complete",
    readOnly: false,
    accountId: account.id,
    productsScanned: uniqueProducts.length,
    stripeHttpMethodsUsed: [...usedMethods],
    writesPerformed: changedResources.size > 0,
    changedResources: [...changedResources],
    unchangedResources: ["customers", "subscriptions", "checkout_sessions", "entitlements"],
    operations: progress,
    envVars,
    note: "Price IDs are test-mode identifiers; no secret key is included."
  });
}

main().catch(error => {
  emit({
    status: "failed",
    writesPerformed: usedMethods.has("POST"),
    details: safeError(error)
  });
  process.exitCode = 1;
});
