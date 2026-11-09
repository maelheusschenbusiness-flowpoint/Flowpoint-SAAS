import { randomUUID } from "node:crypto";

/**
 * Identifiant non prédictible pour une ressource (préfixe lisible + UUID v4 cryptographique).
 * Remplace `${prefix}_${Date.now()}_${Math.random()...}` : l'ancien format est prévisible
 * (horodatage + 4 caractères) et facilitait l'énumération d'identifiants (IDOR).
 *
 * Compatibilité : les colonnes `id` sont TEXT ; les anciens identifiants restent lisibles
 * tels quels (aucune route ne parse le format).
 */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
