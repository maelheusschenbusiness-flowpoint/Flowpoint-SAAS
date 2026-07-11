import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export interface MissionStats {
  total: number;
  open: number;
  inProgress: number;
  done: number;
  dismissed: number;
  completionRate: number;
  avgPriorityScore: number;
  quickWins: number;
  estimatedTrafficImpact: number;
  estimatedRevenueImpact: number;
}

type MissionTemplate = {
  title: string; category: string; type: string; priority: string; impact: string; effort: string;
  estimatedTrafficImpact: number | null; estimatedRevenueImpact: number | null;
  aiExplanation: string; aiActionSteps: string[]; aiQuickWin: boolean; priorityScore: number;
};

// Fallback templates — used ONLY when no audit data exists in DB
const MISSION_TEMPLATES: MissionTemplate[] = [
  { title: "Lancer un premier audit SEO", category: "seo", type: "technical", priority: "high", impact: "high", effort: "low", estimatedTrafficImpact: null, estimatedRevenueImpact: null, aiExplanation: "Aucun audit n'a encore été effectué. Un audit initial est indispensable pour identifier les problèmes prioritaires et mesurer le point de départ.", aiActionSteps: ["Entrer l'URL du site dans la section Audits", "Lancer l'analyse PageSpeed Insights", "Consulter les issues critiques remontées", "Activer un audit planifié hebdomadaire"], aiQuickWin: true, priorityScore: 95 },
  { title: "Configurer Google Search Console", category: "seo", type: "technical", priority: "high", impact: "high", effort: "low", estimatedTrafficImpact: null, estimatedRevenueImpact: null, aiExplanation: "Sans Google Search Console connecté, vous n'avez pas accès aux données de clics, impressions et positions réelles dans Google. C'est la première source de données SEO à activer.", aiActionSteps: ["Connecter GSC dans Intégrations", "Vérifier la propriété du site", "Soumettre le sitemap XML", "Consulter les erreurs d'indexation"], aiQuickWin: true, priorityScore: 90 },
  { title: "Configurer un monitor de disponibilité", category: "technical", type: "technical", priority: "high", impact: "medium", effort: "low", estimatedTrafficImpact: null, estimatedRevenueImpact: null, aiExplanation: "Un site indisponible perd immédiatement ses positions Google. Un monitor actif permet d'être alerté en moins de 5 minutes et de réagir avant que les robots de Google ne détectent la panne.", aiActionSteps: ["Aller dans la section Monitors", "Ajouter l'URL principale du site", "Configurer l'email d'alerte", "Tester le monitor manuellement"], aiQuickWin: true, priorityScore: 85 },
  { title: "Optimiser la fiche Google Business Profile", category: "local_seo", type: "local", priority: "high", impact: "high", effort: "low", estimatedTrafficImpact: null, estimatedRevenueImpact: null, aiExplanation: "Une fiche GBP complète améliore la visibilité dans le Pack Local Google. Photos, horaires à jour et réponses aux avis sont des signaux de confiance clés pour le SEO local.", aiActionSteps: ["Connecter GBP dans Intégrations", "Vérifier les informations de base (NAP)", "Ajouter 5+ photos professionnelles", "Répondre aux avis récents"], aiQuickWin: true, priorityScore: 82 },
  { title: "Ajouter des mots-clés cibles à suivre", category: "seo", type: "content", priority: "medium", impact: "high", effort: "low", estimatedTrafficImpact: null, estimatedRevenueImpact: null, aiExplanation: "Sans mots-clés suivis, il est impossible de mesurer l'évolution du positionnement ni d'orienter la stratégie de contenu. Commencez par 5-10 mots-clés locaux à fort potentiel.", aiActionSteps: ["Aller dans la section Mots-clés", "Ajouter les 5-10 mots-clés principaux", "Identifier les variantes longue traîne locales", "Programmer un suivi hebdomadaire des positions"], aiQuickWin: true, priorityScore: 78 },
  { title: "Configurer les alertes SEO automatiques", category: "seo", type: "technical", priority: "medium", impact: "medium", effort: "low", estimatedTrafficImpact: null, estimatedRevenueImpact: null, aiExplanation: "Les alertes automatiques permettent de détecter immédiatement toute baisse de score SEO ou perte de position. Sans alertes, les problèmes peuvent passer inaperçus pendant des semaines.", aiActionSteps: ["Aller dans la section Alertes", "Créer une règle 'Score SEO < 60'", "Créer une règle 'Baisse position > 5'", "Configurer la notification email"], aiQuickWin: true, priorityScore: 72 },
];

