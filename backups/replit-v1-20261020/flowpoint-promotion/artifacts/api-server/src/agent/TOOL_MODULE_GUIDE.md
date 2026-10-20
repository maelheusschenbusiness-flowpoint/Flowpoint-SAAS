# Guide — Modules d'outils IA (Universal AI Engine)

> **Source de vérité pour toutes les futures phases AI Agents.**
> Phases déjà livrées : Missions (Phase 2) · Calendrier (Phase 3.1)
> Phases planifiées  : Audits · Monitors · Reports · Keywords · Local SEO · Reviews ·
> Google Business Profile · Search Console · Google Analytics · Competitors ·
> Integrations · Automations · Settings

---

## 1. Architecture générale

```
┌─────────────────────────────────────────────────────────────────┐
│                         /api/ai/chat                             │
│                                                                 │
│   buildFlowpointContext() ──► système enrichi (données réelles) │
│   ALL_TOOLS (array merged) ─► provider (OpenAI / Anthropic / Gemini) │
│   ALL_TOOLS_MAP (Map<name,ToolDef>) ─► dispatch serveur        │
│                                                                 │
│   ToolExecutor (tool-executor.ts)                               │
│     ├── switch(call.name) pour chaque module                    │
│     ├── logActionLog() pour chaque exécution                    │
│     └── store.logActivity() pour chaque action réussie         │
│                                                                 │
│   Undo (undo.ts)  ─► atomic SQL / snapshot per tool            │
└─────────────────────────────────────────────────────────────────┘
```

Aucun module n'a de logique propre d'accès provider.
Chaque module fournit uniquement : **définitions d'outils + dispatch + undo**.

---

## 2. Interface TypeScript d'un module

```typescript
// Fichier : src/agent/<module>-tools.ts
import type { ToolDef } from "./mission-tools.js";

// ── 1. Définitions des outils ─────────────────────────────────────────────
export const MY_MODULE_TOOLS: ToolDef[] = [
  {
    name: "my_tool_action",          // snake_case unique dans tout le registre
    description: "...",              // Phrase claire, sans jargon technique
    confirmationLevel: "preview",    // "none" | "preview" | "full"
    parameters: {
      type: "object",
      properties: {
        id:    { type: "string",  description: "ID exact de l'entité" },
        title: { type: "string",  description: "Nouveau titre" },
        // ...
      },
      required: ["id"],
    },
  },
];

// ── 2. Map de lookup ───────────────────────────────────────────────────────
export const MY_MODULE_TOOL_BY_NAME = new Map(
  MY_MODULE_TOOLS.map(t => [t.name, t])
);

// ── 3. Schémas Zod (validation runtime des args) ─────────────────────────
import { z } from "zod";
export const MY_MODULE_ARG_SCHEMAS: Record<string, z.ZodTypeAny> = {
  my_tool_action: z.object({
    id: z.string(),
    // ...
  }),
};
```

---

## 3. Niveaux de confirmation (`confirmationLevel`)

| Niveau    | Usage                               | Comportement UI              |
|-----------|-------------------------------------|------------------------------|
| `"none"`  | Lecture seule (search, get)         | Exécution auto, pas de popup |
| `"preview"` | Écriture réversible (create/update/move) | Popup « Confirmer »      |
| `"full"`  | Suppression, action critique        | Popup avec avertissement rouge |

**Règle :** toute action qui modifie ou supprime des données doit avoir `"preview"` au minimum.

---

## 4. Intégration dans le moteur (`tool-executor.ts`)

### 4.1 Importer le module

```typescript
// Dans tool-executor.ts, section imports
import {
  MY_MODULE_TOOL_BY_NAME,
  MY_MODULE_ARG_SCHEMAS,
} from "./my-module-tools.js";
```

### 4.2 Fusionner dans TOOL_BY_NAME

```typescript
// Fusion des maps de tous les modules (order matters for override)
export const TOOL_BY_NAME = new Map([
  ...Array.from(_MISSION_TOOL_BY_NAME.entries()),
  ...Array.from(CALENDAR_TOOL_BY_NAME.entries()),
  ...Array.from(MY_MODULE_TOOL_BY_NAME.entries()),   // ← ajouter ici
]);
```

### 4.3 Ajouter le dispatch

