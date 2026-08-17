/**
 * FlowPoint AI Agents — Phase 2 : Définitions d'outils missions.
 *
 * SOURCE DE VÉRITÉ pour les 7 outils missions + navigate_to.
 * - Une seule définition JSON Schema universelle → convertie en format
 *   OpenAI / Anthropic / Gemini au moment de l'appel.
 * - Chaque outil porte son niveau de confirmation et la permission requise.
 * - AUCUN hardcode de route ; navigate_to utilise le registre Phase 1.
 */
import { z } from "zod";

// ── Niveaux de confirmation ────────────────────────────────────────────────
export type ConfirmationLevel = "none" | "preview" | "full";

// ── Définition universelle d'un outil ─────────────────────────────────────
export interface ToolDef {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  /** Permission effective requise pour exécuter l'outil. */
  requiredPermission: string;
  /** Niveau de confirmation requis. */
  confirmationLevel: ConfirmationLevel;
  /** true = l'outil écrit des données, false = lecture seule. */
  isWrite: boolean;
}

export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, ToolPropertySchema>;
  required?: string[];
}

export interface ToolPropertySchema {
  type: string | string[];
  description?: string;
  enum?: string[];
  items?: { type: string; enum?: string[] };
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  maxLength?: number;
}

// ── Catalogue d'outils — Phase 2 : Missions seulement ─────────────────────
export const MISSION_TOOLS: ToolDef[] = [
  {
    name: "list_missions",
    description:
      "Liste toutes les missions de l'organisation avec des filtres optionnels (statut, catégorie, priorité). " +
      "Utiliser pour afficher un tableau de bord des missions, lister toutes les missions en cours, ou parcourir les missions par statut/priorité. " +
      "Ne nécessite pas de mots-clés — utilise search_mission pour une recherche textuelle ciblée.",
    requiredPermission: "missions.read",
    confirmationLevel: "none",
    isWrite: false,
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["todo", "in_progress", "done", "dismissed"],
          description: "Filtre par statut de mission (optionnel — si omis, retourne tous les statuts).",
        },
        category: {
          type: "string",
          description: "Filtre par catégorie (optionnel).",
        },
        priority: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
          description: "Filtre par priorité (optionnel).",
        },
        limit: {
          type: "number",
          description: "Nombre maximum de résultats à retourner (défaut : 10, max : 20).",
          minimum: 1,
          maximum: 20,
        },
      },
      required: [],
    },
  },
  {
    name: "search_mission",
    description:
      "Recherche des missions dans FlowPoint par mots-clés dans le titre ou la description. " +
      "Peut aussi lister toutes les missions si query est omis (équivalent à list_missions avec filtres). " +
      "À utiliser AVANT toute modification pour trouver l'ID réel d'une mission. " +
      "L'IA ne doit JAMAIS inventer un ID de mission.",
    requiredPermission: "missions.read",
    confirmationLevel: "none",
    isWrite: false,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Mots-clés à rechercher dans le titre ou la description de la mission (optionnel — si omis, retourne toutes les missions correspondant aux filtres).",
        },
        status: {
          type: "string",
          enum: ["todo", "in_progress", "done", "dismissed"],
          description: "Filtre par statut de mission (optionnel).",
        },
        category: {
          type: "string",
          description: "Filtre par catégorie (optionnel).",
        },
        priority: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
          description: "Filtre par priorité (optionnel).",
        },
        limit: {
          type: "number",
          description: "Nombre maximum de résultats à retourner (défaut : 5, max : 10).",
          minimum: 1,
          maximum: 10,
        },
      },
      required: [],
    },
  },
  {
    name: "create_mission",
    description:
      "Crée une nouvelle mission dans FlowPoint. " +
      "Présente un aperçu à l'utilisateur avant la création (niveau preview).",
    requiredPermission: "missions.write",
    confirmationLevel: "preview",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Titre de la mission (obligatoire, max 200 caractères).",
        },
        description: {
          type: "string",
          description: "Description détaillée de la mission (optionnel).",
        },
        category: {
          type: "string",
          enum: ["SEO Technique", "Local SEO", "Performance", "Monitoring", "Croissance", "Conversion", "seo", "local", "perf"],
          description: "Catégorie de la mission.",
        },
        priority: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
          description: "Priorité de la mission.",
        },
        dueDate: {
          type: "string",
          description: "Date d'échéance au format YYYY-MM-DD (optionnel).",
        },
        assignedTo: {
          type: "string",
          description: "Adresse email ou ID du membre à qui assigner la mission (optionnel).",
        },
        steps: {
          type: "array",
          description: "Étapes de la mission sous forme de tableau de textes (optionnel).",
          items: { type: "string" },
        },
      },
      required: ["title"],
    },
  },
  {
    name: "update_mission",
    description:
      "Modifie les champs d'une mission existante. " +
      "L'ID doit provenir d'un appel préalable à search_mission — ne jamais inventer un ID. " +
      "Présente un aperçu avant modification.",
    requiredPermission: "missions.write",
    confirmationLevel: "preview",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "ID de la mission à modifier (obtenu via search_mission).",
        },
        title: { type: "string", description: "Nouveau titre (optionnel)." },
        description: { type: "string", description: "Nouvelle description (optionnel)." },
        status: {
          type: "string",
          enum: ["todo", "in_progress", "done", "dismissed"],
          description: "Nouveau statut (optionnel).",
        },
        priority: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
          description: "Nouvelle priorité (optionnel).",
        },
        dueDate: {
          type: "string",
          description: "Nouvelle date d'échéance YYYY-MM-DD (optionnel).",
        },
        assignedTo: {
          type: "string",
          description: "Réassigner à un autre membre (email ou ID) (optionnel).",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "complete_mission",
    description:
      "Marque une mission comme terminée (statut : done). " +
      "L'ID doit provenir d'un appel préalable à search_mission.",
    requiredPermission: "missions.write",
    confirmationLevel: "preview",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "ID de la mission à marquer comme terminée (obtenu via search_mission).",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "assign_mission",
    description:
      "Attribue une mission à un membre de l'équipe. " +
      "L'ID doit provenir d'un appel préalable à search_mission.",
    requiredPermission: "missions.write",
    confirmationLevel: "none",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "ID de la mission à attribuer (obtenu via search_mission).",
        },
        assignedTo: {
          type: "string",
          description: "Adresse email ou ID du membre à qui attribuer la mission.",
        },
      },
      required: ["id", "assignedTo"],
    },
  },
  {
    name: "delete_mission",
    description:
      "Supprime définitivement une mission. " +
      "⚠ ACTION IRRÉVERSIBLE — requiert une confirmation explicite de l'utilisateur. " +
      "L'ID doit provenir d'un appel préalable à search_mission.",
    requiredPermission: "missions.delete",
    confirmationLevel: "full",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "ID de la mission à supprimer (obtenu via search_mission).",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "navigate_to",
    description:
      "Propose à l'utilisateur un bouton de navigation directe vers une page du dashboard FlowPoint. " +
      "Utiliser uniquement les destinationId du registre officiel — ne jamais inventer une route. " +
      "Préférer cette fonction à la réponse textuelle seule lorsque la demande est de navigation.",
    requiredPermission: "overview.read", // validé en profondeur par le registre Phase 1
    confirmationLevel: "none",
    isWrite: false,
    parameters: {
      type: "object",
      properties: {
        destinationId: {
          type: "string",
          description: "ID de la destination du registre FlowPoint (ex: missions-list, audits-list).",
        },
        label: {
          type: "string",
          description: "Texte du bouton affiché à l'utilisateur (max 60 caractères).",
        },
        highlight: {
          type: "string",
          description: "Ancre CSS à mettre en surbrillance dans la page de destination (optionnel).",
        },
      },
      required: ["destinationId", "label"],
    },
  },
];

