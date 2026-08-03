---
name: FlowPoint i18n source-restore rule
description: Why dashboard translations must always start from the canonical French source
---

# FlowPoint i18n — source-restore rule

**Rule:** translations must always be computed from the canonical French source string, never from
already-translated text, and switching language must actively RESTORE untranslated/French nodes.
The translation engine must also run once as soon as it is defined — the first render can happen
before the engine exists, so a persisted EN/ES preference would otherwise show French on cold load.

**Why:** persistent DOM (sidebar, top bar) is not rebuilt on re-render. An engine that mutates text
in place and skips the French pass leaves residue from the previous language (the « Informes » bug:
Spanish labels stuck in the French UI after FR→ES→FR).

**How to apply:** when adding catalog entries, key on the exact trimmed French string and keep
EN/ES key parity; never early-return for `fr`; surfaces injected outside the main render (float
panels, side panels) need their own translation pass after innerHTML injection.