```typescript
// Dans executeTool() — section switch(call.name)
case "my_tool_action": {
  const args = parseArgs(MY_MODULE_ARG_SCHEMAS["my_tool_action"], call.arguments);
  if(!args.ok) return errResult(logId, call, args.error);

  // Permission check (FAIL-CLOSED)
  if(!ctx.effectivePerms.includes("my_module.write")) {
    return permDenied(logId, call);
  }

  const t0 = Date.now();
  // ... exécution SQL ...
  const versionAfter = row?.updated_at?.toISOString() ?? null;

  await logActionLog({ id: logId, ...ctx, tool: call.name, args: call.arguments,
    confirmationLevel: "preview", result: "ok",
    snapshot: { /* données avant modification pour undo */ },
    versionAfter,
  });
  await store.logActivity({ orgId: ctx.orgId, userId: ctx.userId,
    type: "calendar.create",   // ← adapter au module
    description: `Outil "${call.name}" exécuté`,
  });

  return {
    toolCallId: call.id, toolName: call.name, ok: true,
    content: "Action réussie.",
    data: { /* données retournées à l'IA */ },
    actionLogId: logId,
    undoLabel: "Annuler l'action",
    navProposal: buildNavProposal(/* destinations pertinentes */, ctx.effectivePerms, ctx.orgPlan),
  };
}
```

---

## 5. Intégration dans `ai.ts` (ALL_TOOLS)

```typescript
// Dans routes/ai.ts
import { MY_MODULE_TOOLS } from "../agent/my-module-tools.js";

const ALL_TOOLS = [
  ...MISSION_TOOLS,
  ...CALENDAR_TOOLS,
  ...MY_MODULE_TOOLS,   // ← ajouter ici
];

// ALL_TOOLS_MAP se reconstruit automatiquement depuis ALL_TOOLS
const ALL_TOOLS_MAP = new Map(ALL_TOOLS.map((t) => [t.name, t]));
```

---

## 6. Permissions

### 6.1 Ajouter au catalogue (`permissions.ts`)

```typescript
// Dans PERMISSION_CATALOGUE
"my_module.read":   { description: "Lecture du module", roles: ["owner","admin","member","service"] },
"my_module.write":  { description: "Écriture du module", roles: ["owner","admin","member","service"] },
"my_module.delete": { description: "Suppression",        roles: ["owner","admin","service"] },
```

### 6.2 Ajouter aux bundles de rôle

```typescript
// ROLE_BUNDLES["member"].push("my_module.read", "my_module.write");
// ROLE_BUNDLES["admin"].push("my_module.delete");
```

### 6.3 Règle FAIL-CLOSED

```typescript
if (!ctx.effectivePerms.includes("my_module.write")) {
  return { ok: false, content: "Permission refusée.", ... };
}
```
Ne jamais supposer une permission — toujours vérifier explicitement.

---

## 7. Undo (`undo.ts`)

### 7.1 Snapshot avant modification

Capturer l'état complet de l'entité **avant** la modification dans `snapshot` de `logActionLog`.
Ce snapshot sera utilisé pour restaurer l'état en cas d'annulation.

### 7.2 Locking atomique (version anchor)

```sql
-- Pattern pour l'undo d'une mise à jour :
UPDATE my_table
SET col1 = $2, col2 = $3,
    updated_at = $4  -- version_before restaurée
WHERE id = $1
  AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $5::timestamptz)
```

Le champ `$5` est `version_after` stocké dans `ai_action_logs` au moment de la confirmation.
Si l'entité a été modifiée entre-temps, le `WHERE` ne matche pas → undo renvoie `UNDO_VERSION_UNAVAILABLE` (HTTP 409).

### 7.3 Cases dans `undo.ts`

```typescript
case "my_tool_create": {
  // Undo d'une création = suppression
  await pool.query(`DELETE FROM my_table WHERE id=$1 AND org_id=$2`, [snap.id, log.org_id]);
  return { ok: true, content: "Création annulée." };
}
case "my_tool_delete": {
  // Undo d'une suppression = restauration depuis snapshot
  await pool.query(
    `INSERT INTO my_table(...) VALUES(...) ON CONFLICT(id) DO NOTHING`,
    [snap.id, snap.org_id, ...]
  );
  return { ok: true, content: "Suppression annulée." };
}
case "my_tool_update": {
  // Undo d'une mise à jour = restauration atomique
  const r = await pool.query(
    `UPDATE my_table SET ... WHERE id=$1 AND org_id=$2
     AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $3::timestamptz)`,
    [snap.id, log.org_id, log.version_after]
  );
  if(r.rowCount === 0) return { ok: false, code: "UNDO_VERSION_UNAVAILABLE", ... };
  return { ok: true, content: "Modification annulée." };
}
```

