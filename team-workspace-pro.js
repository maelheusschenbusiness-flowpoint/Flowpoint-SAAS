(() => {
  'use strict';

  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const norm = (v) => String(v || '').toLowerCase();
  const getHash = () => (location.hash || '').toLowerCase();
  const getPlan = () => (q('#fpAccPlan')?.textContent || 'standard').trim();
  const getTrialText = () => (q('#fpAccTrial')?.textContent || '').trim();
  const isTrialLike = () => /essai|trial|jour|day/.test(norm(getTrialText()));
  const isProLike = () => /pro|ultra|premium/.test(norm(getPlan()));
  const isUltraLike = () => /ultra|enterprise/.test(norm(getPlan()));

  function ensureHeroInsights() {
    const root = q('[data-team-enhanced="true"]');
    if (!root || q('.fpTeamHeroInsightBar', root)) return;
    const hero = q('.fpTeamHeroBarRich', root);
    if (!hero) return;
    const mode = isTrialLike() ? 'Essai actif' : `Plan ${getPlan()}`;
    const trial = getTrialText() || 'Synchronisation en cours';
    const cards = [
      { title: mode, text: isTrialLike() ? 'Teste la collaboration équipe pendant l’essai pour valider le confort du produit.' : 'Le workspace équipe renforce l’organisation, la rétention et le suivi interne.' },
      { title: 'Quick wins', text: 'Coordonne par canal, centralise les notes et transforme le calendrier en vrai cockpit d’équipe.' },
      { title: isProLike() ? 'Fonctions avancées' : 'Upgrade conseillé', text: isProLike() ? 'Permissions, workflows plus riches et meilleure organisation peuvent être poussés encore plus loin.' : 'Le plan supérieur peut débloquer une expérience plus poussée pour l’équipe.' }
    ];
    const bar = document.createElement('div');
    bar.className = 'fpTeamHeroInsightBar';
    bar.innerHTML = `
      <div class="fpTeamHeroInsightHead">
        <div class="fpTeamHeroInsightBadge">${mode}</div>
        <div class="fpTeamHeroInsightMeta">${trial}</div>
      </div>
      <div class="fpTeamHeroInsightGrid">
        ${cards.map((c) => `<div class="fpTeamHeroInsightCard"><strong>${c.title}</strong><span>${c.text}</span></div>`).join('')}
      </div>
    `;
    hero.insertAdjacentElement('afterend', bar);
  }

  function addBlock(target, kicker, title, text, open = true) {
    if (!target) return;
    const wrap = document.createElement('div');
    wrap.className = 'fpTeamUpgradeDeck';
    wrap.innerHTML = `
      <div class="fpCardKicker">${kicker}</div>
      <div class="fpTeamUpgradeGrid">
        <div class="fpTeamUpgradeCard ${open ? 'is-open' : 'is-locked'}">
          <strong>${title}</strong>
          <span>${text}</span>
        </div>
      </div>
    `;
    target.appendChild(wrap);
  }

  function ensureChatExtras() {
    const tab = q('.fpTeamTab.active');
    if (!tab || !norm(tab.textContent).includes('chat')) return;
    const panel = q('.fpTeamChatPanelEnhanced');
    if (!panel || q('.fpTeamChatUtilityBar', panel)) return;
    const bar = document.createElement('div');
    bar.className = 'fpTeamChatUtilityBar';
    bar.innerHTML = `
      <div class="fpTeamChatUtilityItem"><strong>Canal plus clair</strong><span>Le fil reste central, les documents restent à droite et les conseils à gauche.</span></div>
      <div class="fpTeamChatUtilityItem ${isProLike() ? 'is-open' : 'is-locked'}"><strong>${isProLike() ? 'Préparé pour plus' : 'Bloc avancé'}</strong><span>${isProLike() ? 'Base prête pour épingles, snippets et réponses plus rapides.' : 'Une couche plus avancée peut encore être ajoutée plus tard.'}</span></div>
    `;
    q('.fpTeamHeader', panel)?.insertAdjacentElement('afterend', bar);
  }

  function ensureNotesExtras() {
    const tab = q('.fpTeamTab.active');
    if (!tab || !norm(tab.textContent).includes('notes')) return;
    const right = q('.fpTeamNotesLayout > .fpTeamPanel:last-child');
    if (!right || q('.fpTeamUpgradeDeck', right)) return;
    addBlock(right, 'Blocs utiles', isProLike() ? 'Bibliothèque enrichie' : 'Bibliothèque de notes', isProLike() ? 'Passe de la simple note à une vraie mémoire opérationnelle de l’équipe.' : 'Ajoute progressivement des templates : incident, réunion, passation, brief, décision.', true);
  }

  function ensureCalendarExtras() {
    const tab = q('.fpTeamTab.active');
    if (!tab || !norm(tab.textContent).includes('calendrier')) return;
    const dayView = q('.fpTeamDayView');
    if (!dayView || q('.fpTeamCalendarInfoStrip')) return;
    const strip = document.createElement('div');
    strip.className = 'fpTeamCalendarInfoStrip';
    strip.innerHTML = `
      <div class="fpTeamCalendarInfoCard"><strong>Usage idéal</strong><span>Réunions, deadlines, revues SEO, points monitor et organisation interne.</span></div>
      <div class="fpTeamCalendarInfoCard ${isUltraLike() ? 'is-open' : 'is-locked'}"><strong>${isUltraLike() ? 'Planification poussée' : 'Planification enrichie'}</strong><span>${isUltraLike() ? 'Le calendrier peut devenir un vrai planning équipe avancé.' : 'Cette base peut encore évoluer vers une vraie planification d’équipe.'}</span></div>
    `;
    dayView.insertAdjacentElement('beforebegin', strip);
  }

  function ensureMembersExtras() {
    const tab = q('.fpTeamTab.active');
    if (!tab || !norm(tab.textContent).includes('membres')) return;
    const side = q('.fpTeamMembersLayout .fpColSide .fpTeamPanel');
    if (!side || q('.fpTeamUpgradeDeck', side)) return;
    addBlock(side, 'Gestion d’équipe', isProLike() ? 'Permissions à pousser' : 'Équipe enrichie', isProLike() ? 'Le socle est prêt pour aller vers permissions, rôles fins et règles par canal.' : 'La page membres sert déjà de base pour un vrai annuaire interne plus crédible.', true);
  }

  function run() {
    if (getHash() !== '#team') return;
    ensureHeroInsights();
    ensureChatExtras();
    ensureNotesExtras();
    ensureCalendarExtras();
    ensureMembersExtras();
  }

  const observer = new MutationObserver(run);
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    run();
    window.addEventListener('hashchange', () => setTimeout(run, 80));
  });
})();
