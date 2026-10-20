import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { createIpRateLimit, clientIp } from "./rateLimiter.js";

function reqFrom(ip: string): Request {
  return { headers: { "x-forwarded-for": ip }, ip, method: "POST" } as unknown as Request;
}

function resSpy(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status, json, setHeader: vi.fn() } as unknown as Response;
  return { res, status, json };
}

function drive(limiter: (r: Request, s: Response, n: NextFunction) => void, ip: string) {
  const { res, status, json } = resSpy();
  const next = vi.fn();
  limiter(reqFrom(ip), res, next);
  return { passed: next.mock.calls.length === 1, status, json };
}

describe("public checkout rate limit — one prospect cannot lock out another", () => {
  it("counts each address separately", () => {
    // The bug this replaces: every anonymous prospect shared the bucket
    // `reportsPerHour:default`, because getOrgId() returns 'default' with no org.
    const limiter = createIpRateLimit("test_independent", 2, 60_000);

    expect(drive(limiter, "1.1.1.1").passed).toBe(true);
    expect(drive(limiter, "1.1.1.1").passed).toBe(true);
    const exhausted = drive(limiter, "1.1.1.1");
    expect(exhausted.passed).toBe(false);
    expect(exhausted.status).toHaveBeenCalledWith(429);

    // A different prospect, mid-checkout, is untouched by the first one's burst.
    expect(drive(limiter, "2.2.2.2").passed).toBe(true);
    expect(drive(limiter, "2.2.2.2").passed).toBe(true);
  });

  it("answers 429 with a retry delay the page can show", () => {
    const limiter = createIpRateLimit("test_retry_after", 1, 60_000);
    drive(limiter, "3.3.3.3");
    const blocked = drive(limiter, "3.3.3.3");
    expect(blocked.status).toHaveBeenCalledWith(429);
    const body = blocked.json.mock.calls[0]?.[0] ?? blocked.status.mock.results[0]?.value?.json?.mock?.calls?.[0]?.[0];
    expect(JSON.stringify(body)).toContain("RATE_LIMIT_EXCEEDED");
  });

  it("lets the window lapse instead of blocking for ever", () => {
    const limiter = createIpRateLimit("test_window", 1, 1);
    expect(drive(limiter, "4.4.4.4").passed).toBe(true);
    const later = Date.now() + 50;
    const spy = vi.spyOn(Date, "now").mockReturnValue(later);
    try {
      expect(drive(limiter, "4.4.4.4").passed).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("keys on the proxy header, then req.ip, and never throws without either", () => {
    expect(clientIp({ headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } } as unknown as Request)).toBe("9.9.9.9");
    expect(clientIp({ headers: {}, ip: "8.8.8.8" } as unknown as Request)).toBe("8.8.8.8");
    expect(clientIp({ headers: {} } as unknown as Request)).toBe("unknown");
  });
});
