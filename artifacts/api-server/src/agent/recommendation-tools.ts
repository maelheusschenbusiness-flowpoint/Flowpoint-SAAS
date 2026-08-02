/**
 * FlowPoint AI Agents — Phase 5 : Outils IA SEO & Recommandations Intelligentes.
 *
 * SOURCE DE VÉRITÉ pour les 10 outils recommendations/stratégie.
 * Mêmes règles que Phase 2 (missions), Phase 3 (calendrier), Phase 4 (audits) :
 *  - permission effective requise
 *  - niveau de confirmation obligatoire
 *  - snapshot avant write → Undo disponible
 *  - Aucune donnée inventée — uniquement données réelles FlowPoint
 */
import { z } from "zod";
import type { ToolDef } from "./mission-tools.js";
import type { Pool } from "pg";

// ── Catalogue d'outils — Phase 5 : Recommandations SEO ───────────────────
export const RECOMMENDATION_TOOLS: ToolDef[] = [
  {
    name: "search_recommendations",
    description:
      "Recherche les recommandations SEO déjà générées pour l'organisation. " +
      "APPEL OBLIGATOIRE pour TOUTE question sur les recommandations : " +
      "'quelles sont mes recommandations prioritaires ?', 'mes recommandations urgentes', " +
      "'recommandations sur la vitesse mobile', 'qu'est-ce que l'IA me conseille ?'. " +
      "Ne jamais répondre en texte seul sur les recommandations — toujours appeler cet outil. " +
      "À utiliser AVANT explain_recommendation ou dismiss_recommendation pour trouver l'ID réel.",
    requiredPermission: "recommendations.read",
    confirmationLevel: "none",
    isWrite: false,
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["active", "dismissed", "applied"],
          description: "Filtrer par statut (défaut : active).",
        },
        category: {
          type: "string",
          description: "Filtrer par catégorie : technique, contenu, local, backlinks, conversion, performance.",
        },
        priority: {
          type: "string",
          enum: ["quick_win", "high_value", "critical", "long_term"],
          description: "Filtrer par niveau de priorité.",
        },
        limit: {
          type: "number",
          description: "Nombre maximum de résultats (défaut : 10, max : 25).",
          minimum: 1,
          maximum: 25,
        },
      },
    },
  },

  {
    name: "generate_recommendations",
    description:
      "Génère de nouvelles recommandations SEO intelligentes basées sur les données réelles de FlowPoint : " +
      "audits, mots-clés, concurrents, monitors, SEO local. " +
      "Utiliser quand l'utilisateur dit : 'génère des recommandations', 'analyse mon SEO', " +
      "'qu'est-ce que je devrais améliorer ?', 'donne-moi tes conseils SEO'. " +
      "Les recommandations sont priorisées automatiquement (urgence, impact, effort, confiance). " +
      "Les données inventées sont STRICTEMENT INTERDITES — utiliser uniquement les données réelles. " +
      "Confirmation de niveau aperçu avant génération.",
    requiredPermission: "recommendations.generate",
    confirmationLevel: "preview",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          description:
            "Domaine de focus optionnel : technique, contenu, local, backlinks, conversion, performance. " +
            "Si absent, analyse tous les domaines.",
        },
        maxResults: {
          type: "number",
          description: "Nombre maximum de recommandations à générer (défaut : 5, max : 10).",
          minimum: 1,
          maximum: 10,
        },
        urgencyOnly: {
          type: "boolean",
          description: "Si true, ne retourner que les recommandations urgentes (critical + quick_win).",
        },
      },
    },
  },

  {
    name: "prioritize_recommendations",
    description:
      "Trie et classe automatiquement les recommandations existantes par ordre de priorité. " +
      "Catégories : Quick Wins (impact élevé, effort faible), Haute valeur, Critique, Long terme. " +
      "Utiliser quand l'utilisateur dit : 'classe mes recommandations', 'par où commencer ?', " +
      "'qu'est-ce qui est le plus urgent ?', 'priorise mes recommandations'. " +
      "L'ordre est toujours justifié par les données réelles.",
    requiredPermission: "recommendations.read",
    confirmationLevel: "none",
    isWrite: false,
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["all", "quick_win", "high_value", "critical", "long_term"],
          description: "Scope de priorisation (défaut : all).",
        },
      },
    },
  },

  {
    name: "explain_recommendation",
    description:
      "Explique en détail une recommandation spécifique : pourquoi elle est importante, " +
      "bénéfice attendu, impact SEO, niveau de difficulté, dépendances. " +
      "Utiliser quand l'utilisateur dit : 'explique cette recommandation', 'pourquoi c'est important ?', " +
      "'comment faire ça ?', 'c'est quoi l'impact de cette recommandation ?'. " +
      "Appeler search_recommendations pour trouver l'ID avant d'appeler cet outil.",
    requiredPermission: "recommendations.read",
    confirmationLevel: "none",
    isWrite: false,
    parameters: {
      type: "object",
      properties: {
        recommendationId: {
          type: "string",
          description: "ID de la recommandation à expliquer (obtenu via search_recommendations).",
        },
      },
      required: ["recommendationId"],
    },
  },

  {
    name: "create_action_plan",
    description:
      "Construit un plan d'action SEO hebdomadaire complet à partir des recommandations et des données réelles. " +
      "Exemple : Semaine 1 — optimiser pages lentes, corriger H1 ; Semaine 2 — améliorer GBP. " +
      "Utiliser quand l'utilisateur dit : 'crée un plan d'action', 'planifie mes actions SEO', " +
      "'établis une feuille de route', 'comment organiser mon travail SEO ?'. " +
      "Basé uniquement sur les données réelles, aucune invention.",
    requiredPermission: "recommendations.generate",
    confirmationLevel: "none",
    isWrite: false,
    parameters: {
      type: "object",
      properties: {
        weeks: {
          type: "number",
          description: "Nombre de semaines à planifier (défaut : 4, max : 12).",
          minimum: 1,
          maximum: 12,
        },
        focus: {
          type: "string",
          description: "Domaine prioritaire : technique, contenu, local, backlinks, conversion.",
        },
      },
    },
  },

  {
    name: "generate_seo_strategy",
    description:
      "Génère une stratégie SEO globale personnalisée : technique, contenu, local, backlinks, conversion. " +
      "Utiliser quand l'utilisateur dit : 'génère une stratégie SEO', 'quelle est ma stratégie ?', " +
      "'crée une stratégie complète', 'plan SEO global'. " +
      "La stratégie est basée sur les données réelles de l'organisation. " +
      "Confirmation de niveau aperçu avant génération. Stockée pour référence future.",
    requiredPermission: "strategy.generate",
    confirmationLevel: "preview",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        horizon: {
          type: "string",
          enum: ["3months", "6months", "12months"],
          description: "Horizon temporel de la stratégie (défaut : 6months).",
        },
        focus: {
          type: "string",
          description: "Axes prioritaires séparés par virgule : technique, contenu, local, backlinks, conversion.",
        },
      },
    },
  },

  {
    name: "compare_strategy",
    description:
      "Compare deux approches stratégiques SEO (ex : SEO local vs SEO national, " +
      "stratégie contenu vs stratégie technique). " +
      "Utiliser quand l'utilisateur dit : 'compare ces deux stratégies', " +
      "'SEO local ou SEO national pour moi ?', 'quelle approche est meilleure ?'. " +
      "La comparaison est basée sur les données réelles de l'organisation.",
    requiredPermission: "strategy.generate",
    confirmationLevel: "none",
    isWrite: false,
    parameters: {
      type: "object",
      properties: {
        strategyA: {
          type: "string",
          description: "Première approche à comparer (ex : 'SEO local', 'stratégie contenu').",
        },
        strategyB: {
          type: "string",
          description: "Seconde approche à comparer (ex : 'SEO national', 'stratégie technique').",
        },
      },
      required: ["strategyA", "strategyB"],
    },
  },

  {
    name: "create_missions_from_strategy",
    description:
      "Transforme automatiquement une stratégie SEO en missions concrètes FlowPoint. " +
      "Réutilise intégralement le système missions Phase 2. " +
      "Utiliser quand l'utilisateur dit : 'crée les missions pour cette stratégie', " +
      "'transforme en tâches', 'mets en œuvre la stratégie'. " +
      "Appeler generate_seo_strategy ou search_recommendations d'abord. " +
      "Confirmation obligatoire (niveau full). Annulation globale possible dans les 30 minutes.",
    requiredPermission: "strategy.generate",
    confirmationLevel: "full",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        strategyId: {
          type: "string",
          description:
            "ID de la stratégie ou recommandation source (obtenu via search_recommendations). " +
            "Si absent, utilise la stratégie courante de l'organisation.",
        },
        maxMissions: {
          type: "number",
          description: "Nombre maximum de missions à créer (défaut : 5, max : 15).",
          minimum: 1,
          maximum: 15,
        },
        priority: {
          type: "string",
          enum: ["low", "normal", "high", "urgent"],
          description: "Priorité des missions créées (défaut : high).",
        },
      },
    },
  },

  {
    name: "dismiss_recommendation",
    description:
      "Ignore une recommandation SEO avec enregistrement du motif. " +
      "L'historique est conservé, la recommandation peut être restaurée. " +
      "Utiliser quand l'utilisateur dit : 'ignore cette recommandation', " +
      "'ça ne s'applique pas', 'marque comme non pertinent'. " +
      "Appeler search_recommendations pour trouver l'ID avant d'appeler cet outil.",
    requiredPermission: "recommendations.dismiss",
    confirmationLevel: "none",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        recommendationId: {
          type: "string",
          description: "ID de la recommandation à ignorer (obtenu via search_recommendations).",
        },
        reason: {
          type: "string",
          description: "Motif d'ignorance (optionnel, max 500 caractères).",
          maxLength: 500,
        },
      },
      required: ["recommendationId"],
    },
  },

  {
    name: "restore_recommendation",
    description:
      "Restaure une recommandation précédemment ignorée (la remet en état 'active'). " +
      "Utiliser quand l'utilisateur dit : 'restaure cette recommandation', " +
      "'reprends cette recommandation', 'elle est finalement pertinente'. " +
      "Appeler search_recommendations avec status='dismissed' pour trouver l'ID.",
    requiredPermission: "recommendations.restore",
    confirmationLevel: "none",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        recommendationId: {
          type: "string",
          description: "ID de la recommandation à restaurer (obtenu via search_recommendations avec status=dismissed).",
        },
      },
      required: ["recommendationId"],
    },
  },
];

