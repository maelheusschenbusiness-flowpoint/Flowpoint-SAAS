
**Lesson (2026-08-04):** full-screen loading overlays must be gated on actual route change, never on every render — background data polls re-render the same route and an unconditional overlay produces a grey flash/vibration. Also preserve scroll position on same-route re-renders.
