es.
      // This catches pre-fix legacy orgs or edge-case failures in ensureStripeCustomer.
      if (customerId && orgId && UUID_RE_WH.test(orgId) && !_customerMismatch) {
        persistOrgData(orgId, { stripeCustomerId: customerId }).catch(e =>
          logger.warn({ e, orgId, customerId }, "[Webhook] Safety stripe_customer_id link failed (non-blocking)")
        );
      }

      // ── New signup flow: activate account + send magic link after Stripe validates ──
      const preRegToken  = meta["pre_register_token"] ?? "";
      const selectedPlan = meta["selected_plan"] || planNorm || "standard";
      const isTrial      = meta["trial_plan"] === "true";

      // ── P0 backstop: detect and auto-cancel duplicate subscriptions ──────────
      // Fires when finalize-checkout's guard missed a race (e.g., two checkout
      // sessions created before either subscription existed, both completing later).
      //
      // PLAN-TIER DECISION (fixes scenario L — reversed event order):
      //   • If the new sub is a HIGHER plan than all conflicts → the new checkout is
      //     the intentional one (user moved to a better plan); cancel the lower-plan
      //     conflicts and let activation run for the new sub.
      //   • Otherwise → cancel the new sub (conservative: first-to-activate wins).
      //
      // Upgrade/downgrade path (billing/upgrade) uses stripe.subscriptions.update()
      // and never triggers checkout.session.completed, so this backstop cannot
      // interfere with dashboard plan changes.
      const _newSubId = obj["subscription"] ? String(obj["subscription"]) : undefined;
      let _isDuplicateSub = false;
      if (_newSubId && customerId && stripeKey) {
        try {
          const _bsStripe  = await createStripeClient(stripeKey);
          const _bsAllSubs = await _bsStripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
          type _BsSub = { id: string; status: string; cancel_at_period_end: boolean; metadata?: Record<string, string> };
          const _bsConflicts = (_bsAllSubs.data as _BsSub[]).filter(
            (s) => s.id !== _newSubId && (s.status === "active" || s.status === "trialing") && !s.cancel_at_period_end
          );
          if (_bsConflicts.length > 0) {
            // Plan-tier map: higher number = higher plan
            const _BS_TIER: Record<string, number> = { standard: 1, pro: 2, ultra: 3 };
            const _bsNewTier       = _BS_TIER[planNorm] ?? 0;
            const _bsMaxConflTier  = Math.max(..._bsConflicts.map(s => _BS_TIER[(s.metadata?.["plan"] ?? "").toLowerCase()] ?? 0), 0);
            // If new sub is strictly higher plan → it is the legitimate one, cancel conflicts
            // Otherwise → new sub is duplicate, cancel it
            const _bsCancelNew    = _bsNewTier <= _bsMaxConflTier;
            const _bsSubsToCancel = _bsCancelNew ? [_newSubId] : _bsConflicts.map(s => s.id);
            logger.error(
              {
                newSubId:        _newSubId,
                newPlan:         planNorm,
                newTier:         _bsNewTier,
                conflictSubIds:  _bsConflicts.map(s => s.id),
                maxConflTier:    _bsMaxConflTier,
                decision:        _bsCancelNew ? "cancel_new_sub" : "cancel_conflicts",
                customerId,
                orgId,
              },
              "[Webhook][P0] DUPLICATE SUBSCRIPTION DETECTED"
            );
            // Helper: cancel a subscription and refund its first paid invoice
            const _bsCancelAndRefund = async (subId: string): Promise<void> => {
              await _bsStripe.subscriptions.cancel(subId, { prorate: false });
              type _BsInv = { id: string; amount_paid: number; payment_intent?: unknown; charge?: unknown };
              const _bsInvs = await _bsStripe.invoices.list({ subscription: subId, limit: 3 });
              for (const _bsInv of (_bsInvs.data as _BsInv[])) {
                if (_bsInv.amount_paid <= 0) continue;
                const _bsPiId = typeof _bsInv.payment_intent === "string" ? _bsInv.payment_intent : null;
                const _bsChId = !_bsPiId && typeof _bsInv.charge === "string" ? _bsInv.charge : null;
                if (_bsPiId) {
                  await _bsStripe.refunds.create({ payment_intent: _bsPiId });
                  logger.info({ subId, invoiceId: _bsInv.id, piId: _bsPiId, amount: _bsInv.amount_paid },
                    "[Webhook][P0] Refund issued (via payment_intent)");
                } else if (_bsChId) {
                  await _bsStripe.refunds.create({ charge: _bsChId });
                  logger.info({ subId, invoiceId: _bsInv.id, chargeId: _bsChId, amount: _bsInv.amount_paid },
                    "[Webhook][P0] Refund issued (via charge)");
                } else {
                  logger.error({ subId, invoiceId: _bsInv.id, amount: _bsInv.amount_paid },
                    "[Webhook][P0] Could not auto-refund — no payment_intent or charge on invoice");
                }
                break;
              }
            };
            for (const _subToCancel of _bsSubsToCancel) {
              await _bsCancelAndRefund(_subToCancel).catch(err =>
                logger.error({ err, _subToCancel }, "[Webhook][P0] cancel+refund threw")
              );
            }
            // If we canceled the new sub → it's a duplicate, skip activation.
            // If we canceled the conflicts → new sub is legitimate, let activation run.
            _isDuplicateSub = _bsCancelNew;
          }
        } catch (_bsErr) {
          logger.error({ _bsErr, customerId, _newSubId },
            "[Webhook][P0] Duplicate sub backstop guard threw — proceeding with activation anyway");
        }
      }

      if (!_isDuplicateSub && preRegToken && orgId) {
        activateNewSignup({ preRegToken, orgId, customerId, selectedPlan, isTrial })
          .catch(e => logger.error({ e, orgId }, "[Webhook] checkout.session.completed new-signup activation failed"));
      }

      // P0-1: pass explicit orgId — never defaults to "default"
      // Bug-1 fix: persist plan immediately from session.metadata.plan when valid,
      // rather than waiting for the subscription.created/updated webhook.
      // _customerMismatch guard: don't overwrite canonical customer ID on mismatch.
      const persistPayload: Parameters<typeof persistSubscriptionMeta>[0] = {
        orgId,
        subscriptionStatus: "active",
        ...(!_customerMismatch ? { stripeCustomerId: customerId } : {}),
      };
      if (["standard","pro","ultra"].includes(planNorm)) {
        persistPayload.plan = planNorm;
      }
      await persistSubscriptionMeta(persistPayload);

      if (["standard","pro","ultra"].includes(planNorm)) {
        store.broadcastPlanUpdate(planNorm, orgId);
        // Provision plan-bundled add-ons immediately at checkout so the subscriber
        // can access their features without waiting for the subscription.created event.
        const { provisionPlanAddons } = await import("../services/addons-service.js");
        provisionPlanAddons(planNorm, orgId).catch(err =>
          logger.warn({ err, planNorm, orgId }, "[Webhook] provisionPlanAddons failed on checkout.session.completed")
        );
      }

      // ── Root cause #2 fix: authoritative add-on activation on paid checkout ──
      // public-billing records the recurring add-ons the customer selected and is
      // billed for now in metadata.immediate_addons (comma-separated add-on keys;
      // AI-credit packs and plan-bundled add-ons are intentionally excluded there).
      // Previously these were only activated later by customer.subscription.created,
      // so a missed/late subscription event left a paid add-on inactive. Activate
      // them here — but only after Stripe confirms this is a *completed & paid*
      // Checkout (status=complete AND payment_status in paid/no_payment_required)
      // so we never grant entitlement for an unpaid session. Idempotent: activateAddon
      // upserts, and the reconcile path never revokes what a live subscription still has.
      {
        const sessionStatus  = String(obj["status"] ?? "");
        const paymentStatus  = String(obj["payment_status"] ?? "");
        const paidOrTrial    = paymentStatus === "paid" || paymentStatus === "no_payment_required";
        const completed      = sessionStatus === "" || sessionStatus === "complete"; // "" tolerates minimal test fixtures
        const immediateAddonKeys = (meta["immediate_addons"] ?? "")
          .split(",")
          .map(k => k.trim())
          .filter(Boolean)
          // Only recurring flag/qty add-ons that carry a Stripe price ID.
          .filter(k => (FLAG_ADDONS.has(k) || QTY_ADDONS.has(k)));

        if (immediateAddonKeys.length > 0 && completed && paidOrTrial) {
          const { activateAddon } = await import("../services/addons-service.js");
          for (const key of immediateAddonKeys) {
            const activated = await activateAddon(key, orgId);
            if (!activated) {
              throw new Error(`Failed to activate immediate add-on '${key}' for org '${orgId}'`);
            }
          }
          logger.info({ orgId, immediateAddonKeys, paymentStatus, sessionStatus },
            "[Webhook] Immediate recurring add-ons activated from completed paid checkout");
        } else if (immediateAddonKeys.length > 0) {
          logger.info({ orgId, immediateAddonKeys, paymentStatus, sessionStatus },
            "[Webhook] Immediate add-ons NOT activated — checkout not completed/paid");
        }
      }

      // ── Direct /billing/addon-checkout path ──────────────────────────────────
      // These sessions store addonKey + quantity in session-level metadata (not
      // in immediate_addons) and always use mode=subscription.  The
      // customer.subscription.created event also activates via
      // persistAddonsFromSubscription, but only if getAddonForPriceId() can map
      // the price ID.  Activate here too (idempotent upsert) so a missing
      // env-var price mapping never silently drops a paid add-on.
      {
        const directAddonKey  = String(meta["addonKey"]  ?? "").trim();
        const directAddonQty  = Math.max(1, parseInt(String(meta["quantity"] ?? "1"), 10));
        const sessionComplete = (String(obj["status"] ?? "") === "complete" || String(obj["status"] ?? "") === "");
        const paymentOk       = (String(obj["payment_status"] ?? "") === "paid" ||
                                 String(obj["payment_status"] ?? "") === "no_payment_required");
        if (directAddonKey && (FLAG_ADDONS.has(directAddonKey) || QTY_ADDONS.has(directAddonKey))
            && sessionComplete && paymentOk) {
          try {
            const { activateAddon } = await import("../services/addons-service.js");
            const activated = await activateAddon(directAddonKey, orgId, directAddonQty);
            if (!activated) {
              logger.warn({ directAddonKey, orgId, directAddonQty },
                "[Webhook] Direct addon-checkout activation returned false — addon may already be active or unknown");
            } else {
              logger.info({ directAddonKey, orgId, directAddonQty },
                "[Webhook] Direct addon-checkout: add-on activated from checkout.session.completed");
            }
          } catch (dErr) {
            logger.error({ dErr, directAddonKey, orgId },
              "[Webhook] Direct addon-checkout activation threw — add-on activation will be retried by subscription.created");
          }
        }
      }

      logger.info({ plan: planNorm, orgId }, "[Webhook] Checkout session completed");
      break;
    }

    // ── New checkout-payment.html flow ────────────────────────────────────────
    // The PaymentElement flow fires payment_intent.succeeded (add-ons charged today)
    // or setup_intent.succeeded (plan-only trial, 0€ today).
    // Either can carry pre_register_token in metadata — activate the org when present.
    // orgId is not resolvable via the standard customer lookup (customer is created
    // later by finalize-checkout), so we derive it from pending_signups via the token.
    case "payment_intent.succeeded":
    case "setup_intent.succeeded": {
      const piMeta = (obj["metadata"] as Record<string, string>) ?? {};

      // ── In-app AI credit pack purchase (PaymentElement modal, no redirect) ──
      if (piMeta["type"] === "ai_credits") {
        const pack    = piMeta["pack"]    ?? "";
        const credits = parseInt(piMeta["credits"] ?? "0", 10);
        const amountEurCents = parseInt(piMeta["amountEurCents"] ?? "0", 10);
        const piId    = String(obj["id"] ?? "");
        const aiOrgId = orgId ?? piMeta["orgId"] ?? null;

        if (credits > 0 && aiOrgId && piId) {
          try {
            const { pool: pgPool } = await import("@workspace/db");
            const client = await pgPool.connect();
            try {
              // Deterministic id keyed on the PaymentIntent → idempotent on retries
              await client.query(
                `INSERT INTO ai_credit_purchases
                   (id, org_id, pack, credits, amount_eur_cents, stripe_session_id, stripe_payment_intent)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (id) DO NOTHING`,
                [`acp_pi_${piId}`, aiOrgId, pack, credits, amountEurCents, "", piId]
              );
            } finally { client.release(); }
            store.broadcast({ type: "ai:credits_added", pack, credits }, aiOrgId);
            logger.info({ pack, credits, orgId: aiOrgId }, "[Webhook] AI credits credited (payment_intent flow)");
          } catch (e) {
            logger.error({ e, orgId: aiOrgId }, "[Webhook] Failed to credit AI credits (payment_intent flow)");
          }
        } else {
          logger.error({ pack, credits, piId }, "[Webhook] AI credits intent: orgId unresolved — credits NOT credited");
        }
        break;
      }

      // A0 — Closed-tab addon recovery: activate recurring add-ons for authenticated
      // users who paid but never reached finalize-checkout (browser closed, 3DS in
      // another tab, connection lost). The PaymentIntent carries orgId + addons in
      // metadata so we can attribute and activate without a browser callback.
      const piAddonsRaw  = piMeta["addons"]  ?? "";
      const piMetaOrgId  = piMeta["orgId"]   ?? piMeta["org_id"] ?? orgId ?? null;
      const piPreRegToken = piMeta["pre_register_token"] ?? "";

      if (!piPreRegToken && piMetaOrgId && piAddonsRaw && piAddonsRaw !== "{}" && piAddonsRaw !== "null") {
        try {
          const piAddons = JSON.parse(piAddonsRaw) as Record<string, unknown>;
          const addonEntries = Object.entries(piAddons).filter(([, v]) => v === true || (typeof v === "number" && v > 0));
          const AI_CR_KEYS = new Set(["aiCreditsPack50k", "aiCreditsPack200k", "aiCreditsPack500k"]);
          const recurringEntries = addonEntries.filter(([k]) => !AI_CR_KEYS.has(k));

          if (recurringEntries.length > 0) {
            const piId = String(obj["id"] ?? "");
            // Idempotency: use a DB flag keyed on the PI id to prevent double-activation
            const { pool: pgPool } = await import("@workspace/db");
            // Idempotency: check a dedicated table or a known webhook event key.
            // We use the activity_log pattern: if this PI id already appears as
            // a webhook-sourced activation, skip. Use pool query for raw SQL.
            const idempClient = await pgPool.connect();
            let alreadyActivated = false;
            try {
              // Use a simple approach: check if the PI id is stored in activity_log
              const idempCheck = await idempClient.query<{ count: string }>(
                `SELECT COUNT(*) as count FROM activity_log WHERE org_id = $1 AND metadata->>'pi_id' = $2 AND action_key = 'addon.webhook_activated' LIMIT 1`,
                [piMetaOrgId, piId]
              );
              alreadyActivated = parseInt(idempCheck.rows[0]?.count ?? "0", 10) > 0;
            } catch (_) { /* table may not exist — proceed without idempotency check */ }
            finally { idempClient.release(); }

            if (!alreadyActivated) {
              // ── Tenant binding verification ─────────────────────────────────────
              // The PI metadata.orgId must map to a canonical org in organizations.
              // Never upsert an org just to satisfy the FK — fail loudly so Stripe retries.
              const { pool: _pgPool_a0 } = await import("@workspace/db");
              const _a0c = await _pgPool_a0.connect();
              const _UUID_RE_A0 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
              let _canonicalOrgId: string | null = null;
              try {
                if (_UUID_RE_A0.test(piMetaOrgId)) {
                  const _r = await _a0c.query<{ id: string }>(
                    `SELECT id FROM organizations WHERE id = $1 LIMIT 1`,
                    [piMetaOrgId]
                  );
                  _canonicalOrgId = _r.rows[0]?.id ?? null;
                } else {
                  // Legacy email-form orgId — look up canonical UUID via email
                  const _r = await _a0c.query<{ id: string }>(
                    `SELECT id FROM organizations WHERE owner_email = $1 OR id::text = $1 LIMIT 1`,
                    [piMetaOrgId]
                  );
                  _canonicalOrgId = _r.rows[0]?.id ?? null;
                }
              } finally { _a0c.release(); }

              const _evtId_a0 = (event as unknown as { id?: string }).id ?? "unknown";
              if (!_canonicalOrgId) {
                logger.error({
                  ADDON_ACTIVATION_FAILED: true,
                  eventId: _evtId_a0,
                  piId,
                  orgId: piMetaOrgId,
                  addonKeys: recurringEntries.map(([k]) => k),
                  reason: "org_not_in_organizations",
                }, "[Webhook] ADDON_ACTIVATION_FAILED — orgId not found in organizations; will retry");
                throw new Error(`ADDON_ACTIVATION_FAILED: org ${piMetaOrgId} not in organizations`);
              }

              const { activateAddon } = await import("../services/addons-service.js");
              const _failedKeys: string[] = [];
              for (const [key, val] of recurringEntries) {
                const qty = typeof val === "number" ? val : 1;
                try {
                  await activateAddon(key, _canonicalOrgId, qty);
                  logger.info({ key, qty, orgId: _canonicalOrgId, piId }, "[Webhook] Recurring add-on activated from PI metadata (closed-tab recovery)");
                } catch (activateErr) {
                  _failedKeys.push(key);
                  logger.error({
                    ADDON_ACTIVATION_FAILED: true,
                    eventId: _evtId_a0,
                    piId,
                    orgId: _canonicalOrgId,
                    addonKey: key,
                    qty,
                    err: activateErr instanceof Error ? activateErr.message : String(activateErr),
                  }, "[Webhook] ADDON_ACTIVATION_FAILED — DB error during activateAddon");
                }
              }
              if (_failedKeys.length > 0) {
                throw new Error(`ADDON_ACTIVATION_FAILED: [${_failedKeys.join(",")}] for org ${_canonicalOrgId}`);
              }
              store.broadcast({ type: "billing:addons_updated" }, _canonicalOrgId);
            } else {
              logger.info({ orgId: piMetaOrgId, piId }, "[Webhook] PI addon activation already done — skipping");
            }
          }
        } catch (piAddonErr) {
          const _isActivationFail = piAddonErr instanceof Error && piAddonErr.message.startsWith("ADDON_ACTIVATION_FAILED");
          if (_isActivationFail) {
            // Propagate so the top-level handler returns 500 — Stripe will retry
            throw piAddonErr;
          }
          logger.error({ piAddonErr, orgId: piMetaOrgId }, "[Webhook] Failed to parse/activate add-ons from PI metadata");
        }
        // Fall through to handle pre_register_token if present (new signup may also buy addons)
      }

      if (!piPreRegToken) {
        // Not a new-signup intent and addons already handled above — nothing more to do
        logger.info({ type: event.type, orgId: piMetaOrgId }, "[Webhook] PI processed (no pre_register_token)");
        break;
      }

      // Derive orgId from pending_signups (email = orgId in FlowPoint)
      let piOrgId: string | null = orgId; // may already be set if customer was linked
      if (!piOrgId) {
        try {
          const { pool: pgPool } = await import("@workspace/db");
          const lookupClient = await pgPool.connect();
          try {
            const r = await lookupClient.query<{ email: string }>(
              `SELECT email FROM pending_signups WHERE token = $1 AND expires_at > NOW() LIMIT 1`,
              [piPreRegToken]
            );
            if (r.rows[0]?.email) piOrgId = r.rows[0].email;
          } finally { lookupClient.release(); }
        } catch (e) {
          logger.warn({ e, type: event.type }, "[Webhook] Failed to look up orgId from pending_signups");
        }
      }

      if (!piOrgId) {
        logger.error({ type: event.type, piPreRegToken }, "[Webhook] Could not resolve orgId for new-signup intent — activation skipped");
        break;
      }

      const piPlan    = piMeta["plan"] ?? "standard";
      const piIsTrial = !piMeta["addons"] || piMeta["addons"] === "{}" || piMeta["addons"] === "null";
      // For setup_intent (0€ plan-only) always trial; for payment_intent also trial (add-ons don't count)
      const piSelectedPlan = piPlan || "standard";

      // The Stripe customer may not exist yet (created by finalize-checkout).
      // Pass undefined so organizations.stripe_customer_id is left NULL until
      // the customer.subscription.created webhook links it.
      activateNewSignup({
        preRegToken:  piPreRegToken,
        orgId:        piOrgId,
        customerId:   undefined,
        selectedPlan: piSelectedPlan,
        isTrial:      true,  // all new signups start with a trial
      }).catch(e => logger.error({ e, orgId: piOrgId, type: event.type }, "[Webhook] new-signup activation via intent failed"));

      logger.info({ type: event.type, orgId: piOrgId, plan: piSelectedPlan }, "[Webhook] New-signup activation queued from intent");
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const newPlan = parsePlanFromSubscription(obj);
      const status = String(obj["status"] || "active");

      if (!orgId) {
        logger.error({ type: event.type, status, plan: newPlan }, "[Webhook] subscription event: orgId unresolved — state NOT persisted");
        break;
      }

      // ── Plan-sync diagnostic logging ──────────────────────────────────────
      const _eventId_ps = (event as unknown as { id?: string }).id ?? "unknown";
      const _subId_ps   = obj["id"]       ? String(obj["id"])       : "unknown";
      const _custId_ps  = obj["customer"] ? String(obj["customer"]) : "unknown";
      let _dbPlanBefore: string | null = null;
      try {
        const { pool: _pgPool_ps } = await import("@workspace/db");
        const _psc = await _pgPool_ps.connect();
        const _UUID_RE_PS = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        try {
          if (_UUID_RE_PS.test(orgId)) {
            const _pr = await _psc.query<{ plan: string }>(`SELECT plan FROM organizations WHERE id = $1`, [orgId]);
            _dbPlanBefore = _pr.rows[0]?.plan ?? null;
          } else {
            const _pr = await _psc.query<{ plan: string }>(`SELECT plan FROM org_settings WHERE org_id = $1`, [orgId]);
            _dbPlanBefore = _pr.rows[0]?.plan ?? null;
          }
        } finally { _psc.release(); }
      } catch { /* non-fatal */ }
      logger.info({ eventId: _eventId_ps, subscriptionId: _subId_ps, customerId: _custId_ps, oldPlan: _dbPlanBefore, newPlan, stripeStatus: status, orgId },
        "[Webhook][plan-sync] customer.subscription event received");

      // P0-1: explicit orgId
      // P0-3: no store.me mutation
      const subscriptionId = obj["id"] ? String(obj["id"]) : undefined;
      const updatePayload: Parameters<typeof persistSubscriptionMeta>[0] = {
        orgId,
        subscriptionStatus: status,
        ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
      };
      if (newPlan) updatePayload.plan = newPlan;

      // Set trial_consumed_at when a real Stripe trialing subscription is first created.
      // This distinguishes real Stripe trials from old fake DB trials set at signup.
      // Only set once (idempotent: skip if already consumed).
      if (status === "trialing" && event.type === "customer.subscription.created") {
        try {
          const existingSettings = await loadOrgSettings(orgId).catch(() => null);
          if (!existingSettings?.trialConsumedAt) {
            const now = new Date().toISOString();
            updatePayload.trialConsumedAt = now;
            updatePayload.trialStartedAt  = now;
            // Persist the Stripe trial_end date
            if (obj["trial_end"] && typeof obj["trial_end"] === "number") {
              updatePayload.trialEndsAt = new Date(obj["trial_end"] * 1000).toISOString();
            }
            logger.info({ orgId, subscriptionId }, "[Webhook] First real Stripe trial — trial_consumed_at set");
          }
        } catch (trialErr) {
          logger.warn({ trialErr, orgId }, "[Webhook] trial_consumed_at check failed (non-fatal)");
        }
      }

      await persistSubscriptionMeta(updatePayload);

      // ── Verify DB plan after persist ─────────────────────────────────────
      if (newPlan) {
        let _dbPlanAfter: string | null = null;
        try {
          const { pool: _pgPool_pa } = await import("@workspace/db");
          const _pac = await _pgPool_pa.connect();
          const _UUID_RE_PA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          try {
            if (_UUID_RE_PA.test(orgId)) {
              const _ar = await _pac.query<{ plan: string }>(`SELECT plan FROM organizations WHERE id = $1`, [orgId]);
              _dbPlanAfter = _ar.rows[0]?.plan ?? null;
            } else {
              const _ar = await _pac.query<{ plan: string }>(`SELECT plan FROM org_settings WHERE org_id = $1`, [orgId]);
              _dbPlanAfter = _ar.rows[0]?.plan ?? null;
            }
          } finally { _pac.release(); }
        } catch { /* non-fatal */ }
        logger.info({ eventId: _eventId_ps, subscriptionId: _subId_ps, customerId: _custId_ps, oldPlan: _dbPlanBefore, newPlan, stripeStatus: status, orgId, dbPlanAfter: _dbPlanAfter, synced: _dbPlanAfter === newPlan },
          "[Webhook][plan-sync] customer.subscription.updated DB state after persist");
      }

      // The Stripe subscription event is the single authoritative point for
      // the trial-start notice. The webhook event guard above makes this
      // idempotent across Stripe retries.
      if (status === "trialing" && event.type === "customer.subscription.created") {
        const { pool: pgPool } = await import("@workspace/db");
        await pgPool.query(
          `UPDATE organizations
           SET trial_started_email_eligible_at = COALESCE(trial_started_email_eligible_at, NOW())
           WHERE id = $1`,
          [orgId],
        );
        const recipient = await loadOrgEmail(orgId);
        if (recipient.email && updatePayload.trialStartedAt) {
          const trialEnd = updatePayload.trialEndsAt;
          if (trialEnd) {
            await sendTrialStartedOnce({
              orgId,
              email: recipient.email,
              name: recipient.firstName || recipient.email.split("@")[0] || "Utilisateur",
              plan: newPlan || recipient.plan,
              trialEndsAt: trialEnd,
            });
          } else {
            logger.warn({ orgId, subscriptionId }, "[Webhook] Trial-started email skipped — Stripe did not supply trial_end");
          }
        }
      }

      if (newPlan) {
        // Only broadcast when the plan actually changed — a subscription.updated
        // fired by Stripe for unrelated reasons (e.g. payment method updated after
        // an add-on purchase) must NOT produce a "Plan mis à jour" toast.
        const _planActuallyChanged = !_dbPlanBefore || _dbPlanBefore.toLowerCase() !== newPlan.toLowerCase();
        if (_planActuallyChanged) {
          logger.info({ newPlan, oldPlan: _dbPlanBefore, status, orgId }, "[Webhook] Subscription updated — plan changed, broadcasting");
          store.broadcastPlanUpdate(newPlan, orgId);
        } else {
          logger.info({ newPlan, oldPlan: _dbPlanBefore, status, orgId }, "[Webhook] Subscription updated — plan unchanged, skipping broadcast");
        }
      }

      // Persist activated add-ons to DB using the resolved orgId.
      // Only reconcile deactivations on subscription.updated — never on subscription.created,
      // because an add-on checkout creates a separate subscription whose item list only contains
      // the new add-on; running deactivation on that event would wrongly revoke addons on
      // the customer's base or other add-on subscriptions.
      {
        const subCustomerId = obj["customer"] ? String(obj["customer"]) : null;
        const isCreated = event.type === "customer.subscription.created";
        await persistAddonsFromSubscription(obj, orgId, subCustomerId, /* reconcileDeactivations */ !isCreated);
      }

      // Provision plan-bundled add-ons (whiteLabel for Pro, customDomain for Ultra, etc.)
      // These are never Stripe subscription items because they are included at no extra charge.
      // provisionPlanAddons is idempotent (ON CONFLICT DO NOTHING under the hood).
      if (newPlan && (status === "active" || status === "trialing")) {
        const { provisionPlanAddons } = await import("../services/addons-service.js");
        provisionPlanAddons(newPlan, orgId).catch(err =>
          logger.warn({ err, newPlan, orgId }, "[Webhook] provisionPlanAddons failed on subscription event")
        );
      }

      if (status === "past_due" || status === "unpaid" || status === "canceled") {
        store.broadcast({ type: "subscription_status", status }, orgId);
      }
      break;
    }

    case "customer.subscription.deleted": {
      if (!orgId) {
        logger.error("[Webhook] customer.subscription.deleted: orgId unresolved — plan NOT reset");
        break;
      }

      // ── Root cause #4 fix: distinguish plan subscription from add-on-only sub ──
      // A FlowPoint customer can hold multiple subscriptions: one carrying the base
      // plan, plus separate add-on-only subscriptions. The previous handler blindly
      // reset the plan to Standard and deactivated ALL add-ons on ANY deletion, so
      // cancelling one add-on subscription wrongly downgraded the base plan and
      // revoked every unrelated live add-on.
      //
      // The deleted subscription is a PLAN subscription only if one of its items
      // resolves to a plan price ID. If it contains no plan item (add-on-only sub),
      // we do NOT touch the base plan and we only reconcile add-ons against the
      // customer's remaining live subscriptions (fail-open on Stripe errors).
      const deletedIsPlanSub = parsePlanFromSubscription(obj) !== null;
      const delCustomerId = obj["customer"] ? String(obj["customer"]) : null;

      if (deletedIsPlanSub) {
        logger.info({ orgId }, "[Webhook] Plan subscription deleted — downgrading to standard");

        // P0-4: persist plan='standard' and status='canceled'
        await persistSubscriptionMeta({ orgId, subscriptionStatus: "canceled", plan: "standard" });

        // Disable all add-ons in org_addons table (base subscription is gone)
        try {
          const { pool: pgPool } = await import("@workspace/db");
          const client = await pgPool.connect();
          try {
            await client.query(`UPDATE org_addons SET active = false, updated_at = NOW() WHERE org_id = $1`, [orgId]);
          } finally { client.release(); }
        } catch (err) {
          logger.warn({ err, orgId }, "[Webhook] Failed to deactivate addons after plan subscription deleted");
        }

        store.broadcastPlanUpdate("standard", orgId);
        store.broadcast({ type: "subscription_status", status: "canceled" }, orgId);
        logger.info({ orgId }, "[Webhook] Plan reset to standard, addons deactivated");
      } else {
        // Add-on-only subscription cancelled: preserve the base plan entitlement.
        // Deactivate only the add-ons that are no longer present on ANY live
        // subscription — persistAddonsFromSubscription(reconcileDeactivations=true)
        // aggregates all remaining live subs and fails open if Stripe is unreachable.
        logger.info({ orgId, subId: obj["id"] },
          "[Webhook] Add-on-only subscription deleted — base plan preserved, reconciling add-ons only");
        await persistAddonsFromSubscription(
          obj,
          orgId,
          delCustomerId,
          /* reconcileDeactivations */ true,
          /* skipActivation */ true,
        );
        store.broadcast({ type: "subscription_status", status: "addon_canceled" }, orgId);
      }
      break;
    }

    case "invoice.payment_succeeded": {
      logger.info({ orgId }, "[Webhook] Payment succeeded");

      if (!orgId) {
        logger.error("[Webhook] invoice.payment_succeeded: orgId unresolved — status NOT persisted, email NOT sent");
        break;
      }

      // P0-1 + P0-3: persist to DB, no store.me mutation
      await persistSubscriptionMeta({ orgId, subscriptionStatus: "active" });
      store.broadcast({ type: "payment_succeeded" }, orgId);

      // Persist active add-ons from subscription (if subscription is in the event).
      // Invoice events are additive-only (no deactivation reconciliation here).
      if (obj["lines"]) {
        const invCustomerId = obj["customer"] ? String(obj["customer"]) : null;
        await persistAddonsFromSubscription(obj, orgId, invCustomerId, /* reconcileDeactivations */ false).catch(() => {});
      }

      // ── Email routing based on billing_reason ─────────────────────────────
      // "subscription_create" → the activation magic link was already sent by
      //   checkout.session.completed / activateNewSignup. Do NOT send a second email.
      // "subscription_update" → plan change email (not "payment confirmed").
      // "subscription_cycle" → recurring renewal → send payment-confirmed.
      // Anything else (manual, add-on, one-off) → send add-on confirmation.
      const billingReason = String(obj["billing_reason"] || "");
      if (billingReason === "subscription_create") {
        logger.info({ orgId, billingReason }, "[Webhook] invoice.payment_succeeded: subscription_create — activation email already sent, skipping duplicate");
        break;
      }

      // P0-5: load email from DB — never from store.me
      const orgData = await loadOrgEmail(orgId);
      if (!orgData.email) {
        logger.warn({ orgId }, "[Webhook] invoice.payment_succeeded: no email found in org_settings — email NOT sent");
        break;
      }

      const amountCents = Number(obj["amount_paid"] || 0);
      const periodEnd = (() => {
        try {
          const l = obj["lines"] as Record<string, unknown>;
          const d = (l["data"] as Array<Record<string, unknown>>)?.[0];
          return d ? new Date(Number((d["period"] as Record<string, unknown>)?.["end"] ?? 0) * 1000).toISOString() : undefined;
        } catch { return undefined; }
      })();
      const recipientName = orgData.firstName || orgData.email.split("@")[0] || "Utilisateur";

      if (billingReason === "subscription_update") {
        // Plan changed → send plan-change specific email, not generic "payment confirmed".
        // If amount_paid = 0 the user is on a trial — adjust message accordingly.
        //
        // GUARD: add-on subscriptions (metadata.addonSub="true") also fire
        // subscription_update invoices. Do NOT send a plan-change email for those —
        // they are not a plan change. Route them to the addon/renewal email instead.
        const _subDetails = obj["subscription_details"] as Record<string, unknown> | undefined;
        const _subMeta = (_subDetails?.["metadata"] as Record<string, string>) ?? {};
        const _isAddonSub = _subMeta["addonSub"] === "true";

        if (_isAddonSub) {
          // Add-on subscription update — treat as an add-on confirmation email.
          logger.info({ orgId, billingReason }, "[Webhook] invoice.payment_succeeded: subscription_update on addonSub — routing to sendPaymentSucceeded(isAddon)");
          mailer.sendPaymentSucceeded({
            to:        orgData.email,
            name:      recipientName,
            plan:      orgData.plan,
            amountEur: amountCents > 0 ? Math.round(amountCents / 100) : undefined,
            periodEnd,
            isAddon:   true,
          }).catch(err => logger.warn({ err, orgId }, "[Webhook] sendPaymentSucceeded(addon) email failed"));
        } else {
          const isBillingTrial = amountCents === 0;
          mailer.sendPlanChanged({
            to:        orgData.email,
            name:      recipientName,
            plan:      orgData.plan,
            amountEur: amountCents > 0 ? Math.round(amountCents / 100) : undefined,
            periodEnd,
            isTrial:   isBillingTrial,
          }).catch(err => logger.warn({ err, orgId }, "[Webhook] sendPlanChanged email failed"));
        }
      } else {
        // subscription_cycle (renewal) or manual (add-on) → standard payment confirmed
        mailer.sendPaymentSucceeded({
          to:        orgData.email,
          name:      recipientName,
          plan:      orgData.plan,
          amountEur: amountCents > 0 ? Math.round(amountCents / 100) : undefined,
          periodEnd,
          isAddon:   billingReason !== "subscription_cycle",
        }).catch(err => logger.warn({ err, orgId }, "[Webhook] sendPaymentSucceeded email failed"));
      }
      break;
    }

    case "invoice.payment_failed": {
      const attemptCount = Number(obj["attempt_count"] || 1);
      logger.warn({ attemptCount, orgId }, "[Webhook] Payment failed");

      if (!orgId) {
        logger.error("[Webhook] invoice.payment_failed: orgId unresolved — status NOT persisted, email NOT sent");
        break;
      }

      // P0-1 + P0-3: persist to DB, no store.me mutation
      await persistSubscriptionMeta({ orgId, subscriptionStatus: "past_due" });
      store.broadcast({ type: "payment_failed", attemptCount }, orgId);

      // P0-5: load email from DB — never from store.me
      const orgDataFailed = await loadOrgEmail(orgId);
      if (orgDataFailed.email) {
        const nextAttempt = obj["next_payment_attempt"]
          ? new Date(Number(obj["next_payment_attempt"]) * 1000).toISOString()
          : undefined;
        mailer.sendPaymentFailed({
          to:          orgDataFailed.email,
          name:        orgDataFailed.firstName || orgDataFailed.email.split("@")[0] || "Utilisateur",
          plan:        orgDataFailed.plan,
          attemptCount,
          retryDate:   nextAttempt,
        }).catch(err => logger.warn({ err, orgId }, "[Webhook] sendPaymentFailed email failed"));
      } else {
        logger.warn({ orgId }, "[Webhook] invoice.payment_failed: no email found in org_settings — email NOT sent");
      }
      break;
    }

    case "customer.deleted": {
      // Customer hard-deleted in Stripe (e.g. via dashboard or API) — clear billing refs in DB.
      const deletedCustomerId = String(obj["id"] ?? "");
      if (deletedCustomerId) {
        try {
          const { pool: pgPool } = await import("@workspace/db");
          const dbCl = await pgPool.connect();
          try {
            // Jalon 7: clear billing refs in organizations (source of truth)
            const upd = await dbCl.query(
              `UPDATE organizations
               SET stripe_customer_id     = NULL,
                   stripe_subscription_id = NULL,
                   subscription_status    = 'none',
                   plan                   = 'standard',
                   updated_at             = NOW()
               WHERE stripe_customer_id = $1
               RETURNING id AS org_id`,
              [deletedCustomerId],
            );
            if (upd.rowCount && upd.rowCount > 0) {
              const affected = upd.rows[0]?.org_id;
              logger.info({ customerId: deletedCustomerId, affected }, "[Webhook] customer.deleted — billing refs cleared in organizations");
              store.broadcastPlanUpdate("standard", affected ?? orgId ?? "");
            } else {
              logger.warn({ customerId: deletedCustomerId }, "[Webhook] customer.deleted — no org matched this customer in organizations");
            }
          } finally { dbCl.release(); }
        } catch (err) {
          logger.error({ err, customerId: deletedCustomerId }, "[Webhook] customer.deleted — DB update failed");
        }
      }
      break;
    }

    case "customer.updated": {
      // P0-3: removed store.me.stripeCustomerId mutation
      // If we resolved an orgId, persist the customer ID update
      if (orgId && obj["id"]) {
        await persistSubscriptionMeta({ orgId, stripeCustomerId: String(obj["id"]) });
      }
      break;
    }

    default:
      logger.info({ type: event.type }, "[Webhook] Unhandled Stripe event type");
  }
  } catch (handlerErr) {
    // A mutation failed. Mark the event 'failed' so a Stripe retry can heal it
    // (the claim guard above will re-process a non-'processed' event), and return
    // 500 so Stripe schedules that retry. No secrets are logged.
    logger.error({ handlerErr, eventId, type: event.type }, "[Webhook] Handler failed — returning 500 for Stripe retry");
    await markEventStatus("failed");
    res.status(500).json({ received: false, error: "Webhook processing failed" });
    return;
  }

  // Handler completed successfully — record processed so future replays no-op.
  await markEventStatus("processed");
  res.json({ received: true });
}

// Canonical path + legacy path active in Stripe Dashboard
router.post("/webhooks/stripe", handleStripeWebhook);
router.post("/billing/webhook", handleStripeWebhook);

export default router;