// ── Map pour tool-executor — Phase 5 ─────────────────────────────────────
export const RECOMMENDATION_TOOL_BY_NAME = new Map<string, ToolDef>(
  RECOMMENDATION_TOOLS.map((t) => [t.name, t])
);

// ── Schémas Zod de validation ─────────────────────────────────────────────
export const RECOMMENDATION_ARG_SCHEMAS = {
  search_recommendations: z.object({
    status: z.enum(["active", "dismissed", "applied"]).optional(),
    category: z.string().max(100).optional(),
    priority: z.enum(["quick_win", "high_value", "critical", "long_term"]).optional(),
    limit: z.number().int().min(1).max(25).optional(),
  }),

  generate_recommendations: z.object({
    focus: z.string().max(100).optional(),
    maxResults: z.number().int().min(1).max(10).optional(),
    urgencyOnly: z.boolean().optional(),
  }),

  prioritize_recommendations: z.object({
    scope: z.enum(["all", "quick_win", "high_value", "critical", "long_term"]).optional(),
  }),

  explain_recommendation: z.object({
    recommendationId: z.string().min(1).max(100),
  }),

  create_action_plan: z.object({
    weeks: z.number().int().min(1).max(12).optional(),
    focus: z.string().max(100).optional(),
  }),

  generate_seo_strategy: z.object({
    horizon: z.enum(["3months", "6months", "12months"]).optional(),
    focus: z.string().max(200).optional(),
  }),

  compare_strategy: z.object({
    strategyA: z.string().min(1).max(200),
    strategyB: z.string().min(1).max(200),
  }),

  create_missions_from_strategy: z.object({
    strategyId: z.string().min(1).max(100).optional(),
    maxMissions: z.number().int().min(1).max(15).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  }),

  dismiss_recommendation: z.object({
    recommendationId: z.string().min(1).max(100),
    reason: z.string().max(500).optional(),
  }),

  restore_recommendation: z.object({
    recommendationId: z.string().min(1).max(100),
  }),
};

