'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║         FLOWPOINT — Backend API v2 (Node.js / Express)          ║
 * ║  JWT auth · MongoDB · Stripe · OpenAI · Resend · SSE realtime   ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 *  npm install && node server.js
 *  Render → Build: npm install  |  Start: npm start
 */

require('dotenv').config();

const express      = require('express');
const mongoose     = require('mongoose');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors         = require('cors');
const path         = require('path');
const crypto       = require('crypto');
const cron         = require('node-cron');
const Stripe       = require('stripe');
const { Resend }   = require('resend');

// ── ENV ───────────────────────────────────────────────────────────────────────

const PORT          = process.env.PORT || 3001;
const MONGO_URI     = process.env.MONGO_URI || 'mongodb://localhost:27017/flowpoint';
const JWT_SECRET    = process.env.JWT_SECRET || 'change_me_32chars_min!!';
const OPENAI_KEY    = process.env.OPENAI_API_KEY || '';
const STRIPE_KEY    = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WH     = process.env.STRIPE_WEBHOOK_SECRET || '';
const RESEND_KEY    = process.env.RESEND_API_KEY || '';
const FROM_EMAIL    = process.env.FROM_EMAIL || 'no-reply@flowpoint.pro';
const FRONTEND_URL  = process.env.FRONTEND_URL || `http://localhost:${PORT}`;

const STRIPE_PRICES = {
  standard: process.env.STRIPE_PRICE_STANDARD || '',
  pro:      process.env.STRIPE_PRICE_PRO      || '',
  ultra:    process.env.STRIPE_PRICE_ULTRA    || '',
};

const STRIPE_PUB = process.env.STRIPE_PUBLISHABLE_KEY || '';

const PLAN_LIMITS = {
  standard: { audit: 30,    monitor: 3,   pdf: 30,    exports: 30,    aiCredits: 20,  seats: 1 },
  pro:      { audit: 300,   monitor: 50,  pdf: 300,   exports: 300,   aiCredits: 100, seats: 5 },
  ultra:    { audit: 2000,  monitor: 300, pdf: 2000,  exports: 2000,  aiCredits: 500, seats: 10 },
};

const ADDON_PRICE_IDS = {
  monitorsPack50:  process.env.STRIPE_ADDON_MONITORS  || '',
  extraSeats:      process.env.STRIPE_ADDON_SEATS     || '',
  auditsPack200:   process.env.STRIPE_ADDON_AUDITS    || '',
  pdfPack200:      process.env.STRIPE_ADDON_PDF       || '',
  exportsPack1000: process.env.STRIPE_ADDON_EXPORTS   || '',
  prioritySupport: process.env.STRIPE_ADDON_SUPPORT   || '',
  customDomain:    process.env.STRIPE_ADDON_DOMAIN    || '',
  retention90d:    process.env.STRIPE_ADDON_RET90     || '',
  retention365d:   process.env.STRIPE_ADDON_RET365    || '',
};

const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY, { apiVersion: '2024-04-10' }) : null;
const resend  = RESEND_KEY ? new Resend(RESEND_KEY) : null;

// ── SCHEMAS ───────────────────────────────────────────────────────────────────

const { Schema, model } = mongoose;

const UserSchema = new Schema({
  email:                { type: String, required: true, unique: true, lowercase: true },
  passwordHash:         { type: String, required: true },
  firstName:            { type: String, required: true },
  companyName:          String,
  website:              String,
  phone:                String,
  avatarUrl:            String,
  plan:                 { type: String, enum: ['standard','pro','ultra'], default: 'standard' },
  role:                 { type: String, enum: ['owner','manager','viewer'], default: 'owner' },
  org:                  { name: String, slug: String },
  subscriptionStatus:   { type: String, enum: ['trial','active','past_due','canceled'], default: 'trial' },
  trialEndsAt:          { type: Date, default: () => new Date(Date.now() + 14*864e5) },
  stripeCustomerId:     String,
  stripeSubscriptionId: String,
  aiCredits:            { used: { type: Number, default: 0 }, limit: { type: Number, default: 20 }, resetAt: Date },
  usage: {
    audit:   { used: { type: Number, default: 0 }, limit: { type: Number, default: 30 } },
    pdf:     { used: { type: Number, default: 0 }, limit: { type: Number, default: 30 } },
    exports: { used: { type: Number, default: 0 }, limit: { type: Number, default: 30 } },
    monitor: { used: { type: Number, default: 0 }, limit: { type: Number, default: 3  } },
  },
  addons: {
    monitorsPack50:  { type: Number, default: 0 },
    extraSeats:      { type: Number, default: 0 },
    auditsPack200:   { type: Number, default: 0 },
    pdfPack200:      { type: Number, default: 0 },
    exportsPack1000: { type: Number, default: 0 },
    prioritySupport: { type: Boolean, default: false },
    customDomain:    { type: Boolean, default: false },
    retention90d:    { type: Boolean, default: false },
    retention365d:   { type: Boolean, default: false },
  },
  notifPrefs: {
    email:  { type: Boolean, default: true },
    inApp:  { type: Boolean, default: true },
    digest: { type: String, default: 'daily' },
  },
  resetToken:     String,
  resetTokenExp:  Date,
  inviteToken:    String,
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
  aiSummary: String,
  details: {
    seo:          { score: Number, issues: [String] },
    performance:  { score: Number, issues: [String] },
    accessibility:{ score: Number, issues: [String] },
    bestPractices:{ score: Number, issues: [String] },
  },
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
  paused:     { type: Boolean, default: false },
}, { timestamps: true });

const MonitorCheckSchema = new Schema({
  monitorId:  { type: Schema.Types.ObjectId, ref: 'Monitor', required: true },
  ok:         Boolean,
  latency:    Number,
  statusCode: Number,
  error:      String,
  checkedAt:  { type: Date, default: Date.now },
});

const MissionSchema = new Schema({
  userId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title:    String,
  category: { type: String, enum: ['Audits','Local SEO','Monitoring','Rapports','Contenu','Croissance'] },
  impact:   { type: String, enum: ['Élevé','Très élevé','Moyen'] },
  status:   { type: String, enum: ['todo','inprogress','done'], default: 'todo' },
  date:     { type: Date, default: Date.now },
  steps:    [{ id: String, text: String, done: { type: Boolean, default: false }, tag: String }],
  dueDate:  Date,
  priority: { type: Number, default: 0 },
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
  orgId:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name:        String,
  email:       { type: String, required: true },
  role:        { type: String, enum: ['owner','manager','viewer'], default: 'viewer' },
  status:      { type: String, enum: ['active','invited','inactive'], default: 'invited' },
  joined:      { type: Date, default: Date.now },
  inviteToken: String,
}, { timestamps: true });

const ActivityEventSchema = new Schema({
  userId:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
  userName:   String,
  type:       { type: String, enum: ['audit','monitor','report','mission','alert','team','billing','ai','connector'] },
  label:      String,
  targetId:   Schema.Types.ObjectId,
  targetType: String,
  metadata:   { type: Schema.Types.Mixed, default: {} },
  createdAt:  { type: Date, default: Date.now },
});

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
  resolvedAt: Date,
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
  action:     { type: String, enum: ['chat','audit','report','analysis','keywords'] },
  tokensUsed: Number,
  cost:       Number,
  createdAt:  { type: Date, default: Date.now },
});

const KeywordSchema = new Schema({
  userId:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
  keyword:   { type: String, required: true },
  url:       String,
  position:  Number,
  volume:    Number,
  difficulty:Number,
  trend:     { type: String, enum: ['up','down','stable'], default: 'stable' },
  tags:      [String],
  history:   [{ date: Date, position: Number }],
}, { timestamps: true });

const CompetitorSchema = new Schema({
  userId:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
  url:       { type: String, required: true },
  name:      String,
  score:     Number,
  traffic:   Number,
  keywords:  Number,
  backlinks: Number,
  status:    { type: String, enum: ['tracked','paused'], default: 'tracked' },
  lastCheck: Date,
}, { timestamps: true });

