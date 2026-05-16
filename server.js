'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║                 FLOWPOINT — Backend API V3                          ║
 * ║   Enterprise SaaS Backend · MongoDB · Stripe · AI · SSE            ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

require('dotenv').config();

/* =========================================================
   IMPORTS
========================================================= */

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const cron = require('node-cron');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const Stripe = require('stripe');
const { Resend } = require('resend');

const app = express();

/* =========================================================
   ENV
========================================================= */

const PORT =
  process.env.PORT || 10000;

const NODE_ENV =
  process.env.NODE_ENV || 'development';

const IS_PROD =
  NODE_ENV === 'production';

const MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://127.0.0.1:27017/flowpoint';

const JWT_SECRET =
  process.env.JWT_SECRET ||
  'change_this_secret_32_chars_minimum';

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  `http://localhost:${PORT}`;

const OPENAI_KEY =
  process.env.OPENAI_API_KEY || '';

const STRIPE_SECRET_KEY =
  process.env.STRIPE_SECRET_KEY || '';

const STRIPE_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET || '';

const STRIPE_PUBLISHABLE_KEY =
  process.env.STRIPE_PUBLISHABLE_KEY || '';

const RESEND_API_KEY =
  process.env.RESEND_API_KEY || '';

const FROM_EMAIL =
  process.env.FROM_EMAIL ||
  'no-reply@flowpoint.pro';

const ADMIN_KEY =
  process.env.ADMIN_KEY || '';

const CRON_KEY =
  process.env.CRON_KEY || '';

const LOGIN_LINK_TTL_MINUTES =
  Number(
    process.env.LOGIN_LINK_TTL_MINUTES || 30
  );

const AUDIT_CACHE_HOURS =
  Number(
    process.env.AUDIT_CACHE_HOURS || 24
  );

const MONITOR_HTTP_TIMEOUT_MS =
  Number(
    process.env.MONITOR_HTTP_TIMEOUT_MS || 8000
  );

/* =========================================================
   STRIPE
========================================================= */

const STRIPE_PRICES = {
  standard:
    process.env.STRIPE_PRICE_STANDARD || '',

  pro:
    process.env.STRIPE_PRICE_PRO || '',

  ultra:
    process.env.STRIPE_PRICE_ULTRA || '',
};

const ADDON_PRICE_IDS = {

  monitorsPack50:
    process.env.STRIPE_ADDON_MONITORS || '',

  extraSeats:
    process.env.STRIPE_ADDON_SEATS || '',

  auditsPack200:
    process.env.STRIPE_ADDON_AUDITS || '',

  pdfPack200:
    process.env.STRIPE_ADDON_PDF || '',

  exportsPack1000:
    process.env.STRIPE_ADDON_EXPORTS || '',

  prioritySupport:
    process.env.STRIPE_ADDON_SUPPORT || '',

  customDomain:
    process.env.STRIPE_ADDON_DOMAIN || '',

  retention90d:
    process.env.STRIPE_ADDON_RET90 || '',

  retention365d:
    process.env.STRIPE_ADDON_RET365 || '',
};

const PLAN_LIMITS = {

  standard: {
    audit: 30,
    monitor: 3,
    pdf: 30,
    exports: 30,
    aiCredits: 20,
    seats: 1,
  },

  pro: {
    audit: 300,
    monitor: 50,
    pdf: 300,
    exports: 300,
    aiCredits: 100,
    seats: 5,
  },

  ultra: {
    audit: 2000,
    monitor: 300,
    pdf: 2000,
    exports: 2000,
    aiCredits: 500,
    seats: 10,
  },
};

const stripe =
  STRIPE_SECRET_KEY
    ? new Stripe(
        STRIPE_SECRET_KEY,
        {
          apiVersion: '2024-04-10',
        }
      )
    : null;

/* =========================================================
   RESEND
========================================================= */

const resend =
  RESEND_API_KEY
    ? new Resend(
        RESEND_API_KEY
      )
    : null;

/* =========================================================
   APP CONFIG
========================================================= */

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(
  cors({
    origin(origin, cb) {

      if (
        !origin ||
        !IS_PROD
      ) {
        return cb(null, true);
      }

      if (
        origin === FRONTEND_URL
      ) {
        return cb(null, true);
      }

      return cb(
        new Error(
          `CORS blocked: ${origin}`
        )
      );
    },

    credentials: true,
  })
);

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
  })
);

app.use(cookieParser());

/* =========================================================
   STRIPE WEBHOOK RAW
========================================================= */

app.post(
  '/api/billing/webhook',

  express.raw({
    type: 'application/json',
  }),

  async (req, res) => {

    try {

      if (!stripe) {
        return res.json({
          ok: true,
        });
      }

      const sig =
        req.headers[
          'stripe-signature'
        ];

      const event =
        stripe.webhooks.constructEvent(
          req.body,
          sig,
          STRIPE_WEBHOOK_SECRET
        );

      console.log(
        '[FP] Stripe webhook:',
        event.type
      );

      global.__FP_STRIPE_QUEUE =
        global.__FP_STRIPE_QUEUE || [];

      global.__FP_STRIPE_QUEUE.push(
        event
      );

      return res.json({
        received: true,
      });

    } catch (err) {

      console.error(
        '[FP] Stripe webhook error:',
        err.message
      );

      return res.status(400).json({
        error: err.message,
      });
    }
  }
);

/* =========================================================
   JSON
========================================================= */

app.use(
  express.json({
    limit: '10mb',
  })
);

app.use(
  express.urlencoded({
    extended: true,
  })
);

/* =========================================================
   CACHE CONTROL
========================================================= */

app.use((req, res, next) => {

  if (
    req.path.startsWith('/api/auth/') ||
    req.path === '/api/me' ||
    req.path === '/api/overview'
  ) {

    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate'
    );

    res.setHeader(
      'Pragma',
      'no-cache'
    );

    res.setHeader(
      'Expires',
      '0'
    );
  }

  next();
});

