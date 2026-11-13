#!/usr/bin/env node
/**
 * E2E isole — essai 14 jours sans carte (TRIAL_WITHOUT_CARD).
 *
 * A lancer UNIQUEMENT contre un PostgreSQL jetable et un serveur API local :
 *   E2E_BASE_URL=http://127.0.0.1:38123 \
 *   DATABASE_URL=postgres://postgres@127.0.0.1:55432/flowpoint_e2e \
 *   STRIPE_WEBHOOK_SECRET=whsec_... (le MEME secret de test que le serveur) \
 *   node scripts/e2e-trial-without-card.mjs
 *
 * Le serveur doit tourner avec TRIAL_WITHOUT_CARD=true et une cle sk_test_
 * (jamais sk_live_). Stripe est simule au niveau HTTP : les webhooks sont
 * signes localement avec le secret de test, aucun appel n'atteint un compte
 * Stripe. Le script refuse de tourner si DATABASE_URL ne vise pas localhost.
 */
import crypto from "node:crypto";
import pg from "pg";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:38123";
const DB_URL = process.env.DATABASE_URL ?? "";
const WH_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error("DATABASE_URL doit viser une base LOCALE jetable"); process.exit(2); }
if (!WH_SECRET.startsWith("whsec_")) { console.error("STRIPE_WEBHOOK_SECRET de test requis"); process.exit(2); }
if (String(process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_")) { console.error("cle live interdite"); process.exit(2); }

const db = new pg.Pool({ connectionString: DB_URL });
const q = async (sql, v = []) => (await db.query(sql, v)).rows;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RUN = Date.now().toString(36);
const FP_LID = crypto.randomBytes(16).toString("base64url").slice(0, 22);
let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = "") {
  (cond ? pass++ : fail++);
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
let ipN = 0;
async function api(method, path, { body, token, raw, headers = {}, sameIp = false } = {}) {
  // Chaque inscription vient d'une IP distincte (X-Forwarded-For), sauf le test
  // du rate limit : sinon trialSignupRateLimit (5/h/IP) bloquerait le scenario.
  if (path === "/api/auth/trial-signup" && !sameIp) headers = { "X-Forwarded-For": `10.77.${(++ipN) >> 8}.${ipN & 255}`, ...headers };
  const r = await fetch(BASE + path, {
    method, redirect: "manual",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  let json = null; try { json = await r.json(); } catch { /* */ }
  return { status: r.status, body: json };
}
async function login(email) {
  const [tok] = await q(`SELECT token FROM magic_link_tokens WHERE email=$1 AND used=FALSE ORDER BY expires_at DESC LIMIT 1`, [email]);
  if (!tok) return null;
  const r = await api("POST", "/api/auth/login-verify", { body: { token: tok.token } });
  return r.body?.token ?? null;
}
let evtN = 0;
async function webhook(type, object, extra = {}) {
  const event = { id: `evt_e2e_${RUN}_${++evtN}`, object: "event", type, livemode: false,
    created: Math.floor(Date.now() / 1000), data: { object, ...extra }, api_version: "2026-04-22.dahlia" };
  return sendEvent(event);
}
async function sendEvent(event) {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", WH_SECRET).update(`${t}.${payload}`).digest("hex");
  const r = await api("POST", "/api/webhooks/stripe", { raw: payload, headers: { "Stripe-Signature": `t=${t},v1=${sig}` } });
  return { ...r, event };
}
const orgOf = async email => (await q(`SELECT * FROM organizations WHERE owner_email=$1`, [email]))[0];

const PHASE = process.env.E2E_PHASE ?? "flag-on";
const STATE_FILE = process.env.E2E_STATE_FILE ?? "";
const MAIL_DIR = process.env.TEST_MAIL_DIR ?? "";
const ADMIN_KEY = process.env.ADMIN_KEY ?? "";
const { readFileSync, writeFileSync, readdirSync } = await import("node:fs");
const mails = () => MAIL_DIR ? readdirSync(MAIL_DIR).filter(f => f.endsWith(".json"))
  .map(f => JSON.parse(readFileSync(`${MAIL_DIR}/${f}`, "utf8"))) : [];

if (PHASE === "flag-off") {
  // Serveur relance SANS TRIAL_WITHOUT_CARD : plus de creation, protections intactes.
  const st = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  let rr = await api("POST", "/api/auth/trial-signup", { body: { firstName: "Z", email: `off.${RUN}@off-${RUN}.fr` } });
  check("drapeau OFF : nouvelle inscription sans carte → 404 + redirection parcours carte",
    rr.status === 404 && rr.body?.redirectTo === "/signin.html", JSON.stringify(rr.body));
  const [{ n: nOff }] = await q(`SELECT COUNT(*)::int AS n FROM organizations WHERE owner_email=$1`, [`off.${RUN}@off-${RUN}.fr`]);
  check("drapeau OFF : aucune organisation creee", nOff === 0);
  rr = await api("GET", "/api/auth/providers");
  check("drapeau OFF : /auth/providers → trialWithoutCard=false (signin.html reste sur le parcours carte)", rr.body?.trialWithoutCard === false);
  rr = await api("POST", "/api/ai/chat", { token: st.tokenA, body: { message: "x" } });
  check("drapeau OFF : essai sans carte expire existant → POST /api/ai/chat 402 TRIAL_EXPIRED", rr.status === 402 && rr.body?.code === "TRIAL_EXPIRED", `status ${rr.status}`);
  rr = await api("POST", "/api/billing/upgrade", { token: st.tokenA, body: { plan: "pro" } });
  check("drapeau OFF : paiement toujours ouvert", rr.body?.code !== "TRIAL_EXPIRED", `status ${rr.status}`);
  const [mon] = await q(`SELECT last_check FROM monitors WHERE id=$1`, [st.monitor]);
  check("drapeau OFF : moniteur de l'org expiree non verifie par le cron", String(mon?.last_check) === String(st.monitorLastCheck), String(mon?.last_check));
  const [ctl] = await q(`SELECT last_check FROM monitors WHERE id=$1`, [st.ctrlMonitor]);
  check("drapeau OFF : moniteur de l'org temoin verifie", String(ctl?.last_check) !== String(st.ctrlLastCheck));
  const [aud] = await q(`SELECT last_run FROM audit_schedules WHERE id=$1`, [st.auditExp]);
  check("drapeau OFF : audit planifie de l'org expiree non lance", aud?.last_run === null);
  const [org] = await q(`SELECT trial_expired_notified_at FROM organizations WHERE id=$1`, [st.orgExpired]);
  check("drapeau OFF : passe d'expiration traitee (trial_expired_notified_at pose)", !!org?.trial_expired_notified_at);
  const m = mails().filter(x => x.tag === "trial_expired" && x.to === st.emailA);
  check("drapeau OFF : email « essai termine » capture (transport de test) pour le bon destinataire", m.length === 1, JSON.stringify(m[0] ?? {}));
  const [{ n: nFunnel }] = await q(`SELECT COUNT(*)::int AS n FROM funnel_events WHERE etape='trial_expired' AND cle_idempotence=$1`, [`trial_expired:cardless:${st.orgExpired}`]);
  check("drapeau OFF : jalon funnel trial_expired enregistre une fois", nFunnel === 1);
  console.log(results.join("\n"));
  console.log(`\nE2E HTTP (drapeau OFF) : ${pass} PASS / ${fail} FAIL`);
  await db.end();
  process.exit(fail ? 1 : 0);
}

// ── 1. Inscription sans carte ────────────────────────────────────────────────
const A = `lead.${RUN}@agence-${RUN}.fr`;
let r = await api("POST", "/api/auth/trial-signup", { body: { firstName: "Léa", email: A, fp_lid: FP_LID } });
check("inscription sans carte → 200", r.status === 200, JSON.stringify(r.body));
let orgA = await orgOf(A);
check("org trialing, plan standard, aucun objet Stripe", orgA?.subscription_status === "trialing" && orgA?.plan === "standard"
  && !orgA?.stripe_customer_id && !orgA?.stripe_subscription_id && !!orgA?.trial_consumed_at);
const days = (new Date(orgA.trial_ends_at) - new Date(orgA.trial_started_at)) / 86400000;
check("trial_ends_at = debut + 14 j", Math.abs(days - 14) < 0.001, `${days}`);
check("fp_lid propage pending_signups → organizations", orgA?.fp_lid === FP_LID);
const [pend] = await q(`SELECT fp_lid, consumed_at FROM pending_signups WHERE email=$1`, [A]);
check("pending_signups consomme avec fp_lid", pend?.fp_lid === FP_LID && !!pend?.consumed_at);
const [osA] = await q(`SELECT trial_consumed_at FROM org_settings WHERE org_id=$1`, [orgA.id]);
check("org_settings.trial_consumed_at pose (le webhook ne verra pas un 1er essai)", !!osA?.trial_consumed_at);

// ── 2. Second essai ──────────────────────────────────────────────────────────
r = await api("POST", "/api/auth/trial-signup", { body: { firstName: "Léa", email: A } });
check("meme adresse → 409", r.status === 409, r.body?.code);
r = await api("POST", "/api/auth/trial-signup", { body: { firstName: "Léa", email: A.replace("@", "+bis@") } });
check("variante +etiquette → 409 TRIAL_ALREADY_USED_EMAIL", r.body?.code === "TRIAL_ALREADY_USED_EMAIL");
const G = `gmail.e2e.${RUN}@gmail.com`;
r = await api("POST", "/api/auth/trial-signup", { body: { firstName: "G", email: G } });
const gVariant = `gmaile2e${RUN}+x@googlemail.com`;
r = await api("POST", "/api/auth/trial-signup", { body: { firstName: "G", email: gVariant } });
check("variante Gmail (points, +tag, googlemail) → 409", r.body?.code === "TRIAL_ALREADY_USED_EMAIL", gVariant);
// Domaine : 3 essais / 30 j → le 4e est refuse
for (const who of ["b", "c"]) {
  r = await api("POST", "/api/auth/trial-signup", { body: { firstName: who, email: `${who}.${RUN}@agence-${RUN}.fr` } });
  check(`collegue ${who} du meme domaine → 200 (sous le seuil)`, r.status === 200, r.body?.code);
}
r = await api("POST", "/api/auth/trial-signup", { body: { firstName: "d", email: `d.${RUN}@agence-${RUN}.fr` } });
check("4e essai du domaine en 30 j → 409 TRIAL_DOMAIN_LIMIT", r.body?.code === "TRIAL_DOMAIN_LIMIT");
// Deblocage administrateur : +1 essai pour ce domaine, avec auteur, motif, echeance
r = await api("POST", "/api/admin/trial-domain-exceptions", { body: { domain: `agence-${RUN}.fr`, extraTrials: 1,
  expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), reason: "salon e2e", actor: "e2e-admin" } });
check("exception admin sans x-admin-key → 403", r.status === 403);
r = await api("POST", "/api/admin/trial-domain-exceptions", { headers: { "x-admin-key": ADMIN_KEY }, body: { domain: `agence-${RUN}.fr`, extraTrials: 1,
  expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), reason: "salon e2e", actor: "e2e-admin" } });
check("exception admin creee (201)", r.status === 201, JSON.stringify(r.body?.error ?? ""));
const excId = r.body?.exception?.id;
r = await api("POST", "/api/auth/trial-signup", { body: { firstName: "d", email: `d.${RUN}@agence-${RUN}.fr` } });
check("avec exception active : 4e essai du domaine accepte", r.status === 200, r.body?.code);
r = await api("POST", "/api/auth/trial-signup", { body: { firstName: "e", email: `e.${RUN}@agence-${RUN}.fr` } });
check("quota de l'exception epuise : 5e essai refuse", r.body?.code === "TRIAL_DOMAIN_LIMIT");
r = await api("POST", "/api/auth/trial-signup", { body: { firstName: "d", email: `d+2.${RUN}@agence-${RUN}.fr`.replace(`d+2.${RUN}`, `d.${RUN}+2`) } });
check("exception active : jamais de second essai pour la meme boite (+tag)", r.body?.code === "TRIAL_ALREADY_USED_EMAIL", r.body?.code);
const audit = await q(`SELECT action, actor FROM trial_domain_exception_audit WHERE exception_id=$1`, [excId]);
check("piste d'audit : creation par e2e-admin", audit.length === 1 && audit[0].action === "create" && audit[0].actor === "e2e-admin");
r = await api("POST", `/api/admin/trial-domain-exceptions/${excId}/revoke`, { headers: { "x-admin-key": ADMIN_KEY }, body: { actor: "e2e-admin", reason: "fin du salon" } });
check("revocation admin + audit", r.status === 200 && (await q(`SELECT 1 FROM trial_domain_exception_audit WHERE exception_id=$1 AND action='revoke'`, [excId])).length === 1);

// ── 3. Connexion et acces pendant l'essai ───────────────────────────────────
const tokenA = await login(A);
check("connexion par lien magique", !!tokenA);
const actMail = mails().filter(x => x.tag === "activation_magic_link" && x.to === A);
check("email d'activation capture (transport de test) : bon destinataire, sujet « essai … prêt », jeton present",
  actMail.length === 1 && /essai FlowPoint Standard est prêt/.test(actMail[0].subject) && /^[a-f0-9]{64}$/.test(actMail[0].token ?? ""));
r = await api("GET", "/api/me", { token: tokenA });
check("/api/me pendant l'essai : trialing + acces premium", r.body?.subscriptionStatus === "trialing" && r.body?.hasPremiumAccess === true);
r = await api("POST", "/api/ai/chat", { token: tokenA, body: { message: "bonjour" } });
check("pendant l'essai : /api/ai/chat n'est PAS bloque par le garde", r.body?.code !== "TRIAL_EXPIRED", `status ${r.status}`);

// ── 4. Expiration simulee ────────────────────────────────────────────────────
await q(`UPDATE organizations SET trial_ends_at = NOW() - INTERVAL '1 minute' WHERE id=$1`, [orgA.id]);
await sleep(31_000); // cache du garde : 30 s
r = await api("GET", "/api/me", { token: tokenA });
check("/api/me apres echeance : none + mustCompleteBilling", r.body?.subscriptionStatus === "none" && r.body?.mustCompleteBilling === true, r.body?.subscriptionStatus);
r = await api("POST", "/api/ai/chat", { token: tokenA, body: { message: "bonjour" } });
check("apres echeance : POST /api/ai/chat → 402 TRIAL_EXPIRED", r.status === 402 && r.body?.code === "TRIAL_EXPIRED", `status ${r.status}`);
r = await api("GET", "/api/seo/overview", { token: tokenA });
check("apres echeance : GET /api/seo/* → 402 TRIAL_EXPIRED", r.status === 402 && r.body?.code === "TRIAL_EXPIRED", `status ${r.status}`);
r = await api("POST", "/api/audits", { token: tokenA, body: { url: "https://example.com" } });
check("apres echeance : POST /api/audits → 402 TRIAL_EXPIRED", r.status === 402 && r.body?.code === "TRIAL_EXPIRED", `status ${r.status}`);
r = await api("POST", "/api/billing/upgrade", { token: tokenA, body: { plan: "pro" } });
check("apres echeance : POST /api/billing/upgrade reste ouvert (pas de 402 TRIAL_EXPIRED)", r.body?.code !== "TRIAL_EXPIRED", `status ${r.status} ${r.body?.error ?? ""}`);
r = await api("PATCH", "/api/me/prefs", { token: tokenA, body: { pinned: [] } });
check("apres echeance : PATCH /api/me/prefs reste ouvert", r.body?.code !== "TRIAL_EXPIRED", `status ${r.status}`);
r = await api("GET", "/api/me", { token: tokenA });
check("apres echeance : GET /api/me reste ouvert", r.status === 200);

// Taches planifiees : un moniteur et un audit planifie dus, sur l'org expiree
await q(`INSERT INTO monitors (id, org_id, name, url, status, frequency, last_check, enabled)
         VALUES ($1,$2,'e2e',$3,'up','5', (NOW() - INTERVAL '2 hours')::text, TRUE)`,
  [`mon_e2e_${RUN}`, orgA.id, `${BASE}/api/health`]).catch(e => check("insertion moniteur", false, e.message));

// ── 5. Paiement pendant l'essai : webhooks sur une org issue de l'essai sans carte ──
const B = `pay.${RUN}@payeur-${RUN}.fr`;
await api("POST", "/api/auth/trial-signup", { body: { firstName: "Paul", email: B } });
let orgB = await orgOf(B);
const trialEndB = Math.floor(new Date(orgB.trial_ends_at).getTime() / 1000);
const before = { ends: orgB.trial_ends_at.toISOString(), started: orgB.trial_started_at.toISOString(), consumed: orgB.trial_consumed_at.toISOString() };
const cus = `cus_e2e_${RUN}`, sub = `sub_e2e_${RUN}`;
const subObj = (status, extra = {}) => ({ id: sub, object: "subscription", customer: cus, status, trial_end: trialEndB,
  metadata: { plan: "pro", orgId: orgB.id, reactivation: "true" },
  items: { data: [{ id: "si_e2e", price: { id: "price_e2e_pro", recurring: { interval: "month" } }, quantity: 1 }] }, ...extra });

let w = await webhook("checkout.session.completed", { id: `cs_e2e_${RUN}`, object: "checkout.session", mode: "subscription",
  customer: cus, subscription: sub, status: "complete", payment_status: "no_payment_required",
  metadata: { plan: "pro", targetPlan: "pro", orgId: orgB.id, reactivation: "true" } });
check("webhook checkout.session.completed accepte", w.status === 200, `status ${w.status}`);
w = await webhook("customer.subscription.created", subObj("trialing"));
check("webhook customer.subscription.created accepte", w.status === 200, `status ${w.status}`);
orgB = await orgOf(B);
check("apres checkout + sub.created : customer et abonnement ancres", orgB.stripe_customer_id === cus && orgB.stripe_subscription_id === sub);
check("trial_ends_at / trial_started_at / trial_consumed_at NON reecrits",
  orgB.trial_ends_at.toISOString() === before.ends && orgB.trial_started_at.toISOString() === before.started
  && orgB.trial_consumed_at.toISOString() === before.consumed,
  `${orgB.trial_ends_at.toISOString()} vs ${before.ends}`);
check("statut trialing (essai Stripe jusqu'a la meme echeance)", orgB.subscription_status === "trialing", orgB.subscription_status);
const replay = await sendEvent(w.event);
const [{ n: nEvt }] = await q(`SELECT COUNT(*)::int AS n FROM billing_events WHERE stripe_event_id=$1`, [w.event.id]);
check("rejeu du meme evenement : idempotent (1 seule ligne billing_events)", replay.status === 200 && nEvt === 1, `rows=${nEvt}`);
w = await webhook("customer.subscription.updated", subObj("active"), { previous_attributes: { status: "trialing" } });
orgB = await orgOf(B);
check("sub.updated active : statut active, trial_ends_at inchange", orgB.subscription_status === "active" && orgB.trial_ends_at.toISOString() === before.ends, orgB.subscription_status);
w = await webhook("invoice.payment_failed", { id: `in_e2e_${RUN}`, object: "invoice", customer: cus, subscription: sub, attempt_count: 1 });
orgB = await orgOf(B);
check("invoice.payment_failed : past_due, trial_ends_at inchange", orgB.subscription_status === "past_due" && orgB.trial_ends_at.toISOString() === before.ends, orgB.subscription_status);
w = await webhook("customer.subscription.deleted", subObj("canceled"));
orgB = await orgOf(B);
check("sub.deleted : canceled, trial_ends_at inchange", orgB.subscription_status === "canceled" && orgB.trial_ends_at.toISOString() === before.ends, orgB.subscription_status);
const [{ n: nOrgB }] = await q(`SELECT COUNT(*)::int AS n FROM organizations WHERE owner_email=$1`, [B]);
check("aucune organisation en double", nOrgB === 1);
// La passe de relance (retryLifecycleEmails) n'envoie que si sent_at IS NULL.
const [{ n: nTrialMail }] = await q(`SELECT COUNT(*)::int AS n FROM organizations WHERE id=$1
  AND trial_started_email_eligible_at IS NOT NULL AND trial_started_email_sent_at IS NULL`, [orgB.id]);
check("aucun email « essai demarre » en attente apres le webhook (sent_at pose a l'inscription)", nTrialMail === 0);
// Le garde ne bloque pas une org qui a paye
const tokenB = await login(B);
await q(`UPDATE organizations SET subscription_status='active', trial_ends_at = NOW() - INTERVAL '1 day' WHERE id=$1`, [orgB.id]);
r = await api("POST", "/api/ai/chat", { token: tokenB, body: { message: "x" } });
check("org payee, echeance passee : jamais TRIAL_EXPIRED", r.body?.code !== "TRIAL_EXPIRED", `status ${r.status}`);

// ── 6. Rate limit IP (meme IP, rafale) ──────────────────────────────────────
let got429 = false;
for (let i = 0; i < 7; i++) {
  const rr = await api("POST", "/api/auth/trial-signup", { sameIp: true, headers: { "X-Forwarded-For": "10.99.99.99" },
    body: { firstName: "R", email: `rl${i}.${RUN}@rl-${i}-${RUN}.fr` } });
  if (rr.status === 429) { got429 = true; break; }
}
check("rafale depuis une meme IP → 429", got429);

// Etat pour la phase « drapeau OFF » (le serveur sera relance sans le drapeau).
if (STATE_FILE) {
  await q(`INSERT INTO monitors (id, org_id, name, url, status, frequency, last_check, enabled)
           VALUES ($1,$2,'ctrl',$3,'up','5',(NOW() - INTERVAL '2 hours')::text, TRUE)`, [`mon_ctrl_${RUN}`, orgB.id, `${BASE}/api/health`]);
  await q(`UPDATE organizations SET subscription_status='active', stripe_subscription_id='sub_ctrl' WHERE id=$1`, [orgB.id]);
  await q(`INSERT INTO audit_schedules (id,url,frequency,next_run,enabled,org_id) VALUES ($1,'https://example.invalid','weekly',NOW() - INTERVAL '1 hour',TRUE,$2)`, [`as_exp_${RUN}`, orgA.id]);
  const [m1] = await q(`SELECT last_check FROM monitors WHERE id=$1`, [`mon_e2e_${RUN}`]);
  const [m2] = await q(`SELECT last_check FROM monitors WHERE id=$1`, [`mon_ctrl_${RUN}`]);
  writeFileSync(STATE_FILE, JSON.stringify({ tokenA, emailA: A, orgExpired: orgA.id, monitor: `mon_e2e_${RUN}`, monitorLastCheck: m1?.last_check,
    ctrlMonitor: `mon_ctrl_${RUN}`, ctrlLastCheck: m2?.last_check, auditExp: `as_exp_${RUN}` }));
}

console.log(results.join("\n"));
console.log(`\nE2E HTTP : ${pass} PASS / ${fail} FAIL`);
console.log(JSON.stringify({ orgExpired: orgA.id, monitor: `mon_e2e_${RUN}` }));
await db.end();
process.exit(fail ? 1 : 0);
