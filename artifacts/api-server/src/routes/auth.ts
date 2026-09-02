ic_link_tokens (token, email, expires_at, used)
           VALUES ($1, $2, NOW() + INTERVAL '24 hours', FALSE)
           ON CONFLICT (token) DO NOTHING`,
          [magicToken, email]
        );
      } catch (tokErr) {
        logger.error({ err: tokErr, email }, "[Auth/CheckoutComplete] magic_link_tokens insert failed");
      }
      const publicUrl    = process.env["PUBLIC_URL"] || "https://app.flowpoint.pro";
      const magicLinkUrl = `${publicUrl}/login-verify.html?token=${magicToken}`;

      const transport = process.env["RESEND_API_KEY"]
        ? "resend-sdk"
        : (process.env["SMTP_HOST"] ? `smtp:${process.env["SMTP_HOST"]}` : "none");
      logger.info({ email, transport, step: "CC-ML-send" }, "[Auth/CheckoutComplete] Sending magic link directly");

      const { mailer: _ccMailer } = await import("../services/mailer.js").catch(() => ({ mailer: null }));
      if (_ccMailer) {
        const mailResult = await _ccMailer.sendActivationMagicLink({
          to:          email,
          name:        email.split("@")[0],
          plan:        meta["plan"] || "standard",
          magicLinkUrl,
          isTrial:     false,
        }).catch((mailErr: unknown) => ({ ok: false as const, error: String(mailErr) }));

        emailSent = !!mailResult?.ok;
        emailId   = (mailResult as { id?: string })?.id;
        logger.info({ email, emailSent, emailId, error: (mailResult as { error?: string })?.error, step: "CC-ML-result" },
          "[Auth/CheckoutComplete] Magic link send result");
      } else {
        logger.error({ email }, "[Auth/CheckoutComplete] Mailer unavailable");
      }
    }

    store.logActivity({
      type: "account",
      label: `Paiement confirmÃ© â€” ${emailSent ? "magic link envoyÃ©" : "email Ã©chouÃ©"} : ${email}`,
      targetId: metaOrgId || email,
      targetType: "user",
      orgId: metaOrgId || undefined,
      userId: email || undefined,
      userName: email || undefined,
    }).catch(() => {});

    if (!emailSent) {
      // Account was activated but email couldn't be sent â€” surface the error clearly.
      res.status(200).json({
        ok: true,
        emailSent: false,
        emailFailed: true,
        isNewSignup: true,
        message: "Compte activÃ© mais l'envoi de l'email a Ã©chouÃ©. Connectez-vous depuis la page de connexion.",
      });
      return;
    }

    res.json({
      ok: true,
      emailSent: true,
      isNewSignup: true,
      message: "Votre paiement est confirmÃ©. Un lien de connexion vous a Ã©tÃ© envoyÃ© par email. VÃ©rifiez votre boÃ®te de rÃ©ception (et vos spams).",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isStripeErr = err instanceof Error && (
      (err as unknown as Record<string, unknown>)["type"] === "StripeInvalidRequestError" ||
      msg.includes("No such") || msg.includes("no such") ||
      msg.includes("resource_missing") || msg.includes("invalid_request")
    );
    if (isStripeErr) {
      logger.warn({ err: msg, sessionId }, "[Auth/CheckoutComplete] Invalid Stripe session");
      res.status(400).json({ error: "Session de paiement introuvable ou invalide." });
      return;
    }
    logger.error({ err: msg, sessionId }, "[Auth/CheckoutComplete] Error");
    res.status(500).json({ error: "Erreur lors de la finalisation. RÃ©essayez ou contactez le support." });
  }
});

/** Shared handler â€” called by both GET and POST /auth/login-verify */
async function handleLoginVerify(tokenRaw: string | undefined, req: Request, res: Response): Promise<void> {
  // â”€â”€ ML-6: Token consumption entry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  logger.info({ step: "ML-6", tokenPrefix: typeof tokenRaw === "string" ? tokenRaw.trim().slice(0, 8) : "(none)" }, "[ML] step-6: login-verify called â€” token consumption attempt");
  // â”€â”€ S0: Token guard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (!tokenRaw || typeof tokenRaw !== "string" || !tokenRaw.trim()) {
    res.status(400).json({ error: "Token manquant" });
    return;
  }
  const token = tokenRaw.trim();

  // â”€â”€ S1: Peek token (SELECT only â€” no UPDATE) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let peeked: Awaited<ReturnType<typeof peekToken>>;
  try {
    peeked = await peekToken(token);
  } catch (dbErr) {
    logger.error({ err: dbErr instanceof Error ? dbErr.message : String(dbErr) }, "login-verify: peekToken error");
    res.status(500).json({ error: "Erreur base de donnÃ©es. Veuillez rÃ©essayer." });
    return;
  }

  if (!peeked.ok) {
    // Diagnostic: log every failure with token prefix so we can match it
    // against the email send logs in BetterStack to understand why the token
    // can't be found (e.g. race condition, cleanup job, RLS, duplicate send).
    logger.warn(
      { reason: peeked.reason, tokenPrefix: token.slice(0, 8), step: "S1-fail" },
      "[ML] peekToken failed â€” token not usable"
    );
    switch (peeked.reason) {
      case "already_used":
        res.status(410).json({
          error: "Ce lien a dÃ©jÃ  Ã©tÃ© utilisÃ©.",
          hint:  "Demandez un nouveau lien depuis la page de connexion.",
          canRetry: true,
        });
        return;
      case "expired":
        res.status(401).json({
          error:    "Ce lien a expirÃ©.",
          hint:     "Les liens de connexion expirent aprÃ¨s 1 heure. Demandez un nouveau lien.",
          canRetry: true,
        });
        return;
      default:
        res.status(401).json({
          error:    "Lien invalide ou introuvable.",
          hint:     "Le lien n'existe pas en base de donnÃ©es. Demandez un nouveau lien depuis la page de connexion.",
          canRetry: true,
        });
        return;
    }
  }

  const email = peeked.email;

  // â”€â”€ S2: DB reads (users + organization_members) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let sessionOrgId: string;
  let sessionRole: string;
  let sessionUserUuid: string | undefined;

  try {
    // S2a â€” users query
    let userRow: { rows: Array<{ id: string; status: string; email_verified: boolean }> };
    try {
      userRow = await pool.query<{ id: string; status: string; email_verified: boolean }>(
        `SELECT id, status, email_verified FROM users WHERE email = $1`,
        [email]
      ) as { rows: Array<{ id: string; status: string; email_verified: boolean }> };
    } catch (qErr) {
      logger.error({ err: qErr instanceof Error ? (qErr as Error).message : String(qErr) }, "login-verify: users query error");
      throw qErr; // re-throw to outer catch â†’ 503
    }

    // S2b â€” organization_members JOIN organizations query
    let memberRow: { rows: Array<{ organization_id: string; role: string; status: string; org_status: string; subscription_status: string }> };
    try {
      memberRow = await pool.query<{
        organization_id: string; role: string; status: string; org_status: string; subscription_status: string;
      }>(
        `SELECT om.organization_id, om.role, om.status AS member_status,
                o.status AS org_status, o.subscription_status
         FROM organization_members om
         JOIN organizations o ON o.id::text = om.organization_id
         WHERE om.user_id = (SELECT id FROM users WHERE email = $1 LIMIT 1)
           AND om.status = 'active'
           AND o.status != 'deleted'
         ORDER BY om.joined_at ASC
         LIMIT 1`,
        [email]
      ) as { rows: Array<{ organization_id: string; role: string; status: string; org_status: string; subscription_status: string }> };
    } catch (qErr) {
      logger.error({ err: qErr instanceof Error ? (qErr as Error).message : String(qErr) }, "login-verify: org_members query error");
      throw qErr;
    }

    // â”€â”€ S3: Check 2 â€” user existence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    if (userRow.rows.length === 0) {
      // S3-legacy: user not in users table â€” try org_settings
      let orgCheck: Awaited<ReturnType<typeof loadOrgSettings>> | null;
      try {
        orgCheck = await loadOrgSettings(email).catch(() => null);
      } catch (osErr) {
        logger.error({ err: osErr instanceof Error ? osErr.message : String(osErr) }, "login-verify: S3-legacy loadOrgSettings error");
        throw osErr;
      }

      if (orgCheck === null) {
        res.status(404).json({ error: "Aucun compte associÃ© Ã  cette adresse email.", redirectTo: "/signin.html" });
        return;
      }
      if (orgCheck.subscriptionStatus === "pending_billing") {
        res.status(402).json({ error: "Votre compte n'est pas encore activÃ©. Veuillez complÃ©ter votre inscription.", redirectTo: "/signin.html" });
        return;
      }
      // Resolve or create a UUID org â€” never store email as orgId.
      const s3Result = await resolveOrCreateLegacyOrg({
        email, userUuid: undefined, orgSettings: orgCheck,
      });
      sessionOrgId    = s3Result.orgId;
      sessionRole     = "owner";
      sessionUserUuid = s3Result.userUuid;

    } else {
      const user = userRow.rows[0]!;

      // â”€â”€ S4: Check 3 â€” email verified â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (!user.email_verified) {
        res.status(403).json({ error: "Adresse email non vÃ©rifiÃ©e. VÃ©rifiez votre boÃ®te mail." });
        return;
      }

      // â”€â”€ S5: Check 4 â€” user active â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (user.status !== "active") {
        res.status(403).json({
          error: user.status === "suspended"
            ? "Votre compte a Ã©tÃ© suspendu. Contactez le support."
            : "Votre compte n'est plus actif.",
        });
        return;
      }

      // â”€â”€ S6: Check 5 â€” org membership â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (memberRow.rows.length === 0) {
        // S6-no-membership: user exists but has no active organization_members row.
        //
        // NOTE: the old "S6-pending" path that attempted to auto-provision
        // organization_members via pool.query (without a client-level RLS GUC) has
        // been removed. It was an authorization bypass risk: a caught provisioning
        // failure still granted an org session with an unverified role.
        //
        // The ONLY correct path for invited members is:
        //   accept-invitation.html â†’ POST /api/team/invitations/accept
        // That endpoint runs a locked transaction with the RLS GUC correctly set.
        // If the user somehow has an active users row but no membership, they must
        // re-click their invitation link.
        // â”€â”€ S6-team-members: check legacy team_members table BEFORE touching org_settings â”€â”€
        // A guest/invited user has a users row + active team_members row but NO
        // organization_members row (this happens when the invitation was created via the
        // old team_members path and the user completed their email verification but the
        // organization_members row was never back-filled, or when the session was created
        // before the org_members migration).  We MUST find their existing org here;
        // falling straight through to resolveOrCreateLegacyOrg would create a fresh
        // Standard workspace for them â€” a critical isolation breach.
        let s6GuestOrgId: string | null = null;
        let s6GuestRole: string = "member";
        try {
          const tmRow = await pool.query<{ org_id: string; role: string }>(
            `SELECT org_id, COALESCE(role, 'member') AS role
             FROM team_members
             WHERE (LOWER(email) = LOWER($1) OR user_id = $2)
               AND status = 'active'
             ORDER BY created_at ASC
             LIMIT 1`,
            [email, user.id]
          );
          if (tmRow.rows.length > 0) {
            s6GuestOrgId = tmRow.rows[0].org_id;
            s6GuestRole  = tmRow.rows[0].role || "member";
            logger.info(
              { email, userId: user.id, guestOrgId: s6GuestOrgId, role: s6GuestRole, source: "team_members" },
              "[AUTH CONTEXT DEBUG] S6: guest resolved via team_members â€” skipping org creation"
            );
          }
        } catch (_tmErr) {
          logger.warn({ err: String(_tmErr) }, "login-verify: S6-team-members lookup failed (non-fatal)");
        }

        if (s6GuestOrgId) {
          // Guest belongs to an existing org via team_members â€” use it directly.
          // Attempt to back-fill organization_members so future logins use the canonical path.
          try {
            await pool.query(
              `INSERT INTO organization_members (id, organization_id, user_id, role, status, joined_at)
               VALUES (gen_random_uuid(), $1, $2::uuid, $3, 'active', NOW())
               ON CONFLICT (organization_id, user_id) DO NOTHING`,
              [s6GuestOrgId, user.id, s6GuestRole]
            );
          } catch (_backfill) {
            // Non-fatal â€” the session still works without the organization_members row.
            logger.warn({ err: String(_backfill) }, "login-verify: S6 org_members backfill failed (non-fatal)");
          }
          sessionOrgId    = s6GuestOrgId;
          sessionRole     = s6GuestRole;
          sessionUserUuid = user.id;
        } else {
        // S6-fallback: user exists but no org_members row AND no team_members row â€” try org_settings (legacy owners)
        let orgFallback: Awaited<ReturnType<typeof loadOrgSettings>> | null;
        try {
          orgFallback = await loadOrgSettings(email).catch(() => null);
        } catch (osErr) {
          logger.error({ err: osErr instanceof Error ? osErr.message : String(osErr) }, "login-verify: S6-fallback loadOrgSettings error");
          throw osErr;
        }

        if (!orgFallback) {
          // No org_settings either â€” invited member who hasn't accepted yet or partial failure.
          // Direct them to use the invitation link rather than attempting unsafe auto-provision.
          res.status(403).json({
            error: "Votre compte n'est associÃ© Ã  aucune organisation active. Si vous avez reÃ§u une invitation, veuillez cliquer sur le lien d'invitation pour rejoindre l'Ã©quipe.",
            code: "NO_ACTIVE_ORG",
          });
          return;
        }
        if (orgFallback.subscriptionStatus === "pending_billing") {
          res.status(402).json({ error: "Votre compte n'est pas encore activÃ©. Veuillez complÃ©ter votre inscription.", redirectTo: "/signin.html" });
          return;
        }
        // Resolve or create a UUID org â€” never store email as orgId.
        const s6Result = await resolveOrCreateLegacyOrg({
          email, userUuid: user.id, orgSettings: orgFallback,
        });
        sessionOrgId    = s6Result.orgId;
        sessionRole     = "owner";
        sessionUserUuid = s6Result.userUuid;
        } // end else (no team_members row found)

      } else {
        const member = memberRow.rows[0]!;

        // â”€â”€ S6b: role valid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (!["owner", "admin", "member", "viewer"].includes(member.role)) {
          res.status(403).json({ error: "RÃ´le invalide." });
          return;
        }

        sessionOrgId    = member.organization_id;
        sessionRole     = member.role;
        sessionUserUuid = user.id;
      }
    }

  } catch (guardErr) {
    logger.error({ err: guardErr instanceof Error ? guardErr.message : String(guardErr) }, "login-verify: guard error â†’ 503");
    res.status(503).json({
      error: "Erreur temporaire. Veuillez rÃ©essayer en cliquant Ã  nouveau sur le lien de connexion.",
    });
    return;
  }

  // â”€â”€ S8: Atomic token consumption â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  try {
    const { consumed } = await finalConsumeToken(token);
    if (!consumed) {
      res.status(410).json({ error: "Ce lien a dÃ©jÃ  Ã©tÃ© utilisÃ©. Demandez un nouveau lien si nÃ©cessaire." });
      return;
    }
  } catch (consumeErr) {
    logger.error({ err: consumeErr instanceof Error ? consumeErr.message : String(consumeErr) }, "login-verify: finalConsumeToken error");
    res.status(503).json({ error: "Erreur temporaire. Veuillez rÃ©essayer en cliquant Ã  nouveau sur le lien de connexion." });
    return;
  }

  // â”€â”€ S9: Invalidate existing sessions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  await invalidateAllSessions(email).catch((err) => {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "login-verify: invalidateAllSessions failed (non-fatal)");
  });

  // â”€â”€ ML-6-ok: Token consumed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  logger.info({ step: "ML-6-ok", email, orgIdPrefix: sessionOrgId?.slice(0, 8) }, "[ML] step-6-ok: token consumed â€” proceeding to session creation");
  logger.info({
    userId:    sessionUserUuid?.slice(0, 8) ?? "(none)",
    email,
    orgId:     sessionOrgId?.slice(0, 8),
    role:      sessionRole,
    source:    "login-verify",
  }, "[AUTH CONTEXT DEBUG]");

  // â”€â”€ S10: Create session â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let sessionToken: string;
  try {
    sessionToken = await createSession({
      userId:    sessionOrgId,
      orgId:     sessionOrgId,
      email,
      role:      sessionRole,
      userUuid:  sessionUserUuid,
       ipAddress: req.ip ?? undefined,
      userAgent: (req.headers["user-agent"] as string | undefined) ?? undefined,
    });
  } catch (sessErr) {
    logger.error({ err: sessErr instanceof Error ? sessErr.message : String(sessErr) }, "login-verify: createSession error");
    res.status(503).json({ error: "Erreur temporaire. Veuillez rÃ©essayer." });
    return;
  }

  // Update last_login_at (fire-and-forget)
  pool.query(`UPDATE users SET last_login_at = NOW() WHERE email = $1`, [email])
    .catch((err) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "login-verify: last_login_at update failed"));

  // â”€â”€ ML-7: Session created â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  logger.info({ step: "ML-7", email, orgIdPrefix: sessionOrgId?.slice(0, 8), tokenPrefix: sessionToken.slice(0, 8) }, "[ML] step-7: session created successfully");

  // â”€â”€ S11: Set cookie â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const isProd = isDeployedProd();
  res.cookie("fp_token", sessionToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });

  // â”€â”€ ML-8: Success response â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  logger.info({ step: "ML-8", email, cookieSet: true }, "[ML] step-8: cookie set + JSON response â€” login complete, dashboard redirect expected");
  // â”€â”€ S12: Send success response â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Return the session token in the body so the frontend can store it
  // in sessionStorage (per-tab isolation) â€” prevents cross-user contamination
  // when two accounts are tested in the same browser simultaneously.
  res.json({ ok: true, email, message: "Connexion rÃ©ussie", token: sessionToken });

  // Fire-and-forget: ensure Stripe customer (non-blocking, after response sent)
  (async () => {
    const stripeKey = process.env["STRIPE_LIVE_API_KEY"] ?? process.env["STRIPE_SECRET_KEY"] ?? "";
    if (!stripeKey) return;
    try {
      const { ensureStripeCustomer } = await import("../services/ensure-stripe-customer.js");
      await ensureStripeCustomer(sessionOrgId);
    } catch (stripeErr) {
      logger.warn({ err: stripeErr instanceof Error ? stripeErr.message : String(stripeErr) }, "login-verify: ensureStripeCustomer failed (non-fatal)");
    }
  })();

  // Fire-and-forget: auto-reactivate canceled subscription on login.
  // Canonical service handles all Stripe cases including creating a new sub
  // when all previous subscriptions are truly canceled.
  reactivateSubscriptionAfterLogin(sessionOrgId, "magic-link");

  // NOTE: Address backfill from pending_signups was removed.
  // A safe implementation requires a durable org_id column on the consumed
  // pending_signups row so the query can be scoped to the correct organisation.
  // Until that column is added and populated at activation, an email-only
  // lookup risks writing one org's signup address into a different org's
  // settings when multiple orgs share an email address.
  // TODO: add pending_signups.org_id (FK organizations.id), populate it in
  // stripe-webhook.ts at activation, then restore the self-heal keyed by org_id.
}

// GET â€” kept for backward compatibility (existing email links point to login-verify.html?token=...
// which makes the AJAX call). The static HTML file does the actual AJAX â€” email scanners
// pre-fetch the HTML page URL, not the API endpoint, so the risk is low.
// New deployments of login-verify.js use POST; GET still works atomically.
router.get("/auth/login-verify", (req: Request, res: Response) => {
  return handleLoginVerify(req.query["token"] as string | undefined, req, res);
});

// POST â€” preferred path; login-verify.js sends the token in the request body so that
// email-scanner prefetch (SafeLinks, Barracuda, etc.) cannot consume the token via GET.
router.post("/auth/login-verify", (req: Request, res: Response) => {
  const token = req.body?.token ?? req.query["token"];
  return handleLoginVerify(typeof token === "string" ? token : undefined, req, res);
});

// â”€â”€ Google OAuth Login (separate from GBP â€” for account authentication) â”€â”€â”€â”€â”€â”€
router.get("/auth/google/login", (req: Request, res: Response) => {
  const clientId = process.env["GOOGLE_CLIENT_ID"] || "";
  const redirectUri = process.env["GOOGLE_AUTH_REDIRECT_URI"] || `${getPublicUrl()}/api/auth/google/callback`;

  if (!clientId) {
    res.status(503).json({ error: "Google OAuth not configured" });
    return;
  }

  logger.info({ redirectUri }, "[Auth] Google OAuth login â€” redirect URI");

  const rawPlan = String(req.query["plan"] ?? "");
  const selectedPlan = ["standard","pro","ultra"].includes(rawPlan) ? rawPlan : null;
  const rawRedirect = String(req.query["redirect_to"] ?? "");
  const redirectTo = rawRedirect.startsWith("/") ? rawRedirect : null;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
    state: Buffer.from(JSON.stringify({ ts: Date.now(), plan: selectedPlan, redirect_to: redirectTo })).toString("base64"),
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get("/auth/google/callback", async (req: Request, res: Response) => {
  const { code, error: oauthError } = req.query as { code?: string; error?: string };
  const publicUrl = getPublicUrl();

  if (oauthError) {
    res.redirect(`${publicUrl}/login.html?error=${encodeURIComponent(oauthError)}`);
    return;
  }
  if (!code) {
    res.status(400).json({ error: "Missing OAuth code" });
    return;
  }

  try {
    const clientId = process.env["GOOGLE_CLIENT_ID"] || "";
    const clientSecret = process.env["GOOGLE_CLIENT_SECRET"] || "";
    const redirectUri = process.env["GOOGLE_AUTH_REDIRECT_URI"] || `${publicUrl}/api/auth/google/callbackc§W6W"ÇW6W#¦VÖ–Æ°¢&W2ç&VF—&V7B‡W&Â“°§Ò“° §&÷WFW"ævWB‚"öWF‚öv—F‡V"ö6ÆÆ&6²"Â7–æ2‡&W¢&WVW7BÂ&W3¢&W7öç6R’Óâ°¢6öç7B²6öFRÂW'&÷#¢öWF„W'&÷"ÒÒ&WçVW'’2²6öFSó¢7G&–æs²W'&÷#ó¢7G&–ærÓ°¢6öç7BV&Æ–5W&ÂÒvWEV&Æ–5W&Â‚“° ¢–b†öWF„W'&÷"ÇÂ6öFR’°¢&W2ç&VF—&V7B†G·V&Æ–5W&ÇÒöÆöv–âæ‡FÖÃöW'&÷#ÒG¶Væ6öFUU$”6ö×öæVçB†öWF„W'&÷"ÇÂ&Ö—76–æuö6öFR"—Ö“°¢&WGW&ã°¢Ğ ¢G'’°¢6öç7BFö¶Vå&W2Òv—BfWF6‚‚&‡GG3¢òöv—F‡V"æ6öÒöÆöv–âööWF‚ö66W75÷Fö¶Vâ"Â°¢ÖWF†öC¢%õ5B"À¢†VFW'3¢²$66WB#¢&Æ–6F–öâö§6öâ"Â$6öçFVçBÕG—R#¢&Æ–6F–öâö§6öâ"ÒÀ¢&öG“¢¥4ôâç7G&–æv–g’‡²6Æ–VçEö–C¢&ö6W72æVçe²$t•D…T%ô4Ä”TåEô”B%ÒÂ6Æ–VçE÷6V7&WC¢&ö6W72æVçe²$t•D…T%ô4Ä”TåEõ4T5$UB%ÒÂ6öFRÒ’À¢Ò“°¢6öç7BFö¶Vç2Òv—BFö¶Vå&W2æ§6öâ‚’2²66W75÷Fö¶Vãó¢7G&–æs²W'&÷#ó¢7G&–ærÓ°¢–b‚Fö¶Vç2æ66W75÷Fö¶Vâ’F‡&÷ræWrW'&÷"‚$æòFö¶Vã¢"²‡Fö¶Vç2æW'&÷"ÇÂ'Væ¶æ÷vâ"’“° ¢6öç7BW6W%&W2Òv—BfWF6‚‚&‡GG3¢òö’æv—F‡V"æ6öÒ÷W6W""Â°¢†VFW'3¢²$WF†÷&—¦F–öâ#¢&V&W"G·Fö¶Vç2æ66W75÷Fö¶VçÖÂ$66WB#¢&Æ–6F–öâ÷fæBæv—F‡V"¶§6öâ"ÒÀ¢Ò“°¢6öç7BW6W"Òv—BW6W%&W2æ§6öâ‚’2²Æöv–ãó¢7G&–æs²æÖSó¢7G&–æs²VÖ–Ãó¢7G&–ærÓ° ¢6öç7B&W6öÇfVDVÖ–ÂÒW6W"æVÖ–ÂóòW6W"æÆöv–âóò"#°¢–b‚—4VÖ–ÄÆÆ÷vVB‡&W6öÇfVDVÖ–Â’’°¢ÆövvW"çv&â‡²Æöv–ã¢W6W"æÆöv–âÒÂ%´WF…Òv—D‡V"Æöv–â&V¦V7FVB(	BVÖ–Âæ÷BöâÆÆ÷vÆ—7B"“°¢&W2ç&VF—&V7B†G·V&Æ–5W&ÇÒöÆöv–âæ‡FÖÃöW'&÷#Ö66W75öFVæ–VF“°¢&WGW&ã°¢Ğ ¢òò4T5U$•E“¢7F÷&RæÖRæf—'7DæÖRw&—FR&VÖ÷fVB(	BvÆö&Â6–ævÆWFöâ6W6W27&÷72×W6W"FFÆV¶vRà ¢òòW'6—7BW"×W6W"÷&r6òö’öÖR&WGW&ç26÷'&V7BFFgFW"&W7F'@¢G'’°¢6öç7B²W6W'D÷&u6WGF–æw2ÂÆöD÷&u6WGF–æw3¢öÆöDv—F‡V$÷&rÒÒv—B–×÷'B‚"ââ÷6W'f–6W2ö÷&r×6WGF–æw2æ§2"“°¢6öç7BöW†—7F–ætv—F‡V$÷&rÒv—BöÆöDv—F‡V$÷&r‡&W6öÇfVDVÖ–Â’æ6F6‚‚‚’ÓâçVÆÂ“°¢–b…öW†—7F–ætv—F‡V$÷&r’°¢v—BW6W'D÷&u6WGF–æw2‡&W6öÇfVDVÖ–ÂÂ°¢VÖ–Ã¢&W6öÇfVDVÖ–ÂÀ¢f—'7DæÖS¢öW†—7F–ætv—F‡V$÷&ræf—'7DæÖRÇÂ‡W6W"ææÖRòW6W"ææÖRç7Æ—B‚""•³Ò¢‡W6W"æÆöv–âóòVæFVf–æVB’’À¢Æã¢öW†—7F–ætv—F‡V$÷&rçÆâóò'7FæF&B"À¢Ò“°¢ÆövvW"æ–æfò‡²Æöv–ã¢W6W"æÆöv–âÒÂ%´WF…Òv—D‡V"Æöv–â(	BW†—7F–ær÷&rÂ&–ÆÆ–ærFF&W6W'fVB"“°¢ÒVÇ6R°¢v—BW6W'D÷&u6WGF–æw2‡&W6öÇfVDVÖ–ÂÂ°¢VÖ–Ã¢&W6öÇfVDVÖ–ÂÀ¢f—'7DæÖS¢W6W"ææÖRòW6W"ææÖRç7Æ—B‚""•³Ò¢‡W6W"æÆöv–âóòVæFVf–æVB’À¢Æã¢'7FæF&B"À¢7V'67&—F–öå7FGW3¢'VæF–æuö&–ÆÆ–ær"À¢÷&tæÖS¢W6W"æÆöv–âóòVæFVf–æVBÀ¢Ò“°¢ÆövvW"æ–æfò‡²Æöv–ã¢W6W"æÆöv–âÒÂ%´WF…Òv—D‡V"Æöv–â(	BæWr÷&r7&VFVBv—F‚VæF–æuö&–ÆÆ–ær"“°¢Ğ¢Ò6F6‚†W'"’°¢ÆövvW"çv&â‡²W'"ÒÂ%´WF…Òv—D‡V"Æöv–â(	B÷&u÷6WGF–æw2W'6—7Bf–ÆVB†æöâÖfFÂ’"“°¢Ğ ¢ÆövvW"æ–æfò‡²Æöv–ã¢W6W"æÆöv–âÒÂ%´WF…Òv—D‡V"Æöv–â7V66W76gVÂ"“° ¢òò—77VRVæ—VRW"×6W76–öâFö¶VâæB6WB—B2â‡GGöæÇ’6öö¶–Rà¢òòF—&V7BôWF‚Æöv–âÒ÷&r7&VF÷"(i"÷væW"&öÆRà¢6öç7B6W76–öåFö¶VâÒv—B7&VFU6W76–öâ‡°¢W6W$–C¢&W6öÇfVDVÖ–ÂÂ÷&t–C¢&W6öÇfVDVÖ–ÂÂVÖ–Ã¢&W6öÇfVDVÖ–ÂÂ&öÆS¢&÷væW""À¢—FG&W73¢&Wæ—óòVæFVf–æVBÀ¢W6W$vVçC¢‡&Wæ†VFW'5²'W6W"ÖvVçB%Ò27G&–ærÂVæFVf–æVB’óòVæFVf–æVBÀ¢Ò“°¢6öç7B—5&öBÒ—4FWÆ÷–VE&öB‚“°¢&W2æ6öö¶–R‚&g÷Fö¶Vâ"Â6W76–öåFö¶VâÂ°¢‡GGöæÇ“¢G'VRÀ¢6V7W&S¢—5&öBÀ¢6ÖU6—FS¢—5&öBò&æöæR"¢&Æ‚"À¢Ö„vS¢4U54”ôåõEDÅôÕ2À¢Fƒ¢"ò"À¢Ò“°¢&W2ç&VF—&V7B†G·V&Æ–5W&ÇÒöF6†&ö&Bæ‡FÖÃ÷&÷f–FW#Öv—F‡V&“°¢Ò6F6‚†W'"’°¢ÆövvW"æW'&÷"‡²W'"ÒÂ%´WF…Òv—D‡V"6ÆÆ&6²f–ÆVB"“°¢&W2ç&VF—&V7B†G·V&Æ–5W&ÇÒöÆöv–âæ‡FÖÃöW'&÷#Öv—F‡V%öWF…öf–ÆVF“°¢Ğ§Ò“° ¢òò)H)H6W76–öâbÆöv÷WB)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H §&÷WFW"ævWB‚"öWF‚÷6W76–öâ"Â7–æ2‡&W¢&WVW7BÂ&W3¢&W7öç6R’Óâ°¢6öç7B6öö¶–UFö¶Vã¢7G&–ærÒ‡&W2Væ¶æ÷vâ2²6öö¶–W3ó¢&V6÷&CÇ7G&–ærÂ7G&–æsâÒ’æ6öö¶–W3òæg÷Fö¶Vâóò"#°¢6öç7B6W76–öâÒ6öö¶–UFö¶Vâòv—BvWE6W76–öâ†6öö¶–UFö¶Vâ’¢çVÆÃ°¢6öç7BWF†VçF–6FVBÒ6W76–öâÓÒçVÆÃ° ¢òò4T5U$•E“¢&WGW&âöæÇ’6W76–öâ×66÷VBFF(	BæWfW"&VBg&öÒ7F÷&RæÖR†vÆö&Â6–ævÆWFöâ’à¢&W2æ§6öâ‡°¢WF†VçF–6FVBÀ¢W6W#¢WF†VçF–6FVBò°¢VÖ–Ã¢6W76–öâæVÖ–ÂÀ¢&öÆS¢6W76–öâç&öÆRÀ¢f—'7DæÖS¢6W76–öâæVÖ–Ãòç7Æ—B‚$"•³Òóò%W6W""À¢Ò¢çVÆÂÀ¢Ò“°§Ò“° ¢òò)H)H6W76–öâ&W7F÷&R)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢òò&WGW&ç2F†R&rg÷Fö¶Vâg&öÒF†R6öö¶–R6òF†R'&÷w6W"6Æ–VçB6âw&—FR—@¢òò–çFò6W76–öå7F÷&vR‡W"×F"—6öÆF–öâ’âæVVFVBv†VâF†RW6W"÷Vç2æWp¢òòF6†&ö&BF"†&öö¶Ö&²òFG&W72Ö&"æf–vF–öâ’v†W&R6W76–öå7F÷&vR—2V×G¢òò'WBF†R‡GGöæÇ’6öö¶–RÇ&VG’6'&–W2fÆ–B6W76–öâà¢òòæò&WV—&TWF‚w&W"(	BF†—2•2F†RWF‚Ö&ö÷G7G&6ÆÂà§&÷WFW"ç÷7B‚"öWF‚÷6W76–öâ×&W7F÷&R"Â7–æ2‡&W¢&WVW7BÂ&W3¢&W7öç6R’Óâ°¢òòW6Æ–çBÖF—6&ÆRÖæW‡BÖÆ–æRG—W67&—BÖW6Æ–çBöæòÖW‡Æ–6—BÖç¢6öç7B6öö¶–UFö¶Vã¢7G&–ærÂVæFVf–æVBÒ‡&W2ç’’æ6öö¶–W3òæg÷Fö¶Vã°¢6öç7BWF„†VFW"Ò&Wæ†VFW'5²&WF†÷&—¦F–öâ%Òóò"#°¢6öç7B&V&W%Fö¶VâĞ¢G—VöbWF„†VFW"ÓÓÒ'7G&–ær"bbWF„†VFW"ç7F'G5v—F‚‚$&V&W""¢òWF„†VFW"ç6Æ–6Rƒr’çG&–Ò‚¢¢VæFVf–æVC°¢òò&W6öÇWF–öâ÷&FW"‡7G&–7B(	B&V&W"—2WF†÷&—FF—fR“ ¢òòâ&V&W"&W6VçB(i"fÆ–FFR&V&W"ôäÅ’â–b–çfÆ–B÷7FÆR(i"Cà¢òòæWfW"fÆÂ&6²Fò6öö¶–Rv†Vâ&V&W"—2W‡Æ–6—FÇ’&÷f–FVBà¢òòF†—2&WfVçG27&÷72×W6W"6öçFÖ–æF–öâv†Vâ'&÷w6W"†öÆG26öö¶–P¢òòg&öÒW6W""v†–ÆRW6W"w2&V&W"—2ÖöÖVçF&–Ç’7FÆRà¢òò"âæò&V&W"(i"6öö¶–RÖöæÇ’F‚††&B&Vg&W6‚ÂæWrF"g&öÒ&öö¶Ö&²’à¢ÆWB6W76–öâÒçVÆÃ°¢ÆWB&÷f–FVC¢7G&–ærÂVæFVf–æVC° ¢6öç7B&W7F÷&TÆöt&6RÒ°¢†46öö¶–S¢6öö¶–UFö¶VâÀ¢†4&V&W#¢&V&W%Fö¶VâÀ¢6öö¶–U&Vf—ƒ¢6öö¶–UFö¶Vâò6öö¶–UFö¶Vâç6Æ–6RƒÂ‚’¢çVÆÂÀ¢&V&W%&Vf—ƒ¢&V&W%Fö¶Vâò&V&W%Fö¶Vâç6Æ–6RƒÂ‚’¢çVÆÂÀ¢Ó°¢ÆövvW"æFV'Vr‡&W7F÷&TÆöt&6RÂ%´WF‚÷6W76–öâ×&W7F÷&UÒGFV×F–ær6W76–öâÆöö·W"“° ¢–b†&V&W%Fö¶Vâ’°¢òò&V&W"—2W‡Æ–6—BæBWF†÷&—FF—fR(	Bæò6öö¶–RfÆÆ&6²à¢6W76–öâÒv—BvWE6W76–öâ†&V&W%Fö¶Vâ“°¢–b‡6W76–öâ’°¢&÷f–FVBÒ&V&W%Fö¶Vã°¢ÆövvW"æFV'Vr‡²ââç&W7F÷&TÆöt&6RÂf–¢&&V&W""Â÷&t–C¢6W76–öâæ÷&t–Còç6Æ–6RƒÂ‚’ÒÂ%´WF‚÷6W76–öâ×&W7F÷&UÒ&W6öÇfVBf–&V&W""“°¢ÒVÇ6R°¢ÆövvW"çv&â‡²ââç&W7F÷&TÆöt&6RÂf–¢&&V&W"Ö–çfÆ–B"ÒÂ%´WF‚÷6W76–öâ×&W7F÷&UÒ&V&W"–çfÆ–B÷7FÆR(	B&WGW&æ–ærC†æò6öö¶–RfÆÆ&6²’"“°¢Ğ¢ÒVÇ6R–b†6öö¶–UFö¶Vâ’°¢6W76–öâÒv—BvWE6W76–öâ†6öö¶–UFö¶Vâ“°¢–b‡6W76–öâ’°¢&÷f–FVBÒ6öö¶–UFö¶Vã°¢ÆövvW"æFV'Vr‡²ââç&W7F÷&TÆöt&6RÂf–¢&6öö¶–RÖöæÇ’"Â÷&t–C¢6W76–öâæ÷&t–Còç6Æ–6RƒÂ‚’ÒÂ%´WF‚÷6W76–öâ×&W7F÷&UÒ&W6öÇfVBf–6öö¶–R††&B&Vg&W6‚F‚’"“°¢ÒVÇ6R°¢ÆövvW"çv&â‡²ââç&W7F÷&TÆöt&6RÂf–¢&6öö¶–RÖöæÇ’Öf–ÆVB"ÒÂ%´WF‚÷6W76–öâ×&W7F÷&UÒ6öö¶–R&W6VçB'WBvWE6W76–öâ&WGW&æVBçVÆÂ(	BD"&÷rÖ—76–ær÷"W‡—&VB"“°¢Ğ¢ÒVÇ6R°¢ÆövvW"çv&â‡²ââç&W7F÷&TÆöt&6RÒÂ%´WF‚÷6W76–öâ×&W7F÷&UÒæò&V&W"æBæò6öö¶–R(	Bæöç–Ö÷W2&WVW7B"“°¢Ğ ¢–b‚6W76–öâÇÂ&÷f–FVB’°¢òòæV—F†W"Fö¶Vâ—2fÆ–B(	B6ÆV"F†R6öö¶–R6òF†R'&÷w6W"7F÷2&WG'––æp¢6öç7B—5&öBÒ—4FWÆ÷–VE&öB‚“°¢–b†6öö¶–UFö¶Vâ’°¢&W2æ6ÆV$6öö¶–R‚&g÷Fö¶Vâ"Â°¢‡GGöæÇ“¢G'VRÀ¢6V7W&S¢—5&öBÀ¢6ÖU6—FS¢—5&öBò&æöæR"¢&Æ‚"À¢Fƒ¢"ò"À¢Ò“°¢Ğ¢&W2ç7FGW2ƒC’æ§6öâ‡²W'&÷#¢'6W76–öåöW‡—&VB"Ò“°¢&WGW&ã°¢Ğ¢òò–bF†RfÆ–BFö¶Vâ—2æ÷BÇ&VG’–âF†Rg÷Fö¶Vâ6öö¶–RÂ6WB—Bæ÷rà¢òòF†—2ÆÆ÷w2&V&W"ÖöæÇ’6W76–öâ†Rærâ&÷f—6–öæ–ær’Fòv–âF†R6öö¶–P¢òò&WV—&VB'’F†R…DÔÂÖ–FFÆWv&RF†B&÷FV7G2öF6†&ö&Bæ‡FÖÂÂW6–ærW†7FÇ¢òòF†R6ÖR6öö¶–RGG&–'WFW22F†Ræ÷&ÖÂÆöv–âfÆ÷rà¢6öç7B—5&öBÒ—4FWÆ÷–VE&öB‚“°¢–b‡&÷f–FVBbb&÷f–FVBÓÒ6öö¶–UFö¶Vâ’°¢&W2æ6öö¶–R‚&g÷Fö¶Vâ"Â&÷f–FVBÂ°¢‡GGöæÇ“¢G'VRÀ¢6V7W&S¢—5&öBÀ¢6ÖU6—FS¢—5&öBò&æöæR"¢&Æ‚"À¢Ö„vS¢4U54”ôåõEDÅôÕ2À¢Fƒ¢"ò"À¢Ò“°¢Ğ ¢òò&WGW&âF†R6æöæ–6ÂfÆ–BFö¶Vâ6òF†R6Æ–VçB6â‡&R—7F÷&R—B–â6W76–öå7F÷&vRà¢òò–bF†R&V&W"v27FÆRæBF†R6öö¶–Rv2W6VBÂF†R6Æ–VçB&V6V—fW2F†R6öö¶–Rw0¢òòFö¶VâæBWFFW26W76–öå7F÷&vR(	B&V6÷fW&–ær6–ÆVçFÇ’v—F†÷WBÆöv–â&VF—&V7Bà¢&W2æ§6öâ‡²Fö¶Vã¢&÷f–FVBÂVÖ–Ã¢6W76–öâæVÖ–ÂÂ÷&t–C¢6W76–öâæ÷&t–BÒ“°§Ò“° §&÷WFW"ç÷7B‚"öWF‚öÆöv÷WB"Â7–æ2‡&W¢&WVW7BÂ&W3¢&W7öç6R’Óâ°¢òò&W6öÇfR&÷F‚Fö¶Vç26òvR6âçV¶RWfW'’6W76–öâf÷"F†—2W6W"Â&Vv&FÆW70¢òòöbv†–6‚F"÷Fö¶VâF†R6Æ–VçB—27W'&VçFÇ’W6–ærà¢òòW6Æ–çBÖF—6&ÆRÖæW‡BÖÆ–æRG—W67&—BÖW6Æ–çBöæòÖW‡Æ–6—BÖç¢6öç7B6öö¶–UFö¶Vã¢7G&–ærÒ‡&W2ç’’æ6öö¶–W3òæg÷Fö¶Vâóò"#°¢6öç7BWF„†VFW"Ò&Wæ†VFW'5²&WF†÷&—¦F–öâ%Òóò"#°¢6öç7B&V&W%Fö¶VâÒG—VöbWF„†VFW"ÓÓÒ'7G&–ær"bbWF„†VFW"ç7F'G5v—F‚‚$&V&W""¢òWF„†VFW"ç6Æ–6Rƒr’çG&–Ò‚¢¢"#° ¢òò&W6öÇfRF†R6æöæ–6Â6W76–öâ„&V&W"&VfW'&VC²6öö¶–R2fÆÆ&6²’Fğ¢òòvWBF†RW6W$–B6òvR6âçV¶RÄÂ6W76–öç2f÷"F†—266÷VçB(	Bæ÷B§W7BF†P¢òò7W'&VçBF"w2Fö¶VââF†—2—2F†R7&—F–6ÂFƒ¢–bÆöv÷WBöæÇ’FVÆWFVBF†P¢òò&V&W"6W76–öâv†–ÆRF†R6öö¶–R6W76–öâ&VÖ–æVBÆ—fRÂæf–vF–ærFòÆöv–âæ‡FÖÀ¢òòv÷VÆB–ÖÖVF–FVÇ’&VF—&V7B&6²FòF6†&ö&Bf–F†R7F–ÆÂ×fÆ–B6öö¶–Rà¢6öç7B&–Ö'•Fö¶VâÒ&V&W%Fö¶VâÇÂ6öö¶–UFö¶Vã°¢ÆWBçV¶VD'•W6W$–BÒfÇ6S°¢–b‡&–Ö'•Fö¶Vâ’°¢6öç7B6W76–öâÒv—BvWE6W76–öâ‡&–Ö'•Fö¶Vâ“°¢–b‡6W76–öãòçW6W$–B’°¢v—B–çfÆ–FFTÆÅ6W76–öç2‡6W76–öâçW6W$–B“°¢çV¶VD'•W6W$–BÒG'VS°¢ÆövvW"æ–æfò‡²W6W$–C¢6W76–öâçW6W$–Bç6Æ–6RƒÂ‚’Âf–¢&V&W%Fö¶Vâò&&V&W""¢&6öö¶–R"ÒÀ¢%´WF…ÒÆÂ6W76–öç2&Wfö¶VBöâÆöv÷WB†–çfÆ–FFTÆÅ6W76–öç2’"“°¢Ğ¢Ğ¢òò&VÇBÖæB×7W7VæFW'3¢–bvR6÷VÆFâwB&W6öÇfRW6W$–B†RærâD"†–67W’À¢òòfÆÂ&6²FòFVÆWF–ærV6‚Fö¶Vâ–æF—f–GVÆÇ’6òF†RFö¶Vç2BÆV7B&V6öÖP¢òò–çfÆ–B–âF†RD"à¢–b‚çV¶VD'•W6W$–B’°¢6öç7BFVÅ&öÖ—6W3¢&öÖ—6SÇfö–CåµÒÒµÓ°¢–b†&V&W%Fö¶Vâ’FVÅ&öÖ—6W2çW6‚†FVÆWFU6W76–öâ†&V&W%Fö¶Vâ’“°¢–b†6öö¶–UFö¶Vâbb6öö¶–UFö¶VâÓÒ&V&W%Fö¶Vâ’FVÅ&öÖ—6W2çW6‚†FVÆWFU6W76–öâ†6öö¶–UFö¶Vâ’“°¢–b†FVÅ&öÖ—6W2æÆVæwF‚’°¢v—B&öÖ—6RæÆÅ6WGFÆVB†FVÅ&öÖ—6W2“°¢ÆövvW"æ–æfò‚%´WF…Ò6W76–öâ‡2’&Wfö¶VBöâÆöv÷WB†fÆÆ&6²–æF—f–GVÂFVÆWFR’"“°¢Ğ¢Ğ ¢òòÇv—26ÆV"F†R‡GGöæÇ’6öö¶–RÂWfVâv†VâF†RD"FVÆWFRf–ÆVBÂ6òF†P¢òò'&÷w6W"FöW2æ÷B¶VW6VæF–æræ÷rÖ–çfÆ–BFö¶Vâà¢6öç7B—5&öBÒ—4FWÆ÷–VE&öB‚“°¢&W2æ6ÆV$6öö¶–R‚&g÷Fö¶Vâ"Â°¢‡GGöæÇ“¢G'VRÀ¢6V7W&S¢—5&öBÀ¢6ÖU6—FS¢—5&öBò&æöæR"¢&Æ‚"À¢Fƒ¢"ò"À¢Ò“° ¢&W2æ§6öâ‡²ö³¢G'VRÂÖW76vS¢%6W76–öâFW&Ö–ì:–R"Ò“°§Ò“° ¢òò)H)HÆR6–vâ–â‡7GV"(	B&WV—&W2ÄUô4Ä”TåEô”B²ÄUõDTÕô”B²&—fFR¶W’’)H §&÷WFW"ævWB‚"öWF‚öÆRöÆöv–â"Â‡&W¢&WVW7BÂ&W3¢&W7öç6R’Óâ°¢6öç7B6Æ–VçD–BÒ&ö6W72æVçe²$ÄUô4Ä”TåEô”B%ÒÇÂ"#°¢–b‚6Æ–VçD–B’°¢&W2ç&VF—&V7B‚"öÆöv–âæ‡FÖÃöW'&÷#ÖÆUöæ÷Eö6öæf–wW&VB"“°¢&WGW&ã°¢Ğ¢6öç7B&VF—&V7EW&’Ğ¢&ö6W72æVçe²$ÄUôUD…õ$TD•$T5EõU$’%ÒÇÀ¢G¶vWEV&Æ–5W&Â‚—Òö’öWF‚öÆRö6ÆÆ&6¶°¢6öç7B7FFRÒ'VffW"æg&öÒ„¥4ôâç7G&–æv–g’‡²G3¢FFRææ÷r‚’Ò’’çFõ7G&–ær‚&&6ScGW&Â"“°¢6öç7BW&ÂÒæWrU$Â‚&‡GG3¢òöÆV–BæÆRæ6öÒöWF‚öWF†÷&—¦R"“°¢W&Âç6V&6…&×2ç6WB‚&6Æ–VçEö–B"Â6Æ–VçD–B“°¢W&Âç6V&6…&×2ç6WB‚'&VF—&V7E÷W&’"Â&VF—&V7EW&’“°¢W&Âç6V&6…&×2ç6WB‚'&W7öç6U÷G—R"Â&6öFR"“°¢W&Âç6V&6…&×2ç6WB‚'&W7öç6UöÖöFR"Â&f÷&Õ÷÷7B"“°¢W&Âç6V&6…&×2ç6WB‚'66÷R"Â&æÖRVÖ–Â"“°¢W&Âç6V&6…&×2ç6WB‚'7FFR"Â7FFR“°¢&W2ç&VF—&V7B‡W&ÂçFõ7G&–ær‚’“°§Ò“° ¢òò)H)HÆR6–vâ–â6ÆÆ&6²…õ5B(	BÆRW6W2f÷&Õ÷÷7B&W7öç6UöÖöFR’)H)H)H)H)H)H)H)H  ¢ò¢¢&6ScBÕU$ÂVæ6öFR'VffW"†æòFF–ær’â¢ğ¦gVæ7F–öâ#cGW&Â†'Vc¢'VffW"“¢7G&–ær°¢&WGW&â'VbçFõ7G&–ær‚&&6ScB"’ç&WÆ6R‚õÂ²örÂ"Ò"’ç&WÆ6R‚õÂòörÂ%ò"’ç&WÆ6R‚óÒörÂ""“°§Ğ ¢ò¢ ¢¢'V–ÆBF†RU3#Sb6Æ–VçE÷6V7&WB¥uBÆR&WV—&W2f÷"F†R6öFRW†6†ævRà¢¢W6W2æöFRw2'V–ÇBÖ–â7'—Fò(	BæòW‡G&6¶vW2æVVFVBà¢¢ğ¦gVæ7F–öâ'V–ÆDÆT6Æ–VçE6V7&WB†6Æ–VçD–C¢7G&–ærÂFVÔ–C¢7G&–ærÂ¶W”–C¢7G&–ærÂ&uVÓ¢7G&–ær“¢7G&–ær°¢6öç7Bæ÷rÒÖF‚æfÆö÷"„FFRææ÷r‚’ò“°¢6öç7B†G"Ò#cGW&Â„'VffW"æg&öÒ„¥4ôâç7G&–æv–g’‡²Æs¢$U3#Sb"Â¶–C¢¶W”–BÒ’’“°¢6öç7BÇ’Ò#cGW&Â„'VffW"æg&öÒ„¥4ôâç7G&–æv–g’‡°¢—73¢FVÔ–BÀ¢–C¢æ÷rÀ¢W‡¢æ÷r²ƒeóCÂòò#B‚Ö€¢VC¢&‡GG3¢òöÆV–BæÆRæ6öÒ"À¢7V#¢6Æ–VçD–BÀ¢Ò’’“°¢6öç7B6–væ–æt–çWBÒ'VffW"æg&öÒ†G¶†G'ÒâG·Ç—Ö“°¢6öç7B&—d¶W’Ò7&VFU&—fFT¶W’‡²¶W“¢&uVÒÂf÷&ÖC¢'VÒ"Ò“°¢òòU3#Sc¢4„Ó#Sb²”TTRÕ3c2‡'ÇÇ2’f÷&Ö@¢6öç7B6–rÒ7'—Fõ6–vâ‚%4„#Sb"Â6–væ–æt–çWBÂ²¶W“¢&—d¶W’ÂG6Væ6öF–æs¢&–VVR×3c2"Ò“°¢&WGW&âG¶†G'ÒâG·Ç—ÒâG¶#cGW&Â‡6–r—Ö°§Ğ §&÷WFW"ç÷7B‚"öWF‚öÆRö6ÆÆ&6²"Â7–æ2‡&W¢&WVW7BÂ&W3¢&W7öç6R’Óâ°¢6öç7BV&Æ–5W&ÂÒvWEV&Æ–5W&Â‚“°¢6öç7B&öG’Ò&Wæ&öG’2&V6÷&CÇ7G&–ærÂ7G&–ærÂVæFVf–æVCã°¢6öç7B6öFRÒ&öG•²&6öFR%Òóò"#°¢6öç7B–EFö¶VâÒ&öG•²&–E÷Fö¶Vâ%Òóò"#°¢òòÆRöæÇ’6VæG2W6W&¥4ôâöâF†RdU%’d•%5BWF‚f÷"F†—2W6W"¶— ¢6öç7BW6W$§6öâÒ&öG•²'W6W"%Òóò"#° ¢–b‚6öFR’°¢6öç7BÆTW'&÷"Ò&öG•²&W'&÷"%Òóò&Ö—76–æuö6öFR#°¢ÆövvW"çv&â‡²ÆTW'&÷"ÒÂ%´WF…ÒÆR6ÆÆ&6²(	BÖ—76–ær6öFR"“°¢&W2ç&VF—&V7B†G·V&Æ–5W&ÇÒöÆöv–âæ‡FÖÃöW'&÷#ÒG¶Væ6öFUU$”6ö×öæVçB†ÆTW'&÷"—Ö“°¢&WGW&ã°¢Ğ ¢6öç7B6Æ–VçD–BÒ&ö6W72æVçe²$ÄUô4Ä”TåEô”B%Òóò"#°¢–b‚6Æ–VçD–B’°¢&W2ç&VF—&V7B†G·V&Æ–5W&ÇÒöÆöv–âæ‡FÖÃöW'&÷#ÖÆUöæ÷Eö6öæf–wW&VF“°¢&WGW&ã°¢Ğ ¢G'’°¢ÆWBÆTVÖ–Ã¢7G&–ærÂVæFVf–æVC°¢ÆWBÆU7V#¢7G&–ærÂVæFVf–æVC° ¢òò)H)H7FW¢fW&–g’F†R–E÷Fö¶VâF†BÆR6VçB–âF†Rf÷&Õ÷÷7B&öG’)H)H)H)H)H)H ¢–b†–EFö¶Vâ’°¢6öç7B'G2Ò–EFö¶Vâç7Æ—B‚"â"“°¢–b‡'G2æÆVæwF‚ÓÓÒ2’°¢G'’°¢6öç7B†VFW$ö&¢Ò¥4ôâç'6R„'VffW"æg&öÒ‡'G5³ÒÂ&&6ScGW&Â"’çFõ7G&–ær‚'WFc‚"’’2²¶–Có¢7G&–ærÓ°¢6öç7B–ÆöDö&¢Ò¥4ôâç'6R„'VffW"æg&öÒ‡'G5³ÒÂ&&6ScGW&Â"’çFõ7G&–ær‚'WFc‚"’’2&V6÷&CÇ7G&–ærÂVæ¶æ÷vãã°¢òòfWF6‚ÆRw2V&Æ–2¥tµ0¢6öç7B§v·5&W2Òv—BfWF6‚‚&‡GG3¢òöÆV–BæÆRæ6öÒöWF‚ö¶W—2"“°¢–b†§v·5&W2æö²’°¢6öç7B§v·2Òv—B§v·5&W2æ§6öâ‚’2²¶W—3¢'&“Ä§6öåvV$¶W’b²¶–Có¢7G&–ærÓâÓ°¢6öç7B§v²Ò§v·2æ¶W—2æf–æB‚†²’Óâ²æ¶–BÓÓÒ†VFW$ö&¢æ¶–B“°¢–b†§v²’°¢6öç7BV$¶W’Ò7&VFUV&Æ–4¶W’‡²¶W“¢§v²2Væ¶æ÷vâ2&ÖWFW'3ÇG—Vöb7&VFUV&Æ–4¶W“å³Òbö&¦V7BÂf÷&ÖC¢&§v²"Ò2&ÖWFW'3ÇG—Vöb7&VFUV&Æ–4¶W“å³Ò“°¢6öç7B6–t–çWBÒ'VffW"æg&öÒ†G·'G5³×ÒâG·'G5³×Ö“°¢6öç7BfÆ–BÒ7'—FõfW&–g’‚%4„#Sb"Â6–t–çWBÂV$¶W’Â'VffW"æg&öÒ‡'G5³%ÒÂ&&6ScGW&Â"’“°¢–b‡fÆ–Bbb–ÆöDö&¥²&VB%ÒÓÓÒ6Æ–VçD–B’°¢ÆTVÖ–ÂÒG—Vöb–ÆöDö&¥²&VÖ–Â%ÒÓÓÒ'7G&–ær"ò–ÆöDö&¥²&VÖ–Â%Ò¢VæFVf–æVC°¢ÆU7V"ÒG—Vöb–ÆöDö&¥²'7V"%ÒÓÓÒ'7G&–ær"ò–ÆöDö&¥²'7V"%Ò¢VæFVf–æVC°¢Ğ¢Ğ¢Ğ¢Ò6F6‚‡fW&–g”W'"’°¢ÆövvW"çv&â‡²W'#¢fW&–g”W'"ÒÂ%´WF…ÒÆR6ÆÆ&6²(	B–E÷Fö¶VâfW&–g’f–ÆVB†æöâÖfFÂÂv–ÆÂG'’6öFRW†6†ævR’"“°¢Ğ¢Ğ¢Ğ ¢òò)H)H7FW#¢W†6†ævR6öFRf÷"Fö¶Vç2–bvR7F–ÆÂFöâwB†fRVÖ–Â÷7V")H)H)H)H)H)H ¢–b‚ÆTVÖ–ÂbbÆU7V"’°¢6öç7BFVÔ–BÒ&ö6W72æVçe²$ÄUõDTÕô”B%Òóò"#°¢6öç7B¶W”–BÒ&ö6W72æVçe²$ÄUô´U•ô”B%Òóò"#°¢6öç7B&uVÒÒ‡&ö6W72æVçe²$ÄUõ$•dDUô´U’%Òóò""’ç&WÆ6R‚õÅÆâörÂ%Æâ"“°¢6öç7B&VF—&V7EW&’Ò&ö6W72æVçe²$ÄUôUD…õ$TD•$T5EõU$’%ÒÇÂG·V&Æ–5W&ÇÒö’öWF‚öÆRö6ÆÆ&6¶° ¢–b‚FVÔ–BÇÂ¶W”–BÇÂ&uVÒ’°¢F‡&÷ræWrW'&÷"‚$ÆR7&VFVçF–Ç2–æ6ö×ÆWFR…DTÕô”Bò´U•ô”Bò$•dDUô´U’Ö—76–ær’"“°¢Ğ ¢6öç7B6Æ–VçE6V7&WBÒ'V–ÆDÆT6Æ–VçE6V7&WB†6Æ–VçD–BÂFVÔ–BÂ¶W”–BÂ&uVÒ“°¢6öç7BFö¶Vå&W2Òv—BfWF6‚‚&‡GG3¢òöÆV–BæÆRæ6öÒöWF‚÷Fö¶Vâ"Â°¢ÖWF†öC¢%õ5B"À¢†VFW'3¢²$6öçFVçBÕG—R#¢&Æ–6F–öâ÷‚×wwrÖf÷&Ò×W&ÆVæ6öFVB"ÒÀ¢&öG“¢æWrU$Å6V&6…&×2‡°¢6Æ–VçEö–C¢6Æ–VçD–BÀ¢6Æ–VçE÷6V7&WC¢6Æ–VçE6V7&WBÀ¢6öFRÀ¢w&çE÷G—S¢&WF†÷&—¦F–öåö6öFR"À¢&VF—&V7E÷W&“¢&VF—&V7EW&’À¢Ò’À¢Ò“°¢6öç7BFö¶Vç2Òv—BFö¶Vå&W2æ§6öâ‚’2²–E÷Fö¶Vãó¢7G&–æs²W'&÷#ó¢7G&–æs²W'&÷%öFW67&—F–öãó¢7G&–ærÓ°¢–b‚Fö¶Vå&W2æö²ÇÂFö¶Vç2æ–E÷Fö¶Vâ’°¢F‡&÷ræWrW'&÷"†ÆRFö¶VâW†6†ævRf–ÆVC¢G·Fö¶Vç2æW'&÷"óò&æò–E÷Fö¶Vâ'Ò(	BG·Fö¶Vç2æW'&÷%öFW67&—F–öâóò"'Ö“°¢Ğ¢òòFV6öFR–ÆöB†Ç&VG’—77VVB'’ÆRÂG'W7B—BgFW"W†6†ævR¢6öç7BGÒFö¶Vç2æ–E÷Fö¶Vâç7Æ—B‚"â"“°¢–b‡GæÆVæwF‚ÓÓÒ2’°¢6öç7BÂÒ¥4ôâç'6R„'VffW"æg&öÒ‡G³ÒÂ&&6ScGW&Â"’çFõ7G&–ær‚'WFc‚"’’2&V6÷&CÇ7G&–ærÂVæ¶æ÷vãã°¢ÆTVÖ–ÂÒG—VöbÅ²&VÖ–Â%ÒÓÓÒ'7G&–ær"òÅ²&VÖ–Â%Ò¢VæFVf–æVC°¢ÆU7V"ÒG—VöbÅ²'7V"%ÒÓÓÒ'7G&–ær"òÅ²'7V"%Ò¢VæFVf–æVC°¢Ğ¢Ğ ¢òò)H)H7FW3¢'6RW6W&¥4ôâ†æÖR²VÖ–ÂÂöæÇ’öâf—'7B6–vâÖ–â’)H)H)H)H)H)H)H)H ¢ÆWBÆTf—'7DæÖS¢7G&–ærÂVæFVf–æVC°¢–b‡W6W$§6öâ’°¢G'’°¢6öç7BRÒ¥4ôâç'6R‡W6W$§6öâ’2²æÖSó¢²f—'7DæÖSó¢7G&–ærÓ²VÖ–Ãó¢7G&–ærÓ°¢ÆTf—'7DæÖRÒRææÖSòæf—'7DæÖS°¢–b‚ÆTVÖ–Â’ÆTVÖ–ÂÒRæVÖ–Ã°¢Ò6F6‚²ò¢–væ÷&R¢òĞ¢Ğ ¢–b‚ÆTVÖ–ÂbbÆU7V"’°¢F‡&÷ræWrW'&÷"‚$6÷VÆBæ÷BFWFW&Ö–æRÆRW6W"–FVçF—G’(	BVÖ–ÂæB7V"&÷F‚Ö—76–ær"“°¢Ğ ¢òòÆR&—fFR×&VÆ’FG&W76W2‡&—fFW&VÆ’æÆV–Bæ6öÒ’&RfÆ–B(	B66WBF†VĞ¢6öç7B&W6öÇfVDVÖ–ÂÒ†ÆTVÖ–ÂóòG¶ÆU7V'ÔÆR×7V"æÆö6Æ’çFôÆ÷vW$66R‚’çG&–Ò‚“° ¢–b‚—4VÖ–ÄÆÆ÷vVB‡&W6öÇfVDVÖ–Â’’°¢ÆövvW"çv&â‡²VÖ–Ã¢&W6öÇfVDVÖ–ÂÒÂ%´WF…ÒÆRÆöv–â&V¦V7FVB(	BVÖ–Âæ÷BöâÆÆ÷vÆ—7B"“°¢&W2ç&VF—&V7B†G·V&Æ–5W&ÇÒöÆöv–âæ‡FÖÃöW'&÷#Ö66W75öFVæ–VF“°¢&WGW&ã°¢Ğ ¢òò)H)H7FWC¢W'6—7B÷&r6WGF–æw2‡6ÖRGFW&â2vöövÆRôWF‚’)H)H)H)H)H)H)H)H)H)H)H)H)H ¢G'’°¢6öç7B²W6W'D÷&u6WGF–æw2ÂÆöD÷&u6WGF–æw3¢öÆöDÆT÷&rÒÒv—B–×÷'B‚"ââ÷6W'f–6W2ö÷&r×6WGF–æw2æ§2"“°¢6öç7BW†—7F–ærÒv—BöÆöDÆT÷&r‡&W6öÇfVDVÖ–Â’æ6F6‚‚‚’ÓâçVÆÂ“°¢–b†W†—7F–ær’°¢v—BW6W'D÷&u6WGF–æw2‡&W6öÇfVDVÖ–ÂÂ°¢VÖ–Ã¢&W6öÇfVDVÖ–ÂÀ¢f—'7DæÖS¢W†—7F–æræf—'7DæÖRÇÂÆTf—'7DæÖRÀ¢Ò“°¢ÆövvW"æ–æfò‡²VÖ–Ã¢&W6öÇfVDVÖ–ÂÒÂ%´WF…ÒÆRÆöv–â(	BW†—7F–ær÷&rÂ&–ÆÆ–ær&W6W'fVB"“°¢ÒVÇ6R°¢v—BW6W'D÷&u6WGF–æw2‡&W6öÇfVDVÖ–ÂÂ°¢VÖ–Ã¢&W6öÇfVDVÖ–ÂÀ¢f—'7DæÖS¢ÆTf—'7DæÖRÀ¢Æã¢'7FæF&B"À¢7V'67&—F–öå7FGW3¢'VæF–æuö&–ÆÆ–ær"À¢Ò“°¢ÆövvW"æ–æfò‡²VÖ–Ã¢&W6öÇfVDVÖ–ÂÒÂ%´WF…ÒÆRÆöv–â(	BæWr÷&r7&VFVBv—F‚VæF–æuö&–ÆÆ–ær"“°¢Ğ¢Ò6F6‚†÷&tW'"’°¢ÆövvW"çv&â‡²W'#¢÷&tW'"ÒÂ%´WF…ÒÆRÆöv–â(	B÷&u÷6WGF–æw2W'6—7Bf–ÆVB†æöâÖfFÂ’"“°¢Ğ ¢òò)H)H7FWS¢7&VFR6W76–öâ)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢6öç7B6W76–öåFö¶VâÒv—B7&VFU6W76–öâ‡°¢W6W$–C¢&W6öÇfVDVÖ–ÂÀ¢÷&t–C¢&W6öÇfVDVÖ–ÂÀ¢VÖ–Ã¢&W6öÇfVDVÖ–ÂÀ¢&öÆS¢&÷væW""À¢—FG&W73¢&Wæ—óòVæFVf–æVBÀ¢W6W$vVçC¢‡&Wæ†VFW'5²'W6W"ÖvVçB%Ò27G&–ærÂVæFVf–æVB’óòVæFVf–æVBÀ¢Ò“°¢6öç7B—5&öBÒ—4FWÆ÷–VE&öB‚“°¢&W2æ6öö¶–R‚&g÷Fö¶Vâ"Â6W76–öåFö¶VâÂ°¢‡GGöæÇ“¢G'VRÀ¢6V7W&S¢—5&öBÀ¢6ÖU6—FS¢—5&öBò&æöæR"¢&Æ‚"À¢Ö„vS¢4U54”ôåõEDÅôÕ2À¢Fƒ¢"ò"À¢Ò“° ¢ÆövvW"æ–æfò‡²VÖ–Ã¢&W6öÇfVDVÖ–ÂÒÂ%´WF…ÒÆRÆöv–â7V66W76gVÂ"“°¢&W2ç&VF—&V7B†G·V&Æ–5W&ÇÒöF6†&ö&Bæ‡FÖÃ÷&÷f–FW#ÖÆV“° ¢Ò6F6‚†W'"’°¢ÆövvW"æW'&÷"‡²W'"ÒÂ%´WF…ÒÆR6ÆÆ&6²f–ÆVB"“°¢&W2ç&VF—&V7B†G·V&Æ–5W&ÇÒöÆöv–âæ‡FÖÃöW'&÷#ÖÆUöWF…öf–ÆVF“°¢Ğ§Ò“° ¢òò)H)HFWbÖöæÇ’6W76–öâVæGö–çB…Æ—w&–v‡Bò4’WF‚'—72’)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢òò&WV—&W2Tä$ÄUôDUeôUDƒ×G'VRäBæöâ×&öGV7F–öâVçbâ&WGW&ç2CB÷F†W'v—6Rà§&÷WFW"ç÷7B‚"öWF‚öFWb×6W76–öâ"Â7–æ2‡&W¢&WVW7BÂ&W3¢&W7öç6R’Óâ°¢6öç7BFWdVæ&ÆVBÒ&ö6W72æVçe²$Tä$ÄUôDUeôUD‚%ÒÓÓÒ'G'VR#°¢–b‚FWdVæ&ÆVBÇÂ—4FWÆ÷–VE&öB‚’ÇÂ&ö6W72æVçe²$äôDUôTåb%ÒÓÓÒ'&öGV7F–öâ"’°¢&W2ç7FGW2ƒCB’æ§6öâ‡²W'&÷#¢$æ÷Bf÷VæB"Ò“°¢&WGW&ã°¢Ğ¢6öç7BFÖ–ä¶W’Ò‡&Wæ†VFW'5²'‚ÖFÖ–âÖ¶W’%Ò27G&–ær’óò"#°¢6öç7BW‡V7FVD¶W’Ò&ö6W72æVçe²$DÔ”åô´U’%Òóò"#°¢–b‚W‡V7FVD¶W’ÇÂFÖ–ä¶W’ÓÒW‡V7FVD¶W’’°¢&W2ç7FGW2ƒC’æ§6öâ‡²W'&÷#¢%VæWF†÷&—¦VB"Ò“°¢&WGW&ã°¢Ğ¢6öç7B²VÖ–ÂÒ'FW7DfÆ÷wö–çBç&ò"Â÷&t–BÒ&FVfVÇB"Â&öÆRÒ&FÖ–â"ÒÒ‡&Wæ&öG’2²VÖ–Ãó¢7G&–æs²÷&t–Có¢7G&–æs²&öÆSó¢7G&–ærÒ’ÇÂ·Ó°¢G'’°¢6öç7BFö¶VâÒv—B7&VFU6W76–öâ‡°¢W6W$–C¢VÖ–ÂÂ÷&t–BÂVÖ–ÂÂ&öÆRÀ¢—FG&W73¢&Wæ—óòVæFVf–æVBÀ¢W6W$vVçC¢‡&Wæ†VFW'5²'W6W"ÖvVçB%Ò27G&–ærÂVæFVf–æVB’óòVæFVf–æVBÀ¢Ò“°¢6öç7B—5&öBÒ—4FWÆ÷–VE&öB‚“°¢&W2æ6öö¶–R‚&g÷Fö¶Vâ"ÂFö¶VâÂ°¢‡GGöæÇ“¢G'VRÀ¢6V7W&S¢—5&öBÀ¢6ÖU6—FS¢—5&öBò&æöæR"¢&Æ‚"À¢Ö„vS¢4U54”ôåõEDÅôÕ2À¢Fƒ¢"ò"À¢Ò“°¢&W2æ§6öâ‡²ö³¢G'VRÂFö¶VâÂVÖ–ÂÂ÷&t–BÂ&öÆRÒ“°¢Ò6F6‚†W'"’°¢ÆövvW"æW'&÷"‡²W'"ÒÂ%´WF…ÒFWb×6W76–öâ7&VF–öâf–ÆVB"“°¢&W2ç7FGW2ƒS’æ§6öâ‡²W'&÷#¢%6W76–öâ7&VF–öâf–ÆVB"Ò“°¢Ğ§Ò“° ¢òò)H)HFWbÖöæÇ’tUBÆöv–â…Æ—w&–v‡Bò4’’(	B6WG26öö¶–RF†Vâ&VF—&V7G2)H)H)H)H)H)H ¢òòW6vS¢tUBö’öWF‚öFWbÖÆöv–ãö¶W“ÔDÔ”åô´U’g&VF—&V7CÒö’öF6†&ö&Bğ§&÷WFW"ævWB‚"öWF‚öFWbÖÆöv–â"Â7–æ2‡&W¢&WVW7BÂ&W3¢&W7öç6R’Óâ°¢6öç7BFWdVæ&ÆVBÒ&ö6W72æVçe²$Tä$ÄUôDUeôUD‚%ÒÓÓÒ'G'VR#°¢–b‚FWdVæ&ÆVBÇÂ—4FWÆ÷–VE&öB‚’ÇÂ&ö6W72æVçe²$äôDUôTåb%ÒÓÓÒ'&öGV7F–öâ"’°¢&W2ç7FGW2ƒCB’ç6VæB‚$æ÷Bf÷VæB"“°¢&WGW&ã°¢Ğ¢6öç7B¶W’Ò‡&WçVW'•²&¶W’%Ò27G&–ær’óò"#°¢6öç7BW‡V7FVBÒ&ö6W72æVçe²$DÔ”åô´U’%Òóò"#°¢–b‚W‡V7FVBÇÂ¶W’ÓÒW‡V7FVB’²&W2ç7FGW2ƒC’ç6VæB‚%VæWF†÷&—¦VB"“²&WGW&ã²Ğ¢6öç7BVÖ–ÂÒ‡&WçVW'•²&VÖ–Â%Ò27G&–ær’ÇÂ'FW7DfÆ÷wö–çBç&ò#°¢6öç7B÷&t–BÒ‡&WçVW'•²&÷&t–B%Ò27G&–ær’ÇÂ&FVfVÇB#°¢6öç7B&öÆRÒ‡&WçVW'•²'&öÆR%Ò27G&–ær’ÇÂ&FÖ–â#°¢6öç7B&VF—&V7BÒ‡&WçVW'•²'&VF—&V7B%Ò27G&–ær’ÇÂ"öF6†&ö&Bæ‡FÖÂ#°¢G'’°¢6öç7BFö¶VâÒv—B7&VFU6W76–öâ‡°¢W6W$–C¢VÖ–ÂÂ÷&t–BÂVÖ–ÂÂ&öÆRÀ¢—FG&W73¢&Wæ—óòVæFVf–æVBÀ¢W6W$vVçC¢‡&Wæ†VFW'5²'W6W"ÖvVçB%Ò27G&–ærÂVæFVf–æVB’óòVæFVf–æVBÀ¢Ò“°¢&W2æ6öö¶–R‚&g÷Fö¶Vâ"ÂFö¶VâÂ°¢‡GGöæÇ“¢G'VRÂ6V7W&S¢fÇ6RÂ6ÖU6—FS¢&Æ‚"À¢Ö„vS¢4U54”ôåõEDÅôÕ2ÂFƒ¢"ò"À¢Ò“°¢&W2ç&VF—&V7B‡&VF—&V7B“°¢Ò6F6‚†W'"’°¢ÆövvW"æW'&÷"‡²W'"ÒÂ%´WF…ÒFWbÖÆöv–âf–ÆVB"“°¢&W2ç7FGW2ƒS’ç6VæB‚%6W76–öâ7&VF–öâf–ÆVB"“°¢Ğ§Ò“° §&÷WFW"ævWB‚"öWF‚÷&÷f–FW'2"Â…÷&W¢&WVW7BÂ&W3¢&W7öç6R’Óâ°¢6öç7BvöövÆT6öæf–wW&VBÒ‡&ö6W72æVçe²$tôôtÄUô4Ä”TåEô”B%Òbb&ö6W72æVçe²$tôôtÄUô4Ä”TåEõ4T5$UB%Ò“°¢òòÆR&WV—&W24Ä”TåEô”B²DTÕô”B²´U•ô”B²&—fFR¶W’²6ÆÆ&6²&÷WFP¢òòVçF–ÂÆÂ&R&W6VçBF†R'WGFöâ×W7B7F’†–FFVà¢6öç7BÆT6öæf–wW&VBÒ€¢&ö6W72æVçe²$ÄUô4Ä”TåEô”B%Òb`¢&ö6W72æVçe²$ÄUõDTÕô”B%Òb`¢&ö6W72æVçe²$ÄUô´U•ô”B%Ğ¢“°¢6öç7Bv—F‡V$6öæf–wW&VBÒ‡&ö6W72æVçe²$t•D…T%ô4Ä”TåEô”B%Òbb&ö6W72æVçe²$t•D…T%ô4Ä”TåEõ4T5$UB%Ò“° ¢&W2æ§6öâ‡°¢&÷f–FW'3¢°¢²–C¢&vöövÆR"ÂæÖS¢$vöövÆR"Â6öæf–wW&VC¢vöövÆT6öæf–wW&VBÂÆöv–åW&Ã¢"ö’öWF‚övöövÆRöÆöv–â"ÒÀ¢²–C¢&ÆR"ÂæÖS¢$ÆR"Â6öæf–wW&VC¢ÆT6öæf–wW&VBÂÆöv–åW&Ã¢"ö’öWF‚öÆRöÆöv–â"ÒÀ¢²–C¢&v—F‡V""ÂæÖS¢$v—D‡V""Â6öæf–wW&VC¢v—F‡V$6öæf–wW&VBÂÆöv–åW&Ã¢"ö’öWF‚öv—F‡V"öÆöv–â"ÒÀ¢²–C¢&Öv–2ÖÆ–æ²"ÂæÖS¢$VÖ–Â„Öv–2Æ–æ²’"Â6öæf–wW&VC¢G'VRÂÆöv–åW&Ã¢"ö’öWF‚öÆöv–â×&WVW7B"ÒÀ¢ÒÀ¢Ò“°§Ò“° ¦W‡÷'BFVfVÇB&÷WFW#°