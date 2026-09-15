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
      // A magic link is a fresh account boundary. Never carry a previous
      // account's destination into this new session: it can reopen an unrelated
      // page (for example the Alert Command Center) after account recreation.
      sessionStorage.clear();
    } catch (e) { /* non-fatal */ }
  }

  function readPendingCheckout() {
    try {
      var pending = JSON.parse(localStorage.getItem('flowpoint_pending_checkout') || 'null');
      var valid = pending && pending.exp > Date.now() && pending.cart &&
        pending.cart._v === 1 && pending.cart.addons && typeof pending.cart.addons === 'object';
      return valid ? pending : null;
    } catch (e) { return ''; }
  }

  var token = getParam('token');

  if (!token) {
    document.getElementById('fp-error-msg').textContent = 'Aucun token trouvé dans l\'URL.';
    show('fp-error');
    return;
  }

  var pendingCheckout = readPendingCheckout();
  var pendingCheckoutNext = pendingCheckout
    ? (pendingCheckout.next === '/checkout-payment.html' ? pendingCheckout.next : '/checkout.html')
    : '';
  // Purge cache immediately — before calling the API — so the dashboard
  // cannot read stale localStorage from a previously logged-in user.
  purgeUserCache();
  /* Restore only the short-lived, validated checkout intent after the account
     boundary has been purged. It contains a plan/add-on selection, never user
     credentials or billing data. */
  if (pendingCheckout) {
    try {
      localStorage.setItem('fp_cart', JSON.stringify(pendingCheckout.cart));
      if (pendingCheckout.sellerRef) localStorage.setItem('fp_seller_ref', pendingCheckout.sellerRef);
      localStorage.removeItem('flowpoint_pending_checkout');
    } catch (e) {}
  }

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
          // PRIMARY AUTH: HttpOnly cookie (set by server, sent automatically via credentials:'include').
          // sessionStorage token is a per-tab override only for multi-user UAT testing
          // (each tab keeps its own token; tabs don't share sessionStorage).
          // localStorage tokens are intentionally NOT written — sharing across tabs is
          // the root cause of cross-user contamination, and the cookie already covers
          // all normal single-user sessions.
          sessionStorage.setItem('fp_session_token', r.data.token);
          var tabUid = Math.random().toString(36).slice(2);
          sessionStorage.setItem('fp_tab_uid', tabUid);
          // Purge any legacy localStorage token so the old fallback path is dead
          localStorage.removeItem('fp_token');
          localStorage.removeItem('token');
          // Mark that this browser has ever had a session so login.html's
          // auth-boot knows to probe for a live cookie on subsequent visits.
          try { localStorage.setItem('fp_had_session', '1'); } catch(_) {}
        }
      } catch(e) { /* non-fatal */ }
      show('fp-success');
      setTimeout(function () {
        var next = pendingCheckoutNext || '/dashboard.html';
        // Cache-bust to prevent browser serving stale dashboard from disk cache
        var sep = next.indexOf('?') === -1 ? '?' : '&';
        window.location.replace(next + sep + '_cb=' + Date.now());
      }, 1200);
    } else {
      // Show the server's error message (French prose).
      // Fall back to a generic message only when the server returned no body.
      var serverMsg = (r.data && r.data.error) ? r.data.error : 'Lien invalide ou expiré.';
      var canRetry  = !!(r.data && r.data.canRetry);
      document.getElementById('fp-error-msg').textContent = serverMsg;

      // Show the "Request new link" button for retryable errors (expired / already_used / not_found).
      // This lets the user self-serve without contacting support.
      if (canRetry) {
        var retryBtn = document.getElementById('fp-retry-btn');
        if (retryBtn) {
          retryBtn.style.display = 'inline-block';
          retryBtn.addEventListener('click', function () {
            window.location.href = '/login.html';
          });
        }
      }

      show('fp-error');
    }
  })
  .catch(function () {
    document.getElementById('fp-error-msg').textContent = 'Impossible de contacter le serveur. Réessayez.';
    show('fp-error');
  });
})();
