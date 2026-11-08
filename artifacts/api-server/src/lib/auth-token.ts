import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

/**
 * Comparaison de secrets en temps constant (ADMIN_KEY, API_SECRET_KEY...).
 *
 * `===` / `!==` s'arretent au premier octet different : le temps de reponse
 * renseigne un attaquant sur le prefixe correct. On compare donc deux
 * empreintes SHA-256 de longueur fixe avec `timingSafeEqual`, ce qui ne fuit
 * ni le contenu ni la longueur du secret attendu.
 */
export function keysEqual(provided: unknown, expected: unknown): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Un jeton en query string finit dans les journaux d'acces, l'historique du
 * navigateur et les en-tetes Referer. Il n'est accepte que pour un flux SSE :
 * EventSource ne sait pas poser d'en-tete, et envoie toujours
 * `Accept: text/event-stream` en GET. Meme regle que `requireAuth`.
 */
export function isSseQueryTokenRequest(req: Pick<Request, "method" | "query" | "headers">): boolean {
  return (
    req.method === "GET" &&
    typeof req.query?.["token"] === "string" &&
    String(req.headers?.["accept"] ?? "").includes("text/event-stream")
  );
}
