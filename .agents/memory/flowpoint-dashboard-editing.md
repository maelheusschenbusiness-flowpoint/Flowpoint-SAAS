---
name: FlowPoint dashboard.js editing
description: Tips for editing the 29k-line dashboard.js safely
---

## Rule
Use `sed -n 'X,Yp'` for large line offsets. Always get exact surrounding context (5-10 lines) before any edit. Never batch-fix expression-body arrow functions (`=> \`...\``).

**Why:** File is 29k+ lines; reading wrong offset causes wrong edits.

**How to apply:** Before any edit, grep for the unique string and verify line number. Read ±5 lines before applying the change.

## onclick in template literals — safe patterns

- **Problem:** `onclick="...'${varName}'..."` — varName with double-quotes inside HTML attr breaks parsing.
- **Solution A:** `data-x="${escHtml(varName)}" onclick="...this.dataset.x..."` — safest.
- **Solution B:** `${JSON.stringify(varName)}` inside template lit — works when onclick uses single-quote outer HTML attr delimiters... but avoid if varName contains double quotes.
- **Problem 2:** `onclick="_fpMQ(q.title||..."` — `q` is loop variable, undefined at click time.
- **Solution:** Always serialize loop-scope vars at render time: `${JSON.stringify(q.title||'default')}` for non-double-quote-containing strings, or data attribute otherwise.

## Backtick count
As of session 3 end: 2875 (node --check passes = valid JS even though odd count; escaped backticks or regex can cause odd counts).

## Piège \' dans template literal
Dans un template literal JS, `\'` produit simplement `'` dans la sortie — donc écrire `d\'abord` dans un onclick généré casse la chaîne JS de l'attribut. **Solution :** reformuler sans apostrophe (ex. « enregistrez le webhook » au lieu de « d'abord »).

## Sélecteurs d'inputs sans attribut type
`querySelector('input[type=text]')` ne matche PAS un `<input>` sans attribut type explicite (sélecteur d'attribut, pas de propriété). Utiliser `input.fp-input` ou `btn.parentElement.parentElement.querySelector(...)` selon la structure.
