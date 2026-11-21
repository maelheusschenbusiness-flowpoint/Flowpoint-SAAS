import { motion, useReducedMotion } from "framer-motion";
import { BrainCircuit, Check, ClipboardList, FileDown, KeyRound, LockKeyhole, Shield, UsersRound } from "lucide-react";
import "./home-premium-sections.css";

const providers = [
  { name: "OpenAI", models: "gpt-5-mini · gpt-5 · gpt-image-1" },
  { name: "Anthropic · Claude", models: "claude-haiku-4-5 · claude-sonnet-4-6 · claude-opus-4-8" },
  { name: "Google Gemini", models: "gemini-3-flash-preview · gemini-3.1-pro-preview" },
];

const roles = [
  { name: "Owner", detail: "Administration complète" },
  { name: "Admin", detail: "Accès et paramètres" },
  { name: "Member", detail: "Travail dans l’espace" },
  { name: "Viewer", detail: "Consultation" },
];

const reveal = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.65, ease: [0.22, 1, 0.36, 1] as const } },
};

export default function HomePremiumSections() {
  const reduceMotion = useReducedMotion();
  const motionProps = reduceMotion
    ? {}
    : { initial: "hidden" as const, whileInView: "visible" as const, viewport: { once: true, amount: 0.18 }, variants: reveal };

  return (
    <div className="fp-premium">
      <motion.section {...motionProps} className="fp-premium-ai" aria-labelledby="fp-premium-ai-title">
        <div className="fp-premium-shell fp-premium-ai-layout">
          <div className="fp-premium-copy">
            <span className="fp-premium-kicker"><i /> IA configurable</span>
            <h2 id="fp-premium-ai-title">Une assistance IA.<br /><em>Vos choix restent les vôtres.</em></h2>
            <p>FlowPoint s’appuie sur un assistant à outils. Par défaut, gpt-5-mini/gpt-5 servent au chat et aux missions; Claude Haiku 4.5/Sonnet 4.6/Opus 4.8 aux rapports et analyses SEO/CRO/marché; Gemini 3 Flash/3.1 Pro à l’analyse d’images; GPT-5 aux prévisions; gpt-image-1 à la génération d’images. Analyse, stratégie et action décrivent des étapes de travail — pas trois agents autonomes.</p>
            <p className="fp-premium-note">Le fournisseur, le modèle et l’intensité se règlent selon l’espace de travail. Le choix utilisé peut aussi varier selon la tâche.</p>
          </div>
          <div className="fp-premium-provider-panel" role="group" aria-label="Fournisseurs IA pris en charge">
            <div className="fp-premium-panel-heading"><span className="fp-premium-orbit"><BrainCircuit size={19} /></span><div><small>FOURNISSEURS PRIS EN CHARGE</small><b>Une configuration par espace</b></div></div>
            <div className="fp-premium-provider-list">
              {providers.map((provider, index) => <div className="fp-premium-provider" key={provider.name}>
                <span className="fp-premium-provider-index">0{index + 1}</span><div><b>{provider.name}</b><small>{provider.models}</small></div><Check size={15} aria-hidden="true" />
              </div>)}
            </div>
            <div className="fp-premium-config"><span>PRÉFÉRENCES D’ESPACE</span><div><i /> Fournisseur · modèle · intensité</div></div>
            <p className="fp-premium-disclosure">La disponibilité dans votre espace dépend de sa configuration. Pour certaines fonctions, le prompt et le contexte utile à la demande sont transmis au fournisseur IA sélectionné.</p>
          </div>
        </div>
      </motion.section>

      <motion.section {...motionProps} className="fp-premium-team" aria-labelledby="fp-premium-team-title">
        <div className="fp-premium-shell fp-premium-team-layout">
          <div className="fp-premium-team-intro">
            <span className="fp-premium-kicker"><i /> Pilotage d’équipe</span>
            <h2 id="fp-premium-team-title">Des responsabilités lisibles.<br /><em>Un espace mieux maîtrisé.</em></h2>
            <p>Les rôles intégrés structurent les accès. Les administrateurs gèrent les permissions et les rôles personnalisés, ainsi que les réglages de l’espace.</p>
            <div className="fp-premium-team-foot"><UsersRound size={17} /><span>Activité, journaux d’accès et d’audit, usage IA et crédits consultables.</span></div>
          </div>
          <div className="fp-premium-roles" role="group" aria-label="Rôles intégrés de l’espace">
            <div className="fp-premium-roles-head"><span>RÔLES DE L’ESPACE</span><span>Permissions gérées par les administrateurs</span></div>
            {roles.map((role, index) => <div className="fp-premium-role" key={role.name}>
              <span className="fp-premium-role-symbol">{index === 0 ? <KeyRound size={15} /> : <UsersRound size={15} />}</span>
              <b>{role.name}</b><span>{role.detail}</span><i className={`fp-premium-role-mark mark-${index}`} />
            </div>)}
            <div className="fp-premium-plan-strip">
              <span><ClipboardList size={16} /> Crédits IA inclus par mois</span>
              <span>Standard <b>100 000</b></span><span>Pro <b>500 000</b></span><span>Ultra <b>10 000 000</b></span>
            </div>
          </div>
        </div>
      </motion.section>

      <motion.section {...motionProps} className="fp-premium-security" aria-labelledby="fp-premium-security-title">
        <div className="fp-premium-shell fp-premium-security-layout">
          <div className="fp-premium-security-heading">
            <span className="fp-premium-kicker"><i /> Sécurité & confidentialité</span>
            <h2 id="fp-premium-security-title">Des contrôles concrets.<br /><em>Une transparence nécessaire.</em></h2>
            <p>Les accès, les actions et les données exportées sont encadrés par des contrôles côté plateforme.</p>
            <div className="fp-premium-security-illustration" aria-hidden="true">
              <div className="fp-premium-shield"><Shield size={31} /><span /></div>
              <div className="fp-premium-signal signal-one" /><div className="fp-premium-signal signal-two" />
              <span className="fp-premium-security-caption">ESPACE · ACCÈS · AUDIT</span>
            </div>
          </div>
          <div className="fp-premium-security-list">
            <article><span><LockKeyhole size={17} /></span><div><h3>Accès contextualisés</h3><p>Sessions côté serveur, contexte de base de données isolé par organisation et vérifications de rôles et permissions.</p></div></article>
            <article><span><Shield size={17} /></span><div><h3>Limites et protections</h3><p>Limitation de débit IA par organisation et en-têtes de sécurité en production, dont CSP et HSTS.</p></div></article>
            <article><span><ClipboardList size={17} /></span><div><h3>Actions suivies</h3><p>Propositions et actions d’outils sont journalisées. Les actions d’écriture ont un niveau de confirmation aperçu ou complet lorsqu’il est configuré.</p></div></article>
            <article><span><FileDown size={17} /></span><div><h3>Exports maîtrisés</h3><p>Rapports PDF et export JSON des données de l’organisation, réservé aux propriétaires et administrateurs. L’export JSON exclut les secrets OAuth, API et session, les moyens de paiement, jetons de partage, pièces jointes privées et prompts IA. Des métriques d’usage peuvent y figurer.</p></div></article>
            <p className="fp-premium-security-caveat">Le traitement dépend de la fonction utilisée : certaines demandes IA transmettent au fournisseur sélectionné le prompt et les éléments de contexte nécessaires.</p>
          </div>
        </div>
      </motion.section>
    </div>
  );
}
