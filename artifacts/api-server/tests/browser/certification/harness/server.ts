/**
 * Serveur LOCAL de certification navigateur.
 *
 * Demarre la VRAIE application (src/app.ts : memes routes, memes pages statiques,
 * memes middlewares) contre la base PostgreSQL jetable, avec :
 *   - Stripe remplace par un faux en memoire (fake-stripe.ts), jamais de reseau ;
 *   - e-mails captures sur disque (TEST_MAIL_DIR + ENABLE_TEST_MAILER, hook existant
 *     de services/mailer.ts) : jamais Resend, jamais SMTP ;
 *   - Google OAuth simule : les deux appels sortants du callback
 *     (oauth2.googleapis.com/token et googleapis.com/oauth2/v3/userinfo) sont
 *     interceptes dans CE processus ; l'ecran Google lui-meme est simule par la
 *     suite Playwright (route sur accounts.google.com).
 *
 * Les points /__fake/* n'existent que dans ce processus (enveloppe externe) ; ils ne
 * font pas partie de l'application et refusent de demarrer si NODE_ENV=production.
 */
import express from "express";
import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";
import { setStripeForTesting } from "../../../../src/services/stripe-factory.ts";
import { createFakeStripe, FakeStripeState } from "./fake-stripe.ts";

if (process.env["NODE_ENV"] === "production") throw new Error("Le harnais de certification refuse NODE_ENV=production.");
if (process.env["NODE_ENV"] !== "test") throw new Error("Le harnais exige NODE_ENV=test (lancer via run-local.sh).");
const dbUrl = process.env["DATABASE_URL"] ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(dbUrl)) {
  throw new Error("Le harnais n'accepte qu'une base PostgreSQL LOCALE (127.0.0.1/localhost). DATABASE_URL refusee.");
}

const PORT = Number(process.env["PORT"] ?? 4321);
const MAIL_DIR = process.env["TEST_MAIL_DIR"] ?? "";
if (!MAIL_DIR) throw new Error("TEST_MAIL_DIR requis (capture des e-mails).");
fs.mkdirSync(MAIL_DIR, { recursive: true });

// ── Stripe simule ────────────────────────────────────────────────────────────
const stripeState = new FakeStripeState();
setStripeForTesting(createFakeStripe(stripeState));

// ── Google simule : interception des appels sortants du callback ─────────────
type Persona = { email: string; given_name?: string; family_name?: string; email_verified?: boolean };
const personas = new Map<string, Persona>();
const googleCalls: string[] = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    const body = new URLSearchParams(String(init?.body ?? ""));
    const code = body.get("code") ?? "";
    googleCalls.push(`token:${code}`);
    if (!personas.has(code)) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ access_token: `at:${code}`, id_token: "fake.id.token", token_type: "Bearer", expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.startsWith("https://www.googleapis.com/oauth2/v3/userinfo")) {
    const auth = String((init?.headers as Record<string, string> | undefined)?.["Authorization"] ?? "");
    const code = auth.replace(/^Bearer at:/, "");
    googleCalls.push(`userinfo:${code}`);
    const p = personas.get(code);
    if (!p) return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ sub: `sub-${code}`, email: p.email, email_verified: p.email_verified !== false, given_name: p.given_name ?? "Test", family_name: p.family_name ?? "Google", name: `${p.given_name ?? "Test"} ${p.family_name ?? "Google"}` }), { status: 200, headers: { "content-type": "application/json" } });
  }
  // Tout autre appel sortant vers un hote public est refuse : la certification ne doit rien joindre.
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  if (host && host !== "127.0.0.1" && host !== "localhost") {
    return new Response(JSON.stringify({ error: "harnais: appel sortant bloque", host }), { status: 599, headers: { "content-type": "application/json" } });
  }
  return realFetch(input as Parameters<typeof fetch>[0], init);
}) as typeof fetch;

// ── Application reelle ───────────────────────────────────────────────────────
const { default: app } = await import("../../../../src/app.ts");

const outer = express();
const fake = express.Router();
fake.use(express.json());

fake.get("/health", (_req, res) => { res.json({ ok: true, pid: process.pid }); });

fake.post("/stripe/confirm-setup", (req, res) => {
  const { clientSecret, card } = req.body as { clientSecret?: string; card?: string };
  res.json(stripeState.confirmSetup(String(clientSecret ?? ""), String(card ?? "")));
});
fake.get("/stripe/state", (_req, res) => { res.json(stripeState.snapshot()); });
fake.post("/stripe/reset", (_req, res) => { stripeState.reset(); res.json({ ok: true }); });
fake.post("/stripe/fail-next", (req, res) => { const { path: p, message } = req.body as { path: string; message: string }; stripeState.failNext.set(p, message); res.json({ ok: true }); });

fake.get("/mails", (req, res) => {
  const to = String(req.query["to"] ?? "").toLowerCase();
  const files = fs.existsSync(MAIL_DIR) ? fs.readdirSync(MAIL_DIR).filter((f) => f.endsWith(".json")).sort() : [];
  const mails = files.map((f) => ({ file: f, ...(JSON.parse(fs.readFileSync(path.join(MAIL_DIR, f), "utf8")) as Record<string, unknown>) }))
    .filter((m) => !to || String(m["to"]).toLowerCase() === to);
  res.json({ mails });
});
fake.post("/mails/clear", (_req, res) => { for (const f of fs.existsSync(MAIL_DIR) ? fs.readdirSync(MAIL_DIR) : []) fs.rmSync(path.join(MAIL_DIR, f), { force: true }); res.json({ ok: true }); });

fake.post("/google/persona", (req, res) => { const { code, ...p } = req.body as { code: string } & Persona; personas.set(code, p as Persona); res.json({ ok: true }); });
fake.get("/google/calls", (_req, res) => { res.json({ calls: googleCalls }); });

/** Livre a l'application un evenement Stripe SIGNE (meme verification que Stripe reel). */
fake.post("/webhook", async (req, res) => {
  const { type, object, id } = req.body as { type: string; object: Record<string, unknown>; id?: string };
  const payload = JSON.stringify({ id: id ?? `evt_fake_${Date.now()}`, object: "event", api_version: "2026-04-22.dahlia", created: Math.floor(Date.now() / 1000), livemode: false, type, data: { object } });
  const secret = process.env["STRIPE_TEST_WEBHOOK_SECRET"]!;
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  const r = await realFetch(`http://127.0.0.1:${PORT}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": header }, body: payload });
  res.status(200).json({ status: r.status, body: await r.text() });
});

outer.use("/__fake", fake);
outer.use(app);
outer.listen(PORT, "127.0.0.1", () => { console.log(`[certification] serveur local pret sur http://127.0.0.1:${PORT}`); });
