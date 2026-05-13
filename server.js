'use strict';

require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const cron = require('node-cron');
const Stripe = require('stripe');
const { Resend } = require('resend');

const app = express();

/* ──────────────────────────────────────────────
   ENV
────────────────────────────────────────────── */

const PORT = process.env.PORT || 10000;

const MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://127.0.0.1:27017/flowpoint';

const JWT_SECRET =
  process.env.JWT_SECRET ||
  'change_this_secret';

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

const STRIPE_PRICES = {
  standard: process.env.STRIPE_PRICE_STANDARD || '',
  pro: process.env.STRIPE_PRICE_PRO || '',
  ultra: process.env.STRIPE_PRICE_ULTRA || '',
};

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2024-04-10',
    })
  : null;

const resend = RESEND_API_KEY
  ? new Resend(RESEND_API_KEY)
  : null;

/* ──────────────────────────────────────────────
   APP
────────────────────────────────────────────── */

app.set('trust proxy', 1);

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(cookieParser());

/* ──────────────────────────────────────────────
   STRIPE WEBHOOK
────────────────────────────────────────────── */

app.post(
  '/api/billing/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      if (!stripe) {
        return res.json({ ok: true });
      }

      const sig = req.headers['stripe-signature'];

      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        STRIPE_WEBHOOK_SECRET
      );

      console.log('[FP] Stripe webhook:', event.type);

      return res.json({
        received: true,
      });
    } catch (err) {
      console.error('[FP] Webhook error:', err.message);

      return res.status(400).json({
        error: err.message,
      });
    }
  }
);

app.use(express.json({ limit: '10mb' }));

/* ──────────────────────────────────────────────
   MONGOOSE
────────────────────────────────────────────── */

const { Schema, model } = mongoose;

const UserSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },

    passwordHash: {
      type: String,
      required: true,
    },

    firstName: {
      type: String,
      required: true,
    },

    companyName: String,

    website: String,

    plan: {
      type: String,
      enum: ['standard', 'pro', 'ultra'],
      default: 'standard',
    },

    subscriptionStatus: {
      type: String,
      default: 'trial',
    },

    stripeCustomerId: String,

    stripeSubscriptionId: String,

    trialEndsAt: {
      type: Date,
      default: () =>
        new Date(Date.now() + 14 * 86400000),
    },
  },
  {
    timestamps: true,
  }
);

const AuditSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
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

const MonitorSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
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

const ReportSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },

    name: String,

    type: String,
  },
  {
    timestamps: true,
  }
);

const MissionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
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

const User = model('User', UserSchema);
const Audit = model('Audit', AuditSchema);
const Monitor = model('Monitor', MonitorSchema);
const Report = model('Report', ReportSchema);
const Mission = model('Mission', MissionSchema);

/* ──────────────────────────────────────────────
   HELPERS
────────────────────────────────────────────── */

function createToken(userId) {
  return jwt.sign(
    { userId },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function auth(req, res, next) {
  try {
    const token =
      req.cookies?.fp_token ||
      req.headers.authorization?.replace(
        'Bearer ',
        ''
      );

    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
      });
    }

    const decoded = jwt.verify(
      token,
      JWT_SECRET
    );

    req.userId = decoded.userId;

    next();
  } catch (err) {
    return res.status(401).json({
      error: 'Invalid token',
    });
  }
}

function simScore(url) {
  let hash = 0;

  for (let i = 0; i < url.length; i++) {
    hash =
      ((hash << 5) - hash) +
      url.charCodeAt(i);

    hash |= 0;
  }

  const score = Math.abs(hash % 100);

  return {
    score: Math.max(40, score),
    speed: Math.max(35, score - 5),
    issues: Math.floor(Math.random() * 12),
  };
}

