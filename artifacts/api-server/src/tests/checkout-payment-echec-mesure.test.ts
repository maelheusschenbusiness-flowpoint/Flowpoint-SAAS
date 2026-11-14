/**
 * Mesure des refus de carte : l'etape seule, sous consentement, sans donnee bancaire.
 * Test statique des fichiers servis (pas de navigateur) + frontiere du serveur.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ETAPES_PUBLIQUES, ETAPES_TUNNEL } from "../services/funnel-events.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../flowpoint-export");
const page = readFileSync(path.join(dir, "checkout-payment.html"), "utf8");
const suivi = readFileSync(path.join(dir, "funnel-tracking.js"), "utf8");

describe("refus de carte -> etape checkout_payment_failed", () => {
  it("la page declare l'etape dans la branche result.error, sans transmettre le message ni le code", () => {
    const i = page.indexOf("fpFunnelTrack('checkout_payment_failed')");
    expect(i).toBeGreaterThan(0);
    const avant = page.slice(Math.max(0, i - 400), i);
    expect(avant).toContain("result.error");
    const ligne = page.slice(i - 60, i + 120);
    expect(ligne).not.toMatch(/message|\.code|decline|last4|email/i);
  });
  it("une mesure en echec ne peut pas empecher l'affichage de l'erreur de paiement", () => {
    const apres = page.slice(page.indexOf("fpFunnelTrack('checkout_payment_failed')"));
    expect(apres.indexOf("catch (e)")).toBeLessThan(apres.indexOf("showAlert(msg)"));
  });
  it("le script partage n'expose que cette etape et reste soumis au consentement", () => {
    expect(suivi).toContain('window.fpFunnelTrack = function (step) { if (step === "checkout_payment_failed") send(step); };');
    const send = suivi.slice(suivi.indexOf("function send(step"), suivi.indexOf("function send(step") + 200);
    expect(send).toContain("const id = visitorId();");
    expect(send).toContain("if (!id) return;");
    expect(suivi.slice(suivi.indexOf("function visitorId()"), suivi.indexOf("function visitorId()") + 120)).toContain("if (!hasConsent()) return null;");
  });
  it("le serveur l'accepte comme etape navigateur et la connait du tunnel", () => {
    expect(ETAPES_PUBLIQUES.has("checkout_payment_failed")).toBe(true);
    expect(ETAPES_TUNNEL as readonly string[]).toContain("checkout_payment_failed");
  });
});
