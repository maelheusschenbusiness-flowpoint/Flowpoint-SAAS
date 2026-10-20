import type { RouteComponentProps } from "wouter";
import { Footer } from "@/components/Footer";
import { Navigation } from "@/components/Navigation";
import { SupportChat } from "@/components/SupportChat";
import { Badge } from "@/components/ui/badge";
import { usePageTitle } from "@/hooks/use-page-title";
import NotFound from "@/pages/not-found";
import { getResourceArticle } from "@shared/resource-articles";

const NOT_FOUND_TITLE = "Page introuvable | Flowpoint";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export default function ResourceArticle({
  params,
}: RouteComponentProps<{ slug: string }>) {
  const article = getResourceArticle(params.slug);
  const relatedArticles = article
    ? article.relatedArticles
        .map((slug) => getResourceArticle(slug))
        .filter((related): related is NonNullable<typeof related> => Boolean(related))
    : [];

  usePageTitle(article?.title ?? NOT_FOUND_TITLE, { noindex: !article });

  if (!article) {
    return <NotFound />;
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      <Navigation />

      <main className="pt-28 pb-20">
        <article className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav aria-label="Fil d’Ariane" className="mb-8">
            <ol className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <li>
                <a href="/" className="hover:text-blue-600 hover:underline">
                  Accueil
                </a>
              </li>
              <li aria-hidden="true">/</li>
              <li>
                <a href="/ressources" className="hover:text-blue-600 hover:underline">
                  Ressources
                </a>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="text-slate-900 dark:text-slate-100">
                {article.h1}
              </li>
            </ol>
          </nav>

          {article.testOnly && (
            <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
              Article technique temporaire — visible uniquement en environnement local.
            </div>
          )}

          <header className="border-b border-slate-200 pb-8 dark:border-slate-700">
            <Badge className="mb-5">{article.cluster}</Badge>
            <h1 className="text-4xl sm:text-5xl font-display font-bold leading-tight text-slate-900 dark:text-slate-100">
              {article.h1}
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-slate-600 dark:text-slate-300">
              {article.metaDescription}
            </p>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-500 dark:text-slate-400">
              <span>Auteur : {article.author}</span>
              <time dateTime={article.datePublished}>
                Publié le {formatDate(article.datePublished)}
              </time>
              <time dateTime={article.dateModified}>
                Mis à jour le {formatDate(article.dateModified)}
              </time>
            </div>
          </header>

          <div className="prose prose-slate dark:prose-invert max-w-none pt-8">
            {article.content.map((section, sectionIndex) => (
              <section key={`${article.slug}-section-${sectionIndex}`}>
                {section.heading &&
                  (section.headingLevel === 3 ? (
                    <h3>{section.heading}</h3>
                  ) : (
                    <h2>{section.heading}</h2>
                  ))}
                {section.paragraphs?.map((paragraph, paragraphIndex) => (
                  <p key={`${article.slug}-paragraph-${sectionIndex}-${paragraphIndex}`}>
                    {typeof paragraph === "string"
                      ? paragraph
                      : paragraph.map((segment, segmentIndex) => {
                          if (typeof segment === "string") return segment;

                          const external = segment.href.startsWith("https://");
                          return (
                            <a
                              key={`${article.slug}-paragraph-${sectionIndex}-${paragraphIndex}-link-${segmentIndex}`}
                              href={segment.href}
                              className="text-blue-700 hover:underline dark:text-blue-300"
                              {...(external
                                ? { target: "_blank", rel: "noopener noreferrer" }
                                : {})}
                            >
                              {segment.label}
                            </a>
                          );
                        })}
                  </p>
                ))}
                {section.bullets && (
                  <ul>
                    {section.bullets.map((bullet, bulletIndex) => (
                      <li key={`${article.slug}-bullet-${sectionIndex}-${bulletIndex}`}>
                        {bullet}
                      </li>
                    ))}
                  </ul>
                )}
                {section.table && (
                  <figure className="my-8">
                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                      <table className="min-w-[880px] w-full border-collapse text-left text-sm">
                        <caption className="sr-only">{section.table.caption}</caption>
                        <thead className="bg-slate-100 dark:bg-slate-800">
                          <tr>
                            {section.table.headers.map((header) => (
                              <th
                                key={header}
                                scope="col"
                                className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100"
                              >
                                {header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {section.table.rows.map((row, rowIndex) => (
                            <tr
                              key={`${article.slug}-table-row-${rowIndex}`}
                              className="odd:bg-white even:bg-slate-50 dark:odd:bg-slate-900 dark:even:bg-slate-800/50"
                            >
                              {row.map((cell, cellIndex) => (
                                <td
                                  key={`${article.slug}-table-cell-${rowIndex}-${cellIndex}`}
                                  className="border-b border-slate-200 px-4 py-3 align-top text-slate-700 dark:border-slate-700 dark:text-slate-300"
                                >
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <figcaption className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                      {section.table.description}
                    </figcaption>
                  </figure>
                )}
                {section.links && (
                  <ul className="not-prose mt-4 space-y-2">
                    {section.links.map((link) => {
                      const external = link.href.startsWith("https://");
                      return (
                        <li key={link.href}>
                          <a
                            href={link.href}
                            className="text-blue-700 hover:underline dark:text-blue-300"
                            {...(external
                              ? { target: "_blank", rel: "noopener noreferrer" }
                              : {})}
                          >
                            {link.label}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ))}
          </div>

          {article.parentLandingCta !== null && (
            <aside className="mt-12 rounded-xl border border-blue-200 bg-blue-50 p-6 dark:border-blue-800 dark:bg-blue-950/30">
              <h2 className="text-xl font-display font-bold text-slate-900 dark:text-slate-100">
                {article.parentLandingCta?.heading ?? "Explorer le sujet"}
              </h2>
              <p className="mt-2 text-slate-600 dark:text-slate-300">
                {article.parentLandingCta?.description ??
                  "Retrouvez la page Flowpoint associée à cette thématique."}
              </p>
              <a
                href={article.parentLanding}
                className="mt-4 inline-flex font-semibold text-blue-700 hover:underline dark:text-blue-300"
              >
                {article.parentLandingCta?.label ?? "Découvrir la page de référence"}
              </a>
            </aside>
          )}

          {relatedArticles.length > 0 && (
            <section className="mt-12" aria-labelledby="related-articles-heading">
              <h2
                id="related-articles-heading"
                className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100"
              >
                Articles connexes
              </h2>
              <ul className="mt-4 space-y-3">
                {relatedArticles.map((related) => (
                  <li key={related.slug}>
                    <a
                      href={`/ressources/${encodeURIComponent(related.slug)}`}
                      className="text-blue-700 hover:underline dark:text-blue-300"
                    >
                      {related.h1}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
      </main>

      <Footer />
      <SupportChat />
    </div>
  );
}
