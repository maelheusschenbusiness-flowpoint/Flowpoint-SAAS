---
name: github_connections real schema
description: Real DB columns for github_connections — service interface and INSERT must match these; old interface was wrong in 3 places.
---

## Real github_connections columns (confirmed from DB)

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | bigint | NOT NULL | SERIAL |
| org_id | text | NOT NULL | 'default' |
| github_user_id | bigint | NOT NULL | — |
| login | text | NOT NULL | — |
| name | text | NULL | — |
| email | text | NULL | — |
| avatar_url | text | NULL | — |
| access_token | text | NOT NULL | — |
| scope | text | NULL | — |
| connected_at | timestamptz | NOT NULL | now() |
| updated_at | timestamptz | NULL | — |

## Corrections made

1. **Interface** `GitHubConnection` previously had `installedAt` (wrong); now has `githubUserId`, `connectedAt`.
2. **saveConnection INSERT** previously used `installed_at` (wrong column); now uses correct columns.
3. **getConnection SELECT** now maps snake_case DB columns to camelCase interface fields.
4. **exchangeCodeForToken** returns a raw string, NOT an object — callers must use the returned value directly as the access token.
5. **getGitHubUser** returns `{ id, login, name, email, avatarUrl }` (camelCase) — use `user.avatarUrl`, not `user.avatar_url`.

**Why:** The original saveConnection had a positional-arg mismatch that caused NULL to be stored for all token fields. The function signature expected an object but callers passed individual positional args, which TypeScript would have caught but esbuild does not type-check.

## How to apply

Any future change to GitHub OAuth must:
- Pass `githubUserId: user.id` to saveConnection
- Use `user.avatarUrl` (from getGitHubUser, camelCase)
- Treat `exchangeCodeForToken()` return value as the access token directly (it's a string)
