/**
 * Push all pending text-file changes to GitHub/Test-Replit via Git Data API
 * (MP4s excluded — already pushed; binary limit safeguard)
 */
import { ReplitConnectors } from "@replit/connectors-sdk";
import { readFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";

const connectors = new ReplitConnectors();
const OWNER  = "maelheusschenbusiness-flowpoint";
const REPO   = "Flowpoint-SAAS";
const BRANCH = "Test-Replit";
const BASE   = `/repos/${OWNER}/${REPO}`;
const REPO_ROOT = "/home/runner/workspace";
const MAX_BYTES = 900_000; // ~900 KB per file safe limit for Contents API

async function gh(path, opts = {}) {
  const r = await connectors.proxy("github", path, opts);
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
}

// Files to push (text files only, excluding MP4s)
const textFiles = [
  "src/frontend/dashboard.js",
  "artifacts/flowpoint-export/dashboard.js",
  "artifacts/api-server/src/tests/onboarding-replay-button.test.ts",
  ".agents/memory/MEMORY.md",
  ".agents/memory/ffmpeg-zoompan-duration.md",
  "tools/gh-push-videos.mjs",
  "tools/record-safe.mjs",
  "tools/record-v2.mjs",
  "tools/record-v3.mjs",
  "tools/record-v3-final.mjs",
  "tools/record-v4.mjs",
  "tools/record-v5.mjs",
  "tools/record-v6-fin.mjs",
  "tools/record-v6-only.mjs",
  "tools/record-final.mjs",
  ".agents/agent_assets_metadata.toml",
];

// Filter to files that exist and are under size limit
const eligible = textFiles.filter(f => {
  try {
    const s = statSync(`${REPO_ROOT}/${f}`);
    if (s.size > MAX_BYTES) { console.log(`  SKIP (too large ${s.size}): ${f}`); return false; }
    return true;
  } catch { console.log(`  SKIP (not found): ${f}`); return false; }
});

console.log(`Pushing ${eligible.length} files…`);

// Step 1 – get remote HEAD
const refData = await gh(`${BASE}/git/refs/heads/${BRANCH}`);
const headSha = refData.object?.sha;
if (!headSha) throw new Error("Could not resolve remote HEAD: " + JSON.stringify(refData).slice(0,200));
console.log(`Remote HEAD: ${headSha.slice(0,10)}`);

const commitData = await gh(`${BASE}/git/commits/${headSha}`);
const treeSha = commitData.tree?.sha;
console.log(`Remote tree: ${treeSha?.slice(0,10)}`);

// Step 2 – create blobs in parallel (batches of 4)
const treeItems = [];
for (let i = 0; i < eligible.length; i += 4) {
  const batch = eligible.slice(i, i + 4);
  const results = await Promise.all(batch.map(async (relPath) => {
    const content = readFileSync(`${REPO_ROOT}/${relPath}`, "utf8");
    const blob = await gh(`${BASE}/git/blobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, encoding: "utf-8" }),
    });
    if (!blob.sha) throw new Error(`Blob failed for ${relPath}: ${JSON.stringify(blob).slice(0,200)}`);
    console.log(`  blob ${blob.sha.slice(0,10)}  ${relPath}`);
    return { path: relPath, mode: "100644", type: "blob", sha: blob.sha };
  }));
  treeItems.push(...results);
}

// Step 3 – create tree
const treeRes = await gh(`${BASE}/git/trees`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ base_tree: treeSha, tree: treeItems }),
});
if (!treeRes.sha) throw new Error("Tree failed: " + JSON.stringify(treeRes).slice(0,200));
console.log(`New tree: ${treeRes.sha.slice(0,10)}`);

// Step 4 – get local HEAD message for commit
const localMsg = execSync("cd /home/runner/workspace && git log --format=%B -n1 HEAD", { encoding: "utf8" }).trim();

// Step 5 – create commit
const commitRes = await gh(`${BASE}/git/commits`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    message: "fix: 6 UI corrections (légende carte, titre carte mobile, rayon 50/100km, stop IA, activité équipe, add-on cards)",
    tree: treeRes.sha,
    parents: [headSha],
  }),
});
if (!commitRes.sha) throw new Error("Commit failed: " + JSON.stringify(commitRes).slice(0,200));
console.log(`New commit: ${commitRes.sha}`);

// Step 6 – update ref
const refRes = await gh(`${BASE}/git/refs/heads/${BRANCH}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sha: commitRes.sha, force: false }),
});
console.log(`Ref updated: ${refRes.object?.sha?.slice(0,10) || JSON.stringify(refRes).slice(0,100)}`);
console.log("Done.");
