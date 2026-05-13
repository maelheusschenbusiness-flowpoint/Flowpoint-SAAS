# FlowPoint — SEO SaaS Dashboard

A full-stack, production-grade SEO monitoring and analytics platform.

## Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Vanilla JS + CSS (no framework, zero dependencies) |
| **Backend** | Node.js 20 · Express · TypeScript |
| **Database** | PostgreSQL 15 via Drizzle ORM |
| **Realtime** | Server-Sent Events (SSE) |
| **Queues** | In-process (Redis-upgradeable via BullMQ) |
| **Payments** | Stripe Checkout |
| **Email** | Resend |
| **SMS** | Twilio |
| **AI** | OpenAI GPT-4 |
| **PDF** | Puppeteer (pluggable) |

---

## Project Structure

```
flowpoint/
├── artifacts/
│   ├── api-server/                  # Express backend (TypeScript)
│   │   └── src/
│   │       ├── app.ts               # Express setup + middleware
│   │       ├── index.ts             # Entry point + startup
│   │       ├── routes/              # 20 REST API route files
│   │       ├── services/            # SSE store, cron, email, SMS, PDF
│   │       ├── workers/             # Job processors (audit, pdf, email, monitor, ai)
│   │       ├── queues/              # Queue abstraction (in-proc + BullMQ-ready)
│   │       ├── realtime/            # SSE event catalogue
│   │       ├── middlewares/         # Auth guard
│   │       └── lib/                 # Logger · URL validator · Env validation
│   └── flowpoint-export/            # Standalone frontend (no build step)
│       ├── dashboard.html           # App shell (SPA)
│       ├── dashboard.js             # ~19 000 lines — complete SPA logic
│       ├── dashboard.css            # All styles + dark mode + animations
│       ├── fp-backend.js            # API integration layer v4
│       ├── fp-config.js             # Runtime config + feature flags
│       └── report-view.html         # Shareable SEO report page
├── lib/
│   ├── db/                          # Drizzle ORM — 15 PostgreSQL tables
│   ├── api-spec/                    # OpenAPI 3.0 YAML
│   └── api-client-react/            # Generated React hooks (optional)
├── tests/
│   ├── setup.ts                     # Test server + DB bootstrap
│   └── api/                         # API integration tests (Vitest)
│       ├── health.test.ts
│       ├── monitors.test.ts
│       ├── billing.test.ts
│       ├── keywords.test.ts
│       ├── notifications.test.ts
│       └── competitors.test.ts
├── .github/
│   └── workflows/
│       ├── ci.yml                   # Install · lint · test · build · Docker
│       └── deploy.yml               # Build & push Docker image to GHCR
├── Dockerfile                       # Multi-stage, non-root, slim Alpine
├── docker-compose.yml               # App + PostgreSQL + Redis
├── ecosystem.config.cjs             # PM2 cluster config
├── vitest.config.ts                 # Test runner config
├── .env.example                     # All environment variables documented
├── package.json                     # pnpm workspace root
└── pnpm-workspace.yaml
```

---

## Database Tables (Drizzle / PostgreSQL)

| Table | Purpose |
|-------|---------|
| `monitors` | Uptime monitors (URL, interval, status) |
| `monitor_checks` | Historical ping results |
| `downtime_incidents` | Incident timeline |
| `alert_rules` | Threshold-based alert configuration |
| `audits` | SEO audit runs + scores |
| `audit_schedules` | Recurring audit cron config |
| `reports` | Generated PDF reports |
| `share_tokens` | Public shareable report links |
| `team` | Team members + roles |
| `activity_events` | Audit log / activity feed |
| `keywords` | Keyword tracking + positions |
| `competitors` | Competitor domains + metrics |
| `notifications` | In-app notification inbox |
| `team_messages` | Team chat messages by channel |
| `connectors` | Third-party integration state |

