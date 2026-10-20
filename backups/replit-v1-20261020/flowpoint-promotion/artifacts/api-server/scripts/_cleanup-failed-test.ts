import Stripe from "stripe";
import { pool } from "@workspace/db";
const stripe = new Stripe(process.env["STRIPE_LIVE_API_KEY"]!, { apiVersion: "2025-06-30.basil" as Parameters<typeof Stripe>[1]["apiVersion"] });
async function main() {
  await stripe.subscriptions.cancel("sub_1Tyyz79eqtbj6iPBWCzWnVta").catch(e => console.log("sub:", e.message));
  const c = await pool.connect();
  try {
    await c.query(`DELETE FROM org_settings WHERE org_id LIKE 'test-t1t4-%'`);
    await c.query(`DELETE FROM organizations WHERE id LIKE 'test-t1t4-%'`);
    await c.query(`DELETE FROM user_sessions WHERE org_id LIKE 'test-t1t4-%'`);
    console.log("DB cleaned");
  } finally { c.release(); }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