const NotificationSchema = new Schema({
  userId:  { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type:    String,
  title:   String,
  message: String,
  read:    { type: Boolean, default: false },
  link:    String,
  createdAt: { type: Date, default: Date.now },
});

const TeamMessageSchema = new Schema({
  orgId:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
  senderId:  { type: Schema.Types.ObjectId, ref: 'User' },
  senderName:String,
  channel:   { type: String, default: 'general' },
  content:   String,
  attachments:[String],
  createdAt: { type: Date, default: Date.now },
});

const WorkspaceNoteSchema = new Schema({
  orgId:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
  authorId:  { type: Schema.Types.ObjectId, ref: 'User' },
  authorName:String,
  title:     String,
  content:   String,
  tags:      [String],
  pinned:    { type: Boolean, default: false },
}, { timestamps: true });

const ConnectorSchema = new Schema({
  userId:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type:      { type: String, enum: ['google_search_console','google_analytics','google_my_business','semrush','ahrefs','mailchimp','slack','zapier','custom'] },
  name:      String,
  status:    { type: String, enum: ['active','inactive','error'], default: 'inactive' },
  config:    { type: Schema.Types.Mixed, default: {} },
  lastSync:  Date,
}, { timestamps: true });

const LocalSeoSchema = new Schema({
  userId:       { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  businessName: String,
  address:      String,
  city:         String,
  postalCode:   String,
  country:      { type: String, default: 'FR' },
  phone:        String,
  website:      String,
  category:     String,
  description:  String,
  googlePlaceId:String,
  rating:       Number,
  reviewCount:  Number,
  photos:       [String],
  hours:        { type: Schema.Types.Mixed, default: {} },
  attributes:   { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true });

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
const Keyword       = model('Keyword', KeywordSchema);
const Competitor    = model('Competitor', CompetitorSchema);
const Notification  = model('Notification', NotificationSchema);
const TeamMessage   = model('TeamMessage', TeamMessageSchema);
const WorkspaceNote = model('WorkspaceNote', WorkspaceNoteSchema);
const Connector     = model('Connector', ConnectorSchema);
const LocalSeo      = model('LocalSeo', LocalSeoSchema);

// ── HELPERS ───────────────────────────────────────────────────────────────────

function toDoc(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject({ virtuals: true }) : { ...doc };
  o.id = String(o._id);
  delete o._id; delete o.__v;
  return o;
}
function toDocs(arr) { return (arr || []).map(toDoc); }

function simScore(url) {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = ((h << 5) - h) + url.charCodeAt(i);
  const s = Math.abs(h) % 100;
  return {
    score:  40 + (s % 56),
    speed:  35 + ((s * 7) % 60),
    issues: Math.max(1, 25 - Math.floor((40 + (s % 56)) / 5)),
  };
}
function scoreStatus(s) { return s >= 70 ? 'ok' : s >= 45 ? 'warn' : 'error'; }

function calcNextRun(freq) {
  const d = new Date();
  if (freq === 'daily')   d.setDate(d.getDate() + 1);
  else if (freq === 'weekly') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

async function sendEmail(to, subject, html) {
  if (!resend) { console.warn('[FP] Resend non configuré — email ignoré:', subject); return; }
  try { await resend.emails.send({ from: `FlowPoint <${FROM_EMAIL}>`, to, subject, html }); }
  catch (e) { console.warn('[FP] Email error:', e.message); }
}

async function logActivity(userId, userName, type, label, metadata = {}) {
  try { await ActivityEvent.create({ userId, userName, type, label, metadata, createdAt: new Date() }); }
  catch (e) { console.warn('[FP] Activity log error:', e.message); }
}

async function pushNotif(userId, type, title, message, link = '') {
  try {
    const notif = await Notification.create({ userId, type, title, message, link });
    sseNotify(String(userId), { type: 'notification', data: toDoc(notif) });
  } catch (e) { console.warn('[FP] Notif error:', e.message); }
}

async function createOnboardingData(userId) {
  const today = new Date();
  await Promise.all([
    Mission.create({ userId, title: 'Lancer votre premier audit SEO', category: 'Audits', impact: 'Élevé', status: 'todo', date: today, steps: [{ id:'s1', text:"Entrer l'URL d'un site client", done:false, tag:'Démarrage' }, { id:'s2', text:'Analyser les résultats', done:false, tag:'Audit' }] }),
    Mission.create({ userId, title: 'Configurer votre premier monitor', category: 'Monitoring', impact: 'Élevé', status: 'todo', date: today, steps: [{ id:'s1', text:"Ajouter l'URL à surveiller", done:false, tag:'Config' }, { id:'s2', text:"Configurer l'email d'alerte", done:false, tag:'Config' }] }),
    Mission.create({ userId, title: 'Créer votre première fiche Local SEO', category: 'Local SEO', impact: 'Très élevé', status: 'todo', date: today, steps: [{ id:'s1', text:'Compléter Google Business Profile', done:false, tag:'Local' }, { id:'s2', text:'Ajouter des photos récentes', done:false, tag:'Contenu' }] }),
    AlertRule.create({ userId, name: 'Monitor DOWN', type: 'uptime', operator: 'lt', threshold: 1, durationMin: 1, channels: ['email'], siteUrls: [], enabled: true }),
  ]);
}

// ── SSE MANAGER ───────────────────────────────────────────────────────────────

const sseClients = new Map();

function sseNotify(userId, payload) {
  const clients = sseClients.get(userId) || [];
  const data = JSON.stringify(payload);
  for (const res of clients) {
    try { res.write(`data: ${data}\n\n`); } catch (_) {}
  }
}

function sseBroadcast(payload) {
  const data = JSON.stringify(payload);
  for (const clients of sseClients.values()) {
    for (const res of clients) {
      try { res.write(`data: ${data}\n\n`); } catch (_) {}
    }
  }
}

// ── AUTH MIDDLEWARE ───────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const token = req.cookies?.fp_token || req.headers?.authorization?.replace('Bearer ', '');
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
    return res.status(401).json({ error: "Erreur d'authentification" });
  }
}

const auth = [requireAuth, loadUser];

// ── APP SETUP ─────────────────────────────────────────────────────────────────

const app = express();

const CORS_ORIGIN = process.env.CORS_ORIGIN || FRONTEND_URL;
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || origin === CORS_ORIGIN || CORS_ORIGIN === '*') return cb(null, true);
    cb(null, true);
  },
  credentials: true,
  methods: ['GET','POST','PATCH','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

app.use(cookieParser());

// ── STRIPE WEBHOOK (raw body) ─────────────────────────────────────────────────

app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.json({ received: true });
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WH);
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
      const items = obj.items?.data || [];
      let plan = 'standard';
      for (const item of items) {
        const nick = (item.price?.nickname || item.price?.id || '').toLowerCase();
        if (nick.includes('ultra')) { plan = 'ultra'; break; }
        if (nick.includes('pro'))   { plan = 'pro';   break; }
      }
      const L = PLAN_LIMITS[plan];
      const sub = obj.status === 'trialing' ? 'trial' : obj.status === 'active' ? 'active' : 'past_due';
      user.plan = plan;
      user.subscriptionStatus = sub;
      user.stripeSubscriptionId = obj.id;
      user.usage.audit.limit   = L.audit;
      user.usage.pdf.limit     = L.pdf;
      user.usage.exports.limit = L.exports;
      user.usage.monitor.limit = L.monitor;
      user.aiCredits.limit     = L.aiCredits;

      for (const item of items) {
        const priceId = item.price?.id;
        const qty     = item.quantity || 1;
        if (priceId === ADDON_PRICE_IDS.monitorsPack50)  user.addons.monitorsPack50  = qty;
        if (priceId === ADDON_PRICE_IDS.extraSeats)      user.addons.extraSeats      = qty;
        if (priceId === ADDON_PRICE_IDS.auditsPack200)   user.addons.auditsPack200   = qty;
        if (priceId === ADDON_PRICE_IDS.pdfPack200)      user.addons.pdfPack200      = qty;
        if (priceId === ADDON_PRICE_IDS.exportsPack1000) user.addons.exportsPack1000 = qty;
        if (priceId === ADDON_PRICE_IDS.prioritySupport) user.addons.prioritySupport = true;
        if (priceId === ADDON_PRICE_IDS.customDomain)    user.addons.customDomain    = true;
        if (priceId === ADDON_PRICE_IDS.retention90d)    user.addons.retention90d    = true;
        if (priceId === ADDON_PRICE_IDS.retention365d)   user.addons.retention365d   = true;
      }
      await user.save();
      sseNotify(String(user._id), { type: 'billing', data: { plan, status: sub } });
      break;
    }
    case 'customer.subscription.deleted':
      user.plan = 'standard'; user.subscriptionStatus = 'canceled'; await user.save();
      sseNotify(String(user._id), { type: 'billing', data: { status: 'canceled' } });
      break;
    case 'invoice.payment_failed':
      user.subscriptionStatus = 'past_due'; await user.save();
      sseNotify(String(user._id), { type: 'billing', data: { status: 'past_due' } });
      break;
    case 'invoice.payment_succeeded':
      user.subscriptionStatus = 'active';
      user.usage.audit.used = user.usage.pdf.used = user.usage.exports.used = 0;
      await user.save();
      sseNotify(String(user._id), { type: 'billing', data: { status: 'active' } });
      break;
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '10mb' }));

