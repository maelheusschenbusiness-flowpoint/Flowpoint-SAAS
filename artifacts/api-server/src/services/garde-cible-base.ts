/**
 * garde-cible-base.ts
 *
 * Empeche un service de modifier une base qui n'est pas la sienne.
 *
 * MESURE DU 18/10/2026. Le risque n'etait pas celui qu'on croyait. On cherchait
 * si un `preDeployCommand` de l'environnement de test pouvait migrer la
 * production : aucun des deux services Render n'en a. Mais `index.ts` execute
 * `initDataTables`, `initRlsSetup`, `runRlsMigrationIfNeeded`, `initPhase1Users`
 * et `reconcileSchema` a CHAQUE demarrage. N'importe quel service qui demarre
 * contre une base en modifie donc le schema, sans aucun hook de migration.
 *
 * Il suffit qu'un `DATABASE_URL` soit copie d'un service a l'autre — le geste
 * le plus banal du depannage — pour que le service de test reecrive le schema
 * de la production au prochain deploiement.
 *
 * La garde demande a chaque service de DECLARER la base qu'il attend. Si la
 * declaration ne correspond pas a la destination reelle, le service refuse de
 * continuer, avant toute ecriture.
 *
 * Elle ne compare que l'HOTE et le NOM DE BASE. Jamais l'utilisateur, jamais le
 * mot de passe, et aucune de ces valeurs n'est journalisee.
 *
 * Non posee, `DB_HOTE_ATTENDU` ne change rien : le comportement reste celui
 * d'avant. C'est une protection qu'on arme, pas un prerequis.
 */

export interface CibleBase {
  hote: string;
  base: string;
  /** Avec le pooler Supavisor, c'est l'utilisateur qui designe le PROJET. */
  utilisateur: string;
}

/**
 * Ce qui peut etre journalise sans risque : un nom d'hote ou une adresse.
 * Lettres, chiffres, points, tirets, deux-points (IPv6) et crochets. Rien
 * d'autre — en particulier ni `@`, ni `/`, ni `:` suivi d'autre chose qu'un
 * port, c'est-a-dire aucune des formes que prend un identifiant.
 */
const MOTIF_HOTE = /^[A-Za-z0-9._\-\[\]:]+$/;

/** Idem pour un nom de base : pas de separateur, donc pas d'identifiant. */
const MOTIF_BASE = /^[A-Za-z0-9._\-]+$/;

/**
 * Rend une description de la cible SURE A JOURNALISER.
 *
 * DEFAUT MESURE LE 18/10/2026, et c'est le motif de cette fonction. Le journal
 * de demarrage imprimait `hote/base` tel quel. Un `PGHOST` contenant par
 * erreur une chaine de connexion complete a produit une URL dont le CHEMIN
 * portait l'identifiant — et le mot de passe PostgreSQL s'est retrouve en
 * clair dans les journaux Render.
 *
 * Desormais, toute valeur qui ne ressemble pas strictement a un hote et a un
 * nom de base est remplacee par une mention. Un journal ne doit pas pouvoir
 * divulguer un secret, quelle que soit l'entree.
 */
export function decrireCibleSurement(cible: CibleBase | null): string {
  if (!cible) return "(illisible)";
  const hoteSur = MOTIF_HOTE.test(cible.hote);
  const baseSure = MOTIF_BASE.test(cible.base);
  if (!hoteSur || !baseSure) {
    return "(valeur non journalisable — PGHOST ou PGDATABASE contient des separateurs, " +
           "verifiez qu'il ne s'agit pas d'une chaine de connexion complete)";
  }
  return `${cible.hote}/${cible.base}`;
}

export class CibleBaseRefusee extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CibleBaseRefusee";
  }
}

/**
 * Extrait l'hote et le nom de base d'une URL PostgreSQL, sans jamais toucher
 * aux identifiants. Rend `null` si l'URL est inexploitable.
 */
