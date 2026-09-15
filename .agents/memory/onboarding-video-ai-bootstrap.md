---
name: Onboarding video AI bootstrap
description: Stable browser-recording rule for the FlowPoint AI page and long model response waits.
---

Do not navigate to the AI page until the initial AI-history request has completed. After navigation, require the same textarea node to remain connected, visible, enabled, and pointer-interactive for a stability window before recording the first click.

**Why:** The global bootstrap can restore the previous route after the textarea first appears, detach that node, and make a visually correct click miss. Real AI responses can also take long enough to create an unacceptable recorded loader.

**How to apply:** Register the history-response wait before loading the dashboard, navigate only after it resolves, and validate node identity plus geometry. If the real response wait is too long, condense only that fixed-camera wait segment in post-production while preserving the real send and final response.