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
export function construireDepuisVariablesPg(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const cle of VARIABLES_SEPAREES) {
    const v = env[cle];
    if (typeof v !== "string" || v.length === 0) return null;
  }
  const hote = env["PGHOST"]!;
  const port = env["PGPORT"] && env["PGPORT"].length > 0 ? env["PGPORT"] : "5432";
  const base = env["PGDATABASE"]!;
  // Supabase exige TLS. `require` est donc le defaut, et non `disable`.
  const ssl  = env["PGSSLMODE"] && env["PGSSLMODE"].length > 0 ? env["PGSSLMODE"] : "require";

  const utilisateur = encodeURIComponent(env["PGUSER"]!);
  const motDePasse  = encodeURIComponent(env["PGPASSWORD"]!);

  return `postgresql://${utilisateur}:${motDePasse}@${hote}:${port}/${encodeURIComponent(base)}?sslmode=${encodeURIComponent(ssl)}`;
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

// Effet a l'import : voir l'en-tete. Rien n'est journalise ici — ce module est
// evalue avant le logger.
appliquerVariablesPg();
