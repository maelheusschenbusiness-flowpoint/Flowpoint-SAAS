/**
 * FlowPoint AI Agents — Phase 4 : Définitions d'outils Audits SEO.
 *
 * SOURCE DE VÉRITÉ pour les 9 outils audit.
 * Mêmes règles que Phase 2 (missions) et Phase 3 (calendrier) :
 *  - permission effective requise
 *  - niveau de confirmation obligatoire
 *  - snapshot avant write → Undo disponible
 *  - L'IA ne doit JAMAIS inventer un ID d'audit
 */
import { z } from "zod";
import type { ToolDef } from "./mission-tools.js";
import type { Pool } from "pg";

// ── Catalogue d'outils — Phase 4 : Audits SEO ─────────────────────────────
export const AUDIT_TOOLS: ToolDef[] = [
  {
    name: "search_audits",
    description:
      "Recherche les audits SEO de l'organisation par URL, statut ou plage de dates. " +
      "APPEL OBLIGATOIRE pour TOUTE question sur les audits : 'quel est le score de mon site ?', " +
      "'mes audits récents', 'quels sites ont des problèmes ?', 'montre-moi les audits en erreur'. " +
      "Ne jamais répondre en texte seul pour une question audit — toujours appeler cet outil pour obtenir les vraies données. " +
      "À utiliser AVANT toute modification pour trouver l'ID réel d'un audit. " +
      "L'IA ne doit JAMAIS inventer un ID d'audit.",
    requiredPermission: "audits.read",
    confirmationLevel: "none",
    isWrite: false,
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Filtrer par URL ou domaine (optionnel, recherche partielle).",
        },
        status: {
          type: "string",
          enum: ["ok", "warn", "error", "processing"],
          description: "Filtrer par statut : ok (≥70), warn (50-69), error (<50), processing (en cours).",
        },
        days: {
          type: "number",
          description: "Limiter aux audits des N derniers jours (optionnel).",
          minimum: 1,
          maximum: 365,
        },
        limit: {
          type: "number",
          description: "Nombre maximum de résultats (défaut : 5, max : 20).",
          minimum: 1,
          maximum: 20,
        },
      },
    },
  },

  {
    name: "run_audit",
    description:
      "Lance un nouvel audit SEO PageSpeed Insights pour une URL. " +
      "Utiliser quand l'utilisateur dit 'audite ce site', 'lance un audit sur example.com', " +
      "'analyse la performance de cette page'. " +
      "L'audit s'exécute en arrière-plan (30-60 secondes). " +
      "Le score et les problèmes seront disponibles via search_audits ou summarize_audit après traitement. " +
      "Confirmation de niveau aperçu présentée avant le lancement.",
    requiredPermission: "audits.write",
    confirmationLevel: "preview",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL à auditer (ex : https://example.com). Le protocole https:// est ajouté automatiquement si absent.",
        },
        origin: {
          type: "string",
          description: "Origine de l'audit : 'manual' (par défaut) ou 'agent'.",
        },
      },
      required: ["url"],
    },
  },

  {
    name: "rerun_audit",
    description:
      "Relance l'audit d'un site déjà audité en créant une nouvelle entrée. " +
      "Utiliser quand l'utilisateur dit 'refais l'audit', 'mets à jour le score', 'ré-analyse ce site'. " +
      "Appeler search_audits pour trouver l'URL avant de relancer. " +
      "Confirmation de niveau aperçu présentée avant le relancement.",
    requiredPermission: "audits.write",
    confirmationLevel: "preview",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        auditId: {
          type: "string",
          description: "ID de l'audit existant à relancer (obtenu via search_audits).",
        },
      },
      required: ["auditId"],
    },
  },

  {
    name: "compare_audits",
    description:
      "Compare deux audits SEO pour voir l'évolution du score et des métriques. " +
      "Utiliser quand l'utilisateur dit 'compare ces deux audits', 'montre l'évolution', " +
      "'est-ce que le site s'est amélioré ?', 'quelle est la différence entre ces deux scores ?'. " +
      "Appeler search_audits pour trouver les IDs des deux audits à comparer.",
    requiredPermission: "audits.read",
    confirmationLevel: "none",
    isWrite: false,
    parameters: {
      type: "object",
      properties: {
        auditIdA: {
          type: "string",
          description: "ID du premier audit (le plus ancien ou le référent).",
        },
        auditIdB: {
          type: "string",
          description: "ID du second audit (le plus récent ou le comparé).",
        },
      },
      required: ["auditIdA", "auditIdB"],
    },
  },

  {
    name: "summarize_audit",
    description:
      "Retourne le résumé complet d'un audit SEO : score, statut, vitesse, problèmes critiques, opportunités. " +
      "Utiliser pour 'détails de cet audit', 'montre-moi les problèmes trouvés', 'résume cet audit'. " +
      "Appeler search_audits pour trouver l'ID avant d'appeler cet outil.",
    requiredPermission: "audits.read",
    confirmationLevel: "none",
    isWrite: false,
    parameters: {
      type: "object",
      properties: {
        auditId: {
          type: "string",
          description: "ID de l'audit à résumer (obtenu via search_audits).",
        },
      },
      required: ["auditId"],
    },
  },

  {
    name: "explain_audit_issue",
    description:
      "Explique un problème spécifique trouvé dans un audit SEO, avec sa cause, son impact et comment le corriger. " +
      "Utiliser quand l'utilisateur dit 'c'est quoi ce problème ?', 'comment corriger cette erreur ?', " +
      "'explique-moi cet audit issue', 'que signifie LCP ?'. " +
      "Appeler summarize_audit d'abord pour obtenir la liste des issues.",
    requiredPermission: "audits.read",
    confirmationLevel: "none",
    isWrite: false,
    parameters: {
      type: "object",
      properties: {
        auditId: {
          type: "string",
          description: "ID de l'audit contenant le problème (obtenu via search_audits).",
        },
        issueId: {
          type: "string",
          description: "Identifiant de l'issue (ex : 'unused-javascript', 'render-blocking-resources') ou description libre.",
        },
      },
      required: ["auditId", "issueId"],
    },
  },

  {
    name: "create_missions_from_audit",
    description:
      "Crée des missions FlowPoint à partir des problèmes critiques d'un audit SEO. " +
      "Utiliser quand l'utilisateur dit 'crée des tâches pour cet audit', 'transforme les problèmes en missions', " +
      "'j'veux corriger ces problèmes, crée les missions'. " +
      "Appeler summarize_audit d'abord pour voir les problèmes disponibles. " +
      "Niveau de confirmation obligatoire : l'utilisateur doit valider avant création. " +
      "Annulation possible dans les 30 minutes (supprime toutes les missions créées).",
    requiredPermission: "audits.write",
    confirmationLevel: "full",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        auditId: {
          type: "string",
          description: "ID de l'audit source (obtenu via search_audits).",
        },
        maxMissions: {
          type: "number",
          description: "Nombre maximum de missions à créer (défaut : 5, max : 10).",
          minimum: 1,
          maximum: 10,
        },
        priority: {
          type: "string",
          enum: ["low", "normal", "high", "urgent"],
          description: "Priorité des missions créées (défaut : high pour les issues critiques).",
        },
      },
      required: ["auditId"],
    },
  },

  {
    name: "delete_audit",
    description:
      "Supprime définitivement un audit SEO et ses données associées. " +
      "Confirmation obligatoire de niveau 'full' (action irréversible). " +
      "Appeler search_audits pour obtenir l'ID avant d'appeler cet outil.",
    requiredPermission: "audits.delete",
    confirmationLevel: "full",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        auditId: {
          type: "string",
          description: "ID de l'audit à supprimer (obtenu via search_audits).",
        },
      },
      required: ["auditId"],
    },
  },

  {
    name: "export_audit",
    description:
      "Génère un résumé exportable d'un audit SEO (format Markdown structuré). " +
      "Utiliser quand l'utilisateur dit 'exporte cet audit', 'génère un rapport pour ce site', " +
      "'envoie-moi les résultats', 'format rapport de cet audit'. " +
      "Retourne le rapport complet en Markdown prêt à copier ou partager.",
    requiredPermission: "audits.export",
    confirmationLevel: "none",
    isWrite: false,
    parameters: {
      type: "object",
      properties: {
        auditId: {
          type: "string",
          description: "ID de l'audit à exporter (obtenu via search_audits).",
        },
      },
      required: ["auditId"],
    },
  },
];