const router = express.Router();

// ── SSE EVENTS STREAM ─────────────────────────────────────────────────────────

router.get('/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const uid = String(req.userId);
  if (!sseClients.has(uid)) sseClients.set(uid, []);
  sseClients.get(uid).push(res);

  res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);

  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) { clearInterval(ping); }
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    const list = sseClients.get(uid) || [];
    sseClients.set(uid, list.filter(r => r !== res));
  });
});

// ── AUTH ──────────────────────────────────────────────────────────────────────

router.post('/auth/register', async (req, res) => {
  try {
    const { email, password, firstName, orgName, companyName } = req.body;
    if (!email || !password || !firstName)
      return res.status(400).json({ error: 'email, password et firstName requis' });

    if (await User.findOne({ email: email.toLowerCase() }))
      return res.status(409).json({ error: 'Email déjà utilisé' });

    const passwordHash = await bcrypt.hash(password, 12);
    const L = PLAN_LIMITS.standard;
    const nextMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);

    const user = await User.create({
      email: email.toLowerCase(), passwordHash, firstName,
      companyName: companyName || orgName || '',
      plan: 'standard', role: 'owner',
      org: { name: orgName || companyName || `${firstName}'s Agency` },
      subscriptionStatus: 'trial',
      trialEndsAt: new Date(Date.now() + 14 * 864e5),
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
    res.cookie('fp_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'none', maxAge: 7*24*36e5 });

    sendEmail(email, 'Bienvenue sur FlowPoint ! 🚀',
      `<h2>Bonjour ${firstName} !</h2><p>Votre essai gratuit de 14 jours commence maintenant.</p><p><a href="${FRONTEND_URL}">Accéder au dashboard →</a></p>`);

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
    res.cookie('fp_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'none', maxAge: 7*24*36e5 });

    res.json({ ok: true, user: { id: user._id, firstName: user.firstName, email: user.email, plan: user.plan, role: user.role } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/auth/logout', (req, res) => {
  res.clearCookie('fp_token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'none' });
  res.json({ ok: true });
});

router.post('/auth/reset-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email requis' });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (user) {
      const resetToken = crypto.randomUUID();
      user.resetToken    = resetToken;
      user.resetTokenExp = new Date(Date.now() + 3600000);
      await user.save();
      sendEmail(email, 'Réinitialisation mot de passe FlowPoint',
        `<p>Cliquez ici pour réinitialiser (1h) : <a href="${FRONTEND_URL}/reset?token=${resetToken}">Réinitialiser →</a></p>`);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/auth/reset-password/confirm', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'token et password requis' });
    const user = await User.findOne({ resetToken: token, resetTokenExp: { $gt: new Date() } });
    if (!user) return res.status(400).json({ error: 'Token invalide ou expiré' });
    user.passwordHash = await bcrypt.hash(password, 12);
    user.resetToken   = undefined;
    user.resetTokenExp = undefined;
    await user.save();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/auth/accept-invite', async (req, res) => {
  try {
    const { inviteToken, password, firstName } = req.body;
    if (!inviteToken || !password || !firstName) return res.status(400).json({ error: 'inviteToken, password, firstName requis' });
    const member = await TeamMember.findOne({ inviteToken });
    if (!member) return res.status(404).json({ error: 'Invitation introuvable' });

    const existing = await User.findOne({ email: member.email });
    if (existing) return res.status(409).json({ error: 'Compte déjà existant' });

    const passwordHash = await bcrypt.hash(password, 12);
    const L = PLAN_LIMITS.standard;
    const user = await User.create({
      email: member.email, passwordHash, firstName,
      plan: 'standard', role: member.role,
      usage: { audit: { used:0, limit:L.audit }, pdf:{used:0,limit:L.pdf}, exports:{used:0,limit:L.exports}, monitor:{used:0,limit:L.monitor} },
      aiCredits: { used:0, limit:L.aiCredits },
    });
    member.status = 'active'; member.inviteToken = undefined; await member.save();

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('fp_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'none', maxAge: 7*24*36e5 });
    res.json({ ok: true, user: { id: user._id, firstName, plan: 'standard' } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ME / SETTINGS / OVERVIEW ──────────────────────────────────────────────────

function userPayload(u) {
  return {
    id: u._id, firstName: u.firstName, email: u.email,
    companyName: u.companyName, website: u.website, phone: u.phone, avatarUrl: u.avatarUrl,
    plan: u.plan, role: u.role, org: u.org,
    subscriptionStatus: u.subscriptionStatus, trialEndsAt: u.trialEndsAt,
    stripeCustomerId: u.stripeCustomerId,
    aiCredits: u.aiCredits, usage: u.usage, addons: u.addons, notifPrefs: u.notifPrefs,
  };
}

router.get('/me',      ...auth, (req, res) => res.json(userPayload(req.user)));
router.get('/auth/me', ...auth, (req, res) => res.json(userPayload(req.user)));

router.patch('/me', ...auth, async (req, res) => {
  try {
    const allowed = ['firstName','companyName','website','phone','avatarUrl','notifPrefs'];
    for (const k of allowed) { if (req.body[k] !== undefined) req.user[k] = req.body[k]; }
    if (req.body.orgName) req.user.org = { ...req.user.org, name: req.body.orgName };
    if (req.body.password) {
      if (!req.body.currentPassword) return res.status(400).json({ error: 'currentPassword requis' });
      const valid = await bcrypt.compare(req.body.currentPassword, req.user.passwordHash);
      if (!valid) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
      req.user.passwordHash = await bcrypt.hash(req.body.password, 12);
    }
    await req.user.save();
    res.json(userPayload(req.user));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/settings', ...auth, (req, res) => {
  const u = req.user;
  res.json({ firstName: u.firstName, companyName: u.companyName, website: u.website, email: u.email, phone: u.phone, plan: u.plan, addons: u.addons, notifPrefs: u.notifPrefs });
});
router.patch('/settings', ...auth, async (req, res) => {
  try {
    const allowed = ['firstName','companyName','website','phone','notifPrefs'];
    for (const k of allowed) { if (req.body[k] !== undefined) req.user[k] = req.body[k]; }
    await req.user.save();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/overview', ...auth, async (req, res) => {
  try {
    const uid = req.userId;
    const [audits, monitors, reports, team, missions, keywords] = await Promise.all([
      Audit.find({ userId: uid, archived: false }),
      Monitor.find({ userId: uid }),
      Report.find({ userId: uid }),
      TeamMember.find({ orgId: uid }),
      Mission.find({ userId: uid }),
      Keyword.find({ userId: uid }),
    ]);
    const scores = audits.map(a => a.score).filter(Boolean);
    const avgScore = scores.length ? Math.round(scores.reduce((s,v)=>s+v,0)/scores.length) : 0;
    res.json({
      avgScore,
      monitorsDown:  monitors.filter(m=>m.status==='down').length,
      monitorsTotal: monitors.length,
      auditsTotal:   audits.length,
      reportsTotal:  reports.length,
      teamTotal:     team.length + 1,
      missionsDone:  missions.filter(m=>m.status==='done').length,
      missionsTotal: missions.length,
      keywordsTotal: keywords.length,
      avgPosition:   keywords.length ? Math.round(keywords.reduce((s,k)=>s+(k.position||0),0)/keywords.length) : 0,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── AUDITS ────────────────────────────────────────────────────────────────────

router.get('/audits/upcoming', ...auth, async (req, res) => {
  try { res.json(toDocs(await AuditSchedule.find({ userId: req.userId, enabled: true }).sort({ nextRun: 1 }).limit(5))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/audits/history', ...auth, async (req, res) => {
  try {
    const { url, days = 90 } = req.query;
    const cutoff = new Date(Date.now() - Number(days)*864e5);
    const audits = await Audit.find({ userId: req.userId, url, date: { $gte: cutoff } }).sort({ date: -1 });
    res.json(toDocs(audits));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/audits/schedule', ...auth, async (req, res) => {
  try { res.json(toDocs(await AuditSchedule.find({ userId: req.userId }))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/audits/schedule', ...auth, async (req, res) => {
  try {
    const { url, frequency } = req.body;
    if (!url || !frequency) return res.status(400).json({ error: 'url et frequency requis' });
    const sched = await AuditSchedule.create({ userId: req.userId, url, frequency, nextRun: calcNextRun(frequency), enabled: true });
    res.status(201).json(toDoc(sched));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/audits/schedule/:id', ...auth, async (req, res) => {
  try {
    const s = await AuditSchedule.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, { ...req.body, nextRun: calcNextRun(req.body.frequency || 'weekly') }, { new: true });
    if (!s) return res.status(404).json({ error: 'Planification introuvable' });
    res.json(toDoc(s));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/audits/schedule/:id', ...auth, async (req, res) => {
  try { await AuditSchedule.deleteOne({ _id: req.params.id, userId: req.userId }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/audits', ...auth, async (req, res) => {
  try { res.json(toDocs(await Audit.find({ userId: req.userId, archived: false }).sort({ date: -1 }))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/audits', ...auth, async (req, res) => {
  try {
    const user = req.user;
    if (user.usage.audit.used >= user.usage.audit.limit)
      return res.status(429).json({ error: "Quota d'audits atteint pour ce mois" });

    const { url, origin = 'manual' } = req.body;
    if (!url) return res.status(400).json({ error: 'url requis' });

    const { score, speed, issues } = simScore(url);
    const details = {
      seo:           { score: Math.round(score * 1.0),  issues: ['Balises meta manquantes', 'Titres H1 dupliqués'].slice(0, issues > 5 ? 2 : 1) },
      performance:   { score: Math.round(speed * 1.0),  issues: issues > 3 ? ['LCP trop élevé'] : [] },
      accessibility: { score: Math.min(100, score + 8), issues: [] },
      bestPractices: { score: Math.min(100, score + 5), issues: [] },
    };
    const audit = await Audit.create({ userId: req.userId, url, score, speed, issues, status: scoreStatus(score), origin, date: new Date(), archived: false, details });

    user.usage.audit.used += 1; await user.save();
    await logActivity(req.userId, user.firstName, 'audit', `Audit lancé : ${url}`, { auditId: audit._id });
    sseNotify(String(req.userId), { type: 'audit', data: toDoc(audit) });

    await pushNotif(req.userId, 'audit', `Audit terminé`, `Score : ${score}/100 pour ${url}`, `#audits`);
    res.status(201).json(toDoc(audit));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/audits/:id', ...auth, async (req, res) => {
  try {
    const a = await Audit.findOne({ _id: req.params.id, userId: req.userId });
    if (!a) return res.status(404).json({ error: 'Audit introuvable' });
    res.json(toDoc(a));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/audits/:id', ...auth, async (req, res) => {
  try {
    const a = await Audit.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, req.body, { new: true });
    if (!a) return res.status(404).json({ error: 'Audit introuvable' });
    res.json(toDoc(a));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/audits/:id', ...auth, async (req, res) => {
  try { await Audit.deleteOne({ _id: req.params.id, userId: req.userId }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/audits/:id/analyse', ...auth, async (req, res) => {
  try {
    const user = req.user;
    if (user.aiCredits.used >= user.aiCredits.limit)
      return res.status(429).json({ error: 'Crédits IA épuisés' });

    const audit = await Audit.findOne({ _id: req.params.id, userId: req.userId });
    if (!audit) return res.status(404).json({ error: 'Audit introuvable' });

    let summary = `Analyse IA pour ${audit.url} : score global ${audit.score}/100. `;
    if (OPENAI_KEY) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Tu es un expert SEO. Analyse les métriques et donne 3 recommandations concrètes en français. Maximum 200 mots.' },
            { role: 'user', content: `URL: ${audit.url}\nScore SEO: ${audit.score}/100\nVitesse: ${audit.speed}/100\nProblèmes: ${audit.issues}\nDonnez des recommandations prioritaires.` },
          ],
          max_tokens: 300,
        }),
      });
      const data = await response.json();
      summary = data.choices?.[0]?.message?.content || summary;
      const tokensUsed = data.usage?.total_tokens || 0;
      user.aiCredits.used += 1; await user.save();
      await AIUsage.create({ userId: req.userId, action: 'audit', tokensUsed, cost: tokensUsed * 0.00000015 });
    }

    audit.aiSummary = summary; await audit.save();
    res.json({ summary, audit: toDoc(audit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MONITORS ──────────────────────────────────────────────────────────────────

router.get('/monitors', ...auth, async (req, res) => {
  try { res.json(toDocs(await Monitor.find({ userId: req.userId }))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/monitors', ...auth, async (req, res) => {
  try {
    const user = req.user;
    const totalMonitors = await Monitor.countDocuments({ userId: req.userId });
    const monitorLimit = user.usage.monitor.limit + (user.addons?.monitorsPack50 || 0) * 50;
    if (totalMonitors >= monitorLimit) return res.status(429).json({ error: 'Quota de monitors atteint' });

    const { url, name, alertEmail, alertPhone, frequency = 5, isCritical = false } = req.body;
    if (!url) return res.status(400).json({ error: 'url requis' });
    const monitor = await Monitor.create({ userId: req.userId, url, name: name || url, status: 'up', uptime: 100, latency: 0, lastCheck: null, alertEmail, alertPhone, frequency, isCritical });
    user.usage.monitor.used += 1; await user.save();
    await logActivity(req.userId, user.firstName, 'monitor', `Monitor ajouté : ${name || url}`, { monitorId: monitor._id });
    res.status(201).json(toDoc(monitor));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/monitors/:id', ...auth, async (req, res) => {
  try {
    const m = await Monitor.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, req.body, { new: true });
    if (!m) return res.status(404).json({ error: 'Monitor introuvable' });
    res.json(toDoc(m));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/monitors/:id', ...auth, async (req, res) => {
  try { await Monitor.deleteOne({ _id: req.params.id, userId: req.userId }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/monitors/:id/check', ...auth, async (req, res) => {
  try {
    const monitor = await Monitor.findOne({ _id: req.params.id, userId: req.userId });
    if (!monitor) return res.status(404).json({ error: 'Monitor introuvable' });
    const rand = Math.random();
    const status  = rand < 0.80 ? 'up' : rand < 0.95 ? 'warn' : 'down';
    const latency = status === 'down' ? 0 : 50 + Math.floor(Math.random() * 600);
    monitor.status = status; monitor.latency = latency; monitor.lastCheck = new Date();
    await monitor.save();
    await MonitorCheck.create({ monitorId: monitor._id, ok: status === 'up', latency, statusCode: status === 'down' ? 0 : 200 });
    if (status === 'down') {
      await pushNotif(req.userId, 'monitor', 'Monitor DOWN', `${monitor.name || monitor.url} est inaccessible`, '#monitors');
    }
    sseNotify(String(req.userId), { type: 'monitor', data: toDoc(monitor) });
    res.json(toDoc(monitor));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/monitors/:id/checks', ...auth, async (req, res) => {
  try {
    const checks = await MonitorCheck.find({ monitorId: req.params.id }).sort({ checkedAt: -1 }).limit(100);
    res.json(toDocs(checks));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/monitors/:id/checks-summary', ...auth, async (req, res) => {
  try {
    const summary = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (29 - i));
      return { date: d.toISOString().split('T')[0], ok: Math.floor(Math.random() * 5 + 283), total: 288 };
    });
    res.json(summary);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/monitors/:id/test-sms', ...auth, async (req, res) => {
  console.log(`[FP] SMS test pour monitor ${req.params.id}, phone: ${req.body.phone}`);
  res.json({ ok: true });
});

// ── MISSIONS ──────────────────────────────────────────────────────────────────

router.get('/missions', ...auth, async (req, res) => {
  try { res.json(toDocs(await Mission.find({ userId: req.userId }).sort({ date: -1 }))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/missions', ...auth, async (req, res) => {
  try {
    const { title, category, impact, date, steps, dueDate } = req.body;
    const mission = await Mission.create({ userId: req.userId, title, category, impact, date: date || new Date(), steps: steps || [], status: 'todo', dueDate });
    await logActivity(req.userId, req.user.firstName, 'mission', `Mission créée : ${title}`, { missionId: mission._id });
    res.status(201).json(toDoc(mission));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/missions/:id', ...auth, async (req, res) => {
  try {
    const m = await Mission.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, req.body, { new: true });
    if (!m) return res.status(404).json({ error: 'Mission introuvable' });
    res.json(toDoc(m));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/missions/:id', ...auth, async (req, res) => {
  try { await Mission.deleteOne({ _id: req.params.id, userId: req.userId }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/missions/generate', ...auth, async (req, res) => {
  try {
    const user = req.user;
    if (user.aiCredits.used >= user.aiCredits.limit) return res.status(429).json({ error: 'Crédits IA épuisés' });

    const { context } = req.body;
    let missions = [
      { title: 'Optimiser les balises meta de vos 5 pages clés', category: 'Audits', impact: 'Très élevé', steps: [{ id:'s1', text:'Identifier les pages prioritaires', done:false, tag:'Analyse' }, { id:'s2', text:'Rédiger les meta title et description', done:false, tag:'SEO' }] },
      { title: 'Créer 3 contenus pour vos mots-clés locaux', category: 'Contenu', impact: 'Élevé', steps: [{ id:'s1', text:'Choisir 3 mots-clés longue traîne', done:false, tag:'Recherche' }, { id:'s2', text:'Rédiger et publier les contenus', done:false, tag:'Rédaction' }] },
      { title: 'Obtenir 10 nouveaux avis Google', category: 'Local SEO', impact: 'Très élevé', steps: [{ id:'s1', text:'Identifier les clients récents', done:false, tag:'CRM' }, { id:'s2', text:'Envoyer les demandes d\'avis', done:false, tag:'Email' }] },
    ];

    if (OPENAI_KEY) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Tu es un expert SEO. Génère 3 missions SEO actionnables en JSON. Format: [{title, category, impact, steps:[{id,text,done,tag}]}]. Categories: Audits|Local SEO|Monitoring|Rapports|Contenu|Croissance. Impact: Élevé|Très élevé|Moyen. Réponds UNIQUEMENT avec le JSON.' },
            { role: 'user', content: `Plan: ${user.plan}. Contexte: ${context || 'agence SEO'}` },
          ],
          max_tokens: 500,
        }),
      });
      const data = await response.json();
      try {
        const txt = data.choices?.[0]?.message?.content || '[]';
        missions = JSON.parse(txt.replace(/```json|```/g, '').trim());
      } catch (_) {}
      user.aiCredits.used += 1; await user.save();
    }

    const created = await Promise.all(missions.map(m => Mission.create({ userId: req.userId, ...m, status: 'todo', date: new Date() })));
    res.json(toDocs(created));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── REPORTS ───────────────────────────────────────────────────────────────────

router.get('/reports', ...auth, async (req, res) => {
  try { res.json(toDocs(await Report.find({ userId: req.userId }).sort({ date: -1 }))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/reports', ...auth, async (req, res) => {
  try {
    const user = req.user;
    const { name, auditId, format = 'PDF', whiteLabel = false, meetingNotes, dateStart, dateEnd } = req.body;
    if (format.toUpperCase() === 'PDF' && user.usage.pdf.used >= user.usage.pdf.limit)
      return res.status(429).json({ error: 'Quota PDF atteint' });

    const report = await Report.create({ userId: req.userId, name, auditId, type: format.toUpperCase(), whiteLabel, meetingNotes, dateStart, dateEnd, date: new Date(), pages: 4, shared: false, pdfReady: true });
    if (format.toUpperCase() === 'PDF') { user.usage.pdf.used += 1; await user.save(); }
    await logActivity(req.userId, user.firstName, 'report', `Rapport créé : ${name}`, { reportId: report._id });
    res.status(201).json(toDoc(report));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/reports/:id', ...auth, async (req, res) => {
  try { await Report.deleteOne({ _id: req.params.id, userId: req.userId }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/reports/:id/download', ...auth, async (req, res) => {
  try {
    const r = await Report.findOne({ _id: req.params.id, userId: req.userId });
    if (!r) return res.status(404).json({ error: 'Rapport introuvable' });
    res.json({ name: r.name, type: r.type, data: toDoc(r) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/reports/:id/pdf', ...auth, async (req, res) => {
  try {
    const report = await Report.findOne({ _id: req.params.id, userId: req.userId });
    if (!report) return res.status(404).json({ error: 'Rapport introuvable' });
    let auditData = null;
    if (report.auditId) auditData = await Audit.findById(report.auditId);

    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>${report.name}</title>
<style>body{font-family:Arial,sans-serif;margin:40px;color:#1a1a2e}h1{color:#4f46e5}h2{color:#374151;border-bottom:2px solid #e5e7eb;padding-bottom:8px}.stat{background:#f9fafb;border-radius:8px;padding:16px;margin:8px 0}.score{font-size:48px;font-weight:bold;color:#4f46e5}footer{margin-top:60px;color:#9ca3af;font-size:12px;border-top:1px solid #e5e7eb;padding-top:16px}</style>
</head><body>
<h1>${report.whiteLabel ? report.name : `FlowPoint — ${report.name}`}</h1>
<p><b>Date :</b> ${new Date(report.date).toLocaleDateString('fr-FR')}</p>
${auditData ? `<h2>Résultats d'audit</h2><div class="stat"><p>URL : <b>${auditData.url}</b></p><p class="score">${auditData.score}/100</p><p>Vitesse : ${auditData.speed}/100 | Problèmes détectés : ${auditData.issues}</p></div>` : ''}
${report.meetingNotes ? `<h2>Notes de réunion</h2><p>${report.meetingNotes}</p>` : ''}
<footer>Rapport généré par FlowPoint AI • ${new Date().toLocaleDateString('fr-FR')}</footer>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(report.name)}.html"`);
    res.send(html);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/reports/:id/share', ...auth, async (req, res) => {
  try {
    const shareToken = crypto.randomUUID();
    const shareUrl   = `${FRONTEND_URL}/share/${shareToken}`;
    const r = await Report.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, { shared: true, shareUrl, shareToken }, { new: true });
    if (!r) return res.status(404).json({ error: 'Rapport introuvable' });
    res.json({ url: shareUrl, report: toDoc(r) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/share/:token', async (req, res) => {
  try {
    const r = await Report.findOne({ shareToken: req.params.token, shared: true });
    if (!r) return res.status(404).json({ error: 'Rapport partagé introuvable' });
    res.json(toDoc(r));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── TEAM ──────────────────────────────────────────────────────────────────────

router.get('/team', ...auth, async (req, res) => {
  try { res.json(toDocs(await TeamMember.find({ orgId: req.userId }))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/team/invite', ...auth, async (req, res) => {
  try {
    const { email, role = 'viewer' } = req.body;
    if (!email) return res.status(400).json({ error: 'email requis' });
    if (await TeamMember.findOne({ orgId: req.userId, email: email.toLowerCase() }))
      return res.status(409).json({ error: 'Membre déjà invité' });

    const inviteToken = crypto.randomUUID();
    const member = await TeamMember.create({ orgId: req.userId, email: email.toLowerCase(), name: email.split('@')[0], role, status: 'invited', inviteToken });
    sendEmail(email, 'Invitation à rejoindre FlowPoint', `<p>Invité par ${req.user.firstName}. <a href="${FRONTEND_URL}/invite-accept.html?token=${inviteToken}">Accepter l'invitation →</a></p>`);
    await logActivity(req.userId, req.user.firstName, 'team', `Invitation envoyée à ${email}`, { memberId: member._id });
    res.status(201).json(toDoc(member));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/team/:id', ...auth, async (req, res) => {
  try {
    const m = await TeamMember.findOneAndUpdate({ _id: req.params.id, orgId: req.userId }, req.body, { new: true });
    if (!m) return res.status(404).json({ error: 'Membre introuvable' });
    res.json(toDoc(m));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/team/:id', ...auth, async (req, res) => {
  try { await TeamMember.deleteOne({ _id: req.params.id, orgId: req.userId }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── TEAM MESSAGES / WORKSPACE ─────────────────────────────────────────────────

router.get('/workspace/messages', ...auth, async (req, res) => {
  try {
    const { channel = 'general', limit = 50 } = req.query;
    const msgs = await TeamMessage.find({ orgId: req.userId, channel }).sort({ createdAt: -1 }).limit(Number(limit));
    res.json(toDocs(msgs.reverse()));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/workspace/messages', ...auth, async (req, res) => {
  try {
    const { content, channel = 'general', attachments } = req.body;
    if (!content) return res.status(400).json({ error: 'content requis' });
    const msg = await TeamMessage.create({ orgId: req.userId, senderId: req.userId, senderName: req.user.firstName, channel, content, attachments: attachments || [] });
    sseNotify(String(req.userId), { type: 'workspace_message', data: toDoc(msg) });
    res.status(201).json(toDoc(msg));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/workspace/messages/:id', ...auth, async (req, res) => {
  try { await TeamMessage.deleteOne({ _id: req.params.id, orgId: req.userId }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/workspace/notes', ...auth, async (req, res) => {
  try { res.json(toDocs(await WorkspaceNote.find({ orgId: req.userId }).sort({ pinned: -1, updatedAt: -1 }))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/workspace/notes', ...auth, async (req, res) => {
  try {
    const { title, content, tags, pinned } = req.body;
    const note = await WorkspaceNote.create({ orgId: req.userId, authorId: req.userId, authorName: req.user.firstName, title, content, tags: tags || [], pinned: !!pinned });
    res.status(201).json(toDoc(note));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/workspace/notes/:id', ...auth, async (req, res) => {
  try {
    const n = await WorkspaceNote.findOneAndUpdate({ _id: req.params.id, orgId: req.userId }, req.body, { new: true });
    if (!n) return res.status(404).json({ error: 'Note introuvable' });
    res.json(toDoc(n));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/workspace/notes/:id', ...auth, async (req, res) => {
  try { await WorkspaceNote.deleteOne({ _id: req.params.id, orgId: req.userId }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── AI ────────────────────────────────────────────────────────────────────────

router.post('/ai/chat', ...auth, async (req, res) => {
  try {
    const user = req.user;
    if (user.aiCredits.used >= user.aiCredits.limit)
      return res.status(429).json({ error: 'Crédits IA épuisés pour ce mois' });

    const { message, context } = req.body;
    if (!message) return res.status(400).json({ error: 'message requis' });
    if (!OPENAI_KEY) return res.json({ reply: "Assistant IA non configuré (OPENAI_API_KEY manquant)." });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `Tu es l'assistant IA de FlowPoint, expert SEO local et digital. Plan de l'utilisateur : ${user.plan}. Score SEO moyen : ${context?.avgScore || '—'}/100. Réponds en français, de façon concise et actionnable. Maximum 300 mots.` },
          { role: 'user', content: message },
        ],
        max_tokens: 400,
      }),
    });

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'Pas de réponse.';
    const tokensUsed = data.usage?.total_tokens || 0;

    user.aiCredits.used += 1; await user.save();
    await AIUsage.create({ userId: req.userId, action: 'chat', tokensUsed, cost: tokensUsed * 0.00000015, createdAt: new Date() });

    res.json({ reply });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/ai/usage', ...auth, async (req, res) => {
  try {
    const usage = await AIUsage.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(50);
    const total = await AIUsage.aggregate([{ $match: { userId: req.user._id } }, { $group: { _id: null, tokens: { $sum: '$tokensUsed' }, cost: { $sum: '$cost' } } }]);
    res.json({ history: toDocs(usage), total: total[0] || { tokens: 0, cost: 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── KEYWORDS ──────────────────────────────────────────────────────────────────

router.get('/keywords', ...auth, async (req, res) => {
  try { res.json(toDocs(await Keyword.find({ userId: req.userId }).sort({ position: 1 }))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/keywords', ...auth, async (req, res) => {
  try {
    const { keyword, url, volume, difficulty, tags } = req.body;
    if (!keyword) return res.status(400).json({ error: 'keyword requis' });
    const position = Math.floor(Math.random() * 50) + 1;
    const kw = await Keyword.create({ userId: req.userId, keyword, url, volume: volume || Math.floor(Math.random()*5000), difficulty: difficulty || Math.floor(Math.random()*100), position, trend: 'stable', tags: tags || [], history: [{ date: new Date(), position }] });
    res.status(201).json(toDoc(kw));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/keywords/:id', ...auth, async (req, res) => {
  try {
    const kw = await Keyword.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, req.body, { new: true });
    if (!kw) return res.status(404).json({ error: 'Mot-clé introuvable' });
    res.json(toDoc(kw));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/keywords/:id', ...auth, async (req, res) => {
  try { await Keyword.deleteOne({ _id: req.params.id, userId: req.userId }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/keywords/analyse', ...auth, async (req, res) => {
  try {
    const user = req.user;
    if (user.aiCredits.used >= user.aiCredits.limit) return res.status(429).json({ error: 'Crédits IA épuisés' });
    const keywords = await Keyword.find({ userId: req.userId }).limit(20);
    if (!keywords.length) return res.json({ insights: 'Aucun mot-clé suivi pour le moment.' });

    let insights = `Analyse de ${keywords.length} mots-clés : ${keywords.map(k=>k.keyword).join(', ')}.`;
    if (OPENAI_KEY) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Analyse les mots-clés SEO et donne 3 insights actionnables en français. Max 200 mots.' },
            { role: 'user', content: keywords.map(k=>`${k.keyword} (pos:${k.position}, vol:${k.volume})`).join('\n') },
          ],
          max_tokens: 300,
        }),
      });
      const data = await response.json();
      insights = data.choices?.[0]?.message?.content || insights;
      user.aiCredits.used += 1; await user.save();
    }
    res.json({ insights });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── COMPETITORS ───────────────────────────────────────────────────────────────

router.get('/competitors', ...auth, async (req, res) => {
  try { res.json(toDocs(await Competitor.find({ userId: req.userId }))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/competitors', ...auth, async (req, res) => {
  try {
    const { url, name } = req.body;
    if (!url) return res.status(400).json({ error: 'url requis' });
    const { score } = simScore(url);
    const comp = await Competitor.create({ userId: req.userId, url, name: name || url, score, traffic: Math.floor(Math.random()*100000), keywords: Math.floor(Math.random()*5000), backlinks: Math.floor(Math.random()*10000), status: 'tracked', lastCheck: new Date() });
    res.status(201).json(toDoc(comp));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/competitors/:id', ...auth, async (req, res) => {
  try {
    const c = await Competitor.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, req.body, { new: true });
    if (!c) return res.status(404).json({ error: 'Concurrent introuvable' });
    res.json(toDoc(c));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/competitors/:id', ...auth, async (req, res) => {
  try { await Competitor.deleteOne({ _id: req.params.id, userId: req.userId }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── LOCAL SEO ─────────────────────────────────────────────────────────────────

router.get('/local-seo', ...auth, async (req, res) => {
  try {
    let profile = await LocalSeo.findOne({ userId: req.userId });
    if (!profile) profile = await LocalSeo.create({ userId: req.userId });
    res.json(toDoc(profile));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/local-seo', ...auth, async (req, res) => {
  try {
    const profile = await LocalSeo.findOneAndUpdate({ userId: req.userId }, req.body, { new: true, upsert: true });
    res.json(toDoc(profile));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ALERT RULES ───────────────────────────────────────────────────────────────

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
    const r = await AlertRule.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, req.body, { new: true });
    if (!r) return res.status(404).json({ error: 'Règle introuvable' });
    res.json(toDoc(r));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/alert-rules/:id', ...auth, async (req, res) => {
  try { await AlertRule.deleteOne({ _id: req.params.id, userId: req.userId }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/alert-events', ...auth, async (req, res) => {
  try { res.json(toDocs(await AlertEvent.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(50))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/alert-events/:id/resolve', ...auth, async (req, res) => {
  try {
    const ev = await AlertEvent.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, { resolved: true, resolvedAt: new Date() }, { new: true });
    if (!ev) return res.status(404).json({ error: 'Alerte introuvable' });
    res.json(toDoc(ev));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ACTIVITY ──────────────────────────────────────────────────────────────────

router.get('/activity', ...auth, async (req, res) => {
  try { res.json(toDocs(await ActivityEvent.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(100))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/activity', ...auth, async (req, res) => {
  try {
    const { type, label, targetId, targetType, metadata } = req.body;
    const ev = await ActivityEvent.create({ userId: req.userId, userName: req.user.firstName, type, label, targetId, targetType, metadata: metadata || {}, createdAt: new Date() });
    res.status(201).json(toDoc(ev));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────

router.get('/notifications', ...auth, async (req, res) => {
  try { res.json(toDocs(await Notification.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(50))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/notifications/:id/read', ...auth, async (req, res) => {
  try {
    const n = await Notification.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, { read: true }, { new: true });
    if (!n) return res.status(404).json({ error: 'Notification introuvable' });
    res.json(toDoc(n));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/notifications/read-all', ...auth, async (req, res) => {
  try { await Notification.updateMany({ userId: req.userId, read: false }, { read: true }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/notifications/:id', ...auth, async (req, res) => {
  try { await Notification.deleteOne({ _id: req.params.id, userId: req.userId }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CONNECTORS ────────────────────────────────────────────────────────────────

router.get('/connectors', ...auth, async (req, res) => {
  try { res.json(toDocs(await Connector.find({ userId: req.userId }))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/connectors', ...auth, async (req, res) => {
  try {
    const { type, name, config } = req.body;
    if (!type) return res.status(400).json({ error: 'type requis' });
    const conn = await Connector.create({ userId: req.userId, type, name: name || type, config: config || {}, status: 'active' });
    await logActivity(req.userId, req.user.firstName, 'connector', `Connecteur ajouté : ${name || type}`);
    res.status(201).json(toDoc(conn));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/connectors/:id', ...auth, async (req, res) => {
  try {
    const c = await Connector.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, req.body, { new: true });
    if (!c) return res.status(404).json({ error: 'Connecteur introuvable' });
    res.json(toDoc(c));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/connectors/:id', ...auth, async (req, res) => {
  try { await Connector.deleteOne({ _id: req.params.id, userId: req.userId }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/connectors/:id/sync', ...auth, async (req, res) => {
  try {
    const c = await Connector.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, { lastSync: new Date(), status: 'active' }, { new: true });
    if (!c) return res.status(404).json({ error: 'Connecteur introuvable' });
    res.json({ ok: true, connector: toDoc(c) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── BILLING ───────────────────────────────────────────────────────────────────

router.get('/billing/config', (req, res) => {
  res.json({ publishableKey: STRIPE_PUB, prices: STRIPE_PRICES });
});

router.post('/billing/checkout', ...auth, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Stripe non configuré' });
    const { plan, addons = [] } = req.body;
    const priceId = STRIPE_PRICES[plan];
    if (!priceId) return res.status(400).json({ error: 'Plan invalide' });

    const user = req.user;
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, name: user.firstName });
      customerId = customer.id; user.stripeCustomerId = customerId; await user.save();
    }

    const lineItems = [{ price: priceId, quantity: 1 }];
    for (const addon of addons) {
      const addonPriceId = ADDON_PRICE_IDS[addon.key] || addon.priceId;
      if (addonPriceId) lineItems.push({ price: addonPriceId, quantity: addon.quantity || 1 });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId, mode: 'subscription',
      line_items: lineItems,
      subscription_data: { trial_period_days: 14 },
      success_url: `${FRONTEND_URL}/checkout-return.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${FRONTEND_URL}/pricing.html?canceled=1`,
    });
    res.json({ url: session.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/billing/checkout-embedded', ...auth, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Stripe non configuré' });
    const { plan, addons = [] } = req.body;
    const priceId = STRIPE_PRICES[plan];
    if (!priceId) return res.status(400).json({ error: 'Plan invalide' });

    const user = req.user;
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, name: user.firstName });
      customerId = customer.id; user.stripeCustomerId = customerId; await user.save();
    }

    const lineItems = [{ price: priceId, quantity: 1 }];
    for (const addon of addons) {
      const addonPriceId = ADDON_PRICE_IDS[addon.key] || addon.priceId;
      if (addonPriceId) lineItems.push({ price: addonPriceId, quantity: addon.quantity || 1 });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId, mode: 'subscription', ui_mode: 'embedded',
      line_items: lineItems,
      subscription_data: { trial_period_days: 14 },
      return_url: `${FRONTEND_URL}/checkout-return.html?session_id={CHECKOUT_SESSION_ID}`,
    });
    res.json({ clientSecret: session.client_secret });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/billing/verify', ...auth, async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!stripe || !session_id) return res.status(400).json({ error: 'session_id requis' });
    const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ['subscription'] });
    if (session.payment_status === 'paid' || session.status === 'complete') {
      const sub = session.subscription;
      if (sub && typeof sub === 'object') {
        const items = sub.items?.data || [];
        let plan = 'standard';
        for (const item of items) {
          const nick = (item.price?.nickname || item.price?.id || '').toLowerCase();
          if (nick.includes('ultra')) { plan = 'ultra'; break; }
          if (nick.includes('pro'))   { plan = 'pro';   break; }
        }
        const L = PLAN_LIMITS[plan];
        req.user.plan = plan;
        req.user.subscriptionStatus = sub.status === 'trialing' ? 'trial' : 'active';
        req.user.stripeSubscriptionId = sub.id;
        req.user.usage.audit.limit   = L.audit;
        req.user.usage.pdf.limit     = L.pdf;
        req.user.usage.exports.limit = L.exports;
        req.user.usage.monitor.limit = L.monitor;
        req.user.aiCredits.limit     = L.aiCredits;
        await req.user.save();
      }
      return res.json({ ok: true, status: session.status, user: userPayload(req.user) });
    }
    res.json({ ok: false, status: session.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/billing/portal', ...auth, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Stripe non configuré' });
    let customerId = req.user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: req.user.email, name: req.user.firstName });
      customerId = customer.id; req.user.stripeCustomerId = customerId; await req.user.save();
    }
    const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${FRONTEND_URL}/billing.html` });
    res.json({ url: session.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/billing/subscription', ...auth, async (req, res) => {
  try {
    const u = req.user;
    if (!stripe || !u.stripeSubscriptionId) {
      return res.json({ plan: u.plan, status: u.subscriptionStatus, trialEndsAt: u.trialEndsAt, usage: u.usage, addons: u.addons });
    }
    const sub = await stripe.subscriptions.retrieve(u.stripeSubscriptionId, { expand: ['items.data.price'] });
    res.json({ plan: u.plan, status: sub.status, currentPeriodEnd: new Date(sub.current_period_end * 1000), usage: u.usage, addons: u.addons, items: sub.items.data.map(i=>({ priceId: i.price.id, nickname: i.price.nickname, quantity: i.quantity })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/billing/addon', ...auth, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Stripe non configuré' });
    const { addonKey, quantity = 1 } = req.body;
    const priceId = ADDON_PRICE_IDS[addonKey];
    if (!priceId) return res.status(400).json({ error: 'Add-on invalide' });
    if (!req.user.stripeSubscriptionId) return res.status(400).json({ error: 'Aucun abonnement actif' });

    const sub = await stripe.subscriptions.retrieve(req.user.stripeSubscriptionId);
    const existingItem = sub.items.data.find(i => i.price.id === priceId);

    if (existingItem) {
      await stripe.subscriptionItems.update(existingItem.id, { quantity: existingItem.quantity + quantity });
    } else {
      await stripe.subscriptionItems.create({ subscription: req.user.stripeSubscriptionId, price: priceId, quantity });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── EXPORT ────────────────────────────────────────────────────────────────────

router.get('/export/:type', ...auth, async (req, res) => {
  try {
    const user = req.user;
    if (user.usage.exports.used >= user.usage.exports.limit)
      return res.status(429).json({ error: "Quota d'exports atteint" });

    const { type } = req.params;
    const { format = 'json' } = req.query;
    let data = [];
    if (type === 'audits')      data = await Audit.find({ userId: req.userId });
    else if (type === 'monitors')   data = await Monitor.find({ userId: req.userId });
    else if (type === 'reports')    data = await Report.find({ userId: req.userId });
    else if (type === 'keywords')   data = await Keyword.find({ userId: req.userId });
    else if (type === 'competitors')data = await Competitor.find({ userId: req.userId });
    else return res.status(400).json({ error: 'Type invalide (audits|monitors|reports|keywords|competitors)' });

    user.usage.exports.used += 1; await user.save();

    if (format === 'csv' && data.length > 0) {
      const docs = toDocs(data);
      const keys = Object.keys(docs[0]).filter(k => typeof docs[0][k] !== 'object');
      const csv  = [keys.join(','), ...docs.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${type}.csv"`);
      return res.send('\uFEFF' + csv);
    }
    res.json(toDocs(data));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HEALTH ────────────────────────────────────────────────────────────────────

router.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString(), mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

// ── MOUNT ROUTER ──────────────────────────────────────────────────────────────

app.use('/api', router);

// ── STATIC FRONTEND ───────────────────────────────────────────────────────────

const FRONTEND_DIR = path.join(__dirname, 'frontend');
app.use(express.static(FRONTEND_DIR));

// SPA fallback for dashboard pages
app.get('/dashboard', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'dashboard.html')));
app.get('/billing',   (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'billing.html')));
app.get('/login',     (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'login.html')));
app.get('/pricing',   (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'pricing.html')));

// 404 handler
app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: `Route introuvable : ${req.method} ${req.path}` });
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// Error handler
app.use((err, req, res, _next) => {
  console.error('[FP] Error:', err);
  res.status(500).json({ error: err.message || 'Erreur interne' });
});

// ── MONITOR CRON (toutes les 5 minutes) ──────────────────────────────────────

async function runMonitorChecks() {
  try {
    const monitors = await Monitor.find({ paused: { $ne: true } });
    for (const monitor of monitors) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const start = Date.now();
        let ok = true; let statusCode = 200; let error = null;

        try {
          const r = await fetch(monitor.url, { signal: controller.signal, redirect: 'follow' });
          statusCode = r.status;
          ok = r.ok;
        } catch (err) {
          ok = false; error = err.message; statusCode = 0;
        } finally {
          clearTimeout(timeout);
        }

        const latency = Date.now() - start;
        const prevStatus = monitor.status;
        const newStatus  = !ok ? 'down' : latency > 3000 ? 'warn' : 'up';

        monitor.status = newStatus; monitor.latency = latency; monitor.lastCheck = new Date();
        if (newStatus === 'up') {
          const total = (monitor.uptime * 99 + 100) / 100;
          monitor.uptime = Math.min(100, Math.round(total * 100) / 100);
        }
        await monitor.save();
        await MonitorCheck.create({ monitorId: monitor._id, ok, latency, statusCode, error, checkedAt: new Date() });

        if (prevStatus !== 'down' && newStatus === 'down') {
          const user = await User.findById(monitor.userId);
          if (user) {
            const rule = await AlertRule.findOne({ userId: monitor.userId, type: 'uptime', enabled: true });
            if (rule) {
              await AlertEvent.create({ userId: monitor.userId, ruleId: rule._id, type: 'uptime', message: `Monitor DOWN : ${monitor.name || monitor.url}`, severity: 'error', resolved: false, siteUrl: monitor.url });
            }
            if (monitor.alertEmail || user.email) {
              await sendEmail(monitor.alertEmail || user.email, `🔴 Monitor DOWN : ${monitor.name || monitor.url}`,
                `<h2>Alerte FlowPoint</h2><p><b>${monitor.name || monitor.url}</b> est inaccessible.</p><p>Heure : ${new Date().toLocaleString('fr-FR')}</p><p><a href="${FRONTEND_URL}">Voir le dashboard →</a></p>`);
            }
            await pushNotif(monitor.userId, 'monitor', 'Monitor DOWN', `${monitor.name || monitor.url} est inaccessible`, '#monitors');
            sseNotify(String(monitor.userId), { type: 'monitor_down', data: { monitorId: String(monitor._id), url: monitor.url, name: monitor.name } });
          }
        }
      } catch (e) { console.warn('[FP] Monitor check error:', monitor.url, e.message); }
    }
  } catch (e) { console.warn('[FP] Monitor cron error:', e.message); }
}

// ── SCHEDULED AUDIT CRON (toutes les heures) ─────────────────────────────────

async function runScheduledAudits() {
  try {
    const now = new Date();
    const schedules = await AuditSchedule.find({ enabled: true, nextRun: { $lte: now } });
    for (const sched of schedules) {
      try {
        const user = await User.findById(sched.userId);
        if (!user || user.usage.audit.used >= user.usage.audit.limit) continue;

        const { score, speed, issues } = simScore(sched.url);
        await Audit.create({ userId: sched.userId, url: sched.url, score, speed, issues, status: scoreStatus(score), origin: 'scheduled', date: now, archived: false });
        user.usage.audit.used += 1; await user.save();

        sched.lastRun = now;
        sched.nextRun = calcNextRun(sched.frequency);
        await sched.save();
        await pushNotif(sched.userId, 'audit', 'Audit planifié terminé', `${sched.url} — score ${score}/100`, '#audits');
      } catch (e) { console.warn('[FP] Scheduled audit error:', e.message); }
    }
  } catch (e) { console.warn('[FP] Audit cron error:', e.message); }
}

// ── BOOT ──────────────────────────────────────────────────────────────────────

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('[FP] ✅ MongoDB connecté');
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[FP] 🚀 Serveur démarré → http://localhost:${PORT}`);
    });

    // Start crons
    cron.schedule('*/5 * * * *', runMonitorChecks);
    cron.schedule('0 * * * *',   runScheduledAudits);
    console.log('[FP] ✅ Crons démarrés (monitors: 5min, audits: 1h)');
  })
  .catch(err => {
    console.error('[FP] ❌ MongoDB erreur:', err.message);
    process.exit(1);
  });
