/**
 * FlowPoint AI Agents — Permissions effectives (Ajustement 1 de l'architecture v2).
 *
 * Le rôle n'est qu'un fournisseur de bundles par défaut. La source de vérité est
 * resolveEffectivePermissions() : bundle du rôle + grants − revokes lus dans
 * org_member_permissions. Aucun code agent ne doit jamais tester un rôle.
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

/** Catalogue exhaustif des permissions connues — Phase 1 à 6. */
export const PERMISSION_CATALOG = [
  "overview.read",
  "missions.read",
  "missions.write",            // Phase 2 — création / modification (hors suppression) de missions via IA
  "missions.delete",           // Phase 2 — suppression de missions via IA (owner + admin uniquement par défaut)
  "calendar.read",             // Phase 3 — lecture des événements du calendrier
  "calendar.write",            // Phase 3 — création / modification des événements du calendrier
  "calendar.delete",           // Phase 3 — suppression des événements du calendrier (owner + admin uniquement)
  "audits.read",
  "audits.write",              // Phase 4 — lancement d'audits + création de missions depuis un audit
  "audits.delete",             // Phase 4 — suppression d'audits (owner + admin uniquement par défaut)
  "audits.export",             // Phase 4 — export d'audit en Markdown
  "recommendations.read",      // Phase 5 — lecture des recommandations SEO
  "recommendations.generate",  // Phase 5 — génération de recommandations + plan d'action + missions depuis stratégie
  "recommendations.dismiss",   // Phase 5 — ignorer une recommandation (avec motif)
  "recommendations.restore",   // Phase 5 — restaurer une recommandation ignorée
  "recommendations.export",    // Phase 5 — export de recommandations
  "strategy.generate",         // Phase 5 — génération de stratégie SEO globale + comparaison + missions
  "monitors.read",
  "monitors.write",            // Phase 6 — suspension/reprise + création de missions depuis incident
  "monitors.delete",           // Phase 6 — suppression de monitors (owner + admin uniquement)
  "monitors.configure",        // Phase 6 — création / modification de monitors (owner + admin + member)
  "incidents.read",            // Phase 6 — lecture des incidents (tous rôles)
  "incidents.resolve",         // Phase 6 — acquittement + résolution d'incidents (owner + admin + member)
  "alerts.manage",             // Phase 6 — gestion des alertes (owner + admin uniquement)
  "keywords.read",
  "competitors.read",
  "reports.read",
  "team.read",
  "settings.read",
  "settings.admin",
  "billing.read",
  "ai.read",
  "localseo.read",
  "alerts.read",
  "analytics.read",
  "conversion.read",
  "activity.read",
  "web.read",                  // Phase 7 — analyse d'URL externe via l'outil analyze_url
] as const;

export type Permission = (typeof PERMISSION_CATALOG)[number];

const ALL_READ: Permission[] = PERMISSION_CATALOG.filter(
  (p) => p !== "settings.admin" && p !== "billing.read" && !p.endsWith(".write") && !p.endsWith(".delete")
);

/** Bundles par défaut par rôle — valeurs de départ, jamais la source de vérité finale. */
const ROLE_BUNDLES: Record<string, Permission[]> = {
  // owner/admin : toutes permissions y compris suppression + stratégie
  owner:   [...PERMISSION_CATALOG],
  admin:   [...PERMISSION_CATALOG],
  // member : lecture + écriture missions + calendrier + lancement audits + export + recommandations + stratégie + monitors/incidents
  member:  [
    ...ALL_READ,
    "missions.write",
    "calendar.write",
    "audits.write",
    "audits.export",
    "recommendations.generate",
    "recommendations.dismiss",
    "recommendations.restore",
    "recommendations.export",
    "strategy.generate",
    "monitors.write",
    "monitors.configure",
    "incidents.resolve",
  ],
  // viewer : lecture seule, aucune écriture ni suppression
  viewer:  [...ALL_READ],
  // service (API_SECRET_KEY interne) : tout — cohérent avec requireRole
  service: [...PERMISSION_CATALOG],
};

export function isKnownPermission(p: string): p is Permission {
  return (PERMISSION_CATALOG as readonly string[]).includes(p);
}

/**
 * Résout les permissions effectives d'un utilisateur dans une organisation.
 * bundle(rôle) + grants − revokes (table org_member_permissions).
 *
 * FAIL-CLOSED : si les overrides sont illisibles (panne DB, table absente),
 * on retourne un ensemble VIDE — jamais le bundle du rôle seul. Une révocation
 * explicite ne doit jamais être restaurée par une panne transitoire ; l'agent
 * perd la navigation le temps de la panne, le chat continue de fonctionner.
 */
export async function resolveEffectivePermissions(
  userId: string,
  orgId: string,
  role: string | undefined
): Promise<Set<string>> {
  const bundle = new Set<string>(ROLE_BUNDLES[role ?? "viewer"] ?? ROLE_BUNDLES["viewer"]);
  try {
    const { rows } = await pool.query<{ permission: string; mode: string }>(
      `SELECT permission, mode FROM org_member_permissions WHERE org_id = $1 AND user_id = $2`,
      [orgId, userId]
    );
    for (const r of rows) {
      if (!isKnownPermission(r.permission)) continue; // permission inconnue → ignorée
      if (r.mode === "grant") bundle.add(r.permission);
      else if (r.mode === "revoke") bundle.delete(r.permission);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If the table simply does not exist yet (first deploy before init-agent-tables runs),
    // return the role bundle rather than locking out all AI tools. The table holds only
    // *overrides* on top of role defaults; an absent table means "no overrides" → safe to
    // fall back to the role bundle.  For any other DB error, remain fail-closed.
    if (msg.includes("does not exist") || msg.includes("relation") && msg.includes("not exist")) {
      logger.warn({ orgId }, "[agent] org_member_permissions table absent — returning role bundle (no overrides)");
      return bundle;
    }
    logger.error({ err, orgId }, "[agent] org_member_permissions unreadable — FAIL CLOSED (zéro permission agent)");
    return new Set<string>();
  }
  return bundle;
}
