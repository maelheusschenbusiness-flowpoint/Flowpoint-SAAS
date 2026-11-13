#!/usr/bin/env node
/**
 * Pre-controle des PREREQUIS des certifications reelles (aucun appel reseau, aucune ecriture).
 * N'affiche JAMAIS une valeur : seulement READY / MISSING / REFUSED par prerequis.
 *
 *   node scripts/certify-preflight.mjs conversion   # Stripe TEST + AI Lab + e-mails
 *   node scripts/certify-preflight.mjs hubspot      # application HubSpot de test
 *
 * Code de sortie : 0 = tous les prerequis sont reunis, 1 = au moins un manque, 3 = environnement dangereux
 * (cle LIVE detectee : on refuse de continuer, quoi que contienne le reste).
 */
import { pathToFileURL } from "node:url";

/** Evalue un jeu de variables et retourne { dangers, items }. Pure : testable sans environnement. */
export function evaluer(profil, env) {
  const v = (k) => (env[k] ?? "").trim();
  const items = [];
  const dangers = [];
  const add = (id, etat, note) => items.push({ id, etat, note });

  // Garde LIVE commune : toute cle *_live_ dans l'environnement arrete la certification.
  for (const [k, val] of Object.entries(env)) {
    if (typeof val === "string" && /(sk|pk|rk|whsec)_live_/.test(val)) dangers.push(`${k} contient une cle LIVE`);
  }
  if (/^(production|prod)$/i.test(v("NODE_ENV"))) dangers.push("NODE_ENV=production : la certification ne s'execute que sur une base jetable ou une preproduction");

  if (profil === "conversion") {
    // Variables EXACTEMENT celles lues par la suite reelle (tools/certification-stripe/config.ts).
    add("CERT_STRIPE_REEL=1", v("CERT_STRIPE_REEL") === "1" ? "READY" : "MISSING", "garde-fou : la suite ne tourne que sur demande explicite");
    const base = v("CERT_STRIPE_BASE_URL");
    const cibleOk = /^(http:\/\/(127\.0\.0\.1|localhost)(:\d+)?|https:\/\/flowpoint-test\.onrender\.com)\/?$/.test(base);
    add("CERT_STRIPE_BASE_URL", cibleOk ? "READY" : base ? "REFUSED" : "MISSING", "admis : localhost, 127.0.0.1 (Mode L) ou flowpoint-test.onrender.com (Mode R) ; jamais app.flowpoint.pro");
    const local = /^http:\/\/(127\.0\.0\.1|localhost)/.test(base);
    add("CERT_STRIPE_EMAIL_BASE (nom@domaine, sans +)", /^[^@+\s]+@[^@\s]+\.[^@\s]+$/.test(v("CERT_STRIPE_EMAIL_BASE")) ? "READY" : v("CERT_STRIPE_EMAIL_BASE") ? "REFUSED" : "MISSING", "boite de test : adressage « + »");
    const sk = v("STRIPE_TEST_SECRET_KEY");
    add("STRIPE_TEST_SECRET_KEY (sk_test_...)", /^sk_test_/.test(sk) ? "READY" : sk ? "REFUSED" : "MISSING", "preuves cote Stripe");
    const pk = v("STRIPE_TEST_PUBLISHABLE_KEY");
    add("STRIPE_TEST_PUBLISHABLE_KEY (pk_test_...)", /^pk_test_/.test(pk) ? "READY" : pk ? "REFUSED" : "MISSING", "");
    add("STRIPE_TEST_WEBHOOK_SECRET (whsec_...)", /^whsec_/.test(v("STRIPE_TEST_WEBHOOK_SECRET")) ? "READY" : "MISSING", "secret du point de terminaison TEST / stripe listen");
    add("STRIPE_TEST_MODE=true (serveur sous test)", v("STRIPE_TEST_MODE") === "true" ? "READY" : "MISSING", "mode TEST explicite cote application");
    add("ENABLE_TEST_MAILER=true + TEST_MAIL_DIR", local ? (v("ENABLE_TEST_MAILER") === "true" && v("TEST_MAIL_DIR") ? "READY" : "MISSING") : "OPTIONAL", "requis en Mode L : e-mails captures, jamais envoyes");
    add("AI_LAB_CONVERSION_URL (instance de TEST)", /^https:\/\//.test(v("AI_LAB_CONVERSION_URL")) ? "READY" : "MISSING", "jamais l'instance de production d'acquisition");
    add("CONVERSION_EVENT_SECRET (>= 32 caracteres)", v("CONVERSION_EVENT_SECRET").length >= 32 ? "READY" : "MISSING", "");
    add("ADMIN_KEY (lecture des deux dashboards)", v("ADMIN_KEY").length >= 16 ? "READY" : "MISSING", "");
  } else if (profil === "hubspot") {
    add("HUBSPOT_CLIENT_ID", v("HUBSPOT_CLIENT_ID") ? "READY" : "MISSING", "application HubSpot de TEST (compte developpeur)");
    add("HUBSPOT_CLIENT_SECRET", v("HUBSPOT_CLIENT_SECRET").length >= 16 ? "READY" : "MISSING", "signe aussi les webhooks");
    add("CRM_TOKEN_ENCRYPTION_KEY (64 hex)", /^[a-f\d]{64}$/i.test(v("CRM_TOKEN_ENCRYPTION_KEY")) ? "READY" : "MISSING", "cle distincte de toute autre cle");
    add("CRM_OAUTH_REDIRECT_BASE ou PUBLIC_URL (https)", /^https:\/\//.test(v("CRM_OAUTH_REDIRECT_BASE") || v("PUBLIC_URL") || v("RENDER_EXTERNAL_URL")) ? "READY" : "MISSING", "HubSpot exige une URL de redirection https declaree dans l'application");
    add("CRM_WEBHOOK_PUBLIC_URL (si different)", v("CRM_WEBHOOK_PUBLIC_URL") ? "READY" : "OPTIONAL", "base exacte signee par HubSpot");
    const surcharge = v("HUBSPOT_AUTH_BASE") || v("HUBSPOT_API_BASE");
    add("HUBSPOT_AUTH_BASE / HUBSPOT_API_BASE absents", surcharge ? "REFUSED" : "READY", "ces surcharges (fausse API) ne doivent pas etre posees pour une certification reelle");
  } else {
    throw new Error(`profil inconnu : ${profil} (conversion | hubspot)`);
  }
  return { dangers, items };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const profil = process.argv[2];
  let r;
  try { r = evaluer(profil, process.env); } catch (e) { console.error(e.message); process.exit(2); }
  if (r.dangers.length) {
    for (const d of r.dangers) console.error(`DANGER  ${d}`);
    console.error("Certification refusee : retirer la cle LIVE / changer d'environnement.");
    process.exit(3);
  }
  for (const i of r.items) console.log(`${i.etat.padEnd(8)} ${i.id}${i.note ? "  — " + i.note : ""}`);
  const bloquants = r.items.filter((i) => i.etat === "MISSING" || i.etat === "REFUSED");
  console.log(`\n${r.items.length - bloquants.length}/${r.items.length} prerequis OK` + (bloquants.length ? ` — ${bloquants.length} bloquant(s)` : " — pret"));
  process.exit(bloquants.length ? 1 : 0);
}
