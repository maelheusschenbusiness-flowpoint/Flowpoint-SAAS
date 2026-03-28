(() => {
  "use strict";

  const storage = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (err) {
        console.warn("Storage error:", err);
      }
    }
  };

  const appState = {
    theme: storage.get("fp_theme", "dark"),
    route: "overview",
    auditFilter: "all",
    missionFilter: "all",
    auditSearch: "",
    drawerOpen: false,
    modalOpen: false,
    selectedAudit: null,
    workspace: storage.get("fp_workspace", {
      name: "FlowPoint AI",
      plan: "Ultra",
      planPrice: "149€",
      planDescription: "Pour les équipes, la croissance et les besoins avancés.",
      alertEmail: "alerts@flowpoint.pro",
      timezone: "Europe/Brussels",
      frequency: "monthly"
    }),
    missions: storage.get("fp_missions", [
      {
        id: 1,
        title: "Optimiser les balises title des pages prioritaires",
        description: "Améliore la compréhension Google et augmente le potentiel de clic sur les pages les plus stratégiques.",
        done: true,
        priority: "Haute",
        owner: "SEO Manager",
        eta: "Terminé"
      },
      {
        id: 2,
        title: "Corriger les pages lentes sur mobile",
        description: "Réduit la friction utilisateur et améliore performance SEO, expérience mobile et conversion.",
        done: false,
        priority: "Haute",
        owner: "Tech",
        eta: "2 jours"
      },
      {
        id: 3,
        title: "Créer des pages locales ciblées",
        description: "Permet de capter des requêtes à forte intention commerciale locale et d’élargir la couverture géographique.",
        done: false,
        priority: "Moyenne",
        owner: "Content",
        eta: "5 jours"
      },
      {
        id: 4,
        title: "Améliorer le maillage interne des pages services",
        description: "Aide Google à mieux comprendre la structure du site et augmente la transmission d’autorité interne.",
        done: true,
        priority: "Moyenne",
        owner: "SEO Manager",
        eta: "Terminé"
      },
      {
        id: 5,
        title: "Préparer un rapport dirigeant simplifié",
        description: "Crée une version premium, rapide à lire et plus vendeuse pour les clients non techniques.",
        done: false,
        priority: "Faible",
        owner: "Account",
        eta: "1 jour"
      }
    ]),
    audits: [
      {
        id: 101,
        site: "flowpoint.pro",
        score: 91,
        priority: "Faible",
        status: "Healthy",
        tech: "Très bon socle technique, quelques optimisations d’UX mobile encore possibles.",
        traffic: "+18%",
        lastRun: "Aujourd’hui",
        opportunities: 6,
        issueCount: 8,
        localPotential: "Élevé",
        category: "saas"
      },
      {
        id: 102,
        site: "client-garage.be",
        score: 74,
        priority: "Moyenne",
        status: "Needs work",
        tech: "Structure correcte mais manque d’optimisation des pages locales et de rapidité mobile.",
        traffic: "+5%",
        lastRun: "Hier",
        opportunities: 12,
        issueCount: 19,
        localPotential: "Très élevé",
        category: "local"
      },
      {
        id: 103,
        site: "artisan-local.be",
        score: 63,
        priority: "Haute",
        status: "Critical",
        tech: "Site sous-exploité avec plusieurs problèmes techniques et contenus insuffisants.",
        traffic: "-7%",
        lastRun: "Il y a 2 jours",
        opportunities: 18,
        issueCount: 27,
        localPotential: "Très élevé",
        category: "local"
      },
      {
        id: 104,
        site: "premiumdetailing.be",
        score: 86,
        priority: "Faible",
        status: "Healthy",
        tech: "Très bonne base visuelle et structure solide, potentiel supplémentaire sur le contenu SEO.",
        traffic: "+11%",
        lastRun: "Il y a 3 jours",
        opportunities: 7,
        issueCount: 10,
        localPotential: "Élevé",
        category: "premium"
      },
      {
        id: 105,
        site: "ecom-bruxelles.store",
        score: 69,
        priority: "Haute",
        status: "Needs work",
        tech: "Données techniques correctes mais vitesse et structure de collection à reprendre.",
        traffic: "+2%",
        lastRun: "Il y a 5 jours",
        opportunities: 14,
        issueCount: 22,
        localPotential: "Moyen",
        category: "ecom"
      }
    ],
    monitors: [
      {
        id: 201,
        site: "flowpoint.pro",
        status: "UP",
        latency: 182,
        uptime: "99.99%",
        checks: 12890,
        note: "Disponibilité excellente, aucun incident majeur détecté."
      },
      {
        id: 202,
        site: "client-garage.be",
        status: "UP",
        latency: 341,
        uptime: "99.95%",
        checks: 9440,
        note: "Le site est stable mais peut être accéléré sur mobile."
      },
      {
        id: 203,
        site: "artisan-local.be",
        status: "DEGRADED",
        latency: 892,
        uptime: "98.72%",
        checks: 7530,
        note: "Temps de réponse trop élevé, impact possible sur SEO et conversion."
      },
      {
        id: 204,
        site: "premiumdetailing.be",
        status: "UP",
        latency: 225,
        uptime: "99.97%",
        checks: 10120,
        note: "Bonne stabilité globale, très peu d’alertes observées."
      }
    ],
    reports: [
      {
        id: 301,
        title: "Rapport mensuel — FlowPoint",
        type: "PDF",
        date: "Mars 2026",
        description: "Synthèse complète SEO, monitoring, local et opportunités business."
      },
      {
        id: 302,
        title: "Export actions prioritaires",
        type: "CSV",
        date: "Mars 2026",
        description: "Liste opérationnelle des tâches les plus rentables à déployer."
      },
      {
        id: 303,
        title: "Résumé direction",
        type: "PDF",
        date: "Mars 2026",
        description: "Version courte, claire et premium pour décideurs non techniques."
      },
      {
        id: 304,
        title: "Comparatif concurrentiel",
        type: "PDF",
        date: "Mars 2026",
        description: "Mise en perspective du site face aux concurrents directs."
      }
    ],
    competitors: [
      {
        name: "Concurrent A",
        highlights: [
          "Plus de contenu local ciblé",
          "Meilleur maillage interne",
          "Pages services mieux structurées"
        ]
      },
      {
        name: "Concurrent B",
        highlights: [
          "Temps de chargement plus faible",
          "Plus de signaux de confiance",
          "Landing pages mieux segmentées"
        ]
      },
      {
        name: "Votre site",
        highlights: [
          "Base technique saine",
          "Potentiel rapide d’amélioration",
          "Opportunités immédiates exploitables"
        ]
      }
    ],
    tools: [
      {
        name: "Smart SEO Audit",
        description: "Analyse technique, contenu, structure et opportunités immédiates.",
        tag: "Core"
      },
      {
        name: "Uptime Monitoring",
        description: "Surveillance continue du site avec logique d’alerte et historique.",
        tag: "Premium"
      },
      {
        name: "Local Visibility",
        description: "Module dédié au SEO local, réputation et présence maps.",
        tag: "Growth"
      },
      {
        name: "Competitor Watch",
        description: "Comparaison de visibilité et de structure face aux concurrents.",
        tag: "Premium"
      },
      {
        name: "Report Builder",
        description: "Création de rapports clairs, vendables et faciles à partager.",
        tag: "Client-ready"
      },
      {
        name: "Team Workspace",
        description: "Gestion des membres, rôles et accès pour scaler plus facilement.",
        tag: "Ultra"
      },
      {
        name: "Action Center",
        description: "Priorisation automatique des actions les plus rentables.",
        tag: "Automation"
      },
      {
        name: "Lead Opportunity Layer",
        description: "Aide à transformer les données SEO en décisions business concrètes.",
        tag: "Sales"
      },
      {
        name: "Client Proof Mode",
        description: "Présente les résultats de manière plus rassurante et plus premium.",
        tag: "Retention"
      }
    ],
    team: [
      {
        name: "Maël",
        role: "Owner",
        detail: "Accès complet au workspace, au billing et à la configuration globale."
      },
      {
        name: "SEO Manager",
        role: "Manager",
        detail: "Peut lancer des audits, exporter des rapports et gérer les missions."
      },
      {
        name: "Client Viewer",
        role: "Viewer",
        detail: "Peut consulter les rapports et la progression sans modifier les données."
      },
      {
        name: "Tech Ops",
        role: "Editor",
        detail: "Peut gérer les monitors, vérifier la stabilité et corriger les alertes."
      }
    ],
    usage: [
      {
        label: "Audits",
        value: "248 / 2000",
        percent: 12,
        description: "Quota très confortable pour le mois."
      },
      {
        label: "Monitors",
        value: "34 / 300",
        percent: 11,
        description: "Marge de croissance importante."
      },
      {
        label: "PDF",
        value: "126 / 2000",
        percent: 7,
        description: "Capacité suffisante pour scaler."
      },
      {
        label: "Team seats",
        value: "4 / 10",
        percent: 40,
        description: "Des sièges restent disponibles."
      }
    ],
    feed: [
      {
        title: "Nouveau rapport généré",
        text: "Le rapport mensuel a été préparé avec la synthèse SEO, uptime et local.",
        time: "Il y a 12 min"
      },
      {
        title: "Alerte performance détectée",
        text: "Le site artisan-local.be présente une latence inhabituelle sur mobile.",
        time: "Il y a 44 min"
      },
      {
        title: "Opportunité locale identifiée",
        text: "3 nouvelles pages géolocalisées peuvent être créées pour augmenter les leads.",
        time: "Aujourd’hui"
      }
    ]
  };

  const els = {
    body: document.body,
    overlay: document.getElementById("fpOverlay"),
    sidebar: document.getElementById("sidebar"),
    mobileMenuBtn: document.getElementById("mobileMenuBtn"),
    mobileCloseSidebar: document.getElementById("mobileCloseSidebar"),
    pageTitle: document.getElementById("pageTitle"),
    pageSubtitle: document.getElementById("pageSubtitle"),
    navItems: [...document.querySelectorAll(".fpNavItem")],
    pages: [...document.querySelectorAll(".fpPage")],
    themeToggleBtn: document.getElementById("themeToggleBtn"),
    toastWrap: document.getElementById("fpToastWrap"),

    workspaceName: document.getElementById("workspaceName"),
    workspacePlanBadge: document.getElementById("workspacePlanBadge"),
    workspaceNameInput: document.getElementById("workspaceNameInput"),
    alertEmailInput: document.getElementById("alertEmailInput"),
    timezoneSelect: document.getElementById("timezoneSelect"),
    reportFrequencySelect: document.getElementById("reportFrequencySelect"),

    overviewMissionList: document.getElementById("overviewMissionList"),
    missionsList: document.getElementById("missionsList"),
    auditsTableBody: document.getElementById("auditsTableBody"),
    monitorGrid: document.getElementById("monitorGrid"),
    reportsList: document.getElementById("reportsList"),
    competitorList: document.getElementById("competitorList"),
    toolsHub: document.getElementById("toolsHub"),
    teamList: document.getElementById("teamList"),
    usageGrid: document.getElementById("usageGrid"),

    billingPlanName: document.getElementById("billingPlanName"),
    billingPlanDesc: document.getElementById("billingPlanDesc"),
    billingPlanPrice: document.getElementById("billingPlanPrice"),

    runQuickAuditBtn: document.getElementById("runQuickAuditBtn"),
    createAuditBtn: document.getElementById("createAuditBtn"),
    addMonitorBtn: document.getElementById("addMonitorBtn"),
    generateReportBtn: document.getElementById("generateReportBtn"),
    addMissionBtn: document.getElementById("addMissionBtn"),
    saveSettingsBtn: document.getElementById("saveSettingsBtn"),
    openPortalBtn: document.getElementById("openPortalBtn")
  };

  const pageMeta = {
    overview: {
      title: "Overview",
      subtitle: "Votre centre de contrôle SEO, monitoring, reporting et croissance."
    },
    missions: {
      title: "Missions",
      subtitle: "Suivez les actions réalisées pour rendre la valeur visible et rassurante."
    },
    audits: {
      title: "Audits SEO",
      subtitle: "Détectez les problèmes et transformez l’analyse en résultats concrets."
    },
    monitors: {
      title: "Monitors",
      subtitle: "Surveillez la stabilité des sites pour protéger trafic, leads et réputation."
    },
    reports: {
      title: "Reports",
      subtitle: "Générez des livrables premium, compréhensibles et faciles à partager."
    },
    competitors: {
      title: "Competitors",
      subtitle: "Mesurez l’écart avec le marché pour mieux vendre les optimisations."
    },
    "local-seo": {
      title: "Local SEO",
      subtitle: "Boostez visibilité locale, crédibilité et génération de leads."
    },
    tools: {
      title: "Tools",
      subtitle: "Accédez aux briques premium qui rendent FlowPoint plus puissant."
    },
    team: {
      title: "Team",
      subtitle: "Collaboration, rôles et accès pour faire évoluer le produit proprement."
    },
    billing: {
      title: "Billing",
      subtitle: "Présentez clairement le plan, les usages et l’intérêt de continuer."
    },
    settings: {
      title: "Settings",
      subtitle: "Personnalisez votre espace de travail et activez les bons modules."
    }
  };

  function init() {
    applyTheme(appState.theme);
    hydrateWorkspace();
    injectAdvancedBlocks();
    bindEvents();
    ensureHashRoute();
    renderAll();
    keepFakeSessionAlive();
    bootWelcomeToast();
  }

  function injectAdvancedBlocks() {
    injectOverviewPremiumBlocks();
    injectAuditsToolbar();
    injectMissionToolbar();
    injectMonitorsHealth();
    injectReportsFeed();
    injectBillingExtras();
    createGlobalModal();
    createGlobalDrawer();
  }

  function injectOverviewPremiumBlocks() {
    const overviewPage = document.querySelector('.fpPage[data-page="overview"]');
    if (!overviewPage) return;

    const grid = overviewPage.querySelector(".fpGridMain");
    if (!grid) return;

    const block = document.createElement("div");
    block.className = "fpGrid";
    block.innerHTML = `
      <article class="fpPanel fpSpan8 isHighlighted">
        <div class="fpPanelHead">
          <div>
            <h3>Health Center</h3>
            <p>Un résumé premium des points qui rassurent le client et rendent la plateforme plus crédible.</p>
          </div>
          <span class="fpBadge purple">Premium insight</span>
        </div>
        <div class="fpHealthGrid" id="fpHealthGrid"></div>
      </article>

      <article class="fpPanel fpSpan4">
        <div class="fpPanelHead">
          <div>
            <h3>Activity feed</h3>
            <p>Ce qui se passe en direct dans l’espace client.</p>
          </div>
        </div>
        <div class="fpFeedList" id="fpFeedList"></div>
      </article>

      <article class="fpPanel fpSpan12">
        <div class="fpPanelHead">
          <div>
            <h3>Évolution mensuelle</h3>
            <p>Visualisation simple, propre et convaincante pour montrer la progression de la valeur.</p>
          </div>
        </div>
        <div class="fpChartCard">
          <div class="fpPseudoChart" id="fpPseudoChart"></div>
        </div>
      </article>
    `;

    overviewPage.appendChild(block);
  }

  function injectAuditsToolbar() {
    const page = document.querySelector('.fpPage[data-page="audits"]');
    if (!page) return;

    const toolbar = document.createElement("div");
    toolbar.className = "fpFilterBar";
    toolbar.innerHTML = `
      <div class="fpSearchWrap">
        <div class="fpSearchIcon">⌕</div>
        <input class="fpSearchInput" id="auditSearchInput" type="text" placeholder="Rechercher un site, une catégorie, un statut..." />
      </div>

      <div class="fpFilterActions">
        <div class="fpSegmented" id="auditSegmented">
          <button class="fpSegmentedBtn active" data-audit-filter="all" type="button">Tous</button>
          <button class="fpSegmentedBtn" data-audit-filter="high" type="button">Priorité haute</button>
          <button class="fpSegmentedBtn" data-audit-filter="healthy" type="button">Healthy</button>
          <button class="fpSegmentedBtn" data-audit-filter="local" type="button">Local</button>
        </div>
      </div>
    `;

    page.insertBefore(toolbar, page.children[1]);
  }

  function injectMissionToolbar() {
    const page = document.querySelector('.fpPage[data-page="missions"]');
    if (!page) return;

    const toolbar = document.createElement("div");
    toolbar.className = "fpFilterBar";
    toolbar.innerHTML = `
      <div class="fpSearchWrap">
        <div class="fpSearchIcon">✓</div>
        <input class="fpSearchInput" id="missionSearchInput" type="text" placeholder="Rechercher une mission..." />
      </div>

      <div class="fpFilterActions">
        <div class="fpSegmented" id="missionSegmented">
          <button class="fpSegmentedBtn active" data-mission-filter="all" type="button">Toutes</button>
          <button class="fpSegmentedBtn" data-mission-filter="todo" type="button">En cours</button>
          <button class="fpSegmentedBtn" data-mission-filter="done" type="button">Terminées</button>
        </div>
      </div>
    `;

    page.insertBefore(toolbar, page.children[1]);
  }

  function injectMonitorsHealth() {
    const page = document.querySelector('.fpPage[data-page="monitors"]');
    if (!page) return;

    const grid = page.querySelector(".fpGrid");
    if (!grid) return;

    const extra = document.createElement("article");
    extra.className = "fpPanel fpSpan12";
    extra.innerHTML = `
      <div class="fpPanelHead">
        <div>
          <h3>Infrastructure confidence layer</h3>
          <p>Une présentation plus premium du monitoring renforce immédiatement la confiance du client.</p>
        </div>
      </div>
      <div class="fpKpiStrip" id="monitorKpiStrip"></div>
    `;
    grid.appendChild(extra);
  }

  function injectReportsFeed() {
    const page = document.querySelector('.fpPage[data-page="reports"]');
    if (!page) return;

    const grid = page.querySelector(".fpGrid");
    if (!grid) return;

    const extra = document.createElement("article");
    extra.className = "fpPanel fpSpan12";
    extra.innerHTML = `
      <div class="fpPanelHead">
        <div>
          <h3>Checklist de rapport premium</h3>
          <p>Ce bloc aide à vendre des rapports qui paraissent plus complets, plus utiles et plus professionnels.</p>
        </div>
      </div>
      <div class="fpChecklist" id="reportChecklist"></div>
    `;
    grid.appendChild(extra);
  }

  function injectBillingExtras() {
    const page = document.querySelector('.fpPage[data-page="billing"]');
    if (!page) return;

    const grid = page.querySelector(".fpGrid");
    if (!grid) return;

    const extra = document.createElement("article");
    extra.className = "fpPanel fpSpan12";
    extra.innerHTML = `
      <div class="fpPanelHead">
        <div>
          <h3>Pourquoi l’offre est rentable</h3>
          <p>Ce type de bloc améliore fortement la perception de valeur du plan actuel.</p>
        </div>
      </div>
      <div class="fpHealthGrid" id="billingWhyGrid"></div>
    `;
    grid.appendChild(extra);
  }

  function createGlobalModal() {
    if (document.getElementById("fpGlobalModal")) return;

    const modal = document.createElement("div");
    modal.id = "fpGlobalModal";
    modal.className = "fpModal";
    modal.innerHTML = `
      <div class="fpModalLayer" data-close-modal="true"></div>
      <div class="fpModalCard">
        <div class="fpModalHead">
          <div>
            <h3 id="fpModalTitle">Détail</h3>
            <p id="fpModalSubtitle">Informations détaillées.</p>
          </div>
          <button class="fpIconBtn" type="button" data-close-modal="true">✕</button>
        </div>
        <div id="fpModalContent"></div>
        <div class="fpModalActions">
          <button class="fpBtn fpBtnSoft" type="button" data-close-modal="true">Fermer</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function createGlobalDrawer() {
    if (document.getElementById("fpGlobalDrawer")) return;

    const drawer = document.createElement("div");
    drawer.id = "fpGlobalDrawer";
    drawer.className = "fpDrawer";
    drawer.innerHTML = `
      <div class="fpDrawerLayer" data-close-drawer="true"></div>
      <div class="fpDrawerCard">
        <div class="fpDrawerHead">
          <div>
            <h3 id="fpDrawerTitle">Centre d’action</h3>
            <p id="fpDrawerSubtitle">Actions rapides et contexte complémentaire.</p>
          </div>
          <button class="fpIconBtn" type="button" data-close-drawer="true">✕</button>
        </div>
        <div id="fpDrawerContent"></div>
      </div>
    `;
    document.body.appendChild(drawer);
  }

  function bindEvents() {
    window.addEventListener("hashchange", () => {
      const route = (window.location.hash || "#overview").replace("#", "");
      openRoute(route);
    });

    els.navItems.forEach(item => {
      item.addEventListener("click", () => openRoute(item.dataset.route));
    });

    document.addEventListener("click", handleGlobalClick);
    document.addEventListener("input", handleGlobalInput);

    els.mobileMenuBtn?.addEventListener("click", openSidebar);
    els.mobileCloseSidebar?.addEventListener("click", closeSidebar);
    els.overlay?.addEventListener("click", closeSidebar);

    els.themeToggleBtn?.addEventListener("click", () => {
      const nextTheme = appState.theme === "dark" ? "light" : "dark";
      applyTheme(nextTheme);
      toast("Thème mis à jour", `Le mode ${nextTheme === "dark" ? "sombre" : "clair"} est activé.`);
    });

    els.runQuickAuditBtn?.addEventListener("click", () => {
      openRoute("audits");
      toast("Audit prêt", "Le module d’audit est prêt pour un nouveau scan.");
    });

    els.createAuditBtn?.addEventListener("click", () => {
      openAuditQuickModal();
    });

    els.addMonitorBtn?.addEventListener("click", () => {
      openDrawer(
        "Nouveau monitor",
        "Prépare l’ajout d’une nouvelle surveillance.",
        `
          <div class="fpFormGrid">
            <label class="fpField">
              <span>URL du site</span>
              <input type="text" placeholder="https://example.com" />
            </label>
            <label class="fpField">
              <span>Fréquence</span>
              <select>
                <option>1 min</option>
                <option>5 min</option>
                <option selected>15 min</option>
              </select>
            </label>
          </div>
          <div style="height:16px"></div>
          <button class="fpBtn fpBtnPrimary fpBtnBlock" type="button" id="fakeCreateMonitorBtn">Créer le monitor</button>
        `
      );
    });

    els.generateReportBtn?.addEventListener("click", () => {
      toast("Rapport généré", "Le bouton est prêt à être branché sur ton endpoint PDF/CSV.");
    });

    els.addMissionBtn?.addEventListener("click", addMission);

    els.saveSettingsBtn?.addEventListener("click", saveSettings);

    els.openPortalBtn?.addEventListener("click", () => {
      toast("Billing portal", "Branche ici ton endpoint /api/stripe/portal.");
    });

    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openDrawer(
          "Command Center",
          "Raccourcis rapides pour piloter l’interface.",
          `
            <div class="fpChecklist">
              <div class="fpChecklistItem">
                <div class="fpChecklistDot info"></div>
                <div><strong>Ctrl/Cmd + K</strong><p>Ouvre le centre d’action rapide.</p></div>
              </div>
              <div class="fpChecklistItem">
                <div class="fpChecklistDot good"></div>
                <div><strong>Hash routes</strong><p>Chaque page reste accessible par URL simple.</p></div>
              </div>
              <div class="fpChecklistItem">
                <div class="fpChecklistDot warn"></div>
                <div><strong>Theme persistence</strong><p>Le mode clair/sombre reste mémorisé.</p></div>
              </div>
            </div>
          `
        );
      }

      if (e.key === "Escape") {
        closeModal();
        closeDrawer();
        closeSidebar();
      }
    });
  }

  function handleGlobalClick(e) {
    const routeBtn = e.target.closest("[data-route-go]");
    const missionToggle = e.target.closest("[data-mission-toggle]");
    const missionDelete = e.target.closest("[data-mission-delete]");
    const auditFilterBtn = e.target.closest("[data-audit-filter]");
    const missionFilterBtn = e.target.closest("[data-mission-filter]");
    const auditViewBtn = e.target.closest("[data-audit-view]");
    const contactSupportBtn = e.target.closest("[data-action='contact-support']");
    const refreshBtn = e.target.closest("[data-action='refresh-dashboard']");
    const closeModalBtn = e.target.closest("[data-close-modal]");
    const closeDrawerBtn = e.target.closest("[data-close-drawer]");
    const fakeCreateMonitorBtn = e.target.closest("#fakeCreateMonitorBtn");

    if (routeBtn) openRoute(routeBtn.dataset.routeGo);
    if (missionToggle) toggleMission(Number(missionToggle.dataset.missionToggle));
    if (missionDelete) removeMission(Number(missionDelete.dataset.missionDelete));

    if (auditFilterBtn) {
      appState.auditFilter = auditFilterBtn.dataset.auditFilter;
      updateSegmentedState("#auditSegmented", "[data-audit-filter]", appState.auditFilter, "audit-filter");
      renderAudits();
    }

    if (missionFilterBtn) {
      appState.missionFilter = missionFilterBtn.dataset.missionFilter;
      updateSegmentedState("#missionSegmented", "[data-mission-filter]", appState.missionFilter, "mission-filter");
      renderMissions();
    }

    if (auditViewBtn) {
      const id = Number(auditViewBtn.dataset.auditView);
      openAuditDetail(id);
    }

    if (contactSupportBtn) {
      toast("Support", "Tu peux connecter ce bouton à une page support ou un module email.");
    }

    if (refreshBtn) {
      simulateRefresh();
    }

    if (closeModalBtn) closeModal();
    if (closeDrawerBtn) closeDrawer();

    if (fakeCreateMonitorBtn) {
      toast("Monitor créé", "Le monitor a été ajouté visuellement. Branche-le ensuite à ton backend.");
      closeDrawer();
    }
  }

  function handleGlobalInput(e) {
    if (e.target.id === "auditSearchInput") {
      appState.auditSearch = e.target.value.trim().toLowerCase();
      renderAudits();
    }

    if (e.target.id === "missionSearchInput") {
      renderMissions();
    }
  }

  function ensureHashRoute() {
    const route = (window.location.hash || "#overview").replace("#", "");
    openRoute(route);
  }

  function openRoute(route) {
    const finalRoute = pageMeta[route] ? route : "overview";
    appState.route = finalRoute;

    els.navItems.forEach(item => {
      item.classList.toggle("active", item.dataset.route === finalRoute);
    });

    els.pages.forEach(page => {
      page.classList.toggle("active", page.dataset.page === finalRoute);
    });

    els.pageTitle.textContent = pageMeta[finalRoute].title;
    els.pageSubtitle.textContent = pageMeta[finalRoute].subtitle;

    if (window.location.hash !== `#${finalRoute}`) {
      window.location.hash = finalRoute;
    }

    closeSidebar();
  }

  function applyTheme(theme) {
    appState.theme = theme;
    storage.set("fp_theme", theme);
    els.body.classList.toggle("fpLight", theme === "light");
  }

  function openSidebar() {
    els.sidebar?.classList.add("show");
    els.overlay?.classList.add("show");
    els.body.classList.add("fpNoScroll");
  }

  function closeSidebar() {
    els.sidebar?.classList.remove("show");
    els.overlay?.classList.remove("show");
    els.body.classList.remove("fpNoScroll");
  }

  function hydrateWorkspace() {
    if (els.workspaceName) els.workspaceName.textContent = appState.workspace.name;
    if (els.workspacePlanBadge) els.workspacePlanBadge.textContent = appState.workspace.plan;

    if (els.workspaceNameInput) els.workspaceNameInput.value = appState.workspace.name;
    if (els.alertEmailInput) els.alertEmailInput.value = appState.workspace.alertEmail;
    if (els.timezoneSelect) els.timezoneSelect.value = appState.workspace.timezone;
    if (els.reportFrequencySelect) els.reportFrequencySelect.value = appState.workspace.frequency;
  }

  function saveSettings() {
    appState.workspace.name = els.workspaceNameInput?.value.trim() || "FlowPoint AI";
    appState.workspace.alertEmail = els.alertEmailInput?.value.trim() || "alerts@flowpoint.pro";
    appState.workspace.timezone = els.timezoneSelect?.value || "Europe/Brussels";
    appState.workspace.frequency = els.reportFrequencySelect?.value || "monthly";

    storage.set("fp_workspace", appState.workspace);
    hydrateWorkspace();
    renderBilling();
    toast("Paramètres sauvegardés", "Le workspace a été mis à jour avec succès.");
  }

  function renderAll() {
    renderOverviewMissions();
    renderMissions();
    renderAudits();
    renderMonitors();
    renderReports();
    renderCompetitors();
    renderTools();
    renderTeam();
    renderBilling();
    renderOverviewHealth();
    renderOverviewFeed();
    renderPseudoChart();
    renderMonitorKpis();
    renderReportChecklist();
    renderBillingWhy();
  }

  function renderOverviewMissions() {
    if (!els.overviewMissionList) return;

    els.overviewMissionList.innerHTML = appState.missions
      .slice(0, 4)
      .map(m => `
        <div class="fpMiniItem">
          <div>
            <strong>${escapeHtml(m.title)}</strong>
            <p>${escapeHtml(m.description)}</p>
          </div>
          <span class="fpBadge ${m.done ? "good" : "warn"}">
            ${m.done ? "Fait" : "En cours"}
          </span>
        </div>
      `)
      .join("");
  }

  function renderMissions() {
    if (!els.missionsList) return;

    const missionSearch = document.getElementById("missionSearchInput")?.value.trim().toLowerCase() || "";

    let data = [...appState.missions];

    if (appState.missionFilter === "todo") {
      data = data.filter(m => !m.done);
    }
    if (appState.missionFilter === "done") {
      data = data.filter(m => m.done);
    }
    if (missionSearch) {
      data = data.filter(m =>
        `${m.title} ${m.description} ${m.owner} ${m.priority}`.toLowerCase().includes(missionSearch)
      );
    }

    if (!data.length) {
      els.missionsList.innerHTML = `
        <div class="fpEmptyState">
          <div class="fpEmptyStateIcon">✓</div>
          <h4>Aucune mission trouvée</h4>
          <p>Essaie un autre filtre ou ajoute une nouvelle mission.</p>
        </div>
      `;
      return;
    }

    els.missionsList.innerHTML = data
      .map(m => `
        <div class="fpMissionItem">
          <div class="fpMissionMain">
            <button
              class="fpMissionCheck ${m.done ? "done" : ""}"
              type="button"
              data-mission-toggle="${m.id}"
              aria-label="Basculer la mission"
            >✓</button>

            <div>
              <h4>${escapeHtml(m.title)}</h4>
              <p>${escapeHtml(m.description)}</p>
              <div style="height:10px"></div>
              <span class="fpBadge info">${escapeHtml(m.owner)}</span>
              <span class="fpBadge ${m.priority === "Haute" ? "warn" : m.priority === "Moyenne" ? "info" : "good"}">${escapeHtml(m.priority)}</span>
              <span class="fpBadge purple">${escapeHtml(m.eta)}</span>
            </div>
          </div>

          <div class="fpMissionMeta">
            <span class="fpBadge ${m.done ? "good" : "warn"}">
              ${m.done ? "Terminée" : "En cours"}
            </span>

            <button class="fpBtn fpBtnSoft fpBtnSm" type="button" data-mission-delete="${m.id}">
              Supprimer
            </button>
          </div>
        </div>
      `)
      .join("");
  }

  function renderAudits() {
    if (!els.auditsTableBody) return;

    let data = [...appState.audits];

    if (appState.auditFilter === "high") {
      data = data.filter(a => a.priority === "Haute");
    }
    if (appState.auditFilter === "healthy") {
      data = data.filter(a => a.status === "Healthy");
    }
    if (appState.auditFilter === "local") {
      data = data.filter(a => a.category === "local");
    }
    if (appState.auditSearch) {
      data = data.filter(a =>
        `${a.site} ${a.category} ${a.status} ${a.priority} ${a.localPotential}`.toLowerCase().includes(appState.auditSearch)
      );
    }

    if (!data.length) {
      els.auditsTableBody.innerHTML = `
        <tr>
          <td colspan="5">
            <div class="fpEmptyState">
              <div class="fpEmptyStateIcon">⌕</div>
              <h4>Aucun audit correspondant</h4>
              <p>Essaie un autre filtre ou retire une partie de ta recherche.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    els.auditsTableBody.innerHTML = data
      .map(a => {
        const scoreClass = a.score >= 85 ? "good" : a.score >= 70 ? "mid" : "low";
        const badgeClass = a.priority === "Haute" ? "warn" : a.priority === "Moyenne" ? "info" : "good";

        return `
          <tr>
            <td>
              <div class="fpDomainCell">
                <strong>${escapeHtml(a.site)}</strong>
                <small>${escapeHtml(a.category)} • ${escapeHtml(a.status)}</small>
              </div>
            </td>
            <td><span class="fpScore ${scoreClass}">${a.score}/100</span></td>
            <td><span class="fpBadge ${badgeClass}">${escapeHtml(a.priority)}</span></td>
            <td>${escapeHtml(a.lastRun)}</td>
            <td>
              <button class="fpBtn fpBtnSoft fpBtnSm" type="button" data-audit-view="${a.id}">Voir</button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function renderMonitors() {
    if (!els.monitorGrid) return;

    els.monitorGrid.innerHTML = appState.monitors
      .map(m => {
        const badgeClass = m.status === "UP" ? "good" : m.status === "DEGRADED" ? "warn" : "danger";
        return `
          <div class="fpMonitorItem">
            <div class="fpMonitorTop">
              <strong>${escapeHtml(m.site)}</strong>
              <span class="fpBadge ${badgeClass}">${escapeHtml(m.status)}</span>
            </div>
            <div class="fpLatency">${m.latency} ms • ${escapeHtml(m.uptime)}</div>
            <p>${escapeHtml(m.note)}</p>
            <div>
              <span class="fpBadge info">${escapeHtml(String(m.checks))} checks</span>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderReports() {
    if (!els.reportsList) return;

    els.reportsList.innerHTML = appState.reports
      .map(r => `
        <div class="fpReportItem">
          <div>
            <strong>${escapeHtml(r.title)}</strong>
            <p>${escapeHtml(r.description)} • ${escapeHtml(r.date)}</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <span class="fpBadge info">${escapeHtml(r.type)}</span>
            <button class="fpBtn fpBtnSoft fpBtnSm" type="button">Télécharger</button>
          </div>
        </div>
      `)
      .join("");
  }

  function renderCompetitors() {
    if (!els.competitorList) return;

    els.competitorList.innerHTML = appState.competitors
      .map(c => `
        <div class="fpCompareCard">
          <h4>${escapeHtml(c.name)}</h4>
          <ul>
            ${c.highlights.map(item => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </div>
      `)
      .join("");
  }

  function renderTools() {
    if (!els.toolsHub) return;

    els.toolsHub.innerHTML = appState.tools
      .map(t => `
        <div class="fpToolCard">
          <span class="fpBadge info">${escapeHtml(t.tag)}</span>
          <div style="height:10px"></div>
          <strong>${escapeHtml(t.name)}</strong>
          <p>${escapeHtml(t.description)}</p>
          <div style="height:12px"></div>
          <button class="fpBtn fpBtnSoft fpBtnSm" type="button">Activer</button>
        </div>
      `)
      .join("");
  }

  function renderTeam() {
    if (!els.teamList) return;

    els.teamList.innerHTML = appState.team
      .map(member => `
        <div class="fpTeamItem">
          <div>
            <strong>${escapeHtml(member.name)}</strong>
            <p>${escapeHtml(member.detail)}</p>
          </div>
          <span class="fpBadge info">${escapeHtml(member.role)}</span>
        </div>
      `)
      .join("");
  }

  function renderBilling() {
    if (!els.usageGrid) return;

    els.billingPlanName.textContent = appState.workspace.plan;
    els.billingPlanDesc.textContent = appState.workspace.planDescription;
    els.billingPlanPrice.textContent = appState.workspace.planPrice;

    els.usageGrid.innerHTML = appState.usage
      .map(item => `
        <div class="fpUsageCard">
          <strong>${escapeHtml(item.label)}</strong>
          <div style="font-size:1.12rem;font-weight:900;margin-bottom:6px;">${escapeHtml(item.value)}</div>
          <div class="fpProgress">
            <div class="fpProgressFill" style="width:${item.percent}%"></div>
          </div>
          <p>${escapeHtml(item.description)}</p>
        </div>
      `)
      .join("");
  }

  function renderOverviewHealth() {
    const healthGrid = document.getElementById("fpHealthGrid");
    if (!healthGrid) return;

    const avgScore = Math.round(appState.audits.reduce((sum, a) => sum + a.score, 0) / appState.audits.length);
    const degradedCount = appState.monitors.filter(m => m.status !== "UP").length;

    healthGrid.innerHTML = `
      <div class="fpHealthItem">
        <div class="fpHealthTop">
          <strong>Score moyen audits</strong>
          <span class="fpBadge info">Global</span>
        </div>
        <div class="fpHealthValue">${avgScore}/100</div>
        <p>Vue synthétique de la qualité moyenne des sites analysés.</p>
      </div>

      <div class="fpHealthItem">
        <div class="fpHealthTop">
          <strong>Monitors à surveiller</strong>
          <span class="fpBadge ${degradedCount ? "warn" : "good"}">${degradedCount}</span>
        </div>
        <div class="fpHealthValue">${degradedCount ? "Attention" : "Stable"}</div>
        <p>Nombre de sites qui méritent une vérification plus poussée.</p>
      </div>

      <div class="fpHealthItem">
        <div class="fpHealthTop">
          <strong>Potentiel local</strong>
          <span class="fpBadge purple">Business</span>
        </div>
        <div class="fpHealthValue">Élevé</div>
        <p>Le mix SEO local + pages géolocalisées peut générer plus de leads qualifiés.</p>
      </div>

      <div class="fpHealthItem">
        <div class="fpHealthTop">
          <strong>Perception premium</strong>
          <span class="fpBadge good">Forte</span>
        </div>
        <div class="fpHealthValue">Très bonne</div>
        <p>Le dashboard explique bien la valeur et renforce la crédibilité du produit.</p>
      </div>
    `;
  }

  function renderOverviewFeed() {
    const feed = document.getElementById("fpFeedList");
    if (!feed) return;

    feed.innerHTML = appState.feed
      .map(item => `
        <div class="fpFeedItem">
          <div class="fpFeedTop">
            <strong>${escapeHtml(item.title)}</strong>
            <span class="fpFeedTime">${escapeHtml(item.time)}</span>
          </div>
          <p>${escapeHtml(item.text)}</p>
        </div>
      `)
      .join("");
  }

  function renderPseudoChart() {
    const chart = document.getElementById("fpPseudoChart");
    if (!chart) return;

    const values = [
      { label: "Oct", v: 42 },
      { label: "Nov", v: 55 },
      { label: "Déc", v: 61 },
      { label: "Jan", v: 74 },
      { label: "Fév", v: 82 },
      { label: "Mars", v: 92 }
    ];

    chart.innerHTML = values
      .map(item => `
        <div class="fpBar" data-label="${escapeHtml(item.label)}" style="height:${item.v}%"></div>
      `)
      .join("");
  }

  function renderMonitorKpis() {
    const strip = document.getElementById("monitorKpiStrip");
    if (!strip) return;

    const avgLatency = Math.round(
      appState.monitors.reduce((sum, m) => sum + m.latency, 0) / appState.monitors.length
    );
    const healthy = appState.monitors.filter(m => m.status === "UP").length;

    strip.innerHTML = `
      <div class="fpKpiItem">
        <strong>${appState.monitors.length}</strong>
        <span>Monitors actifs</span>
      </div>
      <div class="fpKpiItem">
        <strong>${healthy}</strong>
        <span>Sites stables</span>
      </div>
      <div class="fpKpiItem">
        <strong>${avgLatency} ms</strong>
        <span>Latence moyenne</span>
      </div>
      <div class="fpKpiItem">
        <strong>24/7</strong>
        <span>Surveillance continue</span>
      </div>
    `;
  }

  function renderReportChecklist() {
    const list = document.getElementById("reportChecklist");
    if (!list) return;

    list.innerHTML = `
      <div class="fpChecklistItem">
        <div class="fpChecklistDot good"></div>
        <div>
          <strong>Résumé exécutif</strong>
          <p>Une synthèse claire pour les dirigeants et clients non techniques.</p>
        </div>
      </div>
      <div class="fpChecklistItem">
        <div class="fpChecklistDot info"></div>
        <div>
          <strong>Actions prioritaires</strong>
          <p>Une section qui montre quoi faire en premier et pourquoi.</p>
        </div>
      </div>
      <div class="fpChecklistItem">
        <div class="fpChecklistDot warn"></div>
        <div>
          <strong>Valeur business</strong>
          <p>Lier les recommandations à la visibilité, la conversion et les leads.</p>
        </div>
      </div>
      <div class="fpChecklistItem">
        <div class="fpChecklistDot good"></div>
        <div>
          <strong>Preuve de progression</strong>
          <p>Montrer l’évolution dans le temps augmente la rétention.</p>
        </div>
      </div>
    `;
  }

  function renderBillingWhy() {
    const grid = document.getElementById("billingWhyGrid");
    if (!grid) return;

    grid.innerHTML = `
      <div class="fpInfoBox">
        <strong>Centralisation</strong>
        <p>SEO, uptime, local, reporting et missions au même endroit.</p>
      </div>
      <div class="fpInfoBox">
        <strong>Scalabilité</strong>
        <p>L’espace est prêt pour accueillir plus de sites, plus de membres et plus de clients.</p>
      </div>
      <div class="fpInfoBox">
        <strong>Livrables premium</strong>
        <p>Les rapports sont plus faciles à vendre et à justifier auprès des clients finaux.</p>
      </div>
      <div class="fpInfoBox">
        <strong>Rétention plus forte</strong>
        <p>Plus le client voit la valeur, moins il a envie de partir.</p>
      </div>
    `;
  }

  function addMission() {
    const newMission = {
      id: Date.now(),
      title: "Nouvelle mission stratégique",
      description: "Mission créée pour suivre une action supplémentaire à forte valeur business.",
      done: false,
      priority: "Haute",
      owner: "Owner",
      eta: "3 jours"
    };
    appState.missions.unshift(newMission);
    persistMissions();
    renderOverviewMissions();
    renderMissions();
    toast("Mission ajoutée", "Une nouvelle mission a été créée.");
  }

  function toggleMission(id) {
    const mission = appState.missions.find(m => m.id === id);
    if (!mission) return;

    mission.done = !mission.done;
    mission.eta = mission.done ? "Terminé" : "2 jours";
    persistMissions();
    renderOverviewMissions();
    renderMissions();
    toast(
      mission.done ? "Mission terminée" : "Mission réouverte",
      mission.done ? "La mission est désormais marquée comme terminée." : "La mission est repassée en cours."
    );
  }

  function removeMission(id) {
    appState.missions = appState.missions.filter(m => m.id !== id);
    persistMissions();
    renderOverviewMissions();
    renderMissions();
    toast("Mission supprimée", "La mission a été retirée de la liste.");
  }

  function persistMissions() {
    storage.set("fp_missions", appState.missions);
  }

  function updateSegmentedState(containerSelector, buttonSelector, value, dataKey) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    container.querySelectorAll(buttonSelector).forEach(btn => {
      btn.classList.toggle("active", btn.dataset[toCamel(dataKey)] === value || btn.dataset[dataKey] === value);
    });
  }

  function openAuditDetail(id) {
    const audit = appState.audits.find(a => a.id === id);
    if (!audit) return;

    appState.selectedAudit = audit;

    openModal(
      `Audit — ${audit.site}`,
      "Détail premium de l’analyse, pensé pour rassurer le client et faciliter la décision.",
      `
        <div class="fpHealthGrid">
          <div class="fpInfoBox">
            <strong>Score global</strong>
            <p><span class="fpScore ${audit.score >= 85 ? "good" : audit.score >= 70 ? "mid" : "low"}">${audit.score}/100</span></p>
          </div>
          <div class="fpInfoBox">
            <strong>Priorité</strong>
            <p>${escapeHtml(audit.priority)}</p>
          </div>
          <div class="fpInfoBox">
            <strong>Opportunités</strong>
            <p>${escapeHtml(String(audit.opportunities))} pistes exploitables rapidement.</p>
          </div>
          <div class="fpInfoBox">
            <strong>Issues détectées</strong>
            <p>${escapeHtml(String(audit.issueCount))} points à corriger ou améliorer.</p>
          </div>
        </div>

        <div style="height:16px"></div>

        <div class="fpChecklist">
          <div class="fpChecklistItem">
            <div class="fpChecklistDot info"></div>
            <div>
              <strong>Analyse technique</strong>
              <p>${escapeHtml(audit.tech)}</p>
            </div>
          </div>
          <div class="fpChecklistItem">
            <div class="fpChecklistDot good"></div>
            <div>
              <strong>Potentiel local</strong>
              <p>${escapeHtml(audit.localPotential)}</p>
            </div>
          </div>
          <div class="fpChecklistItem">
            <div class="fpChecklistDot warn"></div>
            <div>
              <strong>Évolution trafic</strong>
              <p>${escapeHtml(audit.traffic)}</p>
            </div>
          </div>
        </div>
      `
    );
  }

  function openAuditQuickModal() {
    openModal(
      "Lancer un audit",
      "Prépare un nouveau scan SEO complet.",
      `
        <div class="fpFormGrid">
          <label class="fpField">
            <span>URL du site</span>
            <input type="text" placeholder="https://monsite.com" />
          </label>
          <label class="fpField">
            <span>Type d’analyse</span>
            <select>
              <option>Complet</option>
              <option>Technique</option>
              <option>Local SEO</option>
              <option>Concurrentiel</option>
            </select>
          </label>
        </div>
        <div style="height:16px"></div>
        <button class="fpBtn fpBtnPrimary fpBtnBlock" type="button" onclick="this.disabled=true;this.textContent='Audit en préparation...'">Préparer l’audit</button>
      `
    );
  }

  function openModal(title, subtitle, content) {
    const modal = document.getElementById("fpGlobalModal");
    if (!modal) return;

    const titleEl = document.getElementById("fpModalTitle");
    const subEl = document.getElementById("fpModalSubtitle");
    const contentEl = document.getElementById("fpModalContent");

    titleEl.textContent = title;
    subEl.textContent = subtitle;
    contentEl.innerHTML = content;

    modal.classList.add("show");
    appState.modalOpen = true;
    els.body.classList.add("fpNoScroll");
  }

  function closeModal() {
    const modal = document.getElementById("fpGlobalModal");
    if (!modal || !appState.modalOpen) return;

    modal.classList.remove("show");
    appState.modalOpen = false;
    if (!appState.drawerOpen) els.body.classList.remove("fpNoScroll");
  }

  function openDrawer(title, subtitle, content) {
    const drawer = document.getElementById("fpGlobalDrawer");
    if (!drawer) return;

    const titleEl = document.getElementById("fpDrawerTitle");
    const subEl = document.getElementById("fpDrawerSubtitle");
    const contentEl = document.getElementById("fpDrawerContent");

    titleEl.textContent = title;
    subEl.textContent = subtitle;
    contentEl.innerHTML = content;

    drawer.classList.add("show");
    appState.drawerOpen = true;
    els.body.classList.add("fpNoScroll");
  }

  function closeDrawer() {
    const drawer = document.getElementById("fpGlobalDrawer");
    if (!drawer || !appState.drawerOpen) return;

    drawer.classList.remove("show");
    appState.drawerOpen = false;
    if (!appState.modalOpen) els.body.classList.remove("fpNoScroll");
  }

  function simulateRefresh() {
    toast("Dashboard actualisé", "Les données visibles ont été rafraîchies.");
  }

  function bootWelcomeToast() {
    setTimeout(() => {
      toast("FlowPoint prêt", "Le dashboard premium est chargé et prêt à être branché à ton backend.");
    }, 450);
  }

  function keepFakeSessionAlive() {
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");

    if (!token) {
      console.info("Aucun token local détecté. Pas de redirection forcée.");
      return;
    }

    try {
      localStorage.setItem("token", token);
    } catch (err) {
      console.warn("Impossible de persister le token localement.", err);
    }
  }

  function toast(title, message) {
    if (!els.toastWrap) return;

    const node = document.createElement("div");
    node.className = "fpToast";
    node.innerHTML = `
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(message)}</p>
    `;

    els.toastWrap.appendChild(node);

    setTimeout(() => {
      node.classList.add("isClosing");
    }, 2600);

    setTimeout(() => {
      node.remove();
    }, 3000);
  }

  function toCamel(value) {
    return value.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  init();
})();
