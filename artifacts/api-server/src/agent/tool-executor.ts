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
import { TOOL_BY_NAME, TOOL_ARG_SCHEMAS, type AIToolCall, type AIToolCallResult } from "./mission-tools.js";
import { filterDestinations, validateNavAction } from "./destination-registry.js";
import { createNavigationProposal, type ActionProposal } from "./proposals.js";
import type { Permission } from "./permissions.js";

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
  durationMs?: number;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO ai_action_logs
         (id, org_id, user_id, conversation_id, provider, model, tool, args,
          confirmation_level, result, error, undo_snapshot, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
      [
        opts.id, opts.orgId, opts.userId, opts.conversationId,
        opts.provider, opts.model, opts.tool,
        JSON.stringify(opts.args), opts.confirmationLevel, opts.result,
        opts.error ?? null, opts.snapshot ? JSON.stringify(opts.snapshot) : null,
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

    await store.logActivity({
      type: "report", label: `[IA] Mission créée : ${title}`,
      targetId: id, targetType: "mission",
      metadata: { provider, model, tool: name }, orgId,
    }).catch(() => {});

    // Snapshot the created mission so undo (= delete) has the ID available
    await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
      tool: name, args, confirmationLevel: toolDef.confirmationLevel,
      result: "ok", snapshot: mission ?? { id }, durationMs: Date.now() - t0 });

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

    await store.logActivity({
      type: "report", label: `[IA] Mission modifiée : ${snapshot["title"]}`,
      targetId: id, targetType: "mission",
      metadata: { provider, model, tool: name, changes: args }, orgId,
    }).catch(() => {});

    await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
      tool: name, args, confirmationLevel: toolDef.confirmationLevel,
      result: "ok", snapshot, durationMs: Date.now() - t0 });

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

    await store.logActivity({
      type: "report", label: `[IA] Mission accomplie : ${snapshot["title"]}`,
      targetId: id, targetType: "mission",
      metadata: { provider, model, tool: name }, orgId,
    }).catch(() => {});

    await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
      tool: name, args, confirmationLevel: toolDef.confirmationLevel,
      result: "ok", snapshot, durationMs: Date.now() - t0 });

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

    await store.logActivity({
      type: "report", label: `[IA] Mission attribuée : ${snapshot["title"]} → ${assignedTo}`,
      targetId: id, targetType: "mission",
      metadata: { provider, model, tool: name, assignedTo }, orgId,
    }).catch(() => {});

    await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
      tool: name, args, confirmationLevel: toolDef.confirmationLevel,
      result: "ok", snapshot, durationMs: Date.now() - t0 });

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

    await logActionLog({ id: logId, orgId, userId, conversationId, provider, model,
      tool: name, args, confirmationLevel: toolDef.confirmationLevel,
      result: "ok", snapshot, durationMs: Date.now() - t0 });

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

  // fallback
  return { toolCallId: logId, toolName: name, ok: false,
    content: `Outil ${name} non implémenté dans cette phase.`, actionLogId: logId };
}