/* =========================================================
   SSE REALTIME
========================================================= */

const sseClients = new Map();

function sseNotify(
  userId,
  payload
) {

  const clients =
    sseClients.get(userId);

  if (!clients?.length) {
    return;
  }

  const data =
    `data: ${JSON.stringify(payload)}\n\n`;

  for (const res of clients) {

    try {
      res.write(data);
    } catch {}
  }
}

/* =========================================================
   HELPERS
========================================================= */

function safeObjectId() {
  return new mongoose.Types.ObjectId();
}

function normalizeEmail(email='') {

  return String(email)
    .trim()
    .toLowerCase();
}

function slugify(str='') {

  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function randomToken(
  length = 48
) {

  return crypto
    .randomBytes(length)
    .toString('hex');
}

function signToken(user) {

  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      plan: user.plan,
      role: user.role,
    },
    JWT_SECRET,
    {
      expiresIn: '30d',
    }
  );
}

function userPayload(user) {

  return {

    id: user._id,

    email: user.email,

    firstName:
      user.firstName,

    role:
      user.role,

    plan:
      user.plan,

    subscriptionStatus:
      user.subscriptionStatus,

    orgId:
      user.orgId,

    usage:
      user.usage,

    addons:
      user.addons,

    aiCredits:
      user.aiCredits,
  };
}
/* =========================================================
   MONGOOSE
========================================================= */

const { Schema, model } = mongoose;

/* =========================================================
   USER
========================================================= */

const UserSchema = new Schema(
  {

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },

    passwordHash: {
      type: String,
      required: true,
    },

    firstName: {
      type: String,
      required: true,
    },

    companyName: {
      type: String,
      default: '',
    },

    website: {
      type: String,
      default: '',
    },

    role: {
      type: String,
      enum: [
        'owner',
        'admin',
        'manager',
        'viewer',
      ],
      default: 'owner',
    },

    plan: {
      type: String,
      enum: [
        'standard',
        'pro',
        'ultra',
      ],
      default: 'standard',
    },

    subscriptionStatus: {
      type: String,
      enum: [
        'trial',
        'active',
        'past_due',
        'canceled',
      ],
      default: 'trial',
    },

    stripeCustomerId: {
      type: String,
      default: '',
    },

    stripeSubscriptionId: {
      type: String,
      default: '',
    },

    trialEndsAt: Date,

    accessBlocked: {
      type: Boolean,
      default: false,
    },

    orgId: {
      type: Schema.Types.ObjectId,
      ref: 'Org',
    },

    usage: {

      audit: {
        used: {
          type: Number,
          default: 0,
        },

        limit: {
          type: Number,
          default:
            PLAN_LIMITS.standard.audit,
        },
      },

      monitor: {
        used: {
          type: Number,
          default: 0,
        },

        limit: {
          type: Number,
          default:
            PLAN_LIMITS.standard.monitor,
        },
      },

      pdf: {
        used: {
          type: Number,
          default: 0,
        },

        limit: {
          type: Number,
          default:
            PLAN_LIMITS.standard.pdf,
        },
      },

      exports: {
        used: {
          type: Number,
          default: 0,
        },

        limit: {
          type: Number,
          default:
            PLAN_LIMITS.standard.exports,
        },
      },
    },

    aiCredits: {

      used: {
        type: Number,
        default: 0,
      },

      limit: {
        type: Number,
        default:
          PLAN_LIMITS.standard.aiCredits,
      },
    },

    addons: {

      monitorsPack50: {
        type: Number,
        default: 0,
      },

      extraSeats: {
        type: Number,
        default: 0,
      },

      auditsPack200: {
        type: Number,
        default: 0,
      },

      pdfPack200: {
        type: Number,
        default: 0,
      },

      exportsPack1000: {
        type: Number,
        default: 0,
      },

      prioritySupport: {
        type: Boolean,
        default: false,
      },

      customDomain: {
        type: Boolean,
        default: false,
      },

      retention90d: {
        type: Boolean,
        default: false,
      },

      retention365d: {
        type: Boolean,
        default: false,
      },
    },

    lastLoginAt: Date,

  },

  {
    timestamps: true,
  }
);

/* =========================================================
   ORG
========================================================= */

const OrgSchema = new Schema(
  {

    name: {
      type: String,
      required: true,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
    },

    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },

    plan: {
      type: String,
      default: 'standard',
    },

    seats: {
      type: Number,
      default: 1,
    },

    branding: {

      logoUrl: String,

      primaryColor: {
        type: String,
        default: '#2f5bff',
      },

      customDomain: String,
    },

    settings: {

      notifications: {
        email: {
          type: Boolean,
          default: true,
        },

        monitors: {
          type: Boolean,
          default: true,
        },
      },
    },

  },

  {
    timestamps: true,
  }
);

/* =========================================================
   AUDIT
========================================================= */

const AuditSchema = new Schema(
  {

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },

    orgId: {
      type: Schema.Types.ObjectId,
      ref: 'Org',
      index: true,
    },

    url: String,

    score: {
      type: Number,
      default: 0,
    },

    seoScore: Number,

    performanceScore: Number,

    accessibilityScore: Number,

    issues: [
      {
        type: Object,
      }
    ],

    recommendations: [
      {
        type: Object,
      }
    ],

    metadata: {
      type: Object,
      default: {},
    },

  },

  {
    timestamps: true,
  }
);

/* =========================================================
   MONITOR
========================================================= */

