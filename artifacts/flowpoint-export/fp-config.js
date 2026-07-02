/**
 * FLOWPOINT — Configuration Backend
 * ═══════════════════════════════════
 * Ce fichier centralise TOUTE la configuration de connexion backend.
 * Pour changer d'environnement (local → Render → Replit), modifiez
 * uniquement FP_BACKEND_URL et FP_SOCKET_URL ci-dessous.
 *
 * USAGE :
 *   Développement local  : FP_BACKEND_URL = 'http://localhost:3001'
 *   Production (Render)  : FP_BACKEND_URL = '' (même origine — relatif /api/...)
 *   Override manuel      : window.__FP_BACKEND_URL = 'https://app.flowpoint.pro'
 *
 * Inclure ce fichier AVANT dashboard.js dans dashboard.html :
 *   <script src="fp-config.js"></script>
 *   <script src="dashboard.js"></script>
 */

(function () {
  'use strict';

  // ─── CONFIGURATION PRINCIPALE ────────────────────────────────────────────────
  // Modifiez ces deux valeurs pour votre environnement de déploiement.

  const FP_BACKEND_URL = (function () {
    // 1. Variable injectée par le serveur (window.__FP_BACKEND_URL = '...')
    if (typeof window.__FP_BACKEND_URL === 'string' && window.__FP_BACKEND_URL) {
      return window.__FP_BACKEND_URL.replace(/\/$/, '');
    }
    // 2. Même origine (frontend servi par le backend Express)
    if (window.location.protocol !== 'file:') {
      return '';  // requêtes relatives /api/... — le backend est sur le même domaine
    }
    // 3. Développement local (ouverture du fichier HTML directement)
    return 'http://localhost:3001';
  })();

  const FP_SOCKET_URL = (function () {
    if (typeof window.__FP_SOCKET_URL === 'string' && window.__FP_SOCKET_URL) {
      return window.__FP_SOCKET_URL;
    }
    if (FP_BACKEND_URL) return FP_BACKEND_URL;
    // Même hôte, chemin racine
    return window.location.origin;
  })();

  // ─── EXPOSE CONFIG GLOBALE ───────────────────────────────────────────────────

  window.FP_CONFIG = {
    backendUrl:  FP_BACKEND_URL,
    socketUrl:   FP_SOCKET_URL,
    apiBase:     FP_BACKEND_URL + '/api',
    version:     '3.1',
  };

  // ─── PROXY FETCH GLOBAL ──────────────────────────────────────────────────────
  // Intercepte tous les fetch('/api/...') :
  // - préfixe avec backendUrl si FP_BACKEND_URL est défini
  // - ajoute toujours X-Api-Key depuis window.__FP_TOKEN (injecté par le serveur)

  (function () {
    const _origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      init = init || {};
      let url = typeof input === 'string' ? input
        : (input instanceof Request ? input.url : String(input));

      if (url.startsWith('/api/') || (FP_BACKEND_URL && url.startsWith(FP_BACKEND_URL + '/api/'))) {
        const newUrl = FP_BACKEND_URL ? FP_BACKEND_URL + (url.startsWith('/') ? url : '/' + url) : url;
        const token = window.__FP_TOKEN || '';
        const baseHeaders = init.headers
          ? (init.headers instanceof Headers ? init.headers : new Headers(init.headers))
          : new Headers();
        if (token && !baseHeaders.has('X-Api-Key')) {
          baseHeaders.set('X-Api-Key', token);
        }
        const newInit = Object.assign({}, init, {
          credentials: 'include',
          cache: 'no-store',
          headers: baseHeaders,
        });
        return _origFetch(FP_BACKEND_URL ? newUrl : input, newInit);
      }
      return _origFetch(input, init);
    };
  })();

  // ─── SOCKET.IO LOADER ────────────────────────────────────────────────────────
  // Charge socket.io-client dynamiquement depuis le backend et initialise
  // la connexion. Disponible via window.FP_SOCKET après connexion.

  window.FP_SOCKET = null;
  window.FP_SOCKET_READY = false;

  function loadSocketIO() {
    // Socket.IO désactivé — le backend utilise SSE uniquement (/api/activity/events)
    // Aucun /socket.io/socket.io.js n'est servi par ce backend.
  }
  // (appel conservé pour compatibilité — la fonction ne fait rien)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSocketIO);
  } else {
    loadSocketIO();
  }

  // ─── SSE ACTIVITY ─────────────────────────────────────────────────────────────
  // Single SSE connection for activity events. Billing SSE is handled exclusively
  // by dashboard.js (subscribeBillingEvents) to avoid duplicate connections.

  window.FP_SSE_ACTIVITY = null;
  window.FP_SSE_BILLING  = null; // managed by dashboard.js

  var _actSseRetries = 0;
  var _actSseMaxRetries = 8;

  function connectActivitySSE() {
    if (window.FP_SOCKET_READY) return;
    if (typeof EventSource === 'undefined') return;
    if (window.location.protocol === 'file:') return;

    try {
      if (window.FP_SSE_ACTIVITY) {
        try { window.FP_SSE_ACTIVITY.close(); } catch(_) {}
        window.FP_SSE_ACTIVITY = null;
      }
      const actUrl = (FP_BACKEND_URL || '') + '/api/activity/events';
      const es = new EventSource(actUrl, { withCredentials: true });
      window.FP_SSE_ACTIVITY = es;

      es.onopen = function() { _actSseRetries = 0; };
      es.addEventListener('activity', function (e) {
        try {
          const data = JSON.parse(e.data);
          document.dispatchEvent(new CustomEvent('fp:activity:new', { detail: data }));
        } catch (_) {}
      });
      // Silent reconnect — QUIC idle timeouts (status 200 + ERR_QUIC_PROTOCOL_ERROR)
      // are normal and not displayed as errors.
      es.onerror = function () {
        es.close();
        window.FP_SSE_ACTIVITY = null;
        if (_actSseRetries < _actSseMaxRetries) {
          _actSseRetries++;
          var delay = _actSseRetries === 1 ? 3000 : Math.min(5000 * _actSseRetries, 60000);
          setTimeout(connectActivitySSE, delay);
        }
      };
    } catch (err) {
      // EventSource not supported or blocked — degrade silently
    }
  }

  // Start activity SSE 4s after load to let the dashboard initialise first
  setTimeout(connectActivitySSE, 4000);

  console.log('[FP] Config chargée — backend:', FP_BACKEND_URL || '(même origine)', '| socket:', FP_SOCKET_URL);
})();
