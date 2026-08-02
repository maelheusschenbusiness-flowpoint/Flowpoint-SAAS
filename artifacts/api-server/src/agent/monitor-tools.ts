/**
 * FlowPoint AI Agents — Phase 6 : Outils Monitors, Incidents & Alertes
 *
 * 12 outils :
 *  - search_monitors        (monitors.read,    none,    read)
 *  - search_incidents       (incidents.read,   none,    read)
 *  - explain_incident       (incidents.read,   none,    read)
 *  - compare_incidents      (incidents.read,   none,    read)
 *  - acknowledge_incident   (incidents.resolve, preview, write)
 *  - resolve_incident       (incidents.resolve, full,    write + undo)
 *  - create_missions_from_incident (monitors.write, full, write + undo)
 *  - optimize_monitors      (monitors.read,    none,    read — jamais auto)
 *  - configure_monitor      (monitors.configure, full,  write + undo)
 *  - suspend_monitor        (monitors.write,   preview, write + undo)
 *  - resume_monitor         (monitors.write,   preview, write)
 *  - delete_monitor         (monitors.delete,  full,    write + undo)
 */
import { z } from "zod";

// ── ToolDef (same shape as other phase tool files) ───────────────────────────

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiredPermission: string;
  confirmationLevel: "none" | "preview" | "full";
  isWrite: boolean;
  undoable?: boolean;
}

// ── Tool definitions ─────────────────────────────────────────────────────────

