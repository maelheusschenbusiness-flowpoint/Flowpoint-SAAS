# ── Stage 1: deps ─────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
RUN npm install -g pnpm@9
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY lib/db/package.json ./lib/db/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-zod/package.json ./lib/api-zod/
RUN pnpm install --frozen-lockfile

# ── Stage 2: builder ──────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@9
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/artifacts/api-server/node_modules ./artifacts/api-server/node_modules
COPY . .
RUN pnpm --filter @workspace/api-server run build

# ── Stage 3: production ───────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S flowpoint -u 1001
USER flowpoint

COPY --from=builder --chown=flowpoint:nodejs /app/artifacts/api-server/dist ./dist
COPY --from=builder --chown=flowpoint:nodejs /app/artifacts/flowpoint-export ./flowpoint-export
COPY --from=deps    --chown=flowpoint:nodejs /app/artifacts/api-server/node_modules ./node_modules

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/health || exit 1

CMD ["node", "dist/index.mjs"]
