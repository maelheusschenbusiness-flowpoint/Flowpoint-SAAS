import { getResourceArticleFromPath } from "@shared/resource-articles";

export const PUBLIC_PATHS = new Set([
  "/",
  "/merci",
  "/a-propos",
  "/contact",
  "/carrieres",
  "/mentions-legales",
  "/informations-legales",
  "/mises-a-jour",
  "/ressources",
  "/fonctionnalites",
  "/seo-audit",
  "/local-seo",
  "/website-monitoring",
  "/seo-reporting",
  "/competitor-analysis",
  "/tarifs",
  "/avantages",
]);

export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) ||
    getResourceArticleFromPath(pathname) !== undefined
  );
}
