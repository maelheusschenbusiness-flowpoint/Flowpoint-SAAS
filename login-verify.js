(() => {
  "use strict";

  const TOKEN_KEY = "token";
  const REFRESH_TOKEN_KEY = "refreshToken";

  const $ = (s) => document.querySelector(s);

  const els = {
    title: $("#title"),
    desc: $("#desc"),
    statusBox: $("#statusBox"),
    foot: $("#foot"),
    btnDashboard: $("#btnDashboard"),
    btnLogin: $("#btnLogin"),
    btnRetry: $("#btnRetry"),
  };

  function setState({
    title,
    desc,
    status,
    kind = "",
    showDashboard = false,
    showLogin = false,
    showRetry = false,
    foot = ""
  }) {
    if (els.title) els.title.textContent = title || "";
    if (els.desc) els.desc.textContent = desc || "";
    if (els.statusBox) {
      els.statusBox.textContent = status || "";
      els.statusBox.classList.remove("error", "success");
      if (kind) els.statusBox.classList.add(kind);
    }
    if (els.foot) els.foot.textContent = foot || "";

    els.btnDashboard?.classList.toggle("hidden", !showDashboard);
    els.btnLogin?.classList.toggle("hidden", !showLogin);
    els.btnRetry?.classList.toggle("hidden", !showRetry);
  }

  function getUrlParams() {
    const url = new URL(window.location.href);
    return {
      token: url.searchParams.get("token") || "",
      refreshToken: url.searchParams.get("refreshToken") || "",
    };
  }

  function storeTokens(token, refreshToken) {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    }
    if (refreshToken) {
      localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    }
  }

  async function verify() {
    const { token: tokenFromUrl, refreshToken: refreshTokenFromUrl } = getUrlParams();

    if (!tokenFromUrl) {
      setState({
        title: "Lien invalide",
        desc: "Aucun token n’a été trouvé dans l’URL.",
        status: "Token manquant",
        kind: "error",
        showLogin: true,
        showRetry: true,
        foot: "Retourne sur la page de connexion pour demander un nouveau lien."
      });
      return;
    }

    try {
      const r = await fetch(`/api/auth/login-verify?token=${encodeURIComponent(tokenFromUrl)}`, {
        method: "GET",
        credentials: "include",
      });

      const data = await r.json().catch(() => ({}));

      if (!r.ok) {
        setState({
          title: "Lien invalide ou expiré",
          desc: "La validation du lien a échoué.",
          status: String(data?.error || "Validation impossible"),
          kind: "error",
          showLogin: true,
          showRetry: true,
          foot: "Demande un nouveau lien de connexion."
        });
        return;
      }

      const finalToken = data?.token || tokenFromUrl;
      const finalRefreshToken = data?.refreshToken || refreshTokenFromUrl || "";

      storeTokens(finalToken, finalRefreshToken);

      setState({
        title: "Connexion réussie",
        desc: "Ton accès a bien été validé.",
        status: "Redirection vers le dashboard…",
        kind: "success",
        showDashboard: true,
        foot: "Tu vas être redirigé automatiquement."
      });

      setTimeout(() => {
        window.location.replace("/dashboard.html");
      }, 900);
    } catch (e) {
      setState({
        title: "Erreur réseau",
        desc: "La validation du lien a échoué.",
        status: "Impossible de contacter le serveur",
        kind: "error",
        showLogin: true,
        showRetry: true,
        foot: "Vérifie ta connexion puis réessaie."
      });
    }
  }

  els.btnRetry?.addEventListener("click", () => {
    verify();
  });

  verify();
})();
