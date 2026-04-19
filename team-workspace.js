
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
      { id: "general", name: "général", kind: "public", locked: false, description: "Canal principal du workspace" },
      { id: "seo", name: "seo", kind: "public", locked: false, description: "Discussions SEO, contenus et quick wins" },
      { id: "dev", name: "dev", kind: "public", locked: false, description: "Bugs, intégrations et sujets techniques" },
      { id: "planning", name: "planning", kind: "private", locked: true, description: "Organisation, calendrier et exécution" }
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
        author: "SEO Manager",
        role: "manager",
        text: "Priorité du jour : transformer les quick wins des audits en vraies actions. On centralise tout ici.",
        createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
        attachments: []
      },
      {
        id: "seed_3",
        channelId: "dev",
        author: "Tech Ops",
        role: "editor",
        text: "Le workspace est branché sur le dashboard. Prochaine étape : pousser encore plus loin la vraie collaboration backend.",
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

  function getWorkspace() {
    const current = getStorageJson(TEAM_STORE_KEY, null);
    if (current && typeof current === "object" && Array.isArray(current.channels)) {
      return current;
    }

    const workspace = {
      currentTab: "chat",
      currentChannelId: "general",
      selectedNoteId: "",
      channels: buildInitialChannels(),
      messages: buildInitialMessages(),
      files: buildInitialFiles(),
      activity: [
        { id: "act_1", title: "Workspace activé", text: "Le hub équipe a été initialisé dans le dashboard.", time: new Date().toISOString() },
        { id: "act_2", title: "Canaux prêts", text: "Les canaux général, seo, dev et planning sont disponibles.", time: new Date(Date.now() - 3600 * 1000).toISOString() }
      ]
    };
    setStorageJson(TEAM_STORE_KEY, workspace);
    return workspace;
  }

  function saveWorkspace(next) {
    setStorageJson(TEAM_STORE_KEY, next);
  }

  function getNotes() {
    return getStorageJson(NOTES_KEY, []);
  }

  function saveNotes(items) {
    setStorageJson(NOTES_KEY, items);
  }

  function getCalendarItems() {
    return getStorageJson(CALENDAR_KEY, []);
  }

  function saveCalendarItems(items) {
    setStorageJson(CALENDAR_KEY, items);
  }

  function getCurrentChannel(workspace) {
    return workspace.channels.find((item) => item.id === workspace.currentChannelId) || workspace.channels[0];
  }

  function getMessagesForChannel(workspace, channelId) {
    return workspace.messages.filter((item) => item.channelId === channelId).slice(-40);
  }

  function getFilesForChannel(workspace, channelId) {
    return workspace.files.filter((item) => item.channelId === channelId).slice(-12).reverse();
  }

  function getMembers() {
    const plan = document.getElementById("fpAccPlan")?.textContent?.trim() || "Standard";
    const org = document.getElementById("fpAccOrg")?.textContent?.trim() || "Workspace principal";
    const ownerRole = document.getElementById("fpAccRole")?.textContent?.trim() || "Owner";

    return [
      { name: org, role: ownerRole, text: "Compte principal, accès complet au workspace et au pilotage du dashboard." },
      { name: "SEO Manager", role: "Manager", text: "Pilote audits, quick wins, recommandations et plan d’action SEO." },
      { name: "Tech Ops", role: "Editor", text: "Suit la stabilité, les monitors, l’exécution technique et les incidents." },
      { name: `Plan ${plan}`, role: "Workspace", text: "Le niveau d’abonnement débloque plus ou moins de confort de collaboration." }
    ];
  }

  function addActivity(workspace, title, text) {
    workspace.activity.unshift({
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title,
      text,
      time: new Date().toISOString()
    });
    workspace.activity = workspace.activity.slice(0, 18);
  }

  function pickSelectedNote(workspace, notes) {
    const selected = notes.find((note) => note.id === workspace.selectedNoteId);
    return selected || notes[0] || null;
  }

  function eventTypeClass(type) {
    const t = lower(type);
    if (t.includes("audit")) return "audit";
    if (t.includes("monitor")) return "monitoring";
    if (t.includes("tâche") || t.includes("task")) return "task";
    return "custom";
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
        items: items.filter((item) => String(item.date || "").slice(0, 10) === iso).slice(0, 3)
      });
    }

    return {
      monthLabel: now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
      weekdays: ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"],
      cells
    };
  }

  function renderChatTab(workspace) {
    const channel = getCurrentChannel(workspace);
    const messages = getMessagesForChannel(workspace, channel.id);
    const files = getFilesForChannel(workspace, channel.id);

    return `
      <div class="fpTeamWorkspace">
        <aside class="fpTeamPanel">
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
          <div class="fpDetailActions" style="margin-top:14px">
            <button class="fpBtn fpBtnPrimary fpBtnSmall" type="button" data-team-action="new-channel">Nouveau canal</button>
          </div>
        </aside>

        <section class="fpTeamPanel">
          <div class="fpTeamHeader">
            <div>
              <div class="fpCardKicker">Canal actif</div>
              <div class="fpTeamChannelTitle">#${esc(channel.name)}</div>
              <div class="fpTeamChannelMeta">${esc(channel.description || "Canal équipe")}</div>
            </div>
            <div class="fpBadge up">
              <span class="fpBadgeDot"></span>
              En ligne
            </div>
          </div>

          <div class="fpTeamMessages">
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

          <div class="fpTeamComposer">
            <div class="fpTeamComposerGrid">
              <textarea id="fpTeamMessageInput" class="fpTeamTextarea" placeholder="Écris un message, une note interne, une consigne ou un suivi..."></textarea>
              <div class="fpTeamMiniList">
                <button class="fpBtn fpBtnPrimary" type="button" data-team-action="send-message">Envoyer</button>
                <button class="fpBtn fpBtnGhost" type="button" data-team-action="pick-file">Joindre un document</button>
                <input id="fpTeamFileInput" type="file" multiple hidden />
                <button class="fpBtn fpBtnGhost" type="button" data-team-action="open-calendar">Voir calendrier</button>
              </div>
            </div>
            <div id="fpTeamPendingFiles" class="fpTeamBadgeRow"></div>
          </div>
        </section>

        <aside class="fpTeamPanel">
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

          <div class="fpCardKicker" style="margin-top:18px">Activité</div>
          <div class="fpTeamActivityList">
            ${workspace.activity.slice(0, 6).map((item) => `
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

  function renderCalendarTab() {
    const items = getCalendarItems().slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const matrix = buildCalendarMatrix(items);

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

        <div class="fpTeamCalendarGrid">
          ${matrix.weekdays.map((day) => `<div class="fpMiniStat"><div class="fpMiniStatLabel">${esc(day)}</div></div>`).join("")}
          ${matrix.cells.map((cell) => `
            <button class="fpTeamCalendarCell ${cell.currentMonth ? "" : "muted"} ${cell.today ? "today" : ""}" type="button" data-team-day="${esc(cell.iso)}">
              <div class="fpTeamCalendarTop">
                <strong>${esc(cell.day)}</strong>
                ${cell.today ? `<span class="fpAddonPill on">Today</span>` : ``}
              </div>
              <div class="fpTeamCalendarPills">
                ${cell.items.map((item) => `
                  <div class="fpTeamCalendarPill ${eventTypeClass(item.type)}">${esc(item.title)}</div>
                `).join("")}
              </div>
            </button>
          `).join("")}
        </div>

        <div class="fpGrid fpGridMain">
          <div class="fpCol fpColMain">
            <section class="fpTeamPanel">
              <div class="fpCardKicker">Agenda</div>
              <div class="fpTeamCalendarAgenda">
                ${items.length ? items.slice(0, 12).map((item) => `
                  <div class="fpTeamCalendarRow">
                    <strong>${esc(item.title)}</strong>
                    <span>${esc(formatDate(item.date))} · ${esc(item.type || "Tâche")}</span>
                  </div>
                `).join("") : `<div class="fpEmpty">Aucun événement enregistré.</div>`}
              </div>
            </section>
          </div>
          <div class="fpCol fpColSide">
            <section class="fpTeamPanel">
              <div class="fpCardKicker">Usage recommandé</div>
              <div class="fpTeamMiniList">
                <div class="fpTeamMiniCard"><strong>Audits</strong><span>Planifie revues, relances et restitutions.</span></div>
                <div class="fpTeamMiniCard"><strong>Monitors</strong><span>Place les vérifications importantes et les points de suivi.</span></div>
                <div class="fpTeamMiniCard"><strong>Opérations</strong><span>Centralise deadlines, tâches internes et reminders clients.</span></div>
              </div>
            </section>
          </div>
        </div>
      </div>
    `;
  }

  function renderNotesTab(workspace) {
    const notes = getNotes();
    const selected = pickSelectedNote(workspace, notes);

    return `
      <div class="fpTeamSplit">
        <aside class="fpTeamPanel">
          <div class="fpCardKicker">Notes</div>
          <div class="fpDetailActions" style="margin-top:14px">
            <button class="fpBtn fpBtnPrimary fpBtnSmall" type="button" data-team-action="new-note">Nouvelle note</button>
          </div>
          <div class="fpTeamNotesList">
            ${notes.length ? notes.map((note) => `
              <button class="fpTeamNoteItem ${selected && note.id === selected.id ? "active" : ""}" type="button" data-team-note="${esc(note.id)}">
                <strong>${esc(note.title || "Nouvelle note")}</strong>
                <span>${esc((note.text || "").slice(0, 90) || "Note vide")} · ${esc(shortDate(note.updatedAt))}</span>
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
                <div class="fpTeamChannelMeta">Dernière mise à jour · ${esc(formatDate(selected.updatedAt))}</div>
              </div>
              <div class="fpDetailActions">
                <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-team-action="edit-note" data-team-payload="${esc(selected.id)}">Modifier</button>
                <button class="fpBtn fpBtnDanger fpBtnSmall" type="button" data-team-action="delete-note" data-team-payload="${esc(selected.id)}">Supprimer</button>
              </div>
            </div>
            <div class="fpTeamNoteContent">${esc(selected.text || "Note vide")}</div>
          ` : `<div class="fpEmpty">Choisis une note dans la colonne de gauche.</div>`}
        </section>
      </div>
    `;
  }

  function renderMembersTab(workspace) {
    const members = getMembers();
    return `
      <div class="fpGrid fpGridMain">
        <div class="fpCol fpColMain">
          <section class="fpTeamPanel">
            <div class="fpCardKicker">Membres</div>
            <div class="fpTeamMembersGrid">
              ${members.map((item) => `
                <div class="fpTeamMiniCard">
                  <strong>${esc(item.name)}</strong>
                  <span>${esc(item.role)} · ${esc(item.text)}</span>
                </div>
              `).join("")}
            </div>
          </section>
        </div>
        <div class="fpCol fpColSide">
          <section class="fpTeamPanel">
            <div class="fpCardKicker">Résumé workspace</div>
            <div class="fpTeamMiniList">
              <div class="fpTeamMiniCard"><strong>Canaux</strong><span>${workspace.channels.length} salons disponibles</span></div>
              <div class="fpTeamMiniCard"><strong>Messages</strong><span>${workspace.messages.length} échanges enregistrés</span></div>
              <div class="fpTeamMiniCard"><strong>Documents</strong><span>${workspace.files.length} documents référencés</span></div>
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
      <section class="fpCard" data-team-enhanced="true">
        <div class="fpTeamHeroBar">
          <div>
            <div class="fpCardKicker">Équipe</div>
            <h2 class="fpSectionTitle">Workspace collaboration</h2>
            <p class="fpCardText">Canaux de discussion, documents, calendrier et notes dans une vraie logique de hub équipe.</p>
          </div>
          <div class="fpDetailActions">
            <button class="fpBtn fpBtnPrimary" type="button" data-team-action="new-channel">Nouveau canal</button>
            <button class="fpBtn fpBtnGhost" type="button" data-team-action="new-note">Nouvelle note</button>
            <button class="fpBtn fpBtnGhost" type="button" data-team-action="new-event">Nouvel événement</button>
          </div>
        </div>

        <div class="fpTeamTabs">
          ${tabs.map((tab) => `
            <button class="fpTeamTab ${tab.id === activeTab ? "active" : ""}" type="button" data-team-tab="${esc(tab.id)}">${esc(tab.label)}</button>
          `).join("")}
        </div>

        <div class="fpTeamShell" style="margin-top:18px">
          ${body}
        </div>
      </section>
    `;

    bindWorkspaceEvents();
  }

  function promptText(title, placeholder = "") {
    const value = window.prompt(title, placeholder);
    if (value == null) return null;
    const clean = String(value).trim();
    return clean || null;
  }

  function createMessageFromInput(pendingFiles) {
    const input = document.getElementById("fpTeamMessageInput");
    const text = input?.value?.trim();
    if (!text && !pendingFiles.length) return null;

    return {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      channelId: getCurrentChannel(getWorkspace()).id,
      author: "Vous",
      role: "owner",
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
      <div class="fpAddonPill on" style="letter-spacing:0;text-transform:none;height:auto;min-height:34px">
        ${esc(file.name)}
        <button type="button" data-team-remove-file="${index}" style="margin-left:8px;background:none;border:none;color:#fff;cursor:pointer">×</button>
      </div>
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
        saveWorkspace(workspace);
        renderWorkspace();
      });
    });

    document.querySelectorAll("[data-team-note]").forEach((btn) => {
      btn.addEventListener("click", () => {
        workspace.selectedNoteId = btn.getAttribute("data-team-note") || "";
        saveWorkspace(workspace);
        renderWorkspace();
      });
    });

    document.querySelectorAll("[data-team-day]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const date = btn.getAttribute("data-team-day") || "";
        if (!date) return;
        const title = promptText("Titre de l’événement", "Suivi équipe");
        if (!title) return;
        const type = promptText("Type d’événement", "Tâche") || "Tâche";
        const items = getCalendarItems();
        items.unshift({ id: `cal_${Date.now()}`, title, date, type });
        saveCalendarItems(items);
        workspace.currentTab = "calendar";
        addActivity(workspace, "Événement ajouté", `${title} prévu le ${date}.`);
        saveWorkspace(workspace);
        renderWorkspace();
      });
    });

    document.querySelectorAll("[data-team-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-team-action") || "";
        const payload = btn.getAttribute("data-team-payload") || "";

        if (action === "new-channel") {
          const name = promptText("Nom du canal", "client-success");
          if (!name) return;
          const normalized = lower(name).replace(/[^a-z0-9à-ÿ_-]+/gi, "-");
          workspace.channels.unshift({
            id: `channel_${Date.now()}`,
            name: normalized,
            kind: "public",
            locked: false,
            description: `Canal créé pour ${normalized}.`
          });
          workspace.currentChannelId = workspace.channels[0].id;
          workspace.currentTab = "chat";
          addActivity(workspace, "Canal créé", `Le canal #${normalized} a été ajouté au workspace.`);
          saveWorkspace(workspace);
          renderWorkspace();
          return;
        }

        if (action === "send-message") {
          const message = createMessageFromInput(pendingFiles);
          if (!message) return;
          workspace.messages.push(message);
          message.attachments.forEach((file) => {
            workspace.files.unshift({
              id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              channelId: message.channelId,
              name: file.name,
              sizeLabel: file.sizeLabel,
              kind: file.kind,
              uploadedAt: new Date().toISOString(),
              uploadedBy: "Vous"
            });
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

        if (action === "new-note") {
          const title = promptText("Titre de la note", "Nouvelle note équipe");
          if (!title) return;
          const text = promptText("Contenu de la note", "Écris la note ici...") || "";
          const notes = getNotes();
          const note = { id: `note_${Date.now()}`, title, text, updatedAt: new Date().toISOString() };
          notes.unshift(note);
          saveNotes(notes);
          workspace.currentTab = "notes";
          workspace.selectedNoteId = note.id;
          addActivity(workspace, "Note créée", `${title} a été ajoutée au workspace.`);
          saveWorkspace(workspace);
          renderWorkspace();
          return;
        }

        if (action === "edit-note") {
          const notes = getNotes();
          const idx = notes.findIndex((n) => n.id === payload);
          if (idx < 0) return;
          const title = promptText("Modifier le titre", notes[idx].title) || notes[idx].title;
          const text = promptText("Modifier le contenu", notes[idx].text || "") || notes[idx].text || "";
          notes[idx] = { ...notes[idx], title, text, updatedAt: new Date().toISOString() };
          saveNotes(notes);
          addActivity(workspace, "Note modifiée", `${title} a été mise à jour.`);
          saveWorkspace(workspace);
          renderWorkspace();
          return;
        }

        if (action === "delete-note") {
          if (!window.confirm("Supprimer cette note ?")) return;
          const notes = getNotes().filter((n) => n.id !== payload);
          saveNotes(notes);
          workspace.selectedNoteId = notes[0]?.id || "";
          addActivity(workspace, "Note supprimée", "Une note a été retirée du workspace.");
          saveWorkspace(workspace);
          renderWorkspace();
          return;
        }

        if (action === "new-event") {
          const title = promptText("Titre de l’événement", "Revue équipe");
          if (!title) return;
          const date = promptText("Date de l’événement (YYYY-MM-DD)", new Date().toISOString().slice(0, 10));
          if (!date) return;
          const type = promptText("Type d’événement", "Tâche") || "Tâche";
          const items = getCalendarItems();
          items.unshift({ id: `cal_${Date.now()}`, title, date, type });
          saveCalendarItems(items);
          workspace.currentTab = "calendar";
          addActivity(workspace, "Événement planifié", `${title} ajouté au calendrier.`);
          saveWorkspace(workspace);
          renderWorkspace();
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