const MonitorSchema = new Schema(
  {

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },

    orgId: {
      type: Schema.Types.ObjectId,
      ref: 'Org',
      index: true,
    },

    url: String,

    label: String,

    type: {
      type: String,
      default: 'http',
    },

    active: {
      type: Boolean,
      default: true,
    },

    lastStatus: {
      type: String,
      default: 'unknown',
    },

    lastStatusCode: Number,

    lastResponseTime: Number,

    lastCheckedAt: Date,

    incidents: [
      {
        startedAt: Date,
        endedAt: Date,
        reason: String,
      }
    ],

  },

  {
    timestamps: true,
  }
);

/* =========================================================
   REPORT
========================================================= */

const ReportSchema = new Schema(
  {

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },

    orgId: {
      type: Schema.Types.ObjectId,
      ref: 'Org',
      index: true,
    },

    type: String,

    title: String,

    status: {
      type: String,
      default: 'completed',
    },

    fileUrl: String,

    metadata: {
      type: Object,
      default: {},
    },

  },

  {
    timestamps: true,
  }
);

/* =========================================================
   MISSIONS
========================================================= */

const MissionSchema = new Schema(
  {

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },

    orgId: {
      type: Schema.Types.ObjectId,
      ref: 'Org',
    },

    title: String,

    description: String,

    category: String,

    sourceType: {
      type: String,
      default: 'manual',
    },

    priority: {
      type: String,
      default: 'medium',
    },

    status: {
      type: String,
      default: 'todo',
    },

    completedAt: Date,

    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },

    metadata: {
      type: Object,
      default: {},
    },

  },

  {
    timestamps: true,
  }
);

/* =========================================================
   TEAM THREAD
========================================================= */

const TeamThreadSchema = new Schema(
  {

    orgId: {
      type: Schema.Types.ObjectId,
      ref: 'Org',
    },

    channel: String,

    title: String,

    lastActivityAt: Date,

  },

  {
    timestamps: true,
  }
);

/* =========================================================
   TEAM MESSAGE
========================================================= */

const TeamMessageSchema = new Schema(
  {

    orgId: {
      type: Schema.Types.ObjectId,
      ref: 'Org',
    },

    threadId: {
      type: Schema.Types.ObjectId,
      ref: 'TeamThread',
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },

    content: String,

    attachments: [
      {
        type: Object,
      }
    ],

  },

  {
    timestamps: true,
  }
);

/* =========================================================
   ACTIVITY
========================================================= */

const ActivitySchema = new Schema(
  {

    orgId: {
      type: Schema.Types.ObjectId,
      ref: 'Org',
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },

    type: String,

    title: String,

    description: String,

    metadata: {
      type: Object,
      default: {},
    },

  },

  {
    timestamps: true,
  }
);

/* =========================================================
   MODELS
========================================================= */

const User =
  model('User', UserSchema);

const Org =
  model('Org', OrgSchema);

const Audit =
  model('Audit', AuditSchema);

const Monitor =
  model('Monitor', MonitorSchema);

const Report =
  model('Report', ReportSchema);

const Mission =
  model('Mission', MissionSchema);

const TeamThread =
  model(
    'TeamThread',
    TeamThreadSchema
  );

const TeamMessage =
  model(
    'TeamMessage',
    TeamMessageSchema
  );

const Activity =
  model(
    'Activity',
    ActivitySchema
  );

/* =========================================================
   MONGO CONNECT
========================================================= */

mongoose
  .connect(MONGO_URI)
  .then(() => {

    console.log(
      '✅ MongoDB connected'
    );

  })
  .catch(err => {

    console.error(
      '❌ MongoDB error:',
      err
    );

    process.exit(1);
  });
/* =========================================================
   AUTH MIDDLEWARE
========================================================= */

async function auth(
  req,
  res,
  next
) {

  try {

    let token = null;

    const authHeader =
      req.headers.authorization;

    if (
      authHeader?.startsWith(
        'Bearer '
      )
    ) {

      token =
        authHeader.split(' ')[1];
    }

    if (
      !token &&
      req.cookies?.fp_token
    ) {

      token =
        req.cookies.fp_token;
    }

    if (!token) {

      return res.status(401).json({
        error: 'Unauthorized',
      });
    }

    const decoded =
      jwt.verify(
        token,
        JWT_SECRET
      );

    const user =
      await User.findById(
        decoded.id
      );

    if (!user) {

      return res.status(401).json({
        error: 'User not found',
      });
    }

    if (user.accessBlocked) {

      return res.status(403).json({
        error:
          'Subscription blocked',
      });
    }

    req.user = user;

    next();

  } catch (err) {

    return res.status(401).json({
      error: 'Invalid token',
    });
  }
}

/* =========================================================
   ADMIN MIDDLEWARE
========================================================= */

function adminOnly(
  req,
  res,
  next
) {

  if (
    req.user?.role !== 'owner' &&
    req.user?.role !== 'admin'
  ) {

    return res.status(403).json({
      error: 'Forbidden',
    });
  }

  next();
}

/* =========================================================
   QUOTAS
========================================================= */

function getPlanLimits(
  user
) {

  const base =
    PLAN_LIMITS[
      user.plan
    ] ||
    PLAN_LIMITS.standard;

  return {

    audit:
      base.audit +
      (
        user.addons
          ?.auditsPack200 || 0
      ) * 200,

    monitor:
      base.monitor +
      (
        user.addons
          ?.monitorsPack50 || 0
      ) * 50,

    pdf:
      base.pdf +
      (
        user.addons
          ?.pdfPack200 || 0
      ) * 200,

    exports:
      base.exports +
      (
        user.addons
          ?.exportsPack1000 || 0
      ) * 1000,

    aiCredits:
      base.aiCredits,

    seats:
      base.seats +
      (
        user.addons
          ?.extraSeats || 0
      ),
  };
}

