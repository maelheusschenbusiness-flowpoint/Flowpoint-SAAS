---
name: FlowPoint dashboard.js editing
description: Techniques pour éditer le fichier 31k-lignes dashboard.js correctement
---

# FlowPoint dashboard.js — techniques d'édition

**Règle #1 — Ne jamais éditer sans lire le contexte exact**
- Utiliser `sed -n 'START,ENDp'` pour lire exactement les lignes autour de la cible
- Les `grep -n` donnent un numéro de ligne mais le contenu peut avoir bougé après d'autres édits

**Règle #2 — Validation syntaxe après chaque batch**
- `node --check artifacts/flowpoint-export/dashboard.js 2>&1`
- À faire après chaque modification, jamais grouper sans valider

**Règle #3 — Patterns de données fake**
- `displayStat(liveVal, previewFallback)` → null + PREVIEW_MODE → '—'
- `STATE.xxx ?? (PREVIEW_MODE ? fakeVal : null)` pour computed values
- `PREVIEW_MODE ? [...fakeData] : []` pour arrays complets
- Pour `?? N` avec N > 0 : vérifier que N n'est pas une usage metric (ex: `?? 87` pour usage.audit.used → corriger en `?? 0`)

**Règle #4 — Scan patterns critiques**
```bash
grep -n "Math\.random()" file.js | grep -v "PREVIEW_MODE\|isDemoMode\|sort.*random\|token"
grep -n "?? [1-9][0-9]\+\b" file.js | grep -v "PREVIEW_MODE\|aLimit\|mLimit\|?? 100\b\|?? 999\b"
grep -n "statCard\b" file.js | grep "'[0-9]\+%'\|'[0-9]\+/[0-9]\+'" | grep -v "STATE\.\|displayStat\|PREVIEW_MODE"
```

**Règle #5 — Taille**
- Le fichier fait ~31 000 lignes (après audit complet)
- Utilisez `sed -n 'X,Yp'` avec des offsets précis pour les lectures profondes
- Jamais lire plus de 100 lignes à la fois sauf pour la section entière d'une fonction

**Why:**
File size caused multiple missed contexts and syntax errors when editing without reading first. Incremental fix + validate is the only safe workflow.
