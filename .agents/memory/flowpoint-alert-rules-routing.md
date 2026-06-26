---
name: FlowPoint alert rules routing
description: Two different alert components — wrong navigation = broken test
---

# Alert Rules vs Alerts Center — Two Different Components

## The two components
1. `renderAlertRules()` — line 7492 — CRUD management (list, create, edit, delete rules)
   - Route: `navigate('settings')` then `navigateSub('alerts')`
   - Has the "+ Nouvelle règle" button with inline onclick
   - This is where BUG6 was fixed (addEventListener → inline onclick)

2. `renderAlertsCenter()` — line 19651 — Command Center (alert feed, threat intelligence)
   - Route: `navigate('alerts-center')`
   - Has plan gates (blurred content for lower plans)
   - Has "Config alertes" button that redirects to renderAlertRules via navigate('settings')

**Why:** These serve different purposes. Playwright tests MUST navigate to settings+alerts
for rule CRUD. The alerts-center is a read-only dashboard, not the management page.

**How to apply:** Any test of "create alert rule" must use:
  `navigate('settings'); navigateSub('alerts');`
NOT `navigate('alerts-center');`
