import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Masquage des secrets dans les journaux.
 *
 * ETAT INITIAL (mesure le 17/10/2026) : la liste ne couvrait que trois
 * en-tetes. Un appel comme `logger.warn({ err, token }, "…")` ecrivait donc le
 * jeton en clair — services/seller-attribution.ts journalisait le jeton de
 * `pending_signups`, c'est-a-dire l'identifiant qui autorise une inscription.
 * Un jeton dans un journal est une credential rejouable par quiconque lit les
 * journaux.
 *
 * PREMIERE CORRECTION : une liste de chemins fast-redact `x` et `*.x`. Mesure
 * du 17/10/2026 sur douze formes d'appel reelles : les erreurs etaient bien
 * couvertes jusqu'au deuxieme niveau, mais six formes fuyaient encore —
 *
 *   - profondeur 3 et au-dela :  { ctx: { stripe: { token } } }
 *   - tableaux :                 { items: [{ token }] }   (`*` ne traverse pas
 *                                 un index de tableau)
 *   - erreurs enrichies :        err.config.headers.Authorization (style axios)
 *   - casse differente :         { Token }, { API_KEY }
 *   - secret interpole dans le message ou dans err.message
 *
 * fast-redact accepte les jokers multiples, mais exige d'enumerer a l'avance
 * chaque profondeur ET chaque position de tableau, et ne sait pas ignorer la
 * casse. Le masquage est donc fait ici par un parcours recursif : une cle
 * sensible est masquee ou qu'elle se trouve, quelle que soit sa casse, dans les
 * objets comme dans les tableaux.
 *
 * Le parcours est borne (profondeur et nombre de noeuds) et protege des
 * cycles : un journal ne doit jamais pouvoir bloquer le serveur.
 */
const CHAMPS_SENSIBLES = [
  "token", "accessToken", "refreshToken", "sessionToken", "magicToken", "idToken",
  "password", "passwd", "secret", "clientSecret", "client_secret",
  "apiKey", "api_key", "adminKey", "admin_key", "serviceKey", "serviceRoleKey",
  "authorization", "cookie", "setupIntentSecret",
  "privateKey", "signingSecret", "webhookSecret", "signature",
  "connectionString", "databaseUrl", "dbUrl",
];

/** `API_KEY`, `api-key`, `apiKey` et `apikey` designent la meme chose. */
function normaliser(cle: string): string {
  return cle.toLowerCase().replace(/[-_\s]/g, "");
}

const CLES_SENSIBLES = new Set(CHAMPS_SENSIBLES.map(normaliser));

export const CENSURE = "[masque]";

/** Profondeur et volume maximum parcourus — un journal ne doit rien couter. */
const PROFONDEUR_MAX = 8;
const NOEUDS_MAX = 500;

/**
 * Secrets reconnaissables a leur forme, pour les cas ou la cle ne dit rien :
 * un jeton interpole dans un message, ou recopie dans `err.message`.
 */
