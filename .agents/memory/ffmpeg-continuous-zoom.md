---
name: Continuous FFmpeg zooms
description: Continuous onboarding-video zooms need animated scale plus fixed output crop; segment fades create visible black flashes.
---

For dashboard recordings, use one continuous FFmpeg filtergraph with `scale=...:eval=frame` and a fixed-size `crop` to keep the output at 1920×1080. Do not use per-segment black fades to hide zoom transitions.

**Why:** This FFmpeg build does not support `crop:eval=frame`, and segment concatenation with fade-in/out produces an artificial black flash that is visible in onboarding micro-demos.

**How to apply:** Animate zoom using frame-time expressions in `scale`, crop the enlarged frame back to the delivery resolution, and reserve fades for the global intro/outro only.