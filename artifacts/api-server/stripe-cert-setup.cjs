/**
 * stripe-cert-setup.cjs — Phase 1: Stripe Test infrastructure
 * Run from: artifacts/api-server/
 */
'use strict';
const Stripe = require('./node_modules/stripe');
const { Pool } = require('./node_modules/pg');
const fs = require('fs');

const STRIPE_KEY = process.env.STRIPE_TEST_KEY;
if (!STRIPE_KEY || !STRIPE_KEY.startsWith('sk_test_')) {
  console.error('FATAL: STRIPE_TEST_KEY missing or not test mode'); process.exit(1);
}

const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2026-04-22.dahlia' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ORGS = {
  standard: { id: '8bb3b58f-8b77-42e5-a082-559aa5040004', email: 'certstd@cert.test' },
  pro:      { id: 'd66cff1f-ac20-4856-bff4-c85e3f38f971', email: 'certpro@cert.test' },
  ultra:    { id: '3c25177c-cc96-4150-8eb7-74b7af114df8', email: 'certult@cert.test' },
};

const PLANS = [
  { key: 'standard', name: 'FP Standard CERT', price: 2900 },
  { key: 'pro',      name: 'FP Pro CERT',      price: 7900 },
  { key: 'ultra',    name: 'FP Ultra CERT',    price: 14900 },
];

const ADDONS = [
  { key: 'monitorsPack10',        price:  900, qty: true  },
  { key: 'monitorsPack50',        price: 1900, qty: true  },
  { key: 'globalMonitoring',      price: 4900, qty: false },
  { key: 'slaMonitoring',         price: 1900, qty: false },
  { key: 'advancedSeoLab',        price: 2900, qty: false },
  { key: 'keywordDomination',     price: 3900, qty: false },
  { key: 'backlinkIntelligence',  price: 2400, qty: false },
  { key: 'aiContentStrategist',   price: 3400, qty: false },
  { key: 'gbpSlots10',            price: 1900, qty: true  },
  { key: 'aiGbpPosting',          price: 2900, qty: false },
  { key: 'reviewIntelligence',    price: 1900, qty: false },
  { key: 'localDominationMaps',   price: 2400, qty: false },
  { key: 'aiCro',                 price: 3400, qty: false },
  { key: 'behavioralAI',          price: 4400, qty: false },
  { key: 'revenueLeak',           price: 2900, qty: false },
  { key: 'abTestingAI',           price: 2400, qty: false },
  { key: 'whiteLabel',            price: 1700, qty: false },
  { key: 'agencyPacks',           price: 4900, qty: false },
  { key: 'aiExecutiveReport',     price: 2400, qty: false },
  { key: 'aiForecasting',         price: 3900, qty: false },
  { key: 'marketIntelligence',    price: 4900, qty: false },
  { key: 'aiWorkflows',           price: 3400, qty: false },
  { key: 'extraSeats',            price: 3500, qty: true  },
  { key: 'enterprisePermissions', price: 1900, qty: false },
  { key: 'retention90d',          price:  900, qty: false },
  { key: 'retention365d',         price: 1900, qty: false },
  { key: 'advancedWebhooks',      price: 1400, qty: false },
  { key: 'zapierIntegration',     price: 1900, qty: false },
  { key: 'crmIntegration',        price: 2900, qty: false },
  { key: 'customDomain',          price:  900, qty: false },
  { key: 'ssoEnterprise',         price: 4900, qty: false },
  { key: 'aiWorkspaceLaunch',     price: 4900, qty: false },
  { key: 'prioritySupport',       price: 2900, qty: false },
  { key: 'auditsPack200',         price: 1200, qty: true  },
  { key: 'auditsPack1000',        price: 3900, qty: true  },
  { key: 'pdfPack200',            price: 1200, qty: true  },
  { key: 'exportsPack1000',       price: 1400, qty: true  },
];

const AI_PACKS = [
  { key: 'aiCreditsPack50k',  credits: 50000,  price:  400 },
  { key: 'aiCreditsPack200k', credits: 200000, price:  900 },
  { key: 'aiCreditsPack500k', credits: 500000, price: 1900 },
];

async function mkPrice(name, amount, meta, recurring = true) {
  const prod = await stripe.products.create({ name: `${name} [CERT]`, metadata: meta });
  const params = { product: prod.id, unit_amount: amount, currency: 'eur', metadata: meta };
  if (recurring) params.recurring = { interval: 'month' };
  const price = await stripe.prices.create(params);
  return { productId: prod.id, priceId: price.id };
}

async function main() {
  console.log('=== Stripe Test Certification — Phase 1: Setup ===\n');
  const ids = { plans: {}, addons: {}, aiPacks: {}, customers: {}, orgs: ORGS };

  // Plans
  console.log('[1] Plan products+prices...');
  for (const p of PLANS) {
    ids.plans[p.key] = await mkPrice(p.name, p.price, { plan: p.key, cert: 'cert2026' });
    console.log(`  ${p.key}: ${ids.plans[p.key].priceId}`);
  }

  // Add-ons
  console.log('\n[2] Add-on products+prices (36)...');
  for (const a of ADDONS) {
    ids.addons[a.key] = { ...await mkPrice(a.key, a.price, { addonKey: a.key, cert: 'cert2026' }), qty: a.qty };
    process.stdout.write('.');
  }
  console.log(` done (${ADDONS.length})`);

  // AI packs (one-time)
  console.log('\n[3] AI credit pack prices (one-time)...');
  for (const ai of AI_PACKS) {
    ids.aiPacks[ai.key] = {
      ...await mkPrice(ai.key, ai.price, { addonKey: ai.key, credits: String(ai.credits), cert: 'cert2026' }, false),
      credits: ai.credits,
    };
    console.log(`  ${ai.key}: ${ids.aiPacks[ai.key].priceId} (+${ai.credits} credits)`);
  }

  // Customers + DB link
  console.log('\n[4] Test customers + org DB reset...');
  const client = await pool.connect();
  try {
    for (const [planKey, org] of Object.entries(ORGS)) {
      // Reset org to clean state
      await client.query(`
        UPDATE organizations SET
          plan = $2, subscription_status = 'active',
          stripe_customer_id = NULL, stripe_subscription_id = NULL,
          trial_consumed_at = NULL, trial_ends_at = NULL
        WHERE id = $1
      `, [org.id, planKey]);
      await client.query(`DELETE FROM org_addons WHERE org_id = $1`, [org.id]);

      const cus = await stripe.customers.create({
        email: org.email,
        metadata: { orgId: org.id, plan: planKey, cert: 'cert2026' },
      });
      ids.customers[planKey] = { customerId: cus.id, orgId: org.id };
      await client.query(`UPDATE organizations SET stripe_customer_id = $1 WHERE id = $2`, [cus.id, org.id]);
      console.log(`  ${planKey}: ${org.id} → ${cus.id}`);
    }
  } finally {
    client.release();
  }

  fs.writeFileSync('/tmp/stripe-cert-ids.json', JSON.stringify(ids, null, 2));
  console.log('\n✅ Setup complete — /tmp/stripe-cert-ids.json written');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); }).finally(() => pool.end());
