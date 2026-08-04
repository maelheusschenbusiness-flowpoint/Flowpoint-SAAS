---
name: Bare :not([data-theme]) selector pitfall
description: Why bare :not([data-theme="light"]) rules leak into light mode and how to write theme-scoped overrides
---

# Bare `:not([data-theme="light"])` matches in light mode

A selector like `:not([data-theme="light"]) .fp-card` matches **any** ancestor element lacking the attribute (body, every div…), so it applies in light mode too. Placed after the light-theme overrides, its `background:#16191f !important` wins the cascade → dark cards on light theme (the Aug 2026 mobile light-mode bug lot).

**Rule:** dark-only overrides must be anchored to the themed element: `html:not([data-theme="light"]) .fp-card`. The theme attribute lives on `<html>` (set from `localStorage['fp:theme']`).

**Audit command:** `rg '^\s*:not\(\[data-theme' dashboard.css` must return nothing.

Related: inline dark backgrounds in dashboard.js renderers (e.g. map placeholders) should use a CSS var themed in both blocks — pattern: `var(--fp-map-placeholder-bg, rgba(10,14,27,0.95))`, light block sets `#eef2f9`.
