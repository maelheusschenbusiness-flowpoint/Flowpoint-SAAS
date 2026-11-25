/**
 * url-base.ts
 *
 * Permet de configurer la connexion PostgreSQL SANS ecrire de mot de passe
 * dans une URL.
 *
 * POURQUOI, mesure du 18/10/2026. En isolant l'environnement de test sur sa
 * propre base, deux demarrages ont echoue coup sur coup, pour deux raisons
 * differentes et toutes deux liees a la forme de `DATABASE_URL` :
 *
 *   1. `28P01 password authentication failed for user "postgres"` — la chaine
 *      etait une URL valide, elle a atteint le serveur, qui l'a refusee. Avec
 *      le pooler Supabase l'utilisateur doit s'ecrire `postgres.<ref>` ; un
 *      `postgres` seul ne resout aucun locataire et produit cette erreur.
 *   2. `DATABASE_URL n'est pas une URL de connexion valide` — un caractere
 *      reserve non encode dans le mot de passe. Mesure : `#` et `/` suffisent.
 *
 * Les deux viennent du meme endroit : un secret transporte dans une URL, ou
 * la moindre ponctuation change le sens. Les variables separees suppriment le
 * probleme a la racine — la valeur n'est jamais interpretee, seulement encodee
 * ici, une fois, correctement.
 *
 * CONTRAT, volontairement sans ambiguite : `DATABASE_URL` l'emporte toujours.
 * Les variables separees ne servent que si elle est absente ou vide. Une
 * `DATABASE_URL` posee mais malformee n'est donc jamais masquee en silence :
 * elle echoue avec son message, qui nomme la cause.
 *
 * Ce module AGIT A L'IMPORT, comme `lib/env.ts`, parce que `@workspace/db`
 * construit son pool des son evaluation. Il doit donc etre importe en PREMIER
 * par tout point d'entree.
 */

/** Les cinq variables separees. `PGPORT` et `PGSSLMODE` ont des valeurs par defaut. */
export const VARIABLES_SEPAREES = ["PGHOST", "PGUSER", "PGPASSWORD", "PGDATABASE"] as const;

/**
 * Fabrique une URL de connexion depuis les variables separees.
 * Rend `null` si l'une des quatre variables requises manque.
 *
 * L'utilisateur et le mot de passe sont encodes en pourcentage : c'est le seul
 * endroit du systeme ou cet encodage a lieu, et il n'est plus a la charge de
 * l'exploitant.
 */
/**
 * Un hote, et rien d'autre. Lettres, chiffres, points, tirets — plus les
 * crochets et deux-points d'une adresse IPv6.
 *
 * DEFAUT MESURE LE 18/10/2026 : `PGHOST` a recu une chaine de connexion
 * complete au lieu du seul nom d'hote. L'URL composee ici devenait absurde, le
 * demarrage echouait sans dire pourquoi, et le journal de la garde a imprime
 * le chemin de cette URL — qui portait l'identifiant. Mieux vaut refuser tot,
 * en nommant la cause.
 */
const MOTIF_HOTE = /^[A-Za-z0-9.\-]+$|^\[[0-9A-Fa-f:.]+\]$/;

export class VariablesPgInvalides extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VariablesPgInvalides";
  }
}

export function construireDepuisVariablesPg(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const cle of VARIABLES_SEPAREES) {
    const v = env[cle];
    if (typeof v !== "string" || v.length === 0) return null;
  }

  // PGHOST doit etre un hote seul. On refuse explicitement une chaine de
  // connexion : c'est l'erreur reellement commise, et elle est silencieuse.
  if (!MOTIF_HOTE.test(env["PGHOST"]!)) {
    throw new VariablesPgInvalides(
      "PGHOST n'est pas un nom d'hote. Attendu : uniquement l'hote, par exemple " +
      "« aws-1-eu-central-1.pooler.supabase.com » — sans schema, sans identifiant, " +
      "sans port et sans nom de base. Si vous y avez colle une chaine de connexion " +
      "complete, posez plutot DATABASE_URL, ou separez ses morceaux entre PGHOST, " +
      "PGPORT, PGUSER, PGPASSWORD et PGDATABASE."
    );
  }
  if (!/^[A-Za-z0-9._\-]+$/.test(env["PGDATABASE"]!)) {
    throw new VariablesPgInvalides(
      "PGDATABASE n'est pas un nom de base simple. Attendu : par exemple « postgres »."
    );
  }
  if (env["PGPORT"] && !/^[0-9]{1,5}$/.test(env["PGPORT"])) {
    throw new VariablesPgInvalides("PGPORT n'est pas un numero de port.");
  }
  const hote = env["PGHOST"]!;
  const port = env["PGPORT"] && env["PGPORT"].length > 0 ? env["PGPORT"] : "5432";
  const base = env["PGDATABASE"]!;

  const utilisateur = encodeURIComponent(env["PGUSER"]!);
  const motDePasse  = encodeURIComponent(env["PGPASSWORD"]!);

  // Pas de `sslmode` dans l'URL, volontairement. Le mode TLS est decide au
  // niveau du pool, par `optionsSslPostgres()`, qui fournit la racine Supabase
  // absente du magasin public. Deux sources de verite pour le meme reglage
  // produiraient un comportement ambigu selon la version de pg.
  return `postgresql://${utilisateur}:${motDePasse}@${hote}:${port}/${encodeURIComponent(base)}`;
}

/**
 * Pose `DATABASE_URL` depuis les variables separees quand elle est absente.
 * Rend ce qui a ete fait, pour que l'appelant puisse le journaliser — sans
 * jamais rendre l'URL elle-meme, qui contient le secret.
 */
export function appliquerVariablesPg(env: NodeJS.ProcessEnv = process.env):
  { applique: boolean; raison: "deja_posee" | "variables_incompletes" | "construite" } {
  const existante = env["DATABASE_URL"];
  if (typeof existante === "string" && existante.length > 0) {
    return { applique: false, raison: "deja_posee" };
  }
  const construite = construireDepuisVariablesPg(env);
  if (!construite) return { applique: false, raison: "variables_incompletes" };
  env["DATABASE_URL"] = construite;
  return { applique: true, raison: "construite" };
}

// Effet a l'import : voir l'en-tete. Le logger n'existe pas encore a ce stade,
// d'ou l'ecriture directe sur stderr. Le message ne contient que des noms de
// variables, jamais une valeur.
try {
  appliquerVariablesPg();
} catch (err) {
  if (err instanceof VariablesPgInvalides) {
    process.stderr.write(`\n[FlowPoint] ❌ Configuration PostgreSQL invalide :\n  • ${err.message}\n\n`);
    process.exit(1);
  }
  throw err;
}
