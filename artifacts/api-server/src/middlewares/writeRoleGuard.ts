/**
 * Garde de role par defaut sur toutes les routes d'ECRITURE (C-04).
 *
 * Probleme corrige : seule une minorite des routes non-GET portait un
 * `canWrite` / `canAdmin` / `ownerOnly`. Un membre `viewer` (et une cle API
 * `fp_pub_`, dont le role est `viewer`) pouvait donc creer des integrations,
 * des workflows, des posts GBP, deconnecter Google, televerser des fichiers...
 *
 * Principe : DENY PAR DEFAUT, monte une seule fois dans routes/index.ts, juste
 * apres `requireAuth` et la verification de contexte d'organisation.
 *
 *   - methodes de lecture (GET / HEAD / OPTIONS)     -> jamais concernees
 *   - route listee dans WRITE_ANY_ROLE_EXCEPTIONS     -> tout role authentifie
 *   - route listee dans WRITE_ADMIN_ONLY              -> owner / admin
 *   - route listee dans WRITE_OWNER_ONLY              -> owner
 *   - TOUTE AUTRE route non-GET                       -> owner / admin / member
 *
 * Les gardes posees route par route (canWrite, canAdmin, ownerOnly, requireAdmin,
 * gardes enterprise du moteur de permissions...) restent en place : cette garde
 * est un PLANCHER, elle ne retire aucune restriction existante. Elle n'applique
 * volontairement PAS la matrice « roles Enterprise » (reservee aux six domaines
 * audits / monitors / reports / keywords / competitors / missions, deja geres
 * par `requireRole`) afin de ne pas fermer a tort les autres routes a un membre
 * qui porte un role personnalise.
 *
 * Le test `src/tests/write-role-inventory.test.ts` inventorie toutes les routes
 * non-GET du depot et echoue si une exception ne correspond plus a aucune route
 * ou si une nouvelle route tombe sous une exception sans y etre listee.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { logger } from "../lib/logger.js";

export type WriteRouteClass = "read" | "any-role" | "member" | "admin" | "owner";

export interface WriteRouteRule {
  /** Methode HTTP (en majuscules) ou "*" pour toutes les methodes d'ecriture. */
  method: "POST" | "PUT" | "PATCH" | "DELETE" | "*";
  /** Chemin RELATIF au montage /api, sans slash final. `:param` = un segment, `*` final = tout le reste. */
  path: string;
  /** Pourquoi cette route a un traitement particulier (obligatoire, relu en revue). */
  reason: string;
}

/**
 * EXCEPTIONS — routes non-GET ouvertes a TOUT role authentifie (viewer inclus).
 *
 * Ajouter une ligne ici est une decision de securite : la raison est obligatoire.
 * Les routes publiques (auth, webhooks Stripe, partage, tracking comportemental,
 * checkout public, invitation) sont montees AVANT requireAuth dans index.ts et
 * ne passent jamais par cette garde ; elles ne sont donc pas listees.
 */
