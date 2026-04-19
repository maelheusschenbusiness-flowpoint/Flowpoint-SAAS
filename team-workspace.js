(() => {
  "use strict";

  const TEAM_STORE_KEY = "fp_team_workspace_v1";
  const NOTES_KEY = "fp_notes_items_v3";
  const CALENDAR_KEY = "fp_calendar_items_v3";
  const LEGACY_CHAT_KEY = "fp_chat_messages_v3";

  const pageContainer = () => document.getElementById("fpPageContainer");
  const getHash = () => (location.hash || "#overview").toLowerCase();

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function lower(v) {
    return String(v || "").toLowerCase();
  }

  function uid(prefix = "id") {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function formatDate(value) {
    if (!value) return "Récemment";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "Récemment";
    return d.toLocaleString("fr-FR");
  }

  function shortDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  }

  function timeOnly(value) {
    if (!value) return "09:00";
    const s = String(value);
    if (/^\d{2}:\d{2}$/.test(s)) return s;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "09:00";
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  function dateOnly(value) {
    if (!value) return new Date().toISOString().slice(0, 10);
    const s = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
    return d.toISOString().slice(0, 10);
  }

  function getStorageJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function setStorageJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  function buildInitialChannels() {
    return [
      { id: "general", name: "général", kind: "public", locked: false, description: "Canal principal du workspace", purpose: "Annonces, coordination, décisions et suivi global." },
      { id: "seo", name: "seo", kind: "public", locked: false, description: "Discussions SEO, contenus et quick wins", purpose: "Audits, priorités SEO, contenus et plan d’action organique." },
      { id: "dev", name: "dev", kind: "public", locked: false, description: "Bugs, intégrations et sujets techniques", purpose: "Stabilité, implémentation, correctifs et backlog technique." },
      { id: "planning", name: "planning", kind: "private", locked: true, description: "Organisation, calendrier et exécution", purpose: "Planning, deadlines, ressources et exécution opérationnelle." }
    ];
  }

  function buildInitialMessages() {
    const legacy = getStorageJson(LEGACY_CHAT_KEY, []);
    const mapped = Array.isArray(legacy)
      ? legacy.slice(-8).map((item, index) => ({
          id: `legacy_${index}_${Date.now()}`,
          channelId: "general",
          author: item.author || "Équipe",
          role: "member",
          text: item.text || "",
          createdAt: item.createdAt || new Date().toISOString(),
          attachments: []
        }))
      : [];

    const seed = [
      {
        id: "seed_1",
        channelId: "general",
        author: "FlowPoint",
        role: "system",
        text: "Workspace équipe activé. Tu peux discuter par canal, joindre des documents, suivre le planning et garder les notes au même endroit.",
        createdAt: new Date().toISOString(),
        attachments: []
      },
      {
        id: "seed_2",
        channelId: "seo",
        author: "Maël",
        role: "owner",
        text: "Priorité du jour : transformer les quick wins des audits en vraies actions et mieux répartir le travail par canal.",
        createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
        attachments: []
      },
      {
        id: "seed_3",
        channelId: "dev",
        author: "Tech Ops",
        role: "editor",
        text: "Le workspace est branché sur le dashboard. Prochaine étape : pousser encore plus loin la collaboration backend et la visio.",
        createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        attachments: []
      }
    ];

    return [...seed, ...mapped];
  }

  function buildInitialFiles() {
    return [
      {
        id: "file_seed_1",
        channelId: "general",
        name: "guide-workspace.pdf",
        sizeLabel: "1.2 MB",
        kind: "PDF",
        uploadedAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
        uploadedBy: "FlowPoint"
      },
      {
        id: "file_seed_2",
        channelId: "seo",
        name: "quick-wins-client.docx",
        sizeLabel: "480 KB",
        kind: "DOC",
        uploadedAt: new Date(Date.now() - 7 * 3600 * 1000).toISOString(),
        uploadedBy: "SEO Manager"
      }
    ];
  }

  function buildInitialMembers() {
    const org = document.getElementById("fpAccOrg")?.textContent?.trim() || "Workspace principal";
    const ownerRole = document.getElementById("fpAccRole")?.textContent?.trim() || "Owner";
    return [
      {
        id: "member_owner",
        name: org,
        title: "Owner & direction",
        role: ownerRole,
        status: "online",
        avatarUrl: "",
        initials: "FP",
        expertise: ["Pilotage", "Décision", "Vision"],
        bio: "Compte principal, accès complet au workspace et au pilotage du dashboard.",
        lastSeen: new Date().toISOString()
      },
      {
        id: "member_seo",
        name: "SEO Manager",
        title: "Lead SEO",
        role: "Manager",
        status: "online",
        avatarUrl: "",
        initials: "SM",
        expertise: ["SEO", "Quick wins", "Contenu"],
        bio: "Pilote audits, quick wins, recommandations et plan d’action SEO.",
        lastSeen: new Date(Date.now() - 5 * 60 * 1000).toISOString()
      },
      {
        id: "member_tech",
        name: "Tech Ops",
        title: "Ops & stabilité",
        role: "Editor",
        status: "offline",
        avatarUrl: "",
        initials: "TO",
        expertise: ["Monitoring", "Infra", "Exécution"],
        bio: "Suit la stabilité, les monitors, l’exécution technique et les incidents.",
        lastSeen: new Date(Date.now() - 80 * 60 * 1000).toISOString()
      }
    ];
  }

  function buildSeedNotes() {
    return [
      {
        id: "note_seed_1",
        title: "Playbook équipe",
        category: "Process",
        text: "Canal général pour les annonces et arbitrages. Canal SEO pour les quick wins et les contenus. Canal dev pour le technique et les incidents. Canal planning pour l’organisation et le calendrier.",
        pinned: true,
        updatedAt: new Date().toISOString()
      },
      {
        id: "note_seed_2",
        title: "Priorités semaine",
        category: "Sprint",
        text: "1. Transformer les quick wins SEO en missions concrètes.\n2. Mieux suivre les incidents monitors.\n3. Préparer un reporting plus premium pour les clients.",
        pinned: false,
        updatedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString()
      }
    ];
  }

  function buildSeedCalendar() {
    const today = new Date().toISOString().slice(0, 10);
    return [
      { id: "cal_seed_1", title: "Revue équipe", date: today, time: "09:30", type: "Réunion", description: "Point d’avancement général" },
      { id: "cal_seed_2", title: "Quick wins SEO", date: today, time: "14:00", type: "SEO", description: "Priorités et exécution" }
    ];
  }

  function getNotes() {
    const notes = getStorageJson(NOTES_KEY, []);
    if (Array.isArray(notes) && notes.length) return notes;
    const seeded = buildSeedNotes();
    setStorageJson(NOTES_KEY, seeded);
    return seeded;
  }

  function saveNotes(items) {
    setStorageJson(NOTES_KEY, items);
  }

  function getCalendarItems() {
    const items = getStorageJson(CALENDAR_KEY, []);
    if (Array.isArray(items) && items.length) return items;
    const seeded = buildSeedCalendar();
    setStorageJson(CALENDAR_KEY, seeded);
    return seeded;
  }

  function saveCalendarItems(items) {
    setStorageJson(CALENDAR_KEY, items);
  }

  function getWorkspace() {
    const current = getStorageJson(TEAM_STORE_KEY, null);
    const base = {
      currentTab: "chat",
      currentChannelId: "general",
      selectedNoteId: "",
      selectedDate: new Date().toISOString().slice(0, 10),
      channels: buildInitialChannels(),
      messages: buildInitialMessages(),
      files: buildInitialFiles(),
      members: buildInitialMembers(),
      activity: [
        { id: "act_1", title: "Workspace activé", text: "Le hub équipe a été initialisé dans le dashboard.", time: new Date().toISOString() },
        { id: "act_2", title: "Canaux prêts", text: "Les canaux général, seo, dev et planning sont disponibles.", time: new Date(Date.now() - 3600 * 1000).toISOString() }
      ]
    };

    if (current && typeof current === "object") {
      const merged = {
        ...base,
        ...current,
        channels: Array.isArray(current.channels) && current.channels.length ? current.channels : base.channels,
        messages: Array.isArray(current.messages) ? current.messages : base.messages,
        files: Array.isArray(current.files) ? current.files : base.files,
        members: Array.isArray(current.members) && current.members.length ? current.members : base.members,
        activity: Array.isArray(current.activity) && current.activity.length ? current.activity : base.activity
      };
      setStorageJson(TEAM_STORE_KEY, merged);
      return merged;
    }

    setStorageJson(TEAM_STORE_KEY, base);
    return base;
  }

  function saveWorkspace(next) {
    setStorageJson(TEAM_STORE_KEY, next);
  }

  function getCurrentChannel(workspace) {
    return workspace.channels.find((item) => item.id === workspace.currentChannelId) || workspace.channels[0];
  }

  function getMessagesForChannel(workspace, channelId) {
    return workspace.messages.filter((item) => item.channelId === channelId).slice(-60);
  }

  function getFilesForChannel(workspace, channelId) {
    return workspace.files.filter((item) => item.channelId === channelId).slice(-12).reverse();
  }

  function addActivity(workspace, title, text) {
    workspace.activity.unshift({ id: uid("act"), title, text, time: new Date().toISOString() });
    workspace.activity = workspace.activity.slice(0, 18);
  }

  function pickSelectedNote(workspace, notes) {
    const selected = notes.find((note) => note.id === workspace.selectedNoteId);
    return selected || notes[0] || null;
  }

  function eventTypeClass(type) {
    const t = lower(type);
    if (t.includes("seo") || t.includes("audit")) return "audit";
    if (t.includes("monitor") || t.includes("incident")) return "monitoring";
    if (t.includes("réunion") || t.includes("meeting")) return "custom";
    return "task";
  }

  function statusLabel(status) {
    return status === "online" ? "En ligne" : "Hors ligne";
  }

  function memberAvatar(member) {
    if (member.avatarUrl) {
      return `<img src="${esc(member.avatarUrl)}" alt="${esc(member.name)}" class="fpTeamMemberAvatarImg" />`;
    }
    return esc(member.initials || (member.name || "U").slice(0, 2).toUpperCase());
  }

  function getChannelTips(channel) {
    const map = {
      général: [
        "Utilise ce canal pour les annonces, arbitrages et décisions visibles par toute l’équipe.",
        "Épingle ici les messages de référence et les points d’avancement importants.",
        "Garde les sujets détaillés dans les canaux dédiés pour garder ce canal propre."
      ],
      seo: [
        "Convertis chaque quick win en action claire avec échéance et responsable.",
        "Partage ici les idées de contenu, SERP, concurrence et pages locales.",
        "Ajoute les exports ou captures utiles pour garder un historique propre."
      ],
      dev: [
        "Centralise les bugs, incidents, blocages d’intégration et corrections techniques.",
        "Documente le contexte et le niveau d’urgence pour accélérer l’exécution.",
        "Ajoute une note de sortie quand un fix est déployé ou vérifié."
      ],
      planning: [
        "Utilise ce canal pour les deadlines, répartitions, sprints et points de charge.",
        "Lie les messages aux événements du calendrier pour garder une vision claire.",
        "Archive les décisions d’organisation dans une note dédiée."
      ]
    };
    return map[channel.name] || [
      channel.purpose || "Canal dédié à un sujet précis du workspace.",
      "Garde ce canal focalisé pour éviter le bruit.",
      "Ajoute documents, décisions et points d’action au même endroit."
    ];
  }

  function buildCalendarMatrix(items) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1);
    const startWeekday = (firstDay.getDay() + 6) % 7;
    const firstVisible = new Date(year, month, 1 - startWeekday);
    const cells = [];

    for (let i = 0; i < 35; i += 1) {
      const date = new Date(firstVisible);
      date.setDate(firstVisible.getDate() + i);
      const iso = date.toISOString().slice(0, 10);
      cells.push({
        iso,
        day: date.getDate(),
        currentMonth: date.getMonth() === month,
        today: iso === new Date().toISOString().slice(0, 10),
        items: items.filter((item) => dateOnly(item.date) === iso).slice(0, 3)
      });
    }

    return {
      monthLabel: now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
      weekdays: ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"],
      cells
    };
  }

  function getDayAgenda(items, selectedDate) {
    return items
      .filter((item) => dateOnly(item.date) === selectedDate)
      .sort((a, b) => String(a.time || "09:00").localeCompare(String(b.time || "09:00")));
  }

  function getTimelineSlots() {
    return ["04:00", "05:00", "06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];
  }

  function renderKpis(workspace) {
    const online = workspace.members.filter((m) => m.status === "online").length;
    const files = workspace.files.length;
    return `
      <div class="fpTeamKpiGrid">
        <div class="fpTeamKpiCard"><span>Canaux</span><strong>${workspace.channels.length}</strong><small>Espaces de discussion actifs</small></div>
        <div class="fpTeamKpiCard"><span>Messages</span><strong>${workspace.messages.length}</strong><small>Historique workspace</small></div>
        <div class="fpTeamKpiCard"><span>En ligne</span><strong>${online}</strong><small>Membres actuellement disponibles</small></div>
        <div class="fpTeamKpiCard"><span>Documents</span><strong>${files}</strong><small>Fichiers liés aux canaux</small></div>
      </div>
    `;
  }

  function renderChatTab(workspace) {
    const channel = getCurrentChannel(workspace);
    const messages = getMessagesForChannel(workspace, channel.id);
    const files = getFilesForChannel(workspace, channel.id);
    const tips = getChannelTips(channel);

    return `
      <div class="fpTeamWorkspace fpTeamWorkspaceChat">
        <aside class="fpTeamPanel fpTeamSidePanel">
          <div class="fpCardKicker">Canaux</div>
          <div class="fpRowMeta">Discussion interne type workspace. Crée des salons, poste et organise les échanges.</div>
          <div class="fpTeamChannelList">
            ${workspace.channels.map((item) => `
              <button class="fpTeamChannel ${item.id === channel.id ? "active" : ""}" type="button" data-team-channel="${esc(item.id)}">
                <span>#</span>
                <span class="fpTeamChannelLabel">${esc(item.name)}</span>
                ${item.locked ? `<span class="fpAddonPill off">Privé</span>` : ``}
              </button>
            `).join("")}
          </div>
          <div class="fpTeamSidebarBlock">
            <div class="fpCardKicker">Conseils du canal</div>
            <div class="fpTeamTipList">
              ${tips.map((tip) => `<div class="fpTeamTipItem">${esc(tip)}</div>`).join("")}
            </div>
          </div>
        </aside>

        <section class="fpTeamPanel fpTeamChatPanelEnhanced">
          <div class="fpTeamHeader">
            <div>
              <div class="fpCardKicker">Canal actif</div>
              <div class="fpTeamChannelTitle">#${esc(channel.name)}</div>
              <div class="fpTeamChannelMeta">${esc(channel.description || "Canal équipe")} · ${esc(channel.purpose || "")}</div>
            </div>
            <div class="fpBadge up"><span class="fpBadgeDot"></span>En ligne</div>
          </div>

          <div class="fpTeamMessages fpTeamMessagesEnhanced">
            ${messages.length ? messages.map((item) => `
              <article class="fpTeamMessage ${item.role === "system" ? "system" : ""}">
                <div class="fpTeamAvatar">${esc((item.author || "U").slice(0, 1).toUpperCase())}</div>
                <div class="fpTeamMessageBody">
                  <div class="fpTeamMessageTop">
                    <strong>${esc(item.author || "Équipe")}</strong>
                    <span>${esc(item.role || "member")}</span>
                    <span>${esc(formatDate(item.createdAt))}</span>
                  </div>
                  <div class="fpTeamMessageText">${esc(item.text || "")}</div>
                  ${Array.isArray(item.attachments) && item.attachments.length ? `
                    <div class="fpTeamComposerFiles">
                      ${item.attachments.map((file) => `
                        <div class="fpTeamAttachment">
                          <div class="fpTeamAvatar">${esc((file.kind || "F").slice(0, 1))}</div>
                          <div>
                            <strong>${esc(file.name)}</strong>
                            <span>${esc(file.kind || "DOC")} · ${esc(file.sizeLabel || "Pièce jointe")}</span>
                          </div>
                        </div>
                      `).join("")}
                    </div>
                  ` : ``}
                </div>
              </article>
            `).join("") : `<div class="fpEmpty">Aucun message dans ce canal pour le moment.</div>`}
          </div>

          <div class="fpTeamComposer fpTeamComposerEnhanced">
            <div class="fpTeamComposerTopBar">
              <div class="fpTeamComposerLabel">Nouveau message</div>
              <div class="fpTeamComposerHint">Le fil reste scrollable sans agrandir la page.</div>
            </div>
            <div class="fpTeamComposerGrid fpTeamComposerGridWide">
              <textarea id="fpTeamMessageInput" class="fpTeamTextarea" placeholder="Écris un message, une note interne, une consigne ou un suivi..."></textarea>
              <div class="fpTeamActionColumn">
                <button class="fpBtn fpBtnPrimary" type="button" data-team-action="send-message">Envoyer</button>
                <button class="fpBtn fpBtnGhost" type="button" data-team-action="pick-file">Joindre un document</button>
                <input id="fpTeamFileInput" type="file" multiple hidden />
                <button class="fpBtn fpBtnGhost" type="button" data-team-action="open-calendar">Voir calendrier</button>
              </div>
            </div>
            <div id="fpTeamPendingFiles" class="fpTeamBadgeRow"></div>
          </div>
        </section>

        <aside class="fpTeamPanel fpTeamContextPanel">
          <div class="fpCardKicker">Documents du canal</div>
          <div class="fpRowMeta">Fichiers liés au canal actif. Idéal pour briefs, notes de passage et docs opérationnels.</div>
          <div class="fpTeamMiniList">
            ${files.length ? files.map((file) => `
              <div class="fpTeamFileCard">
                <div class="fpTeamAvatar">${esc((file.kind || "F").slice(0, 1))}</div>
                <div>
                  <strong>${esc(file.name)}</strong>
                  <span>${esc(file.kind || "DOC")} · ${esc(file.sizeLabel || "Document")} · ${esc(shortDate(file.uploadedAt))}</span>
                </div>
              </div>
            `).join("") : `<div class="fpEmpty">Aucun document dans ce canal.</div>`}
          </div>

          <div class="fpCardKicker" style="margin-top:18px">Activité récente</div>
          <div class="fpTeamActivityList">
            ${workspace.activity.slice(0, 7).map((item) => `
              <div class="fpTeamActivityRow">
                <strong>${esc(item.title)}</strong>
                <span>${esc(item.text)} · ${esc(shortDate(item.time))}</span>
              </div>
            `).join("")}
          </div>
        </aside>
      </div>
    `;
  }

  function renderCalendarTab(workspace) {
    const items = getCalendarItems().slice().sort((a, b) => `${dateOnly(a.date)} ${a.time || "09:00"}`.localeCompare(`${dateOnly(b.date)} ${b.time || "09:00"}`));
    const matrix = buildCalendarMatrix(items);
    const selectedDate = workspace.selectedDate || new Date().toISOString().slice(0, 10);
    const agenda = getDayAgenda(items, selectedDate);
    const prettyDate = new Date(selectedDate).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short", year: "numeric" });

    return `
      <div class="fpTeamShell">
        <div class="fpTeamHeroBar">
          <div>
            <div class="fpCardKicker">Calendrier workspace</div>
            <div class="fpSectionTitle" style="font-size:28px">${esc(matrix.monthLabel)}</div>
            <div class="fpCardText">Une vraie vue agenda type téléphone, pour noter audits, suivis, deadlines et tâches.</div>
          </div>
          <div class="fpDetailActions">
            <button class="fpBtn fpBtnPrimary" type="button" data-team-action="new-event">Nouvel événement</button>
          </div>
        </div>

        <div class="fpTeamCalendarSurface">
          <div class="fpTeamCalendarWeekdays">${matrix.weekdays.map((day) => `<div>${esc(day)}</div>`).join("")}</div>
          <div class="fpTeamCalendarGrid fpTeamCalendarGridLuxury">
            ${matrix.cells.map((cell) => `
              <button class="fpTeamCalendarCell fpTeamCalendarCellEnhanced ${cell.currentMonth ? "" : "muted"} ${cell.today ? "today" : ""} ${cell.iso === selectedDate ? "selected" : ""}" type="button" data-team-day="${esc(cell.iso)}">
                <div class="fpTeamCalendarTop">
                  <strong>${esc(cell.day)}</strong>
                  ${cell.items.length ? `<span class="fpTeamCalendarCount">${cell.items.length}</span>` : ``}
                </div>
                <div class="fpTeamCalendarPills">
                  ${cell.items.map((item) => `
                    <div class="fpTeamCalendarPill ${eventTypeClass(item.type)}">${esc(item.title)}</div>
                  `).join("")}
                </div>
              </button>
            `).join("")}
          </div>
        </div>

        <div class="fpTeamDayView">
          <div class="fpTeamDayViewHeader">
            <div>
              <div class="fpCardKicker">Jour sélectionné</div>
              <div class="fpTeamDayViewTitle">${esc(prettyDate)}</div>
            </div>
            <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-team-action="new-event-for-day">Ajouter sur ce jour</button>
          </div>
          <div class="fpTeamPhoneAgenda">
            ${getTimelineSlots().map((slot) => {
              const slotEvents = agenda.filter((event) => (event.time || "09:00") === slot);
              return `
                <div class="fpTeamPhoneSlot">
                  <div class="fpTeamPhoneTime">${esc(slot)}</div>
                  <div class="fpTeamPhoneContent">
                    ${slotEvents.length ? slotEvents.map((event) => `
                      <div class="fpTeamPhoneEvent ${eventTypeClass(event.type)}">
                        <strong>${esc(event.title)}</strong>
                        <span>${esc(event.type || "Tâche")} · ${esc(event.description || "Événement workspace")}</span>
                      </div>
                    `).join("") : `<div class="fpTeamPhoneEmpty"></div>`}
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      </div>
    `;
  }

  function renderNotesTab(workspace) {
    const notes = getNotes().slice().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const selected = pickSelectedNote(workspace, notes);
    const pinned = notes.filter((note) => note.pinned).length;

    return `
      <div class="fpTeamSplit fpTeamNotesLayout">
        <aside class="fpTeamPanel">
          <div class="fpCardKicker">Notes</div>
          <div class="fpTeamKpiGrid fpTeamKpiGridCompact">
            <div class="fpTeamKpiCard"><span>Total</span><strong>${notes.length}</strong><small>Notes disponibles</small></div>
            <div class="fpTeamKpiCard"><span>Pinned</span><strong>${pinned}</strong><small>Notes prioritaires</small></div>
          </div>
          <div class="fpTeamActionBar">
            <button class="fpBtn fpBtnPrimary fpBtnSmall" type="button" data-team-action="new-note">Créer une note</button>
            <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-team-action="new-template-note">Template</button>
          </div>
          <div class="fpTeamNotesList">
            ${notes.length ? notes.map((note) => `
              <button class="fpTeamNoteItem ${selected && note.id === selected.id ? "active" : ""}" type="button" data-team-note="${esc(note.id)}">
                <div class="fpTeamNoteTopRow">
                  <strong>${esc(note.title || "Nouvelle note")}</strong>
                  ${note.pinned ? `<span class="fpAddonPill on">Pinned</span>` : `<span class="fpAddonPill off">${esc(note.category || "Note")}</span>`}
                </div>
                <span>${esc((note.text || "").slice(0, 96) || "Note vide")} · ${esc(shortDate(note.updatedAt))}</span>
              </button>
            `).join("") : `<div class="fpEmpty">Aucune note disponible.</div>`}
          </div>
        </aside>

        <section class="fpTeamPanel">
          ${selected ? `
            <div class="fpTeamHeader">
              <div>
                <div class="fpCardKicker">Note active</div>
                <div class="fpTeamChannelTitle">${esc(selected.title || "Note")}</div>
                <div class="fpTeamChannelMeta">${esc(selected.category || "Note interne")} · Dernière mise à jour ${esc(formatDate(selected.updatedAt))}</div>
              </div>
              <div class="fpDetailActions">
                <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-team-action="toggle-pin-note" data-team-payload="${esc(selected.id)}">${selected.pinned ? "Unpin" : "Pin"}</button>
                <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-team-action="edit-note" data-team-payload="${esc(selected.id)}">Modifier</button>
                <button class="fpBtn fpBtnDanger fpBtnSmall" type="button" data-team-action="delete-note" data-team-payload="${esc(selected.id)}">Supprimer</button>
              </div>
            </div>
            <div class="fpTeamNoteMetaBar">
              <span class="fpTeamMetaChip">${esc(selected.category || "Note")}</span>
              <span class="fpTeamMetaChip">${selected.pinned ? "Prioritaire" : "Standard"}</span>
            </div>
            <div class="fpTeamNoteContent">${esc(selected.text || "Note vide")}</div>
            <div class="fpTeamNoteIdeas">
              <div class="fpCardKicker">Idées d’usage</div>
              <div class="fpTeamTipList">
                <div class="fpTeamTipItem">Utilise les notes pour préparer des points client, décisions internes et checklists d’exécution.</div>
                <div class="fpTeamTipItem">Épingle les notes importantes pour les retrouver immédiatement depuis l’espace équipe.</div>
                <div class="fpTeamTipItem">Crée des notes modèles pour les audits, incidents, suivis ou passations.</div>
              </div>
            </div>
          ` : `<div class="fpEmpty">Choisis une note dans la colonne de gauche.</div>`}
        </section>
      </div>
    `;
  }

  function renderMembersTab(workspace) {
    const members = workspace.members || [];
    const onlineCount = members.filter((m) => m.status === "online").length;
    return `
      <div class="fpGrid fpGridMain fpTeamMembersLayout">
        <div class="fpCol fpColMain">
          <section class="fpTeamPanel">
            <div class="fpTeamHeader">
              <div>
                <div class="fpCardKicker">Membres</div>
                <div class="fpTeamChannelTitle">Équipe & rôles</div>
                <div class="fpTeamChannelMeta">Photos, dénominations, rôle, expertise et statut de présence.</div>
              </div>
              <div class="fpDetailActions">
                <button class="fpBtn fpBtnPrimary" type="button" data-team-action="new-member">Ajouter un membre</button>
              </div>
            </div>
            <div class="fpTeamMembersGrid fpTeamMembersGridRich">
              ${members.map((member) => `
                <article class="fpTeamMemberCard">
                  <div class="fpTeamMemberTop">
                    <div class="fpTeamMemberAvatarWrap ${member.status === "online" ? "online" : "offline"}">${memberAvatar(member)}</div>
                    <div class="fpTeamMemberMain">
                      <div class="fpTeamMemberNameRow">
                        <strong>${esc(member.name)}</strong>
                        <span class="fpTeamStatusBadge ${member.status}">${esc(statusLabel(member.status))}</span>
                      </div>
                      <div class="fpTeamMemberTitle">${esc(member.title || member.role || "Membre")}</div>
                      <div class="fpTeamMemberRole">${esc(member.role || "Member")}</div>
                    </div>
                  </div>
                  <div class="fpTeamMemberBio">${esc(member.bio || "Aucune bio renseignée.")}</div>
                  <div class="fpTeamMemberTags">${(member.expertise || []).map((tag) => `<span class="fpTeamMetaChip">${esc(tag)}</span>`).join("")}</div>
                  <div class="fpTeamMemberFooter">
                    <span>Dernière activité · ${esc(shortDate(member.lastSeen))}</span>
                    <div class="fpDetailActions">
                      <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-team-action="toggle-member-status" data-team-payload="${esc(member.id)}">${member.status === "online" ? "Mettre hors ligne" : "Mettre en ligne"}</button>
                      <button class="fpBtn fpBtnSoft fpBtnSmall" type="button" data-team-action="edit-member" data-team-payload="${esc(member.id)}">Modifier</button>
                    </div>
                  </div>
                </article>
              `).join("")}
            </div>
          </section>
        </div>
        <div class="fpCol fpColSide">
          <section class="fpTeamPanel">
            <div class="fpCardKicker">Résumé workspace</div>
            <div class="fpTeamMiniList">
              <div class="fpTeamMiniCard"><strong>Membres</strong><span>${members.length} personnes enregistrées</span></div>
              <div class="fpTeamMiniCard"><strong>En ligne</strong><span>${onlineCount} membres actuellement disponibles</span></div>
              <div class="fpTeamMiniCard"><strong>Profils</strong><span>Nom, titre, rôle, expertise et statut personnalisables</span></div>
            </div>
            <div class="fpCardKicker" style="margin-top:18px">Idées premium</div>
            <div class="fpTeamTipList">
              <div class="fpTeamTipItem">Ajouter des niveaux d’accès par membre et des permissions par canal.</div>
              <div class="fpTeamTipItem">Afficher les membres en visio, en réunion ou concentrés.</div>
              <div class="fpTeamTipItem">Assigner notes, tâches et événements à une ou plusieurs personnes.</div>
            </div>
          </section>
        </div>
      </div>
    `;
  }

  function renderWorkspace() {
    const root = pageContainer();
    if (!root || getHash() !== "#team") return;

    const workspace = getWorkspace();
    const tabs = [
      { id: "chat", label: "Canaux & chat" },
      { id: "calendar", label: "Calendrier" },
      { id: "notes", label: "Notes" },
      { id: "members", label: "Membres" }
    ];

    const activeTab = tabs.some((tab) => tab.id === workspace.currentTab) ? workspace.currentTab : "chat";
    workspace.currentTab = activeTab;
    saveWorkspace(workspace);

    let body = "";
    if (activeTab === "chat") body = renderChatTab(workspace);
    if (activeTab === "calendar") body = renderCalendarTab(workspace);
    if (activeTab === "notes") body = renderNotesTab(workspace);
    if (activeTab === "members") body = renderMembersTab(workspace);

    root.innerHTML = `
      <section class="fpCard fpTeamMasterCard" data-team-enhanced="true">
        <div class="fpTeamHeroBar fpTeamHeroBarRich">
          <div>
            <div class="fpCardKicker">Équipe</div>
            <h2 class="fpSectionTitle">Workspace collaboration</h2>
            <p class="fpCardText">Canaux de discussion, documents, calendrier et notes dans une vraie logique de hub équipe.</p>
          </div>
          <div class="fpDetailActions fpTeamHeroActions">
            <button class="fpBtn fpBtnPrimary" type="button" data-team-action="new-channel">Nouveau canal</button>
            <button class="fpBtn fpBtnGhost" type="button" data-team-action="new-note">Nouvelle note</button>
            <button class="fpBtn fpBtnGhost" type="button" data-team-action="new-event">Nouvel événement</button>
          </div>
        </div>

        ${renderKpis(workspace)}

        <div class="fpTeamTabs">
          ${tabs.map((tab) => `
            <button class="fpTeamTab ${tab.id === activeTab ? "active" : ""}" type="button" data-team-tab="${esc(tab.id)}">${esc(tab.label)}</button>
          `).join("")}
        </div>

        <div class="fpTeamShell" style="margin-top:18px">${body}</div>
      </section>
    `;

    bindWorkspaceEvents();
    scrollMessagesToBottom();
  }

  function scrollMessagesToBottom() {
    const box = document.querySelector(".fpTeamMessagesEnhanced");
    if (box) box.scrollTop = box.scrollHeight;
  }

  function ensureModalRoot() {
    let overlay = document.getElementById("fpTeamModalOverlay");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "fpTeamModalOverlay";
    overlay.className = "fpTeamModalOverlay";
    overlay.innerHTML = `<div class="fpTeamModalWrap"><div class="fpTeamModalCard"></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeModal();
    });
    return overlay;
  }

  function closeModal() {
    const overlay = document.getElementById("fpTeamModalOverlay");
    if (overlay) overlay.classList.remove("show");
  }

  function openFormModal(config) {
    const overlay = ensureModalRoot();
    const card = overlay.querySelector(".fpTeamModalCard");
    card.innerHTML = `
      <div class="fpTeamModalHead">
        <div>
          <div class="fpCardKicker">${esc(config.kicker || "Workspace")}</div>
          <div class="fpTeamModalTitle">${esc(config.title || "Nouvelle action")}</div>
          ${config.text ? `<div class="fpTeamModalText">${esc(config.text)}</div>` : ``}
        </div>
        <button class="fpTeamModalClose" type="button" data-team-modal-close>×</button>
      </div>
      <form class="fpTeamModalForm">
        ${config.fields.map((field) => {
          const value = field.value ?? "";
          if (field.type === "textarea") {
            return `<label class="fpField"><span class="fpLabel">${esc(field.label)}</span><textarea name="${esc(field.name)}" class="fpTextarea fpTeamModalTextarea" placeholder="${esc(field.placeholder || "")}">${esc(value)}</textarea></label>`;
          }
          if (field.type === "select") {
            return `<label class="fpField"><span class="fpLabel">${esc(field.label)}</span><select name="${esc(field.name)}" class="fpSelect fpTeamModalSelect">${(field.options || []).map((option) => `<option value="${esc(option.value)}" ${String(option.value) === String(value) ? "selected" : ""}>${esc(option.label)}</option>`).join("")}</select></label>`;
          }
          if (field.type === "checkbox") {
            return `<label class="fpTeamModalCheck"><input type="checkbox" name="${esc(field.name)}" ${value ? "checked" : ""} /><span>${esc(field.label)}</span></label>`;
          }
          return `<label class="fpField"><span class="fpLabel">${esc(field.label)}</span><input name="${esc(field.name)}" class="fpInput fpTeamModalInput" type="${esc(field.type || "text")}" value="${esc(value)}" placeholder="${esc(field.placeholder || "")}" /></label>`;
        }).join("")}
        <div class="fpTeamModalActions">
          <button class="fpBtn fpBtnGhost" type="button" data-team-modal-cancel>Annuler</button>
          <button class="fpBtn fpBtnPrimary" type="submit">${esc(config.submitLabel || "Valider")}</button>
        </div>
      </form>
    `;
    overlay.classList.add("show");

    card.querySelector("[data-team-modal-close]")?.addEventListener("click", closeModal);
    card.querySelector("[data-team-modal-cancel]")?.addEventListener("click", closeModal);
    const form = card.querySelector(".fpTeamModalForm");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const fd = new FormData(form);
      const values = {};
      config.fields.forEach((field) => {
        values[field.name] = field.type === "checkbox" ? form.elements[field.name].checked : String(fd.get(field.name) || "").trim();
      });
      config.onSubmit?.(values);
      closeModal();
    });
  }

  function openChannelModal(workspace) {
    openFormModal({
      kicker: "Canal",
      title: "Créer un nouveau canal",
      text: "Ajoute un salon plus propre avec un vrai nom, une description et une utilité claire.",
      submitLabel: "Créer le canal",
      fields: [
        { name: "name", label: "Nom du canal", value: "client-success" },
        { name: "description", label: "Description", value: "Suivi dédié à un sujet précis du workspace." },
        { name: "purpose", label: "Utilité", value: "Décisions, points d’action et coordination autour du sujet." },
        { name: "kind", label: "Visibilité", type: "select", value: "public", options: [{ value: "public", label: "Public" }, { value: "private", label: "Privé" }] }
      ],
      onSubmit(values) {
        if (!values.name) return;
        const normalized = lower(values.name).replace(/[^a-z0-9à-ÿ_-]+/gi, "-");
        workspace.channels.unshift({
          id: uid("channel"),
          name: normalized,
          kind: values.kind || "public",
          locked: values.kind === "private",
          description: values.description || `Canal créé pour ${normalized}.`,
          purpose: values.purpose || "Canal dédié au suivi d’un sujet précis."
        });
        workspace.currentChannelId = workspace.channels[0].id;
        workspace.currentTab = "chat";
        addActivity(workspace, "Canal créé", `Le canal #${normalized} a été ajouté au workspace.`);
        saveWorkspace(workspace);
        renderWorkspace();
      }
    });
  }

  function openNoteModal(workspace, note = null) {
    openFormModal({
      kicker: "Note",
      title: note ? "Modifier la note" : "Créer une nouvelle note",
      text: "Crée une note plus propre qu’un popup standard, avec catégorie et priorité.",
      submitLabel: note ? "Enregistrer" : "Créer la note",
      fields: [
        { name: "title", label: "Titre", value: note?.title || "Nouvelle note équipe" },
        { name: "category", label: "Catégorie", value: note?.category || "Process" },
        { name: "text", label: "Contenu", type: "textarea", value: note?.text || "" },
        { name: "pinned", label: "Épingler cette note", type: "checkbox", value: !!note?.pinned }
      ],
      onSubmit(values) {
        const notes = getNotes();
        if (!values.title) return;
        if (note) {
          const idx = notes.findIndex((n) => n.id === note.id);
          if (idx >= 0) notes[idx] = { ...notes[idx], title: values.title, category: values.category, text: values.text, pinned: !!values.pinned, updatedAt: new Date().toISOString() };
          addActivity(workspace, "Note modifiée", `${values.title} a été mise à jour.`);
        } else {
          const created = { id: uid("note"), title: values.title, category: values.category, text: values.text, pinned: !!values.pinned, updatedAt: new Date().toISOString() };
          notes.unshift(created);
          workspace.selectedNoteId = created.id;
          addActivity(workspace, "Note créée", `${values.title} a été ajoutée au workspace.`);
        }
        saveNotes(notes);
        workspace.currentTab = "notes";
        saveWorkspace(workspace);
        renderWorkspace();
      }
    });
  }

  function openEventModal(workspace, datePrefill = "") {
    openFormModal({
      kicker: "Calendrier",
      title: "Planifier un événement",
      text: "Vue plus premium avec date, heure, type et description de l’événement.",
      submitLabel: "Ajouter l’événement",
      fields: [
        { name: "title", label: "Titre", value: "Revue équipe" },
        { name: "date", label: "Date", type: "date", value: datePrefill || workspace.selectedDate || new Date().toISOString().slice(0, 10) },
        { name: "time", label: "Heure", type: "time", value: "09:00" },
        { name: "type", label: "Type", value: "Réunion" },
        { name: "description", label: "Description", type: "textarea", value: "" }
      ],
      onSubmit(values) {
        if (!values.title || !values.date) return;
        const items = getCalendarItems();
        items.unshift({ id: uid("cal"), title: values.title, date: values.date, time: values.time || "09:00", type: values.type || "Tâche", description: values.description || "" });
        saveCalendarItems(items);
        workspace.currentTab = "calendar";
        workspace.selectedDate = values.date;
        addActivity(workspace, "Événement planifié", `${values.title} ajouté au calendrier.`);
        saveWorkspace(workspace);
        renderWorkspace();
      }
    });
  }

  function openMemberModal(workspace, member = null) {
    openFormModal({
      kicker: "Membre",
      title: member ? "Modifier le membre" : "Ajouter un membre",
      text: "Nom, dénomination, rôle, photo de profil, expertise et statut de présence.",
      submitLabel: member ? "Enregistrer" : "Ajouter",
      fields: [
        { name: "name", label: "Nom", value: member?.name || "Nouveau membre" },
        { name: "title", label: "Dénomination", value: member?.title || "Collaborateur" },
        { name: "role", label: "Rôle", value: member?.role || "Member" },
        { name: "status", label: "Statut", type: "select", value: member?.status || "online", options: [{ value: "online", label: "En ligne" }, { value: "offline", label: "Hors ligne" }] },
        { name: "avatarUrl", label: "URL photo de profil", value: member?.avatarUrl || "", placeholder: "https://..." },
        { name: "initials", label: "Initiales si pas de photo", value: member?.initials || "NM" },
        { name: "expertise", label: "Expertises (séparées par des virgules)", value: (member?.expertise || []).join(", ") },
        { name: "bio", label: "Bio", type: "textarea", value: member?.bio || "" }
      ],
      onSubmit(values) {
        if (!values.name) return;
        const expertise = values.expertise ? values.expertise.split(",").map((x) => x.trim()).filter(Boolean) : [];
        if (member) {
          const idx = workspace.members.findIndex((m) => m.id === member.id);
          if (idx >= 0) workspace.members[idx] = { ...workspace.members[idx], name: values.name, title: values.title, role: values.role, status: values.status, avatarUrl: values.avatarUrl, initials: values.initials || values.name.slice(0, 2).toUpperCase(), expertise, bio: values.bio, lastSeen: new Date().toISOString() };
          addActivity(workspace, "Membre modifié", `${values.name} a été mis à jour.`);
        } else {
          workspace.members.unshift({ id: uid("member"), name: values.name, title: values.title, role: values.role, status: values.status, avatarUrl: values.avatarUrl, initials: values.initials || values.name.slice(0, 2).toUpperCase(), expertise, bio: values.bio, lastSeen: new Date().toISOString() });
          addActivity(workspace, "Membre ajouté", `${values.name} rejoint le workspace.`);
        }
        workspace.currentTab = "members";
        saveWorkspace(workspace);
        renderWorkspace();
      }
    });
  }

  function createMessageFromInput(workspace, pendingFiles) {
    const input = document.getElementById("fpTeamMessageInput");
    const text = input?.value?.trim();
    if (!text && !pendingFiles.length) return null;
    return {
      id: uid("msg"),
      channelId: getCurrentChannel(workspace).id,
      author: "Vous",
      role: document.getElementById("fpAccRole")?.textContent?.trim()?.toLowerCase() || "member",
      text: text || "Document partagé",
      createdAt: new Date().toISOString(),
      attachments: pendingFiles
    };
  }

  let pendingFiles = [];

  function renderPendingFiles() {
    const holder = document.getElementById("fpTeamPendingFiles");
    if (!holder) return;
    holder.innerHTML = pendingFiles.map((file, index) => `
      <div class="fpTeamMetaChip fpTeamMetaChipClosable">${esc(file.name)}<button type="button" data-team-remove-file="${index}">×</button></div>
    `).join("");
    holder.querySelectorAll("[data-team-remove-file]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.getAttribute("data-team-remove-file"));
        pendingFiles.splice(index, 1);
        renderPendingFiles();
      });
    });
  }

  function bindWorkspaceEvents() {
    const workspace = getWorkspace();

    document.querySelectorAll("[data-team-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        workspace.currentTab = btn.getAttribute("data-team-tab") || "chat";
        saveWorkspace(workspace);
        renderWorkspace();
      });
    });

    document.querySelectorAll("[data-team-channel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        workspace.currentChannelId = btn.getAttribute("data-team-channel") || "general";
        workspace.currentTab = "chat";
        addActivity(workspace, "Canal consulté", `Le canal #${getCurrentChannel(workspace).name} a été ouvert.`);
        saveWorkspace(workspace);
        renderWorkspace();
      });
    });

    document.querySelectorAll("[data-team-note]").forEach((btn) => {
      btn.addEventListener("click", () => {
        workspace.selectedNoteId = btn.getAttribute("data-team-note") || "";
        workspace.currentTab = "notes";
        saveWorkspace(workspace);
        renderWorkspace();
      });
    });

    document.querySelectorAll("[data-team-day]").forEach((btn) => {
      btn.addEventListener("click", () => {
        workspace.selectedDate = btn.getAttribute("data-team-day") || new Date().toISOString().slice(0, 10);
        workspace.currentTab = "calendar";
        saveWorkspace(workspace);
        renderWorkspace();
      });
    });

    document.querySelectorAll("[data-team-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-team-action") || "";
        const payload = btn.getAttribute("data-team-payload") || "";

        if (action === "new-channel") return openChannelModal(workspace);
        if (action === "new-note") return openNoteModal(workspace, null);
        if (action === "new-template-note") return openNoteModal(workspace, { title: "Template de passation", category: "Template", text: "Contexte\nObjectif\nActions à faire\nPoints bloquants\nDécision attendue", pinned: false });
        if (action === "new-event") return openEventModal(workspace, workspace.selectedDate);
        if (action === "new-event-for-day") return openEventModal(workspace, workspace.selectedDate);
        if (action === "new-member") return openMemberModal(workspace, null);

        if (action === "send-message") {
          const message = createMessageFromInput(workspace, pendingFiles);
          if (!message) return;
          workspace.messages.push(message);
          message.attachments.forEach((file) => {
            workspace.files.unshift({ id: uid("file"), channelId: message.channelId, name: file.name, sizeLabel: file.sizeLabel, kind: file.kind, uploadedAt: new Date().toISOString(), uploadedBy: "Vous" });
          });
          addActivity(workspace, "Message envoyé", `Nouveau message posté dans #${getCurrentChannel(workspace).name}.`);
          saveWorkspace(workspace);
          const input = document.getElementById("fpTeamMessageInput");
          if (input) input.value = "";
          pendingFiles = [];
          renderWorkspace();
          return;
        }

        if (action === "pick-file") {
          document.getElementById("fpTeamFileInput")?.click();
          return;
        }

        if (action === "open-calendar") {
          workspace.currentTab = "calendar";
          saveWorkspace(workspace);
          renderWorkspace();
          return;
        }

        if (action === "edit-note") {
          const note = getNotes().find((n) => n.id === payload);
          if (note) openNoteModal(workspace, note);
          return;
        }

        if (action === "toggle-pin-note") {
          const notes = getNotes();
          const idx = notes.findIndex((n) => n.id === payload);
          if (idx >= 0) {
            notes[idx].pinned = !notes[idx].pinned;
            notes[idx].updatedAt = new Date().toISOString();
            saveNotes(notes);
            addActivity(workspace, notes[idx].pinned ? "Note épinglée" : "Note désépinglée", `${notes[idx].title} a changé de statut.`);
            saveWorkspace(workspace);
            renderWorkspace();
          }
          return;
        }

        if (action === "delete-note") {
          const notes = getNotes().filter((n) => n.id !== payload);
          saveNotes(notes);
          workspace.selectedNoteId = notes[0]?.id || "";
          addActivity(workspace, "Note supprimée", "Une note a été retirée du workspace.");
          saveWorkspace(workspace);
          renderWorkspace();
          return;
        }

        if (action === "edit-member") {
          const member = workspace.members.find((m) => m.id === payload);
          if (member) openMemberModal(workspace, member);
          return;
        }

        if (action === "toggle-member-status") {
          const idx = workspace.members.findIndex((m) => m.id === payload);
          if (idx >= 0) {
            workspace.members[idx].status = workspace.members[idx].status === "online" ? "offline" : "online";
            workspace.members[idx].lastSeen = new Date().toISOString();
            addActivity(workspace, "Statut membre", `${workspace.members[idx].name} est maintenant ${statusLabel(workspace.members[idx].status).toLowerCase()}.`);
            saveWorkspace(workspace);
            renderWorkspace();
          }
        }
      });
    });

    const fileInput = document.getElementById("fpTeamFileInput");
    if (fileInput) {
      fileInput.addEventListener("change", () => {
        const picked = Array.from(fileInput.files || []).map((file) => ({
          name: file.name,
          sizeLabel: file.size > 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`,
          kind: (file.name.split(".").pop() || "DOC").toUpperCase()
        }));
        pendingFiles = pendingFiles.concat(picked).slice(0, 6);
        renderPendingFiles();
        fileInput.value = "";
      });
    }

    renderPendingFiles();
  }

  function scheduleEnhance() {
    if (getHash() !== "#team") return;
    window.clearTimeout(scheduleEnhance._t);
    scheduleEnhance._t = window.setTimeout(renderWorkspace, 50);
  }

  function installObserver() {
    const root = pageContainer();
    if (!root || installObserver._done) return;
    installObserver._done = true;
    const observer = new MutationObserver(() => {
      if (getHash() === "#team" && !root.querySelector("[data-team-enhanced='true']")) {
        scheduleEnhance();
      }
    });
    observer.observe(root, { childList: true, subtree: false });
  }

  document.addEventListener("DOMContentLoaded", () => {
    installObserver();
    scheduleEnhance();
    window.addEventListener("hashchange", scheduleEnhance);
  });
})();