function ensureQuota(
  key
) {

  return async (
    req,
    res,
    next
  ) => {

    try {

      const user =
        req.user;

      const limits =
        getPlanLimits(user);

      const usage =
        user.usage?.[key];

      if (
        !usage
      ) {

        return next();
      }

      if (
        usage.used >=
        limits[key]
      ) {

        return res.status(403).json({
          error:
            `Quota exceeded (${key})`,
        });
      }

      next();

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error: 'Quota error',
      });
    }
  };
}

/* =========================================================
   ACTIVITY ENGINE
========================================================= */

async function pushActivity({

  orgId,
  userId,
  type,
  title,
  description='',
  metadata={},

}) {

  try {

    const activity =
      await Activity.create({

        orgId,
        userId,
        type,
        title,
        description,
        metadata,

      });

    if (userId) {

      sseNotify(
        String(userId),
        {
          type: 'activity',
          activity,
        }
      );
    }

    return activity;

  } catch (err) {

    console.error(
      '[FP] activity error',
      err
    );
  }
}

/* =========================================================
   EMAIL
========================================================= */

async function sendEmail({

  to,
  subject,
  html,

}) {

  try {

    if (!resend) {

      console.log(
        '[FP] resend disabled'
      );

      return;
    }

    await resend.emails.send({

      from: FROM_EMAIL,

      to,

      subject,

      html,

    });

  } catch (err) {

    console.error(
      '[FP] email error:',
      err.message
    );
  }
}

/* =========================================================
   AUTH ROUTES
========================================================= */

app.post(
  '/api/auth/register',

  async (req, res) => {

    try {

      const {

        email,
        password,
        firstName,
        companyName='',
        website='',

      } = req.body || {};

      const cleanEmail =
        normalizeEmail(email);

      if (
        !cleanEmail ||
        !password ||
        !firstName
      ) {

        return res.status(400).json({
          error:
            'Missing fields',
        });
      }

      const existing =
        await User.findOne({
          email: cleanEmail,
        });

      if (existing) {

        return res.status(409).json({
          error:
            'Email already used',
        });
      }

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      const org =
        await Org.create({

          name:
            companyName ||
            firstName,

          slug:
            slugify(
              companyName ||
              firstName
            ) +
            '-' +
            Math.floor(
              Math.random() * 9999
            ),

        });

      const user =
        await User.create({

          email:
            cleanEmail,

          passwordHash,

          firstName,

          companyName,

          website,

          role:
            'owner',

          plan:
            'standard',

          subscriptionStatus:
            'trial',

          trialEndsAt:
            new Date(
              Date.now() +
              1000 *
              60 *
              60 *
              24 *
              14
            ),

          orgId:
            org._id,

        });

      org.ownerUserId =
        user._id;

      await org.save();

      const token =
        signToken(user);

      res.cookie(
        'fp_token',
        token,
        {

          httpOnly: true,

          secure:
            IS_PROD,

          sameSite:
            IS_PROD
              ? 'none'
              : 'lax',

          maxAge:
            1000 *
            60 *
            60 *
            24 *
            30,
        }
      );

      await pushActivity({

        orgId:
          org._id,

        userId:
          user._id,

        type:
          'account_created',

        title:
          'Compte créé',

        description:
          `${firstName} a créé un workspace FlowPoint`,
      });

      sendEmail({

        to:
          cleanEmail,

        subject:
          'Bienvenue sur FlowPoint',

        html:
          `
          <div style="font-family:Inter,sans-serif;padding:30px">
            <h1>Bienvenue ${firstName}</h1>
            <p>
              Votre workspace FlowPoint est prêt.
            </p>
          </div>
          `,
      });

      return res.json({

        ok: true,

        token,

        user:
          userPayload(user),

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          'Register failed',
      });
    }
  }
);

/* =========================================================
   LOGIN
========================================================= */

app.post(
  '/api/auth/login',

  async (req, res) => {

    try {

      const {
        email,
        password,
      } = req.body || {};

      const user =
        await User.findOne({

          email:
            normalizeEmail(email),

        });

      if (!user) {

        return res.status(401).json({
          error:
            'Invalid credentials',
        });
      }

      const valid =
        await bcrypt.compare(
          password,
          user.passwordHash
        );

      if (!valid) {

        return res.status(401).json({
          error:
            'Invalid credentials',
        });
      }

      user.lastLoginAt =
        new Date();

      await user.save();

      const token =
        signToken(user);

      res.cookie(
        'fp_token',
        token,
        {

          httpOnly: true,

          secure:
            IS_PROD,

          sameSite:
            IS_PROD
              ? 'none'
              : 'lax',

          maxAge:
            1000 *
            60 *
            60 *
            24 *
            30,
        }
      );

      await pushActivity({

        orgId:
          user.orgId,

        userId:
          user._id,

        type:
          'login',

        title:
          'Connexion',

        description:
          `${user.firstName} s’est connecté`,
      });

      return res.json({

        ok: true,

        token,

        user:
          userPayload(user),

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          'Login failed',
      });
    }
  }
);

/* =========================================================
   LOGOUT
========================================================= */

app.post(
  '/api/auth/logout',

  async (req, res) => {

    res.clearCookie(
      'fp_token'
    );

    return res.json({
      ok: true,
    });
  }
);

/* =========================================================
   AUTH ME
========================================================= */

app.get(
  '/api/auth/me',

  auth,

  async (req, res) => {

    return res.json({

      ok: true,

      user:
        userPayload(
          req.user
        ),

      limits:
        getPlanLimits(
          req.user
        ),

    });
  }
);

/* =========================================================
   SSE EVENTS
========================================================= */

