---
name: i18n zero-French completion
description: All hardcoded French UI strings wrapped in fpT() — 0 detected by scanner; catalog state
---

## Rule
After this session, `dashboard.js` scans at **0** remaining French strings (HTML content, placeholder=, title= patterns). Any new visible text added to dashboard.js MUST use `fpT('key')`.

**Why:** The exhaustive i18n pass covered 377+31 wraps across 3 sessions. A future partial edit that adds raw French will re-break ES/DE/etc. views.

## How to apply
- New HTML: `<div>` + fpT('Clé française') + `</div>` (string concat)
- Template literal: `<div>${fpT('Clé française')}</div>`
- Attribute: `title="${fpT('Clé française')}"` (inside template literal)
- Single-quoted concat attr: `' title="' + fpT('Clé') + '"'`
- After adding code: run `python3 .local/tools/french-scanner.py` (or the inline scanner from session) to verify 0 remain

## Catalog locations
- `FP_I18N_EN` at ~L17450: single-quoted keys, add before last entry
- `FP_I18N` at ~L20048: 9 language sections (es/de/it/pt/nl/pl/sv/ro/cs), double-quoted keys
  - Each section ends with `"s+(o.savingsMs...` entry; insert before `"rapport SEO Executive de mai"` anchor
- Scanner runs on `content[:cat_start]` (code only, not catalog)

## Known false-negatives (not wrapped — intentional)
- `+ Ajouter` outer button (starts with `+`, scanner skips non-alpha first char)
- Dynamic data strings inside statCard() second/third arg (not HTML content)
- Strings inside `onclick=` that are JS function args evaluated at click-time (not render-time)
