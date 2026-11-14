/**
 * Mesure des refus de carte : l'etape seule, sous consentement, sans donnee bancaire.
 * Test statique de la page de paiement (pas de navigateur) + frontiere du serveur.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ETAPES_PUBLIQUES, ETAPES_TUNNEL } from "../services/funnel-events.js";

const html = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),
  "../../../flowpoint-export/checkout-payment.html"), "utf8");
const bloc = (() => {
  const i = html.indexOf("etape: 'checkout_payment_failed'");
  return i < 0 ? "" : html.slice(Math.max(0, i - 700), i + 400);
})();

describe("refus de carte -> etape checkout_payment_failed", () => {
  it("la page declare l'etape apres un result.error, derriere le consentement", () => {
    expect(bloc).not.toBe("");
    expect(bloc).toContain("result.error");
    expect(bloc).toContain("fpFunnelAttribution()");
    expect(bloc).toContain("if (failAttr.visiteurId)");
  });
  it("le corps emis ne contient que etape, visiteurId et source : ni message, ni code, ni carte", () => {
    const body = bloc.slice(bloc.indexOf("JSON.stringify({"), bloc.indexOf("})", bloc.indexOf("JSON.stringify({")) + 2);
    expect(body).toMatch(/^JSON\.stringify\(\{ etape: 'checkout_payment_failed', visiteurId: failAttr\.visiteurId, source: failAttr\.source \}\)$/);
    expect(body).not.toMatch(/message|code|decline|card|last4|email/i);
  });
  it("une erreur d'envoi de la mesure n'interrompt jamais l'affichage de l'erreur de paiement", () => {
    const apres = html.slice(html.indexOf("etape: 'checkout_payment_failed'"));
    expect(apres.indexOf("catch (e)")).toBeLessThan(apres.indexOf("showAlert(msg)"));
  });
  it("le serveur l'accepte comme etape navigateur et la connait du tunnel", () => {
    expect(ETAPES_PUBLIQUES.has("checkout_payment_failed")).toBe(true);
    expect(ETAPES_TUNNEL as readonly string[]).toContain("checkout_payment_failed");
  });
});
