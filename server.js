/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         FLOWPOINT — Backend API (Node.js / Express)         ║
 * ║  JWT auth · bcrypt · MongoDB (Mongoose) · Stripe · OpenAI  ║
 * ║  Resend emails · Quotas · Activité · Missions · Monitors   ║
 * ║                                                              ║
 * ║  CORRECTIONS v1.1 :                                         ║
 * ║   [1] Reset password : token stocké en DB + expiry 1h      ║
 * ║   [2] SSE : /api/activity/events + /api/billing/events      ║
 * ║   [3] Monitor checks-summary : vraies données MonitorCheck  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * INSTALLATION :
 *   npm install
 *   cp .env.example .env   (puis remplir les valeurs)
 *   node server.js
 *
 * VARIABLES D'ENVIRONNEMENT REQUISES : voir .env.example
 */

'use strict';

const express      = require('express');
const mongoose     = require('mongoose');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors         = require('cors');
const crypto       = require('crypto');
const Stripe       = require('stripe');
const { Resend }   = require('resend');
require('dotenv').config();

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT              = process.env.PORT || 3001;
const MONGO_URI         = process.env.MONGO_URI || 'mongodb://localhost:27017/flowpoint';
const JWT_SECRET        = process.env.JWT_SECRET || 'changeme_at_least_32_chars_long!!';
const OPENAI_KEY        = process.env.OPENAI_API_KEY || '';
const STRIPE_KEY        = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const RESEND_KEY        = process.env.RESEND_API_KEY || '';
const FRONTEND_URL      = process.env.FRONTEND_URL || 'http://localhost:3000';

const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY, { apiVersion: '2024-04-10' }) : null;
const resend = RESEND_KEY ? new Resend(RESEND_KEY) : null;

const PLAN_LIMITS = {
  standard: { audit: 50,     monitor: 5,   pdf: 10,     exports: 5,      aiCredits: 20  },
  pro:      { audit: 300,    monitor: 50,  pdf: 100,    exports: 50,     aiCredits: 100 },
  ultra:    { audit: 999999, monitor: 200, pdf: 999999, exports: 999999, aiCredits: 500 },
};

const STRIPE_PRICES = {
  standard: process.env.STRIPE_PRICE_STANDARD || 'price_standard_monthly',
  pro:      process.env.STRIPE_PRICE_PRO      || 'price_pro_monthly',
  ultra:    process.env.STRIPE_PRICE_ULTRA    || 'price_ultra_monthly',
};

// ─── MongoDB Schemas ──────────────────────────────────────────────────────────

const { Schema, model } = mongoose;

const UserSchema = new Schema({
  email:               { type: String, required: true, unique: true, lowercase: true },
  passwordHash:        { type: String, required: true },
  firstName:           { type: String, required: true },
  plan:                { type: String, enum: ['standard','pro','ultra'], default: 'standard' },
  role:                { type: String, enum: ['owner','manager','viewer'], default: 'owner' },
  org:                 { name: String },
  subscriptionStatus:  { type: String, enum: ['trial','active','past_due','canceled'], default: 'trial' },
  trialEndsAt:         { type: Date, default: () => new Date(Date.now() + 14*86400000) },
  stripeCustomerId:    String,
  stripeSubscriptionId: String,
  aiCredits:           { used: { type: Number, default: 0 }, limit: Number, resetAt: Date },
  usage: {
    audit:   { used: { type: Number, default: 0 }, limit: Number },
    pdf:     { used: { type: Number, default: 0 }, limit: Number },
    exports: { used: { type: Number, default: 0 }, limit: Number },
    monitor: { used: { type: Number, default: 0 }, limit: Number },
  },
  addons: {
    whiteLabel:       { type: Boolean, default: false },
    prioritySupport:  { type: Boolean, default: false },
    customDomain:     { type: Boolean, default: false },
    extraSeats:       { type: Number, default: 0 },
    monitorsPack50:   { type: Number, default: 0 },
  },
  // ── FIX [1] : champs reset password ──────────────────────────
  resetToken:         { type: String, default: null },
  resetTokenExpires:  { type: Date,   default: null },
}, { timestamps: true });

const AuditSchema = new Schema({
  userId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
  url:      { type: String, required: true },
  score:    Number,
  status:   { type: String, enum: ['ok','warn','error'] },
  speed:    Number,
  issues:   Number,
  origin:   { type: String, enum: ['manual','scheduled','auto'], default: 'manual' },
  archived: { type: Boolean, default: false },
  date:     { type: Date, default: Date.now },
}, { timestamps: true });

