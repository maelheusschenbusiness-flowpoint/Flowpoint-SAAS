#!/usr/bin/env node
/**
 * E2E isole — invoice.payment_succeeded pour un orgId historique non UUID.
 *
 * Reproduit les 500 observes sur flowpoint-test : une organisation historique
 * (cle email dans org_settings, aucune ligne organizations) recoit un paiement ;
 * la lecture d'attribution vendeur `organizations WHERE id = $1` faisait
 * echouer le cast uuid (22P02) et le webhook repondait 500 en boucle.
 *
 * A lancer UNIQUEMENT contre un PostgreSQL jetable et un serveur API local :
 *   E2E_BASE_URL=http://127.0.0.1:38123 \
 *   DATABASE_URL=postgres://postgres@127.0.0.1:55432/<base jetable> \
 *   STRIPE_WEBHOOK_SECRET=whsec_... (le MEME secret de test que le serveur) \
 *   node scripts/e2e-stripe-webhook-non-uuid.mjs
 *
 * Cas verifies :
 *   1. historique non UUID (cle email) → 200, evenement « processed », statut actif ;
 *   2. nouveau compte UUID avec vendeur → 200 et paiement inscrit au registre vendeur ;
 *   3. nouveau compte UUID sans vendeur → 200, rien au registre ;
 *   4. une vraie panne d'ecriture (registre vendeur indisponible) → toujours 500,
 *      evenement « failed » : la garde ne masque pas les autres erreurs.
 */
