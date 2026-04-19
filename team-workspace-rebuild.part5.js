// PARTIE 5 — calendrier premium
(() => {
  "use strict";

  function monthLabelPart5(year, month) {
    const text = new Date(year, month, 1).toLocaleDateString("fr-FR", {
      month: "long",
      year: "numeric"
    });
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function fullDayLabelPart5(dateStr) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "Jour sélectionné";
    const text = d.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    });
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function todayIsoPart5() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function isProPart5() {
    const plan = (document.getElementById("fpAccPlan")?.textContent || "standard").toLowerCase();
    return plan.includes("pro") || plan.includes("ultra");
  }

  function isUltraPart5() {
    const plan = (document.getElementById("fpAccPlan")?.textContent || "standard").toLowerCase();
    return plan.includes("ultra");
  }

  function buildCalendarCellsPart5(s) {
    const first = new Date(s.viewYear, s.viewMonth, 1);
    const startDay = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(s.viewYear, s.viewMonth + 1, 0).getDate();
    const prevMonthDays = new Date(s.viewYear, s.viewMonth, 0).getDate();
    const cells = [];

    for (let i = 0; i < 42; i += 1) {
      let year = s.viewYear;
      let month = s.viewMonth;
      let day;
      let muted = false;

      if (i < startDay) {
        muted = true;
        month = s.viewMonth - 1;
        if (month < 0) {
          month = 11;
          year -= 1;
        }
        day = prevMonthDays - startDay + i + 1;
      } else if (i >= startDay + daysInMonth) {
        muted = true;
        month = s.viewMonth + 1;
        if (month > 11) {
          month = 0;
          year += 1;
        }
        day = i - (startDay + daysInMonth) + 1;
      } else {
        day = i - startDay + 1;
      }

      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const events = s.events.filter((e) => e.date === iso).slice(0, 2);
      const count = s.events.filter((e) => e.date === iso).length;

      cells.push({
        iso,
        day,
        muted,
        isToday: iso === todayIsoPart5(),
        isSelected: iso === s.selectedDate,
        events,
        count
      });
    }

    return cells;
  }

  function selectedDateEventsPart5(s) {
    return s.events
      .filter((e) => e.date === s.selectedDate)
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));
  }

  function renderCalendarPart5(s) {
    const cells = buildCalendarCellsPart5(s);
    const dayEvents = selectedDateEventsPart5(s);
    const weekdays = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
    const upcoming = s.events
      .slice()
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
      .slice(0, 4);

    return `
      <div class="fpTeamV2CalendarLayout">
        <div class="fpTeamV2Panel">
          <div class="fpTeamV2CalendarHeader">
            <div>
              <div class="fpTeamV2SectionKicker">Calendrier workspace</div>
              <div class="fpTeamV2SectionTitle">${monthLabelPart5(s.viewYear, s.viewMonth)}</div>
              <div class="fpTeamV2SectionText">
                Vue agenda plus propre, navigation mois/année, jour sélectionné visible en haut et événements mieux structurés.
              </div>
            </div>

            <div class="fpTeamV2CalendarNav">
              <button class="fpTeamV2Btn fpTeamV2BtnGhost" data-cal-nav="prev">Mois précédent</button>
              <button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-open="event">Nouvel événement</button>
              <button class="fpTeamV2Btn fpTeamV2BtnGhost" data-cal-nav="next">Mois suivant</button>
            </div>
          </div>

          <div class="fpTeamV2CalendarSurface">
            <div class="fpTeamV2Weekdays">
              ${weekdays.map((w) => `<div>${w}</div>`).join("")}
            </div>

            <div class="fpTeamV2CalendarGrid">
              ${cells.map((cell) => `
                <button
                  class="fpTeamV2DayCard ${cell.muted ? "isMuted" : ""} ${cell.isToday ? "isToday" : ""} ${cell.isSelected ? "isSelected" : ""}"
                  data-select-date="${cell.iso}"
                >
                  <div class="fpTeamV2DayTop">
                    <strong>${cell.day}</strong>
                    ${cell.count ? `<span class="fpTeamV2DayCount">${cell.count}</span>` : ""}
                  </div>

                  <div class="fpTeamV2DayPills">
                    ${cell.events.map((e) => `
                      <div class="fpTeamV2DayPill ${e.type || "task"}">${e.title}</div>
                    `).join("")}
                  </div>
                </button>
              `).join("")}
            </div>
          </div>
        </div>

        <div class="fpTeamV2Stack">
          <div class="fpTeamV2SelectedCard">
            <div class="fpTeamV2SectionKicker">Jour sélectionné</div>
            <div class="fpTeamV2SelectedTitle">${fullDayLabelPart5(s.selectedDate)}</div>

            <div class="fpTeamV2SelectedActions">
              <button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-open="event">Ajouter un événement</button>
              <button class="fpTeamV2Btn fpTeamV2BtnGhost" data-open="event-quick">Ajouter sur ce jour</button>
            </div>

            <div class="fpTeamV2Timeline">
              ${dayEvents.length ? dayEvents.map((e) => `
                <div class="fpTeamV2TimelineRow">
                  <div class="fpTeamV2TimelineTime">${e.time}</div>
                  <div class="fpTeamV2TimelineBody">
                    <div class="fpTeamV2TimelineEvent">
                      <strong>${e.title}</strong>
                      <span>${e.desc || "Événement workspace."} · ${e.assignee || "Équipe"}</span>
                    </div>
                  </div>
                </div>
              `).join("") : `
                <div class="fpTeamV2Empty">
                  Aucun événement sur cette journée. Tu peux ajouter une réunion, une tâche, un suivi client ou un checkpoint de stabilité.
                </div>
              `}
            </div>
          </div>

          <div class="fpTeamV2SidebarCard">
            <strong>À venir</strong>
            <span>Événements les plus proches visibles sans avoir à descendre tout en bas de la page.</span>
            <div class="fpTeamV2UpcomingList">
              ${upcoming.map((e) => `
                <div class="fpTeamV2UpcomingItem">
                  <strong>${e.title}</strong>
                  <span>${fullDayLabelPart5(e.date)} · ${e.time} · ${e.assignee || "Équipe"}</span>
                </div>
              `).join("")}
            </div>
          </div>

          <div class="fpTeamV2SidebarCard">
            <strong>Analytics calendrier</strong>
            <span>Petite lecture de charge et d’usage du mois affiché.</span>

            <div class="fpTeamV2InfoGrid" style="margin-top:12px;">
              <div class="fpTeamV2Stat">
                <span>Mois</span>
                <strong>${s.events.filter((e) => {
                  const d = new Date(e.date);
                  return d.getFullYear() === s.viewYear && d.getMonth() === s.viewMonth;
                }).length}</strong>
              </div>
              <div class="fpTeamV2Stat">
                <span>Réunions</span>
                <strong>${s.events.filter((e) => e.type === "meeting").length}</strong>
              </div>
              <div class="fpTeamV2Stat">
                <span>Suivis</span>
                <strong>${s.events.filter((e) => e.type !== "meeting").length}</strong>
              </div>
            </div>

            ${isProPart5() ? `
              <div class="fpTeamV2MiniList" style="margin-top:12px;">
                <div class="fpTeamV2MiniCard">
                  <strong>Pro</strong>
                  <span>Ajoute catégories, priorité, personne assignée et meilleure lecture par charge.</span>
                </div>
              </div>
            ` : ""}

            ${isUltraPart5() ? `
              <div class="fpTeamV2MiniList" style="margin-top:12px;">
                <div class="fpTeamV2MiniCard">
                  <strong>Ultra</strong>
                  <span>Ultra peut monter sur planning analytique, charge par membre et coordination plus fine.</span>
                </div>
              </div>
            ` : ""}
          </div>
        </div>
      </div>
    `;
  }

  // suite à venir dans la partie 6
})();