async function sendEmail(
  to,
  subject,
  html
) {
  if (!resend) return;

  try {
    await resend.emails.send({
      from: `FlowPoint <${FROM_EMAIL}>`,
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

/* ──────────────────────────────────────────────
   API ROUTER
────────────────────────────────────────────── */

const router = express.Router();

/* ──────────────────────────────────────────────
   HEALTH
────────────────────────────────────────────── */

router.get('/health', async (_req, res) => {
  res.json({
    ok: true,
    mongo:
      mongoose.connection.readyState === 1
        ? 'connected'
        : 'disconnected',
    ts: new Date().toISOString(),
  });
});

/* ──────────────────────────────────────────────
   AUTH
────────────────────────────────────────────── */

router.post(
  '/auth/register',
  async (req, res) => {
    try {
      const {
        email,
        password,
        firstName,
        companyName,
      } = req.body;

      if (
        !email ||
        !password ||
        !firstName
      ) {
        return res.status(400).json({
          error:
            'email, password et firstName requis',
        });
      }

      const existing =
        await User.findOne({
          email: email.toLowerCase(),
        });

      if (existing) {
        return res.status(409).json({
          error: 'Email déjà utilisé',
        });
      }

      const passwordHash =
        await bcrypt.hash(password, 12);

      const user = await User.create({
        email: email.toLowerCase(),
        passwordHash,
        firstName,
        companyName,
      });

      const token = createToken(user._id);

      res.cookie('fp_token', token, {
        httpOnly: true,
        secure:
          process.env.NODE_ENV ===
          'production',
        sameSite: 'none',
        maxAge: 7 * 24 * 3600000,
      });

      await sendEmail(
        user.email,
        'Bienvenue sur FlowPoint',
        `
        <h2>Bienvenue ${user.firstName}</h2>
        <p>Votre compte est prêt.</p>
        `
      );

      res.status(201).json({
        ok: true,
        user,
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: err.message,
      });
    }
  }
);

router.post(
  '/auth/login',
  async (req, res) => {
    try {
      const { email, password } =
        req.body;

      const user =
        await User.findOne({
          email: email.toLowerCase(),
        });

      if (!user) {
        return res.status(401).json({
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
        return res.status(401).json({
          error:
            'Email ou mot de passe incorrect',
        });
      }

      const token = createToken(user._id);

      res.cookie('fp_token', token, {
        httpOnly: true,
        secure:
          process.env.NODE_ENV ===
          'production',
        sameSite: 'none',
        maxAge: 7 * 24 * 3600000,
      });

      res.json({
        ok: true,
        user,
      });
    } catch (err) {
      res.status(500).json({
        error: err.message,
      });
    }
  }
);

router.post(
  '/auth/logout',
  (_req, res) => {
    res.clearCookie('fp_token');

    res.json({
      ok: true,
    });
  }
);

router.get(
  '/auth/me',
  auth,
  async (req, res) => {
    try {
      const user =
        await User.findById(req.userId);

      if (!user) {
        return res.status(404).json({
          error: 'User not found',
        });
      }

      res.json(user);
    } catch (err) {
      res.status(500).json({
        error: err.message,
      });
    }
  }
);

/* ──────────────────────────────────────────────
   AUDITS
────────────────────────────────────────────── */

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

      res.json(audits);
    } catch (err) {
      res.status(500).json({
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
        return res.status(400).json({
          error: 'url requis',
        });
      }

      const result = simScore(url);

      const audit = await Audit.create({
        userId: req.userId,
        url,
        score: result.score,
        speed: result.speed,
        issues: result.issues,
        status:
          result.score >= 70
            ? 'ok'
            : 'warn',
      });

      res.status(201).json(audit);
    } catch (err) {
      res.status(500).json({
        error: err.message,
      });
    }
  }
);

/* ──────────────────────────────────────────────
   MONITORS
────────────────────────────────────────────── */

router.get(
  '/monitors',
  auth,
  async (req, res) => {
    try {
      const monitors =
        await Monitor.find({
          userId: req.userId,
        });

      res.json(monitors);
    } catch (err) {
      res.status(500).json({
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
      const { url, name } =
        req.body;

      const monitor =
        await Monitor.create({
          userId: req.userId,
          url,
          name: name || url,
        });

      res.status(201).json(monitor);
    } catch (err) {
      res.status(500).json({
        error: err.message,
      });
    }
  }
);

/* ──────────────────────────────────────────────
   MISSIONS
────────────────────────────────────────────── */

router.get(
  '/missions',
  auth,
  async (req, res) => {
    try {
      const missions =
        await Mission.find({
          userId: req.userId,
        });

      res.json(missions);
    } catch (err) {
      res.status(500).json({
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
          ...req.body,
        });

      res.status(201).json(mission);
    } catch (err) {
      res.status(500).json({
        error: err.message,
      });
    }
  }
);

/* ──────────────────────────────────────────────
   REPORTS
────────────────────────────────────────────── */

router.get(
  '/reports',
  auth,
  async (req, res) => {
    try {
      const reports =
        await Report.find({
          userId: req.userId,
        });

      res.json(reports);
    } catch (err) {
      res.status(500).json({
        error: err.message,
      });
    }
  }
);

/* ──────────────────────────────────────────────
   BILLING
────────────────────────────────────────────── */

router.get(
  '/billing/config',
  (_req, res) => {
    res.json({
      publishableKey:
        STRIPE_PUBLISHABLE_KEY,
      prices: STRIPE_PRICES,
    });
  }
);

router.post(
  '/billing/checkout',
  auth,
  async (req, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({
          error:
            'Stripe non configuré',
        });
      }

      const { plan } = req.body;

      const priceId =
        STRIPE_PRICES[plan];

      if (!priceId) {
        return res.status(400).json({
          error: 'Plan invalide',
        });
      }

      const user =
        await User.findById(
          req.userId
        );

      let customerId =
        user.stripeCustomerId;

      if (!customerId) {
        const customer =
          await stripe.customers.create({
            email: user.email,
            name: user.firstName,
          });

        customerId = customer.id;

        user.stripeCustomerId =
          customerId;

        await user.save();
      }

      const session =
        await stripe.checkout.sessions.create(
          {
            mode: 'subscription',

            customer: customerId,

            line_items: [
              {
                price: priceId,
                quantity: 1,
              },
            ],

            subscription_data: {
              trial_period_days: 14,
            },

            success_url:
              `${FRONTEND_URL}/dashboard.html?success=1`,

            cancel_url:
              `${FRONTEND_URL}/pricing.html?canceled=1`,
          }
        );

      res.json({
        url: session.url,
      });
    } catch (err) {
      res.status(500).json({
        error: err.message,
      });
    }
  }
);

/* ──────────────────────────────────────────────
   MOUNT API
────────────────────────────────────────────── */

app.use('/api', router);

/* ──────────────────────────────────────────────
   STATIC FRONTEND
────────────────────────────────────────────── */

/*
IMPORTANT :

TES HTML DOIVENT ÊTRE
À LA RACINE AVEC server.js

Exemple :

server.js
dashboard.html
login.html
pricing.html
billing.html
dashboard.css
dashboard.js
etc
*/

const FRONTEND_DIR = __dirname;

app.use(express.static(FRONTEND_DIR));

app.get('/', (_req, res) => {
  res.sendFile(
    path.join(
      FRONTEND_DIR,
      'dashboard.html'
    )
  );
});

app.get(
  '/dashboard',
  (_req, res) => {
    res.sendFile(
      path.join(
        FRONTEND_DIR,
        'dashboard.html'
      )
    );
  }
);

app.get('/login', (_req, res) => {
  res.sendFile(
    path.join(
      FRONTEND_DIR,
      'login.html'
    )
  );
});

app.get(
  '/pricing',
  (_req, res) => {
    res.sendFile(
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
    res.sendFile(
      path.join(
        FRONTEND_DIR,
        'billing.html'
      )
    );
  }
);

/* ──────────────────────────────────────────────
   404
────────────────────────────────────────────── */

app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({
      error: `Route introuvable : ${req.method} ${req.path}`,
    });
  }

  return res.sendFile(
    path.join(
      FRONTEND_DIR,
      'dashboard.html'
    )
  );
});

/* ──────────────────────────────────────────────
   ERROR HANDLER
────────────────────────────────────────────── */

app.use(
  (err, _req, res, _next) => {
    console.error(
      '[FP] Error:',
      err
    );

    res.status(500).json({
      error:
        err.message ||
        'Erreur interne',
    });
  }
);

/* ──────────────────────────────────────────────
   MONITOR CRON
────────────────────────────────────────────── */

async function runMonitorChecks() {
  try {
    const monitors =
      await Monitor.find();

    for (const monitor of monitors) {
      const rand = Math.random();

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

/* ──────────────────────────────────────────────
   MONGODB + SERVER
────────────────────────────────────────────── */

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log(
      '[FP] ✅ MongoDB connecté'
    );

    app.listen(
      PORT,
      '0.0.0.0',
      () => {
        console.log(
          `[FP] 🚀 Serveur démarré → http://localhost:${PORT}`
        );
      }
    );

    cron.schedule(
      '*/5 * * * *',
      runMonitorChecks
    );

    console.log(
      '[FP] ✅ Crons démarrés'
    );
  })
  .catch((err) => {
    console.error(
      '[FP] ❌ MongoDB erreur:',
      err.message
    );

    process.exit(1);
  });
