---
name: dashboard.js map callback syntax errors
description: How to correctly identify and fix missing `}` in .map() block-body callbacks without over-correcting expression-body arrows
---

# Rule
Only add `}` before `).join` when the `.map()` callback uses an **explicit block body** (`=> {`). Expression-body arrows (`=> \`...\``) must NOT get a `}`.

**Why:** dashboard.js uses both styles. A batch grep/replace on `` `).join `` will hit both patterns and over-correct expression-body arrows, breaking syntax.

**How to apply:**
1. Run `node --check` to get the exact error line.
2. Read ~20 lines of context ABOVE the error line to find the `.map(` opener.
3. If the opener ends with `=> {` (block body), add `}` before `).join` on the error line.
4. If the opener ends with `=> \`` (expression body), the error is elsewhere — don't touch the `).join`.
5. Never use a bulk/batch script to convert `` `).join `` → `` `}).join `` without verifying each one has `=> {` and a `return` statement in the body.

**Confirmed real errors (block body, correctly fixed):**
- Line ~22118: `.map(({ m, up, ok, downMin }) => {` ... `return \`...\`` — needed `}`
- Line ~22250: same pattern with `monitors.slice(0,3).map((mon, ji) => {` — needed `}`