const MonitorSchema = new Schema({
  userId:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name:       String,
  url:        { type: String, required: true },
  status:     { type: String, enum: ['up','down','warn'], default: 'up' },
  uptime:     { type: Number, default: 100 },
  latency:    { type: Number, default: 0 },
  lastCheck:  Date,
  alertEmail: String,
  alertPhone: String,
  isCritical: { type: Boolean, default: false },
  frequency:  { type: Number, default: 5 },
}, { timestamps: true });

const MonitorCheckSchema = new Schema({
  monitorId:  { type: Schema.Types.ObjectId, ref: 'Monitor', required: true },
  ok:         Boolean,
  latency:    Number,
  statusCode: Number,
  checkedAt:  { type: Date, default: Date.now },
}, { timestamps: true });

const MissionSchema = new Schema({
  userId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title:    String,
  category: { type: String, enum: ['Audits','Local SEO','Monitoring','Rapports','Contenu','Croissance'] },
  impact:   { type: String, enum: ['Élevé','Très élevé','Moyen'] },
  status:   { type: String, enum: ['todo','inprogress','done'], default: 'todo' },
  date:     { type: Date, default: Date.now },
  steps:    [{ id: String, text: String, done: { type: Boolean, default: false }, tag: String }],
}, { timestamps: true });

const ReportSchema = new Schema({
  userId:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name:         String,
  type:         { type: String, enum: ['PDF','CSV'], default: 'PDF' },
  date:         { type: Date, default: Date.now },
  pages:        { type: Number, default: 4 },
  shared:       { type: Boolean, default: false },
  shareUrl:     String,
  shareToken:   String,
  auditId:      { type: Schema.Types.ObjectId, ref: 'Audit' },
  whiteLabel:   { type: Boolean, default: false },
  meetingNotes: String,
  dateStart:    Date,
  dateEnd:      Date,
  pdfReady:     { type: Boolean, default: true },
}, { timestamps: true });

