import {
  getResourceArticleCanonical,
  type ResourceArticle,
} from "./resource-articles";

export function appendResourceArticlesToSitemap(
  baseSitemap: string,
  articles: readonly ResourceArticle[],
): string {
  const closingTagIndex = baseSitemap.lastIndexOf("</urlset>");
  if (closingTagIndex === -1) {
    throw new Error("The base sitemap is missing its closing </urlset> tag.");
  }

  const existingUrls = new Set<string>();
  const locationPattern = /<loc>([^<]+)<\/loc>/g;
  let locationMatch: RegExpExecArray | null;
  while ((locationMatch = locationPattern.exec(baseSitemap))) {
    existingUrls.add(unescapeXml(locationMatch[1].trim()));
  }
  const articleEntries = articles
    .filter((article) => article.published)
    .filter((article) => !existingUrls.has(getResourceArticleCanonical(article.slug)))
    .map(
      (article) => `  <url>
    <loc>${escapeXml(getResourceArticleCanonical(article.slug))}</loc>
    <lastmod>${escapeXml(article.dateModified)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`,
    );

  if (articleEntries.length === 0) return baseSitemap;

  return [
    baseSitemap.slice(0, closingTagIndex).trimEnd(),
    ...articleEntries,
    baseSitemap.slice(closingTagIndex),
  ].join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}
