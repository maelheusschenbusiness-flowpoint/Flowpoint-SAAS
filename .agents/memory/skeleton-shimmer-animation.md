---
name: Skeleton shimmer animation pattern
description: How the skeleton shimmer keyframes are structured and why they must use background-position not opacity
---

## Rule

Shimmer skeleton elements (`.fp-skel-shimmer`, `.fp-skel-block::after`, `.fp-pre-skel`) must use the `fpSlide` keyframe (background-position 200%→-200%), NOT the `fpSkeleton` opacity keyframe.

The `fpSkeleton` keyframe only animates opacity. Combined with `background-size: 200% 100%` it creates a "gradient visible/hidden" flicker, not a left-to-right sweep. At 1.6s linear, multiple elements phase-drift and create visual vibration.

**Correct pattern:**
```css
@keyframes fpSlide {
  0%   { background-position: 200% center; }
  100% { background-position: -200% center; }
}
.fp-skel-shimmer {
  background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.11) 50%, rgba(255,255,255,0.04) 75%);
  background-size: 200% 100%;
  animation: fpSlide 2.2s ease-in-out infinite;
}
```

**Why:** 2.2s ease-in-out on a single background-position sweep gives a calm, phase-coherent visual. Elements started at different times look coordinated because the easing is symmetrical.

**How to apply:** If adding a new skeleton block, use `fp-skel-shimmer` inside a `position:relative; overflow:hidden` parent. Never use `fpSkeleton` (opacity keyframe) on gradient-shimmer backgrounds.
