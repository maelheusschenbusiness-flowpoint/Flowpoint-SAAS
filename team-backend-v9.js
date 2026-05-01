// FlowPoint Team Backend V9
// Real workspace persistence for channels, messages, documents, notes, calendar, members,
// invites, activity, unread notifications and manager analytics.

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const ObjectId = mongoose.Schema.Types.ObjectId;

function getModel(name, schema, collection) {
  return mongoose.models[name] || mongoose.model(name, schema, collection);
}

const TeamChannelSchema = new mongoose.Schema({
  orgId: { type: ObjectId, index: true, required: true },
  name: { type: String, required: true },
  slug: { type: String, index: true, required: true },
  description: { type: String, default: "" },
  topic: { type: String, default: "Coordination" },
  isPrivate: { type: Boolean, default: false },
  createdByUserId: { type: ObjectId, index: true },
  archivedAt: Date,
}, { timestamps: true, collection: "teamchannels" });
TeamChannelSchema.index({ orgId: 1, slug: 1 }, { unique: true });

const TeamMessageSchema = new mongoose.Schema({
  orgId: { type: ObjectId, index: true, required: true },
  channelId: { type: ObjectId, index: true, required: true },
  userId: { type: ObjectId, index: true },
  authorName: { type: String, default: "Membre" },
  role: { type: String, default: "owner" },
  text: { type: String, default: "" },
  files: [{ name: String, type: String, size: String, url: String, key: String }],
  decision: { type: Boolean, default: false },
  pinned: { type: Boolean, default: false },
}, { timestamps: true, collection: "teammessages" });

const TeamNoteSchema = new mongoose.Schema({
  orgId: { type: ObjectId, index: true, required: true },
  userId: { type: ObjectId, index: true },
  title: { type: String, required: true },
  text: { type: String, default: "" },
  type: { type: String, default: "Décision" },
  priority: { type: String, default: "Moyenne" },
  tags: { type: [String], default: [] },
  checklist: { type: [String], default: [] },
  ownerUserId: { type: ObjectId, index: true },
  pinned: { type: Boolean, default: false },
  archivedAt: Date,
}, { timestamps: true, collection: "teamnotes" });

const TeamEventSchema = new mongoose.Schema({
  orgId: { type: ObjectId, index: true, required: true },
  userId: { type: ObjectId, index: true },
  title: { type: String, required: true },
  date: { type: String, index: true, required: true },
  time: { type: String, default: "09:00" },
  type: { type: String, default: "meeting" },
  description: { type: String, default: "" },
  assignee: { type: String, default: "" },
  ownerUserId: { type: ObjectId, index: true },
  done: { type: Boolean, default: false },
}, { timestamps: true, collection: "teamevents" });

const TeamMemberProfileSchema = new mongoose.Schema({
  orgId: { type: ObjectId, index: true, required: true },
  userId: { type: ObjectId, index: true, required: true },
  displayName: String,
  title: { type: String, default: "Direction produit" },
  teamRole: { type: String, default: "Owner" },
  status: { type: String, enum: ["online", "offline"], default: "online" },
  bio: { type: String, default: "Compte principal du workspace." },
  focus: { type: String, default: "Pilotage workspace" },
  skills: { type: [String], default: ["Direction", "Décision", "Coordination"] },
  restrictions: { type: [String], default: [] },
  load: { type: Number, default: 68 },
  lastSeenAt: Date,
}, { timestamps: true, collection: "teammemberprofiles" });
TeamMemberProfileSchema.index({ orgId: 1, userId: 1 }, { unique: true });

const TeamInviteSchema = new mongoose.Schema({
  orgId: { type: ObjectId, index: true, required: true },
  email: { type: String, index: true, required: true },
  emailNormalized: { type: String, index: true, required: true },
  name: { type: String, default: "" },
  role: { type: String, default: "Viewer" },
  tokenHash: { type: String, unique: true, index: true },
  tokenPreview: String,
  status: { type: String, enum: ["pending", "accepted", "cancelled", "expired"], default: "pending" },
  createdByUserId: { type: ObjectId, index: true },
  acceptedByUserId: { type: ObjectId, index: true },
  acceptedAt: Date,
  expiresAt: Date,
}, { timestamps: true, collection: "teaminvites" });

