import { randomUUID } from "crypto";
import {
  db,
  behaviorEventsTable,
  behaviorSessionsTable,
  behaviorInsightsTable,
} from "@workspace/db";
import { eq, desc, sql, and, gte, inArray } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { aiChat } from "./ai-provider.js";
import { checkAIQuota, recordCompletedUsageDeferred, type AIModel } from "./ai-engine.js";

export async function trackBehaviorEvent(event: {
  sessionId: string;
  orgId: string;
  siteUrl: string;
  page: string;
  eventType: "page_view" | "scroll" | "scroll_depth" | "click" | "rage_click" | "dead_click" | "exit" | "form_abandon" | "form_submit" | "session_end" | "tracker_ready" | "experiment_exposure" | "experiment_conversion" | "hover" | "copy";
  element?: string;
  xPos?: number;
  yPos?: number;
  scrollDepth?: number;
  timeOnPage?: number;
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
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
    return true;
  } catch (err) {
    logger.error({ err }, "[Behavioral] Failed to track event");
    return false;
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

export async function generateBehaviorInsights(
  orgId: string,
  siteUrl: string,
  userId = "system",
  periodDays = 7,
): Promise<{ aiGenerated: boolean; count: number }> {
  try {
    const safePeriod = [7, 30, 90].includes(periodDays) ? periodDays : 7;
    const since = new Date(Date.now() - safePeriod * 24 * 3600 * 1000);
    const events = await db.select()
      .from(behaviorEventsTable)
      .where(and(
        eq(behaviorEventsTable.orgId, orgId),
        eq(behaviorEventsTable.siteUrl, siteUrl),
        gte(behaviorEventsTable.createdAt, since),
      ))
      .limit(5_000);

    const rageClicks   = events.filter(e => e.eventType === "rage_click");
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
        estimatedImpact: `${rageClicks.length} événements observés`,
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
        estimatedImpact: `${formAbandons.length} événements observés`,
        aiSuggestion: "Réduisez le formulaire à 3-5 champs. Ajoutez une barre de progression. Pré-remplissez les champs connus.",
      });
    }

    const lowScrollPages = events.filter(e =>
      e.eventType === "scroll_depth" && e.scrollDepth != null && e.scrollDepth < 30,
    );
    if (lowScrollPages.length > 20) {
      insights.push({
        orgId,
        siteUrl,
        insightType: "low_engagement",
        severity: "medium",
        title: "Engagement faible — scroll < 30%",
        description: `${lowScrollPages.length} événements de profondeur de scroll inférieure à 30% ont été observés.`,
        affectedPages: [...new Set(lowScrollPages.map(e => e.page))],
        estimatedImpact: `${lowScrollPages.length} événements observés`,
        aiSuggestion: "Remontez votre CTA principal. Ajoutez un résumé visuel en haut de page. Réduisez les distractions.",
      });
    }

    let aiGenerated = false;
    if (insights.length) {
      const quota = await checkAIQuota({ feature: "behavior_analysis", orgId });
      if (quota.allowed) {
        const evidence = insights.map((item, index) => ({
          referenceId: `E${index + 1}`,
          type: item.insightType,
          severity: item.severity,
          observedSummary: item.description,
          affectedPages: (item.affectedPages as string[]).map(page =>
            String(page).split(/[?#]/, 1)[0]!
              .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "/:id")
              .replace(/\/[^/]+@[^/]+/g, "/:private-value")
              .slice(0, 120),
          ),
        }));
        try {
          const startedAt = Date.now();
          const result = await aiChat({
            task: "behavior_analysis",
            json: true,
            systemPrompt: [
              "Tu es un analyste UX. Tu ne reçois que des agrégats d'événements comportementaux anonymisés.",
              "Produis 1 recommandation par signal; relie chaque conseil à son referenceId.",
              "N'invente aucune métrique, aucun revenu ni causalité. N'ajoute aucun nombre ou pourcentage.",
              "Priorise high, medium ou low. Les conseils doivent être concrets, spécifiques au signal et expliquer brièvement pourquoi agir.",
              "Réponds uniquement en JSON: {\"recommendations\":[{\"referenceId\":\"E1\",\"priority\":\"high|medium|low\",\"action\":\"...\",\"why\":\"...\"}]}",
            ].join("\n"),
            userPrompt: JSON.stringify({ evidence }),
          });
          recordCompletedUsageDeferred({
            feature: "behavior_analysis",
            orgId,
            userId,
            model: result._ai.model as AIModel,
            provider: result._ai.provider,
            tokensIn: result.usage.promptTokens ?? 0,
            tokensOut: result.usage.completionTokens ?? 0,
            latencyMs: Date.now() - startedAt,
            success: true,
          });
          let raw = result.text ?? "";
          const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (codeBlock) raw = codeBlock[1]!.trim();
          const parsed = JSON.parse(raw) as { recommendations?: Array<{
            referenceId?: string; priority?: string; action?: string; why?: string;
          }> };
          const valid = new Map((parsed.recommendations ?? [])
            .filter(x => /^E[1-9]\d*$/.test(x.referenceId ?? "") &&
              ["high", "medium", "low"].includes(x.priority ?? "") &&
              typeof x.action === "string" && typeof x.why === "string" &&
              !/\d|%|€|\$/.test(`${x.action} ${x.why}`))
            .map(x => [x.referenceId!, x]));
          for (const [index, insight] of insights.entries()) {
            const recommendation = valid.get(`E${index + 1}`);
            if (!recommendation) continue;
            insight.severity = recommendation.priority!;
            insight.aiSuggestion = `${recommendation.action!.slice(0, 400)} ${recommendation.why!.slice(0, 300)}`;
          }
          aiGenerated = valid.size > 0;
        } catch (err) {
          logger.warn({ err, orgId }, "[Behavioral] AI recommendations unavailable; keeping evidence-based rules");
        }
      }
    }

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
    return { aiGenerated, count: insights.length };
  } catch (err) {
    logger.error({ err }, "[Behavioral] Failed to generate insights");
    throw err;
  }
}

