import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { registerChatRoutes } from "./replit_integrations/chat";
import { getUncachableResendClient } from "./resendClient";
import rateLimit from "express-rate-limit";
import { registerPublicAuditRoutes } from "./public-audit-routes";
import { escapeHtml } from "./html-escape";
import { isAllowedMarketingOrigin } from "./request-origin";
import { getContactRecipient } from "./contact-config";

function requireSameOrigin(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV !== "production") {
    return next();
  }

  if (isAllowedMarketingOrigin(req)) {
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
  registerPublicAuditRoutes(app);

  app.post(api.leads.create.path, requireSameOrigin, leadsLimiter, async (req, res) => {
    try {
      const input = api.leads.create.input.parse(req.body);
      const lead = await storage.createLead(input);
      res.status(201).json(lead);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.issues[0].message,
          field: err.issues[0].path.join('.'),
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
      const recipient = getContactRecipient();
      const safeName = escapeHtml(name);
      const safeEmail = escapeHtml(email);
      const safeSubject = escapeHtml(subject);
      const safeMessage = escapeHtml(message);

      await client.emails.send({
        from: `Flowpoint Contact <${fromEmail}>`,
        to: recipient,
        replyTo: email,
        subject: `[Contact] ${String(subject).replace(/[\r\n]+/g, " ")}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">Nouveau message depuis flowpoint.pro</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px; font-weight: bold; width: 120px;">Nom :</td><td style="padding: 8px;">${safeName}</td></tr>
              <tr><td style="padding: 8px; font-weight: bold;">Email :</td><td style="padding: 8px;"><a href="mailto:${safeEmail}">${safeEmail}</a></td></tr>
              <tr><td style="padding: 8px; font-weight: bold;">Sujet :</td><td style="padding: 8px;">${safeSubject}</td></tr>
            </table>
            <hr style="margin: 16px 0;" />
            <h3 style="color: #334155;">Message :</h3>
            <p style="white-space: pre-wrap; color: #475569;">${safeMessage}</p>
          </div>
        `,
      });

      res.json({ success: true });
    } catch {
      console.error("Error sending contact email");
      res.status(500).json({ error: "Échec de l'envoi. Veuillez contacter support@flowpoint.pro directement." });
    }
  });

  registerChatRoutes(app);

  return httpServer;
}
