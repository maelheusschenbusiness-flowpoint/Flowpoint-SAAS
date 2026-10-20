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
      "src/services/keyword-domination.test.ts",
      "src/services/global-monitoring.test.ts",
      "src/services/content-decay-strategy.test.ts",
      "src/services/workspace-launch-output.test.ts",
      "src/services/forecasting-service.test.ts",
      "src/services/forecasting-service.atomic.test.ts",
      "src/services/market-intel-service.test.ts",
      "src/services/market-intel-persistence-db.test.ts",
      "src/services/backlink-intel.test.ts",
      "src/routes/sla-addon-gate.test.ts",
      "src/services/mailer-nodemailer10.test.ts",
      "src/services/nodemailer10-transport.test.ts",
      "src/services/webhook-url-safety.test.ts",
      "src/services/integration-response.test.ts",
      "src/services/executive-report-facts.test.ts",
      "src/services/review-intelligence-themes.test.ts",
      "src/services/review-intel-reply.test.ts",
      "src/services/local-maps-summary.test.ts",
      "src/services/local-heatmap-grid.test.ts",
      "src/services/dataforseo-coordinate-fixture.test.ts",
      "src/services/gbp-posting-publish.test.ts",
      // Conversion B — fp_lid attribution
      "src/tests/conversion-b-fp-lid.test.ts",
      // AI Lab — emission des jalons de conversion (signup, checkout, trial, paid).
      "src/tests/ai-lab-conversion-emitters.test.ts",
      // Les handlers eux-memes : prouve que quelqu un appelle l emetteur.
      "src/tests/ai-lab-conversion-handlers.test.ts",
      // Croissance — faits commerciaux par jour ouvre (clients, essais, MRR).
      "src/tests/growth-facts.test.ts",
      // CRO observed-event recommendations and real A/B sample statistics.
      "src/services/conversion-observations.test.ts",
      // Conversion A — funnel fixes
      "src/routes/seo-quota-gate.test.ts",
      "src/services/dataforseo-quota-db.test.ts",
      // Politique fail-closed des appels payants DataForSEO (17/10/2026).
      "src/routes/seo-quota-failclosed.test.ts",
      "src/services/dataforseo-quota-failclosed-db.test.ts",
      "src/services/betterstack-tenancy-db.test.ts",
      // Gardes de creation, migration autonome, non-regression du natif.
      "src/services/betterstack-creation-guards-db.test.ts",
      "src/lib/logger-redaction.test.ts",
      "src/lib/carry-params.test.ts",
      // Resilience des APIs externes : toute sortie reseau est bornee (17/10/2026).
      "src/lib/fetch-borne.test.ts",
      "src/middlewares/rate-limit-public-checkout.test.ts",
      "src/tests/conversion-a-funnel-guards.test.ts",
      "src/lib/startup-retry.test.ts",
      "src/startup-bootstrap.test.ts",
      "src/services/content-decay.test.ts",
      "src/tests/pdf_white_label.test.ts",
      "src/tests/rbac-policy-v1.test.ts",
      "src/tests/onboarding-six-steps.test.ts",
      "src/tests/whitelabel-color-escape.test.ts",
      "src/tests/rbac-default-role.test.ts",
      "src/tests/cmd-palette-rbac.test.ts",
      "src/tests/no-mongo-vestige.test.ts",
      "src/tests/session_restore_precedence.test.ts",
      "src/tests/signup-session-dashboard-refresh.test.ts",
      // P0 anti-double-facturation : un checkout = un abonnement.
      "src/services/checkout-subscription-claim-db.test.ts",
      "src/routes/checkout-single-subscription.test.ts",
      "src/services/checkout-post-tokens-rls-db.test.ts",
      "src/services/identity-schema-gate-db.test.ts",
      "src/services/readiness-db.test.ts",
      "src/services/readiness-timeout.test.ts",
      "src/lib/with-timeout.test.ts",
      "src/services/quarantine-table-rls-db.test.ts",
      "src/services/schema-gate-status-db.test.ts",
      "src/services/rls-guc-alignment-db.test.ts",
      // Tables pre-compte : RLS forcee sans policy, et pourquoi rien ne casse (18/10/2026).
      "src/services/tables-pre-compte-rls-db.test.ts",
      // Garde de cible : un service ne modifie que la base qu'il declare (18/10/2026).
      "src/services/garde-cible-base.test.ts",
      // Fuite reelle d'un identifiant dans le journal de la garde (18/10/2026).
      "src/services/fuite-journal-cible.test.ts",
      // Ordre du durcissement RLS au demarrage, mesure sur base neuve (18/10/2026).
      "src/services/ordre-durcissement-rls.test.ts",
      // ALTER sur une table que rien ne cree — defaut mesure le 18/10/2026.
      "src/services/alter-sans-create.test.ts",
      // Mesure du tunnel commercial (18/10/2026).
      "src/services/funnel-events-db.test.ts",
      "src/routes/funnel-endpoint-db.test.ts",
      // Enumeration de comptes sur login-request (18/10/2026).
      "src/routes/login-request-enumeration.test.ts",
      // Mesure du tunnel posee sur la page d'inscription (18/10/2026).
      "src/tests/signin-mesure-tunnel.test.ts",
      "src/services/schema-reconcile-db.test.ts",
      "src/services/pg-init-contract-db.test.ts",
      "src/services/org-settings-canonical-key-db.test.ts",
      "src/lib/plan-price-mode.test.ts",
      "src/lib/plans-prix-test-manquants.test.ts",
      "src/lib/env-database-url.test.ts",
      "src/lib/url-base.test.ts",
      // Verification TLS : racine Supabase epinglee, verification active (18/10/2026).
      "../../lib/db/src/ssl-supabase.test.ts",
      // Taille du pool face au plafond du pooler Supabase (18/10/2026).
      "../../lib/db/src/pool-taille.test.ts",
      "src/services/cancel-at-period-end-db.test.ts",
      "src/services/publishable-key-mode.test.ts",
      "src/services/canonical-subscription-db.test.ts",
      "src/services/ai-economy.test.ts",
      "src/services/ai-engine.credit-calc.test.ts",
      "src/services/ai-economy-db.test.ts",
      "src/services/ai-usage-tracking-db.test.ts",
      "src/services/ai-usage-idempotency-db.test.ts",
      "src/services/ai-usage-failclosed.test.ts",
      "src/services/ai-provider-stream.test.ts",
      "src/tests/dashboard-responsive-ux.test.ts",
      "src/middlewares/requirePaidAccess-db.test.ts",
      // Le contournement d'authentification de developpement exige une intention (17/10/2026).
      "src/middlewares/requireAuth-dev-bypass.test.ts",
      "src/routes/auth-me-org-resolution-db.test.ts",
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
      "src/tests/overview-cache-key.test.ts",
      "src/tests/overview-uptime-honest.test.ts",
      "src/routes/growth-objectives.test.ts",
      "src/services/ensure-stripe-customer.test.ts",
      "src/agent/ai-tool-gate.test.ts",
      "src/lib/plans.test.ts",
      "src/services/billing-quote.test.ts",
      "src/services/billing-schedule.test.ts",
      "src/routes/white-label.test.ts",
      "src/services/addons-provisioning.test.ts",
      "src/routes/stripe-webhook-addon-reconcile.test.ts",
      "src/routes/stripe-webhook-ordering-db.test.ts",
      // La signature du webhook de facturation est la seule protection de cet
      // endpoint : un tiers non authentifie peut y faire accorder un abonnement.
      "src/routes/stripe-webhook-signature.test.ts",
      // Cycle de vie de l'abonnement, par webhooks signes localement (18/10/2026).
      "src/routes/stripe-subscription-lifecycle-db.test.ts",
      "src/routes/stripe-webhook-secret-test-seul.test.ts",
      // Le mode sans signature ne doit pouvoir atteindre la production par
      // aucune voie : affectation, paquet construit, configuration, ordre des gardes.
      "src/routes/stripe-webhook-unsigned-containment.test.ts",
      "src/services/google-oauth-scopes.test.ts",
      "src/services/monitor-addon-quota.test.ts",
      "src/routes/addon-activate-quantity.test.ts",
      "src/routes/gsc-site-ownership.test.ts",
      "src/services/gsc-sync-ownership.test.ts",
      "src/services/ga4-property-discovery.test.ts",
      "src/routes/chat-notifications.test.ts",
      "src/routes/team-chat-reliability.test.ts",
      "src/routes/addon-only-checkout.test.ts",
      "src/routes/onboarding.test.ts",
      "src/routes/billing-period-end.test.ts",
      "src/routes/team-invite-accept.test.ts",
      "src/services/seat-entitlement.test.ts",
      "src/routes/team-seat-gate.test.ts",
      "src/routes/team-list-owner.test.ts",
      "src/routes/monitors-delete.test.ts",
       "src/routes/team-member-removal-security.test.ts",
      // Account deletion — early session revocation (preKillSessions) patch
      "src/services/account-deletion-session-kill.test.ts",
      // Le mecanisme de suppression cree-t-il encore des orphelins ? (17/10/2026)
      "src/services/org-deletion-orphans-db.test.ts",
      // Revalidation a DEUX organisations : tables partagees et relations indirectes.
      "src/services/org-deletion-two-orgs-db.test.ts",
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
      // Canonical activity-day source, identity, and timezone-safe streak semantics
      "src/services/activity-streak.test.ts",
      // Canonical user_id/org_id session contract and legacy-session policy
      "src/services/session-identity-canonical.test.ts",
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
      // P0 billing legacy mapping: A-G (legacy customer reuse, trial gate, webhook sub ID)
      "src/tests/billing-legacy-customer.test.ts",
      // P0 pre-register customer reuse + trial anchor: Tests A-F
      "src/tests/billing-preregister-customer.test.ts",
      // P0 admin purge — SAVEPOINT fix + 7 regression tests
      "src/tests/admin-purge-all-clients.test.ts",
      "src/tests/billing-checkout-session-dedup.test.ts",
       "src/tests/seller-attribution.test.ts",
       "src/tests/seller-financial-ledger.test.ts",
      // Seller admin: scoped SELLER_ADMIN_KEY, canonical fp_ref link, exact list totals
      "src/tests/seller-admin-routes.test.ts",
      "src/tests/seller-list-totals.db.test.ts",
      // P0 fixes: org_members legacy + email-as-UUID guard
      "src/tests/p0-org-members-legacy.test.ts",
      "src/tests/p0-email-uuid-guard.test.ts",
      // Resubscription: existing org → canceled sub → same customer invariant
      "src/tests/billing-resubscription-same-customer.test.ts",
      // Browser account isolation + dashboard/Stripe reactivation source contracts
      "src/tests/session-dashboard-billing-reactivation.test.ts",
       "src/tests/dashboard-plan-notification.test.ts",
      // finalize-checkout Path C: PI/SI metadata pre_register_token recovery
      "src/tests/finalize-checkout-path-c.test.ts",
      // P0 2026-09-15: a valid signup token wins over a stale browser session
      "src/tests/signup-token-over-stale-session.test.ts",
      "src/tests/onboarding-frontend.test.ts",
      // Smart billing upgrade routing: server-side reactivation vs Checkout
      "src/tests/billing-upgrade-reactivation.test.ts",
      // Checkout abandonné — gardes contre les mutations prématurées
      "src/tests/checkout-abandon-guards.test.ts",
      "src/tests/auth-login-verify-stripe-mode.test.ts",
      // P0 webhook race: customer.subscription.* before finalize-checkout commits the UUID org
      "src/tests/stripe-webhook-pending-activation.test.ts",
      "src/services/quota-gate.test.ts",
      "src/services/workflow-schedule-cron.test.ts",
      "src/services/workflow-schedule-cron-db.test.ts",
    ],
    environment: "node",
    // DETERMINISME : les fichiers ne s'executent pas en parallele.
    //
    // Mesure du 17/10/2026 : plusieurs fichiers modifient le schema PARTAGE
    // de la base de test — DROP TABLE, DROP puis CREATE POLICY — pendant que
    // d'autres verifient un invariant GLOBAL sur toutes les tables portant
    // org_id. Resultat, la suite rendait 0, 4 ou 9 echecs selon le passage,
    // pour des raisons etrangeres au produit.
    //
    // Cout mesure : 46 s au lieu de 11 s. C'est le prix d'un resultat sur
    // lequel on peut fonder une decision, et il est paye une fois par
    // verification, pas par personne.
    fileParallelism: false,
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
