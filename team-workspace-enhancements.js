(() => {
  "use strict";

  function getHash() {
    return (location.hash || "").toLowerCase();
  }

  function slugify(value) {
    return String(value || "room")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "room";
  }

  function buildRoomName() {
    const org = document.getElementById("fpAccOrg")?.textContent?.trim() || "flowpoint-team";
    const channel = document.querySelector(".fpTeamChannel.active .fpTeamChannelLabel")?.textContent?.trim() || "general";
    return `${slugify(org)}-${slugify(channel)}`;
  }

  function openVisio() {
    const room = buildRoomName();
    const url = `https://meet.jit.si/${encodeURIComponent(room)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function injectVisioButtons() {
    if (getHash() !== "#team") return;

    const heroActions = document.querySelector("[data-team-enhanced='true'] .fpTeamHeroBar .fpDetailActions");
    if (heroActions && !heroActions.querySelector("[data-team-visio='hero']")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fpBtn fpBtnGhost";
      btn.textContent = "Lancer visio";
      btn.setAttribute("data-team-visio", "hero");
      btn.addEventListener("click", openVisio);
      heroActions.prepend(btn);
    }

    const channelHeader = document.querySelector(".fpTeamHeader .fpBadge");
    if (channelHeader && !document.querySelector("[data-team-visio='header']")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fpBtn fpBtnSoft fpBtnSmall";
      btn.textContent = "Visio";
      btn.setAttribute("data-team-visio", "header");
      btn.addEventListener("click", openVisio);
      channelHeader.parentElement?.appendChild(btn);
    }
  }

  function patchMobileIssues() {
    if (getHash() !== "#team") return;

    const chatPanel = document.querySelector(".fpTeamWorkspace > .fpTeamPanel:nth-child(2)");
    const messages = document.querySelector(".fpTeamMessages");
    const composer = document.querySelector(".fpTeamComposer");

    if (chatPanel && messages) {
      chatPanel.classList.add("fpTeamChatPanelEnhanced");
      messages.classList.add("fpTeamMessagesEnhanced");
    }

    if (composer) {
      composer.classList.add("fpTeamComposerEnhanced");
    }

    document.querySelectorAll(".fpTeamCalendarCell").forEach((cell) => {
      cell.classList.add("fpTeamCalendarCellEnhanced");
    });
  }

  function runEnhancements() {
    injectVisioButtons();
    patchMobileIssues();
  }

  const observer = new MutationObserver(() => {
    if (getHash() === "#team") runEnhancements();
  });

  document.addEventListener("DOMContentLoaded", () => {
    observer.observe(document.body, { childList: true, subtree: true });
    runEnhancements();
    window.addEventListener("hashchange", () => setTimeout(runEnhancements, 80));
  });
})();
