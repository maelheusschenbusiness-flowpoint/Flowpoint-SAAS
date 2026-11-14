import { configDefaults, defineConfig } from "vitest/config";
import { EXCLUSIONS, INCLUDE } from "./vitest.exclusions.mjs";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Workspace packages — resolves to source so oxc can transform them
      "@workspace/db":      resolve(__dirname, "../../lib/db/src/index.ts"),
      "@workspace/api-zod": resolve(__dirname, "../../lib/api-zod/src/index.ts"),
    },
  },
  test: {
    // Perimetre = GLOB (plus de liste blanche fichier par fichier) :
    // tout nouveau `*.test.ts` sous src/, tests/ ou tools/ tourne automatiquement,
    // sans modifier ce fichier — ce qui supprime aussi les conflits de fusion d'une
    // ligne entre PR. Les fichiers qui NE doivent PAS tourner sous vitest sont
    // declares, avec leur raison, dans ./vitest.exclusions.mjs ; la CI echoue si un
    // test n'est ni inclus ni exclu explicitement (scripts/verifier-tests-orphelins.mjs).
    include: INCLUDE,
    exclude: [...configDefaults.exclude, ...EXCLUSIONS.map((e) => e.fichier)],
    environment: "node",
    // DETERMINISME : les fichiers ne s'executent pas en parallele.
    //
    // Mesure du 17/10/2026 : plusieurs fichiers modifient le schema PARTAGE
    // de la base de test — DROP TABLE, DROP puis CREATE POLICY — pendant que
    // d'autres verifient un invariant GLOBAL sur toutes les tables portant
    // org_id. Resultat, la suite rendait 0, 4 ou 9 echecs selon le passage,
    // pour des raisons etrangeres au produit.
    //
    // Cout mesure : 46 s au lieu de 11 s. C'est le prix d'un resultat sur
    // lequel on peut fonder une decision, et il est paye une fois par
    // verification, pas par personne.
    fileParallelism: false,
    globals:     false,
    reporters:   ["verbose"],
    // Mock heavy deps that would require a real DB connection
    setupFiles:  ["./src/test-email-safety.setup.ts", "./src/vitest.setup.ts"],
    // Use the isolated tsconfig so oxc does NOT pick up the composite/references
    // from tsconfig.json (which targets compiled workspace packages, not source).
    // tsconfig.json composite+references must stay intact for tsc project build.
    typecheck: { tsconfig: "./tsconfig.vitest.json" },
  },
});
