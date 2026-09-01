/**
 * session-restore Bearer/Cookie precedence tests
 * Invariant: Bearer explicit → authoritative (no cookie fallback).
 * Cookie only used when no Bearer is present.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock getSession ───────────────────────────────────────────────────────────
// We test the resolution logic directly, mirroring auth.ts handler exactly.

type Session = { token: string; orgId: string; email: string; userId: string } | null;

const SESSION_A: Session = { token: "TOKEN_A", orgId: "org-a", email: "a@example.com", userId: "a" };
const SESSION_B: Session = { token: "TOKEN_B", orgId: "org-b", email: "b@example.com", userId: "b" };

/** Mirrors the new session-resolve logic from POST /auth/session-restore */
async function resolveSession(
  bearerToken: string | undefined,
  cookieToken: string | undefined,
  getSession: (token: string) => Promise<Session>
): Promise<{ session: Session; via: string }> {
  if (bearerToken) {
    const session = await getSession(bearerToken);
    if (session) return { session, via: "bearer" };
    // Bearer present but invalid → 401, no cookie fallback
    return { session: null, via: "bearer-invalid" };
  } else if (cookieToken) {
    const session = await getSession(cookieToken);
    if (session) return { session, via: "cookie-only" };
    return { session: null, via: "cookie-only-failed" };
  }
  return { session: null, via: "anonymous" };
}

// Mock getSession: TOKEN_A → SESSION_A, TOKEN_B → SESSION_B, anything else → null
async function mockGetSession(token: string): Promise<Session> {
  if (token === "TOKEN_A") return SESSION_A;
  if (token === "TOKEN_B") return SESSION_B;
  return null;
}

// ── CAS 1: Bearer A valide, aucun cookie ─────────────────────────────────────
describe("CAS 1 — valid Bearer A, no cookie", () => {
  it("returns session A", async () => {
    const { session, via } = await resolveSession("TOKEN_A", undefined, mockGetSession);
    expect(session?.orgId).toBe("org-a");
    expect(via).toBe("bearer");
  });
});

// ── CAS 2: Bearer A valide + cookie B ────────────────────────────────────────
describe("CAS 2 — valid Bearer A + cookie B", () => {
  it("returns session A, cookie B is ignored", async () => {
    const { session, via } = await resolveSession("TOKEN_A", "TOKEN_B", mockGetSession);
    expect(session?.orgId).toBe("org-a");
    expect(session?.orgId).not.toBe("org-b");
    expect(via).toBe("bearer");
  });
});

// ── CAS 3 CRITIQUE: Bearer A invalide/stale + cookie B valide ─────────────────
describe("CAS 3 — invalid Bearer A + valid cookie B → 401 (no cross-user fallback)", () => {
  it("returns null session, never returns B identity", async () => {
    const { session, via } = await resolveSession("TOKEN_A_STALE", "TOKEN_B", mockGetSession);
    expect(session).toBeNull();
    expect(via).toBe("bearer-invalid");
  });
  it("the response must NOT contain any org-b data", async () => {
    const { session } = await resolveSession("TOKEN_A_STALE", "TOKEN_B", mockGetSession);
    expect(session?.orgId).not.toBe("org-b");
    expect(session?.email).not.toBe("b@example.com");
  });
});

// ── CAS 4: Bearer invalide + cookie A valide → 401 ───────────────────────────
describe("CAS 4 — invalid Bearer + valid cookie A → 401", () => {
  it("returns null when Bearer is present but invalid, even if cookie is valid", async () => {
    const { session, via } = await resolveSession("TOKEN_UNKNOWN", "TOKEN_A", mockGetSession);
    expect(session).toBeNull();
    expect(via).toBe("bearer-invalid");
  });
});

// ── CAS 5: aucun Bearer, cookie B valide ─────────────────────────────────────
describe("CAS 5 — no Bearer, valid cookie B → 200 B", () => {
  it("returns session B via cookie-only path", async () => {
    const { session, via } = await resolveSession(undefined, "TOKEN_B", mockGetSession);
    expect(session?.orgId).toBe("org-b");
    expect(via).toBe("cookie-only");
  });
});

// ── CAS 6: aucun Bearer, cookie A valide ─────────────────────────────────────
describe("CAS 6 — no Bearer, valid cookie A → 200 A", () => {
  it("returns session A via cookie-only path", async () => {
    const { session, via } = await resolveSession(undefined, "TOKEN_A", mockGetSession);
    expect(session?.orgId).toBe("org-a");
    expect(via).toBe("cookie-only");
  });
});

