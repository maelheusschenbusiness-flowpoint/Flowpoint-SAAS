import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { canWrite } from "../middlewares/requireRole.js";
import { requireAddon } from "../middlewares/planGate.js";
import { safeErrMsg } from "../lib/safe-error.js";
import { verifyTechnicalSEOFix } from "../services/technical-seo-fix-verification.js";

type DbResult = { rows: Record<string, unknown>[] };
type OrgRequest = Request & {
  orgId?: string;
  orgDb?: (sql: string, values?: unknown[]) => Promise<DbResult>;
};

const router = Router();
const getOrgId = (req: Request) => (req as OrgRequest).orgId;
const getOrgDb = (req: Request) => (req as OrgRequest).orgDb;
const validId = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 128;

router.use(
  "/technical-seo-fix-verification",
  requireAddon("technicalSeoFixVerification", "Technical SEO Fix Verification"),
);

router.get("/technical-seo-fix-verification", async (req, res) => {
  const orgId = getOrgId(req);
  const db = getOrgDb(req);
  if (!orgId || !db) { res.status(401).json({ error: "Contexte d’organisation requis." }); return; }
  try {
    const [audits, verifications] = await Promise.all([
      db(
        `SELECT id, url, score, issues, status, created_at
         FROM audits
         WHERE org_id=$1 AND status IN ('ok','warn') AND url <> ''
         ORDER BY created_at DESC LIMIT 500`,
        [orgId],
      ),
      db(
        `SELECT id, url, before_audit_id, after_audit_id, before_issue_count, after_issue_count, status, created_at
         FROM technical_seo_fix_verifications
         WHERE org_id=$1 ORDER BY created_at DESC LIMIT 50`,
        [orgId],
      ),
    ]);
    res.json({
      ok: true,
      metric: "aggregate_audit_issue_count",
      limitation: "Les audits enregistrent le nombre total de problèmes, pas le détail par règle.",
      audits: audits.rows,
      verifications: verifications.rows,
    });
  } catch (error) {
    res.status(500).json({ error: safeErrMsg(error) });
  }
});

router.post("/technical-seo-fix-verification/verify", canWrite, async (req, res) => {
  const orgId = getOrgId(req);
  const db = getOrgDb(req);
  if (!orgId || !db) { res.status(401).json({ error: "Contexte d’organisation requis." }); return; }
  const { beforeAuditId, afterAuditId } = req.body ?? {};
  if (!validId(beforeAuditId) || !validId(afterAuditId) || beforeAuditId === afterAuditId) {
    res.status(400).json({ error: "Sélectionnez deux audits distincts.", code: "INVALID_AUDIT_PAIR" });
    return;
  }
  try {
    const selected = await db(
      `SELECT id, url, issues, created_at
       FROM audits
       WHERE org_id=$1 AND id = ANY($2::text[]) AND status IN ('ok','warn')`,
      [orgId, [beforeAuditId, afterAuditId]],
    );
    const before = selected.rows.find(row => row["id"] === beforeAuditId);
    const after = selected.rows.find(row => row["id"] === afterAuditId);
    if (!before || !after) { res.status(404).json({ error: "Un audit est introuvable pour votre organisation.", code: "AUDIT_NOT_FOUND" }); return; }
    if (before["url"] !== after["url"]) {
      res.status(400).json({ error: "Les deux audits doivent porter sur la même URL.", code: "AUDIT_URL_MISMATCH" });
      return;
    }
    if (new Date(String(after["created_at"])).getTime() <= new Date(String(before["created_at"])).getTime()) {
      res.status(400).json({ error: "L’audit de vérification doit être plus récent que l’audit de référence.", code: "AUDIT_ORDER_INVALID" });
      return;
    }
    const result = verifyTechnicalSEOFix({
      beforeAuditId,
      afterAuditId,
      beforeIssueCount: Number(before["issues"]),
      afterIssueCount: Number(after["issues"]),
    });
    const id = randomUUID();
    await db(
      `INSERT INTO technical_seo_fix_verifications
         (id, org_id, url, before_audit_id, after_audit_id, before_issue_count, after_issue_count, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (org_id, before_audit_id, after_audit_id)
       DO UPDATE SET before_issue_count=$6, after_issue_count=$7, status=$8, created_at=NOW()`,
      [id, orgId, String(before["url"]), beforeAuditId, afterAuditId, result.beforeIssueCount, result.afterIssueCount, result.status],
    );
    res.json({ ok: true, metric: "aggregate_audit_issue_count", result });
  } catch (error) {
    res.status(500).json({ error: safeErrMsg(error) });
  }
});

export default router;
