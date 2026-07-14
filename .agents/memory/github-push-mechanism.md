---
name: GitHub push mechanism
description: How to push to GitHub remote from the Replit main agent environment
---

## Rule
Git staging (`git add`) and committing are blocked in the main agent by sandbox policy — exit 254. The GitHub connector proxy (`@replit/connectors-sdk` `getProxyUrl` / `createProxyFetch`) fails with "No conn_... connection found for this customer" in the code_execution notebook. The pre-registered `listConnections('github')` in the code_execution sandbox returns 0 connections. `git ls-remote --heads origin` works (read-only), but `replit-git-askpass` password prompt times out when called standalone (only works inside git subprocess context).

**Why:** The main agent sandbox policy blocks all write git operations. The GitHub connector proxy binds to a customer context that differs between the main agent session and the code_execution notebook sandbox.

**How to apply:** When changes must reach GitHub (e.g. for Render auto-deploy):
1. The Replit system auto-commits at task end — changes land in the local repo.
2. User must manually push via the Replit git panel or CLI: `git push origin HEAD:Test-Replit`
3. Do NOT waste time retrying connector/git approaches — tell the user promptly.
