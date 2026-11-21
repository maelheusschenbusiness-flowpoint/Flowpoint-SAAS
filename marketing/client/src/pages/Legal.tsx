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
  usePageTitle("Legal notice | FlowPoint");

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      <Navigation language="en" />

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
              Legal notice
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300"
            >
              Last updated: October 24, 2026
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
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">1. Website publisher</h2>
              <div className="bg-white dark:bg-slate-900 rounded-lg p-6 space-y-2 text-slate-600 dark:text-slate-300">
                <p><strong>Company name:</strong> FlowPoint</p>
                <p><strong>Operated exclusively online</strong></p>
                <p><strong>Company number:</strong> 1038.273.845</p>
                <p><strong>VAT:</strong> BE1038.273.845</p>
                <p><strong>Publisher:</strong> Maël Heusschen</p>
                <p><strong>Email:</strong> support@flowpoint.pro</p>
                <p><strong>Service type:</strong> Online-only</p>
              </div>
            </motion.div>

            <motion.div variants={fadeInUp} className="mb-12">
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">2. Hosting</h2>
              <div className="bg-white dark:bg-slate-900 rounded-lg p-6 space-y-2 text-slate-600 dark:text-slate-300">
                <p><strong>Application hosting:</strong> Render</p>
                <p><strong>Database:</strong> MongoDB Atlas</p>
              </div>
            </motion.div>

            <motion.div variants={fadeInUp} className="mb-12">
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">3. Intellectual property</h2>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed mb-4">
                All content on this website (including text, images, logos, graphics, icons and software) is protected and remains the exclusive property of FlowPoint or its partners under Belgian and international intellectual property laws.
              </p>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed">
                Reproducing, displaying, modifying, publishing, transmitting or altering any part of this website or its content, by any means or on any medium, is prohibited without FlowPoint's prior written permission.
              </p>
            </motion.div>

            <motion.div variants={fadeInUp} className="mb-12">
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">4. Personal data protection</h2>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed mb-4">
                Under the General Data Protection Regulation (GDPR) and applicable Belgian law, you have the right to access, rectify, erase and port your personal data.
              </p>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed mb-4">
                Data collected through website forms is intended solely for FlowPoint and is used to:
              </p>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-200 space-y-2 mb-4">
                <li>Respond to your contact requests</li>
                <li>Send information about our services, with your consent</li>
                <li>Improve our website and services</li>
              </ul>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed">
                To exercise your rights or ask a question about your personal data, contact us at support@flowpoint.pro.
              </p>
            </motion.div>

            <motion.div variants={fadeInUp} className="mb-12">
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">5. Cookies</h2>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed mb-4">
                This website uses cookies to improve the user experience and analyze traffic. The cookies used include:
              </p>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-200 space-y-2 mb-4">
                <li><strong>Essential cookies:</strong> required for the website to function</li>
                <li><strong>Analytics cookies:</strong> used to measure traffic and improve our services</li>
                <li><strong>Preference cookies:</strong> used to remember your choices</li>
              </ul>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed">
                You can change your preferences at any time through the cookie settings banner or your browser settings.
              </p>
            </motion.div>

            <motion.div variants={fadeInUp} className="mb-12">
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">6. Limitation of liability</h2>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed mb-4">
                FlowPoint makes reasonable efforts to keep the information on this website accurate and up to date. However, FlowPoint cannot guarantee that the information is accurate, precise or complete.
              </p>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed">
                Accordingly, FlowPoint accepts no liability for damage resulting from inaccurate or incomplete information available on this website.
              </p>
            </motion.div>

            <motion.div variants={fadeInUp} className="mb-12">
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">7. External links</h2>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed">
                This website may contain links to other websites. FlowPoint does not control those websites and accepts no responsibility for their content.
              </p>
            </motion.div>

            <motion.div variants={fadeInUp} className="mb-12">
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">8. Services offered</h2>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed">
                FlowPoint is an online SaaS platform that provides digital performance tracking, monitoring, data analysis, report automation and features powered by artificial intelligence.
              </p>
            </motion.div>

            <motion.div variants={fadeInUp} className="mb-12">
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">9. Availability</h2>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed">
                FlowPoint makes reasonable efforts to keep the service available. Temporary interruptions for maintenance, updates or technical incidents may occur without notice.
              </p>
            </motion.div>

            <motion.div variants={fadeInUp} className="mb-12">
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">10. Governing law</h2>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed">
                This legal notice is governed by Belgian law. If a dispute cannot be resolved amicably, the Belgian courts will have exclusive jurisdiction.
              </p>
            </motion.div>

            <motion.div variants={fadeInUp}>
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">11. Contact</h2>
              <p className="text-slate-600 dark:text-slate-200 leading-relaxed">
                For questions about this legal notice, contact us at support@flowpoint.pro.
              </p>
            </motion.div>
          </motion.div>
        </div>
      </section>

      <Footer language="en" />
      <SupportChat />
    </div>
  );
}
