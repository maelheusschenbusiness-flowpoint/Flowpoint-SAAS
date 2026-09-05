/**
 * finalize-checkout Path C — PI/SI metadata pre_register_token recovery
 *
 * When the frontend loses fp_pre_reg_token (sessionStorage cleared by Stripe
 * redirect, localStorage expired), finalize-checkout must recover it from the
 * PaymentIntent or SetupIntent metadata before returning 401.
 *
 * Test IDs: FC-C1 … FC-C5
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(import.meta.dirname ?? __dirname, "../routes/public-billing.ts");
const src = fs.readFileSync(SRC, "utf8");

// ── FC-C1: Path C block is present and guards on intentType payment|setup ────
describe("FC-C1 — Path C auth gate block", () => {
  it("contains Path C guard: !_authenticatedOrgId && intentId && (intentType payment|setup)", () => {
    expect(src).toMatch(/Path C/i);
    expect(src).toMatch(
      /!_authenticatedOrgId\s*&&\s*intentId\s*&&\s*\(\s*intentType\s*===\s*["']payment["']\s*\|\|\s*intentType\s*===\s*["']setup["']\s*\)/
    );
  });

  it("retrieves paymentIntent when intentType === 'payment'", () => {
    expect(src).toMatch(/paymentIntents\.retrieve/);
    expect(src).toMatch(/setupIntents\.retrieve/);
  });

  it("reads pre_register_token from retrieved intent metadata", () => {
    expect(src).toMatch(/_recMeta\["pre_register_token"\]/);
  });

  it("updates preRegisterToken (let) so activateNewSignup uses it", () => {
    // Ensure preRegisterToken is mutable (let) at the finalize-checkout declaration
    const letMatch = src.match(/let preRegisterToken\s*=/);
    expect(letMatch, "preRegisterToken must be declared with `let` (not const) in finalize-checkout").toBeTruthy();
  });

  it("Path C is wrapped in try/catch so Stripe errors are non-fatal", () => {
    // The pattern: try { ... Path C ... } catch (_pathCErr) { logger.warn ... }
    expect(src).toMatch(/_pathCErr/);
    expect(src).toMatch(/Path C.*PI\/SI metadata recovery failed.*non-fatal/i);
  });
});

// ── FC-C2: Path C is positioned BEFORE the 401 return ────────────────────────
describe("FC-C2 — Path C precedes the 401 gate", () => {
  it("Path C block appears before the 401 auth_required return", () => {
    const pathCIdx = src.indexOf("Path C: authenticated via PI");
    const gate401Idx = src.indexOf("auth_required");
    expect(pathCIdx).toBeGreaterThan(0);
    expect(gate401Idx).toBeGreaterThan(0);
    expect(pathCIdx, "Path C must appear before the 401 gate").toBeLessThan(gate401Idx);
  });
});

// ── FC-C3: checkout-return.html — 401 no longer shows "Session expirée" ──────
describe("FC-C3 — checkout-return.html 401 message is not 'Session expirée'", () => {
  const crSrc = (() => {
    const p = path.join(import.meta.dirname ?? __dirname, "../../../flowpoint-export/checkout-return.html");
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  })();

  it("checkout-return.html exists", () => {
    expect(crSrc.length, "checkout-return.html not found").toBeGreaterThan(0);
  });

  it("401 handler does not display 'Session expirée' as the title", () => {
    // Extract the 401 branch content
    const idx401 = crSrc.indexOf("res.status === 401");
    expect(idx401).toBeGreaterThan(0);
    const block = crSrc.slice(idx401, idx401 + 600);
    expect(block).not.toContain("Session expirée");
  });

  it("401 handler mentions 'email' (guide user to check email)", () => {
    const idx401 = crSrc.indexOf("res.status === 401");
    const block = crSrc.slice(idx401, idx401 + 600);
    expect(block.toLowerCase()).toMatch(/email|connexion|se connecter/i);
  });
});

// ── FC-C4: finalize-checkout intentType validation still blocks checkout_session ──
describe("FC-C4 — Path C only fires for payment|setup, not checkout_session", () => {
  it("Path C guard excludes intentType === checkout_session", () => {
    // The guard: intentType === 'payment' || intentType === 'setup'
    // checkout_session type must NOT be in the Path C guard
    const pathCStart = src.indexOf("Path C: recover");
    const pathCEnd   = src.indexOf("Path C: PI/SI metadata recovery failed") + 200;
    const pathCBlock = src.slice(pathCStart, pathCEnd);
    expect(pathCBlock).not.toContain("checkout_session");
  });
});

// ── FC-C5: preRegisterToken used by _fcPrt later ─────────────────────────────
describe("FC-C5 — preRegisterToken flows into _fcPrt for activateNewSignup", () => {
  it("_fcPrt reads preRegisterToken (which Path C may have updated)", () => {
    // _fcPrt = preRegisterToken || intentMeta["pre_register_token"] || ""
    expect(src).toMatch(/_fcPrt\s*=\s*preRegisterToken\s*\|\|/);
  });
});
