/**
 * FlowPoint AI Agents — Permissions effectives (Ajustement 1 de l'architecture v2).
 *
 * Le rôle n'est qu'un fournisseur de bundles par défaut. La source de vérité est
 * resolveEffectivePermissions() : bundle du rôle + grants − revokes lus dans
 * org_member_permissions. Aucun code agent ne doit jamais tester un rôle.
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

/** Catalogue exhaustif des permissions connues — Phase 1 : lecture uniquement. */
export const PERMISSION_CATALOG = [
  "overview.read",
  "missions.read",
  "audits.read",
  "monitors.read",
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
] as const;

export type Permission = (typeof PERMISSION_CATALOG)[number];

const ALL_READ: Permission[] = PERMISSION_CATALOG.filter(
  (p) => p !== "settings.admin" && p !== "billing.read"
);

/** Bundles par défaut par rôle — valeurs de départ, jamais la source de vérité finale. */
const ROLE_BUNDLES: Record<string, Permission[]> = {
  owner:  [...PERMISSION_CATALOG],
  admin:  [...PERMISSION_CATALOG],
  member: [...ALL_READ],
  viewer: [...ALL_READ],
  // service (API_SECRET_KEY interne) : tout — cohérent avec requireRole
  service: [...PERMISSION_CATALOG],
};

export function isKnownPermission(p: string): p is Permission {
  return (PERMISSION_CATALOG as readonly string[]).includes(p);
}

/**
 * Résout les permissions effectives d'un utilisateur dans une organisation.
 * bundle(rôle) + grants − revokes (table org_member_permissions).
 * Fail-safe : si la table est illisible, on retourne le bundle du rôle seul.
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
    logger.warn({ err, orgId }, "[agent] org_member_permissions unreadable — role bundle only");
  }
  return bundle;
}
