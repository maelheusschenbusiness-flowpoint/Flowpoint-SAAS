#!/usr/bin/env tsx
/** Usage : tsx tools/certification-stripe/analyser-journal-listen.ts <fichier-journal-stripe-listen> [--requis setup_intent.succeeded,customer.subscription.created] */
import { readFileSync } from "node:fs";
import { analyserJournalListen } from "./journal-listen.ts";

const fichier = process.argv[2];
if (!fichier) { console.error("Usage : <fichier> [--requis type1,type2]"); process.exit(2); }
const i = process.argv.indexOf("--requis");
const requis = (i > -1 ? process.argv[i + 1]! : "setup_intent.succeeded,customer.subscription.created").split(",").filter(Boolean);
const r = analyserJournalListen(readFileSync(fichier, "utf8"));
for (const l of r.livraisons) console.log(`${l.statut! >= 200 && l.statut! < 300 ? "OK  " : "FAIL"}  [${l.statut}] ${l.type} ${l.evenement}`);
for (const l of r.sansReponse) console.log(`FAIL  sans reponse : ${l.type} ${l.evenement}`);
const manquants = requis.filter((t) => !r.livraisons.some((l) => l.type === t && l.statut! >= 200 && l.statut! < 300));
for (const t of manquants) console.log(`FAIL  evenement requis jamais livre en 2xx : ${t}`);
const go = r.echecs.length === 0 && r.sansReponse.length === 0 && manquants.length === 0 && r.livraisons.length > 0;
console.log(go ? "\nVERDICT : GO (tous les evenements livres, reponse 2xx)" : "\nVERDICT : NO-GO");
process.exit(go ? 0 : 1);