app.get(
  '/api/events',

  auth,

  (req, res) => {

    res.setHeader(
      'Content-Type',
      'text/event-stream'
    );

    res.setHeader(
      'Cache-Control',
      'no-cache'
    );

    res.setHeader(
      'Connection',
      'keep-alive'
    );

    res.flushHeaders();

    const userId =
      String(
        req.user._id
      );

    const existing =
      sseClients.get(
        userId
      ) || [];

    existing.push(res);

    sseClients.set(
      userId,
      existing
    );

    res.write(
      `data: ${JSON.stringify({
        type: 'connected',
      })}\n\n`
    );

    req.on(
      'close',
      () => {

        const current =
          sseClients.get(
            userId
          ) || [];

        sseClients.set(
          userId,
          current.filter(
            x => x !== res
          )
        );
      }
    );
  }
);
/* =========================================================
   OVERVIEW / WAR ROOM
========================================================= */

app.get(
  '/api/overview',

  auth,

  async (req, res) => {

    try {

      const user =
        req.user;

      const orgId =
        user.orgId;

      const [
        audits,
        monitors,
        missions,
        reports,
        activities,
      ] = await Promise.all([

        Audit.find({
          orgId,
        })
        .sort({
          createdAt: -1,
        })
        .limit(12),

        Monitor.find({
          orgId,
        }),

        Mission.find({
          orgId,
        })
        .sort({
          createdAt: -1,
        })
        .limit(20),

        Report.find({
          orgId,
        })
        .sort({
          createdAt: -1,
        })
        .limit(10),

        Activity.find({
          orgId,
        })
        .sort({
          createdAt: -1,
        })
        .limit(15),

      ]);

      const latestAudit =
        audits[0];

      const onlineCount =
        monitors.filter(
          m =>
            m.lastStatus === 'up'
        ).length;

      const criticalMissions =
        missions.filter(
          m =>
            m.priority === 'critical' &&
            m.status !== 'done'
        ).length;

      const completedMissions =
        missions.filter(
          m =>
            m.status === 'done'
        ).length;

      const missionProgress =
        missions.length
          ? Math.round(
              (
                completedMissions /
                missions.length
              ) * 100
            )
          : 0;

      const seoScore =
        latestAudit?.seoScore || 0;

      const performanceScore =
        latestAudit?.performanceScore || 0;

      const accessibilityScore =
        latestAudit?.accessibilityScore || 0;

      let executiveSummary =
        'Le système est stable mais plusieurs opportunités de croissance restent sous-exploitées.';

      if (
        seoScore < 60
      ) {

        executiveSummary =
          'Le SEO technique limite actuellement la visibilité du site.';
      }

      if (
        onlineCount <
        monitors.length
      ) {

        executiveSummary =
          'Des incidents uptime impactent certaines ressources critiques.';
      }

      const quickWins = [

        {
          title:
            'Optimiser les pages locales',
          impact:
            '+ visibilité Google Maps',
        },

        {
          title:
            'Améliorer les performances mobile',
          impact:
            '+ conversion',
        },

        {
          title:
            'Créer plus de landing pages',
          impact:
            '+ trafic organique',
        },

      ];

      return res.json({

        ok: true,

        overview: {

          healthScore:
            Math.round(
              (
                seoScore +
                performanceScore +
                accessibilityScore
              ) / 3
            ),

          seoScore,

          performanceScore,

          accessibilityScore,

          monitorsTotal:
            monitors.length,

          monitorsOnline:
            onlineCount,

          reportsCount:
            reports.length,

          missionProgress,

          criticalMissions,

          executiveSummary,

          quickWins,

        },

        audits,

        monitors,

        missions,

        reports,

        activities,

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          'Overview failed',
      });
    }
  }
);

/* =========================================================
   AUDITS
========================================================= */

app.get(
  '/api/audits',

  auth,

  async (req, res) => {

    try {

      const audits =
        await Audit.find({

          orgId:
            req.user.orgId,

        })
        .sort({
          createdAt: -1,
        });

      return res.json({
        ok: true,
        audits,
      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          'Audits failed',
      });
    }
  }
);

app.post(
  '/api/audits',

  auth,
  ensureQuota('audit'),

  async (req, res) => {

    try {

      const {
        url,
      } = req.body || {};

      if (!url) {

        return res.status(400).json({
          error:
            'URL required',
        });
      }

      const score =
        Math.floor(
          70 + Math.random() * 25
        );

      const audit =
        await Audit.create({

          userId:
            req.user._id,

          orgId:
            req.user.orgId,

          url,

          score,

          seoScore:
            Math.floor(
              60 + Math.random() * 30
            ),

          performanceScore:
            Math.floor(
              55 + Math.random() * 40
            ),

          accessibilityScore:
            Math.floor(
              70 + Math.random() * 20
            ),

          issues: [

            {
              type:
                'seo',

              title:
                'Meta descriptions manquantes',
            },

            {
              type:
                'performance',

              title:
                'Images trop lourdes',
            },

          ],

          recommendations: [

            {
              title:
                'Optimiser les balises H1',
            },

            {
              title:
                'Améliorer le cache',
            },

          ],

        });

      req.user.usage.audit.used += 1;

      await req.user.save();

      await pushActivity({

        orgId:
          req.user.orgId,

        userId:
          req.user._id,

        type:
          'audit_created',

        title:
          'Nouvel audit',

        description:
          `Audit généré pour ${url}`,
      });

      return res.json({

        ok: true,

        audit,

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          'Audit failed',
      });
    }
  }
);

/* =========================================================
   MONITORS
========================================================= */

app.get(
  '/api/monitors',

  auth,

  async (req, res) => {

    try {

      const monitors =
        await Monitor.find({

          orgId:
            req.user.orgId,

        })
        .sort({
          createdAt: -1,
        });

      return res.json({
        ok: true,
        monitors,
      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          'Monitors failed',
      });
    }
  }
);

