import { queue } from "../queues/index.js";
import { logger } from "../lib/logger.js";
import { store } from "../services/store.js";

interface AiAnalyseJobData {
  analysisId: string;
  type: "seo" | "competitor" | "keyword" | "content";
  payload: Record<string, unknown>;
  userId?: string;
}

queue.register<AiAnalyseJobData>("ai:analyse", async (job) => {
  const { analysisId, type } = job.data;
  logger.info({ analysisId, type }, "AI analysis job started");

  store.broadcast({ type: "ai:started", analysisId, analysisType: type });

  // Replace with real OpenAI call in production
  await new Promise((r) => setTimeout(r, 800));

  const result = {
    analysisId,
    analysisType: type,
    summary: "Analysis complete — 3 high-impact recommendations identified.",
    recommendations: [
      { priority: "high", action: "Improve Core Web Vitals (LCP < 2.5s)" },
      { priority: "medium", action: "Add structured data markup" },
      { priority: "low", action: "Optimise image alt attributes" },
    ],
    completedAt: new Date().toISOString(),
  };

  store.broadcast({ type: "ai:completed", ...result });
  logger.info({ analysisId }, "AI analysis job completed");
});
