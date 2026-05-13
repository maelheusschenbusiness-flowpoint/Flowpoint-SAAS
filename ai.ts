import { Router, type Request } from "express";
import { db, auditsTable } from "@workspace/db";
import { store } from "../services/store.js";
import { logger } from "../lib/logger.js";

const router = Router();

const QUICK_REPLIES: Record<string, string> = {
  "score": "Le **score SEO moyen** de vos sites est de **67/100**. Priorité : optimiser les balises title et améliorer la vitesse de chargement.",
  "monitor": "**restaurant-lesoleil.com** est DOWN depuis 44 minutes. Contactez l'hébergeur et activez une page de maintenance.",
  "rapport": "Je peux générer un rapport PDF personnalisé. Cliquez sur le bouton **Générer rapport PDF** ou accédez à la section Rapports.",
};

const AI_RATE_LIMIT = 20;
const AI_RATE_WINDOW_MS = 60_000;
const aiRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function getClientIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

function checkAiRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = aiRateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    aiRateLimitMap.set(ip, { count: 1, resetAt: now + AI_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= AI_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

router.post("/ai/chat", async (req, res) => {
  const clientIp = getClientIp(req);
  if (!checkAiRateLimit(clientIp)) {
    logger.warn({ ip: clientIp }, "[AI] Rate limit exceeded");
    res.status(429).json({ error: "Too many requests — please wait before sending another message" });
    return;
  }
  const { message, context } = req.body as { message?: string; context?: Record<string, unknown> };
  if (!message) { res.status(400).json({ error: "message required" }); return; }

  const apiKey = process.env["OPENAI_API_KEY"];
  if (apiKey) {
    try {
      const { default: OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey });
      const audits = await db.select().from(auditsTable);
      const avgScore = audits.length > 0
        ? Math.round(audits.reduce((s, a) => s + a.score, 0) / audits.length)
        : 0;
      const chat = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Tu es l'assistant IA de Flowpoint, expert SEO local. Plan ${context?.plan || store.me.plan}, score moyen ${context?.avgScore || avgScore}/100. Réponds en français, concis, avec ** pour le gras.`,
          },
          { role: "user", content: message },
        ],
        max_tokens: 500,
      });
      res.json({ reply: chat.choices[0]?.message?.content || "Je ne peux pas répondre pour le moment." });
      return;
    } catch (err) {
      logger.error({ err }, "[AI] OpenAI call failed, falling back to mock");
    }
  }

  const lower = message.toLowerCase();
  let reply = "Je suis votre assistant SEO Flowpoint. Posez-moi des questions sur vos scores, monitors ou rapports.";
  for (const [key, val] of Object.entries(QUICK_REPLIES)) {
    if (lower.includes(key)) { reply = val; break; }
  }
  res.json({ reply });
});

export default router;
