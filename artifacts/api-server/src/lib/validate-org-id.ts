/**
 * FlowPoint — OrgId validation utilities
 *
 * OrgId in FlowPoint = the user's email address (set at signup).
 * Some tables use org_id as TEXT (correct), others as UUID (incorrect for our pattern).
 * This module provides guards to prevent raw SQL type errors and enforce tenant isolation.
 */

import { logger } from "./logger.js";

/**
 * Returns true if orgId is a non-empty string that is NOT the reserved sentinel "default".
 * Use before any DB operation that must be tenant-scoped.
 */
export function isValidOrgId(orgId: unknown): orgId is string {
  return typeof orgId === "string" && orgId.trim().length > 0 && orgId !== "default";
}

/**
 * Returns true if orgId looks like a UUID (v4 format).
 * Use before queries on columns typed UUID to avoid "invalid input syntax for type uuid" errors.
 */
export function isUUIDFormat(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Assert that orgId is valid (non-empty, not "default").
 * Logs a structured error and returns false if invalid.
 * Use as a guard before any billing DB write.
 */
export function assertOrgId(orgId: unknown, context: string): orgId is string {
  if (!isValidOrgId(orgId)) {
    logger.error(
      { orgId, context },
      "[OrgId] Invalid orgId detected — DB operation aborted. " +
      "orgId must be a non-empty string and not 'default'."
    );
    return false;
  }
  return true;
}

/**
 * Safe wrapper for SQL queries on UUID-typed org_id columns.
 * Returns null (query skipped) if the value is not UUID format.
 * Prevents: ERROR: invalid input syntax for type uuid
 *
 * Known tables with UUID org_id:
 *   gsc_keyword_data, gsc_page_data, gsc_sync_logs, ga4_accounts
 *
 * Note: org_settings.org_id is TEXT — do NOT use this guard for that table.
 */
export function toUUIDOrNull(value: string): string | null {
  if (isUUIDFormat(value)) return value;
  logger.warn(
    { value },
    "[OrgId] Value is not UUID format — UUID-typed column query skipped"
  );
  return null;
}
