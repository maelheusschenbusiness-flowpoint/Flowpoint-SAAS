/**
 * FlowPoint AI Agents — Phase 3 : Définitions d'outils Calendrier.
 *
 * SOURCE DE VÉRITÉ pour les 5 outils calendrier.
 * Mêmes règles que Phase 2 (missions) :
 *  - permission effective requise
 *  - niveau de confirmation obligatoire
 *  - snapshot avant write → Undo disponible
 *  - L'IA ne doit JAMAIS inventer un ID d'événement
 */
import { z } from "zod";
import type { ToolDef } from "./mission-tools.js";
import type { Pool } from "pg";

// ── Catalogue d'outils — Phase 3 : Calendrier ─────────────────────────────
export const CALENDAR_TOOLS: ToolDef[] = [
  {
    name: "search_calendar_event",
    description:
      "Recherche des événements dans le calendrier FlowPoint par titre, date, type, notes ou nom de client. " +
      "APPEL OBLIGATOIRE pour TOUTE question sur les événements : 'qu'est-ce que j'ai cette semaine ?', " +
      "'mes RDV de demain', 'quels sont mes événements de lundi ?', 'qu'est-ce que j'ai prévu ?', etc. " +
      "Ne jamais répondre en texte seul pour une question calendrier — toujours appeler cet outil pour obtenir les vraies données. " +
      "À utiliser AVANT toute modification pour trouver l'ID réel d'un événement. " +
      "L'IA ne doit JAMAIS inventer un ID d'événement.",
    requiredPermission: "calendar.read",
    confirmationLevel: "none",
    isWrite: false,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Mots-clés à chercher dans le titre, notes ou nom du client (optionnel).",
        },
        date: {
          type: "string",
          description: "Date exacte au format YYYY-MM-DD, ou période : 'today', 'tomorrow', 'week', 'month' (optionnel).",
        },
        type: {
          type: "string",
          description: "Type d'événement : Réunion, Rendez-vous, Formation, Autre… (optionnel).",
        },
        limit: {
          type: "number",
          description: "Nombre maximum de résultats (défaut : 5, max : 15).",
          minimum: 1,
          maximum: 15,
        },
      },
    },
  },
  {
    name: "create_calendar_event",
    description:
      "Crée un nouvel événement dans le calendrier FlowPoint. " +
      "RÉSOLUTION DES EXPRESSIONS RELATIVES : utilise la date et l'heure actuelles injectées dans le contexte calendrier pour calculer la date/heure ISO exacte. " +
      "Exemples : 'dans 30 minutes' → ajouter 30 min à l'heure actuelle ; 'dans une heure' → +60 min ; 'demain matin' → demain 09:00 ; 'vendredi dans deux semaines' → vendredi +14 j. " +
      "Ne jamais supposer silencieusement — si une expression est ambiguë, demander une clarification. " +
      "Vérifie automatiquement les conflits de créneau avant la création. " +
      "Si le titre ou la date manque, demander à l'utilisateur avant d'appeler cet outil. " +
      "Niveau de confirmation : aperçu présenté avant la création effective.",
    requiredPermission: "calendar.write",
    confirmationLevel: "preview",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Titre de l'événement (obligatoire, max 200 caractères)." },
        date: { type: "string", description: "Date au format YYYY-MM-DD (obligatoire)." },
        startTime: { type: "string", description: "Heure de début au format HH:MM (ex : 09:00)." },
        duration: { type: "number", description: "Durée en minutes (défaut : 60).", minimum: 5, maximum: 1440 },
        notes: { type: "string", description: "Notes ou description de l'événement." },
        site: { type: "string", description: "Site ou URL associé à l'événement." },
        type: { type: "string", description: "Type d'événement (Réunion, Rendez-vous, Formation, Autre…)." },
        clientName: { type: "string", description: "Nom du client ou participant principal." },
        priority: {
          type: "string",
          enum: ["low", "normal", "high", "urgent"],
          description: "Priorité de l'événement (défaut : normal).",
        },
        color: { type: "string", description: "Couleur en hex (ex : #3b82f6)." },
        reminder: {
          type: "number",
          description: "Rappel en minutes avant l'événement (0 = pas de rappel).",
          minimum: 0,
          maximum: 10080,
        },
        linkedMissionId: { type: "string", description: "ID de la mission FlowPoint liée (optionnel)." },
      },
      required: ["title", "date"],
    },
  },
  {
    name: "update_calendar_event",
    description:
      "Modifie un ou plusieurs champs d'un événement existant dans le calendrier. " +
      "Utiliser search_calendar_event pour trouver l'ID avant d'appeler cet outil. " +
      "Seuls les champs fournis sont modifiés — les autres restent inchangés. " +
      "Aperçu présenté à l'utilisateur avant la modification.",
    requiredPermission: "calendar.write",
    confirmationLevel: "preview",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID de l'événement à modifier (obtenu via search_calendar_event)." },
        title: { type: "string", description: "Nouveau titre." },
        date: { type: "string", description: "Nouvelle date YYYY-MM-DD." },
        startTime: { type: "string", description: "Nouvelle heure HH:MM." },
        duration: { type: "number", description: "Nouvelle durée en minutes.", minimum: 5, maximum: 1440 },
        notes: { type: "string", description: "Nouvelles notes." },
        site: { type: "string", description: "Nouveau site." },
        type: { type: "string", description: "Nouveau type d'événement." },
        clientName: { type: "string", description: "Nouveau nom de client." },
        priority: {
          type: "string",
          enum: ["low", "normal", "high", "urgent"],
          description: "Nouvelle priorité.",
        },
        color: { type: "string", description: "Nouvelle couleur (hex)." },
        reminder: { type: "number", description: "Nouveau rappel en minutes.", minimum: 0, maximum: 10080 },
        linkedMissionId: { type: "string", description: "Nouvel ID de mission liée." },
      },
      required: ["id"],
    },
  },
  {
    name: "move_calendar_event",
    description:
      "Déplace un événement vers une nouvelle date et/ou heure. " +
      "Spécialisé pour les demandes de type : 'décale ce rendez-vous à jeudi', 'avance d'une heure', 'passe-le demain matin'. " +
      "RÉSOLUTION DES EXPRESSIONS RELATIVES : utilise la date et l'heure actuelles injectées dans le contexte calendrier pour calculer la nouvelle date/heure ISO exacte ('avance d'une heure' → heure actuelle +60 min). " +
      "Vérifie les conflits de créneau avant le déplacement. " +
      "Utiliser search_calendar_event pour obtenir l'ID avant d'appeler cet outil. " +
      "Aperçu présenté avant le déplacement.",
    requiredPermission: "calendar.write",
    confirmationLevel: "preview",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID de l'événement à déplacer." },
        newDate: { type: "string", description: "Nouvelle date YYYY-MM-DD." },
        newStartTime: { type: "string", description: "Nouvelle heure HH:MM." },
        newDuration: {
          type: "number",
          description: "Nouvelle durée en minutes (optionnel — inchangée si absent).",
          minimum: 5,
          maximum: 1440,
        },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_calendar_event",
    description:
      "Supprime définitivement un événement du calendrier. " +
      "Confirmation obligatoire de niveau 'full' (action irréversible sauf Annuler dans les 30 minutes). " +
      "Utiliser search_calendar_event pour obtenir l'ID avant d'appeler cet outil.",
    requiredPermission: "calendar.delete",
    confirmationLevel: "full",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID de l'événement à supprimer." },
      },
      required: ["id"],
    },
  },

  // ── Phase 3 capacités avancées ─────────────────────────────────────────────

  {
    name: "find_free_slots",
    description:
      "Trouve les créneaux libres dans une journée ou une plage de dates. " +
      "Utiliser pour répondre à 'quand suis-je libre ?', 'trouve-moi un créneau de 2h vendredi', " +
      "'est-ce que j'ai du temps lundi matin ?'. " +
      "Utilise la date/heure injectée dans le contexte pour résoudre les expressions relatives. " +
      "Outil en lecture seule — aucune confirmation requise.",
    requiredPermission: "calendar.read",
    confirmationLevel: "none",
    isWrite: false,
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description:
            "Date YYYY-MM-DD pour un seul jour, ou période : 'today', 'tomorrow', 'week' (7 prochains jours).",
        },
        duration: {
          type: "number",
          description: "Durée cherchée en minutes (défaut : 60).",
          minimum: 5,
          maximum: 480,
        },
        startHour: {
          type: "number",
          description: "Heure de début de la plage de recherche, 0-23 (défaut : 8 = 8h00).",
          minimum: 0,
          maximum: 23,
        },
        endHour: {
          type: "number",
          description: "Heure de fin de la plage de recherche, 1-24 (défaut : 18 = 18h00).",
          minimum: 1,
          maximum: 24,
        },
        limit: {
          type: "number",
          description: "Nombre maximum de créneaux à retourner (défaut : 5, max : 20).",
          minimum: 1,
          maximum: 20,
        },
      },
      required: ["date"],
    },
  },

  {
    name: "reschedule_week",
    description:
      "Déplace tous les événements d'une semaine vers une autre semaine en conservant la position " +
      "relative de chaque événement dans la semaine (lundi→lundi, mardi→mardi, etc.). " +
      "Utiliser pour 'décale ma semaine du 10 août au 17 août', 'je serai absent cette semaine, déplace tout à la semaine prochaine'. " +
      "Utiliser search_calendar_event pour vérifier les événements avant d'appeler cet outil. " +
      "Transaction atomique : tout passe ou rien ne passe. " +
      "Aperçu présenté avant l'exécution. Annulation possible dans les 30 minutes.",
    requiredPermission: "calendar.write",
    confirmationLevel: "preview",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        sourceWeekStart: {
          type: "string",
          description: "Date du lundi de la semaine source (YYYY-MM-DD).",
        },
        targetWeekStart: {
          type: "string",
          description: "Date du lundi de la semaine cible (YYYY-MM-DD).",
        },
        eventIds: {
          type: "array",
          items: { type: "string" },
          description: "IDs d'événements spécifiques à déplacer (optionnel — tous les événements de la semaine si absent).",
          maxItems: 50,
        },
      },
      required: ["sourceWeekStart", "targetWeekStart"],
    },
  },

  {
    name: "optimize_schedule",
    description:
      "Réorganise les événements d'une journée pour les regrouper et minimiser les trous entre les réunions. " +
      "Utiliser pour 'optimise mon planning de mardi', 'regroupe mes réunions de demain', " +
      "'j'ai trop de trous dans mon agenda du 15, arrange ça'. " +
      "Les événements sans heure définie ne sont pas touchés. " +
      "Transaction atomique. Aperçu présenté avant modification. Annulation possible dans les 30 minutes.",
    requiredPermission: "calendar.write",
    confirmationLevel: "preview",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Date YYYY-MM-DD de la journée à optimiser.",
        },
        startHour: {
          type: "number",
          description: "Heure de début de la plage de travail, 0-23 (défaut : 9).",
          minimum: 0,
          maximum: 23,
        },
        breakMinutes: {
          type: "number",
          description: "Pause minimum en minutes entre deux événements (défaut : 15).",
          minimum: 0,
          maximum: 60,
        },
      },
      required: ["date"],
    },
  },

  {
    name: "create_recurring_event",
    description:
      "Crée un événement récurrent avec une règle de récurrence. " +
      "Utiliser pour 'réunion hebdo chaque lundi', 'scrum quotidien', 'bilan mensuel le 1er du mois'. " +
      "Crée plusieurs occurrences en DB selon la règle. " +
      "RRULE supportées : 'DAILY' (quotidien), 'WEEKLY' (hebdomadaire), 'MONTHLY' (mensuel), " +
      "'WEEKLY:2' (toutes les 2 semaines), 'DAILY:2' (tous les 2 jours). " +
      "Aperçu présenté avant création. Annulation possible dans les 30 minutes (supprime toutes les occurrences).",
    requiredPermission: "calendar.write",
    confirmationLevel: "preview",
    isWrite: true,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Titre de l'événement (obligatoire, max 200 caractères)." },
        startDate: { type: "string", description: "Date de la première occurrence YYYY-MM-DD (obligatoire)." },
        startTime: { type: "string", description: "Heure de début HH:MM (ex : 09:00)." },
        duration: { type: "number", description: "Durée en minutes (défaut : 60).", minimum: 5, maximum: 1440 },
        rrule: {
          type: "string",
          description:
            "Règle de récurrence : 'DAILY', 'WEEKLY', 'MONTHLY', 'WEEKLY:2' (toutes les 2 semaines), " +
            "'DAILY:2' (tous les 2 jours), 'MONTHLY:2' (tous les 2 mois). " +
            "Construis cette chaîne depuis la demande de l'utilisateur.",
        },
        occurrences: {
          type: "number",
          description: "Nombre d'occurrences à créer (défaut : 4, max : 52).",
          minimum: 1,
          maximum: 52,
        },
        type: { type: "string", description: "Type d'événement (Réunion, Rendez-vous, Formation, Autre…)." },
        notes: { type: "string", description: "Notes ou description." },
        clientName: { type: "string", description: "Nom du client ou participant." },
        priority: {
          type: "string",
          enum: ["low", "normal", "high", "urgent"],
          description: "Priorité (défaut : normal).",
        },
        color: { type: "string", description: "Couleur en hex (ex : #3b82f6)." },
      },
      required: ["title", "startDate", "rrule"],
    },
  },
];

