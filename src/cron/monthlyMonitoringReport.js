/**
 * src/cron/monthlyMonitoringReport.js
 * Cron #3 — FlowPoint AI
 *
 * But: déclencher la génération du rapport monitoring mensuel (PDF) côté Web Service
 * sans dupliquer la logique (donc sans casser l’existant).
 *
 * Nécessite:
 * - PUBLIC_BASE_URL (ex: https://flowpoint-saas-1.onrender.com)
 * - CRON_KEY (secret)
 */

async function main() {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  const cronKey = process.env.CRON_KEY || "";

  if (!base) throw new Error("PUBLIC_BASE_URL manquante");
  if (!cronKey) throw new Error("CRON_KEY manquante");

  // Endpoint à créer/brancher côté backend :
  // → Il génère le PDF mensuel et (optionnel) l’envoie par email aux bons destinataires (Ultra).
  const url = `${base}/api/cron/monitoring/monthly-report`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cron-key": cronKey,
    },
    body: JSON.stringify({}),
  });

  const text = await r.text().catch(() => "");
  if (!r.ok) {
    throw new Error(`Cron call failed ${r.status}: ${text.slice(0, 400)}`);
  }

  console.log("✅ Monthly monitoring report triggered:", text.slice(0, 400));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Cron failed:", e);
    process.exit(1);
  });
