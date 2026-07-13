(function () {
  'use strict';

  var isAnnual = false;

  var prices = {
    standard: { monthly: 29,  annual: 278  },
    pro:      { monthly: 79,  annual: 758  },
    enterprise:{ monthly: 249, annual: 2390 },
  };

  var labels = { standard: 'Standard', pro: 'Pro', enterprise: 'Enterprise' };

  function formatPrice(plan) {
    var p = isAnnual ? prices[plan].annual : prices[plan].monthly;
    var period = isAnnual ? '/an' : '/mois';
    return p + '€<span>' + period + '</span>';
  }

  function updatePrices() {
    Object.keys(prices).forEach(function (plan) {
      var el = document.getElementById('fp-price-' + plan);
      if (el) el.innerHTML = formatPrice(plan);
    });
    document.getElementById('fp-label-monthly').classList.toggle('active', !isAnnual);
    document.getElementById('fp-label-annual').classList.toggle('active', isAnnual);
    document.getElementById('fp-billing-toggle').classList.toggle('on', isAnnual);
  }

  document.getElementById('fp-billing-toggle').addEventListener('click', function () {
    isAnnual = !isAnnual;
    updatePrices();
  });

  document.getElementById('fp-plans-container').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-plan]');
    if (!btn) return;

    var plan = btn.dataset.plan;

    if (plan === 'enterprise') {
      window.location.href = 'mailto:hello@flowpoint.pro?subject=FlowPoint%20Enterprise';
      return;
    }

    var billing  = isAnnual ? 'annual' : 'monthly';

    /* Always persist the plan selection so checkout.html can read it */
    try { localStorage.setItem('fp_cart', JSON.stringify({ plan: plan, addons: {}, billing: billing })); } catch(e) {}

    btn.disabled = true;
    btn.innerHTML = '<span class="fp-spinner"></span>Chargement…';

    fetch('/api/billing/checkout', {
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
    .then(function (res) {
      if (res.status === 401) {
        /* Not logged in — save plan and redirect to signup */
        try { sessionStorage.setItem('fp_next', '/checkout.html'); } catch(e) {}
        window.location.href = '/login.html';
        return null;
      }
      return res.json();
    })
    .then(function (data) {
      if (!data) return;
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Impossible de démarrer le paiement. Réessayez.');
        btn.disabled = false;
        btn.textContent = plan === 'pro' ? 'Commencer — Pro' : 'Commencer';
      }
    })
    .catch(function () {
      alert('Erreur réseau. Vérifiez votre connexion et réessayez.');
      btn.disabled = false;
      btn.textContent = plan === 'pro' ? 'Commencer — Pro' : 'Commencer';
    });
  });

  document.querySelectorAll('.fp-faq-q').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var answer = btn.nextElementSibling;
      var icon   = btn.querySelector('span');
      var open   = answer.style.display === 'block';
      answer.style.display = open ? 'none' : 'block';
      if (icon) icon.textContent = open ? '+' : '−';
    });
  });

  updatePrices();
})();
