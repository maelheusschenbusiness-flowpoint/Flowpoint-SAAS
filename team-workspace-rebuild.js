(() => {
  "use strict";

  const TEAM_V2_KEY = "fp_team_workspace_v2";
  const root = () => document.getElementById("fpPageContainer");
  const getHash = () => (location.hash || "#overview").toLowerCase();
  const esc = (v) => String(v || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const uid = (p = "id") => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const load = () => {
    try { return JSON.parse(localStorage.getItem(TEAM_V2_KEY)) || null; }
    catch { return null; }
  };
  const save = (v) => localStorage.setItem(TEAM_V2_KEY, JSON.stringify(v));

  function fmtDate(ts) {
    try {
      return new Date(ts).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch {
      return "Récemment";
    }
  }

  function shortDate(ts) {
    try {
      return new Date(ts).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
    } catch {
      return "—";
    }
  }

  function seed() {
    const now = Date.now();
    return {
      tab: "chat",
      filter: "all",
      currentChannel: "general",
      channels: [
        { id: "general", name: "general", private: false, desc: "Annonces, coordination et décisions visibles par toute l’équipe.", purpose: "Garder le pilotage général propre." },
        { id: "seo", name: "seo", private: false, desc: "Quick wins, contenus, pages locales et arbitrages SEO.", purpose: "Transformer les audits en actions concrètes." },
        { id: "dev", name: "dev", private: false, desc: "Bugs, stabilité, intégrations et sujets techniques.", purpose: "Accélérer les correctifs et l’exécution." },
        { id: "planning", name: "planning", private: true, desc: "Planning, charge et coordination interne.", purpose: "Suivre les deadlines et répartitions." }
      ],
      messages: [
        { id: uid("m"), c: "general", a: "FlowPoint", role: "system", t: "Workspace lancé. Le canal général sert aux arbitrages et annonces majeures.", d: now - 3600 * 1000, attachments: [] },
        { id: uid("m"), c: "general", a: "Maël", role: "owner", t: "On repart proprement : chat d’abord, puis calendrier, notes, membres et activité.", d: now - 3200 * 1000, attachments: [] },
        { id: uid("m"), c: "general", a: "SEO Manager", role: "manager", t: "Je prépare la liste des quick wins à remonter dans #seo pour qu’on transforme ça en actions prioritaires.", d: now - 2500 * 1000, attachments: [{ name: "quick-wins-sprint.docx", type: "DOC", size: "420 KB" }] },
        { id: uid("m"), c: "seo", a: "SEO Manager", role: "manager", t: "Pages locales à prioriser cette semaine : Bruxelles, Liège et Verviers. On peut aussi corriger les titles avant la fin de journée.", d: now - 1800 * 1000, attachments: [] },
        { id: uid("m"), c: "dev", a: "Tech Ops", role: "editor", t: "La stabilité du dashboard s’améliore. Prochaine étape : vraie UX clean page par page, sans patchs visuels inutiles.", d: now - 1200 * 1000, attachments: [{ name: "stability-checklist.pdf", type: "PDF", size: "1.1 MB" }] }
      ],
      notes: [
        { id: uid("n"), title: "Playbook équipe", text: "Canal général = annonces. SEO = quick wins. Dev = technique. Planning = deadlines.", pinned: true, d: now - 5000 * 1000 }
      ],
      members: [
        { id: "m1", name: "Maël", role: "Owner", title: "Direction produit", status: "online", initials: "MH" },
        { id: "m2", name: "SEO Manager", role: "Manager", title: "Lead SEO", status: "online", initials: "SM" },
        { id: "m3", name: "Tech Ops", role: "Editor", title: "Ops & stabilité", status: "offline", initials: "TO" }
      ],
      docs: [
        { id: uid("d"), c: "general", name: "guide-workspace.pdf", type: "PDF", size: "1.2 MB", by: "FlowPoint", d: now - 7200 * 1000 },
        { id: uid("d"), c: "general", name: "sprint-priorities.docx", type: "DOC", size: "540 KB", by: "Maël", d: now - 5100 * 1000 },
        { id: uid("d"), c: "seo", name: "local-seo-opportunities.xlsx", type: "XLS", size: "880 KB", by: "SEO Manager", d: now - 4200 * 1000 }
      ],
      events: [],
      activity: [
        { id: uid("a"), type: "message", title: "Message posté dans #general", text: "Maël a annoncé la refonte propre du workspace équipe.", d: now - 3300 * 1000 },
        { id: uid("a"), type: "doc", title: "Document ajouté", text: "guide-workspace.pdf disponible dans #general.", d: now - 7200 * 1000 },
        { id: uid("a"), type: "member", title: "Membre actif", text: "SEO Manager est actuellement en ligne.", d: now - 900 * 1000 }
      ],
      pendingFiles: []
    };
  }

  function getState() {
    const s = load();
    if (!s) {
      const n = seed();
      save(n);
      return n;
    }
    return s;
  }

  function currentChannel(s) {
    return s.channels.find((c) => c.id === s.currentChannel) || s.channels[0];
  }

  function channelMessages(s) {
    return s.messages.filter((m) => m.c === s.currentChannel).sort((a, b) => a.d - b.d);
  }

  function channelDocs(s) {
    return s.docs.filter((d) => d.c === s.currentChannel).sort((a, b) => b.d - a.d).slice(0, 6);
  }

  function analytics(s) {
    const channelMsgs = channelMessages(s);
    const docs = channelDocs(s);
    const msgs7d = s.messages.filter((m) => Date.now() - m.d < 7 * 86400000).length;
    const online = s.members.filter((m) => m.status === "online").length;
    const todayMsgs = s.messages.filter((m) => new Date(m.d).toDateString() === new Date().toDateString()).length;
    const activeName = currentChannel(s)?.name || "general";
    return { msgs7d, online, todayMsgs, docs: docs.length, channelMsgs: channelMsgs.length, activeName };
  }

  function addActivity(s, type, title, text) {
    s.activity.unshift({ id: uid("a"), type, title, text, d: Date.now() });
    s.activity = s.activity.slice(0, 24);
  }

  function hero(s, a) {
    return `
      <div class="fpTeamV2Hero">
        <div>
          <div class="fpTeamV2SectionKicker">Équipe</div>
          <div class="fpTeamV2HeroTitle">Workspace</div>
          <div class="fpTeamV2HeroText">Hub complet : chat, calendrier, notes, membres et activité. On reconstruit page par page, proprement, et on commence par un chat de travail vraiment utilisable.</div>
          <div class="fpTeamV2HeroMeta">
            <div class="fpTeamV2MetaPill"><span class="fpTeamV2Dot"></span>${a.online} en ligne</div>
            <div class="fpTeamV2MetaPill">${a.msgs7d} messages / 7j</div>
            <div class="fpTeamV2MetaPill">Canal actif : #${esc(a.activeName)}</div>
          </div>
        </div>
        <div class="fpTeamV2HeroRight">
          <div class="fpTeamV2ActionGrid">
            <button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-open="message">Nouveau message</button>
            <button class="fpTeamV2Btn fpTeamV2BtnGhost" data-open="channel">Nouveau canal</button>
            <button class="fpTeamV2Btn fpTeamV2BtnGhost" data-open="note">Nouvelle note</button>
            <button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-open="visio">Lancer une visio</button>
          </div>
          <div class="fpTeamV2InsightGrid">
            <div class="fpTeamV2Insight"><strong>Ce qui compte</strong><span>Le chat doit servir à piloter, décider et faire remonter les pièces importantes sans noyer le reste du workspace.</span></div>
            <div class="fpTeamV2Insight"><strong>Étape actuelle</strong><span>On refait d’abord Canaux & chat. Les autres onglets suivront avec le même niveau de finition.</span></div>
          </div>
        </div>
      </div>
    `;
  }

  function tabs(s) {
    const labels = { chat: "Canaux & chat", calendar: "Calendrier", notes: "Notes", members: "Membres", activity: "Activité" };
    return `
      <div class="fpTeamV2Tabs">
        ${Object.entries(labels).map(([k, label]) => `<button class="fpTeamV2Tab ${s.tab === k ? "active" : ""}" data-tab="${k}">${label}</button>`).join("")}
      </div>
    `;
  }

  function kpis(s, a) {
    return `
      <div class="fpTeamV2Kpis">
        <div class="fpTeamV2Kpi"><span>Messages aujourd’hui</span><strong>${a.todayMsgs}</strong><small>Conversations postées dans le workspace aujourd’hui</small></div>
        <div class="fpTeamV2Kpi"><span>Canal actif</span><strong>${a.channelMsgs}</strong><small>Messages visibles dans #${esc(a.activeName)}</small></div>
        <div class="fpTeamV2Kpi"><span>Docs liés</span><strong>${a.docs}</strong><small>Documents récents visibles dans la colonne de contexte</small></div>
        <div class="fpTeamV2Kpi"><span>Membres en ligne</span><strong>${a.online}</strong><small>Disponibles pour répondre ou exécuter</small></div>
      </div>
    `;
  }

  function renderChat(s) {
    const ch = currentChannel(s);
    const msgs = channelMessages(s);
    const docs = channelDocs(s);
    const tips = {
      general: [
        "Utilise #general pour les annonces, arbitrages et décisions visibles par toute l’équipe.",
        "Évite d’y enterrer des détails trop techniques. Renvoie les sujets précis vers les bons canaux.",
        "Garde les messages les plus importants lisibles et accompagnés des bons documents."
      ],
      seo: [
        "Centralise ici les quick wins, pages locales, titles et recommandations exploitables.",
        "Chaque message SEO doit idéalement déboucher sur une action ou une note exploitable.",
        "Ajoute les exports ou documents utiles pour garder une mémoire propre."
      ],
      dev: [
        "Regroupe ici les bugs, chantiers techniques et points de stabilité.",
        "Écris le contexte, l’impact et le statut pour accélérer l’exécution.",
        "Ajoute une trace quand un correctif est vérifié ou déployé."
      ],
      planning: [
        "Planning sert aux deadlines, répartitions et charge d’exécution.",
        "Lie ce canal au calendrier et aux membres pour mieux piloter la semaine.",
        "Documente les arbitrages d’organisation au même endroit."
      ]
    };
    const tipList = tips[ch.id] || tips.general;

    return `
      <div class="fpTeamV2GridChat">
        <div class="fpTeamV2Panel">
          <div class="fpTeamV2SectionKicker">Canaux</div>
          <div class="fpTeamV2SectionText">Canaux organisés pour éviter le bruit, structurer les sujets et relier les échanges aux documents utiles.</div>
          <div class="fpTeamV2ChannelList">
            ${s.channels.map((c) => `
              <button class="fpTeamV2ChannelBtn ${c.id === s.currentChannel ? "active" : ""}" data-channel="${c.id}">
                <div class="fpTeamV2ChannelLeft">
                  <span class="fpTeamV2Hash">#</span>
                  <div>
                    <div class="fpTeamV2ChannelName">${esc(c.name)}</div>
                    <div class="fpTeamV2ChannelMeta">${esc(c.desc)}</div>
                  </div>
                </div>
                ${c.private ? `<span class="fpTeamV2Lock">Privé</span>` : ``}
              </button>
            `).join("")}
          </div>
          <div class="fpTeamV2SidebarCard" style="margin-top:16px;">
            <strong>Conseils du canal</strong>
            <div class="fpTeamV2MiniList">
              ${tipList.map((t) => `<div class="fpTeamV2MiniCard"><strong>Bon réflexe</strong><span>${esc(t)}</span></div>`).join("")}
            </div>
          </div>
        </div>

        <div class="fpTeamV2Panel">
          <div class="fpTeamV2Header">
            <div>
              <div class="fpTeamV2SectionKicker">Canal actif</div>
              <div class="fpTeamV2SectionTitle">#${esc(ch.name)}</div>
              <div class="fpTeamV2SectionText">${esc(ch.desc)} ${esc(ch.purpose || "")}</div>
            </div>
            <div class="fpTeamV2Status ${s.members.some((m) => m.status === "online") ? "online" : "offline"}">${s.members.filter((m) => m.status === "online").length} en ligne</div>
            <div class="fpTeamV2HeaderActions">
              <button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-open="visio">Lancer une visio</button>
            </div>
          </div>

          <div class="fpTeamV2ChannelHero">
            <div class="fpTeamV2ChannelHeroText">Le chat doit servir à décider, exécuter et conserver les échanges importants. Les documents récents et l’activité de contexte restent visibles à droite pour éviter de perdre l’information.</div>
            <div class="fpTeamV2TopActions">
              <span class="fpTeamV2Badge">${msgs.length} messages</span>
              <span class="fpTeamV2Badge">${docs.length} documents</span>
            </div>
          </div>

          <div class="fpTeamV2MessagesWrap">
            <div>
              <div class="fpTeamV2Messages">
                ${msgs.length ? msgs.map((m) => `
                  <article class="fpTeamV2Message">
                    <div class="fpTeamV2Avatar">${esc((m.a || "U").slice(0, 1).toUpperCase())}</div>
                    <div>
                      <div class="fpTeamV2MessageTop">
                        <strong>${esc(m.a)}</strong>
                        <span class="fpTeamV2MessageMeta">${esc(m.role || "member")}</span>
                        <span class="fpTeamV2MessageMeta">${esc(fmtDate(m.d))}</span>
                      </div>
                      <div class="fpTeamV2MessageText">${esc(m.t)}</div>
                      ${m.attachments && m.attachments.length ? `
                        <div class="fpTeamV2Attachments">
                          ${m.attachments.map((f) => `
                            <div class="fpTeamV2Attachment">
                              <div class="fpTeamV2Hash">${esc((f.type || "F").slice(0, 1))}</div>
                              <div>
                                <strong>${esc(f.name)}</strong>
                                <span>${esc(f.type || "DOC")} · ${esc(f.size || "Pièce jointe")}</span>
                              </div>
                            </div>
                          `).join("")}
                        </div>
                      ` : ``}
                    </div>
                  </article>
                `).join("") : `<div class="fpTeamV2Empty">Aucun message dans ce canal.</div>`}
              </div>

              <div class="fpTeamV2Composer">
                <div class="fpTeamV2SectionKicker">Nouveau message</div>
                <div class="fpTeamV2SectionText">Fil scrollable, saisie claire, docs liés et actions de contexte visibles sans allonger la page.</div>
                <div class="fpTeamV2ComposerGrid">
                  <div>
                    <textarea id="fpTeamV2MessageInput" class="fpTeamV2Textarea" placeholder="Écris un message utile, une décision, une consigne ou un suivi précis..."></textarea>
                    <div id="fpTeamV2PendingFiles" class="fpTeamV2PendingFiles"></div>
                  </div>
                  <div class="fpTeamV2Stack">
                    <button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-send="message">Envoyer</button>
                    <button class="fpTeamV2Btn fpTeamV2BtnGhost" data-open="attach">Joindre un document</button>
                    <button class="fpTeamV2Btn fpTeamV2BtnGhost" data-tab-jump="activity">Voir l’activité</button>
                    <button class="fpTeamV2Btn fpTeamV2BtnGhost" data-tab-jump="calendar">Voir le calendrier</button>
                    <input type="file" id="fpTeamV2FileInput" hidden multiple />
                  </div>
                </div>
              </div>
            </div>

            <div class="fpTeamV2Stack">
              <div class="fpTeamV2SidebarCard">
                <strong>Documents du canal</strong>
                <span>Pièces utiles pour éviter de perdre les briefs et exports importants.</span>
                <div class="fpTeamV2DocList">
                  ${docs.length ? docs.map((d) => `
                    <div class="fpTeamV2DocItem">
                      <strong>${esc(d.name)}</strong>
                      <span>${esc(d.type)} · ${esc(d.size)} · ${esc(d.by)} · ${esc(shortDate(d.d))}</span>
                    </div>
                  `).join("") : `<div class="fpTeamV2Empty">Aucun document récent dans ce canal.</div>`}
                </div>
              </div>

              <div class="fpTeamV2SidebarCard">
                <strong>Activité récente</strong>
                <span>Flux compact des dernières actions liées au workspace.</span>
                <div class="fpTeamV2ActivityCards">
                  ${s.activity.slice(0, 5).map((it) => `
                    <div class="fpTeamV2MiniCard">
                      <strong>${esc(it.title)}</strong>
                      <span>${esc(it.text)} · ${esc(shortDate(it.d))}</span>
                    </div>
                  `).join("")}
                </div>
              </div>

              <div class="fpTeamV2SidebarCard">
                <strong>Analytics du canal</strong>
                <span>Lecture rapide du niveau d’usage et du contexte du canal actif.</span>
                <div class="fpTeamV2InfoGrid" style="margin-top:12px;">
                  <div class="fpTeamV2Stat"><span>Messages</span><strong>${msgs.length}</strong></div>
                  <div class="fpTeamV2Stat"><span>Docs</span><strong>${docs.length}</strong></div>
                  <div class="fpTeamV2Stat"><span>Actifs</span><strong>${s.members.filter((m) => m.status === "online").length}</strong></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="fpTeamV2Panel">
          <div class="fpTeamV2SectionKicker">Vue manager</div>
          <div class="fpTeamV2SectionText">Un résumé rapide du canal pour savoir ce qui se passe sans tout lire.</div>
          <div class="fpTeamV2MiniList">
            <div class="fpTeamV2MiniCard"><strong>Focus actuel</strong><span>#${esc(ch.name)} concentre ${msgs.length} message(s) et ${docs.length} document(s) visibles.</span></div>
            <div class="fpTeamV2MiniCard"><strong>Dernier message utile</strong><span>${msgs.length ? esc(msgs[msgs.length - 1].t.slice(0, 90)) : "Aucun message récent"}</span></div>
            <div class="fpTeamV2MiniCard"><strong>Recommandation</strong><span>Le chat doit rester actionnable : annonce, décision, pièce jointe ou consigne claire.</span></div>
          </div>
        </div>
      </div>
    `;
  }

  function renderPlaceholder(title, text) {
    return `<div class="fpTeamV2Panel"><div class="fpTeamV2SectionKicker">En reconstruction</div><div class="fpTeamV2SectionTitle">${title}</div><div class="fpTeamV2SectionText">${text}</div></div>`;
  }

  function renderActivity(s) {
    const counts = {
      msg: s.activity.filter((x) => x.type === "message").length,
      doc: s.activity.filter((x) => x.type === "doc").length,
      member: s.activity.filter((x) => x.type === "member").length
    };
    return `
      <div class="fpTeamV2ActivityLayout">
        <div class="fpTeamV2Panel">
          <div class="fpTeamV2SectionKicker">Activité</div>
          <div class="fpTeamV2SectionTitle">Timeline du workspace</div>
          <div class="fpTeamV2SectionText">Vue vivante des actions récentes pour donner du contexte au produit et à l’équipe.</div>
          <div class="fpTeamV2FeedList">
            ${s.activity.length ? s.activity.map((it) => `
              <div class="fpTeamV2FeedItem">
                <div class="fpTeamV2FeedIcon">${it.type === "doc" ? "📄" : it.type === "member" ? "👤" : "💬"}</div>
                <div>
                  <strong>${esc(it.title)}</strong>
                  <span>${esc(it.text)}</span>
                </div>
                <div class="fpTeamV2FeedMeta">${esc(shortDate(it.d))}</div>
              </div>
            `).join("") : `<div class="fpTeamV2Empty">Aucune activité enregistrée.</div>`}
          </div>
        </div>
        <div class="fpTeamV2SidebarCard">
          <strong>Analytics rapides</strong>
          <div class="fpTeamV2Kpis" style="margin-top:14px;">
            <div class="fpTeamV2Kpi"><span>Messages</span><strong>${counts.msg}</strong><small>Éléments conversationnels</small></div>
            <div class="fpTeamV2Kpi"><span>Docs</span><strong>${counts.doc}</strong><small>Ajouts de fichiers</small></div>
            <div class="fpTeamV2Kpi"><span>Membres</span><strong>${counts.member}</strong><small>Présence ou actions liées aux profils</small></div>
            <div class="fpTeamV2Kpi"><span>Canaux</span><strong>${s.channels.length}</strong><small>Espaces de travail disponibles</small></div>
          </div>
        </div>
      </div>
    `;
  }

  function renderTab(s) {
    if (s.tab === "chat") return renderChat(s);
    if (s.tab === "calendar") return renderPlaceholder("Calendrier", "Le calendrier sera la prochaine page refaite proprement dans cette nouvelle base, avec vraie navigation et panneau du jour en haut.");
    if (s.tab === "notes") return renderPlaceholder("Notes", "Les notes seront reconstruites avec plus de contenu, de vraies actions et une mise en page premium exploitable.");
    if (s.tab === "members") return renderPlaceholder("Membres", "Les membres seront reconstruits avec cartes propres, activité, charge, rôles et meilleure structure visuelle.");
    if (s.tab === "activity") return renderActivity(s);
    return "";
  }

  function openModal(kind) {
    let overlay = document.getElementById("fpTeamV2Modal");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "fpTeamV2Modal";
      overlay.className = "fpTeamV2ModalOverlay";
      overlay.innerHTML = `<div class="fpTeamV2ModalWrap"><div class="fpTeamV2ModalCard"></div></div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("show"); });
    }
    const card = overlay.querySelector(".fpTeamV2ModalCard");
    const titles = {
      message: ["Nouveau message", "Prépare un message utile dans le canal actif."],
      channel: ["Nouveau canal", "Crée un canal propre avec une utilité claire."],
      note: ["Nouvelle note", "Prépare une note qui sera enrichie dans la prochaine étape."],
      visio: ["Lancer une visio", "La room Jitsi s’ouvrira immédiatement dans un nouvel onglet."],
      attach: ["Joindre un document", "Ajoute un document à ton prochain message dans le canal actif."]
    };
    const [title, text] = titles[kind] || ["Action", "Action du workspace."];

    if (kind === "visio") {
      const s = getState();
      const ch = currentChannel(s).name;
      const room = `flowpoint-${(document.getElementById("fpAccOrg")?.textContent || "team").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${ch}`;
      window.open(`https://meet.jit.si/${encodeURIComponent(room)}`, "_blank", "noopener,noreferrer");
      addActivity(s, "message", "Visio ouverte", `Une visio a été lancée depuis #${ch}.`);
      save(s);
      render();
      return;
    }

    card.innerHTML = `
      <div class="fpTeamV2ModalHead">
        <div>
          <div class="fpTeamV2SectionKicker">Workspace</div>
          <div class="fpTeamV2ModalTitle">${esc(title)}</div>
          <div class="fpTeamV2ModalText">${esc(text)}</div>
        </div>
        <button class="fpTeamV2ModalClose" type="button">×</button>
      </div>
      ${kind === "message" ? `
        <form class="fpTeamV2ModalForm" data-form="message">
          <label class="fpTeamV2Field"><span class="fpTeamV2Label">Contenu</span><textarea class="fpTeamV2Textarea" name="content" placeholder="Écris un message clair et utile..."></textarea></label>
          <div class="fpTeamV2ModalActions">
            <button class="fpTeamV2Btn fpTeamV2BtnGhost" type="button" data-close>Annuler</button>
            <button class="fpTeamV2Btn fpTeamV2BtnPrimary" type="submit">Envoyer</button>
          </div>
        </form>
      ` : kind === "channel" ? `
        <form class="fpTeamV2ModalForm" data-form="channel">
          <label class="fpTeamV2Field"><span class="fpTeamV2Label">Nom du canal</span><input class="fpTeamV2Input" name="name" placeholder="client-success"></label>
          <label class="fpTeamV2Field"><span class="fpTeamV2Label">Description</span><textarea class="fpTeamV2Textarea" name="desc" placeholder="Canal dédié à..."></textarea></label>
          <div class="fpTeamV2Check"><input type="checkbox" name="private"> <span>Canal privé</span></div>
          <div class="fpTeamV2ModalActions">
            <button class="fpTeamV2Btn fpTeamV2BtnGhost" type="button" data-close>Annuler</button>
            <button class="fpTeamV2Btn fpTeamV2BtnPrimary" type="submit">Créer</button>
          </div>
        </form>
      ` : kind === "note" ? `
        <form class="fpTeamV2ModalForm" data-form="note">
          <label class="fpTeamV2Field"><span class="fpTeamV2Label">Titre</span><input class="fpTeamV2Input" name="title" placeholder="Nouvelle note"></label>
          <label class="fpTeamV2Field"><span class="fpTeamV2Label">Contenu</span><textarea class="fpTeamV2Textarea" name="content" placeholder="Contenu de la note..."></textarea></label>
          <div class="fpTeamV2ModalActions">
            <button class="fpTeamV2Btn fpTeamV2BtnGhost" type="button" data-close>Annuler</button>
            <button class="fpTeamV2Btn fpTeamV2BtnPrimary" type="submit">Créer</button>
          </div>
        </form>
      ` : `
        <div class="fpTeamV2ModalForm">
          <label class="fpTeamV2Field"><span class="fpTeamV2Label">Document</span><input id="fpTeamV2AttachModalInput" type="file" class="fpTeamV2Input"></label>
          <div class="fpTeamV2ModalActions">
            <button class="fpTeamV2Btn fpTeamV2BtnGhost" type="button" data-close>Fermer</button>
          </div>
        </div>
      `}
    `;
    overlay.classList.add("show");
    card.querySelector(".fpTeamV2ModalClose")?.addEventListener("click", () => overlay.classList.remove("show"));
    card.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => overlay.classList.remove("show")));

    const form = card.querySelector("form[data-form='message']");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const content = form.querySelector("textarea[name='content']").value.trim();
        if (!content) return;
        const s = getState();
        s.messages.push({ id: uid("m"), c: s.currentChannel, a: document.getElementById("fpAccOrg")?.textContent?.trim() || "Vous", role: "owner", t: content, d: Date.now(), attachments: [] });
        addActivity(s, "message", `Message posté dans #${currentChannel(s).name}`, content.slice(0, 90));
        save(s);
        overlay.classList.remove("show");
        render();
      });
    }
    const chForm = card.querySelector("form[data-form='channel']");
    if (chForm) {
      chForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const name = chForm.querySelector("input[name='name']").value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-");
        const desc = chForm.querySelector("textarea[name='desc']").value.trim();
        const priv = chForm.querySelector("input[name='private']").checked;
        if (!name) return;
        const s = getState();
        s.channels.unshift({ id: uid("c"), name, private: priv, desc: desc || "Nouveau canal du workspace.", purpose: "Coordination spécifique." });
        s.currentChannel = s.channels[0].id;
        addActivity(s, "message", `Canal #${name} créé`, priv ? "Canal privé ajouté au workspace." : "Canal public ajouté au workspace.");
        save(s);
        overlay.classList.remove("show");
        render();
      });
    }
    const noteForm = card.querySelector("form[data-form='note']");
    if (noteForm) {
      noteForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const title = noteForm.querySelector("input[name='title']").value.trim();
        const content = noteForm.querySelector("textarea[name='content']").value.trim();
        if (!title) return;
        const s = getState();
        s.notes.unshift({ id: uid("n"), title, text: content, pinned: false, d: Date.now() });
        addActivity(s, "doc", "Note créée", title);
        save(s);
        overlay.classList.remove("show");
        render();
      });
    }
    const attachInput = card.querySelector("#fpTeamV2AttachModalInput");
    if (attachInput) {
      attachInput.addEventListener("change", () => {
        const file = attachInput.files?.[0];
        if (!file) return;
        const s = getState();
        s.docs.unshift({ id: uid("d"), c: s.currentChannel, name: file.name, type: (file.name.split(".").pop() || "DOC").toUpperCase(), size: file.size > 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`, by: document.getElementById("fpAccOrg")?.textContent?.trim() || "Vous", d: Date.now() });
        addActivity(s, "doc", "Document ajouté", file.name);
        save(s);
        overlay.classList.remove("show");
        render();
      });
    }
  }

  function bind() {
    document.querySelectorAll("[data-tab]").forEach((b) => {
      b.onclick = () => {
        const s = getState();
        s.tab = b.dataset.tab;
        save(s);
        render();
      };
    });

    document.querySelectorAll("[data-channel]").forEach((b) => {
      b.onclick = () => {
        const s = getState();
        s.currentChannel = b.dataset.channel;
        addActivity(s, "message", `Canal ouvert`, `Le canal #${currentChannel(s).name} a été consulté.`);
        save(s);
        render();
      };
    });

    document.querySelectorAll("[data-open]").forEach((b) => {
      b.onclick = () => openModal(b.dataset.open);
    });

    document.querySelectorAll("[data-tab-jump]").forEach((b) => {
      b.onclick = () => {
        const s = getState();
        s.tab = b.dataset.tabJump;
        save(s);
        render();
      };
    });

    document.querySelector("[data-send='message']")?.addEventListener("click", () => {
      const input = document.getElementById("fpTeamV2MessageInput");
      const content = input?.value?.trim();
      if (!content) return;
      const s = getState();
      s.messages.push({ id: uid("m"), c: s.currentChannel, a: document.getElementById("fpAccOrg")?.textContent?.trim() || "Vous", role: "owner", t: content, d: Date.now(), attachments: [] });
      addActivity(s, "message", `Message posté dans #${currentChannel(s).name}`, content.slice(0, 90));
      save(s);
      render();
    });

    const fileInput = document.getElementById("fpTeamV2FileInput");
    document.querySelector("[data-open='attach']")?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const s = getState();
      s.docs.unshift({ id: uid("d"), c: s.currentChannel, name: file.name, type: (file.name.split(".").pop() || "DOC").toUpperCase(), size: file.size > 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`, by: document.getElementById("fpAccOrg")?.textContent?.trim() || "Vous", d: Date.now() });
      addActivity(s, "doc", "Document ajouté", file.name);
      save(s);
      render();
    });
  }

  function render() {
    if (getHash() !== "#team") return;
    const s = getState();
    const a = analytics(s);
    const body = s.tab === "chat" ? renderChat(s) : renderTab(s);

    root().innerHTML = `
      <div class="fpTeamV2">
        ${hero(s, a)}
        ${kpis(s, a)}
        ${tabs(s)}
        <div class="fpTeamV2Body">${body}</div>
      </div>
    `;
    bind();
  }

  window.addEventListener("hashchange", () => setTimeout(render, 60));
  document.addEventListener("DOMContentLoaded", render);
})();
