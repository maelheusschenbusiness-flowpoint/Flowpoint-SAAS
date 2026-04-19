(() => {
  "use strict";

  const TEAM_V2_KEY = "fp_team_workspace_v2";
  const root = () => document.getElementById("fpPageContainer");
  const getHash = () => (location.hash || "#overview").toLowerCase();

  const esc = (v) =>
    String(v || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const uid = (p = "id") =>
    `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  let delegationBound = false;
  let renderLock = false;

  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(TEAM_V2_KEY)) || null;
    } catch {
      return null;
    }
  };

  const save = (v) => localStorage.setItem(TEAM_V2_KEY, JSON.stringify(v));

  function fmtDate(ts) {
    try {
      return new Date(ts).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch {
      return "Récemment";
    }
  }

  function shortDate(ts) {
    try {
      return new Date(ts).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit"
      });
    } catch {
      return "—";
    }
  }

  function monthLabel(year, month) {
    const text = new Date(year, month, 1).toLocaleDateString("fr-FR", {
      month: "long",
      year: "numeric"
    });
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function fullDayLabel(dateStr) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "Jour sélectionné";
    const text = d.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    });
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function todayIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function fileSizeLabel(size) {
    if (!size || Number.isNaN(Number(size))) return "Pièce jointe";
    const n = Number(size);
    if (n > 1048576) return `${(n / 1048576).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(n / 1024))} KB`;
  }

  function getPlanRank() {
    const plan = (document.getElementById("fpAccPlan")?.textContent || "standard").toLowerCase();
    if (plan.includes("ultra")) return 3;
    if (plan.includes("pro")) return 2;
    return 1;
  }

  function isPro() {
    return getPlanRank() >= 2;
  }

  function isUltra() {
    return getPlanRank() >= 3;
  }

  function seed() {
    const now = Date.now();
    const d = new Date();
    const y = d.getFullYear();
    const m = d.getMonth();
    const selectedDate = todayIso();

    return {
      tab: "chat",
      currentChannel: "general",
      filter: "all",
      viewYear: y,
      viewMonth: m,
      selectedDate,
      selectedNoteId: "note_playbook",
      selectedMemberId: "member_owner",
      draftAttachments: [],

      channels: [
        {
          id: "general",
          name: "general",
          private: false,
          desc: "Annonces, coordination et décisions visibles par toute l’équipe.",
          purpose: "Garder le pilotage général propre.",
          topic: "Arbitrages, annonces, décisions visibles"
        },
        {
          id: "seo",
          name: "seo",
          private: false,
          desc: "Quick wins, contenus, pages locales et arbitrages SEO.",
          purpose: "Transformer les audits en actions concrètes.",
          topic: "SEO local, contenu, quick wins"
        },
        {
          id: "dev",
          name: "dev",
          private: false,
          desc: "Bugs, stabilité, intégrations et sujets techniques.",
          purpose: "Accélérer les correctifs et l’exécution.",
          topic: "Tech, intégrations, incidents"
        },
        {
          id: "planning",
          name: "planning",
          private: true,
          desc: "Planning, charge et coordination interne.",
          purpose: "Suivre les deadlines et répartitions.",
          topic: "Charge, deadlines, affectations"
        },
        {
          id: "client-success",
          name: "client-success",
          private: false,
          desc: "Suivi client, livrables, relances et points de passage.",
          purpose: "Garder une vue client claire.",
          topic: "Retours, suivi, fidélisation"
        }
      ],

      messages: [
        {
          id: uid("m"),
          c: "general",
          a: "FlowPoint",
          role: "system",
          t: "Workspace lancé. Le canal général sert aux arbitrages et annonces majeures.",
          d: now - 3600 * 1000,
          attachments: []
        },
        {
          id: uid("m"),
          c: "general",
          a: "Maël",
          role: "owner",
          t: "On repart proprement : chat d’abord, puis calendrier, notes, membres et activité.",
          d: now - 3200 * 1000,
          attachments: []
        }
      ]
    };
  }

  // suite à venir dans les prochaines parties
})();
