import type { Request } from "express";
import { resolveDashboardLanguage } from "./default-language.js";

/**
 * Customer-visible language resolution (user rule):
 *   explicit per-request option → user preference → organization language → "en".
 * NEVER derived from Accept-Language, the country or the email address.
 * Organization language ignores the legacy "fr" DB default (see resolveDashboardLanguage).
 */

const LANG_RE = /^[a-zA-Z]{2,3}(?:[-_][a-zA-Z0-9]{2,8})?$/;

/** Validate and normalize a language value to a short lowercase code ("fr-FR" → "fr"). */
export function normalizeLanguageCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || !LANG_RE.test(v)) return null;
  return v.split(/[-_]/, 1)[0]!.toLowerCase();
}

export interface LanguageSources {
  explicit?: unknown;
  userLanguage?: unknown;
  orgLanguage?: unknown;
}

/** Pure core: explicit > user preference > org language (legacy fr ignored) > en. */
export function resolveLanguageFromSources(sources: LanguageSources): string {
  const explicit = normalizeLanguageCode(sources.explicit);
  if (explicit) return explicit;
  const user = normalizeLanguageCode(sources.userLanguage);
  const org = normalizeLanguageCode(sources.orgLanguage);
  return normalizeLanguageCode(resolveDashboardLanguage(user, org)) ?? "en";
}

export interface LanguageLoaders {
  loadUserLanguage: (orgId: string) => Promise<unknown>;
  loadOrgLanguage: (orgId: string) => Promise<unknown>;
}

type OrgQuery = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/**
 * Default loaders. User preference uses the request-scoped org DB (req.orgDb, the
 * same accessor GET /api/me uses); without it (background jobs) only the org
 * language is consulted.
 */
function defaultLoaders(query?: OrgQuery): LanguageLoaders {
  return {
    // Same source as GET /api/me: user_prefs.settings.language (keyed by org_id).
    async loadUserLanguage(orgId) {
      if (!query) return null;
      const r = await query(`SELECT settings FROM user_prefs WHERE org_id=$1 LIMIT 1`, [orgId]);
      const prefs = r.rows[0]?.["settings"] as Record<string, unknown> | null | undefined;
      return prefs?.["language"];
    },
    // Same source as GET /api/me (dbData): org_settings.language via loadOrgSettings.
    async loadOrgLanguage(orgId) {
      const { loadOrgSettings } = await import("../services/org-settings.js");
      return (await loadOrgSettings(orgId))?.language;
    },
  };
}

const TIMEOUT_MS = 2000;

function bounded<T>(p: Promise<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(undefined), TIMEOUT_MS);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(undefined); });
  });
}

/** Org-level stored language (no explicit option). Bounded, never throws; failures → "en". */
export async function resolveOrgLanguage(
  orgId: string | null | undefined,
  loaders: LanguageLoaders = defaultLoaders(),
): Promise<string> {
  try {
    if (!orgId || orgId === "default") return "en";
    const [userLanguage, orgLanguage] = await Promise.all([
      bounded(Promise.resolve().then(() => loaders.loadUserLanguage(orgId))),
      bounded(Promise.resolve().then(() => loaders.loadOrgLanguage(orgId))),
    ]);
    return resolveLanguageFromSources({ userLanguage, orgLanguage });
  } catch {
    return "en";
  }
}

const CACHE = Symbol("flowpointRequestLanguage");

/**
 * Resolve the customer-visible language for a request. Explicit option wins;
 * otherwise stored preferences (cached per request). Never throws.
 */
export async function resolveRequestLanguage(
  req: Request,
  opts: { explicit?: unknown; loaders?: LanguageLoaders } = {},
): Promise<string> {
  const explicit = normalizeLanguageCode(opts.explicit);
  if (explicit) return explicit;
  const holder = req as unknown as Record<symbol, Promise<string> | undefined>;
  let cached = holder[CACHE];
  if (!cached) {
    const r = req as unknown as { orgId?: string | null; orgDb?: OrgQuery };
    const query = typeof r.orgDb === "function" ? r.orgDb.bind(r) : undefined;
    cached = resolveOrgLanguage(r.orgId, opts.loaders ?? defaultLoaders(query));
    holder[CACHE] = cached;
  }
  return cached;
}
