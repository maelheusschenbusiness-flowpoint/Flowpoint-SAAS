import { Router, type Request } from "express";
import { store } from "../services/store.js";
import { canWrite } from "../middlewares/requireRole.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
  orgContext?: { orgId?: string; email?: string; userId?: string; userUuid?: string };
};
// Canonical org bucket — the tenant every teammate (owner + invited member)
// shares. orgContext.orgId is authoritative (set from the verified session and
// identical for the owner and everyone they invited); fall back to req.orgId,
// then "default". Normalized (trim) so REST reads and SSE broadcasts key the
// exact same bucket and messages are never split across two org strings.
const org = (req: Request): string => {
  const ctx = (req as OrgReq).orgContext;
  const raw = ctx?.orgId ?? (req as OrgReq).orgId ?? "default";
  const s = String(raw).trim();
  return s || "default";
};
const db  = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);
// Stable identity of the requester — used to persist sender_id and to compute
// per-recipient "self" on reads. Prefers the immutable user UUID, then userId,
// then email. Trimmed so the same person always resolves to the same senderId
// regardless of whitespace/casing drift in the session record.
const requesterId = (req: Request): string => {
  const ctx = (req as OrgReq).orgContext;
  const raw = ctx?.userUuid || ctx?.userId || ctx?.email || "user";
  const s = String(raw).trim();
  return s || "user";
};
// Canonical channel form: bare lowercase name without '#' prefix ("general", "seo", …)
const normChannel = (c: unknown): string =>
  String(c ?? "general").trim().replace(/^#+/, "").toLowerCase() || "general";

const mapMsg = (m: Record<string, unknown>, self = false) => ({
  id:             m["id"],
  channel:        m["channel"],
  from:           m["sender_name"],
  text:           m["content"],
  self,
  read:           true,
  type:           m["type"],
  // Stable sender identity so each client can compute "self" locally
  // (SSE broadcast is org-wide — the server cannot know who each recipient is).
  senderId:       m["sender_id"] ?? null,
  attachmentUrl:  m["attachment_url"]  ?? null,
  attachmentName: m["attachment_name"] ?? null,
  createdAt:      m["created_at"],
});

// ── GET /team/channels — list all channels (persisted union message-derived) ──
router.get("/team/channels", async (req, res) => {
  try {
    const persistedRes = await db(req)(
      `SELECT name, created_by, created_at FROM team_channels WHERE org_id=$1 ORDER BY created_at ASC`,
      [org(req)]
    );
    let msgChannels: string[] = [];
    try {
      const msgRes = await db(req)(
        `SELECT DISTINCT channel FROM team_messages WHERE org_id=$1`,
        [org(req)]
      );
      msgChannels = msgRes.rows.map((r: Record<string, unknown>) => String(r["channel"]));
    } catch { /* team_messages may not exist */ }

    const persisted = new Set(persistedRes.rows.map((r: Record<string, unknown>) => String(r["name"])));
    const extra = msgChannels.filter(c => !persisted.has(c));

    const channels = [
      ...persistedRes.rows.map((r: Record<string, unknown>) => ({
        name:      String(r["name"]),
        createdBy: r["created_by"] ?? null,
        createdAt: r["created_at"] ?? null,
        persisted: true,
      })),
      ...extra.map(c => ({ name: c, createdBy: null, createdAt: null, persisted: false })),
    ];
    res.json(channels);
  } catch (err) {
    console.error("[team-channels] GET failed:", (err as Error)?.message);
    res.json([]);
  }
});

// ── POST /team/channels — create/persist a channel ────────────────────────────
router.post("/team/channels", canWrite, async (req, res) => {
  const { name: rawName } = req.body as { name?: string };
  if (!rawName) { res.status(400).json({ error: "name required" }); return; }
  const name = normChannel(rawName);
  const createdBy = (req as OrgReq).orgContext?.email?.split("@")[0] ?? "user";
  try {
    await db(req)(
      `INSERT INTO team_channels (org_id, name, created_by, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (org_id, name) DO NOTHING`,
      [org(req), name, createdBy]
    );
    res.status(201).json({ name, createdBy, persisted: true });
  } catch (err) {
    console.error("[team-channels] POST failed:", (err as Error)?.message);
    res.status(500).json({ error: "Failed to create channel" });
  }
});

// ── DELETE /team/channels/:name ────────────────────────────────────────────────
router.delete("/team/channels/:name", canWrite, async (req, res) => {
  const name = normChannel(req.params["name"]);
  try {
    await db(req)(`DELETE FROM team_channels WHERE org_id=$1 AND name=$2`, [org(req), name]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete channel" });
  }
});

// ── GET /team/messages ────────────────────────────────────────────────────────
router.get("/team/messages", async (req, res) => {
  try {
    const channel = normChannel(req.query["channel"]);
    const r = await db(req)(
      `SELECT id, org_id, channel, sender_id, sender_name, content, type, attachment_url, attachment_name, created_at
       FROM team_messages
       WHERE org_id=$1 AND channel=$2
       ORDER BY created_at DESC LIMIT 100`,
      [org(req), channel]
    );
    const me = requesterId(req);
    res.json(r.rows.reverse().map((m: Record<string, unknown>) => mapMsg(m, String(m["sender_id"] ?? "") === me)));
  } catch (err) {
    console.error("[team-messages] GET failed:", (err as Error)?.message);
    res.json([]);
  }
});

// ── GET /team/messages/all  — fetch all persisted channels in one request ─────
router.get("/team/messages/all", async (req, res) => {
  try {
    // Fetch channel list dynamically from team_channels, fallback to defaults.
    // Union with message-derived channels: the channel-row auto-persist in
    // POST /team/messages is best-effort, so a message whose channel row was
    // never written must still surface here instead of silently disappearing.
    let channels: string[] = ["general", "seo", "rapports", "support"];
    try {
      const chRes = await db(req)(
        `SELECT name FROM team_channels WHERE org_id=$1 ORDER BY created_at ASC`,
        [org(req)]
      );
      const names = chRes.rows.map((r: Record<string, unknown>) => String(r["name"]));
      try {
        const msgRes = await db(req)(
          `SELECT DISTINCT channel FROM team_messages WHERE org_id=$1`,
          [org(req)]
        );
        for (const r of msgRes.rows) {
          const c = String(r["channel"]);
          if (c && !names.includes(c)) names.push(c);
        }
      } catch { /* channel rows only */ }
      if (names.length > 0) channels = names;
    } catch { /* use defaults */ }

    const results: Record<string, unknown[]> = {};
    await Promise.all(channels.map(async ch => {
      try {
        const r = await db(req)(
          `SELECT id, org_id, channel, sender_id, sender_name, content, type, attachment_url, attachment_name, created_at
           FROM team_messages
           WHERE org_id=$1 AND channel=$2
           ORDER BY created_at DESC LIMIT 100`,
          [org(req), ch]
        );
        const me = requesterId(req);
        results[ch] = r.rows.reverse().map((m: Record<string, unknown>) => mapMsg(m, String(m["sender_id"] ?? "") === me));
      } catch (err) {
        console.error(`[team-messages] GET-all channel ${ch} failed:`, (err as Error)?.message);
        results[ch] = [];
      }
    }));
    res.json(results);
  } catch (err) {
    console.error("[team-messages] GET-all failed:", (err as Error)?.message);
    res.json({ general: [], seo: [], rapports: [], support: [] });
  }
});

// ── POST /team/messages ───────────────────────────────────────────────────────
router.post("/team/messages", canWrite, async (req, res) => {
  const { channel: rawChannel = "general", text, attachmentUrl, attachmentName } =
    req.body as { channel?: string; from?: string; text?: string; attachmentUrl?: string; attachmentName?: string };
  const channel = normChannel(rawChannel);
  if (!text && !attachmentUrl) { res.status(400).json({ error: "text or attachmentUrl required" }); return; }
  const senderName = (req as OrgReq).orgContext?.email?.split("@")[0] ?? "Équipe";
  const senderId = requesterId(req);
  const id = "msg" + Date.now();
  try {
    // Auto-persist the channel so it always appears in the channel list.
    // AWAITED (not fire-and-forget): /team/messages/all derives its channel
    // list from team_channels, so a recipient refreshing right after this POST
    // must already find the row — otherwise the message exists but its channel
    // is missing from the response and the chat looks empty.
    await db(req)(
      `INSERT INTO team_channels (org_id, name, created_by, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (org_id, name) DO NOTHING`,
      [org(req), channel, senderName]
    ).catch(() => {});

    await db(req)(
      `INSERT INTO team_messages (id, org_id, channel, sender_id, sender_name, content, type, attachment_url, attachment_name)
       VALUES ($1,$2,$3,$4,$5,$6,'text',$7,$8)`,
       [id, org(req), channel, senderId, senderName, text ?? "", attachmentUrl ?? null, attachmentName ?? null]
    );
    const r = await db(req)(
      `SELECT id, channel, sender_id, sender_name, content, type, attachment_url, attachment_name, created_at
       FROM team_messages WHERE id=$1`,
      [id]
    );
    const row = r.rows[0];
    const msg = row
      ? mapMsg(row, true)
      : { id, channel, from: senderName, text: text ?? "", self: true, read: true, type: "text",
          senderId, attachmentUrl: attachmentUrl ?? null, attachmentName: attachmentName ?? null };
    // SSE broadcast goes to EVERY client of the org, including teammates —
    // self:true would suppress their unread badge. Send self:false + senderId;
    // each client compares senderId to its own identity to decide "self".
    store.broadcast({ type: "chat:message", channel, message: { ...msg, self: false, read: false } }, org(req));
    // Persist PER-RECIPIENT notification rows so offline teammates see the
    // message in their notification feed. One row per active member (excluding
    // the sender), each with its own read state — one member marking all read
    // can never clear another member's chat alert. Fire-and-forget.
    (async () => {
      const senderEmail = (req as OrgReq).orgContext?.email ?? "";
      const members = await db(req)(
        `SELECT COALESCE(NULLIF(user_id, ''), email) AS rid, email, user_id
           FROM team_members
          WHERE org_id = $1 AND status = 'active'`,
        [org(req)]
      );
      const title = `Nouveau message de ${senderName} dans #${channel}`;
      const body  = (text ?? attachmentName ?? "Pièce jointe").slice(0, 300);
      const link  = JSON.stringify({ route: "team", sub: "chat", channel, senderId });
      let n = 0;
      for (const m of members.rows) {
        const rid = String(m["rid"] ?? "");
        if (!rid) continue;
        // Exclude the sender under any of their identities (userId or email)
        if (rid === senderId || String(m["email"] ?? "") === senderId ||
            String(m["user_id"] ?? "") === senderId ||
            (senderEmail && (rid === senderEmail || String(m["email"] ?? "") === senderEmail))) continue;
        await db(req)(
          `INSERT INTO notifications (id, org_id, type, title, message, read, link, recipient_id, created_at)
           VALUES ($1, $2, 'chat', $3, $4, false, $5, $6, NOW())`,
          [`ntf_chat_${id}_${n++}`, org(req), title, body, link, rid]
        );
      }
    })().catch(() => {});
    res.status(201).json(msg);
  } catch {
    res.status(500).json({ error: "Failed to send message" });
  }
});

// ── DELETE /team/messages/:id ─────────────────────────────────────────────────
router.delete("/team/messages/:id", canWrite, async (req, res) => {
  await db(req)(`DELETE FROM team_messages WHERE id=$1 AND org_id=$2`, [req.params["id"], org(req)]);
  res.json({ ok: true });
});

export default router;
