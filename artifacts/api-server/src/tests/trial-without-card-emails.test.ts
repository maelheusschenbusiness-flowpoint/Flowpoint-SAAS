/**
 * Emails de l'essai sans carte — rendu reel des templates, transport Resend
 * SIMULE (le SDK est remplace : on capture exactement ce qui serait envoye).
 *
 * Teste en simulation : destinataire, sujet, etiquette, contenu HTML, lien.
 * Validation reelle restante : delivrabilite Resend (domaine, SPF/DKIM, boite).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

const sent: Array<Record<string, unknown>> = [];
vi.mock("resend", () => ({
  Resend: class { emails = { send: async (p: Record<string, unknown>) => { sent.push(p); return { data: { id: `re_${sent.length}` }, error: null }; } }; },
}));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

let mailer: typeof import("../services/mailer.js")["mailer"];
beforeAll(async () => {
  process.env["RESEND_API_KEY"] = "re_test_simulated_transport";
  delete process.env["TEST_MAIL_DIR"];
  ({ mailer } = await import("../services/mailer.js"));
});

describe("emails de l'essai sans carte (transport simule)", () => {
  it("activation « sans carte » : destinataire, sujet, lien magique, aucune mention de paiement", async () => {
    sent.length = 0;
    const url = "https://app.flowpoint.pro/login-verify.html?token=" + "a".repeat(64);
    const r = await mailer.sendActivationMagicLink({ to: "lea@agence.fr", name: "Léa", plan: "standard",
      magicLinkUrl: url, isTrial: true, cardless: true });
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
    const m = sent[0]!;
    expect(m["to"]).toBe("lea@agence.fr");
    expect(String(m["subject"])).toMatch(/essai FlowPoint Standard est prêt/);
    expect(m["tags"]).toEqual([{ name: "type", value: "activation_magic_link" }]);
    const html = String(m["html"]);
    expect(html).toContain(url);
    expect(html).toMatch(/sans carte bancaire/);
    expect(html).toMatch(/rien ne t'est prélevé/);
    expect(html).not.toMatch(/paiement est confirmé/);
    expect(html).toMatch(/Bienvenue sur FlowPoint, Léa/);
  });
  it("activation parcours carte : texte historique inchange (« paiement confirme »)", async () => {
    sent.length = 0;
    await mailer.sendActivationMagicLink({ to: "p@x.fr", name: "P", plan: "pro", magicLinkUrl: "https://x/l", isTrial: true });
    expect(String(sent[0]!["html"])).toMatch(/Ton paiement est confirmé/);
  });
  it("essai termine : destinataire, sujet, lien Facturation, aucun prelevement", async () => {
    sent.length = 0;
    const r = await mailer.sendTrialExpired({ to: "fin@agence.fr", name: "Fin", plan: "standard" });
    expect(r.ok).toBe(true);
    const m = sent[0]!;
    expect(m["to"]).toBe("fin@agence.fr");
    expect(String(m["subject"])).toMatch(/essai FlowPoint est terminé/);
    expect(m["tags"]).toEqual([{ name: "type", value: "trial_expired" }]);
    expect(String(m["html"])).toMatch(/Aucun prélèvement n'a eu lieu/);
    expect(String(m["html"])).toMatch(/Activer mon abonnement/);
    expect(String(m["html"])).toMatch(/billing/);
  });
  it("rappel J-3 : envoye a l'essai sans carte avec le meme template", async () => {
    sent.length = 0;
    await mailer.sendTrialEnding({ to: "j3@agence.fr", name: "J", daysLeft: 3, plan: "standard" });
    expect(sent[0]!["to"]).toBe("j3@agence.fr");
    expect(String(sent[0]!["subject"])).toMatch(/se termine dans 3 jours/);
  });
});
