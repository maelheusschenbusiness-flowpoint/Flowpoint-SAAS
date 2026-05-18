/* =========================================================
   FLOWPOINT DASHBOARD ENGINE V3
========================================================= */

(() => {

  'use strict';

  /* =======================================================
     CONFIG
  ======================================================= */

  const API_BASE =
    window.FLOWPOINT_CONFIG?.API_BASE || '';

  const APP_VERSION =
    window.FLOWPOINT_CONFIG?.VERSION || 'v3';

  /* =======================================================
     STATE
  ======================================================= */

  const state = {

    route:
      'overview',

    loading:
      true,

    mobileSidebar:
      false,

    user:
      null,

    org:
      null,

    plan:
      'pro',

    monitors:
      [],

    audits:
      [],

    reports:
      [],

    missions:
      [],

    notes:
      [],

    alerts:
      [],

    team:
      [],

    chat:
      [],

    competitors:
      [],

    localSeo:
      [],

    exports:
      [],

    stats: {

      uptime:
        99.98,

      audits:
        142,

      reports:
        84,

      monitors:
        22,

    },

  };

  /* =======================================================
     ROOT
  ======================================================= */

  const root =
    document.getElementById(
      'app'
    );

  /* =======================================================
     ROUTES
  ======================================================= */

  const routes = [

    {
      key:'overview',
      label:'Overview',
      icon:'📊',
    },

    {
      key:'missions',
      label:'Missions',
      icon:'🎯',
    },

    {
      key:'audits',
      label:'Audits',
      icon:'🧠',
    },

    {
      key:'monitors',
      label:'Monitoring',
      icon:'🛰️',
    },

    {
      key:'reports',
      label:'Rapports',
      icon:'📑',
    },

    {
      key:'team',
      label:'Équipe',
      icon:'👥',
    },

    {
      key:'calendar',
      label:'Calendrier',
      icon:'📅',
    },

    {
      key:'notes',
      label:'Notes',
      icon:'📝',
    },

    {
      key:'local-seo',
      label:'Local SEO',
      icon:'📍',
    },

    {
      key:'competitors',
      label:'Concurrents',
      icon:'⚔️',
    },

    {
      key:'alerts',
      label:'Alertes',
      icon:'🚨',
    },

    {
      key:'exports',
      label:'Exports',
      icon:'📦',
    },

    {
      key:'billing',
      label:'Facturation',
      icon:'💳',
    },

    {
      key:'settings',
      label:'Paramètres',
      icon:'⚙️',
    },

  ];

  /* =======================================================
     HELPERS
  ======================================================= */

  function qs(selector){

    return document.querySelector(
      selector
    );
  }

  function qsa(selector){

    return [
      ...document.querySelectorAll(
        selector
      )
    ];
  }

  function setRoute(route){

    state.route = route;

    localStorage.setItem(
      'fp_route',
      route
    );

    render();
  }

  function escapeHtml(str=''){

    return str
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;');
  }

  function formatNumber(num){

    return Intl.NumberFormat(
      'fr-FR'
    ).format(num);
  }

  function toast(
    text,
    type='info'
  ){

    const wrap =
      document.getElementById(
        'fpToastWrap'
      );

    const el =
      document.createElement(
        'div'
      );

    el.className =
      `fp-toast fp-toast${
        type.charAt(0)
          .toUpperCase()
        +
        type.slice(1)
      }`;

    el.innerHTML = `
      <div class="fp-font700">
        ${escapeHtml(text)}
      </div>
    `;

    wrap.appendChild(el);

    setTimeout(() => {

      el.remove();

    }, 3200);
  }

  async function api(

    path,

    options = {}

  ){

    const response =
      await fetch(

        API_BASE + path,

        {

          credentials:
            'include',

          headers: {

            'Content-Type':
              'application/json',

            ...(options.headers || {}),

          },

          ...options,

        }
      );

    const data =
      await response.json();

    if(!response.ok){

      throw new Error(
        data?.error ||
        'Erreur API'
      );
    }

    return data;
  }

  /* =======================================================
     SIDEBAR
  ======================================================= */

  function renderSidebar(){

    return `

      <aside class="fp-sidebar ${state.mobileSidebar ? 'mobileOpen' : ''}">

        <div class="fp-sidebarTop">

          <div class="fp-brand">

            <div class="fp-brandLogo">

              <img
                src="/assets/flowpoint-logo.svg"
                alt="FlowPoint"
              />

            </div>

            <div>

              <div class="fp-brandTitle">
                FlowPoint
              </div>

              <div class="fp-brandSub">
                Workspace premium
              </div>

            </div>

          </div>

        </div>

        <div class="fp-nav">

          <div class="fp-navSection">

            <div class="fp-navLabel">
              Dashboard
            </div>

            <div class="fp-navList">

              ${routes.map(route => `

                <div

                  class="fp-navItem ${
                    state.route === route.key
                      ? 'active'
                      : ''
                  }"

                  data-route="${route.key}"

                >

                  <div class="fp-navIcon">
                    ${route.icon}
                  </div>

                  <div class="fp-navText">
                    ${route.label}
                  </div>

                </div>

              `).join('')}

            </div>

          </div>

        </div>

        <div class="fp-sidebarFooter">

          <div class="fp-workspaceCard">

            <div class="fp-workspaceTitle">
              Plan ${state.plan}
            </div>

            <div class="fp-workspaceText">
              Monitoring, IA,
              rapports et collaboration actifs.
            </div>

          </div>

        </div>

      </aside>

    `;
  }

  /* =======================================================
     TOPBAR
  ======================================================= */

  function renderTopbar(){

    const current =
      routes.find(
        x => x.key === state.route
      );

    return `

      <div class="fp-topbar">

        <div class="fp-topbarLeft">

          <button
            class="fp-iconBtn fp-mobileMenuBtn"
            id="fpMobileMenuBtn"
          >
            ☰
          </button>

          <div>

            <div class="fp-pageTitle">
              ${current?.label || 'Dashboard'}
            </div>

            <div class="fp-pageSub">
              Workspace FlowPoint premium
            </div>

          </div>

        </div>

        <div class="fp-topbarRight">

          <button
            class="fp-btn fp-btnGhost"
            id="fpRefreshBtn"
          >
            Actualiser
          </button>

          <button
            class="fp-btn fp-btnPrimary"
            id="fpNewBtn"
          >
            Nouveau
          </button>

        </div>

      </div>

    `;
  }

  /* =======================================================
     OVERVIEW
  ======================================================= */

  function renderOverview(){

    return `

      <div class="fp-page">

        <div class="fp-card fp-overviewHero">

          <div class="fp-cardBody fp-overviewHeroContent">

            <div class="fp-overviewHeroTop">

              <div>

                <div class="fp-overviewTitle">
                  Centre de contrôle
                </div>

                <div class="fp-overviewText">

                  Vue exécutive du workspace :
                  monitoring temps réel,
                  rapports, SEO,
                  audits IA et activité équipe.

                </div>

                <div class="fp-overviewBadges">

                  <div class="fp-overviewBadge">
                    Monitoring actif
                  </div>

                  <div class="fp-overviewBadge">
                    IA connectée
                  </div>

                  <div class="fp-overviewBadge">
                    Rapports premium
                  </div>

                </div>

              </div>

            </div>

          </div>

        </div>

        <div class="fp-kpiGrid">

          <div class="fp-kpiCard">

            <div class="fp-kpiTop">

              <div class="fp-kpiLabel">
                Uptime global
              </div>

              <div class="fp-kpiIcon">
                🛰️
              </div>

            </div>

            <div class="fp-kpiValue">
              ${state.stats.uptime}%
            </div>

            <div class="fp-kpiBottom">

              <div class="fp-kpiTrend fp-kpiTrendUp">
                +0.2%
              </div>

            </div>

          </div>

          <div class="fp-kpiCard">

            <div class="fp-kpiTop">

              <div class="fp-kpiLabel">
                Audits
              </div>

              <div class="fp-kpiIcon">
                🧠
              </div>

            </div>

            <div class="fp-kpiValue">
              ${formatNumber(
                state.stats.audits
              )}
            </div>

          </div>

          <div class="fp-kpiCard">

            <div class="fp-kpiTop">

              <div class="fp-kpiLabel">
                Rapports
              </div>

              <div class="fp-kpiIcon">
                📑
              </div>

            </div>

            <div class="fp-kpiValue">
              ${formatNumber(
                state.stats.reports
              )}
            </div>

          </div>

          <div class="fp-kpiCard">

            <div class="fp-kpiTop">

              <div class="fp-kpiLabel">
                Moniteurs
              </div>

              <div class="fp-kpiIcon">
                🚨
              </div>

            </div>

            <div class="fp-kpiValue">
              ${formatNumber(
                state.stats.monitors
              )}
            </div>

          </div>

        </div>

      </div>

    `;
  }

  /* =======================================================
     PAGE ROUTER
  ======================================================= */

  function renderPage(){

    switch(state.route){

      case 'overview':
        return renderOverview();

      default:
        return `
          <div class="fp-content">

            <div class="fp-card">

              <div class="fp-cardBody">

                <div class="fp-sectionTitle">
                  ${state.route}
                </div>

                <div class="fp-sectionText">
                  Module en cours de chargement.
                </div>

              </div>

            </div>

          </div>
        `;
    }
  }

  /* =======================================================
     MAIN RENDER
  ======================================================= */

  function render(){

    root.innerHTML = `

      <div class="fp-layout">

        ${renderSidebar()}

        <main class="fp-main">

          ${renderTopbar()}

          <div class="fp-content">

            ${renderPage()}

          </div>

        </main>

      </div>

      <div class="
        fp-mobileOverlay
        ${state.mobileSidebar ? 'active' : ''}
      "></div>

    `;

    bindEvents();
  }

})();
/* =========================================================
   MISSIONS PAGE
========================================================= */

function renderMissions(){

  const missions = [

    {

      title:
        'Optimiser les pages locales',

      priority:
        'critical',

      text:
        'Créer des landing pages géolocalisées et améliorer les balises SEO locales.',

      progress:
        42,

    },

    {

      title:
        'Réduire le temps de chargement',

      priority:
        'medium',

      text:
        'Compresser les assets critiques et améliorer le cache navigateur.',

      progress:
        68,

    },

    {

      title:
        'Corriger les erreurs uptime',

      priority:
        'critical',

      text:
        'Stabiliser les endpoints surveillés et corriger les réponses 500.',

      progress:
        23,

    },

    {

      title:
        'Augmenter les conversions',

      priority:
        'low',

      text:
        'Optimiser les CTA et améliorer le tunnel onboarding.',

      progress:
        81,

    },

  ];

  return `

    <div class="fp-page">

      <div class="fp-filterBar">

        <div class="fp-filterLeft">

          <div class="fp-search">

            <span class="fp-searchIcon">
              🔎
            </span>

            <input
              placeholder="Rechercher une mission..."
            />

          </div>

        </div>

        <div class="fp-filterRight">

          <button class="fp-btn fp-btnGhost">
            Filtrer
          </button>

          <button class="fp-btn fp-btnPrimary">
            Nouvelle mission
          </button>

        </div>

      </div>

      <div class="fp-missionGrid">

        ${missions.map(mission => `

          <div class="fp-missionCard">

            <div class="fp-missionTop">

              <div class="fp-missionTitle">
                ${mission.title}
              </div>

              <div class="
                fp-missionPriority

                ${
                  mission.priority === 'critical'
                    ? 'fp-priorityCritical'
                    : mission.priority === 'medium'
                      ? 'fp-priorityMedium'
                      : 'fp-priorityLow'
                }
              ">

                ${
                  mission.priority === 'critical'
                    ? 'CRITIQUE'
                    : mission.priority === 'medium'
                      ? 'MOYEN'
                      : 'LOW'
                }

              </div>

            </div>

            <div class="fp-missionText">
              ${mission.text}
            </div>

            <div class="fp-mt20">

              <div class="fp-progress">

                <div
                  class="fp-progressBar"
                  style="
                    width:${mission.progress}%
                  "
                ></div>

              </div>

            </div>

            <div class="fp-missionBottom">

              <div class="fp-muted fp-textSm">
                ${mission.progress}% terminé
              </div>

              <button
                class="fp-btn fp-btnGhost"
              >
                Ouvrir
              </button>

            </div>

          </div>

        `).join('')}

      </div>

    </div>

  `;
}

/* =========================================================
   AUDITS PAGE
========================================================= */

function renderAudits(){

  const audits = [

    {

      domain:
        'flowpoint.pro',

      score:
        91,

      date:
        'Aujourd’hui',

      insights: [

        'Core Web Vitals excellents',

        '2 pages locales manquantes',

        'Meta descriptions optimisables',

      ],

    },

    {

      domain:
        'client-agency.com',

      score:
        78,

      date:
        'Hier',

      insights: [

        'Temps de réponse serveur élevé',

        'Backlinks faibles',

        'Pages indexées correctement',

      ],

    },

  ];

  return `

    <div class="fp-page">

      <div class="fp-auditGrid">

        ${audits.map(audit => `

          <div class="fp-auditCard">

            <div class="fp-auditTop">

              <div>

                <div class="fp-auditDomain">
                  ${audit.domain}
                </div>

                <div class="fp-auditDate">
                  ${audit.date}
                </div>

              </div>

              <div class="fp-auditScore">
                ${audit.score}
              </div>

            </div>

            <div class="fp-auditInsights">

              ${audit.insights.map(
                insight => `

                  <div class="fp-auditInsight">
                    ${insight}
                  </div>

                `
              ).join('')}

            </div>

            <div class="fp-mt20">

              <button
                class="fp-btn fp-btnPrimary"
              >
                Voir rapport
              </button>

            </div>

          </div>

        `).join('')}

      </div>

    </div>

  `;
}

/* =========================================================
   MONITORS PAGE
========================================================= */

function renderMonitors(){

  const monitors = [

    {

      name:
        'Main API',

      url:
        'https://api.flowpoint.pro',

      status:
        'up',

      uptime:
        '99.99%',

      latency:
        '124ms',

    },

    {

      name:
        'Landing',

      url:
        'https://flowpoint.pro',

      status:
        'up',

      uptime:
        '99.97%',

      latency:
        '98ms',

    },

    {

      name:
        'Client Dashboard',

      url:
        'https://dashboard.flowpoint.pro',

      status:
        'down',

      uptime:
        '94.12%',

      latency:
        'Timeout',

    },

  ];

  return `

    <div class="fp-page">

      <div class="fp-monitorGrid">

        ${monitors.map(monitor => `

          <div class="fp-monitorCard">

            <div class="fp-monitorTop">

              <div>

                <div class="fp-monitorName">
                  ${monitor.name}
                </div>

                <div class="fp-monitorUrl">
                  ${monitor.url}
                </div>

              </div>

              <div class="
                fp-monitorStatus
                ${monitor.status}
              "></div>

            </div>

            <div class="fp-monitorMetrics">

              <div class="fp-monitorMetric">

                <div class="fp-monitorMetricValue">
                  ${monitor.uptime}
                </div>

                <div class="fp-monitorMetricLabel">
                  Uptime
                </div>

              </div>

              <div class="fp-monitorMetric">

                <div class="fp-monitorMetricValue">
                  ${monitor.latency}
                </div>

                <div class="fp-monitorMetricLabel">
                  Latence
                </div>

              </div>

            </div>

            <div class="fp-mt20">

              <button
                class="fp-btn fp-btnGhost"
              >
                Historique
              </button>

            </div>

          </div>

        `).join('')}

      </div>

    </div>

  `;
}

/* =========================================================
   REPORTS PAGE
========================================================= */

function renderReports(){

  const reports = [

    {

      title:
        'Executive SEO Report',

      text:
        'Résumé premium des performances SEO, uptime et optimisation locale.',

      stats: [

        'PDF',

        'SEO',

        'Analytics',

      ],

    },

    {

      title:
        'Monitoring Incident Report',

      text:
        'Historique détaillé des incidents, alertes et temps de réponse.',

      stats: [

        'Monitoring',

        'Latency',

        'Alerts',

      ],

    },

  ];

  return `

    <div class="fp-page">

      <div class="fp-reportGrid">

        ${reports.map(report => `

          <div class="fp-reportCard">

            <div class="fp-reportTop">

              <div>

                <div class="fp-reportTitle">
                  ${report.title}
                </div>

                <div class="fp-reportText">
                  ${report.text}
                </div>

              </div>

            </div>

            <div class="fp-reportStats">

              ${report.stats.map(stat => `

                <div class="fp-reportStat">
                  ${stat}
                </div>

              `).join('')}

            </div>

            <div class="fp-mt24">

              <button
                class="fp-btn fp-btnPrimary"
              >
                Exporter
              </button>

            </div>

          </div>

        `).join('')}

      </div>

    </div>

  `;
}
/* =========================================================
   TEAM PAGE
========================================================= */

function renderTeam(){

  const members = [

    {

      name:
        'Alex Martin',

      role:
        'SEO Manager',

      email:
        'alex@flowpoint.pro',

    },

    {

      name:
        'Sarah Klein',

      role:
        'Monitoring Lead',

      email:
        'sarah@flowpoint.pro',

    },

    {

      name:
        'Lucas Bernard',

      role:
        'Growth Operator',

      email:
        'lucas@flowpoint.pro',

    },

  ];

  const messages = [

    {

      author:
        'Alex',

      text:
        'Les nouvelles pages locales sont indexées.',

      time:
        '09:12',

    },

    {

      author:
        'Sarah',

      text:
        'Incident API résolu sur le cluster principal.',

      time:
        '10:44',

    },

    {

      author:
        'Lucas',

      text:
        'Le nouveau rapport PDF premium est prêt.',

      time:
        '11:27',

    },

  ];

  return `

    <div class="fp-page">

      <div class="fp-grid2">

        <!-- TEAM -->

        <div class="fp-card">

          <div class="fp-cardHeader">

            <div class="fp-cardTitle">
              Équipe
            </div>

            <button
              class="fp-btn fp-btnPrimary"
            >
              Inviter
            </button>

          </div>

          <div class="fp-cardBody">

            <div class="fp-list">

              ${members.map(member => `

                <div class="fp-userCard">

                  <div class="fp-userAvatar">

                    ${member.name
                      .split(' ')
                      .map(x => x[0])
                      .join('')
                    }

                  </div>

                  <div>

                    <div class="fp-userName">
                      ${member.name}
                    </div>

                    <div class="fp-userEmail">
                      ${member.role}
                    </div>

                    <div class="fp-userEmail">
                      ${member.email}
                    </div>

                  </div>

                </div>

              `).join('')}

            </div>

          </div>

        </div>

        <!-- CHAT -->

        <div class="fp-card">

          <div class="fp-cardHeader">

            <div class="fp-cardTitle">
              Team Chat
            </div>

          </div>

          <div class="fp-cardBody">

            <div class="fp-chatWrap">

              <div class="fp-chatMessages">

                ${messages.map(message => `

                  <div class="fp-chatMessage">

                    <div class="fp-chatAvatar">
                      ${message.author[0]}
                    </div>

                    <div class="fp-chatBubble">

                      <div class="fp-chatAuthor">
                        ${message.author}
                      </div>

                      <div class="fp-chatText">
                        ${message.text}
                      </div>

                      <div class="fp-chatTime">
                        ${message.time}
                      </div>

                    </div>

                  </div>

                `).join('')}

              </div>

              <div class="fp-chatComposer">

                <input
                  class="fp-input"
                  placeholder="Écrire un message..."
                />

                <button
                  class="fp-btn fp-btnPrimary"
                >
                  Envoyer
                </button>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   CALENDAR PAGE
========================================================= */

function renderCalendar(){

  const days = [

    'Lun',
    'Mar',
    'Mer',
    'Jeu',
    'Ven',
    'Sam',
    'Dim',

  ];

  return `

    <div class="fp-page">

      <div class="fp-card">

        <div class="fp-cardHeader">

          <div class="fp-cardTitle">
            Calendrier
          </div>

          <button
            class="fp-btn fp-btnPrimary"
          >
            Nouvel évènement
          </button>

        </div>

        <div class="fp-cardBody">

          <div class="fp-calendarGrid">

            ${days.map((day,index) => `

              <div class="fp-calendarDay">

                <div class="fp-calendarDate">
                  ${day} ${index + 12}
                </div>

                <div class="fp-calendarEvent">
                  Audit SEO client
                </div>

                <div class="fp-calendarEvent">
                  Monitoring review
                </div>

              </div>

            `).join('')}

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   NOTES PAGE
========================================================= */

function renderNotes(){

  const notes = [

    {

      title:
        'SEO Quick Wins',

      badge:
        'SEO',

      text:
        'Créer davantage de pages locales pour booster le trafic organique.',

      date:
        'Aujourd’hui',

    },

    {

      title:
        'Infrastructure',

      badge:
        'DEVOPS',

      text:
        'Migrer certains endpoints critiques sur cluster dédié.',

      date:
        'Hier',

    },

    {

      title:
        'Growth Ideas',

      badge:
        'GROWTH',

      text:
        'Ajouter plus d’automatisation dans les exports et onboarding.',

      date:
        'Cette semaine',

    },

  ];

  return `

    <div class="fp-page">

      <div class="fp-filterBar">

        <div class="fp-filterLeft">

          <button
            class="fp-btn fp-btnPrimary"
          >
            Nouvelle note
          </button>

        </div>

      </div>

      <div class="fp-notesGrid">

        ${notes.map(note => `

          <div class="fp-noteCard">

            <div class="fp-noteTop">

              <div class="fp-noteTitle">
                ${note.title}
              </div>

              <div class="fp-noteBadge">
                ${note.badge}
              </div>

            </div>

            <div class="fp-noteText">
              ${note.text}
            </div>

            <div class="fp-noteFooter">

              <div class="fp-noteDate">
                ${note.date}
              </div>

              <button
                class="fp-btn fp-btnGhost"
              >
                Ouvrir
              </button>

            </div>

          </div>

        `).join('')}

      </div>

    </div>

  `;
}

/* =========================================================
   ALERTS PAGE
========================================================= */

function renderAlerts(){

  const alerts = [

    {

      type:
        'danger',

      title:
        'Incident API détecté',

      text:
        'Le cluster monitoring principal répond lentement.',

      meta:
        'Il y a 4 minutes',

    },

    {

      type:
        'warning',

      title:
        'SEO local incomplet',

      text:
        'Certaines villes importantes ne possèdent pas encore de landing pages.',

      meta:
        'Aujourd’hui',

    },

    {

      type:
        'success',

      title:
        'Rapports générés',

      text:
        'Tous les exports PDF ont été créés avec succès.',

      meta:
        'Aujourd’hui',

    },

  ];

  return `

    <div class="fp-page">

      <div class="fp-alertCenter">

        ${alerts.map(alert => `

          <div class="fp-alertCard">

            <div class="
              fp-alertIcon
              ${alert.type}
            ">

              ${
                alert.type === 'danger'
                  ? '⚠️'
                  : alert.type === 'warning'
                    ? '🟠'
                    : '✅'
              }

            </div>

            <div class="fp-alertContent">

              <div class="fp-alertTitle">
                ${alert.title}
              </div>

              <div class="fp-alertText">
                ${alert.text}
              </div>

              <div class="fp-alertMeta">
                ${alert.meta}
              </div>

            </div>

          </div>

        `).join('')}

      </div>

    </div>

  `;
}
/* =========================================================
   LOCAL SEO PAGE
========================================================= */

function renderLocalSeo(){

  const keywords = [

    {

      keyword:
        'agence seo bruxelles',

      position:
        3,

    },

    {

      keyword:
        'monitoring site belgique',

      position:
        1,

    },

    {

      keyword:
        'audit seo liege',

      position:
        5,

    },

    {

      keyword:
        'saas seo premium',

      position:
        2,

    },

  ];

  return `

    <div class="fp-page">

      <div class="fp-localGrid">

        <!-- MAP -->

        <div class="fp-card fp-mapCard">

          <div class="fp-cardHeader">

            <div class="fp-cardTitle">
              Carte SEO locale
            </div>

            <button
              class="fp-btn fp-btnGhost"
            >
              Actualiser
            </button>

          </div>

          <div class="fp-cardBody">

            <div class="fp-mapWrap">

              <div class="
                fp-hFull
                fp-flex
                fp-alignCenter
                fp-justifyCenter
                fp-muted
              ">

                Carte interactive locale

              </div>

            </div>

          </div>

        </div>

        <!-- KEYWORDS -->

        <div class="fp-card">

          <div class="fp-cardHeader">

            <div class="fp-cardTitle">
              Rankings locaux
            </div>

          </div>

          <div class="fp-cardBody">

            <div class="fp-rankingList">

              ${keywords.map(item => `

                <div class="fp-rankingItem">

                  <div class="fp-rankingKeyword">
                    ${item.keyword}
                  </div>

                  <div class="fp-rankingPosition">
                    #${item.position}
                  </div>

                </div>

              `).join('')}

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   COMPETITORS PAGE
========================================================= */

function renderCompetitors(){

  const competitors = [

    {

      name:
        'AgencyFlow',

      meta:
        'SEO & monitoring platform',

      score:
        72,

    },

    {

      name:
        'RankSphere',

      meta:
        'Growth SEO suite',

      score:
        61,

    },

    {

      name:
        'MonitorStack',

      meta:
        'Infrastructure monitoring',

      score:
        84,

    },

  ];

  return `

    <div class="fp-page">

      <div class="fp-competitorList">

        ${competitors.map(competitor => `

          <div class="fp-competitorCard">

            <div class="fp-competitorTop">

              <div>

                <div class="fp-competitorName">
                  ${competitor.name}
                </div>

                <div class="fp-competitorMeta">
                  ${competitor.meta}
                </div>

              </div>

              <div class="fp-badge fp-badgePrimary">
                ${competitor.score}/100
              </div>

            </div>

            <div class="fp-competitorBars">

              <div>

                <div class="fp-mb8 fp-textSm">
                  SEO
                </div>

                <div class="fp-progress">

                  <div
                    class="fp-progressBar"
                    style="
                      width:${competitor.score}%
                    "
                  ></div>

                </div>

              </div>

              <div>

                <div class="fp-mb8 fp-textSm">
                  Performance
                </div>

                <div class="fp-progress">

                  <div
                    class="fp-progressBar"
                    style="
                      width:${competitor.score - 10}%
                    "
                  ></div>

                </div>

              </div>

            </div>

          </div>

        `).join('')}

      </div>

    </div>

  `;
}

/* =========================================================
   EXPORTS PAGE
========================================================= */

function renderExports(){

  const exportsData = [

    {

      title:
        'Executive PDF',

      text:
        'Rapport premium client avec analytics et recommandations.',

    },

    {

      title:
        'CSV Analytics',

      text:
        'Export brut des données monitoring et SEO.',

    },

    {

      title:
        'Monitoring Logs',

      text:
        'Historique complet des incidents et uptime.',

    },

  ];

  return `

    <div class="fp-page">

      <div class="fp-exportGrid">

        ${exportsData.map(item => `

          <div class="fp-exportCard">

            <div class="fp-exportIcon">
              📦
            </div>

            <div class="fp-exportTitle">
              ${item.title}
            </div>

            <div class="fp-exportText">
              ${item.text}
            </div>

            <div class="fp-exportActions">

              <button
                class="fp-btn fp-btnPrimary"
              >
                Exporter
              </button>

              <button
                class="fp-btn fp-btnGhost"
              >
                Prévisualiser
              </button>

            </div>

          </div>

        `).join('')}

      </div>

    </div>

  `;
}

/* =========================================================
   BILLING PAGE
========================================================= */

function renderBilling(){

  const plans = [

    {

      name:
        'Standard',

      price:
        29,

      active:
        false,

      features: [

        '30 audits',

        '3 monitors',

        'Rapports PDF',

      ],

    },

    {

      name:
        'Pro',

      price:
        79,

      active:
        true,

      features: [

        '300 audits',

        '50 monitors',

        'Team workspace',

      ],

    },

    {

      name:
        'Ultra',

      price:
        199,

      active:
        false,

      features: [

        '2000 audits',

        '300 monitors',

        'White-label',

      ],

    },

  ];

  return `

    <div class="fp-page">

      <div class="fp-billingPlans">

        ${plans.map(plan => `

          <div class="
            fp-billingPlan
            ${plan.active ? 'active' : ''}
          ">

            <div class="fp-billingPlanName">
              ${plan.name}
            </div>

            <div class="fp-billingPrice">

              <div class="fp-billingPriceValue">
                ${plan.price}€
              </div>

              <div class="fp-billingPricePer">
                /mois
              </div>

            </div>

            <div class="fp-billingFeatures">

              ${plan.features.map(feature => `

                <div class="fp-listItem">
                  ${feature}
                </div>

              `).join('')}

            </div>

            <div class="fp-mt24">

              <button
                class="
                  fp-btn
                  ${
                    plan.active
                      ? 'fp-btnGhost'
                      : 'fp-btnPrimary'
                  }
                "
              >

                ${
                  plan.active
                    ? 'Plan actif'
                    : 'Choisir'
                }

              </button>

            </div>

          </div>

        `).join('')}

      </div>

    </div>

  `;
}

/* =========================================================
   SETTINGS PAGE
========================================================= */

function renderSettings(){

  return `

    <div class="fp-page">

      <div class="fp-settingsGrid">

        <!-- NAV -->

        <div class="fp-card">

          <div class="fp-cardBody">

            <div class="fp-settingsNav">

              <div class="
                fp-settingsNavItem
                active
              ">
                Général
              </div>

              <div class="fp-settingsNavItem">
                Workspace
              </div>

              <div class="fp-settingsNavItem">
                Monitoring
              </div>

              <div class="fp-settingsNavItem">
                Notifications
              </div>

              <div class="fp-settingsNavItem">
                API
              </div>

              <div class="fp-settingsNavItem">
                Sécurité
              </div>

            </div>

          </div>

        </div>

        <!-- CONTENT -->

        <div class="fp-card">

          <div class="fp-cardHeader">

            <div class="fp-cardTitle">
              Paramètres généraux
            </div>

          </div>

          <div class="fp-cardBody">

            <div class="fp-formGrid">

              <div class="fp-field">

                <label class="fp-label">
                  Nom workspace
                </label>

                <input
                  class="fp-input"
                  value="FlowPoint"
                />

              </div>

              <div class="fp-field">

                <label class="fp-label">
                  Domaine
                </label>

                <input
                  class="fp-input"
                  value="flowpoint.pro"
                />

              </div>

              <div class="fp-field">

                <label class="fp-label">
                  Email alertes
                </label>

                <input
                  class="fp-input"
                  value="alerts@flowpoint.pro"
                />

              </div>

              <div class="fp-field">

                <label class="fp-label">
                  Fuseau horaire
                </label>

                <select class="fp-select">

                  <option>
                    Europe/Paris
                  </option>

                </select>

              </div>

            </div>

            <div class="fp-mt24">

              <button
                class="fp-btn fp-btnPrimary"
              >
                Sauvegarder
              </button>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}
/* =========================================================
   PAGE ROUTER UPDATE
========================================================= */

function renderPage(){

  switch(state.route){

    case 'overview':
      return renderOverview();

    case 'missions':
      return renderMissions();

    case 'audits':
      return renderAudits();

    case 'monitors':
      return renderMonitors();

    case 'reports':
      return renderReports();

    case 'team':
      return renderTeam();

    case 'calendar':
      return renderCalendar();

    case 'notes':
      return renderNotes();

    case 'local-seo':
      return renderLocalSeo();

    case 'competitors':
      return renderCompetitors();

    case 'alerts':
      return renderAlerts();

    case 'exports':
      return renderExports();

    case 'billing':
      return renderBilling();

    case 'settings':
      return renderSettings();

    default:

      return `

        <div class="fp-page">

          <div class="fp-card">

            <div class="fp-cardBody">

              <div class="fp-sectionTitle">
                Module introuvable
              </div>

              <div class="fp-sectionText">
                Cette page n’existe pas.
              </div>

            </div>

          </div>

        </div>

      `;
  }
}

/* =========================================================
   EVENTS
========================================================= */

function bindEvents(){

  /* ROUTES */

  qsa('[data-route]').forEach(el => {

    el.onclick = () => {

      const route =
        el.dataset.route;

      setRoute(route);

      if(window.innerWidth <= 980){

        state.mobileSidebar =
          false;

        render();
      }
    };

  });

  /* MOBILE MENU */

  const mobileBtn =
    qs('#fpMobileMenuBtn');

  if(mobileBtn){

    mobileBtn.onclick = () => {

      state.mobileSidebar =
        !state.mobileSidebar;

      render();
    };
  }

  /* MOBILE OVERLAY */

  const overlay =
    qs('.fp-mobileOverlay');

  if(overlay){

    overlay.onclick = () => {

      state.mobileSidebar =
        false;

      render();
    };
  }

  /* REFRESH */

  const refreshBtn =
    qs('#fpRefreshBtn');

  if(refreshBtn){

    refreshBtn.onclick = async () => {

      toast(
        'Actualisation...',
        'info'
      );

      await loadDashboard();

      toast(
        'Workspace mis à jour',
        'success'
      );
    };
  }

  /* NEW BUTTON */

  const newBtn =
    qs('#fpNewBtn');

  if(newBtn){

    newBtn.onclick = () => {

      toast(
        'Création rapide bientôt disponible',
        'info'
      );
    };
  }
}

/* =========================================================
   AUTH
========================================================= */

async function loadSession(){

  try{

    const data =
      await api(
        '/api/auth/me'
      );

    state.user =
      data.user || null;

    state.org =
      data.org || null;

    if(data.plan){

      state.plan =
        data.plan;
    }

  }catch(err){

    console.error(err);

    window.location.href =
      '/login.html';
  }
}

/* =========================================================
   LOAD DASHBOARD
========================================================= */

async function loadDashboard(){

  try{

    /* MONITORS */

    try{

      const monitors =
        await api(
          '/api/monitors'
        );

      state.monitors =
        monitors.monitors || [];

    }catch(err){

      console.warn(
        'monitors fail',
        err
      );
    }

    /* AUDITS */

    try{

      const audits =
        await api(
          '/api/audits'
        );

      state.audits =
        audits.audits || [];

    }catch(err){

      console.warn(
        'audits fail',
        err
      );
    }

    /* REPORTS */

    try{

      const reports =
        await api(
          '/api/reports'
        );

      state.reports =
        reports.reports || [];

    }catch(err){

      console.warn(
        'reports fail',
        err
      );
    }

    /* MISSIONS */

    try{

      const missions =
        await api(
          '/api/missions'
        );

      state.missions =
        missions.missions || [];

    }catch(err){

      console.warn(
        'missions fail',
        err
      );
    }

  }catch(err){

    console.error(err);

    showFatalError(
      err.message ||
      'Erreur dashboard'
    );
  }
}

/* =========================================================
   STORAGE
========================================================= */

function loadStorage(){

  const savedRoute =
    localStorage.getItem(
      'fp_route'
    );

  if(savedRoute){

    state.route =
      savedRoute;
  }

  const sidebar =
    localStorage.getItem(
      'fp_sidebar'
    );

  if(sidebar){

    state.mobileSidebar =
      sidebar === '1';
  }
}

function persistStorage(){

  localStorage.setItem(
    'fp_route',
    state.route
  );

  localStorage.setItem(
    'fp_sidebar',
    state.mobileSidebar
      ? '1'
      : '0'
  );
}

/* =========================================================
   FATAL ERROR
========================================================= */

function showFatalError(text){

  const wrap =
    document.getElementById(
      'fpFatalError'
    );

  const content =
    document.getElementById(
      'fpFatalErrorText'
    );

  if(content){

    content.textContent =
      text;
  }

  if(wrap){

    wrap.style.display =
      'flex';
  }
}

/* =========================================================
   LOADING
========================================================= */

function hideLoading(){

  const loading =
    document.getElementById(
      'fpLoadingScreen'
    );

  if(!loading){
    return;
  }

  loading.style.opacity =
    '0';

  loading.style.pointerEvents =
    'none';

  setTimeout(() => {

    loading.remove();

  }, 260);
}

/* =========================================================
   RESIZE
========================================================= */

window.addEventListener(
  'resize',
  () => {

    if(
      window.innerWidth > 980
    ){

      state.mobileSidebar =
        false;

      persistStorage();

      render();
    }
  }
);

/* =========================================================
   INIT
========================================================= */

async function init(){

  try{

    loadStorage();

    await loadSession();

    await loadDashboard();

    render();

    bindEvents();

    hideLoading();

    toast(
      'Workspace connecté',
      'success'
    );

  }catch(err){

    console.error(err);

    showFatalError(
      err.message ||
      'Erreur initialisation'
    );
  }
}

/* =========================================================
   START
========================================================= */

init();
/* =========================================================
   ADVANCED OVERVIEW
========================================================= */

function renderAdvancedOverview(){

  const incidents = [

    {

      title:
        'API timeout détecté',

      text:
        'Pic de latence détecté sur le cluster principal.',

      type:
        'danger',

      time:
        '4 min',

    },

    {

      title:
        'SEO local amélioré',

      text:
        '3 nouvelles pages géolocalisées indexées.',

      type:
        'success',

      time:
        '22 min',

    },

    {

      title:
        'Rapport exporté',

      text:
        'Executive PDF envoyé au client.',

      type:
        'info',

      time:
        '1 h',

    },

  ];

  return `

    <div class="fp-page">

      <!-- HERO -->

      <div class="
        fp-card
        fp-overviewHero
      ">

        <div class="
          fp-cardBody
          fp-overviewHeroContent
        ">

          <div class="
            fp-overviewHeroTop
          ">

            <div>

              <div class="
                fp-overviewTitle
              ">

                War Room Dashboard

              </div>

              <div class="
                fp-overviewText
              ">

                Vue exécutive temps réel :
                monitoring,
                infrastructure,
                SEO,
                IA,
                analytics
                et incidents critiques.

              </div>

              <div class="
                fp-overviewBadges
              ">

                <div class="
                  fp-overviewBadge
                ">
                  Monitoring actif
                </div>

                <div class="
                  fp-overviewBadge
                ">
                  IA connectée
                </div>

                <div class="
                  fp-overviewBadge
                ">
                  Infrastructure stable
                </div>

              </div>

            </div>

            <button class="
              fp-btn
              fp-btnPrimary
            ">
              Générer rapport
            </button>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-kpiGrid
      ">

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiTop
          ">

            <div class="
              fp-kpiLabel
            ">
              Santé globale
            </div>

            <div class="
              fp-kpiIcon
            ">
              🧠
            </div>

          </div>

          <div class="
            fp-kpiValue
          ">
            94
          </div>

          <div class="
            fp-kpiBottom
          ">

            <div class="
              fp-kpiTrend
              fp-kpiTrendUp
            ">
              +8%
            </div>

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiTop
          ">

            <div class="
              fp-kpiLabel
            ">
              Uptime
            </div>

            <div class="
              fp-kpiIcon
            ">
              🛰️
            </div>

          </div>

          <div class="
            fp-kpiValue
          ">
            99.98%
          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiTop
          ">

            <div class="
              fp-kpiLabel
            ">
              SEO Score
            </div>

            <div class="
              fp-kpiIcon
            ">
              📈
            </div>

          </div>

          <div class="
            fp-kpiValue
          ">
            88
          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiTop
          ">

            <div class="
              fp-kpiLabel
            ">
              Conversions
            </div>

            <div class="
              fp-kpiIcon
            ">
              💰
            </div>

          </div>

          <div class="
            fp-kpiValue
          ">
            +24%
          </div>

        </div>

      </div>

      <!-- GRID -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- ACTIVITY -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            <div class="
              fp-cardTitle
            ">
              Activité récente
            </div>

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-activityList
            ">

              ${incidents.map(item => `

                <div class="
                  fp-activityItem
                ">

                  <div class="
                    fp-activityIcon
                  ">

                    ${
                      item.type === 'danger'
                        ? '⚠️'
                        : item.type === 'success'
                          ? '✅'
                          : '📦'
                    }

                  </div>

                  <div class="
                    fp-activityContent
                  ">

                    <div class="
                      fp-activityTitle
                    ">
                      ${item.title}
                    </div>

                    <div class="
                      fp-activityText
                    ">
                      ${item.text}
                    </div>

                    <div class="
                      fp-activityTime
                    ">
                      ${item.time}
                    </div>

                  </div>

                </div>

              `).join('')}

            </div>

          </div>

        </div>

        <!-- TIMELINE -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            <div class="
              fp-cardTitle
            ">
              Timeline
            </div>

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-timeline
            ">

              <div class="
                fp-timelineItem
              ">

                <div class="
                  fp-timelineDot
                "></div>

                <div class="
                  fp-timelineCard
                ">

                  <div class="
                    fp-timelineTitle
                  ">
                    Infrastructure stabilisée
                  </div>

                  <div class="
                    fp-timelineText
                  ">
                    Optimisation du cluster monitoring.
                  </div>

                  <div class="
                    fp-timelineTime
                  ">
                    Aujourd’hui
                  </div>

                </div>

              </div>

              <div class="
                fp-timelineItem
              ">

                <div class="
                  fp-timelineDot
                "></div>

                <div class="
                  fp-timelineCard
                ">

                  <div class="
                    fp-timelineTitle
                  ">
                    SEO boost
                  </div>

                  <div class="
                    fp-timelineText
                  ">
                    Ajout de nouvelles pages locales.
                  </div>

                  <div class="
                    fp-timelineTime
                  ">
                    Hier
                  </div>

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}
/* =========================================================
   AI PAGE
========================================================= */

function renderAi(){

  const conversations = [

    {

      title:
        'SEO Executive Analysis',

      meta:
        'Il y a 12 minutes',

    },

    {

      title:
        'Monitoring Optimization',

      meta:
        'Aujourd’hui',

    },

    {

      title:
        'Growth Opportunities',

      meta:
        'Hier',

    },

  ];

  const messages = [

    {

      role:
        'assistant',

      text:
        'Le site est stable techniquement mais sous-exploité localement. Plusieurs quick wins peuvent améliorer la visibilité.',

    },

    {

      role:
        'user',

      text:
        'Analyse les meilleures opportunités SEO locales.',

    },

    {

      role:
        'assistant',

      text:
        'Les meilleures opportunités concernent Bruxelles, Liège et Namur avec faible concurrence et forte intention locale.',

    },

  ];

  return `

    <div class="fp-page">

      <div class="fp-aiLayout">

        <!-- SIDEBAR -->

        <div class="fp-aiSidebar">

          <div class="fp-card">

            <div class="fp-cardHeader">

              <div class="fp-cardTitle">
                Conversations IA
              </div>

            </div>

            <div class="fp-cardBody">

              <div class="
                fp-aiConversationList
              ">

                ${conversations.map(
                  (conversation,index) => `

                    <div class="
                      fp-aiConversation
                      ${
                        index === 0
                          ? 'active'
                          : ''
                      }
                    ">

                      <div class="
                        fp-aiConversationTitle
                      ">
                        ${conversation.title}
                      </div>

                      <div class="
                        fp-aiConversationMeta
                      ">
                        ${conversation.meta}
                      </div>

                    </div>

                  `
                ).join('')}

              </div>

            </div>

          </div>

        </div>

        <!-- CHAT -->

        <div class="fp-card">

          <div class="fp-cardHeader">

            <div class="fp-cardTitle">
              FlowPoint AI
            </div>

            <button class="
              fp-btn
              fp-btnGhost
            ">
              Nouveau chat
            </button>

          </div>

          <div class="fp-cardBody">

            <div class="fp-aiChat">

              <div class="fp-aiMessages">

                ${messages.map(message => `

                  <div class="
                    fp-aiMessage
                    ${message.role}
                  ">

                    <div class="
                      fp-aiAvatar
                    ">

                      ${
                        message.role === 'assistant'
                          ? 'AI'
                          : 'U'
                      }

                    </div>

                    <div class="
                      fp-aiBubble
                    ">

                      ${message.text}

                    </div>

                  </div>

                `).join('')}

              </div>

              <div class="
                fp-aiComposer
              ">

                <textarea
                  class="fp-textarea"
                  placeholder="
                    Demande une analyse,
                    un rapport ou une stratégie...
                  "
                ></textarea>

                <button class="
                  fp-btn
                  fp-btnPrimary
                ">
                  Envoyer
                </button>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   COMMAND CENTER
========================================================= */

function renderCommandCenter(){

  const actions = [

    {

      title:
        'Audit IA complet',

      text:
        'Analyse SEO, performance et conversion.',

      button:
        'Lancer audit',

    },

    {

      title:
        'Exporter Executive PDF',

      text:
        'Créer un rapport premium prêt client.',

      button:
        'Exporter',

    },

    {

      title:
        'Monitoring temps réel',

      text:
        'Vérifier les incidents et uptime.',

      button:
        'Ouvrir',

    },

    {

      title:
        'Optimisation SEO locale',

      text:
        'Détection des opportunités géographiques.',

      button:
        'Analyser',

    },

    {

      title:
        'Analyse concurrence',

      text:
        'Comparer le positionnement et visibilité.',

      button:
        'Comparer',

    },

    {

      title:
        'Automatisation rapports',

      text:
        'Configurer les exports automatiques.',

      button:
        'Configurer',

    },

  ];

  return `

    <div class="fp-page">

      <div class="
        fp-commandCenter
      ">

        ${actions.map(action => `

          <div class="
            fp-commandCard
          ">

            <div class="
              fp-commandTitle
            ">
              ${action.title}
            </div>

            <div class="
              fp-commandText
            ">
              ${action.text}
            </div>

            <div class="
              fp-commandBottom
            ">

              <button class="
                fp-btn
                fp-btnPrimary
              ">
                ${action.button}
              </button>

            </div>

          </div>

        `).join('')}

      </div>

    </div>

  `;
}

/* =========================================================
   ANALYTICS PAGE
========================================================= */

function renderAnalytics(){

  return `

    <div class="fp-page">

      <div class="
        fp-analyticsGrid
      ">

        <!-- MAIN -->

        <div class="
          fp-card
          fp-analyticsPanel
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-analyticsHeader
            ">

              <div>

                <div class="
                  fp-analyticsTitle
                ">
                  Analytics avancés
                </div>

                <div class="
                  fp-analyticsText
                ">
                  Performance SEO,
                  conversions,
                  uptime
                  et croissance.
                </div>

              </div>

            </div>

            <div class="
              fp-chartEmpty
            ">

              Chart analytics premium

            </div>

            <div class="
              fp-analyticsMetrics
            ">

              <div class="
                fp-analyticsMetric
              ">

                <div class="
                  fp-analyticsMetricValue
                ">
                  +28%
                </div>

                <div class="
                  fp-analyticsMetricLabel
                ">
                  Croissance SEO
                </div>

              </div>

              <div class="
                fp-analyticsMetric
              ">

                <div class="
                  fp-analyticsMetricValue
                ">
                  99.98%
                </div>

                <div class="
                  fp-analyticsMetricLabel
                ">
                  Uptime
                </div>

              </div>

              <div class="
                fp-analyticsMetric
              ">

                <div class="
                  fp-analyticsMetricValue
                ">
                  4.8x
                </div>

                <div class="
                  fp-analyticsMetricLabel
                ">
                  Conversion boost
                </div>

              </div>

            </div>

          </div>

        </div>

        <!-- SIDE -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            <div class="
              fp-cardTitle
            ">
              Résumé IA
            </div>

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-list
            ">

              <div class="
                fp-listItem
              ">

                <div class="
                  fp-listTitle
                ">
                  SEO stable
                </div>

                <div class="
                  fp-listText
                ">
                  Les positions locales progressent.
                </div>

              </div>

              <div class="
                fp-listItem
              ">

                <div class="
                  fp-listTitle
                ">
                  Monitoring optimisé
                </div>

                <div class="
                  fp-listText
                ">
                  Aucun incident critique détecté.
                </div>

              </div>

              <div class="
                fp-listItem
              ">

                <div class="
                  fp-listTitle
                ">
                  Conversion boost
                </div>

                <div class="
                  fp-listText
                ">
                  Les nouveaux funnels performent mieux.
                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}
/* =========================================================
   UPDATE ROUTES
========================================================= */

routes.splice(

  1,

  0,

  {

    key:'analytics',
    label:'Analytics',
    icon:'📈',

  },

  {

    key:'ai',
    label:'FlowPoint AI',
    icon:'🤖',

  },

  {

    key:'command-center',
    label:'Command Center',
    icon:'⚡',

  }

);

/* =========================================================
   UPDATE PAGE ROUTER
========================================================= */

const originalRenderPage =
  renderPage;

renderPage = function(){

  switch(state.route){

    case 'analytics':
      return renderAnalytics();

    case 'ai':
      return renderAi();

    case 'command-center':
      return renderCommandCenter();

    default:
      return originalRenderPage();
  }
};

/* =========================================================
   DEMO DATA GENERATORS
========================================================= */

function generateFakeNotifications(){

  return [

    {

      type:'success',

      text:
        'Rapport Executive PDF généré',

    },

    {

      type:'danger',

      text:
        'Latence élevée détectée',

    },

    {

      type:'info',

      text:
        'Nouveau quick win SEO disponible',

    },

  ];
}

function generateFakeMissions(){

  return [

    {

      title:
        'Créer landing pages Bruxelles',

      progress:
        38,

    },

    {

      title:
        'Optimiser monitoring cluster',

      progress:
        72,

    },

    {

      title:
        'Améliorer funnel onboarding',

      progress:
        58,

    },

  ];
}

/* =========================================================
   QUICK ACTIONS
========================================================= */

function renderQuickActions(){

  const actions = [

    {

      title:
        'Audit SEO',

      text:
        'Lancer un audit complet IA.',

      icon:
        '🧠',

    },

    {

      title:
        'Nouveau monitor',

      text:
        'Ajouter un endpoint monitoring.',

      icon:
        '🛰️',

    },

    {

      title:
        'Exporter PDF',

      text:
        'Créer un rapport client.',

      icon:
        '📑',

    },

    {

      title:
        'Créer mission',

      text:
        'Ajouter une tâche équipe.',

      icon:
        '🎯',

    },

  ];

  return `

    <div class="
      fp-quickActions
    ">

      ${actions.map(action => `

        <div class="
          fp-quickAction
        ">

          <div class="
            fp-textXl
          ">
            ${action.icon}
          </div>

          <div class="
            fp-quickActionTitle
          ">
            ${action.title}
          </div>

          <div class="
            fp-quickActionText
          ">
            ${action.text}
          </div>

        </div>

      `).join('')}

    </div>

  `;
}

/* =========================================================
   UPDATE ADVANCED OVERVIEW
========================================================= */

const originalAdvancedOverview =
  renderAdvancedOverview;

renderAdvancedOverview =
  function(){

    return `

      <div class="fp-page">

        ${originalAdvancedOverview()}

        <div class="
          fp-mt24
        ">

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              <div class="
                fp-cardTitle
              ">
                Actions rapides
              </div>

            </div>

            <div class="
              fp-cardBody
            ">

              ${renderQuickActions()}

            </div>

          </div>

        </div>

      </div>

    `;
  };

/* =========================================================
   REPLACE OVERVIEW
========================================================= */

renderOverview =
  renderAdvancedOverview;

/* =========================================================
   DEMO NOTIFICATIONS
========================================================= */

function startFakeRealtime(){

  setInterval(() => {

    const notifications =
      generateFakeNotifications();

    const item =
      notifications[
        Math.floor(
          Math.random()
          *
          notifications.length
        )
      ];

    toast(
      item.text,
      item.type
    );

  }, 45000);
}

/* =========================================================
   KEYBOARD SHORTCUTS
========================================================= */

window.addEventListener(

  'keydown',

  (event) => {

    /* CMD/CTRL + K */

    if(

      (
        event.metaKey ||
        event.ctrlKey
      )

      &&

      event.key.toLowerCase()
      === 'k'

    ){

      event.preventDefault();

      toast(
        'Command palette bientôt disponible',
        'info'
      );
    }

    /* ESC */

    if(
      event.key === 'Escape'
    ){

      state.mobileSidebar =
        false;

      render();
    }
  }
);

/* =========================================================
   SESSION KEEPALIVE
========================================================= */

async function keepAlive(){

  try{

    await api(
      '/api/auth/ping'
    );

  }catch(err){

    console.warn(
      'keepalive fail'
    );
  }
}

setInterval(
  keepAlive,
  1000 * 60 * 5
);

/* =========================================================
   LOADING IMPROVEMENTS
========================================================= */

function smoothRemoveLoading(){

  const loading =
    document.getElementById(
      'fpLoadingScreen'
    );

  if(!loading){
    return;
  }

  loading.animate(

    [

      {

        opacity:1,
        transform:'scale(1)',

      },

      {

        opacity:0,
        transform:'scale(1.04)',

      },

    ],

    {

      duration:320,
      easing:'ease',

      fill:'forwards',

    }

  );

  setTimeout(() => {

    loading.remove();

  }, 320);
}

hideLoading =
  smoothRemoveLoading;

/* =========================================================
   START REALTIME
========================================================= */

startFakeRealtime();

/* =========================================================
   FINAL BOOT MESSAGE
========================================================= */

console.log(`

FLOWPOINT DASHBOARD V3
READY

`);
/* =========================================================
   DRAWER SYSTEM
========================================================= */

function openDrawer({

  title = 'Drawer',

  content = '',

} = {}){

  closeDrawer();

  const overlay =
    document.createElement(
      'div'
    );

  overlay.className =
    'fp-drawerOverlay';

  overlay.id =
    'fpDrawerOverlay';

  const drawer =
    document.createElement(
      'div'
    );

  drawer.className =
    'fp-drawer';

  drawer.id =
    'fpDrawer';

  drawer.innerHTML = `

    <div class="
      fp-drawerHeader
    ">

      <div class="
        fp-drawerTitle
      ">
        ${title}
      </div>

      <button
        class="fp-iconBtn"
        id="fpCloseDrawer"
      >
        ✕
      </button>

    </div>

    <div class="
      fp-drawerBody
    ">

      ${content}

    </div>

  `;

  document.body.appendChild(
    overlay
  );

  document.body.appendChild(
    drawer
  );

  overlay.onclick =
    closeDrawer;

  qs('#fpCloseDrawer')
    .onclick =
      closeDrawer;
}

function closeDrawer(){

  qs('#fpDrawerOverlay')
    ?.remove();

  qs('#fpDrawer')
    ?.remove();
}

/* =========================================================
   MODAL SYSTEM
========================================================= */

function openModal({

  title = 'Modal',

  content = '',

  actions = '',

} = {}){

  closeModal();

  const overlay =
    document.createElement(
      'div'
    );

  overlay.className =
    'fp-modalOverlay';

  overlay.id =
    'fpModalOverlay';

  overlay.innerHTML = `

    <div class="
      fp-modal
    ">

      <div class="
        fp-modalHeader
      ">

        <div class="
          fp-modalTitle
        ">
          ${title}
        </div>

        <button
          class="fp-modalClose"
          id="fpCloseModal"
        >
          ✕
        </button>

      </div>

      <div class="
        fp-modalBody
      ">

        ${content}

        ${
          actions
            ? `
              <div class="fp-mt24">
                ${actions}
              </div>
            `
            : ''
        }

      </div>

    </div>

  `;

  document.body.appendChild(
    overlay
  );

  qs('#fpCloseModal')
    .onclick =
      closeModal;

  overlay.onclick =
    (event) => {

      if(
        event.target === overlay
      ){

        closeModal();
      }
    };
}

function closeModal(){

  qs('#fpModalOverlay')
    ?.remove();
}

/* =========================================================
   COMMAND PALETTE
========================================================= */

function openCommandPalette(){

  openModal({

    title:
      'Command Center',

    content: `

      <div class="
        fp-search
      ">

        <span class="
          fp-searchIcon
        ">
          🔎
        </span>

        <input
          class="fp-input"
          id="fpCommandSearch"
          placeholder="
            Rechercher une action...
          "
        />

      </div>

      <div class="
        fp-list
        fp-mt24
      ">

        <div
          class="fp-listItem"
          data-command-route="
            overview
          "
        >

          Dashboard Overview

        </div>

        <div
          class="fp-listItem"
          data-command-route="
            analytics
          "
        >

          Analytics

        </div>

        <div
          class="fp-listItem"
          data-command-route="
            ai
          "
        >

          FlowPoint AI

        </div>

        <div
          class="fp-listItem"
          data-command-route="
            monitors
          "
        >

          Monitoring

        </div>

        <div
          class="fp-listItem"
          data-command-route="
            billing
          "
        >

          Billing

        </div>

      </div>

    `,

  });

  qsa('[data-command-route]')
    .forEach(el => {

      el.onclick = () => {

        const route =
          el.dataset.commandRoute;

        closeModal();

        setRoute(route);
      };
    });
}

/* =========================================================
   IMPROVED SHORTCUTS
========================================================= */

window.addEventListener(

  'keydown',

  (event) => {

    /* CMD/CTRL + K */

    if(

      (
        event.metaKey ||
        event.ctrlKey
      )

      &&

      event.key.toLowerCase()
      === 'k'

    ){

      event.preventDefault();

      openCommandPalette();
    }

  }
);

/* =========================================================
   THEME ENGINE
========================================================= */

const theme = {

  dark:true,

};

function toggleTheme(){

  theme.dark =
    !theme.dark;

  if(theme.dark){

    document.body.classList
      .remove(
        'fp-light'
      );

  }else{

    document.body.classList
      .add(
        'fp-light'
      );
  }

  localStorage.setItem(
    'fp_theme',
    theme.dark
      ? 'dark'
      : 'light'
  );
}

function loadTheme(){

  const saved =
    localStorage.getItem(
      'fp_theme'
    );

  if(saved === 'light'){

    theme.dark =
      false;

    document.body.classList
      .add(
        'fp-light'
      );
  }
}

/* =========================================================
   ADVANCED TOASTS
========================================================= */

function toastAction({

  text = '',

  type = 'info',

  button = '',

  callback = null,

}){

  const wrap =
    document.getElementById(
      'fpToastWrap'
    );

  if(!wrap){
    return;
  }

  const el =
    document.createElement(
      'div'
    );

  el.className =
    `fp-toast fp-toast${
      type.charAt(0)
        .toUpperCase()
      +
      type.slice(1)
    }`;

  el.innerHTML = `

    <div class="
      fp-flex
      fp-alignCenter
      fp-justifyBetween
      fp-gap16
    ">

      <div class="
        fp-font700
      ">
        ${text}
      </div>

      ${
        button
          ? `
            <button
              class="
                fp-btn
                fp-btnGhost
              "
              id="fpToastBtn"
            >
              ${button}
            </button>
          `
          : ''
      }

    </div>

  `;

  wrap.appendChild(el);

  if(button){

    qs('#fpToastBtn')
      .onclick =
        () => {

          if(callback){

            callback();
          }

          el.remove();
        };
  }

  setTimeout(() => {

    el.remove();

  }, 5000);
}

/* =========================================================
   GLOBAL ACTIONS
========================================================= */

function setupGlobalActions(){

  document.body.addEventListener(

    'click',

    (event) => {

      const target =
        event.target;

      /* EXPORT */

      if(

        target.closest(
          '.fp-exportCard .fp-btnPrimary'
        )

      ){

        toastAction({

          text:
            'Export démarré',

          type:
            'success',

          button:
            'Voir',

          callback(){

            setRoute(
              'exports'
            );
          },

        });
      }

      /* BILLING */

      if(

        target.closest(
          '.fp-billingPlan .fp-btnPrimary'
        )

      ){

        openModal({

          title:
            'Upgrade abonnement',

          content:`

            <div class="
              fp-alert
              fp-alertSuccess
            ">

              Upgrade Stripe bientôt connecté.

            </div>

          `,

          actions:`

            <button class="
              fp-btn
              fp-btnPrimary
            ">
              Continuer
            </button>

          `,

        });
      }

    }
  );
}

/* =========================================================
   START GLOBAL ACTIONS
========================================================= */

setupGlobalActions();

/* =========================================================
   LOAD THEME
========================================================= */

loadTheme();
/* =========================================================
   REALTIME ENGINE
========================================================= */

const realtime = {

  enabled:true,

  interval:null,

};

function startRealtimeEngine(){

  if(realtime.interval){

    clearInterval(
      realtime.interval
    );
  }

  realtime.interval =
    setInterval(async () => {

      if(!realtime.enabled){
        return;
      }

      try{

        await refreshRealtimeData();

      }catch(err){

        console.warn(
          'Realtime error',
          err
        );
      }

    }, 30000);
}

async function refreshRealtimeData(){

  /* MONITORS */

  try{

    const response =
      await api(
        '/api/monitors/live'
      );

    if(response.monitors){

      state.monitors =
        response.monitors;
    }

  }catch(err){

    console.warn(
      'live monitors fail'
    );
  }

  /* ALERTS */

  try{

    const response =
      await api(
        '/api/alerts/live'
      );

    if(response.alerts){

      state.alerts =
        response.alerts;
    }

  }catch(err){

    console.warn(
      'live alerts fail'
    );
  }

  /* RENDER */

  render();
}

/* =========================================================
   MONITOR HISTORY DRAWER
========================================================= */

function openMonitorDrawer(monitor){

  openDrawer({

    title:
      monitor.name,

    content: `

      <div class="
        fp-grid2
      ">

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-sectionTitle
            ">
              ${monitor.uptime || '99.98%'}
            </div>

            <div class="
              fp-sectionText
            ">
              Uptime global
            </div>

          </div>

        </div>

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-sectionTitle
            ">
              ${monitor.latency || '124ms'}
            </div>

            <div class="
              fp-sectionText
            ">
              Latence moyenne
            </div>

          </div>

        </div>

      </div>

      <div class="
        fp-mt24
      ">

        <div class="
          fp-chartEmpty
        ">

          Historique monitoring

        </div>

      </div>

    `,

  });
}

/* =========================================================
   AUDIT DRAWER
========================================================= */

function openAuditDrawer(audit){

  openDrawer({

    title:
      audit.domain,

    content: `

      <div class="
        fp-card
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">
                ${audit.score}
              </div>

              <div class="
                fp-sectionText
              ">
                SEO Score
              </div>

            </div>

            <div class="
              fp-badge
              fp-badgeSuccess
            ">

              Stable

            </div>

          </div>

        </div>

      </div>

      <div class="
        fp-mt24
      ">

        <div class="
          fp-list
        ">

          ${(audit.insights || []).map(
            item => `

              <div class="
                fp-listItem
              ">

                ${item}

              </div>

            `
          ).join('')}

        </div>

      </div>

    `,

  });
}

/* =========================================================
   EXPORT ENGINE
========================================================= */

async function exportReport(type='pdf'){

  try{

    toast(
      'Préparation export...',
      'info'
    );

    const response =
      await api(

        '/api/reports/export',

        {

          method:'POST',

          body:JSON.stringify({

            type,

          }),

        }
      );

    toastAction({

      text:
        'Export prêt',

      type:
        'success',

      button:
        'Télécharger',

      callback(){

        if(response.url){

          window.open(
            response.url,
            '_blank'
          );
        }
      },

    });

  }catch(err){

    toast(
      err.message ||
      'Erreur export',
      'danger'
    );
  }
}

/* =========================================================
   AI ENGINE
========================================================= */

async function sendAiMessage(text){

  if(!text?.trim()){
    return;
  }

  try{

    toast(
      'IA en réflexion...',
      'info'
    );

    const response =
      await api(

        '/api/ai/chat',

        {

          method:'POST',

          body:JSON.stringify({

            message:text,

          }),

        }
      );

    toast(
      'Réponse IA générée',
      'success'
    );

    console.log(
      response
    );

  }catch(err){

    toast(
      err.message ||
      'Erreur IA',
      'danger'
    );
  }
}

/* =========================================================
   SEARCH ENGINE
========================================================= */

function globalSearch(query=''){

  query =
    query.toLowerCase();

  const searchable = [

    ...routes.map(route => ({
      type:'route',
      title:route.label,
      key:route.key,
    })),

    ...(state.missions || []).map(
      mission => ({
        type:'mission',
        title:mission.title,
      })
    ),

    ...(state.monitors || []).map(
      monitor => ({
        type:'monitor',
        title:monitor.name,
      })
    ),

  ];

  return searchable.filter(item =>

    item.title
      .toLowerCase()
      .includes(query)

  );
}

/* =========================================================
   SEARCH DRAWER
========================================================= */

function openSearchDrawer(){

  openDrawer({

    title:
      'Recherche globale',

    content: `

      <div class="
        fp-search
      ">

        <span class="
          fp-searchIcon
        ">
          🔎
        </span>

        <input
          id="fpGlobalSearchInput"
          class="fp-input"
          placeholder="
            Rechercher...
          "
        />

      </div>

      <div
        id="fpGlobalSearchResults"
        class="
          fp-list
          fp-mt24
        "
      ></div>

    `,

  });

  const input =
    qs('#fpGlobalSearchInput');

  const results =
    qs('#fpGlobalSearchResults');

  if(!input || !results){
    return;
  }

  input.focus();

  input.oninput = () => {

    const value =
      input.value.trim();

    const data =
      globalSearch(value);

    results.innerHTML =

      data.map(item => `

        <div
          class="
            fp-listItem
          "

          data-search-route="
            ${item.key || ''}
          "
        >

          <div class="
            fp-listTitle
          ">
            ${item.title}
          </div>

          <div class="
            fp-listText
          ">
            ${item.type}
          </div>

        </div>

      `).join('');

    qsa('[data-search-route]')
      .forEach(el => {

        el.onclick = () => {

          const route =
            el.dataset.searchRoute;

          if(route){

            closeDrawer();

            setRoute(route);
          }
        };
      });
  };
}

/* =========================================================
   IMPROVED SHORTCUTS
========================================================= */

window.addEventListener(

  'keydown',

  (event) => {

    /* CMD/CTRL + P */

    if(

      (
        event.metaKey ||
        event.ctrlKey
      )

      &&

      event.key.toLowerCase()
      === 'p'

    ){

      event.preventDefault();

      openSearchDrawer();
    }

  }
);

/* =========================================================
   START REALTIME
========================================================= */

startRealtimeEngine();
/* =========================================================
   PIPELINE PAGE
========================================================= */

function renderPipeline(){

  const columns = [

    {

      title:
        'Leads',

      items:[

        {

          title:
            'Agence Bruxelles',

          text:
            'SEO + monitoring',

        },

        {

          title:
            'Restaurant Liège',

          text:
            'Local SEO',

        },

      ],

    },

    {

      title:
        'Qualification',

      items:[

        {

          title:
            'Cabinet juridique',

          text:
            'Executive reporting',

        },

      ],

    },

    {

      title:
        'Proposition',

      items:[

        {

          title:
            'E-commerce premium',

          text:
            'Infrastructure + SEO',

        },

      ],

    },

    {

      title:
        'Clients',

      items:[

        {

          title:
            'FlowPoint Enterprise',

          text:
            'Ultra plan',

        },

      ],

    },

  ];

  return `

    <div class="fp-page">

      <div class="
        fp-pipeline
      ">

        ${columns.map(column => `

          <div class="
            fp-pipelineColumn
          ">

            <div class="
              fp-pipelineTop
            ">

              <div class="
                fp-pipelineTitle
              ">
                ${column.title}
              </div>

              <div class="
                fp-pipelineCount
              ">
                ${column.items.length}
              </div>

            </div>

            <div class="
              fp-pipelineCards
            ">

              ${column.items.map(item => `

                <div class="
                  fp-pipelineCard
                ">

                  <div class="
                    fp-pipelineCardTitle
                  ">
                    ${item.title}
                  </div>

                  <div class="
                    fp-pipelineCardText
                  ">
                    ${item.text}
                  </div>

                </div>

              `).join('')}

            </div>

          </div>

        `).join('')}

      </div>

    </div>

  `;
}

/* =========================================================
   CLIENT MODE PAGE
========================================================= */

function renderClientMode(){

  return `

    <div class="fp-page">

      <div class="
        fp-card
        fp-clientHero
      ">

        <div class="
          fp-cardBody
          fp-clientHeroContent
        ">

          <div class="
            fp-clientName
          ">
            Client Workspace
          </div>

          <div class="
            fp-clientText
          ">

            Vue simplifiée client :
            rapports,
            SEO,
            monitoring
            et progression.

          </div>

          <div class="
            fp-clientStats
          ">

            <div class="
              fp-kpiCard
            ">

              <div class="
                fp-kpiLabel
              ">
                SEO Score
              </div>

              <div class="
                fp-kpiValue
              ">
                91
              </div>

            </div>

            <div class="
              fp-kpiCard
            ">

              <div class="
                fp-kpiLabel
              ">
                Uptime
              </div>

              <div class="
                fp-kpiValue
              ">
                99.98%
              </div>

            </div>

            <div class="
              fp-kpiCard
            ">

              <div class="
                fp-kpiLabel
              ">
                Rapports
              </div>

              <div class="
                fp-kpiValue
              ">
                42
              </div>

            </div>

            <div class="
              fp-kpiCard
            ">

              <div class="
                fp-kpiLabel
              ">
                Croissance
              </div>

              <div class="
                fp-kpiValue
              ">
                +28%
              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   TOOLS PAGE
========================================================= */

function renderTools(){

  const tools = [

    {

      title:
        'SEO Scanner',

      text:
        'Analyse SEO complète et rapide.',

      icon:
        '🧠',

    },

    {

      title:
        'Monitoring Uptime',

      text:
        'Surveillance temps réel.',

      icon:
        '🛰️',

    },

    {

      title:
        'PDF Generator',

      text:
        'Rapports premium automatiques.',

      icon:
        '📑',

    },

    {

      title:
        'AI Recommendations',

      text:
        'Quick wins intelligents.',

      icon:
        '🤖',

    },

    {

      title:
        'Local SEO Mapper',

      text:
        'Analyse géographique.',

      icon:
        '📍',

    },

    {

      title:
        'Competitor Tracker',

      text:
        'Benchmark concurrence.',

      icon:
        '⚔️',

    },

  ];

  return `

    <div class="fp-page">

      <div class="
        fp-toolsGrid
      ">

        ${tools.map(tool => `

          <div class="
            fp-toolCard
          ">

            <div class="
              fp-toolIcon
            ">
              ${tool.icon}
            </div>

            <div class="
              fp-toolTitle
            ">
              ${tool.title}
            </div>

            <div class="
              fp-toolText
            ">
              ${tool.text}
            </div>

            <div class="
              fp-toolBottom
            ">

              <button class="
                fp-btn
                fp-btnPrimary
              ">
                Ouvrir
              </button>

            </div>

          </div>

        `).join('')}

      </div>

    </div>

  `;
}

/* =========================================================
   UPDATE ROUTES
========================================================= */

routes.push(

  {

    key:'pipeline',
    label:'Pipeline',
    icon:'🧩',

  },

  {

    key:'client-mode',
    label:'Client Mode',
    icon:'👤',

  },

  {

    key:'tools',
    label:'Outils',
    icon:'🛠️',

  }

);

/* =========================================================
   EXTEND ROUTER
========================================================= */

const previousRenderPage =
  renderPage;

renderPage = function(){

  switch(state.route){

    case 'pipeline':
      return renderPipeline();

    case 'client-mode':
      return renderClientMode();

    case 'tools':
      return renderTools();

    default:
      return previousRenderPage();
  }
};
/* =========================================================
   ADVANCED BILLING ENGINE
========================================================= */

async function startCheckout(plan='pro'){

  try{

    toast(
      'Création session Stripe...',
      'info'
    );

    const response =
      await api(

        '/api/billing/create-checkout',

        {

          method:'POST',

          body:JSON.stringify({

            plan,

          }),

        }
      );

    if(response.url){

      window.location.href =
        response.url;

      return;
    }

    throw new Error(
      'Checkout introuvable'
    );

  }catch(err){

    toast(
      err.message ||
      'Erreur Stripe',
      'danger'
    );
  }
}

async function openBillingPortal(){

  try{

    const response =
      await api(
        '/api/billing/portal'
      );

    if(response.url){

      window.open(
        response.url,
        '_blank'
      );
    }

  }catch(err){

    toast(
      err.message ||
      'Erreur portail',
      'danger'
    );
  }
}

/* =========================================================
   USER MENU
========================================================= */

function renderUserMenu(){

  return `

    <div class="
      fp-userDropdown
    ">

      <div class="
        fp-userCard
      ">

        <div class="
          fp-userAvatar
        ">

          ${
            state.user?.email
              ?.slice(0,1)
              ?.toUpperCase()
              || 'U'
          }

        </div>

        <div>

          <div class="
            fp-userName
          ">

            ${
              state.user?.name
              || 'Utilisateur'
            }

          </div>

          <div class="
            fp-userEmail
          ">

            ${
              state.user?.email
              || 'user@flowpoint.pro'
            }

          </div>

        </div>

      </div>

      <div class="
        fp-list
        fp-mt16
      ">

        <div
          class="fp-listItem"
          id="fpOpenBillingPortal"
        >

          Billing Portal

        </div>

        <div
          class="fp-listItem"
          id="fpLogoutBtn"
        >

          Déconnexion

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   LOGOUT
========================================================= */

async function logout(){

  try{

    await api(

      '/api/auth/logout',

      {

        method:'POST',

      }
    );

  }catch(err){

    console.warn(err);
  }

  window.location.href =
    '/login.html';
}

/* =========================================================
   SESSION EXPIRED
========================================================= */

function sessionExpired(){

  openModal({

    title:
      'Session expirée',

    content: `

      <div class="
        fp-alert
        fp-alertDanger
      ">

        Votre session a expiré.
        Veuillez vous reconnecter.

      </div>

    `,

    actions: `

      <button
        class="
          fp-btn
          fp-btnPrimary
        "

        id="fpReconnectBtn"
      >

        Reconnexion

      </button>

    `,

  });

  setTimeout(() => {

    qs('#fpReconnectBtn')
      ?.addEventListener(

        'click',

        () => {

          window.location.href =
            '/login.html';
        }
      );

  }, 50);
}

/* =========================================================
   API OVERRIDE
========================================================= */

const originalApi =
  api;

api = async function(

  path,

  options = {}

){

  try{

    return await originalApi(
      path,
      options
    );

  }catch(err){

    if(

      err.message
        ?.toLowerCase()
        ?.includes('unauthorized')

    ){

      sessionExpired();
    }

    throw err;
  }
};

/* =========================================================
   USER MENU EVENTS
========================================================= */

function bindUserMenu(){

  const billing =
    qs('#fpOpenBillingPortal');

  if(billing){

    billing.onclick =
      openBillingPortal;
  }

  const logoutBtn =
    qs('#fpLogoutBtn');

  if(logoutBtn){

    logoutBtn.onclick =
      logout;
  }
}

/* =========================================================
   IMPROVED TOPBAR
========================================================= */

const originalTopbar =
  renderTopbar;

renderTopbar = function(){

  return `

    <div class="
      fp-topbar
    ">

      <div class="
        fp-topbarLeft
      ">

        <button
          class="
            fp-iconBtn
            fp-mobileMenuBtn
          "

          id="fpMobileMenuBtn"
        >

          ☰

        </button>

        <div>

          <div class="
            fp-pageTitle
          ">

            FlowPoint Dashboard

          </div>

          <div class="
            fp-pageSub
          ">

            Infrastructure,
            SEO,
            IA
            et monitoring premium

          </div>

        </div>

      </div>

      <div class="
        fp-topbarRight
      ">

        <button
          class="
            fp-btn
            fp-btnGhost
          "

          id="fpGlobalSearchBtn"
        >

          Recherche

        </button>

        <button
          class="
            fp-btn
            fp-btnPrimary
          "

          id="fpAiQuickBtn"
        >

          FlowPoint AI

        </button>

        <div
          id="fpUserMenuWrap"
        >

          ${renderUserMenu()}

        </div>

      </div>

    </div>

  `;
};

/* =========================================================
   EXTEND EVENTS
========================================================= */

const previousBindEvents =
  bindEvents;

bindEvents = function(){

  previousBindEvents();

  bindUserMenu();

  const searchBtn =
    qs('#fpGlobalSearchBtn');

  if(searchBtn){

    searchBtn.onclick =
      openSearchDrawer;
  }

  const aiBtn =
    qs('#fpAiQuickBtn');

  if(aiBtn){

    aiBtn.onclick =
      () => {

        setRoute('ai');
      };
  }

  /* BILLING BUTTONS */

  qsa('.fp-billingPlan')
    .forEach(card => {

      const btn =
        card.querySelector(
          '.fp-btnPrimary'
        );

      if(!btn){
        return;
      }

      btn.onclick = () => {

        const planName =
          card.querySelector(
            '.fp-billingPlanName'
          )?.textContent
            ?.toLowerCase()
            || 'pro';

        startCheckout(
          planName
        );
      };
    });

  /* EXPORTS */

  qsa('.fp-exportCard')
    .forEach(card => {

      const btn =
        card.querySelector(
          '.fp-btnPrimary'
        );

      if(!btn){
        return;
      }

      btn.onclick = () => {

        exportReport(
          'pdf'
        );
      };
    });

  /* AI */

  const aiTextarea =
    qs('.fp-aiComposer textarea');

  const aiSend =
    qs('.fp-aiComposer .fp-btnPrimary');

  if(aiTextarea && aiSend){

    aiSend.onclick =
      () => {

        sendAiMessage(
          aiTextarea.value
        );
      };
  }
};
/* =========================================================
   ADVANCED MONITORING ENGINE
========================================================= */

function calculateGlobalHealth(){

  const monitors =
    state.monitors || [];

  if(!monitors.length){
    return 96;
  }

  let total = 0;

  monitors.forEach(monitor => {

    const uptime =
      parseFloat(
        monitor.uptime || 99
      );

    total += uptime;
  });

  return Math.round(
    total / monitors.length
  );
}

function calculateIncidentCount(){

  return (state.alerts || [])
    .filter(alert =>

      alert.type === 'danger'

    ).length;
}

function calculateSeoScore(){

  const audits =
    state.audits || [];

  if(!audits.length){
    return 88;
  }

  let total = 0;

  audits.forEach(audit => {

    total +=
      Number(audit.score || 0);
  });

  return Math.round(
    total / audits.length
  );
}

/* =========================================================
   OVERVIEW KPI OVERRIDE
========================================================= */

renderAdvancedOverview =
  function(){

    const health =
      calculateGlobalHealth();

    const seo =
      calculateSeoScore();

    const incidents =
      calculateIncidentCount();

    return `

      <div class="
        fp-page
      ">

        <!-- HERO -->

        <div class="
          fp-card
          fp-overviewHero
        ">

          <div class="
            fp-cardBody
            fp-overviewHeroContent
          ">

            <div class="
              fp-overviewHeroTop
            ">

              <div>

                <div class="
                  fp-overviewTitle
                ">

                  Executive War Room

                </div>

                <div class="
                  fp-overviewText
                ">

                  Infrastructure,
                  monitoring,
                  SEO,
                  analytics,
                  IA
                  et opérations critiques
                  centralisés.

                </div>

                <div class="
                  fp-overviewBadges
                ">

                  <div class="
                    fp-overviewBadge
                  ">

                    ${state.plan.toUpperCase()} PLAN

                  </div>

                  <div class="
                    fp-overviewBadge
                  ">

                    IA ACTIVE

                  </div>

                  <div class="
                    fp-overviewBadge
                  ">

                    REALTIME

                  </div>

                </div>

              </div>

              <div class="
                fp-flex
                fp-gap12
              ">

                <button class="
                  fp-btn
                  fp-btnGhost
                ">

                  Export

                </button>

                <button class="
                  fp-btn
                  fp-btnPrimary
                ">

                  Nouveau rapport

                </button>

              </div>

            </div>

          </div>

        </div>

        <!-- KPI -->

        <div class="
          fp-kpiGrid
        ">

          <div class="
            fp-kpiCard
          ">

            <div class="
              fp-kpiTop
            ">

              <div class="
                fp-kpiLabel
              ">

                Santé globale

              </div>

              <div class="
                fp-kpiIcon
              ">

                🧠

              </div>

            </div>

            <div class="
              fp-kpiValue
            ">

              ${health}

            </div>

            <div class="
              fp-kpiBottom
            ">

              <div class="
                fp-kpiTrend
                fp-kpiTrendUp
              ">

                +4%

              </div>

            </div>

          </div>

          <div class="
            fp-kpiCard
          ">

            <div class="
              fp-kpiTop
            ">

              <div class="
                fp-kpiLabel
              ">

                SEO Score

              </div>

              <div class="
                fp-kpiIcon
              ">

                📈

              </div>

            </div>

            <div class="
              fp-kpiValue
            ">

              ${seo}

            </div>

          </div>

          <div class="
            fp-kpiCard
          ">

            <div class="
              fp-kpiTop
            ">

              <div class="
                fp-kpiLabel
              ">

                Incidents

              </div>

              <div class="
                fp-kpiIcon
              ">

                🚨

              </div>

            </div>

            <div class="
              fp-kpiValue
            ">

              ${incidents}

            </div>

          </div>

          <div class="
            fp-kpiCard
          ">

            <div class="
              fp-kpiTop
            ">

              <div class="
                fp-kpiLabel
              ">

                Monitors

              </div>

              <div class="
                fp-kpiIcon
              ">

                🛰️

              </div>

            </div>

            <div class="
              fp-kpiValue
            ">

              ${state.monitors.length || 0}

            </div>

          </div>

        </div>

        <!-- QUICK ACTIONS -->

        <div class="
          fp-mt24
        ">

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              <div class="
                fp-cardTitle
              ">

                Command Center

              </div>

            </div>

            <div class="
              fp-cardBody
            ">

              ${renderQuickActions()}

            </div>

          </div>

        </div>

        <!-- GRID -->

        <div class="
          fp-grid2
          fp-mt24
        ">

          <!-- MONITORS -->

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              <div class="
                fp-cardTitle
              ">

                Monitoring live

              </div>

            </div>

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-list
              ">

                ${(state.monitors || [])
                  .slice(0,5)
                  .map(monitor => `

                    <div class="
                      fp-listItem
                    ">

                      <div class="
                        fp-flex
                        fp-alignCenter
                        fp-justifyBetween
                      ">

                        <div>

                          <div class="
                            fp-listTitle
                          ">

                            ${monitor.name || 'Monitor'}

                          </div>

                          <div class="
                            fp-listText
                          ">

                            ${monitor.url || ''}

                          </div>

                        </div>

                        <div class="
                          fp-dot
                          ${
                            monitor.status === 'down'
                              ? 'offline'
                              : 'online'
                          }
                        "></div>

                      </div>

                    </div>

                  `).join('')}

              </div>

            </div>

          </div>

          <!-- ALERTS -->

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              <div class="
                fp-cardTitle
              ">

                Alertes critiques

              </div>

            </div>

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-alertCenter
              ">

                ${(state.alerts || [])
                  .slice(0,5)
                  .map(alert => `

                    <div class="
                      fp-alertCard
                    ">

                      <div class="
                        fp-alertIcon
                        ${alert.type || 'warning'}
                      ">

                        ⚠️

                      </div>

                      <div class="
                        fp-alertContent
                      ">

                        <div class="
                          fp-alertTitle
                        ">

                          ${alert.title || 'Alerte'}

                        </div>

                        <div class="
                          fp-alertText
                        ">

                          ${alert.text || ''}

                        </div>

                      </div>

                    </div>

                  `).join('')}

              </div>

            </div>

          </div>

        </div>

      </div>

    `;
  };

/* =========================================================
   FINAL OVERVIEW OVERRIDE
========================================================= */

renderOverview =
  renderAdvancedOverview;
/* =========================================================
   ADVANCED TEAM WORKSPACE
========================================================= */

function renderAdvancedTeam(){

  const members = [

    {

      name:
        'Alex Martin',

      role:
        'SEO Manager',

      status:
        'online',

      tasks:
        12,

    },

    {

      name:
        'Sarah Klein',

      role:
        'Infrastructure Lead',

      status:
        'online',

      tasks:
        8,

    },

    {

      name:
        'Lucas Bernard',

      role:
        'Growth Operator',

      status:
        'warning',

      tasks:
        5,

    },

  ];

  const channels = [

    '#general',
    '#seo',
    '#monitoring',
    '#growth',
    '#reports',

  ];

  const messages = [

    {

      author:
        'Alex',

      role:
        'SEO',

      text:
        'Les nouvelles pages locales commencent à ranker.',

      time:
        '09:12',

    },

    {

      author:
        'Sarah',

      role:
        'Infra',

      text:
        'Le cluster monitoring est maintenant stable.',

      time:
        '10:42',

    },

    {

      author:
        'Lucas',

      role:
        'Growth',

      text:
        'Le nouveau funnel augmente les conversions.',

      time:
        '11:27',

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <div class="
        fp-grid3
      ">

        <!-- CHANNELS -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            <div class="
              fp-cardTitle
            ">

              Channels

            </div>

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-list
            ">

              ${channels.map(channel => `

                <div class="
                  fp-listItem
                ">

                  ${channel}

                </div>

              `).join('')}

            </div>

          </div>

        </div>

        <!-- CHAT -->

        <div class="
          fp-card
        " style="
          grid-column:span 2;
        ">

          <div class="
            fp-cardHeader
          ">

            <div class="
              fp-cardTitle
            ">

              Team Workspace

            </div>

            <button class="
              fp-btn
              fp-btnPrimary
            ">

              Nouveau thread

            </button>

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-chatWrap
            ">

              <div class="
                fp-chatMessages
              ">

                ${messages.map(message => `

                  <div class="
                    fp-chatMessage
                  ">

                    <div class="
                      fp-chatAvatar
                    ">

                      ${message.author[0]}

                    </div>

                    <div class="
                      fp-chatBubble
                    ">

                      <div class="
                        fp-flex
                        fp-alignCenter
                        fp-gap8
                      ">

                        <div class="
                          fp-chatAuthor
                        ">

                          ${message.author}

                        </div>

                        <div class="
                          fp-badge
                          fp-badgePrimary
                        ">

                          ${message.role}

                        </div>

                      </div>

                      <div class="
                        fp-chatText
                      ">

                        ${message.text}

                      </div>

                      <div class="
                        fp-chatTime
                      ">

                        ${message.time}

                      </div>

                    </div>

                  </div>

                `).join('')}

              </div>

              <div class="
                fp-chatComposer
              ">

                <input
                  class="fp-input"
                  placeholder="
                    Envoyer un message...
                  "
                />

                <button class="
                  fp-btn
                  fp-btnPrimary
                ">

                  Envoyer

                </button>

              </div>

            </div>

          </div>

        </div>

      </div>

      <!-- TEAM -->

      <div class="
        fp-mt24
      ">

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            <div class="
              fp-cardTitle
            ">

              Team Members

            </div>

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-grid3
            ">

              ${members.map(member => `

                <div class="
                  fp-userCard
                ">

                  <div class="
                    fp-userAvatar
                  ">

                    ${
                      member.name
                        .split(' ')
                        .map(x => x[0])
                        .join('')
                    }

                  </div>

                  <div class="
                    fp-wFull
                  ">

                    <div class="
                      fp-flex
                      fp-alignCenter
                      fp-justifyBetween
                    ">

                      <div class="
                        fp-userName
                      ">

                        ${member.name}

                      </div>

                      <div class="
                        fp-dot
                        ${member.status}
                      "></div>

                    </div>

                    <div class="
                      fp-userEmail
                    ">

                      ${member.role}

                    </div>

                    <div class="
                      fp-mt12
                      fp-textSm
                      fp-muted
                    ">

                      ${member.tasks} missions actives

                    </div>

                  </div>

                </div>

              `).join('')}

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   OVERRIDE TEAM PAGE
========================================================= */

renderTeam =
  renderAdvancedTeam;
/* =========================================================
   ADVANCED REPORT ENGINE
========================================================= */

function renderAdvancedReports(){

  const reports = [

    {

      title:
        'Executive SEO Report',

      category:
        'SEO',

      score:
        91,

      pages:
        42,

      generated:
        'Aujourd’hui',

      status:
        'success',

    },

    {

      title:
        'Infrastructure Incident Report',

      category:
        'Monitoring',

      score:
        84,

      pages:
        28,

      generated:
        'Hier',

      status:
        'warning',

    },

    {

      title:
        'Growth Conversion Analysis',

      category:
        'Analytics',

      score:
        96,

      pages:
        37,

      generated:
        'Cette semaine',

      status:
        'success',

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Executive Reports

              </div>

              <div class="
                fp-sectionText
              ">

                Rapports premium,
                exports PDF,
                monitoring,
                analytics
                et SEO.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Historique

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Nouveau rapport

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- REPORTS -->

      <div class="
        fp-reportGrid
        fp-mt24
      ">

        ${reports.map(report => `

          <div class="
            fp-reportCard
          ">

            <div class="
              fp-reportTop
            ">

              <div>

                <div class="
                  fp-flex
                  fp-alignCenter
                  fp-gap12
                ">

                  <div class="
                    fp-reportTitle
                  ">

                    ${report.title}

                  </div>

                  <div class="
                    fp-badge
                    ${
                      report.status === 'success'
                        ? 'fp-badgeSuccess'
                        : 'fp-badgeWarning'
                    }
                  ">

                    ${report.category}

                  </div>

                </div>

                <div class="
                  fp-reportText
                ">

                  Généré :
                  ${report.generated}

                </div>

              </div>

              <div class="
                fp-auditScore
              ">

                ${report.score}

              </div>

            </div>

            <div class="
              fp-reportStats
            ">

              <div class="
                fp-reportStat
              ">

                ${report.pages} pages

              </div>

              <div class="
                fp-reportStat
              ">

                PDF premium

              </div>

              <div class="
                fp-reportStat
              ">

                IA incluse

              </div>

            </div>

            <div class="
              fp-mt24
              fp-flex
              fp-gap12
            ">

              <button
                class="
                  fp-btn
                  fp-btnPrimary
                "

                data-export-report="
                  ${report.title}
                "
              >

                Exporter

              </button>

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Prévisualiser

              </button>

            </div>

          </div>

        `).join('')}

      </div>

      <!-- REPORT ANALYTICS -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Rapports générés

          </div>

          <div class="
            fp-kpiValue
          ">

            284

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Exports PDF

          </div>

          <div class="
            fp-kpiValue
          ">

            142

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Satisfaction client

          </div>

          <div class="
            fp-kpiValue
          ">

            98%

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   REPORT EVENTS
========================================================= */

function bindReportEvents(){

  qsa('[data-export-report]')
    .forEach(button => {

      button.onclick = () => {

        const report =
          button.dataset.exportReport;

        toastAction({

          text:
            `Export ${report} lancé`,

          type:
            'success',

          button:
            'Voir',

          callback(){

            setRoute(
              'exports'
            );
          },

        });

      };
    });
}

/* =========================================================
   OVERRIDE REPORTS
========================================================= */

renderReports =
  renderAdvancedReports;

/* =========================================================
   EXTEND BIND EVENTS
========================================================= */

const previousBindEventsReports =
  bindEvents;

bindEvents = function(){

  previousBindEventsReports();

  bindReportEvents();
};
/* =========================================================
   ADVANCED SETTINGS ENGINE
========================================================= */

function renderAdvancedSettings(){

  return `

    <div class="
      fp-page
    ">

      <div class="
        fp-settingsGrid
      ">

        <!-- SIDEBAR -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-settingsNav
            ">

              <div class="
                fp-settingsNavItem
                active
              ">

                Général

              </div>

              <div class="
                fp-settingsNavItem
              ">

                Workspace

              </div>

              <div class="
                fp-settingsNavItem
              ">

                Monitoring

              </div>

              <div class="
                fp-settingsNavItem
              ">

                Notifications

              </div>

              <div class="
                fp-settingsNavItem
              ">

                Billing

              </div>

              <div class="
                fp-settingsNavItem
              ">

                API

              </div>

              <div class="
                fp-settingsNavItem
              ">

                Sécurité

              </div>

              <div class="
                fp-settingsNavItem
              ">

                IA

              </div>

            </div>

          </div>

        </div>

        <!-- CONTENT -->

        <div class="
          fp-flex
          fp-flexCol
          fp-gap20
        ">

          <!-- GENERAL -->

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              <div class="
                fp-cardTitle
              ">

                Paramètres généraux

              </div>

            </div>

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-formGrid
              ">

                <div class="
                  fp-field
                ">

                  <label class="
                    fp-label
                  ">

                    Workspace

                  </label>

                  <input
                    class="fp-input"
                    value="FlowPoint"
                  />

                </div>

                <div class="
                  fp-field
                ">

                  <label class="
                    fp-label
                  ">

                    Domaine

                  </label>

                  <input
                    class="fp-input"
                    value="flowpoint.pro"
                  />

                </div>

                <div class="
                  fp-field
                ">

                  <label class="
                    fp-label
                  ">

                    Email alertes

                  </label>

                  <input
                    class="fp-input"
                    value="
                      alerts@flowpoint.pro
                    "
                  />

                </div>

                <div class="
                  fp-field
                ">

                  <label class="
                    fp-label
                  ">

                    Fuseau horaire

                  </label>

                  <select class="
                    fp-select
                  ">

                    <option>
                      Europe/Paris
                    </option>

                  </select>

                </div>

              </div>

              <div class="
                fp-mt24
              ">

                <button class="
                  fp-btn
                  fp-btnPrimary
                ">

                  Sauvegarder

                </button>

              </div>

            </div>

          </div>

          <!-- MONITORING -->

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              <div class="
                fp-cardTitle
              ">

                Monitoring

              </div>

            </div>

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-grid2
              ">

                <div class="
                  fp-listItem
                ">

                  <div class="
                    fp-listTitle
                  ">

                    Intervalle checks

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Toutes les 60 secondes

                  </div>

                </div>

                <div class="
                  fp-listItem
                ">

                  <div class="
                    fp-listTitle
                  ">

                    Alertes uptime

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Activées

                  </div>

                </div>

              </div>

            </div>

          </div>

          <!-- AI -->

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              <div class="
                fp-cardTitle
              ">

                FlowPoint AI

              </div>

            </div>

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-list
              ">

                <div class="
                  fp-listItem
                ">

                  <div class="
                    fp-flex
                    fp-alignCenter
                    fp-justifyBetween
                  ">

                    <div>

                      <div class="
                        fp-listTitle
                      ">

                        Suggestions automatiques

                      </div>

                      <div class="
                        fp-listText
                      ">

                        IA proactive activée

                      </div>

                    </div>

                    <div class="
                      fp-dot
                      online
                    "></div>

                  </div>

                </div>

                <div class="
                  fp-listItem
                ">

                  <div class="
                    fp-flex
                    fp-alignCenter
                    fp-justifyBetween
                  ">

                    <div>

                      <div class="
                        fp-listTitle
                      ">

                        Rapports IA

                      </div>

                      <div class="
                        fp-listText
                      ">

                        Génération executive active

                      </div>

                    </div>

                    <div class="
                      fp-dot
                      online
                    "></div>

                  </div>

                </div>

              </div>

            </div>

          </div>

          <!-- SECURITY -->

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              <div class="
                fp-cardTitle
              ">

                Sécurité

              </div>

            </div>

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-grid3
              ">

                <div class="
                  fp-kpiCard
                ">

                  <div class="
                    fp-kpiLabel
                  ">

                    2FA

                  </div>

                  <div class="
                    fp-kpiValue
                  ">

                    ON

                  </div>

                </div>

                <div class="
                  fp-kpiCard
                ">

                  <div class="
                    fp-kpiLabel
                  ">

                    Sessions

                  </div>

                  <div class="
                    fp-kpiValue
                  ">

                    4

                  </div>

                </div>

                <div class="
                  fp-kpiCard
                ">

                  <div class="
                    fp-kpiLabel
                  ">

                    Score sécurité

                  </div>

                  <div class="
                    fp-kpiValue
                  ">

                    98

                  </div>

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   SETTINGS SAVE
========================================================= */

async function saveSettings(){

  try{

    toast(
      'Sauvegarde...',
      'info'
    );

    await api(

      '/api/settings',

      {

        method:'POST',

        body:JSON.stringify({

          workspace:
            'FlowPoint',

        }),

      }
    );

    toast(
      'Paramètres sauvegardés',
      'success'
    );

  }catch(err){

    toast(
      err.message ||
      'Erreur paramètres',
      'danger'
    );
  }
}

/* =========================================================
   SETTINGS EVENTS
========================================================= */

function bindSettingsEvents(){

  qsa('.fp-settingsNavItem')
    .forEach(item => {

      item.onclick = () => {

        qsa('.fp-settingsNavItem')
          .forEach(x =>

            x.classList.remove(
              'active'
            )
          );

        item.classList.add(
          'active'
        );
      };
    });

  qsa('.fp-btnPrimary')
    .forEach(button => {

      if(

        button.textContent
          .trim()
          .toLowerCase()
          === 'sauvegarder'

      ){

        button.onclick =
          saveSettings;
      }
    });
}

/* =========================================================
   OVERRIDE SETTINGS
========================================================= */

renderSettings =
  renderAdvancedSettings;

/* =========================================================
   EXTEND EVENTS
========================================================= */

const previousBindSettings =
  bindEvents;

bindEvents = function(){

  previousBindSettings();

  bindSettingsEvents();
};
/* =========================================================
   ADVANCED LOCAL SEO ENGINE
========================================================= */

function renderAdvancedLocalSeo(){

  const cities = [

    {

      city:
        'Bruxelles',

      visibility:
        92,

      traffic:
        '+28%',

      keywords:
        148,

    },

    {

      city:
        'Liège',

      visibility:
        84,

      traffic:
        '+16%',

      keywords:
        102,

    },

    {

      city:
        'Namur',

      visibility:
        71,

      traffic:
        '+11%',

      keywords:
        58,

    },

    {

      city:
        'Charleroi',

      visibility:
        66,

      traffic:
        '+8%',

      keywords:
        44,

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Local SEO Command

              </div>

              <div class="
                fp-sectionText
              ">

                Analyse géographique,
                visibilité locale,
                pages SEO
                et positionnement Google.

              </div>

            </div>

            <button class="
              fp-btn
              fp-btnPrimary
            ">

              Nouveau scan local

            </button>

          </div>

        </div>

      </div>

      <!-- GRID -->

      <div class="
        fp-localGrid
        fp-mt24
      ">

        <!-- MAP -->

        <div class="
          fp-card
          fp-mapCard
        ">

          <div class="
            fp-cardHeader
          ">

            <div class="
              fp-cardTitle
            ">

              Carte géographique

            </div>

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-mapWrap
            ">

              <div class="
                fp-hFull
                fp-flex
                fp-alignCenter
                fp-justifyCenter
                fp-muted
              ">

                Google Maps SEO Layer

              </div>

            </div>

          </div>

        </div>

        <!-- SIDE -->

        <div class="
          fp-flex
          fp-flexCol
          fp-gap20
        ">

          <!-- VISIBILITY -->

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              <div class="
                fp-cardTitle
              ">

                Visibilité locale

              </div>

            </div>

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-rankingList
              ">

                ${cities.map(city => `

                  <div class="
                    fp-rankingItem
                  ">

                    <div>

                      <div class="
                        fp-rankingKeyword
                      ">

                        ${city.city}

                      </div>

                      <div class="
                        fp-muted
                        fp-textSm
                        fp-mt8
                      ">

                        ${city.keywords}
                        mots-clés

                      </div>

                    </div>

                    <div class="
                      fp-rankingPosition
                    ">

                      ${city.visibility}

                    </div>

                  </div>

                `).join('')}

              </div>

            </div>

          </div>

          <!-- QUICK INSIGHTS -->

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              <div class="
                fp-cardTitle
              ">

                IA Insights

              </div>

            </div>

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-list
              ">

                <div class="
                  fp-listItem
                ">

                  <div class="
                    fp-listTitle
                  ">

                    Bruxelles sous-exploitée

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Potentiel élevé sur requêtes locales.

                  </div>

                </div>

                <div class="
                  fp-listItem
                ">

                  <div class="
                    fp-listTitle
                  ">

                    Liège progresse

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Croissance organique stable.

                  </div>

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

      <!-- CITY CARDS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        ${cities.map(city => `

          <div class="
            fp-card
          ">

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-flex
                fp-alignCenter
                fp-justifyBetween
              ">

                <div>

                  <div class="
                    fp-sectionTitle
                  ">

                    ${city.city}

                  </div>

                  <div class="
                    fp-sectionText
                  ">

                    Visibilité :
                    ${city.visibility}/100

                  </div>

                </div>

                <div class="
                  fp-badge
                  fp-badgeSuccess
                ">

                  ${city.traffic}

                </div>

              </div>

              <div class="
                fp-mt24
              ">

                <div class="
                  fp-progress
                ">

                  <div
                    class="
                      fp-progressBar
                    "

                    style="
                      width:${city.visibility}%
                    "
                  ></div>

                </div>

              </div>

            </div>

          </div>

        `).join('')}

      </div>

    </div>

  `;
}

/* =========================================================
   OVERRIDE LOCAL SEO
========================================================= */

renderLocalSeo =
  renderAdvancedLocalSeo;
/* =========================================================
   ADVANCED COMPETITOR ENGINE
========================================================= */

function renderAdvancedCompetitors(){

  const competitors = [

    {

      name:
        'AgencyFlow',

      category:
        'SEO Platform',

      seo:
        82,

      performance:
        76,

      authority:
        71,

      growth:
        '+12%',

    },

    {

      name:
        'RankSphere',

      category:
        'Growth Suite',

      seo:
        91,

      performance:
        84,

      authority:
        79,

      growth:
        '+22%',

    },

    {

      name:
        'MonitorStack',

      category:
        'Monitoring SaaS',

      seo:
        63,

      performance:
        94,

      authority:
        66,

      growth:
        '+8%',

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Competitive Intelligence

              </div>

              <div class="
                fp-sectionText
              ">

                Benchmark SEO,
                performance,
                visibilité,
                croissance
                et positionnement marché.

              </div>

            </div>

            <button class="
              fp-btn
              fp-btnPrimary
            ">

              Nouveau benchmark

            </button>

          </div>

        </div>

      </div>

      <!-- MAIN GRID -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- COMPETITORS -->

        <div class="
          fp-flex
          fp-flexCol
          fp-gap20
        ">

          ${competitors.map(item => `

            <div class="
              fp-card
            ">

              <div class="
                fp-cardBody
              ">

                <div class="
                  fp-flex
                  fp-alignCenter
                  fp-justifyBetween
                ">

                  <div>

                    <div class="
                      fp-sectionTitle
                    ">

                      ${item.name}

                    </div>

                    <div class="
                      fp-sectionText
                    ">

                      ${item.category}

                    </div>

                  </div>

                  <div class="
                    fp-badge
                    fp-badgeSuccess
                  ">

                    ${item.growth}

                  </div>

                </div>

                <div class="
                  fp-mt24
                  fp-flex
                  fp-flexCol
                  fp-gap20
                ">

                  <div>

                    <div class="
                      fp-flex
                      fp-alignCenter
                      fp-justifyBetween
                      fp-mb8
                    ">

                      <div class="
                        fp-textSm
                      ">

                        SEO

                      </div>

                      <div class="
                        fp-textSm
                      ">

                        ${item.seo}

                      </div>

                    </div>

                    <div class="
                      fp-progress
                    ">

                      <div
                        class="
                          fp-progressBar
                        "

                        style="
                          width:${item.seo}%
                        "
                      ></div>

                    </div>

                  </div>

                  <div>

                    <div class="
                      fp-flex
                      fp-alignCenter
                      fp-justifyBetween
                      fp-mb8
                    ">

                      <div class="
                        fp-textSm
                      ">

                        Performance

                      </div>

                      <div class="
                        fp-textSm
                      ">

                        ${item.performance}

                      </div>

                    </div>

                    <div class="
                      fp-progress
                    ">

                      <div
                        class="
                          fp-progressBar
                        "

                        style="
                          width:${item.performance}%
                        "
                      ></div>

                    </div>

                  </div>

                  <div>

                    <div class="
                      fp-flex
                      fp-alignCenter
                      fp-justifyBetween
                      fp-mb8
                    ">

                      <div class="
                        fp-textSm
                      ">

                        Authority

                      </div>

                      <div class="
                        fp-textSm
                      ">

                        ${item.authority}

                      </div>

                    </div>

                    <div class="
                      fp-progress
                    ">

                      <div
                        class="
                          fp-progressBar
                        "

                        style="
                          width:${item.authority}%
                        "
                      ></div>

                    </div>

                  </div>

                </div>

              </div>

            </div>

          `).join('')}

        </div>

        <!-- SIDE PANEL -->

        <div class="
          fp-flex
          fp-flexCol
          fp-gap20
        ">

          <!-- AI -->

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              <div class="
                fp-cardTitle
              ">

                IA Competitive Insights

              </div>

            </div>

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-list
              ">

                <div class="
                  fp-listItem
                ">

                  <div class="
                    fp-listTitle
                  ">

                    RankSphere domine le SEO

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Forte présence organique détectée.

                  </div>

                </div>

                <div class="
                  fp-listItem
                ">

                  <div class="
                    fp-listTitle
                  ">

                    MonitorStack plus rapide

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Performance technique élevée.

                  </div>

                </div>

                <div class="
                  fp-listItem
                ">

                  <div class="
                    fp-listTitle
                  ">

                    Opportunité marché local

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Faible concurrence géographique.

                  </div>

                </div>

              </div>

            </div>

          </div>

          <!-- QUICK STATS -->

          <div class="
            fp-grid2
          ">

            <div class="
              fp-kpiCard
            ">

              <div class="
                fp-kpiLabel
              ">

                Concurrents suivis

              </div>

              <div class="
                fp-kpiValue
              ">

                24

              </div>

            </div>

            <div class="
              fp-kpiCard
            ">

              <div class="
                fp-kpiLabel
              ">

                Opportunités

              </div>

              <div class="
                fp-kpiValue
              ">

                12

              </div>

            </div>

          </div>

          <!-- CHART -->

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              <div class="
                fp-cardTitle
              ">

                Growth Comparison

              </div>

            </div>

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-chartEmpty
              ">

                Competitive analytics chart

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   OVERRIDE COMPETITORS
========================================================= */

renderCompetitors =
  renderAdvancedCompetitors;
/* =========================================================
   ADVANCED ANALYTICS ENGINE
========================================================= */

function renderAdvancedAnalytics(){

  const metrics = [

    {

      title:
        'SEO Growth',

      value:
        '+28%',

      trend:
        'up',

      text:
        'Croissance organique sur 30 jours',

    },

    {

      title:
        'Conversion Rate',

      value:
        '4.8%',

      trend:
        'up',

      text:
        'Optimisation du funnel onboarding',

    },

    {

      title:
        'Bounce Rate',

      value:
        '-18%',

      trend:
        'up',

      text:
        'Amélioration UX et vitesse',

    },

    {

      title:
        'Infrastructure Health',

      value:
        '99.98%',

      trend:
        'stable',

      text:
        'Monitoring et uptime excellents',

    },

  ];

  const channels = [

    {

      name:
        'SEO Organique',

      traffic:
        '48k',

      growth:
        '+32%',

    },

    {

      name:
        'Direct',

      traffic:
        '22k',

      growth:
        '+11%',

    },

    {

      name:
        'Referral',

      traffic:
        '14k',

      growth:
        '+6%',

    },

    {

      name:
        'Social',

      traffic:
        '9k',

      growth:
        '+18%',

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Analytics Intelligence

              </div>

              <div class="
                fp-sectionText
              ">

                SEO,
                conversions,
                monitoring,
                croissance
                et performance globale.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Export analytics

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Nouveau dashboard

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${metrics.map(metric => `

          <div class="
            fp-kpiCard
          ">

            <div class="
              fp-kpiTop
            ">

              <div class="
                fp-kpiLabel
              ">

                ${metric.title}

              </div>

              <div class="
                fp-kpiIcon
              ">

                ${
                  metric.trend === 'up'
                    ? '📈'
                    : '🛰️'
                }

              </div>

            </div>

            <div class="
              fp-kpiValue
            ">

              ${metric.value}

            </div>

            <div class="
              fp-kpiBottom
            ">

              <div class="
                fp-muted
                fp-textSm
              ">

                ${metric.text}

              </div>

            </div>

          </div>

        `).join('')}

      </div>

      <!-- MAIN -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- CHARTS -->

        <div class="
          fp-flex
          fp-flexCol
          fp-gap20
        ">

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              <div class="
                fp-cardTitle
              ">

                Traffic Evolution

              </div>

            </div>

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-chartEmpty
              ">

                Analytics traffic chart

              </div>

            </div>

          </div>

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              <div class="
                fp-cardTitle
              ">

                Conversion Analytics

              </div>

            </div>

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-chartEmpty
              ">

                Conversion analytics chart

              </div>

            </div>

          </div>

        </div>

        <!-- SIDE -->

        <div class="
          fp-flex
          fp-flexCol
          fp-gap20
        ">

          <!-- CHANNELS -->

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              <div class="
                fp-cardTitle
              ">

                Traffic Sources

              </div>

            </div>

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-list
              ">

                ${channels.map(channel => `

                  <div class="
                    fp-listItem
                  ">

                    <div class="
                      fp-flex
                      fp-alignCenter
                      fp-justifyBetween
                    ">

                      <div>

                        <div class="
                          fp-listTitle
                        ">

                          ${channel.name}

                        </div>

                        <div class="
                          fp-listText
                        ">

                          ${channel.traffic}
                          visiteurs

                        </div>

                      </div>

                      <div class="
                        fp-badge
                        fp-badgeSuccess
                      ">

                        ${channel.growth}

                      </div>

                    </div>

                  </div>

                `).join('')}

              </div>

            </div>

          </div>

          <!-- AI SUMMARY -->

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              <div class="
                fp-cardTitle
              ">

                IA Summary

              </div>

            </div>

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-list
              ">

                <div class="
                  fp-listItem
                ">

                  <div class="
                    fp-listTitle
                  ">

                    Forte croissance SEO

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Les landing pages locales performent.

                  </div>

                </div>

                <div class="
                  fp-listItem
                ">

                  <div class="
                    fp-listTitle
                  ">

                    Conversion améliorée

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Funnel onboarding optimisé.

                  </div>

                </div>

                <div class="
                  fp-listItem
                ">

                  <div class="
                    fp-listTitle
                  ">

                    Infrastructure stable

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Aucun incident critique détecté.

                  </div>

                </div>

              </div>

            </div>

          </div>

          <!-- LIVE -->

          <div class="
            fp-kpiCard
          ">

            <div class="
              fp-kpiLabel
            ">

              Live Visitors

            </div>

            <div class="
              fp-kpiValue
            ">

              184

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   OVERRIDE ANALYTICS
========================================================= */

renderAnalytics =
  renderAdvancedAnalytics;
/* =========================================================
   ADVANCED AI ENGINE
========================================================= */

function renderAdvancedAi(){

  const suggestions = [

    {

      title:
        'Créer plus de pages locales',

      text:
        'Bruxelles et Namur montrent un fort potentiel SEO.',

      impact:
        '+22% trafic',

    },

    {

      title:
        'Optimiser les Core Web Vitals',

      text:
        'Certaines pages restent plus lentes sur mobile.',

      impact:
        '+11% conversion',

    },

    {

      title:
        'Renforcer le maillage interne',

      text:
        'Plusieurs pages stratégiques manquent de liens.',

      impact:
        '+18% visibilité',

    },

  ];

  const conversations = [

    {

      title:
        'SEO Executive Analysis',

      category:
        'SEO',

      time:
        'Aujourd’hui',

    },

    {

      title:
        'Infrastructure Optimization',

      category:
        'Monitoring',

      time:
        'Hier',

    },

    {

      title:
        'Growth Opportunities',

      category:
        'Growth',

      time:
        'Cette semaine',

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                FlowPoint AI

              </div>

              <div class="
                fp-sectionText
              ">

                Intelligence stratégique,
                analyses SEO,
                monitoring,
                croissance
                et recommandations premium.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Historique

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Nouveau chat

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- GRID -->

      <div class="
        fp-aiLayout
        fp-mt24
      ">

        <!-- SIDEBAR -->

        <div class="
          fp-aiSidebar
        ">

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              <div class="
                fp-cardTitle
              ">

                Conversations

              </div>

            </div>

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-aiConversationList
              ">

                ${conversations.map(
                  (conversation,index) => `

                    <div class="
                      fp-aiConversation
                      ${
                        index === 0
                          ? 'active'
                          : ''
                      }
                    ">

                      <div class="
                        fp-aiConversationTitle
                      ">

                        ${conversation.title}

                      </div>

                      <div class="
                        fp-flex
                        fp-alignCenter
                        fp-justifyBetween
                        fp-mt8
                      ">

                        <div class="
                          fp-aiConversationMeta
                        ">

                          ${conversation.time}

                        </div>

                        <div class="
                          fp-badge
                          fp-badgePrimary
                        ">

                          ${conversation.category}

                        </div>

                      </div>

                    </div>

                  `
                ).join('')}

              </div>

            </div>

          </div>

          <!-- AI STATUS -->

          <div class="
            fp-card
            fp-mt20
          ">

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-flex
                fp-alignCenter
                fp-justifyBetween
              ">

                <div>

                  <div class="
                    fp-listTitle
                  ">

                    IA Active

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Monitoring,
                    SEO
                    et analytics connectés

                  </div>

                </div>

                <div class="
                  fp-dot
                  online
                "></div>

              </div>

            </div>

          </div>

        </div>

        <!-- MAIN -->

        <div class="
          fp-flex
          fp-flexCol
          fp-gap20
        ">

          <!-- CHAT -->

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              <div class="
                fp-cardTitle
              ">

                AI Executive Assistant

              </div>

            </div>

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-aiChat
              ">

                <div class="
                  fp-aiMessages
                ">

                  <div class="
                    fp-aiMessage
                    assistant
                  ">

                    <div class="
                      fp-aiAvatar
                    ">

                      AI

                    </div>

                    <div class="
                      fp-aiBubble
                    ">

                      Le site est stable techniquement
                      mais plusieurs opportunités SEO
                      locales restent sous-exploitées.

                    </div>

                  </div>

                  <div class="
                    fp-aiMessage
                    user
                  ">

                    <div class="
                      fp-aiAvatar
                    ">

                      U

                    </div>

                    <div class="
                      fp-aiBubble
                    ">

                      Analyse les meilleures
                      opportunités de croissance.

                    </div>

                  </div>

                  <div class="
                    fp-aiMessage
                    assistant
                  ">

                    <div class="
                      fp-aiAvatar
                    ">

                      AI

                    </div>

                    <div class="
                      fp-aiBubble
                    ">

                      Les meilleures opportunités
                      concernent Bruxelles,
                      Namur
                      et certaines requêtes locales
                      à faible concurrence.

                    </div>

                  </div>

                </div>

                <div class="
                  fp-aiComposer
                ">

                  <textarea
                    class="fp-textarea"
                    placeholder="
                      Demande une analyse,
                      un rapport ou une stratégie...
                    "
                  ></textarea>

                  <button class="
                    fp-btn
                    fp-btnPrimary
                  ">

                    Envoyer

                  </button>

                </div>

              </div>

            </div>

          </div>

          <!-- SUGGESTIONS -->

          <div class="
            fp-grid3
          ">

            ${suggestions.map(item => `

              <div class="
                fp-card
              ">

                <div class="
                  fp-cardBody
                ">

                  <div class="
                    fp-sectionTitle
                  " style="
                    font-size:22px;
                  ">

                    ${item.title}

                  </div>

                  <div class="
                    fp-sectionText
                  ">

                    ${item.text}

                  </div>

                  <div class="
                    fp-mt24
                  ">

                    <div class="
                      fp-badge
                      fp-badgeSuccess
                    ">

                      ${item.impact}

                    </div>

                  </div>

                </div>

              </div>

            `).join('')}

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   OVERRIDE AI
========================================================= */

renderAi =
  renderAdvancedAi;
/* =========================================================
   ADVANCED BILLING PAGE
========================================================= */

function renderAdvancedBilling(){

  const plans = [

    {

      name:
        'Standard',

      price:
        29,

      description:
        'Pour indépendants et petits projets.',

      features:[

        '30 audits / mois',
        '3 monitors',
        '30 exports PDF',
        '1 utilisateur',
        'SEO local basique',

      ],

      active:
        false,

    },

    {

      name:
        'Pro',

      price:
        79,

      description:
        'Le meilleur équilibre croissance.',

      features:[

        '300 audits / mois',
        '50 monitors',
        'Team Workspace',
        'Analytics avancés',
        'FlowPoint AI',
        'Exports premium',

      ],

      active:
        true,

    },

    {

      name:
        'Ultra',

      price:
        199,

      description:
        'Infrastructure et scaling avancé.',

      features:[

        '2000 audits / mois',
        '300 monitors',
        'White-label',
        'Multi équipes',
        'Executive reports',
        'IA avancée',
        'Automatisations',

      ],

      active:
        false,

    },

  ];

  const addons = [

    {

      title:
        '+50 monitors',

      price:
        '+19€',

    },

    {

      title:
        'Extra team seats',

      price:
        '+12€',

    },

    {

      title:
        'White-label exports',

      price:
        '+39€',

    },

    {

      title:
        'AI executive mode',

      price:
        '+49€',

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Billing & Subscription

              </div>

              <div class="
                fp-sectionText
              ">

                Gestion abonnement,
                Stripe,
                facturation,
                add-ons
                et scaling infrastructure.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button
                class="
                  fp-btn
                  fp-btnGhost
                "

                id="
                  fpOpenPortalBtn
                "
              >

                Billing Portal

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Upgrade

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- CURRENT PLAN -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Plan actif

          </div>

          <div class="
            fp-kpiValue
          ">

            PRO

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Prochaine facture

          </div>

          <div class="
            fp-kpiValue
          ">

            79€

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Trial restant

          </div>

          <div class="
            fp-kpiValue
          ">

            11j

          </div>

        </div>

      </div>

      <!-- PLANS -->

      <div class="
        fp-billingPlans
        fp-mt24
      ">

        ${plans.map(plan => `

          <div class="
            fp-billingPlan
            ${
              plan.active
                ? 'active'
                : ''
            }
          ">

            <div class="
              fp-billingPlanName
            ">

              ${plan.name}

            </div>

            <div class="
              fp-billingPrice
            ">

              <div class="
                fp-billingPriceValue
              ">

                ${plan.price}€

              </div>

              <div class="
                fp-billingPricePer
              ">

                /mois

              </div>

            </div>

            <div class="
              fp-sectionText
              fp-mt12
            ">

              ${plan.description}

            </div>

            <div class="
              fp-billingFeatures
              fp-mt24
            ">

              ${plan.features.map(feature => `

                <div class="
                  fp-listItem
                ">

                  ${feature}

                </div>

              `).join('')}

            </div>

            <div class="
              fp-mt24
            ">

              <button
                class="
                  fp-btn
                  ${
                    plan.active
                      ? 'fp-btnGhost'
                      : 'fp-btnPrimary'
                  }
                "

                data-plan="
                  ${plan.name.toLowerCase()}
                "
              >

                ${
                  plan.active
                    ? 'Plan actif'
                    : 'Choisir'
                }

              </button>

            </div>

          </div>

        `).join('')}

      </div>

      <!-- ADDONS -->

      <div class="
        fp-mt24
      ">

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            <div class="
              fp-cardTitle
            ">

              Add-ons premium

            </div>

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-grid2
            ">

              ${addons.map(addon => `

                <div class="
                  fp-listItem
                ">

                  <div class="
                    fp-flex
                    fp-alignCenter
                    fp-justifyBetween
                  ">

                    <div>

                      <div class="
                        fp-listTitle
                      ">

                        ${addon.title}

                      </div>

                    </div>

                    <div class="
                      fp-badge
                      fp-badgePrimary
                    ">

                      ${addon.price}

                    </div>

                  </div>

                </div>

              `).join('')}

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   BILLING EVENTS
========================================================= */

function bindBillingEvents(){

  qsa('[data-plan]')
    .forEach(button => {

      button.onclick = () => {

        const plan =
          button.dataset.plan;

        startCheckout(plan);
      };
    });

  const portalBtn =
    qs('#fpOpenPortalBtn');

  if(portalBtn){

    portalBtn.onclick =
      openBillingPortal;
  }
}

/* =========================================================
   OVERRIDE BILLING
========================================================= */

renderBilling =
  renderAdvancedBilling;

/* =========================================================
   EXTEND EVENTS
========================================================= */

const previousBillingBind =
  bindEvents;

bindEvents = function(){

  previousBillingBind();

  bindBillingEvents();
};
/* =========================================================
   ADVANCED ALERT CENTER
========================================================= */

function renderAdvancedAlerts(){

  const alerts = [

    {

      type:
        'danger',

      title:
        'Incident API critique',

      text:
        'Temps de réponse élevé détecté sur le cluster principal.',

      time:
        'Il y a 4 minutes',

      source:
        'Monitoring',

    },

    {

      type:
        'warning',

      title:
        'SEO local incomplet',

      text:
        'Certaines villes importantes ne possèdent pas encore de pages dédiées.',

      time:
        'Aujourd’hui',

      source:
        'SEO',

    },

    {

      type:
        'success',

      title:
        'Rapports exportés',

      text:
        'Tous les executive reports ont été générés avec succès.',

      time:
        'Aujourd’hui',

      source:
        'Reports',

    },

    {

      type:
        'info',

      title:
        'Nouvelle opportunité détectée',

      text:
        'FlowPoint AI recommande de nouvelles optimisations locales.',

      time:
        'Cette semaine',

      source:
        'AI',

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientDanger
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Alert Center

              </div>

              <div class="
                fp-sectionText
              ">

                Incidents,
                monitoring,
                infrastructure,
                IA
                et alertes critiques temps réel.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Historique

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Configurer alertes

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Alertes critiques

          </div>

          <div class="
            fp-kpiValue
          ">

            2

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Monitoring actif

          </div>

          <div class="
            fp-kpiValue
          ">

            22

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Uptime global

          </div>

          <div class="
            fp-kpiValue
          ">

            99.98%

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            IA monitoring

          </div>

          <div class="
            fp-kpiValue
          ">

            ACTIVE

          </div>

        </div>

      </div>

      <!-- ALERTS -->

      <div class="
        fp-alertCenter
        fp-mt24
      ">

        ${alerts.map(alert => `

          <div class="
            fp-alertCard
          ">

            <div class="
              fp-alertIcon
              ${alert.type}
            ">

              ${
                alert.type === 'danger'
                  ? '⚠️'
                  : alert.type === 'warning'
                    ? '🟠'
                    : alert.type === 'success'
                      ? '✅'
                      : '📡'
              }

            </div>

            <div class="
              fp-alertContent
            ">

              <div class="
                fp-flex
                fp-alignCenter
                fp-justifyBetween
                fp-gap12
              ">

                <div class="
                  fp-alertTitle
                ">

                  ${alert.title}

                </div>

                <div class="
                  fp-badge
                  ${
                    alert.type === 'danger'
                      ? 'fp-badgeDanger'
                      : alert.type === 'warning'
                        ? 'fp-badgeWarning'
                        : alert.type === 'success'
                          ? 'fp-badgeSuccess'
                          : 'fp-badgePrimary'
                  }
                ">

                  ${alert.source}

                </div>

              </div>

              <div class="
                fp-alertText
              ">

                ${alert.text}

              </div>

              <div class="
                fp-alertMeta
              ">

                ${alert.time}

              </div>

            </div>

          </div>

        `).join('')}

      </div>

      <!-- TIMELINE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            Incident Timeline

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-timeline
          ">

            <div class="
              fp-timelineItem
            ">

              <div class="
                fp-timelineDot
              "></div>

              <div class="
                fp-timelineCard
              ">

                <div class="
                  fp-timelineTitle
                ">

                  Cluster monitoring ralenti

                </div>

                <div class="
                  fp-timelineText
                ">

                  Pic de latence détecté sur API principale.

                </div>

                <div class="
                  fp-timelineTime
                ">

                  Aujourd’hui — 10:42

                </div>

              </div>

            </div>

            <div class="
              fp-timelineItem
            ">

              <div class="
                fp-timelineDot
              "></div>

              <div class="
                fp-timelineCard
              ">

                <div class="
                  fp-timelineTitle
                ">

                  Stabilisation infrastructure

                </div>

                <div class="
                  fp-timelineText
                ">

                  Redémarrage automatique réussi.

                </div>

                <div class="
                  fp-timelineTime
                ">

                  Aujourd’hui — 11:04

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   OVERRIDE ALERTS
========================================================= */

renderAlerts =
  renderAdvancedAlerts;
/* =========================================================
   ADVANCED EXPORT CENTER
========================================================= */

function renderAdvancedExports(){

  const exportsData = [

    {

      title:
        'Executive SEO PDF',

      category:
        'SEO',

      description:
        'Rapport premium avec IA et analytics.',

      status:
        'ready',

      size:
        '4.8 MB',

    },

    {

      title:
        'Monitoring Incident Logs',

      category:
        'Monitoring',

      description:
        'Historique complet uptime et incidents.',

      status:
        'processing',

      size:
        '12.2 MB',

    },

    {

      title:
        'Growth Analytics Export',

      category:
        'Analytics',

      description:
        'Conversions, funnels et trafic.',

      status:
        'ready',

      size:
        '7.1 MB',

    },

    {

      title:
        'Local SEO Benchmark',

      category:
        'SEO Local',

      description:
        'Analyse géographique et visibilité.',

      status:
        'ready',

      size:
        '5.2 MB',

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientSuccess
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Export Center

              </div>

              <div class="
                fp-sectionText
              ">

                Exports PDF,
                analytics,
                monitoring,
                SEO
                et rapports executive premium.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Historique exports

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Nouveau export

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Exports générés

          </div>

          <div class="
            fp-kpiValue
          ">

            842

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            PDF premium

          </div>

          <div class="
            fp-kpiValue
          ">

            284

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Automatisations

          </div>

          <div class="
            fp-kpiValue
          ">

            18

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Stockage utilisé

          </div>

          <div class="
            fp-kpiValue
          ">

            72GB

          </div>

        </div>

      </div>

      <!-- EXPORTS -->

      <div class="
        fp-exportGrid
        fp-mt24
      ">

        ${exportsData.map(item => `

          <div class="
            fp-exportCard
          ">

            <div class="
              fp-exportIcon
            ">

              ${
                item.category === 'SEO'
                  ? '📈'
                  : item.category === 'Monitoring'
                    ? '🛰️'
                    : item.category === 'Analytics'
                      ? '📊'
                      : '📍'
              }

            </div>

            <div class="
              fp-exportTitle
            ">

              ${item.title}

            </div>

            <div class="
              fp-exportText
            ">

              ${item.description}

            </div>

            <div class="
              fp-flex
              fp-alignCenter
              fp-gap12
              fp-mt20
            ">

              <div class="
                fp-badge
                fp-badgePrimary
              ">

                ${item.category}

              </div>

              <div class="
                fp-muted
                fp-textSm
              ">

                ${item.size}

              </div>

            </div>

            <div class="
              fp-exportActions
            ">

              <button
                class="
                  fp-btn
                  fp-btnPrimary
                "

                data-export="
                  ${item.title}
                "
              >

                ${
                  item.status === 'processing'
                    ? 'Processing'
                    : 'Télécharger'
                }

              </button>

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Prévisualiser

              </button>

            </div>

          </div>

        `).join('')}

      </div>

      <!-- AUTOMATIONS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            Export Automations

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid2
          ">

            <div class="
              fp-listItem
            ">

              <div class="
                fp-flex
                fp-alignCenter
                fp-justifyBetween
              ">

                <div>

                  <div class="
                    fp-listTitle
                  ">

                    Executive PDF hebdomadaire

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Chaque lundi à 08:00

                  </div>

                </div>

                <div class="
                  fp-dot
                  online
                "></div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-flex
                fp-alignCenter
                fp-justifyBetween
              ">

                <div>

                  <div class="
                    fp-listTitle
                  ">

                    Monitoring incidents

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Temps réel

                  </div>

                </div>

                <div class="
                  fp-dot
                  online
                "></div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   EXPORT EVENTS
========================================================= */

function bindAdvancedExportEvents(){

  qsa('[data-export]')
    .forEach(button => {

      button.onclick = () => {

        const name =
          button.dataset.export;

        toastAction({

          text:
            `${name} prêt`,

          type:
            'success',

          button:
            'Télécharger',

          callback(){

            exportReport(
              'pdf'
            );
          },

        });
      };
    });
}

/* =========================================================
   OVERRIDE EXPORTS
========================================================= */

renderExports =
  renderAdvancedExports;

/* =========================================================
   EXTEND EVENTS
========================================================= */

const previousExportBind =
  bindEvents;

bindEvents = function(){

  previousExportBind();

  bindAdvancedExportEvents();
};
/* =========================================================
   ADVANCED MISSIONS ENGINE
========================================================= */

function renderAdvancedMissions(){

  const missions = [

    {

      title:
        'Créer landing pages Bruxelles',

      description:
        'Développer les pages locales pour améliorer la visibilité SEO.',

      priority:
        'critical',

      progress:
        42,

      assignee:
        'Alex',

      due:
        'Aujourd’hui',

    },

    {

      title:
        'Optimiser cluster monitoring',

      description:
        'Réduire la latence et stabiliser les endpoints critiques.',

      priority:
        'medium',

      progress:
        74,

      assignee:
        'Sarah',

      due:
        'Demain',

    },

    {

      title:
        'Améliorer onboarding conversion',

      description:
        'Optimiser les CTA et les funnels premium.',

      priority:
        'low',

      progress:
        18,

      assignee:
        'Lucas',

      due:
        'Cette semaine',

    },

    {

      title:
        'Executive PDF automation',

      description:
        'Automatiser les exports premium clients.',

      priority:
        'critical',

      progress:
        88,

      assignee:
        'Alex',

      due:
        'Aujourd’hui',

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Mission Control

              </div>

              <div class="
                fp-sectionText
              ">

                Gestion des tâches,
                workflows,
                SEO,
                monitoring,
                automatisations
                et collaboration équipe.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Bibliothèque

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Nouvelle mission

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Missions actives

          </div>

          <div class="
            fp-kpiValue
          ">

            28

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Critiques

          </div>

          <div class="
            fp-kpiValue
          ">

            4

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Complétées

          </div>

          <div class="
            fp-kpiValue
          ">

            142

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Productivité

          </div>

          <div class="
            fp-kpiValue
          ">

            +18%

          </div>

        </div>

      </div>

      <!-- FILTER BAR -->

      <div class="
        fp-filterBar
        fp-mt24
      ">

        <div class="
          fp-filterLeft
        ">

          <div class="
            fp-search
          ">

            <span class="
              fp-searchIcon
            ">
              🔎
            </span>

            <input
              class="fp-input"
              placeholder="
                Rechercher une mission...
              "
            />

          </div>

        </div>

        <div class="
          fp-filterRight
        ">

          <button class="
            fp-btn
            fp-btnGhost
          ">

            Filtrer

          </button>

          <button class="
            fp-btn
            fp-btnPrimary
          ">

            Nouvelle mission

          </button>

        </div>

      </div>

      <!-- MISSIONS -->

      <div class="
        fp-missionGrid
        fp-mt24
      ">

        ${missions.map(mission => `

          <div class="
            fp-missionCard
          ">

            <div class="
              fp-missionTop
            ">

              <div class="
                fp-missionTitle
              ">

                ${mission.title}

              </div>

              <div class="
                fp-missionPriority

                ${
                  mission.priority === 'critical'
                    ? 'fp-priorityCritical'
                    : mission.priority === 'medium'
                      ? 'fp-priorityMedium'
                      : 'fp-priorityLow'
                }
              ">

                ${
                  mission.priority === 'critical'
                    ? 'CRITIQUE'
                    : mission.priority === 'medium'
                      ? 'MOYEN'
                      : 'LOW'
                }

              </div>

            </div>

            <div class="
              fp-missionText
            ">

              ${mission.description}

            </div>

            <div class="
              fp-mt20
            ">

              <div class="
                fp-progress
              ">

                <div
                  class="
                    fp-progressBar
                  "

                  style="
                    width:${mission.progress}%
                  "
                ></div>

              </div>

            </div>

            <div class="
              fp-flex
              fp-alignCenter
              fp-justifyBetween
              fp-mt20
            ">

              <div>

                <div class="
                  fp-textSm
                  fp-font600
                ">

                  ${mission.assignee}

                </div>

                <div class="
                  fp-muted
                  fp-textSm
                ">

                  ${mission.due}

                </div>

              </div>

              <div class="
                fp-badge
                fp-badgePrimary
              ">

                ${mission.progress}%

              </div>

            </div>

            <div class="
              fp-mt24
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Ouvrir

              </button>

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Modifier

              </button>

            </div>

          </div>

        `).join('')}

      </div>

    </div>

  `;
}

/* =========================================================
   OVERRIDE MISSIONS
========================================================= */

renderMissions =
  renderAdvancedMissions;
/* =========================================================
   ADVANCED CALENDAR ENGINE
========================================================= */

function renderAdvancedCalendar(){

  const events = [

    {

      title:
        'SEO Executive Review',

      date:
        '12 Juin',

      hour:
        '09:00',

      type:
        'seo',

    },

    {

      title:
        'Monitoring Infrastructure Audit',

      date:
        '13 Juin',

      hour:
        '11:30',

      type:
        'monitoring',

    },

    {

      title:
        'Growth Strategy Meeting',

      date:
        '14 Juin',

      hour:
        '15:00',

      type:
        'growth',

    },

    {

      title:
        'Client Executive Call',

      date:
        '15 Juin',

      hour:
        '17:00',

      type:
        'client',

    },

  ];

  const days = [

    'Lun',
    'Mar',
    'Mer',
    'Jeu',
    'Ven',
    'Sam',
    'Dim',

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Workspace Calendar

              </div>

              <div class="
                fp-sectionText
              ">

                Planning équipe,
                SEO reviews,
                monitoring,
                clients
                et automatisations.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Synchroniser

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Nouvel évènement

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Évènements

          </div>

          <div class="
            fp-kpiValue
          ">

            48

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Réunions

          </div>

          <div class="
            fp-kpiValue
          ">

            12

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Automatisations

          </div>

          <div class="
            fp-kpiValue
          ">

            8

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Disponibilité

          </div>

          <div class="
            fp-kpiValue
          ">

            92%

          </div>

        </div>

      </div>

      <!-- GRID -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- CALENDAR -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            <div class="
              fp-cardTitle
            ">

              Calendrier

            </div>

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-calendarGrid
            ">

              ${days.map((day,index) => `

                <div class="
                  fp-calendarDay
                ">

                  <div class="
                    fp-calendarDate
                  ">

                    ${day}
                    ${index + 12}

                  </div>

                  <div class="
                    fp-calendarEvent
                  ">

                    SEO Review

                  </div>

                  <div class="
                    fp-calendarEvent
                  ">

                    Monitoring

                  </div>

                </div>

              `).join('')}

            </div>

          </div>

        </div>

        <!-- EVENTS -->

        <div class="
          fp-flex
          fp-flexCol
          fp-gap20
        ">

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              <div class="
                fp-cardTitle
              ">

                Upcoming Events

              </div>

            </div>

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-list
              ">

                ${events.map(event => `

                  <div class="
                    fp-listItem
                  ">

                    <div class="
                      fp-flex
                      fp-alignCenter
                      fp-justifyBetween
                      fp-gap12
                    ">

                      <div>

                        <div class="
                          fp-listTitle
                        ">

                          ${event.title}

                        </div>

                        <div class="
                          fp-listText
                        ">

                          ${event.date}
                          —
                          ${event.hour}

                        </div>

                      </div>

                      <div class="
                        fp-badge
                        ${
                          event.type === 'seo'
                            ? 'fp-badgePrimary'
                            : event.type === 'monitoring'
                              ? 'fp-badgeWarning'
                              : event.type === 'growth'
                                ? 'fp-badgeSuccess'
                                : 'fp-badgeDanger'
                        }
                      ">

                        ${event.type}

                      </div>

                    </div>

                  </div>

                `).join('')}

              </div>

            </div>

          </div>

          <!-- AI PLANNING -->

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              <div class="
                fp-cardTitle
              ">

                IA Planning

              </div>

            </div>

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-list
              ">

                <div class="
                  fp-listItem
                ">

                  <div class="
                    fp-listTitle
                  ">

                    Semaine chargée

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Plusieurs audits critiques détectés.

                  </div>

                </div>

                <div class="
                  fp-listItem
                ">

                  <div class="
                    fp-listTitle
                  ">

                    Créneau disponible

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Vendredi après-midi libre.

                  </div>

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   OVERRIDE CALENDAR
========================================================= */

renderCalendar =
  renderAdvancedCalendar;
/* =========================================================
   ADVANCED NOTES ENGINE
========================================================= */

function renderAdvancedNotes(){

  const notes = [

    {

      title:
        'SEO Quick Wins',

      category:
        'SEO',

      text:
        'Créer davantage de pages locales ciblant Bruxelles et Namur.',

      author:
        'Alex',

      date:
        'Aujourd’hui',

    },

    {

      title:
        'Infrastructure Scaling',

      category:
        'Monitoring',

      text:
        'Prévoir un cluster dédié pour les monitors critiques.',

      author:
        'Sarah',

      date:
        'Hier',

    },

    {

      title:
        'Growth Funnel',

      category:
        'Growth',

      text:
        'Améliorer les CTA onboarding pour augmenter les conversions.',

      author:
        'Lucas',

      date:
        'Cette semaine',

    },

    {

      title:
        'Executive Reporting',

      category:
        'Reports',

      text:
        'Ajouter davantage de visualisations premium dans les PDF.',

      author:
        'Alex',

      date:
        'Cette semaine',

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Workspace Notes

              </div>

              <div class="
                fp-sectionText
              ">

                Centralisation des idées,
                stratégies,
                quick wins,
                infrastructure
                et collaboration équipe.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Bibliothèque

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Nouvelle note

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Notes actives

          </div>

          <div class="
            fp-kpiValue
          ">

            128

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            SEO Insights

          </div>

          <div class="
            fp-kpiValue
          ">

            42

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            AI Suggestions

          </div>

          <div class="
            fp-kpiValue
          ">

            18

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Collaboration

          </div>

          <div class="
            fp-kpiValue
          ">

            ACTIVE

          </div>

        </div>

      </div>

      <!-- FILTER BAR -->

      <div class="
        fp-filterBar
        fp-mt24
      ">

        <div class="
          fp-filterLeft
        ">

          <div class="
            fp-search
          ">

            <span class="
              fp-searchIcon
            ">
              🔎
            </span>

            <input
              class="fp-input"
              placeholder="
                Rechercher une note...
              "
            />

          </div>

        </div>

        <div class="
          fp-filterRight
        ">

          <button class="
            fp-btn
            fp-btnGhost
          ">

            Filtrer

          </button>

          <button class="
            fp-btn
            fp-btnPrimary
          ">

            Nouvelle note

          </button>

        </div>

      </div>

      <!-- NOTES -->

      <div class="
        fp-notesGrid
        fp-mt24
      ">

        ${notes.map(note => `

          <div class="
            fp-noteCard
          ">

            <div class="
              fp-noteTop
            ">

              <div class="
                fp-noteTitle
              ">

                ${note.title}

              </div>

              <div class="
                fp-badge
                ${
                  note.category === 'SEO'
                    ? 'fp-badgePrimary'
                    : note.category === 'Monitoring'
                      ? 'fp-badgeWarning'
                      : note.category === 'Growth'
                        ? 'fp-badgeSuccess'
                        : 'fp-badgeDanger'
                }
              ">

                ${note.category}

              </div>

            </div>

            <div class="
              fp-noteText
            ">

              ${note.text}

            </div>

            <div class="
              fp-flex
              fp-alignCenter
              fp-justifyBetween
              fp-mt24
            ">

              <div>

                <div class="
                  fp-textSm
                  fp-font600
                ">

                  ${note.author}

                </div>

                <div class="
                  fp-muted
                  fp-textSm
                ">

                  ${note.date}

                </div>

              </div>

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Ouvrir

              </button>

            </div>

          </div>

        `).join('')}

      </div>

      <!-- AI INSIGHTS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            IA Insights

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                SEO Local

              </div>

              <div class="
                fp-listText
              ">

                Opportunités importantes détectées à Bruxelles.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Monitoring

              </div>

              <div class="
                fp-listText
              ">

                Plusieurs endpoints critiques doivent être optimisés.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Growth

              </div>

              <div class="
                fp-listText
              ">

                Les funnels premium améliorent les conversions.

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   OVERRIDE NOTES
========================================================= */

renderNotes =
  renderAdvancedNotes;
/* =========================================================
   ADVANCED MONITORS ENGINE
========================================================= */

function renderAdvancedMonitors(){

  const monitors = [

    {

      name:
        'Main API',

      url:
        'api.flowpoint.pro',

      uptime:
        '99.99%',

      latency:
        '84ms',

      status:
        'online',

    },

    {

      name:
        'Dashboard Frontend',

      url:
        'app.flowpoint.pro',

      uptime:
        '99.97%',

      latency:
        '112ms',

      status:
        'online',

    },

    {

      name:
        'Stripe Webhooks',

      url:
        'billing.flowpoint.pro',

      uptime:
        '98.42%',

      latency:
        '248ms',

      status:
        'warning',

    },

    {

      name:
        'Monitoring Cluster',

      url:
        'monitor.flowpoint.pro',

      uptime:
        '97.12%',

      latency:
        '422ms',

      status:
        'danger',

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Monitoring Infrastructure

              </div>

              <div class="
                fp-sectionText
              ">

                Uptime,
                latence,
                incidents,
                endpoints
                et surveillance temps réel.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Historique

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Nouveau monitor

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Uptime global

          </div>

          <div class="
            fp-kpiValue
          ">

            99.98%

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Monitors actifs

          </div>

          <div class="
            fp-kpiValue
          ">

            22

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Incidents

          </div>

          <div class="
            fp-kpiValue
          ">

            2

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Latence moyenne

          </div>

          <div class="
            fp-kpiValue
          ">

            124ms

          </div>

        </div>

      </div>

      <!-- MONITORS -->

      <div class="
        fp-monitorGrid
        fp-mt24
      ">

        ${monitors.map(monitor => `

          <div class="
            fp-monitorCard
          ">

            <div class="
              fp-monitorTop
            ">

              <div>

                <div class="
                  fp-monitorTitle
                ">

                  ${monitor.name}

                </div>

                <div class="
                  fp-monitorUrl
                ">

                  ${monitor.url}

                </div>

              </div>

              <div class="
                fp-dot
                ${monitor.status}
              "></div>

            </div>

            <div class="
              fp-monitorStats
            ">

              <div class="
                fp-monitorStat
              ">

                <div class="
                  fp-monitorStatLabel
                ">

                  Uptime

                </div>

                <div class="
                  fp-monitorStatValue
                ">

                  ${monitor.uptime}

                </div>

              </div>

              <div class="
                fp-monitorStat
              ">

                <div class="
                  fp-monitorStatLabel
                ">

                  Latence

                </div>

                <div class="
                  fp-monitorStatValue
                ">

                  ${monitor.latency}

                </div>

              </div>

            </div>

            <div class="
              fp-chartEmpty
              fp-mt24
            ">

              Monitoring chart

            </div>

            <div class="
              fp-flex
              fp-gap12
              fp-mt24
            ">

              <button
                class="
                  fp-btn
                  fp-btnPrimary
                "

                data-monitor="
                  ${monitor.name}
                "
              >

                Détails

              </button>

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Logs

              </button>

            </div>

          </div>

        `).join('')}

      </div>

      <!-- INCIDENT TIMELINE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            Incident Timeline

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-timeline
          ">

            <div class="
              fp-timelineItem
            ">

              <div class="
                fp-timelineDot
              "></div>

              <div class="
                fp-timelineCard
              ">

                <div class="
                  fp-timelineTitle
                ">

                  Cluster overload détecté

                </div>

                <div class="
                  fp-timelineText
                ">

                  Temps de réponse élevé sur monitoring cluster.

                </div>

                <div class="
                  fp-timelineTime
                ">

                  Aujourd’hui — 09:48

                </div>

              </div>

            </div>

            <div class="
              fp-timelineItem
            ">

              <div class="
                fp-timelineDot
              "></div>

              <div class="
                fp-timelineCard
              ">

                <div class="
                  fp-timelineTitle
                ">

                  Stabilisation automatique

                </div>

                <div class="
                  fp-timelineText
                ">

                  Redémarrage service réussi.

                </div>

                <div class="
                  fp-timelineTime
                ">

                  Aujourd’hui — 10:11

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   MONITOR EVENTS
========================================================= */

function bindMonitorEvents(){

  qsa('[data-monitor]')
    .forEach(button => {

      button.onclick = () => {

        const monitorName =
          button.dataset.monitor;

        openDrawer({

          title:
            monitorName,

          content:`

            <div class="
              fp-grid2
            ">

              <div class="
                fp-kpiCard
              ">

                <div class="
                  fp-kpiLabel
                ">

                  Uptime

                </div>

                <div class="
                  fp-kpiValue
                ">

                  99.98%

                </div>

              </div>

              <div class="
                fp-kpiCard
              ">

                <div class="
                  fp-kpiLabel
                ">

                  Latence

                </div>

                <div class="
                  fp-kpiValue
                ">

                  112ms

                </div>

              </div>

            </div>

            <div class="
              fp-chartEmpty
              fp-mt24
            ">

              Detailed monitoring analytics

            </div>

          `,
        });
      };
    });
}

/* =========================================================
   OVERRIDE MONITORS
========================================================= */

renderMonitors =
  renderAdvancedMonitors;

/* =========================================================
   EXTEND EVENTS
========================================================= */

const previousMonitorBind =
  bindEvents;

bindEvents = function(){

  previousMonitorBind();

  bindMonitorEvents();
};
/* =========================================================
   ADVANCED AUDITS ENGINE
========================================================= */

function renderAdvancedAudits(){

  const audits = [

    {

      domain:
        'flowpoint.pro',

      score:
        91,

      performance:
        96,

      seo:
        88,

      accessibility:
        82,

      issues:
        4,

      trend:
        '+12%',

    },

    {

      domain:
        'client-enterprise.com',

      score:
        84,

      performance:
        78,

      seo:
        89,

      accessibility:
        74,

      issues:
        9,

      trend:
        '+6%',

    },

    {

      domain:
        'local-business.be',

      score:
        72,

      performance:
        68,

      seo:
        74,

      accessibility:
        63,

      issues:
        18,

      trend:
        '-2%',

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                SEO & Performance Audits

              </div>

              <div class="
                fp-sectionText
              ">

                Analyse SEO,
                performance,
                accessibilité,
                Core Web Vitals
                et recommandations IA.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Historique

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Nouveau audit

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Audits générés

          </div>

          <div class="
            fp-kpiValue
          ">

            482

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Score moyen

          </div>

          <div class="
            fp-kpiValue
          ">

            84

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Issues détectées

          </div>

          <div class="
            fp-kpiValue
          ">

            31

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            AI Optimizations

          </div>

          <div class="
            fp-kpiValue
          ">

            128

          </div>

        </div>

      </div>

      <!-- AUDITS -->

      <div class="
        fp-auditGrid
        fp-mt24
      ">

        ${audits.map(audit => `

          <div class="
            fp-auditCard
          ">

            <div class="
              fp-auditTop
            ">

              <div>

                <div class="
                  fp-auditDomain
                ">

                  ${audit.domain}

                </div>

                <div class="
                  fp-muted
                  fp-textSm
                  fp-mt8
                ">

                  Dernière analyse :
                  aujourd’hui

                </div>

              </div>

              <div class="
                fp-auditScore
              ">

                ${audit.score}

              </div>

            </div>

            <div class="
              fp-auditStats
              fp-mt24
            ">

              <div class="
                fp-auditStat
              ">

                <div class="
                  fp-auditStatLabel
                ">

                  Performance

                </div>

                <div class="
                  fp-auditStatValue
                ">

                  ${audit.performance}

                </div>

              </div>

              <div class="
                fp-auditStat
              ">

                <div class="
                  fp-auditStatLabel
                ">

                  SEO

                </div>

                <div class="
                  fp-auditStatValue
                ">

                  ${audit.seo}

                </div>

              </div>

              <div class="
                fp-auditStat
              ">

                <div class="
                  fp-auditStatLabel
                ">

                  Accessibilité

                </div>

                <div class="
                  fp-auditStatValue
                ">

                  ${audit.accessibility}

                </div>

              </div>

            </div>

            <div class="
              fp-chartEmpty
              fp-mt24
            ">

              Lighthouse analytics

            </div>

            <div class="
              fp-flex
              fp-alignCenter
              fp-justifyBetween
              fp-mt24
            ">

              <div class="
                fp-flex
                fp-alignCenter
                fp-gap12
              ">

                <div class="
                  fp-badge
                  ${
                    audit.issues > 10
                      ? 'fp-badgeDanger'
                      : audit.issues > 5
                        ? 'fp-badgeWarning'
                        : 'fp-badgeSuccess'
                  }
                ">

                  ${audit.issues} issues

                </div>

                <div class="
                  fp-badge
                  fp-badgePrimary
                ">

                  ${audit.trend}

                </div>

              </div>

              <button
                class="
                  fp-btn
                  fp-btnPrimary
                "

                data-audit="
                  ${audit.domain}
                "
              >

                Ouvrir

              </button>

            </div>

          </div>

        `).join('')}

      </div>

      <!-- AI INSIGHTS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            AI Optimization Insights

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Core Web Vitals

              </div>

              <div class="
                fp-listText
              ">

                Plusieurs pages mobiles restent lentes.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                SEO local

              </div>

              <div class="
                fp-listText
              ">

                Fort potentiel sur Bruxelles et Liège.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Conversion

              </div>

              <div class="
                fp-listText
              ">

                Optimiser les CTA premium recommandés.

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   AUDIT EVENTS
========================================================= */

function bindAuditEvents(){

  qsa('[data-audit]')
    .forEach(button => {

      button.onclick = () => {

        const domain =
          button.dataset.audit;

        openDrawer({

          title:
            domain,

          content:`

            <div class="
              fp-grid3
            ">

              <div class="
                fp-kpiCard
              ">

                <div class="
                  fp-kpiLabel
                ">

                  SEO

                </div>

                <div class="
                  fp-kpiValue
                ">

                  91

                </div>

              </div>

              <div class="
                fp-kpiCard
              ">

                <div class="
                  fp-kpiLabel
                ">

                  Performance

                </div>

                <div class="
                  fp-kpiValue
                ">

                  96

                </div>

              </div>

              <div class="
                fp-kpiCard
              ">

                <div class="
                  fp-kpiLabel
                ">

                  Accessibility

                </div>

                <div class="
                  fp-kpiValue
                ">

                  82

                </div>

              </div>

            </div>

            <div class="
              fp-chartEmpty
              fp-mt24
            ">

              Full audit analytics

            </div>

          `,
        });
      };
    });
}

/* =========================================================
   OVERRIDE AUDITS
========================================================= */

renderAudits =
  renderAdvancedAudits;

/* =========================================================
   EXTEND EVENTS
========================================================= */

const previousAuditBind =
  bindEvents;

bindEvents = function(){

  previousAuditBind();

  bindAuditEvents();
};
/* =========================================================
   ADVANCED DASHBOARD CORE
========================================================= */

function renderDashboardShell(){

  return `

    <div class="
      fp-dashboardShell
    ">

      <!-- SIDEBAR -->

      <aside class="
        fp-sidebar
        ${
          state.mobileSidebar
            ? 'open'
            : ''
        }
      ">

        <div class="
          fp-sidebarTop
        ">

          <div class="
            fp-brand
          ">

            <div class="
              fp-brandLogo
            ">

              ⚡

            </div>

            <div>

              <div class="
                fp-brandName
              ">

                FlowPoint

              </div>

              <div class="
                fp-brandText
              ">

                Executive Platform

              </div>

            </div>

          </div>

        </div>

        <!-- NAV -->

        <div class="
          fp-sidebarNav
        ">

          ${routes.map(route => `

            <button

              class="
                fp-sidebarLink
                ${
                  state.route === route.key
                    ? 'active'
                    : ''
                }
              "

              data-route="
                ${route.key}
              "
            >

              <span class="
                fp-sidebarIcon
              ">

                ${route.icon}

              </span>

              <span>

                ${route.label}

              </span>

            </button>

          `).join('')}

        </div>

        <!-- BOTTOM -->

        <div class="
          fp-sidebarBottom
        ">

          <div class="
            fp-planCard
          ">

            <div class="
              fp-planTop
            ">

              <div class="
                fp-planTitle
              ">

                ${state.plan.toUpperCase()}

              </div>

              <div class="
                fp-badge
                fp-badgePrimary
              ">

                ACTIVE

              </div>

            </div>

            <div class="
              fp-planText
            ">

              Infrastructure premium,
              analytics,
              IA
              et monitoring avancé.

            </div>

            <button class="
              fp-btn
              fp-btnPrimary
              fp-wFull
              fp-mt20
            ">

              Upgrade

            </button>

          </div>

        </div>

      </aside>

      <!-- CONTENT -->

      <div class="
        fp-main
      ">

        ${renderTopbar()}

        <main class="
          fp-content
        ">

          ${renderPage()}

        </main>

      </div>

    </div>

  `;
}

/* =========================================================
   MAIN RENDER
========================================================= */

function render(){

  const app =
    document.getElementById(
      'app'
    );

  if(!app){
    return;
  }

  app.innerHTML =
    renderDashboardShell();

  bindEvents();
}

/* =========================================================
   ROUTING
========================================================= */

function setRoute(route){

  state.route =
    route;

  localStorage.setItem(
    'fp_route',
    route
  );

  render();

  window.scrollTo({

    top:0,

    behavior:'smooth',

  });
}

function restoreRoute(){

  const saved =
    localStorage.getItem(
      'fp_route'
    );

  if(saved){

    state.route =
      saved;
  }
}

/* =========================================================
   SIDEBAR EVENTS
========================================================= */

function bindSidebarEvents(){

  qsa('[data-route]')
    .forEach(button => {

      button.onclick = () => {

        const route =
          button.dataset.route;

        state.mobileSidebar =
          false;

        setRoute(route);
      };
    });
}

/* =========================================================
   MOBILE MENU
========================================================= */

function bindMobileMenu(){

  const button =
    qs('#fpMobileMenuBtn');

  if(button){

    button.onclick = () => {

      state.mobileSidebar =
        !state.mobileSidebar;

      render();
    };
  }
}

/* =========================================================
   GLOBAL EVENTS
========================================================= */

const originalBindEventsFinal =
  bindEvents;

bindEvents = function(){

  originalBindEventsFinal();

  bindSidebarEvents();

  bindMobileMenu();
};

/* =========================================================
   URL HASH SUPPORT
========================================================= */

function syncHashRoute(){

  const hash =
    window.location.hash
      .replace('#','')
      .trim();

  if(!hash){
    return;
  }

  const exists =
    routes.find(
      route =>
        route.key === hash
    );

  if(exists){

    state.route =
      hash;
    return;
  }
}

window.addEventListener(

  'hashchange',

  () => {

    syncHashRoute();

    render();
  }
);

/* =========================================================
   ROUTE PATCH
========================================================= */

const originalSetRoute =
  setRoute;

setRoute = function(route){

  window.location.hash =
    route;

  originalSetRoute(route);
};

/* =========================================================
   INITIALIZATION
========================================================= */

async function bootDashboard(){

  try{

    showLoading();

    loadTheme();

    restoreRoute();

    syncHashRoute();

    await hydrateDashboard();

    render();

    startRealtimeEngine();

    smoothRemoveLoading();

    console.log(

      '%cFLOWPOINT READY',

      `
        color:#fff;
        background:#2f5bff;
        padding:8px 14px;
        border-radius:8px;
        font-weight:bold;
      `
    );

  }catch(err){

    console.error(err);

    toast(
      'Erreur chargement dashboard',
      'danger'
    );
  }
}

/* =========================================================
   START
========================================================= */

bootDashboard();
/* =========================================================
   ADVANCED DATA HYDRATION
========================================================= */

async function hydrateDashboard(){

  try{

    const [

      userData,

      monitorsData,

      auditsData,

      reportsData,

      alertsData,

      missionsData,

    ] = await Promise.all([

      api('/api/auth/me'),

      api('/api/monitors'),

      api('/api/audits'),

      api('/api/reports'),

      api('/api/alerts'),

      api('/api/missions'),

    ]);

    /* USER */

    if(userData?.user){

      state.user =
        userData.user;

      state.plan =
        (
          userData.user.plan
          || 'pro'
        ).toLowerCase();
    }

    /* MONITORS */

    state.monitors =
      Array.isArray(
        monitorsData?.monitors
      )
        ? monitorsData.monitors
        : [];

    /* AUDITS */

    state.audits =
      Array.isArray(
        auditsData?.audits
      )
        ? auditsData.audits
        : [];

    /* REPORTS */

    state.reports =
      Array.isArray(
        reportsData?.reports
      )
        ? reportsData.reports
        : [];

    /* ALERTS */

    state.alerts =
      Array.isArray(
        alertsData?.alerts
      )
        ? alertsData.alerts
        : [];

    /* MISSIONS */

    state.missions =
      Array.isArray(
        missionsData?.missions
      )
        ? missionsData.missions
        : [];

  }catch(err){

    console.warn(
      'Hydration fallback',
      err
    );

    loadDemoData();
  }
}

/* =========================================================
   DEMO FALLBACK
========================================================= */

function loadDemoData(){

  state.user = {

    name:
      'FlowPoint User',

    email:
      'user@flowpoint.pro',

    plan:
      'pro',

  };

  state.monitors = [

    {

      name:
        'Main API',

      status:
        'online',

      uptime:
        '99.98%',

      latency:
        '112ms',

    },

    {

      name:
        'Dashboard',

      status:
        'online',

      uptime:
        '99.97%',

      latency:
        '98ms',

    },

  ];

  state.audits = [

    {

      domain:
        'flowpoint.pro',

      score:
        91,

    },

  ];

  state.alerts = [

    {

      type:
        'warning',

      title:
        'Infrastructure latency',

      text:
        'Monitoring cluster ralenti',

    },

  ];

  state.missions = [

    {

      title:
        'SEO Local Expansion',

      progress:
        42,

    },

  ];

  state.reports = [

    {

      title:
        'Executive SEO Report',

    },

  ];
}

/* =========================================================
   GLOBAL SEARCH INDEX
========================================================= */

function buildSearchIndex(){

  const index = [];

  /* ROUTES */

  routes.forEach(route => {

    index.push({

      type:
        'route',

      title:
        route.label,

      key:
        route.key,

    });
  });

  /* MISSIONS */

  (state.missions || [])
    .forEach(mission => {

      index.push({

        type:
          'mission',

        title:
          mission.title,

      });
    });

  /* MONITORS */

  (state.monitors || [])
    .forEach(monitor => {

      index.push({

        type:
          'monitor',

        title:
          monitor.name,

      });
    });

  /* AUDITS */

  (state.audits || [])
    .forEach(audit => {

      index.push({

        type:
          'audit',

        title:
          audit.domain,

      });
    });

  return index;
}

/* =========================================================
   ADVANCED SEARCH
========================================================= */

function performGlobalSearch(query=''){

  query =
    query.toLowerCase();

  const index =
    buildSearchIndex();

  return index.filter(item =>

    item.title
      ?.toLowerCase()
      ?.includes(query)

  );
}

/* =========================================================
   COMMAND BAR
========================================================= */

function renderCommandBar(){

  return `

    <div
      class="
        fp-commandBar
      "

      id="
        fpCommandBar
      "
    >

      <div class="
        fp-commandInputWrap
      ">

        <span class="
          fp-commandIcon
        ">
          ⚡
        </span>

        <input

          id="
            fpCommandInput
          "

          class="
            fp-commandInput
          "

          placeholder="
            Rechercher pages,
            audits,
            monitors...
          "
        />

      </div>

      <div
        id="
          fpCommandResults
        "

        class="
          fp-commandResults
        "
      ></div>

    </div>

  `;
}

/* =========================================================
   COMMAND BAR EVENTS
========================================================= */

function bindCommandBar(){

  const input =
    qs('#fpCommandInput');

  const results =
    qs('#fpCommandResults');

  if(!input || !results){
    return;
  }

  input.oninput = () => {

    const value =
      input.value.trim();

    if(!value){

      results.innerHTML =
        '';

      return;
    }

    const data =
      performGlobalSearch(value);

    results.innerHTML =

      data.map(item => `

        <button

          class="
            fp-commandItem
          "

          data-command-route="
            ${item.key || ''}
          "
        >

          <div>

            <div class="
              fp-commandTitle
            ">

              ${item.title}

            </div>

            <div class="
              fp-commandType
            ">

              ${item.type}

            </div>

          </div>

        </button>

      `).join('');

    qsa('[data-command-route]')
      .forEach(button => {

        button.onclick = () => {

          const route =
            button.dataset
              .commandRoute;

          if(route){

            setRoute(route);
          }

          results.innerHTML =
            '';

          input.value =
            '';
        };
      });
  };
}

/* =========================================================
   TOPBAR OVERRIDE
========================================================= */

renderTopbar = function(){

  return `

    <div class="
      fp-topbar
    ">

      <div class="
        fp-topbarLeft
      ">

        <button

          id="
            fpMobileMenuBtn
          "

          class="
            fp-mobileMenuBtn
          "
        >

          ☰

        </button>

        <div>

          <div class="
            fp-pageTitle
          ">

            FlowPoint Executive

          </div>

          <div class="
            fp-pageSub
          ">

            SEO,
            monitoring,
            analytics,
            infrastructure
            et IA.

          </div>

        </div>

      </div>

      <div class="
        fp-topbarCenter
      ">

        ${renderCommandBar()}

      </div>

      <div class="
        fp-topbarRight
      ">

        <button class="
          fp-iconBtn
        ">

          🔔

        </button>

        <button
          class="
            fp-iconBtn
          "

          id="
            fpThemeToggle
          "
        >

          🌙

        </button>

        <div class="
          fp-userMini
        ">

          <div class="
            fp-userMiniAvatar
          ">

            ${
              state.user?.email
                ?.slice(0,1)
                ?.toUpperCase()
              || 'U'
            }

          </div>

        </div>

      </div>

    </div>

  `;
};

/* =========================================================
   THEME TOGGLE
========================================================= */

function bindThemeToggle(){

  const button =
    qs('#fpThemeToggle');

  if(button){

    button.onclick =
      toggleTheme;
  }
}

/* =========================================================
   FINAL EVENT PATCH
========================================================= */

const previousUltimateBind =
  bindEvents;

bindEvents = function(){

  previousUltimateBind();

  bindCommandBar();

  bindThemeToggle();
};
/* =========================================================
   ADVANCED STATE ENGINE
========================================================= */

const persistedKeys = [

  'route',
  'plan',
  'theme',

  'sidebar',

];

function saveDashboardState(){

  try{

    const payload = {

      route:
        state.route,

      plan:
        state.plan,

      sidebar:
        state.mobileSidebar,

      theme:
        theme.dark
          ? 'dark'
          : 'light',

    };

    localStorage.setItem(

      'fp_dashboard_state_v3',

      JSON.stringify(payload)

    );

  }catch(err){

    console.warn(
      'save state fail',
      err
    );
  }
}

function restoreDashboardState(){

  try{

    const raw =
      localStorage.getItem(
        'fp_dashboard_state_v3'
      );

    if(!raw){
      return;
    }

    const data =
      JSON.parse(raw);

    if(data.route){

      state.route =
        data.route;
    }

    if(data.plan){

      state.plan =
        data.plan;
    }

    if(

      typeof data.sidebar
      === 'boolean'

    ){

      state.mobileSidebar =
        data.sidebar;
    }

  }catch(err){

    console.warn(
      'restore state fail',
      err
    );
  }
}

/* =========================================================
   AUTO SAVE STATE
========================================================= */

setInterval(

  saveDashboardState,

  4000

);

/* =========================================================
   PERFORMANCE ENGINE
========================================================= */

const perf = {

  renders:0,

  mountedAt:
    Date.now(),

};

function trackRender(){

  perf.renders++;

  const uptime =
    Math.floor(

      (
        Date.now()
        -
        perf.mountedAt
      )

      / 1000

    );

  console.log({

    renders:
      perf.renders,

    uptime,

  });
}

/* =========================================================
   RENDER PATCH
========================================================= */

const previousRenderFinal =
  render;

render = function(){

  previousRenderFinal();

  trackRender();
};

/* =========================================================
   VIEW TRANSITIONS
========================================================= */

function animatePage(){

  const content =
    qs('.fp-content');

  if(!content){
    return;
  }

  content.animate(

    [

      {

        opacity:0,

        transform:
          'translateY(12px)',

      },

      {

        opacity:1,

        transform:
          'translateY(0)',

      },

    ],

    {

      duration:280,

      easing:
        'ease',

    }

  );
}

/* =========================================================
   ROUTE PATCH
========================================================= */

const previousRoutePatch =
  setRoute;

setRoute = function(route){

  previousRoutePatch(route);

  requestAnimationFrame(
    animatePage
  );
};

/* =========================================================
   LIVE CLOCK
========================================================= */

function startClock(){

  setInterval(() => {

    const now =
      new Date();

    const hour =
      now.toLocaleTimeString(
        'fr-FR',
        {

          hour:'2-digit',

          minute:'2-digit',

        }
      );

    qsa('.fp-liveClock')
      .forEach(el => {

        el.textContent =
          hour;
      });

  }, 1000);
}

/* =========================================================
   TOPBAR CLOCK PATCH
========================================================= */

const previousTopbarPatch =
  renderTopbar;

renderTopbar = function(){

  const html =
    previousTopbarPatch();

  return html.replace(

    '</div>\n\n      </div>\n\n    </div>',

    `

      <div class="
        fp-liveClockWrap
      ">

        <div class="
          fp-liveClock
        ">
          --:--
        </div>

      </div>

      </div>

    </div>

    `
  );
};

/* =========================================================
   SMART INSIGHTS
========================================================= */

function generateSmartInsights(){

  const insights = [];

  const monitorCount =
    state.monitors?.length || 0;

  const alertCount =
    state.alerts?.length || 0;

  const auditCount =
    state.audits?.length || 0;

  if(monitorCount > 10){

    insights.push(
      'Infrastructure monitoring élevé détecté.'
    );
  }

  if(alertCount > 0){

    insights.push(
      'Certaines alertes nécessitent une attention immédiate.'
    );
  }

  if(auditCount > 5){

    insights.push(
      'Les audits montrent une forte activité SEO.'
    );
  }

  if(!insights.length){

    insights.push(
      'Le workspace est stable et optimisé.'
    );
  }

  return insights;
}

/* =========================================================
   AI INSIGHT WIDGET
========================================================= */

function renderInsightWidget(){

  const insights =
    generateSmartInsights();

  return `

    <div class="
      fp-card
      fp-mt24
    ">

      <div class="
        fp-cardHeader
      ">

        <div class="
          fp-cardTitle
        ">

          AI Smart Insights

        </div>

      </div>

      <div class="
        fp-cardBody
      ">

        <div class="
          fp-list
        ">

          ${insights.map(insight => `

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                ${insight}

              </div>

            </div>

          `).join('')}

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   OVERVIEW PATCH
========================================================= */

const previousOverviewFinal =
  renderOverview;

renderOverview = function(){

  return `

    ${previousOverviewFinal()}

    ${renderInsightWidget()}

  `;
};

/* =========================================================
   START SERVICES
========================================================= */

restoreDashboardState();

startClock();
/* =========================================================
   ADVANCED UI UTILITIES
========================================================= */

function createEmptyState({

  icon = '📦',

  title = 'Aucune donnée',

  text = 'Aucun contenu disponible.',

  button = '',

} = {}){

  return `

    <div class="
      fp-emptyState
    ">

      <div class="
        fp-emptyIcon
      ">

        ${icon}

      </div>

      <div class="
        fp-emptyTitle
      ">

        ${title}

      </div>

      <div class="
        fp-emptyText
      ">

        ${text}

      </div>

      ${
        button
          ? `
            <button class="
              fp-btn
              fp-btnPrimary
              fp-mt24
            ">
              ${button}
            </button>
          `
          : ''
      }

    </div>

  `;
}

/* =========================================================
   SKELETON LOADING
========================================================= */

function renderSkeletonCards(count=4){

  return `

    <div class="
      fp-grid4
    ">

      ${Array(count)
        .fill(0)
        .map(() => `

          <div class="
            fp-skeletonCard
          ">

            <div class="
              fp-skeleton
              fp-skeletonTitle
            "></div>

            <div class="
              fp-skeleton
              fp-skeletonText
            "></div>

            <div class="
              fp-skeleton
              fp-skeletonText
            "></div>

          </div>

        `).join('')}

    </div>

  `;
}

/* =========================================================
   ADVANCED TABLE
========================================================= */

function renderDataTable({

  columns = [],

  rows = [],

} = {}){

  return `

    <div class="
      fp-tableWrap
    ">

      <table class="
        fp-table
      ">

        <thead>

          <tr>

            ${columns.map(column => `

              <th>

                ${column}

              </th>

            `).join('')}

          </tr>

        </thead>

        <tbody>

          ${rows.map(row => `

            <tr>

              ${row.map(cell => `

                <td>

                  ${cell}

                </td>

              `).join('')}

            </tr>

          `).join('')}

        </tbody>

      </table>

    </div>

  `;
}

/* =========================================================
   CSV EXPORT
========================================================= */

function exportCsv({

  filename = 'export.csv',

  rows = [],

}){

  const csv = rows
    .map(row =>

      row.join(',')

    )
    .join('\n');

  const blob =
    new Blob(

      [csv],

      {

        type:'text/csv',

      }
    );

  const url =
    URL.createObjectURL(
      blob
    );

  const link =
    document.createElement(
      'a'
    );

  link.href =
    url;

  link.download =
    filename;

  link.click();

  URL.revokeObjectURL(
    url
  );

  toast(
    'CSV exporté',
    'success'
  );
}

/* =========================================================
   PDF PREVIEW
========================================================= */

function openPdfPreview(title='Report'){

  openModal({

    title,

    content:`

      <div class="
        fp-chartEmpty
      " style="
        height:420px;
      ">

        PDF Preview

      </div>

    `,

  });
}

/* =========================================================
   ADVANCED FILTER ENGINE
========================================================= */

function applyFilter({

  data = [],

  search = '',

  key = 'title',

} = {}){

  if(!search){
    return data;
  }

  return data.filter(item =>

    String(item[key] || '')
      .toLowerCase()
      .includes(
        search.toLowerCase()
      )

  );
}

/* =========================================================
   SORT ENGINE
========================================================= */

function sortData({

  data = [],

  key = 'title',

  direction = 'asc',

} = {}){

  return [...data].sort((a,b) => {

    const first =
      String(a[key] || '');

    const second =
      String(b[key] || '');

    if(direction === 'asc'){

      return first.localeCompare(
        second
      );
    }

    return second.localeCompare(
      first
    );
  });
}

/* =========================================================
   STORAGE UTILITIES
========================================================= */

function saveLocal(key,value){

  try{

    localStorage.setItem(

      key,

      JSON.stringify(value)

    );

  }catch(err){

    console.warn(err);
  }
}

function loadLocal(key,fallback=null){

  try{

    const raw =
      localStorage.getItem(
        key
      );

    if(!raw){
      return fallback;
    }

    return JSON.parse(raw);

  }catch(err){

    return fallback;
  }
}

/* =========================================================
   NOTIFICATION CENTER
========================================================= */

const notifications = [];

function pushNotification({

  title = 'Notification',

  text = '',

  type = 'info',

}){

  notifications.unshift({

    id:
      Date.now(),

    title,

    text,

    type,

    createdAt:
      new Date(),

  });

  if(notifications.length > 20){

    notifications.pop();
  }

  saveLocal(
    'fp_notifications',
    notifications
  );
}

/* =========================================================
   LOAD NOTIFICATIONS
========================================================= */

function restoreNotifications(){

  const saved =
    loadLocal(
      'fp_notifications',
      []
    );

  if(Array.isArray(saved)){

    notifications.push(
      ...saved
    );
  }
}

/* =========================================================
   NOTIFICATION DRAWER
========================================================= */

function openNotifications(){

  openDrawer({

    title:
      'Notifications',

    content:`

      <div class="
        fp-list
      ">

        ${
          notifications.length
            ? notifications.map(item => `

              <div class="
                fp-listItem
              ">

                <div class="
                  fp-listTitle
                ">

                  ${item.title}

                </div>

                <div class="
                  fp-listText
                ">

                  ${item.text}

                </div>

              </div>

            `).join('')
            : createEmptyState({

                icon:'🔔',

                title:
                  'Aucune notification',

                text:
                  'Le centre de notifications est vide.',

              })
        }

      </div>

    `,
  });
}

/* =========================================================
   TOPBAR NOTIFICATION PATCH
========================================================= */

const previousTopbarNotification =
  renderTopbar;

renderTopbar = function(){

  const html =
    previousTopbarNotification();

  return html.replace(

    '🔔',

    `<span id="fpOpenNotifications">🔔</span>`

  );
};

/* =========================================================
   BIND NOTIFICATIONS
========================================================= */

function bindNotifications(){

  const button =
    qs('#fpOpenNotifications');

  if(button){

    button.onclick =
      openNotifications;
  }
}

/* =========================================================
   EVENT PATCH
========================================================= */

const previousNotificationBind =
  bindEvents;

bindEvents = function(){

  previousNotificationBind();

  bindNotifications();
};

/* =========================================================
   RESTORE
========================================================= */

restoreNotifications();
/* =========================================================
   ADVANCED WORKSPACE ENGINE
========================================================= */

function renderWorkspaceOverview(){

  const workspaces = [

    {

      name:
        'FlowPoint Main',

      members:
        12,

      projects:
        28,

      status:
        'online',

    },

    {

      name:
        'Enterprise Clients',

      members:
        6,

      projects:
        14,

      status:
        'online',

    },

    {

      name:
        'Infrastructure Lab',

      members:
        4,

      projects:
        9,

      status:
        'warning',

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Workspace Manager

              </div>

              <div class="
                fp-sectionText
              ">

                Gestion multi équipes,
                projets,
                clients,
                accès,
                rôles
                et collaboration.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Inviter

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Nouveau workspace

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- WORKSPACES -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        ${workspaces.map(workspace => `

          <div class="
            fp-card
          ">

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-flex
                fp-alignCenter
                fp-justifyBetween
              ">

                <div>

                  <div class="
                    fp-sectionTitle
                  " style="
                    font-size:22px;
                  ">

                    ${workspace.name}

                  </div>

                  <div class="
                    fp-sectionText
                  ">

                    ${workspace.projects}
                    projets actifs

                  </div>

                </div>

                <div class="
                  fp-dot
                  ${workspace.status}
                "></div>

              </div>

              <div class="
                fp-grid2
                fp-mt24
              ">

                <div class="
                  fp-kpiCard
                ">

                  <div class="
                    fp-kpiLabel
                  ">

                    Membres

                  </div>

                  <div class="
                    fp-kpiValue
                  ">

                    ${workspace.members}

                  </div>

                </div>

                <div class="
                  fp-kpiCard
                ">

                  <div class="
                    fp-kpiLabel
                  ">

                    Projets

                  </div>

                  <div class="
                    fp-kpiValue
                  ">

                    ${workspace.projects}

                  </div>

                </div>

              </div>

              <div class="
                fp-flex
                fp-gap12
                fp-mt24
              ">

                <button class="
                  fp-btn
                  fp-btnPrimary
                ">

                  Ouvrir

                </button>

                <button class="
                  fp-btn
                  fp-btnGhost
                ">

                  Paramètres

                </button>

              </div>

            </div>

          </div>

        `).join('')}

      </div>

      <!-- TEAM ACCESS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            Team Access Control

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Utilisateur',
              'Rôle',
              'Workspace',
              'Status',

            ],

            rows:[

              [

                'Alex Martin',
                'Admin',
                'FlowPoint Main',
                'Actif',

              ],

              [

                'Sarah Klein',
                'Infrastructure Lead',
                'Infrastructure Lab',
                'Actif',

              ],

              [

                'Lucas Bernard',
                'Growth',
                'Enterprise Clients',
                'Actif',

              ],

            ],

          })}

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   WORKSPACE STORAGE
========================================================= */

function saveWorkspaceConfig(config){

  saveLocal(

    'fp_workspace_config',

    config

  );

  toast(
    'Workspace sauvegardé',
    'success'
  );
}

function loadWorkspaceConfig(){

  return loadLocal(

    'fp_workspace_config',

    {

      workspace:
        'FlowPoint',

    }

  );
}

/* =========================================================
   USER PREFERENCES
========================================================= */

const preferences = loadLocal(

  'fp_preferences',

  {

    compactMode:false,

    animations:true,

    notifications:true,

  }

);

function updatePreference(

  key,

  value

){

  preferences[key] =
    value;

  saveLocal(
    'fp_preferences',
    preferences
  );
}

/* =========================================================
   COMPACT MODE
========================================================= */

function toggleCompactMode(){

  preferences.compactMode =
    !preferences.compactMode;

  updatePreference(

    'compactMode',

    preferences.compactMode

  );

  document.body.classList.toggle(
    'fp-compact'
  );
}

/* =========================================================
   ANIMATION MODE
========================================================= */

function toggleAnimations(){

  preferences.animations =
    !preferences.animations;

  updatePreference(

    'animations',

    preferences.animations

  );

  if(!preferences.animations){

    document.body.classList.add(
      'fp-noAnimations'
    );

  }else{

    document.body.classList.remove(
      'fp-noAnimations'
    );
  }
}

/* =========================================================
   PREFERENCES INIT
========================================================= */

function initPreferences(){

  if(preferences.compactMode){

    document.body.classList.add(
      'fp-compact'
    );
  }

  if(!preferences.animations){

    document.body.classList.add(
      'fp-noAnimations'
    );
  }
}

/* =========================================================
   ADD ROUTE
========================================================= */

routes.push({

  key:'workspace',

  label:'Workspace',

  icon:'🏢',

});

/* =========================================================
   ROUTER PATCH
========================================================= */

const previousWorkspaceRouter =
  renderPage;

renderPage = function(){

  if(

    state.route
    === 'workspace'

  ){

    return renderWorkspaceOverview();
  }

  return previousWorkspaceRouter();
};

/* =========================================================
   INIT
========================================================= */

initPreferences();
/* =========================================================
   ADVANCED CLIENT PORTAL
========================================================= */

function renderClientPortal(){

  const clients = [

    {

      name:
        'Enterprise Group',

      plan:
        'Ultra',

      seo:
        94,

      uptime:
        '99.99%',

      reports:
        42,

    },

    {

      name:
        'Local Business',

      plan:
        'Pro',

      seo:
        82,

      uptime:
        '99.97%',

      reports:
        18,

    },

    {

      name:
        'Agency Partner',

      plan:
        'Ultra',

      seo:
        91,

      uptime:
        '99.98%',

      reports:
        34,

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Client Portal

              </div>

              <div class="
                fp-sectionText
              ">

                Gestion clients,
                accès workspace,
                executive reports,
                SEO
                et monitoring premium.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Inviter client

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Nouveau client

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- CLIENTS -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        ${clients.map(client => `

          <div class="
            fp-card
          ">

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-flex
                fp-alignCenter
                fp-justifyBetween
              ">

                <div>

                  <div class="
                    fp-sectionTitle
                  " style="
                    font-size:22px;
                  ">

                    ${client.name}

                  </div>

                  <div class="
                    fp-sectionText
                  ">

                    ${client.reports}
                    rapports générés

                  </div>

                </div>

                <div class="
                  fp-badge
                  fp-badgePrimary
                ">

                  ${client.plan}

                </div>

              </div>

              <div class="
                fp-grid2
                fp-mt24
              ">

                <div class="
                  fp-kpiCard
                ">

                  <div class="
                    fp-kpiLabel
                  ">

                    SEO

                  </div>

                  <div class="
                    fp-kpiValue
                  ">

                    ${client.seo}

                  </div>

                </div>

                <div class="
                  fp-kpiCard
                ">

                  <div class="
                    fp-kpiLabel
                  ">

                    Uptime

                  </div>

                  <div class="
                    fp-kpiValue
                  ">

                    ${client.uptime}

                  </div>

                </div>

              </div>

              <div class="
                fp-flex
                fp-gap12
                fp-mt24
              ">

                <button class="
                  fp-btn
                  fp-btnPrimary
                ">

                  Ouvrir

                </button>

                <button class="
                  fp-btn
                  fp-btnGhost
                ">

                  Reports

                </button>

              </div>

            </div>

          </div>

        `).join('')}

      </div>

      <!-- CLIENT TABLE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            Client Infrastructure

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Client',
              'Plan',
              'SEO',
              'Monitoring',
              'Reports',

            ],

            rows:clients.map(client => [

              client.name,
              client.plan,
              client.seo,
              client.uptime,
              client.reports,

            ]),

          })}

        </div>

      </div>

      <!-- AI INSIGHTS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            AI Client Insights

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Enterprise croissance forte

              </div>

              <div class="
                fp-listText
              ">

                Forte amélioration SEO détectée.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Infrastructure stable

              </div>

              <div class="
                fp-listText
              ">

                Aucun incident critique actif.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Opportunités premium

              </div>

              <div class="
                fp-listText
              ">

                Plusieurs upgrades Ultra recommandés.

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   ADD ROUTE
========================================================= */

routes.push({

  key:'clients',

  label:'Clients',

  icon:'👥',

});

/* =========================================================
   ROUTER PATCH
========================================================= */

const previousClientRouter =
  renderPage;

renderPage = function(){

  if(

    state.route
    === 'clients'

  ){

    return renderClientPortal();
  }

  return previousClientRouter();
};
/* =========================================================
   ADVANCED AUTOMATION ENGINE
========================================================= */

function renderAutomationCenter(){

  const automations = [

    {

      name:
        'Executive PDF Weekly',

      trigger:
        'Chaque lundi 08:00',

      status:
        'online',

      type:
        'Reports',

    },

    {

      name:
        'Critical Incident Alerts',

      trigger:
        'Temps réel',

      status:
        'online',

      type:
        'Monitoring',

    },

    {

      name:
        'SEO Audit Auto Scan',

      trigger:
        'Tous les jours',

      status:
        'warning',

      type:
        'SEO',

    },

    {

      name:
        'Client Summary Emails',

      trigger:
        'Chaque vendredi',

      status:
        'online',

      type:
        'Clients',

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Automation Center

              </div>

              <div class="
                fp-sectionText
              ">

                Automatisations,
                workflows,
                exports,
                monitoring,
                IA
                et infrastructure.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Templates

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Nouvelle automation

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Automatisations

          </div>

          <div class="
            fp-kpiValue
          ">

            28

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Workflows actifs

          </div>

          <div class="
            fp-kpiValue
          ">

            18

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Exécutions

          </div>

          <div class="
            fp-kpiValue
          ">

            12k

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Success rate

          </div>

          <div class="
            fp-kpiValue
          ">

            99.2%

          </div>

        </div>

      </div>

      <!-- AUTOMATIONS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        ${automations.map(item => `

          <div class="
            fp-card
          ">

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-flex
                fp-alignCenter
                fp-justifyBetween
              ">

                <div>

                  <div class="
                    fp-sectionTitle
                  " style="
                    font-size:22px;
                  ">

                    ${item.name}

                  </div>

                  <div class="
                    fp-sectionText
                  ">

                    ${item.trigger}

                  </div>

                </div>

                <div class="
                  fp-dot
                  ${item.status}
                "></div>

              </div>

              <div class="
                fp-mt24
              ">

                <div class="
                  fp-badge
                  fp-badgePrimary
                ">

                  ${item.type}

                </div>

              </div>

              <div class="
                fp-chartEmpty
                fp-mt24
              ">

                Workflow analytics

              </div>

              <div class="
                fp-flex
                fp-gap12
                fp-mt24
              ">

                <button class="
                  fp-btn
                  fp-btnPrimary
                ">

                  Configurer

                </button>

                <button class="
                  fp-btn
                  fp-btnGhost
                ">

                  Logs

                </button>

              </div>

            </div>

          </div>

        `).join('')}

      </div>

      <!-- EXECUTION TABLE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            Workflow Executions

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Workflow',
              'Trigger',
              'Status',
              'Dernière exécution',

            ],

            rows:automations.map(item => [

              item.name,
              item.trigger,
              item.status,
              'Aujourd’hui',

            ]),

          })}

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            AI Workflow Suggestions

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Auto PDF Executive

              </div>

              <div class="
                fp-listText
              ">

                Générer automatiquement les rapports clients.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Monitoring incidents

              </div>

              <div class="
                fp-listText
              ">

                Envoyer alertes temps réel Slack/Email.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                SEO automation

              </div>

              <div class="
                fp-listText
              ">

                Scanner automatiquement les pages critiques.

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   ADD ROUTE
========================================================= */

routes.push({

  key:'automations',

  label:'Automations',

  icon:'⚙️',

});

/* =========================================================
   ROUTER PATCH
========================================================= */

const previousAutomationRouter =
  renderPage;

renderPage = function(){

  if(

    state.route
    === 'automations'

  ){

    return renderAutomationCenter();
  }

  return previousAutomationRouter();
};
/* =========================================================
   ADVANCED MODAL ENGINE
========================================================= */

const modalState = {

  open:false,

};

function openModal({

  title='Modal',

  content='',

  large=false,

} = {}){

  closeModal();

  modalState.open =
    true;

  const modal =
    document.createElement(
      'div'
    );

  modal.className =
    'fp-modalOverlay';

  modal.innerHTML = `

    <div class="
      fp-modal
      ${
        large
          ? 'large'
          : ''
      }
    ">

      <div class="
        fp-modalHeader
      ">

        <div class="
          fp-modalTitle
        ">

          ${title}

        </div>

        <button
          class="
            fp-iconBtn
          "

          id="
            fpCloseModal
          "
        >

          ✕

        </button>

      </div>

      <div class="
        fp-modalBody
      ">

        ${content}

      </div>

    </div>

  `;

  document.body.appendChild(
    modal
  );

  requestAnimationFrame(() => {

    modal.classList.add(
      'visible'
    );

  });

  qs('#fpCloseModal')
    .onclick =
      closeModal;

  modal.onclick = event => {

    if(
      event.target === modal
    ){

      closeModal();
    }
  };
}

function closeModal(){

  const existing =
    qs('.fp-modalOverlay');

  if(existing){

    existing.remove();
  }

  modalState.open =
    false;
}

/* =========================================================
   ADVANCED DRAWER ENGINE
========================================================= */

function openDrawer({

  title='Drawer',

  content='',

} = {}){

  closeDrawer();

  const drawer =
    document.createElement(
      'div'
    );

  drawer.className =
    'fp-drawerOverlay';

  drawer.innerHTML = `

    <div class="
      fp-drawer
    ">

      <div class="
        fp-drawerHeader
      ">

        <div class="
          fp-drawerTitle
        ">

          ${title}

        </div>

        <button
          class="
            fp-iconBtn
          "

          id="
            fpCloseDrawer
          "
        >

          ✕

        </button>

      </div>

      <div class="
        fp-drawerBody
      ">

        ${content}

      </div>

    </div>

  `;

  document.body.appendChild(
    drawer
  );

  requestAnimationFrame(() => {

    drawer.classList.add(
      'visible'
    );

  });

  qs('#fpCloseDrawer')
    .onclick =
      closeDrawer;

  drawer.onclick = event => {

    if(
      event.target === drawer
    ){

      closeDrawer();
    }
  };
}

function closeDrawer(){

  const existing =
    qs('.fp-drawerOverlay');

  if(existing){

    existing.remove();
  }
}

/* =========================================================
   ADVANCED TOAST ENGINE
========================================================= */

function ensureToastRoot(){

  let root =
    qs('.fp-toastRoot');

  if(root){
    return root;
  }

  root =
    document.createElement(
      'div'
    );

  root.className =
    'fp-toastRoot';

  document.body.appendChild(
    root
  );

  return root;
}

function toast(

  text='Notification',

  type='info'

){

  const root =
    ensureToastRoot();

  const toast =
    document.createElement(
      'div'
    );

  toast.className = `

    fp-toast
    ${type}

  `;

  toast.innerHTML = `

    <div class="
      fp-toastText
    ">

      ${text}

    </div>

  `;

  root.appendChild(
    toast
  );

  requestAnimationFrame(() => {

    toast.classList.add(
      'visible'
    );

  });

  setTimeout(() => {

    toast.classList.remove(
      'visible'
    );

    setTimeout(() => {

      toast.remove();

    },300);

  },3400);
}

/* =========================================================
   ADVANCED ACTION TOAST
========================================================= */

function toastAction({

  text='Action',

  button='Open',

  callback=()=>{},

} = {}){

  const root =
    ensureToastRoot();

  const toast =
    document.createElement(
      'div'
    );

  toast.className =
    'fp-toast visible';

  toast.innerHTML = `

    <div class="
      fp-flex
      fp-alignCenter
      fp-justifyBetween
      fp-gap20
    ">

      <div>

        ${text}

      </div>

      <button
        class="
          fp-btn
          fp-btnPrimary
        "

        id="
          fpToastAction
        "
      >

        ${button}

      </button>

    </div>

  `;

  root.appendChild(
    toast
  );

  qs('#fpToastAction')
    .onclick = () => {

      callback();

      toast.remove();
    };

  setTimeout(() => {

    toast.remove();

  },5000);
}

/* =========================================================
   LOADING ENGINE
========================================================= */

function showLoading(){

  if(qs('.fp-globalLoading')){
    return;
  }

  const loading =
    document.createElement(
      'div'
    );

  loading.className =
    'fp-globalLoading';

  loading.innerHTML = `

    <div class="
      fp-loader
    "></div>

  `;

  document.body.appendChild(
    loading
  );
}

function smoothRemoveLoading(){

  const loading =
    qs('.fp-globalLoading');

  if(!loading){
    return;
  }

  loading.classList.add(
    'hide'
  );

  setTimeout(() => {

    loading.remove();

  },400);
}

/* =========================================================
   ESCAPE CLOSE
========================================================= */

window.addEventListener(

  'keydown',

  event => {

    if(event.key === 'Escape'){

      closeModal();

      closeDrawer();
    }
  }
);
/* =========================================================
   ADVANCED REALTIME ENGINE
========================================================= */

const realtime = {

  interval:null,

  connected:false,

  latency:0,

  lastSync:null,

};

function startRealtimeEngine(){

  stopRealtimeEngine();

  realtime.connected =
    true;

  realtime.interval =
    setInterval(async () => {

      try{

        realtime.latency =
          Math.floor(

            Math.random() * 140
          ) + 40;

        realtime.lastSync =
          new Date();

        await refreshRealtimeData();

        updateRealtimeWidgets();

      }catch(err){

        console.warn(
          'Realtime fail',
          err
        );

        realtime.connected =
          false;
      }

    }, 12000);

  updateRealtimeWidgets();
}

function stopRealtimeEngine(){

  if(realtime.interval){

    clearInterval(
      realtime.interval
    );
  }
}

/* =========================================================
   REALTIME REFRESH
========================================================= */

async function refreshRealtimeData(){

  try{

    const data =
      await api(
        '/api/dashboard/live'
      );

    if(data?.alerts){

      state.alerts =
        data.alerts;
    }

    if(data?.monitors){

      state.monitors =
        data.monitors;
    }

    if(data?.missions){

      state.missions =
        data.missions;
    }

    realtime.connected =
      true;

  }catch(err){

    realtime.connected =
      false;
    throw err;
  }
}

/* =========================================================
   REALTIME BADGE
========================================================= */

function renderRealtimeBadge(){

  return `

    <div class="
      fp-realtimeBadge
      ${
        realtime.connected
          ? 'online'
          : 'offline'
      }
    ">

      <div class="
        fp-dot
        ${
          realtime.connected
            ? 'online'
            : 'danger'
        }
      "></div>

      <span>

        ${
          realtime.connected
            ? 'LIVE'
            : 'OFFLINE'
        }

      </span>

    </div>

  `;
}

/* =========================================================
   LATENCY WIDGET
========================================================= */

function renderLatencyWidget(){

  return `

    <div class="
      fp-latencyWidget
    ">

      <span>

        ${realtime.latency}ms

      </span>

    </div>

  `;
}

/* =========================================================
   TOPBAR REALTIME PATCH
========================================================= */

const previousRealtimeTopbar =
  renderTopbar;

renderTopbar = function(){

  const html =
    previousRealtimeTopbar();

  return html.replace(

    '</div>\n\n    </div>',

    `

      <div class="
        fp-flex
        fp-alignCenter
        fp-gap12
      ">

        ${renderRealtimeBadge()}

        ${renderLatencyWidget()}

      </div>

    </div>

    `
  );
};

/* =========================================================
   UPDATE REALTIME WIDGETS
========================================================= */

function updateRealtimeWidgets(){

  qsa('.fp-realtimeBadge')
    .forEach(el => {

      el.className = `

        fp-realtimeBadge

        ${
          realtime.connected
            ? 'online'
            : 'offline'
        }

      `;

      el.innerHTML = `

        <div class="
          fp-dot
          ${
            realtime.connected
              ? 'online'
              : 'danger'
          }
        "></div>

        <span>

          ${
            realtime.connected
              ? 'LIVE'
              : 'OFFLINE'
          }

        </span>

      `;
    });

  qsa('.fp-latencyWidget')
    .forEach(el => {

      el.innerHTML = `

        <span>

          ${realtime.latency}ms

        </span>

      `;
    });
}

/* =========================================================
   SMART REFRESH
========================================================= */

function smartRefresh(){

  if(
    document.hidden
  ){
    return;
  }

  render();
}

/* =========================================================
   VISIBILITY EVENTS
========================================================= */

document.addEventListener(

  'visibilitychange',

  () => {

    if(

      !document.hidden

    ){

      smartRefresh();
    }
  }
);

/* =========================================================
   NETWORK DETECTION
========================================================= */

window.addEventListener(

  'offline',

  () => {

    realtime.connected =
      false;

    updateRealtimeWidgets();

    toast(
      'Connexion perdue',
      'danger'
    );
  }
);

window.addEventListener(

  'online',

  () => {

    realtime.connected =
      true;

    updateRealtimeWidgets();

    toast(
      'Connexion restaurée',
      'success'
    );
  }
);

/* =========================================================
   AUTO RECONNECT
========================================================= */

setInterval(() => {

  if(

    !navigator.onLine

  ){
    return;
  }

  if(

    !realtime.connected

  ){

    startRealtimeEngine();
  }

}, 15000);

/* =========================================================
   LIVE ACTIVITY FEED
========================================================= */

const activityFeed = [];

function pushActivity({

  text='Activité',

  type='info',

}){

  activityFeed.unshift({

    id:
      Date.now(),

    text,

    type,

    createdAt:
      new Date(),

  });

  if(activityFeed.length > 30){

    activityFeed.pop();
  }
}

/* =========================================================
   ACTIVITY DRAWER
========================================================= */

function openActivityFeed(){

  openDrawer({

    title:
      'Live Activity',

    content:`

      <div class="
        fp-list
      ">

        ${
          activityFeed.length
            ? activityFeed.map(item => `

              <div class="
                fp-listItem
              ">

                <div class="
                  fp-listTitle
                ">

                  ${item.text}

                </div>

                <div class="
                  fp-listText
                ">

                  ${formatRelativeTime(
                    item.createdAt
                  )}

                </div>

              </div>

            `).join('')
            : createEmptyState({

                icon:'📡',

                title:
                  'Aucune activité',

                text:
                  'Le flux temps réel est vide.',

              })
        }

      </div>

    `,
  });
}

/* =========================================================
   RELATIVE TIME
========================================================= */

function formatRelativeTime(date){

  const seconds =
    Math.floor(

      (
        Date.now()
        -
        new Date(date)
      )

      / 1000

    );

  if(seconds < 60){

    return 'À l’instant';
  }

  if(seconds < 3600){

    return `${Math.floor(
      seconds / 60
    )} min`;
  }

  if(seconds < 86400){

    return `${Math.floor(
      seconds / 3600
    )} h`;
  }

  return `${Math.floor(
    seconds / 86400
  )} j`;
}

/* =========================================================
   FAKE LIVE EVENTS
========================================================= */

setInterval(() => {

  const events = [

    'Nouveau rapport généré',
    'Audit SEO terminé',
    'Incident monitoring résolu',
    'Client connecté',
    'Nouvelle opportunité détectée',
    'Workflow exécuté',
    'Export PDF terminé',

  ];

  const random =
    events[
      Math.floor(
        Math.random()
        * events.length
      )
    ];

  pushActivity({

    text:random,

  });

}, 18000);
/* =========================================================
   ADVANCED SECURITY ENGINE
========================================================= */

const security = {

  sessionTimeout:
    1000 * 60 * 60 * 4,

  lastActivity:
    Date.now(),

  locked:false,

};

/* =========================================================
   SESSION TRACKING
========================================================= */

function updateSessionActivity(){

  security.lastActivity =
    Date.now();
}

[
  'click',
  'mousemove',
  'keydown',
  'scroll',
].forEach(eventName => {

  window.addEventListener(

    eventName,

    updateSessionActivity,

    {

      passive:true,

    }
  );
});

/* =========================================================
   SESSION WATCHER
========================================================= */

function startSessionWatcher(){

  setInterval(() => {

    const diff =
      Date.now()
      -
      security.lastActivity;

    if(

      diff >
      security.sessionTimeout

    ){

      lockDashboard();
    }

  }, 30000);
}

/* =========================================================
   LOCK DASHBOARD
========================================================= */

function lockDashboard(){

  if(security.locked){
    return;
  }

  security.locked =
    true;

  openModal({

    title:
      'Session verrouillée',

    content:`

      <div class="
        fp-flex
        fp-flexCol
        fp-gap20
      ">

        <div class="
          fp-sectionText
        ">

          La session a été verrouillée
          après une longue inactivité.

        </div>

        <input

          id="
            fpUnlockPassword
          "

          type="
            password
          "

          class="
            fp-input
          "

          placeholder="
            Mot de passe
          "
        />

        <button

          id="
            fpUnlockBtn
          "

          class="
            fp-btn
            fp-btnPrimary
          "
        >

          Déverrouiller

        </button>

      </div>

    `,

  });

  const button =
    qs('#fpUnlockBtn');

  if(button){

    button.onclick =
      unlockDashboard;
  }
}

/* =========================================================
   UNLOCK
========================================================= */

function unlockDashboard(){

  const input =
    qs('#fpUnlockPassword');

  if(

    !input?.value?.trim()

  ){

    toast(
      'Mot de passe requis',
      'danger'
    );

    return;
  }

  security.locked =
    false;

  updateSessionActivity();

  closeModal();

  toast(
    'Session restaurée',
    'success'
  );
}

/* =========================================================
   ROLE ENGINE
========================================================= */

function hasRole(role='user'){

  const current =
    state.user?.role
    || 'admin';

  const hierarchy = {

    viewer:1,

    user:2,

    manager:3,

    admin:4,

    owner:5,

  };

  return (

    hierarchy[current]
    >=
    hierarchy[role]

  );
}

/* =========================================================
   ROLE GUARD
========================================================= */

function guardRole({

  role='admin',

  callback=()=>{},

}){

  if(

    !hasRole(role)

  ){

    toast(
      'Permissions insuffisantes',
      'danger'
    );

    return;
  }

  callback();
}

/* =========================================================
   API TOKEN ENGINE
========================================================= */

function generateApiToken(){

  const token =

    'fp_' +

    Math.random()
      .toString(36)
      .slice(2)

    +

    Date.now()
      .toString(36);

  saveLocal(

    'fp_api_token',

    token

  );

  return token;
}

function getApiToken(){

  return loadLocal(

    'fp_api_token',

    null

  );
}

/* =========================================================
   API SETTINGS PAGE
========================================================= */

function renderApiPage(){

  const token =
    getApiToken()
    || generateApiToken();

  return `

    <div class="
      fp-page
    ">

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-sectionTitle
          ">

            API & Infrastructure

          </div>

          <div class="
            fp-sectionText
          ">

            Tokens API,
            webhooks,
            automatisations,
            intégrations
            et infrastructure FlowPoint.

          </div>

        </div>

      </div>

      <div class="
        fp-grid2
        fp-mt24
      ">

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            <div class="
              fp-cardTitle
            ">

              API Token

            </div>

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-flex
              fp-gap12
            ">

              <input

                readonly

                class="
                  fp-input
                "

                value="
                  ${token}
                "
              />

              <button

                id="
                  fpRegenerateToken
                "

                class="
                  fp-btn
                  fp-btnPrimary
                "
              >

                Régénérer

              </button>

            </div>

          </div>

        </div>

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            <div class="
              fp-cardTitle
            ">

              Webhooks

            </div>

          </div>

          <div class="
            fp-cardBody
          ">

            ${renderDataTable({

              columns:[

                'Endpoint',
                'Status',

              ],

              rows:[

                [

                  '/stripe/webhook',
                  'ONLINE',

                ],

                [

                  '/monitor/events',
                  'ONLINE',

                ],

                [

                  '/reports/export',
                  'ONLINE',

                ],

              ],

            })}

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   API EVENTS
========================================================= */

function bindApiEvents(){

  const button =
    qs('#fpRegenerateToken');

  if(button){

    button.onclick = () => {

      guardRole({

        role:'admin',

        callback(){

          generateApiToken();

          render();

          toast(
            'Token régénéré',
            'success'
          );
        },

      });
    };
  }
}

/* =========================================================
   ROUTE
========================================================= */

routes.push({

  key:'api',

  label:'API',

  icon:'🔌',

});

/* =========================================================
   ROUTER PATCH
========================================================= */

const previousApiRouter =
  renderPage;

renderPage = function(){

  if(

    state.route
    === 'api'

  ){

    return renderApiPage();
  }

  return previousApiRouter();
};

/* =========================================================
   EVENTS PATCH
========================================================= */

const previousApiBind =
  bindEvents;

bindEvents = function(){

  previousApiBind();

  bindApiEvents();
};

/* =========================================================
   START
========================================================= */

startSessionWatcher();
/* =========================================================
   ADVANCED CHART ENGINE
========================================================= */

function createMiniChart({

  values = [],

  height = 80,

} = {}){

  if(!values.length){

    values = [

      20,
      40,
      28,
      60,
      48,
      82,
      70,

    ];
  }

  const max =
    Math.max(...values);

  const points =
    values.map((value,index) => {

      const x =
        (
          index
          /
          (values.length - 1)
        ) * 100;

      const y =
        100
        -
        (
          value
          / max
        ) * 100;

      return `${x},${y}`;

    }).join(' ');

  return `

    <svg
      class="
        fp-miniChart
      "

      viewBox="
        0 0 100 100
      "

      preserveAspectRatio="
        none
      "

      style="
        height:${height}px;
      "
    >

      <polyline

        fill="
          none
        "

        stroke="
          currentColor
        "

        stroke-width="
          3
        "

        points="
          ${points}
        "

      />

    </svg>

  `;
}

/* =========================================================
   ADVANCED ANALYTICS WIDGET
========================================================= */

function renderAnalyticsWidget({

  title='Analytics',

  value='0',

  trend='+0%',

  values=[],

} = {}){

  return `

    <div class="
      fp-analyticsWidget
    ">

      <div class="
        fp-flex
        fp-alignCenter
        fp-justifyBetween
      ">

        <div>

          <div class="
            fp-kpiLabel
          ">

            ${title}

          </div>

          <div class="
            fp-kpiValue
          ">

            ${value}

          </div>

        </div>

        <div class="
          fp-badge
          ${
            trend.startsWith('-')
              ? 'fp-badgeDanger'
              : 'fp-badgeSuccess'
          }
        ">

          ${trend}

        </div>

      </div>

      <div class="
        fp-mt20
      ">

        ${createMiniChart({

          values,

        })}

      </div>

    </div>

  `;
}

/* =========================================================
   EXECUTIVE OVERVIEW
========================================================= */

function renderExecutiveOverview(){

  return `

    <div class="
      fp-grid4
      fp-mt24
    ">

      ${renderAnalyticsWidget({

        title:
          'SEO Growth',

        value:
          '+28%',

        trend:
          '+12%',

        values:[

          10,
          20,
          40,
          52,
          61,
          78,
          92,

        ],

      })}

      ${renderAnalyticsWidget({

        title:
          'Conversions',

        value:
          '4.8%',

        trend:
          '+8%',

        values:[

          20,
          28,
          34,
          40,
          55,
          60,
          74,

        ],

      })}

      ${renderAnalyticsWidget({

        title:
          'Infrastructure',

        value:
          '99.98%',

        trend:
          '+1%',

        values:[

          82,
          88,
          92,
          94,
          96,
          98,
          99,

        ],

      })}

      ${renderAnalyticsWidget({

        title:
          'Clients',

        value:
          '128',

        trend:
          '+18%',

        values:[

          12,
          20,
          30,
          48,
          64,
          88,
          100,

        ],

      })}

    </div>

  `;
}

/* =========================================================
   OVERVIEW PATCH
========================================================= */

const previousExecutiveOverview =
  renderOverview;

renderOverview = function(){

  return `

    ${previousExecutiveOverview()}

    ${renderExecutiveOverview()}

  `;
};

/* =========================================================
   ADVANCED ACTIVITY TIMELINE
========================================================= */

function renderActivityTimeline(){

  const events = [

    {

      title:
        'Executive report exporté',

      text:
        'PDF premium généré avec succès.',

      type:
        'success',

    },

    {

      title:
        'Incident monitoring détecté',

      text:
        'Latence élevée sur cluster principal.',

      type:
        'warning',

    },

    {

      title:
        'Nouvelle opportunité SEO',

      text:
        'Pages locales Bruxelles recommandées.',

      type:
        'primary',

    },

  ];

  return `

    <div class="
      fp-card
      fp-mt24
    ">

      <div class="
        fp-cardHeader
      ">

        <div class="
          fp-cardTitle
        ">

          Executive Activity

        </div>

      </div>

      <div class="
        fp-cardBody
      ">

        <div class="
          fp-timeline
        ">

          ${events.map(event => `

            <div class="
              fp-timelineItem
            ">

              <div class="
                fp-timelineDot
                ${event.type}
              "></div>

              <div class="
                fp-timelineCard
              ">

                <div class="
                  fp-timelineTitle
                ">

                  ${event.title}

                </div>

                <div class="
                  fp-timelineText
                ">

                  ${event.text}

                </div>

              </div>

            </div>

          `).join('')}

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   OVERVIEW PATCH
========================================================= */

const previousOverviewTimeline =
  renderOverview;

renderOverview = function(){

  return `

    ${previousOverviewTimeline()}

    ${renderActivityTimeline()}

  `;
};

/* =========================================================
   PERFORMANCE GRAPH
========================================================= */

function renderPerformanceGraph(){

  return `

    <div class="
      fp-card
      fp-mt24
    ">

      <div class="
        fp-cardHeader
      ">

        <div class="
          fp-cardTitle
        ">

          Performance Analytics

        </div>

      </div>

      <div class="
        fp-cardBody
      ">

        <div class="
          fp-performanceGraph
        ">

          ${createMiniChart({

            height:260,

            values:[

              18,
              22,
              40,
              38,
              62,
              58,
              84,
              92,
              110,

            ],

          })}

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   OVERVIEW FINAL PATCH
========================================================= */

const previousOverviewGraph =
  renderOverview;

renderOverview = function(){

  return `

    ${previousOverviewGraph()}

    ${renderPerformanceGraph()}

  `;
};
/* =========================================================
   ADVANCED MOBILE ENGINE
========================================================= */

function detectMobile(){

  return window.innerWidth < 980;
}

function updateResponsiveState(){

  state.mobile =
    detectMobile();

  document.body.classList.toggle(

    'fp-mobile',

    state.mobile

  );
}

/* =========================================================
   RESPONSIVE LISTENER
========================================================= */

window.addEventListener(

  'resize',

  debounce(() => {

    updateResponsiveState();

  }, 120)

);

/* =========================================================
   DEBOUNCE
========================================================= */

function debounce(

  callback,

  delay = 120

){

  let timeout;

  return (...args) => {

    clearTimeout(timeout);

    timeout = setTimeout(() => {

      callback(...args);

    }, delay);
  };
}

/* =========================================================
   MOBILE SIDEBAR CLOSE
========================================================= */

function bindMobileOverlay(){

  const sidebar =
    qs('.fp-sidebar');

  if(!sidebar){
    return;
  }

  document.onclick = event => {

    if(

      !state.mobile

    ){
      return;
    }

    const insideSidebar =
      event.target.closest(
        '.fp-sidebar'
      );

    const mobileButton =
      event.target.closest(
        '#fpMobileMenuBtn'
      );

    if(

      !insideSidebar
      &&
      !mobileButton
      &&
      state.mobileSidebar

    ){

      state.mobileSidebar =
        false;

      render();
    }
  };
}

/* =========================================================
   TOUCH GESTURES
========================================================= */

function bindTouchGestures(){

  let startX = 0;

  window.addEventListener(

    'touchstart',

    event => {

      startX =
        event.touches[0].clientX;
    },

    {

      passive:true,

    }
  );

  window.addEventListener(

    'touchend',

    event => {

      const endX =
        event.changedTouches[0]
          .clientX;

      const diff =
        endX - startX;

      if(

        diff > 100
        &&
        state.mobile

      ){

        state.mobileSidebar =
          true;

        render();
      }

      if(

        diff < -100
        &&
        state.mobile

      ){

        state.mobileSidebar =
          false;

        render();
      }

    },

    {

      passive:true,

    }
  );
}

/* =========================================================
   SAFE AREA SUPPORT
========================================================= */

function applySafeAreas(){

  document.documentElement
    .style
    .setProperty(

      '--fp-safe-top',

      'env(safe-area-inset-top)'

    );

  document.documentElement
    .style
    .setProperty(

      '--fp-safe-bottom',

      'env(safe-area-inset-bottom)'

    );
}

/* =========================================================
   ADVANCED SCROLL ENGINE
========================================================= */

function scrollToTop(){

  window.scrollTo({

    top:0,

    behavior:'smooth',

  });
}

function createScrollButton(){

  const button =
    document.createElement(
      'button'
    );

  button.className =
    'fp-scrollTop';

  button.innerHTML =
    '↑';

  button.onclick =
    scrollToTop;

  document.body.appendChild(
    button );

  window.addEventListener(

    'scroll',

    () => {

      if(

        window.scrollY > 400

      ){

        button.classList.add(
          'visible'
        );

      }else{

        button.classList.remove(
          'visible'
        );
      }
    }
  );
}

/* =========================================================
   FPS MONITOR
========================================================= */

const fpsMonitor = {

  frame:0,

  last:
    performance.now(),

};

function startFpsMonitor(){

  function tick(now){

    fpsMonitor.frame++;

    if(

      now - fpsMonitor.last
      >= 1000

    ){

      fpsMonitor.fps =
        fpsMonitor.frame;

      fpsMonitor.frame =
        0;

      fpsMonitor.last =
        now;

      updateFpsWidget();
    }

    requestAnimationFrame(
      tick
    );
  }

  requestAnimationFrame(
    tick
  );
}

function updateFpsWidget(){

  qsa('.fp-fpsWidget')
    .forEach(el => {

      el.textContent =
        `${fpsMonitor.fps || 60} FPS`;

    });
}

/* =========================================================
   FPS WIDGET
========================================================= */

function renderFpsWidget(){

  return `

    <div class="
      fp-fpsWidget
    ">

      60 FPS

    </div>

  `;
}

/* =========================================================
   TOPBAR PATCH
========================================================= */

const previousMobileTopbar =
  renderTopbar;

renderTopbar = function(){

  const html =
    previousMobileTopbar();

  return html.replace(

    '</div>\n\n    </div>',

    `

      ${renderFpsWidget()}

    </div>

    `
  );
};

/* =========================================================
   LOW POWER MODE
========================================================= */

function enableLowPowerMode(){

  document.body.classList.add(
    'fp-lowPower'
  );

  toast(
    'Mode économie activé',
    'warning'
  );
}

function disableLowPowerMode(){

  document.body.classList.remove(
    'fp-lowPower'
  );

  toast(
    'Mode économie désactivé',
    'success'
  );
}

/* =========================================================
   MEMORY CLEANUP
========================================================= */

function cleanupMemory(){

  if(

    modalState.open

  ){
    return;
  }

  qsa('.fp-temp')
    .forEach(el => {

      el.remove();
    });
}

/* =========================================================
   AUTO CLEANUP
========================================================= */

setInterval(

  cleanupMemory,

  60000

);

/* =========================================================
   START MOBILE ENGINE
========================================================= */

updateResponsiveState();

applySafeAreas();

bindTouchGestures();

bindMobileOverlay();

createScrollButton();

startFpsMonitor();
/* =========================================================
   FINAL DASHBOARD OPTIMIZATION ENGINE
========================================================= */

const optimization = {

  cache:new Map(),

  renderedRoutes:new Set(),

  preloaded:false,

};

/* =========================================================
   SMART CACHE
========================================================= */

function setCache(

  key,

  value

){

  optimization.cache.set(

    key,

    {

      value,

      createdAt:
        Date.now(),

    }

  );
}

function getCache(

  key,

  maxAge = 60000

){

  const item =
    optimization.cache.get(
      key
    );

  if(!item){
    return null;
  }

  const expired =

    Date.now()
    -
    item.createdAt

    >

    maxAge;

  if(expired){

    optimization.cache.delete(
      key
    );

    return null;
  }

  return item.value;
}

/* =========================================================
   API CACHE PATCH
========================================================= */

const originalApi =
  api;

api = async function(

  url,

  options = {}

){

  const cacheKey =

    url
    +
    JSON.stringify(options);

  if(

    !options.method
    ||
    options.method === 'GET'

  ){

    const cached =
      getCache(cacheKey);

    if(cached){

      return cached;
    }
  }

  const result =
    await originalApi(
      url,
      options
    );

  if(

    !options.method
    ||
    options.method === 'GET'

  ){

    setCache(
      cacheKey,
      result
    );
  }

  return result;
};

/* =========================================================
   PRELOAD ROUTES
========================================================= */

function preloadCriticalRoutes(){

  if(
    optimization.preloaded
  ){
    return;
  }

  optimization.preloaded =
    true;

  [

    'overview',
    'analytics',
    'monitors',
    'audits',

  ].forEach(route => {

    optimization.renderedRoutes
      .add(route);
  });
}

/* =========================================================
   SMART PREFETCH
========================================================= */

function prefetchRoute(route){

  if(

    optimization.renderedRoutes
      .has(route)

  ){
    return;
  }

  optimization.renderedRoutes
    .add(route);

  requestIdleCallback(() => {

    try{

      renderPage(route);

    }catch(err){

      console.warn(err);
    }

  });
}

/* =========================================================
   LINK PREFETCH
========================================================= */

function bindPrefetch(){

  qsa('[data-route]')
    .forEach(button => {

      button.onmouseenter =
        () => {

          prefetchRoute(

            button.dataset.route

          );
        };
    });
}

/* =========================================================
   MEMORY STATS
========================================================= */

function getMemoryStats(){

  if(

    !performance.memory

  ){

    return null;
  }

  return {

    used:

      Math.round(

        performance.memory
          .usedJSHeapSize

        / 1048576

      ),

    total:

      Math.round(

        performance.memory
          .totalJSHeapSize

        / 1048576

      ),

  };
}

/* =========================================================
   DEV PANEL
========================================================= */

function renderDevPanel(){

  const memory =
    getMemoryStats();

  return `

    <div class="
      fp-devPanel
    ">

      <div class="
        fp-devTitle
      ">

        FlowPoint Engine

      </div>

      <div class="
        fp-devStat
      ">

        Route:
        ${state.route}

      </div>

      <div class="
        fp-devStat
      ">

        Cache:
        ${optimization.cache.size}

      </div>

      <div class="
        fp-devStat
      ">

        FPS:
        ${fpsMonitor.fps || 60}

      </div>

      <div class="
        fp-devStat
      ">

        Latency:
        ${realtime.latency}ms

      </div>

      <div class="
        fp-devStat
      ">

        Memory:
        ${
          memory
            ? `${memory.used}MB`
            : 'N/A'
        }

      </div>

    </div>

  `;
}

/* =========================================================
   DEV MODE
========================================================= */

const devMode = {

  enabled:false,

};

function toggleDevMode(){

  devMode.enabled =
    !devMode.enabled;

  let existing =
    qs('.fp-devPanel');

  if(existing){

    existing.remove();
  }

  if(devMode.enabled){

    const panel =
      document.createElement(
        'div'
      );

    panel.innerHTML =
      renderDevPanel();

    document.body.appendChild(

      panel.firstElementChild

    );

    toast(
      'Dev mode activé',
      'success'
    );

  }else{

    toast(
      'Dev mode désactivé',
      'warning'
    );
  }
}

/* =========================================================
   DEV SHORTCUT
========================================================= */

window.addEventListener(

  'keydown',

  event => {

    if(

      event.shiftKey
      &&
      event.key.toLowerCase()
      === 'd'

    ){

      toggleDevMode();
    }
  }
);

/* =========================================================
   ERROR BOUNDARY
========================================================= */

window.addEventListener(

  'error',

  event => {

    console.error(
      'Global error',
      event.error
    );

    toast(
      'Erreur détectée',
      'danger'
    );
  }
);

/* =========================================================
   PROMISE ERRORS
========================================================= */

window.addEventListener(

  'unhandledrejection',

  event => {

    console.error(
      'Promise rejection',
      event.reason
    );

    toast(
      'Erreur async',
      'danger'
    );
  }
);

/* =========================================================
   SMART PERFORMANCE SCORE
========================================================= */

function calculatePerformanceScore(){

  let score = 100;

  if(

    realtime.latency > 300

  ){

    score -= 15;
  }

  if(

    fpsMonitor.fps < 45

  ){

    score -= 20;
  }

  if(

    !realtime.connected

  ){

    score -= 30;
  }

  return Math.max(
    score,
    0
  );
}

/* =========================================================
   PERFORMANCE BADGE
========================================================= */

function renderPerformanceBadge(){

  const score =
    calculatePerformanceScore();

  return `

    <div class="
      fp-performanceBadge
    ">

      ${score}/100

    </div>

  `;
}

/* =========================================================
   TOPBAR PATCH
========================================================= */

const previousPerfTopbar =
  renderTopbar;

renderTopbar = function(){

  const html =
    previousPerfTopbar();

  return html.replace(

    '</div>\n\n    </div>',

    `

      ${renderPerformanceBadge()}

    </div>

    `
  );
};

/* =========================================================
   FINAL INIT
========================================================= */

preloadCriticalRoutes();

bindPrefetch();

/* =========================================================
   FLOWPOINT ENGINE READY
========================================================= */

console.log(`

███████╗██╗      ██████╗ ██╗    ██╗██████╗  ██████╗ ██╗███╗   ██╗████████╗
██╔════╝██║     ██╔═══██╗██║    ██║██╔══██╗██╔═══██╗██║████╗  ██║╚══██╔══╝
█████╗  ██║     ██║   ██║██║ █╗ ██║██████╔╝██║   ██║██║██╔██╗ ██║   ██║
██╔══╝  ██║     ██║   ██║██║███╗██║██╔═══╝ ██║   ██║██║██║╚██╗██║   ██║
██║     ███████╗╚██████╔╝╚███╔███╔╝██║     ╚██████╔╝██║██║ ╚████║   ██║
╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝ ╚═╝      ╚═════╝ ╚═╝╚═╝  ╚═══╝   ╚═╝

EXECUTIVE DASHBOARD READY

`);
/* =========================================================
   FINAL PRODUCTION PATCHES
========================================================= */

/* =========================================================
   SAFE RENDER
========================================================= */

function safeRender(callback){

  try{

    return callback();

  }catch(err){

    console.error(err);

    return `

      <div class="
        fp-page
      ">

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-emptyState
            ">

              <div class="
                fp-emptyIcon
              ">
                ⚠️
              </div>

              <div class="
                fp-emptyTitle
              ">

                Une erreur est survenue

              </div>

              <div class="
                fp-emptyText
              ">

                Impossible de charger cette page.

              </div>

            </div>

          </div>

        </div>

      </div>

    `;
  }
}

/* =========================================================
   PAGE RENDER PATCH
========================================================= */

const previousSafeRenderPage =
  renderPage;

renderPage = function(){

  return safeRender(() =>

    previousSafeRenderPage()

  );
};

/* =========================================================
   SAFE JSON
========================================================= */

function safeJsonParse(

  value,

  fallback = null

){

  try{

    return JSON.parse(value);

  }catch(err){

    return fallback;
  }
}

/* =========================================================
   NETWORK STATUS
========================================================= */

function getNetworkStatus(){

  if(

    !navigator.connection

  ){

    return null;
  }

  return {

    type:
      navigator.connection
        .effectiveType,

    downlink:
      navigator.connection
        .downlink,

  };
}

/* =========================================================
   PERFORMANCE REPORT
========================================================= */

function buildPerformanceReport(){

  return {

    fps:
      fpsMonitor.fps || 60,

    latency:
      realtime.latency,

    connected:
      realtime.connected,

    route:
      state.route,

    memory:
      getMemoryStats(),

    network:
      getNetworkStatus(),

  };
}

/* =========================================================
   EXPORT PERFORMANCE REPORT
========================================================= */

function exportPerformanceReport(){

  const report =
    buildPerformanceReport();

  const blob =
    new Blob(

      [

        JSON.stringify(
          report,
          null,
          2
        )

      ],

      {

        type:
          'application/json',

      }

    );

  const url =
    URL.createObjectURL(
      blob
    );

  const link =
    document.createElement(
      'a'
    );

  link.href =
    url;

  link.download =
    'flowpoint-performance.json';

  link.click();

  URL.revokeObjectURL(
    url
  );

  toast(
    'Rapport exporté',
    'success'
  );
}

/* =========================================================
   COMMAND SHORTCUTS
========================================================= */

window.addEventListener(

  'keydown',

  event => {

    /* COMMAND BAR */

    if(

      (
        event.metaKey
        ||
        event.ctrlKey
      )

      &&

      event.key.toLowerCase()
      === 'k'

    ){

      event.preventDefault();

      const input =
        qs('#fpCommandInput');

      if(input){

        input.focus();
      }
    }

    /* PERFORMANCE EXPORT */

    if(

      event.shiftKey

      &&

      event.key.toLowerCase()
      === 'e'

    ){

      exportPerformanceReport();
    }

    /* QUICK OVERVIEW */

    if(

      event.shiftKey

      &&

      event.key.toLowerCase()
      === 'h'

    ){

      setRoute(
        'overview'
      );
    }
  }
);

/* =========================================================
   APP VERSION
========================================================= */

const FLOWPOINT_VERSION =
  '3.0.0-enterprise';

/* =========================================================
   FOOTER ENGINE
========================================================= */

function renderFooter(){

  return `

    <footer class="
      fp-footer
    ">

      <div class="
        fp-footerLeft
      ">

        FlowPoint
        ${FLOWPOINT_VERSION}

      </div>

      <div class="
        fp-footerRight
      ">

        Executive Infrastructure Platform

      </div>

    </footer>

  `;
}

/* =========================================================
   MAIN LAYOUT PATCH
========================================================= */

const previousDashboardShell =
  renderDashboardShell;

renderDashboardShell = function(){

  const html =
    previousDashboardShell();

  return html.replace(

    '</main>',

    `

      ${renderFooter()}

    </main>

    `
  );
};

/* =========================================================
   SMART AUTO SAVE
========================================================= */

function autoSaveWorkspace(){

  saveLocal(

    'fp_workspace_snapshot',

    {

      state,

      realtime,

      timestamp:
        Date.now(),

    }

  );
}

/* =========================================================
   SNAPSHOT RESTORE
========================================================= */

function restoreWorkspaceSnapshot(){

  const snapshot =
    loadLocal(

      'fp_workspace_snapshot',

      null

    );

  if(!snapshot){
    return;
  }

  console.log(
    'Workspace snapshot restored',
    snapshot
  );
}

/* =========================================================
   PERIODIC SAVE
========================================================= */

setInterval(

  autoSaveWorkspace,

  45000

);

/* =========================================================
   FINAL BOOT CHECK
========================================================= */

function runSystemChecks(){

  const checks = [

    {

      name:
        'Realtime',

      ok:
        realtime.connected,

    },

    {

      name:
        'Rendering',

      ok:true,

    },

    {

      name:
        'Storage',

      ok:!!window.localStorage,

    },

    {

      name:
        'Routing',

      ok:!!state.route,

    },

  ];

  const failed =
    checks.filter(
      check => !check.ok
    );

  if(failed.length){

    console.warn(
      'Checks failed',
      failed
    );

  }else{

    console.log(
      'All systems operational'
    );
  }
}

/* =========================================================
   FINAL START
========================================================= */

restoreWorkspaceSnapshot();

runSystemChecks();

toast(
  'FlowPoint chargé',
  'success'
);

/* =========================================================
   READY
========================================================= */

window.FlowPoint = {

  version:
    FLOWPOINT_VERSION,

  state,

  realtime,

  render,

  setRoute,

  toast,

  openModal,

  openDrawer,

  exportCsv,

};

console.log(

  `%cFlowPoint ${FLOWPOINT_VERSION}`,

  `
    background:#2f5bff;
    color:white;
    padding:8px 14px;
    border-radius:10px;
    font-weight:bold;
  `
);
/* =========================================================
   FINAL CSS AUTO PATCH ENGINE
   (inject critical dashboard styles safely)
========================================================= */

function injectCriticalStyles(){

  if(

    document.getElementById(
      'fp-critical-styles'
    )

  ){
    return;
  }

  const style =
    document.createElement(
      'style'
    );

  style.id =
    'fp-critical-styles';

  style.innerHTML = `

/* =========================================================
   CORE LAYOUT
========================================================= */

.fp-dashboardShell{
  display:flex;
  min-height:100vh;
  background:
    radial-gradient(
      circle at top left,
      rgba(47,91,255,.18),
      transparent 30%
    ),
    linear-gradient(
      180deg,
      #060816 0%,
      #09111f 100%
    );
  color:#fff;
}

.fp-main{
  flex:1;
  min-width:0;
  display:flex;
  flex-direction:column;
}

.fp-content{
  padding:28px;
  display:flex;
  flex-direction:column;
  gap:24px;
}

/* =========================================================
   SIDEBAR
========================================================= */

.fp-sidebar{
  width:290px;
  background:
    rgba(10,15,30,.82);
  border-right:
    1px solid
    rgba(255,255,255,.06);
  backdrop-filter:
    blur(18px);
  position:sticky;
  top:0;
  height:100vh;
  display:flex;
  flex-direction:column;
  z-index:40;
}

.fp-sidebarTop{
  padding:26px;
  border-bottom:
    1px solid
    rgba(255,255,255,.06);
}

.fp-sidebarNav{
  flex:1;
  padding:18px;
  overflow:auto;
}

.fp-sidebarBottom{
  padding:18px;
  border-top:
    1px solid
    rgba(255,255,255,.06);
}

.fp-sidebarLink{
  width:100%;
  display:flex;
  align-items:center;
  gap:14px;
  padding:14px 16px;
  border-radius:16px;
  background:transparent;
  color:#d6def5;
  border:none;
  cursor:pointer;
  transition:.24s;
  font-weight:600;
}

.fp-sidebarLink:hover{
  background:
    rgba(255,255,255,.06);
}

.fp-sidebarLink.active{
  background:
    linear-gradient(
      135deg,
      rgba(47,91,255,.28),
      rgba(47,91,255,.12)
    );
  color:#fff;
  box-shadow:
    0 10px 30px
    rgba(47,91,255,.24);
}

/* =========================================================
   TOPBAR
========================================================= */

.fp-topbar{
  position:sticky;
  top:0;
  z-index:20;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:20px;
  padding:18px 28px;
  backdrop-filter:blur(18px);
  background:
    rgba(6,10,20,.72);
  border-bottom:
    1px solid
    rgba(255,255,255,.05);
}

.fp-pageTitle{
  font-size:24px;
  font-weight:800;
}

.fp-pageSub{
  color:#8fa3d7;
  font-size:14px;
  margin-top:6px;
}

/* =========================================================
   CARDS
========================================================= */

.fp-card{
  background:
    linear-gradient(
      180deg,
      rgba(18,25,45,.94),
      rgba(11,18,34,.94)
    );
  border:
    1px solid
    rgba(255,255,255,.06);
  border-radius:26px;
  overflow:hidden;
  box-shadow:
    0 20px 60px
    rgba(0,0,0,.32);
}

.fp-cardHeader{
  padding:22px 24px;
  border-bottom:
    1px solid
    rgba(255,255,255,.05);
}

.fp-cardBody{
  padding:24px;
}

.fp-cardTitle{
  font-size:18px;
  font-weight:700;
}

.fp-gradientPrimary{
  background:
    linear-gradient(
      135deg,
      #2449ff,
      #2f5bff,
      #3d6bff
    );
}

.fp-gradientDanger{
  background:
    linear-gradient(
      135deg,
      #dc2626,
      #ef4444
    );
}

.fp-gradientSuccess{
  background:
    linear-gradient(
      135deg,
      #059669,
      #10b981
    );
}

/* =========================================================
   BUTTONS
========================================================= */

.fp-btn{
  border:none;
  border-radius:14px;
  padding:13px 18px;
  font-weight:700;
  cursor:pointer;
  transition:.24s;
}

.fp-btnPrimary{
  background:
    linear-gradient(
      135deg,
      #2f5bff,
      #4f7bff
    );
  color:white;
  box-shadow:
    0 12px 28px
    rgba(47,91,255,.28);
}

.fp-btnPrimary:hover{
  transform:
    translateY(-2px);
}

.fp-btnGhost{
  background:
    rgba(255,255,255,.06);
  color:white;
}

/* =========================================================
   KPI
========================================================= */

.fp-kpiCard{
  background:
    rgba(255,255,255,.04);
  border:
    1px solid
    rgba(255,255,255,.05);
  border-radius:22px;
  padding:22px;
}

.fp-kpiLabel{
  color:#8fa3d7;
  font-size:13px;
}

.fp-kpiValue{
  font-size:34px;
  font-weight:800;
  margin-top:12px;
}

/* =========================================================
   GRID
========================================================= */

.fp-grid2{
  display:grid;
  grid-template-columns:
    repeat(2,minmax(0,1fr));
  gap:20px;
}

.fp-grid3{
  display:grid;
  grid-template-columns:
    repeat(3,minmax(0,1fr));
  gap:20px;
}

.fp-grid4{
  display:grid;
  grid-template-columns:
    repeat(4,minmax(0,1fr));
  gap:20px;
}

/* =========================================================
   BADGES
========================================================= */

.fp-badge{
  padding:8px 12px;
  border-radius:999px;
  font-size:12px;
  font-weight:700;
}

.fp-badgePrimary{
  background:
    rgba(47,91,255,.18);
  color:#7ea0ff;
}

.fp-badgeSuccess{
  background:
    rgba(16,185,129,.14);
  color:#34d399;
}

.fp-badgeDanger{
  background:
    rgba(239,68,68,.14);
  color:#f87171;
}

.fp-badgeWarning{
  background:
    rgba(245,158,11,.14);
  color:#fbbf24;
}

/* =========================================================
   INPUTS
========================================================= */

.fp-input,
.fp-select,
.fp-textarea{
  width:100%;
  background:
    rgba(255,255,255,.05);
  border:
    1px solid
    rgba(255,255,255,.08);
  color:white;
  border-radius:16px;
  padding:14px 16px;
  outline:none;
}

.fp-input::placeholder,
.fp-textarea::placeholder{
  color:#7e8fb8;
}

.fp-textarea{
  min-height:120px;
  resize:vertical;
}

/* =========================================================
   PROGRESS
========================================================= */

.fp-progress{
  height:10px;
  background:
    rgba(255,255,255,.06);
  border-radius:999px;
  overflow:hidden;
}

.fp-progressBar{
  height:100%;
  border-radius:999px;
  background:
    linear-gradient(
      90deg,
      #2f5bff,
      #5b7cff
    );
}

/* =========================================================
   TABLE
========================================================= */

.fp-table{
  width:100%;
  border-collapse:collapse;
}

.fp-table th{
  text-align:left;
  padding:16px;
  color:#8fa3d7;
  font-size:13px;
}

.fp-table td{
  padding:16px;
  border-top:
    1px solid
    rgba(255,255,255,.05);
}

/* =========================================================
   MOBILE
========================================================= */

@media(max-width:1200px){

  .fp-grid4{
    grid-template-columns:
      repeat(2,minmax(0,1fr));
  }

  .fp-grid3{
    grid-template-columns:
      repeat(2,minmax(0,1fr));
  }
}

@media(max-width:980px){

  .fp-sidebar{
    position:fixed;
    left:-100%;
    transition:.28s;
  }

  .fp-sidebar.open{
    left:0;
  }

  .fp-grid2,
  .fp-grid3,
  .fp-grid4{
    grid-template-columns:1fr;
  }

  .fp-content{
    padding:18px;
  }

  .fp-topbar{
    padding:16px 18px;
  }
}

/* =========================================================
   ANIMATIONS
========================================================= */

.fp-card,
.fp-kpiCard,
.fp-sidebarLink{
  animation:
    fpFade .28s ease;
}

@keyframes fpFade{

  from{
    opacity:0;
    transform:
      translateY(8px);
  }

  to{
    opacity:1;
    transform:
      translateY(0);
  }
}

  `;

  document.head.appendChild(
    style
  );
}

/* =========================================================
   START STYLE ENGINE
========================================================= */

injectCriticalStyles();
/* =========================================================
   FINAL ENTERPRISE PATCHES
========================================================= */

/* =========================================================
   ADVANCED SEARCH OVERLAY
========================================================= */

function openGlobalSearch(){

  openModal({

    title:
      'Recherche globale',

    large:true,

    content:`

      <div class="
        fp-flex
        fp-flexCol
        fp-gap20
      ">

        <input

          id="
            fpGlobalSearchInput
          "

          class="
            fp-input
          "

          placeholder="
            Rechercher pages,
            clients,
            audits,
            monitors...
          "
        />

        <div
          id="
            fpGlobalSearchResults
          "

          class="
            fp-list
          "
        ></div>

      </div>

    `,

  });

  const input =
    qs('#fpGlobalSearchInput');

  const results =
    qs('#fpGlobalSearchResults');

  if(!input || !results){
    return;
  }

  input.focus();

  input.oninput = () => {

    const value =
      input.value.trim();

    const data =
      performGlobalSearch(
        value
      );

    results.innerHTML =

      data.length

      ? data.map(item => `

        <button

          class="
            fp-commandItem
          "

          data-global-route="
            ${item.key || ''}
          "
        >

          <div>

            <div class="
              fp-commandTitle
            ">

              ${item.title}

            </div>

            <div class="
              fp-commandType
            ">

              ${item.type}

            </div>

          </div>

        </button>

      `).join('')

      : createEmptyState({

          icon:'🔎',

          title:
            'Aucun résultat',

          text:
            'Aucun élément trouvé.',

        });

    qsa('[data-global-route]')
      .forEach(button => {

        button.onclick = () => {

          const route =
            button.dataset
              .globalRoute;

          if(route){

            setRoute(route);
          }

          closeModal();
        };
      });
  };
}

/* =========================================================
   QUICK ACTIONS
========================================================= */

function renderQuickActions(){

  return `

    <div class="
      fp-quickActions
    ">

      <button
        class="
          fp-quickAction
        "

        data-quick-action="
          audit
        "
      >

        📈

      </button>

      <button
        class="
          fp-quickAction
        "

        data-quick-action="
          monitor
        "
      >

        🛰️

      </button>

      <button
        class="
          fp-quickAction
        "

        data-quick-action="
          report
        "
      >

        📄

      </button>

      <button
        class="
          fp-quickAction
        "

        data-quick-action="
          search
        "
      >

        🔎

      </button>

    </div>

  `;
}

/* =========================================================
   QUICK ACTION EVENTS
========================================================= */

function bindQuickActions(){

  qsa('[data-quick-action]')
    .forEach(button => {

      button.onclick = () => {

        const action =
          button.dataset
            .quickAction;

        if(action === 'search'){

          openGlobalSearch();

          return;
        }

        if(action === 'audit'){

          toast(
            'Nouveau audit lancé',
            'success'
          );

          return;
        }

        if(action === 'monitor'){

          toast(
            'Monitor créé',
            'success'
          );

          return;
        }

        if(action === 'report'){

          toast(
            'Export PDF généré',
            'success'
          );
        }
      };
    });
}

/* =========================================================
   LAYOUT PATCH
========================================================= */

const previousEnterpriseShell =
  renderDashboardShell;

renderDashboardShell = function(){

  const html =
    previousEnterpriseShell();

  return html.replace(

    '</body>',

    `

      ${renderQuickActions()}

    </body>

    `
  );
};

/* =========================================================
   ADVANCED EMPTY FALLBACKS
========================================================= */

function ensureArrays(){

  if(!Array.isArray(state.monitors)){

    state.monitors = [];
  }

  if(!Array.isArray(state.audits)){

    state.audits = [];
  }

  if(!Array.isArray(state.alerts)){

    state.alerts = [];
  }

  if(!Array.isArray(state.missions)){

    state.missions = [];
  }

  if(!Array.isArray(state.reports)){

    state.reports = [];
  }
}

/* =========================================================
   STARTUP PATCH
========================================================= */

const previousBootDashboard =
  bootDashboard;

bootDashboard = async function(){

  ensureArrays();

  await previousBootDashboard();

  bindQuickActions();
};

/* =========================================================
   SYSTEM HEALTH
========================================================= */

function calculateSystemHealth(){

  let score = 100;

  if(

    realtime.latency > 240

  ){

    score -= 12;
  }

  if(

    !realtime.connected

  ){

    score -= 30;
  }

  if(

    state.alerts?.length > 8

  ){

    score -= 14;
  }

  return Math.max(
    score,
    0
  );
}

/* =========================================================
   SYSTEM HEALTH WIDGET
========================================================= */

function renderSystemHealth(){

  const score =
    calculateSystemHealth();

  return `

    <div class="
      fp-systemHealth
    ">

      <div class="
        fp-systemHealthScore
      ">

        ${score}

      </div>

      <div class="
        fp-systemHealthText
      ">

        System Health

      </div>

    </div>

  `;
}

/* =========================================================
   TOPBAR PATCH
========================================================= */

const previousHealthTopbar =
  renderTopbar;

renderTopbar = function(){

  const html =
    previousHealthTopbar();

  return html.replace(

    '</div>\n\n    </div>',

    `

      ${renderSystemHealth()}

    </div>

    `
  );
};

/* =========================================================
   FINAL EVENT PATCH
========================================================= */

const previousFinalEnterpriseBind =
  bindEvents;

bindEvents = function(){

  previousFinalEnterpriseBind();

  bindQuickActions();
};

/* =========================================================
   FLOWPOINT ENTERPRISE READY
========================================================= */

toast(
  'FlowPoint Enterprise prêt',
  'success'
);
/* =========================================================
   FINAL BILLING & SUBSCRIPTION ENGINE
========================================================= */

function renderBillingAdvanced(){

  const plans = [

    {

      name:
        'Standard',

      price:
        '49€',

      features:[

        '30 audits / mois',
        '3 monitors',
        '30 exports',
        '1 utilisateur',

      ],

      current:
        state.plan === 'standard',

    },

    {

      name:
        'Pro',

      price:
        '149€',

      features:[

        '300 audits / mois',
        '50 monitors',
        '300 exports',
        'Automations',

      ],

      current:
        state.plan === 'pro',

      highlight:true,

    },

    {

      name:
        'Ultra',

      price:
        '499€',

      features:[

        '2000 audits / mois',
        '300 monitors',
        'IA avancée',
        'White label',

      ],

      current:
        state.plan === 'ultra',

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Billing & Subscription

              </div>

              <div class="
                fp-sectionText
              ">

                Gestion abonnement,
                Stripe,
                facturation,
                add-ons
                et infrastructure premium.

              </div>

            </div>

            <div class="
              fp-badge
              fp-badgeSuccess
            ">

              PLAN:
              ${state.plan.toUpperCase()}

            </div>

          </div>

        </div>

      </div>

      <!-- PLANS -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        ${plans.map(plan => `

          <div class="
            fp-card
            ${
              plan.highlight
                ? 'fp-planHighlight'
                : ''
            }
          ">

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-flex
                fp-alignCenter
                fp-justifyBetween
              ">

                <div class="
                  fp-sectionTitle
                ">

                  ${plan.name}

                </div>

                ${
                  plan.current
                    ? `
                      <div class="
                        fp-badge
                        fp-badgeSuccess
                      ">
                        ACTIF
                      </div>
                    `
                    : ''
                }

              </div>

              <div class="
                fp-pricing
              ">

                ${plan.price}

                <span>

                  /mois

                </span>

              </div>

              <div class="
                fp-list
                fp-mt24
              ">

                ${plan.features.map(feature => `

                  <div class="
                    fp-listItem
                  ">

                    <div class="
                      fp-listTitle
                    ">

                      ✓ ${feature}

                    </div>

                  </div>

                `).join('')}

              </div>

              <button

                class="
                  fp-btn
                  ${
                    plan.current
                      ? 'fp-btnGhost'
                      : 'fp-btnPrimary'
                  }
                  fp-wFull
                  fp-mt24
                "

                data-plan="
                  ${plan.name.toLowerCase()}
                "
              >

                ${
                  plan.current
                    ? 'Plan actif'
                    : 'Upgrade'
                }

              </button>

            </div>

          </div>

        `).join('')}

      </div>

      <!-- BILLING TABLE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            Historique facturation

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Facture',
              'Date',
              'Montant',
              'Status',

            ],

            rows:[

              [

                '#INV-2026-001',
                '12 Juin',
                '149€',
                'Payé',

              ],

              [

                '#INV-2026-002',
                '12 Mai',
                '149€',
                'Payé',

              ],

              [

                '#INV-2026-003',
                '12 Avril',
                '149€',
                'Payé',

              ],

            ],

          })}

        </div>

      </div>

      <!-- ADDONS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            <div class="
              fp-cardTitle
            ">

              Add-ons

            </div>

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-list
            ">

              <div class="
                fp-listItem
              ">

                <div>

                  <div class="
                    fp-listTitle
                  ">

                    +50 monitors

                  </div>

                  <div class="
                    fp-listText
                  ">

                    39€/mois

                  </div>

                </div>

                <button class="
                  fp-btn
                  fp-btnPrimary
                ">

                  Ajouter

                </button>

              </div>

              <div class="
                fp-listItem
              ">

                <div>

                  <div class="
                    fp-listTitle
                  ">

                    White Label

                  </div>

                  <div class="
                    fp-listText
                  ">

                    99€/mois

                  </div>

                </div>

                <button class="
                  fp-btn
                  fp-btnPrimary
                ">

                  Ajouter

                </button>

              </div>

            </div>

          </div>

        </div>

        <!-- STRIPE -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            <div class="
              fp-cardTitle
            ">

              Stripe Infrastructure

            </div>

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-grid2
            ">

              <div class="
                fp-kpiCard
              ">

                <div class="
                  fp-kpiLabel
                ">

                  Webhooks

                </div>

                <div class="
                  fp-kpiValue
                ">

                  ONLINE

                </div>

              </div>

              <div class="
                fp-kpiCard
              ">

                <div class="
                  fp-kpiLabel
                ">

                  Payments

                </div>

                <div class="
                  fp-kpiValue
                ">

                  OK

                </div>

              </div>

            </div>

            <button

              id="
                fpOpenPortal
              "

              class="
                fp-btn
                fp-btnPrimary
                fp-wFull
                fp-mt24
              "
            >

              Ouvrir portail Stripe

            </button>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   BILLING EVENTS
========================================================= */

function bindBillingEvents(){

  qsa('[data-plan]')
    .forEach(button => {

      button.onclick = async () => {

        const plan =
          button.dataset.plan;

        toast(
          'Redirection Stripe...',
          'success'
        );

        try{

          const result =
            await api(

              '/api/billing/create-checkout',

              {

                method:'POST',

                body:JSON.stringify({

                  plan,

                }),

              }

            );

          if(result?.url){

            window.location.href =
              result.url;
          }

        }catch(err){

          console.error(err);

          toast(
            'Erreur Stripe',
            'danger'
          );
        }
      };
    });

  const portal =
    qs('#fpOpenPortal');

  if(portal){

    portal.onclick = async () => {

      toast(
        'Ouverture portail...',
        'success'
      );

      try{

        const result =
          await api(

            '/api/billing/portal',

            {

              method:'POST',

            }

          );

        if(result?.url){

          window.location.href =
            result.url;
        }

      }catch(err){

        toast(
          'Erreur portail',
          'danger'
        );
      }
    };
  }
}

/* =========================================================
   ROUTER PATCH
========================================================= */

const previousBillingRender =
  renderBilling;

renderBilling = function(){

  return renderBillingAdvanced()
    || previousBillingRender();
};

/* =========================================================
   EVENTS PATCH
========================================================= */

const previousBillingBind =
  bindEvents;

bindEvents = function(){

  previousBillingBind();

  bindBillingEvents();
};
/* =========================================================
   FINAL SETTINGS ENGINE
========================================================= */

function renderAdvancedSettings(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-sectionTitle
          ">

            Platform Settings

          </div>

          <div class="
            fp-sectionText
          ">

            Paramètres plateforme,
            sécurité,
            préférences,
            branding,
            IA
            et infrastructure.

          </div>

        </div>

      </div>

      <!-- SETTINGS GRID -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- PROFILE -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            <div class="
              fp-cardTitle
            ">

              Profil

            </div>

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-flex
              fp-flexCol
              fp-gap20
            ">

              <input
                class="
                  fp-input
                "
                placeholder="
                  Nom
                "
                value="
                  ${state.user?.name || ''}
                "
              />

              <input
                class="
                  fp-input
                "
                placeholder="
                  Email
                "
                value="
                  ${state.user?.email || ''}
                "
              />

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Sauvegarder

              </button>

            </div>

          </div>

        </div>

        <!-- SECURITY -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            <div class="
              fp-cardTitle
            ">

              Sécurité

            </div>

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-list
            ">

              <div class="
                fp-listItem
              ">

                <div>

                  <div class="
                    fp-listTitle
                  ">

                    Double authentification

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Sécurisation compte

                  </div>

                </div>

                <button class="
                  fp-btn
                  fp-btnPrimary
                ">

                  Activer

                </button>

              </div>

              <div class="
                fp-listItem
              ">

                <div>

                  <div class="
                    fp-listTitle
                  ">

                    Sessions actives

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Gestion appareils

                  </div>

                </div>

                <button class="
                  fp-btn
                  fp-btnGhost
                ">

                  Voir

                </button>

              </div>

            </div>

          </div>

        </div>

      </div>

      <!-- PLATFORM -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            IA

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-flex
              fp-flexCol
              fp-gap20
            ">

              <label class="
                fp-toggle
              ">

                <input
                  type="
                    checkbox
                  "
                  checked
                />

                <span>

                  Suggestions IA

                </span>

              </label>

              <label class="
                fp-toggle
              ">

                <input
                  type="
                    checkbox
                  "
                  checked
                />

                <span>

                  Executive summaries

                </span>

              </label>

            </div>

          </div>

        </div>

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Branding

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-flex
              fp-flexCol
              fp-gap20
            ">

              <input
                class="
                  fp-input
                "
                placeholder="
                  Nom entreprise
                "
                value="
                  FlowPoint
                "
              />

              <input
                class="
                  fp-input
                "
                placeholder="
                  Domaine custom
                "
              />

            </div>

          </div>

        </div>

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Notifications

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-flex
              fp-flexCol
              fp-gap20
            ">

              <label class="
                fp-toggle
              ">

                <input
                  type="
                    checkbox
                  "
                  checked
                />

                <span>

                  Alertes email

                </span>

              </label>

              <label class="
                fp-toggle
              ">

                <input
                  type="
                    checkbox
                  "
                  checked
                />

                <span>

                  Monitoring critique

                </span>

              </label>

            </div>

          </div>

        </div>

      </div>

      <!-- INFRA -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            Infrastructure

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Service',
              'Status',
              'Latence',
              'Region',

            ],

            rows:[

              [

                'API',
                'ONLINE',
                '82ms',
                'EU-West',

              ],

              [

                'Monitoring',
                'ONLINE',
                '121ms',
                'EU-West',

              ],

              [

                'Stripe',
                'ONLINE',
                '64ms',
                'Global',

              ],

            ],

          })}

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   SETTINGS ROUTER PATCH
========================================================= */

const previousSettingsPage =
  renderSettings;

renderSettings = function(){

  return renderAdvancedSettings()
    || previousSettingsPage();
};
/* =========================================================
   FINAL REPORTS ENGINE
========================================================= */

function renderAdvancedReports(){

  const reports = [

    {

      title:
        'Executive SEO Report',

      client:
        'Enterprise Group',

      type:
        'SEO',

      date:
        '12 Juin',

      status:
        'completed',

    },

    {

      title:
        'Infrastructure Audit',

      client:
        'FlowPoint',

      type:
        'Monitoring',

      date:
        '11 Juin',

      status:
        'processing',

    },

    {

      title:
        'Growth Analytics',

      client:
        'Agency Partner',

      type:
        'Growth',

      date:
        '10 Juin',

      status:
        'completed',

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Executive Reports

              </div>

              <div class="
                fp-sectionText
              ">

                Rapports premium,
                exports PDF,
                analytics,
                dashboards
                et executive summaries.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Templates

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Nouveau report

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Reports générés

          </div>

          <div class="
            fp-kpiValue
          ">

            842

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Exports PDF

          </div>

          <div class="
            fp-kpiValue
          ">

            1.2k

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Clients actifs

          </div>

          <div class="
            fp-kpiValue
          ">

            128

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            AI Summaries

          </div>

          <div class="
            fp-kpiValue
          ">

            642

          </div>

        </div>

      </div>

      <!-- REPORTS -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        ${reports.map(report => `

          <div class="
            fp-card
          ">

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-flex
                fp-alignCenter
                fp-justifyBetween
              ">

                <div class="
                  fp-badge
                  ${
                    report.type === 'SEO'
                      ? 'fp-badgePrimary'
                      : report.type === 'Monitoring'
                        ? 'fp-badgeWarning'
                        : 'fp-badgeSuccess'
                  }
                ">

                  ${report.type}

                </div>

                <div class="
                  fp-badge
                  ${
                    report.status === 'completed'
                      ? 'fp-badgeSuccess'
                      : 'fp-badgeWarning'
                  }
                ">

                  ${report.status}

                </div>

              </div>

              <div class="
                fp-sectionTitle
                fp-mt24
              " style="
                font-size:22px;
              ">

                ${report.title}

              </div>

              <div class="
                fp-sectionText
              ">

                ${report.client}

              </div>

              <div class="
                fp-chartEmpty
                fp-mt24
              ">

                Executive report preview

              </div>

              <div class="
                fp-flex
                fp-alignCenter
                fp-justifyBetween
                fp-mt24
              ">

                <div class="
                  fp-muted
                  fp-textSm
                ">

                  ${report.date}

                </div>

                <div class="
                  fp-flex
                  fp-gap12
                ">

                  <button

                    class="
                      fp-btn
                      fp-btnGhost
                    "

                    data-preview-report="
                      ${report.title}
                    "
                  >

                    Aperçu

                  </button>

                  <button

                    class="
                      fp-btn
                      fp-btnPrimary
                    "

                    data-export-report="
                      ${report.title}
                    "
                  >

                    Export

                  </button>

                </div>

              </div>

            </div>

          </div>

        `).join('')}

      </div>

      <!-- REPORT TABLE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            Executive Report History

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Report',
              'Client',
              'Type',
              'Date',
              'Status',

            ],

            rows:reports.map(report => [

              report.title,
              report.client,
              report.type,
              report.date,
              report.status,

            ]),

          })}

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   REPORT EVENTS
========================================================= */

function bindReportEvents(){

  qsa('[data-preview-report]')
    .forEach(button => {

      button.onclick = () => {

        const report =
          button.dataset
            .previewReport;

        openPdfPreview(
          report
        );
      };
    });

  qsa('[data-export-report]')
    .forEach(button => {

      button.onclick = () => {

        const report =
          button.dataset
            .exportReport;

        toast(
          `${report} exporté`,
          'success'
        );
      };
    });
}

/* =========================================================
   REPORT ROUTER PATCH
========================================================= */

const previousReportsRender =
  renderReports;

renderReports = function(){

  return renderAdvancedReports()
    || previousReportsRender();
};

/* =========================================================
   EVENTS PATCH
========================================================= */

const previousReportsBind =
  bindEvents;

bindEvents = function(){

  previousReportsBind();

  bindReportEvents();
};
/* =========================================================
   FINAL LOCAL SEO ENGINE
========================================================= */

function renderAdvancedLocalSeo(){

  const locations = [

    {

      city:
        'Bruxelles',

      visibility:
        '92%',

      keywords:
        184,

      trend:
        '+18%',

    },

    {

      city:
        'Liège',

      visibility:
        '78%',

      keywords:
        122,

      trend:
        '+8%',

    },

    {

      city:
        'Namur',

      visibility:
        '64%',

      keywords:
        84,

      trend:
        '+4%',

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Local SEO Intelligence

              </div>

              <div class="
                fp-sectionText
              ">

                SEO local,
                visibilité Google,
                géolocalisation,
                concurrence
                et opportunités régionales.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Maps

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Nouvelle analyse

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Keywords locales

          </div>

          <div class="
            fp-kpiValue
          ">

            842

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Villes trackées

          </div>

          <div class="
            fp-kpiValue
          ">

            24

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Visibilité moyenne

          </div>

          <div class="
            fp-kpiValue
          ">

            81%

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Opportunités

          </div>

          <div class="
            fp-kpiValue
          ">

            42

          </div>

        </div>

      </div>

      <!-- LOCAL GRID -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        ${locations.map(location => `

          <div class="
            fp-card
          ">

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-flex
                fp-alignCenter
                fp-justifyBetween
              ">

                <div class="
                  fp-sectionTitle
                ">

                  ${location.city}

                </div>

                <div class="
                  fp-badge
                  fp-badgePrimary
                ">

                  ${location.trend}

                </div>

              </div>

              <div class="
                fp-grid2
                fp-mt24
              ">

                <div class="
                  fp-kpiCard
                ">

                  <div class="
                    fp-kpiLabel
                  ">

                    Visibility

                  </div>

                  <div class="
                    fp-kpiValue
                  ">

                    ${location.visibility}

                  </div>

                </div>

                <div class="
                  fp-kpiCard
                ">

                  <div class="
                    fp-kpiLabel
                  ">

                    Keywords

                  </div>

                  <div class="
                    fp-kpiValue
                  ">

                    ${location.keywords}

                  </div>

                </div>

              </div>

              <div class="
                fp-chartEmpty
                fp-mt24
              ">

                Local SEO heatmap

              </div>

              <div class="
                fp-flex
                fp-gap12
                fp-mt24
              ">

                <button class="
                  fp-btn
                  fp-btnPrimary
                ">

                  Détails

                </button>

                <button class="
                  fp-btn
                  fp-btnGhost
                ">

                  Keywords

                </button>

              </div>

            </div>

          </div>

        `).join('')}

      </div>

      <!-- GEO TABLE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            Regional Performance

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Ville',
              'Visibility',
              'Keywords',
              'Trend',

            ],

            rows:locations.map(location => [

              location.city,
              location.visibility,
              location.keywords,
              location.trend,

            ]),

          })}

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            AI Local Opportunities

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Bruxelles

              </div>

              <div class="
                fp-listText
              ">

                Fort potentiel SEO premium.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Liège

              </div>

              <div class="
                fp-listText
              ">

                Opportunités pages locales.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Namur

              </div>

              <div class="
                fp-listText
              ">

                Faible concurrence détectée.

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   LOCAL SEO PATCH
========================================================= */

const previousLocalSeo =
  renderLocalSeo;

renderLocalSeo = function(){

  return renderAdvancedLocalSeo()
    || previousLocalSeo();
};
/* =========================================================
   FINAL COMPETITORS ENGINE
========================================================= */

function renderAdvancedCompetitors(){

  const competitors = [

    {

      name:
        'SEO Growth Agency',

      traffic:
        '182k',

      authority:
        74,

      keywords:
        18420,

      trend:
        '+12%',

    },

    {

      name:
        'Digital Rank Pro',

      traffic:
        '92k',

      authority:
        61,

      keywords:
        9240,

      trend:
        '+4%',

    },

    {

      name:
        'Local Visibility',

      traffic:
        '54k',

      authority:
        48,

      keywords:
        4820,

      trend:
        '-2%',

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Competitor Intelligence

              </div>

              <div class="
                fp-sectionText
              ">

                Analyse concurrence,
                trafic SEO,
                mots-clés,
                backlinks
                et opportunités marché.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Benchmark

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Nouveau concurrent

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Competitors

          </div>

          <div class="
            fp-kpiValue
          ">

            42

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Keywords trackés

          </div>

          <div class="
            fp-kpiValue
          ">

            84k

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Backlinks

          </div>

          <div class="
            fp-kpiValue
          ">

            182k

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Opportunités

          </div>

          <div class="
            fp-kpiValue
          ">

            28

          </div>

        </div>

      </div>

      <!-- COMPETITOR GRID -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        ${competitors.map(competitor => `

          <div class="
            fp-card
          ">

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-flex
                fp-alignCenter
                fp-justifyBetween
              ">

                <div class="
                  fp-sectionTitle
                " style="
                  font-size:22px;
                ">

                  ${competitor.name}

                </div>

                <div class="
                  fp-badge
                  ${
                    competitor.trend.startsWith('-')
                      ? 'fp-badgeDanger'
                      : 'fp-badgeSuccess'
                  }
                ">

                  ${competitor.trend}

                </div>

              </div>

              <div class="
                fp-grid2
                fp-mt24
              ">

                <div class="
                  fp-kpiCard
                ">

                  <div class="
                    fp-kpiLabel
                  ">

                    Traffic

                  </div>

                  <div class="
                    fp-kpiValue
                  ">

                    ${competitor.traffic}

                  </div>

                </div>

                <div class="
                  fp-kpiCard
                ">

                  <div class="
                    fp-kpiLabel
                  ">

                    Authority

                  </div>

                  <div class="
                    fp-kpiValue
                  ">

                    ${competitor.authority}

                  </div>

                </div>

              </div>

              <div class="
                fp-chartEmpty
                fp-mt24
              ">

                SEO competitor analytics

              </div>

              <div class="
                fp-flex
                fp-alignCenter
                fp-justifyBetween
                fp-mt24
              ">

                <div class="
                  fp-muted
                  fp-textSm
                ">

                  ${competitor.keywords}
                  keywords

                </div>

                <div class="
                  fp-flex
                  fp-gap12
                ">

                  <button class="
                    fp-btn
                    fp-btnGhost
                  ">

                    Keywords

                  </button>

                  <button class="
                    fp-btn
                    fp-btnPrimary
                  ">

                    Détails

                  </button>

                </div>

              </div>

            </div>

          </div>

        `).join('')}

      </div>

      <!-- TABLE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            Competitive Benchmark

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Concurrent',
              'Traffic',
              'Authority',
              'Keywords',
              'Trend',

            ],

            rows:competitors.map(competitor => [

              competitor.name,
              competitor.traffic,
              competitor.authority,
              competitor.keywords,
              competitor.trend,

            ]),

          })}

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            AI Competitive Insights

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Keyword Gap

              </div>

              <div class="
                fp-listText
              ">

                Plusieurs mots-clés premium manquants.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Backlink Opportunity

              </div>

              <div class="
                fp-listText
              ">

                Opportunités backlinks détectées.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Content Expansion

              </div>

              <div class="
                fp-listText
              ">

                Expansion SEO locale recommandée.

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   COMPETITOR PATCH
========================================================= */

const previousCompetitors =
  renderCompetitors;

renderCompetitors = function(){

  return renderAdvancedCompetitors()
    || previousCompetitors();
};
/* =========================================================
   FINAL ALERT CENTER ENGINE
========================================================= */

function renderAdvancedAlerts(){

  const alerts = [

    {

      title:
        'Infrastructure latency detected',

      type:
        'danger',

      service:
        'Monitoring Cluster',

      time:
        '2 min',

    },

    {

      title:
        'SEO visibility increase',

      type:
        'success',

      service:
        'Local SEO',

      time:
        '12 min',

    },

    {

      title:
        'Stripe webhook delayed',

      type:
        'warning',

      service:
        'Billing',

      time:
        '28 min',

    },

    {

      title:
        'Executive report generated',

      type:
        'primary',

      service:
        'Reports',

      time:
        '1 h',

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientDanger
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Alert Center

              </div>

              <div class="
                fp-sectionText
              ">

                Incidents,
                monitoring,
                sécurité,
                automatisations
                et alertes temps réel.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Historique

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Nouvelle règle

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Alertes actives

          </div>

          <div class="
            fp-kpiValue
          ">

            12

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Critiques

          </div>

          <div class="
            fp-kpiValue
          ">

            2

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Résolues

          </div>

          <div class="
            fp-kpiValue
          ">

            182

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Response time

          </div>

          <div class="
            fp-kpiValue
          ">

            4m

          </div>

        </div>

      </div>

      <!-- ALERT LIST -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            Live Alerts

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-list
          ">

            ${alerts.map(alert => `

              <div class="
                fp-alertItem
              ">

                <div class="
                  fp-flex
                  fp-alignCenter
                  fp-gap20
                ">

                  <div class="
                    fp-alertDot
                    ${alert.type}
                  "></div>

                  <div>

                    <div class="
                      fp-listTitle
                    ">

                      ${alert.title}

                    </div>

                    <div class="
                      fp-listText
                    ">

                      ${alert.service}
                      —
                      ${alert.time}

                    </div>

                  </div>

                </div>

                <div class="
                  fp-flex
                  fp-gap12
                ">

                  <button class="
                    fp-btn
                    fp-btnGhost
                  ">

                    Logs

                  </button>

                  <button class="
                    fp-btn
                    fp-btnPrimary
                  ">

                    Résoudre

                  </button>

                </div>

              </div>

            `).join('')}

          </div>

        </div>

      </div>

      <!-- TIMELINE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            Incident Timeline

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-timeline
          ">

            ${alerts.map(alert => `

              <div class="
                fp-timelineItem
              ">

                <div class="
                  fp-timelineDot
                  ${alert.type}
                "></div>

                <div class="
                  fp-timelineCard
                ">

                  <div class="
                    fp-timelineTitle
                  ">

                    ${alert.title}

                  </div>

                  <div class="
                    fp-timelineText
                  ">

                    ${alert.service}

                  </div>

                  <div class="
                    fp-timelineTime
                  ">

                    ${alert.time}

                  </div>

                </div>

              </div>

            `).join('')}

          </div>

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            AI Incident Analysis

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Monitoring overload

              </div>

              <div class="
                fp-listText
              ">

                Cluster surcharge détectée.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Stripe latency

              </div>

              <div class="
                fp-listText
              ">

                Webhooks plus lents que normal.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                SEO opportunity

              </div>

              <div class="
                fp-listText
              ">

                Croissance locale détectée.

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   ALERT PATCH
========================================================= */

const previousAlerts =
  renderAlerts;

renderAlerts = function(){

  return renderAdvancedAlerts()
    || previousAlerts();
};
/* =========================================================
   FINAL MISSIONS ENGINE
========================================================= */

function renderAdvancedMissions(){

  const missions = [

    {

      title:
        'Créer pages SEO locales Bruxelles',

      progress:
        72,

      priority:
        'high',

      category:
        'SEO',

    },

    {

      title:
        'Optimiser monitoring infrastructure',

      progress:
        48,

      priority:
        'critical',

      category:
        'Monitoring',

    },

    {

      title:
        'Améliorer onboarding conversion',

      progress:
        82,

      priority:
        'medium',

      category:
        'Growth',

    },

    {

      title:
        'Générer executive reports premium',

      progress:
        94,

      priority:
        'low',

      category:
        'Reports',

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientSuccess
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Mission Control

              </div>

              <div class="
                fp-sectionText
              ">

                Missions,
                workflows,
                objectifs,
                quick wins
                et stratégies IA.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Templates

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Nouvelle mission

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Missions actives

          </div>

          <div class="
            fp-kpiValue
          ">

            48

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Terminées

          </div>

          <div class="
            fp-kpiValue
          ">

            182

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Priorité critique

          </div>

          <div class="
            fp-kpiValue
          ">

            4

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Progression globale

          </div>

          <div class="
            fp-kpiValue
          ">

            78%

          </div>

        </div>

      </div>

      <!-- MISSIONS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        ${missions.map(mission => `

          <div class="
            fp-card
          ">

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-flex
                fp-alignCenter
                fp-justifyBetween
              ">

                <div class="
                  fp-badge
                  ${
                    mission.priority === 'critical'
                      ? 'fp-badgeDanger'
                      : mission.priority === 'high'
                        ? 'fp-badgeWarning'
                        : mission.priority === 'medium'
                          ? 'fp-badgePrimary'
                          : 'fp-badgeSuccess'
                  }
                ">

                  ${mission.priority}

                </div>

                <div class="
                  fp-badge
                  fp-badgePrimary
                ">

                  ${mission.category}

                </div>

              </div>

              <div class="
                fp-sectionTitle
                fp-mt24
              " style="
                font-size:22px;
              ">

                ${mission.title}

              </div>

              <div class="
                fp-progress
                fp-mt24
              ">

                <div

                  class="
                    fp-progressBar
                  "

                  style="
                    width:${mission.progress}%;
                  "
                ></div>

              </div>

              <div class="
                fp-flex
                fp-alignCenter
                fp-justifyBetween
                fp-mt20
              ">

                <div class="
                  fp-muted
                  fp-textSm
                ">

                  ${mission.progress}%
                  terminé

                </div>

                <div class="
                  fp-flex
                  fp-gap12
                ">

                  <button class="
                    fp-btn
                    fp-btnGhost
                  ">

                    Modifier

                  </button>

                  <button class="
                    fp-btn
                    fp-btnPrimary
                  ">

                    Ouvrir

                  </button>

                </div>

              </div>

            </div>

          </div>

        `).join('')}

      </div>

      <!-- TABLE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            Mission Tracking

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Mission',
              'Catégorie',
              'Priorité',
              'Progression',

            ],

            rows:missions.map(mission => [

              mission.title,
              mission.category,
              mission.priority,
              `${mission.progress}%`,

            ]),

          })}

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            AI Mission Suggestions

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                SEO Expansion

              </div>

              <div class="
                fp-listText
              ">

                Créer davantage de pages locales.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Infrastructure Scaling

              </div>

              <div class="
                fp-listText
              ">

                Prévoir nouveau cluster monitoring.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Conversion Funnel

              </div>

              <div class="
                fp-listText
              ">

                Optimiser onboarding premium.

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   MISSIONS PATCH
========================================================= */

const previousMissions =
  renderMissions;

renderMissions = function(){

  return renderAdvancedMissions()
    || previousMissions();
};
/* =========================================================
   FINAL TEAM COLLABORATION ENGINE
========================================================= */

function renderAdvancedTeam(){

  const members = [

    {

      name:
        'Alex Martin',

      role:
        'CEO',

      status:
        'online',

      tasks:
        12,

    },

    {

      name:
        'Sarah Klein',

      role:
        'Infrastructure Lead',

      status:
        'online',

      tasks:
        8,

    },

    {

      name:
        'Lucas Bernard',

      role:
        'Growth Manager',

      status:
        'away',

      tasks:
        14,

    },

    {

      name:
        'Emma Laurent',

      role:
        'SEO Strategist',

      status:
        'online',

      tasks:
        9,

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Team Collaboration

              </div>

              <div class="
                fp-sectionText
              ">

                Équipe,
                collaboration,
                discussions,
                tâches
                et workspace partagé.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Inviter

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Nouveau canal

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Membres

          </div>

          <div class="
            fp-kpiValue
          ">

            24

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Canaux

          </div>

          <div class="
            fp-kpiValue
          ">

            12

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Tâches actives

          </div>

          <div class="
            fp-kpiValue
          ">

            84

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Productivité

          </div>

          <div class="
            fp-kpiValue
          ">

            92%

          </div>

        </div>

      </div>

      <!-- TEAM GRID -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- MEMBERS -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            <div class="
              fp-cardTitle
            ">

              Team Members

            </div>

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-list
            ">

              ${members.map(member => `

                <div class="
                  fp-listItem
                ">

                  <div class="
                    fp-flex
                    fp-alignCenter
                    fp-gap20
                  ">

                    <div class="
                      fp-userMiniAvatar
                    ">

                      ${
                        member.name
                          .slice(0,1)
                          .toUpperCase()
                      }

                    </div>

                    <div>

                      <div class="
                        fp-listTitle
                      ">

                        ${member.name}

                      </div>

                      <div class="
                        fp-listText
                      ">

                        ${member.role}

                      </div>

                    </div>

                  </div>

                  <div class="
                    fp-flex
                    fp-alignCenter
                    fp-gap12
                  ">

                    <div class="
                      fp-badge
                      ${
                        member.status === 'online'
                          ? 'fp-badgeSuccess'
                          : 'fp-badgeWarning'
                      }
                    ">

                      ${member.status}

                    </div>

                    <div class="
                      fp-muted
                    ">

                      ${member.tasks}
                      tâches

                    </div>

                  </div>

                </div>

              `).join('')}

            </div>

          </div>

        </div>

        <!-- CHAT -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            <div class="
              fp-cardTitle
            ">

              Team Chat

            </div>

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-chatBox
            ">

              <div class="
                fp-chatMessage
              ">

                <div class="
                  fp-chatAuthor
                ">

                  Alex

                </div>

                <div class="
                  fp-chatText
                ">

                  Le nouveau report enterprise est prêt.

                </div>

              </div>

              <div class="
                fp-chatMessage
              ">

                <div class="
                  fp-chatAuthor
                ">

                  Sarah

                </div>

                <div class="
                  fp-chatText
                ">

                  Monitoring cluster stabilisé.

                </div>

              </div>

              <div class="
                fp-chatMessage
              ">

                <div class="
                  fp-chatAuthor
                ">

                  Emma

                </div>

                <div class="
                  fp-chatText
                ">

                  Opportunité SEO Bruxelles détectée.

                </div>

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
              fp-mt24
            ">

              <input
                class="
                  fp-input
                "
                placeholder="
                  Envoyer un message...
                "
              />

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Envoyer

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- TASK BOARD -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
            ">

            Team Tasks

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Tâche',
              'Assigné',
              'Priorité',
              'Status',

            ],

            rows:[

              [

                'SEO local Bruxelles',
                'Emma',
                'High',
                'In Progress',

              ],

              [

                'Infrastructure scaling',
                'Sarah',
                'Critical',
                'Pending',

              ],

              [

                'Growth funnel',
                'Lucas',
                'Medium',
                'Completed',

              ],

            ],

          })}

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   TEAM PATCH
========================================================= */

const previousTeam =
  renderTeam;

renderTeam = function(){

  return renderAdvancedTeam()
    || previousTeam();
};
/* =========================================================
   FINAL ANALYTICS ENGINE
========================================================= */

function renderAdvancedAnalytics(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Executive Analytics

              </div>

              <div class="
                fp-sectionText
              ">

                Données business,
                croissance,
                infrastructure,
                SEO
                et intelligence IA.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Export CSV

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Générer report

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${renderAnalyticsWidget({

          title:
            'Revenue',

          value:
            '€48k',

          trend:
            '+22%',

          values:[

            12,
            20,
            28,
            40,
            48,
            60,
            78,

          ],

        })}

        ${renderAnalyticsWidget({

          title:
            'Traffic',

          value:
            '182k',

          trend:
            '+18%',

          values:[

            20,
            26,
            40,
            54,
            66,
            74,
            92,

          ],

        })}

        ${renderAnalyticsWidget({

          title:
            'Conversion',

          value:
            '4.8%',

          trend:
            '+6%',

          values:[

            8,
            12,
            18,
            20,
            28,
            34,
            40,

          ],

        })}

        ${renderAnalyticsWidget({

          title:
            'Retention',

          value:
            '92%',

          trend:
            '+4%',

          values:[

            42,
            48,
            58,
            64,
            74,
            82,
            92,

          ],

        })}

      </div>

      <!-- CHARTS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            <div class="
              fp-cardTitle
            ">

              Revenue Growth

            </div>

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              height:260,

              values:[

                20,
                32,
                48,
                54,
                72,
                88,
                110,

              ],

            })}

          </div>

        </div>

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            <div class="
              fp-cardTitle
            ">

              SEO Visibility

            </div>

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              height:260,

              values:[

                10,
                18,
                30,
                44,
                58,
                74,
                96,

              ],

            })}

          </div>

        </div>

      </div>

      <!-- ANALYTICS TABLE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            Executive Metrics

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Metric',
              'Current',
              'Previous',
              'Trend',

            ],

            rows:[

              [

                'Revenue',
                '48k€',
                '39k€',
                '+22%',

              ],

              [

                'SEO Traffic',
                '182k',
                '154k',
                '+18%',

              ],

              [

                'Conversion',
                '4.8%',
                '4.2%',
                '+6%',

              ],

              [

                'Retention',
                '92%',
                '88%',
                '+4%',

              ],

            ],

          })}

        </div>

      </div>

      <!-- AI INSIGHTS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

            <div class="
              fp-cardTitle
            ">

              AI Analytics Insights

            </div>

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Revenue acceleration

              </div>

              <div class="
                fp-listText
              ">

                Croissance MRR supérieure à la moyenne.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                SEO expansion

              </div>

              <div class="
                fp-listText
              ">

                Forte croissance locale détectée.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Client retention

              </div>

              <div class="
                fp-listText
              ">

                Excellente stabilité abonnements.

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   ANALYTICS PATCH
========================================================= */

const previousAnalytics =
  renderAnalytics;

renderAnalytics = function(){

  return renderAdvancedAnalytics()
    || previousAnalytics();
};
/* =========================================================
   FINAL MONITORING ENGINE
========================================================= */

function renderAdvancedMonitoring(){

  const monitors = [

    {

      name:
        'flowpoint.pro',

      uptime:
        '99.99%',

      latency:
        '82ms',

      status:
        'online',

      incidents:
        0,

    },

    {

      name:
        'api.flowpoint.pro',

      uptime:
        '99.92%',

      latency:
        '128ms',

      status:
        'warning',

      incidents:
        2,

    },

    {

      name:
        'billing.flowpoint.pro',

      uptime:
        '100%',

      latency:
        '64ms',

      status:
        'online',

      incidents:
        0,

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientSuccess
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Infrastructure Monitoring

              </div>

              <div class="
                fp-sectionText
              ">

                Uptime,
                incidents,
                latence,
                clusters
                et surveillance temps réel.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Historique

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Nouveau monitor

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Monitors actifs

          </div>

          <div class="
            fp-kpiValue
          ">

            84

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Uptime moyen

          </div>

          <div class="
            fp-kpiValue
          ">

            99.97%

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Incidents

          </div>

          <div class="
            fp-kpiValue
          ">

            2

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Latence moyenne

          </div>

          <div class="
            fp-kpiValue
          ">

            84ms

          </div>

        </div>

      </div>

      <!-- MONITOR GRID -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        ${monitors.map(monitor => `

          <div class="
            fp-card
          ">

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-flex
                fp-alignCenter
                fp-justifyBetween
              ">

                <div class="
                  fp-sectionTitle
                " style="
                  font-size:22px;
                ">

                  ${monitor.name}

                </div>

                <div class="
                  fp-dot
                  ${monitor.status}
                "></div>

              </div>

              <div class="
                fp-grid2
                fp-mt24
              ">

                <div class="
                  fp-kpiCard
                ">

                  <div class="
                    fp-kpiLabel
                  ">

                    Uptime

                  </div>

                  <div class="
                    fp-kpiValue
                  ">

                    ${monitor.uptime}

                  </div>

                </div>

                <div class="
                  fp-kpiCard
                ">

                  <div class="
                    fp-kpiLabel
                  ">

                    Latency

                  </div>

                  <div class="
                    fp-kpiValue
                  ">

                    ${monitor.latency}

                  </div>

                </div>

              </div>

              <div class="
                fp-chartEmpty
                fp-mt24
              ">

                Live infrastructure graph

              </div>

              <div class="
                fp-flex
                fp-alignCenter
                fp-justifyBetween
                fp-mt24
              ">

                <div class="
                  fp-muted
                  fp-textSm
                ">

                  ${monitor.incidents}
                  incidents

                </div>

                <div class="
                  fp-flex
                  fp-gap12
                ">

                  <button class="
                    fp-btn
                    fp-btnGhost
                  ">

                    Logs

                  </button>

                  <button class="
                    fp-btn
                    fp-btnPrimary
                  ">

                    Détails

                  </button>

                </div>

              </div>

            </div>

          </div>

        `).join('')}

      </div>

      <!-- INCIDENT TABLE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            Infrastructure Status

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Service',
              'Uptime',
              'Latency',
              'Incidents',
              'Status',

            ],

            rows:monitors.map(monitor => [

              monitor.name,
              monitor.uptime,
              monitor.latency,
              monitor.incidents,
              monitor.status,

            ]),

          })}

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            AI Monitoring Insights

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                API overload

              </div>

              <div class="
                fp-listText
              ">

                Pics de trafic détectés.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Latency optimization

              </div>

              <div class="
                fp-listText
              ">

                Cache infrastructure recommandé.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Cluster stability

              </div>

              <div class="
                fp-listText
              ">

                Infrastructure globalement stable.

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   MONITOR PATCH
========================================================= */

const previousMonitoring =
  renderMonitoring;

renderMonitoring = function(){

  return renderAdvancedMonitoring()
    || previousMonitoring();
};
/* =========================================================
   FINAL SEO AUDIT ENGINE
========================================================= */

function renderAdvancedAudits(){

  const audits = [

    {

      site:
        'flowpoint.pro',

      seo:
        92,

      performance:
        88,

      accessibility:
        94,

      issues:
        4,

    },

    {

      site:
        'client-enterprise.com',

      seo:
        78,

      performance:
        72,

      accessibility:
        81,

      issues:
        12,

    },

    {

      site:
        'local-business.be',

      seo:
        64,

      performance:
        69,

      accessibility:
        74,

      issues:
        18,

    },

  ];

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                SEO Audit Engine

              </div>

              <div class="
                fp-sectionText
              ">

                Audits SEO,
                performance,
                accessibilité,
                structure
                et optimisation IA.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Historique

              </button>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Nouveau scan

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Audits générés

          </div>

          <div class="
            fp-kpiValue
          ">

            4.2k

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Score SEO moyen

          </div>

          <div class="
            fp-kpiValue
          ">

            82

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Issues détectées

          </div>

          <div class="
            fp-kpiValue
          ">

            182

          </div>

        </div>

        <div class="
          fp-kpiCard
        ">

          <div class="
            fp-kpiLabel
          ">

            Quick wins

          </div>

          <div class="
            fp-kpiValue
          ">

            64

          </div>

        </div>

      </div>

      <!-- AUDITS -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        ${audits.map(audit => `

          <div class="
            fp-card
          ">

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-sectionTitle
              " style="
                font-size:22px;
              ">

                ${audit.site}

              </div>

              <div class="
                fp-grid2
                fp-mt24
              ">

                <div class="
                  fp-kpiCard
                ">

                  <div class="
                    fp-kpiLabel
                  ">

                    SEO

                  </div>

                  <div class="
                    fp-kpiValue
                  ">

                    ${audit.seo}

                  </div>

                </div>

                <div class="
                  fp-kpiCard
                ">

                  <div class="
                    fp-kpiLabel
                  ">

                    Performance

                  </div>

                  <div class="
                    fp-kpiValue
                  ">

                    ${audit.performance}

                  </div>

                </div>

              </div>

              <div class="
                fp-progress
                fp-mt24
              ">

                <div

                  class="
                    fp-progressBar
                  "

                  style="
                    width:${audit.seo}%;
                  "
                ></div>

              </div>

              <div class="
                fp-flex
                fp-alignCenter
                fp-justifyBetween
                fp-mt20
              ">

                <div class="
                  fp-muted
                  fp-textSm
                ">

                  ${audit.issues}
                  problèmes détectés

                </div>

                <button class="
                  fp-btn
                  fp-btnPrimary
                ">

                  Ouvrir audit

                </button>

              </div>

            </div>

          </div>

        `).join('')}

      </div>

      <!-- TABLE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            SEO Audit History

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Site',
              'SEO',
              'Performance',
              'Accessibility',
              'Issues',

            ],

            rows:audits.map(audit => [

              audit.site,
              audit.seo,
              audit.performance,
              audit.accessibility,
              audit.issues,

            ]),

          })}

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            AI SEO Recommendations

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Meta optimization

              </div>

              <div class="
                fp-listText
              ">

                Plusieurs titles trop faibles.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Performance gain

              </div>

              <div class="
                fp-listText
              ">

                Compression images recommandée.

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div class="
                fp-listTitle
              ">

                Local SEO boost

              </div>

              <div class="
                fp-listText
              ">

                Expansion géographique suggérée.

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   AUDIT PATCH
========================================================= */

const previousAudits =
  renderAudits;

renderAudits = function(){

  return renderAdvancedAudits()
    || previousAudits();
};
/* =========================================================
   FINAL AI COMMAND CENTER
========================================================= */

const aiState = {

  history:[],

  suggestions:[],

};

/* =========================================================
   AI MESSAGE
========================================================= */

function pushAiMessage({

  role='assistant',

  text='',

}){

  aiState.history.push({

    id:
      Date.now(),

    role,

    text,

    createdAt:
      new Date(),

  });

  if(aiState.history.length > 60){

    aiState.history.shift();
  }
}

/* =========================================================
   AI GENERATOR
========================================================= */

function generateAiResponse(input=''){

  const lower =
    input.toLowerCase();

  if(

    lower.includes('seo')

  ){

    return `

      Analyse SEO détectée.

      Plusieurs quick wins :
      optimisation titles,
      pages locales
      et maillage interne.

    `;
  }

  if(

    lower.includes('monitor')

  ){

    return `

      Infrastructure stable.

      Recommandation :
      ajouter cache edge
      et scaling API.

    `;
  }

  if(

    lower.includes('conversion')

  ){

    return `

      Tunnel de conversion améliorable.

      Recommandation :
      CTA plus visibles
      et onboarding simplifié.

    `;
  }

  return `

    Analyse exécutive générée.

    FlowPoint IA recommande
    optimisation SEO,
    amélioration infrastructure
    et expansion locale.

  `;
}

/* =========================================================
   AI PAGE
========================================================= */

function renderAiCenter(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                FlowPoint AI

              </div>

              <div class="
                fp-sectionText
              ">

                Assistant IA,
                executive insights,
                SEO,
                infrastructure
                et stratégie business.

              </div>

            </div>

            <div class="
              fp-badge
              fp-badgeSuccess
            ">

              AI ONLINE

            </div>

          </div>

        </div>

      </div>

      <!-- GRID -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        <!-- CHAT -->

        <div class="
          fp-card
        " style="
          grid-column:span 2;
        ">

          <div class="
            fp-cardHeader
          ">

            <div class="
              fp-cardTitle
            ">

              AI Executive Chat

            </div>

          </div>

          <div class="
            fp-cardBody
          ">

            <div

              id="
                fpAiMessages
              "

              class="
                fp-aiMessages
              "
            >

              ${
                aiState.history.length

                ?

                aiState.history.map(message => `

                  <div class="
                    fp-aiMessage
                    ${message.role}
                  ">

                    <div class="
                      fp-aiBubble
                    ">

                      ${message.text}

                    </div>

                  </div>

                `).join('')

                :

                `

                  <div class="
                    fp-emptyState
                  ">

                    <div class="
                      fp-emptyIcon
                    ">
                      🤖
                    </div>

                    <div class="
                      fp-emptyTitle
                    ">

                      FlowPoint AI prêt

                    </div>

                    <div class="
                      fp-emptyText
                    ">

                      Pose une question SEO,
                      monitoring,
                      business
                      ou infrastructure.

                    </div>

                  </div>

                `
              }

            </div>

            <div class="
              fp-flex
              fp-gap12
              fp-mt24
            ">

              <input

                id="
                  fpAiInput
                "

                class="
                  fp-input
                "

                placeholder="
                  Demander une analyse...
                "
              />

              <button

                id="
                  fpSendAi
                "

                class="
                  fp-btn
                  fp-btnPrimary
                "
              >

                Envoyer

              </button>

            </div>

          </div>

        </div>

        <!-- INSIGHTS -->

        <div class="
          fp-flex
          fp-flexCol
          fp-gap20
        ">

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              AI Insights

            </div>

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-list
              ">

                <div class="
                  fp-listItem
                ">

                  <div>

                    <div class="
                      fp-listTitle
                    ">

                      SEO Growth

                    </div>

                    <div class="
                      fp-listText
                    ">

                      Opportunités locales détectées.

                    </div>

                  </div>

                </div>

                <div class="
                  fp-listItem
                ">

                  <div>

                    <div class="
                      fp-listTitle
                    ">

                      Infrastructure

                    </div>

                    <div class="
                      fp-listText
                    ">

                      API stable actuellement.

                    </div>

                  </div>

                </div>

              </div>

            </div>

          </div>

          <div class="
            fp-card
          ">

            <div class="
              fp-cardHeader
            ">

              AI Suggestions

            </div>

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-flex
                fp-flexCol
                fp-gap12
              ">

                <button

                  class="
                    fp-btn
                    fp-btnGhost
                    fp-wFull
                  "

                  data-ai-prompt="
                    Analyse SEO complète
                  "
                >

                  Analyse SEO complète

                </button>

                <button

                  class="
                    fp-btn
                    fp-btnGhost
                    fp-wFull
                  "

                  data-ai-prompt="
                    Vérifie infrastructure
                  "
                >

                  Vérifie infrastructure

                </button>

                <button

                  class="
                    fp-btn
                    fp-btnGhost
                    fp-wFull
                  "

                  data-ai-prompt="
                    Optimise conversions
                  "
                >

                  Optimise conversions

                </button>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   AI EVENTS
========================================================= */

function bindAiEvents(){

  const input =
    qs('#fpAiInput');

  const button =
    qs('#fpSendAi');

  if(input && button){

    const send = () => {

      const value =
        input.value.trim();

      if(!value){
        return;
      }

      pushAiMessage({

        role:'user',

        text:value,

      });

      render();

      setTimeout(() => {

        pushAiMessage({

          role:'assistant',

          text:
            generateAiResponse(
              value
            ),

        });

        render();

      }, 700);

      input.value = '';
    };

    button.onclick =
      send;

    input.onkeydown = event => {

      if(event.key === 'Enter'){

        send();
      }
    };
  }

  qsa('[data-ai-prompt]')
    .forEach(button => {

      button.onclick = () => {

        const prompt =
          button.dataset
            .aiPrompt;

        pushAiMessage({

          role:'user',

          text:prompt,

        });

        pushAiMessage({

          role:'assistant',

          text:
            generateAiResponse(
              prompt
            ),

        });

        render();
      };
    });
}

/* =========================================================
   ROUTE
========================================================= */

routes.push({

  key:'ai',

  label:'AI',

  icon:'🤖',

});

/* =========================================================
   ROUTER PATCH
========================================================= */

const previousAiRouter =
  renderPage;

renderPage = function(){

  if(

    state.route
    === 'ai'

  ){

    return renderAiCenter();
  }

  return previousAiRouter();
};

/* =========================================================
   EVENTS PATCH
========================================================= */

const previousAiBind =
  bindEvents;

bindEvents = function(){

  previousAiBind();

  bindAiEvents();
};
/* =========================================================
   FINAL UI COMPONENTS PACK
========================================================= */

/* =========================================================
   STAT CARD
========================================================= */

function createStatCard({

  title='Stat',

  value='0',

  trend='+0%',

  icon='📊',

} = {}){

  return `

    <div class="
      fp-statCard
    ">

      <div class="
        fp-flex
        fp-alignCenter
        fp-justifyBetween
      ">

        <div class="
          fp-statIcon
        ">

          ${icon}

        </div>

        <div class="
          fp-badge
          ${
            trend.startsWith('-')
              ? 'fp-badgeDanger'
              : 'fp-badgeSuccess'
          }
        ">

          ${trend}

        </div>

      </div>

      <div class="
        fp-statValue
      ">

        ${value}

      </div>

      <div class="
        fp-statTitle
      ">

        ${title}

      </div>

    </div>

  `;
}

/* =========================================================
   EMPTY STATE
========================================================= */

function createEmptyState({

  icon='📭',

  title='Aucun contenu',

  text='Aucune donnée disponible.',

  button='',

} = {}){

  return `

    <div class="
      fp-emptyState
    ">

      <div class="
        fp-emptyIcon
      ">

        ${icon}

      </div>

      <div class="
        fp-emptyTitle
      ">

        ${title}

      </div>

      <div class="
        fp-emptyText
      ">

        ${text}

      </div>

      ${
        button
          ? `
            <button class="
              fp-btn
              fp-btnPrimary
              fp-mt24
            ">
              ${button}
            </button>
          `
          : ''
      }

    </div>

  `;
}

/* =========================================================
   SECTION HEADER
========================================================= */

function createSectionHeader({

  title='Section',

  text='',

  action='',

} = {}){

  return `

    <div class="
      fp-sectionHeader
    ">

      <div>

        <div class="
          fp-sectionTitle
        ">

          ${title}

        </div>

        ${
          text
            ? `
              <div class="
                fp-sectionText
              ">
                ${text}
              </div>
            `
            : ''
        }

      </div>

      ${
        action
          ? `
            <div>
              ${action}
            </div>
          `
          : ''
      }

    </div>

  `;
}

/* =========================================================
   SKELETONS
========================================================= */

function createSkeleton({

  height=120,

} = {}){

  return `

    <div

      class="
        fp-skeleton
      "

      style="
        height:${height}px;
      "
    ></div>

  `;
}

/* =========================================================
   ADVANCED FILTER BAR
========================================================= */

function createFilterBar({

  filters=[],

} = {}){

  return `

    <div class="
      fp-filterBar
    ">

      ${filters.map(filter => `

        <button class="
          fp-filterChip
        ">

          ${filter}

        </button>

      `).join('')}

    </div>

  `;
}

/* =========================================================
   ADVANCED DROPDOWN
========================================================= */

function createDropdown({

  id='dropdown',

  items=[],

} = {}){

  return `

    <div class="
      fp-dropdown
    ">

      <button

        class="
          fp-btn
          fp-btnGhost
        "

        data-dropdown-trigger="
          ${id}
        "
      >

        Options

      </button>

      <div

        class="
          fp-dropdownMenu
        "

        id="
          ${id}
        "
      >

        ${items.map(item => `

          <button class="
            fp-dropdownItem
          ">

            ${item}

          </button>

        `).join('')}

      </div>

    </div>

  `;
}

/* =========================================================
   DROPDOWN EVENTS
========================================================= */

function bindDropdowns(){

  qsa('[data-dropdown-trigger]')
    .forEach(button => {

      button.onclick = event => {

        event.stopPropagation();

        const id =
          button.dataset
            .dropdownTrigger;

        const menu =
          qs('#' + id);

        if(menu){

          menu.classList.toggle(
            'open'
          );
        }
      };
    });

  document.addEventListener(

    'click',

    () => {

      qsa('.fp-dropdownMenu')
        .forEach(menu => {

          menu.classList.remove(
            'open'
          );
        });
    }
  );
}

/* =========================================================
   ADVANCED TABS
========================================================= */

function createTabs({

  tabs=[],

  active='',

} = {}){

  return `

    <div class="
      fp-tabs
    ">

      ${tabs.map(tab => `

        <button

          class="
            fp-tab
            ${
              tab === active
                ? 'active'
                : ''
            }
          "
        >

          ${tab}

        </button>

      `).join('')}

    </div>

  `;
}

/* =========================================================
   ADVANCED LOADER
========================================================= */

function renderAdvancedLoader(){

  return `

    <div class="
      fp-advancedLoader
    ">

      <div class="
        fp-loaderRing
      "></div>

      <div class="
        fp-loaderText
      ">

        Chargement FlowPoint...

      </div>

    </div>

  `;
}

/* =========================================================
   ADVANCED SEARCH BAR
========================================================= */

function createSearchBar({

  placeholder='Recherche...',

} = {}){

  return `

    <div class="
      fp-searchBar
    ">

      <span class="
        fp-searchIcon
      ">
        🔎
      </span>

      <input

        class="
          fp-searchInput
        "

        placeholder="
          ${placeholder}
        "
      />

    </div>

  `;
}

/* =========================================================
   GLOBAL COMPONENT INIT
========================================================= */

const previousComponentBind =
  bindEvents;

bindEvents = function(){

  previousComponentBind();

  bindDropdowns();
};

/* =========================================================
   COMPONENTS READY
========================================================= */

console.log(
  'FlowPoint UI Components Loaded'
);
/* =========================================================
   FINAL POLISH & UX ENGINE
========================================================= */

/* =========================================================
   PAGE TRANSITIONS
========================================================= */

function animatePageTransition(){

  const page =
    qs('.fp-page');

  if(!page){
    return;
  }

  page.animate(

    [

      {

        opacity:0,

        transform:
          'translateY(10px)',

      },

      {

        opacity:1,

        transform:
          'translateY(0)',

      },

    ],

    {

      duration:260,

      easing:'ease',

    }

  );
}

/* =========================================================
   RENDER PATCH
========================================================= */

const previousRenderEngine =
  render;

render = function(){

  previousRenderEngine();

  requestAnimationFrame(() => {

    animatePageTransition();
  });
};

/* =========================================================
   SMART PAGE TITLES
========================================================= */

function updateDocumentTitle(){

  const current =
    routes.find(

      route =>

        route.key
        ===
        state.route

    );

  document.title = current

    ? `FlowPoint — ${current.label}`

    : 'FlowPoint';
}

/* =========================================================
   ROUTE PATCH
========================================================= */

const previousSetRoute =
  setRoute;

setRoute = function(route){

  previousSetRoute(route);

  updateDocumentTitle();

  window.scrollTo({

    top:0,

    behavior:'smooth',

  });
};

/* =========================================================
   SMART SHORTCUTS
========================================================= */

window.addEventListener(

  'keydown',

  event => {

    /* OVERVIEW */

    if(

      event.altKey
      &&
      event.key === '1'

    ){

      setRoute(
        'overview'
      );
    }

    /* ANALYTICS */

    if(

      event.altKey
      &&
      event.key === '2'

    ){

      setRoute(
        'analytics'
      );
    }

    /* MONITORS */

    if(

      event.altKey
      &&
      event.key === '3'

    ){

      setRoute(
        'monitors'
      );
    }

    /* AI */

    if(

      event.altKey
      &&
      event.key === '4'

    ){

      setRoute(
        'ai'
      );
    }
  }
);

/* =========================================================
   SMART GREETING
========================================================= */

function getGreeting(){

  const hour =
    new Date()
      .getHours();

  if(hour < 12){

    return 'Bonjour';
  }

  if(hour < 18){

    return 'Bon après-midi';
  }

  return 'Bonsoir';
}

/* =========================================================
   OVERVIEW HERO PATCH
========================================================= */

function renderExecutiveHero(){

  return `

    <div class="
      fp-card
      fp-gradientPrimary
      fp-executiveHero
    ">

      <div class="
        fp-cardBody
      ">

        <div class="
          fp-flex
          fp-alignCenter
          fp-justifyBetween
          fp-gap20
        ">

          <div>

            <div class="
              fp-heroGreeting
            ">

              ${getGreeting()}

            </div>

            <div class="
              fp-heroTitle
            ">

              Bienvenue sur FlowPoint

            </div>

            <div class="
              fp-heroText
            ">

              Infrastructure exécutive,
              SEO,
              analytics
              et intelligence business.

            </div>

          </div>

          <div class="
            fp-heroStats
          ">

            <div class="
              fp-heroStat
            ">

              <div class="
                fp-heroStatValue
              ">

                99.97%

              </div>

              <div class="
                fp-heroStatLabel
              ">

                Uptime

              </div>

            </div>

            <div class="
              fp-heroStat
            ">

              <div class="
                fp-heroStatValue
              ">

                +28%

              </div>

              <div class="
                fp-heroStatLabel
              ">

                SEO Growth

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   OVERVIEW PATCH
========================================================= */

const previousExecutiveOverviewPage =
  renderOverview;

renderOverview = function(){

  return `

    ${renderExecutiveHero()}

    ${previousExecutiveOverviewPage()}

  `;
};

/* =========================================================
   SMART USER STATUS
========================================================= */

function renderUserStatus(){

  return `

    <div class="
      fp-userStatus
    ">

      <div class="
        fp-userStatusDot
      "></div>

      <span>

        Tous les systèmes opérationnels

      </span>

    </div>

  `;
}

/* =========================================================
   TOPBAR PATCH
========================================================= */

const previousFinalTopbar =
  renderTopbar;

renderTopbar = function(){

  const html =
    previousFinalTopbar();

  return html.replace(

    '</div>\n\n    </div>',

    `

      ${renderUserStatus()}

    </div>

    `
  );
};

/* =========================================================
   SMART WELCOME
========================================================= */

function showWelcomeToast(){

  const alreadyShown =
    sessionStorage.getItem(
      'fp_welcome'
    );

  if(alreadyShown){
    return;
  }

  sessionStorage.setItem(
    'fp_welcome',
    '1'
  );

  setTimeout(() => {

    toast(

      'Bienvenue sur FlowPoint Enterprise',

      'success'

    );

  }, 1200);
}

/* =========================================================
   SMART PERFORMANCE OPTIMIZATION
========================================================= */

function optimizeAnimations(){

  if(

    window.matchMedia(

      '(prefers-reduced-motion: reduce)'

    ).matches

  ){

    document.body.classList.add(
      'fp-reduceMotion'
    );
  }
}

/* =========================================================
   FINAL START
========================================================= */

updateDocumentTitle();

optimizeAnimations();

showWelcomeToast();

/* =========================================================
   FLOWPOINT FULLY LOADED
========================================================= */

console.log(`

███████╗██╗      ██████╗ ██╗    ██╗██████╗  ██████╗ ██╗███╗   ██╗████████╗
██╔════╝██║     ██╔═══██╗██║    ██║██╔══██╗██╔═══██╗██║████╗  ██║╚══██╔══╝
█████╗  ██║     ██║   ██║██║ █╗ ██║██████╔╝██║   ██║██║██╔██╗ ██║   ██║
██╔══╝  ██║     ██║   ██║██║███╗██║██╔═══╝ ██║   ██║██║██║╚██╗██║   ██║
██║     ███████╗╚██████╔╝╚███╔███╔╝██║     ╚██████╔╝██║██║ ╚████║   ██║
╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝ ╚═╝      ╚═════╝ ╚═╝╚═╝  ╚═══╝   ╚═╝

ENTERPRISE PLATFORM READY

`);
/* =========================================================
   FINAL CLEANUP & STABILITY PATCH
========================================================= */

/* =========================================================
   SAFE QUERY HELPERS
========================================================= */

function qs(selector){

  return document.querySelector(
    selector
  );
}

function qsa(selector){

  return Array.from(

    document.querySelectorAll(
      selector
    )

  );
}

/* =========================================================
   STORAGE HELPERS
========================================================= */

function saveLocal(

  key,

  value

){

  try{

    localStorage.setItem(

      key,

      JSON.stringify(value)

    );

  }catch(err){

    console.warn(err);
  }
}

function loadLocal(

  key,

  fallback = null

){

  try{

    const item =
      localStorage.getItem(
        key
      );

    if(!item){
      return fallback;
    }

    return JSON.parse(item);

  }catch(err){

    return fallback;
  }
}

/* =========================================================
   CSV EXPORT
========================================================= */

function exportCsv({

  rows=[],

  filename='export.csv',

} = {}){

  const csv =
    rows.map(row =>

      row.join(',')

    ).join('\n');

  const blob =
    new Blob(

      [csv],

      {

        type:
          'text/csv',

      }

    );

  const url =
    URL.createObjectURL(
      blob
    );

  const link =
    document.createElement(
      'a'
    );

  link.href =
    url;

  link.download =
    filename;

  link.click();

  URL.revokeObjectURL(
    url
  );
}

/* =========================================================
   API HELPER
========================================================= */

async function api(

  url,

  options = {}

){

  const config = {

    headers:{

      'Content-Type':
        'application/json',

    },

    ...options,

  };

  const response =
    await fetch(

      url,

      config

    );

  if(

    !response.ok

  ){

    throw new Error(

      `API ERROR ${response.status}`

    );
  }

  return response.json();
}

/* =========================================================
   GLOBAL STATE
========================================================= */

if(

  typeof state === 'undefined'

){

  window.state = {

    route:'overview',

    plan:'pro',

    mobile:false,

    mobileSidebar:false,

    alerts:[],

    monitors:[],

    audits:[],

    missions:[],

    reports:[],

    user:{

      name:'Maël',

      email:'admin@flowpoint.pro',

      role:'owner',

    },

  };
}

/* =========================================================
   ROUTES FALLBACK
========================================================= */

if(

  typeof routes === 'undefined'

){

  window.routes = [];
}

/* =========================================================
   SAFE TABLE
========================================================= */

function renderDataTable({

  columns=[],

  rows=[],

} = {}){

  return `

    <div class="
      fp-tableWrap
    ">

      <table class="
        fp-table
      ">

        <thead>

          <tr>

            ${columns.map(column => `

              <th>

                ${column}

              </th>

            `).join('')}

          </tr>

        </thead>

        <tbody>

          ${rows.map(row => `

            <tr>

              ${row.map(cell => `

                <td>

                  ${cell}

                </td>

              `).join('')}

            </tr>

          `).join('')}

        </tbody>

      </table>

    </div>

  `;
}

/* =========================================================
   SAFE ROUTER
========================================================= */

function ensureValidRoute(){

  const exists =
    routes.some(

      route =>

        route.key
        ===
        state.route

    );

  if(!exists){

    state.route =
      'overview';
  }
}

/* =========================================================
   HASH ROUTER
========================================================= */

function syncHashRoute(){

  const hash =
    window.location.hash
      .replace('#','');

  if(hash){

    state.route =
      hash;
  }

  ensureValidRoute();
}

window.addEventListener(

  'hashchange',

  () => {

    syncHashRoute();

    render();
  }
);

/* =========================================================
   SET ROUTE
========================================================= */

function setRoute(route){

  state.route =
    route;

  window.location.hash =
    route;

  render();
}

/* =========================================================
   SAFE BIND EVENTS
========================================================= */

if(

  typeof bindEvents
  ===
  'undefined'

){

  window.bindEvents =
    function(){};
}

/* =========================================================
   MAIN RENDER
========================================================= */

function render(){

  ensureValidRoute();

  const app =
    qs('#app');

  if(!app){
    return;
  }

  app.innerHTML =
    renderDashboardShell();

  bindEvents();
}

/* =========================================================
   BOOT
========================================================= */

async function bootDashboard(){

  syncHashRoute();

  render();

  startRealtimeEngine?.();

  console.log(
    'Dashboard booted'
  );
}

/* =========================================================
   AUTO BOOT
========================================================= */

document.addEventListener(

  'DOMContentLoaded',

  () => {

    bootDashboard();
  }
);

/* =========================================================
   FINAL READY
========================================================= */

console.log(
  'FlowPoint stable build ready'
);
/* =========================================================
   FINAL MASTER SHELL ENGINE
========================================================= */

/* =========================================================
   SIDEBAR
========================================================= */

function renderSidebar(){

  return `

    <aside class="
      fp-sidebar
      ${
        state.mobileSidebar
          ? 'open'
          : ''
      }
    ">

      <!-- TOP -->

      <div class="
        fp-sidebarTop
      ">

        <div class="
          fp-brand
        ">

          <div class="
            fp-brandLogo
          ">

            ⚡

          </div>

          <div>

            <div class="
              fp-brandTitle
            ">

              FlowPoint

            </div>

            <div class="
              fp-brandSub
            ">

              Enterprise Suite

            </div>

          </div>

        </div>

      </div>

      <!-- NAV -->

      <div class="
        fp-sidebarNav
      ">

        ${routes.map(route => `

          <button

            class="
              fp-sidebarLink
              ${
                state.route === route.key
                  ? 'active'
                  : ''
              }
            "

            data-route="
              ${route.key}
            "
          >

            <span class="
              fp-sidebarIcon
            ">

              ${route.icon || '•'}

            </span>

            <span>

              ${route.label}

            </span>

          </button>

        `).join('')}

      </div>

      <!-- BOTTOM -->

      <div class="
        fp-sidebarBottom
      ">

        <div class="
          fp-workspaceCard
        ">

          <div class="
            fp-workspaceTop
          ">

            <div class="
              fp-userMiniAvatar
            ">

              ${
                (
                  state.user?.name
                  || 'F'
                )

                .slice(0,1)

                .toUpperCase()
              }

            </div>

            <div>

              <div class="
                fp-workspaceTitle
              ">

                ${
                  state.user?.name
                  || 'FlowPoint'
                }

              </div>

              <div class="
                fp-workspaceSub
              ">

                ${
                  state.plan
                }
                plan

              </div>

            </div>

          </div>

        </div>

      </div>

    </aside>

  `;
}

/* =========================================================
   TOPBAR
========================================================= */

function renderTopbar(){

  const current =
    routes.find(

      route =>

        route.key
        ===
        state.route

    );

  return `

    <header class="
      fp-topbar
    ">

      <div class="
        fp-flex
        fp-alignCenter
        fp-gap20
      ">

        <button

          id="
            fpMobileMenuBtn
          "

          class="
            fp-mobileMenuBtn
          "
        >

          ☰

        </button>

        <div>

          <div class="
            fp-pageTitle
          ">

            ${
              current?.label
              || 'Dashboard'
            }

          </div>

          <div class="
            fp-pageSub
          ">

            Executive infrastructure platform

          </div>

        </div>

      </div>

      <div class="
        fp-flex
        fp-alignCenter
        fp-gap16
      ">

        ${renderRealtimeBadge?.() || ''}

        ${renderPerformanceBadge?.() || ''}

        <button

          id="
            fpOpenSearch
          "

          class="
            fp-btn
            fp-btnGhost
          "
        >

          Recherche

        </button>

        <button

          id="
            fpOpenActivity
          "

          class="
            fp-btn
            fp-btnGhost
          "
        >

          Activité

        </button>

      </div>

    </header>

  `;
}

/* =========================================================
   PAGE ROUTER
========================================================= */

function renderPage(){

  switch(state.route){

    case 'overview':
      return renderOverview?.();

    case 'analytics':
      return renderAnalytics?.();

    case 'monitors':
      return renderMonitoring?.();

    case 'audits':
      return renderAudits?.();

    case 'reports':
      return renderReports?.();

    case 'alerts':
      return renderAlerts?.();

    case 'missions':
      return renderMissions?.();

    case 'team':
      return renderTeam?.();

    case 'clients':
      return renderClientPortal?.();

    case 'workspace':
      return renderWorkspaceOverview?.();

    case 'automations':
      return renderAutomationCenter?.();

    case 'local-seo':
      return renderLocalSeo?.();

    case 'competitors':
      return renderCompetitors?.();

    case 'billing':
      return renderBilling?.();

    case 'settings':
      return renderSettings?.();

    case 'api':
      return renderApiPage?.();

    case 'ai':
      return renderAiCenter?.();

    default:

      return createEmptyState({

        icon:'⚠️',

        title:'Page introuvable',

        text:'Impossible de charger cette page.',

      });
  }
}

/* =========================================================
   MAIN SHELL
========================================================= */

function renderDashboardShell(){

  return `

    <div class="
      fp-dashboardShell
    ">

      ${renderSidebar()}

      <main class="
        fp-main
      ">

        ${renderTopbar()}

        <div class="
          fp-content
        ">

          ${renderPage()}

        </div>

      </main>

    </div>

  `;
}

/* =========================================================
   EVENTS
========================================================= */

const previousMasterBind =
  bindEvents;

bindEvents = function(){

  previousMasterBind?.();

  /* ROUTES */

  qsa('[data-route]')
    .forEach(button => {

      button.onclick = () => {

        const route =
          button.dataset.route;

        if(route){

          setRoute(route);
        }
      };
    });

  /* MOBILE */

  const mobile =
    qs('#fpMobileMenuBtn');

  if(mobile){

    mobile.onclick = () => {

      state.mobileSidebar =
        !state.mobileSidebar;

      render();
    };
  }

  /* SEARCH */

  const search =
    qs('#fpOpenSearch');

  if(search){

    search.onclick =
      openGlobalSearch;
  }

  /* ACTIVITY */

  const activity =
    qs('#fpOpenActivity');

  if(activity){

    activity.onclick =
      openActivityFeed;
  }
};

/* =========================================================
   DEFAULT ROUTES
========================================================= */

if(!routes.length){

  routes.push(

    {
      key:'overview',
      label:'Overview',
      icon:'🏠',
    },

    {
      key:'analytics',
      label:'Analytics',
      icon:'📊',
    },

    {
      key:'monitors',
      label:'Monitoring',
      icon:'🛰️',
    },

    {
      key:'audits',
      label:'Audits',
      icon:'📈',
    },

    {
      key:'reports',
      label:'Reports',
      icon:'📄',
    },

    {
      key:'alerts',
      label:'Alerts',
      icon:'🚨',
    },

    {
      key:'missions',
      label:'Missions',
      icon:'🎯',
    },

    {
      key:'team',
      label:'Team',
      icon:'👥',
    },

    {
      key:'clients',
      label:'Clients',
      icon:'💼',
    },

    {
      key:'workspace',
      label:'Workspace',
      icon:'🏢',
    },

    {
      key:'automations',
      label:'Automations',
      icon:'⚙️',
    },

    {
      key:'local-seo',
      label:'Local SEO',
      icon:'📍',
    },

    {
      key:'competitors',
      label:'Competitors',
      icon:'🧠',
    },

    {
      key:'billing',
      label:'Billing',
      icon:'💳',
    },

    {
      key:'settings',
      label:'Settings',
      icon:'🛠️',
    },

    {
      key:'api',
      label:'API',
      icon:'🔌',
    },

    {
      key:'ai',
      label:'AI',
      icon:'🤖',
    },

  );
}

/* =========================================================
   MASTER SHELL READY
========================================================= */

console.log(
  'Master shell loaded'
);
/* =========================================================
   FINAL ENTERPRISE CSS PACK
========================================================= */

/* =========================================================
   RESET
========================================================= */

*{
  box-sizing:border-box;
  margin:0;
  padding:0;
}

html,
body{
  min-height:100%;
  scroll-behavior:smooth;
}

body{
  background:
    radial-gradient(
      circle at top left,
      rgba(47,91,255,.18),
      transparent 28%
    ),
    radial-gradient(
      circle at bottom right,
      rgba(59,130,246,.12),
      transparent 24%
    ),
    linear-gradient(
      180deg,
      #050816 0%,
      #091120 100%
    );
  color:#fff;
  font-family:
    Inter,
    system-ui,
    sans-serif;
  overflow-x:hidden;
}

/* =========================================================
   TYPOGRAPHY
========================================================= */

h1,h2,h3,h4,h5,h6{
  font-weight:800;
  line-height:1.1;
}

p{
  line-height:1.6;
}

.fp-muted{
  color:#8ea3d4;
}

.fp-textSm{
  font-size:13px;
}

/* =========================================================
   FLEX
========================================================= */

.fp-flex{
  display:flex;
}

.fp-flexCol{
  display:flex;
  flex-direction:column;
}

.fp-alignCenter{
  align-items:center;
}

.fp-justifyBetween{
  justify-content:space-between;
}

.fp-gap12{
  gap:12px;
}

.fp-gap16{
  gap:16px;
}

.fp-gap20{
  gap:20px;
}

.fp-gap24{
  gap:24px;
}

/* =========================================================
   MARGINS
========================================================= */

.fp-mt20{
  margin-top:20px;
}

.fp-mt24{
  margin-top:24px;
}

.fp-mt32{
  margin-top:32px;
}

/* =========================================================
   WIDTH
========================================================= */

.fp-wFull{
  width:100%;
}

/* =========================================================
   BRAND
========================================================= */

.fp-brand{
  display:flex;
  align-items:center;
  gap:16px;
}

.fp-brandLogo{
  width:52px;
  height:52px;
  border-radius:18px;
  display:flex;
  align-items:center;
  justify-content:center;
  background:
    linear-gradient(
      135deg,
      #2f5bff,
      #5f84ff
    );
  font-size:24px;
  box-shadow:
    0 18px 40px
    rgba(47,91,255,.34);
}

.fp-brandTitle{
  font-size:20px;
  font-weight:800;
}

.fp-brandSub{
  font-size:13px;
  color:#90a4d4;
  margin-top:4px;
}

/* =========================================================
   PAGE
========================================================= */

.fp-page{
  display:flex;
  flex-direction:column;
  gap:24px;
  min-width:0;
}

/* =========================================================
   EXECUTIVE HERO
========================================================= */

.fp-executiveHero{
  overflow:hidden;
  position:relative;
}

.fp-executiveHero::before{
  content:'';
  position:absolute;
  inset:0;
  background:
    radial-gradient(
      circle at top right,
      rgba(255,255,255,.14),
      transparent 26%
    );
  pointer-events:none;
}

.fp-heroGreeting{
  font-size:15px;
  font-weight:700;
  opacity:.9;
}

.fp-heroTitle{
  font-size:42px;
  font-weight:900;
  margin-top:14px;
}

.fp-heroText{
  margin-top:16px;
  color:
    rgba(255,255,255,.84);
  max-width:640px;
  line-height:1.7;
}

.fp-heroStats{
  display:flex;
  gap:18px;
}

.fp-heroStat{
  min-width:150px;
  background:
    rgba(255,255,255,.10);
  border:
    1px solid
    rgba(255,255,255,.14);
  border-radius:24px;
  padding:22px;
  backdrop-filter:blur(10px);
}

.fp-heroStatValue{
  font-size:32px;
  font-weight:900;
}

.fp-heroStatLabel{
  margin-top:10px;
  color:
    rgba(255,255,255,.72);
  font-size:13px;
}

/* =========================================================
   QUICK ACTIONS
========================================================= */

.fp-quickActions{
  position:fixed;
  right:24px;
  bottom:24px;
  display:flex;
  flex-direction:column;
  gap:14px;
  z-index:120;
}

.fp-quickAction{
  width:58px;
  height:58px;
  border:none;
  border-radius:18px;
  background:
    linear-gradient(
      135deg,
      #2f5bff,
      #5d82ff
    );
  color:white;
  font-size:20px;
  cursor:pointer;
  box-shadow:
    0 18px 40px
    rgba(47,91,255,.30);
  transition:.24s;
}

.fp-quickAction:hover{
  transform:
    translateY(-3px)
    scale(1.04);
}

/* =========================================================
   CHAT
========================================================= */

.fp-chatBox{
  display:flex;
  flex-direction:column;
  gap:16px;
}

.fp-chatMessage{
  display:flex;
  flex-direction:column;
  gap:8px;
}

.fp-chatAuthor{
  font-size:13px;
  font-weight:700;
  color:#90a4d4;
}

.fp-chatText{
  background:
    rgba(255,255,255,.05);
  border:
    1px solid
    rgba(255,255,255,.06);
  border-radius:18px;
  padding:14px 16px;
  line-height:1.6;
}

/* =========================================================
   AI
========================================================= */

.fp-aiMessages{
  display:flex;
  flex-direction:column;
  gap:18px;
  min-height:420px;
}

.fp-aiMessage{
  display:flex;
}

.fp-aiMessage.user{
  justify-content:flex-end;
}

.fp-aiBubble{
  max-width:78%;
  padding:16px 18px;
  border-radius:20px;
  line-height:1.7;
  white-space:pre-line;
}

.fp-aiMessage.assistant
.fp-aiBubble{
  background:
    rgba(255,255,255,.06);
  border:
    1px solid
    rgba(255,255,255,.08);
}

.fp-aiMessage.user
.fp-aiBubble{
  background:
    linear-gradient(
      135deg,
      #2f5bff,
      #4f7cff
    );
}

/* =========================================================
   TIMELINE
========================================================= */

.fp-timeline{
  display:flex;
  flex-direction:column;
  gap:24px;
}

.fp-timelineItem{
  display:flex;
  gap:18px;
}

.fp-timelineDot{
  width:14px;
  height:14px;
  border-radius:999px;
  margin-top:8px;
  flex-shrink:0;
}

.fp-timelineDot.success{
  background:#10b981;
}

.fp-timelineDot.warning{
  background:#f59e0b;
}

.fp-timelineDot.danger{
  background:#ef4444;
}

.fp-timelineDot.primary{
  background:#2f5bff;
}

.fp-timelineCard{
  flex:1;
  background:
    rgba(255,255,255,.04);
  border:
    1px solid
    rgba(255,255,255,.05);
  border-radius:20px;
  padding:18px;
}

.fp-timelineTitle{
  font-weight:700;
}

.fp-timelineText{
  margin-top:8px;
  color:#8ea3d4;
}

.fp-timelineTime{
  margin-top:12px;
  font-size:12px;
  color:#6e82b2;
}

/* =========================================================
   SCROLLBAR
========================================================= */

::-webkit-scrollbar{
  width:10px;
  height:10px;
}

::-webkit-scrollbar-track{
  background:
    rgba(255,255,255,.03);
}

::-webkit-scrollbar-thumb{
  background:
    rgba(255,255,255,.14);
  border-radius:999px;
}

/* =========================================================
   MOBILE
========================================================= */

@media(max-width:980px){

  .fp-heroTitle{
    font-size:30px;
  }

  .fp-heroStats{
    flex-direction:column;
    width:100%;
  }

  .fp-quickActions{
    right:16px;
    bottom:16px;
  }

  .fp-quickAction{
    width:52px;
    height:52px;
  }
}

/* =========================================================
   FINAL POLISH
========================================================= */

.fp-card,
.fp-kpiCard,
.fp-sidebarLink,
.fp-btn{
  will-change:
    transform;
}

.fp-card:hover{
  border-color:
    rgba(255,255,255,.08);
}

.fp-btn:active{
  transform:
    scale(.98);
}

.fp-input:focus,
.fp-textarea:focus,
.fp-select:focus{
  border-color:
    rgba(47,91,255,.48);
  box-shadow:
    0 0 0 4px
    rgba(47,91,255,.12);
}
/* =========================================================
   FINAL RESPONSIVE & PREMIUM UI PATCH
========================================================= */

/* =========================================================
   GRID RESPONSIVE
========================================================= */

@media(max-width:1400px){

  .fp-grid4{
    grid-template-columns:
      repeat(2,minmax(0,1fr));
  }
}

@media(max-width:1100px){

  .fp-grid3{
    grid-template-columns:
      repeat(2,minmax(0,1fr));
  }

  .fp-grid2{
    grid-template-columns:
      1fr;
  }
}

@media(max-width:760px){

  .fp-grid2,
  .fp-grid3,
  .fp-grid4{
    grid-template-columns:
      1fr;
  }
}

/* =========================================================
   MOBILE TOPBAR
========================================================= */

.fp-mobileMenuBtn{
  display:none;
  width:44px;
  height:44px;
  border:none;
  border-radius:14px;
  background:
    rgba(255,255,255,.06);
  color:white;
  font-size:20px;
  cursor:pointer;
}

@media(max-width:980px){

  .fp-mobileMenuBtn{
    display:flex;
    align-items:center;
    justify-content:center;
  }

  .fp-topbar{
    padding:16px;
  }

  .fp-pageTitle{
    font-size:22px;
  }

  .fp-pageSub{
    display:none;
  }
}

/* =========================================================
   SIDEBAR MOBILE
========================================================= */

@media(max-width:980px){

  .fp-sidebar{
    position:fixed;
    top:0;
    left:-100%;
    width:290px;
    z-index:200;
    transition:.32s;
  }

  .fp-sidebar.open{
    left:0;
  }

  .fp-main{
    width:100%;
  }

  .fp-content{
    padding:16px;
  }
}

/* =========================================================
   TABLE RESPONSIVE
========================================================= */

.fp-tableWrap{
  width:100%;
  overflow:auto;
}

.fp-table{
  min-width:760px;
}

/* =========================================================
   PREMIUM TABLE
========================================================= */

.fp-table tr{
  transition:.18s;
}

.fp-table tbody tr:hover{
  background:
    rgba(255,255,255,.03);
}

/* =========================================================
   SEARCH BAR
========================================================= */

.fp-searchBar{
  display:flex;
  align-items:center;
  gap:12px;
  padding:14px 16px;
  border-radius:18px;
  background:
    rgba(255,255,255,.05);
  border:
    1px solid
    rgba(255,255,255,.06);
}

.fp-searchInput{
  flex:1;
  background:transparent;
  border:none;
  outline:none;
  color:white;
}

.fp-searchInput::placeholder{
  color:#7f93c2;
}

/* =========================================================
   FILTER BAR
========================================================= */

.fp-filterBar{
  display:flex;
  align-items:center;
  gap:12px;
  flex-wrap:wrap;
}

.fp-filterChip{
  border:none;
  border-radius:999px;
  padding:12px 16px;
  background:
    rgba(255,255,255,.05);
  color:white;
  cursor:pointer;
  transition:.2s;
}

.fp-filterChip:hover{
  background:
    rgba(255,255,255,.10);
}

/* =========================================================
   DROPDOWN
========================================================= */

.fp-dropdown{
  position:relative;
}

.fp-dropdownMenu{
  position:absolute;
  top:110%;
  right:0;
  min-width:220px;
  background:
    rgba(10,15,30,.96);
  border:
    1px solid
    rgba(255,255,255,.08);
  border-radius:18px;
  padding:10px;
  display:none;
  flex-direction:column;
  gap:6px;
  backdrop-filter:blur(18px);
  z-index:80;
}

.fp-dropdownMenu.open{
  display:flex;
}

.fp-dropdownItem{
  border:none;
  background:transparent;
  color:white;
  text-align:left;
  padding:12px 14px;
  border-radius:12px;
  cursor:pointer;
}

.fp-dropdownItem:hover{
  background:
    rgba(255,255,255,.06);
}

/* =========================================================
   TABS
========================================================= */

.fp-tabs{
  display:flex;
  align-items:center;
  gap:12px;
  flex-wrap:wrap;
}

.fp-tab{
  border:none;
  border-radius:14px;
  padding:12px 18px;
  background:
    rgba(255,255,255,.05);
  color:white;
  cursor:pointer;
  transition:.2s;
}

.fp-tab.active{
  background:
    linear-gradient(
      135deg,
      #2f5bff,
      #5c82ff
    );
}

/* =========================================================
   ALERT ITEM
========================================================= */

.fp-alertItem{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:20px;
  padding:18px;
  border-radius:20px;
  background:
    rgba(255,255,255,.03);
  border:
    1px solid
    rgba(255,255,255,.05);
}

.fp-alertDot{
  width:12px;
  height:12px;
  border-radius:999px;
}

.fp-alertDot.success{
  background:#10b981;
}

.fp-alertDot.warning{
  background:#f59e0b;
}

.fp-alertDot.danger{
  background:#ef4444;
}

.fp-alertDot.primary{
  background:#2f5bff;
}

/* =========================================================
   USER STATUS
========================================================= */

.fp-userStatus{
  display:flex;
  align-items:center;
  gap:10px;
  padding:12px 16px;
  border-radius:999px;
  background:
    rgba(16,185,129,.10);
  border:
    1px solid
    rgba(16,185,129,.18);
  color:#8af0c0;
  font-size:13px;
  font-weight:600;
}

.fp-userStatusDot{
  width:10px;
  height:10px;
  border-radius:999px;
  background:#10b981;
  box-shadow:
    0 0 18px
    rgba(16,185,129,.6);
}

/* =========================================================
   SKELETON
========================================================= */

.fp-skeleton{
  border-radius:20px;
  background:
    linear-gradient(
      90deg,
      rgba(255,255,255,.04),
      rgba(255,255,255,.08),
      rgba(255,255,255,.04)
    );
  background-size:300% 100%;
  animation:
    fpSkeleton 1.4s linear infinite;
}

@keyframes fpSkeleton{

  from{
    background-position:200% 0;
  }

  to{
    background-position:-200% 0;
  }
}

/* =========================================================
   ADVANCED LOADER
========================================================= */

.fp-advancedLoader{
  min-height:100vh;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:24px;
}

.fp-loaderRing{
  width:80px;
  height:80px;
  border-radius:999px;
  border:
    5px solid
    rgba(255,255,255,.08);
  border-top-color:#2f5bff;
  animation:
    fpSpin 1s linear infinite;
}

.fp-loaderText{
  color:#9ab0df;
  font-size:15px;
}

@keyframes fpSpin{

  from{
    transform:rotate(0deg);
  }

  to{
    transform:rotate(360deg);
  }
}

/* =========================================================
   COMMAND SEARCH
========================================================= */

.fp-commandItem{
  width:100%;
  border:none;
  background:
    rgba(255,255,255,.03);
  border-radius:18px;
  padding:16px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  color:white;
  cursor:pointer;
  transition:.18s;
}

.fp-commandItem:hover{
  background:
    rgba(255,255,255,.08);
}

.fp-commandTitle{
  font-weight:700;
}

.fp-commandType{
  margin-top:6px;
  font-size:12px;
  color:#8ea3d4;
}

/* =========================================================
   REDUCED MOTION
========================================================= */

.fp-reduceMotion *,
.fp-reduceMotion *::before,
.fp-reduceMotion *::after{
  animation:none !important;
  transition:none !important;
  scroll-behavior:auto !important;
}

/* =========================================================
   FINAL PREMIUM EFFECTS
========================================================= */

.fp-card{
  position:relative;
}

.fp-card::after{
  content:'';
  position:absolute;
  inset:0;
  border-radius:inherit;
  padding:1px;
  background:
    linear-gradient(
      135deg,
      rgba(255,255,255,.10),
      transparent
    );
  -webkit-mask:
    linear-gradient(#fff 0 0)
    content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite:xor;
  pointer-events:none;
  opacity:.7;
}
/* =========================================================
   FINAL MISSING CLASSES & UTILITIES
========================================================= */

/* =========================================================
   SECTION
========================================================= */

.fp-sectionHeader{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:20px;
  flex-wrap:wrap;
}

.fp-sectionTitle{
  font-size:28px;
  font-weight:800;
  line-height:1.1;
}

.fp-sectionText{
  margin-top:10px;
  color:#8ea3d4;
  line-height:1.7;
  max-width:760px;
}

/* =========================================================
   KPI
========================================================= */

.fp-kpiCard{
  position:relative;
  overflow:hidden;
}

.fp-kpiCard::before{
  content:'';
  position:absolute;
  inset:0;
  background:
    radial-gradient(
      circle at top right,
      rgba(255,255,255,.08),
      transparent 40%
    );
  pointer-events:none;
}

.fp-kpiLabel{
  font-size:13px;
  color:#8ea3d4;
  font-weight:600;
}

.fp-kpiValue{
  margin-top:14px;
  font-size:34px;
  font-weight:900;
  letter-spacing:-1px;
}

/* =========================================================
   STAT CARD
========================================================= */

.fp-statCard{
  background:
    linear-gradient(
      180deg,
      rgba(18,25,45,.96),
      rgba(11,18,34,.96)
    );
  border:
    1px solid
    rgba(255,255,255,.06);
  border-radius:26px;
  padding:24px;
  position:relative;
  overflow:hidden;
}

.fp-statCard::before{
  content:'';
  position:absolute;
  inset:0;
  background:
    radial-gradient(
      circle at top right,
      rgba(47,91,255,.18),
      transparent 30%
    );
  pointer-events:none;
}

.fp-statIcon{
  width:52px;
  height:52px;
  border-radius:18px;
  display:flex;
  align-items:center;
  justify-content:center;
  background:
    rgba(255,255,255,.06);
  font-size:22px;
}

.fp-statValue{
  margin-top:22px;
  font-size:38px;
  font-weight:900;
  line-height:1;
}

.fp-statTitle{
  margin-top:12px;
  color:#8ea3d4;
  font-size:14px;
}

/* =========================================================
   EMPTY STATE
========================================================= */

.fp-emptyState{
  padding:50px 20px;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  text-align:center;
}

.fp-emptyIcon{
  font-size:48px;
}

.fp-emptyTitle{
  margin-top:20px;
  font-size:24px;
  font-weight:800;
}

.fp-emptyText{
  margin-top:12px;
  color:#8ea3d4;
  max-width:520px;
  line-height:1.7;
}

/* =========================================================
   LIST
========================================================= */

.fp-list{
  display:flex;
  flex-direction:column;
  gap:16px;
}

.fp-listItem{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:20px;
  padding:18px;
  border-radius:20px;
  background:
    rgba(255,255,255,.03);
  border:
    1px solid
    rgba(255,255,255,.05);
}

.fp-listTitle{
  font-weight:700;
  line-height:1.4;
}

.fp-listText{
  margin-top:6px;
  color:#8ea3d4;
  font-size:14px;
  line-height:1.6;
}

/* =========================================================
   USER MINI AVATAR
========================================================= */

.fp-userMiniAvatar{
  width:46px;
  height:46px;
  border-radius:16px;
  display:flex;
  align-items:center;
  justify-content:center;
  background:
    linear-gradient(
      135deg,
      #2f5bff,
      #5e82ff
    );
  color:white;
  font-weight:800;
  flex-shrink:0;
}

/* =========================================================
   WORKSPACE CARD
========================================================= */

.fp-workspaceCard{
  background:
    rgba(255,255,255,.04);
  border:
    1px solid
    rgba(255,255,255,.05);
  border-radius:24px;
  padding:18px;
}

.fp-workspaceTop{
  display:flex;
  align-items:center;
  gap:14px;
}

.fp-workspaceTitle{
  font-weight:700;
}

.fp-workspaceSub{
  margin-top:6px;
  color:#8ea3d4;
  font-size:13px;
}

/* =========================================================
   DOT STATUS
========================================================= */

.fp-dot{
  width:14px;
  height:14px;
  border-radius:999px;
  flex-shrink:0;
}

.fp-dot.online{
  background:#10b981;
  box-shadow:
    0 0 16px
    rgba(16,185,129,.5);
}

.fp-dot.warning{
  background:#f59e0b;
  box-shadow:
    0 0 16px
    rgba(245,158,11,.4);
}

.fp-dot.offline{
  background:#ef4444;
  box-shadow:
    0 0 16px
    rgba(239,68,68,.4);
}

/* =========================================================
   CHART PLACEHOLDER
========================================================= */

.fp-chartEmpty{
  height:220px;
  border-radius:24px;
  display:flex;
  align-items:center;
  justify-content:center;
  text-align:center;
  color:#7e92c0;
  border:
    1px dashed
    rgba(255,255,255,.08);
  background:
    linear-gradient(
      180deg,
      rgba(255,255,255,.02),
      rgba(255,255,255,.04)
    );
}

/* =========================================================
   TOGGLE
========================================================= */

.fp-toggle{
  display:flex;
  align-items:center;
  gap:14px;
  cursor:pointer;
  user-select:none;
}

.fp-toggle input{
  width:18px;
  height:18px;
  accent-color:#2f5bff;
}

/* =========================================================
   PRICING
========================================================= */

.fp-pricing{
  margin-top:22px;
  font-size:54px;
  font-weight:900;
  line-height:1;
  letter-spacing:-2px;
}

.fp-pricing span{
  font-size:16px;
  color:#8ea3d4;
  font-weight:600;
  margin-left:6px;
}

.fp-planHighlight{
  border-color:
    rgba(47,91,255,.34);
  box-shadow:
    0 24px 60px
    rgba(47,91,255,.18);
}

/* =========================================================
   REALTIME BADGES
========================================================= */

.fp-liveBadge{
  display:flex;
  align-items:center;
  gap:10px;
  padding:12px 16px;
  border-radius:999px;
  background:
    rgba(16,185,129,.12);
  border:
    1px solid
    rgba(16,185,129,.16);
  color:#7ff0bf;
  font-size:13px;
  font-weight:700;
}

.fp-liveDot{
  width:10px;
  height:10px;
  border-radius:999px;
  background:#10b981;
  animation:
    fpPulse 1.6s infinite;
}

@keyframes fpPulse{

  0%{
    transform:scale(1);
    opacity:1;
  }

  50%{
    transform:scale(1.3);
    opacity:.6;
  }

  100%{
    transform:scale(1);
    opacity:1;
  }
}

/* =========================================================
   MINI CHART
========================================================= */

.fp-miniChart{
  width:100%;
  display:flex;
  align-items:flex-end;
  gap:10px;
  height:220px;
}

.fp-miniChartBar{
  flex:1;
  border-radius:14px 14px 6px 6px;
  background:
    linear-gradient(
      180deg,
      #5b82ff,
      #2f5bff
    );
  min-height:14px;
  transition:.22s;
}

.fp-miniChartBar:hover{
  opacity:.85;
  transform:translateY(-2px);
}

/* =========================================================
   RESPONSIVE FIXES
========================================================= */

@media(max-width:980px){

  .fp-sectionTitle{
    font-size:24px;
  }

  .fp-pricing{
    font-size:42px;
  }

  .fp-kpiValue{
    font-size:28px;
  }

  .fp-statValue{
    font-size:32px;
  }

  .fp-listItem{
    flex-direction:column;
    align-items:flex-start;
  }
}

@media(max-width:640px){

  .fp-cardBody{
    padding:18px;
  }

  .fp-cardHeader{
    padding:18px;
  }

  .fp-sectionTitle{
    font-size:22px;
  }

  .fp-heroTitle{
    font-size:26px;
  }

  .fp-topbar{
    gap:14px;
  }
}
/* =========================================================
   FINAL CORE HELPERS & CHART SYSTEM
========================================================= */

/* =========================================================
   FORMATTERS
========================================================= */

function formatNumber(value = 0){

  return new Intl.NumberFormat(

    'fr-FR'

  ).format(value);
}

function formatCurrency(value = 0){

  return new Intl.NumberFormat(

    'fr-FR',

    {

      style:'currency',

      currency:'EUR',

      maximumFractionDigits:0,

    }

  ).format(value);
}

function formatPercent(value = 0){

  return `${value}%`;
}

/* =========================================================
   DATE FORMATTER
========================================================= */

function formatDate(date){

  try{

    return new Intl.DateTimeFormat(

      'fr-FR',

      {

        day:'numeric',

        month:'short',

        year:'numeric',

      }

    ).format(

      new Date(date)

    );

  }catch(err){

    return '-';
  }
}

/* =========================================================
   ID GENERATOR
========================================================= */

function uid(prefix = 'fp'){

  return `

    ${prefix}

    _

    ${Math.random()
      .toString(36)
      .slice(2,10)}

  `.replace(/\s/g,'');
}

/* =========================================================
   CLAMP
========================================================= */

function clamp(

  value,

  min,

  max

){

  return Math.min(

    Math.max(value,min),

    max

  );
}

/* =========================================================
   RANDOM
========================================================= */

function random(

  min,

  max

){

  return Math.floor(

    Math.random()

    *

    (max - min + 1)

  ) + min;
}

/* =========================================================
   CHART ENGINE
========================================================= */

function createMiniChart({

  values=[],

  height=220,

} = {}){

  const max =
    Math.max(...values,1);

  return `

    <div

      class="
        fp-miniChart
      "

      style="
        height:${height}px;
      "
    >

      ${values.map(value => `

        <div

          class="
            fp-miniChartBar
          "

          style="
            height:
            ${
              clamp(
                (value / max) * 100,
                8,
                100
              )
            }%;
          "
        ></div>

      `).join('')}

    </div>

  `;
}

/* =========================================================
   ANALYTICS WIDGET
========================================================= */

function renderAnalyticsWidget({

  title='Metric',

  value='0',

  trend='+0%',

  values=[],

} = {}){

  return `

    <div class="
      fp-card
    ">

      <div class="
        fp-cardBody
      ">

        <div class="
          fp-flex
          fp-alignCenter
          fp-justifyBetween
        ">

          <div class="
            fp-kpiLabel
          ">

            ${title}

          </div>

          <div class="
            fp-badge
            ${
              trend.startsWith('-')
                ? 'fp-badgeDanger'
                : 'fp-badgeSuccess'
            }
          ">

            ${trend}

          </div>

        </div>

        <div class="
          fp-kpiValue
        ">

          ${value}

        </div>

        <div class="
          fp-mt24
        ">

          ${createMiniChart({

            values,

            height:120,

          })}

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   TOAST ENGINE
========================================================= */

function ensureToastRoot(){

  let root =
    qs('#fpToastRoot');

  if(root){
    return root;
  }

  root =
    document.createElement(
      'div'
    );

  root.id =
    'fpToastRoot';

  root.className =
    'fp-toastRoot';

  document.body.appendChild(
    root
  );

  return root;
}

function toast(

  text='',

  type='primary'

){

  const root =
    ensureToastRoot();

  const toast =
    document.createElement(
      'div'
    );

  toast.className = `

    fp-toast
    ${type}

  `;

  toast.innerHTML = `

    <div class="
      fp-toastText
    ">

      ${text}

    </div>

  `;

  root.appendChild(
    toast
  );

  requestAnimationFrame(() => {

    toast.classList.add(
      'show'
    );
  });

  setTimeout(() => {

    toast.classList.remove(
      'show'
    );

    setTimeout(() => {

      toast.remove();

    }, 240);

  }, 3200);
}

/* =========================================================
   MODAL ENGINE
========================================================= */

function openModal({

  title='',

  content='',

  large=false,

} = {}){

  closeModal();

  const overlay =
    document.createElement(
      'div'
    );

  overlay.className =
    'fp-modalOverlay';

  overlay.innerHTML = `

    <div class="
      fp-modal
      ${
        large
          ? 'large'
          : ''
      }
    ">

      <div class="
        fp-modalHeader
      ">

        <div class="
          fp-modalTitle
        ">

          ${title}

        </div>

        <button

          id="
            fpCloseModal
          "

          class="
            fp-modalClose
          "
        >

          ✕

        </button>

      </div>

      <div class="
        fp-modalBody
      ">

        ${content}

      </div>

    </div>

  `;

  document.body.appendChild(
    overlay
  );

  qs('#fpCloseModal')
    .onclick = closeModal;

  overlay.onclick = event => {

    if(

      event.target === overlay

    ){

      closeModal();
    }
  };
}

function closeModal(){

  qs('.fp-modalOverlay')
    ?.remove();
}

/* =========================================================
   PDF PREVIEW
========================================================= */

function openPdfPreview(title='Report'){

  openModal({

    title,

    large:true,

    content:`

      <div class="
        fp-chartEmpty
      " style="
        height:620px;
      ">

        Executive PDF Preview

      </div>

    `,

  });
}

/* =========================================================
   ACTIVITY FEED
========================================================= */

function openActivityFeed(){

  openModal({

    title:
      'Activité récente',

    content:`

      <div class="
        fp-list
      ">

        <div class="
          fp-listItem
        ">

          <div>

            <div class="
              fp-listTitle
            ">

              Nouveau report généré

            </div>

            <div class="
              fp-listText
            ">

              Il y a 2 minutes

            </div>

          </div>

        </div>

        <div class="
          fp-listItem
        ">

          <div>

            <div class="
              fp-listTitle
            ">

              Infrastructure stable

            </div>

            <div class="
              fp-listText
            ">

              Monitoring OK

            </div>

          </div>

        </div>

      </div>

    `,

  });
}

/* =========================================================
   SEARCH ENGINE
========================================================= */

function performGlobalSearch(query=''){

  if(!query){

    return routes.map(route => ({

      title:route.label,

      key:route.key,

      type:'Page',

    }));
  }

  const lower =
    query.toLowerCase();

  return routes

    .filter(route =>

      route.label
        .toLowerCase()
        .includes(lower)

    )

    .map(route => ({

      title:route.label,

      key:route.key,

      type:'Page',

    }));
}

/* =========================================================
   READY
========================================================= */

console.log(
  'Core helpers ready'
);
/* =========================================================
   FINAL TOASTS / MODALS / OVERLAYS
========================================================= */

/* =========================================================
   TOAST ROOT
========================================================= */

.fp-toastRoot{
  position:fixed;
  top:24px;
  right:24px;
  z-index:500;
  display:flex;
  flex-direction:column;
  gap:14px;
  pointer-events:none;
}

/* =========================================================
   TOAST
========================================================= */

.fp-toast{
  min-width:320px;
  max-width:420px;
  padding:18px 20px;
  border-radius:22px;
  backdrop-filter:blur(18px);
  border:
    1px solid
    rgba(255,255,255,.08);
  background:
    rgba(10,15,30,.92);
  color:white;
  box-shadow:
    0 24px 60px
    rgba(0,0,0,.35);
  opacity:0;
  transform:
    translateY(-10px)
    scale(.96);
  transition:.24s;
  pointer-events:auto;
}

.fp-toast.show{
  opacity:1;
  transform:
    translateY(0)
    scale(1);
}

.fp-toast.primary{
  border-color:
    rgba(47,91,255,.26);
}

.fp-toast.success{
  border-color:
    rgba(16,185,129,.24);
}

.fp-toast.warning{
  border-color:
    rgba(245,158,11,.24);
}

.fp-toast.danger{
  border-color:
    rgba(239,68,68,.24);
}

.fp-toastText{
  line-height:1.6;
  font-weight:600;
}

/* =========================================================
   MODAL OVERLAY
========================================================= */

.fp-modalOverlay{
  position:fixed;
  inset:0;
  background:
    rgba(3,6,14,.72);
  backdrop-filter:blur(8px);
  display:flex;
  align-items:center;
  justify-content:center;
  padding:24px;
  z-index:400;
  animation:
    fpFadeOverlay .18s ease;
}

@keyframes fpFadeOverlay{

  from{
    opacity:0;
  }

  to{
    opacity:1;
  }
}

/* =========================================================
   MODAL
========================================================= */

.fp-modal{
  width:min(720px,100%);
  max-height:92vh;
  overflow:auto;
  border-radius:30px;
  background:
    linear-gradient(
      180deg,
      rgba(18,25,45,.98),
      rgba(10,16,30,.98)
    );
  border:
    1px solid
    rgba(255,255,255,.08);
  box-shadow:
    0 30px 80px
    rgba(0,0,0,.45);
  animation:
    fpModalIn .22s ease;
}

.fp-modal.large{
  width:min(1200px,100%);
}

@keyframes fpModalIn{

  from{
    opacity:0;
    transform:
      translateY(10px)
      scale(.97);
  }

  to{
    opacity:1;
    transform:
      translateY(0)
      scale(1);
  }
}

/* =========================================================
   MODAL HEADER
========================================================= */

.fp-modalHeader{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:20px;
  padding:24px 26px;
  border-bottom:
    1px solid
    rgba(255,255,255,.06);
}

.fp-modalTitle{
  font-size:24px;
  font-weight:800;
}

/* =========================================================
   MODAL BODY
========================================================= */

.fp-modalBody{
  padding:26px;
}

/* =========================================================
   MODAL CLOSE
========================================================= */

.fp-modalClose{
  width:44px;
  height:44px;
  border:none;
  border-radius:14px;
  background:
    rgba(255,255,255,.06);
  color:white;
  cursor:pointer;
  transition:.18s;
  font-size:16px;
}

.fp-modalClose:hover{
  background:
    rgba(255,255,255,.12);
}

/* =========================================================
   OVERLAY BLUR
========================================================= */

.fpOverlay{
  position:fixed;
  inset:0;
  background:
    rgba(0,0,0,.4);
  backdrop-filter:blur(8px);
  z-index:160;
  opacity:0;
  pointer-events:none;
  transition:.2s;
}

.fpOverlay.active{
  opacity:1;
  pointer-events:auto;
}

/* =========================================================
   COMMAND SEARCH
========================================================= */

.fp-commandPalette{
  display:flex;
  flex-direction:column;
  gap:14px;
}

.fp-commandInput{
  width:100%;
  border:none;
  outline:none;
  background:
    rgba(255,255,255,.05);
  border:
    1px solid
    rgba(255,255,255,.06);
  color:white;
  padding:18px;
  border-radius:18px;
  font-size:15px;
}

.fp-commandInput::placeholder{
  color:#8ea3d4;
}

/* =========================================================
   SEARCH RESULTS
========================================================= */

.fp-searchResults{
  display:flex;
  flex-direction:column;
  gap:12px;
  margin-top:20px;
}

/* =========================================================
   SYSTEM HEALTH
========================================================= */

.fp-systemHealth{
  display:flex;
  align-items:center;
  gap:14px;
  padding:14px 18px;
  border-radius:999px;
  background:
    rgba(47,91,255,.10);
  border:
    1px solid
    rgba(47,91,255,.18);
}

.fp-systemHealthScore{
  width:42px;
  height:42px;
  border-radius:999px;
  display:flex;
  align-items:center;
  justify-content:center;
  background:
    linear-gradient(
      135deg,
      #2f5bff,
      #5f84ff
    );
  font-weight:800;
}

.fp-systemHealthText{
  font-size:13px;
  color:#c6d5ff;
  font-weight:700;
}

/* =========================================================
   PERFORMANCE BADGE
========================================================= */

.fp-performanceBadge{
  display:flex;
  align-items:center;
  gap:10px;
  padding:12px 16px;
  border-radius:999px;
  background:
    rgba(255,255,255,.05);
  border:
    1px solid
    rgba(255,255,255,.06);
  font-size:13px;
  color:#cbd7f5;
}

/* =========================================================
   RESPONSIVE
========================================================= */

@media(max-width:980px){

  .fp-toastRoot{
    top:14px;
    right:14px;
    left:14px;
  }

  .fp-toast{
    min-width:unset;
    width:100%;
  }

  .fp-modal{
    border-radius:24px;
  }

  .fp-modalHeader{
    padding:20px;
  }

  .fp-modalBody{
    padding:20px;
  }

  .fp-modalTitle{
    font-size:20px;
  }
}

/* =========================================================
   SMALL MOBILE
========================================================= */

@media(max-width:640px){

  .fp-modalOverlay{
    padding:12px;
  }

  .fp-modal{
    border-radius:20px;
  }

  .fp-systemHealth{
    display:none;
  }

  .fp-userStatus{
    display:none;
  }
}
/* =========================================================
   FINAL REALTIME & PERFORMANCE ENGINE
========================================================= */

/* =========================================================
   REALTIME STATE
========================================================= */

const realtime = {

  connected:true,

  latency:82,

  lastHeartbeat:
    Date.now(),

  incidents:0,

  cpu:42,

  ram:58,

  network:74,

};

/* =========================================================
   PERFORMANCE STATE
========================================================= */

const performanceState = {

  fps:60,

  renderTime:12,

  memory:42,

  requests:0,

};

/* =========================================================
   HEARTBEAT
========================================================= */

function startRealtimeEngine(){

  setInterval(() => {

    realtime.lastHeartbeat =
      Date.now();

    realtime.latency =
      random(42,140);

    realtime.cpu =
      random(24,72);

    realtime.ram =
      random(38,82);

    realtime.network =
      random(40,98);

    performanceState.requests++;

    if(

      Math.random() > .92

    ){

      realtime.incidents++;
    }

    updateRealtimeWidgets();

  }, 4000);
}

/* =========================================================
   UPDATE WIDGETS
========================================================= */

function updateRealtimeWidgets(){

  const latency =
    qs('#fpRealtimeLatency');

  if(latency){

    latency.textContent =

      `${realtime.latency}ms`;
  }

  const requests =
    qs('#fpRealtimeRequests');

  if(requests){

    requests.textContent =

      formatNumber(

        performanceState.requests

      );
  }
}

/* =========================================================
   REALTIME BADGE
========================================================= */

function renderRealtimeBadge(){

  return `

    <div class="
      fp-liveBadge
    ">

      <div class="
        fp-liveDot
      "></div>

      <span>

        LIVE

      </span>

    </div>

  `;
}

/* =========================================================
   PERFORMANCE BADGE
========================================================= */

function renderPerformanceBadge(){

  return `

    <div class="
      fp-performanceBadge
    ">

      <span>

        ${
          realtime.latency
        }ms

      </span>

    </div>

  `;
}

/* =========================================================
   REALTIME PAGE
========================================================= */

function renderRealtimePage(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientSuccess
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Realtime Infrastructure

              </div>

              <div class="
                fp-sectionText
              ">

                Monitoring live,
                heartbeat,
                performances,
                réseau
                et infrastructure globale.

              </div>

            </div>

            <div class="
              fp-liveBadge
            ">

              <div class="
                fp-liveDot
              "></div>

              <span>

                CONNECTED

              </span>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'Latency',

          value:
            realtime.latency + 'ms',

          trend:'+2%',

          icon:'⚡',

        })}

        ${createStatCard({

          title:'CPU',

          value:
            realtime.cpu + '%',

          trend:'+1%',

          icon:'🧠',

        })}

        ${createStatCard({

          title:'RAM',

          value:
            realtime.ram + '%',

          trend:'-2%',

          icon:'💾',

        })}

        ${createStatCard({

          title:'Network',

          value:
            realtime.network + '%',

          trend:'+4%',

          icon:'🌐',

        })}

      </div>

      <!-- LIVE CHARTS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Infrastructure Live

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                24,
                38,
                44,
                58,
                62,
                72,
                realtime.cpu,

              ],

              height:280,

            })}

          </div>

        </div>

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Traffic Realtime

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                18,
                28,
                40,
                58,
                74,
                82,
                realtime.network,

              ],

              height:280,

            })}

          </div>

        </div>

      </div>

      <!-- TABLE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Live Infrastructure Metrics

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Metric',
              'Value',
              'Status',

            ],

            rows:[

              [

                'Latency',
                realtime.latency + 'ms',
                'Healthy',

              ],

              [

                'CPU',
                realtime.cpu + '%',
                'Stable',

              ],

              [

                'RAM',
                realtime.ram + '%',
                'Stable',

              ],

              [

                'Network',
                realtime.network + '%',
                'Healthy',

              ],

            ],

          })}

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   ROUTE
========================================================= */

routes.push({

  key:'realtime',

  label:'Realtime',

  icon:'🟢',

});

/* =========================================================
   ROUTER PATCH
========================================================= */

const previousRealtimeRouter =
  renderPage;

renderPage = function(){

  if(

    state.route
    ===
    'realtime'

  ){

    return renderRealtimePage();
  }

  return previousRealtimeRouter();
};

/* =========================================================
   ENGINE START
========================================================= */

startRealtimeEngine();

/* =========================================================
   READY
========================================================= */

console.log(
  'Realtime engine active'
);
/* =========================================================
   FINAL API & DEVELOPER CENTER
========================================================= */

/* =========================================================
   API KEYS STATE
========================================================= */

const apiState = {

  keys:[

    {

      id:
        uid('key'),

      name:
        'Production API',

      key:
        'fp_live_xxxxxxxxx',

      createdAt:
        Date.now(),

      lastUsed:
        '2 min',

    },

    {

      id:
        uid('key'),

      name:
        'Development API',

      key:
        'fp_test_xxxxxxxxx',

      createdAt:
        Date.now(),

      lastUsed:
        '12 min',

    },

  ],

};

/* =========================================================
   CREATE API KEY
========================================================= */

function createApiKey(){

  apiState.keys.unshift({

    id:
      uid('key'),

    name:
      'New API Key',

    key:
      `fp_live_${
        Math.random()
          .toString(36)
          .slice(2,18)
      }`,

    createdAt:
      Date.now(),

    lastUsed:
      'Never',

  });

  render();

  toast(

    'Nouvelle clé API créée',

    'success'

  );
}

/* =========================================================
   DELETE API KEY
========================================================= */

function deleteApiKey(id){

  apiState.keys =

    apiState.keys.filter(

      key =>

        key.id !== id

    );

  render();

  toast(

    'Clé API supprimée',

    'danger'

  );
}

/* =========================================================
   API PAGE
========================================================= */

function renderApiPage(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Developer Center

              </div>

              <div class="
                fp-sectionText
              ">

                API,
                webhooks,
                infrastructure,
                SDK
                et intégrations FlowPoint.

              </div>

            </div>

            <button

              id="
                fpCreateApiKey
              "

              class="
                fp-btn
                fp-btnPrimary
              "
            >

              Nouvelle clé API

            </button>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'API Requests',

          value:'2.4M',

          trend:'+18%',

          icon:'🔌',

        })}

        ${createStatCard({

          title:'Webhooks',

          value:'182k',

          trend:'+12%',

          icon:'⚡',

        })}

        ${createStatCard({

          title:'Latency',

          value:'84ms',

          trend:'-2%',

          icon:'🛰️',

        })}

        ${createStatCard({

          title:'Success Rate',

          value:'99.98%',

          trend:'+1%',

          icon:'✅',

        })}

      </div>

      <!-- API KEYS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            API Keys

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-list
          ">

            ${apiState.keys.map(key => `

              <div class="
                fp-listItem
              ">

                <div>

                  <div class="
                    fp-listTitle
                  ">

                    ${key.name}

                  </div>

                  <div class="
                    fp-listText
                  ">

                    ${key.key}

                  </div>

                </div>

                <div class="
                  fp-flex
                  fp-alignCenter
                  fp-gap12
                ">

                  <div class="
                    fp-muted
                    fp-textSm
                  ">

                    ${key.lastUsed}

                  </div>

                  <button

                    class="
                      fp-btn
                      fp-btnGhost
                    "

                    data-copy-api="
                      ${key.key}
                    "
                  >

                    Copier

                  </button>

                  <button

                    class="
                      fp-btn
                      fp-btnGhost
                    "

                    data-delete-api="
                      ${key.id}
                    "
                  >

                    Supprimer

                  </button>

                </div>

              </div>

            `).join('')}

          </div>

        </div>

      </div>

      <!-- WEBHOOKS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Webhooks

          </div>

          <div class="
            fp-cardBody
          ">

            ${renderDataTable({

              columns:[

                'Endpoint',
                'Status',
                'Latency',

              ],

              rows:[

                [

                  '/stripe/webhook',
                  'ONLINE',
                  '64ms',

                ],

                [

                  '/monitor/events',
                  'ONLINE',
                  '82ms',

                ],

                [

                  '/reports/export',
                  'ONLINE',
                  '94ms',

                ],

              ],

            })}

          </div>

        </div>

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            SDK & Resources

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-list
            ">

              <div class="
                fp-listItem
              ">

                <div>

                  <div class="
                    fp-listTitle
                  ">

                    JavaScript SDK

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Intégration frontend complète.

                  </div>

                </div>

              </div>

              <div class="
                fp-listItem
              ">

                <div>

                  <div class="
                    fp-listTitle
                  ">

                    REST API

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Infrastructure API scalable.

                  </div>

                </div>

              </div>

              <div class="
                fp-listItem
              ">

                <div>

                  <div class="
                    fp-listTitle
                  ">

                    Webhooks

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Temps réel & automations.

                  </div>

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

      <!-- CODE EXAMPLE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          API Example

        </div>

        <div class="
          fp-cardBody
        ">

<pre class="fp-codeBlock">
fetch('https://api.flowpoint.pro/v1/audits', {
  headers: {
    Authorization: 'Bearer fp_live_xxxxx'
  }
})
.then(res => res.json())
.then(console.log)
</pre>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   EVENTS
========================================================= */

function bindApiEvents(){

  const create =
    qs('#fpCreateApiKey');

  if(create){

    create.onclick =
      createApiKey;
  }

  qsa('[data-delete-api]')
    .forEach(button => {

      button.onclick = () => {

        deleteApiKey(

          button.dataset
            .deleteApi

        );
      };
    });

  qsa('[data-copy-api]')
    .forEach(button => {

      button.onclick = async () => {

        try{

          await navigator.clipboard
            .writeText(

              button.dataset
                .copyApi

            );

          toast(

            'Clé API copiée',

            'success'

          );

        }catch(err){

          toast(

            'Impossible de copier',

            'danger'

          );
        }
      };
    });
}

/* =========================================================
   EVENTS PATCH
========================================================= */

const previousApiBind =
  bindEvents;

bindEvents = function(){

  previousApiBind();

  bindApiEvents();
};

/* =========================================================
   READY
========================================================= */

console.log(
  'Developer center ready'
);
/* =========================================================
   FINAL DEVELOPER / API / ADVANCED UI CSS
========================================================= */

/* =========================================================
   CODE BLOCK
========================================================= */

.fp-codeBlock{
  width:100%;
  overflow:auto;
  border-radius:24px;
  padding:24px;
  background:
    linear-gradient(
      180deg,
      #050816,
      #0b1222
    );
  border:
    1px solid
    rgba(255,255,255,.06);
  color:#d7e3ff;
  font-size:14px;
  line-height:1.8;
  font-family:
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Monaco,
    Consolas,
    monospace;
}

/* =========================================================
   SIDEBAR ICON
========================================================= */

.fp-sidebarIcon{
  width:22px;
  display:flex;
  align-items:center;
  justify-content:center;
  flex-shrink:0;
}

/* =========================================================
   SIDEBAR NAV
========================================================= */

.fp-sidebarNav{
  display:flex;
  flex-direction:column;
  gap:10px;
}

/* =========================================================
   MAIN
========================================================= */

.fp-main{
  flex:1;
  min-width:0;
  display:flex;
  flex-direction:column;
}

/* =========================================================
   CONTENT
========================================================= */

.fp-content{
  flex:1;
  display:flex;
  flex-direction:column;
  gap:24px;
}

/* =========================================================
   BADGES
========================================================= */

.fp-badge{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  padding:10px 14px;
  border-radius:999px;
  font-size:12px;
  font-weight:800;
  letter-spacing:.3px;
}

.fp-badgePrimary{
  background:
    rgba(47,91,255,.16);
  color:#9bb5ff;
}

.fp-badgeSuccess{
  background:
    rgba(16,185,129,.14);
  color:#85efc0;
}

.fp-badgeWarning{
  background:
    rgba(245,158,11,.14);
  color:#ffd28a;
}

.fp-badgeDanger{
  background:
    rgba(239,68,68,.14);
  color:#ff9d9d;
}

/* =========================================================
   BUTTONS
========================================================= */

.fp-btn{
  position:relative;
  overflow:hidden;
}

.fp-btn::before{
  content:'';
  position:absolute;
  inset:0;
  background:
    linear-gradient(
      135deg,
      rgba(255,255,255,.18),
      transparent 40%
    );
  opacity:0;
  transition:.2s;
}

.fp-btn:hover::before{
  opacity:1;
}

/* =========================================================
   BUTTON GHOST
========================================================= */

.fp-btnGhost{
  background:
    rgba(255,255,255,.05);
  border:
    1px solid
    rgba(255,255,255,.06);
  color:white;
}

/* =========================================================
   BUTTON PRIMARY
========================================================= */

.fp-btnPrimary{
  background:
    linear-gradient(
      135deg,
      #2f5bff,
      #5b84ff
    );
  color:white;
  border:none;
}

/* =========================================================
   BUTTON DANGER
========================================================= */

.fp-btnDanger{
  background:
    linear-gradient(
      135deg,
      #dc2626,
      #ef4444
    );
  color:white;
}

/* =========================================================
   INPUTS
========================================================= */

.fp-input,
.fp-textarea,
.fp-select{
  width:100%;
  border-radius:18px;
  padding:16px 18px;
  background:
    rgba(255,255,255,.05);
  border:
    1px solid
    rgba(255,255,255,.06);
  color:white;
  outline:none;
  transition:.2s;
  font-size:14px;
}

.fp-input:hover,
.fp-textarea:hover,
.fp-select:hover{
  border-color:
    rgba(255,255,255,.10);
}

/* =========================================================
   TABLE
========================================================= */

.fp-table{
  border-collapse:collapse;
}

.fp-table th{
  position:sticky;
  top:0;
  background:
    rgba(10,16,30,.98);
  z-index:4;
}

.fp-table td,
.fp-table th{
  white-space:nowrap;
}

/* =========================================================
   CARDS
========================================================= */

.fp-card{
  backdrop-filter:
    blur(16px);
}

.fp-cardHeader{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:20px;
}

/* =========================================================
   PAGE ANIMATION
========================================================= */

.fp-page{
  animation:
    fpPageIn .22s ease;
}

@keyframes fpPageIn{

  from{
    opacity:0;
    transform:
      translateY(8px);
  }

  to{
    opacity:1;
    transform:
      translateY(0);
  }
}

/* =========================================================
   ADVANCED SHADOWS
========================================================= */

.fp-card{
  box-shadow:
    0 24px 60px
    rgba(0,0,0,.28);
}

.fp-card:hover{
  box-shadow:
    0 30px 70px
    rgba(0,0,0,.34);
}

/* =========================================================
   PREMIUM GLOW
========================================================= */

.fp-gradientPrimary{
  position:relative;
  overflow:hidden;
}

.fp-gradientPrimary::after{
  content:'';
  position:absolute;
  inset:0;
  background:
    radial-gradient(
      circle at top right,
      rgba(255,255,255,.18),
      transparent 32%
    );
  pointer-events:none;
}

/* =========================================================
   TOPBAR PREMIUM
========================================================= */

.fp-topbar{
  position:sticky;
  top:0;
  z-index:50;
}

/* =========================================================
   SIDEBAR PREMIUM
========================================================= */

.fp-sidebar{
  box-shadow:
    10px 0 40px
    rgba(0,0,0,.22);
}

/* =========================================================
   MODAL PREMIUM
========================================================= */

.fp-modal{
  backdrop-filter:
    blur(18px);
}

/* =========================================================
   RESPONSIVE LARGE
========================================================= */

@media(max-width:1280px){

  .fp-sidebar{
    width:260px;
  }
}

/* =========================================================
   RESPONSIVE TABLET
========================================================= */

@media(max-width:980px){

  .fp-sidebar{
    border-right:
      1px solid
      rgba(255,255,255,.08);
  }

  .fp-topbar{
    padding:14px;
  }

  .fp-content{
    padding:14px;
  }

  .fp-card{
    border-radius:22px;
  }
}

/* =========================================================
   RESPONSIVE MOBILE
========================================================= */

@media(max-width:640px){

  .fp-page{
    gap:18px;
  }

  .fp-card{
    border-radius:20px;
  }

  .fp-kpiCard{
    border-radius:18px;
  }

  .fp-listItem{
    padding:16px;
  }

  .fp-btn{
    min-height:46px;
  }

  .fp-input,
  .fp-textarea,
  .fp-select{
    min-height:50px;
  }
}

/* =========================================================
   IOS SAFE AREA
========================================================= */

@supports(padding:max(0px)){

  body{
    padding-left:
      env(safe-area-inset-left);

    padding-right:
      env(safe-area-inset-right);

    padding-bottom:
      env(safe-area-inset-bottom);
  }
}

/* =========================================================
   FINAL ENTERPRISE FINISH
========================================================= */

.fp-dashboardShell{
  isolation:isolate;
}

.fp-dashboardShell::before{
  content:'';
  position:fixed;
  inset:0;
  background:
    radial-gradient(
      circle at 10% 10%,
      rgba(47,91,255,.12),
      transparent 22%
    ),
    radial-gradient(
      circle at 90% 90%,
      rgba(91,130,255,.08),
      transparent 18%
    );
  pointer-events:none;
  z-index:-1;
}
/* =========================================================
   FINAL CLIENT PORTAL ENGINE
========================================================= */

/* =========================================================
   CLIENT STATE
========================================================= */

const clientPortalState = {

  clients:[

    {

      id:
        uid('client'),

      name:
        'Enterprise Group',

      plan:
        'Ultra',

      status:
        'active',

      revenue:
        4800,

      growth:
        '+22%',

    },

    {

      id:
        uid('client'),

      name:
        'Local Agency',

      plan:
        'Pro',

      status:
        'active',

      revenue:
        1800,

      growth:
        '+12%',

    },

    {

      id:
        uid('client'),

      name:
        'Startup Vision',

      plan:
        'Standard',

      status:
        'warning',

      revenue:
        420,

      growth:
        '-4%',

    },

  ],

};

/* =========================================================
   CLIENT PAGE
========================================================= */

function renderClientPortal(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Client Portal

              </div>

              <div class="
                fp-sectionText
              ">

                Gestion clients,
                revenus,
                rétention,
                accès
                et collaboration premium.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Exports

              </button>

              <button

                id="
                  fpAddClient
                "

                class="
                  fp-btn
                  fp-btnPrimary
                "
              >

                Nouveau client

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'Clients',

          value:
            clientPortalState
              .clients.length,

          trend:'+8%',

          icon:'👥',

        })}

        ${createStatCard({

          title:'MRR',

          value:
            formatCurrency(7020),

          trend:'+18%',

          icon:'💳',

        })}

        ${createStatCard({

          title:'Retention',

          value:'92%',

          trend:'+4%',

          icon:'📈',

        })}

        ${createStatCard({

          title:'Expansion',

          value:'+28%',

          trend:'+6%',

          icon:'🚀',

        })}

      </div>

      <!-- CLIENT GRID -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        ${clientPortalState
          .clients
          .map(client => `

            <div class="
              fp-card
            ">

              <div class="
                fp-cardBody
              ">

                <div class="
                  fp-flex
                  fp-alignCenter
                  fp-justifyBetween
                ">

                  <div class="
                    fp-userMiniAvatar
                  ">

                    ${
                      client.name
                        .slice(0,1)
                        .toUpperCase()
                    }

                  </div>

                  <div class="
                    fp-badge
                    ${
                      client.status
                        === 'active'

                        ? 'fp-badgeSuccess'

                        : 'fp-badgeWarning'
                    }
                  ">

                    ${client.status}

                  </div>

                </div>

                <div class="
                  fp-sectionTitle
                  fp-mt24
                " style="
                  font-size:24px;
                ">

                  ${client.name}

                </div>

                <div class="
                  fp-sectionText
                ">

                  Plan
                  ${client.plan}

                </div>

                <div class="
                  fp-grid2
                  fp-mt24
                ">

                  <div class="
                    fp-kpiCard
                  ">

                    <div class="
                      fp-kpiLabel
                    ">

                      Revenue

                    </div>

                    <div class="
                      fp-kpiValue
                    ">

                      ${
                        formatCurrency(
                          client.revenue
                        )
                      }

                    </div>

                  </div>

                  <div class="
                    fp-kpiCard
                  ">

                    <div class="
                      fp-kpiLabel
                    ">

                      Growth

                    </div>

                    <div class="
                      fp-kpiValue
                    ">

                      ${client.growth}

                    </div>

                  </div>

                </div>

                <div class="
                  fp-flex
                  fp-gap12
                  fp-mt24
                ">

                  <button class="
                    fp-btn
                    fp-btnGhost
                  ">

                    Workspace

                  </button>

                  <button class="
                    fp-btn
                    fp-btnPrimary
                  ">

                    Ouvrir

                  </button>

                </div>

              </div>

            </div>

          `).join('')}

      </div>

      <!-- CLIENT TABLE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            Client Revenue Tracking

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Client',
              'Plan',
              'Revenue',
              'Growth',
              'Status',

            ],

            rows:

              clientPortalState
                .clients
                .map(client => [

                  client.name,
                  client.plan,
                  formatCurrency(
                    client.revenue
                  ),
                  client.growth,
                  client.status,

                ]),

          })}

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Client Insights

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Upsell Opportunity

                </div>

                <div class="
                  fp-listText
                ">

                  Plusieurs clients prêts pour upgrade Ultra.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Retention Risk

                </div>

                <div class="
                  fp-listText
                ">

                  Startup Vision montre baisse engagement.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Growth Potential

                </div>

                <div class="
                  fp-listText
                ">

                  Enterprise Group en forte croissance.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   EVENTS
========================================================= */

function bindClientEvents(){

  const button =
    qs('#fpAddClient');

  if(button){

    button.onclick = () => {

      openModal({

        title:
          'Nouveau client',

        content:`

          <div class="
            fp-flex
            fp-flexCol
            fp-gap20
          ">

            <input
              class="
                fp-input
              "
              placeholder="
                Nom client
              "
            />

            <select class="
              fp-select
            ">

              <option>
                Standard
              </option>

              <option>
                Pro
              </option>

              <option>
                Ultra
              </option>

            </select>

            <button

              id="
                fpSaveClient
              "

              class="
                fp-btn
                fp-btnPrimary
              "
            >

              Créer client

            </button>

          </div>

        `,

      });

      setTimeout(() => {

        qs('#fpSaveClient')
          .onclick = () => {

            toast(

              'Client créé',

              'success'

            );

            closeModal();
          };

      }, 60);
    };
  }
}

/* =========================================================
   EVENTS PATCH
========================================================= */

const previousClientBind =
  bindEvents;

bindEvents = function(){

  previousClientBind();

  bindClientEvents();
};

/* =========================================================
   READY
========================================================= */

console.log(
  'Client portal ready'
);
/* =========================================================
   FINAL WORKSPACE ENGINE
========================================================= */

/* =========================================================
   WORKSPACE STATE
========================================================= */

const workspaceState = {

  files:[

    {

      name:
        'Executive Report.pdf',

      type:
        'PDF',

      size:
        '4.2 MB',

      updated:
        '2 min',

    },

    {

      name:
        'SEO-Audit.xlsx',

      type:
        'XLSX',

      size:
        '1.8 MB',

      updated:
        '12 min',

    },

    {

      name:
        'Infrastructure-Logs.zip',

      type:
        'ZIP',

      size:
        '12 MB',

      updated:
        '1 h',

    },

  ],

};

/* =========================================================
   WORKSPACE PAGE
========================================================= */

function renderWorkspaceOverview(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Workspace Hub

              </div>

              <div class="
                fp-sectionText
              ">

                Documents,
                collaboration,
                assets,
                exports
                et organisation entreprise.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Shared Links

              </button>

              <button

                id="
                  fpUploadWorkspaceFile
                "

                class="
                  fp-btn
                  fp-btnPrimary
                "
              >

                Upload

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'Files',

          value:'842',

          trend:'+18%',

          icon:'📁',

        })}

        ${createStatCard({

          title:'Storage',

          value:'182GB',

          trend:'+8%',

          icon:'💾',

        })}

        ${createStatCard({

          title:'Exports',

          value:'4.2k',

          trend:'+22%',

          icon:'📄',

        })}

        ${createStatCard({

          title:'Shared Links',

          value:'128',

          trend:'+6%',

          icon:'🔗',

        })}

      </div>

      <!-- FILES -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            Workspace Files

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-list
          ">

            ${workspaceState.files.map(file => `

              <div class="
                fp-listItem
              ">

                <div class="
                  fp-flex
                  fp-alignCenter
                  fp-gap20
                ">

                  <div class="
                    fp-userMiniAvatar
                  ">

                    ${
                      file.type
                        .slice(0,1)
                    }

                  </div>

                  <div>

                    <div class="
                      fp-listTitle
                    ">

                      ${file.name}

                    </div>

                    <div class="
                      fp-listText
                    ">

                      ${file.size}
                      •
                      ${file.updated}

                    </div>

                  </div>

                </div>

                <div class="
                  fp-flex
                  fp-gap12
                ">

                  <button class="
                    fp-btn
                    fp-btnGhost
                  ">

                    Share

                  </button>

                  <button class="
                    fp-btn
                    fp-btnPrimary
                  ">

                    Open

                  </button>

                </div>

              </div>

            `).join('')}

          </div>

        </div>

      </div>

      <!-- GRID -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- STORAGE -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Storage Usage

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                22,
                28,
                34,
                48,
                58,
                68,
                82,

              ],

              height:260,

            })}

          </div>

        </div>

        <!-- ACTIVITY -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Workspace Activity

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-timeline
            ">

              <div class="
                fp-timelineItem
              ">

                <div class="
                  fp-timelineDot
                  success
                "></div>

                <div class="
                  fp-timelineCard
                ">

                  <div class="
                    fp-timelineTitle
                  ">

                    Nouveau report exporté

                  </div>

                  <div class="
                    fp-timelineText
                  ">

                    Export PDF envoyé au client.

                  </div>

                </div>

              </div>

              <div class="
                fp-timelineItem
              ">

                <div class="
                  fp-timelineDot
                  primary
                "></div>

                <div class="
                  fp-timelineCard
                ">

                  <div class="
                    fp-timelineTitle
                  ">

                    Upload infrastructure logs

                  </div>

                  <div class="
                    fp-timelineText
                  ">

                    Logs backend synchronisés.

                  </div>

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Workspace Insights

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Storage Optimization

                </div>

                <div class="
                  fp-listText
                ">

                  Plusieurs fichiers compressables détectés.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Collaboration Growth

                </div>

                <div class="
                  fp-listText
                ">

                  Hausse partage documents équipe.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Export Activity

                </div>

                <div class="
                  fp-listText
                ">

                  Volume reports entreprise élevé.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   EVENTS
========================================================= */

function bindWorkspaceEvents(){

  const upload =
    qs('#fpUploadWorkspaceFile');

  if(upload){

    upload.onclick = () => {

      toast(

        'Upload démarré',

        'success'

      );
    };
  }
}

/* =========================================================
   EVENTS PATCH
========================================================= */

const previousWorkspaceBind =
  bindEvents;

bindEvents = function(){

  previousWorkspaceBind();

  bindWorkspaceEvents();
};

/* =========================================================
   READY
========================================================= */

console.log(
  'Workspace hub ready'
);
/* =========================================================
   FINAL ALERT CENTER ENGINE
========================================================= */

/* =========================================================
   ALERT STATE
========================================================= */

const alertCenterState = {

  alerts:[

    {

      id:
        uid('alert'),

      title:
        'CPU Spike Detected',

      level:
        'warning',

      text:
        'Infrastructure CPU usage elevated.',

      time:
        '2 min',

    },

    {

      id:
        uid('alert'),

      title:
        'SEO Opportunity',

      level:
        'success',

      text:
        'New local SEO expansion detected.',

      time:
        '8 min',

    },

    {

      id:
        uid('alert'),

      title:
        'API Latency Increase',

      level:
        'danger',

      text:
        'Latency threshold exceeded.',

      time:
        '14 min',

    },

    {

      id:
        uid('alert'),

      title:
        'Executive Report Generated',

      level:
        'primary',

      text:
        'New enterprise report exported.',

      time:
        '28 min',

    },

  ],

};

/* =========================================================
   ALERT PAGE
========================================================= */

function renderAlerts(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Alert Center

              </div>

              <div class="
                fp-sectionText
              ">

                Incidents,
                sécurité,
                infrastructure,
                SEO
                et événements critiques.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Historique

              </button>

              <button

                id="
                  fpMarkAlertsRead
                "

                class="
                  fp-btn
                  fp-btnPrimary
                "
              >

                Tout lire

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'Alerts',

          value:
            alertCenterState
              .alerts.length,

          trend:'+4%',

          icon:'🚨',

        })}

        ${createStatCard({

          title:'Critical',

          value:'2',

          trend:'+1%',

          icon:'🔥',

        })}

        ${createStatCard({

          title:'Resolved',

          value:'182',

          trend:'+12%',

          icon:'✅',

        })}

        ${createStatCard({

          title:'Realtime',

          value:'LIVE',

          trend:'+0%',

          icon:'🟢',

        })}

      </div>

      <!-- ALERTS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            Active Alerts

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-flexCol
            fp-gap16
          ">

            ${alertCenterState
              .alerts
              .map(alert => `

                <div class="
                  fp-alertItem
                ">

                  <div class="
                    fp-flex
                    fp-alignCenter
                    fp-gap20
                  ">

                    <div class="
                      fp-alertDot
                      ${alert.level}
                    "></div>

                    <div>

                      <div class="
                        fp-listTitle
                      ">

                        ${alert.title}

                      </div>

                      <div class="
                        fp-listText
                      ">

                        ${alert.text}

                      </div>

                    </div>

                  </div>

                  <div class="
                    fp-flex
                    fp-alignCenter
                    fp-gap16
                  ">

                    <div class="
                      fp-muted
                      fp-textSm
                    ">

                      ${alert.time}

                    </div>

                    <button

                      class="
                        fp-btn
                        fp-btnGhost
                      "

                      data-open-alert="
                        ${alert.id}
                      "
                    >

                      Ouvrir

                    </button>

                  </div>

                </div>

              `).join('')}

          </div>

        </div>

      </div>

      <!-- TIMELINE -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- INCIDENTS -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Incident Timeline

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-timeline
            ">

              <div class="
                fp-timelineItem
              ">

                <div class="
                  fp-timelineDot
                  danger
                "></div>

                <div class="
                  fp-timelineCard
                ">

                  <div class="
                    fp-timelineTitle
                  ">

                    API overload detected

                  </div>

                  <div class="
                    fp-timelineText
                  ">

                    Spike trafic infrastructure.

                  </div>

                  <div class="
                    fp-timelineTime
                  ">

                    14 minutes

                  </div>

                </div>

              </div>

              <div class="
                fp-timelineItem
              ">

                <div class="
                  fp-timelineDot
                  success
                "></div>

                <div class="
                  fp-timelineCard
                ">

                  <div class="
                    fp-timelineTitle
                  ">

                    Infrastructure stabilized

                  </div>

                  <div class="
                    fp-timelineText
                  ">

                    Services revenus à la normale.

                  </div>

                  <div class="
                    fp-timelineTime
                  ">

                    9 minutes

                  </div>

                </div>

              </div>

            </div>

          </div>

        </div>

        <!-- AI -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            AI Alert Insights

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-list
            ">

              <div class="
                fp-listItem
              ">

                <div>

                  <div class="
                    fp-listTitle
                  ">

                    Infrastructure Risk

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Plusieurs pics CPU détectés récemment.

                  </div>

                </div>

              </div>

              <div class="
                fp-listItem
              ">

                <div>

                  <div class="
                    fp-listTitle
                  ">

                    SEO Growth Signal

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Forte croissance locale observée.

                  </div>

                </div>

              </div>

              <div class="
                fp-listItem
              ">

                <div>

                  <div class="
                    fp-listTitle
                  ">

                    Security Stability

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Aucun incident sécurité critique.

                  </div>

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   EVENTS
========================================================= */

function bindAlertEvents(){

  const mark =
    qs('#fpMarkAlertsRead');

  if(mark){

    mark.onclick = () => {

      toast(

        'Toutes les alertes ont été marquées comme lues',

        'success'

      );
    };
  }

  qsa('[data-open-alert]')
    .forEach(button => {

      button.onclick = () => {

        openModal({

          title:
            'Alert Details',

          content:`

            <div class="
              fp-flex
              fp-flexCol
              fp-gap20
            ">

              <div class="
                fp-chartEmpty
              " style="
                height:220px;
              ">

                Alert Investigation Panel

              </div>

              <button class="
                fp-btn
                fp-btnPrimary
              ">

                Resolve Alert

              </button>

            </div>

          `,

        });
      };
    });
}

/* =========================================================
   EVENTS PATCH
========================================================= */

const previousAlertBind =
  bindEvents;

bindEvents = function(){

  previousAlertBind();

  bindAlertEvents();
};

/* =========================================================
   READY
========================================================= */

console.log(
  'Alert center ready'
);
/* =========================================================
   FINAL REPORT ENGINE
========================================================= */

/* =========================================================
   REPORT STATE
========================================================= */

const reportState = {

  reports:[

    {

      id:
        uid('report'),

      name:
        'Executive SEO Report',

      type:
        'SEO',

      client:
        'Enterprise Group',

      created:
        '2 min',

      size:
        '4.8 MB',

    },

    {

      id:
        uid('report'),

      name:
        'Infrastructure Monitoring',

      type:
        'Infrastructure',

      client:
        'Internal',

      created:
        '18 min',

      size:
        '8.2 MB',

    },

    {

      id:
        uid('report'),

      name:
        'Local SEO Analysis',

      type:
        'Local SEO',

      client:
        'Local Agency',

      created:
        '1 h',

      size:
        '2.4 MB',

    },

  ],

};

/* =========================================================
   REPORT PAGE
========================================================= */

function renderReports(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Executive Reports

              </div>

              <div class="
                fp-sectionText
              ">

                Exports PDF,
                analytics,
                SEO,
                monitoring
                et rapports enterprise.

              </div>

            </div>

            <div class="
              fp-flex
              fp-gap12
            ">

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Historique

              </button>

              <button

                id="
                  fpGenerateReport
                "

                class="
                  fp-btn
                  fp-btnPrimary
                "
              >

                Générer report

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'Reports',

          value:'4.2k',

          trend:'+22%',

          icon:'📄',

        })}

        ${createStatCard({

          title:'Exports',

          value:'182GB',

          trend:'+14%',

          icon:'📦',

        })}

        ${createStatCard({

          title:'PDF Generated',

          value:'1.8k',

          trend:'+8%',

          icon:'🧾',

        })}

        ${createStatCard({

          title:'Automation',

          value:'LIVE',

          trend:'+0%',

          icon:'⚡',

        })}

      </div>

      <!-- REPORT LIST -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            Generated Reports

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-list
          ">

            ${reportState.reports
              .map(report => `

                <div class="
                  fp-listItem
                ">

                  <div class="
                    fp-flex
                    fp-alignCenter
                    fp-gap20
                  ">

                    <div class="
                      fp-userMiniAvatar
                    ">

                      📄

                    </div>

                    <div>

                      <div class="
                        fp-listTitle
                      ">

                        ${report.name}

                      </div>

                      <div class="
                        fp-listText
                      ">

                        ${report.client}
                        •
                        ${report.size}
                        •
                        ${report.created}

                      </div>

                    </div>

                  </div>

                  <div class="
                    fp-flex
                    fp-gap12
                  ">

                    <button

                      class="
                        fp-btn
                        fp-btnGhost
                      "

                      data-preview-report="
                        ${report.id}
                      "
                    >

                      Preview

                    </button>

                    <button class="
                      fp-btn
                      fp-btnPrimary
                    ">

                      Download

                    </button>

                  </div>

                </div>

              `).join('')}

          </div>

        </div>

      </div>

      <!-- GRID -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- REPORT ANALYTICS -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Report Activity

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                12,
                18,
                28,
                44,
                62,
                74,
                92,

              ],

              height:260,

            })}

          </div>

        </div>

        <!-- REPORT TYPES -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Report Types

          </div>

          <div class="
            fp-cardBody
          ">

            ${renderDataTable({

              columns:[

                'Type',
                'Reports',
                'Growth',

              ],

              rows:[

                [

                  'SEO',
                  '1.8k',
                  '+22%',

                ],

                [

                  'Infrastructure',
                  '842',
                  '+14%',

                ],

                [

                  'Local SEO',
                  '492',
                  '+18%',

                ],

                [

                  'Executive',
                  '228',
                  '+34%',

                ],

              ],

            })}

          </div>

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Report Insights

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Executive Reports

                </div>

                <div class="
                  fp-listText
                ">

                  Forte demande reports enterprise.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Automation Growth

                </div>

                <div class="
                  fp-listText
                ">

                  Exports automatiques en hausse.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Client Engagement

                </div>

                <div class="
                  fp-listText
                ">

                  Les PDF augmentent la rétention client.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   EVENTS
========================================================= */

function bindReportEvents(){

  const generate =
    qs('#fpGenerateReport');

  if(generate){

    generate.onclick = () => {

      toast(

        'Génération du report démarrée',

        'success'

      );

      setTimeout(() => {

        toast(

          'Executive report généré',

          'primary'

        );

      }, 1800);
    };
  }

  qsa('[data-preview-report]')
    .forEach(button => {

      button.onclick = () => {

        openPdfPreview(
          'Executive Report'
        );
      };
    });
}

/* =========================================================
   EVENTS PATCH
========================================================= */

const previousReportBind =
  bindEvents;

bindEvents = function(){

  previousReportBind();

  bindReportEvents();
};

/* =========================================================
   READY
========================================================= */

console.log(
  'Report engine ready'
);
/* =========================================================
   FINAL BILLING ENGINE
========================================================= */

/* =========================================================
   BILLING STATE
========================================================= */

const billingState = {

  currentPlan:
    'Ultra',

  monthlyRevenue:
    48220,

  invoices:[

    {

      id:
        'INV-2026-001',

      amount:
        249,

      status:
        'paid',

      date:
        '12 May 2026',

    },

    {

      id:
        'INV-2026-002',

      amount:
        89,

      status:
        'paid',

      date:
        '04 May 2026',

    },

    {

      id:
        'INV-2026-003',

      amount:
        520,

      status:
        'pending',

      date:
        '28 Apr 2026',

    },

  ],

};

/* =========================================================
   BILLING PAGE
========================================================= */

function renderBilling(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Billing & Revenue

              </div>

              <div class="
                fp-sectionText
              ">

                Abonnements,
                revenus,
                facturation,
                Stripe
                et analytics financières.

              </div>

            </div>

            <button

              id="
                fpOpenBillingPortal
              "

              class="
                fp-btn
                fp-btnPrimary
              "
            >

              Billing Portal

            </button>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'MRR',

          value:
            formatCurrency(
              billingState
                .monthlyRevenue
            ),

          trend:'+18%',

          icon:'💳',

        })}

        ${createStatCard({

          title:'Active Subs',

          value:'182',

          trend:'+12%',

          icon:'📈',

        })}

        ${createStatCard({

          title:'Churn',

          value:'2.4%',

          trend:'-1%',

          icon:'📉',

        })}

        ${createStatCard({

          title:'Retention',

          value:'92%',

          trend:'+4%',

          icon:'🔥',

        })}

      </div>

      <!-- PLANS -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        <!-- STANDARD -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-sectionTitle
            ">

              Standard

            </div>

            <div class="
              fp-pricing
            ">

              49€

              <span>
                /month
              </span>

            </div>

            <div class="
              fp-list
              fp-mt24
            ">

              <div class="
                fp-listItem
              ">

                30 audits / mois

              </div>

              <div class="
                fp-listItem
              ">

                3 monitors

              </div>

              <div class="
                fp-listItem
              ">

                PDF exports

              </div>

            </div>

            <button class="
              fp-btn
              fp-btnGhost
              fp-wFull
              fp-mt24
            ">

              Choisir

            </button>

          </div>

        </div>

        <!-- PRO -->

        <div class="
          fp-card
          fp-planHighlight
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-badge
              fp-badgePrimary
            ">

              POPULAIRE

            </div>

            <div class="
              fp-sectionTitle
              fp-mt24
            ">

              Pro

            </div>

            <div class="
              fp-pricing
            ">

              149€

              <span>
                /month
              </span>

            </div>

            <div class="
              fp-list
              fp-mt24
            ">

              <div class="
                fp-listItem
              ">

                300 audits

              </div>

              <div class="
                fp-listItem
              ">

                50 monitors

              </div>

              <div class="
                fp-listItem
              ">

                Team workspace

              </div>

            </div>

            <button class="
              fp-btn
              fp-btnPrimary
              fp-wFull
              fp-mt24
            ">

              Upgrade

            </button>

          </div>

        </div>

        <!-- ULTRA -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-sectionTitle
            ">

              Ultra

            </div>

            <div class="
              fp-pricing
            ">

              499€

              <span>
                /month
              </span>

            </div>

            <div class="
              fp-list
              fp-mt24
            ">

              <div class="
                fp-listItem
              ">

                2000 audits

              </div>

              <div class="
                fp-listItem
              ">

                300 monitors

              </div>

              <div class="
                fp-listItem
              ">

                Enterprise AI

              </div>

            </div>

            <button class="
              fp-btn
              fp-btnGhost
              fp-wFull
              fp-mt24
            ">

              Enterprise

            </button>

          </div>

        </div>

      </div>

      <!-- INVOICES -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          <div class="
            fp-cardTitle
          ">

            Invoices

          </div>

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Invoice',
              'Amount',
              'Status',
              'Date',

            ],

            rows:

              billingState
                .invoices
                .map(invoice => [

                  invoice.id,
                  formatCurrency(
                    invoice.amount
                  ),
                  invoice.status,
                  invoice.date,

                ]),

          })}

        </div>

      </div>

      <!-- ANALYTICS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Revenue Growth

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                12,
                18,
                26,
                38,
                52,
                68,
                92,

              ],

              height:260,

            })}

          </div>

        </div>

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Revenue Breakdown

          </div>

          <div class="
            fp-cardBody
          ">

            ${renderDataTable({

              columns:[

                'Plan',
                'Users',
                'Revenue',

              ],

              rows:[

                [

                  'Standard',
                  '82',
                  '4.1k€',

                ],

                [

                  'Pro',
                  '74',
                  '11k€',

                ],

                [

                  'Ultra',
                  '26',
                  '33k€',

                ],

              ],

            })}

          </div>

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Billing Insights

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Revenue Expansion

                </div>

                <div class="
                  fp-listText
                ">

                  Forte croissance des plans Ultra.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Retention Stability

                </div>

                <div class="
                  fp-listText
                ">

                  Churn actuellement très faible.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Upsell Opportunity

                </div>

                <div class="
                  fp-listText
                ">

                  Plusieurs clients prêts pour upgrade.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   EVENTS
========================================================= */

function bindBillingEvents(){

  const portal =
    qs('#fpOpenBillingPortal');

  if(portal){

    portal.onclick = () => {

      toast(

        'Ouverture du Billing Portal',

        'primary'

      );
    };
  }
}

/* =========================================================
   EVENTS PATCH
========================================================= */

const previousBillingBind =
  bindEvents;

bindEvents = function(){

  previousBillingBind();

  bindBillingEvents();
};

/* =========================================================
   READY
========================================================= */

console.log(
  'Billing engine ready'
);
/* =========================================================
   FINAL SETTINGS ENGINE
========================================================= */

/* =========================================================
   SETTINGS STATE
========================================================= */

const settingsState = {

  darkMode:true,

  realtime:true,

  notifications:true,

  aiSuggestions:true,

  autoReports:true,

};

/* =========================================================
   SETTINGS PAGE
========================================================= */

function renderSettings(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Platform Settings

              </div>

              <div class="
                fp-sectionText
              ">

                Configuration,
                sécurité,
                préférences,
                IA
                et infrastructure FlowPoint.

              </div>

            </div>

            <button class="
              fp-btn
              fp-btnPrimary
            ">

              Sauvegarder

            </button>

          </div>

        </div>

      </div>

      <!-- SETTINGS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- GENERAL -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Général

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-flex
              fp-flexCol
              fp-gap24
            ">

              <label class="
                fp-toggle
              ">

                <input

                  type="
                    checkbox
                  "

                  ${
                    settingsState.darkMode
                      ? 'checked'
                      : ''
                  }
                />

                <span>

                  Dark mode

                </span>

              </label>

              <label class="
                fp-toggle
              ">

                <input

                  type="
                    checkbox
                  "

                  ${
                    settingsState.realtime
                      ? 'checked'
                      : ''
                  }
                />

                <span>

                  Realtime monitoring

                </span>

              </label>

              <label class="
                fp-toggle
              ">

                <input

                  type="
                    checkbox
                  "

                  ${
                    settingsState.notifications
                      ? 'checked'
                      : ''
                  }
                />

                <span>

                  Notifications

                </span>

              </label>

            </div>

          </div>

        </div>

        <!-- AI -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Intelligence IA

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-flex
              fp-flexCol
              fp-gap24
            ">

              <label class="
                fp-toggle
              ">

                <input

                  type="
                    checkbox
                  "

                  ${
                    settingsState.aiSuggestions
                      ? 'checked'
                      : ''
                  }
                />

                <span>

                  AI Suggestions

                </span>

              </label>

              <label class="
                fp-toggle
              ">

                <input

                  type="
                    checkbox
                  "

                  ${
                    settingsState.autoReports
                      ? 'checked'
                      : ''
                  }
                />

                <span>

                  Automatic reports

                </span>

              </label>

            </div>

          </div>

        </div>

      </div>

      <!-- SECURITY -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Security & Access

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Service',
              'Status',
              'Last Update',

            ],

            rows:[

              [

                '2FA',
                'Enabled',
                'Today',

              ],

              [

                'API Protection',
                'Active',
                '2 min ago',

              ],

              [

                'Stripe Webhooks',
                'Secured',
                '5 min ago',

              ],

              [

                'Realtime Monitoring',
                'Operational',
                'Now',

              ],

            ],

          })}

        </div>

      </div>

      <!-- TEAM SETTINGS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Team Permissions

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-list
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Admin Access

                </div>

                <div class="
                  fp-listText
                ">

                  Full infrastructure control.

                </div>

              </div>

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Manage

              </button>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Workspace Permissions

                </div>

                <div class="
                  fp-listText
                ">

                  Team collaboration access.

                </div>

              </div>

              <button class="
                fp-btn
                fp-btnGhost
              ">

                Configure

              </button>

            </div>

          </div>

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Configuration Insights

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Monitoring Enabled

                </div>

                <div class="
                  fp-listText
                ">

                  Infrastructure live tracking actif.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Security Stable

                </div>

                <div class="
                  fp-listText
                ">

                  Aucun problème sécurité détecté.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  AI Automation

                </div>

                <div class="
                  fp-listText
                ">

                  Automations IA actives.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   READY
========================================================= */

console.log(
  'Settings engine ready'
);
/* =========================================================
   FINAL AUTOMATION CENTER
========================================================= */

/* =========================================================
   AUTOMATION STATE
========================================================= */

const automationState = {

  automations:[

    {

      id:
        uid('automation'),

      name:
        'Daily SEO Report',

      trigger:
        'Every day - 08:00',

      status:
        'active',

    },

    {

      id:
        uid('automation'),

      name:
        'Infrastructure Alert',

      trigger:
        'CPU > 85%',

      status:
        'active',

    },

    {

      id:
        uid('automation'),

      name:
        'Client PDF Export',

      trigger:
        'Every Monday',

      status:
        'paused',

    },

  ],

};

/* =========================================================
   AUTOMATION PAGE
========================================================= */

function renderAutomationCenter(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Automation Center

              </div>

              <div class="
                fp-sectionText
              ">

                Workflows,
                IA,
                triggers,
                exports
                et automatisations enterprise.

              </div>

            </div>

            <button

              id="
                fpCreateAutomation
              "

              class="
                fp-btn
                fp-btnPrimary
              "
            >

              Nouvelle automation

            </button>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'Automations',

          value:
            automationState
              .automations.length,

          trend:'+8%',

          icon:'⚙️',

        })}

        ${createStatCard({

          title:'Executions',

          value:'18.2k',

          trend:'+22%',

          icon:'⚡',

        })}

        ${createStatCard({

          title:'Success Rate',

          value:'99.2%',

          trend:'+1%',

          icon:'✅',

        })}

        ${createStatCard({

          title:'AI Workflows',

          value:'42',

          trend:'+18%',

          icon:'🤖',

        })}

      </div>

      <!-- AUTOMATIONS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Active Automations

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-list
          ">

            ${automationState
              .automations
              .map(automation => `

                <div class="
                  fp-listItem
                ">

                  <div>

                    <div class="
                      fp-listTitle
                    ">

                      ${automation.name}

                    </div>

                    <div class="
                      fp-listText
                    ">

                      Trigger:
                      ${automation.trigger}

                    </div>

                  </div>

                  <div class="
                    fp-flex
                    fp-alignCenter
                    fp-gap12
                  ">

                    <div class="
                      fp-badge
                      ${
                        automation.status
                          === 'active'

                          ? 'fp-badgeSuccess'

                          : 'fp-badgeWarning'
                      }
                    ">

                      ${automation.status}

                    </div>

                    <button class="
                      fp-btn
                      fp-btnGhost
                    ">

                      Edit

                    </button>

                  </div>

                </div>

              `).join('')}

          </div>

        </div>

      </div>

      <!-- WORKFLOW ANALYTICS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- EXECUTIONS -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Workflow Executions

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                18,
                24,
                32,
                44,
                58,
                74,
                92,

              ],

              height:260,

            })}

          </div>

        </div>

        <!-- TYPES -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Workflow Types

          </div>

          <div class="
            fp-cardBody
          ">

            ${renderDataTable({

              columns:[

                'Type',
                'Count',
                'Status',

              ],

              rows:[

                [

                  'SEO Reports',
                  '18',
                  'ACTIVE',

                ],

                [

                  'Infrastructure',
                  '12',
                  'ACTIVE',

                ],

                [

                  'Client Exports',
                  '8',
                  'ACTIVE',

                ],

                [

                  'AI Workflows',
                  '42',
                  'ACTIVE',

                ],

              ],

            })}

          </div>

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Automation Insights

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Workflow Efficiency

                </div>

                <div class="
                  fp-listText
                ">

                  Automations réduisent le temps manuel.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Infrastructure Stability

                </div>

                <div class="
                  fp-listText
                ">

                  Monitoring automatisé performant.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  AI Scaling

                </div>

                <div class="
                  fp-listText
                ">

                  Les workflows IA augmentent rapidement.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   EVENTS
========================================================= */

function bindAutomationEvents(){

  const create =
    qs('#fpCreateAutomation');

  if(create){

    create.onclick = () => {

      openModal({

        title:
          'Nouvelle automation',

        content:`

          <div class="
            fp-flex
            fp-flexCol
            fp-gap20
          ">

            <input
              class="
                fp-input
              "
              placeholder="
                Nom workflow
              "
            />

            <select class="
              fp-select
            ">

              <option>
                SEO Automation
              </option>

              <option>
                Infrastructure
              </option>

              <option>
                Client Export
              </option>

            </select>

            <button class="
              fp-btn
              fp-btnPrimary
            ">

              Créer workflow

            </button>

          </div>

        `,

      });
    };
  }
}

/* =========================================================
   EVENTS PATCH
========================================================= */

const previousAutomationBind =
  bindEvents;

bindEvents = function(){

  previousAutomationBind();

  bindAutomationEvents();
};

/* =========================================================
   READY
========================================================= */

console.log(
  'Automation center ready'
);
/* =========================================================
   FINAL LOCAL SEO ENGINE
========================================================= */

/* =========================================================
   LOCAL SEO STATE
========================================================= */

const localSeoState = {

  locations:[

    {

      city:
        'Brussels',

      visibility:
        92,

      keywords:
        482,

      growth:
        '+22%',

    },

    {

      city:
        'Liège',

      visibility:
        74,

      keywords:
        248,

      growth:
        '+14%',

    },

    {

      city:
        'Verviers',

      visibility:
        58,

      keywords:
        102,

      growth:
        '+34%',

    },

  ],

};

/* =========================================================
   LOCAL SEO PAGE
========================================================= */

function renderLocalSeo(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Local SEO Intelligence

              </div>

              <div class="
                fp-sectionText
              ">

                Visibilité locale,
                cartes,
                positions,
                Google Business
                et expansion géographique.

              </div>

            </div>

            <button class="
              fp-btn
              fp-btnPrimary
            ">

              Nouveau scan local

            </button>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'Locations',

          value:'28',

          trend:'+8%',

          icon:'📍',

        })}

        ${createStatCard({

          title:'Keywords',

          value:'4.2k',

          trend:'+22%',

          icon:'🔎',

        })}

        ${createStatCard({

          title:'Visibility',

          value:'82%',

          trend:'+14%',

          icon:'📈',

        })}

        ${createStatCard({

          title:'Maps Reach',

          value:'182k',

          trend:'+18%',

          icon:'🗺️',

        })}

      </div>

      <!-- LOCATION GRID -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        ${localSeoState
          .locations
          .map(location => `

            <div class="
              fp-card
            ">

              <div class="
                fp-cardBody
              ">

                <div class="
                  fp-flex
                  fp-alignCenter
                  fp-justifyBetween
                ">

                  <div class="
                    fp-sectionTitle
                  " style="
                    font-size:26px;
                  ">

                    ${location.city}

                  </div>

                  <div class="
                    fp-badge
                    fp-badgeSuccess
                  ">

                    ${location.growth}

                  </div>

                </div>

                <div class="
                  fp-grid2
                  fp-mt24
                ">

                  <div class="
                    fp-kpiCard
                  ">

                    <div class="
                      fp-kpiLabel
                    ">

                      Visibility

                    </div>

                    <div class="
                      fp-kpiValue
                    ">

                      ${location.visibility}

                    </div>

                  </div>

                  <div class="
                    fp-kpiCard
                  ">

                    <div class="
                      fp-kpiLabel
                    ">

                      Keywords

                    </div>

                    <div class="
                      fp-kpiValue
                    ">

                      ${location.keywords}

                    </div>

                  </div>

                </div>

                <div class="
                  fp-progress
                  fp-mt24
                ">

                  <div

                    class="
                      fp-progressBar
                    "

                    style="
                      width:
                      ${location.visibility}%;
                    "
                  ></div>

                </div>

                <div class="
                  fp-flex
                  fp-gap12
                  fp-mt24
                ">

                  <button class="
                    fp-btn
                    fp-btnGhost
                  ">

                    Keywords

                  </button>

                  <button class="
                    fp-btn
                    fp-btnPrimary
                  ">

                    Open

                  </button>

                </div>

              </div>

            </div>

          `).join('')}

      </div>

      <!-- MAP & ANALYTICS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- MAP -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Local Visibility Map

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-chartEmpty
            " style="
              height:320px;
            ">

              Interactive Local SEO Map

            </div>

          </div>

        </div>

        <!-- GROWTH -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Visibility Growth

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                12,
                18,
                28,
                42,
                58,
                74,
                92,

              ],

              height:320,

            })}

          </div>

        </div>

      </div>

      <!-- TABLE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Local Ranking Tracking

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'City',
              'Visibility',
              'Keywords',
              'Growth',

            ],

            rows:

              localSeoState
                .locations
                .map(location => [

                  location.city,
                  location.visibility + '%',
                  location.keywords,
                  location.growth,

                ]),

          })}

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Local SEO Insights

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Expansion Opportunity

                </div>

                <div class="
                  fp-listText
                ">

                  Bruxelles génère forte traction locale.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Keyword Growth

                </div>

                <div class="
                  fp-listText
                ">

                  Hausse visibilité longue traîne.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Local Competition

                </div>

                <div class="
                  fp-listText
                ">

                  Faible concurrence sur certaines zones.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   READY
========================================================= */

console.log(
  'Local SEO engine ready'
);
/* =========================================================
   FINAL COMPETITOR INTELLIGENCE ENGINE
========================================================= */

/* =========================================================
   COMPETITOR STATE
========================================================= */

const competitorState = {

  competitors:[

    {

      name:
        'AgencyBoost',

      traffic:
        '182k',

      seo:
        82,

      ads:
        'High',

      growth:
        '+18%',

    },

    {

      name:
        'LocalRank',

      traffic:
        '94k',

      seo:
        74,

      ads:
        'Medium',

      growth:
        '+8%',

    },

    {

      name:
        'SeoVision',

      traffic:
        '42k',

      seo:
        58,

      ads:
        'Low',

      growth:
        '+28%',

    },

  ],

};

/* =========================================================
   COMPETITOR PAGE
========================================================= */

function renderCompetitors(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Competitor Intelligence

              </div>

              <div class="
                fp-sectionText
              ">

                Analyse concurrence,
                trafic,
                SEO,
                publicité
                et opportunités marché.

              </div>

            </div>

            <button class="
              fp-btn
              fp-btnPrimary
            ">

              Nouveau benchmark

            </button>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'Competitors',

          value:'42',

          trend:'+12%',

          icon:'🧠',

        })}

        ${createStatCard({

          title:'Tracked Keywords',

          value:'18k',

          trend:'+22%',

          icon:'🔎',

        })}

        ${createStatCard({

          title:'Traffic Monitored',

          value:'2.4M',

          trend:'+18%',

          icon:'📈',

        })}

        ${createStatCard({

          title:'Ad Campaigns',

          value:'482',

          trend:'+8%',

          icon:'📢',

        })}

      </div>

      <!-- COMPETITOR GRID -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        ${competitorState
          .competitors
          .map(competitor => `

            <div class="
              fp-card
            ">

              <div class="
                fp-cardBody
              ">

                <div class="
                  fp-flex
                  fp-alignCenter
                  fp-justifyBetween
                ">

                  <div class="
                    fp-sectionTitle
                  " style="
                    font-size:24px;
                  ">

                    ${competitor.name}

                  </div>

                  <div class="
                    fp-badge
                    fp-badgeSuccess
                  ">

                    ${competitor.growth}

                  </div>

                </div>

                <div class="
                  fp-grid2
                  fp-mt24
                ">

                  <div class="
                    fp-kpiCard
                  ">

                    <div class="
                      fp-kpiLabel
                    ">

                      Traffic

                    </div>

                    <div class="
                      fp-kpiValue
                    ">

                      ${competitor.traffic}

                    </div>

                  </div>

                  <div class="
                    fp-kpiCard
                  ">

                    <div class="
                      fp-kpiLabel
                    ">

                      SEO Score

                    </div>

                    <div class="
                      fp-kpiValue
                    ">

                      ${competitor.seo}

                    </div>

                  </div>

                </div>

                <div class="
                  fp-list
                  fp-mt24
                ">

                  <div class="
                    fp-listItem
                  ">

                    <div>

                      <div class="
                        fp-listTitle
                      ">

                        Ads Activity

                      </div>

                      <div class="
                        fp-listText
                      ">

                        ${competitor.ads}

                      </div>

                    </div>

                  </div>

                </div>

                <div class="
                  fp-flex
                  fp-gap12
                  fp-mt24
                ">

                  <button class="
                    fp-btn
                    fp-btnGhost
                  ">

                    Keywords

                  </button>

                  <button class="
                    fp-btn
                    fp-btnPrimary
                  ">

                    Analyse

                  </button>

                </div>

              </div>

            </div>

          `).join('')}

      </div>

      <!-- ANALYTICS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- TRAFFIC -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Competitor Traffic

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                18,
                22,
                34,
                48,
                62,
                82,
                98,

              ],

              height:320,

            })}

          </div>

        </div>

        <!-- KEYWORDS -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Keyword Opportunities

          </div>

          <div class="
            fp-cardBody
          ">

            ${renderDataTable({

              columns:[

                'Keyword',
                'Difficulty',
                'Potential',

              ],

              rows:[

                [

                  'seo dashboard',
                  'Medium',
                  'High',

                ],

                [

                  'local seo platform',
                  'Low',
                  'Very High',

                ],

                [

                  'monitoring saas',
                  'High',
                  'Medium',

                ],

                [

                  'executive reporting',
                  'Low',
                  'High',

                ],

              ],

            })}

          </div>

        </div>

      </div>

      <!-- MARKET INSIGHTS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Market Intelligence

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Weak Competition

                </div>

                <div class="
                  fp-listText
                ">

                  Plusieurs niches encore sous-exploitées.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Traffic Growth

                </div>

                <div class="
                  fp-listText
                ">

                  Hausse forte du trafic SEO SaaS.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Market Opportunity

                </div>

                <div class="
                  fp-listText
                ">

                  Potentiel élevé sur l’enterprise reporting.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   READY
========================================================= */

console.log(
  'Competitor intelligence ready'
);
/* =========================================================
   FINAL AI CENTER ENGINE
========================================================= */

/* =========================================================
   AI STATE
========================================================= */

const aiCenterState = {

  messages:[

    {

      role:
        'assistant',

      content:
        'Bienvenue dans FlowPoint AI Enterprise.',

    },

    {

      role:
        'assistant',

      content:
        'Infrastructure stable. Plusieurs opportunités SEO détectées.',

    },

  ],

};

/* =========================================================
   SEND AI MESSAGE
========================================================= */

function sendAiMessage(){

  const input =
    qs('#fpAiInput');

  if(!input){
    return;
  }

  const text =
    input.value.trim();

  if(!text){
    return;
  }

  aiCenterState.messages.push({

    role:'user',

    content:text,

  });

  render();

  setTimeout(() => {

    aiCenterState.messages.push({

      role:'assistant',

      content:
        generateAiResponse(text),

    });

    render();

  }, 900);
}

/* =========================================================
   AI RESPONSE
========================================================= */

function generateAiResponse(text=''){

  const lower =
    text.toLowerCase();

  if(

    lower.includes('seo')

  ){

    return `
      Analyse SEO détectée.
      Plusieurs quick wins possibles
      sur les pages locales
      et les performances techniques.
    `;
  }

  if(

    lower.includes('report')

  ){

    return `
      Les executive reports
      peuvent améliorer
      la rétention client
      et augmenter les upgrades Pro/Ultra.
    `;
  }

  if(

    lower.includes('monitor')

  ){

    return `
      Monitoring infrastructure stable.
      Aucun incident critique détecté.
    `;
  }

  return `
    FlowPoint AI analyse
    actuellement votre demande
    et détecte plusieurs opportunités
    enterprise.
  `;
}

/* =========================================================
   AI PAGE
========================================================= */

function renderAiCenter(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                FlowPoint AI

              </div>

              <div class="
                fp-sectionText
              ">

                Intelligence artificielle,
                analyses,
                stratégie,
                monitoring
                et recommandations enterprise.

              </div>

            </div>

            <div class="
              fp-liveBadge
            ">

              <div class="
                fp-liveDot
              "></div>

              <span>

                AI ONLINE

              </span>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'AI Requests',

          value:'182k',

          trend:'+28%',

          icon:'🤖',

        })}

        ${createStatCard({

          title:'Suggestions',

          value:'12.4k',

          trend:'+18%',

          icon:'🧠',

        })}

        ${createStatCard({

          title:'Automations',

          value:'842',

          trend:'+12%',

          icon:'⚡',

        })}

        ${createStatCard({

          title:'Accuracy',

          value:'98.2%',

          trend:'+2%',

          icon:'🎯',

        })}

      </div>

      <!-- AI CHAT -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          FlowPoint AI Assistant

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-aiMessages
          ">

            ${aiCenterState
              .messages
              .map(message => `

                <div class="
                  fp-aiMessage
                  ${message.role}
                ">

                  <div class="
                    fp-aiBubble
                  ">

                    ${message.content}

                  </div>

                </div>

              `).join('')}

          </div>

          <div class="
            fp-flex
            fp-gap12
            fp-mt24
          ">

            <input

              id="
                fpAiInput
              "

              class="
                fp-input
              "

              placeholder="
                Demandez quelque chose à FlowPoint AI...
              "
            />

            <button

              id="
                fpSendAiMessage
              "

              class="
                fp-btn
                fp-btnPrimary
              "
            >

              Envoyer

            </button>

          </div>

        </div>

      </div>

      <!-- AI MODULES -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-sectionTitle
            " style="
              font-size:22px;
            ">

              SEO Intelligence

            </div>

            <div class="
              fp-sectionText
            ">

              Détection opportunités,
              quick wins,
              structure SEO
              et expansion locale.

            </div>

          </div>

        </div>

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-sectionTitle
            " style="
              font-size:22px;
            ">

              Infrastructure AI

            </div>

            <div class="
              fp-sectionText
            ">

              Analyse monitoring,
              incidents,
              performance
              et uptime.

            </div>

          </div>

        </div>

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-sectionTitle
            " style="
              font-size:22px;
            ">

              Executive Insights

            </div>

            <div class="
              fp-sectionText
            ">

              Résumés enterprise,
              analytics
              et recommandations stratégiques.

            </div>

          </div>

        </div>

      </div>

      <!-- AI ANALYTICS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            AI Usage Growth

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                12,
                22,
                34,
                52,
                68,
                82,
                98,

              ],

              height:280,

            })}

          </div>

        </div>

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            AI Operations

          </div>

          <div class="
            fp-cardBody
          ">

            ${renderDataTable({

              columns:[

                'Module',
                'Status',
                'Usage',

              ],

              rows:[

                [

                  'SEO AI',
                  'ONLINE',
                  'High',

                ],

                [

                  'Monitoring AI',
                  'ONLINE',
                  'Medium',

                ],

                [

                  'Reports AI',
                  'ONLINE',
                  'High',

                ],

                [

                  'Enterprise AI',
                  'ONLINE',
                  'Very High',

                ],

              ],

            })}

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   EVENTS
========================================================= */

function bindAiEvents(){

  const send =
    qs('#fpSendAiMessage');

  if(send){

    send.onclick =
      sendAiMessage;
  }

  const input =
    qs('#fpAiInput');

  if(input){

    input.onkeydown = event => {

      if(

        event.key === 'Enter'

      ){

        sendAiMessage();
      }
    };
  }
}

/* =========================================================
   EVENTS PATCH
========================================================= */

const previousAiBind =
  bindEvents;

bindEvents = function(){

  previousAiBind();

  bindAiEvents();
};

/* =========================================================
   READY
========================================================= */

console.log(
  'AI center ready'
);
/* =========================================================
   FINAL OVERVIEW PAGE
========================================================= */

/* =========================================================
   OVERVIEW PAGE
========================================================= */

function renderOverview(){

  return `

    <div class="
      fp-page
    ">

      <!-- EXECUTIVE HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
        fp-executiveHero
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-justifyBetween
            fp-gap24
          " style="
            flex-wrap:wrap;
          ">

            <!-- LEFT -->

            <div style="
              flex:1;
              min-width:320px;
            ">

              <div class="
                fp-heroGreeting
              ">

                Bon retour,
                ${
                  state.user?.name
                  || 'Admin'
                }

              </div>

              <div class="
                fp-heroTitle
              ">

                Executive Command Center

              </div>

              <div class="
                fp-heroText
              ">

                Infrastructure stable,
                croissance SEO détectée,
                plusieurs opportunités
                business disponibles
                et monitoring opérationnel.

              </div>

              <div class="
                fp-flex
                fp-gap16
                fp-mt32
              ">

                <button class="
                  fp-btn
                  fp-btnPrimary
                ">

                  Générer report

                </button>

                <button class="
                  fp-btn
                  fp-btnGhost
                ">

                  Ouvrir analytics

                </button>

              </div>

            </div>

            <!-- RIGHT -->

            <div class="
              fp-heroStats
            ">

              <div class="
                fp-heroStat
              ">

                <div class="
                  fp-heroStatValue
                ">

                  98%

                </div>

                <div class="
                  fp-heroStatLabel
                ">

                  Infrastructure Health

                </div>

              </div>

              <div class="
                fp-heroStat
              ">

                <div class="
                  fp-heroStatValue
                ">

                  +42%

                </div>

                <div class="
                  fp-heroStatLabel
                ">

                  SEO Growth

                </div>

              </div>

              <div class="
                fp-heroStat
              ">

                <div class="
                  fp-heroStatValue
                ">

                  182k

                </div>

                <div class="
                  fp-heroStatLabel
                ">

                  Monthly Reach

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI GRID -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'MRR',

          value:'48k€',

          trend:'+18%',

          icon:'💳',

        })}

        ${createStatCard({

          title:'Clients',

          value:'182',

          trend:'+12%',

          icon:'👥',

        })}

        ${createStatCard({

          title:'Uptime',

          value:'99.98%',

          trend:'+0.2%',

          icon:'🛰️',

        })}

        ${createStatCard({

          title:'AI Usage',

          value:'182k',

          trend:'+28%',

          icon:'🤖',

        })}

      </div>

      <!-- MAIN GRID -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- PERFORMANCE -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Platform Performance

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                18,
                28,
                34,
                52,
                68,
                82,
                98,

              ],

              height:300,

            })}

          </div>

        </div>

        <!-- ACTIVITY -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Executive Activity

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-timeline
            ">

              <div class="
                fp-timelineItem
              ">

                <div class="
                  fp-timelineDot
                  success
                "></div>

                <div class="
                  fp-timelineCard
                ">

                  <div class="
                    fp-timelineTitle
                  ">

                    Executive report generated

                  </div>

                  <div class="
                    fp-timelineText
                  ">

                    Nouveau report envoyé automatiquement.

                  </div>

                </div>

              </div>

              <div class="
                fp-timelineItem
              ">

                <div class="
                  fp-timelineDot
                  primary
                "></div>

                <div class="
                  fp-timelineCard
                ">

                  <div class="
                    fp-timelineTitle
                  ">

                    SEO growth detected

                  </div>

                  <div class="
                    fp-timelineText
                  ">

                    Hausse visibilité locale observée.

                  </div>

                </div>

              </div>

              <div class="
                fp-timelineItem
              ">

                <div class="
                  fp-timelineDot
                  warning
                "></div>

                <div class="
                  fp-timelineCard
                ">

                  <div class="
                    fp-timelineTitle
                  ">

                    Infrastructure spike

                  </div>

                  <div class="
                    fp-timelineText
                  ">

                    Pic trafic détecté sur API.

                  </div>

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

      <!-- ENTERPRISE GRID -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        <!-- MONITORING -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-sectionTitle
            " style="
              font-size:22px;
            ">

              Monitoring

            </div>

            <div class="
              fp-sectionText
            ">

              Uptime stable,
              monitoring live
              et alertes infrastructure.

            </div>

            <div class="
              fp-userStatus
              fp-mt24
            ">

              <div class="
                fp-userStatusDot
              "></div>

              Infrastructure healthy

            </div>

          </div>

        </div>

        <!-- SEO -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-sectionTitle
            " style="
              font-size:22px;
            ">

              SEO Intelligence

            </div>

            <div class="
              fp-sectionText
            ">

              Expansion locale,
              opportunités SEO
              et croissance organique.

            </div>

            <div class="
              fp-badge
              fp-badgeSuccess
              fp-mt24
            ">

              +42% organic growth

            </div>

          </div>

        </div>

        <!-- AI -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-sectionTitle
            " style="
              font-size:22px;
            ">

              Enterprise AI

            </div>

            <div class="
              fp-sectionText
            ">

              Intelligence IA,
              reports,
              monitoring
              et automatisations.

            </div>

            <div class="
              fp-liveBadge
              fp-mt24
            ">

              <div class="
                fp-liveDot
              "></div>

              AI ONLINE

            </div>

          </div>

        </div>

      </div>

      <!-- TABLE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Executive Metrics

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Metric',
              'Value',
              'Trend',
              'Status',

            ],

            rows:[

              [

                'MRR',
                '48k€',
                '+18%',
                'Excellent',

              ],

              [

                'Infrastructure',
                '99.98%',
                '+0.2%',
                'Stable',

              ],

              [

                'SEO Reach',
                '182k',
                '+42%',
                'Growing',

              ],

              [

                'AI Requests',
                '182k',
                '+28%',
                'High',

              ],

            ],

          })}

        </div>

      </div>

      <!-- QUICK ACTIONS -->

      <div class="
        fp-quickActions
      ">

        <button class="
          fp-quickAction
        ">

          ⚡

        </button>

        <button class="
          fp-quickAction
        ">

          🤖

        </button>

        <button class="
          fp-quickAction
        ">

          📄

        </button>

      </div>

    </div>

  `;
}

/* =========================================================
   READY
========================================================= */

console.log(
  'Overview page ready'
);
/* =========================================================
   FINAL MISSING GLOBAL COMPONENTS
========================================================= */

/* =========================================================
   CREATE STAT CARD
========================================================= */

function createStatCard({

  title='Metric',

  value='0',

  trend='+0%',

  icon='📊',

} = {}){

  return `

    <div class="
      fp-statCard
    ">

      <div class="
        fp-flex
        fp-alignCenter
        fp-justifyBetween
      ">

        <div class="
          fp-statIcon
        ">

          ${icon}

        </div>

        <div class="
          fp-badge
          ${
            trend.startsWith('-')
              ? 'fp-badgeDanger'
              : 'fp-badgeSuccess'
          }
        ">

          ${trend}

        </div>

      </div>

      <div class="
        fp-statValue
      ">

        ${value}

      </div>

      <div class="
        fp-statTitle
      ">

        ${title}

      </div>

    </div>

  `;
}

/* =========================================================
   EMPTY STATE
========================================================= */

function createEmptyState({

  icon='📭',

  title='Aucune donnée',

  text='Aucune donnée disponible.',

} = {}){

  return `

    <div class="
      fp-emptyState
    ">

      <div class="
        fp-emptyIcon
      ">

        ${icon}

      </div>

      <div class="
        fp-emptyTitle
      ">

        ${title}

      </div>

      <div class="
        fp-emptyText
      ">

        ${text}

      </div>

    </div>

  `;
}

/* =========================================================
   CARD HELPERS
========================================================= */

function createCard({

  title='',

  body='',

  footer='',

  className='',

} = {}){

  return `

    <div class="
      fp-card
      ${className}
    ">

      ${
        title
        ? `
          <div class="
            fp-cardHeader
          ">
            ${title}
          </div>
        `
        : ''
      }

      <div class="
        fp-cardBody
      ">

        ${body}

      </div>

      ${
        footer
        ? `
          <div class="
            fp-cardFooter
          ">
            ${footer}
          </div>
        `
        : ''
      }

    </div>

  `;
}

/* =========================================================
   PROGRESS BAR
========================================================= */

function createProgress({

  value=50,

  label='',

} = {}){

  return `

    <div class="
      fp-progressWrap
    ">

      ${
        label
        ? `
          <div class="
            fp-progressLabel
          ">
            ${label}
          </div>
        `
        : ''
      }

      <div class="
        fp-progress
      ">

        <div

          class="
            fp-progressBar
          "

          style="
            width:${value}%;
          "
        ></div>

      </div>

    </div>

  `;
}

/* =========================================================
   LOADING SCREEN
========================================================= */

function renderLoadingScreen(){

  return `

    <div class="
      fp-advancedLoader
    ">

      <div class="
        fp-loaderRing
      "></div>

      <div class="
        fp-loaderText
      ">

        FlowPoint Enterprise Loading...

      </div>

    </div>

  `;
}

/* =========================================================
   COMMAND PALETTE
========================================================= */

function openGlobalSearch(){

  const results =
    performGlobalSearch();

  openModal({

    title:
      'Recherche globale',

    content:`

      <div class="
        fp-commandPalette
      ">

        <input

          id="
            fpCommandInput
          "

          class="
            fp-commandInput
          "

          placeholder="
            Rechercher une page, une action...
          "
        />

        <div

          id="
            fpSearchResults
          "

          class="
            fp-searchResults
          "
        >

          ${results.map(result => `

            <button

              class="
                fp-commandItem
              "

              data-command-route="
                ${result.key}
              "
            >

              <div>

                <div class="
                  fp-commandTitle
                ">

                  ${result.title}

                </div>

                <div class="
                  fp-commandType
                ">

                  ${result.type}

                </div>

              </div>

            </button>

          `).join('')}

        </div>

      </div>

    `,

  });

  setTimeout(() => {

    bindSearchEvents();

  }, 40);
}

/* =========================================================
   SEARCH EVENTS
========================================================= */

function bindSearchEvents(){

  const input =
    qs('#fpCommandInput');

  if(input){

    input.focus();

    input.oninput = () => {

      const results =
        performGlobalSearch(
          input.value
        );

      const container =
        qs('#fpSearchResults');

      if(!container){
        return;
      }

      container.innerHTML =

        results.map(result => `

          <button

            class="
              fp-commandItem
            "

            data-command-route="
              ${result.key}
            "
          >

            <div>

              <div class="
                fp-commandTitle
              ">

                ${result.title}

              </div>

              <div class="
                fp-commandType
              ">

                ${result.type}

              </div>

            </div>

          </button>

        `).join('');
      
      bindCommandRoutes();
    };
  }

  bindCommandRoutes();
}

/* =========================================================
   COMMAND ROUTES
========================================================= */

function bindCommandRoutes(){

  qsa('[data-command-route]')
    .forEach(button => {

      button.onclick = () => {

        const route =
          button.dataset
            .commandRoute;

        closeModal();

        setRoute(route);
      };
    });
}

/* =========================================================
   QUICK SHORTCUTS
========================================================= */

window.addEventListener(

  'keydown',

  event => {

    /* CMD + K */

    if(

      (event.metaKey || event.ctrlKey)

      &&

      event.key.toLowerCase()
      ===
      'k'

    ){

      event.preventDefault();

      openGlobalSearch();
    }

    /* ESC */

    if(

      event.key
      ===
      'Escape'

    ){

      closeModal();
    }
  }
);

/* =========================================================
   AUTO SAVE
========================================================= */

setInterval(() => {

  saveLocal(

    'fp_state',

    state

  );

}, 4000);

/* =========================================================
   RESTORE
========================================================= */

const restoredState =
  loadLocal(
    'fp_state'
  );

if(restoredState){

  Object.assign(

    state,

    restoredState

  );
}

/* =========================================================
   FINAL INIT
========================================================= */

console.log(
  'Global components ready'
);
/* =========================================================
   FINAL CORE LAYOUT CSS
========================================================= */

/* =========================================================
   DASHBOARD SHELL
========================================================= */

.fp-dashboardShell{
  min-height:100vh;
  display:flex;
  position:relative;
}

/* =========================================================
   SIDEBAR
========================================================= */

.fp-sidebar{
  width:290px;
  min-width:290px;
  display:flex;
  flex-direction:column;
  gap:24px;
  padding:24px;
  background:
    linear-gradient(
      180deg,
      rgba(8,12,24,.96),
      rgba(10,15,30,.96)
    );
  border-right:
    1px solid
    rgba(255,255,255,.06);
  position:sticky;
  top:0;
  height:100vh;
  overflow:auto;
  z-index:90;
}

.fp-sidebarTop{
  display:flex;
  flex-direction:column;
  gap:24px;
}

.fp-sidebarBottom{
  margin-top:auto;
}

/* =========================================================
   SIDEBAR LINK
========================================================= */

.fp-sidebarLink{
  width:100%;
  border:none;
  border-radius:18px;
  padding:16px 18px;
  display:flex;
  align-items:center;
  gap:16px;
  background:transparent;
  color:#d7e3ff;
  cursor:pointer;
  transition:.2s;
  font-size:14px;
  font-weight:700;
  text-align:left;
}

.fp-sidebarLink:hover{
  background:
    rgba(255,255,255,.05);
}

.fp-sidebarLink.active{
  background:
    linear-gradient(
      135deg,
      rgba(47,91,255,.22),
      rgba(91,130,255,.14)
    );
  border:
    1px solid
    rgba(47,91,255,.24);
  color:white;
}

/* =========================================================
   MAIN
========================================================= */

.fp-main{
  flex:1;
  min-width:0;
  display:flex;
  flex-direction:column;
}

/* =========================================================
   TOPBAR
========================================================= */

.fp-topbar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:24px;
  padding:22px 28px;
  border-bottom:
    1px solid
    rgba(255,255,255,.06);
  backdrop-filter:blur(18px);
  background:
    rgba(6,10,22,.74);
}

.fp-pageTitle{
  font-size:30px;
  font-weight:900;
  line-height:1;
}

.fp-pageSub{
  margin-top:8px;
  color:#8ea3d4;
  font-size:14px;
}

/* =========================================================
   CONTENT
========================================================= */

.fp-content{
  flex:1;
  padding:28px;
  display:flex;
  flex-direction:column;
  gap:24px;
}

/* =========================================================
   GRID
========================================================= */

.fp-grid2{
  display:grid;
  grid-template-columns:
    repeat(2,minmax(0,1fr));
  gap:24px;
}

.fp-grid3{
  display:grid;
  grid-template-columns:
    repeat(3,minmax(0,1fr));
  gap:24px;
}

.fp-grid4{
  display:grid;
  grid-template-columns:
    repeat(4,minmax(0,1fr));
  gap:24px;
}

/* =========================================================
   CARD
========================================================= */

.fp-card{
  background:
    linear-gradient(
      180deg,
      rgba(18,25,45,.96),
      rgba(10,16,30,.96)
    );
  border:
    1px solid
    rgba(255,255,255,.06);
  border-radius:28px;
  overflow:hidden;
  position:relative;
}

.fp-cardHeader{
  padding:24px 26px;
  border-bottom:
    1px solid
    rgba(255,255,255,.06);
  font-weight:800;
  font-size:18px;
}

.fp-cardBody{
  padding:26px;
}

.fp-cardFooter{
  padding:22px 26px;
  border-top:
    1px solid
    rgba(255,255,255,.06);
}

/* =========================================================
   BUTTONS
========================================================= */

.fp-btn{
  border:none;
  border-radius:16px;
  min-height:50px;
  padding:0 20px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:10px;
  cursor:pointer;
  transition:.2s;
  font-weight:700;
  font-size:14px;
}

.fp-btn:hover{
  transform:
    translateY(-2px);
}

/* =========================================================
   TABLE
========================================================= */

.fp-table{
  width:100%;
}

.fp-table th{
  padding:18px;
  text-align:left;
  color:#8ea3d4;
  font-size:13px;
  font-weight:800;
  border-bottom:
    1px solid
    rgba(255,255,255,.06);
}

.fp-table td{
  padding:18px;
  border-bottom:
    1px solid
    rgba(255,255,255,.04);
  color:#dbe7ff;
  font-size:14px;
}

/* =========================================================
   PROGRESS
========================================================= */

.fp-progress{
  width:100%;
  height:12px;
  border-radius:999px;
  overflow:hidden;
  background:
    rgba(255,255,255,.06);
}

.fp-progressBar{
  height:100%;
  border-radius:999px;
  background:
    linear-gradient(
      135deg,
      #2f5bff,
      #5d82ff
    );
}

.fp-progressWrap{
  display:flex;
  flex-direction:column;
  gap:12px;
}

.fp-progressLabel{
  font-size:13px;
  color:#8ea3d4;
  font-weight:700;
}

/* =========================================================
   RESPONSIVE
========================================================= */

@media(max-width:1400px){

  .fp-grid4{
    grid-template-columns:
      repeat(2,minmax(0,1fr));
  }
}

@media(max-width:1100px){

  .fp-grid3{
    grid-template-columns:
      repeat(2,minmax(0,1fr));
  }

  .fp-grid2{
    grid-template-columns:
      1fr;
  }
}

@media(max-width:980px){

  .fp-sidebar{
    position:fixed;
    left:-100%;
    top:0;
    transition:.3s;
  }

  .fp-sidebar.open{
    left:0;
  }

  .fp-content{
    padding:18px;
  }

  .fp-topbar{
    padding:18px;
  }

  .fp-pageTitle{
    font-size:24px;
  }
}

@media(max-width:760px){

  .fp-grid2,
  .fp-grid3,
  .fp-grid4{
    grid-template-columns:
      1fr;
  }

  .fp-card{
    border-radius:22px;
  }

  .fp-cardHeader{
    padding:20px;
  }

  .fp-cardBody{
    padding:20px;
  }

  .fp-content{
    padding:14px;
  }
}
/* =========================================================
   FINAL APP INITIALIZER & STABILITY PATCH
========================================================= */

/* =========================================================
   APP VERSION
========================================================= */

const FLOWPOINT_VERSION =
  'Enterprise v7.0';

/* =========================================================
   APP CONFIG
========================================================= */

const appConfig = {

  appName:
    'FlowPoint',

  version:
    FLOWPOINT_VERSION,

  environment:
    'production',

  realtime:
    true,

  ai:
    true,

  monitoring:
    true,

};

/* =========================================================
   APP STATE VALIDATION
========================================================= */

function validateAppState(){

  if(!state.user){

    state.user = {

      name:'Admin',

      email:'admin@flowpoint.pro',

      role:'owner',

    };
  }

  if(!state.plan){

    state.plan = 'Ultra';
  }

  if(!state.route){

    state.route = 'overview';
  }
}

/* =========================================================
   SAFE RENDER
========================================================= */

function safeRender(){

  try{

    render();

  }catch(error){

    console.error(error);

    const app =
      qs('#app');

    if(app){

      app.innerHTML = `

        <div class="
          fp-page
        ">

          <div class="
            fp-card
          ">

            <div class="
              fp-cardBody
            ">

              <div class="
                fp-emptyState
              ">

                <div class="
                  fp-emptyIcon
                ">

                  ⚠️

                </div>

                <div class="
                  fp-emptyTitle
                ">

                  Rendering Error

                </div>

                <div class="
                  fp-emptyText
                ">

                  Une erreur est survenue
                  pendant le rendu
                  du dashboard.

                </div>

                <button

                  onclick="
                    location.reload()
                  "

                  class="
                    fp-btn
                    fp-btnPrimary
                    fp-mt24
                  "
                >

                  Reload

                </button>

              </div>

            </div>

          </div>

        </div>

      `;
    }
  }
}

/* =========================================================
   CONNECTION CHECK
========================================================= */

function startConnectionWatcher(){

  window.addEventListener(

    'offline',

    () => {

      toast(

        'Connexion perdue',

        'danger'

      );
    }
  );

  window.addEventListener(

    'online',

    () => {

      toast(

        'Connexion rétablie',

        'success'

      );
    }
  );
}

/* =========================================================
   MEMORY CLEANER
========================================================= */

function startMemoryCleaner(){

  setInterval(() => {

    if(

      performanceState.memory
      > 90

    ){

      console.warn(
        'High memory usage'
      );
    }

  }, 30000);
}

/* =========================================================
   SESSION CHECK
========================================================= */

function startSessionCheck(){

  setInterval(() => {

    const token =
      localStorage.getItem(
        'fp_token'
      );

    if(!token){

      console.warn(
        'No session token'
      );
    }

  }, 60000);
}

/* =========================================================
   APP BOOT
========================================================= */

async function initializeFlowPoint(){

  console.log(
    'Initializing FlowPoint...'
  );

  validateAppState();

  const app =
    qs('#app');

  if(app){

    app.innerHTML =
      renderLoadingScreen();
  }

  await new Promise(resolve => {

    setTimeout(resolve,600);

  });

  safeRender();

  startConnectionWatcher();

  startMemoryCleaner();

  startSessionCheck();

  startRealtimeEngine?.();

  console.log(
    `
      ${appConfig.appName}
      ${appConfig.version}
      initialized
    `
  );
}

/* =========================================================
   AUTO INIT
========================================================= */

document.addEventListener(

  'DOMContentLoaded',

  () => {

    initializeFlowPoint();
  }
);

/* =========================================================
   GLOBAL ERROR HANDLER
========================================================= */

window.addEventListener(

  'error',

  event => {

    console.error(
      'Global Error:',
      event.error
    );
  }
);

/* =========================================================
   PROMISE HANDLER
========================================================= */

window.addEventListener(

  'unhandledrejection',

  event => {

    console.error(
      'Promise Error:',
      event.reason
    );
  }
);

/* =========================================================
   FINAL READY
========================================================= */

console.log(
  `
  =====================================
        FLOWPOINT ENTERPRISE READY
  =====================================
  `
);
/* =========================================================
   FINAL POLISH / EFFECTS / PREMIUM FINISH
========================================================= */

/* =========================================================
   ROOT
========================================================= */

:root{

  --fpBg:#050816;
  --fpBg2:#091120;
  --fpBg3:#0d1730;

  --fpCard:
    rgba(18,25,45,.96);

  --fpBorder:
    rgba(255,255,255,.06);

  --fpText:#ffffff;

  --fpMuted:#8ea3d4;

  --fpPrimary:#2f5bff;
  --fpPrimary2:#5d82ff;

  --fpSuccess:#10b981;
  --fpWarning:#f59e0b;
  --fpDanger:#ef4444;

  --fpRadius:28px;

}

/* =========================================================
   BODY
========================================================= */

body{
  background:
    radial-gradient(
      circle at top left,
      rgba(47,91,255,.18),
      transparent 24%
    ),

    radial-gradient(
      circle at bottom right,
      rgba(91,130,255,.12),
      transparent 18%
    ),

    linear-gradient(
      180deg,
      #050816 0%,
      #091120 100%
    );

  color:var(--fpText);

  font-family:
    Inter,
    system-ui,
    sans-serif;

  overflow-x:hidden;
}

/* =========================================================
   SELECTION
========================================================= */

::selection{
  background:
    rgba(47,91,255,.34);
  color:white;
}

/* =========================================================
   CARD GLOW
========================================================= */

.fp-card::before{
  content:'';
  position:absolute;
  inset:0;
  pointer-events:none;
  background:
    radial-gradient(
      circle at top right,
      rgba(255,255,255,.08),
      transparent 34%
    );
}

/* =========================================================
   HOVER EFFECTS
========================================================= */

.fp-card{
  transition:
    transform .22s,
    box-shadow .22s,
    border-color .22s;
}

.fp-card:hover{
  transform:
    translateY(-4px);

  border-color:
    rgba(255,255,255,.10);

  box-shadow:
    0 34px 80px
    rgba(0,0,0,.34);
}

/* =========================================================
   BUTTON EFFECTS
========================================================= */

.fp-btn{
  position:relative;
  overflow:hidden;
}

.fp-btn::after{
  content:'';
  position:absolute;
  inset:0;
  background:
    linear-gradient(
      135deg,
      rgba(255,255,255,.18),
      transparent 50%
    );
  opacity:0;
  transition:.22s;
}

.fp-btn:hover::after{
  opacity:1;
}

.fp-btn:active{
  transform:
    scale(.98);
}

/* =========================================================
   GLASS EFFECT
========================================================= */

.fp-glass{
  backdrop-filter:
    blur(18px);

  background:
    rgba(255,255,255,.04);

  border:
    1px solid
    rgba(255,255,255,.06);
}

/* =========================================================
   SCROLLBAR
========================================================= */

::-webkit-scrollbar{
  width:10px;
  height:10px;
}

::-webkit-scrollbar-track{
  background:
    rgba(255,255,255,.03);
}

::-webkit-scrollbar-thumb{
  background:
    rgba(255,255,255,.12);

  border-radius:999px;
}

::-webkit-scrollbar-thumb:hover{
  background:
    rgba(255,255,255,.18);
}

/* =========================================================
   TABLE EFFECTS
========================================================= */

.fp-table tbody tr{
  transition:.18s;
}

.fp-table tbody tr:hover{
  background:
    rgba(255,255,255,.03);
}

/* =========================================================
   INPUT EFFECTS
========================================================= */

.fp-input,
.fp-select,
.fp-textarea{
  transition:
    border-color .2s,
    box-shadow .2s,
    background .2s;
}

.fp-input:focus,
.fp-select:focus,
.fp-textarea:focus{

  border-color:
    rgba(47,91,255,.44);

  box-shadow:
    0 0 0 4px
    rgba(47,91,255,.12);

  background:
    rgba(255,255,255,.06);
}

/* =========================================================
   PROGRESS EFFECT
========================================================= */

.fp-progressBar{
  position:relative;
  overflow:hidden;
}

.fp-progressBar::after{
  content:'';
  position:absolute;
  inset:0;
  background:
    linear-gradient(
      90deg,
      transparent,
      rgba(255,255,255,.28),
      transparent
    );

  animation:
    fpProgressShine 2s linear infinite;
}

@keyframes fpProgressShine{

  from{
    transform:
      translateX(-100%);
  }

  to{
    transform:
      translateX(100%);
  }
}

/* =========================================================
   BADGE EFFECT
========================================================= */

.fp-badge{
  backdrop-filter:
    blur(10px);
}

/* =========================================================
   SIDEBAR
========================================================= */

.fp-sidebar{
  backdrop-filter:
    blur(18px);
}

/* =========================================================
   TOPBAR
========================================================= */

.fp-topbar{
  backdrop-filter:
    blur(16px);
}

/* =========================================================
   ANIMATIONS
========================================================= */

.fp-fadeIn{
  animation:
    fpFadeIn .22s ease;
}

@keyframes fpFadeIn{

  from{
    opacity:0;
  }

  to{
    opacity:1;
  }
}

.fp-slideUp{
  animation:
    fpSlideUp .24s ease;
}

@keyframes fpSlideUp{

  from{
    opacity:0;
    transform:
      translateY(8px);
  }

  to{
    opacity:1;
    transform:
      translateY(0);
  }
}

/* =========================================================
   QUICK ACTIONS
========================================================= */

.fp-quickAction{
  position:relative;
  overflow:hidden;
}

.fp-quickAction::before{
  content:'';
  position:absolute;
  inset:0;
  background:
    radial-gradient(
      circle at top left,
      rgba(255,255,255,.28),
      transparent 40%
    );
}

/* =========================================================
   LOADER
========================================================= */

.fp-loaderRing{
  box-shadow:
    0 0 40px
    rgba(47,91,255,.28);
}

/* =========================================================
   COMMAND PALETTE
========================================================= */

.fp-commandItem{
  transition:
    transform .18s,
    background .18s;
}

.fp-commandItem:hover{
  transform:
    translateX(4px);
}

/* =========================================================
   TIMELINE
========================================================= */

.fp-timelineCard{
  transition:.2s;
}

.fp-timelineCard:hover{
  background:
    rgba(255,255,255,.05);
}

/* =========================================================
   LIVE DOT
========================================================= */

.fp-liveDot{
  box-shadow:
    0 0 20px
    rgba(16,185,129,.7);
}

/* =========================================================
   RESPONSIVE
========================================================= */

@media(max-width:980px){

  .fp-topbar{
    position:sticky;
    top:0;
    z-index:50;
  }

  .fp-sidebar{
    box-shadow:
      20px 0 60px
      rgba(0,0,0,.45);
  }
}

/* =========================================================
   REDUCED MOTION
========================================================= */

@media(prefers-reduced-motion:reduce){

  *,
  *::before,
  *::after{

    animation:none !important;
    transition:none !important;
    scroll-behavior:auto !important;
  }
}

/* =========================================================
   FINAL ENTERPRISE FINISH
========================================================= */

.fp-dashboardShell::after{
  content:'';
  position:fixed;
  inset:0;
  pointer-events:none;

  background:
    radial-gradient(
      circle at 15% 15%,
      rgba(47,91,255,.08),
      transparent 22%
    ),

    radial-gradient(
      circle at 85% 85%,
      rgba(91,130,255,.05),
      transparent 20%
    );

  z-index:-1;
}
/* =========================================================
   FINAL PRODUCTION PATCHES & UTILITIES
========================================================= */

/* =========================================================
   THEME ENGINE
========================================================= */

const themeState = {

  current:
    localStorage.getItem(
      'fp_theme'
    ) || 'dark',

};

function applyTheme(theme='dark'){

  themeState.current =
    theme;

  document.body.dataset.theme =
    theme;

  localStorage.setItem(
    'fp_theme',
    theme
  );
}

applyTheme(
  themeState.current
);

/* =========================================================
   COPY HELPER
========================================================= */

async function copyText(text=''){

  try{

    await navigator
      .clipboard
      .writeText(text);

    toast(
      'Copié dans le presse-papiers',
      'success'
    );

  }catch(error){

    toast(
      'Impossible de copier',
      'danger'
    );
  }
}

/* =========================================================
   DOWNLOAD HELPER
========================================================= */

function downloadFile({

  filename='export.txt',

  content='',

  type='text/plain',

} = {}){

  const blob =
    new Blob(

      [content],

      { type }

    );

  const url =
    URL.createObjectURL(
      blob
    );

  const link =
    document.createElement(
      'a'
    );

  link.href =
    url;

  link.download =
    filename;

  link.click();

  URL.revokeObjectURL(
    url
  );
}

/* =========================================================
   CSV EXPORT
========================================================= */

function exportTableToCsv({

  rows=[],

  filename='export.csv',

} = {}){

  const csv = rows

    .map(row =>

      row.map(cell =>

        `"${cell}"`

      ).join(',')

    )

    .join('\n');

  downloadFile({

    filename,

    content:csv,

    type:'text/csv',

  });
}

/* =========================================================
   PDF MOCK EXPORT
========================================================= */

function exportMockPdf(name='report'){

  downloadFile({

    filename:
      `${name}.txt`,

    content:
      'FlowPoint Executive Report Export',

  });

  toast(

    'Export PDF simulé généré',

    'success'

  );
}

/* =========================================================
   URL PARAMS
========================================================= */

function getUrlParam(key){

  const params =
    new URLSearchParams(

      window.location.search

    );

  return params.get(key);
}

/* =========================================================
   QUERY CACHE
========================================================= */

const queryCache =
  new Map();

function setCache(

  key,

  value

){

  queryCache.set(

    key,

    {

      value,

      createdAt:
        Date.now(),

    }

  );
}

function getCache(key){

  const item =
    queryCache.get(key);

  if(!item){
    return null;
  }

  return item.value;
}

/* =========================================================
   API MOCK
========================================================= */

async function fakeApi({

  data={},

  delay=400,

} = {}){

  await new Promise(resolve => {

    setTimeout(

      resolve,

      delay

    );

  });

  return {

    success:true,

    data,

  };
}

/* =========================================================
   NETWORK STATUS
========================================================= */

function renderNetworkStatus(){

  return `

    <div class="
      fp-systemHealth
    ">

      <div class="
        fp-systemHealthScore
      ">

        98

      </div>

      <div class="
        fp-systemHealthText
      ">

        Infrastructure stable

      </div>

    </div>

  `;
}

/* =========================================================
   SEARCH INDEX
========================================================= */

const searchIndex = [

  ...routes.map(route => ({

    type:'page',

    key:route.key,

    title:route.label,

  })),

  {

    type:'action',

    key:'generate-report',

    title:'Generate Executive Report',

  },

  {

    type:'action',

    key:'open-ai',

    title:'Open AI Center',

  },

];

/* =========================================================
   ADVANCED SEARCH
========================================================= */

function advancedSearch(query=''){

  const lower =
    query.toLowerCase();

  return searchIndex.filter(item =>

    item.title
      .toLowerCase()
      .includes(lower)

  );
}

/* =========================================================
   KEYBOARD NAVIGATION
========================================================= */

document.addEventListener(

  'keydown',

  event => {

    /* ALT + 1 */

    if(

      event.altKey

      &&

      event.key === '1'

    ){

      setRoute('overview');
    }

    /* ALT + 2 */

    if(

      event.altKey

      &&

      event.key === '2'

    ){

      setRoute('analytics');
    }

    /* ALT + 3 */

    if(

      event.altKey

      &&

      event.key === '3'

    ){

      setRoute('ai');
    }
  }
);

/* =========================================================
   AUTO REFRESH
========================================================= */

function startAutoRefresh(){

  setInterval(() => {

    console.log(
      'Auto refresh sync'
    );

  }, 60000);
}

startAutoRefresh();

/* =========================================================
   CLIENT STORAGE
========================================================= */

function saveDashboardSnapshot(){

  saveLocal(

    'fp_snapshot',

    {

      state,

      realtime,

      performanceState,

      savedAt:
        Date.now(),

    }

  );
}

setInterval(

  saveDashboardSnapshot,

  30000
);

/* =========================================================
   APP INFO
========================================================= */

function getAppInfo(){

  return {

    name:
      appConfig.appName,

    version:
      appConfig.version,

    environment:
      appConfig.environment,

  };
}

/* =========================================================
   FINAL STARTUP
========================================================= */

console.table(
  getAppInfo()
);

/* =========================================================
   FINAL READY
========================================================= */

console.log(
  'FlowPoint production utilities ready'
);
/* =========================================================
   FINAL ANALYTICS ENGINE
========================================================= */

/* =========================================================
   ANALYTICS STATE
========================================================= */

const analyticsState = {

  visitors:182420,

  conversions:4822,

  bounceRate:28,

  avgSession:'4m 22s',

};

/* =========================================================
   ANALYTICS PAGE
========================================================= */

function renderAnalytics(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Analytics Intelligence

              </div>

              <div class="
                fp-sectionText
              ">

                Performance,
                trafic,
                conversions,
                croissance
                et analytics enterprise.

              </div>

            </div>

            <button class="
              fp-btn
              fp-btnPrimary
            ">

              Export Analytics

            </button>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'Visitors',

          value:
            formatNumber(
              analyticsState
                .visitors
            ),

          trend:'+18%',

          icon:'👥',

        })}

        ${createStatCard({

          title:'Conversions',

          value:
            formatNumber(
              analyticsState
                .conversions
            ),

          trend:'+12%',

          icon:'🎯',

        })}

        ${createStatCard({

          title:'Bounce Rate',

          value:
            analyticsState
              .bounceRate + '%',

          trend:'-4%',

          icon:'📉',

        })}

        ${createStatCard({

          title:'Avg Session',

          value:
            analyticsState
              .avgSession,

          trend:'+8%',

          icon:'⏱️',

        })}

      </div>

      <!-- MAIN CHARTS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- TRAFFIC -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Traffic Growth

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                12,
                18,
                28,
                42,
                58,
                78,
                96,

              ],

              height:320,

            })}

          </div>

        </div>

        <!-- CONVERSIONS -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Conversion Analytics

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                8,
                14,
                22,
                34,
                46,
                58,
                72,

              ],

              height:320,

            })}

          </div>

        </div>

      </div>

      <!-- PERFORMANCE -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        <!-- SEO -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-sectionTitle
            " style="
              font-size:22px;
            ">

              SEO Performance

            </div>

            <div class="
              fp-sectionText
            ">

              Croissance organique,
              keywords
              et expansion visibilité.

            </div>

            <div class="
              fp-pricing
              fp-mt24
            " style="
              font-size:42px;
            ">

              +42%

            </div>

          </div>

        </div>

        <!-- CONVERSIONS -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-sectionTitle
            " style="
              font-size:22px;
            ">

              Conversion Rate

            </div>

            <div class="
              fp-sectionText
            ">

              Tracking performance
              et optimisation funnel.

            </div>

            <div class="
              fp-pricing
              fp-mt24
            " style="
              font-size:42px;
            ">

              4.8%

            </div>

          </div>

        </div>

        <!-- ENGAGEMENT -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-sectionTitle
            " style="
              font-size:22px;
            ">

              Engagement

            </div>

            <div class="
              fp-sectionText
            ">

              Temps session,
              interactions
              et activité visiteurs.

            </div>

            <div class="
              fp-pricing
              fp-mt24
            " style="
              font-size:42px;
            ">

              82%

            </div>

          </div>

        </div>

      </div>

      <!-- TABLE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Analytics Overview

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Metric',
              'Value',
              'Trend',
              'Status',

            ],

            rows:[

              [

                'Visitors',
                '182k',
                '+18%',
                'Growing',

              ],

              [

                'Conversions',
                '4.8k',
                '+12%',
                'Stable',

              ],

              [

                'SEO Reach',
                '482k',
                '+42%',
                'Excellent',

              ],

              [

                'Bounce Rate',
                '28%',
                '-4%',
                'Improving',

              ],

            ],

          })}

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Analytics Insights

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Growth Detected

                </div>

                <div class="
                  fp-listText
                ">

                  Hausse trafic organique observée.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Conversion Opportunity

                </div>

                <div class="
                  fp-listText
                ">

                  Optimisations funnel possibles.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Engagement Increase

                </div>

                <div class="
                  fp-listText
                ">

                  Temps moyen session en hausse.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   READY
========================================================= */

console.log(
  'Analytics engine ready'
);
/* =========================================================
   FINAL MONITORING ENGINE
========================================================= */

/* =========================================================
   MONITOR STATE
========================================================= */

const monitoringState = {

  uptime:
    '99.98%',

  incidents:
    2,

  activeMonitors:
    182,

  responseTime:
    '182ms',

  services:[

    {

      name:
        'Main API',

      status:
        'online',

      uptime:
        '99.99%',

      latency:
        '142ms',

    },

    {

      name:
        'Stripe Webhooks',

      status:
        'online',

      uptime:
        '99.98%',

      latency:
        '188ms',

    },

    {

      name:
        'AI Infrastructure',

      status:
        'warning',

      uptime:
        '98.82%',

      latency:
        '422ms',

    },

  ],

};

/* =========================================================
   MONITOR PAGE
========================================================= */

function renderMonitoring(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Infrastructure Monitoring

              </div>

              <div class="
                fp-sectionText
              ">

                Uptime,
                incidents,
                monitoring temps réel
                et stabilité infrastructure.

              </div>

            </div>

            <div class="
              fp-liveBadge
            ">

              <div class="
                fp-liveDot
              "></div>

              LIVE MONITORING

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'Uptime',

          value:
            monitoringState
              .uptime,

          trend:'+0.2%',

          icon:'🛰️',

        })}

        ${createStatCard({

          title:'Incidents',

          value:
            monitoringState
              .incidents,

          trend:'-2%',

          icon:'🚨',

        })}

        ${createStatCard({

          title:'Monitors',

          value:
            monitoringState
              .activeMonitors,

          trend:'+18%',

          icon:'📡',

        })}

        ${createStatCard({

          title:'Response',

          value:
            monitoringState
              .responseTime,

          trend:'+8%',

          icon:'⚡',

        })}

      </div>

      <!-- SERVICES -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Infrastructure Services

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-list
          ">

            ${monitoringState
              .services
              .map(service => `

                <div class="
                  fp-listItem
                ">

                  <div class="
                    fp-flex
                    fp-alignCenter
                    fp-gap20
                  ">

                    <div class="
                      fp-alertDot
                      ${
                        service.status
                      }
                    "></div>

                    <div>

                      <div class="
                        fp-listTitle
                      ">

                        ${service.name}

                      </div>

                      <div class="
                        fp-listText
                      ">

                        ${service.uptime}
                        •
                        ${service.latency}

                      </div>

                    </div>

                  </div>

                  <div class="
                    fp-badge
                    ${
                      service.status
                        === 'online'

                        ? 'fp-badgeSuccess'

                        : 'fp-badgeWarning'
                    }
                  ">

                    ${service.status}

                  </div>

                </div>

              `).join('')}

          </div>

        </div>

      </div>

      <!-- CHARTS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- UPTIME -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Uptime Analytics

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                98,
                99,
                99,
                99,
                100,
                99,
                100,

              ],

              height:320,

            })}

          </div>

        </div>

        <!-- LATENCY -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Latency Tracking

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                120,
                142,
                162,
                188,
                144,
                132,
                118,

              ],

              height:320,

            })}

          </div>

        </div>

      </div>

      <!-- INCIDENT TABLE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Incident History

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Incident',
              'Severity',
              'Duration',
              'Status',

            ],

            rows:[

              [

                'API overload',
                'High',
                '4 min',
                'Resolved',

              ],

              [

                'AI latency',
                'Medium',
                '12 min',
                'Monitoring',

              ],

              [

                'Webhook retry',
                'Low',
                '2 min',
                'Resolved',

              ],

            ],

          })}

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Monitoring Insights

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Stable Infrastructure

                </div>

                <div class="
                  fp-listText
                ">

                  Les services critiques restent stables.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  AI Latency Warning

                </div>

                <div class="
                  fp-listText
                ">

                  Quelques pics détectés sur IA.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Growth Capacity

                </div>

                <div class="
                  fp-listText
                ">

                  Infrastructure prête à scaler.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   READY
========================================================= */

console.log(
  'Monitoring engine ready'
);
/* =========================================================
   FINAL MISSIONS ENGINE
========================================================= */

/* =========================================================
   MISSIONS STATE
========================================================= */

const missionsState = {

  missions:[

    {

      id:
        uid('mission'),

      title:
        'Optimiser les pages locales',

      priority:
        'high',

      status:
        'todo',

      reward:
        '+18% SEO',

    },

    {

      id:
        uid('mission'),

      title:
        'Configurer nouveaux monitors',

      priority:
        'medium',

      status:
        'progress',

      reward:
        'Infrastructure',

    },

    {

      id:
        uid('mission'),

      title:
        'Créer executive report client',

      priority:
        'high',

      status:
        'done',

      reward:
        'Retention',

    },

  ],

};

/* =========================================================
   MISSIONS PAGE
========================================================= */

function renderMissions(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Missions Center

              </div>

              <div class="
                fp-sectionText
              ">

                Priorités,
                tâches,
                quick wins,
                workflows
                et organisation enterprise.

              </div>

            </div>

            <button

              id="
                fpCreateMission
              "

              class="
                fp-btn
                fp-btnPrimary
              "
            >

              Nouvelle mission

            </button>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'Missions',

          value:'182',

          trend:'+18%',

          icon:'🎯',

        })}

        ${createStatCard({

          title:'Completed',

          value:'142',

          trend:'+22%',

          icon:'✅',

        })}

        ${createStatCard({

          title:'In Progress',

          value:'28',

          trend:'+8%',

          icon:'⚡',

        })}

        ${createStatCard({

          title:'Critical',

          value:'12',

          trend:'-2%',

          icon:'🔥',

        })}

      </div>

      <!-- MISSIONS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Active Missions

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-list
          ">

            ${missionsState
              .missions
              .map(mission => `

                <div class="
                  fp-listItem
                ">

                  <div class="
                    fp-flex
                    fp-alignCenter
                    fp-gap20
                  ">

                    <div class="
                      fp-alertDot
                      ${mission.priority}
                    "></div>

                    <div>

                      <div class="
                        fp-listTitle
                      ">

                        ${mission.title}

                      </div>

                      <div class="
                        fp-listText
                      ">

                        Reward:
                        ${mission.reward}

                      </div>

                    </div>

                  </div>

                  <div class="
                    fp-flex
                    fp-alignCenter
                    fp-gap12
                  ">

                    <div class="
                      fp-badge
                      ${
                        mission.status
                          === 'done'

                          ? 'fp-badgeSuccess'

                          : mission.status
                            === 'progress'

                          ? 'fp-badgePrimary'

                          : 'fp-badgeWarning'
                      }
                    ">

                      ${mission.status}

                    </div>

                    <button class="
                      fp-btn
                      fp-btnGhost
                    ">

                      Ouvrir

                    </button>

                  </div>

                </div>

              `).join('')}

          </div>

        </div>

      </div>

      <!-- WORKFLOW -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- PROGRESS -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Mission Progress

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                12,
                22,
                38,
                52,
                68,
                82,
                98,

              ],

              height:320,

            })}

          </div>

        </div>

        <!-- PRIORITIES -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Priority Breakdown

          </div>

          <div class="
            fp-cardBody
          ">

            ${renderDataTable({

              columns:[

                'Priority',
                'Count',
                'Trend',

              ],

              rows:[

                [

                  'High',
                  '42',
                  '+8%',

                ],

                [

                  'Medium',
                  '82',
                  '+12%',

                ],

                [

                  'Low',
                  '58',
                  '+4%',

                ],

              ],

            })}

          </div>

        </div>

      </div>

      <!-- QUICK WINS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Quick Wins

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  SEO Expansion

                </div>

                <div class="
                  fp-listText
                ">

                  Optimiser pages locales prioritaires.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Infrastructure Scaling

                </div>

                <div class="
                  fp-listText
                ">

                  Ajouter nouveaux monitors uptime.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Client Retention

                </div>

                <div class="
                  fp-listText
                ">

                  Envoyer executive reports automatiques.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   EVENTS
========================================================= */

function bindMissionEvents(){

  const create =
    qs('#fpCreateMission');

  if(create){

    create.onclick = () => {

      openModal({

        title:
          'Nouvelle mission',

        content:`

          <div class="
            fp-flex
            fp-flexCol
            fp-gap20
          ">

            <input
              class="
                fp-input
              "
              placeholder="
                Nom mission
              "
            />

            <select class="
              fp-select
            ">

              <option>
                High
              </option>

              <option>
                Medium
              </option>

              <option>
                Low
              </option>

            </select>

            <button class="
              fp-btn
              fp-btnPrimary
            ">

              Créer mission

            </button>

          </div>

        `,

      });
    };
  }
}

/* =========================================================
   EVENTS PATCH
========================================================= */

const previousMissionBind =
  bindEvents;

bindEvents = function(){

  previousMissionBind();

  bindMissionEvents();
};

/* =========================================================
   READY
========================================================= */

console.log(
  'Missions engine ready'
);
/* =========================================================
   FINAL TEAM / CHAT ENGINE
========================================================= */

/* =========================================================
   TEAM STATE
========================================================= */

const teamState = {

  members:[

    {

      name:
        'Maël',

      role:
        'Owner',

      status:
        'online',

    },

    {

      name:
        'Lucas',

      role:
        'Developer',

      status:
        'online',

    },

    {

      name:
        'Emma',

      role:
        'SEO Manager',

      status:
        'away',

    },

  ],

  messages:[

    {

      author:
        'Maël',

      content:
        'Le nouveau dashboard enterprise est prêt.',

      time:
        '20:12',

    },

    {

      author:
        'Lucas',

      content:
        'Infrastructure monitoring synchronisé.',

      time:
        '20:16',

    },

  ],

};

/* =========================================================
   TEAM PAGE
========================================================= */

function renderTeam(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Team Workspace

              </div>

              <div class="
                fp-sectionText
              ">

                Collaboration,
                communication,
                notes,
                fichiers
                et organisation équipe.

              </div>

            </div>

            <button

              id="
                fpInviteMember
              "

              class="
                fp-btn
                fp-btnPrimary
              "
            >

              Inviter membre

            </button>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'Members',

          value:'12',

          trend:'+4%',

          icon:'👥',

        })}

        ${createStatCard({

          title:'Channels',

          value:'28',

          trend:'+12%',

          icon:'💬',

        })}

        ${createStatCard({

          title:'Tasks',

          value:'182',

          trend:'+18%',

          icon:'🎯',

        })}

        ${createStatCard({

          title:'Files Shared',

          value:'842',

          trend:'+22%',

          icon:'📁',

        })}

      </div>

      <!-- MAIN -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- CHAT -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Team Chat

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-chatMessages
            ">

              ${teamState
                .messages
                .map(message => `

                  <div class="
                    fp-chatMessage
                  ">

                    <div class="
                      fp-chatAvatar
                    ">

                      ${
                        message.author
                          .slice(0,1)
                      }

                    </div>

                    <div class="
                      fp-chatBubble
                    ">

                      <div class="
                        fp-chatAuthor
                      ">

                        ${message.author}

                      </div>

                      <div class="
                        fp-chatText
                      ">

                        ${message.content}

                      </div>

                      <div class="
                        fp-chatTime
                      ">

                        ${message.time}

                      </div>

                    </div>

                  </div>

                `).join('')}

            </div>

            <div class="
              fp-flex
              fp-gap12
              fp-mt24
            ">

              <input

                id="
                  fpTeamMessageInput
                "

                class="
                  fp-input
                "

                placeholder="
                  Envoyer un message...
                "
              />

              <button

                id="
                  fpSendTeamMessage
                "

                class="
                  fp-btn
                  fp-btnPrimary
                "
              >

                Envoyer

              </button>

            </div>

          </div>

        </div>

        <!-- MEMBERS -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Team Members

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-list
            ">

              ${teamState
                .members
                .map(member => `

                  <div class="
                    fp-listItem
                  ">

                    <div class="
                      fp-flex
                      fp-alignCenter
                      fp-gap20
                    ">

                      <div class="
                        fp-userMiniAvatar
                      ">

                        ${
                          member.name
                            .slice(0,1)
                        }

                      </div>

                      <div>

                        <div class="
                          fp-listTitle
                        ">

                          ${member.name}

                        </div>

                        <div class="
                          fp-listText
                        ">

                          ${member.role}

                        </div>

                      </div>

                    </div>

                    <div class="
                      fp-userStatus
                    ">

                      <div class="
                        fp-userStatusDot
                      "></div>

                      ${member.status}

                    </div>

                  </div>

                `).join('')}

            </div>

          </div>

        </div>

      </div>

      <!-- NOTES -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Shared Notes

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-noteCard
            ">

              <div class="
                fp-noteTitle
              ">

                SEO Expansion

              </div>

              <div class="
                fp-noteText
              ">

                Prioriser les pages locales Bruxelles.

              </div>

            </div>

            <div class="
              fp-noteCard
            ">

              <div class="
                fp-noteTitle
              ">

                Infrastructure

              </div>

              <div class="
                fp-noteText
              ">

                Ajouter nouveaux uptime monitors.

              </div>

            </div>

            <div class="
              fp-noteCard
            ">

              <div class="
                fp-noteTitle
              ">

                AI Reports

              </div>

              <div class="
                fp-noteText
              ">

                Automatiser exports enterprise.

              </div>

            </div>

          </div>

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Collaboration Insights

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Team Productivity

                </div>

                <div class="
                  fp-listText
                ">

                  Collaboration en forte progression.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Communication Flow

                </div>

                <div class="
                  fp-listText
                ">

                  Activité équipe stable et rapide.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Task Coordination

                </div>

                <div class="
                  fp-listText
                ">

                  Missions distribuées efficacement.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   SEND TEAM MESSAGE
========================================================= */

function sendTeamMessage(){

  const input =
    qs('#fpTeamMessageInput');

  if(!input){
    return;
  }

  const value =
    input.value.trim();

  if(!value){
    return;
  }

  teamState.messages.push({

    author:
      state.user?.name || 'Admin',

    content:value,

    time:
      new Date()
        .toLocaleTimeString(
          [],
          {
            hour:'2-digit',
            minute:'2-digit',
          }
        ),

  });

  input.value = '';

  render();
}

/* =========================================================
   EVENTS
========================================================= */

function bindTeamEvents(){

  const send =
    qs('#fpSendTeamMessage');

  if(send){

    send.onclick =
      sendTeamMessage;
  }

  const input =
    qs('#fpTeamMessageInput');

  if(input){

    input.onkeydown = event => {

      if(

        event.key === 'Enter'

      ){

        sendTeamMessage();
      }
    };
  }
}

/* =========================================================
   EVENTS PATCH
========================================================= */

const previousTeamBind =
  bindEvents;

bindEvents = function(){

  previousTeamBind();

  bindTeamEvents();
};

/* =========================================================
   READY
========================================================= */

console.log(
  'Team workspace ready'
);
/* =========================================================
   FINAL ROUTER / PAGE REGISTRY
========================================================= */

/* =========================================================
   ROUTES
========================================================= */

const routes = [

  {

    key:'overview',

    label:'Overview',

    icon:'🏠',

    render:
      renderOverview,

  },

  {

    key:'analytics',

    label:'Analytics',

    icon:'📈',

    render:
      renderAnalytics,

  },

  {

    key:'monitoring',

    label:'Monitoring',

    icon:'🛰️',

    render:
      renderMonitoring,

  },

  {

    key:'missions',

    label:'Missions',

    icon:'🎯',

    render:
      renderMissions,

  },

  {

    key:'reports',

    label:'Reports',

    icon:'📄',

    render:
      renderReports,

  },

  {

    key:'local-seo',

    label:'Local SEO',

    icon:'📍',

    render:
      renderLocalSeo,

  },

  {

    key:'competitors',

    label:'Competitors',

    icon:'🧠',

    render:
      renderCompetitors,

  },

  {

    key:'automation',

    label:'Automation',

    icon:'⚙️',

    render:
      renderAutomationCenter,

  },

  {

    key:'workspace',

    label:'Workspace',

    icon:'📁',

    render:
      renderWorkspaceOverview,

  },

  {

    key:'team',

    label:'Team',

    icon:'👥',

    render:
      renderTeam,

  },

  {

    key:'clients',

    label:'Clients',

    icon:'💼',

    render:
      renderClientPortal,

  },

  {

    key:'alerts',

    label:'Alerts',

    icon:'🚨',

    render:
      renderAlerts,

  },

  {

    key:'ai',

    label:'FlowPoint AI',

    icon:'🤖',

    render:
      renderAiCenter,

  },

  {

    key:'billing',

    label:'Billing',

    icon:'💳',

    render:
      renderBilling,

  },

  {

    key:'settings',

    label:'Settings',

    icon:'⚡',

    render:
      renderSettings,

  },

];

/* =========================================================
   CURRENT ROUTE
========================================================= */

function getCurrentRoute(){

  const found =
    routes.find(route =>

      route.key
      ===
      state.route

    );

  return (

    found

    ||

    routes[0]

  );
}

/* =========================================================
   SET ROUTE
========================================================= */

function setRoute(route='overview'){

  state.route =
    route;

  localStorage.setItem(

    'fp_route',

    route

  );

  render();
}

/* =========================================================
   RESTORE ROUTE
========================================================= */

const savedRoute =
  localStorage.getItem(
    'fp_route'
  );

if(savedRoute){

  state.route =
    savedRoute;
}

/* =========================================================
   SIDEBAR
========================================================= */

function renderSidebar(){

  return `

    <aside class="
      fp-sidebar
    ">

      <!-- TOP -->

      <div class="
        fp-sidebarTop
      ">

        <!-- BRAND -->

        <div class="
          fp-brand
        ">

          <div class="
            fp-brandLogo
          ">

            ⚡

          </div>

          <div>

            <div class="
              fp-brandName
            ">

              FlowPoint

            </div>

            <div class="
              fp-brandSub
            ">

              Enterprise Platform

            </div>

          </div>

        </div>

        <!-- NAV -->

        <div class="
          fp-sidebarNav
        ">

          ${routes.map(route => `

            <button

              class="
                fp-sidebarLink

                ${
                  state.route
                  === route.key

                  ? 'active'

                  : ''
                }
              "

              data-route="
                ${route.key}
              "
            >

              <div class="
                fp-sidebarIcon
              ">

                ${route.icon}

              </div>

              <span>

                ${route.label}

              </span>

            </button>

          `).join('')}

        </div>

      </div>

      <!-- BOTTOM -->

      <div class="
        fp-sidebarBottom
      ">

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-sectionTitle
            " style="
              font-size:20px;
            ">

              Ultra Plan

            </div>

            <div class="
              fp-sectionText
            ">

              Enterprise AI,
              monitoring,
              reports
              et scaling avancé.

            </div>

            <button class="
              fp-btn
              fp-btnPrimary
              fp-wFull
              fp-mt24
            ">

              Manage Plan

            </button>

          </div>

        </div>

      </div>

    </aside>

  `;
}

/* =========================================================
   TOPBAR
========================================================= */

function renderTopbar(){

  const current =
    getCurrentRoute();

  return `

    <header class="
      fp-topbar
    ">

      <!-- LEFT -->

      <div>

        <div class="
          fp-pageTitle
        ">

          ${current.label}

        </div>

        <div class="
          fp-pageSub
        ">

          FlowPoint Enterprise Dashboard

        </div>

      </div>

      <!-- RIGHT -->

      <div class="
        fp-flex
        fp-alignCenter
        fp-gap16
      ">

        <button

          id="
            fpGlobalSearchButton
          "

          class="
            fp-btn
            fp-btnGhost
          "
        >

          ⌘K

        </button>

        <button class="
          fp-btn
          fp-btnGhost
        ">

          🔔

        </button>

        <div class="
          fp-userProfile
        ">

          <div class="
            fp-userAvatar
          ">

            ${
              (
                state.user?.name
                || 'A'
              )
              .slice(0,1)
            }

          </div>

          <div>

            <div class="
              fp-userName
            ">

              ${
                state.user?.name
                || 'Admin'
              }

            </div>

            <div class="
              fp-userRole
            ">

              ${
                state.user?.role
                || 'Owner'
              }

            </div>

          </div>

        </div>

      </div>

    </header>

  `;
}

/* =========================================================
   APP LAYOUT
========================================================= */

function renderAppLayout(){

  const current =
    getCurrentRoute();

  return `

    <div class="
      fp-dashboardShell
    ">

      ${renderSidebar()}

      <main class="
        fp-main
      ">

        ${renderTopbar()}

        <div class="
          fp-content
        ">

          ${current.render()}

        </div>

      </main>

    </div>

  `;
}

/* =========================================================
   MAIN RENDER
========================================================= */

function render(){

  const app =
    qs('#app');

  if(!app){
    return;
  }

  app.innerHTML =
    renderAppLayout();

  bindEvents();
}

/* =========================================================
   BIND EVENTS
========================================================= */

function bindEvents(){

  /* ROUTES */

  qsa('[data-route]')
    .forEach(button => {

      button.onclick = () => {

        setRoute(

          button.dataset
            .route

        );
      };
    });

  /* SEARCH */

  const search =
    qs('#fpGlobalSearchButton');

  if(search){

    search.onclick =
      openGlobalSearch;
  }
}

/* =========================================================
   READY
========================================================= */

console.log(
  'Router system ready'
);
/* =========================================================
   FINAL CORE HELPERS / UTILITIES
========================================================= */

/* =========================================================
   GLOBAL STATE
========================================================= */

const state = {

  route:'overview',

  plan:'Ultra',

  user:{

    name:'Maël',

    role:'Owner',

    email:'admin@flowpoint.pro',

  },

};

/* =========================================================
   PERFORMANCE STATE
========================================================= */

const performanceState = {

  fps:60,

  memory:42,

  latency:122,

};

/* =========================================================
   REALTIME
========================================================= */

const realtime = {

  connected:true,

  lastSync:
    Date.now(),

};

/* =========================================================
   QUERY HELPERS
========================================================= */

function qs(selector,parent=document){

  return parent.querySelector(
    selector
  );
}

function qsa(selector,parent=document){

  return [

    ...parent.querySelectorAll(
      selector
    ),

  ];
}

/* =========================================================
   UID
========================================================= */

function uid(prefix='id'){

  return `

    ${prefix}

    _

    ${Math.random()

      .toString(36)

      .slice(2,10)}

  `

  .replace(/\s/g,'');
}

/* =========================================================
   FORMAT NUMBER
========================================================= */

function formatNumber(number=0){

  return new Intl.NumberFormat(

    'fr-FR'

  ).format(number);
}

/* =========================================================
   FORMAT CURRENCY
========================================================= */

function formatCurrency(value=0){

  return new Intl.NumberFormat(

    'fr-FR',

    {

      style:'currency',

      currency:'EUR',

      maximumFractionDigits:0,

    }

  ).format(value);
}

/* =========================================================
   DATE FORMAT
========================================================= */

function formatDate(date=new Date()){

  return new Intl.DateTimeFormat(

    'fr-FR',

    {

      day:'2-digit',

      month:'short',

      year:'numeric',

    }

  ).format(date);
}

/* =========================================================
   LOCAL STORAGE
========================================================= */

function saveLocal(

  key,

  value

){

  try{

    localStorage.setItem(

      key,

      JSON.stringify(value)

    );

  }catch(error){

    console.error(error);
  }
}

function loadLocal(key){

  try{

    const value =
      localStorage.getItem(key);

    if(!value){
      return null;
    }

    return JSON.parse(value);

  }catch(error){

    console.error(error);

    return null;
  }
}

/* =========================================================
   TOAST
========================================================= */

function toast(

  message='Saved',

  type='primary'

){

  const toast =
    document.createElement(
      'div'
    );

  toast.className = `

    fp-toast
    ${type}

  `;

  toast.innerHTML = `

    <div class="
      fp-toastContent
    ">

      ${message}

    </div>

  `;

  document.body.appendChild(
    toast
  );

  requestAnimationFrame(() => {

    toast.classList.add(
      'visible'
    );

  });

  setTimeout(() => {

    toast.classList.remove(
      'visible'
    );

    setTimeout(() => {

      toast.remove();

    }, 240);

  }, 3200);
}

/* =========================================================
   MODAL
========================================================= */

function openModal({

  title='',

  content='',

} = {}){

  closeModal();

  const modal =
    document.createElement(
      'div'
    );

  modal.className =
    'fp-modalOverlay';

  modal.innerHTML = `

    <div class="
      fp-modal
    ">

      <div class="
        fp-modalHeader
      ">

        <div class="
          fp-modalTitle
        ">

          ${title}

        </div>

        <button

          id="
            fpCloseModal
          "

          class="
            fp-modalClose
          "
        >

          ✕

        </button>

      </div>

      <div class="
        fp-modalBody
      ">

        ${content}

      </div>

    </div>

  `;

  document.body.appendChild(
    modal
  );

  qs('#fpCloseModal')
    .onclick =
      closeModal;

  modal.onclick = event => {

    if(

      event.target
      ===
      modal

    ){

      closeModal();
    }
  };
}

function closeModal(){

  qsa('.fp-modalOverlay')
    .forEach(modal => {

      modal.remove();

    });
}

/* =========================================================
   DATA TABLE
========================================================= */

function renderDataTable({

  columns=[],

  rows=[],

} = {}){

  return `

    <div class="
      fp-tableWrap
    ">

      <table class="
        fp-table
      ">

        <thead>

          <tr>

            ${columns.map(column => `

              <th>

                ${column}

              </th>

            `).join('')}

          </tr>

        </thead>

        <tbody>

          ${rows.map(row => `

            <tr>

              ${row.map(cell => `

                <td>

                  ${cell}

                </td>

              `).join('')}

            </tr>

          `).join('')}

        </tbody>

      </table>

    </div>

  `;
}

/* =========================================================
   MINI CHART
========================================================= */

function createMiniChart({

  values=[],

  height=220,

} = {}){

  const max =
    Math.max(...values,1);

  return `

    <div

      class="
        fp-miniChart
      "

      style="
        height:${height}px;
      "
    >

      ${values.map(value => `

        <div class="
          fp-miniChartBarWrap
        ">

          <div

            class="
              fp-miniChartBar
            "

            style="
              height:
              ${(value/max)*100}%;
            "
          ></div>

        </div>

      `).join('')}

    </div>

  `;
}

/* =========================================================
   PDF PREVIEW
========================================================= */

function openPdfPreview(

  title='Preview'

){

  openModal({

    title,

    content:`

      <div class="
        fp-chartEmpty
      " style="
        height:520px;
      ">

        PDF Preview

      </div>

    `,

  });
}

/* =========================================================
   SEARCH
========================================================= */

function performGlobalSearch(

  query=''

){

  const lower =
    query.toLowerCase();

  return routes.filter(route =>

    route.label

      .toLowerCase()

      .includes(lower)

  );
}

/* =========================================================
   REALTIME ENGINE
========================================================= */

function startRealtimeEngine(){

  setInterval(() => {

    realtime.lastSync =
      Date.now();

  }, 5000);
}

/* =========================================================
   READY
========================================================= */

console.log(
  'Core helpers ready'
);
/* =========================================================
   FINAL COMPONENTS CSS
========================================================= */

/* =========================================================
   BRAND
========================================================= */

.fp-brand{
  display:flex;
  align-items:center;
  gap:16px;
}

.fp-brandLogo{
  width:56px;
  height:56px;
  border-radius:18px;
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:24px;
  background:
    linear-gradient(
      135deg,
      #2f5bff,
      #5d82ff
    );
  color:white;
  box-shadow:
    0 20px 50px
    rgba(47,91,255,.34);
}

.fp-brandName{
  font-size:22px;
  font-weight:900;
  line-height:1;
}

.fp-brandSub{
  margin-top:6px;
  color:#8ea3d4;
  font-size:13px;
}

/* =========================================================
   STAT CARD
========================================================= */

.fp-statCard{
  position:relative;
  overflow:hidden;
  padding:24px;
  border-radius:28px;
  background:
    linear-gradient(
      180deg,
      rgba(20,28,50,.96),
      rgba(10,16,30,.96)
    );
  border:
    1px solid
    rgba(255,255,255,.06);
}

.fp-statValue{
  margin-top:28px;
  font-size:42px;
  font-weight:900;
  line-height:1;
}

.fp-statTitle{
  margin-top:12px;
  color:#8ea3d4;
  font-size:14px;
  font-weight:700;
}

.fp-statIcon{
  width:54px;
  height:54px;
  border-radius:18px;
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:22px;
  background:
    rgba(47,91,255,.14);
}

/* =========================================================
   HERO
========================================================= */

.fp-executiveHero{
  overflow:hidden;
}

.fp-heroGreeting{
  color:#9ab2ff;
  font-size:15px;
  font-weight:700;
}

.fp-heroTitle{
  margin-top:16px;
  font-size:52px;
  line-height:1;
  font-weight:900;
  max-width:720px;
}

.fp-heroText{
  margin-top:20px;
  max-width:760px;
  color:#b6c8f2;
  line-height:1.8;
  font-size:15px;
}

.fp-heroStats{
  width:320px;
  display:flex;
  flex-direction:column;
  gap:18px;
}

.fp-heroStat{
  padding:22px;
  border-radius:22px;
  background:
    rgba(255,255,255,.05);
  border:
    1px solid
    rgba(255,255,255,.06);
}

.fp-heroStatValue{
  font-size:34px;
  font-weight:900;
}

.fp-heroStatLabel{
  margin-top:8px;
  color:#9cb1df;
  font-size:13px;
}

/* =========================================================
   SECTION
========================================================= */

.fp-sectionTitle{
  font-size:34px;
  line-height:1.1;
  font-weight:900;
}

.fp-sectionText{
  margin-top:12px;
  color:#9cb1df;
  line-height:1.8;
  font-size:14px;
}

/* =========================================================
   KPI
========================================================= */

.fp-kpiCard{
  padding:18px;
  border-radius:20px;
  background:
    rgba(255,255,255,.04);
  border:
    1px solid
    rgba(255,255,255,.06);
}

.fp-kpiLabel{
  color:#8ea3d4;
  font-size:12px;
  font-weight:700;
}

.fp-kpiValue{
  margin-top:12px;
  font-size:28px;
  font-weight:900;
}

/* =========================================================
   LIST
========================================================= */

.fp-list{
  display:flex;
  flex-direction:column;
  gap:14px;
}

.fp-listItem{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:18px;
  padding:18px;
  border-radius:20px;
  background:
    rgba(255,255,255,.03);
  border:
    1px solid
    rgba(255,255,255,.04);
}

.fp-listTitle{
  font-size:15px;
  font-weight:800;
}

.fp-listText{
  margin-top:8px;
  color:#8ea3d4;
  font-size:13px;
}

/* =========================================================
   USER
========================================================= */

.fp-userProfile{
  display:flex;
  align-items:center;
  gap:14px;
}

.fp-userAvatar{
  width:52px;
  height:52px;
  border-radius:18px;
  display:flex;
  align-items:center;
  justify-content:center;
  background:
    linear-gradient(
      135deg,
      #2f5bff,
      #5d82ff
    );
  font-size:20px;
  font-weight:900;
}

.fp-userMiniAvatar{
  width:48px;
  height:48px;
  border-radius:16px;
  display:flex;
  align-items:center;
  justify-content:center;
  background:
    rgba(47,91,255,.14);
  font-size:16px;
  font-weight:800;
}

.fp-userName{
  font-size:14px;
  font-weight:800;
}

.fp-userRole{
  margin-top:6px;
  color:#8ea3d4;
  font-size:12px;
}

.fp-userStatus{
  display:flex;
  align-items:center;
  gap:10px;
  color:#9ed9b7;
  font-size:13px;
  font-weight:700;
}

.fp-userStatusDot{
  width:10px;
  height:10px;
  border-radius:999px;
  background:#10b981;
}

/* =========================================================
   ALERTS
========================================================= */

.fp-alertItem{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:18px;
  padding:18px;
  border-radius:22px;
  background:
    rgba(255,255,255,.03);
  border:
    1px solid
    rgba(255,255,255,.05);
}

.fp-alertDot{
  width:14px;
  height:14px;
  border-radius:999px;
}

.fp-alertDot.online,
.fp-alertDot.success{
  background:#10b981;
}

.fp-alertDot.warning,
.fp-alertDot.medium{
  background:#f59e0b;
}

.fp-alertDot.danger,
.fp-alertDot.high{
  background:#ef4444;
}

.fp-alertDot.primary{
  background:#2f5bff;
}

/* =========================================================
   TIMELINE
========================================================= */

.fp-timeline{
  display:flex;
  flex-direction:column;
  gap:22px;
}

.fp-timelineItem{
  display:flex;
  align-items:flex-start;
  gap:18px;
}

.fp-timelineDot{
  width:14px;
  height:14px;
  margin-top:12px;
  border-radius:999px;
  flex-shrink:0;
}

.fp-timelineCard{
  flex:1;
  padding:20px;
  border-radius:22px;
  background:
    rgba(255,255,255,.03);
  border:
    1px solid
    rgba(255,255,255,.04);
}

.fp-timelineTitle{
  font-size:15px;
  font-weight:800;
}

.fp-timelineText{
  margin-top:10px;
  color:#8ea3d4;
  line-height:1.7;
  font-size:13px;
}

.fp-timelineTime{
  margin-top:14px;
  color:#6f84b7;
  font-size:12px;
}

/* =========================================================
   RESPONSIVE
========================================================= */

@media(max-width:980px){

  .fp-heroTitle{
    font-size:38px;
  }

  .fp-heroStats{
    width:100%;
  }
}

@media(max-width:760px){

  .fp-sectionTitle{
    font-size:28px;
  }

  .fp-heroTitle{
    font-size:30px;
  }

  .fp-statValue{
    font-size:34px;
  }
}
/* =========================================================
   FINAL ADVANCED MODULES CSS
========================================================= */

/* =========================================================
   AI CHAT
========================================================= */

.fp-aiMessages{
  display:flex;
  flex-direction:column;
  gap:18px;
  max-height:620px;
  overflow:auto;
}

.fp-aiMessage{
  display:flex;
}

.fp-aiMessage.user{
  justify-content:flex-end;
}

.fp-aiBubble{
  max-width:720px;
  padding:18px 20px;
  border-radius:24px;
  line-height:1.8;
  font-size:14px;
}

.fp-aiMessage.assistant .fp-aiBubble{
  background:
    rgba(255,255,255,.04);

  border:
    1px solid
    rgba(255,255,255,.06);
}

.fp-aiMessage.user .fp-aiBubble{
  background:
    linear-gradient(
      135deg,
      #2f5bff,
      #5d82ff
    );

  color:white;
}

/* =========================================================
   CHAT
========================================================= */

.fp-chatMessages{
  display:flex;
  flex-direction:column;
  gap:18px;
  max-height:560px;
  overflow:auto;
}

.fp-chatMessage{
  display:flex;
  align-items:flex-start;
  gap:14px;
}

.fp-chatAvatar{
  width:42px;
  height:42px;
  border-radius:14px;
  display:flex;
  align-items:center;
  justify-content:center;
  background:
    rgba(47,91,255,.14);
  font-weight:800;
  flex-shrink:0;
}

.fp-chatBubble{
  max-width:760px;
  padding:18px;
  border-radius:22px;
  background:
    rgba(255,255,255,.04);
  border:
    1px solid
    rgba(255,255,255,.05);
}

.fp-chatAuthor{
  font-size:13px;
  font-weight:800;
  color:#9db4ff;
}

.fp-chatText{
  margin-top:10px;
  line-height:1.8;
  font-size:14px;
}

.fp-chatTime{
  margin-top:14px;
  color:#7388b9;
  font-size:12px;
}

/* =========================================================
   NOTES
========================================================= */

.fp-noteCard{
  padding:22px;
  border-radius:24px;
  background:
    linear-gradient(
      180deg,
      rgba(255,255,255,.05),
      rgba(255,255,255,.03)
    );
  border:
    1px solid
    rgba(255,255,255,.05);
}

.fp-noteTitle{
  font-size:18px;
  font-weight:800;
}

.fp-noteText{
  margin-top:14px;
  color:#8ea3d4;
  line-height:1.8;
  font-size:14px;
}

/* =========================================================
   MINI CHART
========================================================= */

.fp-miniChart{
  width:100%;
  display:flex;
  align-items:flex-end;
  gap:14px;
}

.fp-miniChartBarWrap{
  flex:1;
  height:100%;
  display:flex;
  align-items:flex-end;
}

.fp-miniChartBar{
  width:100%;
  border-radius:18px 18px 8px 8px;
  min-height:12px;
  background:
    linear-gradient(
      180deg,
      #5d82ff,
      #2f5bff
    );
}

/* =========================================================
   EMPTY
========================================================= */

.fp-emptyState{
  padding:80px 20px;
  display:flex;
  flex-direction:column;
  align-items:center;
  text-align:center;
}

.fp-emptyIcon{
  font-size:72px;
}

.fp-emptyTitle{
  margin-top:28px;
  font-size:30px;
  font-weight:900;
}

.fp-emptyText{
  margin-top:16px;
  max-width:620px;
  color:#8ea3d4;
  line-height:1.8;
}

/* =========================================================
   TOAST
========================================================= */

.fp-toast{
  position:fixed;
  right:24px;
  bottom:24px;
  z-index:9999;

  min-width:320px;
  max-width:480px;

  padding:18px 20px;

  border-radius:22px;

  background:
    rgba(15,20,38,.96);

  border:
    1px solid
    rgba(255,255,255,.08);

  backdrop-filter:
    blur(18px);

  transform:
    translateY(24px);

  opacity:0;

  transition:.24s;
}

.fp-toast.visible{
  opacity:1;
  transform:
    translateY(0);
}

.fp-toast.primary{
  border-color:
    rgba(47,91,255,.28);
}

.fp-toast.success{
  border-color:
    rgba(16,185,129,.28);
}

.fp-toast.warning{
  border-color:
    rgba(245,158,11,.28);
}

.fp-toast.danger{
  border-color:
    rgba(239,68,68,.28);
}

.fp-toastContent{
  font-size:14px;
  line-height:1.7;
}

/* =========================================================
   MODAL
========================================================= */

.fp-modalOverlay{
  position:fixed;
  inset:0;
  z-index:9998;

  padding:24px;

  display:flex;
  align-items:center;
  justify-content:center;

  background:
    rgba(0,0,0,.58);

  backdrop-filter:
    blur(8px);
}

.fp-modal{
  width:min(720px,100%);
  max-height:90vh;
  overflow:auto;

  border-radius:32px;

  background:
    linear-gradient(
      180deg,
      rgba(18,25,45,.98),
      rgba(10,16,30,.98)
    );

  border:
    1px solid
    rgba(255,255,255,.08);
}

.fp-modalHeader{
  padding:24px 26px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:20px;

  border-bottom:
    1px solid
    rgba(255,255,255,.06);
}

.fp-modalTitle{
  font-size:22px;
  font-weight:900;
}

.fp-modalClose{
  width:42px;
  height:42px;
  border:none;
  border-radius:14px;
  cursor:pointer;

  background:
    rgba(255,255,255,.06);

  color:white;
}

.fp-modalBody{
  padding:26px;
}

/* =========================================================
   COMMAND PALETTE
========================================================= */

.fp-commandPalette{
  display:flex;
  flex-direction:column;
  gap:18px;
}

.fp-commandInput{
  width:100%;
  min-height:58px;
  border:none;
  outline:none;

  padding:0 20px;

  border-radius:20px;

  background:
    rgba(255,255,255,.05);

  border:
    1px solid
    rgba(255,255,255,.06);

  color:white;

  font-size:15px;
}

.fp-searchResults{
  display:flex;
  flex-direction:column;
  gap:12px;
}

.fp-commandItem{
  width:100%;
  padding:18px;
  border:none;
  cursor:pointer;
  text-align:left;

  border-radius:20px;

  background:
    rgba(255,255,255,.03);

  border:
    1px solid
    rgba(255,255,255,.04);

  color:white;
}

.fp-commandTitle{
  font-size:15px;
  font-weight:800;
}

.fp-commandType{
  margin-top:8px;
  color:#8ea3d4;
  font-size:12px;
}

/* =========================================================
   LIVE BADGE
========================================================= */

.fp-liveBadge{
  display:inline-flex;
  align-items:center;
  gap:12px;

  padding:14px 18px;

  border-radius:999px;

  background:
    rgba(16,185,129,.12);

  border:
    1px solid
    rgba(16,185,129,.22);

  color:#9ce3bd;

  font-size:13px;
  font-weight:800;
}

.fp-liveDot{
  width:10px;
  height:10px;
  border-radius:999px;
  background:#10b981;
}

/* =========================================================
   QUICK ACTIONS
========================================================= */

.fp-quickActions{
  position:fixed;
  right:24px;
  bottom:24px;

  display:flex;
  flex-direction:column;
  gap:14px;

  z-index:80;
}

.fp-quickAction{
  width:62px;
  height:62px;

  border:none;
  cursor:pointer;

  border-radius:22px;

  background:
    linear-gradient(
      135deg,
      #2f5bff,
      #5d82ff
    );

  color:white;

  font-size:22px;

  box-shadow:
    0 20px 40px
    rgba(47,91,255,.34);
}

/* =========================================================
   RESPONSIVE
========================================================= */

@media(max-width:760px){

  .fp-modalOverlay{
    padding:14px;
  }

  .fp-modal{
    border-radius:24px;
  }

  .fp-toast{
    left:14px;
    right:14px;
    min-width:auto;
  }

  .fp-quickActions{
    right:14px;
    bottom:14px;
  }
}
/* =========================================================
   FINAL ADVANCED ENTERPRISE FEATURES
========================================================= */

/* =========================================================
   ACTIVITY FEED
========================================================= */

const activityFeed = [

  {

    icon:'📈',

    title:
      'SEO growth detected',

    text:
      'Nouvelle hausse organique observée.',

    time:
      '2 min',

  },

  {

    icon:'🛰️',

    title:
      'Infrastructure stable',

    text:
      'Tous les services critiques sont opérationnels.',

    time:
      '5 min',

  },

  {

    icon:'🤖',

    title:
      'AI report generated',

    text:
      'Executive report exporté automatiquement.',

    time:
      '12 min',

  },

];

/* =========================================================
   ACTIVITY PANEL
========================================================= */

function renderActivityPanel(){

  return `

    <div class="
      fp-card
    ">

      <div class="
        fp-cardHeader
      ">

        Live Activity Feed

      </div>

      <div class="
        fp-cardBody
      ">

        <div class="
          fp-list
        ">

          ${activityFeed.map(item => `

            <div class="
              fp-listItem
            ">

              <div class="
                fp-flex
                fp-alignCenter
                fp-gap20
              ">

                <div class="
                  fp-userMiniAvatar
                ">

                  ${item.icon}

                </div>

                <div>

                  <div class="
                    fp-listTitle
                  ">

                    ${item.title}

                  </div>

                  <div class="
                    fp-listText
                  ">

                    ${item.text}

                  </div>

                </div>

              </div>

              <div class="
                fp-muted
                fp-textSm
              ">

                ${item.time}

              </div>

            </div>

          `).join('')}

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   SYSTEM HEALTH
========================================================= */

function renderSystemHealth(){

  return `

    <div class="
      fp-card
    ">

      <div class="
        fp-cardHeader
      ">

        System Health

      </div>

      <div class="
        fp-cardBody
      ">

        <div class="
          fp-grid3
        ">

          <div class="
            fp-kpiCard
          ">

            <div class="
              fp-kpiLabel
            ">

              CPU

            </div>

            <div class="
              fp-kpiValue
            ">

              42%

            </div>

            ${createProgress({

              value:42,

            })}

          </div>

          <div class="
            fp-kpiCard
          ">

            <div class="
              fp-kpiLabel
            ">

              Memory

            </div>

            <div class="
              fp-kpiValue
            ">

              58%

            </div>

            ${createProgress({

              value:58,

            })}

          </div>

          <div class="
            fp-kpiCard
          ">

            <div class="
              fp-kpiLabel
            ">

              Network

            </div>

            <div class="
              fp-kpiValue
            ">

              82%

            </div>

            ${createProgress({

              value:82,

            })}

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   EXECUTIVE SUMMARY
========================================================= */

function renderExecutiveSummary(){

  return `

    <div class="
      fp-card
      fp-gradientPrimary
    ">

      <div class="
        fp-cardBody
      ">

        <div class="
          fp-sectionTitle
        ">

          Executive Summary

        </div>

        <div class="
          fp-sectionText
        ">

          FlowPoint détecte actuellement
          une croissance SEO importante,
          une infrastructure stable
          et plusieurs opportunités
          enterprise à fort potentiel.

        </div>

        <div class="
          fp-grid3
          fp-mt24
        ">

          <div class="
            fp-kpiCard
          ">

            <div class="
              fp-kpiLabel
            ">

              Revenue Potential

            </div>

            <div class="
              fp-kpiValue
            ">

              +28%

            </div>

          </div>

          <div class="
            fp-kpiCard
          ">

            <div class="
              fp-kpiLabel
            ">

              SEO Growth

            </div>

            <div class="
              fp-kpiValue
            ">

              +42%

            </div>

          </div>

          <div class="
            fp-kpiCard
          ">

            <div class="
              fp-kpiLabel
            ">

              Infrastructure

            </div>

            <div class="
              fp-kpiValue
            ">

              Stable

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   SMART NOTIFICATIONS
========================================================= */

function pushSmartNotification({

  title='Notification',

  text='',

  type='primary',

} = {}){

  toast(

    `${title} • ${text}`,

    type

  );
}

/* =========================================================
   DEMO NOTIFICATIONS
========================================================= */

function startDemoNotifications(){

  const notifications = [

    () => pushSmartNotification({

      title:
        'SEO Growth',

      text:
        'Nouvelle hausse organique détectée.',

      type:
        'success',

    }),

    () => pushSmartNotification({

      title:
        'Infrastructure',

      text:
        'Tous les services sont stables.',

      type:
        'primary',

    }),

    () => pushSmartNotification({

      title:
        'AI Report',

      text:
        'Executive report généré.',

      type:
        'warning',

    }),

  ];

  let index = 0;

  setInterval(() => {

    notifications[
      index %
      notifications.length
    ]();

    index++;

  }, 45000);
}

/* =========================================================
   SESSION TRACKER
========================================================= */

const sessionTracker = {

  startedAt:
    Date.now(),

  actions:0,

};

function trackAction(){

  sessionTracker.actions++;
}

/* =========================================================
   AUTO TRACK BUTTONS
========================================================= */

document.addEventListener(

  'click',

  event => {

    const target =
      event.target;

    if(

      target.closest('button')

    ){

      trackAction();
    }
  }
);

/* =========================================================
   SESSION ANALYTICS
========================================================= */

function getSessionAnalytics(){

  return {

    duration:
      Math.floor(

        (
          Date.now()
          -
          sessionTracker.startedAt
        ) / 1000

      ),

    actions:
      sessionTracker.actions,

  };
}

/* =========================================================
   START
========================================================= */

startDemoNotifications();

/* =========================================================
   READY
========================================================= */

console.log(
  'Advanced enterprise features ready'
);
/* =========================================================
   FINAL SETTINGS PAGE
========================================================= */

/* =========================================================
   SETTINGS STATE
========================================================= */

const settingsState = {

  notifications:true,

  realtime:true,

  ai:true,

  darkMode:true,

  autoReports:true,

};

/* =========================================================
   TOGGLE
========================================================= */

function toggleSetting(key){

  settingsState[key] =
    !settingsState[key];

  saveLocal(

    'fp_settings',

    settingsState

  );

  render();

  toast(

    'Paramètre mis à jour',

    'success'

  );
}

/* =========================================================
   SETTINGS SWITCH
========================================================= */

function createSettingSwitch({

  key='',

  title='Setting',

  text='',

} = {}){

  const enabled =
    settingsState[key];

  return `

    <div class="
      fp-listItem
    ">

      <div>

        <div class="
          fp-listTitle
        ">

          ${title}

        </div>

        <div class="
          fp-listText
        ">

          ${text}

        </div>

      </div>

      <button

        class="
          fp-switch
          ${
            enabled
              ? 'active'
              : ''
          }
        "

        data-toggle-setting="
          ${key}
        "
      >

        <div class="
          fp-switchDot
        "></div>

      </button>

    </div>

  `;
}

/* =========================================================
   SETTINGS PAGE
========================================================= */

function renderSettings(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-sectionTitle
          ">

            Platform Settings

          </div>

          <div class="
            fp-sectionText
          ">

            Configuration,
            sécurité,
            notifications,
            IA
            et paramètres enterprise.

          </div>

        </div>

      </div>

      <!-- GRID -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- GENERAL -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            General Settings

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-list
            ">

              ${createSettingSwitch({

                key:'notifications',

                title:'Notifications',

                text:
                  'Recevoir les alertes et événements.',

              })}

              ${createSettingSwitch({

                key:'realtime',

                title:'Realtime Engine',

                text:
                  'Synchronisation temps réel.',

              })}

              ${createSettingSwitch({

                key:'darkMode',

                title:'Dark Mode',

                text:
                  'Interface sombre premium.',

              })}

            </div>

          </div>

        </div>

        <!-- AI -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            AI Settings

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-list
            ">

              ${createSettingSwitch({

                key:'ai',

                title:'AI Engine',

                text:
                  'Activer intelligence artificielle.',

              })}

              ${createSettingSwitch({

                key:'autoReports',

                title:'Auto Reports',

                text:
                  'Génération automatique des reports.',

              })}

            </div>

          </div>

        </div>

      </div>

      <!-- SECURITY -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Security & Infrastructure

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-kpiCard
            ">

              <div class="
                fp-kpiLabel
              ">

                Authentication

              </div>

              <div class="
                fp-kpiValue
              ">

                Active

              </div>

            </div>

            <div class="
              fp-kpiCard
            ">

              <div class="
                fp-kpiLabel
              ">

                Encryption

              </div>

              <div class="
                fp-kpiValue
              ">

                AES-256

              </div>

            </div>

            <div class="
              fp-kpiCard
            ">

              <div class="
                fp-kpiLabel
              ">

                Infrastructure

              </div>

              <div class="
                fp-kpiValue
              ">

                Stable

              </div>

            </div>

          </div>

        </div>

      </div>

      <!-- BILLING -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Enterprise Preferences

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Feature',
              'Status',
              'Plan',

            ],

            rows:[

              [

                'Realtime AI',
                'Enabled',
                'Ultra',

              ],

              [

                'Executive Reports',
                'Enabled',
                'Ultra',

              ],

              [

                'Infrastructure Monitoring',
                'Enabled',
                'Pro',

              ],

              [

                'Local SEO Intelligence',
                'Enabled',
                'Pro',

              ],

            ],

          })}

        </div>

      </div>

      <!-- ACTIONS -->

      <div class="
        fp-flex
        fp-gap16
        fp-mt24
      ">

        <button class="
          fp-btn
          fp-btnPrimary
        ">

          Sauvegarder

        </button>

        <button class="
          fp-btn
          fp-btnGhost
        ">

          Export Config

        </button>

      </div>

    </div>

  `;
}

/* =========================================================
   EVENTS
========================================================= */

function bindSettingsEvents(){

  qsa('[data-toggle-setting]')
    .forEach(button => {

      button.onclick = () => {

        toggleSetting(

          button.dataset
            .toggleSetting

        );
      };
    });
}

/* =========================================================
   EVENTS PATCH
========================================================= */

const previousSettingsBind =
  bindEvents;

bindEvents = function(){

  previousSettingsBind();

  bindSettingsEvents();
};

/* =========================================================
   RESTORE
========================================================= */

const savedSettings =
  loadLocal(
    'fp_settings'
  );

if(savedSettings){

  Object.assign(

    settingsState,

    savedSettings

  );
}

/* =========================================================
   READY
========================================================= */

console.log(
  'Settings page ready'
);
/* =========================================================
   FINAL SETTINGS / FORMS / TABLES CSS
========================================================= */

/* =========================================================
   INPUTS
========================================================= */

.fp-input,
.fp-select,
.fp-textarea{
  width:100%;
  min-height:56px;

  border:none;
  outline:none;

  padding:0 20px;

  border-radius:20px;

  background:
    rgba(255,255,255,.04);

  border:
    1px solid
    rgba(255,255,255,.06);

  color:white;

  font-size:14px;
  font-weight:600;
}

.fp-textarea{
  min-height:160px;
  resize:vertical;
  padding:20px;
}

.fp-input::placeholder,
.fp-textarea::placeholder{
  color:#7d93c6;
}

/* =========================================================
   SWITCH
========================================================= */

.fp-switch{
  width:70px;
  height:38px;

  border:none;
  cursor:pointer;

  border-radius:999px;

  position:relative;

  background:
    rgba(255,255,255,.08);

  transition:.2s;
}

.fp-switch.active{
  background:
    linear-gradient(
      135deg,
      #2f5bff,
      #5d82ff
    );
}

.fp-switchDot{
  position:absolute;
  top:5px;
  left:5px;

  width:28px;
  height:28px;

  border-radius:999px;

  background:white;

  transition:.2s;
}

.fp-switch.active .fp-switchDot{
  left:37px;
}

/* =========================================================
   BADGES
========================================================= */

.fp-badge{
  display:inline-flex;
  align-items:center;
  justify-content:center;

  min-height:34px;

  padding:0 14px;

  border-radius:999px;

  font-size:12px;
  font-weight:800;
}

.fp-badgePrimary{
  background:
    rgba(47,91,255,.14);

  border:
    1px solid
    rgba(47,91,255,.22);

  color:#b6c8ff;
}

.fp-badgeSuccess{
  background:
    rgba(16,185,129,.14);

  border:
    1px solid
    rgba(16,185,129,.22);

  color:#a7e5c5;
}

.fp-badgeWarning{
  background:
    rgba(245,158,11,.14);

  border:
    1px solid
    rgba(245,158,11,.22);

  color:#f7d8a1;
}

.fp-badgeDanger{
  background:
    rgba(239,68,68,.14);

  border:
    1px solid
    rgba(239,68,68,.22);

  color:#f6b0b0;
}

/* =========================================================
   TABLE WRAP
========================================================= */

.fp-tableWrap{
  width:100%;
  overflow:auto;
}

.fp-table{
  min-width:760px;
  border-collapse:collapse;
}

/* =========================================================
   TABLE ROWS
========================================================= */

.fp-table tbody tr:last-child td{
  border-bottom:none;
}

/* =========================================================
   BUTTONS
========================================================= */

.fp-btnPrimary{
  background:
    linear-gradient(
      135deg,
      #2f5bff,
      #5d82ff
    );

  color:white;

  box-shadow:
    0 20px 40px
    rgba(47,91,255,.24);
}

.fp-btnGhost{
  background:
    rgba(255,255,255,.04);

  border:
    1px solid
    rgba(255,255,255,.06);

  color:white;
}

.fp-btnDanger{
  background:
    rgba(239,68,68,.14);

  border:
    1px solid
    rgba(239,68,68,.24);

  color:#f5b3b3;
}

.fp-wFull{
  width:100%;
}

/* =========================================================
   PRICING
========================================================= */

.fp-pricing{
  font-size:54px;
  line-height:1;
  font-weight:900;
}

.fp-pricing small{
  font-size:16px;
  color:#8ea3d4;
}

/* =========================================================
   SYSTEM HEALTH
========================================================= */

.fp-systemHealth{
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:14px;
}

.fp-systemHealthScore{
  width:140px;
  height:140px;

  border-radius:999px;

  display:flex;
  align-items:center;
  justify-content:center;

  font-size:44px;
  font-weight:900;

  background:
    radial-gradient(
      circle at top,
      rgba(47,91,255,.24),
      rgba(47,91,255,.08)
    );

  border:
    1px solid
    rgba(47,91,255,.18);
}

.fp-systemHealthText{
  color:#9ec0ff;
  font-size:14px;
  font-weight:700;
}

/* =========================================================
   PDF PREVIEW
========================================================= */

.fp-chartEmpty{
  display:flex;
  align-items:center;
  justify-content:center;

  border-radius:24px;

  background:
    rgba(255,255,255,.03);

  border:
    1px dashed
    rgba(255,255,255,.12);

  color:#7f93c2;

  font-size:15px;
  font-weight:700;
}

/* =========================================================
   FLEX
========================================================= */

.fp-flex{
  display:flex;
}

.fp-flexCol{
  flex-direction:column;
}

.fp-alignCenter{
  align-items:center;
}

.fp-justifyBetween{
  justify-content:space-between;
}

.fp-gap12{
  gap:12px;
}

.fp-gap16{
  gap:16px;
}

.fp-gap20{
  gap:20px;
}

.fp-gap24{
  gap:24px;
}

/* =========================================================
   MARGIN
========================================================= */

.fp-mt24{
  margin-top:24px;
}

.fp-mt32{
  margin-top:32px;
}

/* =========================================================
   TEXT
========================================================= */

.fp-muted{
  color:#8ea3d4;
}

.fp-textSm{
  font-size:12px;
}

/* =========================================================
   GRADIENT
========================================================= */

.fp-gradientPrimary{
  background:
    linear-gradient(
      135deg,
      rgba(47,91,255,.22),
      rgba(93,130,255,.10)
    );
}

/* =========================================================
   RESPONSIVE
========================================================= */

@media(max-width:760px){

  .fp-input,
  .fp-select,
  .fp-textarea{
    min-height:52px;
    border-radius:18px;
  }

  .fp-pricing{
    font-size:42px;
  }

  .fp-systemHealthScore{
    width:110px;
    height:110px;
    font-size:34px;
  }
}
/* =========================================================
   FINAL REPORTS ENGINE
========================================================= */

/* =========================================================
   REPORTS STATE
========================================================= */

const reportsState = {

  reports:[

    {

      id:
        uid('report'),

      name:
        'Executive SEO Report',

      client:
        'FlowPoint Enterprise',

      created:
        '12 May 2026',

      status:
        'ready',

    },

    {

      id:
        uid('report'),

      name:
        'Infrastructure Audit',

      client:
        'Monitoring Client',

      created:
        '11 May 2026',

      status:
        'processing',

    },

    {

      id:
        uid('report'),

      name:
        'Local SEO Expansion',

      client:
        'Agency Partner',

      created:
        '10 May 2026',

      status:
        'ready',

    },

  ],

};

/* =========================================================
   REPORT PAGE
========================================================= */

function renderReports(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Executive Reports

              </div>

              <div class="
                fp-sectionText
              ">

                Exports PDF,
                reporting,
                analytics,
                branding
                et documents enterprise.

              </div>

            </div>

            <button

              id="
                fpGenerateReport
              "

              class="
                fp-btn
                fp-btnPrimary
              "
            >

              Générer report

            </button>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'Reports',

          value:'482',

          trend:'+18%',

          icon:'📄',

        })}

        ${createStatCard({

          title:'Exports',

          value:'2.8k',

          trend:'+28%',

          icon:'📤',

        })}

        ${createStatCard({

          title:'Clients',

          value:'182',

          trend:'+12%',

          icon:'👥',

        })}

        ${createStatCard({

          title:'Retention',

          value:'92%',

          trend:'+4%',

          icon:'🎯',

        })}

      </div>

      <!-- REPORTS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Recent Reports

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-list
          ">

            ${reportsState
              .reports
              .map(report => `

                <div class="
                  fp-listItem
                ">

                  <div>

                    <div class="
                      fp-listTitle
                    ">

                      ${report.name}

                    </div>

                    <div class="
                      fp-listText
                    ">

                      ${report.client}
                      •
                      ${report.created}

                    </div>

                  </div>

                  <div class="
                    fp-flex
                    fp-alignCenter
                    fp-gap12
                  ">

                    <div class="
                      fp-badge
                      ${
                        report.status
                          === 'ready'

                          ? 'fp-badgeSuccess'

                          : 'fp-badgeWarning'
                      }
                    ">

                      ${report.status}

                    </div>

                    <button

                      class="
                        fp-btn
                        fp-btnGhost
                      "

                      data-preview-report="
                        ${report.id}
                      "
                    >

                      Preview

                    </button>

                    <button

                      class="
                        fp-btn
                        fp-btnPrimary
                      "

                      data-download-report="
                        ${report.id}
                      "
                    >

                      Export

                    </button>

                  </div>

                </div>

              `).join('')}

          </div>

        </div>

      </div>

      <!-- ANALYTICS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- EXPORTS -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Export Analytics

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                12,
                18,
                28,
                42,
                58,
                72,
                94,

              ],

              height:320,

            })}

          </div>

        </div>

        <!-- TYPES -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Report Categories

          </div>

          <div class="
            fp-cardBody
          ">

            ${renderDataTable({

              columns:[

                'Category',
                'Reports',
                'Growth',

              ],

              rows:[

                [

                  'SEO Reports',
                  '182',
                  '+22%',

                ],

                [

                  'Infrastructure',
                  '82',
                  '+12%',

                ],

                [

                  'Executive',
                  '142',
                  '+28%',

                ],

                [

                  'Local SEO',
                  '76',
                  '+18%',

                ],

              ],

            })}

          </div>

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Report Insights

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Retention Opportunity

                </div>

                <div class="
                  fp-listText
                ">

                  Executive reports augmentent la rétention.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Automation Growth

                </div>

                <div class="
                  fp-listText
                ">

                  Génération automatique fortement utilisée.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Client Engagement

                </div>

                <div class="
                  fp-listText
                ">

                  Les exports enterprise améliorent l’engagement.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   EVENTS
========================================================= */

function bindReportsEvents(){

  const generate =
    qs('#fpGenerateReport');

  if(generate){

    generate.onclick = () => {

      toast(

        'Génération du report...',

        'primary'

      );

      setTimeout(() => {

        toast(

          'Executive report généré',

          'success'

        );

      }, 1600);
    };
  }

  qsa('[data-preview-report]')
    .forEach(button => {

      button.onclick = () => {

        openPdfPreview(
          'Executive Report'
        );
      };
    });

  qsa('[data-download-report]')
    .forEach(button => {

      button.onclick = () => {

        exportMockPdf(
          'flowpoint-report'
        );
      };
    });
}

/* =========================================================
   EVENTS PATCH
========================================================= */

const previousReportsBind =
  bindEvents;

bindEvents = function(){

  previousReportsBind();

  bindReportsEvents();
};

/* =========================================================
   READY
========================================================= */

console.log(
  'Reports engine ready'
);
/* =========================================================
   FINAL BILLING ENGINE
========================================================= */

/* =========================================================
   BILLING STATE
========================================================= */

const billingState = {

  currentPlan:
    'Ultra',

  monthlyPrice:
    299,

  usage:{

    aiRequests:
      182420,

    reports:
      482,

    monitors:
      182,

    teamMembers:
      12,

  },

  invoices:[

    {

      id:'INV-2026-001',

      amount:'299€',

      status:'paid',

      date:'12 May 2026',

    },

    {

      id:'INV-2026-002',

      amount:'299€',

      status:'paid',

      date:'12 Apr 2026',

    },

    {

      id:'INV-2026-003',

      amount:'299€',

      status:'processing',

      date:'12 Mar 2026',

    },

  ],

};

/* =========================================================
   BILLING PAGE
========================================================= */

function renderBilling(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Billing & Subscription

              </div>

              <div class="
                fp-sectionText
              ">

                Plans,
                facturation,
                usage,
                Stripe
                et infrastructure enterprise.

              </div>

            </div>

            <button

              id="
                fpManageBilling
              "

              class="
                fp-btn
                fp-btnPrimary
              "
            >

              Manage Billing

            </button>

          </div>

        </div>

      </div>

      <!-- PLAN -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        <!-- CURRENT -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-badge
              fp-badgePrimary
            ">

              CURRENT PLAN

            </div>

            <div class="
              fp-pricing
              fp-mt24
            ">

              ${billingState.monthlyPrice}€

              <small>

                /month

              </small>

            </div>

            <div class="
              fp-sectionTitle
              fp-mt24
            " style="
              font-size:26px;
            ">

              ${billingState.currentPlan}

            </div>

            <div class="
              fp-sectionText
            ">

              Enterprise AI,
              monitoring,
              reports
              et scaling avancé.

            </div>

            <button class="
              fp-btn
              fp-btnPrimary
              fp-wFull
              fp-mt24
            ">

              Upgrade Plan

            </button>

          </div>

        </div>

        <!-- USAGE -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Usage Analytics

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-list
            ">

              <div class="
                fp-listItem
              ">

                <div>

                  <div class="
                    fp-listTitle
                  ">

                    AI Requests

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Monthly usage

                  </div>

                </div>

                <div class="
                  fp-badge
                  fp-badgePrimary
                ">

                  ${
                    formatNumber(
                      billingState
                        .usage
                        .aiRequests
                    )
                  }

                </div>

              </div>

              <div class="
                fp-listItem
              ">

                <div>

                  <div class="
                    fp-listTitle
                  ">

                    Reports

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Generated exports

                  </div>

                </div>

                <div class="
                  fp-badge
                  fp-badgeSuccess
                ">

                  ${
                    billingState
                      .usage
                      .reports
                  }

                </div>

              </div>

              <div class="
                fp-listItem
              ">

                <div>

                  <div class="
                    fp-listTitle
                  ">

                    Monitors

                  </div>

                  <div class="
                    fp-listText
                  ">

                    Active monitors

                  </div>

                </div>

                <div class="
                  fp-badge
                  fp-badgeWarning
                ">

                  ${
                    billingState
                      .usage
                      .monitors
                  }

                </div>

              </div>

            </div>

          </div>

        </div>

        <!-- ENTERPRISE -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Enterprise Features

          </div>

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-list
            ">

              <div class="
                fp-listItem
              ">

                <div>

                  <div class="
                    fp-listTitle
                  ">

                    Realtime AI

                  </div>

                </div>

                <div class="
                  fp-badge
                  fp-badgeSuccess
                ">

                  Enabled

                </div>

              </div>

              <div class="
                fp-listItem
              ">

                <div>

                  <div class="
                    fp-listTitle
                  ">

                    Executive Reports

                  </div>

                </div>

                <div class="
                  fp-badge
                  fp-badgeSuccess
                ">

                  Enabled

                </div>

              </div>

              <div class="
                fp-listItem
              ">

                <div>

                  <div class="
                    fp-listTitle
                  ">

                    API Access

                  </div>

                </div>

                <div class="
                  fp-badge
                  fp-badgeSuccess
                ">

                  Enabled

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

      <!-- INVOICES -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Billing History

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Invoice',
              'Amount',
              'Status',
              'Date',

            ],

            rows:

              billingState
                .invoices
                .map(invoice => [

                  invoice.id,
                  invoice.amount,
                  invoice.status,
                  invoice.date,

                ]),

          })}

        </div>

      </div>

      <!-- ANALYTICS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- REVENUE -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Revenue Analytics

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                12,
                18,
                32,
                48,
                64,
                82,
                98,

              ],

              height:320,

            })}

          </div>

        </div>

        <!-- PLAN DISTRIBUTION -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Plan Distribution

          </div>

          <div class="
            fp-cardBody
          ">

            ${renderDataTable({

              columns:[

                'Plan',
                'Users',
                'Growth',

              ],

              rows:[

                [

                  'Standard',
                  '82',
                  '+4%',

                ],

                [

                  'Pro',
                  '48',
                  '+12%',

                ],

                [

                  'Ultra',
                  '22',
                  '+28%',

                ],

              ],

            })}

          </div>

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Billing Insights

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Ultra Growth

                </div>

                <div class="
                  fp-listText
                ">

                  Les upgrades enterprise augmentent.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  AI Usage Increase

                </div>

                <div class="
                  fp-listText
                ">

                  Forte hausse consommation IA.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Revenue Stability

                </div>

                <div class="
                  fp-listText
                ">

                  Infrastructure financière stable.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   EVENTS
========================================================= */

function bindBillingEvents(){

  const manage =
    qs('#fpManageBilling');

  if(manage){

    manage.onclick = () => {

      toast(

        'Ouverture du portail Stripe...',

        'primary'

      );
    };
  }
}

/* =========================================================
   EVENTS PATCH
========================================================= */

const previousBillingBind =
  bindEvents;

bindEvents = function(){

  previousBillingBind();

  bindBillingEvents();
};

/* =========================================================
   READY
========================================================= */

console.log(
  'Billing engine ready'
);
/* =========================================================
   FINAL ALERT CENTER ENGINE
========================================================= */

/* =========================================================
   ALERT STATE
========================================================= */

const alertsState = {

  alerts:[

    {

      id:
        uid('alert'),

      type:
        'critical',

      title:
        'API latency spike',

      description:
        'Temps de réponse supérieur à 400ms.',

      createdAt:
        '2 minutes',

      status:
        'active',

    },

    {

      id:
        uid('alert'),

      type:
        'warning',

      title:
        'SEO ranking fluctuation',

      description:
        'Variation détectée sur plusieurs mots-clés.',

      createdAt:
        '18 minutes',

      status:
        'monitoring',

    },

    {

      id:
        uid('alert'),

      type:
        'success',

      title:
        'Infrastructure stabilized',

      description:
        'Tous les services sont revenus à la normale.',

      createdAt:
        '1 heure',

      status:
        'resolved',

    },

  ],

};

/* =========================================================
   ALERT BADGE
========================================================= */

function getAlertBadge(type='warning'){

  if(type === 'critical'){

    return 'fp-badgeDanger';
  }

  if(type === 'success'){

    return 'fp-badgeSuccess';
  }

  return 'fp-badgeWarning';
}

/* =========================================================
   ALERT PAGE
========================================================= */

function renderAlerts(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Alert Center

              </div>

              <div class="
                fp-sectionText
              ">

                Monitoring,
                incidents,
                sécurité,
                infrastructure
                et alertes temps réel.

              </div>

            </div>

            <div class="
              fp-liveBadge
            ">

              <div class="
                fp-liveDot
              "></div>

              ALERT ENGINE ACTIVE

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'Critical',

          value:'2',

          trend:'-1%',

          icon:'🚨',

        })}

        ${createStatCard({

          title:'Warnings',

          value:'12',

          trend:'+4%',

          icon:'⚠️',

        })}

        ${createStatCard({

          title:'Resolved',

          value:'182',

          trend:'+22%',

          icon:'✅',

        })}

        ${createStatCard({

          title:'Monitoring',

          value:'98%',

          trend:'+2%',

          icon:'🛰️',

        })}

      </div>

      <!-- ALERTS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Live Alerts

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-list
          ">

            ${alertsState
              .alerts
              .map(alert => `

                <div class="
                  fp-alertItem
                ">

                  <div class="
                    fp-flex
                    fp-alignCenter
                    fp-gap20
                  ">

                    <div class="
                      fp-alertDot
                      ${alert.type}
                    "></div>

                    <div>

                      <div class="
                        fp-listTitle
                      ">

                        ${alert.title}

                      </div>

                      <div class="
                        fp-listText
                      ">

                        ${alert.description}

                      </div>

                    </div>

                  </div>

                  <div class="
                    fp-flex
                    fp-alignCenter
                    fp-gap12
                  ">

                    <div class="
                      fp-badge
                      ${getAlertBadge(
                        alert.type
                      )}
                    ">

                      ${alert.status}

                    </div>

                    <div class="
                      fp-muted
                      fp-textSm
                    ">

                      ${alert.createdAt}

                    </div>

                  </div>

                </div>

              `).join('')}

          </div>

        </div>

      </div>

      <!-- ANALYTICS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- ALERT TREND -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Alert Trends

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                2,
                4,
                6,
                4,
                3,
                2,
                1,

              ],

              height:320,

            })}

          </div>

        </div>

        <!-- SECURITY -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Security Overview

          </div>

          <div class="
            fp-cardBody
          ">

            ${renderDataTable({

              columns:[

                'System',
                'Status',
                'Risk',

              ],

              rows:[

                [

                  'Infrastructure',
                  'Protected',
                  'Low',

                ],

                [

                  'Authentication',
                  'Protected',
                  'Low',

                ],

                [

                  'Realtime API',
                  'Monitoring',
                  'Medium',

                ],

                [

                  'AI Engine',
                  'Protected',
                  'Low',

                ],

              ],

            })}

          </div>

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Alert Insights

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Stable Infrastructure

                </div>

                <div class="
                  fp-listText
                ">

                  Aucun incident critique majeur détecté.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Latency Monitoring

                </div>

                <div class="
                  fp-listText
                ">

                  Quelques variations API surveillées.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Enterprise Security

                </div>

                <div class="
                  fp-listText
                ">

                  Systèmes sécurisés et opérationnels.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   READY
========================================================= */

console.log(
  'Alert center ready'
);
/* =========================================================
   FINAL CLIENT PORTAL ENGINE
========================================================= */

/* =========================================================
   CLIENT STATE
========================================================= */

const clientPortalState = {

  clients:[

    {

      id:
        uid('client'),

      company:
        'FlowPoint Enterprise',

      plan:
        'Ultra',

      status:
        'active',

      revenue:
        '4 800€',

    },

    {

      id:
        uid('client'),

      company:
        'Agency Partner',

      plan:
        'Pro',

      status:
        'active',

      revenue:
        '1 200€',

    },

    {

      id:
        uid('client'),

      company:
        'Local SEO Group',

      plan:
        'Standard',

      status:
        'trial',

      revenue:
        '0€',

    },

  ],

};

/* =========================================================
   CLIENT PAGE
========================================================= */

function renderClientPortal(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Client Portal

              </div>

              <div class="
                fp-sectionText
              ">

                Clients,
                organisations,
                revenus,
                accès
                et gestion enterprise.

              </div>

            </div>

            <button

              id="
                fpCreateClient
              "

              class="
                fp-btn
                fp-btnPrimary
              "
            >

              Nouveau client

            </button>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'Clients',

          value:'182',

          trend:'+18%',

          icon:'👥',

        })}

        ${createStatCard({

          title:'MRR',

          value:'48k€',

          trend:'+22%',

          icon:'💳',

        })}

        ${createStatCard({

          title:'Trials',

          value:'28',

          trend:'+8%',

          icon:'🚀',

        })}

        ${createStatCard({

          title:'Retention',

          value:'92%',

          trend:'+4%',

          icon:'🎯',

        })}

      </div>

      <!-- CLIENTS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Organisations

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-list
          ">

            ${clientPortalState
              .clients
              .map(client => `

                <div class="
                  fp-listItem
                ">

                  <div>

                    <div class="
                      fp-listTitle
                    ">

                      ${client.company}

                    </div>

                    <div class="
                      fp-listText
                    ">

                      Revenue:
                      ${client.revenue}

                    </div>

                  </div>

                  <div class="
                    fp-flex
                    fp-alignCenter
                    fp-gap12
                  ">

                    <div class="
                      fp-badge
                      ${
                        client.plan
                          === 'Ultra'

                          ? 'fp-badgePrimary'

                          : client.plan
                            === 'Pro'

                          ? 'fp-badgeSuccess'

                          : 'fp-badgeWarning'
                      }
                    ">

                      ${client.plan}

                    </div>

                    <div class="
                      fp-badge
                      ${
                        client.status
                          === 'active'

                          ? 'fp-badgeSuccess'

                          : 'fp-badgeWarning'
                      }
                    ">

                      ${client.status}

                    </div>

                    <button class="
                      fp-btn
                      fp-btnGhost
                    ">

                      Open

                    </button>

                  </div>

                </div>

              `).join('')}

          </div>

        </div>

      </div>

      <!-- ANALYTICS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- GROWTH -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Client Growth

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                8,
                12,
                18,
                32,
                48,
                72,
                98,

              ],

              height:320,

            })}

          </div>

        </div>

        <!-- PLANS -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Subscription Distribution

          </div>

          <div class="
            fp-cardBody
          ">

            ${renderDataTable({

              columns:[

                'Plan',
                'Clients',
                'Growth',

              ],

              rows:[

                [

                  'Standard',
                  '82',
                  '+4%',

                ],

                [

                  'Pro',
                  '68',
                  '+18%',

                ],

                [

                  'Ultra',
                  '32',
                  '+28%',

                ],

              ],

            })}

          </div>

        </div>

      </div>

      <!-- EXECUTIVE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Enterprise Opportunities

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Ultra Upgrades

                </div>

                <div class="
                  fp-listText
                ">

                  Forte hausse des plans enterprise.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Trial Conversion

                </div>

                <div class="
                  fp-listText
                ">

                  Les essais convertissent efficacement.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Revenue Expansion

                </div>

                <div class="
                  fp-listText
                ">

                  Potentiel MRR encore élevé.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   EVENTS
========================================================= */

function bindClientPortalEvents(){

  const create =
    qs('#fpCreateClient');

  if(create){

    create.onclick = () => {

      openModal({

        title:
          'Nouveau client',

        content:`

          <div class="
            fp-flex
            fp-flexCol
            fp-gap20
          ">

            <input
              class="
                fp-input
              "
              placeholder="
                Nom entreprise
              "
            />

            <select class="
              fp-select
            ">

              <option>
                Standard
              </option>

              <option>
                Pro
              </option>

              <option>
                Ultra
              </option>

            </select>

            <button class="
              fp-btn
              fp-btnPrimary
            ">

              Créer organisation

            </button>

          </div>

        `,

      });
    };
  }
}

/* =========================================================
   EVENTS PATCH
========================================================= */

const previousClientBind =
  bindEvents;

bindEvents = function(){

  previousClientBind();

  bindClientPortalEvents();
};

/* =========================================================
   READY
========================================================= */

console.log(
  'Client portal ready'
);
/* =========================================================
   FINAL WORKSPACE ENGINE
========================================================= */

/* =========================================================
   WORKSPACE STATE
========================================================= */

const workspaceState = {

  files:[

    {

      name:
        'Executive-Report.pdf',

      size:
        '4.2 MB',

      type:
        'PDF',

      updated:
        '2 min',

    },

    {

      name:
        'SEO-Audit.xlsx',

      size:
        '1.8 MB',

      type:
        'XLSX',

      updated:
        '18 min',

    },

    {

      name:
        'Infrastructure-Logs.json',

      size:
        '842 KB',

      type:
        'JSON',

      updated:
        '1 hour',

    },

  ],

};

/* =========================================================
   WORKSPACE PAGE
========================================================= */

function renderWorkspaceOverview(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Workspace Hub

              </div>

              <div class="
                fp-sectionText
              ">

                Documents,
                exports,
                assets,
                collaboration
                et organisation enterprise.

              </div>

            </div>

            <button

              id="
                fpUploadFile
              "

              class="
                fp-btn
                fp-btnPrimary
              "
            >

              Upload File

            </button>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'Files',

          value:'2 482',

          trend:'+18%',

          icon:'📁',

        })}

        ${createStatCard({

          title:'Storage',

          value:'182 GB',

          trend:'+22%',

          icon:'💾',

        })}

        ${createStatCard({

          title:'Exports',

          value:'842',

          trend:'+12%',

          icon:'📤',

        })}

        ${createStatCard({

          title:'Collaboration',

          value:'98%',

          trend:'+4%',

          icon:'👥',

        })}

      </div>

      <!-- FILES -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Workspace Files

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-list
          ">

            ${workspaceState
              .files
              .map(file => `

                <div class="
                  fp-listItem
                ">

                  <div class="
                    fp-flex
                    fp-alignCenter
                    fp-gap20
                  ">

                    <div class="
                      fp-userMiniAvatar
                    ">

                      ${
                        file.type
                      }

                    </div>

                    <div>

                      <div class="
                        fp-listTitle
                      ">

                        ${file.name}

                      </div>

                      <div class="
                        fp-listText
                      ">

                        ${file.size}
                        •
                        ${file.updated}

                      </div>

                    </div>

                  </div>

                  <div class="
                    fp-flex
                    fp-alignCenter
                    fp-gap12
                  ">

                    <button class="
                      fp-btn
                      fp-btnGhost
                    ">

                      Preview

                    </button>

                    <button class="
                      fp-btn
                      fp-btnPrimary
                    ">

                      Download

                    </button>

                  </div>

                </div>

              `).join('')}

          </div>

        </div>

      </div>

      <!-- ANALYTICS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- STORAGE -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Storage Analytics

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                12,
                18,
                28,
                42,
                58,
                74,
                96,

              ],

              height:320,

            })}

          </div>

        </div>

        <!-- TYPES -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            File Categories

          </div>

          <div class="
            fp-cardBody
          ">

            ${renderDataTable({

              columns:[

                'Category',
                'Files',
                'Growth',

              ],

              rows:[

                [

                  'Reports',
                  '842',
                  '+18%',

                ],

                [

                  'Exports',
                  '482',
                  '+12%',

                ],

                [

                  'Audits',
                  '628',
                  '+22%',

                ],

                [

                  'Infrastructure',
                  '530',
                  '+8%',

                ],

              ],

            })}

          </div>

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Workspace Insights

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Report Growth

                </div>

                <div class="
                  fp-listText
                ">

                  Les exports enterprise augmentent rapidement.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Storage Scaling

                </div>

                <div class="
                  fp-listText
                ">

                  Infrastructure prête à scaler.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Collaboration Usage

                </div>

                <div class="
                  fp-listText
                ">

                  Activité équipe fortement utilisée.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   EVENTS
========================================================= */

function bindWorkspaceEvents(){

  const upload =
    qs('#fpUploadFile');

  if(upload){

    upload.onclick = () => {

      toast(

        'Upload workspace lancé',

        'primary'

      );
    };
  }
}

/* =========================================================
   EVENTS PATCH
========================================================= */

const previousWorkspaceBind =
  bindEvents;

bindEvents = function(){

  previousWorkspaceBind();

  bindWorkspaceEvents();
};

/* =========================================================
   READY
========================================================= */

console.log(
  'Workspace hub ready'
);
/* =========================================================
   FINAL SAAS BUSINESS ENGINE
========================================================= */

/* =========================================================
   BUSINESS STATE
========================================================= */

const businessState = {

  mrr:48200,

  arr:578400,

  churn:2.4,

  ltv:4820,

  cac:182,

  upgrades:28,

};

/* =========================================================
   BUSINESS PAGE
========================================================= */

function renderBusinessCenter(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-sectionTitle
          ">

            SaaS Business Intelligence

          </div>

          <div class="
            fp-sectionText
          ">

            Revenus,
            croissance,
            MRR,
            rétention,
            expansion
            et analytics business.

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'MRR',

          value:
            formatCurrency(
              businessState.mrr
            ),

          trend:'+22%',

          icon:'💳',

        })}

        ${createStatCard({

          title:'ARR',

          value:
            formatCurrency(
              businessState.arr
            ),

          trend:'+28%',

          icon:'📈',

        })}

        ${createStatCard({

          title:'Churn',

          value:
            businessState.churn + '%',

          trend:'-0.4%',

          icon:'📉',

        })}

        ${createStatCard({

          title:'LTV',

          value:
            formatCurrency(
              businessState.ltv
            ),

          trend:'+12%',

          icon:'🏆',

        })}

      </div>

      <!-- ANALYTICS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- REVENUE -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Revenue Growth

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                12,
                18,
                24,
                42,
                62,
                82,
                98,

              ],

              height:320,

            })}

          </div>

        </div>

        <!-- RETENTION -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Retention Analytics

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                92,
                91,
                93,
                94,
                95,
                96,
                98,

              ],

              height:320,

            })}

          </div>

        </div>

      </div>

      <!-- ENTERPRISE -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-sectionTitle
            " style="
              font-size:24px;
            ">

              Acquisition

            </div>

            <div class="
              fp-sectionText
            ">

              CAC optimisé
              et croissance acquisition.

            </div>

            <div class="
              fp-pricing
              fp-mt24
            ">

              ${
                formatCurrency(
                  businessState.cac
                )
              }

            </div>

          </div>

        </div>

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-sectionTitle
            " style="
              font-size:24px;
            ">

              Upgrades

            </div>

            <div class="
              fp-sectionText
            ">

              Expansion des plans enterprise.

            </div>

            <div class="
              fp-pricing
              fp-mt24
            ">

              ${
                businessState.upgrades
              }

            </div>

          </div>

        </div>

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-sectionTitle
            " style="
              font-size:24px;
            ">

              Retention

            </div>

            <div class="
              fp-sectionText
            ">

              Clients fidélisés
              grâce aux reports
              et IA.

            </div>

            <div class="
              fp-pricing
              fp-mt24
            ">

              92%

            </div>

          </div>

        </div>

      </div>

      <!-- TABLE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          SaaS Metrics

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Metric',
              'Value',
              'Trend',
              'Status',

            ],

            rows:[

              [

                'MRR',
                '48k€',
                '+22%',
                'Excellent',

              ],

              [

                'ARR',
                '578k€',
                '+28%',
                'Growing',

              ],

              [

                'Churn',
                '2.4%',
                '-0.4%',
                'Healthy',

              ],

              [

                'LTV',
                '4 820€',
                '+12%',
                'Strong',

              ],

            ],

          })}

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Business Insights

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Revenue Expansion

                </div>

                <div class="
                  fp-listText
                ">

                  Forte croissance des revenus enterprise.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Healthy Retention

                </div>

                <div class="
                  fp-listText
                ">

                  Les clients restent fortement engagés.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Scaling Opportunity

                </div>

                <div class="
                  fp-listText
                ">

                  Potentiel élevé pour scaler rapidement.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   READY
========================================================= */

console.log(
  'Business intelligence ready'
);
/* =========================================================
   FINAL AI CENTER ENGINE
========================================================= */

/* =========================================================
   AI STATE
========================================================= */

const aiCenterState = {

  conversations:[

    {

      role:
        'assistant',

      text:
        'Bienvenue dans FlowPoint AI Enterprise.',

    },

    {

      role:
        'assistant',

      text:
        'Je peux analyser le SEO, les performances, les concurrents et les revenus SaaS.',

    },

  ],

};

/* =========================================================
   AI MESSAGE
========================================================= */

function createAiMessage({

  role='assistant',

  text='',

} = {}){

  return `

    <div class="
      fp-aiMessage
      ${role}
    ">

      <div class="
        fp-aiBubble
      ">

        ${text}

      </div>

    </div>

  `;
}

/* =========================================================
   AI PAGE
========================================================= */

function renderAiCenter(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-sectionTitle
          ">

            FlowPoint AI Enterprise

          </div>

          <div class="
            fp-sectionText
          ">

            Intelligence artificielle,
            automatisation,
            analyse SEO,
            business
            et infrastructure.

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'AI Requests',

          value:'182k',

          trend:'+28%',

          icon:'🤖',

        })}

        ${createStatCard({

          title:'Automations',

          value:'482',

          trend:'+18%',

          icon:'⚙️',

        })}

        ${createStatCard({

          title:'Insights',

          value:'842',

          trend:'+22%',

          icon:'🧠',

        })}

        ${createStatCard({

          title:'Realtime',

          value:'98%',

          trend:'+4%',

          icon:'⚡',

        })}

      </div>

      <!-- AI CHAT -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Workspace

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-aiMessages
          ">

            ${aiCenterState
              .conversations
              .map(message =>

                createAiMessage({

                  role:
                    message.role,

                  text:
                    message.text,

                })

              ).join('')}

          </div>

          <div class="
            fp-flex
            fp-gap12
            fp-mt24
          ">

            <input

              id="
                fpAiInput
              "

              class="
                fp-input
              "

              placeholder="
                Demander une analyse IA...
              "
            />

            <button

              id="
                fpAiSend
              "

              class="
                fp-btn
                fp-btnPrimary
              "
            >

              Envoyer

            </button>

          </div>

        </div>

      </div>

      <!-- MODULES -->

      <div class="
        fp-grid3
        fp-mt24
      ">

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-sectionTitle
            " style="
              font-size:24px;
            ">

              SEO AI

            </div>

            <div class="
              fp-sectionText
            ">

              Analyse SEO,
              opportunités
              et optimisation contenu.

            </div>

            <button class="
              fp-btn
              fp-btnPrimary
              fp-mt24
            ">

              Analyse SEO

            </button>

          </div>

        </div>

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-sectionTitle
            " style="
              font-size:24px;
            ">

              Infrastructure AI

            </div>

            <div class="
              fp-sectionText
            ">

              Monitoring,
              stabilité
              et infrastructure temps réel.

            </div>

            <button class="
              fp-btn
              fp-btnPrimary
              fp-mt24
            ">

              Analyse Infra

            </button>

          </div>

        </div>

        <div class="
          fp-card
        ">

          <div class="
            fp-cardBody
          ">

            <div class="
              fp-sectionTitle
            " style="
              font-size:24px;
            ">

              Business AI

            </div>

            <div class="
              fp-sectionText
            ">

              Revenus,
              rétention
              et intelligence business.

            </div>

            <button class="
              fp-btn
              fp-btnPrimary
              fp-mt24
            ">

              Analyse Business

            </button>

          </div>

        </div>

      </div>

      <!-- AI INSIGHTS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Executive Insights

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  SEO Opportunity

                </div>

                <div class="
                  fp-listText
                ">

                  Plusieurs quick wins détectés.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Revenue Expansion

                </div>

                <div class="
                  fp-listText
                ">

                  Croissance MRR très positive.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Infrastructure Stable

                </div>

                <div class="
                  fp-listText
                ">

                  Aucun risque critique détecté.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   AI SEND
========================================================= */

function sendAiMessage(){

  const input =
    qs('#fpAiInput');

  if(!input){
    return;
  }

  const value =
    input.value.trim();

  if(!value){
    return;
  }

  aiCenterState
    .conversations
    .push({

      role:'user',

      text:value,

    });

  input.value = '';

  render();

  setTimeout(() => {

    aiCenterState
      .conversations
      .push({

        role:'assistant',

        text:
          generateAiResponse(
            value
          ),

      });

    render();

  }, 900);
}

/* =========================================================
   AI RESPONSE
========================================================= */

function generateAiResponse(message=''){

  const lower =
    message.toLowerCase();

  if(

    lower.includes('seo')

  ){

    return `
      Analyse SEO détectée :
      plusieurs quick wins
      peuvent améliorer
      le trafic organique.
    `;
  }

  if(

    lower.includes('business')

  ){

    return `
      Croissance business stable,
      rétention forte
      et potentiel expansion
      enterprise élevé.
    `;
  }

  if(

    lower.includes('monitor')

    ||

    lower.includes('infra')

  ){

    return `
      Infrastructure stable,
      quelques pics de latence
      restent sous surveillance.
    `;
  }

  return `
    Analyse IA terminée.
    Aucun risque critique détecté
    et plusieurs opportunités
    enterprise disponibles.
  `;
}

/* =========================================================
   EVENTS
========================================================= */

function bindAiEvents(){

  const send =
    qs('#fpAiSend');

  if(send){

    send.onclick =
      sendAiMessage;
  }

  const input =
    qs('#fpAiInput');

  if(input){

    input.onkeydown = event => {

      if(

        event.key === 'Enter'

      ){

        sendAiMessage();
      }
    };
  }
}

/* =========================================================
   EVENTS PATCH
========================================================= */

const previousAiBind =
  bindEvents;

bindEvents = function(){

  previousAiBind();

  bindAiEvents();
};

/* =========================================================
   READY
========================================================= */

console.log(
  'AI enterprise center ready'
);
/* =========================================================
   FINAL LOCAL SEO ENGINE
========================================================= */

/* =========================================================
   LOCAL SEO STATE
========================================================= */

const localSeoState = {

  locations:[

    {

      city:
        'Bruxelles',

      ranking:
        '#2',

      visibility:
        '92%',

      growth:
        '+18%',

    },

    {

      city:
        'Liège',

      ranking:
        '#4',

      visibility:
        '82%',

      growth:
        '+12%',

    },

    {

      city:
        'Anvers',

      ranking:
        '#6',

      visibility:
        '74%',

      growth:
        '+8%',

    },

  ],

};

/* =========================================================
   LOCAL SEO PAGE
========================================================= */

function renderLocalSeo(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Local SEO Intelligence

              </div>

              <div class="
                fp-sectionText
              ">

                Géolocalisation,
                visibilité locale,
                GBP,
                rankings
                et expansion SEO.

              </div>

            </div>

            <button class="
              fp-btn
              fp-btnPrimary
            ">

              New Local Audit

            </button>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'Locations',

          value:'182',

          trend:'+18%',

          icon:'📍',

        })}

        ${createStatCard({

          title:'Visibility',

          value:'92%',

          trend:'+12%',

          icon:'👀',

        })}

        ${createStatCard({

          title:'Keywords',

          value:'4.8k',

          trend:'+22%',

          icon:'🔎',

        })}

        ${createStatCard({

          title:'Growth',

          value:'+42%',

          trend:'+8%',

          icon:'📈',

        })}

      </div>

      <!-- LOCATIONS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Local Rankings

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-list
          ">

            ${localSeoState
              .locations
              .map(location => `

                <div class="
                  fp-listItem
                ">

                  <div>

                    <div class="
                      fp-listTitle
                    ">

                      ${location.city}

                    </div>

                    <div class="
                      fp-listText
                    ">

                      Visibility:
                      ${location.visibility}

                    </div>

                  </div>

                  <div class="
                    fp-flex
                    fp-alignCenter
                    fp-gap12
                  ">

                    <div class="
                      fp-badge
                      fp-badgePrimary
                    ">

                      ${location.ranking}

                    </div>

                    <div class="
                      fp-badge
                      fp-badgeSuccess
                    ">

                      ${location.growth}

                    </div>

                  </div>

                </div>

              `).join('')}

          </div>

        </div>

      </div>

      <!-- ANALYTICS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- GROWTH -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Visibility Growth

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                18,
                22,
                28,
                42,
                58,
                74,
                92,

              ],

              height:320,

            })}

          </div>

        </div>

        <!-- DISTRIBUTION -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            SEO Distribution

          </div>

          <div class="
            fp-cardBody
          ">

            ${renderDataTable({

              columns:[

                'City',
                'Ranking',
                'Growth',

              ],

              rows:[

                [

                  'Bruxelles',
                  '#2',
                  '+18%',

                ],

                [

                  'Liège',
                  '#4',
                  '+12%',

                ],

                [

                  'Anvers',
                  '#6',
                  '+8%',

                ],

                [

                  'Namur',
                  '#8',
                  '+4%',

                ],

              ],

            })}

          </div>

        </div>

      </div>

      <!-- MAP -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Local Expansion Map

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-chartEmpty
          " style="
            height:420px;
          ">

            Interactive Local SEO Map

          </div>

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Local SEO Insights

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Bruxelles Growth

                </div>

                <div class="
                  fp-listText
                ">

                  Forte croissance SEO locale détectée.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Expansion Opportunity

                </div>

                <div class="
                  fp-listText
                ">

                  Potentiel élevé sur plusieurs villes.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  GBP Optimization

                </div>

                <div class="
                  fp-listText
                ">

                  Optimisations Google Business disponibles.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   READY
========================================================= */

console.log(
  'Local SEO intelligence ready'
);
/* =========================================================
   FINAL COMPETITOR ENGINE
========================================================= */

/* =========================================================
   COMPETITOR STATE
========================================================= */

const competitorState = {

  competitors:[

    {

      name:
        'SEO Empire',

      visibility:
        '82%',

      backlinks:
        '12.4k',

      traffic:
        '182k',

      trend:
        '+8%',

    },

    {

      name:
        'Growth Agency',

      visibility:
        '74%',

      backlinks:
        '8.2k',

      traffic:
        '142k',

      trend:
        '+4%',

    },

    {

      name:
        'Local Rank Pro',

      visibility:
        '68%',

      backlinks:
        '6.4k',

      traffic:
        '98k',

      trend:
        '+12%',

    },

  ],

};

/* =========================================================
   COMPETITOR PAGE
========================================================= */

function renderCompetitors(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Competitor Intelligence

              </div>

              <div class="
                fp-sectionText
              ">

                Analyse concurrence,
                backlinks,
                visibilité,
                trafic
                et opportunités SEO.

              </div>

            </div>

            <button class="
              fp-btn
              fp-btnPrimary
            ">

              Analyze Competitor

            </button>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'Competitors',

          value:'42',

          trend:'+8%',

          icon:'🧠',

        })}

        ${createStatCard({

          title:'Keywords',

          value:'18k',

          trend:'+22%',

          icon:'🔎',

        })}

        ${createStatCard({

          title:'Backlinks',

          value:'82k',

          trend:'+18%',

          icon:'🔗',

        })}

        ${createStatCard({

          title:'Traffic',

          value:'482k',

          trend:'+12%',

          icon:'📈',

        })}

      </div>

      <!-- COMPETITORS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Competitor Tracking

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-list
          ">

            ${competitorState
              .competitors
              .map(competitor => `

                <div class="
                  fp-listItem
                ">

                  <div>

                    <div class="
                      fp-listTitle
                    ">

                      ${competitor.name}

                    </div>

                    <div class="
                      fp-listText
                    ">

                      Traffic:
                      ${competitor.traffic}
                      •
                      Backlinks:
                      ${competitor.backlinks}

                    </div>

                  </div>

                  <div class="
                    fp-flex
                    fp-alignCenter
                    fp-gap12
                  ">

                    <div class="
                      fp-badge
                      fp-badgePrimary
                    ">

                      ${competitor.visibility}

                    </div>

                    <div class="
                      fp-badge
                      fp-badgeSuccess
                    ">

                      ${competitor.trend}

                    </div>

                    <button class="
                      fp-btn
                      fp-btnGhost
                    ">

                      Compare

                    </button>

                  </div>

                </div>

              `).join('')}

          </div>

        </div>

      </div>

      <!-- ANALYTICS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- TRAFFIC -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Competitor Traffic

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                18,
                28,
                34,
                52,
                68,
                82,
                98,

              ],

              height:320,

            })}

          </div>

        </div>

        <!-- BACKLINKS -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Backlink Comparison

          </div>

          <div class="
            fp-cardBody
          ">

            ${renderDataTable({

              columns:[

                'Competitor',
                'Backlinks',
                'Trend',

              ],

              rows:

                competitorState
                  .competitors
                  .map(item => [

                    item.name,
                    item.backlinks,
                    item.trend,

                  ]),

            })}

          </div>

        </div>

      </div>

      <!-- GAP ANALYSIS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          SEO Gap Analysis

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Keyword',

              'Competitor',

              'Opportunity',

              'Difficulty',

            ],

            rows:[

              [

                'seo monitoring',

                'SEO Empire',

                'High',

                'Medium',

              ],

              [

                'local seo ai',

                'Growth Agency',

                'High',

                'Low',

              ],

              [

                'executive reports',

                'Local Rank Pro',

                'Medium',

                'Low',

              ],

            ],

          })}

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Competitor Insights

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  SEO Opportunity

                </div>

                <div class="
                  fp-listText
                ">

                  Plusieurs gaps SEO exploitables détectés.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Backlink Expansion

                </div>

                <div class="
                  fp-listText
                ">

                  Potentiel important de backlinks.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Traffic Capture

                </div>

                <div class="
                  fp-listText
                ">

                  Opportunités fortes sur le trafic organique.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   READY
========================================================= */

console.log(
  'Competitor intelligence ready'
);
/* =========================================================
   FINAL AUTOMATION CENTER ENGINE
========================================================= */

/* =========================================================
   AUTOMATION STATE
========================================================= */

const automationState = {

  automations:[

    {

      id:
        uid('automation'),

      name:
        'Daily Executive Reports',

      trigger:
        'Every day',

      status:
        'active',

      executions:
        482,

    },

    {

      id:
        uid('automation'),

      name:
        'Realtime SEO Monitoring',

      trigger:
        'Every hour',

      status:
        'active',

      executions:
        842,

    },

    {

      id:
        uid('automation'),

      name:
        'Client Alert Notifications',

      trigger:
        'On incident',

      status:
        'paused',

      executions:
        182,

    },

  ],

};

/* =========================================================
   AUTOMATION PAGE
========================================================= */

function renderAutomationCenter(){

  return `

    <div class="
      fp-page
    ">

      <!-- HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-flex
            fp-alignCenter
            fp-justifyBetween
            fp-gap20
          ">

            <div>

              <div class="
                fp-sectionTitle
              ">

                Automation Center

              </div>

              <div class="
                fp-sectionText
              ">

                Automatisation,
                workflows,
                IA,
                monitoring
                et exécutions enterprise.

              </div>

            </div>

            <button

              id="
                fpCreateAutomation
              "

              class="
                fp-btn
                fp-btnPrimary
              "
            >

              Create Automation

            </button>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'Automations',

          value:'482',

          trend:'+22%',

          icon:'⚙️',

        })}

        ${createStatCard({

          title:'Executions',

          value:'182k',

          trend:'+28%',

          icon:'⚡',

        })}

        ${createStatCard({

          title:'Realtime',

          value:'98%',

          trend:'+4%',

          icon:'🛰️',

        })}

        ${createStatCard({

          title:'Savings',

          value:'82h',

          trend:'+12%',

          icon:'⏱️',

        })}

      </div>

      <!-- AUTOMATIONS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Active Automations

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-list
          ">

            ${automationState
              .automations
              .map(automation => `

                <div class="
                  fp-listItem
                ">

                  <div>

                    <div class="
                      fp-listTitle
                    ">

                      ${automation.name}

                    </div>

                    <div class="
                      fp-listText
                    ">

                      Trigger:
                      ${automation.trigger}
                      •
                      Executions:
                      ${automation.executions}

                    </div>

                  </div>

                  <div class="
                    fp-flex
                    fp-alignCenter
                    fp-gap12
                  ">

                    <div class="
                      fp-badge
                      ${
                        automation.status
                          === 'active'

                          ? 'fp-badgeSuccess'

                          : 'fp-badgeWarning'
                      }
                    ">

                      ${automation.status}

                    </div>

                    <button class="
                      fp-btn
                      fp-btnGhost
                    ">

                      Edit

                    </button>

                  </div>

                </div>

              `).join('')}

          </div>

        </div>

      </div>

      <!-- ANALYTICS -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- EXECUTIONS -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Execution Analytics

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                18,
                28,
                42,
                58,
                74,
                88,
                98,

              ],

              height:320,

            })}

          </div>

        </div>

        <!-- WORKFLOWS -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Workflow Distribution

          </div>

          <div class="
            fp-cardBody
          ">

            ${renderDataTable({

              columns:[

                'Workflow',
                'Executions',
                'Growth',

              ],

              rows:[

                [

                  'SEO Monitoring',
                  '82k',
                  '+22%',

                ],

                [

                  'Reports',
                  '48k',
                  '+18%',

                ],

                [

                  'Alerts',
                  '32k',
                  '+12%',

                ],

                [

                  'AI Analysis',
                  '20k',
                  '+28%',

                ],

              ],

            })}

          </div>

        </div>

      </div>

      <!-- WORKFLOW MAP -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Automation Flow

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid4
          ">

            <div class="
              fp-noteCard
            ">

              Trigger

            </div>

            <div class="
              fp-noteCard
            ">

              AI Analysis

            </div>

            <div class="
              fp-noteCard
            ">

              Monitoring

            </div>

            <div class="
              fp-noteCard
            ">

              Reports

            </div>

          </div>

        </div>

      </div>

      <!-- AI -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Automation Insights

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Automation Growth

                </div>

                <div class="
                  fp-listText
                ">

                  Les workflows enterprise augmentent rapidement.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Time Savings

                </div>

                <div class="
                  fp-listText
                ">

                  Forte réduction des tâches manuelles.

                </div>

              </div>

            </div>

            <div class="
              fp-listItem
            ">

              <div>

                <div class="
                  fp-listTitle
                ">

                  Infrastructure Stable

                </div>

                <div class="
                  fp-listText
                ">

                  Exécutions automatisées stables.

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   EVENTS
========================================================= */

function bindAutomationEvents(){

  const create =
    qs('#fpCreateAutomation');

  if(create){

    create.onclick = () => {

      openModal({

        title:
          'Créer une automation',

        content:`

          <div class="
            fp-flex
            fp-flexCol
            fp-gap20
          ">

            <input
              class="
                fp-input
              "
              placeholder="
                Nom workflow
              "
            />

            <select class="
              fp-select
            ">

              <option>
                Every hour
              </option>

              <option>
                Every day
              </option>

              <option>
                On event
              </option>

            </select>

            <button class="
              fp-btn
              fp-btnPrimary
            ">

              Créer automation

            </button>

          </div>

        `,

      });
    };
  }
}

/* =========================================================
   EVENTS PATCH
========================================================= */

const previousAutomationBind =
  bindEvents;

bindEvents = function(){

  previousAutomationBind();

  bindAutomationEvents();
};

/* =========================================================
   READY
========================================================= */

console.log(
  'Automation center ready'
);
/* =========================================================
   FINAL OVERVIEW PAGE
========================================================= */

/* =========================================================
   OVERVIEW PAGE
========================================================= */

function renderOverview(){

  return `

    <div class="
      fp-page
    ">

      <!-- EXECUTIVE HERO -->

      <div class="
        fp-card
        fp-gradientPrimary
        fp-executiveHero
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid2
          ">

            <!-- LEFT -->

            <div>

              <div class="
                fp-heroGreeting
              ">

                BON RETOUR • FLOWPOINT

              </div>

              <div class="
                fp-heroTitle
              ">

                Enterprise Command Center

              </div>

              <div class="
                fp-heroText
              ">

                Votre infrastructure SaaS
                est stable,
                le SEO progresse fortement
                et plusieurs opportunités
                business à haute valeur
                ont été détectées.

              </div>

              <div class="
                fp-flex
                fp-gap16
                fp-mt32
              ">

                <button class="
                  fp-btn
                  fp-btnPrimary
                ">

                  Generate Executive Report

                </button>

                <button class="
                  fp-btn
                  fp-btnGhost
                ">

                  Open AI Center

                </button>

              </div>

            </div>

            <!-- RIGHT -->

            <div class="
              fp-heroStats
            ">

              <div class="
                fp-heroStat
              ">

                <div class="
                  fp-heroStatValue
                ">

                  98%

                </div>

                <div class="
                  fp-heroStatLabel
                ">

                  Infrastructure Health

                </div>

              </div>

              <div class="
                fp-heroStat
              ">

                <div class="
                  fp-heroStatValue
                ">

                  +42%

                </div>

                <div class="
                  fp-heroStatLabel
                ">

                  SEO Visibility Growth

                </div>

              </div>

              <div class="
                fp-heroStat
              ">

                <div class="
                  fp-heroStatValue
                ">

                  48k€

                </div>

                <div class="
                  fp-heroStatLabel
                ">

                  Monthly Recurring Revenue

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

      <!-- KPI -->

      <div class="
        fp-grid4
        fp-mt24
      ">

        ${createStatCard({

          title:'MRR',

          value:'48k€',

          trend:'+22%',

          icon:'💳',

        })}

        ${createStatCard({

          title:'SEO Growth',

          value:'+42%',

          trend:'+18%',

          icon:'📈',

        })}

        ${createStatCard({

          title:'Monitoring',

          value:'99.98%',

          trend:'+2%',

          icon:'🛰️',

        })}

        ${createStatCard({

          title:'Retention',

          value:'92%',

          trend:'+4%',

          icon:'🎯',

        })}

      </div>

      <!-- EXECUTIVE SUMMARY -->

      <div class="
        fp-mt24
      ">

        ${renderExecutiveSummary()}

      </div>

      <!-- MAIN -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- ACTIVITY -->

        ${renderActivityPanel()}

        <!-- HEALTH -->

        ${renderSystemHealth()}

      </div>

      <!-- PERFORMANCE -->

      <div class="
        fp-grid2
        fp-mt24
      ">

        <!-- REVENUE -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            Revenue Growth

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                12,
                18,
                28,
                42,
                58,
                74,
                98,

              ],

              height:320,

            })}

          </div>

        </div>

        <!-- SEO -->

        <div class="
          fp-card
        ">

          <div class="
            fp-cardHeader
          ">

            SEO Visibility

          </div>

          <div class="
            fp-cardBody
          ">

            ${createMiniChart({

              values:[

                18,
                24,
                34,
                48,
                62,
                82,
                96,

              ],

              height:320,

            })}

          </div>

        </div>

      </div>

      <!-- QUICK WINS -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          AI Quick Wins

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-grid3
          ">

            <div class="
              fp-noteCard
            ">

              <div class="
                fp-noteTitle
              ">

                SEO Expansion

              </div>

              <div class="
                fp-noteText
              ">

                Optimiser plusieurs pages locales
                à fort potentiel SEO.

              </div>

            </div>

            <div class="
              fp-noteCard
            ">

              <div class="
                fp-noteTitle
              ">

                Infrastructure Scaling

              </div>

              <div class="
                fp-noteText
              ">

                Ajouter nouveaux monitors
                sur les services critiques.

              </div>

            </div>

            <div class="
              fp-noteCard
            ">

              <div class="
                fp-noteTitle
              ">

                Revenue Expansion

              </div>

              <div class="
                fp-noteText
              ">

                Plusieurs opportunités
                d’upgrade enterprise détectées.

              </div>

            </div>

          </div>

        </div>

      </div>

      <!-- EXECUTIVE TABLE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Executive Metrics

        </div>

        <div class="
          fp-cardBody
        ">

          ${renderDataTable({

            columns:[

              'Metric',

              'Current',

              'Trend',

              'Status',

            ],

            rows:[

              [

                'MRR',

                '48k€',

                '+22%',

                'Excellent',

              ],

              [

                'SEO Visibility',

                '92%',

                '+18%',

                'Growing',

              ],

              [

                'Infrastructure',

                '99.98%',

                '+2%',

                'Stable',

              ],

              [

                'Retention',

                '92%',

                '+4%',

                'Healthy',

              ],

            ],

          })}

        </div>

      </div>

      <!-- TIMELINE -->

      <div class="
        fp-card
        fp-mt24
      ">

        <div class="
          fp-cardHeader
        ">

          Enterprise Timeline

        </div>

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-timeline
          ">

            <div class="
              fp-timelineItem
            ">

              <div class="
                fp-timelineDot
                fp-alertDot
                success
              "></div>

              <div class="
                fp-timelineCard
              ">

                <div class="
                  fp-timelineTitle
                ">

                  Executive report generated

                </div>

                <div class="
                  fp-timelineText
                ">

                  Rapport enterprise généré automatiquement.

                </div>

                <div class="
                  fp-timelineTime
                ">

                  2 minutes ago

                </div>

              </div>

            </div>

            <div class="
              fp-timelineItem
            ">

              <div class="
                fp-timelineDot
                fp-alertDot
                warning
              "></div>

              <div class="
                fp-timelineCard
              ">

                <div class="
                  fp-timelineTitle
                ">

                  SEO opportunity detected

                </div>

                <div class="
                  fp-timelineText
                ">

                  Plusieurs quick wins SEO détectés.

                </div>

                <div class="
                  fp-timelineTime
                ">

                  18 minutes ago

                </div>

              </div>

            </div>

            <div class="
              fp-timelineItem
            ">

              <div class="
                fp-timelineDot
                fp-alertDot
                primary
              "></div>

              <div class="
                fp-timelineCard
              ">

                <div class="
                  fp-timelineTitle
                ">

                  Infrastructure scaling completed

                </div>

                <div class="
                  fp-timelineText
                ">

                  Nouveaux monitors ajoutés
                  avec succès.

                </div>

                <div class="
                  fp-timelineTime
                ">

                  1 hour ago

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   READY
========================================================= */

console.log(
  'Overview enterprise ready'
);
/* =========================================================
   FINAL LAYOUT / DASHBOARD CORE CSS
========================================================= */

/* =========================================================
   ROOT
========================================================= */

:root{

  --fpBg:
    #060816;

  --fpBg2:
    #0b1020;

  --fpCard:
    rgba(15,22,40,.92);

  --fpCard2:
    rgba(20,28,50,.94);

  --fpBorder:
    rgba(255,255,255,.06);

  --fpText:
    #f4f7ff;

  --fpTextSoft:
    #8ea3d4;

  --fpPrimary:
    #2f5bff;

  --fpPrimary2:
    #5d82ff;

  --fpSuccess:
    #10b981;

  --fpWarning:
    #f59e0b;

  --fpDanger:
    #ef4444;

  --fpShadow:
    0 30px 60px
    rgba(0,0,0,.34);

  --fpRadius:
    30px;

}

/* =========================================================
   RESET
========================================================= */

*{
  margin:0;
  padding:0;
  box-sizing:border-box;
}

html,
body{
  width:100%;
  min-height:100%;
}

body{
  background:
    radial-gradient(
      circle at top left,
      rgba(47,91,255,.18),
      transparent 32%
    ),

    radial-gradient(
      circle at top right,
      rgba(93,130,255,.12),
      transparent 28%
    ),

    linear-gradient(
      180deg,
      var(--fpBg),
      #04050d
    );

  color:
    var(--fpText);

  font-family:
    Inter,
    ui-sans-serif,
    system-ui;

  overflow-x:hidden;
}

/* =========================================================
   APP
========================================================= */

#app{
  width:100%;
  min-height:100vh;
}

/* =========================================================
   DASHBOARD
========================================================= */

.fp-dashboardShell{
  width:100%;
  min-height:100vh;

  display:grid;

  grid-template-columns:
    320px
    1fr;
}

/* =========================================================
   SIDEBAR
========================================================= */

.fp-sidebar{
  position:sticky;
  top:0;

  height:100vh;

  padding:24px;

  display:flex;
  flex-direction:column;
  justify-content:space-between;

  border-right:
    1px solid
    rgba(255,255,255,.04);

  background:
    linear-gradient(
      180deg,
      rgba(9,13,24,.96),
      rgba(6,8,16,.98)
    );

  backdrop-filter:
    blur(18px);
}

.fp-sidebarTop{
  display:flex;
  flex-direction:column;
  gap:28px;
}

.fp-sidebarNav{
  display:flex;
  flex-direction:column;
  gap:10px;
}

/* =========================================================
   SIDEBAR LINK
========================================================= */

.fp-sidebarLink{
  width:100%;

  min-height:58px;

  border:none;
  cursor:pointer;

  padding:0 18px;

  display:flex;
  align-items:center;
  gap:16px;

  border-radius:20px;

  background:
    transparent;

  color:
    var(--fpTextSoft);

  transition:.2s;
}

.fp-sidebarLink:hover{
  background:
    rgba(255,255,255,.04);

  color:white;
}

.fp-sidebarLink.active{
  background:
    linear-gradient(
      135deg,
      rgba(47,91,255,.24),
      rgba(93,130,255,.12)
    );

  border:
    1px solid
    rgba(47,91,255,.16);

  color:white;
}

.fp-sidebarIcon{
  width:38px;
  height:38px;

  border-radius:14px;

  display:flex;
  align-items:center;
  justify-content:center;

  background:
    rgba(255,255,255,.04);

  font-size:16px;
}

/* =========================================================
   MAIN
========================================================= */

.fp-main{
  min-width:0;

  display:flex;
  flex-direction:column;
}

/* =========================================================
   TOPBAR
========================================================= */

.fp-topbar{
  position:sticky;
  top:0;
  z-index:60;

  min-height:92px;

  padding:20px 32px;

  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:20px;

  border-bottom:
    1px solid
    rgba(255,255,255,.04);

  background:
    rgba(6,8,16,.72);

  backdrop-filter:
    blur(18px);
}

.fp-pageTitle{
  font-size:30px;
  font-weight:900;
}

.fp-pageSub{
  margin-top:8px;

  color:
    var(--fpTextSoft);

  font-size:13px;
}

/* =========================================================
   CONTENT
========================================================= */

.fp-content{
  padding:32px;
}

/* =========================================================
   PAGE
========================================================= */

.fp-page{
  width:100%;

  display:flex;
  flex-direction:column;
}

/* =========================================================
   CARD
========================================================= */

.fp-card{
  position:relative;

  border-radius:
    var(--fpRadius);

  background:
    linear-gradient(
      180deg,
      rgba(16,22,38,.96),
      rgba(10,14,28,.96)
    );

  border:
    1px solid
    var(--fpBorder);

  box-shadow:
    var(--fpShadow);

  overflow:hidden;
}

.fp-cardHeader{
  min-height:72px;

  padding:0 28px;

  display:flex;
  align-items:center;

  border-bottom:
    1px solid
    rgba(255,255,255,.05);

  font-size:16px;
  font-weight:800;
}

.fp-cardBody{
  padding:28px;
}

/* =========================================================
   GRID
========================================================= */

.fp-grid2{
  display:grid;
  grid-template-columns:
    repeat(2,minmax(0,1fr));
  gap:24px;
}

.fp-grid3{
  display:grid;
  grid-template-columns:
    repeat(3,minmax(0,1fr));
  gap:24px;
}

.fp-grid4{
  display:grid;
  grid-template-columns:
    repeat(4,minmax(0,1fr));
  gap:24px;
}

/* =========================================================
   BUTTON
========================================================= */

.fp-btn{
  min-height:52px;

  border:none;
  cursor:pointer;

  padding:0 22px;

  border-radius:18px;

  font-size:14px;
  font-weight:800;

  transition:.2s;
}

.fp-btn:hover{
  transform:
    translateY(-2px);
}

/* =========================================================
   TABLE
========================================================= */

.fp-table{
  width:100%;
}

.fp-table th{
  padding:18px 20px;

  text-align:left;

  color:
    var(--fpTextSoft);

  font-size:12px;
  font-weight:800;

  border-bottom:
    1px solid
    rgba(255,255,255,.06);
}

.fp-table td{
  padding:20px;

  font-size:14px;

  border-bottom:
    1px solid
    rgba(255,255,255,.04);
}

/* =========================================================
   PROGRESS
========================================================= */

.fp-progress{
  width:100%;
  height:12px;

  margin-top:16px;

  border-radius:999px;

  overflow:hidden;

  background:
    rgba(255,255,255,.06);
}

.fp-progressBar{
  height:100%;

  border-radius:999px;

  background:
    linear-gradient(
      90deg,
      var(--fpPrimary),
      var(--fpPrimary2)
    );
}

/* =========================================================
   RESPONSIVE
========================================================= */

@media(max-width:1280px){

  .fp-grid4{
    grid-template-columns:
      repeat(2,minmax(0,1fr));
  }

  .fp-grid3{
    grid-template-columns:
      repeat(2,minmax(0,1fr));
  }
}

@media(max-width:980px){

  .fp-dashboardShell{
    grid-template-columns:
      1fr;
  }

  .fp-sidebar{
    display:none;
  }

  .fp-grid2,
  .fp-grid3,
  .fp-grid4{
    grid-template-columns:
      1fr;
  }
}

@media(max-width:760px){

  .fp-topbar{
    padding:18px;
  }

  .fp-content{
    padding:18px;
  }

  .fp-pageTitle{
    font-size:24px;
  }

  .fp-cardBody{
    padding:20px;
  }

  .fp-cardHeader{
    padding:0 20px;
  }
}
/* =========================================================
   FINAL UI HELPERS / COMPONENT FACTORY
========================================================= */

/* =========================================================
   STAT CARD
========================================================= */

function createStatCard({

  title='Metric',

  value='0',

  trend='+0%',

  icon='📈',

} = {}){

  return `

    <div class="
      fp-statCard
    ">

      <div class="
        fp-flex
        fp-alignCenter
        fp-justifyBetween
      ">

        <div class="
          fp-statIcon
        ">

          ${icon}

        </div>

        <div class="
          fp-badge
          fp-badgeSuccess
        ">

          ${trend}

        </div>

      </div>

      <div class="
        fp-statValue
      ">

        ${value}

      </div>

      <div class="
        fp-statTitle
      ">

        ${title}

      </div>

    </div>

  `;
}

/* =========================================================
   PROGRESS
========================================================= */

function createProgress({

  value=0,

} = {}){

  return `

    <div class="
      fp-progress
    ">

      <div

        class="
          fp-progressBar
        "

        style="
          width:${value}%;
        "
      ></div>

    </div>

  `;
}

/* =========================================================
   EMPTY STATE
========================================================= */

function renderEmptyState({

  icon='📭',

  title='Aucune donnée',

  text='',

} = {}){

  return `

    <div class="
      fp-emptyState
    ">

      <div class="
        fp-emptyIcon
      ">

        ${icon}

      </div>

      <div class="
        fp-emptyTitle
      ">

        ${title}

      </div>

      <div class="
        fp-emptyText
      ">

        ${text}

      </div>

    </div>

  `;
}

/* =========================================================
   COMMAND PALETTE
========================================================= */

function openGlobalSearch(){

  openModal({

    title:
      'Recherche globale',

    content:`

      <div class="
        fp-commandPalette
      ">

        <input

          id="
            fpCommandInput
          "

          class="
            fp-commandInput
          "

          placeholder="
            Rechercher une page, action ou donnée...
          "
        />

        <div

          id="
            fpSearchResults
          "

          class="
            fp-searchResults
          "
        >

        </div>

      </div>

    `,

  });

  const input =
    qs('#fpCommandInput');

  const results =
    qs('#fpSearchResults');

  function renderSearch(){

    const value =
      input.value.trim();

    const items =
      advancedSearch(value);

    results.innerHTML =

      items.map(item => `

        <button

          class="
            fp-commandItem
          "

          data-command-route="
            ${item.key}
          "
        >

          <div class="
            fp-commandTitle
          ">

            ${item.title}

          </div>

          <div class="
            fp-commandType
          ">

            ${item.type}

          </div>

        </button>

      `).join('');

    qsa('[data-command-route]')
      .forEach(button => {

        button.onclick = () => {

          closeModal();

          setRoute(

            button.dataset
              .commandRoute

          );
        };
      });
  }

  renderSearch();

  input.oninput =
    renderSearch;

  input.focus();
}

/* =========================================================
   QUICK ACTIONS
========================================================= */

function renderQuickActions(){

  return `

    <div class="
      fp-quickActions
    ">

      <button

        id="
          fpQuickAi
        "

        class="
          fp-quickAction
        "
      >

        🤖

      </button>

      <button

        id="
          fpQuickReport
        "

        class="
          fp-quickAction
        "
      >

        📄

      </button>

    </div>

  `;
}

/* =========================================================
   QUICK EVENTS
========================================================= */

function bindQuickActions(){

  const ai =
    qs('#fpQuickAi');

  if(ai){

    ai.onclick = () => {

      setRoute('ai');
    };
  }

  const report =
    qs('#fpQuickReport');

  if(report){

    report.onclick = () => {

      toast(

        'Executive report généré',

        'success'

      );
    };
  }
}

/* =========================================================
   APP PATCH
========================================================= */

const previousRender =
  render;

render = function(){

  previousRender();

  document.body.insertAdjacentHTML(

    'beforeend',

    renderQuickActions()

  );

  bindQuickActions();
};

/* =========================================================
   KEYBOARD SHORTCUTS
========================================================= */

document.addEventListener(

  'keydown',

  event => {

    /* CMD / CTRL + K */

    if(

      (
        event.metaKey
        ||
        event.ctrlKey
      )

      &&

      event.key
        .toLowerCase()

      === 'k'

    ){

      event.preventDefault();

      openGlobalSearch();
    }

    /* ESC */

    if(

      event.key
      === 'Escape'

    ){

      closeModal();
    }
  }
);

/* =========================================================
   LOADING
========================================================= */

function showLoading({

  title='Chargement...',

} = {}){

  openModal({

    title,

    content:`

      <div class="
        fp-emptyState
      ">

        <div class="
          fp-emptyIcon
        ">

          ⚡

        </div>

        <div class="
          fp-emptyText
        ">

          Synchronisation FlowPoint...

        </div>

      </div>

    `,

  });
}

/* =========================================================
   BOOT
========================================================= */

function boot(){

  startRealtimeEngine();

  render();

  console.log(
    'FlowPoint fully booted'
  );
}

/* =========================================================
   START
========================================================= */

document.addEventListener(

  'DOMContentLoaded',

  boot
);

/* =========================================================
   READY
========================================================= */

console.log(
  'UI helpers ready'
);
/* =========================================================
   FINAL PRODUCTION INIT / APP CONFIG
========================================================= */

/* =========================================================
   APP CONFIG
========================================================= */

const appConfig = {

  appName:
    'FlowPoint',

  version:
    '3.0 Enterprise',

  environment:
    'production',

  apiBaseUrl:
    '/api',

  websocketUrl:
    'wss://flowpoint.pro/realtime',

  stripePortalUrl:
    '/billing',

};

/* =========================================================
   SECURITY
========================================================= */

const securityState = {

  authenticated:true,

  sessionValid:true,

  csrfProtected:true,

  encryption:'AES-256',

};

/* =========================================================
   PERFORMANCE
========================================================= */

const runtimeMetrics = {

  renderCount:0,

  apiCalls:0,

  errors:0,

};

/* =========================================================
   TRACK RENDERS
========================================================= */

const previousGlobalRender =
  render;

render = function(){

  runtimeMetrics
    .renderCount++;

  previousGlobalRender();
};

/* =========================================================
   API WRAPPER
========================================================= */

async function apiRequest({

  endpoint='/',

  method='GET',

  body=null,

} = {}){

  runtimeMetrics
    .apiCalls++;

  try{

    const response =
      await fakeApi({

        data:{

          endpoint,
          method,

        },

      });

    return response;

  }catch(error){

    runtimeMetrics
      .errors++;

    console.error(error);

    toast(

      'Erreur API détectée',

      'danger'

    );

    return null;
  }
}

/* =========================================================
   AUTH
========================================================= */

function checkAuthentication(){

  if(

    !securityState
      .authenticated

  ){

    document.body.innerHTML = `

      <div class="
        fp-emptyState
      ">

        <div class="
          fp-emptyIcon
        ">

          🔒

        </div>

        <div class="
          fp-emptyTitle
        ">

          Session expirée

        </div>

        <div class="
          fp-emptyText
        ">

          Reconnexion nécessaire.

        </div>

      </div>

    `;

    return false;
  }

  return true;
}

/* =========================================================
   SESSION WATCHER
========================================================= */

function startSessionWatcher(){

  setInterval(() => {

    if(

      !securityState
        .sessionValid

    ){

      toast(

        'Session expirée',

        'danger'

      );
    }

  }, 60000);
}

/* =========================================================
   NETWORK ENGINE
========================================================= */

function startNetworkEngine(){

  window.addEventListener(

    'online',

    () => {

      realtime.connected =
        true;

      toast(

        'Connexion rétablie',

        'success'

      );
    }
  );

  window.addEventListener(

    'offline',

    () => {

      realtime.connected =
        false;

      toast(

        'Connexion perdue',

        'warning'

      );
    }
  );
}

/* =========================================================
   ERROR HANDLER
========================================================= */

window.addEventListener(

  'error',

  event => {

    runtimeMetrics
      .errors++;

    console.error(
      event.error
    );
  }
);

/* =========================================================
   PERFORMANCE PANEL
========================================================= */

function renderPerformancePanel(){

  return `

    <div class="
      fp-card
    ">

      <div class="
        fp-cardHeader
      ">

        Runtime Metrics

      </div>

      <div class="
        fp-cardBody
      ">

        <div class="
          fp-grid3
        ">

          <div class="
            fp-kpiCard
          ">

            <div class="
              fp-kpiLabel
            ">

              Renders

            </div>

            <div class="
              fp-kpiValue
            ">

              ${
                runtimeMetrics
                  .renderCount
              }

            </div>

          </div>

          <div class="
            fp-kpiCard
          ">

            <div class="
              fp-kpiLabel
            ">

              API Calls

            </div>

            <div class="
              fp-kpiValue
            ">

              ${
                runtimeMetrics
                  .apiCalls
              }

            </div>

          </div>

          <div class="
            fp-kpiCard
          ">

            <div class="
              fp-kpiLabel
            ">

              Errors

            </div>

            <div class="
              fp-kpiValue
            ">

              ${
                runtimeMetrics
                  .errors
              }

            </div>

          </div>

        </div>

      </div>

    </div>

  `;
}

/* =========================================================
   FINAL BOOT
========================================================= */

const previousBoot =
  boot;

boot = function(){

  if(

    !checkAuthentication()

  ){

    return;
  }

  previousBoot();

  startSessionWatcher();

  startNetworkEngine();

  console.log(

    `
      ${appConfig.appName}
      ${appConfig.version}
      initialized
    `

  );
};

/* =========================================================
   FINAL READY
========================================================= */

console.log(
  'Production init ready'
);

/* =========================================================
   END OF FLOWPOINT ENTERPRISE
========================================================= */
/* =========================================================
   FINAL POLISH / PREMIUM EFFECTS CSS
========================================================= */

/* =========================================================
   SCROLLBAR
========================================================= */

::-webkit-scrollbar{
  width:10px;
  height:10px;
}

::-webkit-scrollbar-track{
  background:
    rgba(255,255,255,.03);
}

::-webkit-scrollbar-thumb{
  border-radius:999px;

  background:
    linear-gradient(
      180deg,
      rgba(47,91,255,.8),
      rgba(93,130,255,.8)
    );
}

/* =========================================================
   SELECTION
========================================================= */

::selection{
  background:
    rgba(47,91,255,.34);

  color:white;
}

/* =========================================================
   CARD HOVER
========================================================= */

.fp-card{
  transition:
    transform .22s,
    border-color .22s,
    box-shadow .22s;
}

.fp-card:hover{
  transform:
    translateY(-4px);

  border-color:
    rgba(47,91,255,.16);

  box-shadow:
    0 40px 90px
    rgba(0,0,0,.42);
}

/* =========================================================
   BUTTON EFFECT
========================================================= */

.fp-btn{
  position:relative;
  overflow:hidden;
}

.fp-btn::before{
  content:'';

  position:absolute;
  inset:0;

  background:
    linear-gradient(
      120deg,
      transparent,
      rgba(255,255,255,.18),
      transparent
    );

  transform:
    translateX(-120%);

  transition:.5s;
}

.fp-btn:hover::before{
  transform:
    translateX(120%);
}

/* =========================================================
   GLOW
========================================================= */

.fp-gradientPrimary{
  position:relative;
}

.fp-gradientPrimary::after{
  content:'';

  position:absolute;
  inset:-40%;

  background:
    radial-gradient(
      circle,
      rgba(47,91,255,.12),
      transparent 58%
    );

  pointer-events:none;
}

/* =========================================================
   STAT CARD GLOW
========================================================= */

.fp-statCard::after{
  content:'';

  position:absolute;

  top:-80px;
  right:-80px;

  width:180px;
  height:180px;

  border-radius:999px;

  background:
    radial-gradient(
      circle,
      rgba(47,91,255,.18),
      transparent 72%
    );
}

/* =========================================================
   TOPBAR BLUR
========================================================= */

.fp-topbar{
  box-shadow:
    0 10px 40px
    rgba(0,0,0,.18);
}

/* =========================================================
   SIDEBAR
========================================================= */

.fp-sidebar{
  box-shadow:
    inset
    -1px 0 0
    rgba(255,255,255,.03);
}

/* =========================================================
   PAGE ANIMATION
========================================================= */

.fp-page{
  animation:
    fpFade .28s ease;
}

@keyframes fpFade{

  from{
    opacity:0;
    transform:
      translateY(8px);
  }

  to{
    opacity:1;
    transform:
      translateY(0);
  }
}

/* =========================================================
   FLOAT
========================================================= */

.fp-liveDot{
  animation:
    fpPulse 1.8s infinite;
}

@keyframes fpPulse{

  0%{
    transform:scale(1);
    opacity:1;
  }

  50%{
    transform:scale(1.4);
    opacity:.6;
  }

  100%{
    transform:scale(1);
    opacity:1;
  }
}

/* =========================================================
   CHART
========================================================= */

.fp-miniChartBar{
  transition:
    height .3s,
    opacity .2s,
    transform .2s;
}

.fp-miniChartBar:hover{
  opacity:.84;

  transform:
    translateY(-4px);
}

/* =========================================================
   MODAL
========================================================= */

.fp-modal{
  animation:
    fpModal .24s ease;
}

@keyframes fpModal{

  from{
    opacity:0;
    transform:
      scale(.96)
      translateY(10px);
  }

  to{
    opacity:1;
    transform:
      scale(1)
      translateY(0);
  }
}

/* =========================================================
   QUICK ACTIONS
========================================================= */

.fp-quickAction{
  transition:
    transform .22s,
    box-shadow .22s;
}

.fp-quickAction:hover{
  transform:
    translateY(-4px)
    scale(1.04);

  box-shadow:
    0 30px 60px
    rgba(47,91,255,.42);
}

/* =========================================================
   AI BUBBLE
========================================================= */

.fp-aiBubble{
  position:relative;
}

.fp-aiMessage.assistant
.fp-aiBubble::after{

  content:'';

  position:absolute;

  left:-8px;
  top:22px;

  width:16px;
  height:16px;

  transform:
    rotate(45deg);

  background:
    rgba(255,255,255,.04);

  border-left:
    1px solid
    rgba(255,255,255,.05);

  border-bottom:
    1px solid
    rgba(255,255,255,.05);
}

/* =========================================================
   CHAT
========================================================= */

.fp-chatBubble{
  position:relative;
}

.fp-chatBubble::after{

  content:'';

  position:absolute;

  left:-8px;
  top:18px;

  width:16px;
  height:16px;

  transform:
    rotate(45deg);

  background:
    rgba(255,255,255,.04);

  border-left:
    1px solid
    rgba(255,255,255,.05);

  border-bottom:
    1px solid
    rgba(255,255,255,.05);
}

/* =========================================================
   GLASS
========================================================= */

.fp-card,
.fp-modal,
.fp-topbar,
.fp-sidebar{

  backdrop-filter:
    blur(18px);
}

/* =========================================================
   RESPONSIVE FIXES
========================================================= */

@media(max-width:980px){

  .fp-topbar{
    position:relative;
  }

  .fp-sidebar{
    display:none;
  }

  .fp-dashboardShell{
    grid-template-columns:
      1fr;
  }
}

@media(max-width:760px){

  .fp-btn{
    width:100%;
  }

  .fp-flex{
    flex-wrap:wrap;
  }

  .fp-topbar{
    flex-direction:column;
    align-items:flex-start;
  }

  .fp-userProfile{
    width:100%;
  }

  .fp-card{
    border-radius:24px;
  }

  .fp-statCard{
    border-radius:24px;
  }
}

/* =========================================================
   PRINT MODE
========================================================= */

@media print{

  body{
    background:white;
    color:black;
  }

  .fp-sidebar,
  .fp-topbar,
  .fp-quickActions{
    display:none;
  }

  .fp-card{
    box-shadow:none;
    border:1px solid #ddd;
    background:white;
  }
}

/* =========================================================
   FINAL TOUCH
========================================================= */

body::before{

  content:'';

  position:fixed;
  inset:0;

  background:

    radial-gradient(
      circle at 10% 10%,
      rgba(47,91,255,.10),
      transparent 24%
    ),

    radial-gradient(
      circle at 90% 20%,
      rgba(93,130,255,.08),
      transparent 20%
    ),

    radial-gradient(
      circle at 50% 90%,
      rgba(47,91,255,.06),
      transparent 22%
    );

  pointer-events:none;

  z-index:-1;
}
/* =========================================================
   FINAL ROUTER / APP CORE
========================================================= */

/* =========================================================
   ROUTES
========================================================= */

const routes = {

  overview:{
    title:
      'Overview',

    render:
      renderOverview,
  },

  ai:{
    title:
      'AI Center',

    render:
      renderAiCenter,
  },

  business:{
    title:
      'Business Intelligence',

    render:
      renderBusinessCenter,
  },

  reports:{
    title:
      'Executive Reports',

    render:
      renderReports,
  },

  billing:{
    title:
      'Billing',

    render:
      renderBilling,
  },

  alerts:{
    title:
      'Alert Center',

    render:
      renderAlerts,
  },

  localSeo:{
    title:
      'Local SEO',

    render:
      renderLocalSeo,
  },

  competitors:{
    title:
      'Competitors',

    render:
      renderCompetitors,
  },

  automation:{
    title:
      'Automation Center',

    render:
      renderAutomationCenter,
  },

  clients:{
    title:
      'Client Portal',

    render:
      renderClientPortal,
  },

  workspace:{
    title:
      'Workspace',

    render:
      renderWorkspaceOverview,
  },

  settings:{
    title:
      'Settings',

    render:
      renderSettings,
  },

};

/* =========================================================
   APP STATE
========================================================= */

const appState = {

  route:'overview',

};

/* =========================================================
   NAVIGATION
========================================================= */

const sidebarNavigation = [

  {

    key:'overview',

    icon:'🏠',

    label:'Overview',

  },

  {

    key:'ai',

    icon:'🤖',

    label:'AI Center',

  },

  {

    key:'business',

    icon:'📈',

    label:'Business',

  },

  {

    key:'reports',

    icon:'📄',

    label:'Reports',

  },

  {

    key:'billing',

    icon:'💳',

    label:'Billing',

  },

  {

    key:'alerts',

    icon:'🚨',

    label:'Alerts',

  },

  {

    key:'localSeo',

    icon:'📍',

    label:'Local SEO',

  },

  {

    key:'competitors',

    icon:'🧠',

    label:'Competitors',

  },

  {

    key:'automation',

    icon:'⚙️',

    label:'Automation',

  },

  {

    key:'clients',

    icon:'👥',

    label:'Clients',

  },

  {

    key:'workspace',

    icon:'📁',

    label:'Workspace',

  },

  {

    key:'settings',

    icon:'🛠️',

    label:'Settings',

  },

];

/* =========================================================
   SIDEBAR
========================================================= */

function renderSidebar(){

  return `

    <aside class="
      fp-sidebar
    ">

      <div class="
        fp-sidebarTop
      ">

        <!-- BRAND -->

        <div class="
          fp-brand
        ">

          <div class="
            fp-brandLogo
          ">

            ⚡

          </div>

          <div>

            <div class="
              fp-brandTitle
            ">

              FlowPoint

            </div>

            <div class="
              fp-brandSub
            ">

              Enterprise Suite

            </div>

          </div>

        </div>

        <!-- NAV -->

        <div class="
          fp-sidebarNav
        ">

          ${sidebarNavigation
            .map(item => `

              <button

                class="
                  fp-sidebarLink
                  ${
                    appState.route
                    === item.key

                    ? 'active'
                    : ''
                  }
                "

                data-route="
                  ${item.key}
                "
              >

                <div class="
                  fp-sidebarIcon
                ">

                  ${item.icon}

                </div>

                <div>

                  ${item.label}

                </div>

              </button>

            `).join('')}

        </div>

      </div>

      <!-- FOOT -->

      <div class="
        fp-userProfile
      ">

        <div class="
          fp-userAvatar
        ">

          M

        </div>

        <div>

          <div class="
            fp-userName
          ">

            Maël

          </div>

          <div class="
            fp-userPlan
          ">

            Ultra Plan

          </div>

        </div>

      </div>

    </aside>

  `;
}

/* =========================================================
   TOPBAR
========================================================= */

function renderTopbar(){

  const route =
    routes[
      appState.route
    ];

  return `

    <header class="
      fp-topbar
    ">

      <div>

        <div class="
          fp-pageTitle
        ">

          ${route.title}

        </div>

        <div class="
          fp-pageSub
        ">

          Enterprise control center
          powered by FlowPoint AI

        </div>

      </div>

      <div class="
        fp-flex
        fp-alignCenter
        fp-gap16
      ">

        <button

          id="
            fpSearchButton
          "

          class="
            fp-btn
            fp-btnGhost
          "
        >

          ⌘K Search

        </button>

        <div class="
          fp-liveBadge
        ">

          <div class="
            fp-liveDot
          "></div>

          LIVE

        </div>

      </div>

    </header>

  `;
}

/* =========================================================
   MAIN
========================================================= */

function renderMain(){

  const route =
    routes[
      appState.route
    ];

  return `

    <main class="
      fp-main
    ">

      ${renderTopbar()}

      <div class="
        fp-content
      ">

        ${route.render()}

      </div>

    </main>

  `;
}

/* =========================================================
   APP
========================================================= */

function renderApp(){

  return `

    <div class="
      fp-dashboardShell
    ">

      ${renderSidebar()}

      ${renderMain()}

    </div>

  `;
}

/* =========================================================
   ROUTER
========================================================= */

function setRoute(route='overview'){

  if(

    !routes[route]

  ){

    route = 'overview';
  }

  appState.route =
    route;

  render();
}

/* =========================================================
   EVENTS
========================================================= */

function bindRouterEvents(){

  qsa('[data-route]')
    .forEach(button => {

      button.onclick = () => {

        setRoute(

          button.dataset
            .route

        );
      };
    });

  const search =
    qs('#fpSearchButton');

  if(search){

    search.onclick =
      openGlobalSearch;
  }
}

/* =========================================================
   ROOT RENDER
========================================================= */

function render(){

  const root =
    qs('#app');

  if(!root){
    return;
  }

  root.innerHTML =
    renderApp();

  bindRouterEvents();

  bindEvents();
}

/* =========================================================
   READY
========================================================= */

console.log(
  'Router core ready'
);
/* =========================================================
   FINAL DATA LAYER / MOCK BACKEND ENGINE
========================================================= */

/* =========================================================
   FAKE DATABASE
========================================================= */

const db = {

  users:[

    {

      id:
        'u_001',

      name:
        'Maël',

      plan:
        'Ultra',

      email:
        'mael@flowpoint.pro',

    },

  ],

  metrics:{

    mrr:48200,

    arr:578400,

    churn:2.4,

    customers:182,

  },

};

/* =========================================================
   API SIMULATION
========================================================= */

function delay(ms=400){

  return new Promise(
    resolve =>
      setTimeout(resolve, ms)
  );
}

/* =========================================================
   GET OVERVIEW DATA
========================================================= */

async function getOverviewData(){

  await delay(350);

  return {

    kpis:{

      mrr:
        db.metrics.mrr,

      arr:
        db.metrics.arr,

      churn:
        db.metrics.churn,

      customers:
        db.metrics.customers,

    },

    health:{

      uptime:99.98,

      apiLatency:182,

      errors:0.02,

    },

  };
}

/* =========================================================
   GET AI INSIGHTS
========================================================= */

async function getAiInsights(){

  await delay(500);

  return [

    {

      type:
        'seo',

      title:
        'SEO Opportunity',

      text:
        'Pages locales sous-optimisées détectées.',

    },

    {

      type:
        'revenue',

      title:
        'Revenue Expansion',

      text:
        'Upsell potentiel sur plans Pro/Ultra.',

    },

    {

      type:
        'infra',

      title:
        'Infrastructure Stable',

      text:
        'Aucun incident critique détecté.',

    },

  ];

}

/* =========================================================
   GET CLIENTS
========================================================= */

async function getClients(){

  await delay(300);

  return [

    {

      name:
        'Enterprise A',

      plan:
        'Ultra',

      mrr:
        4800,

    },

    {

      name:
        'Agency B',

      plan:
        'Pro',

      mrr:
        1200,

    },

    {

      name:
        'Startup C',

      plan:
        'Standard',

      mrr:
        300,

    },

  ];

}

/* =========================================================
   UPDATE KPI ENGINE
========================================================= */

async function refreshKpis(){

  const data =
    await getOverviewData();

  db.metrics =
    {

      ...db.metrics,

      ...data.kpis,

    };

  render();
}

/* =========================================================
   REALTIME SIMULATION
========================================================= */

function startRealtimeEngine(){

  setInterval(() => {

    db.metrics.mrr +=
      Math.floor(Math.random()*120);

    db.metrics.customers +=
      Math.random() > 0.7
        ? 1
        : 0;

    render();

  }, 15000);

}

/* =========================================================
   SEARCH ENGINE
========================================================= */

function advancedSearch(query=''){

  const q =
    query.toLowerCase();

  const items = [

    {

      key:'overview',

      title:'Overview',

      type:'page',

    },

    {

      key:'ai',

      title:'AI Center',

      type:'page',

    },

    {

      key:'billing',

      title:'Billing',

      type:'page',

    },

    {

      key:'reports',

      title:'Reports',

      type:'page',

    },

    {

      key:'clients',

      title:'Clients',

      type:'page',

    },

  ];

  if(!q){

    return items;
  }

  return items.filter(item =>

    item.title
      .toLowerCase()
      .includes(q)

  );

}

/* =========================================================
   NOTIFICATIONS ENGINE
========================================================= */

function toast(message='', type='primary'){

  const el =
    document.createElement('div');

  el.className =
    `fp-toast ${type}`;

  el.innerText =
    message;

  document.body.appendChild(el);

  setTimeout(() => {

    el.remove();

  }, 2500);

}

/* =========================================================
   MODAL ENGINE
========================================================= */

let modalInstance =
  null;

function openModal({

  title='',

  content='',

} = {}){

  closeModal();

  const el =
    document.createElement('div');

  el.className =
    'fp-modalOverlay';

  el.innerHTML = `

    <div class="
      fp-modal
    ">

      <div class="
        fp-modalHeader
      ">

        ${title}

      </div>

      <div class="
        fp-modalBody
      ">

        ${content}

      </div>

    </div>

  `;

  document.body.appendChild(el);

  modalInstance = el;

  el.onclick = e => {

    if(e.target === el){

      closeModal();
    }

  };

}

function closeModal(){

  if(modalInstance){

    modalInstance.remove();

    modalInstance =
      null;

  }

}

/* =========================================================
   UTILS
========================================================= */

function qs(selector){

  return document.querySelector(selector);

}

function qsa(selector){

  return document.querySelectorAll(selector);

}

function uid(prefix='id'){

  return `${prefix}_${Math.random().toString(16).slice(2)}`;

}

function formatCurrency(value=0){

  return value.toLocaleString('fr-FR') + '€';

}

/* =========================================================
   INIT DATA LOAD
========================================================= */

async function initData(){

  await refreshKpis();

}

/* =========================================================
   READY PATCH HOOK
========================================================= */

document.addEventListener('DOMContentLoaded', () => {

  initData();

  console.log('Data layer ready');

});
/* =========================================================
   FINAL INTEGRATION PATCH / GLUE LAYER
========================================================= */

/* =========================================================
   GLOBAL BOOTSTRAP FIXES
========================================================= */

let isBooted = false;

/* =========================================================
   SAFE RENDER WRAPPER
========================================================= */

function safeRender(){

  try{

    if(!isBooted){

      return;

    }

    render();

  }catch(err){

    console.error(err);

    toast(

      'Render error detected',

      'danger'

    );

  }

}

/* =========================================================
   PATCH RENDER (DEBOUNCED)
========================================================= */

function debounce(fn, delay=120){

  let t;

  return (...args) => {

    clearTimeout(t);

    t = setTimeout(() => {

      fn(...args);

    }, delay);

  };

}

render = debounce(render, 80);

/* =========================================================
   EVENT BUS (LIGHTWEIGHT)
========================================================= */

const eventBus = {

  events:{},

  on(event, cb){

    if(!this.events[event]){

      this.events[event] = [];

    }

    this.events[event].push(cb);

  },

  emit(event, data){

    (this.events[event] || []).forEach(cb =>

      cb(data)

    );

  },

};

/* =========================================================
   GLOBAL ACTIONS
========================================================= */

function globalRefresh(){

  eventBus.emit('refresh');

  render();

}

eventBus.on('refresh', () => {

  console.log('Global refresh triggered');

});

/* =========================================================
   ROUTE SYNC
========================================================= */

function syncRouteWithHash(){

  const hash =
    location.hash.replace('#','');

  if(hash && routes[hash]){

    setRoute(hash);

  }

}

/* =========================================================
   HASH ROUTING
========================================================= */

window.addEventListener('hashchange', () => {

  syncRouteWithHash();

});

/* =========================================================
   INIT ROUTER SYNC
========================================================= */

syncRouteWithHash();

/* =========================================================
   GLOBAL SHORTCUT PATCH
========================================================= */

document.addEventListener('keydown', (e) => {

  if((e.metaKey || e.ctrlKey) && e.key === 'r'){

    e.preventDefault();

    globalRefresh();

  }

});

/* =========================================================
   PERFORMANCE GUARD
========================================================= */

function performanceGuard(){

  if(runtimeMetrics.renderCount > 2000){

    console.warn('Render limit reached');

    toast(

      'Performance warning',

      'warning'

    );

  }

}

/* =========================================================
   RENDER PATCH WRAPPER
========================================================= */

const originalRender =
  render;

render = function(){

  performanceGuard();

  originalRender();

};

/* =========================================================
   BOOT SEQUENCE FINAL
========================================================= */

function finalBootSequence(){

  if(isBooted){

    return;

  }

  isBooted = true;

  startRealtimeEngine();

  startNetworkEngine();

  startSessionWatcher();

  render();

  console.log(

    '%cFLOWPOINT ENTERPRISE READY',

    'color:#2f5bff;font-size:14px;font-weight:bold;'

  );

}

/* =========================================================
   AUTO START OVERRIDE SAFE
========================================================= */

document.addEventListener('DOMContentLoaded', () => {

  finalBootSequence();

});

/* =========================================================
   GLOBAL EXPORT (OPTIONAL DEBUG)
========================================================= */

window.FlowPoint = {

  state: appState,

  db,

  refresh: globalRefresh,

  setRoute,

  eventBus,

};

/* =========================================================
   END PATCH LAYER
========================================================= */
/* =========================================================
   FINAL DEPLOYMENT LAYER / PRODUCTION HARDENING
========================================================= */

/* =========================================================
   ENV CHECK
========================================================= */

const ENV = {

  isProd:
    true,

  debug:
    false,

  apiVersion:
    'v1',

};

/* =========================================================
   LOG CONTROL
========================================================= */

function prodLog(...args){

  if(!ENV.isProd || ENV.debug){

    console.log(...args);

  }

}

/* =========================================================
   ERROR SANITIZER
========================================================= */

function sanitizeError(err){

  return {

    message:
      err?.message || 'Unknown error',

    stack:
      ENV.isProd
        ? undefined
        : err?.stack,

  };

}

/* =========================================================
   GLOBAL ERROR PATCH
========================================================= */

window.addEventListener('error', (event) => {

  runtimeMetrics.errors++;

  const clean =
    sanitizeError(event.error);

  prodLog('Global error:', clean);

  toast(

    'System error intercepted',

    'danger'

  );

});

/* =========================================================
   UNHANDLED PROMISES
========================================================= */

window.addEventListener('unhandledrejection', (event) => {

  runtimeMetrics.errors++;

  const clean =
    sanitizeError(event.reason);

  prodLog('Promise error:', clean);

  toast(

    'Async failure detected',

    'danger'

  );

});

/* =========================================================
   API RETRY LAYER
========================================================= */

async function retry(fn, retries=3){

  let lastError;

  for(let i=0;i<retries;i++){

    try{

      return await fn();

    }catch(err){

      lastError = err;

      await new Promise(r => setTimeout(r, 400));

    }

  }

  throw lastError;

}

/* =========================================================
   SAFE API WRAPPER (FINAL)
========================================================= */

async function safeApiCall(config){

  return retry(() => apiRequest(config));

}

/* =========================================================
   CACHE LAYER
========================================================= */

const cache = new Map();

function cacheGet(key){

  const item = cache.get(key);

  if(!item) return null;

  const expired =
    Date.now() > item.exp;

  if(expired){

    cache.delete(key);

    return null;

  }

  return item.value;

}

function cacheSet(key, value, ttl=30000){

  cache.set(key, {

    value,

    exp: Date.now() + ttl,

  });

}

/* =========================================================
   DATA FETCH OPTIMIZED
========================================================= */

async function getCachedOverview(){

  const key =
    'overview';

  const cached =
    cacheGet(key);

  if(cached){

    return cached;

  }

  const data =
    await getOverviewData();

  cacheSet(key, data, 20000);

  return data;

}

/* =========================================================
   REALTIME PATCH (STABLE MODE)
========================================================= */

function startRealtimeEngine(){

  if(runtimeMetrics.realtimeStarted){

    return;

  }

  runtimeMetrics.realtimeStarted = true;

  setInterval(() => {

    db.metrics.mrr += Math.floor(Math.random() * 80);

    db.metrics.customers += Math.random() > 0.8 ? 1 : 0;

    eventBus.emit('refresh');

    render();

  }, 20000);

}

/* =========================================================
   PERFORMANCE MODE SWITCH
========================================================= */

function enablePerformanceMode(){

  document.body.classList.add('fp-perfMode');

  toast(

    'Performance mode enabled',

    'success'

  );

}

/* =========================================================
   CLEAN ROUTE CHANGE PATCH
========================================================= */

const originalSetRoute =
  setRoute;

setRoute = function(route){

  originalSetRoute(route);

  location.hash =
    route;

  prodLog('Route changed:', route);

};

/* =========================================================
   SESSION PERSISTENCE
========================================================= */

function saveSession(){

  localStorage.setItem(

    'fp_session',

    JSON.stringify({

      route:
        appState.route,

      metrics:
        db.metrics,

    })

  );

}

function restoreSession(){

  try{

    const data =
      JSON.parse(
        localStorage.getItem('fp_session')
      );

    if(data){

      if(data.route){

        appState.route =
          data.route;

      }

      if(data.metrics){

        db.metrics =
          data.metrics;

      }

    }

  }catch(e){

    prodLog('Session restore failed');

  }

}

/* =========================================================
   AUTO SAVE LOOP
========================================================= */

setInterval(saveSession, 15000);

/* =========================================================
   FINAL BOOT OVERRIDE
========================================================= */

const previousBootFinal =
  finalBootSequence;

finalBootSequence = function(){

  restoreSession();

  previousBootFinal();

  prodLog('Production layer initialized');

};

/* =========================================================
   EDGE HARDENING
========================================================= */

window.addEventListener('offline', () => {

  toast(

    'Offline mode activated',

    'warning'

  );

});

window.addEventListener('online', () => {

  toast(

    'Back online',

    'success'

  );

});

/* =========================================================
   FINAL EXPORT SAFE
========================================================= */

window.FlowPointCore = {

  api: safeApiCall,

  cache: {

    get: cacheGet,

    set: cacheSet,

  },

  retry,

  enablePerformanceMode,

};

/* =========================================================
   END PRODUCTION LAYER
========================================================= */

prodLog('FlowPoint production layer loaded');
/* =========================================================
   FINAL ENTERPRISE SECURITY + STRIPE LAYER
========================================================= */

/* =========================================================
   STRIPE CONFIG
========================================================= */

const stripeConfig = {

  publicKey:
    'pk_live_xxxxxxxxx',

  portalUrl:
    '/billing/portal',

  checkoutUrl:
    '/api/stripe/checkout',

};

/* =========================================================
   BILLING ACTIONS
========================================================= */

async function openStripePortal(){

  try{

    const res =
      await safeApiCall({

        endpoint:
          '/stripe/create-portal',

        method:
          'POST',

      });

    if(res?.url){

      window.location.href =
        res.url;

    }else{

      toast(

        'Impossible d’ouvrir Stripe Portal',

        'danger'

      );

    }

  }catch(e){

    toast(

      'Stripe error',

      'danger'

    );

  }

}

/* =========================================================
   CHECKOUT FLOW
========================================================= */

async function startCheckout(plan='pro'){

  try{

    const res =
      await safeApiCall({

        endpoint:
          '/stripe/checkout',

        method:
          'POST',

        body:{

          plan,

        },

      });

    if(res?.url){

      window.location.href =
        res.url;

    }

  }catch(e){

    toast(

      'Checkout failed',

      'danger'

    );

  }

}

/* =========================================================
   AUTH LAYER (FINAL HARDENED)
========================================================= */

const auth = {

  user:null,

  token:null,

};

/* =========================================================
   LOGIN CHECK
========================================================= */

function isAuthenticated(){

  return !!auth.token;

}

/* =========================================================
   PROTECTED ROUTE GUARD
========================================================= */

function routeGuard(){

  if(!isAuthenticated()){

    toast(

      'Authentication required',

      'danger'

    );

    appState.route =
      'login';

    render();

    return false;

  }

  return true;

}

/* =========================================================
   LOGIN MOCK
========================================================= */

async function login(email,password){

  await delay(600);

  if(email && password){

    auth.user = {

      email,

      plan:'Ultra',

    };

    auth.token =
      'secure_token_xxx';

    toast(

      'Login successful',

      'success'

    );

    setRoute('overview');

  }else{

    toast(

      'Invalid credentials',

      'danger'

    );

  }

}

/* =========================================================
   LOGOUT
========================================================= */

function logout(){

  auth.user = null;

  auth.token = null;

  localStorage.removeItem('fp_session');

  setRoute('login');

  toast(

    'Logged out',

    'warning'

  );

}

/* =========================================================
   LOGIN PAGE
========================================================= */

function renderLogin(){

  return `

    <div class="
      fp-login
    ">

      <div class="
        fp-card
        fp-loginCard
      ">

        <div class="
          fp-cardBody
        ">

          <div class="
            fp-sectionTitle
          ">

            FlowPoint Login

          </div>

          <div class="
            fp-sectionText
          ">

            Accès sécurisé enterprise

          </div>

          <div class="
            fp-flex
            fp-flexCol
            fp-gap16
            fp-mt24
          ">

            <input
              id="fpEmail"
              class="fp-input"
              placeholder="Email"
            />

            <input
              id="fpPassword"
              type="password"
              class="fp-input"
              placeholder="Password"
            />

            <button
              id="fpLoginBtn"
              class="
                fp-btn
                fp-btnPrimary
              "
            >

              Login

            </button>

          </div>

        </div>

      </div>

    </div>

  `;

}

/* =========================================================
   LOGIN EVENTS
========================================================= */

function bindLogin(){

  const btn =
    qs('#fpLoginBtn');

  if(btn){

    btn.onclick = () => {

      const email =
        qs('#fpEmail').value;

      const pass =
        qs('#fpPassword').value;

      login(email, pass);

    };

  }

}

/* =========================================================
   ROUTE PATCH (LOGIN SUPPORT)
========================================================= */

const oldSetRoute =
  setRoute;

setRoute = function(route){

  if(route === 'login'){

    appState.route = 'login';

    render();

    bindLogin();

    return;

  }

  if(!isAuthenticated()){

    appState.route = 'login';

    render();

    bindLogin();

    return;

  }

  oldSetRoute(route);

};

/* =========================================================
   FINAL SECURITY WRAPPER
========================================================= */

function secureRender(){

  if(appState.route !== 'login'){

    if(!routeGuard()) return;

  }

  render();

}

/* =========================================================
   FINAL BOOT PATCH
========================================================= */

const previousFinalBoot =
  finalBootSequence;

finalBootSequence = function(){

  restoreSession();

  previousFinalBoot();

  if(appState.route === 'login'){

    render();

    bindLogin();

  }

  console.log(

    'Stripe + Auth layer ready'

  );

};

/* =========================================================
   GLOBAL ACTIONS EXPORT FINAL
========================================================= */

window.FlowPointAuth = {

  login,

  logout,

  isAuthenticated,

  startCheckout,

  openStripePortal,

};

/* =========================================================
   END SECURITY LAYER
========================================================= */
/* =========================================================
   FINAL SYSTEM HARDENING + DEPLOY HOOKS
========================================================= */

/* =========================================================
   HEALTH CHECK ENGINE
========================================================= */

const healthCheck = {

  status:
    'ok',

  lastCheck:
    Date.now(),

  issues:[],

};

async function runHealthCheck(){

  try{

    const data =
      await getCachedOverview();

    if(!data){

      healthCheck.issues.push(
        'NO_OVERVIEW_DATA'
      );

    }

    healthCheck.lastCheck =
      Date.now();

    healthCheck.status =
      healthCheck.issues.length
        ? 'degraded'
        : 'ok';

    prodLog('Health check:', healthCheck);

  }catch(e){

    healthCheck.status =
      'critical';

    healthCheck.issues.push(
      'SYSTEM_FAILURE'
    );

  }

}

/* =========================================================
   AUTO HEALTH LOOP
========================================================= */

setInterval(

  runHealthCheck,

  30000

);

/* =========================================================
   CIRCUIT BREAKER
========================================================= */

const circuitBreaker = {

  failures:0,

  threshold:5,

  open:false,

};

function recordFailure(){

  circuitBreaker.failures++;

  if(

    circuitBreaker.failures >=
    circuitBreaker.threshold

  ){

    circuitBreaker.open =
      true;

    toast(

      'Circuit breaker activated',

      'danger'

    );

  }

}

function resetCircuit(){

  circuitBreaker.failures = 0;

  circuitBreaker.open = false;

}

/* =========================================================
   SAFE EXECUTION WRAPPER
========================================================= */

async function safeExecute(fn){

  if(circuitBreaker.open){

    throw new Error(
      'Circuit breaker open'
    );

  }

  try{

    return await fn();

  }catch(e){

    recordFailure();

    throw e;

  }

}

/* =========================================================
   RATE LIMITER
========================================================= */

const rateLimiter = {

  calls:0,

  limit:60,

  reset(){

    this.calls = 0;

  },

  check(){

    this.calls++;

    if(this.calls > this.limit){

      toast(

        'Rate limit exceeded',

        'warning'

      );

      return false;

    }

    return true;

  },

};

setInterval(() => {

  rateLimiter.reset();

}, 60000);

/* =========================================================
   DEPLOYMENT HOOK
========================================================= */

async function deployHook(){

  try{

    prodLog(
      'Deploying FlowPoint...'
    );

    await delay(800);

    await runHealthCheck();

    await initData();

    prodLog(
      'Deploy complete'
    );

  }catch(e){

    prodLog(
      'Deploy failed'
    );

    recordFailure();

  }

}

/* =========================================================
   OBSERVABILITY LAYER
========================================================= */

const observability = {

  logs:[],

  metrics:{},

  track(event,data){

    this.logs.push({

      event,

      data,

      time:
        Date.now(),

    });

    if(this.logs.length > 200){

      this.logs.shift();

    }

  },

};

function trackEvent(event,data){

  observability.track(event,data);

}

/* =========================================================
   UI ERROR RECOVERY
========================================================= */

function recoverUI(){

  try{

    render();

    toast(

      'UI recovered',

      'success'

    );

  }catch(e){

    document.body.innerHTML = `

      <div style="
        color:white;
        padding:40px;
        font-family:system-ui;
      ">

        SYSTEM CRITICAL FAILURE

      </div>

    `;

  }

}

/* =========================================================
   AUTO RECOVERY LOOP
========================================================= */

setInterval(() => {

  if(

    runtimeMetrics.errors >
    10

  ){

    recoverUI();

  }

}, 10000);

/* =========================================================
   FINAL SAFE START
========================================================= */

function safeStart(){

  try{

    deployHook();

    startSessionWatcher();

    startNetworkEngine();

    runHealthCheck();

    prodLog(
      'System fully stabilized'
    );

  }catch(e){

    console.error(e);

    recoverUI();

  }

}

/* =========================================================
   FINAL EXPORT DEBUG PANEL
========================================================= */

window.FlowPointDebug = {

  healthCheck,

  circuitBreaker,

  rateLimiter,

  observability,

  safeExecute,

};

/* =========================================================
   END HARDENING LAYER
========================================================= */
/* =========================================================
   FINAL SYSTEM ORCHESTRATOR (CLEAN CORE MERGE)
========================================================= */

/* =========================================================
   ORCHESTRATOR STATE
========================================================= */

const orchestrator = {

  initialized:false,

  mode:'stable',

  services:{

    ui:true,

    api:true,

    realtime:true,

    auth:true,

    billing:true,

  },

};

/* =========================================================
   SERVICE CHECKER
========================================================= */

function checkServices(){

  const failures = [];

  Object.entries(orchestrator.services).forEach(([key,enabled]) => {

    if(!enabled){

      failures.push(key);

    }

  });

  return failures;

}

/* =========================================================
   SYSTEM SYNC
========================================================= */

async function systemSync(){

  try{

    trackEvent('system_sync_start');

    const overview =
      await getCachedOverview();

    const insights =
      await getAiInsights();

    const clients =
      await getClients();

    trackEvent('system_sync_complete',{

      overview,
      insightsCount:insights.length,
      clientsCount:clients.length,

    });

    return {

      overview,
      insights,
      clients,

    };

  }catch(e){

    recordFailure();

    trackEvent('system_sync_error',e);

    throw e;

  }

}

/* =========================================================
   GLOBAL STATE SNAPSHOT
========================================================= */

function getSnapshot(){

  return {

    route:
      appState.route,

    metrics:
      db.metrics,

    runtime:
      runtimeMetrics,

    health:
      healthCheck,

    circuit:
      circuitBreaker,

  };

}

/* =========================================================
   FULL APP RESET
========================================================= */

function hardReset(){

  localStorage.clear();

  cache.clear();

  resetCircuit();

  runtimeMetrics.renderCount = 0;

  runtimeMetrics.apiCalls = 0;

  runtimeMetrics.errors = 0;

  toast(

    'System reset completed',

    'warning'

  );

  setRoute('overview');

}

/* =========================================================
   AUTO DIAGNOSTIC LOOP
========================================================= */

setInterval(() => {

  const issues =
    checkServices();

  if(issues.length){

    trackEvent('service_failure',issues);

    toast(

      'Service degradation detected',

      'danger'

    );

  }

}, 20000);

/* =========================================================
   PERFORMANCE TUNER
========================================================= */

function autoTune(){

  if(runtimeMetrics.renderCount > 1000){

    enablePerformanceMode();

  }

  if(db.metrics.mrr > 50000){

    orchestrator.mode = 'growth';

  }

}

/* =========================================================
   AUTO TUNING LOOP
========================================================= */

setInterval(autoTune, 15000);

/* =========================================================
   FINAL SAFE WRAPPER
========================================================= */

function finalSafeRender(){

  try{

    performanceGuard();

    safeRender();

  }catch(e){

    recordFailure();

    recoverUI();

  }

}

/* =========================================================
   MASTER BOOT FINAL OVERRIDE
========================================================= */

const previousFinal =
  finalBootSequence;

finalBootSequence = function(){

  orchestrator.initialized = true;

  previousFinal();

  systemSync();

  trackEvent('system_boot_complete');

  console.log(

    '%cFLOWPOINT ORCHESTRATOR ACTIVE',

    'color:#2f5bff;font-weight:bold;'

  );

};

/* =========================================================
   GLOBAL CONTROL EXPORT
========================================================= */

window.FlowPointCoreV2 = {

  orchestrator,

  systemSync,

  getSnapshot,

  hardReset,

  finalSafeRender,

};

/* =========================================================
   END ORCHESTRATOR
========================================================= */
