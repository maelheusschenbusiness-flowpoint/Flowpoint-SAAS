import { queue } from "../queues/index.js";
import { logger } from "../lib/logger.js";
import { validateMonitorUrl } from "../lib/validateMonitorUrl.js";
import { db } from "@workspace/db";
import { monitors } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { store } from "../services/store.js";

interface MonitorPingJobData {
  monitorId: string;
  url: string;
  expectedStatus?: number;
}

queue.register<MonitorPingJobData>("monitor:ping", async (job) => {
  const { monitorId, url, expectedStatus = 200 } = job.data;
  logger.info({ monitorId, url }, "Monitor ping job started");

  const result = await validateMonitorUrl(url);
  const status = result.ok ? "up" : "down";

  try {
    await db
      .update(monitors)
      .set({
        status,
        lastCheckedAt: new Date(),
        responseTime: result.responseTime ?? null,
      })
      .where(eq(monitors.id, monitorId));
  } catch (dbErr) {
    logger.warn({ monitorId, dbErr }, "Could not update monitor in DB");
  }

  store.broadcast({
    type: "monitor:ping",
    monitorId,
    status,
    responseTime: result.responseTime,
    checkedAt: new Date().toISOString(),
  });

  if (!result.ok) {
    logger.warn({ monitorId, url, status }, "Monitor is DOWN");
    throw new Error(`Monitor ${monitorId} returned status: ${result.status}`);
  }

  logger.info({ monitorId, status, responseTime: result.responseTime }, "Monitor ping completed");
});

// Helper: enqueue a monitor ping
export function enqueueMonitorPing(data: MonitorPingJobData) {
  return queue.add("monitor:ping", data, { maxAttempts: 2 });
}