---

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/me` | Current user profile |
| GET/POST | `/api/overview` | Dashboard metrics |
| GET/POST/PATCH/DELETE | `/api/monitors` | Site monitors |
| POST | `/api/monitors/:id/ping` | Manual ping |
| GET/POST/PATCH/DELETE | `/api/alert-rules` | Alert rules |
| GET/POST/PATCH | `/api/audits` | SEO audits |
| GET/POST/PATCH/DELETE | `/api/keywords` | Keyword tracking |
| GET/POST/DELETE | `/api/competitors` | Competitor tracking |
| GET/POST/PATCH/DELETE | `/api/notifications` | In-app notifications |
| GET/POST/DELETE | `/api/team` | Team members |
| GET/POST/DELETE | `/api/team/messages` | Team chat |
| GET/POST | `/api/missions` | AI missions |
| GET/POST | `/api/ai/chat` | AI assistant |
| GET/POST/DELETE | `/api/connectors` | Third-party integrations |
| GET/POST | `/api/reports` | PDF reports |
| GET | `/api/share/:token` | Public report |
| GET/SSE | `/api/activity/events` | Realtime SSE stream |
| GET/POST | `/api/billing` | Plans + Stripe checkout |
| POST | `/api/webhooks/stripe` | Stripe webhook handler |

---

## Realtime (SSE)

FlowPoint uses **Server-Sent Events** for realtime updates. No Socket.IO required — native browser API, works through proxies and CDNs.

**SSE endpoint:** `GET /api/activity/events`

**Events pushed to all clients:**

| Event | Trigger |
|-------|---------|
| `fp:monitor:status` | Monitor goes up or down |
| `fp:monitor:ping` | Manual ping result |
| `fp:alert:triggered` | Alert threshold crossed |
| `fp:audit:progress` | Audit phase update |
| `fp:audit:completed` | Audit finished with score |
| `fp:report:ready` | PDF report ready |
| `fp:billing:updated` | Plan change confirmed |
| `fp:chat:message` | New team chat message |
| `fp:notification` | New notification |
| `fp:ai:completed` | AI analysis result |
| `fp:activity` | New activity log entry |

**Client usage:**
```js
const es = new EventSource('/api/activity/events');
es.addEventListener('fp:monitor:status', (e) => {
  const data = JSON.parse(e.data);
  console.log(data.monitorId, data.status);
});
```

---

## Queue / Worker System

FlowPoint ships with an in-process queue (`src/queues/index.ts`) that runs without external dependencies. It supports:

- Concurrency control
- Automatic retries with exponential backoff
- Per-job attempt limits

**Workers registered:**

| Worker | File | Handles |
|--------|------|---------|
| Audit | `workers/audit-worker.ts` | `audit:run` jobs |
| PDF | `workers/pdf-worker.ts` | `pdf:generate` jobs |
| Email | `workers/email-worker.ts` | `email:send` jobs |
| Monitor | `workers/monitor-worker.ts` | `monitor:ping` jobs |
| AI | `workers/ai-worker.ts` | `ai:analyse` jobs |

**Upgrade to BullMQ (Redis-backed):** Set `REDIS_URL` in `.env` and swap the `InProcessQueue` class for `new Queue(name, { connection })` from `bullmq` — the handler interface is identical.

---

## Getting Started

### Prerequisites
- Node.js 20+
- pnpm 9+
- PostgreSQL 15+

### Local setup

```bash
# 1. Clone and install
git clone https://github.com/your-org/flowpoint.git
cd flowpoint
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL, JWT_SECRET at minimum

# 3. Push DB schema
cd lib/db && npx drizzle-kit push && cd ../..

# 4. Start the API server (dev mode, hot-reload)
pnpm --filter @workspace/api-server run dev
```

Dashboard available at: **http://localhost:8080/api/dashboard/dashboard.html**

### Build for production

```bash
pnpm --filter @workspace/api-server run build
node artifacts/api-server/dist/index.mjs
```

---

## Running Tests

```bash
# Run all API tests
pnpm test

# With coverage
pnpm test --coverage
```

Tests require a running PostgreSQL instance (see `DATABASE_URL` in `.env`).  
For CI, the `ci.yml` workflow spins up a PostgreSQL service container automatically.

---

## Docker

```bash
# Build + start all services (app + postgres + redis)
docker compose up --build

# Production only (requires external DB)
docker build -t flowpoint-api .
docker run -p 8080:8080 --env-file .env flowpoint-api
```

### Services
- **api** — FlowPoint backend (non-root, Alpine, healthcheck)
- **postgres** — PostgreSQL 15 with persistent volume
- **redis** — Redis 7 with AOF persistence + LRU eviction

---

## PM2 (VPS / bare metal)

```bash
# Install PM2 globally
npm install -g pm2

# Build first
pnpm --filter @workspace/api-server run build

# Start with clustering (auto-detects CPU count)
pm2 start ecosystem.config.cjs --env production

# Save + enable startup
pm2 save
pm2 startup
```

---

## Deployment

| Platform | Method |
|----------|--------|
| **Railway** | Connect repo → set env vars → deploy automatically |
| **Render** | Build: `pnpm build` · Start: `node artifacts/api-server/dist/index.mjs` |
| **Fly.io** | `fly launch` → set secrets → `fly deploy` |
| **VPS** | PM2 cluster via `ecosystem.config.cjs` |
| **Docker** | `docker compose up` or push to GHCR via CI/CD |

---

## CI/CD (GitHub Actions)

### `ci.yml` — runs on every push + PR
1. Install + validate frozen lockfile
2. TypeScript check (tsc --noEmit)
3. Run API test suite (with real PostgreSQL service)
4. Build production bundle
5. Validate Docker build

### `deploy.yml` — runs on push to `main`
1. Build Docker image
2. Push to GitHub Container Registry (GHCR)
3. Optional: trigger Render / Railway deploy hook

---

## Environment Variables

See `.env.example` for the complete list.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | **Yes** | PostgreSQL connection string |
| `JWT_SECRET` | **Yes** | Min 32 chars — sign tokens |
| `PORT` | No | Default `8080` |
| `STRIPE_SECRET_KEY` | Billing | Stripe live/test secret key |
| `STRIPE_WEBHOOK_SECRET` | Billing | Stripe webhook signature |
| `OPENAI_API_KEY` | AI features | OpenAI API key |
| `RESEND_API_KEY` | Emails | Resend API key |
| `REDIS_URL` | Queues | Enables Redis-backed BullMQ queues |

---

## License

Proprietary — FlowPoint SaaS © 2025
