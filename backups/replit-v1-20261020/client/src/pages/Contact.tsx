import { usePageTitle } from "@/hooks/use-page-title";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { SupportChat } from "@/components/SupportChat";
import { motion } from "framer-motion";
import { Mail, MapPin, Globe, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { useState } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/analytics";

const fadeInUp = {
  // The initial state must remain visible in SSR and without JavaScript.
  hidden: { opacity: 1, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

export default function Contact() {
  usePageTitle("Contact | Flowpoint");
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Erreur inconnue");

      trackEvent("contact_form_submitted", { location: "contact_page" });
      navigate("/merci");
    } catch (err: any) {
      trackEvent("contact_form_submission_failed", { location: "contact_page" });
      toast({
        title: "Échec de l'envoi",
        description: err.message || "Contactez-nous directement à support@flowpoint.pro",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const contactInfo = [
    {
      icon: Mail,
      title: "Email",
      content: "support@flowpoint.pro",
      description: "Pour toutes vos questions",
    },
    {
      icon: MapPin,
      title: "Adresse",
      content: "Entreprise 100% en ligne",
      description: "Pas de site physique",
    },
    {
      icon: Globe,
      title: "Service",
      content: "100% en ligne",
      description: "Disponible partout",
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
            <motion.h1
              variants={fadeInUp}
              className="text-4xl sm:text-5xl font-display font-bold text-slate-900 dark:text-slate-100 mb-6"
            >
              Contactez-nous
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto"
            >
              Une question ? Un projet ? Notre équipe est là pour vous accompagner dans votre développement digital.
            </motion.p>
          </motion.div>
        </div>
      </section>

      <section className="py-20 bg-white dark:bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="flex flex-col gap-12"
          >
            {/* Formulaire pleine largeur */}
            <motion.div variants={fadeInUp}>
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-8">
                Envoyez-nous un message
              </h2>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="contact-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Nom complet
                    </label>
                    <Input
                      id="contact-name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Jean Dupont"
                      required
                      data-testid="input-contact-name"
                    />
                  </div>
                  <div>
                    <label htmlFor="contact-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Email
                    </label>
                    <Input
                      id="contact-email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="jean@exemple.fr"
                      required
                      data-testid="input-contact-email"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="contact-subject" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Sujet
                  </label>
                  <Input
                    id="contact-subject"
                    value={formData.subject}
                    onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                    placeholder="Comment pouvons-nous vous aider ?"
                    required
                    data-testid="input-contact-subject"
                  />
                </div>
                <div>
                  <label htmlFor="contact-message" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Message
                  </label>
                  <Textarea
                    id="contact-message"
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    placeholder="Décrivez votre demande..."
                    rows={6}
                    required
                    data-testid="input-contact-message"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700"
                  disabled={isSubmitting}
                  data-testid="button-submit-contact"
                >
                  {isSubmitting ? (
                    "Envoi en cours..."
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      Envoyer le message
                    </>
                  )}
                </Button>
              </form>
            </motion.div>

            {/* Coordonnées en dessous, pleine largeur */}
            <motion.div variants={fadeInUp}>
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-6">
                Nos coordonnées
              </h2>
              <div className="grid sm:grid-cols-3 gap-4 mb-4">
                {contactInfo.map((info, index) => (
                  <Card key={index} className="p-5">
                    <div className="flex flex-col gap-3">
                      <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                        <info.icon className="h-5 w-5 text-blue-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">{info.title}</h3>
                        <p className="text-blue-600 text-sm">{info.content}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{info.description}</p>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
              <Card className="p-4 bg-gradient-to-br from-blue-600 to-indigo-600 dark:from-slate-900 dark:to-blue-950 text-white border-0 mt-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
                    <MessageCircle className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Support instantané</h3>
                    <p className="text-blue-100 text-xs">
                      Assistant IA 24h/24. Cliquez sur la bulle en bas à droite.
                    </p>
                  </div>
                </div>
              </Card>
            </motion.div>
          </motion.div>
        </div>
      </section>

      <section className="py-20 bg-white dark:bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
          >
            <motion.h2
              variants={fadeInUp}
              className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4"
            >
              Questions fréquentes
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-slate-600 dark:text-slate-300 mb-8">
              Avant de nous contacter, consultez peut-être notre FAQ sur la page d'accueil.
            </motion.p>
            <motion.div variants={fadeInUp}>
              <a
                href="/#faq"
                onClick={(e) => {
                  e.preventDefault();
                  sessionStorage.setItem("scrollTo", "faq");
                  window.location.assign("/");
                }}
                className="inline-flex items-center gap-2 text-blue-600 font-medium hover:text-blue-700"
                data-testid="link-contact-faq"
              >
                Voir la FAQ
              </a>
            </motion.div>
          </motion.div>
        </div>
      </section>

      <Footer />
      <SupportChat />
    </div>
  );
}
