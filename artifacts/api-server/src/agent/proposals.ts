/**
 * FlowPoint AI Agents — Propositions d'actions stockées côté serveur (Ajustement 9).
 *
 * Toute proposition (même navigation pure en Phase 1) est persistée dans
 * ai_action_proposals, liée à org/user/conversation, avec TTL 15 minutes.
 * Le client ne renvoie jamais le contenu d'une action — uniquement des IDs.
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import type { ValidatedNavAction } from "./destination-registry.js";

export const PROPOSAL_TTL_MINUTES = 15;

export interface ActionProposal {
  proposalId: string;
  conversationId: string;
  actions: Array<{
    actionId: string;
    kind: "navigation";
    primary: boolean;
    label: string;
    destinationId: string;
    params: Record<string, string | number | boolean>;
    highlight: string | null;
    openMode: string;
  }>;
  expiresAt: string;
}

/**
 * Persiste une proposition de navigation et retourne le payload SSE.
 * Max 2 actions principales, appliqué ICI côté serveur (Ajustement 8) —
 * en Phase 1 une seule action navigation est possible, mais la contrainte
 * est structurelle pour les phases suivantes.
 */
export async function createNavigationProposal(opts: {
  orgId: string;
  userId: string;
  conversationId: string;
  provider: string;
  model: string;
  navActions: ValidatedNavAction[];
}): Promise<ActionProposal | null> {
  const { orgId, userId, conversationId, provider, model } = opts;
  if (opts.navActions.length === 0) return null;

  const proposalId = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MINUTES * 60_000);

  const actions = opts.navActions.slice(0, 2).map((a, i) => ({
    actionId: `act_${proposalId}_${i}`,
    kind: "navigation" as const,
    primary: i === 0,
    label: a.label,
    destinationId: a.destinationId,
    params: a.params,
    highlight: a.highlight,
    openMode: a.openMode,
  }));

  try {
    await pool.query(
      `INSERT INTO ai_action_proposals
         (id, org_id, user_id, conversation_id, kind, payload, status, provider, model, created_at, expires_at)
       VALUES ($1,$2,$3,$4,'navigation',$5,'proposed',$6,$7,NOW(),$8)`,
      [proposalId, orgId, userId, conversationId, JSON.stringify({ actions }), provider, model, expiresAt]
    );
  } catch (err) {
    // Une panne DB ne doit pas casser le chat — mais la proposition n'est alors
    // pas traçable : on la supprime plutôt que d'émettre un bouton non journalisé.
    logger.error({ err, orgId }, "[agent] createNavigationProposal insert failed — proposal dropped");
    return null;
  }

  return { proposalId, conversationId, actions, expiresAt: expiresAt.toISOString() };
}
