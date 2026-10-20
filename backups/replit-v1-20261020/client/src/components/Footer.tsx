import { Zap } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 py-16 border-t border-slate-200 dark:border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-slate-900 dark:text-white">
              <Zap className="h-6 w-6 text-blue-500" />
              <span className="font-display font-bold text-xl">Flowpoint</span>
            </div>
            <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              La plateforme tout-en-un qui vous aide à analyser, surveiller et développer votre entreprise en centralisant toutes vos données en temps réel. Grâce à l'intelligence artificielle, obtenez des recommandations personnalisées et prenez les meilleures décisions pour accélérer votre croissance, quelle que soit votre taille ou votre secteur.
            </p>
          </div>

          <div>
            <h4 className="text-slate-900 dark:text-white font-bold mb-4 font-display">Produit</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="/fonctionnalites" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Fonctionnalités</a></li>
              <li><a href="/avantages" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Avantages</a></li>
              <li><a href="/tarifs" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Tarifs</a></li>
              <li><a href="/mises-a-jour" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Mises à jour</a></li>
              <li><a href="/ressources" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Centre de ressources</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-slate-900 dark:text-white font-bold mb-4 font-display">Entreprise</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="/a-propos" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">À propos</a></li>
              <li><a href="/contact" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Contact</a></li>
              <li><a href="/carrieres" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Carrières</a></li>
              <li><a href="/mentions-legales" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Mentions légales</a></li>
              <li><a href="/informations-legales" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Informations légales</a></li>
            </ul>
          </div>

        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 mt-12 pt-8 text-center text-sm text-slate-500 dark:text-slate-500">
          © {new Date().getFullYear()} Flowpoint. Tous droits réservés.
        </div>
      </div>
    </footer>
  );
}
