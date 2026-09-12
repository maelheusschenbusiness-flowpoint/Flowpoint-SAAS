import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(
  new URL("../../../flowpoint-export/dashboard.js", import.meta.url),
  "utf8",
);

let passed = 0;
function check(condition, message) {
  assert.ok(condition, message);
  passed += 1;
  console.log("  ✓ " + message);
}

const renderStart = source.indexOf("function renderCompetitor()");
const productionReturn = source.indexOf("    return `", renderStart);
const globalHydration = source.indexOf(
  "// Persisted AI analyses are independent from provider metrics.",
  renderStart,
);

check(renderStart >= 0, "found the production competitor renderer");
check(
  globalHydration > renderStart && globalHydration < productionReturn,
  "saved analyses are hydrated before every production competitor view renders",
);

const listStart = source.indexOf("const _persistedA = STATE.competitorAnalyses", renderStart);
const listEnd = source.indexOf("const _a = _persistedA", listStart);
const listBlock = source.slice(listStart, listEnd + 30);
check(listStart >= 0 && listEnd > listStart, "default competitor list reads persisted analyses");
check(
  listBlock.includes("const available = c.dataStatus === 'available'") ||
    source.slice(listStart - 500, listEnd + 30).includes("const available = c.dataStatus === 'available'"),
  "provider availability and saved-analysis state remain independent",
);

const loaderStart = source.indexOf("window.fpLoadCompetitorAnalysis = async function");
const loaderEnd = source.indexOf("window.fpCreateMissionFromOpportunity", loaderStart);
check(loaderStart >= 0 && loaderEnd > loaderStart, "found the saved-analysis loader");

const loaderSource = source.slice(loaderStart, loaderEnd);
const context = {
  window: {},
  STATE: {},
  render() {},
  apiFetch: async () => ({ ok: true, analysis: { value_prop: "Persisted value" } }),
};
vm.createContext(context);
vm.runInContext(loaderSource, context);

await context.window.fpLoadCompetitorAnalysis("competitor-1");
check(
  context.STATE.competitorAnalyses["competitor-1"]?.value_prop === "Persisted value",
  "loader hydrates a persisted analysis into dashboard state",
);

let fetchCalls = 0;
context.apiFetch = async () => {
  fetchCalls += 1;
  return { ok: true, analysis: { value_prop: "Should not replace cache" } };
};
await context.window.fpLoadCompetitorAnalysis("competitor-1");
check(fetchCalls === 0, "hydration guard prevents duplicate requests and render loops");

context.apiFetch = async () => {
  const error = new Error("No analysis");
  error.status = 404;
  throw error;
};
await context.window.fpLoadCompetitorAnalysis("competitor-empty");
check(
  !context.STATE._competitorAnalysisErrors["competitor-empty"],
  "404 is treated as a genuine no-analysis state",
);

context.apiFetch = async () => {
  const error = new Error("Database unavailable");
  error.status = 500;
  throw error;
};
await context.window.fpLoadCompetitorAnalysis("competitor-error");
check(
  context.STATE._competitorAnalysisErrors["competitor-error"] === "Database unavailable",
  "non-404 analysis failures remain explicit and retryable",
);

console.log(`\ncompetitor persisted-analysis hydration — ${passed} passed, 0 failed`);