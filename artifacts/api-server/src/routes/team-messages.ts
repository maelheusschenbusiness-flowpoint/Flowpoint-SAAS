import { Router, type Request } from "express";
import { store } from "../services/store.js";
import { isDemoMode } from "../services/mock-data.js";

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
      `SELECT * FROM team_messages WHERE org_id=$1 AND channel=$2 ORDER BY created_at DESC LIMIT 100`,
      [org(req), channel]
    );
    res.json(r.rows.reverse());
  } catch {
    res.json([]);
  }
});

router.post("/team/messages", async (req, res) => {
  const { channel = "general", from, text } = req.body as { channel?: string; from?: string; text?: string };
  if (!text || !from) { res.status(400).json({ error: "text and from required" }); return; }
  const id = "msg" + Date.now();
  try {
    await db(req)(
      `INSERT INTO team_messages (id, org_id, channel, sender_id, sender_name, content, type)
       VALUES ($1,$2,$3,'user',$4,$5,'text')`,
      [id, org(req), channel, from, text]
    );
    const r = await db(req)(`SELECT * FROM team_messages WHERE id=$1`, [id]);
    const msg = r.rows[0] ?? { id, channel, senderName: from, content: text };
    store.broadcast({ type: "chat:message", channel, message: msg });
    res.status(201).json(msg);
  } catch {
    res.status(500).json({ error: "Failed to send message" });
  }
});

router.delete("/team/messages/:id", async (req, res) => {
  await db(req)(`DELETE FROM team_messages WHERE id=$1 AND org_id=$2`, [req.params.id, org(req)]);
  res.json({ ok: true });
});

export default router;
