'use strict';

const cheerio = require('cheerio');

async function runAudit(
  url
) {

  try {

    const response =
      await fetch(url);

    const html =
      await response.text();

    const $ =
      cheerio.load(html);

    const title =
      $('title').text();

    const metaDescription =
      $(
        'meta[name="description"]'
      ).attr('content');

    const h1 =
      $('h1').length;

    const images =
      $('img').length;

    const missingAlt =
      $('img:not([alt])').length;

    let seoScore = 100;

    const issues = [];

    if (!title) {

      seoScore -= 20;

      issues.push({

        type: 'seo',

        title:
          'Titre manquant',
      });
    }

    if (!metaDescription) {

      seoScore -= 15;

      issues.push({

        type: 'seo',

        title:
          'Meta description manquante',
      });
    }

    if (!h1) {

      seoScore -= 10;

      issues.push({

        type: 'seo',

        title:
          'Aucun H1 détecté',
      });
    }

    if (missingAlt > 0) {

      seoScore -= Math.min(
        20,
        missingAlt * 2
      );

      issues.push({

        type:
          'accessibility',

        title:
          'Images sans ALT',
      });
    }

    seoScore =
      Math.max(
        0,
        seoScore
      );

    return {

      score:
        seoScore,

      seoScore,

      performanceScore:
        Math.max(
          50,
          100 - images
        ),

      accessibilityScore:
        Math.max(
          60,
          100 - missingAlt * 3
        ),

      issues,

      recommendations: [

        {
          title:
            'Optimiser les balises SEO',
        },

        {
          title:
            'Réduire le poids des images',
        },

      ],

      metadata: {

        title,

        images,

        missingAlt,

      },
    };

  } catch {

    return {

      score: 0,

      seoScore: 0,

      performanceScore: 0,

      accessibilityScore: 0,

      issues: [

        {
          type: 'system',
          title:
            'Audit impossible',
        },

      ],

      recommendations: [],

      metadata: {},
    };
  }
}

module.exports = {
  runAudit,
};