export interface BehavioralEventRecord {
  sessionId: string;
  page: string;
  eventType: string;
  scrollDepth: number | null;
  timeOnPage: number | null;
  createdAt: Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface BehavioralSessionRecord {
  id: string;
  deviceType: string | null;
}

export const ALLOWED_BEHAVIOR_FUNNEL_EVENTS = new Set([
  "page_view", "click", "rage_click", "dead_click", "scroll_depth",
  "form_submit", "form_abandon", "exit", "session_end",
]);

export interface BehavioralFunnelStep {
  label: string;
  eventType: string;
  page?: string;
}

export function evaluateBehaviorFunnel(
  events: BehavioralEventRecord[],
  steps: BehavioralFunnelStep[],
) {
  const sessions = new Map<string, BehavioralEventRecord[]>();
  for (const event of events) {
    const list = sessions.get(event.sessionId) ?? [];
    list.push(event);
    sessions.set(event.sessionId, list);
  }
  for (const list of sessions.values()) {
    list.sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
  }

  const reached = steps.map(() => 0);
  for (const list of sessions.values()) {
    let cursor = 0;
    let matched = true;
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
      const step = steps[stepIndex]!;
      const found = list.findIndex((event, index) =>
        index >= cursor &&
        event.eventType === step.eventType &&
        (!step.page || event.page === step.page),
      );
      if (found < 0) { matched = false; break; }
      reached[stepIndex] = (reached[stepIndex] ?? 0) + 1;
      cursor = found + 1;
    }
    void matched;
  }
  return steps.map((step, index) => {
    const sessionsReached = reached[index] ?? 0;
    const previous = index > 0 ? reached[index - 1] ?? 0 : null;
    return {
      ...step,
      sessions: sessionsReached,
      rateFromPrevious: previous === null ? null : previous > 0
        ? Math.round(sessionsReached / previous * 10000) / 100
        : null,
      abandonments: previous === null || previous === 0 ? null : previous - sessionsReached,
    };
  });
}

