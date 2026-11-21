import { getResourceArticleFromPath } from "@shared/resource-articles";

export const PUBLIC_PATHS = new Set([
  "/",
  "/thank-you",
  "/merci",
  "/about",
  "/a-propos",
  "/contact",
  "/careers",
  "/carrieres",
  "/legal-notice",
  "/mentions-legales",
  "/legal-information",
  "/informations-legales",
  "/updates",
  "/mises-a-jour",
  "/resources",
  "/ressources",
  "/features",
  "/fonctionnalites",
  "/seo-audit",
  "/local-seo",
  "/website-monitoring",
  "/seo-reporting",
  "/competitor-analysis",
  "/pricing",
  "/tarifs",
  "/benefits",
  "/avantages",
]);

export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) ||
    getResourceArticleFromPath(pathname) !== undefined
  );
}
