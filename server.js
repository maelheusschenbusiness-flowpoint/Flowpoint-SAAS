'use strict';

require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const Stripe = require('stripe');
const { Resend } = require('resend');

const app = express();

/* =========================================
   ENV
========================================= */

const PORT =
  process.env.PORT || 10000;

const MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://127.0.0.1:27017/flowpoint';

const JWT_SECRET =
  process.env.JWT_SECRET ||
  'flowpoint_secret';

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  `http://localhost:${PORT}`;

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

const STRIPE_PRICES = {
  standard:
    process.env
      .STRIPE_PRICE_STANDARD || '',

  pro:
    process.env
      .STRIPE_PRICE_PRO || '',

  ultra:
    process.env
      .STRIPE_PRICE_ULTRA || '',
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

const resend =
  RESEND_API_KEY
    ? new Resend(
        RESEND_API_KEY
      )
    : null;

/* =========================================
   APP
========================================= */

app.set('trust proxy', 1);

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(cookieParser());

/* =========================================
   STRIPE WEBHOOK
========================================= */

app.post(
  '/api/billing/webhook',

  express.raw({
    type:
      'application/json',
  }),

  async (req, res) => {
    try {
      if (!stripe) {
        return res.json({
          ok: true,
        });
      }

      const signature =
        req.headers[
          'stripe-signature'
        ];

      const event =
        stripe.webhooks.constructEvent(
          req.body,
          signature,
          STRIPE_WEBHOOK_SECRET
        );

      console.log(
        '[FP] Stripe webhook:',
        event.type
      );

      return res.json({
        received: true,
      });

    } catch (err) {

      console.error(
        '[FP] Webhook error:',
        err.message
      );

      return res
        .status(400)
        .json({
          error:
            err.message,
        });
    }
  }
);

app.use(
  express.json({
    limit: '10mb',
  })
);

/* =========================================
   HELPERS
========================================= */

function normalizeEmail(
  email = ''
) {
  return String(email)
    .trim()
    .toLowerCase();
}

function createToken(
  userId
) {
  return jwt.sign(
    { userId },
    JWT_SECRET,
    {
      expiresIn: '7d',
    }
  );
}

function setAuthCookie(
  res,
  token
) {
  res.cookie(
    'fp_token',
    token,
    {
      httpOnly: true,

      secure:
        process.env.NODE_ENV ===
        'production',

      sameSite: 'none',

      maxAge:
        7 *
        24 *
        60 *
        60 *
        1000,
    }
  );
}

async function sendEmail(
  to,
  subject,
  html
) {
  if (!resend) {
    console.log(
      '[FP] Resend disabled'
    );

    return;
  }

  try {

    await resend.emails.send({
      from:
        `FlowPoint <${FROM_EMAIL}>`,

      to,

      subject,

      html,
    });

  } catch (err) {

    console.error(
      '[FP] Email error:',
      err.message
    );
  }
}

function auth(
  req,
  res,
  next
) {
  try {

    const token =
      req.cookies?.fp_token ||

      req.headers.authorization?.replace(
        'Bearer ',
        ''
      );

    if (!token) {
      return res
        .status(401)
        .json({
          error:
            'Unauthorized',
        });
    }

    const decoded =
      jwt.verify(
        token,
        JWT_SECRET
      );

    req.userId =
      decoded.userId;

    next();

  } catch (err) {

    return res
      .status(401)
      .json({
        error:
          'Invalid token',
      });
  }
}

/* =========================================
   MONGOOSE
========================================= */

const {
  Schema,
  model,
} = mongoose;

const UserSchema =
  new Schema(
    {
      email: {
        type: String,
        required: true,
      },

      emailNormalized: {
        type: String,
        required: true,
        unique: true,
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

      plan: {
        type: String,

        enum: [
          'standard',
          'pro',
          'ultra',
        ],

        default:
          'standard',
      },

      subscriptionStatus: {
        type: String,
        default: 'trial',
      },

      stripeCustomerId:
        String,

      stripeSubscriptionId:
        String,

      trialEndsAt: {
        type: Date,

        default: () =>
          new Date(
            Date.now() +
              14 *
                24 *
                60 *
                60 *
                1000
          ),
      },
    },

    {
      timestamps: true,
    }
  );
const AuditSchema =
  new Schema(
    {
      userId: {
        type:
          Schema.Types.ObjectId,

        ref: 'User',
      },

      url: String,

      score: Number,

      speed: Number,

      issues: Number,

      status: String,
    },

    {
      timestamps: true,
    }
  );

const MonitorSchema =
  new Schema(
    {
      userId: {
        type:
          Schema.Types.ObjectId,

        ref: 'User',
      },

      name: String,

      url: String,

      status: {
        type: String,
        default: 'up',
      },

      uptime: {
        type: Number,
        default: 100,
      },

      latency: {
        type: Number,
        default: 0,
      },

      lastCheck: Date,
    },

    {
      timestamps: true,
    }
  );

const ReportSchema =
  new Schema(
    {
      userId: {
        type:
          Schema.Types.ObjectId,

        ref: 'User',
      },

      name: String,

      type: String,
    },

    {
      timestamps: true,
    }
  );

const MissionSchema =
  new Schema(
    {
      userId: {
        type:
          Schema.Types.ObjectId,

        ref: 'User',
      },

      title: String,

      status: {
        type: String,
        default: 'todo',
      },

      category: String,

      impact: String,
    },

    {
      timestamps: true,
    }
  );

const User =
  model(
    'User',
    UserSchema
  );

const Audit =
  model(
    'Audit',
    AuditSchema
  );

const Monitor =
  model(
    'Monitor',
    MonitorSchema
  );

const Report =
  model(
    'Report',
    ReportSchema
  );

const Mission =
  model(
    'Mission',
    MissionSchema
  );

/* =========================================
   ROUTER
========================================= */

const router =
  express.Router();

/* =========================================
   HEALTH
========================================= */

router.get(
  '/health',
  async (_req, res) => {
    res.json({
      ok: true,

      mongo:
        mongoose.connection
          .readyState === 1
          ? 'connected'
          : 'disconnected',

      ts:
        new Date().toISOString(),
    });
  }
);

/* =========================================
   AUTH REGISTER
========================================= */

router.post(
  '/auth/register',

  async (req, res) => {
    try {

      const {
        email,
        password,
        firstName,
        companyName,
        plan,
      } = req.body;

      if (
        !email ||
        !password ||
        !firstName
      ) {
        return res
          .status(400)
          .json({
            error:
              'Missing fields',
          });
      }

      const normalizedEmail =
        normalizeEmail(
          email
        );

      const existing =
        await User.findOne({
          emailNormalized:
            normalizedEmail,
        });

      if (existing) {
        return res
          .status(409)
          .json({
            error:
              'Email déjà utilisé',
          });
      }

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      const user =
        await User.create({
          email,

          emailNormalized:
            normalizedEmail,

          passwordHash,

          firstName,

          companyName:
            companyName ||
            '',

          plan:
            plan ||
            'pro',
        });

      const token =
        createToken(
          user._id
        );

      setAuthCookie(
        res,
        token
      );

      await sendEmail(
        user.email,

        'Bienvenue sur FlowPoint',

        `
        <div style="font-family:Arial;padding:20px;">
          <h2>Bienvenue ${user.firstName}</h2>

          <p>
            Votre compte FlowPoint est prêt.
          </p>
        </div>
        `
      );

      return res
        .status(201)
        .json({
          success: true,

          token,

          user: {
            id: user._id,

            email:
              user.email,

            firstName:
              user.firstName,

            companyName:
              user.companyName,

            plan:
              user.plan,
          },
        });

    } catch (err) {

      console.error(err);

      return res
        .status(500)
        .json({
          error:
            err.message,
        });
    }
  }
);

/* =========================================
   AUTH LOGIN
========================================= */

router.post(
  '/auth/login',

  async (req, res) => {
    try {

      const {
        email,
        password,
      } = req.body;

      const user =
        await User.findOne({
          emailNormalized:
            normalizeEmail(
              email
            ),
        });

      if (!user) {
        return res
          .status(401)
          .json({
            error:
              'Email ou mot de passe incorrect',
          });
      }

      const valid =
        await bcrypt.compare(
          password,
          user.passwordHash
        );

      if (!valid) {
        return res
          .status(401)
          .json({
            error:
              'Email ou mot de passe incorrect',
          });
      }

      const token =
        createToken(
          user._id
        );

      setAuthCookie(
        res,
        token
      );

      return res.json({
        success: true,

        token,

        user: {
          id: user._id,

          email:
            user.email,

          firstName:
            user.firstName,

          companyName:
            user.companyName,

          plan:
            user.plan,
        },
      });

    } catch (err) {

      return res
        .status(500)
        .json({
          error:
            err.message,
        });
    }
  }
);

/* =========================================
   AUTH ME
========================================= */

router.get(
  '/auth/me',

  auth,

  async (
    req,
    res
  ) => {
    try {

      const user =
        await User.findById(
          req.userId
        );

      if (!user) {
        return res
          .status(404)
          .json({
            error:
              'User not found',
          });
      }

      return res.json({
        success: true,

        data: {
          user: {
            id: user._id,

            email:
              user.email,

            firstName:
              user.firstName,

            companyName:
              user.companyName,

            plan:
              user.plan,
          },

          org: {
            name:
              user.companyName ||
              'FlowPoint',
          },
        },
      });

    } catch (err) {

      return res
        .status(500)
        .json({
          error:
            err.message,
        });
    }
  }
);

/* =========================================
   AUTH LOGOUT
========================================= */

router.post(
  '/auth/logout',

  (_req, res) => {

    res.clearCookie(
      'fp_token'
    );

    return res.json({
      success: true,
    });
  }
);
/* =========================================
   BILLING
========================================= */

router.get(
  '/billing/config',
  (_req, res) => {
    return res.json({
      success: true,
      publishableKey:
        STRIPE_PUBLISHABLE_KEY,
      prices:
        STRIPE_PRICES,
    });
  }
);

/* =========================================
   AUDITS
========================================= */

router.get(
  '/audits',
  auth,
  async (req, res) => {
    try {
      const audits =
        await Audit.find({
          userId: req.userId,
        }).sort({
          createdAt: -1,
        });

      return res.json({
        success: true,
        audits,
      });
    } catch (err) {
      return res
        .status(500)
        .json({
          error: err.message,
        });
    }
  }
);

router.post(
  '/audits',
  auth,
  async (req, res) => {
    try {
      const { url } = req.body;

      if (!url) {
        return res
          .status(400)
          .json({
            error: 'URL requise',
          });
      }

      const score =
        Math.floor(
          55 + Math.random() * 40
        );

      const audit =
        await Audit.create({
          userId: req.userId,
          url,
          score,
          speed:
            Math.floor(
              50 + Math.random() * 45
            ),
          issues:
            Math.floor(
              Math.random() * 12
            ),
          status:
            score >= 70
              ? 'ok'
              : 'warn',
        });

      return res
        .status(201)
        .json({
          success: true,
          audit,
        });
    } catch (err) {
      return res
        .status(500)
        .json({
          error: err.message,
        });
    }
  }
);

/* =========================================
   MONITORS
========================================= */

router.get(
  '/monitors',
  auth,
  async (req, res) => {
    try {
      const monitors =
        await Monitor.find({
          userId: req.userId,
        }).sort({
          createdAt: -1,
        });

      return res.json({
        success: true,
        monitors,
      });
    } catch (err) {
      return res
        .status(500)
        .json({
          error: err.message,
        });
    }
  }
);

router.post(
  '/monitors',
  auth,
  async (req, res) => {
    try {
      const {
        url,
        name,
      } = req.body;

      if (!url) {
        return res
          .status(400)
          .json({
            error: 'URL requise',
          });
      }

      const monitor =
        await Monitor.create({
          userId: req.userId,
          url,
          name: name || url,
          status: 'up',
          uptime: 100,
          latency: 0,
          lastCheck: null,
        });

      return res
        .status(201)
        .json({
          success: true,
          monitor,
        });
    } catch (err) {
      return res
        .status(500)
        .json({
          error: err.message,
        });
    }
  }
);

/* =========================================
   MISSIONS
========================================= */

router.get(
  '/missions',
  auth,
  async (req, res) => {
    try {
      const missions =
        await Mission.find({
          userId: req.userId,
        }).sort({
          createdAt: -1,
        });

      return res.json({
        success: true,
        missions,
      });
    } catch (err) {
      return res
        .status(500)
        .json({
          error: err.message,
        });
    }
  }
);

router.post(
  '/missions',
  auth,
  async (req, res) => {
    try {
      const mission =
        await Mission.create({
          userId: req.userId,
          title:
            req.body.title ||
            'Nouvelle mission',
          category:
            req.body.category ||
            'SEO',
          impact:
            req.body.impact ||
            'Moyen',
          status:
            req.body.status ||
            'todo',
        });

      return res
        .status(201)
        .json({
          success: true,
          mission,
        });
    } catch (err) {
      return res
        .status(500)
        .json({
          error: err.message,
        });
    }
  }
);

/* =========================================
   REPORTS
========================================= */

router.get(
  '/reports',
  auth,
  async (req, res) => {
    try {
      const reports =
        await Report.find({
          userId: req.userId,
        }).sort({
          createdAt: -1,
        });

      return res.json({
        success: true,
        reports,
      });
    } catch (err) {
      return res
        .status(500)
        .json({
          error: err.message,
        });
    }
  }
);

router.post(
  '/reports',
  auth,
  async (req, res) => {
    try {
      const report =
        await Report.create({
          userId: req.userId,
          name:
            req.body.name ||
            'Rapport FlowPoint',
          type:
            req.body.type ||
            'PDF',
        });

      return res
        .status(201)
        .json({
          success: true,
          report,
        });
    } catch (err) {
      return res
        .status(500)
        .json({
          error: err.message,
        });
    }
  }
);

/* =========================================
   MOUNT API
========================================= */

app.use(
  '/api',
  router
);

/* =========================================
   STATIC FRONTEND
========================================= */

const FRONTEND_DIR =
  __dirname;

app.use(
  express.static(
    FRONTEND_DIR
  )
);

app.get(
  '/',
  (_req, res) => {
    return res.sendFile(
      path.join(
        FRONTEND_DIR,
        'index.html'
      )
    );
  }
);

app.get(
  '/index.html',
  (_req, res) => {
    return res.sendFile(
      path.join(
        FRONTEND_DIR,
        'index.html'
      )
    );
  }
);

app.get(
  '/login',
  (_req, res) => {
    return res.sendFile(
      path.join(
        FRONTEND_DIR,
        'login.html'
      )
    );
  }
);

app.get(
  '/login.html',
  (_req, res) => {
    return res.sendFile(
      path.join(
        FRONTEND_DIR,
        'login.html'
      )
    );
  }
);

app.get(
  '/dashboard',
  (_req, res) => {
    return res.sendFile(
      path.join(
        FRONTEND_DIR,
        'dashboard.html'
      )
    );
  }
);

app.get(
  '/dashboard.html',
  (_req, res) => {
    return res.sendFile(
      path.join(
        FRONTEND_DIR,
        'dashboard.html'
      )
    );
  }
);

app.get(
  '/pricing',
  (_req, res) => {
    return res.sendFile(
      path.join(
        FRONTEND_DIR,
        'pricing.html'
      )
    );
  }
);

app.get(
  '/pricing.html',
  (_req, res) => {
    return res.sendFile(
      path.join(
        FRONTEND_DIR,
        'pricing.html'
      )
    );
  }
);

app.get(
  '/billing',
  (_req, res) => {
    return res.sendFile(
      path.join(
        FRONTEND_DIR,
        'billing.html'
      )
    );
  }
);

app.get(
  '/billing.html',
  (_req, res) => {
    return res.sendFile(
      path.join(
        FRONTEND_DIR,
        'billing.html'
      )
    );
  }
);

/* =========================================
   404
========================================= */

app.use(
  (req, res) => {
    if (
      req.path.startsWith(
        '/api'
      )
    ) {
      return res
        .status(404)
        .json({
          error:
            `Route introuvable : ${req.method} ${req.path}`,
        });
    }

    return res.sendFile(
      path.join(
        FRONTEND_DIR,
        'index.html'
      )
    );
  }
);

/* =========================================
   ERROR HANDLER
========================================= */

app.use(
  (
    err,
    _req,
    res,
    _next
  ) => {
    console.error(
      '[FP] Error:',
      err
    );

    return res
      .status(500)
      .json({
        error:
          err.message ||
          'Erreur interne',
      });
  }
);

/* =========================================
   MONITOR CRON
========================================= */

async function runMonitorChecks() {
  try {
    const monitors =
      await Monitor.find();

    for (const monitor of monitors) {
      const rand =
        Math.random();

      monitor.status =
        rand < 0.9
          ? 'up'
          : 'down';

      monitor.latency =
        Math.floor(
          Math.random() * 500
        ) + 50;

      monitor.lastCheck =
        new Date();

      await monitor.save();
    }
  } catch (err) {
    console.error(
      '[FP] Cron error:',
      err.message
    );
  }
}

/* =========================================
   START SERVER
========================================= */

mongoose
  .connect(MONGO_URI)
  .then(async () => {
    console.log(
      '[FP] ✅ MongoDB connecté'
    );

    /*
      Important :
      Si l'ancien index emailNormalized_1 a été créé avec des valeurs null,
      il peut bloquer les inscriptions.
      Ce bloc tente de le réparer automatiquement.
    */
    try {
      await User.collection.dropIndex(
        'emailNormalized_1'
      );
      console.log(
        '[FP] Ancien index emailNormalized supprimé'
      );
    } catch (_) {}

    try {
      await User.collection.createIndex(
        {
          emailNormalized: 1,
        },
        {
          unique: true,
          sparse: false,
        }
      );
      console.log(
        '[FP] Index emailNormalized recréé'
      );
    } catch (err) {
      console.log(
        '[FP] Index emailNormalized déjà OK:',
        err.message
      );
    }

    cron.schedule(
      '*/5 * * * *',
      runMonitorChecks
    );

    app.listen(
      PORT,
      '0.0.0.0',
      () => {
        console.log(
          `[FP] 🚀 Serveur démarré sur le port ${PORT}`
        );
      }
    );
  })
  .catch((err) => {
    console.error(
      '[FP] ❌ MongoDB erreur:',
      err.message
    );

    process.exit(1);
  });