export function lireCible(databaseUrl: string | undefined): CibleBase | null {
  if (!databaseUrl) return null;
  try {
    const u = new URL(databaseUrl);
    const hote = u.hostname.toLowerCase();
    const base = decodeURIComponent(u.pathname.replace(/^\//, ""));
    const utilisateur = decodeURIComponent(u.username);
    if (!hote || !base) return null;
    return { hote, base, utilisateur };
  } catch {
    return null;
  }
}

/**
 * Une declaration acceptable s'ecrit `hote` ou `hote/base`. Plusieurs valeurs
 * peuvent etre separees par des virgules — utile pendant une bascule d'hote.
 */
/** Une declaration ne porte pas d'utilisateur : c'est `hote` ou `hote/base`. */
interface Declaration { hote: string; base: string }

function analyserDeclaration(declaration: string): Declaration[] {
  return declaration
    .split(",")
    .map((morceau) => morceau.trim().toLowerCase())
    .filter((morceau) => morceau.length > 0)
    .map((morceau) => {
      const [hote, base] = morceau.split("/");
      return { hote: hote ?? "", base: base ?? "" };
    })
    .filter((c) => c.hote.length > 0);
}

/**
 * Verifie que la destination reelle correspond a la declaration.
 *
 * - `DB_HOTE_ATTENDU` absente  → `{ verifiee: false }`, rien n'est impose.
 * - declaration posee et conforme → `{ verifiee: true }`.
 * - declaration posee et non conforme, ou URL illisible → leve `CibleBaseRefusee`.
 *   C'est voulu : une garde armee qui ne peut pas conclure doit refuser, sinon
 *   elle ne protege rien le jour ou elle compte.
 */
export function verifierCibleBase(env: NodeJS.ProcessEnv = process.env): { verifiee: boolean; cible?: CibleBase } {
  const declaration = env["DB_HOTE_ATTENDU"];
  if (!declaration || declaration.trim().length === 0) return { verifiee: false };

  const attendues = analyserDeclaration(declaration);
  if (attendues.length === 0) {
    throw new CibleBaseRefusee(
      "DB_HOTE_ATTENDU est posee mais ne contient aucune cible exploitable. " +
      "Attendu : « hote » ou « hote/base », plusieurs valeurs separees par des virgules."
    );
  }

  const reelle = lireCible(env["DATABASE_URL"]);
  if (!reelle) {
    throw new CibleBaseRefusee(
      "DB_HOTE_ATTENDU est posee mais DATABASE_URL est absente ou illisible : " +
      "la destination ne peut pas etre verifiee, le demarrage est refuse."
    );
  }

  const conforme = attendues.some(
    (a) => a.hote === reelle.hote && (a.base === "" || a.base === reelle.base.toLowerCase())
  );

  // L'hote du pooler Supavisor est REGIONAL : deux projets de la meme region
  // le partagent, et c'est l'UTILISATEUR (`postgres.<ref>`) qui designe le
  // projet. Comparer l'hote seul donnerait donc une assurance illusoire.
  // `DB_UTILISATEUR_ATTENDU` ferme cet ecart. Il n'est jamais journalise.
  const utilisateurAttendu = env["DB_UTILISATEUR_ATTENDU"];
  if (utilisateurAttendu && utilisateurAttendu.trim().length > 0) {
    if (reelle.utilisateur !== utilisateurAttendu.trim()) {
      throw new CibleBaseRefusee(
        "L'utilisateur de connexion ne correspond pas a celui declare par ce " +
        "service (DB_UTILISATEUR_ATTENDU). Avec le pooler Supabase, c'est " +
        "l'utilisateur qui designe le projet : un hote identique ne prouve donc " +
        "rien. Demarrage refuse. Ni la valeur attendue ni la valeur atteinte ne " +
        "sont reproduites ici."
      );
    }
  }

  if (!conforme) {
    // Le message nomme l'hote attendu et l'hote atteint. Ce ne sont pas des
    // secrets — contrairement a l'utilisateur et au mot de passe, qui ne sont
    // ni lus ni ecrits ici.
    throw new CibleBaseRefusee(
      "DATABASE_URL ne designe pas la base declaree par ce service. " +
      `Attendu : ${attendues.map((a) => (a.base ? `${a.hote}/${a.base}` : a.hote)).join(" ou ")}. ` +
      `Atteint : ${reelle.hote}/${reelle.base}. ` +
      "Demarrage refuse : ce service modifie le schema a chaque demarrage, et " +
      "il ne doit pas le faire sur une base qui n'est pas la sienne. " +
      "Corrigez DATABASE_URL, ou DB_HOTE_ATTENDU si la bascule est voulue."
    );
  }

  return { verifiee: true, cible: reelle };
}
