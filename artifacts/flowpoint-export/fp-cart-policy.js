/* fp-cart-policy.js — règle UNIQUE d'expiration du panier (`fp_cart`). NON BRANCHÉE : aucune page ne la charge encore.
 *
 * Elle décrit la politique proposée (voir docs/POLITIQUE-EXPIRATION-PANIER.md) et sert de spécification
 * exécutable : src/tests/cart-expiration-policy.test.ts. Le serveur reste seul décisionnaire sur les prix, l'essai,
 * l'éligibilité et les quotas ; cette règle ne décide que de la RÉUTILISATION d'une sélection mémorisée dans le navigateur.
 */
(function (root) {
  'use strict';

  var TTL_MS = 60 * 60 * 1000;     // même durée que signin.html, pricing.html et checkout.html aujourd'hui
  var SKEW_MS = 5 * 60 * 1000;     // tolérance d'horloge : un horodatage « dans le futur » au-delà est refusé
  var PLANS = ['standard', 'pro', 'ultra'];

  function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }

  /**
   * @param cart  contenu de `fp_cart` (déjà passé par JSON.parse)
   * @param ctx   { now?: number, orgId?: string, plans?: string[] }
   * @returns {{action: 'keep'|'drop', reason: string, restamp?: boolean}}
   */
  function evaluate(cart, ctx) {
    ctx = ctx || {};
    var now = typeof ctx.now === 'number' ? ctx.now : Date.now();
    var plans = Array.isArray(ctx.plans) && ctx.plans.length ? ctx.plans : PLANS;

    if (!isObject(cart)) return { action: 'drop', reason: 'absent_or_invalid' };
    if (cart.addons !== undefined && !isObject(cart.addons)) return { action: 'drop', reason: 'addons_invalid' };
    var hasPlan = typeof cart.plan === 'string' && cart.plan !== '';
    if (hasPlan && plans.indexOf(cart.plan.toLowerCase()) === -1) return { action: 'drop', reason: 'plan_unknown' };
    var hasAddons = isObject(cart.addons) && Object.keys(cart.addons).length > 0;
    if (!hasPlan && !hasAddons) return { action: 'drop', reason: 'empty' };

    if (cart._v === 1) {
      if (typeof cart._updatedAt !== 'number' || !isFinite(cart._updatedAt)) return { action: 'drop', reason: 'unstamped' };
      var age = now - cart._updatedAt;
      if (age < -SKEW_MS) return { action: 'drop', reason: 'future_timestamp' };
      if (age > TTL_MS) return { action: 'drop', reason: 'expired' };
      if (ctx.orgId && cart._orgId && cart._orgId !== ctx.orgId) return { action: 'drop', reason: 'org_mismatch' };
      return { action: 'keep', reason: 'fresh' };
    }

    // Sans version : seul le relais du tableau de bord (add-ons ou crédits SANS plan, `fromDashboard`) est toléré,
    // et on lui pose un horodatage à la première lecture (`restamp`) pour que l'expiration s'applique ensuite.
    if (cart.fromDashboard === true && !hasPlan && hasAddons) {
      return { action: 'keep', reason: 'dashboard_handoff_unversioned', restamp: true };
    }
    return { action: 'drop', reason: 'unversioned_legacy' };
  }

  /** Reprise d'une intention de paiement mémorisée (`flowpoint_pending_checkout`) : son `exp` fait foi, le panier est ré-horodaté. */
  function restoreFromPending(pending, ctx) {
    ctx = ctx || {};
    var now = typeof ctx.now === 'number' ? ctx.now : Date.now();
    if (!isObject(pending) || typeof pending.exp !== 'number' || pending.exp <= now || !isObject(pending.cart)) return null;
    var base = evaluate(Object.assign({}, pending.cart, { _v: 1, _updatedAt: now }), { now: now, orgId: ctx.orgId, plans: ctx.plans });
    if (base.action !== 'keep') return null;
    return Object.assign({}, pending.cart, { _v: 1, _updatedAt: now });
  }

  var api = { evaluate: evaluate, restoreFromPending: restoreFromPending, TTL_MS: TTL_MS, SKEW_MS: SKEW_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.fpCartPolicy = api;
})(typeof window !== 'undefined' ? window : globalThis);
