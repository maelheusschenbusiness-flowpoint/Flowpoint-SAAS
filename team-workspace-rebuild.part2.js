// PARTIE 2 — data seed suite + helpers
(() => {
  "use strict";

  const TEAM_V2_KEY = "fp_team_workspace_v2";
  const root = () => document.getElementById("fpPageContainer");
  const getHash = () => (location.hash || "#overview").toLowerCase();

  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(TEAM_V2_KEY)) || null;
    } catch {
      return null;
    }
  };

  const save = (v) => localStorage.setItem(TEAM_V2_KEY, JSON.stringify(v));

  const uid = (p = "id") => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  function todayIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function seedPart2(base) {
    const now = Date.now();
    const selectedDate = todayIso();

    return {
      ...base,
      notes: [
        {
          id: "note_playbook",
          title: "Playbook équipe",
          text: "Canal général = annonces. SEO = quick wins. Dev = technique. Planning = deadlines.\n\nToujours garder une trace des décisions, des docs clés et des prochains points d’action.",
          pinned: true,
          type: "Process",
          priority: "Haute",
          tags: ["Ops", "Coordination", "Décision"],
          author: "Maël",
          d: now - 5000 * 1000,
          checklist: ["Clarifier les canaux", "Centraliser les docs", "Documenter les décisions"]
        },
        {
          id: "note_week",
          title: "Semaine sprint équipe",
          text: "Objectif : stabiliser l’espace équipe, améliorer le chat et préparer le calendrier premium.\n\nOn garde une exécution page par page pour éviter de casser le dashboard.",
          pinned: false,
          type: "Sprint",
          priority: "Moyenne",
          tags: ["Sprint", "UX"],
          author: "Maël",
          d: now - 2400 * 1000,
          checklist: ["Chat final", "Calendrier premium", "Notes avancées"]
        }
      ],

      members: [
        {
          id: "member_owner",
          name: "Maël",
          role: "Owner",
          title: "Direction produit",
          status: "online",
          initials: "MH",
          bio: "Pilote la roadmap, les arbitrages et la vision produit du dashboard.",
          expertise: ["Pilotage", "Décision", "Vision"],
          activity: "A lancé la refonte équipe",
          focus: "Coordination produit",
          load: 72,
          avatar: ""
        },
        {
          id: "member_seo",
          name: "SEO Manager",
          role: "Manager",
          title: "Lead SEO",
          status: "online",
          initials: "SM",
          bio: "Transforme audits, quick wins et contenu en actions concrètes pour le workspace.",
          expertise: ["SEO", "Quick wins", "Contenu"],
          activity: "Prépare les priorités locales",
          focus: "Pages locales & contenus",
          load: 64,
          avatar: ""
        },
        {
          id: "member_ops",
          name: "Tech Ops",
          role: "Editor",
          title: "Ops & stabilité",
          status: "offline",
          initials: "TO",
          bio: "Suit la stabilité, les monitors, l’exécution technique et les incidents du dashboard.",
          expertise: ["Monitoring", "Infra", "Exécution"],
          activity: "A vérifié les correctifs UI",
          focus: "Stabilité dashboard",
          load: 46,
          avatar: ""
        }
      ],

      docs: [
        {
          id: uid("d"),
          c: "general",
          name: "guide-workspace.pdf",
          type: "PDF",
          size: "1.2 MB",
          by: "FlowPoint",
          d: now - 7200 * 1000
        },
        {
          id: uid("d"),
          c: "general",
          name: "sprint-priorities.docx",
          type: "DOC",
          size: "540 KB",
          by: "Maël",
          d: now - 5100 * 1000
        },
        {
          id: uid("d"),
          c: "seo",
          name: "local-seo-opportunities.xlsx",
          type: "XLS",
          size: "880 KB",
          by: "SEO Manager",
          d: now - 4200 * 1000
        },
        {
          id: uid("d"),
          c: "planning",
          name: "team-week-board.pdf",
          type: "PDF",
          size: "960 KB",
          by: "Maël",
          d: now - 1800 * 1000
        }
      ],

      events: [
        {
          id: uid("e"),
          title: "Revue équipe",
          date: selectedDate,
          time: "09:00",
          type: "meeting",
          desc: "Point équipe sur priorités et déblocages.",
          assignee: "Maël"
        },
        {
          id: uid("e"),
          title: "Quick wins local SEO",
          date: selectedDate,
          time: "14:00",
          type: "seo",
          desc: "Liste des quick wins à publier et vérifier.",
          assignee: "SEO Manager"
        },
        {
          id: uid("e"),
          title: "Check stabilité dashboard",
          date: selectedDate,
          time: "17:00",
          type: "monitoring",
          desc: "Validation du rendu et correctifs UX.",
          assignee: "Tech Ops"
        }
      ],

      activity: [
        {
          id: uid("a"),
          type: "message",
          title: "Message posté dans #general",
          text: "Maël a annoncé la refonte propre du workspace équipe.",
          d: now - 3300 * 1000
        },
        {
          id: uid("a"),
          type: "doc",
          title: "Document ajouté",
          text: "guide-workspace.pdf disponible dans #general.",
          d: now - 7200 * 1000
        },
        {
          id: uid("a"),
          type: "member",
          title: "Membre actif",
          text: "SEO Manager est actuellement en ligne.",
          d: now - 900 * 1000
        },
        {
          id: uid("a"),
          type: "message",
          title: "Visio ouverte",
          text: "Une visio a été lancée depuis #general.",
          d: now - 600 * 1000
        }
      ]
    };
  }

  function getStatePart2() {
    const s = load();
    if (!s) return null;
    if (!s.selectedDate) s.selectedDate = todayIso();
    if (typeof s.viewYear !== "number" || typeof s.viewMonth !== "number") {
      const d = new Date();
      s.viewYear = d.getFullYear();
      s.viewMonth = d.getMonth();
    }
    if (!Array.isArray(s.draftAttachments)) s.draftAttachments = [];
    return s;
  }

  function currentChannel(s) {
    return s.channels.find((c) => c.id === s.currentChannel) || s.channels[0];
  }

  function channelMessages(s) {
    return s.messages
      .filter((m) => m.c === s.currentChannel)
      .sort((a, b) => a.d - b.d);
  }

  function channelDocs(s) {
    return s.docs
      .filter((d) => d.c === s.currentChannel)
      .sort((a, b) => b.d - a.d)
      .slice(0, 6);
  }

  // suite à venir dans les prochaines parties
})();