export const MONITOR_TOOLS: ToolDef[] = [
  {
    name: "search_monitors",
    description:
      "Recherche des monitors avec filtres : domaine/URL, statut (up/down/paused), type, criticité, fréquence. " +
      "Exemples : 'Quels sites sont hors ligne ?', 'Monitors critiques', 'Monitors avec une fréquence > 5 min'.",
    parameters: {
      type: "object",
      properties: {
        query:       { type: "string",  description: "Filtre texte sur nom ou URL du monitor" },
        status:      { type: "string",  enum: ["up", "down", "paused", "unknown", "all"], description: "Statut courant" },
        is_critical: { type: "boolean", description: "Filtrer sur les monitors critiques uniquement" },
        enabled:     { type: "boolean", description: "true=actifs, false=suspendus" },
        limit:       { type: "number",  description: "Nombre max de résultats (défaut 20)" },
      },
      required: [],
    },
    requiredPermission: "monitors.read",
    confirmationLevel: "none",
    isWrite: false,
  },
  {
    name: "search_incidents",
    description:
      "Recherche des incidents monitors filtrés par statut (actif/résolu), sévérité, monitor_id, période. " +
      "Exemples : 'Incidents actifs', 'Incidents de la semaine dernière', 'Incidents non résolus > 1h'.",
    parameters: {
      type: "object",
      properties: {
        monitor_id:  { type: "string",  description: "ID du monitor à filtrer (optionnel)" },
        status:      { type: "string",  enum: ["active", "resolved", "all"], description: "active=non résolu, resolved=résolu (défaut: all)" },
        period_days: { type: "number",  description: "Fenêtre temporelle en jours (défaut: 7)" },
        min_duration_s: { type: "number", description: "Durée minimale de l'incident en secondes" },
        limit:       { type: "number",  description: "Nombre max de résultats (défaut: 20)" },
      },
      required: [],
    },
    requiredPermission: "incidents.read",
    confirmationLevel: "none",
    isWrite: false,
  },
  {
    name: "explain_incident",
    description:
      "Explique en détail un incident : ce qui s'est produit, quand, pourquoi (cause probable), impact, " +
      "historique du monitor, checks associés, alertes déclenchées, recommandations pour éviter la récurrence.",
    parameters: {
      type: "object",
      properties: {
        incident_id: { type: "string", description: "ID de l'incident (monitor_incidents.id)" },
      },
      required: ["incident_id"],
    },
    requiredPermission: "incidents.read",
    confirmationLevel: "none",
    isWrite: false,
  },
  {
    name: "compare_incidents",
    description:
      "Compare plusieurs incidents côte à côte : durée, fréquence, type d'erreur, causes, impact, " +
      "tendance (les incidents empirent-ils ?). Permet de détecter des patterns récurrents.",
    parameters: {
      type: "object",
      properties: {
        incident_ids: {
          type: "array",
          items: { type: "string" },
          description: "Liste d'IDs d'incidents à comparer (2 à 10)",
          minItems: 2,
          maxItems: 10,
        },
        metrics: {
          type: "array",
          items: { type: "string", enum: ["duration", "frequency", "type", "causes", "impact"] },
          description: "Métriques à comparer (défaut: toutes)",
        },
      },
      required: ["incident_ids"],
    },
    requiredPermission: "incidents.read",
    confirmationLevel: "none",
    isWrite: false,
  },
  {
    name: "acknowledge_incident",
    description:
      "Accuser réception d'un incident actif : marque les alertes associées comme lues (read_at). " +
      "Confirmation obligatoire. L'incident reste actif jusqu'à resolve_incident.",
    parameters: {
      type: "object",
      properties: {
        incident_id: { type: "string", description: "ID de l'incident à acquitter" },
        note:        { type: "string", description: "Note d'acquittement (optionnel)" },
      },
      required: ["incident_id"],
    },
    requiredPermission: "incidents.resolve",
    confirmationLevel: "preview",
    isWrite: true,
    undoable: false,
  },
  {
    name: "resolve_incident",
    description:
      "Marquer un incident comme résolu : met resolved_at=NOW() et calcule duration_s. " +
      "Confirmation obligatoire. Annulable (undo remet resolved_at à NULL).",
    parameters: {
      type: "object",
      properties: {
        incident_id:      { type: "string", description: "ID de l'incident à résoudre" },
        resolution_note:  { type: "string", description: "Note de résolution (optionnel)" },
      },
      required: ["incident_id"],
    },
    requiredPermission: "incidents.resolve",
    confirmationLevel: "full",
    isWrite: true,
    undoable: true,
  },
  {
    name: "create_missions_from_incident",
    description:
      "Crée automatiquement des missions depuis un incident : investigation (pourquoi ?), " +
      "correction (fix), vérification (tests), suivi (monitoring post-fix). Undo global supprime toutes les missions créées.",
    parameters: {
      type: "object",
      properties: {
        incident_id:    { type: "string", description: "ID de l'incident source" },
        mission_types: {
          type: "array",
          items: { type: "string", enum: ["investigation", "correction", "verification", "suivi"] },
          description: "Types de missions à créer (défaut: tous les 4)",
        },
        assignee_id: { type: "string", description: "ID utilisateur assigné (optionnel)" },
      },
      required: ["incident_id"],
    },
    requiredPermission: "monitors.write",
    confirmationLevel: "full",
    isWrite: true,
    undoable: true,
  },
  {
    name: "optimize_monitors",
    description:
      "Analyse la configuration des monitors et propose des optimisations : réduire/augmenter la fréquence, " +
      "fusionner les doublons, détecter les faux positifs, améliorer la couverture. " +
      "NE modifie JAMAIS automatiquement — propose uniquement, l'utilisateur confirme.",
    parameters: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          enum: ["frequency", "coverage", "duplicates", "false_positives", "all"],
          description: "Axe d'optimisation (défaut: all)",
        },
      },
      required: [],
    },
    requiredPermission: "monitors.read",
    confirmationLevel: "none",
    isWrite: false,
  },
  {
    name: "configure_monitor",
    description:
      "Créer un nouveau monitor ou modifier un monitor existant. " +
      "Paramètres : URL, nom, intervalle (s), timeout (s), notifications (email/SMS), " +
      "localisation, HTTP/HTTPS, mots-clés à surveiller, criticité. Confirmation obligatoire.",
    parameters: {
      type: "object",
      properties: {
        monitor_id:     { type: "string",  description: "ID du monitor à modifier (null = créer nouveau)" },
        url:            { type: "string",  description: "URL à surveiller (obligatoire pour création)" },
        name:           { type: "string",  description: "Nom du monitor" },
        frequency:      { type: "number",  description: "Intervalle de vérification en secondes (60, 120, 300, 600, 1800, 3600)" },
        timeout:        { type: "number",  description: "Timeout en secondes (défaut: 30)" },
        alert_email:    { type: "string",  description: "Email de notification" },
        alert_phone:    { type: "string",  description: "Numéro SMS de notification" },
        is_critical:    { type: "boolean", description: "Marquer comme monitor critique" },
        enabled:        { type: "boolean", description: "Activer/désactiver le monitor" },
      },
      required: [],
    },
    requiredPermission: "monitors.configure",
    confirmationLevel: "full",
    isWrite: true,
    undoable: true,
  },
  {
    name: "suspend_monitor",
    description:
      "Suspendre un monitor (enabled=false) : arrête les checks et les alertes. " +
      "Aperçu obligatoire avant confirmation. Annulable (undo réactive le monitor).",
    parameters: {
      type: "object",
      properties: {
        monitor_id: { type: "string", description: "ID du monitor à suspendre" },
        reason:     { type: "string", description: "Motif de suspension (optionnel)" },
      },
      required: ["monitor_id"],
    },
    requiredPermission: "monitors.write",
    confirmationLevel: "preview",
    isWrite: true,
    undoable: true,
  },
  {
    name: "resume_monitor",
    description:
      "Réactiver un monitor suspendu (enabled=true) : reprend les vérifications immédiatement.",
    parameters: {
      type: "object",
      properties: {
        monitor_id: { type: "string", description: "ID du monitor à réactiver" },
      },
      required: ["monitor_id"],
    },
    requiredPermission: "monitors.write",
    confirmationLevel: "preview",
    isWrite: true,
    undoable: false,
  },
  {
    name: "delete_monitor",
    description:
      "Supprimer définitivement un monitor. Protections : vérifie l'absence de missions liées, " +
      "d'alertes actives et d'incidents ouverts. Demande confirmation explicite. Undo (30 min) possible.",
    parameters: {
      type: "object",
      properties: {
        monitor_id: { type: "string", description: "ID du monitor à supprimer" },
        force:      { type: "boolean", description: "Forcer la suppression malgré les protections (défaut: false)" },
      },
      required: ["monitor_id"],
    },
    requiredPermission: "monitors.delete",
    confirmationLevel: "full",
    isWrite: true,
    undoable: true,
  },
];

