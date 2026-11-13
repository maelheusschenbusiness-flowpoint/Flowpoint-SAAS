---
name: A/B exposure ordering
description: Correct event ordering for behavioral A/B experiment conversion tracking.
---

An A/B conversion event must only be sent after the corresponding exposure has been accepted by the event endpoint. Keep the goal click listener active while exposure persistence is pending, then report the conversion only if the exposure request succeeds.

**Why:** the server rejects conversions without an existing exposure for the same session, experiment, site, and variant; fire-and-forget exposure requests can race with fast user clicks.

**How to apply:** when changing the behavioral site snippet or event pipeline, preserve exposure-before-conversion ordering and fail closed if exposure persistence fails.