---

## 8. Destinations de navigation (`destinations.json`)

Ajouter les destinations du module dans `src/agent/destinations.json` :

```json
{
  "id": "my-module-list",
  "route": "my-module",
  "sub": null,
  "labels": ["mon module", "liste"],
  "description": "Vue principale du module",
  "requiredPermission": "my_module.read",
  "openModes": ["page"],
  "anchors": [],
  "planGate": null,
  "prefill": null
}
```

**Règle :** toute destination créée par heuristique est interdite.
Seules les destinations du registre peuvent apparaître dans `action_proposal`.

---

## 9. Contexte IA (`buildFlowpointContext`)

Ajouter un bloc de contexte dans `buildFlowpointContext` (routes/ai.ts) :

```typescript
// === MON MODULE — Phase X : contexte ===
try {
  const rows = await pool.query(
    `SELECT id, name, status FROM my_table WHERE org_id=$1 LIMIT 10`,
    [oid]
  ).catch(() => ({ rows: [] }));
  lines.push(
    `=== MON MODULE ===`,
    rows.rows.length > 0
      ? rows.rows.map(r => `- "${r.name}" (${r.status})`).join("\n")
      : "Aucun élément"
  );
} catch { /* non-fatal */ }
```

---

## 10. Checklist d'implémentation

- [ ] `src/agent/<module>-tools.ts` — ToolDef[], Map, ArgSchemas
- [ ] `src/agent/tool-executor.ts` — merge Map, cases switch
- [ ] `src/routes/ai.ts` — merge ALL_TOOLS + ALL_TOOLS_MAP
- [ ] `src/agent/permissions.ts` — catalogue + bundles
- [ ] `src/agent/undo.ts` — cases par outil
- [ ] `src/agent/destinations.json` — entrées du registre
- [ ] `src/routes/ai.ts::buildFlowpointContext` — bloc contexte
- [ ] `src/services/init-*.ts` — self-heal schema si nouvelle table
- [ ] Tests : `qa_phase<N>_certification.cjs` (structure) + `qa_e2e_provider.cjs` ou équivalent
- [ ] Commit : `feat(ai-agents): Phase X — <module> tools`

---

## 11. Modules planifiés — Correspondance

| Module         | Outils pressentis                                           | Phase |
|----------------|-------------------------------------------------------------|-------|
| Audits         | `run_audit`, `get_audit_result`, `compare_audits`           | 3.2   |
| Monitors       | `get_monitor_status`, `pause_monitor`, `create_monitor`     | 3.3   |
| Keywords       | `search_keywords`, `add_keyword`, `remove_keyword`          | 3.4   |
| Reports        | `get_report`, `generate_report`                             | 3.5   |
| Local SEO / GBP| `get_gbp_profile`, `post_gbp_update`, `reply_review`        | 3.6   |
| Analytics      | `get_ga4_summary`, `get_gsc_performance`                    | 3.7   |
| Competitors    | `analyze_competitor`, `compare_competitors`                 | 3.8   |
| Automations    | `list_automations`, `trigger_automation`                    | 3.9   |
| Settings       | (lecture seule — aucune mutation via IA)                    | —     |

---

## 12. Invariants absolus (jamais violer)

1. **FAIL-CLOSED** : un outil sans permission explicite retourne 403 (jamais 200).
2. **Pas de mutation sans confirmation** : `confirmationLevel` ≥ `preview` pour tout outil write.
3. **Journalisation obligatoire** : `logActionLog` + `store.logActivity` sur toute exécution.
4. **Snapshot avant modification** pour tout outil undoable.
5. **Destinations registre uniquement** : jamais de destination générée par heuristique.
6. **ALL_TOOLS_MAP rebuildt depuis ALL_TOOLS** : ne jamais utiliser la map d'un seul module pour le dispatch dans `ai.ts`.
7. **Test de non-régression** : toute nouvelle phase doit faire passer les suites des phases précédentes.
