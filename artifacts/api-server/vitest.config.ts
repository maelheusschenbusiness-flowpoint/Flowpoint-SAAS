import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Workspace packages — resolves to source so oxc can transform them
      "@workspace/db":      resolve(__dirname, "../../lib/db/src/index.ts"),
      "@workspace/api-zod": resolve(__dirname, "../../lib/api-zod/src/index.ts"),
    },
  },
  test: {
    // Run only files that are self-contained (pure functions / no live DB required)
    include: [
      "src/lib/startup-retry.test.ts",
      "src/startup-bootstrap.test.ts",
      "src/tests/pdf_white_label.test.ts",
      "src/tests/session_restore_precedence.test.ts",
      "src/services/ai-economy.test.ts",
      "src/services/ai-engine.credit-calc.test.ts",
      "src/services/ai-economy-db.test.ts",
      "src/services/ai-usage-tracking-db.test.ts",
      "src/services/ai-usage-failclosed.test.ts",
      "src/routes/ai-classifier.test.ts",
      "src/routes/ai-chat-failclosed.test.ts",
      "src/routes/ai-chat-ratelimit.test.ts",
      "src/routes/ai-lock-lifecycle.test.ts",
      "src/routes/ai-confirmation-preview.test.ts",
      "src/routes/ai-recommendations-localization.test.ts",
      "src/agent/tool-executor-user-text.test.ts",
      "src/services/ai-attachments.test.ts",
      "src/services/ai-attachments-db.test.ts",
      "src/services/ai-attachment-parser.test.ts",
      "src/services/ai-attachment-parser-db.test.ts",
      "src/services/ai-multimodal.test.ts",
      "src/routes/ai-chat-attachments.test.ts",
      "src/routes/team-files.test.ts",
      "src/services/ga4-connection-status.test.ts",
      "src/routes/overview.test.ts",
      "src/routes/growth-objectives.test.ts",
      "src/services/ensure-stripe-customer.test.ts",
      "src/agent/ai-tool-gate.test.ts",
      "src/lib/plans.test.ts",
      "src/services/billing-quote.test.ts",
      "src/routes/white-label.test.ts",
      "src/services/addons-provisioning.test.ts",
      "src/routes/stripe-webhook-addon-reconcile.test.ts",
      "src/services/google-oauth-scopes.test.ts",
      "src/services/monitor-addon-quota.test.ts",
      "src/routes/addon-activate-quantity.test.ts",
      "src/routes/gsc-site-ownership.test.ts",
      "src/services/gsc-sync-ownership.test.ts",
      "src/services/ga4-property-discovery.test.ts",
      "src/routes/chat-notifications.test.ts",
      "src/routes/team-chat-reliability.test.ts",
      "src/routes/addon-only-checkout.test.ts",
      "src/routes/billing-period-end.test.ts",
      "src/routes/team-invite-accept.test.ts",
      "src/services/seat-entitlement.test.ts",
      "src/routes/team-seat-gate.test.ts",
      "src/routes/team-list-owner.test.ts",
       "src/routes/team-member-removal-security.test.ts",
      // Account deletion — early session revocation (preKillSessions) patch
      "src/services/account-deletion-session-kill.test.ts",
      "src/tests/cross_tenant_rbac_sso.test.ts",
      // Phase 7 — analyze_url SSRF IPv6 + IPv4 classification
      "src/services/url-fetcher-ipv6.test.ts",
      "src/services/url-fetcher-ipv4.test.ts",
      // Task #592 — AI engine CR fixes regression suite
      "src/tests/ai-engine.test.ts",
      // Task #592 item #11 — multi-tenant mission isolation
      "src/tests/ai-multitenant.test.ts",
      // Task #608 — AI engine maturity: FP_NAV leak, scope discipline, HYBRID tools, analyze_site
      "src/agent/nav-sanitize.test.ts",
      "src/routes/ai-intent-tools.test.ts",
      "src/services/site-crawler.test.ts",
      // P0 — GET /api/me entitlement fail-closed on unavailable billing data
      "src/routes/me-entitlement.test.ts",
      // Add-on entitlement: plan inclusion + org_addons gate logic
      "src/routes/addon-entitlement.test.ts",
      // P0 — quantity add-on entitlement expansion + idempotency + deactivation race guard
      "src/routes/addon-entitlement-quantity.test.ts",
      // P0-B — addon-stripe-sync independent subscription certification (21 cases + 5 invariants)
      "src/services/addon-stripe-sync.test.ts",
      // P0 — addon lifecycle guards: coming_soon, removed, plan-restricted
      // P0/P1 — streak owner vs member isolation
      "src/routes/streak-owner-member.test.ts",
      // Task #628 — Activity real aggregates: pagination contract + per-member counts/streaks
      "src/routes/activity-pagination.test.ts",
      "src/routes/team-aggregates.test.ts",
      // Task #628 — Local SEO: Review Intelligence canonical entitlement +
      // ranking-history result counts / usage contract
      "src/routes/local-seo-entitlement.test.ts",
       "src/routes/local-seo-rankings-route.test.ts",
      // Task #628 — Agency Lab / client-mode backend reliability: SQL/schema
      // failures surface (no silent empty arrays), genuine empty states preserved.
      "src/services/client-mode-service.test.ts",
      // Reactivation service: 14 cases covering Stripe idempotency, plan prices, concurrency
      "src/tests/reactivate-subscription.test.ts",
    ],
    environment: "node",
    globals:     false,
    reporters:   ["verbose"],
    // Mock heavy deps that would require a real DB connection
    setupFiles:  ["./src/vitest.setup.ts"],
    // Use the isolated tsconfig so oxc does NOT pick up the composite/references
    // from tsconfig.json (which targets compiled workspace packages, not source).
    // tsconfig.json composite+references must stay intact for tsc project build.
    typecheck: { tsconfig: "./tsconfig.vitest.json" },
  },
});
