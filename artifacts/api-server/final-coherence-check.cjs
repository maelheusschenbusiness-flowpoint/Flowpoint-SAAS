/**
 * final-coherence-check.cjs
 * Stripe → webhook → DB → /api/me → entitlement, with reconnection simulation.
 * 3 blocs : Plan, Add-on, Crédits IA.
 */
'use strict';
const Stripe   = require('./node_modules/stripe');
const { Pool } = require('./node_modules/pg');
const crypto   = require('crypto');
const http     = require('http');
const fs       = require('fs');

const STRIPE_KEY     = process.env.STRIPE_TEST_KEY;
const WH_SECRET      = process.env.STRIPE_TEST_WEBHOOK_SECRET;
if (!STRIPE_KEY || !WH_SECRET) { console.error('FATAL: missing env vars'); process.exit(1); }

const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2026-04-22.dahlia' });
const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const IDS    = JSON.parse(fs.readFileSync('/tmp/stripe-cert-ids.json', 'utf8'));

// ── helpers ─────────────────────────────────────────────────────────────────
function sign(body, ts) {
  return `t=${ts},v1=${crypto.createHmac('sha256', WH_SECRET).update(`${ts}.${body}`).digest('hex')}`;
}
function postWh(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const ts   = Math.floor(Date.now() / 1000);
    const req  = http.request({
      hostname:'localhost', port:8081, path:'/api/webhooks/stripe', method:'POST',
      headers:{ 'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Stripe-Signature':sign(body,ts) },
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve({s:res.statusCode,b:JSON.parse(d.trim()||'{}')})); });
    req.on('error',reject); req.write(body); req.end();
  });
}
function apiGet(path, token) {
  return new Promise((resolve,reject) => {
    const req = http.request({ hostname:'localhost',port:8081,path,method:'GET',
      headers: token ? {Authorization:`Bearer ${token}`} : {} },
      res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve({s:res.statusCode,b:JSON.parse(d)})}catch{resolve({s:res.statusCode,b:d})} }); });
    req.on('error',reject); req.end();
  });
}
async function newSession(orgId, email) {
  // Simulate reconnection: INSERT a brand new token (as if user just logged in again)
  const token = crypto.randomBytes(32).toString('hex');
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO user_sessions(token,org_id,user_id,email,role,expires_at,created_at)
       VALUES($1,$2,$3,$4,'owner',NOW()+INTERVAL'1 hour',NOW()) ON CONFLICT(token) DO NOTHING`,
      [token, orgId, email, email]
    );
  } finally { client.release(); }
  return token;
}
async function db(orgId) {
  const client = await pool.connect();
  try {
    const o = await client.query(`SELECT plan,subscription_status FROM organizations WHERE id=$1`,[orgId]);
    const a = await client.query(`SELECT addon_key,quantity FROM org_addons WHERE org_id=$1 AND active=true ORDER BY addon_key`,[orgId]);
    return { plan: o.rows[0]?.plan, status: o.rows[0]?.subscription_status, addons: a.rows };
  } finally { client.release(); }
}
function mkEvt(type, sub) {
  return { id:`evt_fc_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, object:'event', type, livemode:false, created:Math.floor(Date.now()/1000), data:{object:sub} };
}
function sleep(ms) { return new Promise(r => setTimeout(r,ms)); }

const ROWS = [];
function row(test, observed, pass) {
  ROWS.push({test, observed, pass});
  console.log(`  [${pass?'✅':'❌'}] ${test} — ${observed}`);
}

