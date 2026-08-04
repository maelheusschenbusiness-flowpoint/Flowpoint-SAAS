import { Router, type Request } from "express";
import { store } from "../services/store.js";
import { canWrite } from "../middlewares/requireRole.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
  orgContext?: { email?: string; userId?: string };
};
const org = (req: Request): string => (req as OrgReq).orgId ?? "default";
const db  = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);
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
    res.json(r.rows.reverse().map((m: Record<string, unknown>) => mapMsg(m)));
  } catch (err) {
    console.error("[team-messages] GET failed:", (err as Error)?.message);
    res.json([]);
  }
});

// ── GET /team/messages/all  — fetch all persisted channels in one request ─────
router.get("/team/messages/all", async (req, res) => {
  try {
    // Fetch channel list dynamically from team_channels, fallback to defaults
    let channels: string[] = ["general", "seo", "rapports", "support"];
    try {
      const chRes = await db(req)(
        `SELECT name FROM team_channels WHERE org_id=$1 ORDER BY created_at ASC`,
        [org(req)]
      );
      if (chRes.rows.length > 0) {
        channels = chRes.rows.map((r: Record<string, unknown>) => String(r["name"]));
      }
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
        results[ch] = r.rows.reverse().map((m: Record<string, unknown>) => mapMsg(m));
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
  const id = "msg" + Date.now();
  try {
    // Auto-persist the channel so it always appears in the channel list
    db(req)(
      `INSERT INTO team_channels (org_id, name, created_by, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (org_id, name) DO NOTHING`,
      [org(req), channel, senderName]
    ).catch(() => {});

    await db(req)(
      `INSERT INTO team_messages (id, org_id, channel, sender_id, sender_name, content, type, attachment_url, attachment_name)
       VALUES ($1,$2,$3,'user',$4,$5,'text',$6,$7)`,
       [id, org(req), channel, senderName, text ?? "", attachmentUrl ?? null, attachmentName ?? null]
    );
    const r = await db(req)(
      `SELECT id, channel, sender_name, content, type, attachment_url, attachment_name, created_at
       FROM team_messages WHERE id=$1`,
      [id]
    );
    const row = r.rows[0];
    const msg = row
      ? mapMsg(row, true)
      : { id, channel, from: senderName, text: text ?? "", self: true, read: true, type: "text",
          attachmentUrl: attachmentUrl ?? null, attachmentName: attachmentName ?? null };
    store.broadcast({ type: "chat:message", channel, message: msg }, org(req));
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