app.post(
  '/api/monitors',

  auth,
  ensureQuota('monitor'),

  async (req, res) => {

    try {

      const {
        url,
        label='',
      } = req.body || {};

      if (!url) {

        return res.status(400).json({
          error:
            'URL required',
        });
      }

      const monitor =
        await Monitor.create({

          userId:
            req.user._id,

          orgId:
            req.user.orgId,

          url,

          label,

          lastStatus:
            'up',

          lastStatusCode:
            200,

          lastResponseTime:
            Math.floor(
              100 + Math.random() * 500
            ),

          lastCheckedAt:
            new Date(),

        });

      req.user.usage.monitor.used += 1;

      await req.user.save();

      await pushActivity({

        orgId:
          req.user.orgId,

        userId:
          req.user._id,

        type:
          'monitor_created',

        title:
          'Nouveau monitor',

        description:
          `${url} est maintenant monitoré`,
      });

      return res.json({

        ok: true,

        monitor,

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          'Monitor failed',
      });
    }
  }
);

/* =========================================================
   MISSIONS
========================================================= */

app.get(
  '/api/missions',

  auth,

  async (req, res) => {

    try {

      const missions =
        await Mission.find({

          orgId:
            req.user.orgId,

        })
        .sort({
          createdAt: -1,
        });

      return res.json({

        ok: true,

        missions,

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          'Mission fetch failed',
      });
    }
  }
);

app.post(
  '/api/missions',

  auth,

  async (req, res) => {

    try {

      const {
        title,
        description='',
        category='growth',
        priority='medium',
      } = req.body || {};

      if (!title) {

        return res.status(400).json({
          error:
            'Title required',
        });
      }

      const mission =
        await Mission.create({

          userId:
            req.user._id,

          orgId:
            req.user.orgId,

          title,

          description,

          category,

          priority,

        });

      await pushActivity({

        orgId:
          req.user.orgId,

        userId:
          req.user._id,

        type:
          'mission_created',

        title:
          'Nouvelle mission',

        description:
          title,
      });

      return res.json({

        ok: true,

        mission,

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          'Mission create failed',
      });
    }
  }
);

app.patch(
  '/api/missions/:id',

  auth,

  async (req, res) => {

    try {

      const mission =
        await Mission.findOne({

          _id:
            req.params.id,

          orgId:
            req.user.orgId,

        });

      if (!mission) {

        return res.status(404).json({
          error:
            'Mission not found',
        });
      }

      Object.assign(
        mission,
        req.body || {}
      );

      if (
        mission.status === 'done' &&
        !mission.completedAt
      ) {

        mission.completedAt =
          new Date();
      }

      await mission.save();

      return res.json({

        ok: true,

        mission,

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          'Mission update failed',
      });
    }
  }
);
/* =========================================================
   REPORTS
========================================================= */

app.get(
  '/api/reports',

  auth,

  async (req, res) => {

    try {

      const reports =
        await Report.find({

          orgId:
            req.user.orgId,

        })
        .sort({
          createdAt: -1,
        });

      return res.json({

        ok: true,

        reports,

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          'Reports failed',
      });
    }
  }
);

app.post(
  '/api/reports',

  auth,
  ensureQuota('pdf'),

  async (req, res) => {

    try {

      const {
        title='FlowPoint Report',
        type='executive',
      } = req.body || {};

      const report =
        await Report.create({

          userId:
            req.user._id,

          orgId:
            req.user.orgId,

          title,

          type,

          status:
            'completed',

          fileUrl:
            `/exports/report-${Date.now()}.pdf`,

        });

      req.user.usage.pdf.used += 1;

      await req.user.save();

      await pushActivity({

        orgId:
          req.user.orgId,

        userId:
          req.user._id,

        type:
          'report_generated',

        title:
          'Rapport généré',

        description:
          title,
      });

      return res.json({

        ok: true,

        report,

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          'Report failed',
      });
    }
  }
);

/* =========================================================
   TEAM THREADS
========================================================= */

app.get(
  '/api/team/threads',

  auth,

  async (req, res) => {

    try {

      const threads =
        await TeamThread.find({

          orgId:
            req.user.orgId,

        })
        .sort({
          updatedAt: -1,
        });

      return res.json({

        ok: true,

        threads,

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          'Threads failed',
      });
    }
  }
);

app.post(
  '/api/team/threads',

  auth,

  async (req, res) => {

    try {

      const {
        title,
        channel='general',
      } = req.body || {};

      if (!title) {

        return res.status(400).json({
          error:
            'Title required',
        });
      }

      const thread =
        await TeamThread.create({

          orgId:
            req.user.orgId,

          title,

          channel,

          lastActivityAt:
            new Date(),

        });

      await pushActivity({

        orgId:
          req.user.orgId,

        userId:
          req.user._id,

        type:
          'thread_created',

        title:
          'Nouveau thread',

        description:
          title,
      });

      return res.json({

        ok: true,

        thread,

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          'Thread create failed',
      });
    }
  }
);

/* =========================================================
   TEAM MESSAGES
========================================================= */

app.get(
  '/api/team/messages/:threadId',

  auth,

  async (req, res) => {

    try {

      const messages =
        await TeamMessage.find({

          threadId:
            req.params.threadId,

          orgId:
            req.user.orgId,

        })
        .sort({
          createdAt: 1,
        });

      return res.json({

        ok: true,

        messages,

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          'Messages failed',
      });
    }
  }
);

app.post(
  '/api/team/messages',

  auth,

  async (req, res) => {

    try {

      const {
        threadId,
        content='',
      } = req.body || {};

      if (
        !threadId ||
        !content
      ) {

        return res.status(400).json({
          error:
            'Invalid message',
        });
      }

      const message =
        await TeamMessage.create({

          orgId:
            req.user.orgId,

          threadId,

          userId:
            req.user._id,

          content,

        });

      await TeamThread.updateOne(

        {
          _id:
            threadId,
        },

        {
          $set: {
            lastActivityAt:
              new Date(),
          },
        }
      );

      sseNotify(
        String(
          req.user._id
        ),
        {
          type:
            'team_message',
          message,
        }
      );

      return res.json({

        ok: true,

        message,

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          'Message failed',
      });
    }
  }
);

