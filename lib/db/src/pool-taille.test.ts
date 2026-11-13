/**
 * pool-taille.test.ts
 *
 * DEFAUT MESURE LE 18/10/2026. Le deploiement du commit 311c545f a echoue au
 * demarrage sur :
 *
 *   (EMAXCONNSESSION) max clients reached in session mode
 *   - max clients are limited to pool_size: 15
 *
 * Le pool applicatif etait a `max: 20`, au-dessus du plafond de 15 du pooler
 * Supabase en mode session. Pendant un deploiement sans coupure deux
 * instances coexistent : le plafond est franchi, et le demarrage echoue.
 *
 * L'invariant verrouille ici : DEUX instances doivent tenir sous 15, avec de
 * la marge pour `migrate` et les taches planifiees.
 */
import { vi, describe, it, expect } from "vitest";

// Un mock global de `@workspace/db` existe dans la configuration de test ; on
// demande ici le module reel, puisque c'est sa valeur qu'on verifie.
vi.mock("@workspace/db", async (importOriginal) =>
  importOriginal<typeof import("@workspace/db")>()
);

import { TAILLE_POOL_RETENUE } from "@workspace/db";

/** Plafond du pooler Supabase en mode session, constate dans l'erreur. */
const PLAFOND_POOLER = 15;

describe("la taille du pool tient sous le plafond du pooler", () => {
  it("deux instances simultanees restent sous le plafond", () => {
    expect(
      TAILLE_POOL_RETENUE * 2,
      `${TAILLE_POOL_RETENUE} x 2 instances depasse les ${PLAFOND_POOLER} clients du ` +
      "pooler : un deploiement sans coupure echouera en EMAXCONNSESSION."
    ).toBeLessThan(PLAFOND_POOLER);
  });

  it("il reste de la marge pour migrate et les taches planifiees", () => {
    expect(PLAFOND_POOLER - TAILLE_POOL_RETENUE * 2).toBeGreaterThanOrEqual(2);
  });

  it("la valeur reste suffisante pour le trafic reel", () => {
    // 118 589 requetes sur 30 jours = 0,046 requete/seconde. Deux connexions
    // suffiraient ; on en garde plus pour les rafales et les requetes longues.
    expect(TAILLE_POOL_RETENUE).toBeGreaterThanOrEqual(4);
  });
});
