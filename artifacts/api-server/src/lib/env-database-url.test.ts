/**
 * env-database-url.test.ts
 *
 * MESURE DU 18/10/2026. En isolant l'environnement de test sur sa propre base,
 * le demarrage a echoue deux fois de suite, pour deux causes differentes — et
 * l'enchainement s'explique entierement par ce que ce controle laisse passer :
 *
 *   1. `28P01 password authentication failed for user "postgres"`.
 *      La chaine etait une URL parfaitement analysable, donc acceptee ici, mais
 *      le mot de passe etait faux. Le projet Supabase ayant ete cree par l'API,
 *      son mot de passe genere n'est pas relisible, et le tableau de bord sert
 *      une chaine contenant le gabarit `[YOUR-PASSWORD]` — que `.url()`
 *      ACCEPTE, comme ces tests le mesurent.
 *   2. `DATABASE_URL must be a valid PostgreSQL connection string`, sans dire
 *      pourquoi. Le mot de passe reinitialise contenait un caractere reserve :
 *      `#` ou `/` suffisent, et ce sont les deux seuls que `.url()` refuse
 *      parmi ceux qu'un generateur produit couramment.
 *
 * Ces tests verrouillent deux choses : le message nomme desormais la cause, et
 * il ne divulgue jamais la valeur refusee. Ils documentent aussi, par mesure,
 * ce que le controle NE rattrape pas — pour qu'on ne le croie pas plus fort
 * qu'il n'est.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

/**
 * Le meme controle que `envSchema.DATABASE_URL`.
 *
 * `.url()` de Zod, et non un `refine` autour de `new URL()` : mesure faite en
 * ecrivant ces tests, les deux se comportent a l'identique, et remplacer l'un
 * par l'autre n'apporte rien tout en risquant d'affaiblir la validation.
 */
const controle = z.string().url(
  "DATABASE_URL n'est pas une URL de connexion valide. Cause la plus frequente : " +
  "le mot de passe contient un caractere reserve (#, @, /, ?, +, =, espace) qui " +
  "doit etre encode en pourcentage — # devient %23, @ devient %40. Verifiez " +
  "aussi qu'aucun gabarit du type [YOUR-PASSWORD] ne subsiste."
);

const accepte = (v: string) => controle.safeParse(v).success;

describe("les chaines de connexion valides passent", () => {
  it.each([
    "postgresql://postgres:motdepasse@db.exemple.supabase.co:5432/postgres",
    "postgresql://postgres.ref:mot%23depasse@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
    "postgres://utilisateur:mdp@127.0.0.1:5456/fp_e2e",
    "postgresql://postgres:a%40b%2Fc@hote:5432/base?sslmode=require",
  ])("%s", (url) => expect(accepte(url)).toBe(true));
});

describe("LA CAUSE DU SECOND ECHEC — ce que le controle refuse", () => {
  it.each([
    ["un diese non encode dans le mot de passe", "postgresql://postgres:mdp#42@hote:5432/base"],
    ["un slash non encode dans le mot de passe", "postgresql://postgres:mdp/42@hote:5432/base"],
    ["des guillemets copies autour de la chaine", "\"postgresql://postgres:mdp@hote:5432/base\""],
    ["un prefixe psql copie avec la commande", "psql postgresql://postgres:mdp@hote:5432/base"],
    ["des crochets autour de l'hote", "postgresql://postgres:mdp@[db.x.supabase.co]:5432/base"],
    ["une chaine vide", ""],
  ])("%s", (_nom, url) => expect(accepte(url)).toBe(false));

  it("et l'encodage en pourcentage repare exactement ces deux cas", () => {
    expect(accepte("postgresql://postgres:mdp%2342@hote:5432/base"), "# encode en %23").toBe(true);
    expect(accepte("postgresql://postgres:mdp%2F42@hote:5432/base"), "/ encode en %2F").toBe(true);
  });
});

describe("LA CAUSE DU PREMIER ECHEC — ce que le controle laisse passer", () => {
  // Mesure, pas opinion. Ces chaines sont acceptees ici et echouent plus tard,
  // a la connexion, en 28P01. C'est pourquoi une URL valide ne prouve rien
  // quant a la base reellement atteinte — et pourquoi la garde de cible
  // (garde-cible-base.ts) verifie la DESTINATION, pas la forme.
  it.each([
    ["un gabarit [YOUR-PASSWORD] non remplace", "postgresql://postgres:[YOUR-PASSWORD]@db.x.supabase.co:5432/postgres"],
    ["un espace dans le mot de passe", "postgresql://postgres:mot de passe@hote:5432/base"],
    ["une arobase dans le mot de passe", "postgresql://postgres:mdp@42@hote:5432/base"],
    ["un retour a la ligne final", "postgresql://postgres:mdp@hote:5432/base\n"],
  ])("%s est accepte, et echouera a la connexion", (_nom, url) => {
    expect(accepte(url)).toBe(true);
  });
});

describe("le message aide, et ne trahit rien", () => {
  it("il nomme l'encodage en pourcentage et le gabarit", () => {
    const r = controle.safeParse("postgresql://postgres:mdp#42@hote:5432/base");
    expect(r.success).toBe(false);
    if (r.success) return;
    const m = r.error.errors[0]?.message ?? "";
    expect(m).toContain("encode en pourcentage");
    expect(m).toContain("YOUR-PASSWORD");
  });

  it("il ne contient jamais la valeur refusee", () => {
    const secret = "motDePasseUltraSecret#42";
    const r = controle.safeParse(`postgresql://postgres:${secret}@hote:5432/base`);
    expect(r.success).toBe(false);
    if (r.success) return;
    const m = r.error.errors[0]?.message ?? "";
    expect(m, "le message divulgue le mot de passe").not.toContain(secret);
    expect(m, "le message divulgue un fragment du mot de passe").not.toContain("UltraSecret");
  });
});
