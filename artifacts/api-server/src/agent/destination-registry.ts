/**
 * FlowPoint AI Agents — Registre partagé des destinations (Ajustements 4 & 5).
 *
 * Source de vérité unique : agent/destinations.json.
 * - Validé au chargement du module (zod) — une destination invalide fait échouer
 *   le boot du serveur, jamais un simple skip silencieux (exigence n°1 de la
 *   validation définitive).
 * - Servi au frontend via GET /api/ai/destinations (filtré permissions + plan).
 * - Utilisé pour valider toute proposition de navigation du modèle : l'IA ne
 *   génère jamais une route libre.
 */
import { z } from "zod";
import { logger } from "../lib/logger.js";
import { isKnownPermission } from "./permissions.js";
import registryData from "./destinations.json" with { type: "json" };

export const OPEN_MODES = ["page", "detail", "modal", "tab", "highlight", "prefill"] as const;
export type OpenMode = (typeof OPEN_MODES)[number];

const PLAN_RANK: Record<string, number> = { standard: 1, pro: 2, ultra: 3 };

/** Schéma strict d'un champ préremplissable (exigence n°2 — prefill sécurisé). */
const prefillFieldSchema = z.object({
  type: z.enum(["string", "number", "boolean"]),
  maxLength: z.number().int().positive().max(2000).optional(),
  enum: z.array(z.string()).optional(),
});

const destinationSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  route: z.string().min(1),
  sub: z.string().nullable(),
  labels: z.array(z.string().min(1)).min(1),
  description: z.string().min(1),
  requiredPermission: z.string().refine(isKnownPermission, { message: "unknown permission" }),
  openModes: z.array(z.enum(OPEN_MODES)).min(1),
  anchors: z.array(z.string().regex(/^[a-z0-9-]+$/)),
  planGate: z.enum(["standard", "pro", "ultra"]).nullable(),
  prefill: z.record(prefillFieldSchema).nullable(),
});

const registrySchema = z.object({
  version: z.number(),
  destinations: z.array(destinationSchema).min(1),
});

export type Destination = z.infer<typeof destinationSchema>;

// ── Validation au chargement : échec = boot refusé ───────────────────────────
const parsed = registrySchema.parse(registryData);

// IDs uniques — zod ne le vérifie pas nativement
{
  const ids = new Set<string>();
  for (const d of parsed.destinations) {
    if (ids.has(d.id)) throw new Error(`[agent] duplicate destination id: ${d.id}`);
    ids.add(d.id);
  }
}

export const DESTINATIONS: readonly Destination[] = parsed.destinations;
export const REGISTRY_VERSION = parsed.version;

const byId = new Map(DESTINATIONS.map((d) => [d.id, d]));

export function getDestination(id: string): Destination | undefined {
  return byId.get(id);
}

function planAllows(planGate: string | null, plan: string): boolean {
  if (!planGate) return true;
  return (PLAN_RANK[plan.toLowerCase()] ?? 1) >= (PLAN_RANK[planGate] ?? 99);
}

/** Destinations visibles pour un jeu de permissions effectives + un plan. */
export function filterDestinations(perms: Set<string>, plan: string): Destination[] {
  return DESTINATIONS.filter(
    (d) => perms.has(d.requiredPermission) && planAllows(d.planGate, plan)
  );
}

export interface ValidatedNavAction {
  destinationId: string;
  label: string;
  route: string;
  sub: string | null;
  params: Record<string, string>;
  highlight: string | null;
  openMode: OpenMode;
}

/**
 * Valide une action de navigation proposée par le modèle.
 * Retourne null (avec log) si quoi que ce soit est invalide — jamais d'à-peu-près :
 * destination inconnue, permission absente, plan insuffisant, ancre non déclarée,
 * openMode non supporté → l'action est abandonnée.
 */
export function validateNavAction(
  raw: unknown,
  perms: Set<string>,
  plan: string
): ValidatedNavAction | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const destinationId = typeof r["destinationId"] === "string" ? r["destinationId"] : null;
  if (!destinationId) return null;

  const dest = byId.get(destinationId);
  if (!dest) {
    logger.warn({ destinationId }, "[agent] model proposed unknown destination — dropped");
    return null;
  }
  if (!perms.has(dest.requiredPermission)) {
    logger.warn({ destinationId }, "[agent] destination not permitted for user — dropped");
    return null;
  }
  if (!planAllows(dest.planGate, plan)) {
    logger.info({ destinationId, plan }, "[agent] destination plan-gated — dropped");
    return null;
  }

  // highlight : uniquement une ancre déclarée dans le registre
  let highlight: string | null = null;
  if (typeof r["highlight"] === "string" && r["highlight"].length > 0) {
    if (dest.anchors.includes(r["highlight"])) highlight = r["highlight"];
    else logger.warn({ destinationId, highlight: r["highlight"] }, "[agent] undeclared anchor — highlight dropped");
  }

  // openMode : doit être supporté par la destination ; défaut = page (ou highlight si ancre)
  let openMode: OpenMode = highlight ? "highlight" : dest.sub ? "tab" : "page";
  if (typeof r["openMode"] === "string" && (OPEN_MODES as readonly string[]).includes(r["openMode"])) {
    if (dest.openModes.includes(r["openMode"] as OpenMode)) openMode = r["openMode"] as OpenMode;
  }
  if (!dest.openModes.includes(openMode)) openMode = "page";

  // params : Phase 1 — uniquement des scalaires courts, clés alphanumériques
  const params: Record<string, string> = {};
  if (r["params"] && typeof r["params"] === "object") {
    for (const [k, v] of Object.entries(r["params"] as Record<string, unknown>)) {
      if (!/^[a-zA-Z0-9_]{1,40}$/.test(k)) continue;
      if (typeof v === "string" && v.length <= 200) params[k] = v;
      else if (typeof v === "number" || typeof v === "boolean") params[k] = String(v);
    }
  }

  const label = typeof r["label"] === "string" && r["label"].trim().length > 0 && r["label"].length <= 60
    ? r["label"].trim()
    : `Ouvrir ${dest.description.split(":")[0]?.trim() ?? dest.id}`;

  return { destinationId, label, route: dest.route, sub: dest.sub, params, highlight, openMode };
}
