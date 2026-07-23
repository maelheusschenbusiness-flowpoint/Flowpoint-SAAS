---
name: Overview insights quota-vs-no_data order
description: Priority rules for /overview/insights status responses and DB row truthiness guard
---

## Rule
`quota_exhausted` must be checked **before** `no_data`.

**Why:** An org with exhausted quota but no context data would silently return `no_data`, hiding the real reason the feature is unavailable. The UX hierarchy is: quota > data presence.

**How to apply:** In overview.ts (and any future AI insight endpoint), run `checkAIQuota()` immediately after building context data, before the `ctxLines.length === 0` guard.

## DB row truthiness guard
PostgreSQL `COUNT(*)` returns the integer 0, but node-postgres maps numeric columns to JS strings in some configurations. Always guard with `Number(x) > 0` rather than bare truthiness (`x?.total`) to avoid `"0"` string evaluating as truthy.

**Pattern:**
```ts
// WRONG — "0" string is truthy
kw?.total ? `Mots-clés: ${kw.total}...` : ""

// CORRECT
Number(kw?.total) > 0 ? `Mots-clés: ${kw!.total}...` : ""
```