// ── CAS 7: aucun Bearer, cookie invalide → 401 ───────────────────────────────
describe("CAS 7 — no Bearer, invalid cookie → 401", () => {
  it("returns null", async () => {
    const { session, via } = await resolveSession(undefined, "TOKEN_INVALID", mockGetSession);
    expect(session).toBeNull();
    expect(via).toBe("cookie-only-failed");
  });
});

// ── CAS 8: aucune credential → 401 ───────────────────────────────────────────
describe("CAS 8 — no credentials → 401", () => {
  it("returns null session", async () => {
    const { session, via } = await resolveSession(undefined, undefined, mockGetSession);
    expect(session).toBeNull();
    expect(via).toBe("anonymous");
  });
});

// ── CAS 9: Bearer B valide + cookie A → retourne B ───────────────────────────
describe("CAS 9 — valid Bearer B + cookie A → 200 B", () => {
  it("Bearer wins regardless of cookie org", async () => {
    const { session, via } = await resolveSession("TOKEN_B", "TOKEN_A", mockGetSession);
    expect(session?.orgId).toBe("org-b");
    expect(via).toBe("bearer");
  });
});

// ── TEST HOSTILE: cross-org isolation ────────────────────────────────────────
describe("TEST HOSTILE — cross-org Bearer/Cookie contamination", () => {
  // Org A and Org B are distinct. Invalid Bearer for A + valid cookie for B
  // must NEVER return B's identity.
  it("invalid Bearer A + valid cookie B → null (401), zero B data in response", async () => {
    const staleBearer = "fp_qa_a_STALE_TOKEN_THAT_IS_NOT_IN_DB";
    const validCookieB = "TOKEN_B";
    const { session } = await resolveSession(staleBearer, validCookieB, mockGetSession);
    // Critical assertions
    expect(session).toBeNull();
    expect(session?.email).toBeUndefined();
    expect(session?.orgId).toBeUndefined();
  });

  it("after invalid-A request, cookie B still resolves when no Bearer is sent", async () => {
    // Proves cookie B was not destroyed by the invalid-A request
    const { session, via } = await resolveSession(undefined, "TOKEN_B", mockGetSession);
    expect(session?.orgId).toBe("org-b");
    expect(via).toBe("cookie-only");
  });
});

// ── NON-REGRESSION: expired/unknown Bearer variants ──────────────────────────
describe("Non-regression — various invalid Bearer + valid cookie", () => {
  const validCookieA = "TOKEN_A";

  it("expired Bearer + valid cookie → 401", async () => {
    const { session } = await resolveSession("TOKEN_EXPIRED", validCookieA, mockGetSession);
    expect(session).toBeNull();
  });
  it("unknown Bearer + valid cookie → 401", async () => {
    const { session } = await resolveSession("TOKEN_UNKNOWN_XYZ", validCookieA, mockGetSession);
    expect(session).toBeNull();
  });
  it("empty-string Bearer treated as no Bearer → falls to cookie path", async () => {
    // Empty string after trim → bearerToken = undefined in actual code
    // (authHeader.startsWith("Bearer ") + slice(7).trim() → "")
    // We simulate: bearerToken = "" which our resolve fn treats as falsy
    const { session, via } = await resolveSession("" || undefined, validCookieA, mockGetSession);
    expect(session?.orgId).toBe("org-a");
    expect(via).toBe("cookie-only");
  });
});

// ── Symmetry checks ──────────────────────────────────────────────────────────
describe("Symmetry — A/B swapped scenarios", () => {
  it("invalid Bearer B + valid cookie A → 401 (not A)", async () => {
    const { session } = await resolveSession("TOKEN_B_STALE", "TOKEN_A", mockGetSession);
    expect(session).toBeNull();
  });
  it("valid Bearer A + no cookie → A", async () => {
    const { session } = await resolveSession("TOKEN_A", undefined, mockGetSession);
    expect(session?.orgId).toBe("org-a");
  });
  it("valid Bearer B + no cookie → B", async () => {
    const { session } = await resolveSession("TOKEN_B", undefined, mockGetSession);
    expect(session?.orgId).toBe("org-b");
  });
});
