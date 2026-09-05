dy charged month 1
         (or the one-time packs). What remains server-side:
           â€¢ AI credit packs  â†’ credit them (idempotent on the intent id).
           â€¢ Recurring add-ons â†’ create the recurring subscription starting at
             month 2 (trial_end +30d â€” month 1 was just paid) and activate
             org_addons. Returning success without this would take the money
             and grant nothing.                                                */
      const _aoKeys = Object.keys(addonsResolved).filter(k => addonsResolved[k]);
      const _aoCreditPacks = _aoKeys.filter(k => AI_CREDIT_PACKS.has(k));
      const _aoRecurring   = _aoKeys.filter(k => !AI_CREDIT_PACKS.has(k) && ADDON_PRICE_IDS[k]);

      if (_aoKeys.length === 0) {
        logger.info({ planKey }, "[PublicBilling] finalize: empty cart, nothing to provision");
        res.json({ success: true, message: "Rien Ã  activer." });
        return;
      }

      /* AI credit packs â€” same idempotency key as the webhook path (acp_pi_<id>)
         so a webhook replay or a finalize retry can never double-credit. */
      const _aoCreditsMap: Record<string, number> = { aiCreditsPack50k: 50000, aiCreditsPack200k: 200000, aiCreditsPack500k: 500000 };
      let _aoTotalCredits = 0;
      if (_aoCreditPacks.length > 0) {
        try {
          // Compute totals before the DB call so we can use the idempotency key.
          _aoTotalCredits = _aoCreditPacks.reduce((s, k) => s + (_aoCreditsMap[k] ?? 0), 0);
          const _primaryPack      = _aoCreditPacks[0] ?? "";
          const _amountEurCents   = _aoCreditPacks.reduce((s, k) => s + Math.round((ADDON_DEFINITIONS[k]?.priceEur ?? 0) * 100), 0);
          const { pool: _aoPool } = await import("@workspace/db");
          const _aoC = await _aoPool.connect();
          try {
            // Key matches payment_intent.succeeded webhook: acp_pi_<intentId>
            // ON CONFLICT DO NOTHING ensures credits are granted exactly once
            // regardless of whether the webhook or finalize-checkout arrives first,
            // and even if finalize-checkout is called twice (browser reload, double-submit).
            await _aoC.query(
              `INSERT INTO ai_credit_purchases
                 (id, org_id, pack, credits, amount_eur_cents, stripe_session_id, stripe_payment_intent)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (id) DO NOTHING`,
              [`acp_pi_${intentId}`, _authenticatedOrgId, _primaryPack, _aoTotalCredits,
               _amountEurCents, "", intentId]
            );
          } finally { _aoC.release(); }
          logger.info({ orgId: _authenticatedOrgId, packs: _aoCreditPacks }, "[PublicBilling] finalize: AI credits credited (addon-only cart)");
          // Broadcast so any open dashboard tab refreshes the credits counter immediately.
          try { store.broadcast({ type: "ai:credits_added", pack: _aoCreditPacks[0] ?? "", credits: _aoTotalCredits }, _authenticatedOrgId); } catch (_) { /* non-blocking */ }
        } catch (aoCreditErr) {
          logger.error({ aoCreditErr, orgId: _authenticatedOrgId }, "[PublicBilling] finalize: AI credit insert failed");
          res.status(500).json({ error: "Paiement reÃ§u mais crÃ©dits non appliquÃ©s. Contactez le support." });
          return;
        }
      }

      /* Recurring add-ons â€” add to existing plan subscription, or create new as fallback.
         Month 1 was already charged via the PaymentIntent. */
      if (_aoRecurring.length > 0) {
        try {
          /* Ensure _authenticatedOrgId is a UUID â€” legacy email-keyed sessions must be
             resolved to their canonical organizations.id before DB writes that have a UUID FK. */
          const _aoOrigOrgId = _authenticatedOrgId; // snapshot BEFORE resolve (for diagnostics)
          try {
            const { resolveCanonicalOrgUuid: _aoResolve } = await import("../services/ai-engine.js");
            const _resolved = await _aoResolve(_authenticatedOrgId!);
            if (_resolved) _authenticatedOrgId = _resolved;
          } catch (_resolveErr) { /* non-fatal: proceed with original orgId */ }
          // Diagnostic log â€” no behavior change; helps trace UUID vs email orgId mismatch
          const _uuidFmt = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          logger.info({
            FINALIZE_ADDON_CONTEXT:       true,
            authenticatedOrgId_original:  _aoOrigOrgId        ? String(_aoOrigOrgId).slice(0, 8)        + "â€¦" : null,
            resolvedOrgId:                _authenticatedOrgId ? String(_authenticatedOrgId).slice(0, 8) + "â€¦" : null,
            resolutionSucceeded:          _authenticatedOrgId !== _aoOrigOrgId,
            isUuidOriginal:               _uuidFmt.test(_aoOrigOrgId        ?? ""),
            isUuidResolved:               _uuidFmt.test(_authenticatedOrgId ?? ""),
            addonKeys:                    _aoRecurring,
            paymentIntentId:              intentId ? String(intentId).slice(0, 20) + "â€¦" : null,
          }, "[PublicBilling] finalize: FINALIZE_ADDON_CONTEXT");

          /* Resolve the subscriber's Stripe customer (recovers deleted customers). */
          const { loadBillingContext: _aoLbc } = await import("../services/billing-context.js");
          const _aoCtx = await _aoLbc(_authenticatedOrgId);
          const { ensureStripeCustomer: _aoEnsure } = await import("../services/ensure-stripe-customer.js");
          const _aoCustomerId = intentCustomerId || await _aoEnsure(_authenticatedOrgId, _aoCtx, stripeKey);
          if (!_aoCustomerId) throw new Error("no_stripe_customer");

          await stripe.paymentMethods.attach(paymentMethodId!, { customer: _aoCustomerId }).catch(() => {});

          const _aoItems = _aoRecurring.map(k => ({
            price: ADDON_PRICE_IDS[k]!,
            quantity: typeof addonsResolved[k] === "number" ? (addonsResolved[k] as number) : 1,
          }));

          /* List all subscriptions for the customer once â€” used for both idempotency check
             and finding the existing plan subscription. */
          const _aoExisting = await stripe.subscriptions.list({ customer: _aoCustomerId, status: "all", limit: 20 });
          const _aoWanted = new Set(_aoItems.map(i => i.price));

          /* Idempotency: reuse a live add-on sub that matches this exact intent + price set. */
          const _aoReusable = _aoExisting.data.find((s: Stripe.Subscription) =>
            (s.status === "active" || s.status === "trialing") &&
            s.metadata?.["source"] === "checkout_payment_addons" &&
            s.metadata?.["origin_intent"] === intentId &&
            s.items.data.every((i: { price: { id: string } }) => _aoWanted.has(i.price.id)));

          /* Existing plan subscription: any active/trialing sub that is NOT an add-on-only sub
             created by a previous finalize-checkout. Adding items here avoids a second subscription. */
          const _aoPlanSub = !_aoReusable
            ? _aoExisting.data.find((s: Stripe.Subscription) =>
                (s.status === "active" || s.status === "trialing") &&
                !s.metadata?.["source"]?.toString().startsWith("checkout_payment_addons"))
            : null;

          let _aoSubId: string;
          if (_aoReusable) {
            _aoSubId = _aoReusable.id;
            logger.info({ subscriptionId: _aoSubId }, "[PublicBilling] finalize: reusing addon subscription (idempotent)");
          } else if (_aoPlanSub) {
            /* Add add-on items to the subscriber's existing plan subscription so no second
               subscription is created. proration_behavior:"none" because month 1 was already
               collected via the PaymentIntent â€” Stripe will bill the add-on at next renewal.
               CRITICAL: check for an existing item with the same Price ID before creating â€”
               Stripe rejects a duplicate create with "already using that Price". Use UPDATE
               (quantity++) instead. */
            for (const item of _aoItems) {
              type SubItem = { id: string; price?: { id?: string }; quantity?: number };
              const _existingAoItem: SubItem | undefined = (_aoPlanSub.items?.data ?? []).find(
                (it: SubItem) => it.price?.id === item.price
              );
              if (_existingAoItem) {
                // Price already on this subscription â€” increment quantity
                const _newQty = ((_existingAoItem as SubItem).quantity ?? 0) + (item.quantity ?? 1);
                await stripe.subscriptionItems.update(_existingAoItem.id, {
                  quantity:           _newQty,
                  proration_behavior: "none",
                });
                logger.info({ subscriptionId: _aoPlanSub.id, priceId: item.price, oldQty: _existingAoItem.quantity, newQty: _newQty },
                  "[PublicBilling] finalize: addon quantity updated on existing subscription item (idempotent create-vs-update)");
              } else {
                await (stripe as unknown as { subscriptionItems: { create: (p: Record<string, unknown>) => Promise<unknown> } })
                  .subscriptionItems.create({
                    subscription:       _aoPlanSub.id,
                    price:              item.price,
                    quantity:           item.quantity,
                    proration_behavior: "none",
                  });
              }
            }
            _aoSubId = _aoPlanSub.id;
            logger.info({ subscriptionId: _aoSubId, addons: _aoRecurring },
              "[PublicBilling] finalize: addon items added to existing plan subscription (no second sub created)");
          } else {
            /* No existing plan subscription found â€” create a new add-on subscription as fallback.
               This covers non-plan subscribers or edge cases where no active sub was found. */
            const _aoSub = await stripe.subscriptions.create({
              customer:               _aoCustomerId,
              items:                  _aoItems,
              trial_end:              Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
              default_payment_method: paymentMethodId!,
              metadata: {
                addons:         JSON.stringify(Object.fromEntries(_aoRecurring.map(k => [k, addonsResolved[k]]))),
                source:         "checkout_payment_addons",
                origin_intent:  intentId,
                flowpoint_cart: "true",
                org_id:         _authenticatedOrgId,
                orgId:          _authenticatedOrgId,
              },
            });
            _aoSubId = _aoSub.id;
          }

          /* Immediate entitlement â€” the webhook reconciliation remains the
             long-term source of truth, but the user just paid and must not
             wait on webhook latency to use what they bought. */
          const { activateAddon: _aoActivate } = await import("../services/addons-service.js");
          for (const k of _aoRecurring) {
            const qty = typeof addonsResolved[k] === "number" ? (addonsResolved[k] as number) : 1;
            await _aoActivate(k, _authenticatedOrgId, qty);
            // Broadcast so any open dashboard tab reflects the new entitlement immediately.
            try { store.broadcast({ type: "fp:addon:activated", addonKey: k }, _authenticatedOrgId); } catch (_) { /* non-blocking */ }
          }
          logger.info({ orgId: _authenticatedOrgId, addons: _aoRecurring, subscriptionId: _aoSubId },
            "[PublicBilling] finalize: addon-only purchase provisioned");
        } catch (aoErr) {
          logger.error({ aoErr, orgId: _authenticatedOrgId, addons: _aoRecurring },
            "[PublicBilling] finalize: Stripe addon sub step failed after payment â€” attempting local activation fallback");
          // Payment was already received. Attempt direct DB entitlement so the user
          // gets access immediately; the Stripe webhook will reconcile the subscription.
          // FK-aware: if the session org_id has no organizations row (FK 23503), retry
          // with the orgId embedded in the PaymentIntent metadata (set at PI creation time).
          const _piMetaOrgId: string | null = (intentMeta["org_id"] || intentMeta["orgId"]) ?? null;
          const _uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          // Candidate org IDs to try in order (deduplicated, UUIDs only)
          const _fallbackCandidates: string[] = [];
          if (_authenticatedOrgId) _fallbackCandidates.push(_authenticatedOrgId);
          if (_piMetaOrgId && _uuidRe.test(_piMetaOrgId) && _piMetaOrgId !== _authenticatedOrgId) {
            _fallbackCandidates.push(_piMetaOrgId);
          }
          try {
            const { activateAddon: _aoFallback } = await import("../services/addons-service.js");
            let _fallbackSucceeded = false;
            let _usedOrgId: string | null = null;
            for (const _candidateOrgId of _fallbackCandidates) {
              const _candidateResults = await Promise.all(_aoRecurring.map(async k => {
                const qty = typeof addonsResolved[k] === "number" ? (addonsResolved[k] as number) : 1;
                return _aoFallback(k, _candidateOrgId, qty).catch(() => false as boolean | false);
              }));
              if (_candidateResults.every(Boolean)) {
                _fallbackSucceeded = true;
                _usedOrgId = _candidateOrgId;
                // Broadcast to the org that actually received the entitlement
                for (const k of _aoRecurring) {
                  try { store.broadcast({ type: "fp:addon:activated", addonKey: k }, _candidateOrgId); } catch (_) { /* non-fatal */ }
                }
                break;
              }
              logger.warn({ candidateOrgId: _candidateOrgId ? String(_candidateOrgId).slice(0,8)+"â€¦" : null, addons: _aoRecurring },
                "[PublicBilling] finalize: fallback candidate failed â€” trying next");
            }
            if (_fallbackSucceeded) {
              logger.info({ orgId: _usedOrgId ? String(_usedOrgId).slice(0,8)+"â€¦" : null, addons: _aoRecurring },
                "[PublicBilling] finalize: local addon activation succeeded as fallback (webhook will reconcile Stripe)");
              // Update _authenticatedOrgId to the one that worked for the success response
              if (_usedOrgId && _usedOrgId !== _authenticatedOrgId) _authenticatedOrgId = _usedOrgId;
              // Fall through to the res.json success below
            } else {
              logger.error({ addons: _aoRecurring, candidates: _fallbackCandidates.map(c => c.slice(0,8)+"â€¦") },
                "[PublicBilling] finalize: local addon activation failed for all candidates");
              res.status(500).json({ error: "Paiement reÃ§u mais add-on non activÃ©. Contactez le support.", addonProvisioningFailed: true });
              return;
            }
          } catch (fallbackErr) {
            logger.error({ fallbackErr, orgId: _authenticatedOrgId },
              "[PublicBilling] finalize: fallback activation threw");
            res.status(500).json({ error: "Paiement reÃ§u mais add-on non activÃ©. Contactez le support.", addonProvisioningFailed: true });
            return;
          }
        }
      }

      res.json({
        success: true,
        checkoutType: _aoRecurring.length > 0 ? "addon_only" : "ai_credits_only",
        message:      _aoRecurring.length > 0 ? "Add-on activÃ©." : "CrÃ©dits activÃ©s.",
        // Include purchased amounts for the confirmation UI in checkout-return.html
        ..._aoTotalCredits > 0 ? { credits: _aoTotalCredits } : {},
        ..._aoRecurring.length > 0 ? { addons: _aoRecurring } : {},
      });
      return;
    }

    /* â”€â”€ 2. Resolve or create Stripe customer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
       Priority: (a) customer already attached to the intent (set by payment-intent
       endpoint when pre_register_token present â€” enforces 1 email = 1 customer)
       > (b) email search on payment method billing details
       > (c) pending_signups.stripe_customer_id via pre_register_token
       > (d) last resort: create new.
    â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    let customerId: string | null = intentCustomerId;
    let hasSubscriptionHistory    = false;

    if (customerId) {
      try {
        const _fcEc = await stripe.customers.retrieve(customerId);
        if ((_fcEc as { deleted?: boolean }).deleted) {
          customerId = null;
        } else {
          const _fcPrevSubs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 1 });
          hasSubscriptionHistory = _fcPrevSubs.data.length > 0;
          logger.info({ customerId, hasSubscriptionHistory }, "[PublicBilling] finalize: using customer from intent");
        }
      } catch { customerId = null; }
    }

    if (!customerId) {
      // (b) email from payment method billing details
      const _fcPm    = await stripe.paymentMethods.retrieve(paymentMethodId!);
      const _fcEmail = _fcPm.billing_details?.email ?? null;
      if (_fcEmail) {
        const _fcExisting = await stripe.customers.list({ email: _fcEmail, limit: 5 });
        for (const _fcEc2 of _fcExisting.data) {
          if ((_fcEc2 as { deleted?: boolean }).deleted) continue;
          const _fcSubs = await stripe.subscriptions.list({ customer: _fcEc2.id, status: "all", limit: 1 });
          if (_fcSubs.data.length > 0) {
            customerId = _fcEc2.id; hasSubscriptionHistory = true;
            logger.info({ customerId, email: _fcEmail }, "[PublicBilling] finalize: reusing Stripe customer (has history)");
            break;
          }
          if (!customerId) customerId = _fcEc2.id;
        }
      }
    }

    if (!customerId) {
      // (c) pending_signups.stripe_customer_id via pre_register_token
      const _fcPrt = preRegisterToken || intentMeta["pre_register_token"] || "";
      if (_fcPrt) {
        try {
          const { pool: _fcPsPool } = await import("@workspace/db");
          const _fcPsC = await _fcPsPool.connect();
          try {
            const _fcPsR = await _fcPsC.query(
              `SELECT stripe_customer_id FROM pending_signups WHERE token = $1 AND consumed_at IS NULL LIMIT 1`,
              [_fcPrt]
            );
            if (_fcPsR.rows[0]?.stripe_customer_id) {
              customerId = _fcPsR.rows[0].stripe_customer_id;
              logger.info({ customerId }, "[PublicBilling] finalize: found customer via pre_register_token");
            }
          } finally { _fcPsC.release(); }
        } catch { /* non-fatal */ }
      }
    }

    if (!customerId) {
      // (d) last resort: create new customer
      const _fcPm2   = paymentMethodId ? await stripe.paymentMethods.retrieve(paymentMethodId).catch(() => null) : null;
      const _fcEmail2 = _fcPm2?.billing_details?.email ?? null;
      const _fcOrgForMeta = intentMeta["orgId"] || intentMeta["org_id"] || _authenticatedOrgId;
      const _fcNewC = await stripe.customers.create({
        ...(_fcEmail2 ? { email: _fcEmail2 } : {}),
        payment_method: paymentMethodId!,
        invoice_settings: { default_payment_method: paymentMethodId! },
        metadata: {
          source: "checkout_payment", plan: planKey,
          ...(_fcOrgForMeta ? { orgId: _fcOrgForMeta, org_id: _fcOrgForMeta } : {}),
        },
      });
      customerId = _fcNewC.id;
      logger.warn({ customerId }, "[PublicBilling] finalize: new Stripe customer created (last resort â€” check for duplicates)");
    }

    // Attach payment method to resolved customer â€” idempotent guard to avoid 400
    // "PaymentMethod already attached" when finalize-checkout is called twice.
    const _pmInfo = await stripe.paymentMethods.retrieve(paymentMethodId!).catch(() => null);
    const _pmAlreadyOnCustomer = _pmInfo?.customer && _pmInfo.customer === customerId!;
    if (!_pmAlreadyOnCustomer) {
      await stripe.paymentMethods.attach(paymentMethodId!, { customer: customerId! }).catch((pmErr: { message?: string }) => {
        const msg = String(pmErr?.message ?? pmErr ?? "");
        if (msg.includes("already been attached") || msg.includes("already attached")) {
          logger.info({ paymentMethodId, customerId }, "[PublicBilling] finalize: PM already attached â€” skipping (idempotent)");
        } else {
          logger.error({ pmErr, paymentMethodId, customerId }, "[PublicBilling] finalize: PM attach failed");
        }
      });
    } else {
      logger.info({ paymentMethodId, customerId }, "[PublicBilling] finalize: PM already on customer â€” skipping attach (idempotent)");
    }

    // Keep the canonical billing record in sync before creating the subscription.
    // A trial checkout may create the Stripe customer before the activation
    // webhook creates the UUID organization; persistOrgData mirrors safely for
    // pre-registration IDs and writes organizations for authenticated accounts.
    const _UUID_RE_FC = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    try {
      const { persistOrgData: persistCheckoutCustomer } = await import("../services/org-data.js");
      await persistCheckoutCustomer(_authenticatedOrgId, { stripeCustomerId: customerId! });
      logger.info({ orgId: _authenticatedOrgId, customerId }, "[PublicBilling] finalize: Stripe customer linked to organization");
    } catch (customerPersistErr) {
      // Do not abandon a successful Stripe confirmation; the later subscription
      // persistence/webhook remains a recovery path, but make the gap visible.
      logger.error({ customerPersistErr, orgId: _authenticatedOrgId, customerId },
        "[PublicBilling] finalize: could not link Stripe customer to organization");
    }

    // P0 UUID anchor: when _authenticatedOrgId is email-keyed (pre-register flow),
    // the persist above writes to org_settings[email] only. Also anchor the customer ID
    // to the UUID org so ESC finds it on re-subscription without creating a duplicate.
    let _fcResolvedUuidEarly: string | null = null;
    if (!_UUID_RE_FC.test(_authenticatedOrgId) && customerId) {
      try {
        const { pool: _fcUuidEarlyPool } = await import("@workspace/db");
        const _fcUuidEarlyC = await _fcUuidEarlyPool.connect();
        try {
          const _fcUuidEarlyR = await _fcUuidEarlyC.query<{ id: string }>(
            `SELECT id::text FROM organizations WHERE lower(owner_email) = lower($1) LIMIT 1`,
            [_authenticatedOrgId]
          );
          _fcResolvedUuidEarly = _fcUuidEarlyR.rows[0]?.id ?? null;
        } finally { _fcUuidEarlyC.release(); }

        if (_fcResolvedUuidEarly) {
          const { persistOrgData: _fcPodUuidEarly } = await import("../services/org-data.js");
          await _fcPodUuidEarly(_fcResolvedUuidEarly, { stripeCustomerId: customerId! });
          logger.info({ orgId: _fcResolvedUuidEarly, customerId }, "[PublicBilling] finalize: Stripe customer anchored to UUID org (pre-register path)");
        }
      } catch (_fcUuidEarlyErr) {
        logger.warn({ _fcUuidEarlyErr, orgId: _authenticatedOrgId }, "[PublicBilling] finalize: UUID org early anchor failed (non-fatal)");
      }
    }

    /* â”€â”€ Enrich Customer: merge Stripe Address Element data + pending_signups â”€â”€
       Source priority:
         â€¢ name/email   â†’ pending_signups (signup data) > pm.billing_details
         â€¢ address      â†’ pm.billing_details (Stripe Address Element) > pending_signups
       This guarantees 1 Customer with complete identity, billing address and locale.
    â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    try {
      /* 1. Retrieve PM billing_details â€” populated by Stripe Address Element on confirm */
      const _fcPmFull = await stripe.paymentMethods.retrieve(paymentMethodId!).catch(() => null);
      const _fcPmBd   = (_fcPmFull?.billing_details ?? null) as {
        name?:    string | null;
        email?:   string | null;
        address?: { line1?: string | null; line2?: string | nuldW'"Â7W7FöÖW$–BÒÂ%µV&Æ–4&–ÆÆ–æuÒf–æÆ—¦S¢ÖWFFFæ÷&ÖÆ—¦F–öâæöâÖfFÂ"“°¢Ð ¢òò)H)H&R×&Vv—7G&F–öã¢7F—fFRæWrW6W"66÷VçBæBFVÆ—fW"Öv–2Æ–æ²)H)H)H)H ¢òò7V66W76gVÂf–æÆ—¦F–öâ×W7BæWfW"6Æ–ÒF†BÆöv–âVÖ–Âv26Vç@¢òò&Vf÷&RF†R66÷VçBÂFö¶VâæBFVÆ—fW'’†fRÆÂ6ö×ÆWFVB7V66W76gVÆÇ’à¢6öç7Böf47EFö¶VâÒ&U&Vv—7FW%Fö¶VâÇÂ–çFVçDÖWF²'&U÷&Vv—7FW%÷Fö¶Vâ%ÒÇÂ"#°¢ÆövvW"æ–æfò‡°¢7FW¢$d2Ó"À¢–çFVçD–C¢†–çFVçD–B27G&–ær“òç6Æ–6RƒÂ#’À¢–çFVçEG—RÀ¢Æä¶W’À¢†5&U&VuFö¶Vã¢öf47EFö¶VâÀ¢Fö¶Vå&Vf—ƒ¢öf47EFö¶Vãòç6Æ–6RƒÂ‚’ÇÂ"†æöæR’"À¢†56W76–öä6öö¶–S¢öf6µFö¶VâÀ¢WF†VçF–6FVD÷&t–C¢öWF†VçF–6FVD÷&t–Còç6Æ–6RƒÂ3’À¢ÒÂ%´d5Òf–æÆ—¦RÖ6†V6¶÷WB&V6†VB7F—fF–öâvFR"“° ¢–b…öf47EFö¶Vâ’°¢ÆWBöf47F—fF–öä6öÖÖ—GFVBÒfÇ6S°¢G'’°¢6öç7B²ööÃ¢öf47EööÂÒÒv—B–×÷'B‚$v÷&·76RöF""“°¢6öç7B²&æFöÔ'—FW3¢öf5&"ÒÒv—B–×÷'B‚&7'—Fò"“° ¢òò)H)H7FW¢Æöö²WVæF–æu÷6–vçW)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢ÆövvW"æ–æfò‡²7FW¢$d2Ó"ÂFö¶Vã¢öf47EFö¶Vâç6Æ–6RƒÂ‚’ÒÂ%´d5Ò7FWÓ¢VW'––ærVæF–æu÷6–vçW2"“°¢6öç7Böf47D3Òv—Böf47EööÂæ6öææV7B‚“°¢ÆWBöf56–vçW¢&V6÷&CÇ7G&–ærÂ7G&–ærÂçVÆÃâÂçVÆÂÒçVÆÃ°¢òòöf5VæF–æu&÷r—26fVB÷WG6–FRF†RG'’6òd2Ó×6¶—6â&VBF†RVÖ–À¢ÆWBöf5VæF–æu&÷s¢&V6÷&CÇ7G&–ærÂ7G&–ærÂçVÆÃâÂçVÆÂÒçVÆÃ°¢G'’°¢6öç7Böf47E#Òv—Böf47D3çVW'’€¢4TÄT5BVÖ–ÂÂf—'7EöæÖRÂÆ7EöæÖRÂ6ö×ç•öæÖRÂ6÷VçG'’ÂFG&W72Â6—G’À¢÷7FÅö6öFRÂ†öæRÂfBÂ6öç7VÖVEöBÂW‡—&W5ö@¢e$ôÒVæF–æu÷6–vçW0¢t„U$RFö¶VâÒCäBW‡—&W5öBâäõr‚’Ä”Ô•BÀ¢µöf47EFö¶VåÐ¢“°¢öf5VæF–æu&÷rÒöf47E#ç&÷w5³ÒóòçVÆÃ°¢ÆövvW"æ–æfò‡°¢7FW¢$d2Ó×&W7VÇB"À¢f÷VæC¢öf5VæF–æu&÷rÀ¢6öç7VÖVC¢öf5VæF–æu&÷ròöf5VæF–æu&÷u²&6öç7VÖVEöB%Ò¢çVÆÂÀ¢VÖ–Ã¢öf5VæF–æu&÷sòå²&VÖ–Â%ÒÀ¢W‡—&W3¢öf5VæF–æu&÷sòå²&W‡—&W5öB%ÒÀ¢ÒÂ%´d5Ò7FWÓ¢VæF–æu÷6–vçWÆöö·W&W7VÇB"“°¢öf56–vçWÒ…öf5VæF–æu&÷rbböf5VæF–æu&÷u²&6öç7VÖVEöB%Ò’òöf5VæF–æu&÷r¢çVÆÃ°¢Òf–æÆÇ’²öf47D3ç&VÆV6R‚“²Ð ¢–b‚öf56–vçW’°¢òòFö¶VâÇ&VG’6öç7VÖVB‡vV&†öö²Ç&VG’7F—fFVBF†R66÷VçB’÷"æ÷Bf÷VæBà¢òòF†RvV&†öö²6†÷VÆB†fR6VçBF†RÖv–2Æ–æ²VÖ–ÂÂ'WB–b—Bf–ÆVBvR×W7@¢òò&R×6VæBæ÷r6òF†RW6W"—6âwBÆVgBv—F‚&Ææ²–æ&÷‚gFW"6VV–ær&6†V6²–÷W"VÖ–Â"à¢ÆövvW"æ–æfò‡²7FW¢$d2Ó×6¶—"ÂFö¶Vã¢öf47EFö¶Vâç6Æ–6RƒÂ‚’ÒÂ%´d5Ò7FWÓ¢Fö¶Vâ6öç7VÖVBöÖ—76–ær(	BGFV×F–ærVÖ–Â&R×6VæB"“°¢6öç7B÷6¶—VÖ–ÂÒöf5VæF–æu&÷sòå²&VÖ–Â%ÒóòçVÆÃ°¢–b…÷6¶—VÖ–Â’°¢òò)H)Hd2Ó×6¶—&W6VæC¢f–æBW†—7F–ærfÆ–BFö¶Vâ÷"Ö–çBg&W6‚öæR)H)H ¢6öç7B÷&U6VæD2Òv—Böf47EööÂæ6öææV7B‚“°¢ÆWB÷&U6VæDö²ÒfÇ6S°¢ÆWB÷&U6VæDVÖ–Ä–C¢7G&–ærÂVæFVf–æVC°¢G'’°¢6öç7BöW†—7EFö²Òv—B÷&U6VæD2çVW'“Ç²Fö¶Vã¢7G&–ærÓâ€¢4TÄT5BFö¶Vâe$ôÒÖv–5öÆ–æµ÷Fö¶Vç0¢t„U$RVÖ–ÂÒCäBW6VBÒdÅ4RäBW‡—&W5öBâäõr‚¢õ$DU"%’W‡—&W5öBDU42Ä”Ô•BÀ¢µ÷6¶—VÖ–ÅÐ¢“°¢ÆWB÷&UFö¶VâÒöW†—7EFö²ç&÷w5³ÓòçFö¶VâóòçVÆÃ°¢–b‚÷&UFö¶Vâ’°¢òòæòfÆ–BFö¶VâÆVgB(	BÖ–çBg&W6‚öæP¢÷&UFö¶VâÒöf5&"ƒ3"’çFõ7G&–ær‚&†W‚"“°¢v—B÷&U6VæD2çVW'’€¢”å4U%B”åDòÖv–5öÆ–æµ÷Fö¶Vç2‡Fö¶VâÂVÖ–ÂÂW‡—&W5öBÂW6VB¢dÅTU2‚CÂC"Âäõr‚’²”åDU%dÂs#B†÷W'2rÂdÅ4R¢ôâ4ôädÄ”5B‡Fö¶Vâ’DòäõD„”ävÀ¢µ÷&UFö¶VâÂ÷6¶—VÖ–ÅÐ¢“°¢ÆövvW"æ–æfò‡²7FW¢$d2Ó×6¶—ÖæWr×Fö¶Vâ"ÂFö¶Vå&Vf—ƒ¢÷&UFö¶Vâç6Æ–6RƒÂ‚’ÒÂ%´d5Òd2Ó×6¶—¢7&VFVBg&W6‚Öv–2Æ–æ²Fö¶Vâ"“°¢ÒVÇ6R°¢ÆövvW"æ–æfò‡²7FW¢$d2Ó×6¶—×&WW6R×Fö¶Vâ"ÂFö¶Vå&Vf—ƒ¢÷&UFö¶Vâç6Æ–6RƒÂ‚’ÒÂ%´d5Òd2Ó×6¶—¢&WW6–ærW†—7F–ærfÆ–BFö¶Vâ"“°¢Ð¢6öç7B÷&UV%W&ÂÒ&ö6W72æVçe²%T$Ä”5õU$Â%ÒÇÂ&‡GG3¢òöæfÆ÷wö–çBç&ò#°¢6öç7B÷&TÖv–5W&ÂÒGµ÷&UV%W&ÇÒöÆöv–â×fW&–g’æ‡FÖÃ÷Fö¶VãÒGµ÷&UFö¶VçÖ°¢6öç7B²Ö–ÆW#¢÷&TÖ–ÆW"ÒÒv—B–×÷'B‚"ââ÷6W'f–6W2öÖ–ÆW"æ§2"’æ6F6‚‚‚’Óâ‡²Ö–ÆW#¢çVÆÂÒ’“°¢–b…÷&TÖ–ÆW"’°¢6öç7B÷&U&W7VÇBÒv—B÷&TÖ–ÆW"ç6VæD7F—fF–öäÖv–4Æ–æ²‡°¢Fó¢÷6¶—VÖ–ÂÀ¢æÖS¢öf5VæF–æu&÷sòå²&f—'7EöæÖR%ÒÇÂ÷6¶—VÖ–Âç7Æ—B‚$"•³ÒÀ¢Æã¢Æä¶W’À¢Öv–4Æ–æµW&Ã¢÷&TÖv–5W&ÂÀ¢—5G&–Ã¢w&çEG&–ÂÀ¢Ò’æ6F6‚‚†S¢Væ¶æ÷vâ’Óâ‡²ö³¢fÇ6R26öç7BÂW'&÷#¢7G&–ær†R’Ò’“°¢÷&U6VæDö²Ò÷&U&W7VÇCòæö³°¢÷&U6VæDVÖ–Ä–BÒ…÷&U&W7VÇB2²–Có¢7G&–ærÒ“òæ–C°¢ÆövvW"æ–æfò‡²7FW¢$d2Ó×6¶—ÖÖ–Â"Âö³¢÷&U6VæDö²ÂVÖ–Ä–C¢÷&U6VæDVÖ–Ä–BÂW'&÷#¢…÷&U&W7VÇB2²W'&÷#ó¢7G&–ærÒ“òæW'&÷"ÒÂ%´d5Òd2Ó×6¶—¢&R×6VæB&W7VÇB"“°¢ÒVÇ6R°¢ÆövvW"çv&â‡²7FW¢$d2Ó×6¶—ÖæòÖÖ–ÆW""ÒÂ%´d5Òd2Ó×6¶—¢Ö–ÆW"Væf–Æ&ÆR"“°¢Ð¢Ò6F6‚…÷&U6VæDW'"’°¢ÆövvW"æW'&÷"‡²7FW¢$d2Ó×6¶—×&W6VæBÖW'""ÂW'#¢…÷&U6VæDW'"2W'&÷"’æÖW76vRÒÂ%´d5Òd2Ó×6¶—¢&R×6VæBF‡&Wr"“°¢Òf–æÆÇ’²÷&U6VæD2ç&VÆV6R‚“²Ð ¢&W2æ§6öâ‡°¢7V66W73¢G'VRÀ¢7V'67&—F–öä–C¢Æå7V'67&—F–öãòæ–BÀ¢FFöå7V'67&—F–öä–BÀ¢7F—fF–öäVÖ–Å6VçC¢÷&U6VæDö²À¢âââ…÷&U6VæDö²ò·Ò¢²VÖ–Äf–ÆVC¢G'VRÒ’À¢Ò“°¢&WGW&ã°¢Ð¢òòæòVÖ–Âf÷VæB–âVæF–æu÷6–vçW&÷r(	BFö¶Vâv2æWfW"–âD"†–çfÆ–B¢&W2æ§6öâ‡°¢7V66W73¢G'VRÀ¢7V'67&—F–öä–C¢Æå7V'67&—F–öãòæ–BÀ¢FFöå7V'67&—F–öä–BÀ¢7F—fF–öäVÖ–Å6VçC¢fÇ6RÀ¢VÖ–Äf–ÆVC¢G'VRÀ¢Ò“°¢&WGW&ã°¢Ð ¢6öç7Böf4VÖ–ÂÒöf56–vçW²&VÖ–Â%ÒóòöWF†VçF–6FVD÷&t–C°¢6öç7B²&æFöÕUT”C¢öf5&æEUT”BÒÒv—B–×÷'B‚&7'—Fò"“°¢6öç7Böf4÷&t–BÒöf5&æEUT”B‚“°¢ÆövvW"æ–æfò‡²7FW¢$d2Ó""ÂVÖ–Ã¢öf4VÖ–ÂÂæWt÷&t–C¢öf4÷&t–BÂÆä¶W’Âw&çEG&–ÂÂ7W7FöÖW$–BÒÂ%´d5Ò7FWÓ#¢–FVçF–f–W'2&W6öÇfVB"“° ¢òò)H)H7FW3¢6VÆbÖ†VÂDDÂ†WFòÖ6öÖÖ—BÂ÷WG6–FRG&ç67F–öâ’)H)H)H)H ¢ÆövvW"æ–æfò‡²7FW¢$d2Ó2"ÒÂ%´d5Ò7FWÓ3¢'Vææ–ærDDÂ6VÆbÖ†VÇ2öâ—6öÆFVB6öææV7F–öâ"“°¢°¢6öç7Böf56VÆd†VÄ2Òv—Böf47EööÂæ6öææV7B‚“°¢G'’°¢6öç7B÷6…'VâÒ7–æ2‡7Ã¢7G&–ærÂÆ&VÃ¢7G&–ær’Óâ°¢G'’°¢v—Böf56VÆd†VÄ2çVW'’‡7Â“°¢ÆövvW"æ–æfò‡²7FW¢$d2Ó2"ÂÆ&VÂÂö³¢G'VRÒÂ%´d5Ò6VÆbÖ†VÂö²"“°¢Ò6F6‚†R’°¢ÆövvW"çv&â‡²7FW¢$d2Ó2"ÂÆ&VÂÂW'#¢†R2W'&÷"’æÖW76vRÂ6öFS¢†R2&V6÷&CÇ7G&–ærÇVæ¶æ÷vãâ•²&6öFR%ÒÒÂ%´d5Ò6VÆbÖ†VÂv&â†æöâÖfFÂ’"“°¢Ð¢Ó°¢v—B÷6…'Vâ†ÅDU"D$ÄRW6W'2DB4ôÅTÔâ”bäõBU„•5E2f—'7EöæÖRDU…FÂ'W6W'2æf—'7EöæÖR"“°¢v—B÷6…'Vâ†ÅDU"D$ÄRW6W'2DB4ôÅTÔâ”bäõBU„•5E2Æ7EöæÖRDU…FÂ'W6W'2æÆ7EöæÖR"“°¢v—B÷6…'Vâ†ÅDU"D$ÄRW6W'2DB4ôÅTÔâ”bäõBU„•5E27FGW2DU…BäõBåTÄÂDTdTÅBwVæF–ærvÂ'W6W'2ç7FGW2"“°¢v—B÷6…'Vâ†ÅDU"D$ÄRW6W'2DB4ôÅTÔâ”bäõBU„•5E2VÖ–Å÷fW&–f–VB$ôôÄTâäõBåTÄÂDTdTÅBdÅ4VÂ'W6W'2æVÖ–Å÷fW&–f–VB"“°¢v—B÷6…'Vâ†ÅDU"D$ÄRW6W'2DB4ôÅTÔâ”bäõBU„•5E2WFFVEöBD”ÔU5DÕE¢DTdTÅBäõr‚–Â'W6W'2çWFFVEöB"“°¢v—B÷6…'Vâ†ÅDU"D$ÄR÷&væ—¦F–öç2DB4ôÅTÔâ”bäõBU„•5E2WFFVEöBD”ÔU5DÕE¢DTdTÅBäõr‚–Â&÷&w2çWFFVEöB"“°¢òò5$•D”4Ã¢ôâ4ôädÄ”5B†VÖ–Â’&WV—&W2Tä•TR–æFW‚à¢òò5$TDRD$ÄR”bäõBU„•5E2—2æòÖ÷öâW†—7F–ærF&ÆW2Â6òF†R–æÆ–æP¢òò4ôå5E$”åB—2æWfW"&WG&ö7F—fVÇ’Æ–VBFò&RÖW†—7F–ærF&ÆW2à¢v—B÷6…'Vâ†5$TDRTä•TR”äDU‚”bäõBU„•5E2W6W'5öVÖ–Å÷Væ—VRôâW6W'2†VÖ–Â–Â'W6W'5öVÖ–Å÷Væ—VR"“°¢Òf–æÆÇ’²öf56VÆd†VÄ2ç&VÆV6R‚“²Ð¢Ð ¢òò)H)H7FWC¢7F—fF–öâG&ç67F–öâ)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢ÆövvW"æ–æfò‡²7FW¢$d2ÓB"ÂVÖ–Ã¢öf4VÖ–ÂÂ÷&t–C¢öf4÷&t–BÂÆä¶W’Â7W7FöÖW$–BÒÂ%´d5Ò7FWÓC¢$Tt”â7F—fF–öâG&ç67F–öâ"“°¢6öç7Böf47EG„2Òv—Böf47EööÂæ6öææV7B‚“°¢G'’°¢v—Böf47EG„2çVW'’‚$$Tt”â"“° ¢òòF(	BW6W'BW6W ¢ÆövvW"æ–æfò‡²7FW¢$d2ÓF"ÂVÖ–Ã¢öf4VÖ–ÂÒÂ%´d5Ò7FWÓF¢”å4U%B”åDòW6W'2"“°¢6öç7Böf4æWuW6W$–BÒöf5&æEUT”B‚“°¢6öç7Böf5W7"Òv—Böf47EG„2çVW'“Ç²–C¢7G&–ærÓâ€¢”å4U%B”åDòW6W'2†–BÂVÖ–ÂÂf—'7EöæÖRÂÆ7EöæÖRÂWF…÷&÷f–FW"ÂVÖ–Å÷fW&–f–VBÂ7FGW2¢dÅTU2‚CBÂCÂC"ÂC2ÂvÖv–5öÆ–æ²rÅE%TRÂv7F—fRr¢ôâ4ôädÄ”5B†VÖ–Â’DòUDDP¢4UB7FGW3Òv7F—fRrÂVÖ–Å÷fW&–f–VCÕE%TRÀ¢f—'7EöæÖSÔ4ôÄU44R„U„4ÅTDTBæf—'7EöæÖRÇW6W'2æf—'7EöæÖR’ÂWFFVEöCÔäõr‚¢$UEU$ä”är–FÀ¢µöf4VÖ–ÂÂöf56–vçW²&f—'7EöæÖR%Òóò""Âöf56–vçW²&Æ7EöæÖR%Òóò""Âöf4æWuW6W$–EÐ¢“°¢6öç7Böf5W6W$–BÒöf5W7"ç&÷w5³Óòæ–C°¢ÆövvW"æ–æfò‡²7FW¢$d2ÓFÖö²"ÂW6W$–C¢öf5W6W$–BÒÂ%´d5Ò7FWÓF¢W6W"W6W'FVB"“°¢–b‚öf5W6W$–B’F‡&÷ræWrW'&÷"‚'W6W'BW6W"&WGW&æVBæò–Bf÷""²öf4VÖ–Â“° ¢òòF"(	BW6W'B÷&væ—¦F–öà¢ÆövvW"æ–æfò‡²7FW¢$d2ÓF""Â÷&t–C¢öf4÷&t–BÒÂ%´d5Ò7FWÓF#¢”å4U%B”åDò÷&væ—¦F–öç2"“°¢v—Böf47EG„2çVW'’€¢”å4U%B”åDò÷&væ—¦F–öç0¢†–BÆæÖRÇ6ÇVrÆ÷væW%÷W6W%ö–BÇ7FGW2ÇÆâÇ7V'67&—F–öå÷7FGW2Æ÷væW%öVÖ–ÂÇ7G&—Uö7W7FöÖW%ö–BÇG&–ÅöVæG5öB¢dÅTU2‚CÂC"ÂC2ÂCBÂv7F—fRrÂCRÂCbÂCrÂC‚ÂC’¢ôâ4ôädÄ”5B†–B’DòUDDP¢4UB7FGW3Òv7F—fRrÂÆãÔU„4ÅTDTBçÆâÂ7V'67&—F–öå÷7FGW3ÔU„4ÅTDTBç7V'67&—F–öå÷7FGW2À¢7G&—Uö7W7FöÖW%ö–CÔ4ôÄU44R„U„4ÅTDTBç7G&—Uö7W7FöÖW%ö–BÆ÷&væ—¦F–öç2ç7G&—Uö7W7FöÖW%ö–B’À¢WFFVEöCÔäõr‚–À¢°¢öf4÷&t–BÂöf56–vçW²&6ö×ç•öæÖR%Òóòöf4VÖ–ÂÀ¢öf4÷&t–Bç&WÆ6R‚õµæ×£Ó•Òöv’Â"Ò"’çFôÆ÷vW$66R‚’ç6Æ–6RƒÃc’À¢öf5W6W$–BÂÆä¶W’Âw&çEG&–Âò'G&–Æ–ær"¢&7F—fR"À¢öf4VÖ–ÂÂ7W7FöÖW$–BóòçVÆÂÀ¢G&–ÄVæEVæ—‚ÓÒVæFVf–æVBòæWrFFR‡G&–ÄVæEVæ—‚¢’çFô•4õ7G&–ær‚’¢çVÆÂÀ¢Ð¢“°¢ÆövvW"æ–æfò‡²7FW¢$d2ÓF"Öö²"ÒÂ%´d5Ò7FWÓF#¢÷&væ—¦F–öâW6W'FVB"“° ¢òòF2(	BW6W'BÖVÖ&W'6†— ¢ÆövvW"æ–æfò‡²7FW¢$d2ÓF2"ÒÂ%´d5Ò7FWÓF3¢”å4U%B”åDò÷&væ—¦F–öåöÖVÖ&W'2"“°¢v—Böf47EG„2çVW'’€¢”å4U%B”åDò÷&væ—¦F–öåöÖVÖ&W'2†÷&væ—¦F–öåö–BÇW6W%ö–BÇ&öÆRÇ7FGW2¢dÅTU2‚CÂC"Âv÷væW"rÂv7F—fRr¢ôâ4ôädÄ”5B†÷&væ—¦F–öåö–BÇW6W%ö–B’DòUDDR4UB7FGW3Òv7F—fRrÇ&öÆSÒv÷væW"rÇWFFVEöCÔäõr‚–À¢µöf4÷&t–BÂöf5W6W$–EÐ¢“°¢ÆövvW"æ–æfò‡²7FW¢$d2ÓF2Öö²"ÒÂ%´d5Ò7FWÓF3¢÷&væ—¦F–öåöÖVÖ&W'2W6W'FVB"“° ¢òòFB(	B6öç7VÖRVæF–æu÷6–vçWFö¶Và¢ÆövvW"æ–æfò‡²7FW¢$d2ÓFB"ÒÂ%´d5Ò7FWÓFC¢UDDRVæF–æu÷6–vçW24UB6öç7VÖVEöB"“°¢v—Böf47EG„2çVW'’€¢UDDRVæF–æu÷6–vçW24UB6öç7VÖVEöCÔäõr‚’t„U$RFö¶VãÒCäB6öç7VÖVEöB•2åTÄÆÀ¢µöf47EFö¶VåÐ¢“°¢ÆövvW"æ–æfò‡²7FW¢$d2ÓFBÖö²"ÒÂ%´d5Ò7FWÓFC¢VæF–æu÷6–vçW6öç7VÖVB"“° ¢òòFR(	B6öÖÖ—@¢ÆövvW"æ–æfò‡²7FW¢$d2ÓFR"ÒÂ%´d5Ò7FWÓFS¢4ôÔÔ•B"“°¢v—Böf47EG„2çVW'’‚$4ôÔÔ•B"“°¢öf47F—fF–öä6öÖÖ—GFVBÒG'VS°¢ÆövvW"æ–æfò‡²7FW¢$d2ÓBÔ4ôÔÔ•EDTB"Â÷&t–C¢öf4÷&t–BÂW6W$–C¢öf5W6W$–BÂÆã¢Æä¶W’ÒÂ%´d5ÒE$å45D”ôâ4ôÔÔ•EDTB(	BW6W"²÷&r7F—fFVB"“° ¢òò)H)H7FWFc¢&÷vFR6–vçW6öçF7BöFG&W72–çFò÷&u÷6WGF–æw2)H)H ¢òò†æöâÖfFÂ(	B&öf–ÆRFFöæÇ’ÂæWfW"&–ÆÆ–ærFF’âv—F†÷WBF†—2À¢òò66÷VçG27F—fFVBf–f–æÆ—¦RÖ6†V6¶÷WB‡vV&†öö²Æ÷7B÷6Æ÷r’æWfW ¢òò6VRF†V—"6–vçWFG&W72–âv÷&·76Rõ6WGF–æw2ôÆö6Æ—6F–öâà¢G'’°¢6öç7B²W6W'D÷&u6WGF–æw3¢öf5W6W'D÷2ÂÆöD÷&u6WGF–æw3¢öf4ÆöD÷2ÒÒv—B–×÷'B‚"ââ÷6W'f–6W2ö÷&r×6WGF–æw2æ§2"“°¢6öç7Böf4÷4W†—7F–ærÒv—Böf4ÆöD÷2…öf4÷&t–B’æ6F6‚‚‚’ÓâçVÆÂ“°¢6öç7Böf4†4FG"Ò…öf56–vçW²&FG&W72%ÒÇÂöf56–vçW²&6—G’%ÒÇÂöf56–vçW²&6÷VçG'’%ÒÇÂöf56–vçW²'†öæR%Ò“°¢–b‚öf4÷4W†—7F–ær’°¢v—Böf5W6W'D÷2…öf4÷&t–BÂ°¢VÖ–Ã¢öf4VÖ–ÂÀ¢÷&tæÖS¢öf56–vçW²&6ö×ç•öæÖR%Òóò""À¢f—'7DæÖS¢öf56–vçW²&f—'7EöæÖR%Òóò""À¢Æ7DæÖS¢öf56–vçW²&Æ7EöæÖR%Òóò""À¢6÷VçG'“¢öf56–vçW²&6÷VçG'’%ÒóòçVÆÂÀ¢6—G“¢öf56–vçW²&6—G’%ÒóòçVÆÂÀ¢FG&W73¢öf56–vçW²&FG&W72%ÒóòçVÆÂÀ¢÷7FÄ6öFS¢öf56–vçW²'÷7FÅö6öFR%ÒóòçVÆÂÀ¢†öæS¢öf56–vçW²'†öæR%ÒóòçVÆÂÀ¢fC¢öf56–vçW²'fB%ÒóòçVÆÂÀ¢Æö6F–öä6öæf–wW&VC¢…öf56–vçW²&6—G’%ÒÇÂöf56–vçW²&FG&W72%Ò’À¢Æö6F–öå6÷W&6S¢&ÖçVÂ"À¢Ò“°¢ÆövvW"æ–æfò‡²7FW¢$d2ÓFb"Â÷&t–C¢öf4÷&t–BÒÂ%´d5Ò7FWÓFc¢÷&u÷6WGF–æw2&öf–ÆR&÷r7&VFVBg&öÒ6–vçWFF"“°¢ÒVÇ6R–b…öf4†4FG"bböf4÷4W†—7F–æræFG&W72bböf4÷4W†—7F–æræ6—G’’°¢òòW†—7F–ær&öf–ÆR&÷rv—F†÷WBç’FG&W72(	Bf–ÆÂF†RÖ—76–æp¢òò6öçF7Bf–VÆG2g&öÒF†R6–vçWf÷&Ò†æWfW"÷fW'w&—FRfÇVW2’à¢v—Böf5W6W'D÷2…öf4÷&t–BÂ°¢6÷VçG'“¢öf4÷4W†—7F–æræ6÷VçG'’óòöf56–vçW²&6÷VçG'’%ÒóòçVÆÂÀ¢6—G“¢öf56–vçW²&6—G’%ÒóòçVÆÂÀ¢FG&W73¢öf56–vçW²&FG&W72%ÒóòçVÆÂÀ¢÷7FÄ6öFS¢öf4÷4W†—7F–ærç÷7FÄ6öFRóòöf56–vçW²'÷7FÅö6öFR%ÒóòçVÆÂÀ¢†öæS¢öf4÷4W†—7F–ærç†öæRóòöf56–vçW²'†öæR%ÒóòçVÆÂÀ¢Æö6F–öä6öæf–wW&VC¢…öf56–vçW²&6—G’%ÒÇÂöf56–vçW²&FG&W72%Ò’À¢Æö6F–öå6÷W&6S¢&ÖçVÂ"À¢Ò“°¢ÆövvW"æ–æfò‡²7FW¢$d2ÓFb"Â÷&t–C¢öf4÷&t–BÒÂ%´d5Ò7FWÓFc¢÷&u÷6WGF–æw2FG&W726VÆbÖ†VÆVBg&öÒ6–vçWFF"“°¢Ð¢Ò6F6‚…öf4÷4W'"’°¢ÆövvW"çv&â‡²7FW¢$d2ÓFb"ÂW'#¢…öf4÷4W'"2W'&÷"’æÖW76vRÒÂ%´d5Ò7FWÓFc¢÷&u÷6WGF–æw2&÷vF–öâf–ÆVB†æöâÖfFÂ’"“°¢Ð ¢Ò6F6‚…öf47DW'"’°¢v—Böf47EG„2çVW'’‚%$ôÄÄ$4²"’æ6F6‚‚‚’Óâ·Ò“°¢òòÆörF†RgVÆÂ÷7Fw&U5ÂW'&÷"6òvR6â–FVçF–g’F†RW†7Bf–Æ–ær7FFVÖVç@¢6öç7B÷vRÒöf47DW'"2&V6÷&CÇ7G&–ærÂVæ¶æ÷vãã°¢ÆövvW"æW'&÷"‡°¢7FW¢$d2ÓBÔd”Â"À¢ÖW76vS¢÷vSòå²&ÖW76vR%ÒÀ¢6öFS¢÷vSòå²&6öFR%ÒÀ¢FWF–Ã¢÷vSòå²&FWF–Â%ÒÀ¢†–çC¢÷vSòå²&†–çB%ÒÀ¢6öç7G&–çC¢÷vSòå²&6öç7G&–çB%ÒÀ¢F&ÆS¢÷vSòå²'F&ÆR%ÒÀ¢6öÇVÖã¢÷vSòå²&6öÇVÖâ%ÒÀ¢66†VÖ¢÷vSòå²'66†VÖ%ÒÀ¢v†W&S¢÷vSòå²'v†W&R%ÒÀ¢&÷WF–æS¢÷vSòå²'&÷WF–æR%ÒÀ¢÷6—F–öã¢÷vSòå²'÷6—F–öâ%ÒÀ¢ÒÂ%´d5ÒE$å45D”ôâ$ôÄÄTB$4²(	BgVÆÂrW'&÷"&÷fR"“°¢F‡&÷röf47DW'#°¢Òf–æÆÇ’²öf47EG„2ç&VÆV6R‚“²Ð ¢òò)H)HÔÂÓ¢vVæW&FRÖv–2Æ–æ²Fö¶Vâ)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢ÆövvW"æ–æfò‡²7FW¢$ÔÂÓ"ÂVÖ–Ã¢öf4VÖ–ÂÒÂ%´ÔÅÒ7FWÓ¢vVæW&F–ærÖv–2Æ–æ²Fö¶Vâ‡&æFöÔ'—FW23"’"“°¢6öç7Böf4Öv–5Fö¶VâÒöf5&"ƒ3"’çFõ7G&–ær‚&†W‚"“° ¢òò)H)HÔÂÓ#¢–ç6W'BFö¶Vâ–çFòD")H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢ÆövvW"æ–æfò‡²7FW¢$ÔÂÓ""ÂFö¶Vå&Vf—ƒ¢öf4Öv–5Fö¶Vâç6Æ–6RƒÂ‚’ÂVÖ–Ã¢öf4VÖ–ÂÒÂ%´ÔÅÒ7FWÓ#¢–ç6W'F–ærÖv–5öÆ–æµ÷Fö¶Vâ–çFòD""“°¢6öç7Böf5Fö´2Òv—Böf47EööÂæ6öææV7B‚“°¢ÆWBöÖÅFö´–ç6W'FVBÒfÇ6S°¢G'’°¢6öç7BöÖÅFöµ"Òv—Böf5Fö´2çVW'“Ç²Fö¶Vã¢7G&–ærÓâ€¢”å4U%B”åDòÖv–5öÆ–æµ÷Fö¶Vç2‡Fö¶VâÆVÖ–ÂÆW‡—&W5öBÇW6VB¢dÅTU2‚CÂC"Ääõr‚’´”åDU%dÂs#B†÷W'2rÄdÅ4R’ôâ4ôädÄ”5B‡Fö¶Vâ’DòäõD„”är$UEU$ä”ärFö¶VæÀ¢µöf4Öv–5Fö¶VâÂöf4VÖ–ÅÐ¢“°¢öÖÅFö´–ç6W'FVBÒ…öÖÅFöµ"ç&÷t6÷VçBóò’â°¢ÆövvW"æ–æfò‡²7FW¢$ÔÂÓ"Öö²"ÂFö¶Vå&Vf—ƒ¢öf4Öv–5Fö¶Vâç6Æ–6RƒÂ‚’Â–ç6W'FVC¢öÖÅFö´–ç6W'FVBÒÂ%´ÔÅÒ7FWÓ#¢Öv–5öÆ–æµ÷Fö¶VâD"&W7VÇB"“°¢Òf–æÆÇ’²öf5Fö´2ç&VÆV6R‚“²Ð ¢òò)H)HÔÂÓS¢6ö×÷6RÖv–2Æ–æ²U$Â†ÆövvVB&Vf÷&RÔÂÓ2f÷"6Æ&—G’’)H ¢6öç7Böf5V%W&ÂÒ&ö6W72æVçe²%T$Ä”5õU$Â%ÒÇÂ&‡GG3¢òöæfÆ÷wö–çBç&ò#°¢6öç7Böf4Öv–4Æ–æµW&ÂÒGµöf5V%W&ÇÒöÆöv–â×fW&–g’æ‡FÖÃ÷Fö¶VãÒGµöf4Öv–5Fö¶VçÖ°¢ÆövvW"æ–æfò‡²7FW¢$ÔÂÓR"ÂW&ÄFöÖ–ã¢öf5V%W&ÂÂFö¶Vå&Vf—ƒ¢öf4Öv–5Fö¶Vâç6Æ–6RƒÂ‚’ÂFƒ¢"öÆöv–â×fW&–g’æ‡FÖÂ"ÒÂ%´ÔÅÒ7FWÓS¢Öv–2Æ–æ²U$Â6ö×÷6VB"“° ¢òò)H)HÔÂÓ"ãS¢&W6VæB7W&W76–öâÖÆ—7B&RÖ6†V6²)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢òò†&B&÷Væ6RWFòÖFG2F†RFG&W72Fò&W6VæBw27W&W76–öâÆ—7Bà¢òòç’7V'6WVVçB6VæBGFV×B—26–ÆVçFÇ’G&÷VB'’&W6VæB(	BF†R4D°¢òò&WGW&ç2ö³§G'VRv—F‚âVÖ–Ä–B'WBF†RVÖ–Â—2æWfW"FVÆ—fW&VBà¢òò6†V6²$Tdõ$R6ÆÆ–ærF†RÖ–ÆW"6òvR6â&WGW&âVÖ–Äf–ÆVC§G'VP¢òò–ÖÖVF–FVÇ’†æB6†÷rF†R&6öææV7BF—&V7FÇ’"T’’–ç7FVBöbfÇ6VÇ¢òò6Æ–Ö–ærF†RÆ–æ²v26VçBà¢6öç7B÷&W6VæD¶W”6†²Ò&ö6W72æVçe²%$U4TäEô•ô´U’%Ó°¢–b…÷&W6VæD¶W”6†²’°¢G'’°¢6öç7B÷7W&W7Òv—BfWF6‚€¢‡GG3¢òö’ç&W6VæBæ6öÒ÷7W&W76–öç2òG¶Væ6öFUU$”6ö×öæVçB…öf4VÖ–Â—ÖÀ¢²†VFW'3¢²WF†÷&—¦F–öã¢&V&W"Gµ÷&W6VæD¶W”6†·ÖÒÐ¢“°¢–b…÷7W&W7æö²’°¢6öç7B÷7WFFÒv—B÷7W&W7æ§6öâ‚’2²VÖ–Ãó¢7G&–æs²÷&–v–ãó¢7G&–ærÓ°¢–b…÷7WFFòæVÖ–Â’°¢òòFG&W72—27W&W76VB(	B6VæF–ærv÷VÆB&R6–ÆVçFÇ’–væ÷&V@¢ÆövvW"çv&â‡°¢7FW¢$ÔÂÓ"ãRÕ5U$U54TB"À¢VÖ–Ã¢öf4VÖ–ÂÀ¢÷&–v–ã¢÷7WFFæ÷&–v–âÀ¢Fö¶Vå&Vf—ƒ¢öf4Öv–5Fö¶Vâç6Æ–6RƒÂ‚’À¢ÒÂ%´ÔÅÒ7FWÓ"ãS¢VÖ–Â7W&W76VB(	BFVÆ—fW'’–×÷76–&ÆRÂ&WGW&æ–ærVÖ–Äf–ÆVB"“°¢&W2æ§6öâ‡°¢7V66W73¢G'VRÀ¢7V'67&—F–öä–C¢Æå7V'67&—F–öãòæ–BÀ¢FFöå7V'67&—F–öä–BÀ¢7F—fF–öäVÖ–Å6VçC¢fÇ6RÀ¢VÖ–Äf–ÆVC¢G'VRÀ¢VÖ–Äf–Å&V6öã¢'7W&W76VB"À¢Ò“°¢&WGW&ã°¢Ð¢òò#v—F‚VÖ–Âf–VÆB&W6VçB(i"7W&W76VC²CB(i"æ÷B7W&W76VB†vööB¢ÆövvW"æ–æfò‡²7FW¢$ÔÂÓ"ãRÔô²"ÂVÖ–Ã¢öf4VÖ–ÂÒÂ%´ÔÅÒ7FWÓ"ãS¢FG&W72æ÷B7W&W76VB"“°¢Ð¢òòæöâÓ#&W7öç6R÷"æWGv÷&²W'&÷"(i"&ö6VVBç—v’‡7W&W726†V6²—2&W7BÖVff÷'B¢Ò6F6‚…÷7WW'"’°¢ÆövvW"çv&â‡°¢7FW¢$ÔÂÓ"ãRÔU%""À¢W'#¢…÷7WW'"2W'&÷"’æÖW76vRÀ¢ÒÂ%´ÔÅÒ7FWÓ"ãS¢7W&W76–öâ6†V6²f–ÆVB†æöâÖfFÂÂ&ö6VVF–ærv—F‚6VæB’"“°¢Ð¢Ð ¢òò)H)HÔÂÓ2òÔÂÓB)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢òòÇv—26VæBF†R7F—fF–öâÖv–2Æ–æ²–ÖÖVF–FVÇ’(	Bf÷"&÷F‚G&–À¢òòæBæöâ×G&–Â6–vçW2âF†RG&–ÂFV×ÆFR†—5G&–Ã×G'VR’Ç&VG¢òò6'&–W2F†R&–v‡B7V&¦V7BòW–V'&÷r&FvR‚$W76’w&GV—BB¦÷W'2"’à¢òòFVÆVvF–ærFò7G&—RvV&†öö²‡6VæEG&–Å7F'FVDöæ6R’v2Vç&VÆ–&ÆS ¢òòç’vV&†öö²FVÆ’÷"f–ÇW&RÆVgBF†RW6W"v—F‚%l:—&–f–W¢f÷2VÖ–Ç2 ¢òòÖW76vRæBâV×G’–æ&÷‚à ¢òò)H)HÔÂÓ3¢6ÆÂÖ–ÆW"(	BÆörG&ç7÷'BG—R&Vf÷&RF†R6ÆÂ)H)H)H)H)H)H)H)H ¢6öç7BöÖÅG&ç7÷'BÒ&ö6W72æVçe²%$U4TäEô•ô´U’%Ð¢ò'&W6VæB×6F² ¢¢‡&ö6W72æVçe²%4ÕEô„õ5B%Òò6×G¢G·&ö6W72æVçe²%4ÕEô„õ5B%×Ö¢&æöæR"“°¢ÆövvW"æ–æfò‡²7FW¢$ÔÂÓ2"ÂVÖ–Ã¢öf4VÖ–ÂÂG&ç7÷'C¢öÖÅG&ç7÷'BÂ—5G&–Ã¢w&çEG&–ÂÒÂ%´ÔÅÒ7FWÓ3¢6ÆÆ–ær6VæD7F—fF–öäÖv–4Æ–æ²"“°¢6öç7B²Ö–ÆW#¢öf4Ö–ÆW"ÒÒv—B–×÷'B‚"ââ÷6W'f–6W2öÖ–ÆW"æ§2"’æ6F6‚‚‚’Óâ‡²Ö–ÆW#¢çVÆÂÒ’“°¢–b‚öf4Ö–ÆW"’°¢F‡&÷ræWrW'&÷"‚$7F—fF–öâVÖ–Â6W'f–6RVæf–Æ&ÆR"“°¢Ð¢6öç7Böf4Ö–Å&W7VÇBÒv—Böf4Ö–ÆW"ç6VæD7F—fF–öäÖv–4Æ–æ²‡°¢Fó¢öf4VÖ–ÂÀ¢æÖS¢öf56–vçW²&f—'7EöæÖR%ÒÇÂöf4VÖ–Âç7Æ—B‚$"•³ÒÀ¢Æã¢Æä¶W’À¢Öv–4Æ–æµW&Ã¢öf4Öv–4Æ–æµW&ÂÀ¢—5G&–Ã¢w&çEG&–ÂÀ¢Ò“° ¢òò)H)HÔÂÓC¢Ö–ÆW"&W7öç6R(	BÆörWfW'—F†–ær)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢ÆövvW"æ–æfò‡°¢7FW¢$ÔÂÓB"À¢ö³¢öf4Ö–Å&W7VÇCòæö²À¢VÖ–Ä–C¢öf4Ö–Å&W7VÇCòæ–BÀ¢W'&÷#¢öf4Ö–Å&W7VÇCòæW'&÷"À¢G&ç7÷'C¢öÖÅG&ç7÷'BÀ¢Fó¢öf4VÖ–ÂÀ¢ÒÂ%´ÔÅÒ7FWÓC¢6VæD7F—fF–öäÖv–4Æ–æ²&W7öç6R"“° ¢–b‚öf4Ö–Å&W7VÇCòæö²’°¢ÆövvW"çv&â‡²7FW¢$ÔÂÓBÔd”Â"ÂVÖ–Ã¢öf4VÖ–ÂÂW'&÷#¢öf4Ö–Å&W7VÇCòæW'&÷"ÂG&ç7÷'C¢öÖÅG&ç7÷'BÒÂ%´ÔÅÒ7FWÓC¢d”Â(	B7F—fF–öâVÖ–Âæ÷BFVÆ—fW&VB"“°¢&W2æ§6öâ‡°¢7V66W73¢G'VRÀ¢7V'67&—F–öä–C¢Æå7V'67&—F–öâæ–BÀ¢FFöå7V'67&—F–öä–BÀ¢7F—fF–öäVÖ–Å6VçC¢fÇ6RÀ¢VÖ–Äf–ÆVC¢G'VRÀ¢Ò“°¢&WGW&ã°¢Ð¢ÆövvW"æ–æfò‡²7FW¢$ÔÂÓBÔô²"ÂVÖ–Ä–C¢öf4Ö–Å&W7VÇCòæ–BÂFó¢öf4VÖ–ÂÒÂ%´ÔÅÒ7FWÓC¢ô²(	B7F—fF–öâVÖ–Â66WFVB'’G&ç7÷'B"“° ¢Ò6F6‚…öf47EF÷W'"’°¢ÆövvW"æW'&÷"‡²7FW¢$d2ÕDõÔd”Â"ÂW'#¢…öf47EF÷W'"2W'&÷"“òæÖW76vRÒÂ%´d5ÒF÷ÖÆWfVÂ7F—fF–öâ6F6‚"“°¢–b…öf47F—fF–öä6öÖÖ—GFVB’°¢&W2æ§6öâ‡°¢7V66W73¢G'VRÀ¢7V'67&—F–öä–C¢Æå7V'67&—F–öâæ–BóòVæFVf–æVBÀ¢FFöå7V'67&—F–öä–BÀ¢7F—fF–öäVÖ–Å6VçC¢fÇ6RÀ¢VÖ–Äf–ÆVC¢G'VRÀ¢Ò“°¢ÒVÇ6R°¢&W2ç7FGW2ƒS"’æ§6öâ‡°¢W'&÷#¢%f÷G&R–VÖVçBW7B6öæf—&Ü:’ÂÖ—2Âv7F—fF–öâGR6ö×FR:–6†÷\:’â6öçF7FW¢ÆR7W÷'Bâ"À¢6öFS¢&7F—fF–öåöf–ÆVB"À¢Ò“°¢Ð¢&WGW&ã°¢Ð¢Ð¢&W2æ§6öâ‡²7V66W73¢G'VRÂ7V'67&—F–öä–C¢Æå7V'67&—F–öâæ–BÂFFöå7V'67&—F–öä–BÂ7F—fF–öäVÖ–Å6VçC¢G'VRÒ“°¢Ò6F6‚†W'"’°¢ÆövvW"æW'&÷"‡²W'"ÒÂ%µV&Æ–4&–ÆÆ–æuÒf–æÆ—¦RÖ6†V6¶÷WBf–ÆVB"“°¢&W2ç7FGW2ƒS’æ§6öâ‡²W'&÷#¢$W'&WW"Æ÷'2FRÆf–æÆ—6F–öââ"Ò“°¢Ð§Ò“° ¦W‡÷'BFVfVÇB&÷WFW#°