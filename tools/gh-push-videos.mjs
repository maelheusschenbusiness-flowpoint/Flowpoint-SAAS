/**
 * Push 5 MP4 blobs to GitHub via connectors-sdk Git Data API
 */
import { ReplitConnectors } from "@replit/connectors-sdk";
import { readFileSync } from "node:fs";

const connectors = new ReplitConnectors();

const OWNER  = "maelheusschenbusiness-flowpoint";
const REPO   = "Flowpoint-SAAS";
const BRANCH = "Test-Replit";
const BASE   = `/repos/${OWNER}/${REPO}`;

async function gh(path, opts = {}) {
  const r = await connectors.proxy("github", path, opts);
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
}

const videos = [
  "step2-audit-actions",
  "step3-monitoring-alerts",
  "step4-local-competition",
  "step5-ai-reports",
  "step6-daily",
].map(name => ({
  local: `/home/runner/workspace/artifacts/flowpoint-export/onboarding/${name}.mp4`,
  path:  `artifacts/flowpoint-export/onboarding/${name}.mp4`,
  name,
}));

console.log("Creating blobs…");
const blobResults = await Promise.all(videos.map(async v => {
  const b64 = readFileSync(v.local).toString("base64");
  const res = await gh(`${BASE}/git/blobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: b64, encoding: "base64" }),
  });
  if (!res.sha) throw new Error(`Blob failed for ${v.name}: ${JSON.stringify(res).slice(0,200)}`);
  console.log(`  ${v.name} → ${res.sha.slice(0,10)}`);
  return { ...v, blobSha: res.sha };
}));

const refData    = await gh(`${BASE}/git/refs/heads/${BRANCH}`);
const headSha    = refData.object?.sha;
const commitData = await gh(`${BASE}/git/commits/${headSha}`);
const treeSha    = commitData.tree?.sha;
console.log(`HEAD ${headSha?.slice(0,10)}  tree ${treeSha?.slice(0,10)}`);

const treeRes = await gh(`${BASE}/git/trees`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    base_tree: treeSha,
    tree: blobResults.map(v => ({ path: v.path, mode: "100644", type: "blob", sha: v.blobSha })),
  }),
});
console.log(`new tree ${treeRes.sha?.slice(0,10)}`);

const commitRes = await gh(`${BASE}/git/commits`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    message: "chore: replace onboarding videos step2–6 with dense real-action recordings",
    tree: treeRes.sha,
    parents: [headSha],
  }),
});
console.log(`commit ${commitRes.sha?.slice(0,10)}`);

const patchRes = await gh(`${BASE}/git/refs/heads/${BRANCH}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sha: commitRes.sha }),
});
if (!patchRes.object?.sha) throw new Error(`PATCH failed: ${JSON.stringify(patchRes).slice(0,300)}`);
console.log(`branch → ${patchRes.object.sha.slice(0,10)}`);
console.log("✓ Done");
