#!/usr/bin/env node
/**
 * Refuse tout test ignore qui ne figure pas sur la liste blanche.
 *
 * Un test ignore ne se voit pas. Il passe pour un succes dans un resume, et
 * un parcours entier peut cesser d'etre couvert sans que personne ne le
 * remarque — c'est arrive ici : le test de la visite guidee s'ignorait en
 * silence des qu'un drapeau serveur avait ete pose une fois.
 *
 * La regle est donc : chaque test ignore doit etre DECLARE, avec sa raison.
 * Tout autre test ignore fait echouer la verification.
 *
 *   node scripts/verifier-tests-ignores.mjs <rapport-json-de-vitest>
 */
import { readFileSync } from "node:fs";

/**
 * Tests dont l'abandon est VOULU, avec la raison.
 *
 * Chaque entree est un prefixe de nom complet de test. Pour en ajouter une,
 * il faut dire pourquoi — c'est le seul garde-fou contre la derive.
 */
const IGNORES_ASSUMES = [
  {
    motif: "GET /admin/sellers totals on a real PostgreSQL",
    raison:
      "Opt-in explicite de son auteur : le fichier s'ignore sans " +
      "SELLER_TOTALS_DATABASE_URL, une base jetable SEPAREE qu'il efface " +
      "par DROP SCHEMA. La CI ne la fournit pas : ces trois tests exigeraient " +
      "une seconde base migree pour un gain nul sur la securite.",
  },
  {
    motif: "`my_table` ",
    raison:
      "`my_table` n'existe que dans la base de production historique ; la " +
      "migration du depot ne la cree pas. Ces deux tests couvrent une " +
      "relation indirecte (table rattachee a un utilisateur, sans org_id) et " +
      "ne peuvent donc s'executer que sur une copie de production.",
  },
];

const chemin = process.argv[2];
if (!chemin) {
  console.error("usage : verifier-tests-ignores.mjs <rapport-json-de-vitest>");
  process.exit(2);
}

let rapport;
try {
  rapport = JSON.parse(readFileSync(chemin, "utf8"));
} catch (err) {
  console.error(`Rapport illisible (${chemin}) : ${err.message}`);
  console.error("La suite n'a probablement pas produit de rapport — verifiez l'etape precedente.");
  process.exit(2);
}

/** Vitest rend `testResults[].assertionResults[]` avec un `status`. */
const ignores = [];
let total = 0;
for (const fichier of rapport.testResults ?? []) {
  for (const t of fichier.assertionResults ?? []) {
    total += 1;
    if (t.status === "pending" || t.status === "skipped" || t.status === "todo") {
      ignores.push({
        nom: t.fullName ?? t.title ?? "(sans nom)",
        fichier: fichier.name ?? "(fichier inconnu)",
      });
    }
  }
}

if (total === 0) {
  console.error("Aucun test dans le rapport : la verification ne prouverait rien.");
  process.exit(2);
}

const assumes = [];
const involontaires = [];
for (const t of ignores) {
  const connu = IGNORES_ASSUMES.find((a) => t.nom.includes(a.motif));
  (connu ? assumes : involontaires).push({ ...t, raison: connu?.raison });
}

console.log(`${total} tests, ${ignores.length} ignore(s).`);
if (assumes.length > 0) {
  console.log(`\n${assumes.length} ignore(s) assume(s) :`);
  for (const t of assumes) console.log(`  · ${t.nom}`);
}

if (involontaires.length > 0) {
  console.error(`\n${involontaires.length} test(s) ignore(s) NON DECLARE(S) :`);
  for (const t of involontaires) {
    console.error(`  ✗ ${t.nom}`);
    console.error(`    ${t.fichier}`);
  }
  console.error(
    "\nUn test ignore ne se voit pas : il passe pour un succes. Soit il doit " +
    "s'executer, soit son abandon doit etre declare avec sa raison dans " +
    "scripts/verifier-tests-ignores.mjs."
  );
  process.exit(1);
}

console.log("\n✓ Aucun test ignore involontairement.");