// ── BLOC 1 : Plan transitions ────────────────────────────────────────────────
async function checkPlans() {
  console.log('\n═══ BLOC 1 — Plan transitions Std→Pro→Ultra→downgrade ═══');
  const org = IDS.orgs.standard;
  // Get current live sub
  const subs = await stripe.subscriptions.list({ customer: IDS.customers.standard.customerId, status:'all', limit:5 });
  let sub = subs.data.find(s => s.status !== 'canceled');
  if (!sub) {
    // Create fresh sub
    sub = await stripe.subscriptions.create({
      customer: IDS.customers.standard.customerId, items:[{price:IDS.plans.standard.priceId}],
      trial_period_days:30, metadata:{orgId:org.id,plan:'standard',cert:'fc2026'},
    });
  }

  const transitions = [
    { label:'Std→Pro',   to:'pro'      },
    { label:'Pro→Ultra', to:'ultra'    },
    { label:'Ultra→Std', to:'standard' },
  ];
  const MON = { standard:10, pro:50, ultra:300 };
  const AUD = { standard:30, pro:300, ultra:300 };

  for (const t of transitions) {
    await sleep(800);
    const live = await stripe.subscriptions.retrieve(sub.id);
    const pItem = live.items.data.find(i => Object.values(IDS.plans).some(p => p.priceId===i.price.id));
    if (!pItem) { row(`${t.label} plan switch`, 'no plan item found', false); continue; }
    const updated = await stripe.subscriptions.update(sub.id, {
      items:[{id:pItem.id, price:IDS.plans[t.to].priceId}],
      metadata:{orgId:org.id, plan:t.to, cert:'fc2026'}, proration_behavior:'none',
    });
    const wh = await postWh(mkEvt('customer.subscription.updated', updated));
    await sleep(900);

    // DB check
    const d = await db(org.id);
    // Reconnection: new session token
    const tok = await newSession(org.id, org.email);
    const me  = await apiGet('/api/me', tok);

    const okWh   = wh.s === 200;
    const okDb   = d.plan === t.to;
    const okMe   = me.b?.plan?.toLowerCase() === t.to;
    const okMon  = (me.b?.limits?.monitors ?? me.b?.usage?.monitor?.limit) === MON[t.to];
    const okAud  = (me.b?.limits?.audits   ?? me.b?.usage?.audit?.limit)   >= AUD[t.to];
    const status = me.b?.subscriptionStatus;

    const observed = `wh=${wh.s} db=${d.plan} me=${me.b?.plan} mon=${me.b?.limits?.monitors} aud=${me.b?.limits?.audits} status=${status}`;
    row(`Plan ${t.label} (Stripe→wh→DB→me→reconnect)`, observed, okWh&&okDb&&okMe&&okMon&&okAud);
  }
}

