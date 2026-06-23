---
name: renderAI scope variables fix
description: domScore et _aiScore utilisés sans définition dans renderAI() intelligence block — pattern de fix
---

## Règle

Dans `renderAI()` → bloc `if (sub === 'intelligence')`, deux variables étaient référencées sans être définies dans ce scope :

- `domScore` — défini uniquement dans `renderLocalSEO()` (L5707)
- `_aiScore` — jamais défini nulle part dans `renderAI()`

Ceci causait des `ReferenceError` sur la page Workspace Intelligence.

**Fix appliqué :**
```js
if (sub === 'intelligence') {
  const domScore = STATE.localSeo?.domScore ?? null;
  const _aiScore = STATE.overview?.avgScore ?? (
    (STATE.audits||[]).length > 0
      ? Math.round((STATE.audits||[]).reduce((s,a)=>s+(a.score||0),0)/(STATE.audits||[]).length)
      : null
  );
  const _mkSysScore = ...
```

**Why:** Les fonctions `render*()` dans dashboard.js partagent des noms de variables similaires (`domScore`, `_aiScore`, `_gscClicks`) mais chaque fonction a son propre scope. Ne pas supposer qu'une variable définie dans `renderLocalSEO()` est disponible dans `renderAI()`.

**How to apply:** Avant tout usage d'une variable dans une fonction render*, grep pour confirmer qu'elle est définie dans CE scope. Si elle vient d'un autre render*, créer une version locale depuis `STATE.*`.
