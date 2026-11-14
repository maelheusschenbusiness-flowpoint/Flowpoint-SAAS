/** 12. Signatures de webhook REELLES contre le service de test : absente, invalide, perimee -> refus, sans effet. */
import { test, expect } from "@playwright/test";
import { cfg } from "./support/stripe-reel.ts";
import { exigerContrat } from "./support/contrat.ts";

exigerContrat();

const CORPS = JSON.stringify({ id: "evt_fake_cert_signature", object: "event", type: "customer.subscription.created", data: { object: { id: "sub_fake", customer: "cus_fake" } } });
const post = (request: import("@playwright/test").APIRequestContext, entetes: Record<string, string>) =>
  request.post(`${cfg.baseUrl}/api/webhooks/stripe`, { data: CORPS, headers: { "content-type": "application/json", ...entetes } });

test("signature absente : refusee (400)", async ({ request }) => { expect((await post(request, {})).status()).toBe(400); });
test("signature invalide : refusee (400)", async ({ request }) => {
  expect((await post(request, { "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=deadbeef` })).status()).toBe(400);
});
test("horodatage perime : refuse (400)", async ({ request }) => {
  expect((await post(request, { "stripe-signature": `t=1000000000,v1=${"0".repeat(64)}` })).status()).toBe(400);
});
test("chemin historique /api/billing/webhook : meme refus", async ({ request }) => {
  const r = await request.post(`${cfg.baseUrl}/api/billing/webhook`, { data: CORPS, headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=00" } });
  expect(r.status()).toBe(400);
});
