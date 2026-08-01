/**
 * FlowPoint AI Agents — Phase 2 : Service Undo.
 *
 * Restaure l'état précédent d'une ressource à partir du snapshot stocké dans
 * ai_action_logs.undo_snapshot. Ne jamais inverser logiquement une action —
 * toujours restaurer le snapshot réel.
 *
 * Sécurité :
 *  - L'action doit appartenir à l'organisation (org_id scope)
 *  - L'action ne doit pas déjà être annulée (undone_at IS NULL)
 *  - Timeout d'undo : 30 minutes après la création (configurable)
 *  - Le snapshot null (outils sans write, ex: search) → undo refusé
 *  - Validation de version : si la ressource a été modifiée depuis l'action,
 *    l'Undo retourne 409 PROPOSAL_STALE — jamais d'écrasement silencieux.
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { store } from "../services/store.js";

export const UNDO_TTL_MINUTES = 30;

/** Tolérance horloge entre le SQL NOW() de l'action et le created_at du log (ms). */
const VERSION_TOLERANCE_MS = 5_000;

export interface UndoResult {
  ok: boolean;
  message: string;
  code?: "PROPOSAL_STALE" | "ALREADY_UNDONE" | "TTL_EXPIRED" | "NO_SNAPSHOT" | "NOT_FOUND";
  actionLogId?: string;
  toolName?: string;
}

export async function undoAction(
  actionLogId: string,
  orgId: string,
  userId: string
): Promise<UndoResult> {
  // 1. Charger l'entrée de log
  let row: Record<string, unknown> | undefined;
  try {
    const r = await pool.query(
      `SELECT id, org_id, tool, undo_snapshot, undone_at, result, created_at
       FROM ai_action_logs WHERE id = $1 AND org_id = $2`,
      [actionLogId, orgId]
    );
    row = r.rows[0] as Record<string, unknown> | undefined;
  } catch (err) {
    logger.error({ err, actionLogId }, "[undo] DB read failed");
    return { ok: false, message: "Erreur de lecture de la base de données." };
  }

  if (!row) {
    return { ok: false, code: "NOT_FOUND", message: "Action introuvable ou non accessible.", actionLogId };
  }

  // 2. Vérifications
  if (row["undone_at"]) {
    return { ok: false, code: "ALREADY_UNDONE", message: "Cette action a déjà été annulée.", actionLogId,
      toolName: row["tool"] as string };
  }

  const ageMs = Date.now() - new Date(row["created_at"] as string).getTime();
  if (ageMs > UNDO_TTL_MINUTES * 60_000) {
    return { ok: false, code: "TTL_EXPIRED",
      message: `Délai d'annulation dépassé (${UNDO_TTL_MINUTES} min maximum).`,
      actionLogId, toolName: row["tool"] as string };
  }

  if (!row["undo_snapshot"]) {
    return { ok: false, code: "NO_SNAPSHOT",
      message: "Aucun snapshot disponible pour annuler cette action.",
      actionLogId, toolName: row["tool"] as string };
  }

  const snap = typeof row["undo_snapshot"] === "string"
    ? JSON.parse(row["undo_snapshot"] as string)
    : row["undo_snapshot"];

  if (!snap || typeof snap !== "object") {
    return { ok: false, message: "Snapshot invalide.", actionLogId };
  }

  const toolName = row["tool"] as string;
  const logCreatedAt = row["created_at"] as string;

  // 3. Restauration selon l'outil (avec validation de version pour les updates)
  try {
    const snapResult = await applySnapshot(toolName, snap as Record<string, unknown>, orgId, logCreatedAt);
    if (snapResult?.stale) {
      logger.warn({ actionLogId, toolName, orgId }, "[undo] PROPOSAL_STALE — concurrent modification detected");
      return {
        ok: false,
        code: "PROPOSAL_STALE",
        message: "Cette mission a été modifiée depuis l'action initiale. L'annulation ne peut pas être appliquée sans écraser des changements plus récents.",
        actionLogId,
        toolName,
      };
    }
  } catch (err) {
    logger.error({ err, toolName, actionLogId }, "[undo] applySnapshot failed");
    return { ok: false, message: `Erreur lors de la restauration : ${err instanceof Error ? err.message : String(err)}`,
      actionLogId, toolName };
  }

  // 4. Marquer comme annulé
  await pool.query(
    `UPDATE ai_action_logs SET undone_at = NOW() WHERE id = $1`,
    [actionLogId]
  ).catch(err => logger.warn({ err }, "[undo] mark undone_at failed"));

  // 5. Log activité
  await store.logActivity({
    type: "report", label: `[IA] Annulation : ${toolName} (${snap["title"] ?? actionLogId})`,
    targetId: snap["id"] as string ?? actionLogId, targetType: "mission",
    metadata: { actionLogId, toolName }, orgId,
  }).catch(() => {});

  logger.info({ actionLogId, toolName, orgId }, "[undo] action undone");
  return { ok: true, message: "Action annulée avec succès.", actionLogId, toolName };
}

