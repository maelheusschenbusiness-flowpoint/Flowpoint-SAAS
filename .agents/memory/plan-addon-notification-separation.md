---
name: Plan vs add-on notification separation
description: Plan upgrades provision included add-ons through the same activation path, so frontend notifications need a typed action marker.
---

Plan changes can call the add-on provisioning path for bundled entitlements. Treat those technical add-on events as part of the active `plan_change` action: keep the data refresh, suppress the add-on toast, and show one message naming the target plan. Genuine add-on purchases must keep their existing toast.

**Why:** Reusing the add-on activation event for included plan features previously displayed “Add-on activé” after a plan switch and could produce duplicate or misleading notifications.

**How to apply:** Set an explicit short-lived plan-change action marker in every plan entry point, use it to deduplicate SSE plan events and bundled add-on events, and clear it on failure before handling later add-on actions.