import { describe, expect, it, vi } from "vitest";
import { resolveQuotaGate } from "./quota-gate.js";

describe("resolveQuotaGate", () => {
  it("allows a request only when the quota service explicitly allows it", async () => {
    const check = vi.fn().mockResolvedValue({ allowed: true, used: 1, limit: 10 });
    await expect(resolveQuotaGate(check, "reports", "org-a")).resolves.toEqual({
      status: "allowed",
      quota: { allowed: true, used: 1, limit: 10 },
    });
  });

  it("returns quota exhaustion distinctly from a quota-service failure", async () => {
    const check = vi.fn().mockResolvedValue({ allowed: false, used: 10, limit: 10 });
    await expect(resolveQuotaGate(check, "exports", "org-a")).resolves.toMatchObject({
      status: "exceeded",
      quota: { used: 10, limit: 10 },
    });
  });

  it("fails closed when quota data cannot be loaded", async () => {
    const check = vi.fn().mockRejectedValue(new Error("database unavailable"));
    await expect(resolveQuotaGate(check, "exports", "org-a")).resolves.toMatchObject({ status: "unavailable" });
  });
});
