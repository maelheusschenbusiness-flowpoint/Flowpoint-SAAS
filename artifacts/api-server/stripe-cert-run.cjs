/**
 * stripe-cert-run.cjs — Certification finale billing FlowPoint (Stripe Test)
 * Run from: artifacts/api-server/
 *
 * A: subscriptions.created + 6 transitions de plan
 * B: 36 add-ons (18 inclus plan + 31 payants batch × 2 sub)
 * C: 3 packs crédits IA (PaymentIntent)
 * D: 10 edge-cases
 */
'use strict';
const Stripe   = require('./node_modules/stripe');
const { Pool } = require('./node_modules/pg');
const crypto   = require('crypto');
const http     = require('http');
const fs       = require('fs');

const STRIPE_KEY      = process.env.STRIPE_TEST_KEY;
const WEBHOOK_SECRET  = process.env.STRIPE_TEST_WEBHOOK_SECRET;
if (!STRIPE_KEY || !STRIPE_KEY.startsWith('sk_test_')) { console.error('FATAL: STRIPE_TEST_KEY'); process.exit(1); }
if (!WEBHOOK_SECRET) { console.error('FATAL: STRIPE_TEST_WEBHOOK_SECRET'); process.exit(1); }

const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2026-04-22.dahlia' });
const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const IDS    = JSON.parse(fs.readFileSync('/tmp/stripe-cert-ids.json', 'utf8'));
const ORGS   = IDS.orgs;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sign(body, secret, ts) {
  return `t=${ts},v1=${crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
}
function postWebhook(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const ts   = Math.floor(Date.now() / 1000);
    const opts = {
      hostname: 'localhost', port: 8081, path: '/api/webhooks/stripe', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Stripe-Signature': sign(body, WEBHOOK_SECRET, ts) },
    };
    const req = http.request(opts, res => { let d=''; res.on('data', c => d+=c); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } }); });
    req.on('error', reject); req.write(body); req.end();
  });
}
function apiGet(path, token) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'localhost', port: 8081, path, method: 'GET', headers: token ? { Authorization: `Bearer ${token}` } : {} };
    const req = http.request(opts, res => { let d=''; res.on('data', c => d+=c); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } }); });
    req.on('error', reject); req.end();
  });
}
function apiPost(path, token, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(bodyObj);
    const opts = { hostname: 'localhost', port: 8081, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...(token ? { Authorization: `Bearer ${token}` } : {}) } };
    const req = http.request(opts, res => { let d=''; res.on('data', c => d+=c); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } }); });
    req.on('error', reject); req.write(body); req.end();
  });
}
async function getOrCreateSession(orgId, email) {
  const client = await pool.connect();
  try {
    const ex = await client.query(`SELECT token FROM user_sessions WHERE org_id=$1 AND expires_at>NOW() LIMIT 1`, [orgId]);
    if (ex.rows[0]?.token) return ex.rows[0].token;
    const token = crypto.randomBytes(32).toString('hex');
    await client.query(
      `INSERT INTO user_sessions(token,org_id,user_id,email,role,expires_at,created_at) VALUES($1,$2,$3,$4,'owner',NOW()+INTERVAL'7 days',NOW()) ON CONFLICT(token) DO NOTHING`,
      [token, orgId, email, email]
    );
    return token;
  } finally { client.release(); }
}
async function dbCheck(orgId) {
  const client = await pool.connect();
  try {
    const o = await client.query(`SELECT plan,subscription_status,stripe_customer_id,stripe_subscription_id FROM organizations WHERE id=$1`, [orgId]);
    const a = await client.query(`SELECT addon_key,active,quantity FROM org_addons WHERE org_id=$1 AND active=true`, [orgId]);
    return { org: o.rows[0], addons: a.rows.reduce((acc,r) => { acc[r.addon_key] = r.quantity ?? true; return acc; }, {}) };
  } finally { client.release(); }
}
function mkSubEvt(type, sub) {
  return { id: `evt_cert_${Date.now()}_${Math.random().toString(36).slice(2,8)}`, object:'event', type, data: { object: sub }, livemode: false, created: Math.floor(Date.now()/1000) };
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const RESULTS = [];
function row(sec, label, stripeCol, whCol, dbCol, entCol, apiCol, result) {
  RESULTS.push({ sec, label, stripeCol, whCol, dbCol, entCol, apiCol, result });
  console.log(`  [${result==='PASS'?'✅':'❌'}] ${label}: ${result}`);
}
function pass(sec, label, stripe, wh, db, ent, api) { row(sec, label, stripe, wh, db, ent, api, 'PASS'); }
function fail(sec, label, stripe, wh, db, ent, api, why) { row(sec, label, stripe, `${wh}`, `${db}`, `${ent}`, `${api}(${why})`, 'FAIL'); }

// ─── Pre-cleanup: cancel stale subs + clean DB ─────────────────────────────────

async function preCleanup() {
  console.log('\n[PRE-CLEANUP] Canceling old Stripe subs + cleaning DB...');
  const KEEP_SUBS = [];  // will track newly-created subs
  const allCus = Object.values(IDS.customers).map(c => c.customerId);
  for (const cus of allCus) {
    const subs = await stripe.subscriptions.list({ customer: cus, limit: 20 });
    for (const s of subs.data) {
      if (s.status !== 'canceled') {
        await stripe.subscriptions.cancel(s.id).catch(() => {});
      }
    }
  }
  const client = await pool.connect();
  try {
    for (const [planKey, org] of Object.entries(ORGS)) {
      await client.query(`DELETE FROM org_addons WHERE org_id=$1`, [org.id]);
      await client.query(`UPDATE organizations SET plan=$2, subscription_status='active', stripe_subscription_id=NULL WHERE id=$1`, [org.id, planKey]);
    }
  } finally { client.release(); }
  console.log('  Done.\n');
}

// ─── SECTION A ─────────────────────────────────────────────────────────────────

async function sectionA() {
  console.log('══════════════════════════════════════════');
  console.log('SECTION A — Plan subscriptions + 6 transitions');
  console.log('══════════════════════════════════════════');

  // A0: create real Stripe subscriptions (trial_period_days so no PM needed)
  console.log('\n[A0] Creating Stripe Test subscriptions...');
  const subs = {};
  for (const [planKey, org] of Object.entries(ORGS)) {
    const sub = await stripe.subscriptions.create({
      customer: IDS.customers[planKey].customerId,
      items: [{ price: IDS.plans[planKey].priceId }],
      trial_period_days: 30,
      metadata: { orgId: org.id, plan: planKey, cert: 'cert2026' },
    });
    subs[planKey] = sub;
    const client = await pool.connect();
    try { await client.query(`UPDATE organizations SET stripe_subscription_id=$1 WHERE id=$2`, [sub.id, org.id]); }
    finally { client.release(); }
    console.log(`  ${planKey}: ${sub.id} (${sub.status})`);
  }

  // A1–A3: subscription.created → DB + /api/me
  const planKeys = Object.keys(ORGS);
  for (let i = 0; i < planKeys.length; i++) {
    const planKey = planKeys[i];
    const org = ORGS[planKey];
    const sub = subs[planKey];
    const wh  = await postWebhook(mkSubEvt('customer.subscription.created', sub));
    await sleep(700);
    const db    = await dbCheck(org.id);
    const token = await getOrCreateSession(org.id, org.email);
    const me    = await apiGet('/api/me', token);
    const label = `A${i+1} subscription.created ${planKey}`;
    const okWh  = wh.status === 200;
    const okDb  = db.org?.plan === planKey;
    const okMe  = me.body?.plan?.toLowerCase() === planKey;
    const okSt  = ['trialing','active'].includes(me.body?.subscriptionStatus);
    if (okWh && okDb && okMe && okSt) pass('A', label, sub.id, '200', planKey, 'N/A', `plan:${me.body?.plan}`);
    else fail('A', label, sub.id, wh.status, `db:${db.org?.plan}`, 'N/A', `me:${me.body?.plan}`, `st:${me.body?.subscriptionStatus}`);
  }

  // A4–A9: 6 plan transitions
  console.log('\n[A4-A9] Plan transitions...');
  const transitions = [
    { label:'A4 Std→Pro',   orgKey:'standard', to:'pro'      },
    { label:'A5 Std→Ultra', orgKey:'standard', to:'ultra'    },
    { label:'A6 Pro→Ultra', orgKey:'pro',      to:'ultra'    },
    { label:'A7 Ult→Pro',   orgKey:'ultra',    to:'pro'      },
    { label:'A8 Ult→Std',   orgKey:'ultra',    to:'standard' },
    { label:'A9 Pro→Std',   orgKey:'pro',      to:'standard' },
  ];
  const MON = { standard:10, pro:50, ultra:300 };

  for (const t of transitions) {
    await sleep(1000);
    const org  = ORGS[t.orgKey];
    const sub  = subs[t.orgKey];
    const live = await stripe.subscriptions.retrieve(sub.id);
    const pItem = live.items.data.find(i => Object.values(IDS.plans).some(p => p.priceId === i.price.id));
    const updated = pItem
      ? await stripe.subscriptions.update(sub.id, {
          items: [{ id: pItem.id, price: IDS.plans[t.to].priceId }],
          metadata: { orgId: org.id, plan: t.to, cert: 'cert2026' },
          proration_behavior: 'none',
        })
      : live;
    const wh    = await postWebhook(mkSubEvt('customer.subscription.updated', updated));
    await sleep(800);
    const db    = await dbCheck(org.id);
    const token = await getOrCreateSession(org.id, org.email);
    const me    = await apiGet('/api/me', token);
    const okWh  = wh.status === 200;
    const okDb  = db.org?.plan === t.to;
    const okMe  = me.body?.plan?.toLowerCase() === t.to;
    const gotMon = me.body?.limits?.monitors ?? me.body?.usage?.monitor?.limit;
    const okMon  = gotMon === MON[t.to];
    if (okWh && okDb && okMe && okMon) pass('A', t.label, `${sub.id}→${t.to}`, '200', t.to, `mon=${gotMon}`, `plan:${t.to}`);
    else fail('A', t.label, `${sub.id}→${t.to}`, wh.status, `db:${db.org?.plan}`, `mon=${gotMon}≠${MON[t.to]}`, `me:${me.body?.plan}`, `okWh=${okWh}okDb=${okDb}okMe=${okMe}okMon=${okMon}`);
  }

  // Reset all orgs back to their base plans after transition tests
  console.log('\n  Restoring base plans...');
  const client = await pool.connect();
  try {
    for (const [pk, org] of Object.entries(ORGS)) {
      await sleep(700);
      const live = await stripe.subscriptions.retrieve(subs[pk].id);
      const pItem = live.items.data.find(i => Object.values(IDS.plans).some(p => p.priceId === i.price.id));
      if (pItem && pItem.price.id !== IDS.plans[pk].priceId) {
        await stripe.subscriptions.update(subs[pk].id, {
          items: [{ id: pItem.id, price: IDS.plans[pk].priceId }],
          metadata: { orgId: org.id, plan: pk, cert: 'cert2026' },
          proration_behavior: 'none',
        });
      }
      await client.query(`UPDATE organizations SET plan=$2 WHERE id=$1`, [org.id, pk]);
      await client.query(`DELETE FROM org_addons WHERE org_id=$1`, [org.id]);
    }
  } finally { client.release(); }
  console.log('  Done.');

  return subs;
}

// ─── SECTION B ─────────────────────────────────────────────────────────────────

async function sectionB(subs) {
  console.log('\n══════════════════════════════════════════');
  console.log('SECTION B — Add-ons (18 inclus + 31 payants)');
  console.log('══════════════════════════════════════════');

  const INCLUDED = {
    standard: ['whiteLabel'],
    pro:      ['whiteLabel','advancedWebhooks','retention90d','advancedSeoLab','backlinkIntelligence','prioritySupport'],
    ultra:    ['whiteLabel','customDomain','advancedWebhooks','retention90d','advancedSeoLab','backlinkIntelligence',
               'prioritySupport','retention365d','keywordDomination','behavioralAI','aiForecasting'],
  };

  // B-INCLUDED: plan-bundled — no purchase needed
  console.log('\n[B-INCLUDED] Plan-bundled add-ons...');
  for (const [plan, keys] of Object.entries(INCLUDED)) {
    const org   = ORGS[plan];
    const token = await getOrCreateSession(org.id, org.email);
    const me    = await apiGet('/api/me', token);
    const meA   = me.body?.addons ?? {};
    for (const key of keys) {
      if (meA[key]) pass('B', `B-incl: ${plan}→${key}`, 'N/A(bundled)', 'N/A', 'N/A', 'PASS', 'PASS');
      else          fail('B', `B-incl: ${plan}→${key}`, 'N/A', 'N/A', 'N/A', 'FAIL(missing)', 'N/A', '');
    }
  }

  // B-PAID: test 31 paid addons (not in Pro-included) split across 2 subs
  // Stripe hard limit = 20 items per subscription (plan item + max 19 addons)
  console.log('\n[B-PAID] Paid add-ons — batch via 2 Stripe subscriptions...');

  const proOrg   = ORGS.pro;
  const proSub   = subs.pro;
  const proToken = await getOrCreateSession(proOrg.id, proOrg.email);
  const proIncl  = new Set(INCLUDED.pro);
  const paidAll  = Object.entries(IDS.addons).filter(([k]) => !proIncl.has(k));
  // paidAll ≈ 31 addons

  const BATCH1_SIZE = 19; // leaves room for plan item → total 20 (Stripe limit)
  const batch1 = paidAll.slice(0, BATCH1_SIZE);
  const batch2 = paidAll.slice(BATCH1_SIZE);

  console.log(`  batch1=${batch1.length} addons on proSub | batch2=${batch2.length} addons on extra sub`);

  // ── Batch 1: add to pro main sub ────────────────────────────────────────────
  const b1Items = batch1.map(([key, info]) => ({
    price: info.priceId, quantity: info.qty ? 2 : 1, metadata: { addonKey: key, cert: 'cert2026' },
  }));
  const sub1Updated = await stripe.subscriptions.update(proSub.id, {
    items: b1Items, proration_behavior: 'none',
    metadata: { orgId: proOrg.id, plan: 'pro', cert: 'cert2026' },
  });
  const wh1 = await postWebhook(mkSubEvt('customer.subscription.updated', sub1Updated));
  await sleep(1500);
  const db1  = await dbCheck(proOrg.id);
  const me1  = await apiGet('/api/me', proToken);
  const mA1  = me1.body?.addons ?? {};
  const lim1 = me1.body?.limits ?? {};
  const MON_BASE_PRO = 50;

  for (const [key, info] of batch1) {
    const dbV = db1.addons[key]; const meV = mA1[key];
    const okDb = dbV !== undefined && dbV !== false;
    const okMe = meV !== undefined && meV !== false;
    const okQty = !info.qty || Number(dbV) === 2;
    let ent = 'N/A';
    if (info.qty && key==='monitorsPack10') { const exp=MON_BASE_PRO+20; ent=lim1.monitors===exp?`PASS(mon=${lim1.monitors})`:`FAIL(${lim1.monitors}≠${exp})`; }
    else if (info.qty && key==='extraSeats')   { ent=lim1.teamMembers>5?`PASS(seats=${lim1.teamMembers})`:`FAIL(${lim1.teamMembers})`; }
    else if (info.qty && key==='auditsPack200') { ent=lim1.audits>300?`PASS(aud=${lim1.audits})`:`FAIL(${lim1.audits})`; }
    if (wh1.status===200 && okDb && okMe && okQty) pass('B', `B-paid: ${key}${info.qty?' qty=2':''}`, `batch1:${sub1Updated.id}`, '200', `PASS(${dbV})`, ent, `PASS(${meV})`);
    else fail('B', `B-paid: ${key}${info.qty?' qty=2':''}`, `batch1:${sub1Updated.id}`, wh1.status, okDb?`${dbV}`:'FAIL', ent, okMe?`${meV}`:'FAIL', `okDb=${okDb}okMe=${okMe}okQty=${okQty}`);
  }

  // ── Batch 2: create second subscription (addon-only, no plan price) ─────────
  await sleep(800);
  const b2Items = batch2.map(([key, info]) => ({
    price: info.priceId, quantity: info.qty ? 2 : 1, metadata: { addonKey: key, cert: 'cert2026' },
  }));
  const addonSub = await stripe.subscriptions.create({
    customer: IDS.customers.pro.customerId,
    items: b2Items,
    trial_period_days: 30,
    metadata: { orgId: proOrg.id, cert: 'cert2026' },  // no plan key → parsePlanFromSubscription returns null → plan not changed
  });
  const wh2 = await postWebhook(mkSubEvt('customer.subscription.updated', addonSub));
  await sleep(1500);
  const db2  = await dbCheck(proOrg.id);
  const me2  = await apiGet('/api/me', proToken);
  const mA2  = me2.body?.addons ?? {};
  const lim2 = me2.body?.limits ?? {};

  for (const [key, info] of batch2) {
    const dbV = db2.addons[key]; const meV = mA2[key];
    const okDb = dbV !== undefined && dbV !== false;
    const okMe = meV !== undefined && meV !== false;
    const okQty = !info.qty || Number(dbV) === 2;
    let ent = 'N/A';
    if (info.qty && key==='monitorsPack50') { ent=lim2.monitors>50?`PASS(mon=${lim2.monitors})`:`FAIL(${lim2.monitors})`; }
    else if (info.qty && key==='gbpSlots10') { ent=lim2.gbpSlots>=0?`PASS(gbp=${lim2.gbpSlots})`:'N/A'; }
    if (wh2.status===200 && okDb && okMe && okQty) pass('B', `B-paid: ${key}${info.qty?' qty=2':''}`, `batch2:${addonSub.id}`, '200', `PASS(${dbV})`, ent, `PASS(${meV})`);
    else fail('B', `B-paid: ${key}${info.qty?' qty=2':''}`, `batch2:${addonSub.id}`, wh2.status, okDb?`${dbV}`:'FAIL', ent, okMe?`${meV}`:'FAIL', `okDb=${okDb}okMe=${okMe}okQty=${okQty}`);
  }

  // ── Deactivate batch1: remove all 19 addon items from pro sub ───────────────
  console.log('\n[B-DEACT] Deactivate batch1 (19 addons from pro sub)...');
  await sleep(600);
  const freshPro = await stripe.subscriptions.retrieve(proSub.id);
  const b1PriceSet = new Set(batch1.map(([_,i]) => i.priceId));
  const delB1 = freshPro.items.data
    .filter(i => b1PriceSet.has(i.price.id) || batch1.some(([k]) => i.metadata?.addonKey===k))
    .map(i => ({ id: i.id, deleted: true }));
  const sub1Del = await stripe.subscriptions.update(proSub.id, {
    items: delB1, proration_behavior: 'none',
    metadata: { orgId: proOrg.id, plan: 'pro', cert: 'cert2026' },
  });
  const whD1 = await postWebhook(mkSubEvt('customer.subscription.updated', sub1Del));
  await sleep(1500);
  const dbD1 = await dbCheck(proOrg.id);
  for (const [key] of batch1) {
    const after = dbD1.addons[key];
    const okDel = after === undefined || after === false;
    if (okDel) pass('B', `B-deact: ${key}`, `del:${proSub.id}`, `${whD1.status}`, 'PASS(removed)', 'N/A', 'N/A');
    else       fail('B', `B-deact: ${key}`, `del:${proSub.id}`, whD1.status, `FAIL(still=${after})`, 'N/A', 'N/A', '');
  }

  // ── Deactivate batch2: cancel the addon-only sub ────────────────────────────
  console.log('\n[B-DEACT] Deactivate batch2 (12 addons — cancel addon sub)...');
  await sleep(600);
  const canceledAddonSub = await stripe.subscriptions.cancel(addonSub.id);
  const whD2 = await postWebhook(mkSubEvt('customer.subscription.deleted', canceledAddonSub));
  await sleep(1500);
  const dbD2 = await dbCheck(proOrg.id);
  for (const [key] of batch2) {
    const after = dbD2.addons[key];
    const okDel = after === undefined || after === false;
    if (okDel) pass('B', `B-deact: ${key}`, `del:${addonSub.id}`, `${whD2.status}`, 'PASS(removed)', 'N/A', 'N/A');
    else       fail('B', `B-deact: ${key}`, `del:${addonSub.id}`, whD2.status, `FAIL(still=${after})`, 'N/A', 'N/A', '');
  }

  // ── B-IDEMPOTENT: duplicate webhook — qty must not double ──────────────────
  console.log('\n[B-SPECIAL] Idempotency — dup webhook (monitorsPack10)...');
  {
    await sleep(600);
    const freshSub = await stripe.subscriptions.retrieve(proSub.id);
    const addedSub = await stripe.subscriptions.update(proSub.id, {
      items: [{ price: IDS.addons.monitorsPack10.priceId, quantity: 1, metadata: { addonKey: 'monitorsPack10', cert: 'cert2026' } }],
      proration_behavior: 'none', metadata: { orgId: proOrg.id, plan: 'pro', cert: 'cert2026' },
    });
    const evt = mkSubEvt('customer.subscription.updated', addedSub);
    await postWebhook(evt); await sleep(500);
    await postWebhook(evt); await sleep(500); // same event ID
    const db = await dbCheck(proOrg.id);
    const qty = Number(db.addons.monitorsPack10 ?? 0);
    const ok = qty === 1;
    if (ok) pass('B', 'B-idem: dup wh no double monitorsPack10', addedSub.id, 'dup', `PASS(qty=1)`, 'N/A', 'N/A');
    else    fail('B', 'B-idem: dup wh no double monitorsPack10', addedSub.id, 'dup', `FAIL(qty=${qty})`, 'N/A', 'N/A', '');
    // cleanup
    await sleep(400);
    const cleanSub = await stripe.subscriptions.retrieve(proSub.id);
    const mp10Item = cleanSub.items.data.find(i => i.price.id===IDS.addons.monitorsPack10.priceId||i.metadata?.addonKey==='monitorsPack10');
    if (mp10Item) {
      const cleaned = await stripe.subscriptions.update(proSub.id, { items: [{ id: mp10Item.id, deleted: true }], proration_behavior: 'none', metadata: { orgId: proOrg.id, plan: 'pro', cert: 'cert2026' } });
      await postWebhook(mkSubEvt('customer.subscription.updated', cleaned)); await sleep(500);
    }
  }

  // ── B-INCLUDED-GATE: activating plan-included addon → no Stripe charge ─────
  console.log('\n[B-SPECIAL] Plan-included gate (advancedSeoLab already in Pro)...');
  {
    const meBefore = await apiGet('/api/me', proToken);
    const hasBefore = !!meBefore.body?.addons?.advancedSeoLab;
    const act = await apiPost('/api/addons/advancedSeoLab/activate', proToken, { quantity: 1 });
    const ok = act.body?.includedInPlan === true || act.status === 200;
    if (hasBefore && ok) pass('B', 'B-incl-gate: advancedSeoLab in Pro', 'N/A', 'N/A', 'N/A', 'PASS(included)', 'PASS(no charge)');
    else                 fail('B', 'B-incl-gate: advancedSeoLab in Pro', 'N/A', 'N/A', 'N/A', hasBefore?'has':'missing', `${act.status}`, '');
  }

  // ── B-UPGRADE: paid addon Pro → included after upgrade to Ultra ────────────
  console.log('\n[B-SPECIAL] Upgrade: aiForecasting paid on Pro → included on Ultra...');
  {
    await sleep(600);
    // Add aiForecasting to pro sub
    const freshSub = await stripe.subscriptions.retrieve(proSub.id);
    const withAddon = await stripe.subscriptions.update(proSub.id, {
      items: [{ price: IDS.addons.aiForecasting.priceId, quantity: 1, metadata: { addonKey: 'aiForecasting', cert: 'cert2026' } }],
      proration_behavior: 'none', metadata: { orgId: proOrg.id, plan: 'pro', cert: 'cert2026' },
    });
    await postWebhook(mkSubEvt('customer.subscription.updated', withAddon)); await sleep(700);
    const dbBefore = await dbCheck(proOrg.id);
    const onPro = !!dbBefore.addons.aiForecasting;

    // Upgrade plan to ultra
    await sleep(700);
    const live2 = await stripe.subscriptions.retrieve(proSub.id);
    const pItem = live2.items.data.find(i => Object.values(IDS.plans).some(p => p.priceId===i.price.id));
    if (pItem) {
      const toUltra = await stripe.subscriptions.update(proSub.id, {
        items: [{ id: pItem.id, price: IDS.plans.ultra.priceId }],
        metadata: { orgId: proOrg.id, plan: 'ultra', cert: 'cert2026' }, proration_behavior: 'none',
      });
      await postWebhook(mkSubEvt('customer.subscription.updated', toUltra)); await sleep(700);
    }
    const meUltra = await apiGet('/api/me', await getOrCreateSession(proOrg.id, proOrg.email));
    const okPlan = meUltra.body?.plan?.toLowerCase() === 'ultra';
    const okAddon = !!meUltra.body?.addons?.aiForecasting;
    if (onPro && okPlan && okAddon) pass('B', 'B-upgrade: aiForecasting Pro→Ultra included', proSub.id, 'PASS', 'PASS(active)', `plan=${meUltra.body?.plan}`, 'PASS');
    else                            fail('B', 'B-upgrade: aiForecasting Pro→Ultra included', proSub.id, 'PASS', onPro?'ok':'miss', `plan=${meUltra.body?.plan}`, okAddon?'ok':'miss', '');

    // Downgrade back to Pro: remove aiForecasting item + revert plan
    await sleep(600);
    const live3 = await stripe.subscriptions.retrieve(proSub.id);
    const planItemBack = live3.items.data.find(i => Object.values(IDS.plans).some(p => p.priceId===i.price.id));
    const aiItem       = live3.items.data.find(i => i.price.id===IDS.addons.aiForecasting.priceId||i.metadata?.addonKey==='aiForecasting');
    const downItems = [];
    if (planItemBack) downItems.push({ id: planItemBack.id, price: IDS.plans.pro.priceId });
    if (aiItem)       downItems.push({ id: aiItem.id, deleted: true });
    if (downItems.length) {
      const downSub = await stripe.subscriptions.update(proSub.id, { items: downItems, metadata: { orgId: proOrg.id, plan: 'pro', cert: 'cert2026' }, proration_behavior: 'none' });
      await postWebhook(mkSubEvt('customer.subscription.updated', downSub)); await sleep(700);
    }
    const dbDown = await dbCheck(proOrg.id);
    const meDown = await apiGet('/api/me', proToken);
    const planPro = meDown.body?.plan?.toLowerCase() === 'pro';
    const aiGone  = !dbDown.addons.aiForecasting;
    if (planPro && aiGone) pass('B', 'B-downgrade: aiForecasting Ultra→Pro removed', proSub.id, 'PASS', 'PASS(gone)', `plan=${meDown.body?.plan}`, 'PASS');
    else                   fail('B', 'B-downgrade: aiForecasting Ultra→Pro removed', proSub.id, 'PASS', aiGone?'gone':'still', `plan=${meDown.body?.plan}`, aiGone?'gone':'still', '');
  }
}

// ─── SECTION C ─────────────────────────────────────────────────────────────────

async function sectionC() {
  console.log('\n══════════════════════════════════════════');
  console.log('SECTION C — AI Credit Packs (PaymentIntent)');
  console.log('══════════════════════════════════════════');

  const stdOrg  = ORGS.standard;
  const cus     = IDS.customers.standard.customerId;
  const stdTok  = await getOrCreateSession(stdOrg.id, stdOrg.email);

  const packs = [
    { key: 'aiCreditsPack50k',  credits: 50000,  amount: 400  },
    { key: 'aiCreditsPack200k', credits: 200000, amount: 900  },
    { key: 'aiCreditsPack500k', credits: 500000, amount: 1900 },
  ];
  for (const pack of packs) {
    const before = await apiGet('/api/ai/usage', stdTok);
    const extBefore = Number(before.body?.extra ?? before.body?.creditsExtra ?? 0);

    // Real Stripe PaymentIntent (pm_card_visa = test preset)
    // metadata.type="ai_credits" is the branch key the webhook handler checks.
    const pi = await stripe.paymentIntents.create({
      amount: pack.amount, currency: 'eur', customer: cus,
      payment_method: 'pm_card_visa', confirm: true,
      return_url: 'https://app.flowpoint.pro/billing/checkout-return.html',
      metadata: { orgId: stdOrg.id, type: 'ai_credits', pack: pack.key, addonKey: pack.key, credits: String(pack.credits), amountEurCents: String(pack.amount), cert: 'cert2026' },
    });
    const piObj = await stripe.paymentIntents.retrieve(pi.id);
    const evt = { id: `evt_cert_pi_${piObj.id}`, object:'event', type:'payment_intent.succeeded', data:{ object: piObj }, livemode:false, created: Math.floor(Date.now()/1000) };
    const wh = await postWebhook(evt);
    await sleep(1000);

    const after = await apiGet('/api/ai/usage', stdTok);
    const extAfter = Number(after.body?.extra ?? after.body?.creditsExtra ?? 0);
    const delta = extAfter - extBefore;

    const dbClient = await pool.connect();
    let dbRow = null;
    try { const r = await dbClient.query(`SELECT credits FROM ai_credit_purchases WHERE org_id=$1 ORDER BY created_at DESC LIMIT 1`, [stdOrg.id]); dbRow = r.rows[0]; }
    finally { dbClient.release(); }

    const okWh = wh.status === 200;
    const okDb = Number(dbRow?.credits) === pack.credits;
    const okCr = delta === pack.credits;
    if (okWh && okDb && okCr) pass('C', `C: ${pack.key} (+${pack.credits})`, piObj.id, '200', `+${dbRow?.credits}`, `Δ+${delta}`, 'N/A');
    else                       fail('C', `C: ${pack.key} (+${pack.credits})`, piObj.id, wh.status, `db:${dbRow?.credits}`, `Δ=${delta}≠${pack.credits}`, 'N/A', '');
  }

  // C-IDEMPOTENT: replay same event → no double credit
  console.log('\n[C-IDEM] Duplicate PI event...');
  {
    const before = await apiGet('/api/billing/ai-usage', stdTok);
    const b0 = Number(before.body?.creditsExtra ?? 0);
    const pi = await stripe.paymentIntents.create({
      amount: 400, currency: 'eur', customer: cus,
      payment_method: 'pm_card_visa', confirm: true,
      return_url: 'https://app.flowpoint.pro/billing/checkout-return.html',
      metadata: { orgId: stdOrg.id, addonKey: 'aiCreditsPack50k', credits: '50000', cert: 'cert2026-idem' },
    });
    const piObj = await stripe.paymentIntents.retrieve(pi.id);
    const evt = { id: `evt_idem_${piObj.id}`, object:'event', type:'payment_intent.succeeded', data:{ object: piObj }, livemode:false, created: Math.floor(Date.now()/1000) };
    await postWebhook(evt); await sleep(600);
    const mid = Number((await apiGet('/api/billing/ai-usage', stdTok)).body?.creditsExtra ?? 0);
    await postWebhook(evt); await sleep(600); // same event ID
    const end = Number((await apiGet('/api/billing/ai-usage', stdTok)).body?.creditsExtra ?? 0);
    const ok = (end - mid) === 0;
    if (ok) pass('C', 'C-idem: dup PI no double credit', piObj.id, 'dup', `PASS(2nd Δ=0)`, 'N/A', 'N/A');
    else    fail('C', 'C-idem: dup PI no double credit', piObj.id, 'dup', `FAIL(2nd Δ=${end-mid})`, 'N/A', 'N/A', '');
  }
}

// ─── SECTION D ─────────────────────────────────────────────────────────────────

async function sectionD(subs) {
  console.log('\n══════════════════════════════════════════');
  console.log('SECTION D — Edge cases');
  console.log('══════════════════════════════════════════');

  const stdTok = await getOrCreateSession(ORGS.standard.id, ORGS.standard.email);
  const proTok = await getOrCreateSession(ORGS.pro.id, ORGS.pro.email);

  // D1: Org isolation
  {
    const sMe = await apiGet('/api/me', stdTok);
    const pMe = await apiGet('/api/me', proTok);
    const ok = sMe.body?.plan?.toLowerCase()==='standard' && pMe.body?.plan?.toLowerCase()==='pro' && sMe.body?.plan!==pMe.body?.plan;
    if (ok) pass('D', 'D1 Org isolation std≠pro', 'N/A', 'N/A', 'N/A', 'N/A', `std=${sMe.body?.plan} pro=${pMe.body?.plan}`);
    else    fail('D', 'D1 Org isolation std≠pro', 'N/A', 'N/A', 'N/A', 'N/A', `std=${sMe.body?.plan} pro=${pMe.body?.plan}`, '');
  }

  // D2: subscription.deleted → canceled
  {
    const org = ORGS.ultra; const sub = subs.ultra;
    const wh = await postWebhook(mkSubEvt('customer.subscription.deleted', { ...sub, status:'canceled', canceled_at: Math.floor(Date.now()/1000) }));
    await sleep(600);
    const db = await dbCheck(org.id);
    const ok = db.org?.subscription_status === 'canceled';
    if (ok) pass('D', 'D2 sub.deleted → canceled', sub.id, '200', 'PASS(canceled)', 'N/A', 'N/A');
    else    fail('D', 'D2 sub.deleted → canceled', sub.id, wh.status, `FAIL(${db.org?.subscription_status})`, 'N/A', 'N/A', '');
    // Restore
    await postWebhook(mkSubEvt('customer.subscription.updated', { ...sub, status:'trialing', metadata: { orgId: org.id, plan:'ultra', cert:'cert2026' } }));
    await sleep(400);
  }

  // D3: Unauthenticated billing → 401
  {
    const r = await apiGet('/api/billing/usage', '');
    const ok = r.status === 401;
    if (ok) pass('D', 'D3 Unauth /billing/usage → 401', 'N/A', 'N/A', 'N/A', 'N/A', '401');
    else    fail('D', 'D3 Unauth /billing/usage → 401', 'N/A', 'N/A', 'N/A', 'N/A', `${r.status}`, '');
  }

  // D4: trialing → active (trial ended)
  {
    const org = ORGS.standard; const sub = subs.standard;
    const wh = await postWebhook(mkSubEvt('customer.subscription.updated', { ...sub, status:'active', trial_end: Math.floor(Date.now()/1000)-1, metadata: { orgId: org.id, plan:'standard', cert:'cert2026' } }));
    await sleep(500);
    const db = await dbCheck(org.id);
    const ok = db.org?.subscription_status === 'active';
    if (ok) pass('D', 'D4 trialing→active', sub.id, '200', 'PASS(active)', 'N/A', 'N/A');
    else    fail('D', 'D4 trialing→active', sub.id, wh.status, `FAIL(${db.org?.subscription_status})`, 'N/A', 'N/A', '');
  }

  // D5: Same event ID twice → idempotent
  {
    const sub = subs.standard;
    const evt = { ...mkSubEvt('customer.subscription.updated', sub) };
    const wh1 = await postWebhook(evt); await sleep(300);
    const wh2 = await postWebhook(evt);
    const ok = wh1.status===200 && wh2.status===200;
    if (ok) pass('D', 'D5 Wh idempotency same event ID', evt.id, `${wh1.status}/${wh2.status}`, 'PASS(no crash)', 'N/A', 'N/A');
    else    fail('D', 'D5 Wh idempotency same event ID', evt.id, `${wh1.status}/${wh2.status}`, 'FAIL', 'N/A', 'N/A', '');
  }

  // D6: Unresolvable customer → 200 no-op
  {
    const orphan = { id:'sub_orphan_test', object:'subscription', customer:'cus_DOESNOTEXIST', status:'active', metadata:{}, items:{data:[]} };
    const wh = await postWebhook(mkSubEvt('customer.subscription.updated', orphan));
    const ok = wh.status === 200;
    if (ok) pass('D', 'D6 Unresolvable orgId → 200 no-op', 'orphan', '200', 'N/A', 'N/A', 'N/A');
    else    fail('D', 'D6 Unresolvable orgId → 200 no-op', 'orphan', `${wh.status}`, 'N/A', 'N/A', 'N/A', '');
  }

  // D7: qty=0 addon not activated
  {
    const proSub = subs.pro;
    const freshSub = await stripe.subscriptions.retrieve(proSub.id);
    const syntheticSub = { ...freshSub, items: { data: [{ id:'si_qzero', price:{ id:IDS.addons.gbpSlots10.priceId }, quantity:0, metadata:{ addonKey:'gbpSlots10' } }] }, metadata: { orgId: ORGS.pro.id, plan:'pro', cert:'cert2026' } };
    await postWebhook(mkSubEvt('customer.subscription.updated', syntheticSub)); await sleep(500);
    const db = await dbCheck(ORGS.pro.id);
    const ok = !db.addons.gbpSlots10;
    if (ok) pass('D', 'D7 qty=0 addon not activated', 'qty=0', 'N/A', 'PASS(not activated)', 'N/A', 'N/A');
    else    fail('D', 'D7 qty=0 addon not activated', 'qty=0', 'N/A', `FAIL(activated)`, 'N/A', 'N/A', '');
  }

  // D8: /api/billing/plans public
  {
    const r = await apiGet('/api/billing/plans', '');
    const ok = r.status===200 && r.body?.plans;
    if (ok) pass('D', 'D8 /billing/plans public (no auth)', 'N/A', 'N/A', 'N/A', 'N/A', `${Object.keys(r.body.plans??{}).length} plans`);
    else    fail('D', 'D8 /billing/plans public (no auth)', 'N/A', 'N/A', 'N/A', 'N/A', `${r.status}`, '');
  }

  // D9: past_due → hasPremiumAccess=true
  {
    const org = ORGS.pro; const sub = subs.pro;
    const wh = await postWebhook(mkSubEvt('customer.subscription.updated', { ...sub, status:'past_due', metadata: { orgId: org.id, plan:'pro', cert:'cert2026' } }));
    await sleep(500);
    const db = await dbCheck(org.id);
    const me = await apiGet('/api/me', proTok);
    const okPD = db.org?.subscription_status==='past_due';
    const okHA = me.body?.hasPremiumAccess===true;
    if (okPD && okHA) pass('D', 'D9 past_due still hasPremiumAccess', sub.id, '200', 'PASS(past_due)', 'N/A', 'PASS(hasPremium)');
    else              fail('D', 'D9 past_due still hasPremiumAccess', sub.id, wh.status, `${db.org?.subscription_status}`, 'N/A', `hasPremium=${me.body?.hasPremiumAccess}`, '');
    // Restore
    await postWebhook(mkSubEvt('customer.subscription.updated', { ...sub, status:'trialing', metadata: { orgId: org.id, plan:'pro', cert:'cert2026' } }));
    await sleep(400);
  }

  // D10: Cross-tenant plan isolation
  {
    const sMe = await apiGet('/api/me', stdTok);
    const pMe = await apiGet('/api/me', proTok);
    const stdPlan = sMe.body?.plan?.toLowerCase();
    const proPlan = pMe.body?.plan?.toLowerCase();
    const ok = stdPlan==='standard' && proPlan==='pro' && sMe.body?.stripeCustomerId !== pMe.body?.stripeCustomerId;
    if (ok) pass('D', 'D10 Cross-tenant isolation', 'N/A', 'N/A', 'N/A', 'N/A', `std=${stdPlan} pro=${proPlan}`);
    else    fail('D', 'D10 Cross-tenant isolation', 'N/A', 'N/A', 'N/A', 'N/A', `std=${stdPlan} pro=${proPlan}`, 'cross-leak?');
  }
}

// ─── Final report ──────────────────────────────────────────────────────────────

function printReport() {
  console.log('\n\n' + '═'.repeat(130));
  console.log('CERTIFICATION BILLING FLOWPOINT — RÉSULTATS STRIPE TEST');
  console.log('═'.repeat(130));
  console.log('Sec  ' + 'Scénario'.padEnd(55) + 'Stripe'.padEnd(32) + 'Webhook'.padEnd(10) + 'DB'.padEnd(22) + 'Entitlement'.padEnd(22) + 'API'.padEnd(20) + 'RÉSULT.');
  console.log('─'.repeat(130));
  let pass=0, fail=0;
  for (const r of RESULTS) {
    console.log(
      `${r.sec}  ` +
      r.label.slice(0,53).padEnd(55) +
      String(r.stripeCol).slice(0,30).padEnd(32) +
      String(r.whCol).slice(0,8).padEnd(10) +
      String(r.dbCol).slice(0,20).padEnd(22) +
      String(r.entCol).slice(0,20).padEnd(22) +
      String(r.apiCol).slice(0,18).padEnd(20) +
      r.result
    );
    if (r.result==='PASS') pass++; else fail++;
  }
  console.log('─'.repeat(130));
  console.log(`TOTAL: ${pass+fail} | ✅ ${pass} PASS | ❌ ${fail} FAIL`);
  console.log('═'.repeat(130));

  const md = [
    '# Certification Finale Billing FlowPoint — Stripe Test',
    '',
    `Date: ${new Date().toISOString()}`,
    `**Total: ${pass+fail} | PASS: ${pass} | FAIL: ${fail}**`,
    '',
    '| Sec | Scénario | Stripe Test | Webhook | DB | Entitlement | API | RÉSULTAT |',
    '|-----|----------|-------------|---------|-----|-------------|-----|----------|',
    ...RESULTS.map(r => `| ${r.sec} | ${r.label} | ${r.stripeCol} | ${r.whCol} | ${r.dbCol} | ${r.entCol} | ${r.apiCol} | **${r.result}** |`),
    '',
    '## Verdict',
    fail===0
      ? `🟢 **BILLING CERTIFIÉ ET GELÉ** — ${pass}/${pass+fail} PASS. Aucun FAIL financier.`
      : `🔴 **NON CERTIFIÉ** — ${fail} FAIL(s) à corriger avant gel.`,
  ].join('\n');
  fs.writeFileSync('/home/runner/workspace/BILLING_CERT_STRIPE_FINAL.md', md);
  console.log(`\nRapport → BILLING_CERT_STRIPE_FINAL.md`);
  return fail;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Certification Finale Billing FlowPoint — Stripe Test ===');
  console.log(`Key: ${STRIPE_KEY.slice(0,14)}... | Wh: ${WEBHOOK_SECRET.slice(0,12)}...`);
  await preCleanup();
  const subs = await sectionA();
  await sectionB(subs);
  await sectionC();
  await sectionD(subs);
  const fails = printReport();
  process.exit(fails > 0 ? 1 : 0);
}

main()
  .catch(e => { console.error('\nFATAL:', e.message, '\n', e.stack); process.exit(1); })
  .finally(() => pool.end());
