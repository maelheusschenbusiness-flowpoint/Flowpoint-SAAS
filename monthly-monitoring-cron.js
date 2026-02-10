// monthly-monitoring-cron.js
// FlowPoint AI — Monthly Monitoring Report (ULTRA)
// Runs 1x per day, computes last 30 days reliability metrics

require("dotenv").config();
const mongoose = require("mongoose");

const REQUIRED = ["MONGO_URI", "CRON_KEY"];
for (const k of REQUIRED) {
  if (!process.env[k]) {
    console.error("❌ ENV manquante:", k);
    process.exit(1);
  }
}

// ---- Models (same collections, no breaking change)
const MonitorLogSchema = new mongoose.Schema({}, { strict: false, collection: "monitorlogs" });
const MonitorSchema = new mongoose.Schema({}, { strict: false, collection: "monitors" });
const OrgSchema = new mongoose.Schema({}, { strict: false, collection: "orgs" });

const MonitorLog = mongoose.model("MonitorLog", MonitorLogSchema);
const Monitor = mongoose.model("Monitor", MonitorSchema);
const Org = mongoose.model("Org", OrgSchema);

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

async function run() {
  console.log("📊 Monthly monitoring cron started");
  await mongoose.connect(process.env.MONGO_URI);

  const cutoff = Date.now() - 30 * 86400000;
  const orgs = await Org.find({ plan: "ultra" });

  for (const org of orgs) {
    const monitors = await Monitor.find({ orgId: org._id });
    if (!monitors.length) continue;

    const logs = await MonitorLog.find({
      orgId: org._id,
      createdAt: { $gte: new Date(cutoff) },
    }).sort({ createdAt: 1 });

    let checks = 0, up = 0, down = 0;
    let incidents = 0;
    let rtSum = 0, rtCnt = 0;

    let prev = "unknown";

    for (const l of logs) {
      const st = String(l.status || "").toLowerCase();
      checks++;
      if (st === "up") up++;
      if (st === "down") down++;

      if (st === "down" && prev !== "down") incidents++;

      if (l.responseTimeMs) {
        rtSum += l.responseTimeMs;
        rtCnt++;
      }

      prev = st;
    }

    const uptime = checks ? up / checks : 0;
    const avgRt = rtCnt ? rtSum / rtCnt : 0;

    let score = uptime * 100;
    score -= Math.min(40, incidents * 2);
    score -= Math.min(20, avgRt / 200);
    score = clamp(score, 0, 100);

    org.lastMonitoringScore = Math.round(score);
    org.lastMonitoringUptime = uptime;
    org.lastMonitoringComputedAt = new Date();

    await org.save();

    console.log(`✅ Org ${org._id} score=${Math.round(score)}`);
  }

  await mongoose.disconnect();
  console.log("✅ Monthly monitoring cron finished");
}

run().catch((e) => {
  console.error("❌ Monthly cron fatal:", e);
  process.exit(1);
});
