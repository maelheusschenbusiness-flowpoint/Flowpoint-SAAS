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
    if (!hote || !base) return null;
    return { hote, base };
  } catch {
    return null;
  }
}

/**
 * Une declaration acceptable s'ecrit `hote` ou `hote/base`. Plusieurs valeurs
 * peuvent etre separees par des virgules — utile pendant une bascule d'hote.
 */
function analyserDeclaration(declaration: string): CibleBase[] {
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
