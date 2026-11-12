import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  hasLoginEmailTransport,
  isLoginEmailAllowed,
  LOGIN_REQUEST_ACCEPTED_RESPONSE,
  loginEmailFailureCode,
  maskEmailForAuthLog,
} from "../services/login-request-policy.js";

const SOURCE = readFileSync(join(process.cwd(), "src/routes/auth.ts"), "utf8");
const CLIENT = readFileSync(join(process.cwd(), "../flowpoint-export/login.html"), "utf8");
const DASHBOARD = readFileSync(join(process.cwd(), "../flowpoint-export/dashboard.js"), "utf8");
const DASHBOARD_SOURCE = readFileSync(join(process.cwd(), "../../src/frontend/dashboard.js"), "utf8");
const ROUTE_START = SOURCE.indexOf('router.post("/auth/login-request"');
const ROUTE_END = SOURCE.indexOf("// ── BLOCKED: /auth/register", ROUTE_START);
const LOGIN_ROUTE = SOURCE.slice(ROUTE_START, ROUTE_END);

describe("réponse neutre du lien de connexion", () => {
  it("le message qui fuyait a disparu", () => {
    expect(SOURCE, "le message d'enumeration est revenu")
      .not.toContain("Aucun compte trouvé pour cette adresse email");
  });

  it("utilise un texte conditionnel qui ne prétend pas qu'un mail est parti", () => {
    expect(LOGIN_REQUEST_ACCEPTED_RESPONSE.ok).toBe(true);
    expect(LOGIN_REQUEST_ACCEPTED_RESPONSE.message).toContain("peut être envoyé");
    expect(LOGIN_REQUEST_ACCEPTED_RESPONSE.message).not.toMatch(/vient d'être envoyé|envoyé à/i);
  });

  it("renvoie exactement la même réponse pour une liste refusée, un compte absent et un transport accepté", () => {
    expect(ROUTE_START).toBeGreaterThan(-1);
    expect(ROUTE_END).toBeGreaterThan(ROUTE_START);
    expect(LOGIN_ROUTE).toContain("res.json(LOGIN_REQUEST_ACCEPTED_RESPONSE)");
    expect(LOGIN_ROUTE).toContain("res.json({ ...LOGIN_REQUEST_ACCEPTED_RESPONSE, debugLink: verifyPath })");
    expect(LOGIN_ROUTE).not.toContain("Lien de connexion envoyé par email");
    expect(LOGIN_ROUTE).not.toContain("Si un compte existe pour cette adresse, un lien de connexion vient d'etre envoye");
  });

  it("aucun mail ni jeton n'est créé quand le compte est absent", () => {
    const i = LOGIN_ROUTE.indexOf("login-request: aucun compte");
    expect(i).toBeGreaterThan(-1);
    const branch = LOGIN_ROUTE.slice(i, LOGIN_ROUTE.indexOf("if (_existingAccount &&", i));
    expect(branch).toContain("res.json(LOGIN_REQUEST_ACCEPTED_RESPONSE)");
    for (const operation of ["sendMagicEmail", "sendMail", "storeMagicToken"]) {
      expect(branch, `la branche appelle ${operation}`).not.toContain(operation);
    }
  });
});

describe("configuration et restrictions d'envoi", () => {
  it("n'accepte SMTP que si l'hôte et le mot de passe sont présents", () => {
    expect(hasLoginEmailTransport({})).toBe(false);
    expect(hasLoginEmailTransport({ SMTP_HOST: "smtp.example.test" })).toBe(false);
    expect(hasLoginEmailTransport({ SMTP_PASS: "configured" })).toBe(false);
    expect(hasLoginEmailTransport({ SMTP_HOST: "smtp.example.test", SMTP_PASS: "configured" })).toBe(true);
    expect(hasLoginEmailTransport({ RESEND_API_KEY: "configured" })).toBe(true);
    expect(hasLoginEmailTransport({ TEST_MAIL_DIR: "/tmp/mail" })).toBe(true);
  });

  it("applique l'allowlist exacte et le domaine sans accepter ses sous-domaines", () => {
    expect(isLoginEmailAllowed("qa@example.com", {})).toBe(true);
    expect(isLoginEmailAllowed("QA@example.com", { ALLOWED_EMAILS: "other@example.com, qa@example.com" })).toBe(true);
    expect(isLoginEmailAllowed("qa@example.com", { ALLOWED_EMAIL_DOMAIN: "example.com" })).toBe(true);
    expect(isLoginEmailAllowed("qa@sub.example.com", { ALLOWED_EMAIL_DOMAIN: "example.com" })).toBe(false);
    expect(isLoginEmailAllowed("qa@example.com.attacker.test", { ALLOWED_EMAIL_DOMAIN: "example.com" })).toBe(false);
    expect(isLoginEmailAllowed("other@example.net", {
      ALLOWED_EMAILS: "qa@example.com",
      ALLOWED_EMAIL_DOMAIN: "example.com",
    })).toBe(false);
  });

  it("utilise cette politique de restriction dans le parcours login-request", () => {
    expect(LOGIN_ROUTE).toContain("if (!isLoginEmailAllowed(email))");
  });
});

describe("échecs de livraison et erreurs Resend", () => {
  it("classifie les erreurs internes sans exposer les détails du fournisseur", () => {
    const providerError = new Error("EMAIL_SEND_FAILED: recipient qa@example.com rejected");
    expect(loginEmailFailureCode(providerError)).toBe("EMAIL_SEND_FAILED");
    expect(loginEmailFailureCode(new Error("SMTP_SEND_FAILED: server rejected connection"))).toBe("SMTP_SEND_FAILED");
    expect(loginEmailFailureCode(new Error("EMAIL_TRANSPORT_MISSING"))).toBe("EMAIL_TRANSPORT_MISSING");
    expect(loginEmailFailureCode(new Error("DOMAIN_NOT_VERIFIED: private diagnostic"))).toBe("DOMAIN_NOT_VERIFIED");
    expect(loginEmailFailureCode(new Error("TEST_MAILER_NOT_ENABLED"))).toBe("TEST_MAILER_NOT_ENABLED");
  });

  it("vérifie les erreurs SDK, journalise le code et supprime le jeton inutilisable", () => {
    const senderStart = SOURCE.indexOf("async function sendMagicEmail");
    const routeStart = SOURCE.indexOf('router.post("/auth/login-request"');
    const sender = SOURCE.slice(senderStart, routeStart);
    expect(sender).toContain("if (!localizedResult.ok)");
    expect(sender).toContain('message.startsWith("SMTP_SEND_FAILED:")');
    expect(sender).toContain("EMAIL_SEND_FAILED");
    expect(LOGIN_ROUTE).toContain("loginEmailFailureCode(err)");
    expect(LOGIN_ROUTE).toContain("deleteMagicToken(token)");
    expect(LOGIN_ROUTE).toContain("MAGIC_TOKEN_CLEANUP_FAILED");
    expect(LOGIN_ROUTE).toContain("res.json(LOGIN_REQUEST_ACCEPTED_RESPONSE)");
  });

  it("renvoie une erreur de base si le contrôle du compte historique échoue", () => {
    expect(LOGIN_ROUTE).toContain("const _existingAccount = await _checkAccount(email)");
    expect(LOGIN_ROUTE).not.toMatch(/_checkAccount\(email\)\.catch\(\(\)\s*=>\s*undefined\)/);
    expect(LOGIN_ROUTE).toContain("DB unreachable during account guard — 503");
  });
});

describe("protection des journaux et interface", () => {
  it("masque correctement les adresses, y compris les noms courts", () => {
    expect(maskEmailForAuthLog("qa@example.com")).toBe("qa***@example.com");
    expect(maskEmailForAuthLog("x@example.com")).toBe("x***@example.com");
    expect(maskEmailForAuthLog("not-an-email")).toBe("(invalid-email)");
    expect(maskEmailForAuthLog(undefined)).toBe("(none)");
  });

  it("masque l'adresse et ne journalise jamais le lien debug du parcours login", () => {
    expect(LOGIN_ROUTE).toContain("emailReceived: maskEmailForAuthLog(rawEmail)");
    expect(LOGIN_ROUTE).toContain("email: maskEmailForAuthLog(email)");
    expect(LOGIN_ROUTE).not.toMatch(/logger\.(?:info|warn|error)\(\{\s*[^}]*debugLink:\s*verifyPath/);
    expect(LOGIN_ROUTE).not.toContain("{ err: msg, email }");
  });

  it("n'annonce pas un email envoyé dans login.html ou les toasts du dashboard", () => {
    expect(CLIENT).toContain("if (r.ok)");
    expect(CLIENT).toContain("a sign-in link may be sent");
    expect(CLIENT).not.toContain("Lien envoy");
    expect(CLIENT).not.toMatch(/link (?:has been |was )?sent to/i);
    expect(DASHBOARD).not.toContain("fpT('Lien de connexion envoyé à') + ' ' + emailVal");
    expect(DASHBOARD).not.toContain("fpT('Lien de connexion envoyé à') + ' ' + email");
    expect(DASHBOARD_SOURCE).not.toContain("fpT('Lien de connexion envoyé à') + ' ' + emailVal");
    expect(DASHBOARD_SOURCE).not.toContain("fpT('Lien de connexion envoyé à') + ' ' + email");
  });

  it("la limite de debit reste en place sur la route", () => {
    expect(LOGIN_ROUTE).toMatch(/router\.post\("\/auth\/login-request",\s*authRateLimit/);
  });

  it("conserve les garde-fous du compte sans révéler son état", () => {
    expect(LOGIN_ROUTE).toContain('if (userStatus === "pending")');
    expect(LOGIN_ROUTE).toContain('if (userStatus === "suspended")');
    expect(LOGIN_ROUTE).toContain('if (userStatus !== "active")');
    expect(LOGIN_ROUTE).not.toContain("res.status(402)");
    expect(LOGIN_ROUTE).not.toContain("res.status(403)");
  });
});
