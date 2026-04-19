// PARTIE 7 — activité, render final et montage
(() => {
  "use strict";

  function renderActivityPart7(s) {
    const filtered = s.filter === "all" ? s.activity : s.activity.filter((a) => a.type === s.filter);
    const heat = [1, 2, 3, 4, 2, 1, 3]
      .map((lvl, i) => `
        <div class="fpTeamV2HeatCell fpTeamV2HeatCellLevel${lvl}">
          <strong>${["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"][i]}</strong>
          <span>${lvl * 3} actions</span>
        </div>
      `)
      .join("");

    return `
      <div class="fpTeamV2ActivityLayout">
        <div class="fpTeamV2Panel">
          <div class="fpTeamV2SectionKicker">Activité</div>
          <div class="fpTeamV2SectionTitle">Timeline du workspace</div>
          <div class="fpTeamV2SectionText">
            Vue vivante des actions récentes pour donner du contexte au produit et à l’équipe, avec un peu d’analytics.
          </div>

          <div class="fpTeamV2Filters">
            <button class="fpTeamV2Filter ${s.filter === "all" ? "active" : ""}" data-activity-filter="all">Tout</button>
            <button class="fpTeamV2Filter ${s.filter === "message" ? "active" : ""}" data-activity-filter="message">Messages</button>
            <button class="fpTeamV2Filter ${s.filter === "doc" ? "active" : ""}" data-activity-filter="doc">Documents</button>
            <button class="fpTeamV2Filter ${s.filter === "member" ? "active" : ""}" data-activity-filter="member">Membres</button>
          </div>

          <div class="fpTeamV2FeedList">
            ${filtered.length
              ? filtered.map((it) => `
                <div class="fpTeamV2FeedItem">
                  <div class="fpTeamV2FeedIcon">${it.type === "doc" ? "📄" : it.type === "member" ? "👤" : "💬"}</div>
                  <div>
                    <strong>${it.title}</strong>
                    <span>${it.text}</span>
                  </div>
                  <div class="fpTeamV2FeedMeta">${new Date(it.d).toLocaleDateString("fr-FR")}</div>
                </div>
              `).join("")
              : `<div class="fpTeamV2Empty">Aucune activité sur ce filtre.</div>`}
          </div>
        </div>

        <div class="fpTeamV2Stack">
          <div class="fpTeamV2SidebarCard">
            <strong>Analytics rapides</strong>
            <span>Lecture immédiate du niveau d’usage du workspace.</span>
            <div class="fpTeamV2Kpis" style="margin-top:14px;">
              <div class="fpTeamV2Kpi">
                <span>Messages</span>
                <strong>${s.activity.filter((x) => x.type === "message").length}</strong>
                <small>Actions conversationnelles</small>
              </div>
              <div class="fpTeamV2Kpi">
                <span>Docs</span>
                <strong>${s.activity.filter((x) => x.type === "doc").length}</strong>
                <small>Ajouts ou mouvements de documents</small>
              </div>
              <div class="fpTeamV2Kpi">
                <span>Membres</span>
                <strong>${s.activity.filter((x) => x.type === "member").length}</strong>
                <small>Présence ou actions liées à l’équipe</small>
              </div>
              <div class="fpTeamV2Kpi">
                <span>Canaux</span>
                <strong>${s.channels.length}</strong>
                <small>Espaces suivis dans le workspace</small>
              </div>
            </div>
          </div>

          <div class="fpTeamV2SidebarCard">
            <strong>Heatmap légère</strong>
            <span>Petit bloc analytique pour donner plus de vie à l’onglet activité.</span>
            <div class="fpTeamV2AnalyticsHeat">${heat}</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderTabPart7(s) {
    if (s.tab === "chat") return "__CHAT_PARTS_3_4__";
    if (s.tab === "calendar") return "__CALENDAR_PART5__";
    if (s.tab === "notes") return "__NOTES_PART6__";
    if (s.tab === "members") return "__MEMBERS_PART6__";
    if (s.tab === "activity") return renderActivityPart7(s);
    return "__CHAT_PARTS_3_4__";
  }

  function renderShellPart7(state, heroHtml, kpisHtml, tabsHtml, bodyHtml) {
    return `
      <div class="fpTeamV2" data-team-v2="true">
        ${heroHtml}
        ${kpisHtml}
        ${tabsHtml}
        <div class="fpTeamV2Body">${bodyHtml}</div>
      </div>
    `;
  }

  function ensureTakeoverPart7(renderFn) {
    if ((location.hash || "").toLowerCase() !== "#team") return;
    const host = document.getElementById("fpPageContainer");
    if (!host) return;
    renderFn();
  }

  function mountTeamRebuildPart7(renderFn) {
    const observer = new MutationObserver(() => {
      if ((location.hash || "").toLowerCase() === "#team") {
        ensureTakeoverPart7(renderFn);
      }
    });

    document.addEventListener("DOMContentLoaded", () => {
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => ensureTakeoverPart7(renderFn), 80);
      setTimeout(() => ensureTakeoverPart7(renderFn), 260);
      setTimeout(() => ensureTakeoverPart7(renderFn), 700);
    });

    window.addEventListener("hashchange", () => {
      setTimeout(() => ensureTakeoverPart7(renderFn), 80);
      setTimeout(() => ensureTakeoverPart7(renderFn), 220);
    });
  }

  // dernière partie à venir : logique des modales, handlers et fichier complet fusionné
})();