/** Résultat intermédiaire d'applySnapshot — stale = modification concurrente détectée. */
interface SnapshotResult {
  stale?: boolean;
}

/**
 * Applique le snapshot sur la ressource cible.
 *
 * @param logCreatedAt  created_at de l'entrée ai_action_logs. Utilisé comme
 *                      borne de version : si la mission a été modifiée après
 *                      (+ tolérance), on retourne { stale: true }.
 */
async function applySnapshot(
  toolName: string,
  snap: Record<string, unknown>,
  orgId: string,
  logCreatedAt: string,
): Promise<SnapshotResult | void> {
  const id = snap["id"] as string;
  if (!id) throw new Error("Snapshot sans ID — impossible de restaurer.");

  if (toolName === "create_mission") {
    // Annuler une création = supprimer la mission.
    // Pas de validation de version : si la mission n'existe plus (supprimée manuellement), OK.
    await pool.query(`DELETE FROM missions WHERE id = $1 AND org_id = $2`, [id, orgId]);
    return;
  }

  if (toolName === "delete_mission") {
    // Annuler une suppression = réinsérer fidèlement depuis le snapshot.
    // ON CONFLICT DO NOTHING : si quelqu'un l'a recréée entre-temps, on ne l'écrase pas.
    const priorityScore = snap["priority_score"] ?? snap["priorityScore"] ??
      ({ critical: 90, high: 75, medium: 50, low: 25 } as Record<string, number>)[(snap["priority"] as string) ?? "medium"] ?? 50;
    const sourceType = snap["source_type"] ?? snap["sourceType"] ?? "manual";
    await pool.query(`
      INSERT INTO missions (
        id, org_id, title, description, category, status, priority, due_date,
        assigned_to, steps, completed_at, dismissed_at, updated_at, created_at,
        last_refreshed_at, source_type, priority_score
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,NOW(),
        COALESCE($13, NOW()), COALESCE($14, NOW()),$15,$16)
      ON CONFLICT (id) DO NOTHING
    `, [
      id, orgId,
      snap["title"] ?? "", snap["description"] ?? null,
      snap["category"] ?? "seo", snap["status"] ?? "todo", snap["priority"] ?? "medium",
      snap["due_date"] ?? null, snap["assigned_to"] ?? null,
      snap["steps"] ? JSON.stringify(snap["steps"]) : "[]",
      snap["completed_at"] ?? null, snap["dismissed_at"] ?? null,
      snap["created_at"] ?? null, snap["last_refreshed_at"] ?? null,
      sourceType, priorityScore,
    ]);
    return;
  }

  if (["update_mission", "complete_mission", "assign_mission"].includes(toolName)) {
    // ── Validation de version : modification concurrente ? ────────────────────
    // L'action a exécuté UPDATE … SET updated_at = NOW() ≈ logCreatedAt.
    // Si à l'heure de l'Undo, updated_at > logCreatedAt + tolérance, quelqu'un
    // d'autre a modifié la mission après notre action → 409 PROPOSAL_STALE.
    const vRow = await pool.query<{ updated_at: Date | null; id: string }>(
      `SELECT updated_at FROM missions WHERE id = $1 AND org_id = $2`,
      [id, orgId]
    );

    if (!vRow.rows[0]) {
      // La mission n'existe plus — elle a été supprimée après l'action.
      throw new Error("La mission n'existe plus dans votre organisation. Elle a peut-être été supprimée depuis l'action.");
    }

    const currentUpdatedAt = vRow.rows[0].updated_at
      ? new Date(vRow.rows[0].updated_at).getTime()
      : 0;
    const actionTimestamp = new Date(logCreatedAt).getTime();

    if (currentUpdatedAt > actionTimestamp + VERSION_TOLERANCE_MS) {
      // Modification postérieure à notre action → refus sécurisé
      return { stale: true };
    }

    // ── Restauration ──────────────────────────────────────────────────────────
    await pool.query(`
      UPDATE missions SET
        title       = $1,
        description = $2,
        status      = $3,
        priority    = $4,
        due_date    = $5,
        assigned_to = $6,
        completed_at = $7,
        dismissed_at = $8,
        updated_at  = NOW()
      WHERE id = $9 AND org_id = $10
    `, [
      snap["title"], snap["description"], snap["status"], snap["priority"],
      snap["due_date"], snap["assigned_to"], snap["completed_at"], snap["dismissed_at"],
      id, orgId,
    ]);
    return;
  }

  throw new Error(`applySnapshot non implémenté pour l'outil : ${toolName}`);
}
