import { queue } from "../queues/index.js";
import { logger } from "../lib/logger.js";
import { db } from "@workspace/db";
import { audits } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { store } from "../services/store.js";

interface AuditJobData {
  auditId: string;
  url: string;
  userId?: string;
}

queue.register<AuditJobData>("audit:run", async (job) => {
  const { auditId, url } = job.data;
  logger.info({ auditId, url }, "Starting audit job");

  try {
    await db
      .update(audits)
      .set({ status: "running" })
      .where(eq(audits.id, auditId));

    store.broadcast({ type: "audit:started", auditId, url });

    // Simulate audit phases (replace with real crawler logic)
    const phases = ["crawl", "analyse", "score", "report"];
    for (const phase of phases) {
      await new Promise((r) => setTimeout(r, 500));
      store.broadcast({ type: "audit:progress", auditId, phase });
    }

    const score = Math.floor(Math.random() * 40) + 60; // 60-100

    await db
      .update(audits)
      .set({
        status: "completed",
        score,
        completedAt: new Date(),
      })
      .where(eq(audits.id, auditId));

    store.broadcast({ type: "audit:completed", auditId, score });
    logger.info({ auditId, score }, "Audit job completed");
  } catch (err) {
    await db
      .update(audits)
      .set({ status: "failed" })
      .where(eq(audits.id, auditId));
    store.broadcast({ type: "audit:failed", auditId });
    throw err;
  }
});
