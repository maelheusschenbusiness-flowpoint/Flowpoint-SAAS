---
name: Alert rules enabled vs active field
description: Backend returns enabled (boolean) for alert rules, never active; three dashboard.js locations had the wrong field
---

# Alert rules — enabled vs active

## Rule
Always use `r.enabled` when reading the active/inactive state of an alert rule from `STATE.alertRules`.

**Why:** The backend (`alert-rules.ts`) stores and returns the field as `enabled`. The word `active` does not exist in the schema. Using `r.active` returns `undefined` for every rule, making every derived count zero and every filter return an empty array.

## How to apply
Any expression on `STATE.alertRules` that gates on rule state must use `r.enabled`:
- `STATE.alertRules.filter(r => r.enabled)` — correct
- `STATE.alertRules.some(r => r.type === 'X' && r.enabled)` — correct
- `STATE.alertRules.filter(r => r.active)` — wrong, always empty

## Fixed locations (Wave 2 Lot A)
- `dashboard.js` L3684 — overview score card
- `dashboard.js` L4161 — alertes actives counter in mobile widget
- `dashboard.js` L16074 — review checklist item re5
