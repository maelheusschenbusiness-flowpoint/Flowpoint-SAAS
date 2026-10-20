import { usePageTitle } from "@/hooks/use-page-title";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { SupportChat } from "@/components/SupportChat";
import { motion } from "framer-motion";
import { Briefcase, MapPin, Clock, Users, Rocket, Heart, Coffee, GraduationCap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { openMailto } from "@/lib/utils";

const fadeInUp = {
  // The initial state must remain visible in SSR and without JavaScript.
  hidden: { opacity: 1, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

export default function Careers() {
  usePageTitle("Carrières | Flowpoint");
  const benefits = [
    {
      icon: Rocket,
      title: "Croissance rapide",
      description: "Rejoignez une startup en pleine expansion avec des opportunités d'évolution.",
    },
    {
      icon: Heart,
      title: "Impact réel",
      description: "Aidez des entreprises à réussir leur croissance digitale.",
    },
    {
      icon: Coffee,
      title: "Flexibilité",
      description: "Télétravail partiel, horaires flexibles et équilibre vie pro/perso.",
    },
    {
      icon: GraduationCap,
      title: "Formation continue",
      description: "Auto-formation et accès à des ressources pour développer vos compétences.",
    },
  ];

  const openings = [
    {
      title: "Développeur Full-Stack Senior",
      department: "Technique",
      location: "Remote",
      type: "CDI",
      description: "Rejoignez notre équipe technique pour développer de nouvelles fonctionnalités et améliorer notre plateforme.",
    },
    {
      title: "Customer Success Manager",
      department: "Relation Client",
      location: "Remote",
      type: "CDI",
      description: "Accompagnez nos clients dans leur réussite et assurez leur satisfaction au quotidien.",
    },
    {
      title: "SEO Specialist",
      department: "Marketing",
      location: "Remote",
      type: "CDI",
      description: "Développez notre expertise SEO et créez du contenu pour aider nos utilisateurs.",
    },
    {
      title: "Business Developer",
      department: "Commercial",
      location: "Remote",
      type: "CDI",
      description: "Identifiez et développez de nouvelles opportunités commerciales pour accélérer notre croissance.",
    },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      <Navigation />

      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-indigo-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent dark:from-slate-900" />

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={stagger}
          >
            <motion.div variants={fadeInUp} className="mb-6">
              <Badge className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100">
                <Users className="h-3 w-3 mr-1" />
                Nous recrutons
              </Badge>
            </motion.div>
            <motion.h1
              variants={fadeInUp}
              className="text-4xl sm:text-5xl font-display font-bold text-slate-900 dark:text-slate-100 mb-6"
            >
              Rejoignez l'aventure Flowpoint
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto"
            >
              Participez à la transformation digitale des entreprises et aidez-les à prospérer en ligne.
            </motion.p>
          </motion.div>
        </div>
      </section>

      <section className="py-20 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="text-center mb-16"
          >
            <motion.h2
              variants={fadeInUp}
              className="text-3xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4"
            >
              Pourquoi nous rejoindre ?
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
              Chez Flowpoint, nous croyons que le travail doit être épanouissant et avoir du sens.
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-2 lg:grid-cols-4 gap-8"
          >
            {benefits.map((benefit, index) => (
              <motion.div
                key={index}
                variants={fadeInUp}
                className="text-center"
              >
                <div className="w-14 h-14 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <benefit.icon className="h-7 w-7 text-blue-600" />
                </div>
                <h3 className="font-display font-bold text-slate-900 dark:text-slate-100 mb-2">{benefit.title}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-300">{benefit.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="py-20 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="text-center mb-16"
          >
            <motion.h2
              variants={fadeInUp}
              className="text-3xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4"
            >
              Nos offres d'emploi
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
              Découvrez les postes ouverts et trouvez celui qui vous correspond.
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="space-y-4"
          >
            {openings.map((job, index) => (
              <motion.div key={index} variants={fadeInUp}>
                <Card className="p-6 hover-elevate cursor-pointer">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <h3 className="font-display font-bold text-lg text-slate-900 dark:text-slate-100">{job.title}</h3>
                        <Badge variant="secondary">{job.department}</Badge>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300 text-sm mb-3">{job.description}</p>
                      <div className="flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400 flex-wrap">
                        <span className="flex items-center gap-1">
                          <MapPin className="h-4 w-4" />
                          {job.location}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {job.type}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
                        if (isMobile) {
                          openMailto(`mailto:support@flowpoint.pro?subject=${encodeURIComponent(`Candidature – ${job.title}`)}&body=${encodeURIComponent(`Bonjour,\n\nJe souhaite postuler au poste : ${job.title}\n\nPrénom / Nom :\nExpérience :\nLien LinkedIn ou CV :\n\nMessage :\n`)}`);
                        } else {
                          window.location.assign("/contact");
                        }
                      }}
                      className="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium text-sm whitespace-nowrap transition-colors w-full lg:w-auto"
                    >
                      <Briefcase className="h-4 w-4" />
                      Postuler
                    </button>
                  </div>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="py-20 bg-gradient-to-br from-blue-600 to-indigo-600 dark:from-slate-900 dark:to-blue-950 text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
          >
            <motion.h2
              variants={fadeInUp}
              className="text-3xl font-display font-bold mb-4"
            >
              Vous ne trouvez pas le poste idéal ?
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-blue-100 mb-8 max-w-xl mx-auto">
              Envoyez-nous une candidature spontanée ! Nous sommes toujours à la recherche de talents passionnés.
            </motion.p>
            <motion.button
              variants={fadeInUp}
              onClick={() => {
                const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
                if (isMobile) {
                  openMailto(`mailto:support@flowpoint.pro?subject=${encodeURIComponent("Candidature spontanée – Flowpoint")}&body=${encodeURIComponent("Bonjour,\n\nJe vous adresse ma candidature spontanée.\n\nPrénom / Nom :\nPoste recherché :\nExpérience :\nLien LinkedIn ou CV :\n\nMessage :\n")}`);
                } else {
                  window.location.assign("/contact");
                }
              }}
              className="inline-flex items-center gap-2 bg-white text-blue-600 px-8 py-4 rounded-full font-semibold hover:bg-blue-50 transition-colors"
            >
              Envoyer ma candidature
            </motion.button>
          </motion.div>
        </div>
      </section>

      <Footer />
      <SupportChat />
    </div>
  );
}
