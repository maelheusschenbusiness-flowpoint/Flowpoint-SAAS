---
name: Python template literal escaping pitfall
description: Writing JS template literals from Python scripts causes silent corruption when using \` or \$ escape sequences
---

# Python → JS template literal escaping pitfall

## The rule
Never write `\`` or `\$` inside Python strings destined for a JS file:
- `\`` in a Python triple-quoted string = backslash + backtick → in JS expression context = **SyntaxError**
- `\${expr}` in a Python string = literal `\$` in file → **blocks template literal interpolation** (outputs `${expr}` as text instead of evaluating it)

**Why:** Python has no escape for backtick (`\`` = backslash + backtick literally). JS template literals only allow `\`` inside an already-open template literal to escape it as a literal character — not in regular expression context.

## How to apply
When Python needs to write JS with template literals and dynamic interpolation, use one of:

**Option A: String concatenation (safest)**
```python
lines[i] = ("'Static text '+dynamicVar+' more text',\n")
```

**Option B: Line-level replacement** (find exact line, replace entirely)
```python
idx = content.find("unique marker"); ls = content.rfind('\n', 0, idx)+1; le = content.find('\n', idx)
content = content[:ls] + correct_line + content[le:]
```

**Option C: Use actual backtick characters** (when writing nested template literals in expression context)
```python
good_line = '        : `<button onclick="${expr}">text</button>`'
```
Note: in Python, a backtick is just a backtick — no escaping needed. `\$` is wrong; just write `$`.

## Correct pattern for nested template literals
Inside `${aiBlock(...)}` which is inside outer template literal:
```python
# WRONG (Python writes \` and \$ to file):
new = """`My text with \${variable} here\`,"""

# CORRECT (Python writes ` and $ to file):
new = """`My text with ${variable} here`,"""
```

## Always run after
```bash
node --check artifacts/flowpoint-export/dashboard.js
```