/**
 * Derive data-driven missions from real audit data using OpenAI.
 * Falls back to generic templates if no audit data exists or OpenAI unavailable.
 */
/**
 * Derive a realistic traffic impact estimate (% increase) from audit severity.
 * Returns null if no meaningful estimate can be made.
 */
function deriveTrafficImpact(score: number, issues: number, speed: number): number | null {
  if (score === 0 && issues === 0) return null;
  // Critical: score < 50 or speed < 40 → high impact potential
  if (score < 50 || speed < 40) return Math.round(15 + Math.min(issues, 10) * 1.5);
  // Warning: score 50-70 or speed 40-60
  if (score < 70 || speed < 60) return Math.round(8 + Math.min(issues, 8) * 1);
  // Good: score 70+ but some issues
  if (issues > 3) return Math.round(3 + issues * 0.5);
  return null;
}

async function generateDataDrivenMissions(orgId: string, auditData: Array<{
  url: string; score: number; speed: number; issues: number;
  criticalIssues: string[]; opportunities: string[];
}>): Promise<MissionTemplate[]> {
  try {
    const { resolveOpenAIConnection } = await import("../lib/openai-client.js");
    const conn = resolveOpenAIConnection();
    if (!conn) return [];

    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey: conn.apiKey, ...(conn.baseURL ? { baseURL: conn.baseURL } : {}) });

    // Fetch keywords and competitors for richer context
    let kwLine = "";
    let compLine = "";
    try {
      const [kwRes, compRes] = await Promise.allSettled([
        pool.query(
          `SELECT keyword, current_position FROM tracked_keywords WHERE org_id=$1 AND active=true ORDER BY search_volume DESC NULLS LAST LIMIT 8`,
          [orgId]
        ),
        pool.query(
          `SELECT name, domain_rating FROM competitors WHERE org_id=$1 ORDER BY domain_rating DESC LIMIT 3`,
          [orgId]
        ),
      ]);
      if (kwRes.status === "fulfilled" && kwRes.value.rows.length > 0) {
        const kws = kwRes.value.rows as Array<{keyword: string; current_position: number | null}>;
        kwLine = `Mots-clés suivis : ${kws.map(k => `"${k.keyword}" pos=${k.current_position ?? "?"}`).join(", ")}`;
      }
      if (compRes.status === "fulfilled" && compRes.value.rows.length > 0) {
        const comps = compRes.value.rows as Array<{name: string; domain_rating: number}>;
        compLine = `Concurrents : ${comps.map(c => `${c.name} DR=${c.domain_rating}`).join(", ")}`;
      }
    } catch { /* ignore */ }

    const auditSummary = auditData.map(a =>
      `URL: ${a.url} | Score: ${a.score}/100 | Performance: ${a.speed}/100 | Issues: ${a.issues}` +
      (a.criticalIssues.length > 0 ? ` | Problèmes: ${a.criticalIssues.slice(0, 4).join("; ")}` : "") +
      (a.opportunities.length > 0 ? ` | Opportunités: ${a.opportunities.slice(0, 3).join("; ")}` : "")
    ).join("\n");

    const prompt = `Tu es consultant SEO senior. Génère 6 missions prioritaires basées sur ces données réelles d'audit.

DONNÉES RÉELLES :
${auditSummary}
${kwLine ? kwLine + "\n" : ""}${compLine ? compLine + "\n" : ""}

RÈGLES :
- Chaque mission cite l'URL, le score exact ou le problème exact détecté.
- Calcule un gain réaliste : si score=40/100, corriger les issues = +15 à +25 pts.
- Ordonne du plus impactant au moins impactant.
- Titre court et spécifique (pas "optimiser le SEO" mais "Corriger les 5 issues critiques sur example.com").

Retourne un JSON array de 6 objets :
{
  "title": "string",
  "aiExplanation": "string (2-3 phrases avec chiffres réels)",
  "aiActionSteps": ["string", "string", "string", "string"],
  "category": "seo|performance|content|local_seo|netlinking",
  "type": "technical|content|offpage|local",
  "priority": "high|medium|low",
  "impact": "high|medium|low",
  "effort": "low|medium|high",
  "estimatedTrafficImpact": number_or_null,
  "aiQuickWin": boolean,
  "priorityScore": number_1_to_100
}

Réponds UNIQUEMENT avec le JSON array.`;

    const model = "gpt-5-mini";
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "Tu génères des missions SEO JSON basées sur des données réelles. Réponds UNIQUEMENT avec du JSON valide." },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 1500,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
    });

    const raw = resp.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : (parsed.missions ?? parsed.data ?? []);
    if (!Array.isArray(arr) || arr.length === 0) return [];

    return arr.map((m: Record<string, unknown>) => ({
      title: String(m["title"] ?? "Mission SEO"),
      category: String(m["category"] ?? "seo"),
      type: String(m["type"] ?? "technical"),
      priority: String(m["priority"] ?? "medium"),
      impact: String(m["impact"] ?? "medium"),
      effort: String(m["effort"] ?? "medium"),
      estimatedTrafficImpact: typeof m["estimatedTrafficImpact"] === "number" ? m["estimatedTrafficImpact"] :
        (String(m["impact"] ?? "") === "high" ? 15 : String(m["impact"] ?? "") === "medium" ? 8 : 3),
      estimatedRevenueImpact: null,
      aiExplanation: String(m["aiExplanation"] ?? ""),
      aiActionSteps: Array.isArray(m["aiActionSteps"]) ? (m["aiActionSteps"] as string[]).map(String) : [],
      aiQuickWin: Boolean(m["aiQuickWin"] ?? false),
      priorityScore: Number(m["priorityScore"] ?? 70),
    })) as MissionTemplate[];
  } catch (err) {
    logger.warn({ err }, "[mission-engine] AI generation failed — using templates");
    return [];
  }
}