// ── Snapshot helper ────────────────────────────────────────────────────────

/**
 * Capture un snapshot complet d'une recommandation avant toute write.
 */
export async function snapRecommendation(
  recommendationId: string,
  orgId: string,
  pool: Pool
): Promise<Record<string, unknown> | null> {
  try {
    const r = await pool.query(
      `SELECT id, type, title, description, priority, status, source, metadata, created_at, updated_at
       FROM ai_recommendations WHERE id = $1 AND org_id = $2`,
      [recommendationId, orgId]
    );
    return r.rows[0] ?? null;
  } catch {
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Priorité numérique → label lisible */
export function fmtRecommPriority(priority: number): string {
  if (priority >= 90) return "🚨 Critique";
  if (priority >= 70) return "⬆️ Haute valeur";
  if (priority >= 50) return "⚡ Quick Win";
  return "📅 Long terme";
}

/** Étiquette de priorité → catégorie de tri */
export function scoreToPriorityLabel(score: number): "critical" | "high_value" | "quick_win" | "long_term" {
  if (score >= 90) return "critical";
  if (score >= 70) return "high_value";
  if (score >= 50) return "quick_win";
  return "long_term";
}

/**
 * Génère un score de priorité algorithmique basé sur les données réelles.
 * Observation : mesure réelle → Interprétation : signification → Recommandation : action.
 */
export interface RecommendationInput {
  title: string;
  description: string;
  category: string;
  urgency: number;   // 0-100
  impact: number;    // 0-100
  effort: number;    // 0-100 (effort faible = score élevé)
  confidence: number; // 0-100
  source: string;
  metadata?: Record<string, unknown>;
}

export function computeRecommPriorityScore(r: RecommendationInput): number {
  // Formule : urgence×0.35 + impact×0.35 + (100-effort)×0.20 + confiance×0.10
  return Math.round(r.urgency * 0.35 + r.impact * 0.35 + (100 - r.effort) * 0.20 + r.confidence * 0.10);
}