import crypto from "node:crypto";
import pg from "pg";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:38123";
const DB_URL = process.env.DATABASE_URL ?? "";
const WH_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error("DATABASE_URL doit viser une base LOCALE jetable"); process.exit(2); }
if (!WH_SECRET.startsWith("whsec_")) { console.error("STRIPE_WEBHOOK_SECRET de test requis"); process.exit(2); }
if (String(process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_")) { console.error("cle live interdite"); process.exit(2); }

const db = new pg.Pool({ connectionString: DB_URL });
const q = async (sql, v = []) => (await db.query(sql, v)).rows;
const RUN = Date.now().toString(36);
let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = "") {
  (cond ? pass++ : fail++);
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

let evtN = 0;
async function webhook(type, object) {
  const event = { id: `evt_nu_${RUN}_${++evtN}`, object: "event", type, livemode: false,
    created: Math.floor(Date.now() / 1000), data: { object }, api_version: "2026-04-22.dahlia" };
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", WH_SECRET).update(`${t}.${payload}`).digest("hex");
  const r = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${t},v1=${sig}` }, body: payload,
  });
  return { status: r.status, id: event.id };
}
const eventStatus = async id => (await q(`SELECT metadata->>'status' AS status FROM billing_events WHERE stripe_event_id=$1`, [id]))[0]?.status ?? null;
const invoice = (cus, n) => ({
  id: `in_nu_${RUN}_${n}`, object: "invoice", customer: cus, subscription: `sub_nu_${RUN}_${n}`,
  amount_paid: 4900, currency: "eur", billing_reason: "subscription_cycle", payment_intent: `pi_nu_${RUN}_${n}`,
  lines: { object: "list", data: [] },
});

// ── 1. Historique : cle email dans org_settings, aucune ligne organizations ──
const legacyId = `legacy.${RUN}@example.test`;
const cusLegacy = `cus_nu_legacy_${RUN}`;
await q(`INSERT INTO org_settings (org_id, plan, email, stripe_customer_id, subscription_status)
         VALUES ($1,'pro',$1,$2,'past_due')`, [legacyId, cusLegacy]);
let w = await webhook("invoice.payment_succeeded", invoice(cusLegacy, 1));
check("historique non UUID : invoice.payment_succeeded → 200 (etait 500)", w.status === 200, `status ${w.status}`);
check("historique non UUID : evenement marque processed", (await eventStatus(w.id)) === "processed", String(await eventStatus(w.id)));
const [osLegacy] = await q(`SELECT subscription_status FROM org_settings WHERE org_id=$1`, [legacyId]);
check("historique non UUID : statut active persiste (traitement valide preserve)", osLegacy?.subscription_status === "active", osLegacy?.subscription_status);
check("historique non UUID : aucune ligne au registre vendeur",
  (await q(`SELECT 1 FROM seller_financial_ledger WHERE org_id=$1`, [legacyId])).length === 0);

// ── 2. Nouveau compte UUID avec vendeur ─────────────────────────────────────
const sellerId = crypto.randomUUID();
await q(`INSERT INTO sellers (id, seller_code, name, email) VALUES ($1,$2,'Vendeur E2E',$3)`,
  [sellerId, `NU${RUN}`.toUpperCase(), `seller.${RUN}@example.test`]);
async function newOrg(tag, seller) {
  const id = crypto.randomUUID(), cus = `cus_nu_${tag}_${RUN}`, email = `${tag}.${RUN}@example.test`;
  await q(`INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, owner_email, stripe_customer_id, seller_id, subscription_status)
           VALUES ($1,$2,$3,'e2e-user','active','pro',$4,$5,$6,'active')`,
    [id, `Org ${tag}`, `nu-${tag}-${RUN}`, email, cus, seller]);
  await q(`INSERT INTO org_settings (org_id, plan, email, stripe_customer_id) VALUES ($1,'pro',$2,$3)
           ON CONFLICT (org_id) DO NOTHING`, [id, email, cus]);
  return { id, cus };
}
const withSeller = await newOrg("seller", sellerId);
w = await webhook("invoice.payment_succeeded", invoice(withSeller.cus, 2));
check("UUID avec vendeur : 200", w.status === 200, `status ${w.status}`);
const ledger = await q(`SELECT event_type FROM seller_financial_ledger WHERE org_id=$1`, [withSeller.id]);
check("UUID avec vendeur : paiement inscrit au registre vendeur", ledger.length >= 1, JSON.stringify(ledger));

// ── 3. Nouveau compte UUID sans vendeur ─────────────────────────────────────
const noSeller = await newOrg("noseller", null);
w = await webhook("invoice.payment_succeeded", invoice(noSeller.cus, 3));
check("UUID sans vendeur : 200", w.status === 200, `status ${w.status}`);
check("UUID sans vendeur : rien au registre vendeur",
  (await q(`SELECT 1 FROM seller_financial_ledger WHERE org_id=$1`, [noSeller.id])).length === 0);

// ── 4. Une vraie panne reste une erreur ─────────────────────────────────────
// Le registre vendeur refuse toute ecriture pour cette org : le webhook doit
// toujours repondre 500 et laisser l'evenement « failed » pour la relivraison.
const broken = await newOrg("broken", sellerId);
await q(`CREATE OR REPLACE FUNCTION e2e_nu_refuse() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN IF NEW.org_id = '${broken.id}' THEN RAISE EXCEPTION 'e2e: registre indisponible'; END IF; RETURN NEW; END $$`);
await q(`CREATE TRIGGER e2e_nu_refuse BEFORE INSERT ON seller_financial_ledger FOR EACH ROW EXECUTE FUNCTION e2e_nu_refuse()`);
try {
  w = await webhook("invoice.payment_succeeded", invoice(broken.cus, 4));
  check("panne reelle (UUID) : toujours 500, non masquee", w.status === 500, `status ${w.status}`);
  check("panne reelle (UUID) : evenement marque failed (relivraison possible)", (await eventStatus(w.id)) === "failed", String(await eventStatus(w.id)));
} finally {
  await q(`DROP TRIGGER IF EXISTS e2e_nu_refuse ON seller_financial_ledger`);
  await q(`DROP FUNCTION IF EXISTS e2e_nu_refuse()`);
}

console.log(results.join("\n"));
console.log(`\n${pass} PASS / ${fail} FAIL`);
await db.end();
process.exit(fail ? 1 : 0);
