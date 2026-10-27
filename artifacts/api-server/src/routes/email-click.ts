/**
 * `GET /go` — point d'entree premiere partie des liens Smartlead.
 *
 * Toujours une redirection 302 vers une destination de la table fixe
 * `CIBLES_CLIC`, avec le fp_lid et les UTM valides : le lien marche que le suivi
 * soit actif ou non. Le clic n'est COMPTE que si `FP_EMAIL_CLICK_TRACKING=on`
 * (desactive par defaut). Aucun cookie, aucune IP ni user-agent stockes ; voir
 * `lib/email-click.ts` pour le raisonnement RGPD.
 */
import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import {
  CIBLES_CLIC,
  cleIdempotenceClic,
  cleIdempotenceVisite,
  contientDonneePersonnelle,
  empreinteLead,
  estBotSuspect,
  lireClic,
  signalVisiteActif,
  suiviClicActif,
  urlRedirection,
} from "../lib/email-click.js";
import { normalizeFpLid } from "../lib/fp-lid.js";
import { clientIp, createIpRateLimit } from "../middlewares/rateLimiter.js";
import { enregistrerClicEmail, enregistrerVisiteEmail } from "../services/funnel-events.js";

const router = Router();

/**
 * Plafond d'ecritures par adresse et par minute. Au-dela, la redirection a
 * toujours lieu — un prospect ne doit jamais voir une erreur — mais rien n'est
 * compte. La cle est un condensat de l'adresse, en memoire seulement, jamais
 * stockee ni journalisee.
 */
const LIMITE_PAR_MINUTE = 20;
const FENETRE_MS = 60_000;
const MAX_CLES = 10_000;
const fenetres = new Map<string, { debut: number; n: number }>();

export function autoriserEcriture(ip: string, maintenant = Date.now()): boolean {
  const cle = createHash("sha256").update(ip).digest("hex").slice(0, 16);
  const f = fenetres.get(cle);
  if (!f || maintenant - f.debut >= FENETRE_MS) {
    if (fenetres.size >= MAX_CLES) fenetres.clear();
    fenetres.set(cle, { debut: maintenant, n: 1 });
    return true;
  }
  f.n++;
  return f.n <= LIMITE_PAR_MINUTE;
}

export function reinitialiserLimiteClic(): void {
  fenetres.clear();
}

async function traiter(req: Request, res: Response): Promise<void> {
  const clic = lireClic(req.query as Record<string, unknown>);
  // La base est une constante de `CIBLES_CLIC` : jamais Host, Origin,
  // X-Forwarded-Host ni Referer.
  const cible = urlRedirection(clic, { marqueurVisite: signalVisiteActif() });

  if (!clic.refuse && suiviClicActif() && clic.fpLid && clic.utmSource === "smartlead" && autoriserEcriture(clientIp(req))) {
    const bot = estBotSuspect({ method: req.method, headers: req.headers });
    const jour = new Date().toISOString().slice(0, 10);
    // Attendu (quelques ms) pour que l'ecriture ne soit pas perdue si le
    // processus s'arrete ; une erreur est avalee et ne bloque jamais la redirection.
    await enregistrerClicEmail({
      empreinteLead: empreinteLead(clic.fpLid),
      campagne: clic.utmCampaign,
      variante: clic.utmContent,
      botSuspect: bot,
      cleIdempotence: cleIdempotenceClic(clic.fpLid, bot, jour),
    });
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  // La page d'arrivee ne doit pas recevoir l'URL de clic en Referer.
  res.setHeader("Referrer-Policy", "no-referrer");
  res.redirect(302, cible);
}

// Express sert HEAD avec le gestionnaire GET : `req.method` reste `HEAD`,
// ce qui marque ces verifications de lien comme `bot_suspect`.
router.get("/go", (req, res) => {
  traiter(req, res).catch(() => {
    // Jamais d'erreur 500 (le gestionnaire d'erreurs journaliserait l'URL
    // complete) : la destination par defaut, sans parametre, et rien d'autre.
    if (!res.headersSent) res.redirect(302, CIBLES_CLIC.signup);
  });
});

/**
 * Second signal, navigateur : la page d'arrivee confirme qu'un script s'est
 * execute pour ce lead. Sans cookie (`credentials: "omit"` cote client), sans
 * consentement marketing, et inerte tant que `FP_EMAIL_VISIT_BEACON` n'est pas
 * `on`. Repond toujours 204 : le navigateur n'apprend rien.
 */
const visitRateLimit = createIpRateLimit("public_email_visit", 30, 60_000);
router.post("/api/public/email-visit", visitRateLimit, (req: Request, res: Response) => {
  const corps = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const fpLid = normalizeFpLid(corps["fp_lid"]);
  res.setHeader("Cache-Control", "no-store");
  if (!signalVisiteActif() || !fpLid || contientDonneePersonnelle(corps)) {
    res.status(204).end();
    return;
  }
  const jour = new Date().toISOString().slice(0, 10);
  enregistrerVisiteEmail(empreinteLead(fpLid), cleIdempotenceVisite(fpLid, jour))
    .catch(() => false)
    .finally(() => { if (!res.headersSent) res.status(204).end(); });
});

export default router;
