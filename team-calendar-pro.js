(() => {
  "use strict";

  const CALENDAR_KEY = "fp_calendar_items_v3";
  const TEAM_STORE_KEY = "fp_team_workspace_v1";

  function getHash() {
    return (location.hash || "").toLowerCase();
  }

  function getWorkspace() {
    try {
      const raw = localStorage.getItem(TEAM_STORE_KEY);
      if (!raw) return {};
      return JSON.parse(raw) || {};
    } catch {
      return {};
    }
  }

  function saveWorkspace(ws) {
    try {
      localStorage.setItem(TEAM_STORE_KEY, JSON.stringify(ws));
    } catch {}
  }

  function getItems() {
    try {
      const raw = localStorage.getItem(CALENDAR_KEY);
      if (!raw) return [];
      return JSON.parse(raw) || [];
    } catch {
      return [];
    }
  }

  function saveItems(items) {
    localStorage.setItem(CALENDAR_KEY, JSON.stringify(items));
  }

  function dateOnly(value) {
    if (!value) return new Date().toISOString().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
    return d.toISOString().slice(0, 10);
  }

  function formatFull(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    });
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function buildMatrix(year, month, items) {
    const first = new Date(year, month, 1);
    const startDay = (first.getDay() + 6) % 7;
    const firstVisible = new Date(year, month, 1 - startDay);
    const cells = [];

    for (let i = 0; i < 42; i++) {
      const d = new Date(firstVisible);
      d.setDate(firstVisible.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      cells.push({
        iso,
        day: d.getDate(),
        currentMonth: d.getMonth() === month,
        today: iso === new Date().toISOString().slice(0, 10),
        items: items.filter(e => dateOnly(e.date) === iso)
      });
    }

    return cells;
  }

  function render() {
    if (getHash() !== "#team") return;

    const container = document.querySelector(".fpTeamShell");
    if (!container) return;

    const ws = getWorkspace();
    if (ws.currentTab !== "calendar") return;

    const now = new Date();
    const year = ws.calendarYear ?? now.getFullYear();
    const month = ws.calendarMonth ?? now.getMonth();
    const selected = ws.selectedDate || new Date().toISOString().slice(0, 10);

    ws.calendarYear = year;
    ws.calendarMonth = month;
    saveWorkspace(ws);

    const items = getItems();
    const matrix = buildMatrix(year, month, items);

    const monthLabel = capitalize(
      new Date(year, month).toLocaleDateString("fr-FR", { month: "long" })
    ) + " " + year;

    const selectedEvents = items.filter(e => dateOnly(e.date) === selected);

    container.innerHTML = `
      <div class="fpTeamCalendarPro">
        <div>
          <div class="fpTeamCalendarTopRow">
            <div class="fpTeamCalendarMonthCard">
              <div class="fpTeamCalendarHeaderLine">
                <div>
                  <div class="fpCardKicker">Calendrier workspace</div>
                  <h2 class="fpSectionTitle">${monthLabel}</h2>
                </div>
                <div class="fpTeamCalendarNav">
                  <button class="fpBtn fpBtnGhost" data-cal="prev">←</button>
                  <button class="fpBtn fpBtnGhost" data-cal="today">Aujourd'hui</button>
                  <button class="fpBtn fpBtnGhost" data-cal="next">→</button>
                </div>
              </div>

              <div class="fpTeamCalendarSelects">
                <select class="fpSelect" data-cal-select="month">
                  ${Array.from({length:12}).map((_,i)=>{
                    const name = capitalize(new Date(0,i).toLocaleDateString("fr-FR",{month:"long"}));
                    return `<option value="${i}" ${i===month?"selected":""}>${name}</option>`;
                  }).join("")}
                </select>
                <select class="fpSelect" data-cal-select="year">
                  ${Array.from({length:10}).map((_,i)=>{
                    const y = now.getFullYear() - 5 + i;
                    return `<option value="${y}" ${y===year?"selected":""}>${y}</option>`;
                  }).join("")}
                </select>
                <button class="fpBtn fpBtnPrimary" data-cal="new">Nouvel événement</button>
              </div>
            </div>

            <div class="fpTeamCalendarSelectedCard">
              <div class="fpCardKicker">Jour sélectionné</div>
              <div class="fpTeamCalendarSelectedTitle">${capitalize(formatFull(selected))}</div>
              <div class="fpTeamCalendarSelectedMeta">${selectedEvents.length} événement(s)</div>
              <div class="fpTeamCalendarSelectedActions">
                <button class="fpBtn fpBtnPrimary" data-cal="add-day">Ajouter sur ce jour</button>
              </div>
            </div>
          </div>

          <div class="fpTeamCalendarSurface">
            <div class="fpTeamCalendarWeekdays">
              ${["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"].map(d=>`<div>${d}</div>`).join("")}
            </div>

            <div class="fpTeamCalendarGridLuxury">
              ${matrix.map(c=>`
                <div class="fpTeamCalendarCell ${!c.currentMonth?"is-muted":""} ${c.today?"is-today":""} ${c.iso===selected?"is-selected":""}" data-cal-day="${c.iso}">
                  <div class="fpTeamCalendarTop">
                    <strong>${c.day}</strong>
                    ${c.items.length?`<span class="fpTeamCalendarCount">${c.items.length}</span>`:""}
                  </div>
                  <div class="fpTeamCalendarPills">
                    ${c.items.slice(0,3).map(e=>`<div class="fpTeamCalendarPill">${e.title}</div>`).join("")}
                  </div>
                </div>
              `).join("")}
            </div>
          </div>

          <div class="fpTeamCalendarTimelineCard">
            <div class="fpCardKicker">Planning du jour</div>
            <div class="fpTeamCalendarTimeline">
              ${["08:00","10:00","12:00","14:00","16:00","18:00"].map(t=>{
                const ev = selectedEvents.find(e=>e.time===t);
                return `
                  <div class="fpTeamCalendarSlot">
                    <div class="fpTeamCalendarSlotTime">${t}</div>
                    <div class="fpTeamCalendarSlotBody">
                      ${ev?`<div class="fpTeamCalendarEventCard"><strong>${ev.title}</strong><span>${ev.type||"Tâche"}</span></div>`:`<div class="fpTeamCalendarEventEmpty"></div>`}
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          </div>
        </div>

        <div class="fpTeamCalendarSide">
          <div class="fpTeamCalendarStatCard">
            <span>Total mois</span>
            <strong>${items.filter(e=>new Date(e.date).getMonth()===month).length}</strong>
            <small>Événements planifiés</small>
          </div>

          <div class="fpTeamCalendarUpcomingCard">
            <div class="fpCardKicker">À venir</div>
            <div class="fpTeamCalendarUpcomingList">
              ${items.slice(0,4).map(e=>`<div class="fpTeamCalendarUpcomingItem"><strong>${e.title}</strong><span>${e.date} · ${e.time||""}</span></div>`).join("")}
            </div>
          </div>

          <div class="fpTeamCalendarGate">
            <strong>Fonction avancée</strong>
            <span>Planification avancée, rappels et sync disponibles en Pro / Ultra.</span>
          </div>
        </div>
      </div>
    `;

    bind(ws, items);
  }

  function bind(ws, items) {
    document.querySelectorAll("[data-cal-day]").forEach(el=>{
      el.onclick = () => {
        ws.selectedDate = el.dataset.calDay;
        saveWorkspace(ws);
        render();
      };
    });

    document.querySelector("[data-cal='prev']")?.addEventListener("click",()=>{
      ws.calendarMonth--;
      if(ws.calendarMonth<0){ws.calendarMonth=11;ws.calendarYear--;}
      saveWorkspace(ws);
      render();
    });

    document.querySelector("[data-cal='next']")?.addEventListener("click",()=>{
      ws.calendarMonth++;
      if(ws.calendarMonth>11){ws.calendarMonth=0;ws.calendarYear++;}
      saveWorkspace(ws);
      render();
    });

    document.querySelector("[data-cal='today']")?.addEventListener("click",()=>{
      const d=new Date();
      ws.calendarMonth=d.getMonth();
      ws.calendarYear=d.getFullYear();
      ws.selectedDate=d.toISOString().slice(0,10);
      saveWorkspace(ws);
      render();
    });

    document.querySelector("[data-cal-select='month']")?.addEventListener("change",e=>{
      ws.calendarMonth=Number(e.target.value);
      saveWorkspace(ws);
      render();
    });

    document.querySelector("[data-cal-select='year']")?.addEventListener("change",e=>{
      ws.calendarYear=Number(e.target.value);
      saveWorkspace(ws);
      render();
    });

    document.querySelector("[data-cal='new']")?.onclick = ()=>openModal(ws);
    document.querySelector("[data-cal='add-day']")?.onclick = ()=>openModal(ws, ws.selectedDate);
  }

  function openModal(ws, datePrefill=""){
    let overlay=document.getElementById("fpTeamCalendarModalOverlay");
    if(!overlay){
      overlay=document.createElement("div");
      overlay.id="fpTeamCalendarModalOverlay";
      overlay.innerHTML=`<div class="fpTeamCalendarModalWrap"><div class="fpTeamCalendarModalCard"></div></div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener("click",e=>{if(e.target===overlay)overlay.classList.remove("show")});
    }

    const card=overlay.querySelector(".fpTeamCalendarModalCard");
    card.innerHTML=`
      <div class="fpTeamCalendarModalHead">
        <div>
          <div class="fpCardKicker">Calendrier</div>
          <div class="fpTeamCalendarModalTitle">Nouvel événement</div>
        </div>
        <button class="fpTeamCalendarModalClose">×</button>
      </div>

      <form class="fpTeamCalendarModalForm">
        <input class="fpInput" name="title" placeholder="Titre" />
        <input class="fpInput" type="date" name="date" value="${datePrefill}" />
        <input class="fpInput" type="time" name="time" />
        <input class="fpInput" name="type" placeholder="Type" />
        <textarea class="fpTextarea fpTeamCalendarModalTextarea" name="desc" placeholder="Description"></textarea>
        <div class="fpTeamCalendarModalActions">
          <button class="fpBtn fpBtnGhost" type="button">Annuler</button>
          <button class="fpBtn fpBtnPrimary" type="submit">Créer</button>
        </div>
      </form>
    `;

    overlay.classList.add("show");

    card.querySelector(".fpTeamCalendarModalClose").onclick=()=>overlay.classList.remove("show");
    card.querySelector(".fpBtnGhost").onclick=()=>overlay.classList.remove("show");

    card.querySelector("form").onsubmit=(e)=>{
      e.preventDefault();
      const fd=new FormData(e.target);
      const items=getItems();
      items.unshift({
        title:fd.get("title"),
        date:fd.get("date"),
        time:fd.get("time"),
        type:fd.get("type"),
        description:fd.get("desc")
      });
      saveItems(items);
      overlay.classList.remove("show");
      render();
    };
  }

  const observer=new MutationObserver(()=>{
    if(getHash()==="#team") render();
  });

  document.addEventListener("DOMContentLoaded",()=>{
    observer.observe(document.body,{childList:true,subtree:true});
    render();
    window.addEventListener("hashchange",()=>setTimeout(render,80));
  });
})();
