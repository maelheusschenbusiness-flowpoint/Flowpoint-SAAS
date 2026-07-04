interface CronJob {
  name: string;
  interval: string;
  lastRun: Date | null;
  status: "idle" | "running" | "error";
  runCount: number;
}

const jobs: Map<string, CronJob> = new Map([
  ["monitor-health", { name: "monitor-health", interval: "5min", lastRun: null, status: "idle", runCount: 0 }],
  ["dataforseo-sync", { name: "dataforseo-sync", interval: "1h", lastRun: null, status: "idle", runCount: 0 }],
  ["audit-scheduler", { name: "audit-scheduler", interval: "1h", lastRun: null, status: "idle", runCount: 0 }],
  ["mission-engine", { name: "mission-engine", interval: "6h", lastRun: null, status: "idle", runCount: 0 }],
  ["forecast-refresh", { name: "forecast-refresh", interval: "24h", lastRun: null, status: "idle", runCount: 0 }],
]);

export function markCronRun(name: string, status: "idle" | "running" | "error" = "idle"): void {
  const job = jobs.get(name);
  if (!job) return;
  job.lastRun = new Date();
  job.status = status;
  job.runCount += 1;
}

export function getCronStatus(): {
  jobs: Array<{ name: string; interval: string; lastRun: string | null; status: string; runCount: number }>;
  totalJobs: number;
  runningJobs: number;
} {
  const jobList = Array.from(jobs.values()).map((j) => ({
    name: j.name,
    interval: j.interval,
    lastRun: j.lastRun?.toISOString() ?? null,
    status: j.status,
    runCount: j.runCount,
  }));
  return {
    jobs: jobList,
    totalJobs: jobList.length,
    runningJobs: jobList.filter((j) => j.status === "running").length,
  };
}
