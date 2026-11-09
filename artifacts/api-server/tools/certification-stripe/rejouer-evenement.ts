#!/usr/bin/env tsx
/** tsx tools/certification-stripe/rejouer-evenement.ts --event evt_xxx [--url http://127.0.0.1:8080/api/billing/webhook] [--fois 3] */
import { rejouerEvenement } from "./rejeu.ts";
import { CleRefusee, masquerSecrets } from "./garde-cles.ts";
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
const evt = arg("event");
if (!evt) { console.error("Usage : --event evt_... [--url ...] [--fois N]"); process.exit(2); }
rejouerEvenement({ evenementId: evt, url: arg("url") ?? "http://127.0.0.1:8080/api/billing/webhook", fois: Number(arg("fois") ?? 3) })
  .then((r) => { console.log(`${r.type} ${r.evenement} -> statuts ${r.statuts.join(", ")}`); process.exit(r.statuts.every((s) => s >= 200 && s < 300) ? 0 : 1); })
  .catch((e) => { console.error(e instanceof CleRefusee ? `REFUS : ${e.message}` : `ERREUR : ${masquerSecrets(String(e?.message ?? e))}`); process.exit(2); });
