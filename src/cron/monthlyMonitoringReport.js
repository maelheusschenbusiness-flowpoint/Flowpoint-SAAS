// src/cron/monthlyMonitoringReport.js
// Monthly Monitoring Cron - Flowpoint (MONGO_URI compatible)

const mongoose = require("mongoose");

function requiredEnvEither(...names) {
  for (const name of names) {
    const v = process.env[name];
    if (v && String(v).trim().length > 0) return v;
  }
  throw new Error(`Missing env var: one of [${names.join(", ")}]`);
}

function withTimeout(promise, ms, label = "operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
    ),
  ]);
}

async function stripeListActiveSubscriptions(secretKey) {
  const params = new URLSearchParams({ status: "active", limit: "100" });

  const res = await fetch(`https://api.stripe.com/v1/subscriptions?${params}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Stripe API error (${res.status}): ${text}`);
  }
  return JSON.parse(text);
}

// Models (safe)
const UserSchema = new mongoose.Schema(
  { email: String, subscriptionStatus: String, createdAt: Date },
  { collection: "users" }
);

const EmailLogSchema = new mongoose.Schema(
  { userId: String, sentAt: Date, type: String },
  { collection: "email_logs" }
);

const User = mongoose.models.User || mongoose.model("User", UserSchema);
const EmailLog =
  mongoose.models.EmailLog || mongoose.model("EmailLog", EmailLogSchema);

async function connectDB(uri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  console.log("✅ MongoDB connected");
}

async function checkActiveUsers() {
  const n = await User.countDocuments({ subscriptionStatus: "active" });
  console.log("👥 Active users (DB):", n);
  return n;
}

async function checkEmailLogs() {
  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);

  const n = await EmailLog.countDocuments({
    type: "monthly_report",
    sentAt: { $gte: lastMonth },
  });
  console.log("📧 Monthly reports sent (last 30d):", n);
  return n;
}

async function checkExternalAPI() {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch("https://www.google.com", {
      method: "GET",
      signal: controller.signal,
    });
    console.log("🌍 External API reachable:", res.ok ? "YES" : "NO");
    return res.ok;
  } catch {
    console.log("🌍 External API reachable: NO");
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  console.log("🚀 Monthly monitoring cron started:", new Date().toISOString());

  const MONGO_URI = requiredEnvEither("MONGO_URI", "MONGODB_URI");
  const STRIPE_SECRET_KEY = requiredEnvEither("STRIPE_SECRET_KEY");

  await withTimeout(connectDB(MONGO_URI), 20000, "connectDB");

  const users = await withTimeout(checkActiveUsers(), 15000, "checkActiveUsers");

  let stripe = 0;
  try {
    const stripeRes = await withTimeout(
      stripeListActiveSubscriptions(STRIPE_SECRET_KEY),
      20000,
      "stripeListActiveSubscriptions"
    );
    stripe = stripeRes.data?.length ?? 0;
    console.log("💳 Active Stripe subscriptions:", stripe);
  } catch (e) {
    console.error("❌ Stripe check failed:", e.message);
  }

  const emails = await withTimeout(checkEmailLogs(), 15000, "checkEmailLogs");
  const apiOk = await withTimeout(checkExternalAPI(), 12000, "checkExternalAPI");

  console.log("\n========== MONTHLY MONITORING REPORT ==========\n");
  console.log("Active Users (DB):", users);
  console.log("Active Stripe Subs:", stripe);
  console.log("Monthly Emails Sent:", emails);
  console.log("External API OK:", apiOk ? "YES" : "NO");
  console.log("\n=============================================\n");

  if (stripe !== 0 && users !== stripe) {
    console.warn("⚠️ Mismatch between DB users and Stripe subscriptions!");
  }

  await mongoose.disconnect().catch(() => {});
  process.exitCode = 0;
}

main().catch(async (err) => {
  console.error("❌ Cron crashed:", err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exitCode = 1;
});
