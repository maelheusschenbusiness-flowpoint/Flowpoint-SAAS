/* pricing-funnel.js — emission de `cta_clique` depuis pricing.html.
 *
 * Le clic sur un bouton de plan (Standard / Pro / Ultra) ou sur « Panier »
 * n'est pas un lien <a href> : sans cet ecouteur, l'etape `cta_clique` n'etait
 * jamais emise et le taux de clic des tarifs restait incalculable.
 *
 * CONSENTEMENT. Strictement le meme que signin.html : rien n'est lu, cree ni
 * envoye tant que le cookie `fp_analytics_consent=accepted` est absent. Sans
 * consentement, ce fichier n'a aucun effet.
 *
 * IDENTITE. Meme cle `fp_vid` / `fp_source` que signin.html et
 * checkout-payment.html : l'etape se joint au meme visiteur que
 * `signup_started`. Aucune donnee personnelle ne part : une etape, un
 * identifiant de visiteur aleatoire, une source, le plan choisi et, si connu,
 * le fp_lid opaque deja valide par pricing.html.
 *
 * Une mesure ratee ne doit jamais se voir ni bloquer la navigation :
 * tout est en try/catch, la requete n'est jamais attendue (keepalive).
 */
(function () {
  'use strict';

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var FALLBACK_RE = /^fp-[a-z0-9]+-[a-z0-9]+$/i;
  var SOURCES = ['smartlead', 'google', 'direct', 'social', 'other_campaign'];
  var PLANS = ['standard', 'pro', 'ultra'];
  var LID_RE = /^[A-Za-z0-9_-]{22}$/;

  function hasConsent() {
    try {
      return document.cookie.split(';').some(function (c) {
        return c.trim() === 'fp_analytics_consent=accepted';
      });
    } catch (e) { return false; }
  }

  function validVisitorId(v) {
    return typeof v === 'string' && (UUID_RE.test(v) || FALLBACK_RE.test(v));
  }

  function visitorId() {
    if (!hasConsent()) return '';
    try {
      var incoming = new URLSearchParams(window.location.search).get('fp_vid');
      if (validVisitorId(incoming)) localStorage.setItem('fp_vid', incoming);
      var v = localStorage.getItem('fp_vid');
      if (!validVisitorId(v)) {
        v = (window.crypto && window.crypto.randomUUID)
          ? window.crypto.randomUUID()
          : 'fp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
        localStorage.setItem('fp_vid', v);
      }
      return v;
    } catch (e) { return ''; }
  }

  function source() {
    try {
      var stored = localStorage.getItem('fp_source');
      if (SOURCES.indexOf(stored) !== -1) return stored;
      var q = new URLSearchParams(window.location.search);
      var fromUrl = q.get('fp_src') || q.get('utm_source') || '';
      var found = /smartlead/i.test(fromUrl) ? 'smartlead' : (SOURCES.indexOf(fromUrl) !== -1 ? fromUrl : 'direct');
      // Premiere touche : memorisee (consentement obligatoire) pour que la page d'inscription et le
      // checkout, qui lisent la meme cle, parlent de la meme source que les tarifs.
      if (found !== 'direct' && hasConsent()) { try { localStorage.setItem('fp_source', found); } catch (e) {} }
      return found;
    } catch (e) { return 'direct'; }
  }

  function leadId() {
    try {
      var l = sessionStorage.getItem('fp_lid') || '';
      return LID_RE.test(l) ? l : undefined;
    } catch (e) { return undefined; }
  }

  /** Emet une etape du tunnel. No-op sans consentement. */
  function track(etape, plan) {
    try {
      var vid = visitorId();
      if (!vid) return false;
      var body = { etape: etape, visiteurId: vid, source: source(), fp_lid: leadId() };
      if (PLANS.indexOf(plan) !== -1) body.plan = plan;
      window.fetch('/api/public/funnel-event', {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).catch(function () {});
      return true;
    } catch (e) { return false; }
  }

  window.fpFunnelTrack = track;

  /* Boutons de plan, bouton « Panier », liens vers checkout/signup, et tout
     element marque data-funnel-cta. L'ecouteur est en capture : il s'execute
     avant le gestionnaire qui navigue (selectPlan -> goToCheckout). */
  document.addEventListener('click', function (event) {
    try {
      var el = event.target instanceof Element
        ? event.target.closest('a,button,[data-funnel-cta]') : null;
      if (!el || el.disabled) return;
      var planBtn = el.matches('.fp-card-btn[data-plan]') ? el.getAttribute('data-plan') : undefined;
      var href = el instanceof HTMLAnchorElement ? (el.getAttribute('href') || '') : '';
      if (planBtn || el.id === 'fp-cart-btn' || el.hasAttribute('data-funnel-cta') ||
          /checkout|signup/i.test(href)) {
        track('cta_clique', planBtn);
      }
    } catch (e) { /* ne bloque jamais le clic */ }
  }, true);

  /* Vue de la page tarifs : une fois par chargement, meme identite (`fp_vid`) et meme consentement
     que les autres etapes ; le serveur deduplique par visiteur + etape + jour. */
  try {
    if (/\/pricing\.html$/i.test(window.location.pathname || '')) track('tarifs_vus');
  } catch (e) { /* une mesure ratee ne bloque jamais la page */ }
})();