// ── Tool-by-name map ─────────────────────────────────────────────────────────

export const MONITOR_TOOL_BY_NAME = new Map<string, ToolDef>(
  MONITOR_TOOLS.map((t) => [t.name, t])
);

// ── Zod schemas pour validation des arguments ─────────────────────────────────

export const MONITOR_ARG_SCHEMAS = {
  search_monitors: z.object({
    query:       z.string().max(200).optional(),
    status:      z.enum(["up", "down", "paused", "unknown", "all"]).optional(),
    is_critical: z.boolean().optional(),
    enabled:     z.boolean().optional(),
    limit:       z.number().int().min(1).max(100).optional(),
  }),
  search_incidents: z.object({
    monitor_id:     z.string().max(100).optional(),
    status:         z.enum(["active", "resolved", "all"]).optional(),
    period_days:    z.number().int().min(1).max(365).optional(),
    min_duration_s: z.number().min(0).optional(),
    limit:          z.number().int().min(1).max(100).optional(),
  }),
  explain_incident: z.object({
    incident_id: z.string().min(1).max(100),
  }),
  compare_incidents: z.object({
    incident_ids: z.array(z.string().max(100)).min(2).max(10),
    metrics:      z.array(z.enum(["duration", "frequency", "type", "causes", "impact"])).optional(),
  }),
  acknowledge_incident: z.object({
    incident_id: z.string().min(1).max(100),
    note:        z.string().max(500).optional(),
  }),
  resolve_incident: z.object({
    incident_id:     z.string().min(1).max(100),
    resolution_note: z.string().max(500).optional(),
  }),
  create_missions_from_incident: z.object({
    incident_id:   z.string().min(1).max(100),
    mission_types: z.array(z.enum(["investigation", "correction", "verification", "suivi"])).optional(),
    assignee_id:   z.string().max(100).optional(),
  }),
  optimize_monitors: z.object({
    focus: z.enum(["frequency", "coverage", "duplicates", "false_positives", "all"]).optional(),
  }),
  configure_monitor: z.object({
    monitor_id:  z.string().max(100).optional(),
    url:         z.string().url().max(2000).optional(),
    name:        z.string().max(200).optional(),
    frequency:   z.number().int().min(30).max(86400).optional(),
    timeout:     z.number().int().min(5).max(120).optional(),
    alert_email: z.string().email().max(200).optional(),
    alert_phone: z.string().max(30).optional(),
    is_critical: z.boolean().optional(),
    enabled:     z.boolean().optional(),
  }),
  suspend_monitor: z.object({
    monitor_id: z.string().min(1).max(100),
    reason:     z.string().max(300).optional(),
  }),
  resume_monitor: z.object({
    monitor_id: z.string().min(1).max(100),
  }),
  delete_monitor: z.object({
    monitor_id: z.string().min(1).max(100),
    force:      z.boolean().optional(),
  }),
};

// ── Snapshot helper ───────────────────────────────────────────────────────────

export async function snapMonitor(
  monitorId: string,
  orgId: string,
  pool: import("pg").Pool
): Promise<Record<string, unknown> | null> {
  try {
    const r = await pool.query(
      `SELECT id, org_id, name, url, status, uptime, latency, last_check,
              alert_email, alert_phone, is_critical, frequency, enabled, created_at, updated_at
         FROM monitors WHERE id=$1 AND org_id=$2`,
      [monitorId, orgId]
    );
    return (r.rows[0] as Record<string, unknown>) ?? null;
  } catch { return null; }
}

export async function snapIncident(
  incidentId: string,
  orgId: string,
  pool: import("pg").Pool
): Promise<Record<string, unknown> | null> {
  try {
    const r = await pool.query(
      `SELECT id, monitor_id, org_id, started_at, resolved_at, duration_s, error
         FROM monitor_incidents WHERE id=$1 AND org_id=$2`,
      [incidentId, orgId]
    );
    return (r.rows[0] as Record<string, unknown>) ?? null;
  } catch { return null; }
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function fmtMonitorStatus(status: unknown): string {
  if (status === "up")      return "✅ En ligne";
  if (status === "down")    return "🔴 Hors ligne";
  if (status === "paused")  return "⏸️ Suspendu";
  return "❓ Inconnu";
}

export function fmtDurationS(s: unknown): string {
  const n = Number(s ?? 0);
  if (n < 60)     return `${n}s`;
  if (n < 3600)   return `${Math.round(n / 60)}min`;
  if (n < 86400)  return `${(n / 3600).toFixed(1)}h`;
  return `${(n / 86400).toFixed(1)}j`;
}

export function fmtUptimePct(uptime: unknown): string {
  const n = Number(uptime ?? 0);
  return `${n.toFixed(2)}%`;
}
