/**
 * FlowPoint AI Agents — Workspace Tools (Phase 7)
 *
 * Outils CRUD simples branchés sur les mêmes APIs/tables que le dashboard :
 *  - Concurrents : list_competitors, add_competitor, delete_competitor
 *  - Mots-clés   : list_keywords, add_keyword, remove_keyword
 *  - Rapports    : list_reports
 *
 * Règles :
 *  • Chaque outil d'écriture vérifie la présence en DB après l'opération (fail-closed).
 *  • Pas de stockage parallèle : même table / même org_id que le dashboard.
 *  • delete_competitor et remove_keyword nécessitent une confirmation utilisateur (full).
 */
import { z } from "zod";
import type { ToolDef, ToolParameterSchema } from "./mission-tools.js";

export type { ToolDef };

// ── Tool definitions ──────────────────────────────────────────────────────────

export const WORKSPACE_TOOLS: ToolDef[] = [
  // ── Concurrents ────────────────────────────────────────────────────────────
  {
    name: "list_competitors",
    description:
      "Liste les concurrents suivis dans l'organisation avec leur domaine, score DR, et nombre de mots-clés. " +
      "Utiliser quand l'utilisateur demande 'quels sont mes concurrents ?', 'liste mes concurrents', etc.",
    requiredPermission: "audits.read",
    confirmationLevel: "none",
    isWrite: false,
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Nombre maximum de résultats (défaut : 10, max : 30).",
          minimum: 1,
          maximum: 30,
        },
      },
    } as ToolParameterSchema,
  },
  {
    name: "add_competitor",
    description:
      "Ajoute un concurrent à surveiller. Nécessite un nom et un domaine/URL public. " +
      "Exemple : 'ajoute example.com comme concurrent', 'surveille monsite.fr'. " +
      "Confirme ensuite que le concurrent a bien été ajouté.",
    requiredPermission: "audits.write",
    confirmationLevel: "preview",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Nom lisible du concurrent (ex: 'Concurrent Acme').",
          maxLength: 100,
        },
        url: {
          type: "string",
          description: "URL ou domaine public du concurrent (ex: 'https://example.com' ou 'example.com').",
          maxLength: 500,
        },
        threat_level: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          description: "Niveau de menace perçu (défaut: low).",
        },
      },
      required: ["name", "url"],
    } as ToolParameterSchema,
  },
  {
    name: "delete_competitor",
    description:
      "Supprime définitivement un concurrent du suivi. " +
      "Requiert l'ID du concurrent (obtenable via list_competitors). " +
      "Action irréversible — demander confirmation explicite.",
    requiredPermission: "audits.write",
    confirmationLevel: "full",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "ID du concurrent à supprimer (obtenu via list_competitors).",
        },
      },
      required: ["id"],
    } as ToolParameterSchema,
  },

  // ── Mots-clés ──────────────────────────────────────────────────────────────
  {
    name: "list_keywords",
    description:
      "Liste les mots-clés suivis dans l'organisation avec leur position, volume de recherche et évolution. " +
      "Utiliser pour 'quels sont mes mots-clés ?', 'mots-clés en position 1', etc.",
    requiredPermission: "audits.read",
    confirmationLevel: "none",
    isWrite: false,
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Nombre maximum de résultats (défaut : 20, max : 50).",
          minimum: 1,
          maximum: 50,
        },
        min_position: {
          type: "number",
          description: "Filtre : position minimale (ex: 10 = uniquement positions > 10).",
        },
        max_position: {
          type: "number",
          description: "Filtre : position maximale (ex: 3 = top 3).",
        },
      },
    } as ToolParameterSchema,
  },
  {
    name: "add_keyword",
    description:
      "Ajoute un mot-clé au suivi de positionnement. " +
      "Exemple : 'suis le mot-clé agence seo paris', 'ajoute restaurant bordeaux'. " +
      "Confirme ensuite l'ajout en DB.",
    requiredPermission: "audits.write",
    confirmationLevel: "preview",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        keyword: {
          type: "string",
          description: "Mot-clé à suivre (ex: 'agence seo paris').",
          maxLength: 200,
        },
        url: {
          type: "string",
          description: "URL cible optionnelle à associer à ce mot-clé.",
        },
        tag: {
          type: "string",
          description: "Tag ou catégorie du mot-clé (optionnel).",
        },
      },
      required: ["keyword"],
    } as ToolParameterSchema,
  },
  {
    name: "remove_keyword",
    description:
      "Retire un mot-clé du suivi (désactivation, pas de suppression physique). " +
      "Requiert l'ID du mot-clé (obtenable via list_keywords). " +
      "Action irréversible — demander confirmation.",
    requiredPermission: "audits.write",
    confirmationLevel: "full",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "ID du mot-clé à retirer (obtenu via list_keywords).",
        },
        keyword: {
          type: "string",
          description: "Nom du mot-clé (pour confirmation lisible dans le message).",
        },
      },
      required: ["id"],
    } as ToolParameterSchema,
  },

  // ── Rapports ───────────────────────────────────────────────────────────────
  {
    name: "list_reports",
    description:
      "Liste les rapports générés dans l'organisation (PDF, CSV). " +
      "Utiliser pour 'combien de rapports ?', 'liste mes rapports', 'dernier rapport'. " +
      "Retourne le titre, la date, le type et le statut de partage.",
    requiredPermission: "audits.read",
    confirmationLevel: "none",
    isWrite: false,
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Nombre maximum de résultats (défaut : 10, max : 30).",
          minimum: 1,
          maximum: 30,
        },
      },
    } as ToolParameterSchema,
  },
];

// ── Exports pour tool-executor ────────────────────────────────────────────────

export const WORKSPACE_TOOL_BY_NAME: Map<string, ToolDef> = new Map(
  WORKSPACE_TOOLS.map((t) => [t.name, t])
);

// ── Zod validation schemas ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const WORKSPACE_ARG_SCHEMAS: Record<string, { safeParse: (x: unknown) => any }> = {
  list_competitors: z.object({
    limit: z.number().int().min(1).max(30).optional(),
  }),
  add_competitor: z.object({
    name: z.string().min(1).max(100),
    url: z.string().min(3).max(500),
    threat_level: z.enum(["low", "medium", "high", "critical"]).optional(),
  }),
  delete_competitor: z.object({
    id: z.string().min(1),
  }),
  list_keywords: z.object({
    limit: z.number().int().min(1).max(50).optional(),
    min_position: z.number().optional(),
    max_position: z.number().optional(),
  }),
  add_keyword: z.object({
    keyword: z.string().min(1).max(200),
    url: z.string().optional(),
    tag: z.string().optional(),
  }),
  remove_keyword: z.object({
    id: z.string().min(1),
    keyword: z.string().optional(),
  }),
  list_reports: z.object({
    limit: z.number().int().min(1).max(30).optional(),
  }),
};
