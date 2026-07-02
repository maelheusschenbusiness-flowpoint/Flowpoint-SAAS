---
name: Inline onclick in template literals
description: Rules to write safe inline onclick handlers in dashboard.js HTML template strings
---

# Inline onclick handlers in dashboard.js template literals

**Rule:** never reference template-scope variables (`o`, `z`, `c`…) inside an `onclick="..."` string, and never interpolate `JSON.stringify(value)` into a double-quoted attribute.

**Why:** the onclick string is evaluated at *click time* in global scope — template variables no longer exist (`ReferenceError`). `JSON.stringify` emits double quotes that terminate the `onclick="` attribute early, producing truncated JS ("Unexpected end of input"). Both bugs were found live in QA (fp-ai-chip chips, `_fpMQ(o.title)`, `_fpMQ(z.name)`).

**How to apply:** pass values through data attributes escaped with `escHtml`:
`data-t="${escHtml(v)}" onclick="_fpMQ(this.dataset.t, …)"`. Inside setTimeout callbacks, capture first: `var q=this.dataset.q;` before the closure. Good reference pattern already in the file: the "Créer page locale" button (data-kw + this.dataset.kw).

Also: the AI input id is `ai-input` (page) / `ai-panel-input` (panel); `fp-ai-input` is a CSS class, not an id.