export function summarizeBehaviorEvents(
  events: BehavioralEventRecord[],
  sessions: BehavioralSessionRecord[],
  periodDays: number,
) {
  const pageMap = new Map<string, {
    views: number; sessionIds: Set<string>; clicks: number; rageClicks: number;
    deadClicks: number; formSubmits: number; formAbandons: number;
    scrollTotal: number; scrollCount: number; timeTotal: number; timeCount: number;
  }>();
  const sessionEvents = new Map<string, BehavioralEventRecord[]>();
  const sessionDevices = new Map(sessions.map(s => [s.id, s.deviceType || "unknown"]));

  for (const event of events) {
    if (!event.sessionId || !event.page) continue;
    const page = pageMap.get(event.page) ?? {
      views: 0, sessionIds: new Set<string>(), clicks: 0, rageClicks: 0,
      deadClicks: 0, formSubmits: 0, formAbandons: 0,
      scrollTotal: 0, scrollCount: 0, timeTotal: 0, timeCount: 0,
    };
    if (event.eventType === "page_view") {
      page.views++;
      page.sessionIds.add(event.sessionId);
    }
    if (event.eventType === "click") page.clicks++;
    if (event.eventType === "rage_click") page.rageClicks++;
    if (event.eventType === "dead_click") page.deadClicks++;
    if (event.eventType === "form_submit") page.formSubmits++;
    if (event.eventType === "form_abandon") page.formAbandons++;
    if (event.eventType === "scroll_depth" && event.scrollDepth != null) {
      page.scrollTotal += event.scrollDepth;
      page.scrollCount++;
    }
    if (event.eventType === "exit" && event.timeOnPage != null) {
      page.timeTotal += event.timeOnPage;
      page.timeCount++;
    }
    pageMap.set(event.page, page);
    const list = sessionEvents.get(event.sessionId) ?? [];
    list.push(event);
    sessionEvents.set(event.sessionId, list);
  }

  const pageStats = [...pageMap.entries()].map(([page, x]) => ({
    page,
    views: x.views,
    sessions: x.sessionIds.size,
    clicks: x.clicks,
    rageClicks: x.rageClicks,
    deadClicks: x.deadClicks,
    formSubmits: x.formSubmits,
    formAbandons: x.formAbandons,
    avgScrollDepth: x.scrollCount ? Math.round(x.scrollTotal / x.scrollCount) : null,
    avgTimeOnPageSeconds: x.timeCount ? Math.round(x.timeTotal / x.timeCount) : null,
  })).sort((a, b) => b.sessions - a.sessions).slice(0, 20);

  const journeyCounts = new Map<string, { from: string; to: string; sessions: Set<string> }>();
  const entryCounts = new Map<string, Set<string>>();
  const exitCounts = new Map<string, Set<string>>();
  const referrerCounts = new Map<string, Set<string>>();
  let pageViewSessions = 0;
  let formSubmitSessions = 0;
  for (const [sessionId, list] of sessionEvents) {
    list.sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
    const pageViews = list.filter(e => e.eventType === "page_view");
    if (pageViews.length > 0) {
      pageViewSessions++;
      const entry = pageViews[0]!.page;
      const entries = entryCounts.get(entry) ?? new Set<string>();
      entries.add(sessionId);
      entryCounts.set(entry, entries);
      const referrer = pageViews[0]!.metadata?.["referrer"];
      if (typeof referrer === "string" && referrer.trim()) {
        try {
          const host = new URL(referrer).hostname.toLowerCase();
          const sessionsForHost = referrerCounts.get(host) ?? new Set<string>();
          sessionsForHost.add(sessionId);
          referrerCounts.set(host, sessionsForHost);
        } catch { /* invalid referrer is not treated as a source */ }
      }
      for (const exitEvent of list.filter(e => e.eventType === "exit")) {
        const exits = exitCounts.get(exitEvent.page) ?? new Set<string>();
        exits.add(sessionId);
        exitCounts.set(exitEvent.page, exits);
      }
      const pageSequence = pageViews.map(e => e.page).filter((page, index, pages) => index === 0 || page !== pages[index - 1]);
      for (let i = 1; i < pageSequence.length; i++) {
        const from = pageSequence[i - 1]!;
        const to = pageSequence[i]!;
        if (from === to) continue;
        const key = `${from}\u0000${to}`;
        const edge = journeyCounts.get(key) ?? { from, to, sessions: new Set<string>() };
        edge.sessions.add(sessionId);
        journeyCounts.set(key, edge);
      }
      if (list.some(e => e.eventType === "form_submit" && (e.createdAt?.getTime() ?? 0) >= (pageViews[0]!.createdAt?.getTime() ?? 0))) {
        formSubmitSessions++;
      }
    }
  }

  const deviceBuckets = new Map<string, { sessions: Set<string>; submitSessions: Set<string> }>();
  for (const [sessionId, list] of sessionEvents) {
    const device = sessionDevices.get(sessionId) ?? "unknown";
    const bucket = deviceBuckets.get(device) ?? { sessions: new Set<string>(), submitSessions: new Set<string>() };
    bucket.sessions.add(sessionId);
    if (list.some(e => e.eventType === "form_submit")) bucket.submitSessions.add(sessionId);
    deviceBuckets.set(device, bucket);
  }

  const totalEvents = events.length;
  const formAbandons = events.filter(e => e.eventType === "form_abandon").length;
  const friction = pageStats
    .filter(p => p.rageClicks + p.deadClicks + p.formAbandons > 0)
    .map(p => ({
      page: p.page,
      rageClicks: p.rageClicks,
      deadClicks: p.deadClicks,
      formAbandons: p.formAbandons,
      evidence: [p.rageClicks && `${p.rageClicks} rage clicks`, p.deadClicks && `${p.deadClicks} dead clicks`, p.formAbandons && `${p.formAbandons} abandons de formulaire`].filter(Boolean),
    }))
    .sort((a, b) => (b.rageClicks + b.deadClicks + b.formAbandons) - (a.rageClicks + a.deadClicks + a.formAbandons))
    .slice(0, 10);

  return {
    periodDays,
    dataLimited: events.length >= 20_000,
    totalEvents,
    pageViews: events.filter(e => e.eventType === "page_view").length,
    sessionsWithPageView: pageViewSessions,
    sessionsWithFormSubmit: formSubmitSessions,
    formAbandons,
    funnel: pageViewSessions ? [
      { step: "Session avec page vue", sessions: pageViewSessions, rateFromPrevious: null, abandonments: null },
      { step: "Soumission de formulaire après la page vue", sessions: formSubmitSessions, rateFromPrevious: Math.round(formSubmitSessions / pageViewSessions * 10000) / 100, abandonments: pageViewSessions - formSubmitSessions },
    ] : [],
    journeys: [...journeyCounts.values()].map(x => ({ from: x.from, to: x.to, sessions: x.sessions.size })).sort((a, b) => b.sessions - a.sessions).slice(0, 10),
    entryPages: [...entryCounts.entries()].map(([page, ids]) => ({ page, sessions: ids.size })).sort((a, b) => b.sessions - a.sessions).slice(0, 10),
    exitPages: [...exitCounts.entries()].map(([page, ids]) => ({ page, sessions: ids.size })).sort((a, b) => b.sessions - a.sessions).slice(0, 10),
    referrerSegments: [...referrerCounts.entries()].map(([referrerHost, ids]) => ({ referrerHost, sessions: ids.size })).sort((a, b) => b.sessions - a.sessions).slice(0, 10),
    pageStats,
    deviceSegments: [...deviceBuckets.entries()].map(([device, x]) => ({
      device,
      sessions: x.sessions.size,
      formSubmitSessions: x.submitSessions.size,
      formSubmitRate: x.sessions.size ? Math.round(x.submitSessions.size / x.sessions.size * 10000) / 100 : null,
    })).sort((a, b) => b.sessions - a.sessions),
    friction,
    unavailable: ["source de trafic", "nouveaux vs visiteurs récurrents"],
  };
}

