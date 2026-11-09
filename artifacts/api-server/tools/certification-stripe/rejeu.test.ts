import { describe, it, expect } from "vitest";
import { verifierUrlLocale, rejouerEvenement } from "./rejeu.ts";
import { CleRefusee } from "./garde-cles.ts";

describe("rejeu signe : uniquement local, uniquement cles de test", () => {
  it("refuse tout hote non local et tout autre chemin", () => {
    expect(() => verifierUrlLocale("https://flowpoint-test.onrender.com/api/billing/webhook")).toThrow(CleRefusee);
    expect(() => verifierUrlLocale("https://app.flowpoint.pro/api/billing/webhook")).toThrow(CleRefusee);
    expect(() => verifierUrlLocale("http://127.0.0.1:8080/api/admin")).toThrow(CleRefusee);
    expect(verifierUrlLocale("http://127.0.0.1:8080/api/billing/webhook").pathname).toBe("/api/billing/webhook");
  });
  it("refuse une cle live avant tout appel reseau", async () => {
    await expect(rejouerEvenement({ evenementId: "evt_1", url: "http://127.0.0.1:8080/api/billing/webhook", fois: 1, env: { STRIPE_TEST_SECRET_KEY: "sk_live_" + "a".repeat(30), STRIPE_TEST_WEBHOOK_SECRET: "whsec_" + "a".repeat(20) } })).rejects.toThrow(CleRefusee);
  });
});
