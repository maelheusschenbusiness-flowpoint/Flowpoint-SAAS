import { Router, type Request } from "express";
import { store } from "../services/store.js";
import { canWrite } from "../middlewares/requireRole.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const org = (req: Request): string => (req as OrgReq).orgId ?? "default";
const db  = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

router.get("/team/messages", async (req, res) => {
  try {
    const channel = (req.query.channel as string) || "general";
    const r = await db(req)(
      `SELECT id, org_id, channel, sender_id, sender_name, content, type, attachment_url, attachment_name, created_at
       FROM team_messages
       WHERE org_id=$1 AND channel=$2
         AND created_at >= COALESCE(
           (SELECT created_at FROM organizations WHERE id=$1),
           '-infinity'::timestamp
         )
       ORDER BY created_at DESC LIMIT 100`,
      [org(req), channel]
    );
    const rows = r.rows.reverse().map(m => ({
      id:             m.id,
      channel:        m.channel,
      from:           m.sender_name,
      text:           m.content,
      self:           false,
      read:           true,
      type:           m.type,
      attachmentUrl:  m.attachment_url  ?? null,
      attachmentName: m.attachment_name ?? null,
      createdAt:      m.created_at,
    }));
    res.json(rows);
  } catch {
    res.json([]);
  }
});

// ── GET /team/messages/all  — fetch all channels in one request ───────────────
router.get("/team/messages/all", async (req, res) => {
  try {
    const channels = ["general", "seo", "rapports", "support"];
    const results: Record<string, unknown[]> = {};
    await Promise.all(channels.map(async ch => {
      try {
        const r = await db(req)(
          `SELECT id, org_id, channel, sender_id, sender_name, content, type, attachment_url, attachment_name, created_at
           FROM team_messages
           WHERE org_id=$1 AND channel=$2
             AND created_at >= COALESCE(
               (SELECT created_at FROM organizations WHERE id=$1),
               '-infinity'::timestamp
             )
           ORDER BY created_at DESC LIMIT 100`,
          [org(req), ch]
        );
        results[ch] = r.rows.reverse().map(m => ({
          id:             m.id,
          channel:        m.channel,
          from:           m.sender_name,
          text:           m.content,
          self:           false,
          read:           true,
          type:           m.type,
          attachmentUrl:  m.attachment_url  ?? null,
          attachmentName: m.attachment_name ?? null,
          createdAt:      m.created_at,
        }));
      } catch {
        results[ch] = [];
      }
    }));
    res.json(results);
  } catch {
    res.json({ general: [], seo: [], rapports: [], support: [] });
  }
});

router.post("/team/messages", canWrite, async (req, res) => {
  const { channel = "general", text, attachmentUrl, attachmentName } =
    req.body as { channel?: string; from?: string; text?: string; attachmentUrl?: string; attachmentName?: string };
  if (!text && !attachmentUrl) { res.status(400).json({ error: "text or attachmentUrl required" }); return; }
  const senderName = (req as OrgReq).orgContext?.email?.split("@")[0] || "Équipe";
  const id = "msg" + Date.now();
  try {
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
      ? {
          id:             row.id,
          channel:        row.channel,
          from:           row.sender_name,
          text:           row.content,
          self:           true,
          read:           true,
          type:           row.type,
          attachmentUrl:  row.attachment_url  ?? null,
          attachmentName: row.attachment_name ?? null,
          createdAt:      row.created_at,
        }
           : { id, channel, from: senderName, text: text ?? "", self: true, read: true, type: "text",
          attachmentUrl: attachmentUrl ?? null, attachmentName: attachmentName ?? null };
    store.broadcast({ type: "chat:message", channel, message: msg }, org(req));
    res.status(201).json(msg);
  } catch {
    res.status(500).json({ error: "Failed to send message" });
  }
});

router.delete("/team/messages/:id", canWrite, async (req, res) => {
  await db(req)(`DELETE FROM team_messages WHERE id=$1 AND org_id=$2`, [req.params.id, org(req)]);
  res.json({ ok: true });
});

export default router;
