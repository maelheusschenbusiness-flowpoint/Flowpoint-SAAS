---
name: dashboard.js script-tag-in-innerHTML pitfall
description: <script> tags placed via innerHTML never execute; all window.* functions must be exposed in the IIFE init block
---

## Rule
`<script>` tags inside HTML strings set via `element.innerHTML = renderXxx()` **are never executed** by browsers (XSS protection). Any `window._fn = function(){}` written inside such script tags is dead code.

## How to apply
Define ALL window-exposed functions in the IIFE initialization block (lines ~13280-13330), NOT inside `<script>` tags within render functions. Pattern:

```javascript
// In the window exposure block near line 13280:
window._showAddKeyword = function() {
  const m = document.getElementById('fp-kw-modal');
  if (m) m.style.display = 'flex';
};
window._showCreateHeatmapModal = function() {
  const m = document.getElementById('fp-heatmap-modal');
  if (m) m.style.display = 'flex';
};
```

The `<script>` tags in `renderKeywords()` and `renderLocalDominationMaps()` still exist but are inert — the real definitions are in the IIFE init block.

## Why
Browser security: innerHTML parsing skips script execution. This caused `window._showAddKeyword` and `window._showCreateHeatmapModal` to never be registered, making both modals non-functional.

## Onclick nested-quote bug (Competitors)
Inline onclick with backtick template containing `\"escaped\"` double-quotes breaks the HTML attribute:
```html
onclick="openFloatPanel('title',`...<input id="broken" ...`)"
```
The `"broken"` terminates the onclick attribute early → `Unexpected end of input` JS error.
**Fix**: Extract to a named `window.FP_showXxx()` function in the init block with plain string concatenation (no nested quotes).
