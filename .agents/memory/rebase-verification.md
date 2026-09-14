---
name: Rebase verification
description: How to confirm a conflicted rebase actually completed in this workspace
---

After resolving a rebase, do not rely on a clean working tree alone. Confirm that no rebase metadata remains, inspect the reflog for `rebase (finish)` versus `rebase (abort)`, and verify `origin/Flowpoint` is an ancestor of the branch with `git merge-base --is-ancestor`.

**Why:** A previous conflicted rebase was aborted while leaving the branch clean, which could look finished if only `git status` was checked.

**How to apply:** Before reporting a rebase complete, check status, reflog, merge-base, conflict stages, and the final branch head; then run only the requested targeted validations.