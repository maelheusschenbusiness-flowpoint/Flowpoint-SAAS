/**
 * signin-extras.js — injected by the server into every signin.html response.
 * Handles two cases that cannot be solved inside the main signin.html bundle:
 *
 * 1. ?deleted=1 redirect: clear all storage and show a deletion confirmation.
 * 2. Pre-redirect cleanup: remove fp:last-route / fp:last-sub so a re-registered
 *    account always lands on the overview page instead of the previous account's
 *    last visited section.  This is belt-and-suspenders: dashboard.js also runs
 *    an org-change check on every load.
 */
(function () {
  var params = new URLSearchParams(window.location.search);

  // ── Case 1: account just deleted ──────────────────────────────────────────
  if (params.get('deleted') === '1') {
    try { sessionStorage.clear(); } catch (_) {}
    try { localStorage.clear(); } catch (_) {}
    window.history.replaceState({}, '', '/signin.html');

    document.addEventListener('DOMContentLoaded', function () {
      var banner = document.createElement('div');
      banner.setAttribute('role', 'status');
      banner.style.cssText = [
        'position:fixed', 'top:24px', 'left:50%', 'transform:translateX(-50%)',
        'z-index:9999', 'background:#166534', 'color:#dcfce7',
        'padding:14px 28px', 'border-radius:10px', 'font-size:13px',
        'font-weight:600', 'box-shadow:0 4px 24px rgba(0,0,0,.45)',
        'max-width:440px', 'text-align:center', 'line-height:1.5',
      ].join(';');
      banner.textContent = '\u2705 Votre compte a \u00e9t\u00e9 supprim\u00e9 d\u00e9finitivement. Toutes vos donn\u00e9es ont \u00e9t\u00e9 effac\u00e9es.';
      document.body.appendChild(banner);
      setTimeout(function () { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 7000);
    });
    return; // do NOT run session-restore for a deleted account
  }

  // ── Case 2: clear stale last-route before session-restore redirect ────────
  // If the user lands on signin.html via a fresh session-restore (e.g. magic
  // link or F5 on an expired session), we clear fp:last-route so that a
  // re-registered account does not restore the old account's page.
  // Dashboard.js also handles this via org-change detection, but acting here
  // means the cleanup happens before the redirect, not after.
  try {
    localStorage.removeItem('fp:last-route');
    localStorage.removeItem('fp:last-sub');
  } catch (_) {}
})();
