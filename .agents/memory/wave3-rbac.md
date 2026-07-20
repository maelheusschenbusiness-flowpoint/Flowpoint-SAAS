---
name: Wave 3 Lot A RBAC pattern
description: requireRole middleware exports, role matrix, and ALLOWED roles for PATCH /team/:id
---

## requireRole middleware
- File: `src/middlewares/requireRole.ts`
- Exports: `requireRole(roles)`, `canWrite` (owner/admin/member), `canAdmin` (owner/admin), `ownerOnly` (owner)
- Returns 403 `{ error, required: string[], yourRole }` on failure
- Reads role from `req.orgContext.role`

## Role hierarchy
owner > admin > member > viewer (viewer = read-only)

## ALLOWED roles for PATCH /team/:id
`["viewer","member","admin"]` — 'owner' is explicitly excluded (returns 400 "invalid role")
Owner is assigned only at login time (auth.ts), never via team PATCH.

**Why:** Prevent privilege escalation; owner role is a session-level property, not a DB-editable field.

## Routes protection matrix
- canWrite: monitors(POST/PATCH), alert-rules(POST/PATCH), reports(POST), missions(POST/PATCH/DELETE), calendar-events(POST/PATCH/DELETE), competitors(POST/PATCH/DELETE)
- canAdmin: monitors(DELETE), alert-rules(DELETE), reports(DELETE), team(invite/PATCH/DELETE)
- ownerOnly: billing(portal/cancel/upgrade)
- requireAdmin: alert-rules POST /alert-events (internal only)

## Organizations table
- Created in init-data-tables.ts (Wave 3 Lot A)
- Backfilled from org_settings via idempotent INSERT ... ON CONFLICT DO NOTHING
- Primary key: id TEXT (= org_id, same tenant key used across all tables)
