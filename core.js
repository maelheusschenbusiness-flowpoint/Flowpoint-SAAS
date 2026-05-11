const mongoose = require("mongoose");

const { Schema } = mongoose;

/* =========================================================
   ORGANIZATION
========================================================= */

const OrganizationSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },

    slug: {
      type: String,
      unique: true,
      lowercase: true
    },

    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User"
    },

    plan: {
      type: String,
      enum: ["standard", "pro", "ultra"],
      default: "standard"
    },

    subscriptionStatus: {
      type: String,
      default: "trialing"
    },

    stripeCustomerId: String,
    stripeSubscriptionId: String,

    accessBlocked: {
      type: Boolean,
      default: false
    },

    addons: {
      extraSeats: {
        type: Number,
        default: 0
      },

      extraMonitors: {
        type: Number,
        default: 0
      }
    },

    usage: {
      auditsUsed: {
        type: Number,
        default: 0
      },

      monitorsUsed: {
        type: Number,
        default: 0
      },

      reportsUsed: {
        type: Number,
        default: 0
      },

      exportsUsed: {
        type: Number,
        default: 0
      }
    }
  },
  {
    timestamps: true
  }
);

/* =========================================================
   ACTIVITY LOG
========================================================= */

const ActivityLogSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization"
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: "User"
    },

    type: String,

    title: String,

    description: String,

    metadata: {
      type: Object,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

/* =========================================================
   MODELS
========================================================= */

const Organization = mongoose.model(
  "Organization",
  OrganizationSchema
);

const ActivityLog = mongoose.model(
  "ActivityLog",
  ActivityLogSchema
);

/* =========================================================
   PLANS
========================================================= */

const PLANS = {
  standard: {
    audits: 30,
    monitors: 3,
    reports: 30,
    exports: 30,
    teamMembers: 1
  },

  pro: {
    audits: 300,
    monitors: 50,
    reports: 300,
    exports: 300,
    teamMembers: 5
  },

  ultra: {
    audits: 2000,
    monitors: 300,
    reports: 2000,
    exports: 2000,
    teamMembers: 10
  }
};

/* =========================================================
   PLAN HELPERS
========================================================= */

function getPlan(org) {
  return (
    PLANS[org.plan] || PLANS.standard
  );
}

function getLimit(org, key) {
  const plan = getPlan(org);

  let limit = plan[key] || 0;

  if (key === "monitors") {
    limit +=
      org.addons?.extraMonitors || 0;
  }

  if (key === "teamMembers") {
    limit +=
      org.addons?.extraSeats || 0;
  }

  return limit;
}

function getUsage(org, key) {
  const map = {
    audits: "auditsUsed",
    monitors: "monitorsUsed",
    reports: "reportsUsed",
    exports: "exportsUsed"
  };

  return org.usage?.[map[key]] || 0;
}

function hasQuota(org, key) {
  return (
    getUsage(org, key) <
    getLimit(org, key)
  );
}

/* =========================================================
   QUOTA MIDDLEWARE
========================================================= */

function requireQuota(key) {
  return async (req, res, next) => {
    try {
      const org =
        await Organization.findById(
          req.user.organizationId
        );

      if (!org) {
        return res.status(404).json({
          error: "Organization not found"
        });
      }

      if (org.accessBlocked) {
        return res.status(403).json({
          error:
            "Subscription access blocked"
        });
      }

      if (!hasQuota(org, key)) {
        return res.status(403).json({
          error: "Quota exceeded",
          quota: key,
          limit: getLimit(org, key)
        });
      }

      req.organization = org;

      next();
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: "Quota middleware failed"
      });
    }
  };
}

/* =========================================================
   USAGE
========================================================= */

async function incrementUsage(
  organizationId,
  key
) {
  const map = {
    audits: "usage.auditsUsed",
    monitors: "usage.monitorsUsed",
    reports: "usage.reportsUsed",
    exports: "usage.exportsUsed"
  };

  const field = map[key];

  if (!field) return;

  await Organization.findByIdAndUpdate(
    organizationId,
    {
      $inc: {
        [field]: 1
      }
    }
  );
}

/* =========================================================
   ACTIVITY
========================================================= */

async function logActivity({
  organizationId,
  userId,
  type,
  title,
  description = "",
  metadata = {}
}) {
  try {
    await ActivityLog.create({
      organizationId,
      userId,
      type,
      title,
      description,
      metadata
    });
  } catch (error) {
    console.error(
      "activity error",
      error.message
    );
  }
}

/* =========================================================
   EXPORTS
========================================================= */

module.exports = {
  Organization,
  ActivityLog,

  PLANS,

  getPlan,
  getLimit,
  getUsage,
  hasQuota,

  requireQuota,

  incrementUsage,

  logActivity
};
