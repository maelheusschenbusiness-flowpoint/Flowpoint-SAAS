---
name: API-server missing service stubs
description: 29 service/worker/lib files created to fix 65 esbuild errors; critical export naming pitfalls documented
---

## Problem
esbuild bundling of artifacts/api-server failed with 65 "Could not resolve" errors — ~29 service files missing from Test-Replit branch.

## Files created
All in artifacts/api-server/src/:
- services/store.ts — OrgMe + logActivity (pool-backed)
- services/sessions.ts — HMAC session tokens, PG persistence; exports: createSession, deleteSession, getSession, invalidateSession, SESSION_TTL_MS
- services/mock-data.ts — isDemoMode() returns true when not prod+DB
- lib/validateMonitorUrl.ts — SSRF guard; exports validateMonitorUrl, isPrivateHost, checkDnsResolution
- services/schedule-utils.ts — computeNextRun, isValidFrequency
- services/monitor-cron.ts — evaluateAlertRulesForAudit
- workers/cron-scheduler.ts — getCronStatus (in-memory job registry)
- services/org-settings.ts — loadOrgSettings, upsertOrgSettings
- services/pagespeed-service.ts — real PSI API + DB cache; exports analyzePSI, getPSIHistory, getLatestPSIResult, invalidatePSICache
- services/overview-service.ts — getOverviewMetrics (aggregated from DB)
- services/mission-engine.ts — runMissionEngine (seeds AI missions), getMissionsStats
- services/keyword-engine.ts — full keyword tracking suite
- services/forecasting-service.ts — 90-day forecasts, buildComputedForecast fallback
- services/revenue-leak-service.ts — uses drizzle (revenueLeaksTable from @workspace/db)
- services/market-intel-service.ts — getMarketDashboard, generateMarketReport, detectCompetitorMovements, seedMarketData
- services/pdf.ts — pdfkit streaming report (requires pdfkit installed)
- services/sso-service.ts — SSO_PROVIDER_TYPES const array + all SSO CRUD
- services/permissions-service.ts — ALL_RESOURCES, ALL_ACTIONS const arrays + RBAC
- services/github-service.ts — GitHub OAuth + repo analysis via API
- services/integrations-service.ts — SUPPORTED_EVENTS const array + webhook dispatch
- services/ga4-service.ts — all GA4 endpoints (listGA4Accounts, getGA4Overview, etc.)
- services/gsc-service.ts — GSC status, sync, analytics endpoints
- services/google-service.ts — GBP OAuth; encryptToken/decryptToken using AES-256-GCM
- services/llm-visibility.ts — checkLLMVisibility (stub, no external call)
- services/gbp-posting-service.ts — GBP post CRUD + AI content generation
- services/local-maps-service.ts — heatmaps, getMapsDashboard, AI recommendations
- services/maps-service.ts — Google Maps API geocode/nearby/heatmap
- services/review-intel-service.ts — reputation dashboard, analyzeReview, generateReply, syncReviewsFromGBP
- services/dataforseo-service.ts — full DataForSEO API (graceful stubs when !isDataForSEOConfigured())

## Critical pitfall
google-service.ts exports must match EXACTLY what routes/google.ts imports. The route imports: isGoogleConfigured, generateAuthUrl, getTokensFromCode, getAccounts, getLocations, getLocationReviews, syncAll, getGBPStatus, getPerformance, publishGBPPost, replyToReview, generateAIReply, getValidToken, encryptToken. First version used different names → 12 build errors.

## Missing DB tables
~15 tables referenced by stubs are NOT yet in lib/db/src/index.ts: user_sessions, psi_cache, psi_history, gsc_sites, google_tokens, github_connections, ga4_properties, gbp_posts, local_heatmaps, dataforseo_quota, market_trends, market_opportunities, sso_providers, org_auth_config, login_audits, roles, permission_logs, webhook_integrations, activity_logs, seo_forecasts, reviews.

**Why:** The db schema was written before the routes/services were analyzed. Adding these to Drizzle and running a migration is the next required step before the API can serve real requests.

## zod
Added zod ^3.24.1 to artifacts/api-server/package.json — required by src/lib/env.ts.
