// monthly-monitoring-cron.js

require("dotenv").config();
const mongoose = require("mongoose");
const axios = require("axios");

// ===============================
// 🔌 1. Connexion MongoDB
// ===============================

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ MongoDB connected");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    process.exit(1);
  }
}

// ===============================
// 📊 2. Vérifier nombre d'utilisateurs actifs
// ===============================

async function checkActiveUsers() {
  const User = mongoose.model(
    "User",
    new mongoose.Schema({
      email: String,
      subscriptionStatus: String,
      createdAt: Date,
    }),
    "users"
  );

  const activeUsers = await User.countDocuments({
    subscriptionStatus: "active",
  });

  console.log("👥 Active users:", activeUsers);
  return activeUsers;
}

// ===============================
// 💳 3. Vérifier abonnements Stripe actifs
// ===============================

async function checkStripeSubscriptions() {
  try {
    const response = await axios.get(
      "https://api.stripe.com/v1/subscriptions?status=active&limit=100",
      {
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        },
      }
    );

    const stripeCount = response.data.data.length;
    console.log("💳 Active Stripe subscriptions:", stripeCount);
    return stripeCount;
  } catch (error) {
    console.error("❌ Stripe check failed:", error.response?.data || error.message);
    return 0;
  }
}

// ===============================
// 📧 4. Vérifier logs emails mensuels
// ===============================

async function checkEmailLogs() {
  const EmailLog = mongoose.model(
    "EmailLog",
    new mongoose.Schema({
      userId: String,
      sentAt: Date,
      type: String,
    }),
    "email_logs"
  );

  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);

  const sentCount = await EmailLog.countDocuments({
    type: "monthly_report",
    sentAt: { $gte: lastMonth },
  });

  console.log("📧 Monthly reports sent:", sentCount);
  return sentCount;
}

// ===============================
// 🌍 5. Vérifier API externe (SEO / Maps)
// ===============================

async function checkExternalAPI() {
  try {
    const response = await axios.get("https://www.google.com");
    if (response.status === 200) {
      console.log("🌍 External API reachable");
      return true;
    }
  } catch (error) {
    console.error("❌ External API not reachable");
    return false;
  }
}

// ===============================
// 🧠 6. Monitoring global
// ===============================

async function runMonitoring() {
  await connectDB();

  const users = await checkActiveUsers();
  const stripe = await checkStripeSubscriptions();
  const emails = await checkEmailLogs();
  const apiStatus = await checkExternalAPI();

  console.log("\n========== 📊 MONTHLY MONITORING REPORT ==========");
  console.log("Active Users (DB):", users);
  console.log("Active Stripe Subs:", stripe);
  console.log("Monthly Emails Sent:", emails);
  console.log("External API OK:", apiStatus ? "YES" : "NO");
  console.log("==================================================\n");

  if (users !== stripe) {
    console.warn("⚠️ Mismatch between DB users and Stripe subscriptions!");
  }

  process.exit();
}

runMonitoring();
