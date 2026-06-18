(function () {
  'use strict';

  function showError(msg) {
    document.getElementById('fp-loading').style.display = 'none';
    document.getElementById('fp-error-msg').textContent = msg || 'Impossible d\'initialiser le paiement.';
    document.getElementById('fp-error').style.display = 'block';
  }

  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  var plan    = getParam('plan')    || 'pro';
  var billing = getParam('billing') || 'monthly';

  fetch('/api/billing/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      plan: plan,
      billing: billing,
      successUrl: window.location.origin + '/success',
      cancelUrl:  window.location.origin + '/cancel',
    }),
  })
  .then(function (res) { return res.json(); })
  .then(function (data) {
    if (data.url) {
      window.location.href = data.url;
    } else {
      showError(data.error || 'Session de paiement introuvable.');
    }
  })
  .catch(function () {
    showError('Erreur réseau. Vérifiez votre connexion et réessayez.');
  });
})();