// ── Map pour tool-executor ─────────────────────────────────────────────────
export const CALENDAR_TOOL_BY_NAME = new Map<string, ToolDef>(
  CALENDAR_TOOLS.map((t) => [t.name, t])
);

// ── Schémas Zod de validation ─────────────────────────────────────────────
export const CALENDAR_ARG_SCHEMAS = {
  search_calendar_event: z
    .object({
      query: z.string().max(200).optional(),
      date: z.string().max(50).optional(),
      type: z.string().max(100).optional(),
      limit: z.number().int().min(1).max(15).optional(),
    })
    .refine(
      (d) => d.query !== undefined || d.date !== undefined || d.type !== undefined,
      { message: "Au moins un critère requis : query, date ou type." }
    ),

  create_calendar_event: z.object({
    title: z.string().min(1).max(200),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD requis"),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, "Format HH:MM requis").optional(),
    duration: z.number().int().min(5).max(1440).optional(),
    notes: z.string().max(2000).optional(),
    site: z.string().max(500).optional(),
    type: z.string().max(100).optional(),
    clientName: z.string().max(200).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    color: z.string().max(20).optional(),
    reminder: z.number().int().min(0).max(10080).optional(),
    linkedMissionId: z.string().max(100).optional(),
  }),

  update_calendar_event: z.object({
    id: z.string().min(1).max(100),
    title: z.string().min(1).max(200).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    duration: z.number().int().min(5).max(1440).optional(),
    notes: z.string().max(2000).optional(),
    site: z.string().max(500).optional(),
    type: z.string().max(100).optional(),
    clientName: z.string().max(200).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    color: z.string().max(20).optional(),
    reminder: z.number().int().min(0).max(10080).optional(),
    linkedMissionId: z.string().max(100).optional(),
  }),

  move_calendar_event: z
    .object({
      id: z.string().min(1).max(100),
      newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      newStartTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      newDuration: z.number().int().min(5).max(1440).optional(),
    })
    .refine(
      (d) => d.newDate !== undefined || d.newStartTime !== undefined,
      { message: "newDate ou newStartTime est requis pour déplacer un événement." }
    ),

  delete_calendar_event: z.object({
    id: z.string().min(1).max(100),
  }),

  // ── Phase 3 capacités avancées ─────────────────────────────────────────────

  find_free_slots: z.object({
    date: z.string().min(1).max(50),
    duration: z.number().int().min(5).max(480).optional(),
    startHour: z.number().int().min(0).max(23).optional(),
    endHour: z.number().int().min(1).max(24).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  }),

  reschedule_week: z.object({
    sourceWeekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD requis"),
    targetWeekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD requis"),
    eventIds: z.array(z.string().max(100)).max(50).optional(),
  }),

  optimize_schedule: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD requis"),
    startHour: z.number().int().min(0).max(23).optional(),
    breakMinutes: z.number().int().min(0).max(60).optional(),
  }),

  create_recurring_event: z.object({
    title: z.string().min(1).max(200),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD requis"),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    duration: z.number().int().min(5).max(1440).optional(),
    rrule: z.string().min(1).max(200),
    occurrences: z.number().int().min(1).max(52).optional(),
    type: z.string().max(100).optional(),
    notes: z.string().max(2000).optional(),
    clientName: z.string().max(200).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    color: z.string().max(20).optional(),
  }),
};

