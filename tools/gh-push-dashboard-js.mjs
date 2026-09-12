/**
 * Push dashboard.js (large file ~5MB) via GitHub Git Data API blobs (base64)
 * on top of the previous commit just pushed (3a18af2c68)
 */
import { ReplitConnectors } from "@replit/connectors-sdk";
import { readFileSync } from "node:fs";

const connectors = new ReplitConnectors();
const OWNER  = "maelheusschenbusiness-flowpoint";
const REPO   = "Flowpoint-SAAS";
const BRANCH = "Test-Replit";
const BASE   = `/repos/${OWNER}/${REPO}`;
const ROOT   = "/home/runner/workspace";

async function gh(path, opts = {}) {
  const r = await connectors.proxy("github", path, opts);
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
}

// Get current remote HEAD (the commit we just pushed)
const refData = await gh(`${BASE}/git/refs/heads/${BRANCH}`);
const headSha = refData.object?.sha;
console.log("Remote HEAD:", headSha?.slice(0, 10));

const commitData = await gh(`${BASE}/git/commits/${headSha}`);
const treeSha = commitData.tree?.sha;
console.log("Remote tree:", treeSha?.slice(0, 10));

// Upload both dashboard.js files as base64 blobs
const files = [
  { local: `${ROOT}/src/frontend/dashboard.js`,              path: "src/frontend/dashboard.js" },
  { local: `${ROOT}/artifacts/flowpoint-export/dashboard.js`, path: "artifacts/flowpoint-export/dashboard.js" },
];

console.log("Uploading dashboard.js blobs (base64, may take a moment)…");
const treeItems = [];
for (const f of files) {
  const b64 = readFileSync(f.local).toString("base64");
  console.log(`  ${f.path}: ${(b64.length / 1024 / 1024).toFixed(1)} MB b64`);
  const blob = await gh(`${BASE}/git/blobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: b64, encoding: "base64" }),
  });
  if (!blob.sha) throw new Error(`Blob failed for ${f.path}: ${JSON.stringify(blob).slice(0, 300)}`);
  console.log(`  blob ${blob.sha.slice(0, 10)}  ${f.path}`);
  treeItems.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
}

// Create tree
const treeRes = await gh(`${BASE}/git/trees`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ base_tree: treeSha, tree: treeItems }),
});
if (!treeRes.sha) throw new Error("Tree failed: " + JSON.stringify(treeRes).slice(0, 300));
console.log("New tree:", treeRes.sha.slice(0, 10));

// Create commit
const commitRes = await gh(`${BASE}/git/commits`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    message: "fix: include dashboard.js with 6 UI corrections",
    tree: treeRes.sha,
    parents: [headSha],
  }),
});
if (!commitRes.sha) throw new Error("Commit failed: " + JSON.stringify(commitRes).slice(0, 300));
console.log("New commit:", commitRes.sha);

// Update ref
const refRes = await gh(`${BASE}/git/refs/heads/${BRANCH}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sha: commitRes.sha, force: false }),
});
console.log("Ref updated:", refRes.object?.sha || JSON.stringify(refRes).slice(0, 100));
console.log("Done.");