const TeamActivitySchema = new mongoose.Schema({
  orgId: { type: ObjectId, index: true, required: true },
  userId: { type: ObjectId, index: true },
  type: { type: String, default: "action" },
  title: { type: String, required: true },
  text: { type: String, default: "" },
  entityType: String,
  entityId: ObjectId,
  readBy: [{ userId: ObjectId, readAt: Date }],
}, { timestamps: true, collection: "teamactivities" });

const TeamChannel = getModel("TeamChannel", TeamChannelSchema);
const TeamMessage = getModel("TeamMessage", TeamMessageSchema);
const TeamNote = getModel("TeamNote", TeamNoteSchema);
const TeamEvent = getModel("TeamEvent", TeamEventSchema);
const TeamMemberProfile = getModel("TeamMemberProfile", TeamMemberProfileSchema);
const TeamInvite = getModel("TeamInvite", TeamInviteSchema);
const TeamActivity = getModel("TeamActivity", TeamActivitySchema);

function normalizedEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function slugify(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || `channel-${Date.now()}`;
}

function planRank(plan) {
  const p = String(plan || "standard").toLowerCase();
  if (p.includes("ultra")) return 3;
  if (p.includes("pro")) return 2;
  return 1;
}

function teamSeatLimit(user, org) {
  const p = String(user?.plan || "standard").toLowerCase();
  const base = p.includes("ultra") ? 10 : 1;
  return base + Number(org?.billingAddons?.extraSeats || 0);
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function initials(name, email) {
  const src = String(name || email || "FP").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts.slice(0, 2).map(x => x[0]) : [src[0] || "F"]).join("").toUpperCase();
}

