import { randomUUID } from "crypto";
import {
  db,
  behaviorEventsTable,
  behaviorSessionsTable,
  behaviorInsightsTable,
} from "@workspace/db";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export async function trackBehaviorEvent(event: {
  sessionId: string;
  orgId: string;
  siteUrl: string;
  page: string;
  eventType: "scroll" | "click" | "rage_click" | "dead_click" | "exit" | "form_abandon" | "hover" | "copy";
  element?: string;
  xPos?: number;
  yPos?: number;
  scrollDepth?: number;
  timeOnPage?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const id = randomUUID();
    await db.insert(behaviorEventsTable).values({
      id,
      orgId:       event.orgId,
      sessionId:   event.sessionId,
      siteUrl:     event.siteUrl,
      page:        event.page,
      eventType:   event.eventType,
      element:     event.element,
      xPos:        event.xPos,
      yPos:        event.yPos,
      scrollDepth: event.scrollDepth,
      timeOnPage:  event.timeOnPage,
      metadata:    event.metadata,
    });

    if (event.eventType === "rage_click") {
      await db.execute(sql`
        UPDATE behavior_sessions
        SET rage_clicks = rage_clicks + 1
        WHERE id = ${event.sessionId} AND org_id = ${event.orgId}
      `);
    }
  } catch (err) {
    logger.error({ err }, "[Behavioral] Failed to track event");
  }
}

export async function upsertSession(session: {
  id: string;
  orgId: string;
  siteUrl: string;
  userAgent?: string;
  deviceType?: string;
  country?: string;
}): Promise<void> {
  try {
    await db.insert(behaviorSessionsTable).values({
      id:          session.id,
      orgId:       session.orgId,
      siteUrl:     session.siteUrl,
      userAgent:   session.userAgent,
      deviceType:  session.deviceType ?? "desktop",
      country:     session.country,
      pageViews:   1,
      bounce:      true,
      engagementScore: 0,
      rageClicks:  0,
    }).onConflictDoNothing();
  } catch { /* silent */ }
}

export async function generateBehaviorInsights(orgId: string, siteUrl: string): Promise<void> {
  try {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const events = await db.select()
      .from(behaviorEventsTable)
      .where(and(
        eq(behaviorEventsTable.orgId, orgId),
        eq(behaviorEventsTable.siteUrl, siteUrl),
        gte(behaviorEventsTable.createdAt, since),
      ))
      .limit(500);

    const rageClicks   = events.filter(e => e.eventType === "rage_click");
    const exits        = events.filter(e => e.eventType === "exit");
    const formAbandons = events.filter(e => e.eventType === "form_abandon");

    const insights: Array<{
      orgId: string;
      siteUrl: string;
      insightType: string;
      severity: string;
      title: string;
      description: string;
      affectedPages: unknown;
      estimatedImpact: string;
      aiSuggestion: string;
    }> = [];

    if (rageClicks.length > 10) {
      const pageMap = rageClicks.reduce<Record<string, number>>((acc, e) => {
        acc[e.page] = (acc[e.page] ?? 0) + 1;
        return acc;
      }, {});
      const worstPage = Object.entries(pageMap).sort((a, b) => b[1] - a[1])[0];
      insights.push({
        orgId,
        siteUrl,
        insightType: "rage_clicks",
        severity: rageClicks.length > 25 ? "critical" : "high",
        title: `${rageClicks.length} rage clicks détectés`,
        description: `Les utilisateurs cliquent frénétiquement sur des éléments non-interactifs. Page la plus touchée : ${worstPage?.[0] ?? "inconnue"}`,
        affectedPages: Object.keys(pageMap),
        estimatedImpact: `-${Math.round(rageClicks.length * 0.3)}% conversion`,
        aiSuggestion: "Vérifiez que les CTAs sont cliquables et que les éléments visuellement interactifs déclenchent bien une action.",
      });
    }

    if (formAbandons.length > 5) {
      insights.push({
        orgId,
        siteUrl,
        insightType: "form_abandon",
        severity: "high",
        title: `${formAbandons.length} abandons de formulaire`,
        description: "Des utilisateurs abandonnent les formulaires en cours de saisie. Friction ou trop de champs requis.",
        affectedPages: [...new Set(formAbandons.map(e => e.page))],
        estimatedImpact: `-${Math.round(formAbandons.length * 0.8)}% leads potentiels`,
        aiSuggestion: "Réduisez le formulaire à 3-5 champs. Ajoutez une barre de progression. Pré-remplissez les champs connus.",
      });
    }

    const lowScrollPages = events.filter(e => e.eventType === "scroll" && (e.scrollDepth ?? 100) < 30);
    if (lowScrollPages.length > 20) {
      insights.push({
        orgId,
        siteUrl,
        insightType: "low_engagement",
        severity: "medium",
        title: "Engagement faible — scroll < 30%",
        description: "La plupart des visiteurs partent sans lire le contenu principal. La proposition de valeur n'est pas visible above the fold.",
        affectedPages: [...new Set(lowScrollPages.map(e => e.page))],
        estimatedImpact: "-15% à -25% engagement",
        aiSuggestion: "Remontez votre CTA principal. Ajoutez un résumé visuel en haut de page. Réduisez les distractions.",
      });
    }

    void exits;

    for (const insight of insights) {
      const id = randomUUID();
      await db.insert(behaviorInsightsTable).values({
        id,
        orgId:           insight.orgId,
        siteUrl:         insight.siteUrl,
        insightType:     insight.insightType,
        severity:        insight.severity,
        title:           insight.title,
        description:     insight.description,
        affectedPages:   insight.affectedPages as Record<string, unknown>[],
        estimatedImpact: insight.estimatedImpact,
        aiSuggestion:    insight.aiSuggestion,
      }).onConflictDoNothing();
    }
  } catch (err) {
    logger.error({ err }, "[Behavioral] Failed to generate insights");
  }
}

export async function getBehaviorInsights(
  orgId: string,
  siteUrl?: string,
): Promise<{
  insights: Array<typeof behaviorInsightsTable.$inferSelect>;
  sessionStats: { total: number; bounceRate: number; avgEngagement: number; rageClicks: number };
}> {
  const insights = siteUrl
    ? await db.select().from(behaviorInsightsTable)
        .where(and(eq(behaviorInsightsTable.orgId, orgId), eq(behaviorInsightsTable.siteUrl, siteUrl)))
        .orderBy(desc(behaviorInsightsTable.createdAt))
        .limit(20)
    : await db.select().from(behaviorInsightsTable)
        .where(eq(behaviorInsightsTable.orgId, orgId))
        .orderBy(desc(behaviorInsightsTable.createdAt))
        .limit(20);

  const [sessionRow] = await db.select({
    total:         sql<number>`count(*)`,
    bounces:       sql<number>`sum(case when bounce then 1 else 0 end)`,
    avgEngagement: sql<number>`avg(engagement_score)`,
    rageClicks:    sql<number>`sum(rage_clicks)`,
  }).from(behaviorSessionsTable)
    .where(eq(behaviorSessionsTable.orgId, orgId))
    .limit(1);

  const total   = Number(sessionRow?.total   ?? 0);
  const bounces = Number(sessionRow?.bounces ?? 0);

  return {
    insights,
    sessionStats: {
      total,
      bounceRate:    total > 0 ? Math.round((bounces / total) * 100) : 0,
      avgEngagement: Math.round(Number(sessionRow?.avgEngagement ?? 0)),
      rageClicks:    Number(sessionRow?.rageClicks ?? 0),
    },
  };
}
