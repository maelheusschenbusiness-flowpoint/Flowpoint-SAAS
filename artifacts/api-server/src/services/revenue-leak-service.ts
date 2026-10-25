import { createHash } from "crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, behaviorEventsTable } from "@workspace/db";
import { deriveConversionObservations } from "./conversion-observations.js";

export interface RevenueLeakItem {
  id: string;
  orgId: string;
  siteUrl: string | null;
  leakType: string;
  page: string;
  title: string;
  description: string;
  estimatedMonthlyLoss: null;
  impactScore: null;
  fixDifficultyMin: null;
  quickFix: string;
  status: "active";
  metadata: {
    source: "behavior_events";
    financialClassification: "unmeasured";
    observedEvents: number;
    affectedSessions: number;
    confidence: "low" | "medium" | "high";
  };
  detectedAt: Date;
  resolvedAt: null;
}

export interface RevenueLeakData {
  leaks: RevenueLeakItem[];
  summary: {
    totalLeaks: number;
    activeLeaks: number;
    estimatedMonthlyLoss: null;
    resolvedSavings: null;
    topCategory: string;
    criticalLeaks: number;
  };
  financial: {
    status: "unavailable";
    observedLoss: null;
    estimatedLoss: null;
    currency: null;
  };
}

const WINDOW_DAYS = 30;
const titleFor: Record<string, string> = {
  form_abandon: "Abandon de formulaire observé",
  rage_click: "Clics répétés observés",
  dead_click: "Clics sans action observés",
  exit: "Sorties de page observées",
  low_scroll: "Faible profondeur de lecture observée",
};

/**
 * Revenue opportunities are derived only from observed behavioral events.
 * Financial losses remain unavailable until an organization connects measured
 * revenue to these events; no benchmark or model-generated amount is shown.
 */
export async function getRevenueLeakData(orgId: string, siteUrl?: string): Promise<RevenueLeakData> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const filters = [
    eq(behaviorEventsTable.orgId, orgId),
    gte(behaviorEventsTable.createdAt, since),
  ];
  if (siteUrl) filters.push(eq(behaviorEventsTable.siteUrl, siteUrl));

  const events = await db.select({
    siteUrl: behaviorEventsTable.siteUrl,
    page: behaviorEventsTable.page,
    sessionId: behaviorEventsTable.sessionId,
    eventType: behaviorEventsTable.eventType,
    scrollDepth: behaviorEventsTable.scrollDepth,
  }).from(behaviorEventsTable)
    .where(and(...filters))
    .orderBy(desc(behaviorEventsTable.createdAt))
    .limit(20_000);

  const now = new Date();
  const leaks: RevenueLeakItem[] = deriveConversionObservations(events).map((observation) => {
    const observationSite = observation.siteUrl ?? siteUrl ?? null;
    const identity = `${orgId}|${observationSite ?? ""}|${observation.page}|${observation.eventType}`;
    return {
      id: createHash("sha256").update(identity).digest("hex"),
      orgId,
      siteUrl: observationSite,
      leakType: observation.eventType,
      page: observation.page,
      title: titleFor[observation.eventType] ?? "Signal de conversion observé",
      description: `${observation.observedEvents} événements observés dans ${observation.affectedSessions} sessions sur ${observation.page}.`,
      estimatedMonthlyLoss: null,
      impactScore: null,
      fixDifficultyMin: null,
      quickFix: observation.recommendation,
      status: "active",
      metadata: {
        source: "behavior_events",
        financialClassification: "unmeasured",
        observedEvents: observation.observedEvents,
        affectedSessions: observation.affectedSessions,
        confidence: observation.confidence,
      },
      detectedAt: now,
      resolvedAt: null,
    };
  });

  return {
    leaks,
    summary: {
      totalLeaks: leaks.length,
      activeLeaks: leaks.length,
      estimatedMonthlyLoss: null,
      resolvedSavings: null,
      topCategory: leaks[0]?.leakType ?? "N/A",
      criticalLeaks: leaks.filter(leak => leak.metadata.confidence === "high").length,
    },
    financial: {
      status: "unavailable",
      observedLoss: null,
      estimatedLoss: null,
      currency: null,
    },
  };
}

export async function detectRevenueLeaks(orgId: string, siteUrl: string): Promise<RevenueLeakData> {
  return getRevenueLeakData(orgId, siteUrl);
}