/* =========================================================
   ACTIVITY FEED
========================================================= */

app.get(
  '/api/activity',

  auth,

  async (req, res) => {

    try {

      const activities =
        await Activity.find({

          orgId:
            req.user.orgId,

        })
        .sort({
          createdAt: -1,
        })
        .limit(100);

      return res.json({

        ok: true,

        activities,

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          'Activity failed',
      });
    }
  }
);

/* =========================================================
   AI
========================================================= */

app.post(
  '/api/ai/chat',

  auth,

  async (req, res) => {

    try {

      const {
        message='',
      } = req.body || {};

      if (!message) {

        return res.status(400).json({
          error:
            'Message required',
        });
      }

      if (
        req.user.aiCredits.used >=
        req.user.aiCredits.limit
      ) {

        return res.status(403).json({
          error:
            'AI credits exhausted',
        });
      }

      req.user.aiCredits.used += 1;

      await req.user.save();

      let response =
        `
        Voici une analyse stratégique FlowPoint concernant :
        "${message}"

        • Opportunité SEO détectée
        • Optimisation conversion recommandée
        • Monitoring conseillé
        • Rapport exécutif suggéré
        `;

      if (
        OPENAI_KEY
      ) {

        // Future OpenAI integration
      }

      await pushActivity({

        orgId:
          req.user.orgId,

        userId:
          req.user._id,

        type:
          'ai_request',

        title:
          'Assistant IA utilisé',

        description:
          message.slice(0, 80),
      });

      return res.json({

        ok: true,

        response,

        remainingCredits:
          req.user.aiCredits.limit -
          req.user.aiCredits.used,

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          'AI failed',
      });
    }
  }
);

/* =========================================================
   BILLING
========================================================= */

app.get(
  '/api/billing',

  auth,

  async (req, res) => {

    try {

      return res.json({

        ok: true,

        billing: {

          plan:
            req.user.plan,

          subscriptionStatus:
            req.user.subscriptionStatus,

          usage:
            req.user.usage,

          addons:
            req.user.addons,

          limits:
            getPlanLimits(
              req.user
            ),

          stripePublishableKey:
            STRIPE_PUBLISHABLE_KEY,

        },

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          'Billing failed',
      });
    }
  }
);

app.post(
  '/api/billing/create-checkout',

  auth,

  async (req, res) => {

    try {

      if (!stripe) {

        return res.status(400).json({
          error:
            'Stripe disabled',
        });
      }

      const {
        plan='pro',
      } = req.body || {};

      const priceId =
        STRIPE_PRICES[
          plan
        ];

      if (!priceId) {

        return res.status(400).json({
          error:
            'Invalid plan',
        });
      }

      let customerId =
        req.user.stripeCustomerId;

      if (!customerId) {

        const customer =
          await stripe.customers.create({

            email:
              req.user.email,

            name:
              req.user.firstName,

          });

        customerId =
          customer.id;

        req.user.stripeCustomerId =
          customerId;

        await req.user.save();
      }

      const session =
        await stripe.checkout.sessions.create({

          mode:
            'subscription',

          customer:
            customerId,

          payment_method_types:
            ['card'],

          line_items: [

            {
              price:
                priceId,

              quantity: 1,
            },

          ],

          allow_promotion_codes:
            true,

          success_url:
            `${FRONTEND_URL}/dashboard.html#billing?success=1`,

          cancel_url:
            `${FRONTEND_URL}/dashboard.html#billing?cancel=1`,

          subscription_data: {

            trial_period_days:
              14,

          },

          metadata: {

            userId:
              String(
                req.user._id
              ),

            plan,

          },

        });

      return res.json({

        ok: true,

        url:
          session.url,

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          'Checkout failed',
      });
    }
  }
);
/* =========================================================
   STRIPE WEBHOOK PROCESSOR
========================================================= */

async function processStripeEvent(
  event
) {

  try {

    switch (event.type) {

      /* ========================================= */

      case
      'checkout.session.completed': {

        const session =
          event.data.object;

        const userId =
          session.metadata?.userId;

        const plan =
          session.metadata?.plan;

        if (!userId) {
          break;
        }

        const user =
          await User.findById(
            userId
          );

        if (!user) {
          break;
        }

        user.plan =
          plan || 'pro';

        user.subscriptionStatus =
          'active';

        user.accessBlocked =
          false;

        if (
          session.subscription
        ) {

          user.stripeSubscriptionId =
            session.subscription;
        }

        const limits =
          getPlanLimits(user);

        user.usage.audit.limit =
          limits.audit;

        user.usage.monitor.limit =
          limits.monitor;

        user.usage.pdf.limit =
          limits.pdf;

        user.usage.exports.limit =
          limits.exports;

        user.aiCredits.limit =
          limits.aiCredits;

        await user.save();

        await pushActivity({

          orgId:
            user.orgId,

          userId:
            user._id,

          type:
            'subscription_activated',

          title:
            'Abonnement activé',

          description:
            `Plan ${user.plan} activé`,
        });

        break;
      }

      /* ========================================= */

      case
      'invoice.payment_failed': {

        const invoice =
          event.data.object;

        const customerId =
          invoice.customer;

        const user =
          await User.findOne({

            stripeCustomerId:
              customerId,

          });

        if (!user) {
          break;
        }

        user.subscriptionStatus =
          'past_due';

        await user.save();

        sseNotify(
          String(user._id),
          {
            type:
              'billing_issue',
          }
        );

        break;
      }

      /* ========================================= */

      case
      'customer.subscription.deleted': {

        const subscription =
          event.data.object;

        const user =
          await User.findOne({

            stripeSubscriptionId:
              subscription.id,

          });

        if (!user) {
          break;
        }

        user.subscriptionStatus =
          'canceled';

        user.accessBlocked =
          true;

        await user.save();

        break;
      }

      /* ========================================= */

      case
      'invoice.payment_succeeded': {

        const invoice =
          event.data.object;

        const customerId =
          invoice.customer;

        const user =
          await User.findOne({

            stripeCustomerId:
              customerId,

          });

        if (!user) {
          break;
        }

        user.subscriptionStatus =
          'active';

        user.accessBlocked =
          false;

        await user.save();

        break;
      }
    }

  } catch (err) {

    console.error(
      '[FP] stripe processor error:',
      err
    );
  }
}

