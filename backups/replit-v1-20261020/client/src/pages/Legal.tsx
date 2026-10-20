import { usePageTitle } from "@/hooks/use-page-title";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { SupportChat } from "@/components/SupportChat";
import { motion } from "framer-motion";

const fadeInUp = {
  // The initial state must remain visible in SSR and without JavaScript.
  hidden: { opacity: 1, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

export default function Legal() {
  usePageTitle("Mentions légales | FlowPoint");

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      <Navigation />

      <section className="relative pt-32 pb-12 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-indigo-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent dark:from-slate-900" />

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={stagger}
          >
            <motion.h1
              variants={fadeInUp}
              className="text-4xl sm:text-5xl font-display font-bold text-slate-900 dark:text-slate-100 mb-6"
            >
              Mentions légales
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300"
            >
              Dernière mise à jour : Juillet 2026
            </motion.p>
          </motion.div>
        </div>
      </section>

      <section className="py-12 bg-white dark:bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="prose prose-slate dark:prose-invert max-w-none"
          >
            <motion.div variants={fadeInUp} className="mb-12">
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">1. Éditeur du site</h2>
              <div className="bg-white dark:bg-slate-900 rounded-lg p-6 space-y-2 text-slate-600 dark:text-slate-300">
                <p><strong>Raison sociale :</strong> FlowPoint</p>
                <p><strong>Entreprise exploitée exclusivement en ligne</strong></p>
                <p><strong>Numéro d'entreprise :</strong> 1038.273.845</p>
                <p><strong>TVA :</strong> BE1038.273.845</p>
                <p><strong>Directeur de la publication :</strong> Maël Heusschen</p>
                <p><strong>Email :</strong> support@flowpoint.pro</p>
                <p><strong>Type de service :</strong> 100% en ligne</p>
              </div>
            </motion.div>

            <motion.div variants={fadeInUp} className="mb-12">
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">2. Hébergement</h2>
              <div className="bg-white dark:bg-slate-900 rounded-lg p-6 space-y-2 text-slate-600 dark:text-slate-300">
                <p><strong>Hébergeur :</strong> Replit, Inc.</p>
                <p><strong>Adresse :</strong> 340 S Lemon Ave #7837, Walnut, CA 91789, USA</p>
                <p><strong>Site web :</strong> www.replit.com</p>
              </div>
            </motion.div>

            <motion.div variants={fadeInUp} className="mb-12">
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">3. Propriété intellectuelle</h2>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed mb-4">
                L'ensemble du contenu de ce site (textes, images, logos, graphismes, icônes, logiciels, etc.) est protégé et demeure la propriété exclusive de FlowPoint ou de ses partenaires et est protégé par les lois belges et internationales relatives à la propriété intellectuelle.
              </p>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed">
                Toute reproduction, représentation, modification, publication, transmission ou dénaturation, totale ou partielle du site ou de son contenu, par quelque procédé que ce soit, et sur quelque support que ce soit, est interdite sans l'autorisation écrite préalable de FlowPoint.
              </p>
            </motion.div>

            <motion.div variants={fadeInUp} className="mb-12">
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">4. Protection des données personnelles</h2>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed mb-4">
                Conformément au Règlement Général sur la Protection des Données (RGPD) et à la législation belge applicable, vous disposez d'un droit d'accès, de rectification, d'effacement et de portabilité de vos données personnelles.
              </p>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed mb-4">
                Les données collectées via les formulaires du site sont destinées exclusivement à FlowPoint et sont utilisées pour :
              </p>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-200 space-y-2 mb-4">
                <li>Répondre à vos demandes de contact</li>
                <li>Vous envoyer des informations sur nos services (avec votre consentement)</li>
                <li>Améliorer notre site et nos services</li>
              </ul>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed">
                Pour exercer vos droits ou pour toute question relative à vos données personnelles, contactez-nous à : support@flowpoint.pro
              </p>
            </motion.div>

            <motion.div variants={fadeInUp} className="mb-12">
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">5. Cookies</h2>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed mb-4">
                Ce site utilise des cookies pour améliorer l'expérience utilisateur et analyser le trafic. Les cookies utilisés sont :
              </p>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-200 space-y-2 mb-4">
                <li><strong>Cookies essentiels :</strong> nécessaires au fonctionnement du site</li>
                <li><strong>Cookies analytiques :</strong> pour mesurer l'audience et améliorer nos services</li>
                <li><strong>Cookies de préférences :</strong> pour mémoriser vos choix</li>
              </ul>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed">
                Vous pouvez modifier vos préférences à tout moment via notre bannière de gestion des cookies ou les paramètres de votre navigateur.
              </p>
            </motion.div>

            <motion.div variants={fadeInUp} className="mb-12">
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">6. Limitation de responsabilité</h2>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed mb-4">
                FlowPoint s'efforce d'assurer l'exactitude et la mise à jour des informations diffusées sur ce site. Toutefois, FlowPoint ne peut garantir l'exactitude, la précision ou l'exhaustivité des informations mises à disposition sur ce site.
              </p>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed">
                En conséquence, FlowPoint décline toute responsabilité pour tout dommage résultant d'une imprécision ou inexactitude des informations disponibles sur ce site.
              </p>
            </motion.div>

            <motion.div variants={fadeInUp} className="mb-12">
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">7. Liens hypertextes</h2>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed">
                Ce site peut contenir des liens vers d'autres sites internet. FlowPoint n'exerce aucun contrôle sur ces sites et décline toute responsabilité quant à leur contenu.
              </p>
            </motion.div>

            <motion.div variants={fadeInUp} className="mb-12">
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">8. Services proposés</h2>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed">
                FlowPoint est une plateforme SaaS accessible en ligne permettant notamment le suivi des performances digitales, le monitoring, l'analyse de données, l'automatisation de rapports et des fonctionnalités basées sur l'intelligence artificielle.
              </p>
            </motion.div>

            <motion.div variants={fadeInUp} className="mb-12">
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">9. Disponibilité</h2>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed">
                FlowPoint met en œuvre tous les moyens raisonnables pour assurer la disponibilité du service. Toutefois, une interruption temporaire liée à une maintenance, une mise à jour ou un incident technique peut survenir sans préavis.
              </p>
            </motion.div>

            <motion.div variants={fadeInUp} className="mb-12">
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">10. Droit applicable</h2>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed">
                Les présentes mentions légales sont soumises au droit belge. En cas de litige, et après échec de toute tentative de recherche d'une solution amiable, les tribunaux belges seront seuls compétents.
              </p>
            </motion.div>

            <motion.div variants={fadeInUp}>
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">11. Contact</h2>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed">
                Pour toute question concernant ces mentions légales, vous pouvez nous contacter à l'adresse email : support@flowpoint.pro
              </p>
            </motion.div>
          </motion.div>
        </div>
      </section>

      <Footer />
      <SupportChat />
    </div>
  );
}
