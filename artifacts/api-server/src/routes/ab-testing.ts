import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { canWrite } from "../middlewares/requireRole.js";
import { requireAddon } from "../middlewares/planGate.js";
import { calculateExperimentResult } from "../services/conversion-observations.js";
import { aiChat } from "../services/ai-provider.js";
import { loadOrgAIPrefs, resolveAIModel } from "../services/ai-prefs.js";
import { checkAIQuota, recordCompletedUsageDeferred, type AIModel } from "../services/ai-engine.js";
import { buildQuotaGuidance } from "../services/ai-quota.js";
import { parseAbTestingSuggestion } from "../services/ab-testing-suggestion.js";

const router = Router();
type OrgReq = Request & { orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; orgId?: string };
const orgDb = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);
router.use("/ab-testing", requireAddon("abTestingAI", "AB Testing IA"));

function validSelector(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 180 &&
    !/[<>;]/.test(value) && /^[#.[\]a-zA-Z0-9_="'():\s-]+$/.test(value);
}

router.post("/ab-testing/suggest", canWrite, async (req, res) => {
  const orgId = (req as OrgReq).orgId ?? "default";
  const { siteUrl, page, selector, goalSelector, variantAText } = req.body ?? {};
  if (typeof siteUrl !== "string" || siteUrl.length > 500 ||
      typeof page !== "string" || !page.startsWith("/") || page.startsWith("//") || page.length > 300 ||
      !validSelector(selector) || !validSelector(goalSelector) ||
      typeof variantAText !== "string" || !variantAText.trim() || variantAText.length > 300) {
    res.status(400).json({ error: "Site, chemin, sélecteurs CSS et texte témoin valides requis." });
    return;
  }

  try {
    const owned = await orgDb(req)(
      `SELECT 1 FROM behavior_site_tokens WHERE org_id=$1 AND site_url=$2 LIMIT 1`,
      [orgId, siteUrl],
    );
    if (!owned.rows.length) {
      res.status(404).json({ error: "Site non connecté à l’analytics comportemental." });
      return;
    }

    const signals = await orgDb(req)(
      `SELECT event_type AS "eventType",
              COUNT(*)::int AS events,
              COUNT(DISTINCT session_id)::int AS sessions
         FROM behavior_events
        WHERE org_id=$1 AND site_url=$2 AND page=$3
          AND created_at >= now() - interval '30 days'
          AND event_type IN ('click','rage_click','dead_click','form_submit','form_abandon','scroll_depth')
        GROUP BY event_type
        ORDER BY COUNT(*) DESC
        LIMIT 12`,
      [orgId, siteUrl, page],
    );
    if (!signals.rows.length) {
      res.status(409).json({ error: "Aucun signal comportemental récent pour cette page. Installez le snippet et collectez des événements avant de générer une hypothèse." });
      return;
    }

    const quota = await checkAIQuota({ feature: "strategist", orgId });
    if (!quota.allowed) {
      res.status(402).json(buildQuotaGuidance(quota, await loadOrgAIPrefs(orgId)));
      return;
    }
    const prefs = await loadOrgAIPrefs(orgId);
    const model = resolveAIModel(prefs, "strategist");
    const startedAt = Date.now();
    const generated = await aiChat({
      provider: model.provider,
      model: model.model,
      systemPrompt: "Tu aides à préparer un test A/B. Les signaux fournis sont agrégés et observationnels : ne déduis pas de causalité, n'invente aucune mesure et ne promets aucun gain. Propose une hypothèse à valider et une variante B concise du texte témoin. Retourne uniquement un JSON valide.",
      messages: [{
        role: "user",
        content: `Prépare une proposition de test à partir de ces données uniquement : ${JSON.stringify({
          page, selector, goalSelector, variantAText: variantAText.trim(), observedSignals: signals.rows,
        })}\nFormat JSON strict: {"hypothesis":"...","variantBText":"...","rationale":"...","successMetric":"..."}`,
      }],
      maxTokens: model.maxTokens,
      json: true,
    });
    const suggestion = parseAbTestingSuggestion(generated.text ?? "");
    if (!suggestion || suggestion.variantBText === variantAText.trim()) {
      res.status(502).json({ error: "La proposition IA reçue était incomplète. Réessayez." });
      return;
    }
    recordCompletedUsageDeferred({
      feature: "strategist",
      orgId,
      userId: req.userId ?? "unknown",
      model: model.model as AIModel,
      provider: model.provider,
      tokensIn: generated.usage?.promptTokens ?? 0,
      tokensOut: generated.usage?.completionTokens ?? 0,
      latencyMs: Date.now() - startedAt,
      success: true,
      requestId: `ab_testing_suggest_${Date.now()}`,
    });
    res.json({ ok: true, source: "behavior_events", suggestion });
  } catch {
    res.status(503).json({ error: "Impossible de générer une hypothèse à partir des signaux observés." });
  }
});

router.get("/ab-testing/experiments", async (req, res) => {
  const orgId = (req as OrgReq).orgId ?? "default";
  const siteUrl = typeof req.query.siteUrl === "string" ? req.query.siteUrl : undefined;
  try {
    const rows = await orgDb(req)(
      `SELECT id, site_url, page, name, hypothesis, variant_a, variant_b, status, started_at, ended_at, created_at
         FROM cro_experiments
        WHERE org_id=$1 AND ($2::text IS NULL OR site_url=$2)
        ORDER BY created_at DESC LIMIT 50`,
      [orgId, siteUrl ?? null],
    );
    const experiments = await Promise.all(rows.rows.map(async (row) => {
      const counts = await orgDb(req)(
        `SELECT event_type, metadata->>'variant' AS variant, COUNT(DISTINCT session_id)::int AS sessions
           FROM behavior_events
          WHERE org_id=$1 AND metadata->>'experimentId'=$2
            AND event_type IN ('experiment_exposure','experiment_conversion')
          GROUP BY event_type, metadata->>'variant'`,
        [orgId, row["id"]],
      );
      const values = (variant: string) => {
        const get = (type: string) => Number(counts.rows.find(x => x["event_type"] === type && x["variant"] === variant)?.["sessions"] ?? 0);
        return { exposures: get("experiment_exposure"), conversions: get("experiment_conversion") };
      };
      const result = calculateExperimentResult(values("A"), values("B"));
      return { ...row, measurements: { A: values("A"), B: values("B") }, result };
    }));
    res.json({ ok: true, experiments, noData: experiments.length === 0 });
  } catch {
    res.status(503).json({ error: "Les expériences sont temporairement indisponibles.", experiments: [] });
  }
});

router.post("/ab-testing/experiments", canWrite, async (req, res) => {
  const orgId = (req as OrgReq).orgId ?? "default";
  const { siteUrl, page, name, hypothesis, selector, goalSelector, variantAText, variantBText } = req.body ?? {};
  if (typeof siteUrl !== "string" || typeof page !== "string" || typeof name !== "string" ||
      !name.trim() || name.length > 120 || !validSelector(selector) || !validSelector(goalSelector) ||
      typeof variantAText !== "string" || typeof variantBText !== "string" ||
      variantAText.length > 300 || variantBText.length > 300 || variantAText === variantBText) {
    res.status(400).json({ error: "Nom, page, sélecteurs CSS et deux textes de variante distincts sont requis." }); return;
  }
  try {
    const owned = await orgDb(req)(
      `SELECT 1 FROM behavior_site_tokens WHERE org_id=$1 AND site_url=$2 LIMIT 1`,
      [orgId, siteUrl],
    );
    if (!owned.rows.length) { res.status(404).json({ error: "Site non connecté à l’analytics comportemental." }); return; }
    const id = randomUUID();
    const a = { label: "A", selector, text: variantAText, goalSelector };
    const b = { label: "B", selector, text: variantBText, goalSelector };
    const result = await orgDb(req)(
      `INSERT INTO cro_experiments (id, org_id, site_url, page, name, hypothesis, variant_a, variant_b, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'draft',now())
       RETURNING id, site_url, page, name, hypothesis, variant_a, variant_b, status, created_at`,
      [id, orgId, siteUrl, page, name.trim(), typeof hypothesis === "string" ? hypothesis.slice(0, 500) : null, JSON.stringify(a), JSON.stringify(b)],
    );
    res.status(201).json({ ok: true, experiment: result.rows[0] });
  } catch {
    res.status(503).json({ error: "Impossible d’enregistrer l’expérience." });
  }
});

router.post("/ab-testing/experiments/:id/start", canWrite, async (req, res) => {
  const orgId = (req as OrgReq).orgId ?? "default";
  try {
    const result = await orgDb(req)(
      `UPDATE cro_experiments e
          SET status='running', started_at=now(), ended_at=NULL
        WHERE e.id=$1 AND e.org_id=$2 AND e.status='draft'
          AND EXISTS (
            SELECT 1 FROM behavior_events b
             WHERE b.org_id=e.org_id AND b.site_url=e.site_url
               AND b.page=e.page
               AND b.event_type='tracker_ready'
               AND b.metadata->>'version'='2'
               AND b.created_at >= now() - interval '7 days'
          )
        RETURNING e.id, e.status, e.started_at`,
      [req.params.id, orgId],
    );
    if (!result.rows.length) {
      res.status(409).json({ error: "Installez le nouveau snippet FlowPoint sur le site et vérifiez sa télémétrie avant de démarrer le test." }); return;
    }
    res.json({ ok: true, experiment: result.rows[0] });
  } catch {
    res.status(503).json({ error: "Impossible de démarrer l’expérience." });
  }
});

router.post("/ab-testing/experiments/:id/stop", canWrite, async (req, res) => {
  const orgId = (req as OrgReq).orgId ?? "default";
  try {
    const result = await orgDb(req)(
      `UPDATE cro_experiments SET status='stopped', ended_at=now()
        WHERE id=$1 AND org_id=$2 AND status='running'
        RETURNING id, status, ended_at`,
      [req.params.id, orgId],
    );
    if (!result.rows.length) { res.status(404).json({ error: "Expérience active introuvable." }); return; }
    res.json({ ok: true, experiment: result.rows[0] });
  } catch {
    res.status(503).json({ error: "Impossible d’arrêter l’expérience." });
  }
});

export default router;
