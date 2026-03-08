(() => {
  "use strict";

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

  function setState({ title, desc, status, kind = "", showDashboard = false, showLogin = false, showRetry = false, foot = "" }) {
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

  function getTokenFromUrl() {
    const url = new URL(window.location.href);
    return url.searchParams.get("token") || "";
  }

  async function verify() {
    const token = getTokenFromUrl();

    if (!token) {
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
      const r = await fetch(`/api/auth/login-verify?token=${encodeURIComponent(token)}`, {
        method: "GET",
        credentials: "include",
      });

      const data = await r.json().catch(() => ({}));

      if (!r.ok) {
        const msg = String(data?.error || "Validation impossible");

        setState({
          title: "Connexion…",
          desc: "Validation du lien.",
          status: msg,
          kind: "error",
          showLogin: true,
          showRetry: true,
          foot: "Si tu restes bloqué, retourne sur la page de connexion et demande un nouveau lien."
        });
        return;
      }

      if (data?.token) {
        localStorage.setItem("token", data.token);
      }

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
        foot: "Vérifie ta connexion puis redemande un nouveau lien si nécessaire."
      });
    }
  }

  verify();
})();
