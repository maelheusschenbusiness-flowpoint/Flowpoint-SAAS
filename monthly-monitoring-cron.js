// monthly-monitoring-cron.js
// Cron "Monthly Monitoring" - Flowpoint AI (compatible MONGO_URI ou MONGODB_URI)

const mongoose = require("mongoose");

// ============ Utils ============
function requiredEnvEither(...names) {
  for (const name of names) {
    const v = process.env[name];
    if (v && String(v).trim().length > 0) return v;
  }
  throw new Error(`Missing env var: one of [${names.join(", ")}]`);
}

function logSection(title) {
  console.log(`\n========== ${title} ==========\n`);
}

// Timeout global pour éviter "cron bloqué"
function withTimeout(promise, ms, label = "operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
    ),
  ]);
}

// Node 18+ a fetch (sur ton Render c'est OK)
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

// ============ Mongo Models (safe) ============
const UserSchema = new mongoose.Schema(
  {
    email: String,
    subscriptionStatus: String,
    createdAt: Date,
  },
  { collection: "users" }
);

const EmailLogSchema = new mongoose.Schema(
  {
    userId: String,
    sentAt: Date,
    type: String,
  },
  { collection: "email_logs" }
);

const User = mongoose.models.User || mongoose.model("User", UserSchema);
const EmailLog =
  mongoose.models.EmailLog || mongoose.model("EmailLog", EmailLogSchema);

// ============ Checks ============
async function connectDB(mongoUri) {
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 15000,
  });
  console.log("✅ MongoDB connected");
}

async function checkActiveUsers() {
  const activeUsers = await User.countDocuments({
    subscriptionStatus: "active",
  });
  console.log("👥 Active users (DB):", activeUsers);
  return activeUsers;
}

async function checkStripeSubscriptions(stripeKey) {
  try {
    const stripeRes = await withTimeout(
      stripeListActiveSubscriptions(stripeKey),
      20000,
      "stripeListActiveSubscriptions"
    );
    const stripeCount = stripeRes.data?.length ?? 0;
    console.log("💳 Active Stripe subscriptions:", stripeCount);
    return stripeCount;
  } catch (e) {
    console.error("❌ Stripe check failed:", e.message);
    return 0;
  }
}

async function checkEmailLogs() {
  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);

  const sentCount = await EmailLog.countDocuments({
    type: "monthly_report",
    sentAt: { $gte: lastMonth },
  });

  console.log("📧 Monthly reports sent (last 30d):", sentCount);
  return sentCount;
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
  } catch (e) {
    console.log("🌍 External API reachable: NO");
    return false;
  } finally {
    clearTimeout(t);
  }
}

// ============ Main ============
async function main() {
  const startedAt = new Date();
  console.log("🚀 Monthly monitoring cron started:", startedAt.toISOString());

  // ✅ Ici on accepte MONGO_URI ou MONGODB_URI
  const MONGO_URI = requiredEnvEither("MONGO_URI", "MONGODB_URI");
  const STRIPE_SECRET_KEY = requiredEnvEither("STRIPE_SECRET_KEY");

  // 1) DB
  await withTimeout(connectDB(MONGO_URI), 20000, "connectDB");

  // 2) Active users
  const users = await withTimeout(checkActiveUsers(), 15000, "checkActiveUsers");

  // 3) Stripe active subs
  const stripe = await withTimeout(
    checkStripeSubscriptions(STRIPE_SECRET_KEY),
    25000,
    "checkStripeSubscriptions"
  );

  // 4) Email logs
  const emails = await withTimeout(checkEmailLogs(), 15000, "checkEmailLogs");

  // 5) External API
  const apiOk = await withTimeout(checkExternalAPI(), 12000, "checkExternalAPI");

  logSection("MONTHLY MONITORING REPORT");
  console.log("Active Users (DB):", users);
  console.log("Active Stripe Subs:", stripe);
  console.log("Monthly Emails Sent:", emails);
  console.log("External API OK:", apiOk ? "YES" : "NO");

  if (stripe !== 0 && users !== stripe) {
    console.warn(
      "⚠️ Mismatch between DB active users and Stripe active subscriptions!"
    );
  }

  // Clean exit
  await mongoose.disconnect().catch(() => {});
  console.log(
    "✅ Cron finished in",
    Math.round((Date.now() - startedAt) / 1000),
    "s"
  );
  process.exitCode = 0;
}

main().catch(async (err) => {
  console.error("❌ Cron crashed:", err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exitCode = 1;
});