export const WRITE_ANY_ROLE_EXCEPTIONS: readonly WriteRouteRule[] = [
  // ── Assistant IA : l'agent applique lui-meme ses permissions par outil ──────
  // (agent/permissions.ts : le bundle `viewer` ne contient aucune permission .write)
  { method: "POST", path: "/ai/chat", reason: "Chat IA : chaque outil est soumis a resolveEffectivePermissions (viewer = lecture seule)." },
  { method: "POST", path: "/ai/conversations/:id/cancel", reason: "Bouton stop du chat IA de l'utilisateur." },
  { method: "POST", path: "/ai/conversations/:id/confirm", reason: "Confirmation d'un outil propose par le chat : permissions effectives revalidees a l'execution." },
  // ── Analyses IA / calculs : POST utilise comme « lecture avec corps » ───────
  { method: "POST", path: "/ai/audit", reason: "Analyse IA d'un audit (genere du texte, ne modifie aucune donnee metier)." },
  { method: "POST", path: "/ai/seo", reason: "Analyse IA SEO (lecture)." },
  { method: "POST", path: "/ai/conversion", reason: "Analyse IA conversion (lecture)." },
  { method: "POST", path: "/ai/local", reason: "Analyse IA SEO local (lecture)." },
  { method: "POST", path: "/ai/competitors", reason: "Analyse IA concurrents (lecture)." },
  { method: "POST", path: "/ai/reports", reason: "Synthese IA de rapport (lecture)." },
  { method: "POST", path: "/ai/summary", reason: "Resume IA du tableau de bord (lecture)." },
  { method: "POST", path: "/ai/missions", reason: "Suggestions IA de missions (propose, ne cree pas)." },
  { method: "POST", path: "/ai/pagespeed-insights", reason: "Lecture IA des resultats PageSpeed." },
  { method: "POST", path: "/ai/generate", reason: "Generation de texte IA ponctuelle." },
  { method: "POST", path: "/pagespeed/analyze", reason: "Analyse PageSpeed d'une URL (lecture)." },
  { method: "POST", path: "/pagespeed/compare", reason: "Comparaison PageSpeed (lecture)." },
  { method: "POST", path: "/maps/geocode", reason: "Geocodage (lecture)." },
  { method: "POST", path: "/maps/distance", reason: "Calcul de distance (lecture)." },
  { method: "POST", path: "/org/geocode", reason: "Geocodage d'une adresse, sans ecriture (la sauvegarde passe par PUT /org/location)." },
  { method: "POST", path: "/github/analysis/:owner/:repo", reason: "Analyse d'un depot (lecture)." },
  { method: "POST", path: "/market-intelligence/competitor-movement", reason: "Detection de mouvements concurrents (lecture)." },
  { method: "POST", path: "/behavioral/funnels/analyze", reason: "Analyse d'entonnoir comportemental (lecture)." },
  { method: "POST", path: "/google/ai-reply-preview", reason: "Apercu d'une reponse d'avis generee par IA, rien n'est publie." },
  // ── Etat d'interface personnel / acquittements ──────────────────────────────
  { method: "PATCH", path: "/notifications/:id/read", reason: "Marquer SA notification comme lue (la route filtre deja par destinataire)." },
  { method: "PATCH", path: "/notifications/read-all", reason: "Marquer SES notifications comme lues." },
  { method: "PUT", path: "/overview/checklist", reason: "Case cochee de la checklist d'accueil (etat d'interface, aucune donnee metier)." },
  { method: "POST", path: "/onboarding/complete", reason: "Fermeture de la visite guidee : sans cela elle reapparait a chaque connexion pour un viewer." },
  { method: "PATCH", path: "/me/prefs", reason: "Etat d'interface (serie, epingles, checklist). Les reglages d'organisation (`settings`, `statusPageUrl`) sont refuses aux viewers DANS la route." },
  { method: "POST", path: "/organizations/:id/switch", reason: "Changer d'organisation active : concerne la session de l'utilisateur, la route verifie l'appartenance." },
  { method: "POST", path: "/auth/sessions/:id/revoke", reason: "Fin d'une session (#384) : tout utilisateur humain peut terminer SES sessions ; la route verifie la propriete (ou owner/admin de la meme organisation) et refuse les cles API." },
  { method: "POST", path: "/security/2fa/setup", reason: "Compte personnel ; stub 501 (2FA non implemente)." },
  { method: "POST", path: "/security/2fa/verify", reason: "Compte personnel ; stub 501 (2FA non implemente)." },
  // ── Webhooks entrants authentifies par jeton dedie ──────────────────────────
  { method: "POST", path: "/integrations/webhook/incoming/:token", reason: "Webhook entrant : authentifie par son jeton secret, pas par le role." },
  { method: "POST", path: "/integrations/webhook/incoming", reason: "Webhook entrant : authentifie par son jeton secret (X-FlowPoint-Token)." },
];

/**
 * Routes reservees aux owner / admin (integrations, marque blanche, securite,
 * connexions de comptes Google/CRM...). Evaluees APRES les exceptions.
 */
