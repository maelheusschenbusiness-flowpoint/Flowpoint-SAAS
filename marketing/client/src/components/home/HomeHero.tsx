import { MotionConfig, motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  ChevronRight,
  Gauge,
  Layers3,
  Search,
  Sparkles,
} from "lucide-react";
import { trackSignupCta } from "@/lib/analytics";
import "./home-hero.css";

const signupUrl = "https://app.flowpoint.pro/signin.html";

const workspaceRows = [
  { icon: Search, title: "Recherche et SEO", detail: "Local · naturel · concurrence", action: "Explorer", tone: "blue" },
  { icon: Activity, title: "Santé du site", detail: "Disponibilité · incidents · alertes", action: "Surveiller", tone: "dark" },
  { icon: Gauge, title: "Performances web", detail: "Core Web Vitals · audits techniques", action: "Examiner", tone: "pale" },
  { icon: BarChart3, title: "Analyses", detail: "GA4 · trafic · parcours", action: "Explorer", tone: "blue" },
  { icon: Sparkles, title: "Flux de travail IA", detail: "Assistant · missions · gains rapides", action: "Agir", tone: "blue" },
  { icon: Layers3, title: "Rapports", detail: "Direction · conversions · SLA", action: "Partager", tone: "soft" },
];

const reveal = {
  hidden: { opacity: 0.88, y: 12, scale: 0.995 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] as const },
  },
};

function WorkspaceIllustration() {
  return (
    <div className="fp-home-board-art" role="img" aria-label="Aperçu illustratif de l’espace de travail FlowPoint">
      <div className="fp-home-board-window">
        <div className="fp-home-board-topbar">
          <div className="fp-home-board-brand">
            <span className="fp-home-board-mark">F</span>
            <strong className="notranslate" translate="no">FlowPoint</strong>
            <span className="fp-home-board-divider" />
            Espace de travail
          </div>
          <span className="fp-home-board-connected">Vue illustrative</span>
        </div>
        <div className="fp-home-board-layout">
          <div className="fp-home-board-main">
            <div className="fp-home-board-heading">
              <div><span>APERÇU / CROISSANCE NUMÉRIQUE</span><h2>Votre espace de travail</h2></div>
              <span className="fp-home-board-range">Tous les domaines <ChevronRight size={12} /></span>
            </div>
            <div className="fp-home-board-table">
              <div className="fp-home-board-columns"><span>DOMAINE</span><span>CONTENU</span><span>SUITE</span></div>
              {workspaceRows.map((row) => {
                const Icon = row.icon;
                return (
                  <div
                    className="fp-home-board-row"
                    key={row.title}
                  >
                    <span className="fp-home-board-area">
                      <i className={`fp-home-row-icon ${row.tone}`}><Icon /></i><b>{row.title}</b>
                    </span>
                    <span className="fp-home-board-detail">{row.detail}</span>
                    <span className={`fp-home-board-pill ${row.tone}`}>{row.action}</span>
                  </div>
                );
              })}
            </div>
            <div className="fp-home-board-footer">
              <span>Vue illustrative · aucune donnée en direct</span><span>Six domaines fonctionnels</span>
            </div>
          </div>
          <motion.aside
            className="fp-home-board-agent"
            aria-label="Panneau illustratif de l’assistant FlowPoint"
            initial={{ opacity: 0.9, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.48, delay: 0.52, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="fp-home-agent-head">
              <span className="fp-home-agent-avatar"><Sparkles size={16} /></span>
              <span><b>Assistant <span className="notranslate" translate="no">FlowPoint</span></b><small>Analysez vos signaux</small></span>
              <span className="fp-home-agent-menu" aria-hidden="true">•••</span>
            </div>
            <div className="fp-home-agent-question">
              <span>QUESTION EXEMPLE</span><b>Sur quoi me concentrer ensuite&nbsp;?</b>
            </div>
            <p className="fp-home-agent-copy">Réunissez les bons signaux avant de choisir la prochaine étape.</p>
            <div className="fp-home-agent-list-label">PISTES À EXAMINER</div>
            <ul className="fp-home-agent-lenses">
              <li><Activity size={14} /><span>Examiner la disponibilité et les alertes d’incident</span></li>
              <li><Gauge size={14} /><span>Vérifier les Core Web Vitals et les audits</span></li>
              <li><BarChart3 size={14} /><span>Explorer le trafic GA4 et les parcours</span></li>
              <li><Layers3 size={14} /><span>Préparer un rapport de direction ou de SLA</span></li>
            </ul>
            <div className="fp-home-agent-compose">
              <span>Posez une question sur votre activité numérique…</span>
              <span className="fp-home-agent-send"><ArrowUpRight size={13} /></span>
            </div>
            <span className="fp-home-agent-note">Panneau illustratif · pas un écran produit en direct</span>
          </motion.aside>
        </div>
      </div>
      <span className="fp-home-board-stamp">FLOWPOINT / DES SIGNAUX AUX DÉCISIONS</span>
    </div>
  );
}

export function HomeHero() {
  return (
    <MotionConfig reducedMotion="user">
      <section id="top" className="fp-home-hero">
        <div className="fp-home-hero-wrap">
          <motion.div
            className="fp-home-hero-intro"
            initial="hidden"
            animate="visible"
            variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.1, delayChildren: 0.04 } } }}
          >
            <motion.div variants={reveal}>
              <div className="fp-home-eyebrow">Des analyses assistées par IA. Des décisions prises par votre équipe.</div>
            </motion.div>
            <motion.h1 variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.12 } } }}>
              <motion.span className="fp-home-hero-title-line" variants={reveal}>Gagnez plus de clients</motion.span>
              {" "}
              <motion.span className="fp-home-hero-title-line" variants={reveal}><em>avec moins d’incertitudes</em></motion.span>
            </motion.h1>
            <motion.p variants={reveal} className="fp-home-hero-copy">
              Réunissez la santé de votre site, votre visibilité dans les recherches, les Core Web Vitals, les parcours GA4, les campagnes et les rapports dans un seul espace. L’IA met en lumière les informations utiles ; votre équipe les examine, fixe ses priorités et choisit la suite.
            </motion.p>
            <motion.div variants={reveal} className="fp-home-hero-actions">
              <a
                className="fp-home-button"
                href={signupUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackSignupCta("home_hero")}
              >
                Découvrir FlowPoint <ArrowRight size={16} />
              </a>
              <a className="fp-home-text-link" href="/features">Voir toutes les fonctionnalités <ArrowRight size={14} /></a>
            </motion.div>
            <motion.div variants={reveal} className="fp-home-proofline">
              <span><strong>Un espace de travail connecté.</strong> Pour les entreprises locales et les équipes qui les accompagnent.</span>
            </motion.div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0.9, y: 10, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.52, delay: 0.44, ease: [0.22, 1, 0.36, 1] }}
          >
            <WorkspaceIllustration />
          </motion.div>
        </div>
      </section>
    </MotionConfig>
  );
}