export async function runMissionEngine(orgId = "default"): Promise<number> {
  const client = await pool.connect();
  try {
    const existing = await client.query(
      `SELECT COUNT(*) as count FROM missions WHERE org_id = $1 AND status != 'done'`,
      [orgId]
    );
    const count = Number(existing.rows[0]?.count ?? 0);
    if (count >= 10) return 0;
    const slots = Math.max(0, 8 - count);
    if (slots === 0) return 0;

    // Read real audit data from DB
    let auditData: Array<{url: string; score: number; speed: number; issues: number; criticalIssues: string[]; opportunities: string[]}> = [];
    try {
      const [auditRes, psiRes] = await Promise.allSettled([
        client.query(
          `SELECT DISTINCT ON (url) url, score, speed, issues FROM audits WHERE org_id=$1 ORDER BY url, created_at DESC LIMIT 5`,
          [orgId]
        ),
        client.query(
          `SELECT DISTINCT ON (p.url) p.url, p.critical_issues, p.opportunities
           FROM psi_cache p
           JOIN audits a ON a.url = p.url AND a.org_id = $1
           WHERE p.strategy='mobile'
           ORDER BY p.url, p.analyzed_at DESC
           LIMIT 10`,
          [orgId]
        ),
      ]);

      const psiMap = new Map<string, { ci: string[]; opp: string[] }>();
      if (psiRes.status === "fulfilled") {
        for (const row of psiRes.value.rows as Array<Record<string,unknown>>) {
          const u = String(row["url"] ?? "");
          try {
            const ci = JSON.parse(String(row["critical_issues"] ?? "[]")) as Array<{title?: string}>;
            const opp = JSON.parse(String(row["opportunities"] ?? "[]")) as Array<{title?: string; savings?: number}>;
            psiMap.set(u, {
              ci: ci.filter(i => i.title).map(i => i.title!).slice(0, 5),
              opp: opp.filter(i => i.title).map(i => `${i.title}${i.savings ? ` (~${Math.round(i.savings)}ms)` : ""}`).slice(0, 4),
            });
          } catch { /* ignore */ }
        }
      }

      if (auditRes.status === "fulfilled") {
        auditData = (auditRes.value.rows as Array<Record<string,unknown>>).map(r => {
          const u = String(r["url"] ?? "");
          const psi = psiMap.get(u) ?? { ci: [], opp: [] };
          return {
            url: u,
            score: Number(r["score"] ?? 0),
            speed: Number(r["speed"] ?? 0),
            issues: Number(r["issues"] ?? 0),
            criticalIssues: psi.ci,
            opportunities: psi.opp,
          };
        });
      }
    } catch (err) {
      logger.warn({ err }, "[mission-engine] Failed to read audit data — using templates");
    }

    // Generate data-driven missions if we have audit data, else use templates
    let templates: MissionTemplate[] = [];
    if (auditData.length > 0) {
      templates = await generateDataDrivenMissions(orgId, auditData);
      if (templates.length === 0) {
        // AI generation failed — build lightweight templates from audit data
        templates = auditData.flatMap(a => {
          const t: MissionTemplate[] = [];
          if (a.criticalIssues.length > 0) {
            t.push({
              title: `Corriger les ${a.issues} issues critiques — ${new URL(a.url.startsWith("http") ? a.url : "https://" + a.url).hostname}`,
              category: "seo", type: "technical", priority: "high", impact: "high", effort: "medium",
              estimatedTrafficImpact: deriveTrafficImpact(a.score, a.issues, a.speed), estimatedRevenueImpact: null,
              aiExplanation: `L'audit de ${a.url} a détecté ${a.issues} problèmes critiques avec un score de ${a.score}/100. Les corriger peut apporter +10 à +20 points SEO. Problèmes identifiés : ${a.criticalIssues.slice(0, 3).join(", ")}.`,
              aiActionSteps: [...a.criticalIssues.slice(0, 3).map(i => `Corriger : ${i}`), "Relancer l'audit pour valider les corrections"],
              aiQuickWin: a.issues <= 3, priorityScore: Math.max(60, 100 - a.score),
            });
          }
          if (a.speed < 50) {
            t.push({
              title: `Améliorer la performance mobile — ${new URL(a.url.startsWith("http") ? a.url : "https://" + a.url).hostname}`,
              category: "performance", type: "technical", priority: "high", impact: "high", effort: "medium",
              estimatedTrafficImpact: deriveTrafficImpact(a.score, a.issues, a.speed), estimatedRevenueImpact: null,
              aiExplanation: `Le score de performance de ${a.url} est de ${a.speed}/100. Un score < 50 pénalise directement le classement mobile Google (Core Web Vitals). ${a.opportunities.length > 0 ? "Opportunités : " + a.opportunities.slice(0, 2).join(", ") + "." : ""}`,
              aiActionSteps: a.opportunities.slice(0, 3).map(o => o).concat(["Relancer l'audit pour mesurer le gain"]),
              aiQuickWin: false, priorityScore: 85,
            });
          }
          return t;
        });
      }
    }

    if (templates.length === 0) {
      templates = MISSION_TEMPLATES;
    }

    let inserted = 0;
    for (const t of templates.slice(0, slots)) {
      const id = `m_${orgId}_${t.title.replace(/[^a-z0-9]/gi, "_").toLowerCase().slice(0, 30)}_${Date.now()}`;
      await client.query(
        `INSERT INTO missions (id, org_id, title, description, category, type, priority, priority_score,
          status, impact, effort, estimated_traffic_impact, estimated_revenue_impact,
          ai_explanation, ai_action_steps, ai_quick_win, due_date, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10,$11,$12,$13,$14,$15,
           NOW() + INTERVAL '30 days', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [
          id, orgId, t.title,
          `Mission générée par le consultant IA FlowPoint — basée sur les données réelles de votre compte.`,
          t.category, t.type, t.priority, t.priorityScore,
          t.impact, t.effort, t.estimatedTrafficImpact, t.estimatedRevenueImpact,
          t.aiExplanation, JSON.stringify(t.aiActionSteps), t.aiQuickWin,
        ]
      ).catch(err => logger.warn({ err, id }, "[mission-engine] Insert failed — skipping"));
      inserted++;
    }
    return inserted;
  } catch (err) {
    logger.error({ err }, "[mission-engine] runMissionEngine failed");
    return 0;
  } finally {
    client.release();
  }
}

export async function getMissionsStats(orgId = "default"): Promise<MissionStats> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as open,
        SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done,
        SUM(CASE WHEN status='dismissed' THEN 1 ELSE 0 END) as dismissed,
        AVG(priority_score) as avg_priority,
        SUM(CASE WHEN ai_quick_win=true THEN 1 ELSE 0 END) as quick_wins,
        COALESCE(SUM(estimated_traffic_impact),0) as total_traffic,
        COALESCE(SUM(estimated_revenue_impact),0) as total_revenue
       FROM missions WHERE org_id=$1`,
      [orgId]
    );
    const r = res.rows[0] ?? {};
    const total = Number(r.total ?? 0);
    const done = Number(r.done ?? 0);
    return {
      total,
      open: Number(r.open ?? 0),
      inProgress: Number(r.in_progress ?? 0),
      done,
      dismissed: Number(r.dismissed ?? 0),
      completionRate: total > 0 ? Math.round((done / total) * 100) : 0,
      avgPriorityScore: Math.round(Number(r.avg_priority ?? 0)),
      quickWins: Number(r.quick_wins ?? 0),
      estimatedTrafficImpact: Number(r.total_traffic ?? 0),
      estimatedRevenueImpact: Number(r.total_revenue ?? 0),
    };
  } finally {
    client.release();
  }
}
