/**
 * Identifiants de visiteur des parcours de certification.
 *
 * `conversion-dashboards.ts` exclut des chiffres commerciaux les visiteurs dont
 * l'identifiant commence par `fp-test-` (TEST_FILTER). Un parcours de certification
 * qui laisserait le navigateur generer un UUID polluerait donc les tableaux de bord.
 * Le format reste accepte par le navigateur et le serveur (`fp-<a-z0-9>-<a-z0-9>`).
 */
import { randomUUID } from "node:crypto";

export const PREFIXE_VISITEUR_TEST = "fp-test-";

export function visiteurCertification(): string {
  return `${PREFIXE_VISITEUR_TEST}${randomUUID().replaceAll("-", "")}`;
}