const TeamMemberSchema = new Schema({
  orgId:  { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name:   String,
  email:  { type: String, required: true },
  role:   { type: String, enum: ['owner','manager','viewer'], default: 'viewer' },
  status: { type: String, enum: ['active','invited','inactive'], default: 'invited' },
  joined: { type: Date, default: Date.now },
}, { timestamps: true });

const ActivityEventSchema = new Schema({
  userId:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
  userName:   String,
  type:       { type: String, enum: ['audit','monitor','report','mission','alert','team'] },
  label:      String,
  targetId:   Schema.Types.ObjectId,
  targetType: String,
  metadata:   { type: Schema.Types.Mixed, default: {} },
  createdAt:  { type: Date, default: Date.now },
}, { timestamps: true });

const AlertRuleSchema = new Schema({
  userId:      { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name:        String,
  type:        { type: String, enum: ['score','uptime','latency'] },
  operator:    { type: String, enum: ['lt','gt'] },
  threshold:   Number,
  durationMin: { type: Number, default: 0 },
  channels:    [{ type: String }],
  siteUrls:    [{ type: String }],
  enabled:     { type: Boolean, default: true },
}, { timestamps: true });

const AlertEventSchema = new Schema({
  userId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
  ruleId:   { type: Schema.Types.ObjectId, ref: 'AlertRule' },
  type:     String,
  message:  String,
  severity: { type: String, enum: ['info','warn','error'] },
  resolved: { type: Boolean, default: false },
  siteUrl:  String,
}, { timestamps: true });

const AuditScheduleSchema = new Schema({
  userId:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
  url:       { type: String, required: true },
  frequency: { type: String, enum: ['daily','weekly','monthly'] },
  nextRun:   Date,
  lastRun:   Date,
  enabled:   { type: Boolean, default: true },
}, { timestamps: true });

const AIUsageSchema = new Schema({
  userId:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
  action:     { type: String, enum: ['chat','audit','report','analysis'] },
  tokensUsed: Number,
  cost:       Number,
  createdAt:  { type: Date, default: Date.now },
}, { timestamps: true });

// Models
const User          = model('User', UserSchema);
const Audit         = model('Audit', AuditSchema);
const Monitor       = model('Monitor', MonitorSchema);
const MonitorCheck  = model('MonitorCheck', MonitorCheckSchema);
const Mission       = model('Mission', MissionSchema);
const Report        = model('Report', ReportSchema);
const TeamMember    = model('TeamMember', TeamMemberSchema);
const ActivityEvent = model('ActivityEvent', ActivityEventSchema);
const AlertRule     = model('AlertRule', AlertRuleSchema);
const AlertEvent    = model('AlertEvent', AlertEventSchema);
const AuditSchedule = model('AuditSchedule', AuditScheduleSchema);
const AIUsage       = model('AIUsage', AIUsageSchema);

// ─── SSE registries ──────────────────────────────────────────────────────────
// FIX [2] : stockage des clients SSE par userId

const sseActivityClients  = new Map(); // userId → Set<res>
const sseBillingClients   = new Map(); // userId → Set<res>

function sseAdd(map, userId, res) {
  if (!map.has(userId)) map.set(userId, new Set());
  map.get(userId).add(res);
}
function sseRemove(map, userId, res) {
  map.get(userId)?.delete(res);
}
function sseBroadcast(map, userId, event, data) {
  const clients = map.get(userId);
  if (!clients || clients.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => { try { res.write(payload); } catch (_) {} });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toDoc(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject({ virtuals: true }) : { ...doc };
  o.id = String(o._id);
  delete o._id;
  delete o.__v;
  // Ne jamais exposer les champs sensibles
  delete o.passwordHash;
  delete o.resetToken;
  delete o.resetTokenExpires;
  return o;
}
function toDocs(arr) { return (arr || []).map(toDoc); }

function simScore(url) {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = ((h << 5) - h) + url.charCodeAt(i);
  const s = Math.abs(h) % 100;
  const score  = 40 + (s % 56);
  const speed  = 35 + ((s * 7) % 60);
  const issues = Math.max(1, 25 - Math.floor(score / 5));
  return { score, speed, issues };
}
function scoreStatus(s) { return s >= 70 ? 'ok' : s >= 45 ? 'warn' : 'error'; }

function calcNextRun(freq) {
  const d = new Date();
  if (freq === 'daily')        d.setDate(d.getDate() + 1);
  else if (freq === 'weekly')  d.setDate(d.getDate() + 7);
  else                         d.setMonth(d.getMonth() + 1);
  return d;
}

// Seed déterministe pour les sparklines (pas de Math.random pur)
function seededInt(seed, min, max) {
  const x = Math.sin(seed + 1) * 10000;
  return min + Math.floor((x - Math.floor(x)) * (max - min + 1));
}

async function sendEmail(to, subject, html) {
  if (!resend) { console.warn('[FP] Resend non configuré — email ignoré:', subject); return; }
  try {
    await resend.emails.send({ from: 'Flowpoint <no-reply@flowpoint.pro>', to, subject, html });
  } catch (e) { console.warn('[FP] Email error:', e.message); }
}

async function logActivity(userId, userName, type, label, metadata = {}) {
  try {
    const event = await ActivityEvent.create({ userId, userName, type, label, metadata, createdAt: new Date() });
    // Diffuse en SSE aux clients connectés
    sseBroadcast(sseActivityClients, String(userId), 'activity', toDoc(event));
  } catch (e) { console.warn('[FP] Activity log error:', e.message); }
}

async function createOnboardingData(userId) {
  const today = new Date();
  await Promise.all([
    Mission.create({ userId, title: 'Lancer votre premier audit SEO', category: 'Audits', impact: 'Élevé', status: 'todo', date: today,
      steps: [{ id:'s1', text:'Entrer l\'URL d\'un site client', done:false, tag:'Démarrage' }, { id:'s2', text:'Analyser les résultats', done:false, tag:'Audit' }] }),
    Mission.create({ userId, title: 'Configurer votre premier monitor', category: 'Monitoring', impact: 'Élevé', status: 'todo', date: today,
      steps: [{ id:'s1', text:'Ajouter l\'URL à surveiller', done:false, tag:'Config' }, { id:'s2', text:'Configurer l\'email d\'alerte', done:false, tag:'Config' }] }),
    Mission.create({ userId, title: 'Créer votre première fiche Local SEO', category: 'Local SEO', impact: 'Très élevé', status: 'todo', date: today,
      steps: [{ id:'s1', text:'Compléter Google Business Profile', done:false, tag:'Local' }, { id:'s2', text:'Ajouter des photos récentes', done:false, tag:'Contenu' }] }),
    AlertRule.create({ userId, name: 'Monitor DOWN', type: 'uptime', operator: 'lt', threshold: 1, durationMin: 1, channels: ['email'], siteUrls: [], enabled: true }),
  ]);
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const token = req.cookies?.fp_token;
  if (!token) return res.status(401).json({ error: 'Non autorisé — token manquant' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

async function loadUser(req, res, next) {
  try {
    req.user = await User.findById(req.userId);
    if (!req.user) return res.status(401).json({ error: 'Utilisateur introuvable' });
    next();
  } catch {
    return res.status(401).json({ error: 'Erreur d\'authentification' });
  }
}

const auth = [requireAuth, loadUser];

// ─── App Setup ────────────────────────────────────────────────────────────────

const app = express();

app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
  methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

app.use(cookieParser());

// Stripe webhook MUST use raw body — AVANT express.json()
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.json({ received: true });
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  const obj = event.data.object;
  const customerId = obj.customer;
  if (!customerId) return res.json({ received: true });

  const user = await User.findOne({ stripeCustomerId: customerId });
  if (!user) return res.json({ received: true });

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const nickname = obj.items?.data?.[0]?.price?.nickname?.toLowerCase() || 'standard';
      const plan = ['standard','pro','ultra'].includes(nickname) ? nickname : 'standard';
      const L = PLAN_LIMITS[plan];
      user.plan = plan;
      user.subscriptionStatus = obj.status === 'trialing' ? 'trial' : 'active';
      user.stripeSubscriptionId = obj.id;
      user.usage.audit.limit   = L.audit;
      user.usage.pdf.limit     = L.pdf;
      user.usage.exports.limit = L.exports;
      user.usage.monitor.limit = L.monitor;
      user.aiCredits.limit     = L.aiCredits;
      await user.save();
      // Notifie le client SSE billing
      sseBroadcast(sseBillingClients, String(user._id), 'plan_updated', { plan, subscriptionStatus: user.subscriptionStatus });
      break;
    }
    case 'customer.subscription.deleted':
      user.plan = 'standard'; user.subscriptionStatus = 'canceled'; await user.save();
      sseBroadcast(sseBillingClients, String(user._id), 'plan_updated', { plan: 'standard', subscriptionStatus: 'canceled' });
      break;
    case 'invoice.payment_failed':
      user.subscriptionStatus = 'past_due'; await user.save();
      sseBroadcast(sseBillingClients, String(user._id), 'payment_failed', { subscriptionStatus: 'past_due' });
      break;
    case 'invoice.payment_succeeded':
      user.subscriptionStatus = 'active';
      user.usage.audit.used   = 0;
      user.usage.pdf.used     = 0;
      user.usage.exports.used = 0;
      await user.save();
      sseBroadcast(sseBillingClients, String(user._id), 'payment_succeeded', { subscriptionStatus: 'active' });
      break;
  }
  res.json({ received: true });
});

app.use(express.json());

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────

router.post('/auth/register', async (req, res) => {
  try {
    const { email, password, firstName, orgName } = req.body;
    if (!email || !password || !firstName) return res.status(400).json({ error: 'email, password et firstName requis' });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ error: 'Email déjà utilisé' });

    const passwordHash = await bcrypt.hash(password, 12);
    const L = PLAN_LIMITS.standard;
    const nextMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);

    const user = await User.create({
      email: email.toLowerCase(), passwordHash, firstName,
      plan: 'standard', role: 'owner',
      org: { name: orgName || `${firstName}'s Agency` },
      subscriptionStatus: 'trial',
      trialEndsAt: new Date(Date.now() + 14 * 86400000),
      aiCredits: { used: 0, limit: L.aiCredits, resetAt: nextMonth },
      usage: {
        audit:   { used: 0, limit: L.audit },
        pdf:     { used: 0, limit: L.pdf },
        exports: { used: 0, limit: L.exports },
        monitor: { used: 0, limit: L.monitor },
      },
    });

    await createOnboardingData(user._id);

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('fp_token', token, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 7*24*3600*1000 });

    sendEmail(email, 'Bienvenue sur Flowpoint !', `<h2>Bonjour ${firstName} !</h2><p>Votre essai gratuit de 14 jours commence maintenant.</p><p><a href="${FRONTEND_URL}">Accéder au dashboard</a></p>`);

    res.status(201).json({ ok: true, user: { id: user._id, firstName, plan: 'standard', role: 'owner' } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email et password requis' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('fp_token', token, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 7*24*3600*1000 });

    res.json({ ok: true, user: { id: user._id, firstName: user.firstName, plan: user.plan, role: user.role } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/auth/logout', (req, res) => {
  res.clearCookie('fp_token', { httpOnly: true, secure: true, sameSite: 'none' });
  res.json({ ok: true });
});

// ── FIX [1a] : reset-password — token stocké en DB avec expiry 1h ────────────
router.post('/auth/reset-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email requis' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (user) {
      const resetToken        = crypto.randomBytes(32).toString('hex');
      const resetTokenExpires = new Date(Date.now() + 3600 * 1000); // 1 heure

      user.resetToken        = resetToken;
      user.resetTokenExpires = resetTokenExpires;
      await user.save();

      sendEmail(
        email,
        'Réinitialisation de votre mot de passe Flowpoint',
        `<h2>Réinitialisation du mot de passe</h2>
         <p>Cliquez sur le lien ci-dessous (valide 1 heure) :</p>
         <p><a href="${FRONTEND_URL}/reset-password?token=${resetToken}">Réinitialiser mon mot de passe</a></p>
         <p>Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.</p>`
      );
    }
    // Toujours retourner ok (sécurité : ne pas révéler si l'email existe)
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── FIX [1b] : confirm-reset — valide le token et change le mot de passe ─────
router.post('/auth/confirm-reset', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'token et password requis' });
    if (password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères' });

    const user = await User.findOne({
      resetToken: token,
      resetTokenExpires: { $gt: new Date() }, // token non expiré
    });
    if (!user) return res.status(400).json({ error: 'Token invalide ou expiré' });

    user.passwordHash      = await bcrypt.hash(password, 12);
    user.resetToken        = null;
    user.resetTokenExpires = null;
    await user.save();

    res.json({ ok: true, message: 'Mot de passe mis à jour. Vous pouvez vous connecter.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ME / OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────

router.get('/me', ...auth, (req, res) => {
  const u = req.user;
  res.json({ id: u._id, firstName: u.firstName, email: u.email, plan: u.plan, role: u.role,
    org: u.org, subscriptionStatus: u.subscriptionStatus, trialEndsAt: u.trialEndsAt,
    stripeCustomerId: u.stripeCustomerId, aiCredits: u.aiCredits, usage: u.usage, addons: u.addons });
});

router.get('/auth/me', ...auth, (req, res) => {
  const u = req.user;
  res.json({ id: u._id, firstName: u.firstName, email: u.email, plan: u.plan, role: u.role,
    org: u.org, subscriptionStatus: u.subscriptionStatus, trialEndsAt: u.trialEndsAt,
    stripeCustomerId: u.stripeCustomerId, aiCredits: u.aiCredits, usage: u.usage, addons: u.addons });
});

router.get('/overview', ...auth, async (req, res) => {
  try {
    const uid = req.userId;
    const [audits, monitors, reports, team] = await Promise.all([
      Audit.find({ userId: uid, archived: false }),
      Monitor.find({ userId: uid }),
      Report.find({ userId: uid }),
      TeamMember.find({ orgId: uid }),
    ]);
    const scores   = audits.map(a => a.score).filter(Boolean);
    const avgScore = scores.length ? Math.round(scores.reduce((s,v)=>s+v,0)/scores.length) : 0;
    res.json({
      avgScore,
      monitorsDown:  monitors.filter(m => m.status === 'down').length,
      monitorsTotal: monitors.length,
      auditsTotal:   audits.length,
      reportsTotal:  reports.length,
      teamTotal:     team.length + 1,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// AUDITS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/audits/upcoming', ...auth, async (req, res) => {
  try {
    const schedules = await AuditSchedule.find({ userId: req.userId, enabled: true }).sort({ nextRun: 1 }).limit(5);
    res.json(toDocs(schedules));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/audits/history', ...auth, async (req, res) => {
  try {
    const { url, days = 90 } = req.query;
    const cutoff = new Date(Date.now() - Number(days) * 86400000);
    const audits = await Audit.find({ userId: req.userId, url, date: { $gte: cutoff } }).sort({ date: -1 });
    res.json(toDocs(audits));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/audits/schedule', ...auth, async (req, res) => {
  try {
    const schedules = await AuditSchedule.find({ userId: req.userId });
    res.json(toDocs(schedules));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/audits/schedule', ...auth, async (req, res) => {
  try {
    const { url, frequency } = req.body;
    if (!url || !frequency) return res.status(400).json({ error: 'url et frequency requis' });
    const sched = await AuditSchedule.create({ userId: req.userId, url, frequency, nextRun: calcNextRun(frequency), lastRun: null, enabled: true });
    res.status(201).json(toDoc(sched));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/audits/schedule/:id', ...auth, async (req, res) => {
  try {
    const { frequency } = req.body;
    const sched = await AuditSchedule.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { frequency, nextRun: calcNextRun(frequency) },
      { new: true }
    );
    if (!sched) return res.status(404).json({ error: 'Planification introuvable' });
    res.json(toDoc(sched));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/audits/schedule/:id', ...auth, async (req, res) => {
  try {
    await AuditSchedule.deleteOne({ _id: req.params.id, userId: req.userId });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/audits', ...auth, async (req, res) => {
  try {
    const audits = await Audit.find({ userId: req.userId }).sort({ date: -1 });
    res.json(toDocs(audits));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/audits', ...auth, async (req, res) => {
  try {
    const user = req.user;
    if (user.usage.audit.used >= user.usage.audit.limit)
      return res.status(429).json({ error: 'Quota d\'audits atteint pour ce mois' });

    const { url, origin = 'manual' } = req.body;
    if (!url) return res.status(400).json({ error: 'url requis' });

    const { score, speed, issues } = simScore(url);
    const audit = await Audit.create({ userId: req.userId, url, score, speed, issues, status: scoreStatus(score), origin, date: new Date(), archived: false });

    user.usage.audit.used += 1;
    await user.save();

    await logActivity(req.userId, user.firstName, 'audit', `Audit lancé : ${url}`, { auditId: audit._id });
    res.status(201).json(toDoc(audit));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/audits/:id', ...auth, async (req, res) => {
  try {
    await Audit.deleteOne({ _id: req.params.id, userId: req.userId });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// MONITORS
// ─────────────────────────────────────────────────────────────────────────────

// ── FIX [3] : checks-summary — vraies données depuis MonitorCheck ─────────────
router.get('/monitors/:id/checks-summary', ...auth, async (req, res) => {
  try {
    const monitorId = req.params.id;
    const cutoff    = new Date(Date.now() - 30 * 86400000);

    // Agrégation des vraies données par jour
    const realChecks = await MonitorCheck.aggregate([
      { $match: { monitorId: new mongoose.Types.ObjectId(monitorId), checkedAt: { $gte: cutoff } } },
      { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$checkedAt' } },
          ok:    { $sum: { $cond: ['$ok', 1, 0] } },
          total: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]);

    // Construire un map date → données réelles
    const realMap = {};
    realChecks.forEach(c => { realMap[c._id] = { ok: c.ok, total: c.total }; });

    // Compléter les 30 derniers jours (seed déterministe si pas de données réelles)
    const monitorSeed = parseInt(monitorId.slice(-6), 16) || 42;
    const summary = Array.from({ length: 30 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (29 - i));
      const dateStr = d.toISOString().split('T')[0];
      if (realMap[dateStr]) {
        return { date: dateStr, ...realMap[dateStr] };
      }
      // Fallback : données simulées déterministes (pas de Math.random pur)
      const total = 288; // 12 checks/h × 24h
      const ok    = total - seededInt(monitorSeed + i, 0, 4);
      return { date: dateStr, ok, total };
    });

    res.json(summary);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/monitors/:id/check', ...auth, async (req, res) => {
  try {
    const monitor = await Monitor.findOne({ _id: req.params.id, userId: req.userId });
    if (!monitor) return res.status(404).json({ error: 'Monitor introuvable' });

    const rand    = Math.random();
    const status  = rand < 0.80 ? 'up' : rand < 0.95 ? 'warn' : 'down';
    const latency = status === 'down' ? 0 : 50 + Math.floor(Math.random() * 600);

    monitor.status    = status;
    monitor.latency   = latency;
    monitor.lastCheck = new Date();
    await monitor.save();

    await MonitorCheck.create({ monitorId: monitor._id, ok: status === 'up', latency, statusCode: status === 'down' ? 0 : 200 });
    res.json(toDoc(monitor));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/monitors/:id/test-sms', ...auth, async (req, res) => {
  console.log(`[FP] SMS test pour monitor ${req.params.id}, phone: ${req.body.phone}`);
  res.json({ ok: true });
});

router.get('/monitors', ...auth, async (req, res) => {
  try {
    const monitors = await Monitor.find({ userId: req.userId });
    res.json(toDocs(monitors));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/monitors', ...auth, async (req, res) => {
  try {
    const user = req.user;
    if (user.usage.monitor.used >= user.usage.monitor.limit)
      return res.status(429).json({ error: 'Quota de monitors atteint' });

    const { url, name, alertEmail, frequency = 5 } = req.body;
    if (!url) return res.status(400).json({ error: 'url requis' });

    const monitor = await Monitor.create({
      userId: req.userId, url, name: name || url,
      status: 'up', uptime: 100, latency: 0, lastCheck: null,
      alertEmail, frequency, isCritical: false,
    });
    user.usage.monitor.used += 1; await user.save();
    await logActivity(req.userId, user.firstName, 'monitor', `Monitor ajouté : ${name || url}`, { monitorId: monitor._id });
    res.status(201).json(toDoc(monitor));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/monitors/:id', ...auth, async (req, res) => {
  try {
    const monitor = await Monitor.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, req.body, { new: true });
    if (!monitor) return res.status(404).json({ error: 'Monitor introuvable' });
    res.json(toDoc(monitor));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/monitors/:id', ...auth, async (req, res) => {
  try {
    await Monitor.deleteOne({ _id: req.params.id, userId: req.userId });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// MISSIONS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/missions', ...auth, async (req, res) => {
  try {
    const missions = await Mission.find({ userId: req.userId }).sort({ date: -1 });
    res.json(toDocs(missions));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/missions', ...auth, async (req, res) => {
  try {
    const { title, category, impact, date, steps } = req.body;
    const mission = await Mission.create({ userId: req.userId, title, category, impact, date, steps: steps || [], status: 'todo' });
    await logActivity(req.userId, req.user.firstName, 'mission', `Mission créée : ${title}`, { missionId: mission._id });
    res.status(201).json(toDoc(mission));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/missions/:id', ...auth, async (req, res) => {
  try {
    const mission = await Mission.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, req.body, { new: true });
    if (!mission) return res.status(404).json({ error: 'Mission introuvable' });
    res.json(toDoc(mission));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/missions/:id', ...auth, async (req, res) => {
  try {
    await Mission.deleteOne({ _id: req.params.id, userId: req.userId });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// REPORTS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/reports/:id/download', ...auth, async (req, res) => {
  try {
    const report = await Report.findOne({ _id: req.params.id, userId: req.userId });
    if (!report) return res.status(404).json({ error: 'Rapport introuvable' });
    res.json({ name: report.name, type: report.type, data: toDoc(report) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/reports/:id/share', ...auth, async (req, res) => {
  try {
    const shareToken = crypto.randomUUID();
    const shareUrl   = `${FRONTEND_URL}/share/${shareToken}`;
    const report = await Report.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { shared: true, shareUrl, shareToken },
      { new: true }
    );
    if (!report) return res.status(404).json({ error: 'Rapport introuvable' });
    res.json({ url: shareUrl, report: toDoc(report) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/reports', ...auth, async (req, res) => {
  try {
    const reports = await Report.find({ userId: req.userId }).sort({ date: -1 });
    res.json(toDocs(reports));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/reports', ...auth, async (req, res) => {
  try {
    const user = req.user;
    const { name, auditId, format = 'PDF', whiteLabel = false, meetingNotes, dateStart, dateEnd } = req.body;
    if (format.toUpperCase() === 'PDF' && user.usage.pdf.used >= user.usage.pdf.limit)
      return res.status(429).json({ error: 'Quota PDF atteint' });

    const report = await Report.create({
      userId: req.userId, name, auditId, type: format.toUpperCase(),
      whiteLabel, meetingNotes, dateStart, dateEnd, date: new Date(), pages: 4, shared: false, pdfReady: true,
    });
    if (format.toUpperCase() === 'PDF') { user.usage.pdf.used += 1; await user.save(); }
    await logActivity(req.userId, user.firstName, 'report', `Rapport créé : ${name}`, { reportId: report._id });
    res.status(201).json(toDoc(report));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/reports/:id', ...auth, async (req, res) => {
  try {
    await Report.deleteOne({ _id: req.params.id, userId: req.userId });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEAM
// ─────────────────────────────────────────────────────────────────────────────

router.post('/team/invite', ...auth, async (req, res) => {
  try {
    const { email, role = 'viewer' } = req.body;
    if (!email) return res.status(400).json({ error: 'email requis' });
    const existing = await TeamMember.findOne({ orgId: req.userId, email: email.toLowerCase() });
    if (existing) return res.status(409).json({ error: 'Membre déjà invité' });
    const member = await TeamMember.create({ orgId: req.userId, email: email.toLowerCase(), name: email.split('@')[0], role, status: 'invited', joined: new Date() });
    sendEmail(email, 'Invitation à rejoindre Flowpoint', `<p>Invité par ${req.user.firstName}. <a href="${FRONTEND_URL}/join?invite=${member._id}">Accepter</a></p>`);
    await logActivity(req.userId, req.user.firstName, 'team', `Invitation envoyée à ${email}`, { memberId: member._id });
    res.status(201).json(toDoc(member));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/team', ...auth, async (req, res) => {
  try {
    const members = await TeamMember.find({ orgId: req.userId });
    res.json(toDocs(members));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/team/:id', ...auth, async (req, res) => {
  try {
    await TeamMember.deleteOne({ _id: req.params.id, orgId: req.userId });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// AI CHAT
// ─────────────────────────────────────────────────────────────────────────────

router.post('/ai/chat', ...auth, async (req, res) => {
  try {
    const user = req.user;
    if (user.aiCredits.used >= user.aiCredits.limit)
      return res.status(429).json({ error: 'Crédits IA épuisés pour ce mois' });

    const { message, context } = req.body;
    if (!message) return res.status(400).json({ error: 'message requis' });
    if (!OPENAI_KEY) return res.json({ reply: 'Assistant IA non configuré (OPENAI_API_KEY manquant).' });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `Tu es l'assistant IA de FlowPoint, expert SEO local et digital.\nPlan de l'utilisateur : ${user.plan}. Score SEO moyen : ${context?.avgScore || '—'}/100.\nRéponds en français, de façon concise et actionnable. Utilise ** pour le gras. Maximum 300 mots.` },
          { role: 'user', content: message },
        ],
        max_tokens: 400,
      }),
    });

    const data       = await response.json();
    const reply      = data.choices?.[0]?.message?.content || 'Pas de réponse.';
    const tokensUsed = data.usage?.total_tokens || 0;

    user.aiCredits.used += 1; await user.save();
    await AIUsage.create({ userId: req.userId, action: 'chat', tokensUsed, cost: tokensUsed * 0.00000015, createdAt: new Date() });

    res.json({ reply });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ALERT RULES & EVENTS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/alert-rules', ...auth, async (req, res) => {
  try { res.json(toDocs(await AlertRule.find({ userId: req.userId }))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/alert-rules', ...auth, async (req, res) => {
  try { res.status(201).json(toDoc(await AlertRule.create({ ...req.body, userId: req.userId }))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/alert-rules/:id', ...auth, async (req, res) => {
  try {
    const rule = await AlertRule.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, req.body, { new: true });
    if (!rule) return res.status(404).json({ error: 'Règle introuvable' });
    res.json(toDoc(rule));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/alert-rules/:id', ...auth, async (req, res) => {
  try { await AlertRule.deleteOne({ _id: req.params.id, userId: req.userId }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/alert-events', ...auth, async (req, res) => {
  try { res.json(toDocs(await AlertEvent.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(20))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY
// ─────────────────────────────────────────────────────────────────────────────

router.get('/activity', ...auth, async (req, res) => {
  try { res.json(toDocs(await ActivityEvent.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(50))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/activity', ...auth, async (req, res) => {
  try {
    const { type, label, targetId, targetType, metadata } = req.body;
    const event = await ActivityEvent.create({ userId: req.userId, userName: req.user.firstName, type, label, targetId, targetType, metadata: metadata || {}, createdAt: new Date() });
    res.status(201).json(toDoc(event));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── FIX [2a] : SSE — flux d'activité temps réel ──────────────────────────────
router.get('/activity/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Nginx
  res.flushHeaders();

  const userId = String(req.userId);
  sseAdd(sseActivityClients, userId, res);

  // Ping toutes les 25s pour maintenir la connexion
  const ping = setInterval(() => { try { res.write(':ping\n\n'); } catch (_) {} }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    sseRemove(sseActivityClients, userId, res);
  });
});

// ── FIX [2b] : SSE — événements billing temps réel ───────────────────────────
router.get('/billing/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const userId = String(req.userId);
  sseAdd(sseBillingClients, userId, res);

  const ping = setInterval(() => { try { res.write(':ping\n\n'); } catch (_) {} }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    sseRemove(sseBillingClients, userId, res);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BILLING
// ─────────────────────────────────────────────────────────────────────────────

router.post('/billing/portal', ...auth, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Stripe non configuré' });
    const user = req.user;
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, name: user.firstName });
      customerId = customer.id; user.stripeCustomerId = customerId; await user.save();
    }
    const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${FRONTEND_URL}/dashboard` });
    res.json({ url: session.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/billing/checkout', ...auth, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Stripe non configuré' });
    const { plan } = req.body;
    const priceId = STRIPE_PRICES[plan];
    if (!priceId) return res.status(400).json({ error: 'Plan invalide' });

    const user = req.user;
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email });
      customerId = customer.id; user.stripeCustomerId = customerId; await user.save();
    }
    const session = await stripe.checkout.sessions.create({
      customer: customerId, mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { trial_period_days: 14 },
      success_url: `${FRONTEND_URL}/dashboard?checkout=success`,
      cancel_url:  `${FRONTEND_URL}/dashboard?checkout=cancel`,
    });
    res.json({ url: session.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────────────────────

router.get('/export/:type', ...auth, async (req, res) => {
  try {
    const user = req.user;
    if (user.usage.exports.used >= user.usage.exports.limit)
      return res.status(429).json({ error: 'Quota d\'exports atteint' });

    const { type }          = req.params;
    const { format = 'json' } = req.query;
    let data = [];
    if (type === 'audits')        data = await Audit.find({ userId: req.userId });
    else if (type === 'monitors') data = await Monitor.find({ userId: req.userId });
    else if (type === 'reports')  data = await Report.find({ userId: req.userId });
    else return res.status(400).json({ error: 'Type invalide (audits|monitors|reports)' });

    user.usage.exports.used += 1; await user.save();

    if (format === 'csv' && data.length > 0) {
      const docs = toDocs(data);
      const keys = Object.keys(docs[0]);
      const csv  = [keys.join(','), ...docs.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${type}.csv"`);
      return res.send(csv);
    }
    res.json(toDocs(data));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Mount & Start
// ─────────────────────────────────────────────────────────────────────────────

app.use('/api', router);

// 404
app.use((req, res) => res.status(404).json({ error: `Route introuvable : ${req.method} ${req.path}` }));

// Global error handler
app.use((err, req, res, _next) => {
  console.error('[FP] Error:', err);
  res.status(500).json({ error: err.message || 'Erreur interne' });
});

// Boot
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('[FP] MongoDB connecte');
    app.listen(PORT, () => console.log(`[FP] Serveur demarre sur http://localhost:${PORT}`));
  })
  .catch(err => { console.error('[FP] MongoDB erreur:', err); process.exit(1); });
