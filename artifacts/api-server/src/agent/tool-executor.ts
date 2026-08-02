/**
 * FlowPoint AI Agents — Phase 2 : Moteur d'exécution des outils.
 *
 * Sécurité (dans l'ordre) :
 *  1. Validation Zod des arguments (taille, type, enum)
 *  2. Vérification permission effective (resolveEffectivePermissions — fail-closed)
 *  3. Vérification org isolation (l'ID de mission appartient à orgId)
 *  4. Capture snapshot avant toute write
 *  5. Appel du service métier existant (missions routes/service)
 *  6. Journalisation ai_action_logs + activity_logs
 *
 * Toute erreur de validation → résultat d'erreur structuré retourné au modèle,
 * jamais un crash 500.
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { store } from "../services/store.js";
import { TOOL_BY_NAME as _MISSION_TOOL_BY_NAME, TOOL_ARG_SCHEMAS as _MISSION_ARG_SCHEMAS, type AIToolCall, type AIToolCallResult } from "./mission-tools.js";
import { CALENDAR_TOOL_BY_NAME, CALENDAR_ARG_SCHEMAS, snapCalendarEvent, detectCalendarConflicts, computeRecurrenceDates } from "./calendar-tools.js";
import { filterDestinations, validateNavAction } from "./destination-registry.js";
import { createNavigationProposal, type ActionProposal } from "./proposals.js";
import type { Permission } from "./permissions.js";

// ── Phase 3 : registre unifié missions + calendrier ───────────────────────
const TOOL_BY_NAME: Map<string, import("./mission-tools.js").ToolDef> = new Map([
  ..._MISSION_TOOL_BY_NAME, ...CALENDAR_TOOL_BY_NAME,
]);
const TOOL_ARG_SCHEMAS: Record<string, { safeParse: (x: unknown) => { success: boolean; data?: unknown; error?: { issues: Array<{ path: string[]; message: string }> } } }> = {
  ..._MISSION_ARG_SCHEMAS,
  ...(CALENDAR_ARG_SCHEMAS as Record<string, { safeParse: (x: unknown) => { success: boolean; data?: unknown; error?: { issues: Array<{ path: string[]; message: string }> } } }>),
};

// ── Snapshot helpers ─────────────────────────────────────────────────────────

async function snapMission(missionId: string, orgId: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await pool.query(
      `SELECT id, title, description, status, priority, category, due_date, assigned_to, steps,
              completed_at, dismissed_at, updated_at, created_at, last_refreshed_at,
              source_type, priority_score
       FROM missions WHERE id = $1 AND org_id = $2`,
      [missionId, orgId]
    );
    return r.rows[0] ?? null;
  } catch {
    return null;
  }
}

// ── Résultats d'exécution ─────────────────────────────────────────────────────

export interface ToolExecutionResult {
  toolCallId: string;
  toolName: string;
  ok: boolean;
  /** Texte à injecter dans le thread de conversation (visible par le modèle). */
  content: string;
  /** Snapshot avant write (pour undo). */
  snapshot?: Record<string, unknown> | null;
  /** Données de la ressource créée/modifiée. */
  data?: Record<string, unknown> | null;
  /** Proposition de navigation (pour navigate_to). */
  navProposal?: ActionProposal | null;
  /** ID du log persiste (pour undo). */
  actionLogId?: string;
  /** Label court pour le bouton Annuler. */
  undoLabel?: string;
}

export interface ExecuteContext {
  orgId: string;
  userId: string;
  conversationId: string;
  provider: string;
  model: string;
  effectivePerms: Set<string>;
  orgPlan: string;
}

function uid(prefix = "al"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function logActionLog(opts: {
  id: string;
  orgId: string;
  userId: string;
  conversationId: string;
  provider: string;
  model: string;
  tool: string;
  args: Record<string, unknown>;
  confirmationLevel: string;
  result: "ok" | "error" | "pending";
  error?: string | null;
  snapshot?: Record<string, unknown> | null;
  /** ISO string of updated_at captured IMMEDIATELY after the write — exact Undo version anchor. */
  versionAfter?: string | null;
  durationMs?: number;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO ai_action_logs
         (id, org_id, user_id, conversation_id, provider, model, tool, args,
          confirmation_level, result, error, undo_snapshot, version_after, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())`,
      [
        opts.id, opts.orgId, opts.userId, opts.conversationId,
        opts.provider, opts.model, opts.tool,
        JSON.stringify(opts.args), opts.confirmationLevel, opts.result,
        opts.error ?? null, opts.snapshot ? JSON.stringify(opts.snapshot) : null,
        opts.versionAfter ?? null,
      ]
    );
  } catch (err) {
    logger.warn({ err }, "[tool-executor] logActionLog failed (non-fatal)");
  }
}

/**
 * Exécute un appel d'outil après validation complète.
 * Ne lève jamais d'exception — retourne un ToolExecutionResult avec ok=false en cas d'erreur.
 */
export async function executeTool(
  call: AIToolCall,
  ctx: ExecuteContext
): Promise<ToolExecutionResult> {
  const t0 = Date.now();
  const logId = uid("al");

  const toolDef = TOOL_BY_NAME.get(call.name);
  if (!toolDef) {
    await logActionLog({ id: logId, ...ctx, tool: call.name, args: call.arguments,
      confirmationLevel: "none", result: "error", error: `Unknown tool: ${call.name}` });
    return { toolCallId: call.id, toolName: call.name, ok: false,
      content: `Outil inconnu : ${call.name}`, actionLogId: logId };
  }

  // 1. Validation Zod
  const schema = TOOL_ARG_SCHEMAS[call.name];
  if (!schema) {
    return { toolCallId: call.id, toolName: call.name, ok: false,
      content: `Schéma absent pour l'outil : ${call.name}`, actionLogId: logId };
  }
  const parseResult = schema.safeParse(call.arguments);
  if (!parseResult.success) {
    const issues = parseResult.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", ");
    await logActionLog({ id: logId, ...ctx, tool: call.name, args: call.arguments,
      confirmationLevel: toolDef.confirmationLevel, result: "error",
      error: `Validation failed: ${issues}` });
    return { toolCallId: call.id, toolName: call.name, ok: false,
      content: `Arguments invalides : ${issues}`, actionLogId: logId };
  }
  const validArgs = parseResult.data as Record<string, unknown>;

  // 2. Vérification permission
  if (!ctx.effectivePerms.has(toolDef.requiredPermission as Permission)) {
    await logActionLog({ id: logId, ...ctx, tool: call.name, args: validArgs,
      confirmationLevel: toolDef.confirmationLevel, result: "error",
      error: `Permission denied: ${toolDef.requiredPermission}` });
    return { toolCallId: call.id, toolName: call.name, ok: false,
      content: `Permission refusée pour ${call.name} — permission requise : ${toolDef.requiredPermission}`,
      actionLogId: logId };
  }

  // 3. Dispatch par outil
  try {
    const result = await dispatchTool(call.name, validArgs, ctx, logId, t0);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, tool: call.name, orgId: ctx.orgId }, "[tool-executor] dispatch error");
    await logActionLog({ id: logId, ...ctx, tool: call.name, args: validArgs,
      confirmationLevel: toolDef.confirmationLevel, result: "error",
      error: msg, durationMs: Date.now() - t0 });
    return { toolCallId: call.id, toolName: call.name, ok: false,
      content: `Erreur lors de l'exécution de ${call.name} : ${msg}`, actionLogId: logId };
  }
}

