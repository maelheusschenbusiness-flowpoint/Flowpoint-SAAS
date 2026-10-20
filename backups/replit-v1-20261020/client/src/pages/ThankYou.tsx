import { useEffect } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import confetti from "canvas-confetti";

export default function ThankYou() {
  usePageTitle("Merci | Flowpoint", { noindex: true });

  useEffect(() => {
    // Launch confetti on mount
    const duration = 3 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

    const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

    const interval: any = setInterval(function () {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      const particleCount = 50 * (timeLeft / duration);
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
      });
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
      });
    }, 250);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 px-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="max-w-lg w-full text-center space-y-8 bg-white dark:bg-slate-800 p-12 rounded-3xl shadow-xl shadow-blue-900/5 border border-blue-100 dark:border-slate-700"
      >
        <div className="flex justify-center">
          <div className="bg-green-100 dark:bg-green-900/30 p-4 rounded-full">
            <CheckCircle2 className="h-16 w-16 text-green-600" />
          </div>
        </div>

        <div className="space-y-4">
          <h1 className="text-4xl font-display font-bold text-slate-900 dark:text-slate-100">
            Merci pour votre confiance !
          </h1>
          <p className="text-lg text-slate-600 dark:text-slate-300">
            Votre demande a bien été enregistrée. Un expert de notre équipe va analyser votre visibilité locale et vous contacter dans les prochaines 24 heures.
          </p>
        </div>

        <div className="pt-4">
          <Button asChild className="w-full text-lg h-14 bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200 dark:shadow-blue-900/20 hover:shadow-xl transition-all">
            <a href="/">
              Retour à l'accueil
              <ArrowRight className="ml-2 h-5 w-5" />
            </a>
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
