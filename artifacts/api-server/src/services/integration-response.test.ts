import { describe, expect, it } from "vitest";
import { presentIntegration } from "./integration-response.js";

describe("presentIntegration", () => {
  it("never returns stored signing secrets and only returns a newly created secret once", () => {
    const row = { id: "intg_1", secret_key: "stored-signing-key", secretKey: "one-time-key" };
    expect(presentIntegration(row)).toEqual({ id: "intg_1" });
    expect(presentIntegration(row, true)).toEqual({ id: "intg_1", secretKey: "one-time-key" });
  });

  it("masks webhook URL paths and credential-like header values", () => {
    const result = presentIntegration({
      endpoint_url: "https://hooks.example.com/secret-hook?token=query-secret",
      headers: JSON.stringify({ Authorization: "Bearer private", "X-API-Key": "private", "Content-Type": "application/json" }),
    });
    expect(result.endpoint_url).toBe("https://hooks.example.com/…");
    expect(JSON.parse(result.headers as string)).toEqual({
      Authorization: "••••••",
      "X-API-Key": "••••••",
      "Content-Type": "application/json",
    });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("query-secret");
  });
});
