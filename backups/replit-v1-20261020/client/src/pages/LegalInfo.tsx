import { usePageTitle } from "@/hooks/use-page-title";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { motion } from "framer-motion";
import { useState, useEffect, useRef } from "react";
import {
  Shield, FileText, ShoppingCart, Lock, Cookie, Gift, RefreshCw, Bot, Database, Mail,
  ChevronUp, ChevronRight, Activity, Code, Zap, Scale, Settings, Sliders
} from "lucide-react";

const fadeInUp = {
  // The initial state must remain visible in SSR and without JavaScript.
  hidden: { opacity: 1, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const sections = [
  { id: "mentions-legales", label: "Mentions légales", icon: FileText },
  { id: "cgu", label: "CGU", icon: Shield },
  { id: "cgv", label: "CGV", icon: ShoppingCart },
  { id: "confidentialite", label: "Confidentialité", icon: Lock },
  { id: "cookies", label: "Cookies", icon: Cookie },
  { id: "essai-gratuit", label: "Essai gratuit", icon: Gift },
  { id: "remboursement", label: "Remboursement", icon: RefreshCw },
  { id: "politique-ia", label: "Politique IA", icon: Bot },
  { id: "dpa", label: "DPA", icon: Database },
  { id: "sla", label: "SLA", icon: Activity },
  { id: "api-policy", label: "API", icon: Code },
  { id: "donnees", label: "Données", icon: Sliders },
  { id: "force-majeure", label: "Force majeure", icon: Zap },
  { id: "droit-applicable", label: "Droit applicable", icon: Scale },
  { id: "evolution-service", label: "Évolution & Usage", icon: Settings },
  { id: "services-tiers", label: "Services tiers", icon: Zap },
  { id: "modification-conditions", label: "Modification des CGU", icon: Settings },
  { id: "contact-juridique", label: "Contact juridique", icon: Mail },
];

function SectionCard({ id, icon: Icon, title, children }: {
  id: string; icon: any; title: string; children: React.ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-24">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
          <Icon className="h-5 w-5 text-blue-600" />
        </div>
        <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100">{title}</h2>
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-8 space-y-5 text-slate-600 dark:text-slate-300 leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2 flex items-center gap-2">
        <ChevronRight className="h-4 w-4 text-blue-600 flex-shrink-0" />
        {title}
      </h3>
      <div className="pl-6 text-sm space-y-1">{children}</div>
    </div>
  );
}

export default function LegalInfo() {
  usePageTitle("Informations légales | Flowpoint");
  const [activeSection, setActiveSection] = useState("mentions-legales");
  const [showScrollTop, setShowScrollTop] = useState(false);
  const navScrollRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 400);
      const offsets = sections.map(s => {
        const el = document.getElementById(s.id);
        return { id: s.id, top: el ? el.getBoundingClientRect().top : Infinity };
      });
      const visible = offsets.filter(o => o.top <= 120);
      if (visible.length > 0) setActiveSection(visible[visible.length - 1].id);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const btn = btnRefs.current[activeSection];
    const container = navScrollRef.current;
    if (!btn || !container) return;
    const btnLeft = btn.offsetLeft;
    const btnWidth = btn.offsetWidth;
    const containerWidth = container.offsetWidth;
    const scrollTarget = btnLeft - containerWidth / 2 + btnWidth / 2;
    container.scrollTo({ left: scrollTarget, behavior: "smooth" });
  }, [activeSection]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      <Navigation />

      {/* Hero */}
      <section className="relative pt-32 pb-16 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-indigo-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent dark:from-slate-900" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial="hidden" animate="visible" variants={fadeInUp}>
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm font-medium mb-6">
              <Shield className="h-4 w-4" />
              Transparence & conformité
            </span>
            <h1 className="text-4xl sm:text-5xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
              Informations légales
            </h1>
            <p className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
              Toutes les informations légales, conditions d'utilisation et politiques de FlowPoint réunies en un seul endroit.
            </p>
          </motion.div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        {/* Navigation des sections — barre horizontale sticky */}
        <div className="sticky top-20 z-40 -mx-4 sm:-mx-6 lg:-mx-8 mb-12">
          <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-700 shadow-sm">
            <div ref={navScrollRef} className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
              <div className="flex gap-1 py-2 px-4 sm:px-6 lg:px-8 min-w-max">
                {sections.map((s) => {
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.id}
                      ref={el => { btnRefs.current[s.id] = el; }}
                      onClick={() => scrollTo(s.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                        activeSection === s.id
                          ? "bg-blue-600 text-white shadow-sm"
                          : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      <Icon className="h-3 w-3 flex-shrink-0" />
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-12">

          {/* 1. Mentions légales */}
          <SectionCard id="mentions-legales" icon={FileText} title="Mentions légales">
            <SubSection title="Éditeur du site">
              <p><span className="font-medium text-slate-800 dark:text-slate-200">Dénomination :</span> FlowPoint</p>
              <p><span className="font-medium text-slate-800 dark:text-slate-200">Exploitant :</span> Heusschen Maël</p>
              <p><span className="font-medium text-slate-800 dark:text-slate-200">Numéro d'entreprise :</span> BE1038.273.845</p>
              <p><span className="font-medium text-slate-800 dark:text-slate-200">Email :</span>{" "}
                <a href="mailto:support@flowpoint.pro" className="text-blue-600 hover:underline">support@flowpoint.pro</a>
              </p>
              <p><span className="font-medium text-slate-800 dark:text-slate-200">Site :</span>{" "}
                <a href="https://flowpoint.pro" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">https://flowpoint.pro</a>
              </p>
            </SubSection>
            <SubSection title="Infrastructure">
              <p>FlowPoint est hébergé sur une infrastructure cloud sécurisée exploitée par des prestataires professionnels répondant aux standards de sécurité du secteur. Les fournisseurs d'infrastructure peuvent évoluer afin de garantir les meilleures performances, la disponibilité et la sécurité du service.</p>
            </SubSection>
            <SubSection title="Propriété intellectuelle">
              <p>Tous les contenus présents sur ce site (logiciels, interfaces, bases de données, textes, illustrations, logos, graphismes et tout autre contenu) sont la propriété exclusive de FlowPoint, protégés par le droit d'auteur belge et international. Toute reproduction partielle ou totale est interdite sans autorisation préalable écrite.</p>
            </SubSection>
          </SectionCard>

          {/* 2. CGU */}
          <SectionCard id="cgu" icon={Shield} title="Conditions générales d'utilisation (CGU)">
            <p className="text-sm text-slate-500 dark:text-slate-400 italic">Dernière mise à jour : mai 2026</p>
            <SubSection title="Conditions d'accès à la plateforme">
              <p>L'accès à la plateforme FlowPoint est réservé aux professionnels et aux entreprises souhaitant améliorer leur visibilité locale en ligne. L'utilisateur doit être âgé d'au moins 18 ans et disposer de la capacité juridique nécessaire.</p>
            </SubSection>
            <SubSection title="Création de compte">
              <p>L'inscription nécessite la fourniture d'informations exactes et complètes. L'utilisateur est responsable de la confidentialité de ses identifiants de connexion et de toutes les activités effectuées sous son compte.</p>
            </SubSection>
            <SubSection title="Inscription à la newsletter">
              <p>Lors de la création de son compte, l'utilisateur est automatiquement inscrit à la newsletter de FlowPoint et accepte de recevoir par email les actualités, conseils, offres et informations relatives aux services FlowPoint. L'utilisateur peut se désinscrire à tout moment en cliquant sur le lien prévu à cet effet dans chaque newsletter ou en contactant <a href="mailto:support@flowpoint.pro" className="text-blue-600 hover:underline">support@flowpoint.pro</a>.</p>
            </SubSection>
            <SubSection title="Responsabilités de l'utilisateur">
              <p>L'utilisateur s'engage à utiliser la plateforme conformément aux lois en vigueur, à ne pas tenter de contourner les mécanismes de sécurité, et à ne pas utiliser le service à des fins illégales, frauduleuses ou abusives.</p>
            </SubSection>
            <SubSection title="Suspension et résiliation">
              <p>FlowPoint se réserve le droit de suspendre ou résilier tout compte en cas de violation des présentes CGU, sans préavis ni remboursement en cas de manquement grave.</p>
            </SubSection>
            <SubSection title="Utilisation abusive">
              <p>Toute tentative d'utilisation abusive (contournement des quotas, création de multiples comptes frauduleux, scraping massif, etc.) entraînera la résiliation immédiate du compte et pourra faire l'objet de poursuites légales.</p>
            </SubSection>
            <SubSection title="Disponibilité du service">
              <p>FlowPoint s'efforce d'assurer une disponibilité élevée du service mais ne peut garantir une disponibilité ininterrompue. Des maintenances programmées ou imprévues peuvent survenir. FlowPoint ne pourra être tenu responsable des interruptions.</p>
            </SubSection>
            <SubSection title="Limitation de responsabilité">
              <p>FlowPoint ne saurait être tenu responsable des dommages indirects, pertes de profits ou de données résultant de l'utilisation ou de l'impossibilité d'utiliser le service, dans la limite permise par la loi applicable.</p>
              <p className="mt-1">En toute hypothèse, la responsabilité totale de FlowPoint ne pourra excéder le montant payé par l'utilisateur au cours des douze derniers mois précédant l'événement ayant donné lieu à la réclamation.</p>
            </SubSection>
            <SubSection title="Résultats SEO">
              <p>FlowPoint fournit des analyses, recommandations et outils d'optimisation mais ne garantit aucun classement spécifique dans les moteurs de recherche, aucune augmentation de trafic ni aucun résultat commercial déterminé. Les performances SEO dépendent de nombreux facteurs externes indépendants de la volonté de FlowPoint. Les recommandations fournies par FlowPoint constituent une aide à la décision et ne remplacent pas l'expertise ou le jugement professionnel de l'utilisateur.</p>
            </SubSection>
          </SectionCard>

          {/* 3. CGV */}
          <SectionCard id="cgv" icon={ShoppingCart} title="Conditions générales de vente (CGV)">
            <p className="text-sm text-slate-500 dark:text-slate-400 italic">Dernière mise à jour : mai 2026</p>
            <SubSection title="Description des abonnements">
              <p>FlowPoint propose trois plans payants (Standard, Pro, Ultra) avec des fonctionnalités progressives, accessibles via un abonnement mensuel. Un essai gratuit de 14 jours est disponible pour tout nouveau compte.</p>
            </SubSection>
            <SubSection title="Modalités de paiement">
              <p>Les paiements sont traités par Stripe. Les données bancaires ne sont jamais stockées par FlowPoint. Les prix sont exprimés en euros TTC. FlowPoint se réserve le droit de modifier ses tarifs avec un préavis de 30 jours.</p>
            </SubSection>
            <SubSection title="Renouvellement automatique">
              <p>Les abonnements sont renouvelés automatiquement à chaque échéance mensuelle sauf résiliation explicite par l'utilisateur avant la date de renouvellement.</p>
            </SubSection>
            <SubSection title="Gestion des échecs de paiement">
              <p>En cas d'échec de paiement, plusieurs tentatives seront effectuées automatiquement. Après épuisement des tentatives, l'accès au service sera suspendu jusqu'à régularisation du paiement.</p>
            </SubSection>
            <SubSection title="Suspension des comptes">
              <p>Le compte sera suspendu en cas de non-paiement. Les données sont conservées pendant 90 jours après suspension ou résiliation avant suppression définitive.</p>
            </SubSection>
            <SubSection title="Résiliation">
              <p>L'utilisateur peut résilier son abonnement à tout moment depuis son espace client. La résiliation prend effet à la fin de la période de facturation en cours. Aucun remboursement au prorata ne sera effectué.</p>
            </SubSection>
            <SubSection title="Facturation">
              <p>Une facture électronique est générée automatiquement à chaque renouvellement et envoyée à l'adresse email associée au compte. Les factures sont disponibles en téléchargement depuis l'espace client.</p>
            </SubSection>
            <SubSection title="Modules complémentaires (add-ons)">
              <p>Les modules complémentaires (add-ons) sont facturés séparément de l'abonnement principal. Certains add-ons peuvent être facturés immédiatement lors de l'achat et activés dès confirmation du paiement. Les add-ons récurrents sont renouvelés automatiquement jusqu'à résiliation explicite par l'utilisateur.</p>
            </SubSection>
            <SubSection title="TVA">
              <p>La TVA est appliquée conformément à la réglementation en vigueur et peut varier selon le pays de facturation du client et son statut fiscal (particulier, professionnel assujetti, auto-entrepreneur, etc.). Les entreprises européennes assujetties à la TVA peuvent renseigner leur numéro de TVA intracommunautaire afin d'obtenir une facturation hors taxe, sous réserve de validation.</p>
            </SubSection>
          </SectionCard>

          {/* 4. Confidentialité */}
          <SectionCard id="confidentialite" icon={Lock} title="Politique de confidentialité (RGPD)">
            <p className="text-sm text-slate-500 dark:text-slate-400 italic">Dernière mise à jour : août 2026 — Conformément au Règlement (UE) 2016/679</p>
            <SubSection title="Données collectées">
              <p>Nous collectons les informations suivantes : nom, prénom, adresse email professionnelle, nom de l'entreprise, données de facturation, adresse IP, données d'utilisation de la plateforme et préférences de compte.</p>
            </SubSection>
            <SubSection title="Utilisation des données">
              <p>Vos données sont utilisées pour fournir le service, traiter les paiements, envoyer des communications liées au compte et la newsletter FlowPoint, améliorer la plateforme et assurer la sécurité du service. Vos données ne sont jamais vendues à des tiers.</p>
            </SubSection>
            <SubSection title="Google User Data Sharing and Disclosure">
              <p>FlowPoint only accesses Google user data after you have explicitly authorized access through Google's OAuth consent flow. Google user data is used exclusively to provide the FlowPoint features you request, including SEO dashboards, Analytics reporting, Search Console insights, Google Business Profile management, automated reports, monitoring, and recommendations.</p>
              <p>Google user data is never sold, never shared with advertisers, and never used to train artificial intelligence or machine learning models. FlowPoint does not disclose Google user data to third parties except when strictly necessary to operate and provide the requested service, or when disclosure is required by law.</p>
              <p>When strictly necessary to operate the service, the following categories of service providers may process the minimum information required to perform their services on behalf of FlowPoint:</p>
              <ul className="mt-2 space-y-1 list-none">
                {[
                  "Google Cloud for OAuth authentication and Google API access",
                  "MongoDB Atlas for database hosting",
                  "Render for application hosting",
                  "Stripe for billing and payment processing only",
                  "Resend for transactional emails",
                  "OpenAI for providing artificial intelligence features and generating analyses, recommendations, and other AI-assisted content requested through FlowPoint",
                  "Other infrastructure providers strictly required for service operation",
                ].map((provider) => (
                  <li key={provider} className="flex items-start gap-2">
                    <ChevronRight className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                    {provider}
                  </li>
                ))}
              </ul>
              <p>These providers act as processors on behalf of FlowPoint and receive only the minimum information necessary to perform their specific services. Users may disconnect their Google account at any time, request deletion of stored Google-related data, or contact <a href="mailto:support@flowpoint.pro" className="text-blue-600 hover:underline">support@flowpoint.pro</a> with any privacy request.</p>
            </SubSection>
            <SubSection title="Artificial Intelligence and OpenAI">
              <p>FlowPoint uses OpenAI's API to provide certain artificial intelligence features, including AI-assisted analyses, recommendations, summaries, reports, and conversational assistance.</p>
              <p>When a user requests an AI-powered feature, information necessary to process that request may be transmitted to OpenAI. This may include the content submitted by the user and, where required to provide the requested feature, relevant business, SEO, analytics, Search Console, Google Business Profile, or other account data available within FlowPoint.</p>
              <p>FlowPoint configures its production use of the OpenAI API so that customer inputs and outputs are not voluntarily shared with OpenAI for the purpose of training or improving OpenAI's models. FlowPoint does not enable optional data-sharing programs for production customer traffic where those programs would permit customer inputs or outputs to be used for model improvement.</p>
              <p>Data transmitted to OpenAI is limited to what is reasonably necessary to provide the AI-powered feature requested by the user and is processed in accordance with the applicable contractual and data-protection arrangements.</p>
            </SubSection>
            <SubSection title="Newsletter et désinscription">
              <p>L'adresse email fournie lors de la création d'un compte est utilisée pour l'inscription automatique à la newsletter FlowPoint. Celle-ci peut contenir des actualités, conseils, offres et informations sur nos services. Chaque newsletter comporte un lien de désinscription permettant de ne plus recevoir ces communications à tout moment, sans incidence sur l'accès à la plateforme ni sur les communications strictement nécessaires à la gestion du compte.</p>
            </SubSection>
            <SubSection title="Conservation des données">
              <p>Les données sont conservées pendant toute la durée de la relation contractuelle, puis 3 ans après la clôture du compte à des fins légales et comptables.</p>
            </SubSection>
            <SubSection title="Droit d'accès">
              <p>Vous pouvez demander à tout moment une copie de vos données personnelles en contactant <a href="mailto:support@flowpoint.pro" className="text-blue-600 hover:underline">support@flowpoint.pro</a>.</p>
            </SubSection>
            <SubSection title="Droit de rectification">
              <p>Vous pouvez corriger vos données inexactes directement depuis votre espace client ou en contactant notre support.</p>
            </SubSection>
            <SubSection title="Droit à l'effacement">
              <p>Vous pouvez demander la suppression de vos données personnelles. Cette demande sera traitée sous 30 jours, sous réserve des obligations légales de conservation.</p>
            </SubSection>
            <SubSection title="Droit à la portabilité">
              <p>Vous pouvez obtenir vos données dans un format structuré et lisible par machine (JSON ou CSV) sur simple demande.</p>
            </SubSection>
            <SubSection title="Localisation des données">
              <p>Les données peuvent être hébergées dans l'Union européenne ou, selon le fournisseur utilisé, dans des pays bénéficiant de garanties conformes au RGPD (clauses contractuelles types ou décision d'adéquation).</p>
            </SubSection>
            <SubSection title="Contact RGPD">
              <p>Pour tout exercice de vos droits RGPD : <a href="mailto:support@flowpoint.pro" className="text-blue-600 hover:underline">support@flowpoint.pro</a>. Les utilisateurs peuvent également exercer leurs droits en écrivant à support@flowpoint.pro. Vous disposez également du droit d'introduire une réclamation auprès de l'Autorité de protection des données belge (APD).</p>
            </SubSection>
          </SectionCard>

          {/* 5. Cookies */}
          <SectionCard id="cookies" icon={Cookie} title="Politique des cookies">
            <SubSection title="Cookies essentiels">
              <p>Ces cookies sont indispensables au fonctionnement du site (session utilisateur, préférences de thème, consentement aux cookies). Ils ne peuvent pas être désactivés car ils sont nécessaires au service.</p>
            </SubSection>
            <SubSection title="Cookies analytiques">
              <p>Ces cookies nous permettent de mesurer l'audience du site et d'améliorer l'expérience utilisateur. Ils sont utilisés de manière anonymisée et agrégée. Ils nécessitent votre consentement préalable.</p>
            </SubSection>
            <SubSection title="Cookies fonctionnels">
              <p>Ces cookies permettent de mémoriser vos préférences (langue, région, affichage) pour vous offrir une expérience personnalisée lors de vos prochaines visites.</p>
            </SubSection>
            <SubSection title="Gestion du consentement">
              <p>Vous pouvez gérer vos préférences cookies à tout moment via la bannière de consentement disponible sur le site, ou en effaçant les cookies de votre navigateur. Le refus des cookies non essentiels n'impacte pas l'accès au service.</p>
            </SubSection>
            <SubSection title="Liste des cookies">
              <p>Une liste détaillée des cookies utilisés est disponible depuis le bandeau de gestion du consentement ou sur simple demande à <a href="mailto:support@flowpoint.pro" className="text-blue-600 hover:underline">support@flowpoint.pro</a>.</p>
            </SubSection>
          </SectionCard>

          {/* 6. Essai gratuit */}
          <SectionCard id="essai-gratuit" icon={Gift} title="Politique d'essai gratuit">
            <SubSection title="Durée de l'essai">
              <p>Chaque nouveau compte bénéficie d'un essai gratuit de 14 jours donnant accès à l'ensemble des fonctionnalités de la plateforme, sans restriction ni obligation d'achat.</p>
            </SubSection>
            <SubSection title="Conditions d'utilisation">
              <p>L'essai gratuit est limité à un seul essai par personne physique, par email normalisé, par domaine professionnel et par entreprise. Toute tentative de contournement de cette règle entraîne la suspension immédiate du compte.</p>
            </SubSection>
            <SubSection title="Conversion vers abonnement payant">
              <p>À l'issue de l'essai gratuit, le compte est automatiquement converti vers le plan payant sélectionné lors de l'inscription, sous réserve d'un moyen de paiement valide.</p>
            </SubSection>
            <SubSection title="Annulation pendant l'essai">
              <p>L'annulation avant la fin de l'essai gratuit est possible à tout moment depuis l'espace client. Aucun montant ne sera débité si l'annulation intervient avant la date de conversion.</p>
            </SubSection>
          </SectionCard>

          {/* 7. Remboursement */}
          <SectionCard id="remboursement" icon={RefreshCw} title="Politique de remboursement">
            <SubSection title="Conditions de remboursement">
              <p>FlowPoint s'engage à examiner toute demande de remboursement avec bienveillance. Les remboursements sont accordés discrétionnairement dans les cas où le service n'a pas pu être fourni correctement du fait de FlowPoint.</p>
            </SubSection>
            <SubSection title="Cas éligibles">
              <p>Les cas éligibles à un remboursement incluent : panne prolongée du service supérieure à 72h consécutives, double facturation avérée, facturation après résiliation confirmée. Les demandes liées à un changement d'avis ne donnent pas lieu à remboursement.</p>
            </SubSection>
            <SubSection title="Délais de traitement">
              <p>Les demandes de remboursement sont traitées dans un délai de 5 à 10 jours ouvrés. Le remboursement est effectué sur le moyen de paiement original utilisé lors de l'abonnement.</p>
            </SubSection>
            <p className="text-sm bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg p-3">
              Pour toute demande de remboursement, contactez-nous à{" "}
              <a href="mailto:support@flowpoint.pro" className="font-medium hover:underline">support@flowpoint.pro</a>{" "}
              avec votre numéro de commande et la raison de votre demande.
            </p>
          </SectionCard>

          {/* 8. Politique IA */}
          <SectionCard id="politique-ia" icon={Bot} title="Politique IA FlowPoint">
            <SubSection title="Utilisation de l'intelligence artificielle">
              <p>FlowPoint intègre des technologies d'intelligence artificielle pour l'analyse SEO, les recommandations personnalisées et le support client. Ces fonctionnalités sont alimentées par des modèles de langage avancés.</p>
            </SubSection>
            <SubSection title="Quotas et limites techniques">
              <p>Les quotas IA affichés comme « illimités » dans certaines offres commerciales correspondent à une utilisation très élevée destinée à couvrir les besoins normaux des utilisateurs professionnels. Afin de garantir la stabilité du service et d'éviter les abus, le plan Ultra est soumis à une limite technique de <strong className="text-slate-900 dark:text-slate-100">10 000 000 tokens IA par mois</strong>. Cette limite est largement suffisante pour la quasi-totalité des utilisateurs professionnels.</p>
              <p className="mt-2">Le dépassement du quota peut entraîner un ralentissement, une suspension temporaire des fonctionnalités IA ou la proposition d'un pack complémentaire.</p>
            </SubSection>
            <SubSection title="Cycle de consommation">
              <p>Les limites de consommation IA sont calculées sur une base mensuelle glissante et remises à zéro à chaque cycle de facturation.</p>
            </SubSection>
            <SubSection title="Ajustement des limites">
              <p>FlowPoint se réserve le droit d'ajuster cette limite en fonction de l'évolution des coûts des fournisseurs d'IA et des conditions du marché, avec un préavis de 30 jours communiqué par email aux utilisateurs concernés.</p>
            </SubSection>
            <SubSection title="Crédits IA">
              <p>Les crédits IA achetés sous forme de packs ponctuels sont consommés au fur et à mesure de leur utilisation. Les crédits IA ne sont pas remboursables après consommation totale ou partielle et n'expirent pas sauf mention contraire au moment de l'achat.</p>
            </SubSection>
            <SubSection title="Qualité et exactitude">
              <p>Les recommandations générées par l'IA sont fournies à titre indicatif. FlowPoint ne garantit pas l'exactitude absolue des résultats et encourage les utilisateurs à exercer leur jugement professionnel dans l'application des recommandations.</p>
            </SubSection>
            <SubSection title="Responsabilité de l'utilisateur">
              <p>L'utilisateur reste seul responsable des décisions prises sur la base des recommandations générées par l'intelligence artificielle. FlowPoint ne peut être tenu responsable des conséquences d'une décision prise sans vérification indépendante. Les modèles d'intelligence artificielle peuvent produire des résultats incomplets ou inexacts.</p>
            </SubSection>
            <SubSection title="Données et IA">
              <p>FlowPoint peut utiliser des données sous forme anonymisée et agrégée afin d'améliorer le service. Les informations transmises aux fournisseurs d'IA tiers sont limitées à ce qui est strictement nécessaire au traitement de la fonctionnalité demandée. Les données Google restent soumises aux protections spécifiques décrites dans la section « Google User Data Sharing and Disclosure » et ne sont jamais utilisées pour entraîner ou améliorer des modèles d'intelligence artificielle ou d'apprentissage automatique.</p>
            </SubSection>
          </SectionCard>

          {/* 9. DPA */}
          <SectionCard id="dpa" icon={Database} title="Accord de traitement des données (DPA)">
            <p className="text-sm text-slate-500 dark:text-slate-400 italic">Conforme au RGPD — Article 28</p>
            <SubSection title="Traitement des données clients">
              <p>FlowPoint agit en qualité de sous-traitant pour les données que vous saisissez dans la plateforme dans le cadre de votre activité professionnelle. Vous restez responsable du traitement de ces données vis-à-vis de vos propres clients.</p>
            </SubSection>
            <SubSection title="Sous-traitants techniques">
              <p>FlowPoint peut faire appel à des sous-traitants techniques pour l'hébergement, le traitement des paiements, l'envoi d'emails transactionnels, l'intelligence artificielle et l'infrastructure cloud. Une liste actualisée des sous-traitants peut être communiquée sur demande. Cette liste peut évoluer au cours de la vie du service. Les sous-traitants sont sélectionnés pour leurs garanties en matière de sécurité et de conformité.</p>
            </SubSection>
            <SubSection title="Sécurité">
              <p>FlowPoint met en œuvre des mesures techniques et organisationnelles appropriées pour assurer la sécurité des données, notamment :</p>
              <ul className="mt-2 space-y-1 list-none">
                {["HTTPS obligatoire sur l'ensemble des échanges", "Chiffrement TLS en transit", "Authentification sécurisée", "Algorithmes de hachage reconnus", "Protection CSRF", "Protection XSS", "Protection contre le brute force", "Journalisation des accès", "Sauvegardes régulières chiffrées"].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <ChevronRight className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
            </SubSection>
            <SubSection title="Conformité RGPD">
              <p>En cas de violation de données susceptible d'engendrer un risque pour vos droits et libertés, FlowPoint s'engage à vous notifier dans les 72 heures suivant la prise de connaissance de l'incident, conformément à l'article 33 du RGPD.</p>
            </SubSection>
          </SectionCard>

          {/* SLA */}
          <SectionCard id="sla" icon={Activity} title="Disponibilité du service (SLA)">
            <SubSection title="Objectif de disponibilité">
              <p>FlowPoint vise une disponibilité annuelle supérieure à 99,9 %. Toutefois, aucun niveau de disponibilité contractuel n'est garanti sauf accord spécifique conclu par écrit.</p>
            </SubSection>
            <SubSection title="Maintenances">
              <p>Des maintenances programmées peuvent être réalisées, de préférence en dehors des heures de forte utilisation. Les maintenances d'urgence peuvent survenir à tout moment en cas de risque pour la sécurité ou l'intégrité des données.</p>
            </SubSection>
          </SectionCard>

          {/* API */}
          <SectionCard id="api-policy" icon={Code} title="Politique d'utilisation de l'API">
            <p>L'utilisation de l'API FlowPoint est soumise aux mêmes conditions que la plateforme principale.</p>
            <SubSection title="Restrictions d'accès">
              <p>FlowPoint peut appliquer les mesures suivantes selon l'usage constaté :</p>
              <ul className="mt-2 space-y-1 list-none">
                {["Quotas de requêtes par période", "Rate limiting (limitation du débit)", "Restrictions d'usage selon le plan souscrit", "Suspension ou révocation des clés API en cas d'abus ou de violation des conditions"].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <ChevronRight className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
            </SubSection>
          </SectionCard>

          {/* Données */}
          <SectionCard id="donnees" icon={Sliders} title="Propriété et export des données">
            <SubSection title="Propriété des données">
              <p>Les données importées ou créées par l'utilisateur au sein de la plateforme restent sa propriété exclusive. FlowPoint n'acquiert aucun droit de propriété sur ces données et ne les exploite pas à des fins commerciales sans consentement explicite.</p>
            </SubSection>
            <SubSection title="Export des données">
              <p>L'utilisateur peut exporter ses données lorsqu'une fonctionnalité d'export est disponible sur son abonnement. Les formats d'export disponibles (CSV, JSON, PDF) dépendent du plan souscrit et de la fonctionnalité concernée.</p>
            </SubSection>
          </SectionCard>

          {/* Force majeure */}
          <SectionCard id="force-majeure" icon={Zap} title="Force majeure">
            <p>FlowPoint ne pourra être tenu responsable d'un retard ou d'une interruption du service résultant d'un événement de force majeure, notamment :</p>
            <ul className="mt-3 space-y-1 list-none">
              {["Catastrophe naturelle (inondation, séisme, tempête)", "Panne Internet majeure ou panne réseau d'un opérateur", "Indisponibilité d'un fournisseur critique (cloud, IA, paiement)", "Cyberattaque généralisée ou incident de sécurité d'ampleur nationale", "Décision gouvernementale, réglementation ou embargo"].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <ChevronRight className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm">FlowPoint informera les utilisateurs dans les meilleurs délais et s'efforcera de rétablir le service aussi rapidement que possible.</p>
          </SectionCard>

          {/* Droit applicable */}
          <SectionCard id="droit-applicable" icon={Scale} title="Droit applicable et juridictions">
            <SubSection title="Droit applicable">
              <p>Les présentes conditions générales sont régies par le droit belge. En cas de litige portant sur l'interprétation ou l'exécution des présentes, et à défaut de résolution amiable, les juridictions compétentes de Belgique seront seules compétentes, sauf disposition légale impérative contraire applicable au consommateur.</p>
            </SubSection>
            <SubSection title="Résolution amiable">
              <p>En cas de litige, nous vous invitons à nous contacter en premier lieu à <a href="mailto:support@flowpoint.pro" className="text-blue-600 hover:underline">support@flowpoint.pro</a>. Nous nous engageons à répondre dans un délai de 10 jours ouvrés et à rechercher une solution amiable.</p>
            </SubSection>
          </SectionCard>

          {/* Évolution du service & Usage raisonnable */}
          <SectionCard id="evolution-service" icon={Settings} title="Évolution du service & Usage raisonnable">
            <SubSection title="Évolution du service">
              <p>FlowPoint peut modifier, améliorer, supprimer ou ajouter des fonctionnalités afin de faire évoluer la plateforme et d'en améliorer la qualité. Ces évolutions n'ouvrent pas automatiquement droit à un remboursement, sauf suppression d'une fonctionnalité centrale expressément incluse dans le plan souscrit.</p>
            </SubSection>
            <SubSection title="Usage raisonnable">
              <p>Même lorsqu'une fonctionnalité est présentée comme illimitée, son utilisation doit rester compatible avec un usage professionnel normal. Tout usage automatisé, massif ou destiné à contourner les limitations techniques pourra entraîner une limitation temporaire ou définitive du service, sans remboursement.</p>
            </SubSection>
          </SectionCard>

          {/* Services tiers */}
          <SectionCard id="services-tiers" icon={Zap} title="Services tiers">
            <p>Certaines fonctionnalités de FlowPoint reposent sur des services tiers (par exemple Google, Stripe, OpenAI, DataForSEO ou d'autres fournisseurs de données). FlowPoint ne peut être tenu responsable d'une indisponibilité, d'une modification ou d'une interruption de ces services externes pouvant affecter certaines fonctionnalités de la plateforme.</p>
          </SectionCard>

          {/* Modification des conditions */}
          <SectionCard id="modification-conditions" icon={Settings} title="Modification des conditions">
            <p>FlowPoint peut modifier les présentes conditions afin de tenir compte d'une évolution légale, réglementaire, technique ou fonctionnelle. En cas de modification substantielle, les utilisateurs seront informés par email ou via la plateforme avant leur entrée en vigueur.</p>
          </SectionCard>

          {/* 10. Contact juridique */}
          <SectionCard id="contact-juridique" icon={Mail} title="Contact juridique">
            <p>Pour toute question d'ordre juridique, demande liée à vos données personnelles ou réclamation :</p>
            <div>
              <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-4 inline-block">
                <p className="font-semibold text-slate-900 dark:text-slate-100 text-sm mb-1">Email juridique</p>
                <a href="mailto:support@flowpoint.pro" className="text-blue-600 hover:underline text-sm">
                  support@flowpoint.pro
                </a>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Nous nous efforçons de répondre dans les meilleurs délais, généralement sous 5 jours ouvrés.</p>
              </div>
            </div>
            <div className="mt-4">
              <a
                href="/contact"
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                <Mail className="h-4 w-4" />
                Formulaire de contact juridique
              </a>
            </div>
          </SectionCard>

        </div>
      </div>

      {/* Bouton retour en haut */}
      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-24 right-6 z-40 w-10 h-10 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-colors"
          aria-label="Retour en haut"
        >
          <ChevronUp className="h-5 w-5" />
        </button>
      )}

      <Footer />
    </div>
  );
}
