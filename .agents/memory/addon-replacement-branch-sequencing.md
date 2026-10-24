---
name: Add-on replacement branch sequencing
description: Branch and shared-file constraints for the five replacement add-ons
---

Use the existing feature branches for the replacement add-ons; do not create new branches to restart their development. Work in parallel only when files are independent. Only one branch should change the shared add-on catalogue or dashboard source/export files at a time.

**Why:** the user explicitly requested reuse of existing branches and avoiding simultaneous edits to shared catalogue and dashboard files because those changes conflict across branches.

**How to apply:** finish or safely publish a branch's shared-file changes before moving those same files to another branch. While a prior shared-file PR is awaiting approval, limit other branches to independent work that will not overwrite those files.
