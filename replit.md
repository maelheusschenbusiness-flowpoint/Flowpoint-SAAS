# FlowPoint

FlowPoint is a multi-tenant SEO and marketing operations platform. The API service lives in `artifacts/api-server`.

## User preferences

- Keep production untouched unless the user explicitly authorizes production work.
- Do not initiate real Stripe transactions without separate confirmation.
- Keep development data clean: canonical global seeds only, with no tenant or mock data.

### Git workflow (mandatory — no exceptions)

Never recreate commits via the GitHub Git Data API when the local workspace is available — it produces diverged SHAs and forces a rebase after every task.

**Required workflow for every task:**
1. Before any modification: `git fetch origin && git status && git rev-parse HEAD && git rev-parse origin/Test-Replit` — if local ≠ remote, synchronise first with `git pull --rebase origin Test-Replit` (or `git reset --hard origin/Test-Replit` when there are no local changes to keep).
2. Make changes → run tests → `git add` → `git commit` → `git push origin Test-Replit`.
3. End of task: `git fetch origin && git status` — confirm `local HEAD == origin/Test-Replit` and working tree is clean before closing.

**GitHub Git Data API:** only if `git push` is genuinely impossible (proven auth failure). If used, immediately re-sync: `git fetch origin && git reset --hard origin/Test-Replit`.