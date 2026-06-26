/**
 * dbContext middleware
 *
 * Attaches `req.orgDb(sql, values?)` to every request.
 *
 * Each call to req.orgDb:
 *   1. Checks out a connection from the pool
 *   2. Begins a transaction
 *   3. SET LOCAL ROLE app_user          — drops superuser/BYPASSRLS for this tx
 *   4. SET LOCAL "app.current_org_id"   — GUC used by every rls_org_isolation policy
 *   5. Runs the supplied SQL
 *   6. COMMITs and releases the connection
 *
 * This makes every pool.query replacement automatically RLS-scoped to the
 * authenticated organisation without requiring a global DATABASE_URL change.
 *
 * Routes that run background tasks after the HTTP response (e.g. async PSI
 * analysis) should continue using pool.query() directly — those are internal
 * writes by id, not cross-org reads.
 */

import type { Request, Response, NextFunction } from "express";
import type { QueryResult }                      from "pg";
import { withOrgDb }                             from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      /**
       * Execute a SQL query scoped to the authenticated org.
       * Internally opens a transaction, sets ROLE app_user + app.current_org_id,
       * runs the query, and commits — ensuring RLS policies are evaluated.
       */
      orgDb: (text: string, values?: unknown[]) => Promise<QueryResult>;
    }
  }
}

export function dbContext(req: Request, _res: Response, next: NextFunction): void {
  const orgId = req.orgId ?? "default";

  req.orgDb = (text: string, values?: unknown[]): Promise<QueryResult> =>
    withOrgDb(orgId, (client) =>
      values !== undefined
        ? client.query(text, values)
        : client.query(text),
    );

  next();
}
