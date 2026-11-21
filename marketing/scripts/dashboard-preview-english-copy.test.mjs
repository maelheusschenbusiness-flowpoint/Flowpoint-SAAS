import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync("client/public/dashboard-preview/dashboard.js", "utf8");
const bootstrap = readFileSync("client/public/dashboard-preview/preview-bootstrap.js", "utf8");

test("English preview translates visible monitoring and reporting error states", () => {
  assert.ok(dashboard.includes("text: fpT('Données indisponibles — réessayez dans un instant')"));
  assert.ok(dashboard.includes("'Données indisponibles — réessayez dans un instant': 'Data unavailable — please try again shortly'"));
});

test("English Local SEO preview translates post loading, error, and empty states", () => {
  assert.ok(dashboard.includes("fpT('Chargement des posts…')"));
  assert.ok(dashboard.includes("fpT('Posts indisponibles pour ce compte ou cette offre.')"));
  assert.ok(dashboard.includes("'Posts indisponibles pour ce compte ou cette offre.': 'Posts are unavailable for this account or plan.'"));
  assert.ok(dashboard.includes("fpT('Aucun post enregistré. Créez un brouillon, planifiez-le ou publiez-le sur un établissement connecté.')"));
  assert.ok(dashboard.includes("'Chargement des posts…': 'Loading posts…'"));
  assert.ok(dashboard.includes("'Aucun post enregistré. Créez un brouillon, planifiez-le ou publiez-le sur un établissement connecté.': 'No posts saved. Create a draft, schedule it, or publish it to a connected location.'"));
});

test("preview requests remain isolated from live dashboard APIs", () => {
  assert.match(
    bootstrap,
    /if \(!isPreviewAsset && !isTranslationRequest\)\s*\{\s*return Promise\.reject\(new Error\("Dashboard preview API is disabled"\)\);\s*\}/,
  );
  assert.match(dashboard, /const PREVIEW_MODE = true; \/\/ Isolated marketing preview: use built-in sample data/);
});
