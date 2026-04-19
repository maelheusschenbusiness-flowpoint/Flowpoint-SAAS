// PARTIE 3 — hero, kpis, tabs, analytics et rendu chat
(() => {
  "use strict";

  function getPlanRankLocal() {
    const plan = (document.getElementById("fpAccPlan")?.textContent || "standard").toLowerCase();
    if (plan.includes("ultra")) return 3;
    if (plan.includes("pro")) return 2;
    return 1;
  }

  function isProLocal() {
    return getPlanRankLocal() >= 2;
  }

  function isUltraLocal() {
    return getPlanRankLocal() >= 3;
  }

  function analyticsPart3(s) {
    const current = s.channels.find((c) => c.id === s.currentChannel) || s.channels[0];
    const msgs = s.messages.filter((m) => m.c === current.id);
    const docs = s.docs.filter((d) => d.c === current.id).slice(0, 6);
    const online = s.members.filter((m) => m.status === "online").length;
    const msgs7d = s.messages.filter((m) => Date.now() - m.d < 7 * 86400000).length;
    const eventsMonth = s.events.filter((e) => {
      const d = new Date(e.date);
      return d.getFullYear() === s.viewYear && d.getMonth() === s.viewMonth;
    }).length;

    return {
      online,
      msgs7d,
      channelMsgs: msgs.length,
      docs: docs.length,
      notes: s.notes.length,
      members: s.members.length,
      eventsMonth,
      activeName: current?.name || "general"
    };
  }

  function heroPart3(a) {
    return `
      <div class="fpTeamV2Hero">
        <div>
          <div class="fpTeamV2SectionKicker">Équipe</div>
          <div class="fpTeamV2HeroTitle">Workspace collaboration</div>
          <div class="fpTeamV2HeroText">
            Canaux, calendrier, notes, membres et activité dans une logique de hub équipe premium.
            On garde une exécution page par page, avec un vrai niveau SaaS propre et plus riche sur les offres supérieures.
          </div>
          <div class="fpTeamV2HeroMeta">
            <div class="fpTeamV2MetaPill"><span class="fpTeamV2Dot"></span>${a.online} en ligne</div>
            <div class="fpTeamV2MetaPill">${a.msgs7d} messages / 7j</div>
            <div class="fpTeamV2MetaPill">Canal actif : #${a.activeName}</div>
          </div>
        </div>

        <div class="fpTeamV2HeroRight">
          <div class="fpTeamV2ActionGrid">
            <button class="fpTeamV2Btn fpTeamV2BtnGhost" data-open="message">Nouveau message</button>
            <button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-open="channel">Nouveau canal</button>
            <button class="fpTeamV2Btn fpTeamV2BtnGhost" data-open="note">Nouvelle note</button>
            <button class="fpTeamV2Btn fpTeamV2BtnGhost" data-open="visio">Lancer une visio</button>
          </div>

          <div class="fpTeamV2InsightGrid">
            <div class="fpTeamV2Insight">
              <strong>Coordination</strong>
              <span>Le chat doit rester actionnable : annonces, décisions, documents ou consignes claires, sans noyer le reste.</span>
            </div>
            <div class="fpTeamV2Insight">
              <strong>Montée en gamme</strong>
              <span>
                ${isUltraLocal()
                  ? "Ultra débloque un pilotage plus analytique, plus d’assignation et plus de profondeur d’équipe."
                  : isProLocal()
                    ? "Pro débloque plus de structure, d’analytics et de confort de collaboration."
                    : "Le trial montre la logique du workspace. Les plans supérieurs débloquent plus de structure et d’analytics."}
              </span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function kpisPart3(s, a) {
    return `
      <div class="fpTeamV2Kpis">
        <div class="fpTeamV2Kpi">
          <span>Canaux</span>
          <strong>${s.channels.length}</strong>
          <small>Espaces de discussion actifs et séparés par fonction</small>
        </div>
        <div class="fpTeamV2Kpi">
          <span>Messages</span>
          <strong>${a.channelMsgs}</strong>
          <small>Historique visible dans le canal actif</small>
        </div>
        <div class="fpTeamV2Kpi">
          <span>Documents</span>
          <strong>${a.docs}</strong>
          <small>Fichiers récents liés au canal sélectionné</small>
        </div>
        <div class="fpTeamV2Kpi">
          <span>Événements</span>
          <strong>${a.eventsMonth}</strong>
          <small>Éléments enregistrés sur le mois affiché</small>
        </div>
      </div>
    `;
  }

  function tabsPart3(s) {
    const items = [
      ["chat", "Canaux & chat"],
      ["calendar", "Calendrier"],
      ["notes", "Notes"],
      ["members", "Membres"],
      ["activity", "Activité"]
    ];

    return `
      <div class="fpTeamV2Tabs">
        ${items.map(([k, label]) => `
          <button class="fpTeamV2Tab ${s.tab === k ? "active" : ""}" data-tab="${k}">${label}</button>
        `).join("")}
      </div>
    `;
  }

  function channelTipsPart3(channelId) {
    const tips = {
      general: [
        "Utilise #general pour les annonces, arbitrages et décisions visibles par toute l’équipe.",
        "Évite d’y enterrer des détails trop techniques. Renvoie les sujets précis vers les bons canaux.",
        "Garde les messages importants lisibles, courts et accompagnés des bons documents."
      ],
      seo: [
        "Centralise ici quick wins, pages locales et actions SEO exploitables.",
        "Chaque message SEO doit déboucher sur une action, une note ou un export utile.",
        "Ajoute les docs ou exports pour garder une mémoire d’équipe propre."
      ],
      dev: [
        "Regroupe ici bugs, chantiers techniques et points de stabilité.",
        "Écris toujours le contexte, l’impact et le statut pour aller plus vite.",
        "Ajoute une trace quand un correctif est vérifié ou déployé."
      ],
      planning: [
        "Planning sert aux deadlines, répartitions et charge d’exécution.",
        "Lie ce canal au calendrier pour suivre la semaine plus proprement.",
        "Documente les arbitrages d’organisation au même endroit."
      ],
      "client-success": [
        "Garde ici les suivis, relances et points sensibles liés au client.",
        "Lie les documents et décisions pour garder une vue claire du parcours client.",
        "Transforme chaque feedback en action ou prochaine étape visible."
      ]
    };

    return tips[channelId] || tips.general;
  }

  function renderChatPart3(s) {
    const ch = s.channels.find((c) => c.id === s.currentChannel) || s.channels[0];
    const msgs = s.messages.filter((m) => m.c === ch.id).sort((a, b) => a.d - b.d);
    const docs = s.docs.filter((d) => d.c === ch.id).sort((a, b) => b.d - a.d).slice(0, 6);
    const tips = channelTipsPart3(ch.id);

    return `
      <div class="fpTeamV2GridChat">

        <div class="fpTeamV2Panel">
          <div class="fpTeamV2SectionKicker">Canaux</div>
          <div class="fpTeamV2SectionText">Crée des salons propres, poste les bonnes informations et garde une lecture claire par sujet.</div>

          <div class="fpTeamV2ChannelList">
            ${s.channels.map((c) => `
              <button class="fpTeamV2ChannelBtn ${c.id === s.currentChannel ? "active" : ""}" data-channel="${c.id}">
                <div class="fpTeamV2ChannelLeft">
                  <span class="fpTeamV2Hash">#</span>
                  <div>
                    <div class="fpTeamV2ChannelName">${c.name}</div>
                    <div class="fpTeamV2ChannelMeta">${c.desc}</div>
                  </div>
                </div>
                ${c.private ? `<span class="fpTeamV2Lock">Privé</span>` : ""}
              </button>
            `).join("")}
          </div>

          <div class="fpTeamV2SidebarCard" style="margin-top:16px;">
            <strong>Conseils du canal</strong>
            <span>Trois bons réflexes pour garder ce canal propre et réellement utile au workspace.</span>
            <div class="fpTeamV2MiniList">
              ${tips.map((tip, index) => `
                <div class="fpTeamV2MiniCard">
                  <strong>${index === 0 ? "Décision" : index === 1 ? "Structure" : "Clarté"}</strong>
                  <span>${tip}</span>
                </div>
              `).join("")}
            </div>
          </div>
        </div>

        <div class="fpTeamV2Panel">
          <div class="fpTeamV2Header">
            <div>
              <div class="fpTeamV2SectionKicker">Canal actif</div>
              <div class="fpTeamV2SectionTitle">#${ch.name}</div>
              <div class="fpTeamV2SectionText">${ch.desc} ${ch.purpose || ""}</div>
            </div>

            <div class="fpTeamV2HeaderCenter">
              <div class="fpTeamV2Status ${s.members.some((m) => m.status === "online") ? "online" : "offline"}">
                ${s.members.filter((m) => m.status === "online").length} en ligne
              </div>
            </div>

            <div class="fpTeamV2HeaderActions">
              <button class="fpTeamV2Btn fpTeamV2BtnGhost fpTeamV2BtnWide" data-open="visio">Lancer une visio</button>
            </div>
          </div>

          <div class="fpTeamV2ChannelHero">
            <div class="fpTeamV2ChannelHeroText">
              Le chat sert à décider, exécuter et conserver les échanges importants.
              Les documents récents et l’activité de contexte restent visibles sans surcharger la lecture.
            </div>
            <div class="fpTeamV2TopActions">
              <span class="fpTeamV2Badge">${msgs.length} messages</span>
              <span class="fpTeamV2Badge">${docs.length} documents</span>
              <span class="fpTeamV2Badge">Sujet : ${ch.topic || "Coordination"}</span>
            </div>
          </div>

          <!-- suite chat dans partie 4 -->
          <div class="fpTeamV2Empty">Suite du rendu chat dans la partie 4.</div>
        </div>

        <div class="fpTeamV2Panel">
          <div class="fpTeamV2SectionKicker">Vue manager</div>
          <div class="fpTeamV2SectionText">Résumé rapide du canal pour savoir ce qui se passe sans tout lire.</div>
          <div class="fpTeamV2MiniList">
            <div class="fpTeamV2MiniCard">
              <strong>Focus actuel</strong>
              <span>#${ch.name} concentre ${msgs.length} message(s) et ${docs.length} document(s) visibles.</span>
            </div>
            <div class="fpTeamV2MiniCard">
              <strong>Dernier message utile</strong>
              <span>${msgs.length ? msgs[msgs.length - 1].t.slice(0, 90) : "Aucun message récent"}</span>
            </div>
            <div class="fpTeamV2MiniCard">
              <strong>Recommandation</strong>
              <span>Le chat doit rester actionnable : annonce, décision, pièce jointe ou consigne claire.</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // suite à venir dans la partie 4
})();
