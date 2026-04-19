(() => {
  "use strict";

  function getHash(){return (location.hash||"").toLowerCase();}

  function getActiveTab(){
    return document.querySelector(".fpTeamTab.active")?.textContent?.toLowerCase() || "";
  }

  function removeHeaderVisioIfNeeded(){
    const tab = getActiveTab();
    const btn = document.querySelector("[data-team-visio='header']");
    if(!btn) return;
    if(!tab.includes("chat")){
      btn.remove();
    }
  }

  function enrichNotes(){
    const active = document.querySelector(".fpTeamPanel .fpTeamChannelTitle");
    if(!active || !getActiveTab().includes("note")) return;

    const container = active.closest(".fpTeamPanel");
    if(!container || container.querySelector(".fpTeamNoteStats")) return;

    const content = container.querySelector(".fpTeamNoteContent");
    const text = content?.textContent || "";

    const words = text.split(/\s+/).filter(Boolean).length;
    const lines = text.split("\n").length;

    const stats = document.createElement("div");
    stats.className = "fpTeamNoteStats";
    stats.innerHTML = `
      <div class="fpTeamNoteStatCard"><span>Longueur</span><strong>${words}</strong></div>
      <div class="fpTeamNoteStatCard"><span>Lignes</span><strong>${lines}</strong></div>
      <div class="fpTeamNoteStatCard"><span>Statut</span><strong>Active</strong></div>
    `;

    container.insertBefore(stats, content);

    const info = document.createElement("div");
    info.className = "fpTeamInfoGrid";
    info.innerHTML = `
      <div class="fpTeamInfoCard"><strong>Utilisation</strong><span>Utilise cette note comme base de décision ou checklist.</span></div>
      <div class="fpTeamInfoCard"><strong>Conseil</strong><span>Transforme cette note en mission ou action concrète.</span></div>
    `;

    container.appendChild(info);
  }

  function enrichMembers(){
    if(!getActiveTab().includes("membre")) return;

    const side = document.querySelector(".fpColSide .fpTeamPanel");
    if(!side || side.querySelector(".fpTeamWorkspaceStatsGrid")) return;

    const members = document.querySelectorAll(".fpTeamMemberCard").length;
    const online = document.querySelectorAll(".fpTeamStatusBadge.online").length;

    const stats = document.createElement("div");
    stats.className = "fpTeamWorkspaceStatsGrid";
    stats.innerHTML = `
      <div class="fpTeamWorkspaceStat"><strong>Membres</strong><span>${members}</span></div>
      <div class="fpTeamWorkspaceStat"><strong>En ligne</strong><span>${online}</span></div>
      <div class="fpTeamWorkspaceStat"><strong>Activité</strong><span>Élevée</span></div>
    `;

    side.prepend(stats);

    const insights = document.createElement("div");
    insights.className = "fpTeamMemberInsights";
    insights.innerHTML = `
      <div class="fpTeamMemberInsightCard"><strong>Collaboration</strong><span>Ajoute des rôles précis pour structurer l’équipe.</span></div>
      <div class="fpTeamMemberInsightCard"><strong>Performance</strong><span>Assigne tâches et notes pour suivre l’exécution.</span></div>
    `;

    side.appendChild(insights);
  }

  function run(){
    if(getHash() !== "#team") return;
    removeHeaderVisioIfNeeded();
    enrichNotes();
    enrichMembers();
  }

  const obs = new MutationObserver(()=>run());

  document.addEventListener("DOMContentLoaded",()=>{
    obs.observe(document.body,{childList:true,subtree:true});
    run();
    window.addEventListener("hashchange",()=>setTimeout(run,80));
  });
})();