/* =========================================================
   STRIPE EVENT LOOP
========================================================= */

setInterval(
  async () => {

    try {

      global.__FP_STRIPE_QUEUE =
        global.__FP_STRIPE_QUEUE || [];

      while (
        global.__FP_STRIPE_QUEUE.length
      ) {

        const event =
          global.__FP_STRIPE_QUEUE.shift();

        await processStripeEvent(
          event
        );
      }

    } catch (err) {

      console.error(
        '[FP] stripe queue error',
        err
      );
    }

  },

  3000
);

/* =========================================================
   MONITOR ENGINE
========================================================= */

async function runMonitorCheck(
  monitor
) {

  try {

    const isUp =
      Math.random() > 0.08;

    const responseTime =
      Math.floor(
        80 + Math.random() * 600
      );

    monitor.lastCheckedAt =
      new Date();

    monitor.lastResponseTime =
      responseTime;

    monitor.lastStatusCode =
      isUp ? 200 : 500;

    const previous =
      monitor.lastStatus;

    monitor.lastStatus =
      isUp ? 'up' : 'down';

    if (
      previous === 'up' &&
      !isUp
    ) {

      monitor.incidents.push({

        startedAt:
          new Date(),

        reason:
          'Server unreachable',
      });

      await pushActivity({

        orgId:
          monitor.orgId,

        type:
          'monitor_down',

        title:
          'Monitor DOWN',

        description:
          monitor.url,
      });
    }

    if (
      previous === 'down' &&
      isUp
    ) {

      const incident =
        monitor.incidents.find(
          x => !x.endedAt
        );

      if (incident) {

        incident.endedAt =
          new Date();
      }

      await pushActivity({

        orgId:
          monitor.orgId,

        type:
          'monitor_up',

        title:
          'Monitor UP',

        description:
          monitor.url,
      });
    }

    await monitor.save();

  } catch (err) {

    console.error(
      '[FP] monitor check error',
      err
    );
  }
}

/* =========================================================
   MONITOR CRON
========================================================= */

cron.schedule(
  '*/5 * * * *',

  async () => {

    try {

      console.log(
        '[FP] monitor cron running'
      );

      const monitors =
        await Monitor.find({

          active: true,

        }).limit(300);

      for (const monitor of monitors) {

        await runMonitorCheck(
          monitor
        );
      }

    } catch (err) {

      console.error(
        '[FP] monitor cron failed',
        err
      );
    }
  }
);

/* =========================================================
   USAGE RESET MONTHLY
========================================================= */

cron.schedule(
  '0 0 1 * *',

  async () => {

    try {

      console.log(
        '[FP] monthly usage reset'
      );

      const users =
        await User.find({});

      for (const user of users) {

        user.usage.audit.used = 0;
        user.usage.monitor.used = 0;
        user.usage.pdf.used = 0;
        user.usage.exports.used = 0;

        user.aiCredits.used = 0;

        const limits =
          getPlanLimits(user);

        user.usage.audit.limit =
          limits.audit;

        user.usage.monitor.limit =
          limits.monitor;

        user.usage.pdf.limit =
          limits.pdf;

        user.usage.exports.limit =
          limits.exports;

        user.aiCredits.limit =
          limits.aiCredits;

        await user.save();
      }

    } catch (err) {

      console.error(
        '[FP] usage reset failed',
        err
      );
    }
  }
);

/* =========================================================
   STATIC FRONTEND
========================================================= */

const PUBLIC_DIR =
  path.join(
    __dirname,
    'public'
  );

app.use(
  express.static(
    PUBLIC_DIR
  )
);

/* =========================================================
   HEALTH
========================================================= */

app.get(
  '/api/health',

  async (req, res) => {

    return res.json({

      ok: true,

      uptime:
        process.uptime(),

      mongo:
        mongoose.connection.readyState === 1,

      env:
        NODE_ENV,

      time:
        new Date(),

    });
  }
);

/* =========================================================
   ADMIN STATS
========================================================= */

app.get(
  '/api/admin/stats',

  async (req, res) => {

    try {

      if (
        req.headers[
          'x-admin-key'
        ] !== ADMIN_KEY
      ) {

        return res.status(403).json({
          error:
            'Forbidden',
        });
      }

      const [
        users,
        audits,
        monitors,
        reports,
      ] = await Promise.all([

        User.countDocuments(),

        Audit.countDocuments(),

        Monitor.countDocuments(),

        Report.countDocuments(),

      ]);

      return res.json({

        ok: true,

        stats: {

          users,
          audits,
          monitors,
          reports,

        },

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          'Admin stats failed',
      });
    }
  }
);

/* =========================================================
   FRONTEND FALLBACK
========================================================= */

app.get(
  '*',

  (req, res) => {

    res.sendFile(
      path.join(
        PUBLIC_DIR,
        'index.html'
      )
    );
  }
);

/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,

  () => {

    console.log(
      `🚀 FlowPoint backend running on ${PORT}`
    );

    console.log(
      `🌍 ENV: ${NODE_ENV}`
    );

    console.log(
      `💳 Stripe: ${
        stripe
          ? 'enabled'
          : 'disabled'
      }`
    );

    console.log(
      `📨 Resend: ${
        resend
          ? 'enabled'
          : 'disabled'
      }`
    );
  }
);
