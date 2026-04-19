// PARTIE 4 — coeur du chat : messages, composer, docs, activité
(() => {
  "use strict";

  function fmtDatePart4(ts) {
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

  function shortDatePart4(ts) {
    try {
      return new Date(ts).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit"
      });
    } catch {
      return "—";
    }
  }

  function isProPart4() {
    const plan = (document.getElementById("fpAccPlan")?.textContent || "standard").toLowerCase();
    return plan.includes("pro") || plan.includes("ultra");
  }

  function renderChatCorePart4(s) {
    const ch = s.channels.find((c) => c.id === s.currentChannel) || s.channels[0];
    const msgs = s.messages.filter((m) => m.c === ch.id).sort((a, b) => a.d - b.d);
    const docs = s.docs.filter((d) => d.c === ch.id).sort((a, b) => b.d - a.d).slice(0, 6);

    return `
      <div class="fpTeamV2MessagesWrap">
        <div>
          <div class="fpTeamV2Messages">
            ${msgs.length ? msgs.map((m) => `
              <article class="fpTeamV2Message">
                <div class="fpTeamV2Avatar">${(m.a || "U").slice(0, 1).toUpperCase()}</div>
                <div>
                  <div class="fpTeamV2MessageTop">
                    <strong>${m.a}</strong>
                    <span class="fpTeamV2MessageMeta">${m.role || "member"}</span>
                    <span class="fpTeamV2MessageMeta">${fmtDatePart4(m.d)}</span>
                  </div>

                  <div class="fpTeamV2MessageText">${m.t}</div>

                  ${m.attachments && m.attachments.length ? `
                    <div class="fpTeamV2Attachments">
                      ${m.attachments.map((f) => `
                        <div class="fpTeamV2Attachment">
                          <div class="fpTeamV2Hash">${(f.type || "F").slice(0, 1)}</div>
                          <div>
                            <strong>${f.name}</strong>
                            <span>${f.type || "DOC"} · ${f.size || "Pièce jointe"}</span>
                          </div>
                        </div>
                      `).join("")}
                    </div>
                  ` : ""}
                </div>
              </article>
            `).join("") : `
              <div class="fpTeamV2Empty">Aucun message dans ce canal.</div>
            `}
          </div>

          <div class="fpTeamV2Composer">
            <div class="fpTeamV2SectionKicker">Nouveau message</div>
            <div class="fpTeamV2SectionText">
              Fil scrollable, saisie mieux positionnée, actions visibles et documents liés au même endroit.
            </div>

            <div class="fpTeamV2ComposerGrid">
              <div class="fpTeamV2ComposerMain">
                <textarea
                  id="fpTeamV2MessageInput"
                  class="fpTeamV2Textarea"
                  placeholder="Écris un message utile, une décision, une consigne ou un suivi précis..."
                ></textarea>

                <div class="fpTeamV2ComposerHint">
                  <div class="fpTeamV2MiniCard">
                    <strong>Annonce</strong>
                    <span>Décision visible, arbitrage ou point de coordination.</span>
                  </div>
                  <div class="fpTeamV2MiniCard">
                    <strong>Contexte</strong>
                    <span>Ajoute le document ou le détail utile sans noyer le message.</span>
                  </div>
                  <div class="fpTeamV2MiniCard">
                    <strong>Action</strong>
                    <span>Indique la prochaine étape ou le point à exécuter.</span>
                  </div>
                </div>

                <div class="fpTeamV2PendingFiles">
                  ${(s.draftAttachments || []).length
                    ? s.draftAttachments.map((f, i) => `
                        <div class="fpTeamV2FileChip">
                          ${f.name}
                          <button data-remove-file="${i}">×</button>
                        </div>
                      `).join("")
                    : ""}
                </div>
              </div>

              <div class="fpTeamV2ComposerAside">
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
            <span>Pièces utiles pour éviter de perdre briefs, exports et documents opérationnels.</span>

            <div class="fpTeamV2DocList">
              ${docs.length ? docs.map((d) => `
                <div class="fpTeamV2DocItem">
                  <strong>${d.name}</strong>
                  <span>${d.type} · ${d.size} · ${d.by} · ${shortDatePart4(d.d)}</span>
                </div>
              `).join("") : `
                <div class="fpTeamV2Empty">Aucun document récent dans ce canal.</div>
              `}
            </div>
          </div>

          <div class="fpTeamV2SidebarCard">
            <strong>Activité récente</strong>
            <span>Flux compact des dernières actions liées au workspace.</span>

            <div class="fpTeamV2ActivityCards">
              ${s.activity.slice(0, 5).map((it) => `
                <div class="fpTeamV2MiniCard">
                  <strong>${it.title}</strong>
                  <span>${it.text} · ${shortDatePart4(it.d)}</span>
                </div>
              `).join("")}
            </div>
          </div>

          <div class="fpTeamV2SidebarCard">
            <strong>Analytics du canal</strong>
            <span>Lecture rapide du niveau d’usage et du contexte du canal actif.</span>

            <div class="fpTeamV2InfoGrid" style="margin-top:12px;">
              <div class="fpTeamV2Stat">
                <span>Messages</span>
                <strong>${msgs.length}</strong>
              </div>
              <div class="fpTeamV2Stat">
                <span>Docs</span>
                <strong>${docs.length}</strong>
              </div>
              <div class="fpTeamV2Stat">
                <span>Actifs</span>
                <strong>${s.members.filter((m) => m.status === "online").length}</strong>
              </div>
            </div>

            ${isProPart4() ? `
              <div class="fpTeamV2MiniList" style="margin-top:12px;">
                <div class="fpTeamV2MiniCard">
                  <strong>Recommandation Pro</strong>
                  <span>Épingle ici tes décisions clés, points client ou docs de référence pour garder une lecture premium.</span>
                </div>
              </div>
            ` : ""}
          </div>
        </div>
      </div>
    `;
  }

  // suite à venir dans la partie 5
})();