// ── BLOC 2 : Add-ons (flag + quantitatif) ────────────────────────────────────
async function checkAddons() {
  console.log('\n═══ BLOC 2 — Addon activate/deactivate (flag + qty) ═══');
  const org = IDS.orgs.pro;
  const subs = await stripe.subscriptions.list({ customer: IDS.customers.pro.customerId, status:'all', limit:5 });
  let sub = subs.data.find(s => s.status !== 'canceled');
  if (!sub) {
    sub = await stripe.subscriptions.create({
      customer: IDS.customers.pro.customerId, items:[{price:IDS.plans.pro.priceId}],
      trial_period_days:30, metadata:{orgId:org.id,plan:'pro',cert:'fc2026'},
    });
  }

  // Reset DB addons for pro org
  const cl = await pool.connect();
  try { await cl.query(`DELETE FROM org_addons WHERE org_id=$1`,[org.id]); } finally { cl.release(); }

  // ── 2a. Activate flag addon: aiCro ─────────────────────────────────────────
  await sleep(600);
  const withFlag = await stripe.subscriptions.update(sub.id, {
    items:[{price:IDS.addons.aiCro.priceId, quantity:1, metadata:{addonKey:'aiCro',cert:'fc2026'}}],
    proration_behavior:'none', metadata:{orgId:org.id,plan:'pro',cert:'fc2026'},
  });
  const wh1 = await postWh(mkEvt('customer.subscription.updated', withFlag));
  await sleep(900);
  const tok1 = await newSession(org.id, org.email);
  const me1  = await apiGet('/api/me', tok1);
  const d1   = await db(org.id);
  const okAiCroDb = !!d1.addons.find(a=>a.addon_key==='aiCro');
  const okAiCroMe = !!me1.b?.addons?.aiCro;
  row('Addon flag aiCro activate → DB→me (reconnect)', `wh=${wh1.s} dbHas=${okAiCroDb} meHas=${okAiCroMe}`, wh1.s===200&&okAiCroDb&&okAiCroMe);

  // ── 2b. Activate qty addon: monitorsPack10 × 2 ─────────────────────────────
  await sleep(600);
  const live2 = await stripe.subscriptions.retrieve(sub.id);
  const withQty = await stripe.subscriptions.update(sub.id, {
    items:[{price:IDS.addons.monitorsPack10.priceId, quantity:2, metadata:{addonKey:'monitorsPack10',cert:'fc2026'}}],
    proration_behavior:'none', metadata:{orgId:org.id,plan:'pro',cert:'fc2026'},
  });
  const wh2 = await postWh(mkEvt('customer.subscription.updated', withQty));
  await sleep(900);
  const tok2 = await newSession(org.id, org.email);
  const me2  = await apiGet('/api/me', tok2);
  const d2   = await db(org.id);
  const qtyRow = d2.addons.find(a=>a.addon_key==='monitorsPack10');
  const okQtyDb  = Number(qtyRow?.quantity) === 2;
  // monitors = 50 (pro base) + 2×10 = 70
  const expMon   = 70;
  const gotMon   = me2.b?.limits?.monitors;
  const okQtyMe  = gotMon === expMon;
  row('Addon qty monitorsPack10×2 → DB qty=2→me monitors=70 (reconnect)',
    `wh=${wh2.s} dbQty=${qtyRow?.quantity} meMonitors=${gotMon}(exp=${expMon})`, wh2.s===200&&okQtyDb&&okQtyMe);

  // ── 2c. Deactivate both: remove items ──────────────────────────────────────
  await sleep(600);
  const live3 = await stripe.subscriptions.retrieve(sub.id);
  const toDel = live3.items.data
    .filter(i => ['aiCro','monitorsPack10'].some(k => i.metadata?.addonKey===k || i.price.id===IDS.addons[k]?.priceId))
    .map(i => ({id:i.id, deleted:true}));
  const clean = await stripe.subscriptions.update(sub.id, {
    items:toDel, proration_behavior:'none', metadata:{orgId:org.id,plan:'pro',cert:'fc2026'},
  });
  const wh3 = await postWh(mkEvt('customer.subscription.updated', clean));
  await sleep(900);
  const tok3 = await newSession(org.id, org.email);
  const me3  = await apiGet('/api/me', tok3);
  const d3   = await db(org.id);
  const aiCroGone = !d3.addons.find(a=>a.addon_key==='aiCro');
  const mpGone    = !d3.addons.find(a=>a.addon_key==='monitorsPack10');
  const monBack   = (me3.b?.limits?.monitors ?? me3.b?.usage?.monitor?.limit) === 50;
  row('Addon deactivate both → DB clean→me monitors=50 (reconnect)',
    `wh=${wh3.s} aiCroGone=${aiCroGone} mpGone=${mpGone} meMonitors=${me3.b?.limits?.monitors}`, wh3.s===200&&aiCroGone&&mpGone&&monBack);
}

