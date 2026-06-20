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

  var token = getParam('token');

  if (!token) {
    document.getElementById('fp-error-msg').textContent = 'Aucun token trouvé dans l\'URL.';
    show('fp-error');
    return;
  }

  fetch('/api/auth/login-verify?token=' + encodeURIComponent(token), {
    method: 'GET',
    credentials: 'include',
  })
  .then(function (res) {
    return res.json().then(function (data) { return { ok: res.ok, data: data }; });
  })
  .then(function (r) {
    if (r.ok && r.data.ok) {
      show('fp-success');
      setTimeout(function () {
        window.location.href = '/dashboard';
      }, 1500);
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