async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ExecuteContext,
  logId: string,
  t0: number
): Promise<ToolExecutionResult> {
  const { orgId, userId, conversationId, provider, model } = ctx;
  const toolDef = TOOL_BY_NAME.get(name)!;

  // ── search_mission ────────────────────────────────────────────────────────
  if (name === "search_mission") {
    const q = args["query"] as string;
    const status = args["status"] as string | undefined;
    const category = args["category"] as string | undefined;
    const priority = args["priority"] as string | undefined;
    const limit = (args["limit"] as number) ?? 5;

    let sql = `SELECT id, title, description, status, priority, category, due_date, assigned_to, updated_at
               FROM missions
               WHERE org_id = $1 AND (title ILIKE $2 OR description ILIKE $2)`;
    const params: unknown[] = [orgId, `%${q}%`];
    let p = 3;
    if (status) { sql += ` AND status = $${p++}`; params.push(status); }
    if (category) { sql += ` AND category ILIKE $${p++}`; params.push(`%${category}%`); }
    if (priority) { sql += ` AND priority = $${p++}`; params.push(priority); }
    sql += ` ORDER BY priority_score DESC, updated_at DESC LIMIT $${p}`;
    params.push(limit);

    const r = await pool.query(sql, params);
    const missions = r.rows;

    await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
      tool: name, args, confirmationLevel: toolDef.confirmationLevel,
      result: "ok", durationMs: Date.now() - t0 });

    if (missions.length === 0) {
      return { toolCallId: logId, toolName: name, ok: true,
        content: `Aucune mission trouvée pour la recherche "${q}"${status ? ` (statut: ${status})` : ""}. Demande à l'utilisateur de préciser.`,
        actionLogId: logId };
    }

    const list = missions.map(m =>
      `- ID: ${m.id} | Titre: ${m.title} | Statut: ${m.status} | Priorité: ${m.priority} | Catégorie: ${m.category}`
    ).join("\n");

    return { toolCallId: logId, toolName: name, ok: true,
      content: `${missions.length} mission(s) trouvée(s) pour "${q}" :\n${list}`,
      data: { missions }, actionLogId: logId };
  }

  // ── create_mission ────────────────────────────────────────────────────────
  if (name === "create_mission") {
    const title = args["title"] as string;

    // Idempotence : vérifier si une mission identique existe déjà
    const dup = await pool.query(
      `SELECT id FROM missions WHERE org_id = $1 AND LOWER(title) = LOWER($2) AND status != 'done' LIMIT 1`,
      [orgId, title]
    );
    if (dup.rows[0]) {
      return { toolCallId: logId, toolName: name, ok: false,
        content: `Une mission intitulée "${title}" existe déjà (ID: ${dup.rows[0].id}). Utilise update_mission pour la modifier.`,
        actionLogId: logId };
    }

    const id = `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const priority = (args["priority"] as string) ?? "medium";
    const pScore = ({ critical: 90, high: 75, medium: 50, low: 25 } as Record<string, number>)[priority] ?? 50;
    const stepsRaw = args["steps"] as string[] | undefined;
    const stepsArr = stepsRaw?.map((text, i) => ({ id: `s${Date.now()}${i}`, text, done: false })) ?? [];

    await pool.query(`
      INSERT INTO missions (id, org_id, title, description, category, priority, priority_score,
        status, steps, due_date, assigned_to, source_type, created_at, updated_at, last_refreshed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'todo',$8,$9,$10,'ai',NOW(),NOW(),NOW())
    `, [id, orgId, title, (args["description"] as string) ?? null,
        (args["category"] as string) ?? "seo", priority, pScore,
        JSON.stringify(stepsArr), (args["dueDate"] as string) ?? null,
        (args["assignedTo"] as string) ?? null]);

    const row = await pool.query(`SELECT * FROM missions WHERE id = $1`, [id]);
    const mission = row.rows[0];
    const createVersionAfter = mission?.updated_at
      ? new Date(mission.updated_at as string | Date).toISOString()
      : null;

    await store.logActivity({
      type: "report", label: `[IA] Mission créée : ${title}`,
      targetId: id, targetType: "mission",
      metadata: { provider, model, tool: name }, orgId,
    }).catch(() => {});

    // Snapshot the created mission so undo (= delete) has the ID available
    await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
      tool: name, args, confirmationLevel: toolDef.confirmationLevel,
      result: "ok", snapshot: mission ?? { id }, versionAfter: createVersionAfter, durationMs: Date.now() - t0 });

    return { toolCallId: logId, toolName: name, ok: true,
      content: `Mission créée avec succès — ID: ${id} | Titre: "${title}" | Priorité: ${priority}`,
      data: mission, actionLogId: logId,
      undoLabel: `Annuler la création de "${title}"` };
  }

  // ── update_mission ────────────────────────────────────────────────────────
  if (name === "update_mission") {
    const id = args["id"] as string;
    const snapshot = await snapMission(id, orgId);
    if (!snapshot) {
      return { toolCallId: logId, toolName: name, ok: false,
        content: `Mission ID "${id}" introuvable dans votre organisation. Utilise search_mission pour trouver l'ID correct.`,
        actionLogId: logId };
    }

    const newStatus = (args["status"] as string) ?? (snapshot["status"] as string);
    const isNowDone = newStatus === "done" && snapshot["status"] !== "done";
    const isNowDismissed = newStatus === "dismissed" && snapshot["status"] !== "dismissed";

    await pool.query(`
      UPDATE missions SET
        title       = COALESCE($1, title),
        description = COALESCE($2, description),
        status      = $3,
        priority    = COALESCE($4, priority),
        due_date    = COALESCE($5, due_date),
        assigned_to = COALESCE($6, assigned_to),
        completed_at = CASE WHEN $7 THEN NOW() ELSE completed_at END,
        dismissed_at = CASE WHEN $8 THEN NOW() ELSE dismissed_at END,
        updated_at  = NOW()
      WHERE id = $9 AND org_id = $10
    `, [
      (args["title"] as string) ?? null, (args["description"] as string) ?? null,
      newStatus, (args["priority"] as string) ?? null,
      (args["dueDate"] as string) ?? null, (args["assignedTo"] as string) ?? null,
      isNowDone, isNowDismissed, id, orgId,
    ]);

    // Capture updated_at immediately after the write — exact Undo version anchor
    const updateVersionRow = await pool.query<{ updated_at: Date | null }>(
      `SELECT updated_at FROM missions WHERE id = $1 AND org_id = $2`, [id, orgId]);
    const updateVersionAfter = updateVersionRow.rows[0]?.updated_at
      ? new Date(updateVersionRow.rows[0].updated_at).toISOString()
      : null;

    await store.logActivity({
      type: "report", label: `[IA] Mission modifiée : ${snapshot["title"]}`,
      targetId: id, targetType: "mission",
      metadata: { provider, model, tool: name, changes: args }, orgId,
    }).catch(() => {});

    await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
      tool: name, args, confirmationLevel: toolDef.confirmationLevel,
      result: "ok", snapshot, versionAfter: updateVersionAfter, durationMs: Date.now() - t0 });

    return { toolCallId: logId, toolName: name, ok: true,
      content: `Mission "${snapshot["title"]}" (ID: ${id}) modifiée avec succès.`,
      data: { id, updated: args }, snapshot, actionLogId: logId,
      undoLabel: `Annuler la modification de "${snapshot["title"]}"` };
  }

  // ── complete_mission ──────────────────────────────────────────────────────
  if (name === "complete_mission") {
    const id = args["id"] as string;
    const snapshot = await snapMission(id, orgId);
    if (!snapshot) {
      return { toolCallId: logId, toolName: name, ok: false,
        content: `Mission ID "${id}" introuvable dans votre organisation.`,
        actionLogId: logId };
    }
    if (snapshot["status"] === "done") {
      return { toolCallId: logId, toolName: name, ok: true,
        content: `La mission "${snapshot["title"]}" (ID: ${id}) est déjà marquée comme terminée.`,
        actionLogId: logId };
    }

    await pool.query(
      `UPDATE missions SET status = 'done', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2`,
      [id, orgId]
    );

    const completeVersionRow = await pool.query<{ updated_at: Date | null }>(
      `SELECT updated_at FROM missions WHERE id = $1 AND org_id = $2`, [id, orgId]);
    const completeVersionAfter = completeVersionRow.rows[0]?.updated_at
      ? new Date(completeVersionRow.rows[0].updated_at).toISOString()
      : null;

    await store.logActivity({
      type: "report", label: `[IA] Mission accomplie : ${snapshot["title"]}`,
      targetId: id, targetType: "mission",
      metadata: { provider, model, tool: name }, orgId,
    }).catch(() => {});

    await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
      tool: name, args, confirmationLevel: toolDef.confirmationLevel,
      result: "ok", snapshot, versionAfter: completeVersionAfter, durationMs: Date.now() - t0 });

    return { toolCallId: logId, toolName: name, ok: true,
      content: `Mission "${snapshot["title"]}" (ID: ${id}) marquée comme terminée ✓`,
      data: { id, status: "done" }, snapshot, actionLogId: logId,
      undoLabel: `Annuler la complétion de "${snapshot["title"]}"` };
  }

  // ── assign_mission ────────────────────────────────────────────────────────
  if (name === "assign_mission") {
    const id = args["id"] as string;
    const assignedTo = args["assignedTo"] as string;
    const snapshot = await snapMission(id, orgId);
    if (!snapshot) {
      return { toolCallId: logId, toolName: name, ok: false,
        content: `Mission ID "${id}" introuvable dans votre organisation.`,
        actionLogId: logId };
    }

    await pool.query(
      `UPDATE missions SET assigned_to = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
      [assignedTo, id, orgId]
    );

    const assignVersionRow = await pool.query<{ updated_at: Date | null }>(
      `SELECT updated_at FROM missions WHERE id = $1 AND org_id = $2`, [id, orgId]);
    const assignVersionAfter = assignVersionRow.rows[0]?.updated_at
      ? new Date(assignVersionRow.rows[0].updated_at).toISOString()
      : null;

    await store.logActivity({
      type: "report", label: `[IA] Mission attribuée : ${snapshot["title"]} → ${assignedTo}`,
      targetId: id, targetType: "mission",
      metadata: { provider, model, tool: name, assignedTo }, orgId,
    }).catch(() => {});

    await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
      tool: name, args, confirmationLevel: toolDef.confirmationLevel,
      result: "ok", snapshot, versionAfter: assignVersionAfter, durationMs: Date.now() - t0 });

    return { toolCallId: logId, toolName: name, ok: true,
      content: `Mission "${snapshot["title"]}" (ID: ${id}) attribuée à ${assignedTo}.`,
      data: { id, assignedTo }, snapshot, actionLogId: logId,
      undoLabel: `Annuler l'attribution de "${snapshot["title"]}"` };
  }

  // ── delete_mission ────────────────────────────────────────────────────────
  if (name === "delete_mission") {
    const id = args["id"] as string;
    const snapshot = await snapMission(id, orgId);
    if (!snapshot) {
      return { toolCallId: logId, toolName: name, ok: false,
        content: `Mission ID "${id}" introuvable dans votre organisation.`,
        actionLogId: logId };
    }

    await pool.query(`DELETE FROM missions WHERE id = $1 AND org_id = $2`, [id, orgId]);
    await pool.query(`DELETE FROM mission_history WHERE mission_id = $1`, [id]);

    await store.logActivity({
      type: "report", label: `[IA] Mission supprimée : ${snapshot["title"]}`,
      targetId: id, targetType: "mission",
      metadata: { provider, model, tool: name }, orgId,
    }).catch(() => {});

    // version_after = null for delete (row no longer exists)
    await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
      tool: name, args, confirmationLevel: toolDef.confirmationLevel,
      result: "ok", snapshot, versionAfter: null, durationMs: Date.now() - t0 });

    return { toolCallId: logId, toolName: name, ok: true,
      content: `Mission "${snapshot["title"]}" (ID: ${id}) supprimée définitivement.`,
      data: { id, deleted: true }, snapshot, actionLogId: logId,
      undoLabel: `Annuler la suppression de "${snapshot["title"]}"` };
  }

  // ── navigate_to ───────────────────────────────────────────────────────────
  if (name === "navigate_to") {
    const raw = {
      destinationId: args["destinationId"],
      label: args["label"],
      highlight: args["highlight"] ?? null,
    };

    const nav = validateNavAction(raw, ctx.effectivePerms, ctx.orgPlan);
    if (!nav) {
      return { toolCallId: logId, toolName: name, ok: false,
        content: `Destination "${raw.destinationId}" invalide ou non autorisée pour cet utilisateur.`,
        actionLogId: logId };
    }

    const proposal = await createNavigationProposal({
      orgId, userId, conversationId, provider, model, navActions: [nav],
    });

    await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
      tool: name, args, confirmationLevel: toolDef.confirmationLevel,
      result: "ok", durationMs: Date.now() - t0 });

    return { toolCallId: logId, toolName: name, ok: true,
      content: `Navigation proposée vers "${nav.route}"${nav.highlight ? ` (ancre: ${nav.highlight})` : ""}.`,
      navProposal: proposal, actionLogId: logId };
  }

  // ── search_calendar_event ─────────────────────────────────────────────────
  if (name === "search_calendar_event") {
    const query    = args["query"] as string | undefined;
    const dateArg  = args["date"]  as string | undefined;
    const typeArg  = args["type"]  as string | undefined;
    const limit    = (args["limit"] as number) ?? 5;

    const today    = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const weekEnd  = new Date(Date.now() + 7  * 86_400_000).toISOString().slice(0, 10);
    const monthEnd = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

    let sql = `SELECT id, title, site, type, date, start_time, duration, notes, client_name, priority, color
               FROM calendar_events WHERE org_id = $1`;
    const params: unknown[] = [orgId];
    let p = 2;

    if (dateArg) {
      if (dateArg === "today")    { sql += ` AND date = $${p++}`;                       params.push(today); }
      else if (dateArg === "tomorrow") { sql += ` AND date = $${p++}`;                  params.push(tomorrow); }
      else if (dateArg === "week")  { sql += ` AND date >= $${p++} AND date <= $${p++}`; params.push(today, weekEnd); }
      else if (dateArg === "month") { sql += ` AND date >= $${p++} AND date <= $${p++}`; params.push(today, monthEnd); }
      else                          { sql += ` AND date = $${p++}`;                       params.push(dateArg); }
    }
    if (query) {
      sql += ` AND (title ILIKE $${p} OR notes ILIKE $${p} OR client_name ILIKE $${p})`; p++;
      params.push(`%${query}%`);
    }
    if (typeArg) { sql += ` AND type ILIKE $${p++}`; params.push(`%${typeArg}%`); }
    sql += ` ORDER BY date ASC, start_time ASC LIMIT $${p}`; params.push(limit);

    const r = await pool.query(sql, params);
    const events = r.rows;

    await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
      tool: name, args, confirmationLevel: toolDef.confirmationLevel,
      result: "ok", durationMs: Date.now() - t0 });

    if (events.length === 0) {
      const crit = [query ? `"${query}"` : null, dateArg, typeArg].filter(Boolean).join(", ");
      return { toolCallId: logId, toolName: name, ok: true,
        content: `Aucun événement trouvé pour ${crit || "cette recherche"}. L'agenda est peut-être vide ou les critères ne correspondent à aucun événement.`,
        actionLogId: logId };
    }

    const list = events.map((e: Record<string, unknown>) =>
      `- ID: ${e["id"]} | "${e["title"]}" | ${e["date"]}${e["start_time"] ? ` à ${e["start_time"]}` : ""}` +
      `${e["duration"] ? ` (${e["duration"]} min)` : ""}` +
      `${e["type"] && e["type"] !== "Autre" ? ` | ${e["type"]}` : ""}` +
      `${e["client_name"] ? ` | Client: ${e["client_name"]}` : ""}` +
      `${e["priority"] && e["priority"] !== "normal" ? ` | Priorité: ${e["priority"]}` : ""}`
    ).join("\n");

    return { toolCallId: logId, toolName: name, ok: true,
      content: `${events.length} événement(s) trouvé(s) :\n${list}`,
      data: { events }, actionLogId: logId };
  }

  // ── create_calendar_event ─────────────────────────────────────────────────
  if (name === "create_calendar_event") {
    const title     = args["title"] as string;
    const date      = args["date"]  as string;
    const startTime = (args["startTime"] as string) ?? "";
    const duration  = (args["duration"] as number) ?? 60;

    // Vérifier les conflits de créneau
    if (startTime) {
      const conflicts = await detectCalendarConflicts({ orgId, date, startTime, duration, pool });
      if (conflicts.length > 0) {
        const msg = conflicts.map(c => `"${c.title}" à ${c.start_time} (${c.duration} min)`).join(", ");
        return { toolCallId: logId, toolName: name, ok: false,
          content: `Conflit de créneau détecté — vous avez déjà : ${msg}. Souhaitez-vous déplacer l'ancien, choisir un autre horaire, ou créer quand même malgré le conflit ?`,
          actionLogId: logId };
      }
    }

    const id = `ce_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await pool.query(`
      INSERT INTO calendar_events
        (id, org_id, title, site, type, date, start_time, duration, notes, client_name,
         priority, color, reminder, linked_mission_id, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
    `, [
      id, orgId, title,
      (args["site"] as string) ?? "",
      (args["type"] as string) ?? "Autre",
      date, startTime, duration,
      (args["notes"] as string) ?? "",
      (args["clientName"] as string) ?? "",
      (args["priority"] as string) ?? "normal",
      (args["color"] as string) ?? "",
      (args["reminder"] as number) ?? 0,
      (args["linkedMissionId"] as string) ?? null,
    ]);

    const row = await pool.query(`SELECT * FROM calendar_events WHERE id = $1`, [id]);
    const event = row.rows[0];
    const createVersionAfter = event?.updated_at
      ? new Date(event.updated_at as string | Date).toISOString()
      : null;

    await store.logActivity({
      type: "report", label: `[IA] Événement créé : "${title}" (${date})`,
      targetId: id, targetType: "calendar_event",
      metadata: { provider, model, tool: name, date, startTime }, orgId,
    }).catch(() => {});

    await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
      tool: name, args, confirmationLevel: toolDef.confirmationLevel,
      result: "ok", snapshot: event ?? { id }, versionAfter: createVersionAfter,
      durationMs: Date.now() - t0 });

    const timeStr = startTime ? ` à ${startTime}` : "";
    const navCreateDest = validateNavAction(
      { destinationId: "calendar-today", label: "Voir mes événements", openMode: "page" },
      ctx.effectivePerms, ctx.orgPlan
    );
    const navCreateProposal = navCreateDest
      ? await createNavigationProposal({ orgId, userId, conversationId, provider, model, navActions: [navCreateDest] })
      : null;
    return { toolCallId: logId, toolName: name, ok: true,
      content: `Événement créé — ID: ${id} | "${title}" | ${date}${timeStr} (${duration} min)`,
      data: event, actionLogId: logId,
      undoLabel: `Annuler la création de "${title}"`,
      navProposal: navCreateProposal };
  }

  // ── update_calendar_event ─────────────────────────────────────────────────
  if (name === "update_calendar_event") {
    const id   = args["id"] as string;
    const snap = await snapCalendarEvent(id, orgId, pool);
    if (!snap) {
      return { toolCallId: logId, toolName: name, ok: false,
        content: `Événement ID "${id}" introuvable. Utilise search_calendar_event pour trouver l'ID exact.`,
        actionLogId: logId };
    }

    const newDate      = (args["date"] as string)      ?? (snap["date"] as string) ?? "";
    const newStartTime = (args["startTime"] as string) ?? (snap["start_time"] as string) ?? "";
    const newDuration  = (args["duration"] as number)  ?? (snap["duration"] as number) ?? 60;

    if ((args["date"] || args["startTime"]) && newStartTime) {
      const conflicts = await detectCalendarConflicts({
        orgId, date: newDate, startTime: newStartTime,
        duration: newDuration, excludeId: id, pool,
      });
      if (conflicts.length > 0) {
        const msg = conflicts.map(c => `"${c.title}" à ${c.start_time}`).join(", ");
        return { toolCallId: logId, toolName: name, ok: false,
          content: `Conflit détecté au nouveau créneau : ${msg}. Voulez-vous choisir un autre horaire ?`,
          actionLogId: logId };
      }
    }

    await pool.query(`
      UPDATE calendar_events SET
        title             = COALESCE($1, title),
        site              = COALESCE($2, site),
        type              = COALESCE($3, type),
        date              = COALESCE($4, date),
        start_time        = COALESCE($5, start_time),
        duration          = COALESCE($6, duration),
        notes             = COALESCE($7, notes),
        client_name       = COALESCE($8, client_name),
        priority          = COALESCE($9, priority),
        color             = COALESCE($10, color),
        reminder          = COALESCE($11::INTEGER, reminder),
        linked_mission_id = COALESCE($12, linked_mission_id),
        updated_at        = NOW()
      WHERE id = $13 AND org_id = $14
    `, [
      (args["title"] as string)     ?? null, (args["site"] as string)   ?? null,
      (args["type"] as string)      ?? null, (args["date"] as string)   ?? null,
      (args["startTime"] as string) ?? null, (args["duration"] as number) != null ? String(args["duration"]) : null,
      (args["notes"] as string)     ?? null, (args["clientName"] as string) ?? null,
      (args["priority"] as string)  ?? null, (args["color"] as string)  ?? null,
      (args["reminder"] as number)  != null ? String(args["reminder"])   : null,
      (args["linkedMissionId"] as string) ?? null,
      id, orgId,
    ]);

    const updRow = await pool.query<{ updated_at: Date | null }>(
      `SELECT updated_at FROM calendar_events WHERE id = $1 AND org_id = $2`, [id, orgId]);
    const updateVersionAfter = updRow.rows[0]?.updated_at
      ? new Date(updRow.rows[0].updated_at).toISOString()
      : null;

    await store.logActivity({
      type: "report", label: `[IA] Événement modifié : "${snap["title"]}"`,
      targetId: id, targetType: "calendar_event",
      metadata: { provider, model, tool: name, changes: args }, orgId,
    }).catch(() => {});

    await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
      tool: name, args, confirmationLevel: toolDef.confirmationLevel,
      result: "ok", snapshot: snap, versionAfter: updateVersionAfter, durationMs: Date.now() - t0 });

    const navUpdateDest = validateNavAction(
      { destinationId: "calendar-today", label: "Voir mes événements", openMode: "page" },
      ctx.effectivePerms, ctx.orgPlan
    );
    const navUpdateProposal = navUpdateDest
      ? await createNavigationProposal({ orgId, userId, conversationId, provider, model, navActions: [navUpdateDest] })
      : null;
    return { toolCallId: logId, toolName: name, ok: true,
      content: `Événement "${snap["title"]}" (ID: ${id}) modifié avec succès.`,
      data: { id, updated: args }, snapshot: snap, actionLogId: logId,
      undoLabel: `Annuler la modification de "${snap["title"]}"`,
      navProposal: navUpdateProposal };
  }

  // ── move_calendar_event ───────────────────────────────────────────────────
  if (name === "move_calendar_event") {
    const id   = args["id"] as string;
    const snap = await snapCalendarEvent(id, orgId, pool);
    if (!snap) {
      return { toolCallId: logId, toolName: name, ok: false,
        content: `Événement ID "${id}" introuvable. Utilise search_calendar_event pour trouver l'ID exact.`,
        actionLogId: logId };
    }

    const newDate      = (args["newDate"] as string)      ?? (snap["date"] as string)       ?? "";
    const newStartTime = (args["newStartTime"] as string) ?? (snap["start_time"] as string) ?? "";
    const newDuration  = (args["newDuration"] as number)  ?? (snap["duration"] as number)   ?? 60;

    if (newStartTime) {
      const conflicts = await detectCalendarConflicts({
        orgId, date: newDate, startTime: newStartTime,
        duration: newDuration, excludeId: id, pool,
      });
      if (conflicts.length > 0) {
        const msg = conflicts.map(c => `"${c.title}" à ${c.start_time}`).join(", ");
        return { toolCallId: logId, toolName: name, ok: false,
          content: `Conflit détecté au créneau cible : ${msg}. Souhaitez-vous un autre horaire ou conserver quand même ?`,
          actionLogId: logId };
      }
    }

    await pool.query(`
      UPDATE calendar_events SET
        date       = $1,
        start_time = $2,
        duration   = $3,
        updated_at = NOW()
      WHERE id = $4 AND org_id = $5
    `, [newDate, newStartTime, newDuration, id, orgId]);

    const moveRow = await pool.query<{ updated_at: Date | null }>(
      `SELECT updated_at FROM calendar_events WHERE id = $1 AND org_id = $2`, [id, orgId]);
    const moveVersionAfter = moveRow.rows[0]?.updated_at
      ? new Date(moveRow.rows[0].updated_at).toISOString()
      : null;

    await store.logActivity({
      type: "report",
      label: `[IA] Événement déplacé : "${snap["title"]}" → ${newDate}${newStartTime ? ` à ${newStartTime}` : ""}`,
      targetId: id, targetType: "calendar_event",
      metadata: { provider, model, tool: name, newDate, newStartTime }, orgId,
    }).catch(() => {});

    await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
      tool: name, args, confirmationLevel: toolDef.confirmationLevel,
      result: "ok", snapshot: snap, versionAfter: moveVersionAfter, durationMs: Date.now() - t0 });

    const oldInfo = `${snap["date"]}${snap["start_time"] ? ` à ${snap["start_time"]}` : ""}`;
    const newInfo = `${newDate}${newStartTime ? ` à ${newStartTime}` : ""}`;
    const navMoveDest = validateNavAction(
      { destinationId: "calendar-week", label: "Voir la semaine", openMode: "page" },
      ctx.effectivePerms, ctx.orgPlan
    );
    const navMoveProposal = navMoveDest
      ? await createNavigationProposal({ orgId, userId, conversationId, provider, model, navActions: [navMoveDest] })
      : null;
    return { toolCallId: logId, toolName: name, ok: true,
      content: `Événement "${snap["title"]}" déplacé de ${oldInfo} vers ${newInfo}.`,
      data: { id, newDate, newStartTime, newDuration }, snapshot: snap, actionLogId: logId,
      undoLabel: `Annuler le déplacement de "${snap["title"]}"`,
      navProposal: navMoveProposal };
  }

  // ── delete_calendar_event ─────────────────────────────────────────────────
  if (name === "delete_calendar_event") {
    const id   = args["id"] as string;
    const snap = await snapCalendarEvent(id, orgId, pool);
    if (!snap) {
      return { toolCallId: logId, toolName: name, ok: false,
        content: `Événement ID "${id}" introuvable. Utilise search_calendar_event pour trouver l'ID exact.`,
        actionLogId: logId };
    }

    await pool.query(`DELETE FROM calendar_events WHERE id = $1 AND org_id = $2`, [id, orgId]);

    await store.logActivity({
      type: "report", label: `[IA] Événement supprimé : "${snap["title"]}" (${snap["date"]})`,
      targetId: id, targetType: "calendar_event",
      metadata: { provider, model, tool: name }, orgId,
    }).catch(() => {});

    // version_after = null : la ligne n'existe plus (identique au pattern delete_mission)
    await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
      tool: name, args, confirmationLevel: toolDef.confirmationLevel,
      result: "ok", snapshot: snap, versionAfter: null, durationMs: Date.now() - t0 });

    const navDeleteDest = validateNavAction(
      { destinationId: "calendar-today", label: "Retour au calendrier", openMode: "page" },
      ctx.effectivePerms, ctx.orgPlan
    );
    const navDeleteProposal = navDeleteDest
      ? await createNavigationProposal({ orgId, userId, conversationId, provider, model, navActions: [navDeleteDest] })
      : null;
    return { toolCallId: logId, toolName: name, ok: true,
      content: `Événement "${snap["title"]}" (ID: ${id}) supprimé définitivement.`,
      data: { id, deleted: true }, snapshot: snap, actionLogId: logId,
      undoLabel: `Annuler la suppression de "${snap["title"]}"`,
      navProposal: navDeleteProposal };
  }

  // ── find_free_slots ───────────────────────────────────────────────────────
  if (name === "find_free_slots") {
    const dateArg   = args["date"]      as string;
    const duration  = (args["duration"]  as number) ?? 60;
    const startHour = (args["startHour"] as number) ?? 8;
    const endHour   = (args["endHour"]   as number) ?? 18;
    const limit     = (args["limit"]     as number) ?? 5;

    // Fetch org timezone so "today/tomorrow/week" resolve to org-local calendar dates.
    // Falls back to UTC if no timezone is stored.
    let orgTzFfs = "UTC";
    try {
      const tzRow = await pool.query(
        `SELECT COALESCE(
           (SELECT timezone FROM organizations WHERE id = $1 AND timezone IS NOT NULL AND timezone != '' LIMIT 1),
           (SELECT timezone FROM org_settings  WHERE org_id = $1 AND timezone IS NOT NULL AND timezone != '' LIMIT 1),
           'UTC'
         ) AS tz`,
        [orgId]
      );
      if (tzRow.rows[0]?.tz) orgTzFfs = String(tzRow.rows[0].tz);
    } catch { /* keep UTC */ }

    /** Returns the local YYYY-MM-DD in `tz` for today + daysOffset calendar days. */
    function localCalendarDate(tz: string, daysOffset: number): string {
      const now = new Date();
      try {
        // Step 1: get today's local calendar date as YYYY-MM-DD
        const todayStr = now.toLocaleString("fr-FR", {
          timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
        });
        const m = todayStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (m) {
          // Step 2: advance by daysOffset from that local date (pure calendar arithmetic)
          const localBase = new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`);
          return new Date(localBase.getTime() + daysOffset * 86_400_000).toISOString().slice(0, 10);
        }
      } catch { /* fall through */ }
      return new Date(now.getTime() + daysOffset * 86_400_000).toISOString().slice(0, 10);
    }

    // Build list of dates to scan using org-local calendar dates
    let datesToScan: string[];
    if (dateArg === "today")         { datesToScan = [localCalendarDate(orgTzFfs, 0)]; }
    else if (dateArg === "tomorrow") { datesToScan = [localCalendarDate(orgTzFfs, 1)]; }
    else if (dateArg === "week") {
      datesToScan = Array.from({ length: 7 }, (_, i) => localCalendarDate(orgTzFfs, i));
    } else { datesToScan = [dateArg]; }

    const freeSlots: Array<{ date: string; startTime: string; endTime: string }> = [];
    const dayStart = startHour * 60;
    const dayEnd   = endHour   * 60;

    for (const d of datesToScan) {
      if (freeSlots.length >= limit) break;

      const r = await pool.query(
        `SELECT start_time, duration FROM calendar_events
         WHERE org_id = $1 AND date = $2 AND start_time != ''
         ORDER BY start_time ASC`,
        [orgId, d]
      );
      const busy = (r.rows as Array<Record<string, unknown>>).map(row => {
        const [h, m] = String(row["start_time"] ?? "00:00").split(":").map(Number);
        const s = (h ?? 0) * 60 + (m ?? 0);
        return { start: s, end: s + (Number(row["duration"]) || 60) };
      });

      let cursor = dayStart;
      while (cursor + duration <= dayEnd && freeSlots.length < limit) {
        const slotEnd  = cursor + duration;
        // Find first overlapping busy block
        const overlap = busy.find(b => cursor < b.end && slotEnd > b.start);
        if (!overlap) {
          const sh = Math.floor(cursor / 60).toString().padStart(2, "0");
          const sm = (cursor % 60).toString().padStart(2, "0");
          const eh = Math.floor(slotEnd / 60).toString().padStart(2, "0");
          const em = (slotEnd % 60).toString().padStart(2, "0");
          freeSlots.push({ date: d, startTime: `${sh}:${sm}`, endTime: `${eh}:${em}` });
          cursor = slotEnd; // advance past this free slot
        } else {
          cursor = overlap.end; // skip past the blocking event
        }
      }
    }

    await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
      tool: name, args, confirmationLevel: toolDef.confirmationLevel,
      result: "ok", durationMs: Date.now() - t0 });

    if (freeSlots.length === 0) {
      return { toolCallId: logId, toolName: name, ok: true,
        content: `Aucun créneau libre de ${duration} min trouvé entre ${startHour}h et ${endHour}h${dateArg === "week" ? " sur les 7 prochains jours" : " ce jour-là"}. Essayez une durée plus courte ou une autre plage horaire.`,
        actionLogId: logId };
    }
    const list = freeSlots.map(s => `- ${s.date} : ${s.startTime}–${s.endTime} (${duration} min)`).join("\n");
    return { toolCallId: logId, toolName: name, ok: true,
      content: `${freeSlots.length} créneau(x) libre(s) de ${duration} min :\n${list}`,
      data: { freeSlots }, actionLogId: logId };
  }

  // ── reschedule_week ───────────────────────────────────────────────────────
  if (name === "reschedule_week") {
    const sourceWeekStart = args["sourceWeekStart"] as string;
    const targetWeekStart = args["targetWeekStart"] as string;
    const eventIds        = args["eventIds"] as string[] | undefined;

    // Compute source week end (Sunday)
    const srcStart = new Date(sourceWeekStart + "T00:00:00Z");
    const srcEnd   = new Date(srcStart.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
    const tgtStart = new Date(targetWeekStart + "T00:00:00Z");
    const offsetMs = tgtStart.getTime() - srcStart.getTime();
    const offsetDays = Math.round(offsetMs / 86_400_000);

    let sql = `SELECT id, title, date, start_time, duration, site, type, notes, client_name,
                      priority, color, reminder, linked_mission_id, updated_at
               FROM calendar_events
               WHERE org_id = $1 AND date >= $2 AND date <= $3`;
    const params: unknown[] = [orgId, sourceWeekStart, srcEnd];
    if (eventIds && eventIds.length > 0) { sql += ` AND id = ANY($4)`; params.push(eventIds); }
    sql += ` ORDER BY date ASC, start_time ASC`;

    const eventsRes = await pool.query(sql, params);
    const events = eventsRes.rows as Array<Record<string, unknown>>;

    if (events.length === 0) {
      return { toolCallId: logId, toolName: name, ok: false,
        content: `Aucun événement trouvé dans la semaine du ${sourceWeekStart}.`,
        actionLogId: logId };
    }

    // Capture pre-write snapshots (what to restore on undo)
    const snapshots = events.map(e => ({
      ...e,
      updated_at: e["updated_at"] instanceof Date ? (e["updated_at"] as Date).toISOString() : e["updated_at"],
    }));

    // Atomic transaction — capture post-write updated_at for version locking on undo
    const postWriteVersions: Record<string, string> = {};
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const ev of events) {
        const oldDate  = new Date((ev["date"] as string) + "T00:00:00Z");
        const newDate  = new Date(oldDate.getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10);
        const rwRes = await client.query<{ id: string; updated_at: Date }>(
          `UPDATE calendar_events SET date = $1, updated_at = NOW()
           WHERE id = $2 AND org_id = $3
           RETURNING id, updated_at`,
          [newDate, ev["id"], orgId]
        );
        if (rwRes.rows[0]) {
          const ts = rwRes.rows[0].updated_at;
          postWriteVersions[String(ev["id"])] = ts instanceof Date ? ts.toISOString() : String(ts);
        }
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      client.release();
      throw err;
    }
    client.release();

    await store.logActivity({
      type: "report",
      label: `[IA] ${events.length} événement(s) déplacés : semaine du ${sourceWeekStart} → ${targetWeekStart}`,
      targetId: orgId, targetType: "calendar_event",
      metadata: { provider, model, tool: name, count: events.length, offsetDays }, orgId,
    }).catch(() => {});

    const batchSnap = { batchType: "reschedule_week", events: snapshots, postWriteVersions };
    await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
      tool: name, args, confirmationLevel: toolDef.confirmationLevel,
      result: "ok", snapshot: batchSnap as unknown as Record<string, unknown>,
      versionAfter: null, durationMs: Date.now() - t0 });

    const list = events.map(ev => {
      const oldD = ev["date"] as string;
      const newD = new Date(new Date(oldD + "T00:00:00Z").getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10);
      return `"${ev["title"]}" : ${oldD} → ${newD}`;
    }).join("\n");

    const navWeekDest = validateNavAction(
      { destinationId: "calendar-week", label: "Voir la semaine cible", openMode: "page" },
      ctx.effectivePerms, ctx.orgPlan
    );
    const navWeekProposal = navWeekDest
      ? await createNavigationProposal({ orgId, userId, conversationId, provider, model, navActions: [navWeekDest] })
      : null;

    return { toolCallId: logId, toolName: name, ok: true,
      content: `${events.length} événement(s) déplacés de la semaine du ${sourceWeekStart} vers le ${targetWeekStart} (+${offsetDays}j) :\n${list}`,
      data: { count: events.length, offsetDays },
      snapshot: batchSnap as unknown as Record<string, unknown>,
      actionLogId: logId,
      undoLabel: `Annuler le déplacement de semaine (${events.length} événement${events.length > 1 ? "s" : ""})`,
      navProposal: navWeekProposal };
  }

  // ── optimize_schedule ─────────────────────────────────────────────────────
  if (name === "optimize_schedule") {
    const date         = args["date"]         as string;
    const startHour    = (args["startHour"]    as number) ?? 9;
    const breakMinutes = (args["breakMinutes"] as number) ?? 15;

    const evRes = await pool.query(
      `SELECT id, title, date, start_time, duration, site, type, notes, client_name,
              priority, color, reminder, linked_mission_id, updated_at
       FROM calendar_events
       WHERE org_id = $1 AND date = $2 AND start_time IS NOT NULL AND start_time != ''
       ORDER BY start_time ASC`,
      [orgId, date]
    );
    const events = evRes.rows as Array<Record<string, unknown>>;

    if (events.length < 2) {
      await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
        tool: name, args, confirmationLevel: toolDef.confirmationLevel,
        result: "ok", durationMs: Date.now() - t0 });
      return { toolCallId: logId, toolName: name, ok: true,
        content: events.length === 0
          ? `Aucun événement avec horaire défini le ${date} — rien à optimiser.`
          : `Un seul événement le ${date} — rien à regrouper.`,
        actionLogId: logId };
    }

    // Capture pre-write snapshots (what to restore on undo)
    const snapshots = events.map(e => ({
      ...e,
      updated_at: e["updated_at"] instanceof Date ? (e["updated_at"] as Date).toISOString() : e["updated_at"],
    }));

    // Compute new times starting from startHour with breakMinutes between events
    const updates: Array<{ id: string; newStartTime: string; oldStartTime: string; title: string; duration: number }> = [];
    let cursor = startHour * 60;
    for (const ev of events) {
      const dur = Number(ev["duration"]) || 60;
      const sh  = Math.floor(cursor / 60).toString().padStart(2, "0");
      const sm  = (cursor % 60).toString().padStart(2, "0");
      const newST = `${sh}:${sm}`;
      if (newST !== (ev["start_time"] as string)) {
        updates.push({ id: ev["id"] as string, newStartTime: newST,
          oldStartTime: ev["start_time"] as string, title: ev["title"] as string, duration: dur });
      }
      cursor += dur + breakMinutes;
    }

    if (updates.length === 0) {
      await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
        tool: name, args, confirmationLevel: toolDef.confirmationLevel,
        result: "ok", durationMs: Date.now() - t0 });
      return { toolCallId: logId, toolName: name, ok: true,
        content: `Le planning du ${date} est déjà optimisé — aucune modification nécessaire.`,
        actionLogId: logId };
    }

    // Atomic transaction — capture post-write updated_at for version locking on undo
    const optPostWriteVersions: Record<string, string> = {};
    const optClient = await pool.connect();
    try {
      await optClient.query("BEGIN");
      for (const u of updates) {
        const optRes = await optClient.query<{ id: string; updated_at: Date }>(
          `UPDATE calendar_events SET start_time = $1, updated_at = NOW()
           WHERE id = $2 AND org_id = $3
           RETURNING id, updated_at`,
          [u.newStartTime, u.id, orgId]
        );
        if (optRes.rows[0]) {
          const ts = optRes.rows[0].updated_at;
          optPostWriteVersions[u.id] = ts instanceof Date ? ts.toISOString() : String(ts);
        }
      }
      await optClient.query("COMMIT");
    } catch (err) {
      await optClient.query("ROLLBACK");
      optClient.release();
      throw err;
    }
    optClient.release();

    await store.logActivity({
      type: "report",
      label: `[IA] Planning optimisé le ${date} (${updates.length} modification${updates.length > 1 ? "s" : ""})`,
      targetId: orgId, targetType: "calendar_event",
      metadata: { provider, model, tool: name, count: updates.length }, orgId,
    }).catch(() => {});

    const batchOptSnap = { batchType: "optimize_schedule", events: snapshots, postWriteVersions: optPostWriteVersions };
    await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
      tool: name, args, confirmationLevel: toolDef.confirmationLevel,
      result: "ok", snapshot: batchOptSnap as unknown as Record<string, unknown>,
      versionAfter: null, durationMs: Date.now() - t0 });

    const list = updates.map(u => `"${u.title}" : ${u.oldStartTime} → ${u.newStartTime}`).join("\n");

    const navOptDest = validateNavAction(
      { destinationId: "calendar-optimize", label: "Voir le planning optimisé", openMode: "page" },
      ctx.effectivePerms, ctx.orgPlan
    );
    const navOptProposal = navOptDest
      ? await createNavigationProposal({ orgId, userId, conversationId, provider, model, navActions: [navOptDest] })
      : null;

    return { toolCallId: logId, toolName: name, ok: true,
      content: `Planning du ${date} optimisé — ${updates.length} événement(s) repositionné(s) à partir de ${startHour}h (pause ${breakMinutes} min) :\n${list}`,
      data: { count: updates.length, updates },
      snapshot: batchOptSnap as unknown as Record<string, unknown>,
      actionLogId: logId,
      undoLabel: `Annuler l'optimisation du ${date}`,
      navProposal: navOptProposal };
  }

  // ── create_recurring_event ────────────────────────────────────────────────
  if (name === "create_recurring_event") {
    const title       = args["title"]       as string;
    const startDate   = args["startDate"]   as string;
    const startTime   = (args["startTime"]   as string) ?? "";
    const duration    = (args["duration"]    as number) ?? 60;
    const rrule       = args["rrule"]       as string;
    const occurrences = (args["occurrences"] as number) ?? 4;
    const eventType   = (args["type"]        as string) ?? "Réunion";

    const dates = computeRecurrenceDates(startDate, rrule, occurrences);
    if (dates.length === 0) {
      return { toolCallId: logId, toolName: name, ok: false,
        content: `RRULE non reconnue : "${rrule}". Formats supportés : DAILY, WEEKLY, MONTHLY, WEEKLY:2, DAILY:2, MONTHLY:2…`,
        actionLogId: logId };
    }

    const createdIds: string[]                         = [];
    const createdSnaps: Record<string, unknown>[]      = [];

    // All-or-nothing transaction: a failure mid-series leaves no partial orphans
    const recClient = await pool.connect();
    try {
      await recClient.query("BEGIN");
      for (let i = 0; i < dates.length; i++) {
        const id = `ce_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_r${i}`;
        const d  = dates[i]!;
        // Only store rrule on the first occurrence (marker of the series)
        const rruleVal = i === 0 ? rrule : null;
        await recClient.query(`
          INSERT INTO calendar_events
            (id, org_id, title, site, type, date, start_time, duration, notes, client_name,
             priority, color, reminder, linked_mission_id, rrule, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
        `, [
          id, orgId, title,
          (args["site"] as string)       ?? "",
          eventType, d, startTime, duration,
          (args["notes"] as string)      ?? "",
          (args["clientName"] as string) ?? "",
          (args["priority"] as string)   ?? "normal",
          (args["color"] as string)      ?? "",
          (args["reminder"] as number)   ?? 0,
          (args["linkedMissionId"] as string) ?? null,
          rruleVal,
        ]);
        createdIds.push(id);
        createdSnaps.push({ id, org_id: orgId, title, date: d, start_time: startTime,
          duration, type: eventType, rrule: rruleVal });
      }
      await recClient.query("COMMIT");
    } catch (err) {
      await recClient.query("ROLLBACK");
      recClient.release();
      throw err;
    }
    recClient.release();

    await store.logActivity({
      type: "report",
      label: `[IA] Événement récurrent créé : "${title}" (${dates.length} occurrence${dates.length > 1 ? "s" : ""}, RRULE=${rrule})`,
      targetId: createdIds[0] ?? orgId, targetType: "calendar_event",
      metadata: { provider, model, tool: name, count: dates.length, rrule }, orgId,
    }).catch(() => {});

    const batchRecSnap = { batchType: "create_recurring_event", events: createdSnaps };
    await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
      tool: name, args, confirmationLevel: toolDef.confirmationLevel,
      result: "ok", snapshot: batchRecSnap as unknown as Record<string, unknown>,
      versionAfter: null, durationMs: Date.now() - t0 });

    const listDates = dates.map((d, i) => `${i + 1}. ${d}${startTime ? ` à ${startTime}` : ""}`).join("\n");

    const navRecDest = validateNavAction(
      { destinationId: "calendar-recurring", label: "Voir les événements récurrents", openMode: "page" },
      ctx.effectivePerms, ctx.orgPlan
    );
    const navRecProposal = navRecDest
      ? await createNavigationProposal({ orgId, userId, conversationId, provider, model, navActions: [navRecDest] })
      : null;

    return { toolCallId: logId, toolName: name, ok: true,
      content: `Événement récurrent "${title}" créé — ${dates.length} occurrence${dates.length > 1 ? "s" : ""} (RRULE=${rrule}) :\n${listDates}`,
      data: { count: dates.length, ids: createdIds, rrule },
      snapshot: batchRecSnap as unknown as Record<string, unknown>,
      actionLogId: logId,
      undoLabel: `Annuler la création de "${title}" (${dates.length} occurrences)`,
      navProposal: navRecProposal };
  }

  // fallback
  return { toolCallId: logId, toolName: name, ok: false,
    content: `Outil ${name} non implémenté dans cette phase.`, actionLogId: logId };
}
