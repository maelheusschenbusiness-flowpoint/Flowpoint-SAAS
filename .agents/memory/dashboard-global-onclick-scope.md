---
name: dashboard.js — window.* onclick handlers must be at IIFE global scope
description: Why handlers referenced by inline onclick from more than one page must not be defined inside a per-section render block.
---

# window.* onclick handlers must live at IIFE global scope

Any `window.fpXxx` function referenced from an inline `onclick` must be defined
at the IIFE's global scope — never inside a `if (sub === '...')` render block or
any other per-section branch.

**Why:** the account-deletion modal functions were defined inside the *billing*
render branch, but danger-zone buttons calling them exist on **both** the
billing page and the Settings → Data page, and the global
`openDataDeletionPanel('account')` delegates to them behind a
`window.fpX && window.fpX()` guard. Clicking "Supprimer mon compte" from
Settings was a silent no-op for any session that had never rendered the billing
page. The `&&` guard turned a crash into invisible dead UI, which is why it
went unnoticed.

**How to apply:** when adding a `window.*` handler, ask which pages reference it.
If the answer is more than one — or if a global delegator calls it — define it at
global scope beside the other `window.*` declarations. Treat a
`window.fn && window.fn()` guard on a user-facing action as a smell: it hides
exactly this bug. Always run `node --check dashboard.js` after moving blocks.
