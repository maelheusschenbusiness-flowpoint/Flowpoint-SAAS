---
name: JS IIFE string apostrophe rule
description: Critical syntax rule for building HTML strings inside JS IIFEs using single-quoted string concatenation
---

## Rule
In dashboard.js IIFEs that concatenate HTML via single-quoted JS strings (`'...' + var + '...'`), any French apostrophe (d', l', c', j', s') breaks JS syntax.

## Symptoms
`node --check` fails with `SyntaxError: Unexpected identifier 'xyz'` where xyz is the word after the apostrophe.

## Fix patterns
```js
// WRONG — breaks single-quoted JS string:
_msgs.push('Chaque heure d'indisponibilité impact...')

// CORRECT — escape with \':
_msgs.push('Chaque heure d\'indisponibilit\u00e9 impact...')

// ALSO WRONG — onclick in single-quoted string:
'<button onclick="navigate('audits')">...'

// CORRECT:
'<button onclick="navigate(\'audits\')">...'
```

## In Python replacement strings (triple-quoted)
- To write `\'` in the JS file: use `\\'` in a Python triple-double-quoted string
- `"""onclick="navigate(\\'audits\\')" """` → file contains `onclick="navigate(\'audits\')"`

## Prevention
Always run `node --check artifacts/flowpoint-export/dashboard.js` after every batch of edits.
Prefer template literals (backticks) or double-quoted strings for HTML builders when building in a template-literal context.

## Why
French text contains many apostrophes. JS single-quoted strings treat `'` as string terminator. This causes silent-looking syntax errors that only appear at runtime or via node --check.
