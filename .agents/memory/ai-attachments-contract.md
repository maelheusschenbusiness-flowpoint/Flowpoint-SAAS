---
name: AI Attachments Contract — Step 3A
description: Secure attachment contract for /api/ai/chat — fileId references, validation pipeline, 501 guard. No parsers yet.
---

## Rule
`/api/ai/chat` accepts `attachments?: Array<{fileId: string}>`. Files must already exist in `team_files`. Step 3A returns 501 before any provider call.

## Architecture
- `src/config/ai-attachments.ts` — AI_ATTACHMENT_LIMITS (maxFiles=5, maxFile=10MB, maxTotal=20MB)
- `src/types/ai-attachments.ts` — AIAttachmentReference, ResolvedAIAttachment, AttachmentError
- `src/lib/file-validation.ts` — shared sanitizeFilename/extractExtension/buildExtToMimes/validateMimeExtConsistency
- `src/services/ai-attachments.ts` — three exported functions (see below)

## Three-stage validation pipeline (in order)
1. `validateAttachmentReferences(input)` — pure/sync, validates structure before any DB call
2. `resolveAIAttachments(orgDb, orgId, refs)` — async, DB-backed (team_files WHERE id=ANY($1) AND org_id=$2)
3. `validateResolvedAttachments(files)` — pure/sync, aggregate size check (future magic-bytes hook)

## Integration point in /api/ai/chat
- validateAttachmentReferences: after message check, before loadOrgAIPrefs
- resolveAIAttachments: after resolveEconomyPolicy, before buildFlowpointContext
- 501 returned: after both validations pass, before aiStream/aiChat/recordCompletedUsage

## AI MIME allowlist (stricter than team-files)
PDF, PNG, JPEG, WebP, CSV, XLS, XLSX, TXT, Markdown, JSON, DOCX.
NOT allowed: ZIP, SVG, GIF, DOC, PPTX.

## Security invariants
- fileId format: /^[a-zA-Z0-9_\-]{1,128}$/
- Cross-org and not-found return identical ATTACHMENT_NOT_FOUND 404 (no leak)
- Never log contentBase64 or decoded content
- DB size column ignored — sizeBytes derived from Math.round(b64.length * 0.75)
- Data-URI prefix stripped before base64 validation

**Why:** Defense-in-depth — AND org_id=$2 in SQL + RLS GUC are both active in production.

## DB test pattern
makeRealOrgDb without SET LOCAL ROLE (role may not exist in test env; GUC-only mode
is handled by the withOrgDb memory entry). SQL-level AND org_id=$2 still enforces isolation.