function cleanString(v, max = 300) {
  return String(v || "").replace(/[\r\u0000]/g, "").trim().slice(0, max);
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function auth(req, res, next) {
  try {
    const h = String(req.headers.authorization || "");
    const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
    if (!token) return res.status(401).json({ error: "Non autorisé" });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const User = mongoose.models.User;
    const Org = mongoose.models.Org;
    const user = await User.findById(decoded.uid);
    if (!user) return res.status(401).json({ error: "Utilisateur introuvable" });
    const org = await Org.findById(user.orgId);
    if (!org) return res.status(404).json({ error: "Organisation introuvable" });
    if (user.accessBlocked) return res.status(402).json({ error: "Accès bloqué", code: "ACCESS_BLOCKED" });
    req.fpUser = user;
    req.fpOrg = org;
    next();
  } catch (_e) {
    return res.status(401).json({ error: "Token invalide" });
  }
}

async function log(orgId, userId, title, text, type = "action", entityType, entityId) {
  return TeamActivity.create({ orgId, userId, title, text, type, entityType, entityId });
}

async function ensureBaseWorkspace(user, org) {
  const orgId = org._id;
  const existing = await TeamChannel.countDocuments({ orgId });
  if (!existing) {
    const channels = await TeamChannel.insertMany([
      { orgId, name: "general", slug: "general", description: "Annonces, coordination et décisions visibles.", topic: "Coordination", createdByUserId: user._id },
      { orgId, name: "seo", slug: "seo", description: "Quick wins, pages locales et contenu.", topic: "SEO", createdByUserId: user._id },
      { orgId, name: "dev", slug: "dev", description: "Bugs, stabilité et intégrations.", topic: "Tech", createdByUserId: user._id },
      { orgId, name: "planning", slug: "planning", description: "Planning et deadlines.", topic: "Planning", isPrivate: true, createdByUserId: user._id },
    ]);
    await TeamMessage.create({ orgId, channelId: channels[0]._id, userId: user._id, authorName: user.name || user.email, role: user.role || "owner", text: "Workspace équipe initialisé. Les échanges, notes et événements sont synchronisés côté backend." });
    await TeamNote.create({ orgId, userId: user._id, title: "Playbook équipe", type: "Process", priority: "Haute", tags: ["Ops", "Décision"], checklist: ["Clarifier", "Documenter", "Exécuter"], text: "Canal général = annonces. SEO = quick wins. Dev = technique. Planning = deadlines.\n\nToujours garder une trace des décisions, documents clés et prochaines actions.", pinned: true });
    await TeamEvent.create({ orgId, userId: user._id, title: "Revue équipe", date: todayIso(), time: "09:00", type: "meeting", description: "Point équipe sur priorités et déblocages.", assignee: user.name || user.email });
    await log(orgId, user._id, "Workspace créé", "Base équipe backend prête.", "system");
  }
  await TeamMemberProfile.updateOne(
    { orgId, userId: user._id },
    { $setOnInsert: { orgId, userId: user._id, displayName: user.name || user.email, teamRole: user.role === "owner" ? "Owner" : "Member", lastSeenAt: new Date() }, $set: { status: "online", lastSeenAt: new Date() } },
    { upsert: true }
  );
}

async function serializeState(user, org) {
  await ensureBaseWorkspace(user, org);
  const orgId = org._id;
  const [channels, messages, notes, events, profiles, invites, activities, users] = await Promise.all([
    TeamChannel.find({ orgId, archivedAt: null }).sort({ createdAt: 1 }).lean(),
    TeamMessage.find({ orgId }).sort({ createdAt: 1 }).limit(500).lean(),
    TeamNote.find({ orgId, archivedAt: null }).sort({ pinned: -1, updatedAt: -1 }).limit(200).lean(),
    TeamEvent.find({ orgId }).sort({ date: 1, time: 1 }).limit(300).lean(),
    TeamMemberProfile.find({ orgId }).sort({ createdAt: 1 }).lean(),
    TeamInvite.find({ orgId }).sort({ createdAt: -1 }).limit(100).lean(),
    TeamActivity.find({ orgId }).sort({ createdAt: -1 }).limit(80).lean(),
    mongoose.models.User.find({ orgId }).select("email name role plan").lean(),
  ]);
  const usersById = new Map(users.map(u => [String(u._id), u]));
  const channelIdToSlug = new Map(channels.map(c => [String(c._id), c.slug]));
  const unread = activities.filter(a => !(a.readBy || []).some(r => String(r.userId) === String(user._id))).length;
  return {
    serverVersion: "team-v9",
    plan: user.plan || "standard",
    permissions: {
      planRank: planRank(user.plan),
      seatLimit: teamSeatLimit(user, org),
      canInvite: true,
      canUseAi: planRank(user.plan) >= 2,
      canUseWarRoom: planRank(user.plan) >= 2,
      canUseForecast: planRank(user.plan) >= 3,
    },
    quotas: {
      teamSeats: { used: users.length, limit: teamSeatLimit(user, org) },
      invitesPending: invites.filter(i => i.status === "pending").length,
    },
    channels: channels.map(c => ({ id: c.slug, dbId: c._id, name: c.name, desc: c.description, private: c.isPrivate, topic: c.topic })),
    messages: messages.map(m => ({ id: m._id, channel: channelIdToSlug.get(String(m.channelId)) || "general", author: m.authorName, role: m.role, text: m.text, files: m.files || [], date: +new Date(m.createdAt), decision: m.decision, pinned: m.pinned })),
    notes: notes.map(n => ({ id: n._id, title: n.title, text: n.text, type: n.type, priority: n.priority, tags: n.tags, checklist: n.checklist, author: usersById.get(String(n.userId))?.name || user.name || "FlowPoint", pinned: n.pinned, date: +new Date(n.updatedAt || n.createdAt) })),
    events: events.map(e => ({ id: e._id, title: e.title, date: e.date, time: e.time, type: e.type, desc: e.description, assignee: e.assignee, done: e.done })),
    members: profiles.map(p => { const u = usersById.get(String(p.userId)); return { id: p.userId, name: p.displayName || u?.name || u?.email || "Membre", email: u?.email, title: p.title, role: p.teamRole, status: p.status, initials: initials(p.displayName || u?.name, u?.email), bio: p.bio, focus: p.focus, load: p.load, skills: p.skills || [], restrictions: p.restrictions || [], activity: p.status === "online" ? "Session active" : "Hors ligne" }; }),
    invites: invites.map(i => ({ id: i._id, email: i.email, name: i.name, role: i.role, status: i.status, token: i.tokenPreview, date: +new Date(i.createdAt) })),
    activity: activities.map(a => ({ id: a._id, type: a.type, title: a.title, text: a.text, date: +new Date(a.createdAt), read: (a.readBy || []).some(r => String(r.userId) === String(user._id)) })),
    analytics: buildAnalytics({ channels, messages, notes, events, profiles, invites, activities, unread, user }),
  };
}

function buildAnalytics({ channels, messages, notes, events, profiles, invites, activities, unread, user }) {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthEvents = events.filter(e => String(e.date || "").startsWith(month));
  const missingOwners = notes.filter(n => !n.ownerUserId && !n.userId).length + events.filter(e => !e.assignee).length;
  const blockages = Math.min(9, Math.max(0, missingOwners + invites.filter(i => i.status === "pending").length));
  const score = Math.max(35, Math.min(98, 82 - blockages * 4 + Math.min(8, messages.length)));
  return {
    healthScore: score,
    unread,
    channels: channels.length,
    messages: messages.length,
    notes: notes.length,
    events: events.length,
    monthEvents: monthEvents.length,
    meetings: events.filter(e => e.type === "meeting").length,
    pendingInvites: invites.filter(i => i.status === "pending").length,
    onlineMembers: profiles.filter(p => p.status === "online").length,
    blockages,
    recommendation: blockages ? "Assigne les owners manquants et transforme les décisions en actions." : "Workspace propre. Continue à lier notes, décisions et événements.",
    upsell: planRank(user.plan) === 1 ? "Pro débloque IA, restrictions, relances et war-room." : planRank(user.plan) === 2 ? "Ultra ajoute forecast, audit avancé et reporting client." : "Ultra actif : pilotage avancé disponible.",
  };
}

async function getChannelBySlug(orgId, slug) {
  const ch = await TeamChannel.findOne({ orgId, slug: slugify(slug), archivedAt: null });
  if (!ch) throw new Error("Canal introuvable");
  return ch;
}

module.exports = function registerTeamBackendV9(app) {
  app.get("/api/team/state", auth, async (req, res) => {
    try { res.json(await serializeState(req.fpUser, req.fpOrg)); }
    catch (e) { console.error("team/state", e); res.status(500).json({ error: "Erreur chargement équipe" }); }
  });

  app.post("/api/team/channels", auth, async (req, res) => {
    try {
      const name = cleanString(req.body?.name, 60) || "nouveau-canal";
      let slug = slugify(name);
      let suffix = 2;
      while (await TeamChannel.exists({ orgId: req.fpOrg._id, slug })) slug = `${slugify(name)}-${suffix++}`;
      const ch = await TeamChannel.create({ orgId: req.fpOrg._id, name, slug, description: cleanString(req.body?.description, 220), topic: cleanString(req.body?.topic, 80) || "Coordination", isPrivate: !!req.body?.private, createdByUserId: req.fpUser._id });
      await log(req.fpOrg._id, req.fpUser._id, "Canal créé", `#${name} a été ajouté.`, "channel", "channel", ch._id);
      res.status(201).json({ ok: true, channel: ch });
    } catch (e) { res.status(400).json({ error: e.message || "Canal impossible" }); }
  });

  app.post("/api/team/messages", auth, async (req, res) => {
    try {
      const channel = await getChannelBySlug(req.fpOrg._id, req.body?.channel || "general");
      const text = cleanString(req.body?.text, 4000);
      if (!text) return res.status(400).json({ error: "Message vide" });
      const files = Array.isArray(req.body?.files) ? req.body.files.slice(0, 8).map(f => ({ name: cleanString(f.name, 160), type: cleanString(f.type, 40), size: cleanString(f.size, 40), url: cleanString(f.url, 300), key: cleanString(f.key, 120) })) : [];
      const msg = await TeamMessage.create({ orgId: req.fpOrg._id, channelId: channel._id, userId: req.fpUser._id, authorName: req.fpUser.name || req.fpUser.email, role: req.fpUser.role || "owner", text, files, decision: /décision|decision|valide|à faire|todo/i.test(text) });
      await log(req.fpOrg._id, req.fpUser._id, "Message posté", `Message ajouté dans #${channel.slug}.`, "message", "message", msg._id);
      res.status(201).json({ ok: true, message: msg });
    } catch (e) { res.status(400).json({ error: e.message || "Message impossible" }); }
  });

  app.post("/api/team/notes", auth, async (req, res) => {
    try {
      const note = await TeamNote.create({ orgId: req.fpOrg._id, userId: req.fpUser._id, title: cleanString(req.body?.title, 120) || "Nouvelle note", text: cleanString(req.body?.text, 5000), type: cleanString(req.body?.type, 60) || "Décision", priority: cleanString(req.body?.priority, 40) || "Moyenne", tags: Array.isArray(req.body?.tags) ? req.body.tags.slice(0, 12).map(x => cleanString(x, 30)) : [], checklist: Array.isArray(req.body?.checklist) ? req.body.checklist.slice(0, 20).map(x => cleanString(x, 80)) : ["Décision", "Responsable", "Prochaine étape"], pinned: !!req.body?.pinned });
      await log(req.fpOrg._id, req.fpUser._id, "Note créée", note.title, "note", "note", note._id);
      res.status(201).json({ ok: true, note });
    } catch (e) { res.status(400).json({ error: e.message || "Note impossible" }); }
  });

  app.patch("/api/team/notes/:id", auth, async (req, res) => {
    try {
      const update = {};
      ["title", "text", "type", "priority"].forEach(k => { if (req.body?.[k] != null) update[k] = cleanString(req.body[k], k === "text" ? 5000 : 140); });
      if (req.body?.pinned != null) update.pinned = !!req.body.pinned;
      if (req.body?.archived) update.archivedAt = new Date();
      const note = await TeamNote.findOneAndUpdate({ _id: req.params.id, orgId: req.fpOrg._id }, update, { new: true });
      if (!note) return res.status(404).json({ error: "Note introuvable" });
      await log(req.fpOrg._id, req.fpUser._id, "Note modifiée", note.title, "note", "note", note._id);
      res.json({ ok: true, note });
    } catch (e) { res.status(400).json({ error: "Modification impossible" }); }
  });

  app.post("/api/team/events", auth, async (req, res) => {
    try {
      const ev = await TeamEvent.create({ orgId: req.fpOrg._id, userId: req.fpUser._id, title: cleanString(req.body?.title, 120) || "Suivi équipe", date: cleanString(req.body?.date, 20) || todayIso(), time: cleanString(req.body?.time, 10) || "09:00", type: cleanString(req.body?.type, 40) || "meeting", description: cleanString(req.body?.description || req.body?.desc, 1200), assignee: cleanString(req.body?.assignee, 120) || (req.fpUser.name || req.fpUser.email) });
      await log(req.fpOrg._id, req.fpUser._id, "Événement ajouté", `${ev.title} · ${ev.date}`, "calendar", "event", ev._id);
      res.status(201).json({ ok: true, event: ev });
    } catch (e) { res.status(400).json({ error: e.message || "Événement impossible" }); }
  });

  app.post("/api/team/invites", auth, async (req, res) => {
    try {
      const seatLimit = teamSeatLimit(req.fpUser, req.fpOrg);
      const User = mongoose.models.User;
      const usedSeats = await User.countDocuments({ orgId: req.fpOrg._id });
      if (usedSeats >= seatLimit) return res.status(402).json({ error: "Plan insuffisant", code: "UPGRADE_REQUIRED", message: "Améliore le plan ou ajoute des sièges pour inviter plus de membres." });
      const email = normalizedEmail(req.body?.email);
      if (!email || !email.includes("@")) return res.status(400).json({ error: "Email invalide" });
      const token = crypto.randomBytes(24).toString("hex");
      const invite = await TeamInvite.create({ orgId: req.fpOrg._id, email, emailNormalized: email, name: cleanString(req.body?.name, 120), role: cleanString(req.body?.role, 40) || "Viewer", tokenHash: tokenHash(token), tokenPreview: token.slice(0, 10), status: "pending", createdByUserId: req.fpUser._id, expiresAt: new Date(Date.now() + 14 * 24 * 3600 * 1000) });
      await log(req.fpOrg._id, req.fpUser._id, "Invitation créée", `${email} invité comme ${invite.role}.`, "member", "invite", invite._id);
      res.status(201).json({ ok: true, invite: { id: invite._id, email, role: invite.role, status: invite.status, token, acceptUrl: `${String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "")}/invite-accept.html?token=${token}` } });
    } catch (e) { res.status(400).json({ error: e.message || "Invitation impossible" }); }
  });

  app.post("/api/team/invites/:token/accept", auth, async (req, res) => {
    try {
      const invite = await TeamInvite.findOne({ tokenHash: tokenHash(req.params.token), status: "pending" });
      if (!invite || invite.expiresAt < new Date()) return res.status(404).json({ error: "Invitation expirée ou introuvable" });
      if (String(invite.emailNormalized) !== normalizedEmail(req.fpUser.email)) return res.status(403).json({ error: "Cette invitation ne correspond pas à cet email" });
      req.fpUser.orgId = invite.orgId;
      req.fpUser.role = invite.role === "Owner" ? "owner" : "member";
      await req.fpUser.save();
      invite.status = "accepted"; invite.acceptedAt = new Date(); invite.acceptedByUserId = req.fpUser._id; await invite.save();
      await TeamMemberProfile.updateOne({ orgId: invite.orgId, userId: req.fpUser._id }, { $set: { displayName: req.fpUser.name || req.fpUser.email, teamRole: invite.role, status: "online", lastSeenAt: new Date() } }, { upsert: true });
      await log(invite.orgId, req.fpUser._id, "Invitation acceptée", `${req.fpUser.email} a rejoint le workspace.`, "member", "invite", invite._id);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: "Acceptation impossible" }); }
  });

  app.patch("/api/team/members/:userId", auth, async (req, res) => {
    try {
      const update = {};
      ["displayName", "title", "teamRole", "status", "bio", "focus"].forEach(k => { if (req.body?.[k] != null) update[k] = cleanString(req.body[k], 500); });
      if (Array.isArray(req.body?.skills)) update.skills = req.body.skills.slice(0, 12).map(x => cleanString(x, 40));
      if (Array.isArray(req.body?.restrictions)) update.restrictions = req.body.restrictions.slice(0, 20).map(x => cleanString(x, 60));
      if (req.body?.load != null) update.load = Math.max(0, Math.min(100, Number(req.body.load) || 0));
      update.lastSeenAt = new Date();
      const profile = await TeamMemberProfile.findOneAndUpdate({ orgId: req.fpOrg._id, userId: req.params.userId }, { $set: update }, { new: true, upsert: true });
      await log(req.fpOrg._id, req.fpUser._id, "Profil membre modifié", profile.displayName || "Membre", "member", "member", profile._id);
      res.json({ ok: true, member: profile });
    } catch (e) { res.status(400).json({ error: "Membre impossible" }); }
  });

  app.post("/api/team/activity/read", auth, async (req, res) => {
    await TeamActivity.updateMany({ orgId: req.fpOrg._id, "readBy.userId": { $ne: req.fpUser._id } }, { $push: { readBy: { userId: req.fpUser._id, readAt: new Date() } } });
    res.json({ ok: true });
  });

  app.post("/api/team/actions", auth, async (req, res) => {
    const action = cleanString(req.body?.action, 80) || "Action";
    const context = cleanString(req.body?.context, 400) || "Action équipe";
    await log(req.fpOrg._id, req.fpUser._id, action, context, "action");
    res.json({ ok: true, action: { title: action, text: context } });
  });

  app.get("/api/team/health", (_req, res) => res.json({ ok: true, version: "team-v9", collections: ["teamchannels", "teammessages", "teamnotes", "teamevents", "teammemberprofiles", "teaminvites", "teamactivities"] }));
};
