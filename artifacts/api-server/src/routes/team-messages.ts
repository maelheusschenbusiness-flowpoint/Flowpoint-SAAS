import { Router, type Request } from "express";
import { store } from "../services/store.js";
import { isDemoMode } from "../services/mock-data.js";
import { canWrite } from "../middlewares/requireRole.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const org = (req: Request): string => (req as OrgReq).orgId ?? "default";
const db  = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

const SEED_MSGS = [
  { id: "msg1", org_id: "default", channel: "general",  sender_id: "sophie-m",  sender_name: "Sophie M.",  content: "Rapport Mai envoyé à tous les clients ✓",                                        type: "text" },
  { id: "msg2", org_id: "default", channel: "general",  sender_id: "mael-h",    sender_name: "Maël H.",    content: "Super ! J'ai aussi mis à jour les monitors pour Boulangerie Martin.",            type: "text" },
  { id: "msg3", org_id: "default", channel: "general",  sender_id: "thomas-r",  sender_name: "Thomas R.",  content: "Le score SEO de monagence.fr est passé à 82/100 🎉",                            type: "text" },
  { id: "msg4", org_id: "default", channel: "seo",      sender_id: "sophie-m",  sender_name: "Sophie M.",  content: "Attention : VisibilityFirst a gagné 15 positions sur nos mots-clés principaux", type: "text" },
  { id: "msg5", org_id: "default", channel: "seo",      sender_id: "mael-h",    sender_name: "Maël H.",    content: "Je lance un audit complet ce soir pour analyser l'écart.",                      type: "text" },
  { id: "msg6", org_id: "default", channel: "rapports", sender_id: "thomas-r",  sender_name: "Thomas R.",  content: "Template rapport Q2 prêt — à valider avant envoi",                             type: "text" },
];

async function ensureSeed(req: Request): Promise<void> {
  if (!isDemoMode()) return;
  const orgId = org(req);
  const r = await db(req)(`SELECT id FROM team_messages WHERE org_id=$1 LIMIT 1`, [orgId]);
  if (r.rows.length === 0) {
    for (const m of SEED_MSGS) {
      await db(req)(
        `INSERT INTO team_messages (id, org_id, channel, sender_id, sender_name, content, type)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [m.id, orgId, m.channel, m.sender_id, m.sender_name, m.content, m.type]
      );
    }
  }
}

router.get("/team/messages", async (req, res) => {
  try {
    await ensureSeed(req);
    const channel = (req.query.channel as string) || "general";
    const r = await db(req)(
      `SELECT id, org_id, channel, sender_id, sender_name, content, type, attachment_url, attachment_name, created_at
       FROM team_messages WHERE org_id=$1 AND channel=$2 ORDER BY created_at DESC LIMIT 100`,
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
    await ensureSeed(req);
    const channels = ["general", "seo", "rapports", "support"];
    const results: Record<string, unknown[]> = {};
    await Promise.all(channels.map(async ch => {
      try {
        const r = await db(req)(
          `SELECT id, org_id, channel, sender_id, sender_name, content, type, attachment_url, attachment_name, created_at
           FROM team_messages WHERE org_id=$1 AND channel=$2 ORDER BY created_at DESC LIMIT 100`,
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
  const { channel = "general", from, text, attachmentUrl, attachmentName } =
    req.body as { channel?: string; from?: string; text?: string; attachmentUrl?: string; attachmentName?: string };
  if (!text && !attachmentUrl) { res.status(400).json({ error: "text or attachmentUrl required" }); return; }
  if (!from) { res.status(400).json({ error: "from required" }); return; }
  const id = "msg" + Date.now();
  try {
    await db(req)(
      `INSERT INTO team_messages (id, org_id, channel, sender_id, sender_name, content, type, attachment_url, attachment_name)
       VALUES ($1,$2,$3,'user',$4,$5,'text',$6,$7)`,
      [id, org(req), channel, from, text ?? "", attachmentUrl ?? null, attachmentName ?? null]
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
      : { id, channel, from, text: text ?? "", self: true, read: true, type: "text",
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