const MOTIFS_VALEURS: ReadonlyArray<readonly [RegExp, string]> = [
  // Stripe : cles secretes, restreintes, et secrets de signature de webhook
  [/\b(sk|rk)_(live|test)_[A-Za-z0-9]{8,}/g, CENSURE],
  [/\bwhsec_[A-Za-z0-9+/=_-]{8,}/g, CENSURE],
  // En-tete d'autorisation recopie dans une chaine
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${CENSURE}`],
  // Jeton JWT
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, CENSURE],
  // Chaine de connexion portant un mot de passe
  [/\b([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+):[^@\s/]+@/gi, `$1:${CENSURE}@`],
];

function masquerChaine(valeur: string): string {
  let sortie = valeur;
  for (const [motif, remplacement] of MOTIFS_VALEURS) {
    sortie = sortie.replace(motif, remplacement);
  }
  return sortie;
}

/**
 * Clone une Error en masquant ses proprietes : pino doit encore y voir une
 * Error, sinon `type`, `message` et `stack` disparaissent du journal.
 *
 * `stack` est un accesseur propre sur V8 : recopier son descripteur tel quel
 * en y ajoutant une valeur leve `Invalid property descriptor`. On lit donc la
 * valeur et on pose un descripteur neuf, en conservant l'enumerabilite
 * d'origine — `message` et `stack` ne sont pas enumerables, et le serialiseur
 * de pino les traite a part.
 */
function masquerErreur(err: Error, profondeur: number, etat: Etat): Error {
  const clone = Object.create(Object.getPrototypeOf(err) as object) as Error;
  for (const cle of Object.getOwnPropertyNames(err)) {
    const descripteur = Object.getOwnPropertyDescriptor(err, cle);
    if (descripteur === undefined) continue;
    let valeur: unknown;
    try {
      valeur = (err as unknown as Record<string, unknown>)[cle];
    } catch {
      valeur = "[illisible]";
    }
    Object.defineProperty(clone, cle, {
      value: CLES_SENSIBLES.has(normaliser(cle)) ? CENSURE : masquer(valeur, profondeur + 1, etat),
      writable: true,
      enumerable: descripteur.enumerable,
      configurable: true,
    });
  }
  return clone;
}

type Etat = { noeuds: number; vus: WeakSet<object> };

function masquer(valeur: unknown, profondeur: number, etat: Etat): unknown {
  if (typeof valeur === "string") return masquerChaine(valeur);
  if (valeur === null || typeof valeur !== "object") return valeur;
  if (etat.noeuds++ > NOEUDS_MAX) return "[volume max]";
  if (profondeur > PROFONDEUR_MAX) return "[profondeur max]";
  if (etat.vus.has(valeur)) return "[cycle]";
  etat.vus.add(valeur);

  if (valeur instanceof Error) return masquerErreur(valeur, profondeur, etat);
  if (valeur instanceof Date || valeur instanceof RegExp) return valeur;
  if (Buffer.isBuffer(valeur)) return `[binaire ${valeur.length} octets]`;
  if (Array.isArray(valeur)) return valeur.map((v) => masquer(v, profondeur + 1, etat));

  const sortie: Record<string, unknown> = {};
  for (const [cle, v] of Object.entries(valeur as Record<string, unknown>)) {
    sortie[cle] = CLES_SENSIBLES.has(normaliser(cle)) ? CENSURE : masquer(v, profondeur + 1, etat);
  }
  return sortie;
}

/**
 * Point d'entree testable : masque un objet de journal complet.
 *
 * Filet de securite : un masquage qui leve casserait l'appel a `logger.*`
 * lui-meme — c'est arrive pendant la mise au point de cette fonction. Une
 * defaillance ici fait perdre le detail du journal, jamais la requete, et ne
 * laisse rien passer en clair.
 */
export function masquerJournal(objet: unknown): unknown {
  try {
    return masquer(objet, 0, { noeuds: 0, vus: new WeakSet<object>() });
  } catch {
    return { masquage: "[echec du masquage — contenu supprime]" };
  }
}

/**
 * Chemins laisses a fast-redact. Ce ne sont pas des secrets reconnaissables a
 * leur nom mais une decision de politique : le corps d'une requete n'a pas sa
 * place dans un journal — il porte aussi bien un mot de passe que des donnees
 * personnelles sans interet operationnel.
 */
export const REDACTED_PATHS: readonly string[] = [
  "req.body",
  "body",
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
];

/**
 * Configuration du masquage, exportee pour que les tests exercent EXACTEMENT
 * celle de production. Un test qui reconstruit sa propre configuration ne
 * prouve rien sur le journal reel.
 */
export const OPTIONS_MASQUAGE: Pick<pino.LoggerOptions, "redact" | "formatters" | "hooks"> = {
  redact: { paths: [...REDACTED_PATHS], censor: CENSURE },
  formatters: {
    log(objet: Record<string, unknown>): Record<string, unknown> {
      return masquerJournal(objet) as Record<string, unknown>;
    },
  },
  hooks: {
    // Un secret interpole dans le message du journal n'est pas atteignable par
    // les formatteurs : le message passe ici avant d'etre serialise.
    logMethod(this: unknown, args: unknown[], methode: (...a: unknown[]) => void): void {
      const nettoyes = args.map((a) => (typeof a === "string" ? masquerChaine(a) : a));
      methode.apply(this, nettoyes);
    },
  },
};

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  ...OPTIONS_MASQUAGE,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
