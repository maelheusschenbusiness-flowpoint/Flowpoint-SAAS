/**
 * FLOWPOINT — Configuration Backend
 * ═══════════════════════════════════
 * Ce fichier centralise TOUTE la configuration de connexion backend.
 * Pour changer d'environnement (local → Render → Replit), modifiez
 * uniquement FP_BACKEND_URL et FP_SOCKET_URL ci-dessous.
 *
 * USAGE :
 *   Développement local  : FP_BACKEND_URL = 'http://localhost:3001'
 *   Render               : FP_BACKEND_URL = 'https://flowpoint-api.onrender.com'
 *   Replit déployé       : FP_BACKEND_URL = 'https://flowpoint.replit.app'
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
  // Intercepte tous les fetch('/api/...') et les préfixe avec backendUrl.
  // Permet de changer l'URL backend sans toucher à dashboard.js.

  if (FP_BACKEND_URL) {
    const _origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      init = init || {};
      let url = typeof input === 'string' ? input
        : (input instanceof Request ? input.url : String(input));

      if (url.startsWith('/api/')) {
        const newUrl = FP_BACKEND_URL + url;
        const newInit = Object.assign({}, init, { credentials: 'include' });
        return _origFetch(newUrl, newInit);
      }
      return _origFetch(input, init);
    };
  }

  // ─── SOCKET.IO LOADER ────────────────────────────────────────────────────────
  // Charge socket.io-client dynamiquement depuis le backend et initialise
  // la connexion. Disponible via window.FP_SOCKET après connexion.

  window.FP_SOCKET = null;
  window.FP_SOCKET_READY = false;

  function loadSocketIO() {
    if (window.FP_CONFIG.socketUrl === '' && window.location.protocol === 'file:') {
      console.warn('[FP] Socket.IO désactivé en mode fichier local');
      return;
    }

    const socketSrc = window.FP_CONFIG.socketUrl
      ? window.FP_CONFIG.socketUrl + '/socket.io/socket.io.js'
      : '/socket.io/socket.io.js';

    const script = document.createElement('script');
    script.src = socketSrc;
    script.async = true;

    script.onload = function () {
      if (typeof io === 'undefined') {
        console.warn('[FP] socket.io.js chargé mais io() introuvable');
        return;
      }

      const socket = io(window.FP_CONFIG.socketUrl || window.location.origin, {
        withCredentials: true,
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
        timeout: 10000,
      });

      window.FP_SOCKET = socket;

      socket.on('connect', function () {
        window.FP_SOCKET_READY = true;
        console.log('[FP] Socket.IO connecté :', socket.id);
        document.dispatchEvent(new CustomEvent('fp:socket:ready', { detail: { socket } }));
      });

      socket.on('disconnect', function (reason) {
        window.FP_SOCKET_READY = false;
        console.warn('[FP] Socket.IO déconnecté :', reason);
        document.dispatchEvent(new CustomEvent('fp:socket:disconnect', { detail: { reason } }));
      });

      socket.on('connect_error', function (err) {
        console.warn('[FP] Socket.IO erreur de connexion :', err.message);
      });

      // ── Événements temps réel diffusés par le backend ──────────────────────

      // Monitor DOWN/UP → toast + refresh
      socket.on('monitor:alert', function (data) {
        document.dispatchEvent(new CustomEvent('fp:monitor:alert', { detail: data }));
      });

      // Nouvelle entrée d'activité
      socket.on('activity:new', function (data) {
        document.dispatchEvent(new CustomEvent('fp:activity:new', { detail: data }));
      });

      // Mise à jour du plan Stripe
      socket.on('billing:updated', function (data) {
        document.dispatchEvent(new CustomEvent('fp:billing:updated', { detail: data }));
      });

      // Message équipe (canal)
      socket.on('team:message', function (data) {
        document.dispatchEvent(new CustomEvent('fp:team:message', { detail: data }));
      });

      // Notification push générique
      socket.on('notification', function (data) {
        document.dispatchEvent(new CustomEvent('fp:notification', { detail: data }));
      });

      // Audit terminé (depuis queue Bull)
      socket.on('audit:complete', function (data) {
        document.dispatchEvent(new CustomEvent('fp:audit:complete', { detail: data }));
      });

      // Rapport PDF prêt
      socket.on('report:ready', function (data) {
        document.dispatchEvent(new CustomEvent('fp:report:ready', { detail: data }));
      });
    };

    script.onerror = function () {
      console.warn('[FP] Socket.IO non disponible — fonctionnement en mode polling uniquement');
    };

    document.head.appendChild(script);
  }

  // Charge Socket.IO après que le DOM est prêt
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSocketIO);
  } else {
    loadSocketIO();
  }

  // ─── SSE FALLBACK ────────────────────────────────────────────────────────────
  // Si Socket.IO est indisponible, utilise les Server-Sent Events comme fallback.

  window.FP_SSE_ACTIVITY = null;
  window.FP_SSE_BILLING  = null;

  function connectSSE() {
    if (window.FP_SOCKET_READY) return;  // Socket.IO a priorité

    const base = FP_BACKEND_URL;
    if (typeof EventSource === 'undefined') return;
    if (window.location.protocol === 'file:' && !base) return;

    try {
      const actUrl = (base || '') + '/api/activity/events';
      window.FP_SSE_ACTIVITY = new EventSource(actUrl, { withCredentials: true });
      window.FP_SSE_ACTIVITY.addEventListener('activity', function (e) {
        try {
          const data = JSON.parse(e.data);
          document.dispatchEvent(new CustomEvent('fp:activity:new', { detail: data }));
        } catch (_) {}
      });
      window.FP_SSE_ACTIVITY.onerror = function () {
        window.FP_SSE_ACTIVITY?.close();
      };

      const bilUrl = (base || '') + '/api/billing/events';
      window.FP_SSE_BILLING = new EventSource(bilUrl, { withCredentials: true });
      window.FP_SSE_BILLING.addEventListener('plan_updated', function (e) {
        try {
          const data = JSON.parse(e.data);
          document.dispatchEvent(new CustomEvent('fp:billing:updated', { detail: data }));
        } catch (_) {}
      });
      window.FP_SSE_BILLING.onerror = function () {
        window.FP_SSE_BILLING?.close();
      };
    } catch (err) {
      console.warn('[FP] SSE non disponible :', err.message);
    }
  }

  // Démarre SSE 3 secondes après le chargement
  // (si Socket.IO se connecte d'ici là, connectSSE() n'ouvrira rien)
  setTimeout(connectSSE, 3000);

  console.log('[FP] Config chargée — backend:', FP_BACKEND_URL || '(même origine)', '| socket:', FP_SOCKET_URL);
})();
