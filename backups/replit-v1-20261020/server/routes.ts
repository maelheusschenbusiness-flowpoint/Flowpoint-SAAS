import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { registerChatRoutes } from "./replit_integrations/chat";
import { getUncachableResendClient } from "./resendClient";
import rateLimit from "express-rate-limit";

const ALLOWED_ORIGINS = new Set([
  "https://flowpoint.pro",
  "https://www.flowpoint.pro",
  "https://app.flowpoint.pro",
]);

function requireSameOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers["origin"];
  const referer = req.headers["referer"];

  if (process.env.NODE_ENV !== "production") {
    return next();
  }

  const candidate = origin ?? (referer ? new URL(referer).origin : undefined);
  if (candidate && ALLOWED_ORIGINS.has(candidate)) {
    return next();
  }

  return res.status(403).json({ error: "Forbidden" });
}

const leadsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives, réessayez dans 15 minutes." },
});

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de messages envoyés, réessayez dans 15 minutes." },
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.post(api.leads.create.path, requireSameOrigin, leadsLimiter, async (req, res) => {
    try {
      const input = api.leads.create.input.parse(req.body);
      const lead = await storage.createLead(input);
      res.status(201).json(lead);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.post("/api/contact", requireSameOrigin, contactLimiter, async (req, res) => {
    try {
      const { name, email, subject, message } = req.body;
      if (!name || !email || !subject || !message) {
        return res.status(400).json({ error: "Tous les champs sont requis" });
      }

      const { client, fromEmail } = await getUncachableResendClient();

      await client.emails.send({
        from: `Flowpoint Contact <${fromEmail}>`,
        to: "support@flowpoint.pro",
        replyTo: email,
        subject: `[Contact] ${subject}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">Nouveau message depuis flowpoint.pro</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px; font-weight: bold; width: 120px;">Nom :</td><td style="padding: 8px;">${name}</td></tr>
              <tr><td style="padding: 8px; font-weight: bold;">Email :</td><td style="padding: 8px;"><a href="mailto:${email}">${email}</a></td></tr>
              <tr><td style="padding: 8px; font-weight: bold;">Sujet :</td><td style="padding: 8px;">${subject}</td></tr>
            </table>
            <hr style="margin: 16px 0;" />
            <h3 style="color: #334155;">Message :</h3>
            <p style="white-space: pre-wrap; color: #475569;">${message}</p>
          </div>
        `,
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error("Error sending contact email:", err);
      res.status(500).json({ error: "Échec de l'envoi. Veuillez contacter support@flowpoint.pro directement." });
    }
  });

  registerChatRoutes(app);

  return httpServer;
}
