/**
 * FlowPoint AI Agents — Phase 7 : Outil analyze_url.
 *
 * Permet à l'IA de récupérer et analyser le contenu d'une URL externe en temps réel.
 * Déclenché automatiquement par le LLM quand l'utilisateur mentionne une URL.
 */
import { z } from "zod";
import type { ToolDef } from "./mission-tools.js";

export const URL_TOOLS: ToolDef[] = [
  {
    name: "analyze_url",
    description:
      "Récupère et analyse le contenu d'une URL externe en temps réel. " +
      "Extrait : titre, méta-description, structure des titres H1-H3, texte principal, temps de chargement. " +
      "Utiliser SYSTÉMATIQUEMENT quand l'utilisateur mentionne une URL ou demande d'analyser un site, " +
      "même si le site est déjà enregistré dans FlowPoint — pour obtenir l'état actuel de la page. " +
      "Fonctionne pour : sites concurrents, pages clients, outils tiers, tout site public. " +
      "LIMITATIONS : une seule page à la fois, pas de JavaScript, pas de crawl multi-pages. " +
      "Si la page est inaccessible (timeout, 403, bot-block), signale l'erreur clairement à l'utilisateur.",
    requiredPermission: "web.read",
    confirmationLevel: "none",
    isWrite: false,
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "URL complète à analyser. Doit commencer par http:// ou https://. " +
            "Si l'utilisateur donne un domaine sans protocole (ex: exemple.com), ajouter https:// automatiquement.",
          maxLength: 2048,
        },
        purpose: {
          type: "string",
          enum: ["competitor", "seo", "general"],
          description:
            "'competitor' = analyse comparative d'un site concurrent ; " +
            "'seo' = audit SEO de la page (titre, méta, structure) ; " +
            "'general' = analyse générale du contenu. Optionnel.",
        },
      },
      required: ["url"],
    },
  },
];

export const URL_TOOL_BY_NAME = new Map<string, ToolDef>(URL_TOOLS.map((t) => [t.name, t]));

export const URL_ARG_SCHEMAS: Record<string, {
  safeParse: (x: unknown) => {
    success: boolean;
    data?: unknown;
    error?: { issues: Array<{ path: (string | number)[]; message: string }> };
  };
}> = {
  analyze_url: z.object({
    url: z.string().min(1).max(2048).refine(
      (u) => {
        try {
          const parsed = new URL(u.startsWith("http") ? u : `https://${u}`);
          return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "URL doit être une adresse http:// ou https:// valide" }
    ),
    purpose: z.enum(["competitor", "seo", "general"]).optional(),
  }),
};
