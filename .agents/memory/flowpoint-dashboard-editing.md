---
name: FlowPoint dashboard.js editing
description: How to safely edit the 32k-line dashboard.js file
---

The rule: always `sed -n '<start>,<end>p'` to confirm exact context before any edit.

**Why:** dashboard.js is ~32,000+ lines. Guessing context causes non-unique matches or wrong replacements.

**How to apply:**
- Use `grep -n` to find the line number first
- Then `sed -n 'N,Mp'` to read the exact surrounding code
- Use `edit` tool with 5-10 lines of unique context
- For large offsets (>20k) prefer `sed -n` over read tool with offset (less token usage)
- Do NOT batch-fix expression-body arrows (`=> \`...\``) — only block-body arrows need `}` before `).join`
