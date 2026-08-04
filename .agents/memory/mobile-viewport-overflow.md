---
name: Mobile viewport overflow / iOS zoom-out debugging
description: How invisible boxes stretch the mobile layout viewport (iOS shrink-to-fit) and how to find them
---

# Mobile viewport overflow (iOS page appears zoomed-out / shrunk)

When a page renders at ~60% scale on iOS (or Chromium `isMobile:true` reports `innerWidth` > the device width), something demands more layout width than the viewport. Known FlowPoint causes, all fixed once:

1. **Visually-hidden checkbox escaping a scroll container.** `.fp-toggle-wrap input { position:absolute; opacity:0 }` with a NON-positioned label: the checkbox's containing block is outside `.fp-table-wrap`, so it escapes the wrap's `overflow-x:auto` clip and stretches `documentElement.scrollWidth`. Fix: `position:relative` on the label wrapper. **Rule:** any visually-hidden absolute input needs a positioned parent.
2. **Fixed bars anchored at `left: var(--fp-sidebar-w)`.** On mobile the sidebar is off-canvas, but a fixed bar with `left:248px` + non-wrapping content contributes `248 + min-content` to the shrink-to-fit width. Fix: media ≤768px `left:0 !important; flex-wrap:wrap`.
3. **Off-canvas sidebar without explicit width.** `left:-260px` with auto width lets the sidebar bleed onto screen (left-edge sliver bar). Fix: explicit `width: var(--fp-sidebar-w)` + `left: calc(-1 * var(--fp-sidebar-w) - 24px)` cushion for border/shadow.

**How to debug:** Chromium at 390px with `isMobile:false` keeps `innerWidth=390` so offenders are findable; then brute-force by hiding subtrees (`el.style.display='none'`) and watching `documentElement.scrollWidth` drop — getBoundingClientRect scans miss escaped absolute boxes because DOM-ancestor overflow walks over-approximate clipping (clipping only applies from *containing-block* ancestors). `body.scrollWidth` normal but `html.scrollWidth` inflated ⇒ suspect fixed/absolute escapees.