export async function getBehaviorInsights(
  orgId: string,
  siteUrl?: string,
  periodDays = 30,
): Promise<{
  insights: Array<typeof behaviorInsightsTable.$inferSelect>;
  sessionStats: null;
  analysis: ReturnType<typeof summarizeBehaviorEvents> | null;
}> {
  const safePeriod = [7, 30, 90].includes(periodDays) ? periodDays : 30;
  const now = Date.now();
  const since = new Date(now - safePeriod * 24 * 60 * 60 * 1000);
  const comparisonSince = new Date(now - safePeriod * 2 * 24 * 60 * 60 * 1000);
  const insights = siteUrl
    ? await db.select().from(behaviorInsightsTable)
        .where(and(eq(behaviorInsightsTable.orgId, orgId), eq(behaviorInsightsTable.siteUrl, siteUrl)))
        .orderBy(desc(behaviorInsightsTable.createdAt))
        .limit(20)
    : await db.select().from(behaviorInsightsTable)
        .where(eq(behaviorInsightsTable.orgId, orgId))
        .orderBy(desc(behaviorInsightsTable.createdAt))
        .limit(20);

  let analysis: ReturnType<typeof summarizeBehaviorEvents> | null = null;
  if (siteUrl) {
    const events = await db.select({
      sessionId: behaviorEventsTable.sessionId,
      page: behaviorEventsTable.page,
      eventType: behaviorEventsTable.eventType,
      scrollDepth: behaviorEventsTable.scrollDepth,
      timeOnPage: behaviorEventsTable.timeOnPage,
      createdAt: behaviorEventsTable.createdAt,
      metadata: behaviorEventsTable.metadata,
    }).from(behaviorEventsTable).where(and(
      eq(behaviorEventsTable.orgId, orgId),
      eq(behaviorEventsTable.siteUrl, siteUrl),
      gte(behaviorEventsTable.createdAt, comparisonSince),
    )).orderBy(desc(behaviorEventsTable.createdAt)).limit(20_000);
    const sessionIds = [...new Set(events.map(e => e.sessionId))];
    const sessions = sessionIds.length
      ? await db.select({ id: behaviorSessionsTable.id, deviceType: behaviorSessionsTable.deviceType })
          .from(behaviorSessionsTable)
          .where(and(
            eq(behaviorSessionsTable.orgId, orgId),
            eq(behaviorSessionsTable.siteUrl, siteUrl),
            inArray(behaviorSessionsTable.id, sessionIds),
          ))
          .limit(10_000)
      : [];
    const typedEvents: BehavioralEventRecord[] = events.map(e => ({
      ...e,
      metadata: e.metadata && typeof e.metadata === "object"
        ? e.metadata as Record<string, unknown>
        : null,
    }));
    const currentEvents = typedEvents.filter(e => !e.createdAt || e.createdAt >= since);
    const previousEvents = typedEvents.filter(e => e.createdAt && e.createdAt < since);
    analysis = summarizeBehaviorEvents(currentEvents, sessions, safePeriod);
    const previous = summarizeBehaviorEvents(previousEvents, sessions, safePeriod);
    Object.assign(analysis, { comparison: {
      previousPeriodDays: safePeriod,
      previousSessionsWithPageView: previous.sessionsWithPageView,
      previousSessionsWithFormSubmit: previous.sessionsWithFormSubmit,
      sessionsChangePercent: previous.sessionsWithPageView
        ? Math.round((analysis.sessionsWithPageView - previous.sessionsWithPageView) / previous.sessionsWithPageView * 1000) / 10
        : null,
      formSubmitsChangePercent: previous.sessionsWithFormSubmit
        ? Math.round((analysis.sessionsWithFormSubmit - previous.sessionsWithFormSubmit) / previous.sessionsWithFormSubmit * 1000) / 10
        : null,
      dataLimited: events.length >= 20_000,
    } });
    analysis.dataLimited = events.length >= 20_000;
  }

  return {
    insights,
    analysis,
    // Legacy behavior_sessions.bounce and engagement_score are defaults, not measured fields.
    // Do not publish them as analytics until the collector records reliable values.
    sessionStats: null,
  };
}

export async function analyzeBehaviorFunnel(
  orgId: string,
  siteUrl: string,
  periodDays: number,
  steps: BehavioralFunnelStep[],
) {
  const safePeriod = [7, 30, 90].includes(periodDays) ? periodDays : 30;
  const since = new Date(Date.now() - safePeriod * 24 * 60 * 60 * 1000);
  const events = await db.select({
    sessionId: behaviorEventsTable.sessionId,
    page: behaviorEventsTable.page,
    eventType: behaviorEventsTable.eventType,
    scrollDepth: behaviorEventsTable.scrollDepth,
    timeOnPage: behaviorEventsTable.timeOnPage,
    createdAt: behaviorEventsTable.createdAt,
  }).from(behaviorEventsTable).where(and(
    eq(behaviorEventsTable.orgId, orgId),
    eq(behaviorEventsTable.siteUrl, siteUrl),
    gte(behaviorEventsTable.createdAt, since),
  )).orderBy(desc(behaviorEventsTable.createdAt)).limit(20_000);
  return {
    siteUrl,
    periodDays: safePeriod,
    dataLimited: events.length >= 20_000,
    steps: evaluateBehaviorFunnel(events, steps),
  };
}
