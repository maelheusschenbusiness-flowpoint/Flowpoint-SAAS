---
name: OXC tsconfig composite references fix
description: rolldown/OXC fails when tsconfig.json has composite+references pointing to packages with no tsconfig.json; fix is src/tsconfig.json
---

## Rule
When `tsconfig.json` has `composite: true` (inherited from base) and `references` pointing to packages (`lib/db`, `lib/api-zod`) that have **no `tsconfig.json`** of their own, rolldown/OXC fails at transform with:
```
[TSCONFIG_ERROR] Failed to load tsconfig for 'src/...': Tsconfig not found
```

## Fix
Create `src/tsconfig.json` as a standalone tsconfig (no `extends`, no `references`) so OXC finds it first when walking up from files in `src/`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["."]
}
```

**Why:** OXC/rolldown discovers tsconfig by walking up from the file being transformed. It finds `tsconfig.json` at root, which has `references` to `lib/db` and `lib/api-zod`, neither of which has a `tsconfig.json`. OXC cannot resolve the references and reports "Tsconfig not found". A local `src/tsconfig.json` is found first — no references, no problem.

**How to apply:** Whenever api-server tests fail with `[TSCONFIG_ERROR] Failed to load tsconfig for 'src/...': Tsconfig not found`, check that `src/tsconfig.json` exists. The root `tsconfig.json` must keep `composite+references` for the tsc project build; only the test transform path needs the standalone fallback.

## Related
- `oxc.tsconfigFile` vite config option does NOT work in vite 8.1.5 (option silently ignored)
- `typecheck.tsconfig` in vitest only affects typecheck mode, not the transform path
- The `tsconfig.vitest.json` at the root can be used as a reference but OXC ignores it unless discovered via file-system walk
