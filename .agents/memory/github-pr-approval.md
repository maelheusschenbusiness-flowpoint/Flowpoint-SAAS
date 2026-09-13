---
name: GitHub PR approval requirement
description: FlowPoint pull requests require an approving review from a reviewer with write access before merge.
---

FlowPoint PRs cannot be merged through the GitHub API until at least one reviewer with write access has approved them; the PR author cannot satisfy this requirement by self-approval.

**Why:** The repository rule blocks an otherwise clean and mergeable PR, and the merge endpoint rejects attempts to bypass it.

**How to apply:** Check review status before attempting a merge. If approval is missing, stop without deployment or production verification.