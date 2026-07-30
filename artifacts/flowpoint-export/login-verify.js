(function () {
  'use strict';

  function show(id) {
    ['fp-loading', 'fp-success', 'fp-error'].forEach(function (s) {
      document.getElementById(s).style.display = s === id ? 'block' : 'none';
    });
  }

  function getParam(name) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  // SECURITY (P0): Purge ALL cached user state before validating a new magic link.
  // Prevents cross-user data leakage when the same browser switches between accounts.
  function purgeUserCache() {
    try {
      var keysToRemove = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && (k.startsWith('fp-') || k.startsWith('fp_') || k.startsWith('fp:'))) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* non-fatal */ }
    try {
      var _next = sessionStorage.getItem('fp_next') || null;
      sessionStorage.clear();
      if (_next && _next.startsWith('/')) sessionStorage.setItem('fp_next', _next);
    } catch (e) { /* non-fatal */ }
  }

  var token = getParam('token');

  if (!token) {
    document.getElementById('fp-error-msg').textContent = 'Aucun token trouvé dans l\'URL.';
    show('fp-error');
    return;
  }

  // Purge cache immediately — before calling the API — so the dashboard
  // cannot read stale localStorage from a previously logged-in user.
  purgeUserCache();

  // POST — not GET — so that email-scanner prefetch (SafeLinks, Barracuda, etc.)
  // cannot consume the single-use token when they pre-crawl the login-verify.html URL.
  fetch('/api/auth/login-verify', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token }),
  })
  .then(function (res) {
    return res.json().then(function (data) { return { ok: res.ok, data: data }; });
  })
  .then(function (r) {
    if (r.ok && r.data.ok) {
      // Store session token in sessionStorage (per-tab) so each browser tab
      // keeps its OWN session — prevents cross-user contamination when two
      // accounts are open simultaneously in the same browser.
      try {
        if (r.data.token) {
          sessionStorage.setItem('fp_session_token', r.data.token);
          // Also keep in localStorage for legacy fallback paths (SSE, maps, etc.)
          // but mark it with a tab-uid so stale tabs detect the mismatch.
          var tabUid = Math.random().toString(36).slice(2);
          sessionStorage.setItem('fp_tab_uid', tabUid);
          localStorage.setItem('fp_token', r.data.token);
          localStorage.setItem('fp_tab_uid', tabUid);
        }
      } catch(e) { /* non-fatal */ }
      show('fp-success');
      setTimeout(function () {
        var next = '/api/dashboard/';
        try {
          var stored = sessionStorage.getItem('fp_next');
          if (stored && stored.startsWith('/')) {
            next = stored;
            sessionStorage.removeItem('fp_next');
          }
        } catch(e) {}
        // Cache-bust to prevent browser serving stale dashboard from disk cache
        var sep = next.indexOf('?') === -1 ? '?' : '&';
        window.location.replace(next + sep + '_cb=' + Date.now());
      }, 1200);
    } else {
      var msg = (r.data && r.data.error) ? r.data.error : 'Lien invalide ou expiré.';
      document.getElementById('fp-error-msg').textContent = msg;
      show('fp-error');
    }
  })
  .catch(function () {
    document.getElementById('fp-error-msg').textContent = 'Impossible de contacter le serveur. Réessayez.';
    show('fp-error');
  });
})();