// ── Map pour tool-executor — Phase 4 ─────────────────────────────────────
export const AUDIT_TOOL_BY_NAME = new Map<string, ToolDef>(
  AUDIT_TOOLS.map((t) => [t.name, t])
);

// ── Schémas Zod de validation ─────────────────────────────────────────────
export const AUDIT_ARG_SCHEMAS = {
  search_audits: z.object({
    url: z.string().max(500).optional(),
    status: z.enum(["ok", "warn", "error", "processing"]).optional(),
    days: z.number().int().min(1).max(365).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  }),

  run_audit: z.object({
    url: z.string().min(1).max(500),
    origin: z.enum(["manual", "agent"]).optional(),
    force: z.boolean().optional(), // bypass 24-hour deduplication guard
  }),

  rerun_audit: z.object({
    auditId: z.string().min(1).max(100),
  }),

  compare_audits: z.object({
    auditIdA: z.string().min(1).max(100),
    auditIdB: z.string().min(1).max(100),
  }),

  summarize_audit: z.object({
    auditId: z.string().min(1).max(100),
  }),

  explain_audit_issue: z.object({
    auditId: z.string().min(1).max(100),
    issueId: z.string().min(1).max(200),
  }),

  create_missions_from_audit: z.object({
    auditId: z.string().min(1).max(100),
    maxMissions: z.number().int().min(1).max(10).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  }),

  delete_audit: z.object({
    auditId: z.string().min(1).max(100),
  }),

  export_audit: z.object({
    auditId: z.string().min(1).max(100),
  }),
};

// ── Snapshot helper ────────────────────────────────────────────────────────

/**
 * Capture un snapshot complet d'un audit avant toute write.
 * Inclut updated_at pour l'ancre de version Undo.
 */
export async function snapAudit(
  auditId: string,
  orgId: string,
  pool: Pool
): Promise<Record<string, unknown> | null> {
  try {
    const r = await pool.query(
      `SELECT id, url, name, notes, score, status, speed, date, issues, origin, created_at
       FROM audits WHERE id = $1 AND org_id = $2`,
      [auditId, orgId]
    );
    return r.rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Formate le statut d'un audit en emoji + libellé lisible.
 */
export function fmtAuditStatus(status: string, score: number): string {
  if (status === "processing") return "⏳ En cours";
  if (score >= 70) return "✅ Bon";
  if (score >= 50) return "⚠️ Moyen";
  return "❌ Critique";
}
