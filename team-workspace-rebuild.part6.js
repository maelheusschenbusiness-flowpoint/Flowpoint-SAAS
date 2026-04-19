// PARTIE 6 — notes premium + membres premium
(() => {
  "use strict";

  function isProPart6() {
    const plan = (document.getElementById("fpAccPlan")?.textContent || "standard").toLowerCase();
    return plan.includes("pro") || plan.includes("ultra");
  }

  function isUltraPart6() {
    const plan = (document.getElementById("fpAccPlan")?.textContent || "standard").toLowerCase();
    return plan.includes("ultra");
  }

  function fmtDatePart6(ts) {
    try {
      return new Date(ts).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch {
      return "Récemment";
    }
  }

  function selectedNotePart6(s) {
    return s.notes.find((n) => n.id === s.selectedNoteId) || s.notes[0] || null;
  }

  function selectedMemberPart6(s) {
    return s.members.find((m) => m.id === s.selectedMemberId) || s.members[0] || null;
  }

  function renderNotesPart6(s) {
    const note = selectedNotePart6(s);
    const pinnedCount = s.notes.filter((n) => n.pinned).length;

    return `
      <div class="fpTeamV2NotesLayout">
        <div class="fpTeamV2Panel">
          <div class="fpTeamV2SectionKicker">Notes</div>
          <div class="fpTeamV2SectionText">
            Notes internes, décisions, checklists, points client et mémoire d’exécution du workspace.
          </div>

          <div class="fpTeamV2NoteStats" style="margin-top:14px;">
            <div class="fpTeamV2Stat">
              <span>Total</span>
              <strong>${s.notes.length}</strong>
            </div>
            <div class="fpTeamV2Stat">
              <span>Pinned</span>
              <strong>${pinnedCount}</strong>
            </div>
            <div class="fpTeamV2Stat">
              <span>Type</span>
              <strong>${note ? note.type : "—"}</strong>
            </div>
          </div>

          <div class="fpTeamV2ActionRow" style="margin-top:14px;">
            <button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-open="note">Créer une note</button>
            <button class="fpTeamV2Btn fpTeamV2BtnGhost" data-open="note-template">Template</button>
          </div>

          <div class="fpTeamV2NotesList">
            ${s.notes.map((n) => `
              <button class="fpTeamV2NoteItem ${n.id === s.selectedNoteId ? "active" : ""}" data-note="${n.id}">
                <strong>${n.title}</strong>
                <span>${n.text.slice(0, 90)} · ${new Date(n.d).toLocaleDateString("fr-FR")}</span>
              </button>
            `).join("")}
          </div>
        </div>

        <div class="fpTeamV2Panel">
          <div class="fpTeamV2NoteHeader">
            <div>
              <div class="fpTeamV2SectionKicker">Note active</div>
              <div class="fpTeamV2SectionTitle">${note ? note.title : "Aucune note"}</div>
              <div class="fpTeamV2SectionText">
                ${note ? `${note.type} · Priorité ${note.priority} · ${note.author} · ${fmtDatePart6(note.d)}` : "Crée une note pour enrichir l’espace équipe."}
              </div>
            </div>

            <div class="fpTeamV2NoteActions">
              ${note ? `
                <button class="fpTeamV2Btn fpTeamV2BtnGhost" data-note-pin="${note.id}">${note.pinned ? "Désépingler" : "Pin"}</button>
                <button class="fpTeamV2Btn fpTeamV2BtnGhost" data-note-edit="${note.id}">Modifier</button>
                <button class="fpTeamV2Btn fpTeamV2BtnDanger" data-note-delete="${note.id}">Supprimer</button>
                <button class="fpTeamV2Btn fpTeamV2BtnGhost" data-open="visio">Visio</button>
              ` : ""}
            </div>
          </div>

          ${note ? `
            <div class="fpTeamV2InfoGrid" style="margin-bottom:14px;">
              <div class="fpTeamV2MetricCard">
                <strong>Type</strong>
                <span>${note.type}</span>
              </div>
              <div class="fpTeamV2MetricCard">
                <strong>Priorité</strong>
                <span>${note.priority}</span>
              </div>
              <div class="fpTeamV2MetricCard">
                <strong>Tags</strong>
                <span>${(note.tags || []).join(" · ")}</span>
              </div>
            </div>

            <div class="fpTeamV2NoteContent">${note.text}</div>

            <div class="fpTeamV2MiniList" style="margin-top:14px;">
              <div class="fpTeamV2MiniCard">
                <strong>Checklist</strong>
                <span>${(note.checklist || []).join(" · ") || "Aucune checklist"}</span>
              </div>
              <div class="fpTeamV2MiniCard">
                <strong>Usage</strong>
                <span>Utilise cette note pour garder une décision, un briefing, un suivi ou une checklist d’exécution visible dans le workspace.</span>
              </div>
              <div class="fpTeamV2MiniCard">
                <strong>Perspective premium</strong>
                <span>
                  ${isUltraPart6()
                    ? "Ultra débloque assignation de note, lien vers membre et lien vers calendrier pour une vraie logique de pilotage."
                    : isProPart6()
                      ? "Pro débloque templates plus riches, tags, priorités et meilleure structuration des notes."
                      : "Le plan standard garde une base claire. Les offres supérieures débloquent plus de structure."}
                </span>
              </div>
            </div>
          ` : `<div class="fpTeamV2Empty">Sélectionne une note.</div>`}
        </div>

        <div class="fpTeamV2SidebarCard">
          <strong>Bibliothèque d’usage</strong>
          <span>Transforme les notes en système d’exécution, pas juste en bloc de texte.</span>
          <div class="fpTeamV2MiniList">
            <div class="fpTeamV2MiniCard">
              <strong>Décision</strong>
              <span>Consigne les arbitrages pour éviter les pertes d’information.</span>
            </div>
            <div class="fpTeamV2MiniCard">
              <strong>Checklist</strong>
              <span>Prépare des modèles récurrents pour audits, incidents, suivis ou passations.</span>
            </div>
            <div class="fpTeamV2MiniCard">
              <strong>Vision</strong>
              <span>Garde une mémoire claire des points importants pour le workspace.</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderMembersPart6(s) {
    const member = selectedMemberPart6(s);
    const online = s.members.filter((m) => m.status === "online").length;

    return `
      <div class="fpTeamV2MembersLayout">
        <div class="fpTeamV2Panel">
          <div class="fpTeamV2MembersTop">
            <div>
              <div class="fpTeamV2SectionKicker">Membres</div>
              <div class="fpTeamV2SectionTitle">Équipe & rôles</div>
              <div class="fpTeamV2SectionText">
                Profils, dénominations, rôle, expertise, présence et pilotage de l’équipe.
              </div>
            </div>

            <div class="fpTeamV2MemberActions">
              <button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-open="member">Ajouter un membre</button>
              <button class="fpTeamV2Btn fpTeamV2BtnGhost" data-open="visio">Visio</button>
            </div>
          </div>

          <div class="fpTeamV2MemberStats">
            <div class="fpTeamV2Stat">
              <span>Membres</span>
              <strong>${s.members.length}</strong>
            </div>
            <div class="fpTeamV2Stat">
              <span>En ligne</span>
              <strong>${online}</strong>
            </div>
            <div class="fpTeamV2Stat">
              <span>Profils</span>
              <strong>${isProPart6() ? "Avancé" : "Base"}</strong>
            </div>
          </div>

          <div class="fpTeamV2MembersGrid" style="margin-top:16px;">
            ${s.members.map((m) => `
              <div class="fpTeamV2MemberCard ${m.id === s.selectedMemberId ? "active" : ""}">
                <div class="fpTeamV2MemberTop">
                  <div class="fpTeamV2Avatar">${m.avatar ? `<img src="${m.avatar}" alt="${m.name}">` : m.initials}</div>
                  <div class="fpTeamV2MemberMain">
                    <div class="fpTeamV2MemberRow">
                      <div class="fpTeamV2MemberName">${m.name}</div>
                      <div class="fpTeamV2Status ${m.status}">${m.status === "online" ? "En ligne" : "Hors ligne"}</div>
                    </div>
                    <div class="fpTeamV2MemberTitle">${m.title}</div>
                    <div class="fpTeamV2MemberRole">${m.role}</div>
                  </div>
                </div>

                <div class="fpTeamV2MemberBio">${m.bio}</div>

                <div class="fpTeamV2Tags">
                  ${(m.expertise || []).map((x) => `<span class="fpTeamV2Tag">${x}</span>`).join("")}
                </div>

                <div class="fpTeamV2MemberFooter">
                  <div class="fpTeamV2Subtle">${m.activity} · Charge ${m.load}%</div>
                  <div class="fpTeamV2InlineActions">
                    <button class="fpTeamV2Btn fpTeamV2BtnGhost" data-member-status="${m.id}">${m.status === "online" ? "Mettre hors ligne" : "Mettre en ligne"}</button>
                    <button class="fpTeamV2Btn fpTeamV2BtnGhost" data-member-select="${m.id}">Voir</button>
                    <button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-member-edit="${m.id}">Modifier</button>
                  </div>
                </div>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="fpTeamV2Stack">
          <div class="fpTeamV2SidebarCard">
            <strong>Profil sélectionné</strong>
            <span>${member ? `${member.name} · ${member.title}` : "Aucun membre"}</span>
            ${member ? `
              <div class="fpTeamV2MiniList">
                <div class="fpTeamV2MiniCard">
                  <strong>Focus</strong>
                  <span>${member.focus}</span>
                </div>
                <div class="fpTeamV2MiniCard">
                  <strong>Dernière activité</strong>
                  <span>${member.activity}</span>
                </div>
                <div class="fpTeamV2MiniCard">
                  <strong>Charge</strong>
                  <span>${member.load}% · ${member.status === "online" ? "Disponible" : "Non disponible"}</span>
                </div>
              </div>
            ` : ""}
          </div>

          <div class="fpTeamV2SidebarCard">
            <strong>Résumé workspace</strong>
            <span>Vue compacte du niveau de personnalisation membre.</span>
            <div class="fpTeamV2MiniList">
              <div class="fpTeamV2MiniCard">
                <strong>Présence</strong>
                <span>${online} membre(s) actuellement disponibles.</span>
              </div>
              <div class="fpTeamV2MiniCard">
                <strong>Rôles</strong>
                <span>Nom, titre, rôle, expertise et statut sont personnalisables.</span>
              </div>
              <div class="fpTeamV2MiniCard">
                <strong>Montée en gamme</strong>
                <span>
                  ${isUltraPart6()
                    ? "Ultra peut aller vers permissions fines, disponibilité, charge et assignations croisées."
                    : isProPart6()
                      ? "Pro peut enrichir l’équipe avec plus de structure, d’analytics et d’organisation."
                      : "Le trial montre la logique de base des profils d’équipe."}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // suite à venir dans la partie 7
})();