// ── Snapshot helper ────────────────────────────────────────────────────────

/**
 * Capture un snapshot complet de l'événement avant toute write.
 * Inclut updated_at pour l'ancre de version Undo.
 */
export async function snapCalendarEvent(
  eventId: string,
  orgId: string,
  pool: Pool
): Promise<Record<string, unknown> | null> {
  try {
    const r = await pool.query(
      `SELECT id, title, site, type, date, start_time, duration, notes, client_name,
              priority, color, reminder, linked_mission_id, org_id, updated_at, created_at
       FROM calendar_events WHERE id = $1 AND org_id = $2`,
      [eventId, orgId]
    );
    return r.rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Calcule les dates d'un événement récurrent à partir d'une RRULE simplifiée.
 * Formats supportés : DAILY, WEEKLY, MONTHLY, WEEKLY:N, DAILY:N, MONTHLY:N
 */
export function computeRecurrenceDates(startDate: string, rrule: string, count: number): string[] {
  const dates: string[] = [];
  const upper = rrule.trim().toUpperCase();
  const [freq, intervalStr] = upper.split(":");
  const interval = Math.max(1, parseInt(intervalStr ?? "1", 10) || 1);

  for (let i = 0; i < count; i++) {
    // Use UTC to avoid DST-induced date drift
    const base = new Date(startDate + "T00:00:00Z");
    if (freq === "DAILY") {
      base.setUTCDate(base.getUTCDate() + i * interval);
    } else if (freq === "WEEKLY") {
      base.setUTCDate(base.getUTCDate() + i * 7 * interval);
    } else if (freq === "MONTHLY") {
      // Add months without overflowing into next month (e.g. Jan 31 + 1 month → Feb 28)
      const originalDay = base.getUTCDate();
      base.setUTCMonth(base.getUTCMonth() + i * interval, 1);
      const daysInMonth = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
      base.setUTCDate(Math.min(originalDay, daysInMonth));
    } else {
      break; // Unknown freq — stop
    }
    dates.push(base.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * Détecte les conflits de créneau pour un événement proposé.
 * Retourne les événements existants qui se chevauchent.
 */
export async function detectCalendarConflicts(opts: {
  orgId: string;
  date: string;
  startTime?: string;
  duration?: number;
  excludeId?: string;
  pool: Pool;
}): Promise<Array<{ id: string; title: string; start_time: string; duration: number }>> {
  if (!opts.startTime) return [];
  try {
    const [h, m] = opts.startTime.split(":").map(Number);
    const startMin = (h ?? 0) * 60 + (m ?? 0);
    const dur = opts.duration ?? 60;
    const endMin = startMin + dur;

    let sql = `
      SELECT id, title, start_time, duration
      FROM calendar_events
      WHERE org_id = $1
        AND date = $2
        AND start_time != ''
    `;
    const params: unknown[] = [opts.orgId, opts.date];
    if (opts.excludeId) {
      sql += ` AND id != $3`;
      params.push(opts.excludeId);
    }

    const r = await opts.pool.query(sql, params);
    return r.rows.filter((row) => {
      const [rh, rm] = String(row["start_time"] ?? "00:00").split(":").map(Number);
      const rStart = (rh ?? 0) * 60 + (rm ?? 0);
      const rEnd = rStart + (Number(row["duration"]) || 60);
      return startMin < rEnd && endMin > rStart;
    }) as Array<{ id: string; title: string; start_time: string; duration: number }>;
  } catch {
    return [];
  }
}
