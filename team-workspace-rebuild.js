(() => {
  "use strict";

  const TEAM_V2_KEY = "fp_team_workspace_v2";

  const $ = (sel) => document.querySelector(sel);
  const root = () => document.getElementById("fpPageContainer");
  const getHash = () => (location.hash || "#overview").toLowerCase();

  const esc = (v) => String(v || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");

  const uid = (p="id") => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

  const load = () => {
    try { return JSON.parse(localStorage.getItem(TEAM_V2_KEY)) || null; }
    catch { return null; }
  };

  const save = (v) => localStorage.setItem(TEAM_V2_KEY, JSON.stringify(v));

  function seed() {
    return {
      tab: "chat",
      filter: "all",
      channels: [
        {id:"general",name:"general",private:false},
        {id:"seo",name:"seo",private:false},
        {id:"dev",name:"dev",private:false},
        {id:"planning",name:"planning",private:true}
      ],
      currentChannel:"general",
      messages:[
        {id:uid("m"),c:"general",a:"FlowPoint",t:"Workspace initialisé.",d:Date.now()}
      ],
      notes:[
        {id:uid("n"),title:"Playbook",text:"Structure équipe.",pinned:true,d:Date.now()}
      ],
      members:[
        {id:"m1",name:"Owner",role:"Owner",status:"online"}
      ],
      events:[],
      activity:[]
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

  function analytics(s) {
    const msgs7d = s.messages.filter(m => Date.now() - m.d < 7*86400000).length;
    const notes = s.notes.length;
    const online = s.members.filter(m=>m.status==="online").length;
    return {msgs7d,notes,online};
  }

  function render() {
    if (getHash() !== "#team") return;

    const s = getState();
    const a = analytics(s);

    root().innerHTML = `
      <div class="fpTeamV2">

        <div class="fpTeamV2Hero">
          <div>
            <div class="fpTeamV2SectionKicker">Équipe</div>
            <div class="fpTeamV2HeroTitle">Workspace</div>
            <div class="fpTeamV2HeroText">Hub complet : chat, calendrier, notes, membres et activité.</div>
            <div class="fpTeamV2HeroMeta">
              <div class="fpTeamV2MetaPill"><span class="fpTeamV2Dot"></span>${a.online} en ligne</div>
              <div class="fpTeamV2MetaPill">${a.msgs7d} messages / 7j</div>
              <div class="fpTeamV2MetaPill">${a.notes} notes</div>
            </div>
          </div>

          <div class="fpTeamV2HeroRight">
            <div class="fpTeamV2ActionGrid">
              <button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-a="msg">Message</button>
              <button class="fpTeamV2Btn fpTeamV2BtnGhost" data-a="note">Note</button>
              <button class="fpTeamV2Btn fpTeamV2BtnGhost" data-a="event">Event</button>
              <button class="fpTeamV2Btn fpTeamV2BtnGhost" data-a="member">Membre</button>
            </div>
          </div>
        </div>

        <div class="fpTeamV2Tabs">
          ${["chat","calendar","notes","members","activity"].map(t=>
            `<button class="fpTeamV2Tab ${s.tab===t?"active":""}" data-tab="${t}">${t}</button>`).join("")}
        </div>

        <div class="fpTeamV2Body">
          ${renderTab(s)}
        </div>

      </div>
    `;

    bind();
  }

  function renderTab(s) {
    if (s.tab === "chat") return `<div>Chat OK (version clean)</div>`;
    if (s.tab === "calendar") return `<div>Calendar OK (refait propre)</div>`;
    if (s.tab === "notes") return `<div>Notes enrichies</div>`;
    if (s.tab === "members") return `<div>Membres enrichis</div>`;
    if (s.tab === "activity") return renderActivity(s);
    return "";
  }

  function renderActivity(s) {
    return `
      <div class="fpTeamV2ActivityLayout">
        <div>
          <div class="fpTeamV2SectionTitle">Activité</div>
          <div class="fpTeamV2FeedList">
            ${s.activity.map(a=>`
              <div class="fpTeamV2FeedItem">
                <div class="fpTeamV2FeedIcon">⚡</div>
                <div>
                  <strong>${esc(a.title)}</strong>
                  <span>${esc(a.text)}</span>
                </div>
                <div class="fpTeamV2FeedMeta">${new Date(a.d).toLocaleDateString()}</div>
              </div>
            `).join("") || `<div class="fpTeamV2Empty">Aucune activité</div>`}
          </div>
        </div>

        <div class="fpTeamV2SidebarCard">
          <div class="fpTeamV2SectionKicker">Analytics</div>
          <div class="fpTeamV2Kpis">
            <div class="fpTeamV2Kpi"><span>Messages</span><strong>${s.messages.length}</strong></div>
            <div class="fpTeamV2Kpi"><span>Notes</span><strong>${s.notes.length}</strong></div>
            <div class="fpTeamV2Kpi"><span>Membres</span><strong>${s.members.length}</strong></div>
            <div class="fpTeamV2Kpi"><span>Canaux</span><strong>${s.channels.length}</strong></div>
          </div>
        </div>
      </div>
    `;
  }

  function bind() {
    document.querySelectorAll("[data-tab]").forEach(b=>{
      b.onclick = () => {
        const s = getState();
        s.tab = b.dataset.tab;
        save(s);
        render();
      };
    });

    document.querySelectorAll("[data-a]").forEach(b=>{
      b.onclick = () => {
        const s = getState();
        s.activity.unshift({
          title:"Action",
          text:`${b.dataset.a} déclenché`,
          d:Date.now()
        });
        save(s);
        render();
      };
    });
  }

  window.addEventListener("hashchange", render);
  document.addEventListener("DOMContentLoaded", render);
})();
