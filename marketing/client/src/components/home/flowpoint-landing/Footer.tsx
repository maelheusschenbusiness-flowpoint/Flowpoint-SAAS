import { Zap } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 py-16 border-t border-slate-200 dark:border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-slate-900 dark:text-white">
              <img className="fp2-footer-logo-light" src="/images/flowpoint-landing-v2/flowpoint-logo.svg" alt="FlowPoint" />
              <span className="fp2-brand-dark fp2-footer-logo-dark" aria-hidden="true">
                <span className="fp2-brand-icon"><Zap className="h-4 w-4" /></span><span>FlowPoint</span>
              </span>
            </div>
            <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Bring website health, search, analytics and reporting into one workspace. AI-supported insights help your team review activity and decide what to do next.
            </p>
          </div>

          <div>
            <h4 className="text-slate-900 dark:text-white font-bold mb-4 font-display">Product</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="/features" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Features</a></li>
              <li><a href="/benefits" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Benefits</a></li>
              <li><a href="/pricing" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Pricing</a></li>
              <li><a href="/updates" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Updates</a></li>
              <li><a href="/resources" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Resources</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-slate-900 dark:text-white font-bold mb-4 font-display">Company</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="/about" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">About</a></li>
              <li><a href="/contact" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Contact</a></li>
              <li><a href="/careers" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Careers</a></li>
              <li><a href="/legal-notice" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Legal notice</a></li>
              <li><a href="/legal-information" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Legal information</a></li>
            </ul>
          </div>

        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 mt-12 pt-8 text-center text-sm text-slate-500 dark:text-slate-500">
          © {new Date().getFullYear()} FlowPoint. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
