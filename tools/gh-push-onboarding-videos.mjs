/**
 * Push all 6 onboarding MP4 videos to GitHub via Git Data API (base64 blobs)
 */
import { ReplitConnectors } from "@replit/connectors-sdk";
import { readFileSync } from "node:fs";

const connectors = new ReplitConnectors();
const OWNER  = "maelheusschenbusiness-flowpoint";
const REPO   = "Flowpoint-SAAS";
const BRANCH = "Test-Replit";
const BASE   = `/repos/${OWNER}/${REPO}`;
const ONBD   = "/home/runner/workspace/artifacts/flowpoint-export/onboarding";

async function gh(path, opts = {}) {
  const r = await connectors.proxy("github", path, opts);
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
}

const refData = await gh(`${BASE}/git/refs/heads/${BRANCH}`);
const headSha = refData.object?.sha;
console.log("Remote HEAD:", headSha?.slice(0, 10));

const commitData = await gh(`${BASE}/git/commits/${headSha}`);
const treeSha = commitData.tree?.sha;
console.log("Remote tree:", treeSha?.slice(0, 10));

const videos = [
  "step1-interface",
  "step2-audit-actions",
  "step3-monitoring-alerts",
  "step4-local-competition",
  "step5-ai-reports",
  "step6-daily",
];

console.log("\nUploading blobs…");
const treeItems = [];
for (const name of videos) {
  const localPath = `${ONBD}/${name}.mp4`;
  const b64 = readFileSync(localPath).toString("base64");
  console.log(`  ${name}.mp4  ${(b64.length / 1024).toFixed(0)} KB b64`);
  const blob = await gh(`${BASE}/git/blobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: b64, encoding: "base64" }),
  });
  if (!blob.sha) throw new Error(`Blob failed for ${name}: ${JSON.stringify(blob).slice(0, 200)}`);
  console.log(`    blob ${blob.sha.slice(0, 10)}`);
  treeItems.push({
    path: `artifacts/flowpoint-export/onboarding/${name}.mp4`,
    mode: "100644",
    type: "blob",
    sha: blob.sha,
  });
}

const treeRes = await gh(`${BASE}/git/trees`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ base_tree: treeSha, tree: treeItems }),
});
if (!treeRes.sha) throw new Error("Tree failed: " + JSON.stringify(treeRes).slice(0, 300));
console.log("\nNew tree:", treeRes.sha.slice(0, 10));

const commitRes = await gh(`${BASE}/git/commits`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    message: "feat: replace onboarding videos V2-V6 with dense real-demo recordings",
    tree: treeRes.sha,
    parents: [headSha],
  }),
});
if (!commitRes.sha) throw new Error("Commit failed: " + JSON.stringify(commitRes).slice(0, 300));
console.log("New commit:", commitRes.sha);

const refRes = await gh(`${BASE}/git/refs/heads/${BRANCH}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sha: commitRes.sha, force: false }),
});
console.log("Ref updated:", refRes.object?.sha || JSON.stringify(refRes).slice(0, 100));
console.log("\nDone.");