export const TOOL_BY_NAME = new Map<string, ToolDef>(MISSION_TOOLS.map(t => [t.name, t]));

// ── Schémas Zod par outil (validation serveur des arguments) ───────────────
export const TOOL_ARG_SCHEMAS: Record<string, z.ZodTypeAny> = {
  list_missions: z.object({
    status: z.enum(["todo", "in_progress", "done", "dismissed"]).optional(),
    category: z.string().max(100).optional(),
    priority: z.enum(["critical", "high", "medium", "low"]).optional(),
    limit: z.number().int().min(1).max(20).optional().default(10),
  }),
  search_mission: z.object({
    query: z.string().min(1).max(300).optional(),
    status: z.enum(["todo", "in_progress", "done", "dismissed"]).optional(),
    category: z.string().max(100).optional(),
    priority: z.enum(["critical", "high", "medium", "low"]).optional(),
    limit: z.number().int().min(1).max(10).optional().default(5),
  }),
  create_mission: z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    category: z.string().max(100).optional().default("seo"),
    priority: z.enum(["critical", "high", "medium", "low"]).optional().default("medium"),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    assignedTo: z.string().max(200).optional(),
    steps: z.array(z.string().max(500)).max(20).optional(),
  }),
  update_mission: z.object({
    id: z.string().min(1).max(100),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    status: z.enum(["todo", "in_progress", "done", "dismissed"]).optional(),
    priority: z.enum(["critical", "high", "medium", "low"]).optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    assignedTo: z.string().max(200).optional(),
  }),
  complete_mission: z.object({
    id: z.string().min(1).max(100),
  }),
  assign_mission: z.object({
    id: z.string().min(1).max(100),
    assignedTo: z.string().min(1).max(200),
  }),
  delete_mission: z.object({
    id: z.string().min(1).max(100),
  }),
  navigate_to: z.object({
    destinationId: z.string().min(1).max(100),
    label: z.string().min(1).max(60),
    highlight: z.string().max(100).optional(),
  }),
};

// ── Formatters : JSON Schema universel → format provider ──────────────────

export interface OpenAITool {
  type: "function";
  function: { name: string; description: string; parameters: ToolParameterSchema };
}
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: ToolParameterSchema;
}
export interface GeminiTool {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

export function toOpenAITools(tools: ToolDef[]): OpenAITool[] {
  return tools.map(t => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export function toAnthropicTools(tools: ToolDef[]): AnthropicTool[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

export function toGeminiTools(tools: ToolDef[]): GeminiTool[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

// ── Interface commune de résultat d'appel d'outil ──────────────────────────

export interface AIToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AIToolCallResult {
  toolCallId: string;
  toolName: string;
  content: string;
  isError: boolean;
}
