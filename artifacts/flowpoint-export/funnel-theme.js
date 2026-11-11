/*
 * FlowPoint signup funnel — shared light/dark theme.
 *
 * Rules (same as the dashboard): an explicit user choice stored in `fp:theme`
 * (legacy key `fp-theme`) always wins; otherwise the theme follows the system
 * `prefers-color-scheme` and updates live when the system theme changes.
 *
 * Each funnel page also inlines FP_THEME_BOOT (the first statement below,
 * copied verbatim in <head>) so the right theme is set before first paint:
 * no flash of the wrong theme.
 */
(function () {
  'use strict';
  var META_COLORS = { light: '#f8fafc', dark: '#0b1120' };

  function manualChoice() {
    try {
      var t = localStorage.getItem('fp:theme') || localStorage.getItem('fp-theme');
      return t === 'light' || t === 'dark' ? t : null;
    } catch (e) { return null; }
  }
  function systemTheme() {
    try { return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
    catch (e) { return 'dark'; }
  }
  function apply(theme) {
    var root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    var meta = document.getElementById('fp-meta-tc') || document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', META_COLORS[theme]);
  }

  apply(manualChoice() || systemTheme());

  try {
    var mq = window.matchMedia('(prefers-color-scheme: light)');
    var onChange = function () { if (!manualChoice()) apply(systemTheme()); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  } catch (e) { /* matchMedia unavailable: keep the initial theme */ }

  // A choice made in another tab (e.g. the dashboard toggle) applies here too.
  window.addEventListener('storage', function (e) {
    if (e.key === 'fp:theme' || e.key === 'fp-theme') apply(manualChoice() || systemTheme());
  });

  window.FPFunnelTheme = { apply: apply, current: function () { return document.documentElement.getAttribute('data-theme'); } };
})();