export const WRITE_ADMIN_ONLY: readonly WriteRouteRule[] = [
  { method: "*", path: "/integrations/*", reason: "Integrations sortantes / entrantes : portent des URL et jetons secrets." },
  { method: "*", path: "/white-label/*", reason: "Marque blanche et domaines personnalises." },
  { method: "*", path: "/security/*", reason: "Reglages de securite du compte." },
  { method: "*", path: "/sso/*", reason: "Configuration SSO." },
  { method: "*", path: "/crm/*", reason: "Connexion, synchronisation et mapping CRM." },
  { method: "POST", path: "/google/disconnect", reason: "Deconnexion du compte Google (perte des jetons OAuth)." },
  { method: "POST", path: "/gsc/disconnect", reason: "Deconnexion Search Console." },
  { method: "POST", path: "/gsc/site", reason: "Choix de la propriete Search Console connectee." },
  { method: "POST", path: "/ga4/disconnect", reason: "Deconnexion GA4." },
  { method: "POST", path: "/ga4/property", reason: "Choix de la propriete GA4 connectee." },
  { method: "POST", path: "/github/disconnect", reason: "Deconnexion GitHub." },
];

/** Routes reservees au proprietaire. */
export const WRITE_OWNER_ONLY: readonly WriteRouteRule[] = [
  { method: "POST", path: "/addons/ai-credits/buy", reason: "Achat de credits IA : meme niveau que l'activation des modules (ownerOnly)." },
];

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Chemin canonique : minuscules (Express est insensible a la casse), sans slash final. */
export function normalizeRoutePath(rawPath: string): string {
  let p = (rawPath.split("?")[0] ?? "").toLowerCase();
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/** Vrai si `pattern` (`:param`, `*` final) couvre `path`. Les deux sont en minuscules. */
export function routePatternMatches(pattern: string, path: string): boolean {
  const pat = pattern.toLowerCase().split("/").filter(Boolean);
  const seg = path.split("/").filter(Boolean);
  for (let i = 0; i < pat.length; i++) {
    const p = pat[i]!;
    if (p === "*") return seg.length >= i; // « /integrations/* » couvre aussi « /integrations »
    if (i >= seg.length) return false;
    if (p.startsWith(":")) continue;
    if (p !== seg[i]) return false;
  }
  return pat.length === seg.length;
}

function ruleMatches(rule: WriteRouteRule, method: string, path: string): boolean {
  return (rule.method === "*" || rule.method === method) && routePatternMatches(rule.path, path);
}

/** Classe une requete (methode + chemin relatif a /api) dans la politique d'ecriture. */
export function classifyWriteRoute(method: string, rawPath: string): WriteRouteClass {
  const m = method.toUpperCase();
  if (READ_METHODS.has(m)) return "read";
  const path = normalizeRoutePath(rawPath);
  if (WRITE_ANY_ROLE_EXCEPTIONS.some((r) => ruleMatches(r, m, path))) return "any-role";
  if (WRITE_OWNER_ONLY.some((r) => ruleMatches(r, m, path))) return "owner";
  if (WRITE_ADMIN_ONLY.some((r) => ruleMatches(r, m, path))) return "admin";
  return "member";
}

const ALLOWED_ROLES: Record<Exclude<WriteRouteClass, "read" | "any-role">, ReadonlySet<string>> = {
  member: new Set(["owner", "admin", "member", "service"]),
  admin: new Set(["owner", "admin", "service"]),
  owner: new Set(["owner", "service"]),
};

/**
 * Middleware : a monter une fois, apres requireAuth. N'interroge pas la base.
 * Un role absent ou inconnu est refuse (fail-closed), comme `requireRole`.
 */
export const writeRoleGuard: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  const cls = classifyWriteRoute(req.method, req.path);
  if (cls === "read") { next(); return; }

  const role = req.orgContext?.role;
  if (cls === "any-role") {
    if (!role) {
      res.status(401).json({ error: "Unauthorized: authentication required" });
      return;
    }
    next();
    return;
  }

  if (!role) {
    res.status(401).json({ error: "Unauthorized: authentication required" });
    return;
  }
  const allowed = ALLOWED_ROLES[cls];
  if (allowed.has(role)) { next(); return; }

  logger.warn(
    { method: req.method, path: normalizeRoutePath(req.path), role, requiredClass: cls },
    "[RBAC] Ecriture refusee par la garde par defaut",
  );
  res.status(403).json({
    error: cls === "member"
      ? "Forbidden: write access requires owner, admin or member role"
      : cls === "admin"
        ? "Forbidden: requires owner or admin role"
        : "Forbidden: requires owner role",
    yourRole: role,
    code: "WRITE_ROLE_REQUIRED",
  });
};