// ── BLOC 3 : Crédits IA ──────────────────────────────────────────────────────
async function checkAICredits() {
  console.log('\n═══ BLOC 3 — Crédits IA 50k/200k/500k → quota → consommables ═══');
  const org = IDS.orgs.standard;
  const cus = IDS.customers.standard.customerId;

  // Clean prior purchases for clean delta
  const cl = await pool.connect();
  try { await cl.query(`DELETE FROM ai_credit_purchases WHERE org_id=$1`,[org.id]); } finally { cl.release(); }

  const tok = await newSession(org.id, org.email);
  const baseMeR = await apiGet('/api/ai/usage', tok);
  const baseExtra = Number(baseMeR.b?.extra ?? 0);
  const baseRemaining = Number(baseMeR.b?.remaining ?? 0);

  const packs = [
    { key:'aiCreditsPack50k',  credits:50000,  amount:400  },
    { key:'aiCreditsPack200k', credits:200000, amount:900  },
    { key:'aiCreditsPack500k', credits:500000, amount:1900 },
  ];

  let expectedExtra = baseExtra;
  for (const p of packs) {
    await sleep(500);
    const pi = await stripe.paymentIntents.create({
      amount:p.amount, currency:'eur', customer:cus,
      payment_method:'pm_card_visa', confirm:true,
      return_url:'https://app.flowpoint.pro/checkout-return',
      metadata:{ orgId:org.id, type:'ai_credits', pack:p.key, credits:String(p.credits), amountEurCents:String(p.amount), cert:'fc2026' },
    });
    const piObj = await stripe.paymentIntents.retrieve(pi.id);
    const evt = { id:`evt_pi_fc_${piObj.id}`, object:'event', type:'payment_intent.succeeded', livemode:false, created:Math.floor(Date.now()/1000), data:{object:piObj} };
    const wh = await postWh(evt);
    await sleep(800);
    expectedExtra += p.credits;

    // Reconnection check
    const freshTok = await newSession(org.id, org.email);
    const me = await apiGet('/api/ai/usage', freshTok);
    const extra = Number(me.b?.extra ?? 0);
    const rem   = Number(me.b?.remaining ?? 0);
    const okWh  = wh.s === 200;
    const okEx  = extra === expectedExtra;
    const okRem = rem >= extra;  // remaining ≥ extra (since used=0)
    row(`AI credits ${p.key} wh→quota (reconnect)`,
      `wh=${wh.s} extra=${extra}(exp=${expectedExtra}) remaining=${rem}`, okWh&&okEx&&okRem);
  }

  // Final state: extra should be 750k, remaining ≥ 750k
  const finalTok = await newSession(org.id, org.email);
  const finalMe  = await apiGet('/api/ai/usage', finalTok);
  const finalExtra = Number(finalMe.b?.extra ?? 0);
  const finalRem   = Number(finalMe.b?.remaining ?? 0);
  const okFinal = finalExtra === 750000 && finalRem >= 750000;
  row('AI credits total 750k → remaining ≥ 750k (consommables)',
    `extra=${finalExtra} remaining=${finalRem} limit=${finalMe.b?.limit}`, okFinal);
}

// ── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Vérification finale cohérence Billing ===\n');
  await checkPlans();
  await checkAddons();
  await checkAICredits();

  console.log('\n\n' + '─'.repeat(110));
  console.log('Test'.padEnd(65) + 'Résultat observé'.padEnd(35) + 'RÉSULTAT');
  console.log('─'.repeat(110));
  let pass=0, fail=0;
  for (const r of ROWS) {
    const truncObs = r.observed.length > 33 ? r.observed.slice(0,30)+'...' : r.observed;
    console.log(r.test.slice(0,63).padEnd(65) + truncObs.padEnd(35) + (r.pass?'PASS':'FAIL'));
    if (r.pass) pass++; else fail++;
  }
  console.log('─'.repeat(110));
  console.log(`${pass+fail} tests | ✅ ${pass} PASS | ❌ ${fail} FAIL`);
  if (fail === 0) console.log('\n🟢 BILLING VALIDÉ ET GELÉ');
  else            console.log(`\n🔴 ${fail} problème(s) à corriger`);
  process.exit(fail > 0 ? 1 : 0);
}

main()
  .catch(e => { console.error('\nFATAL:', e.message, '\n', e.stack); process.exit(1); })
  .finally(() => pool.end());
