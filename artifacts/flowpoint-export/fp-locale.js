(function () {
  'use strict';

  var LOCALE_BY_LANGUAGE = {
    'pt-br': 'pt-BR',
    fr: 'fr-FR',
    en: 'en-US',
    es: 'es-ES',
    de: 'de-DE',
    it: 'it-IT',
    pt: 'pt-PT',
    nl: 'nl-NL',
    pl: 'pl-PL',
    sv: 'sv-SE',
    ro: 'ro-RO',
    cs: 'cs-CZ',
  };

  // Public pages share this small, exact-match catalogue. Only static UI text
  // is translated automatically; API/user-authored report and organization
  // content is never rewritten.
  var PUBLIC_ENGLISH = {
    "FlowPoint — Créer votre compte": "FlowPoint — Create your account",
    "Créer votre compte FlowPoint": "Create your FlowPoint account",
    "Renseignez vos informations pour créer votre compte FlowPoint.": "Enter your details to create your FlowPoint account.",
    "Continuer avec Google": "Continue with Google",
    "ou remplissez le formulaire": "or fill out the form",
    "Prénom *": "First name *",
    "Nom *": "Last name *",
    "Email professionnel *": "Work email *",
    "Nom de l'entreprise *": "Company name *",
    "Pays *": "Country *",
    "Adresse *": "Address *",
    "Ville *": "City *",
    "Code postal *": "Postal code *",
    "Téléphone": "Phone",
    "(optionnel)": "(optional)",
    "N° TVA": "VAT ID",
    "Continuer vers le choix du plan →": "Continue to plan selection →",
    "Déjà un compte ?": "Already have an account?",
    "Se connecter": "Sign in",
    "Voir les plans et tarifs →": "View plans and pricing →",
    "Choisissez votre plan": "Choose your plan",
    "14 jours d'essai gratuit · Carte requise · Annulation à tout moment": "14-day free trial · Card required · Cancel anytime",
    "Idéal pour les indépendants et petites équipes": "Ideal for freelancers and small teams",
    "29 €": "€29",
    "79 €": "€79",
    "149 €": "€149",
    "4€": "€4",
    "9€": "€9",
    "19€": "€19",
    "/mois": "/mo",
    "/ mois": "/ month",
    "/ pack / mois": "/ pack / month",
    "Recommandé": "Recommended",
    "Pour les agences et équipes en croissance": "For agencies and growing teams",
    "Pour les grandes agences et entreprises": "For large agencies and enterprises",
    "Paiement sécurisé via Stripe · Aucune carte débitée avant la fin de l'essai": "Secure payment via Stripe · No card charged before the trial ends",
    "Comparer les plans en détail →": "Compare plans in detail →",
    "En créant un compte, vous acceptez nos": "By creating an account, you agree to our",
    "Conditions Générales": "Terms and Conditions",
    "et notre": "and our",
    "Politique de confidentialité": "Privacy Policy",
    "Connexion — FlowPoint": "Sign in — FlowPoint",
    "Bienvenue": "Welcome",
    "Connectez-vous à votre espace FlowPoint": "Sign in to your FlowPoint workspace",
    "Adresse e-mail": "Email address",
    "Recevoir le lien de connexion": "Send sign-in link",
    "ou": "or",
    "Pas encore de compte ?": "Don't have an account yet?",
    "Créer mon compte →": "Create my account →",
    "Voir les plans et tarifs": "View plans and pricing",
    "En vous connectant, vous acceptez nos": "By signing in, you agree to our",
    "Conditions d'utilisation": "Terms of Service",
    "Tarifs FlowPoint — SEO, monitoring & IA pour votre croissance": "FlowPoint pricing — SEO, monitoring & AI for your growth",
    "Plans FlowPoint : Standard 29€ (30 audits, 10 monitors), Pro 79€ (300 audits, 50 monitors), Ultra 149€ (1000 audits, 300 monitors). Essai 14 jours.": "FlowPoint plans: Standard €29 (30 audits, 10 monitors), Pro €79 (300 audits, 50 monitors), and Ultra €149 (1,000 audits, 300 monitors). Includes a 14-day trial.",
    "Tarifs FlowPoint — SEO, monitoring & IA": "FlowPoint pricing — SEO, monitoring & AI",
    "Plans flexibles pour indépendants, équipes et agences. 14 jours d'essai inclus.": "Flexible plans for freelancers, teams, and agencies. Includes a 14-day trial.",
    "Créer un compte": "Create an account",
    "Panier": "Cart",
    "🚀 14 jours d'essai complet inclus avec chaque plan": "🚀 14-day full trial included with every plan",
    "Des tarifs": "Transparent",
    "transparents": "pricing",
    "des résultats mesurables": "measurable results",
    "Audits SEO, monitoring uptime, analytics GA4 et IA copilot — tout ce qu'il faut pour dominer les résultats de recherche et convertir votre trafic.\n    Annulation à tout moment, sans engagement.": "SEO audits, uptime monitoring, GA4 analytics, and an AI copilot — everything you need to improve search visibility and convert your traffic.\n    Cancel anytime, no commitment.",
    "Facturation mensuelle · Carte bancaire requise à l'activation ·": "Monthly billing · Credit card required at activation ·",
    "Packs de crédits IA en achat unique ⚡": "One-time AI credit packs ⚡",
    "Pour les indépendants et PME.": "For freelancers and small businesses.",
    "✓ 14 jours gratuits · puis 29€/mois": "✓ 14 days free · then €29/month",
    "30 audits/mois": "30 audits/month",
    "30 rapports PDF/mois": "30 PDF reports/month",
    "30 exports/mois": "30 exports/month",
    "1 membre d'équipe": "1 team member",
    "100 000 crédits IA/mois": "100,000 AI credits/month",
    "Onboarding dédié": "Dedicated onboarding",
    "Pour les agences et équipes growth.": "For agencies and growth teams.",
    "✓ 14 jours gratuits · puis 79€/mois": "✓ 14 days free · then €79/month",
    "300 audits/mois": "300 audits/month",
    "300 rapports PDF/mois": "300 PDF reports/month",
    "300 exports/mois": "300 exports/month",
    "5 membres d'équipe": "5 team members",
    "500 000 crédits IA/mois": "500,000 AI credits/month",
    "Local SEO avancé": "Advanced Local SEO",
    "Local SEO basique": "Basic Local SEO",
    "White-label rapports": "White-label reports",
    "Démarrer Pro — le meilleur choix": "Start Pro — best value",
    "✓ 14 jours gratuits · puis 149€/mois": "✓ 14 days free · then €149/month",
    "1 000 audits/mois": "1,000 audits/month",
    "1 000 rapports PDF/mois": "1,000 PDF reports/month",
    "1 000 exports/mois": "1,000 exports/month",
    "10 membres d'équipe": "10 team members",
    "∞ crédits IA/mois": "∞ AI credits/month",
    "IA Stratégiste complet": "Full AI Strategist",
    "API illimitée": "Unlimited API",
    "Support dédié < 1h": "Dedicated support < 1 hour",
    "Rétention 365 jours": "365-day retention",
    "Démarrer Ultra": "Start Ultra",
    "Personnalisez avec des add-ons": "Customize with add-ons",
    "Cliquez sur un plan pour continuer directement. Besoin d'add-ons ou de crédits IA ?": "Click a plan to continue right away. Need add-ons or AI credits?",
    "Ajoutez-les d'abord au panier": "Add them to your cart first",
    ", puis choisissez votre plan et cliquez sur « Panier ».": ", then choose your plan and click \"Cart\".",
    "Continuer vers le paiement →": "Continue to payment →",
    "Votre session d'inscription a expiré. Veuillez renseigner à nouveau le formulaire pour continuer.": "Your signup session has expired. Please fill in the form again to continue.",
    "Activez uniquement ce dont vous avez besoin — facturé immédiatement par Stripe, annulable à tout moment.": "Activate only what you need — billed immediately via Stripe, cancel anytime.",
    "Performances GBP réelles, objectifs configurables et alertes de baisse des actions locales.": "Real GBP performance, configurable goals, and alerts for drops in local actions.",
    "Priorisation des informations manquantes sur vos fiches GBP": "Prioritize missing information on your GBP profiles",
    "Repérez les recherches locales réelles qui justifient une page de service ou de zone.": "Find real local searches that justify a service or area page.",
    "Repérez les pages à optimiser à partir des sessions et conversions GA4 mesurées.": "Find pages to optimize using measured GA4 sessions and conversions.",
    "Comparez les variations réellement mesurées entre audits SEO terminés.": "Compare measured changes between completed SEO audits.",
    "Priorisez les sites clients selon les audits SEO et les clics organiques réellement mesurés.": "Prioritize client sites using SEO audits and measured organic clicks.",
    "Comparez le nombre de problèmes signalés entre deux audits de la même URL.": "Compare reported issues between two audits of the same URL.",
    "Suivez les objectifs de clics et de position à partir des données GSC mesurées.": "Track click and ranking goals using measured GSC data.",
    "Synthèse des régions de contrôle Better Stack configurées": "Summary of configured Better Stack monitoring regions",
    "🚧 Bientôt disponible": "🚧 Coming soon",
    "SLA Monitoring Avancé": "Advanced SLA monitoring",
    "Suivi SLA et rapports de disponibilité": "SLA tracking and uptime reports",
    "Audit SEO avancé et recommandations IA": "Advanced SEO audit and AI recommendations",
    "Suivi et stratégie mots-clés avancée": "Advanced keyword tracking and strategy",
    "Analyse de backlinks": "Backlink analysis",
    "🧪 Bêta": "🧪 Beta",
    "Repère les baisses de clics, de position et les CTR faibles par rapport aux pages GSC comparables.": "Detects drops in clicks and rankings, and low CTR compared with similar GSC pages.",
    "Publication GBP assistée par IA": "AI-assisted GBP posting",
    "Recommandations CRO fondées sur les événements observés": "CRO recommendations based on observed events",
    "Analyse comportementale et insights IA": "Behavior analysis and AI insights",
    "Opportunités de conversion observées; pertes financières uniquement si mesurées": "Observed conversion opportunities; financial losses only when measured",
    "Exports PDF à votre marque": "Branded PDF exports",
    "Packs de rapports clients réutilisables": "Reusable client report packs",
    "Résumés exécutifs IA": "AI executive summaries",
    "Prévisions SEO, trafic et conversion": "SEO, traffic, and conversion forecasts",
    "+5 Sièges": "+5 seats",
    "+5 membres supplémentaires": "+5 additional members",
    "Rétention 90 jours": "90-day retention",
    "90 jours de données historiques": "90 days of historical data",
    "365 jours de données historiques": "365 days of historical data",
    "Intégration CRM": "CRM integration",
    "Domaine personnalisé pour le portail": "Custom portal domain",
    "SSO SAML et OIDC": "SAML and OIDC SSO",
    "Roadmap et missions IA personnalisées à partir du profil renseigné": "Custom AI roadmap and tasks based on your profile",
    "Agency Lab complet": "Full Agency Lab",
    "⚡ Packs de crédits IA": "⚡ AI credit packs",
    "Achat unique par carte — crédits ajoutés immédiatement à votre compte, sans abonnement ni renouvellement. Cumulables avec votre quota mensuel, utilisables sans limite de temps.": "One-time card purchase — credits are added to your account immediately, with no subscription or renewal. They add to your monthly quota and never expire.",
    "+50 000 crédits IA": "+50,000 AI credits",
    "Boostez votre quota mensuel avec 50 000 crédits supplémentaires. Idéal pour les pics d'activité ponctuels ou tester l'IA de façon intensive.": "Boost your monthly quota with 50,000 extra credits. Ideal for occasional activity spikes or intensive AI testing.",
    "✓ Disponibles immédiatement": "✓ Available immediately",
    "★ Le plus choisi": "★ Most popular",
    "+200 000 crédits IA": "+200,000 AI credits",
    "Quadruplez votre capacité IA pour un mois complet. Parfait pour les campagnes de contenu, les audits massifs ou les sprints stratégiques.": "Quadruple your AI capacity for a full month. Ideal for content campaigns, large-scale audits, or strategy sprints.",
    "+500 000 crédits IA": "+500,000 AI credits",
    "Le pack maximal pour agences et équipes intensives. Un demi-million de crédits disponibles en un seul achat, sans engagement.": "The largest pack for agencies and high-volume teams. Get half a million credits in one purchase, with no commitment.",
    "Comparer toutes les fonctionnalités": "Compare all features",
    "Tout ce que chaque plan inclut, en détail.": "Everything included in each plan, in detail.",
    "Fonctionnalité": "Feature",
    "SEO & Analyse": "SEO & Analytics",
    "IA & Copilot": "AI & Copilot",
    "Audits SEO / mois": "SEO audits / month",
    "Analyse de contenu": "Content analysis",
    "Avancée": "Advanced",
    "Complète": "Full",
    "DataForSEO avancé": "Advanced DataForSEO",
    "Multi-établissements": "Multiple locations",
    "Review Intelligence IA": "Review Intelligence AI",
    "Monitors d'uptime": "Uptime monitors",
    "Fréquence de vérification": "Check frequency",
    "Alertes temps réel": "Real-time alerts",
    "Monitoring avancé / SLA": "Advanced monitoring / SLA",
    "Crédits IA / mois": "AI credits / month",
    "100 000": "100,000",
    "500 000": "500,000",
    "∞ (Inclus)": "∞ (Included)",
    "Inclus": "Included",
    "Complet": "Full",
    "Copilot IA": "AI Copilot",
    "Basiques": "Basic",
    "Limité": "Limited",
    "Rapport exécutif IA": "AI executive report",
    "Rapports": "Reports",
    "Rapports / mois": "Reports / month",
    "Partage de rapports": "Report sharing",
    "Historique des données": "Data history",
    "30 jours": "30 days",
    "90 jours": "90 days",
    "365 jours": "365 days",
    "Équipe & Collaboration": "Team & Collaboration",
    "Membres d'équipe": "Team members",
    "Rôles & permissions": "Roles & permissions",
    "Intégrations & Automatisation": "Integrations & Automation",
    "Intégrations natives": "Native integrations",
    "Avancées": "Advanced",
    "Complètes": "Full",
    "Webhooks avancés": "Advanced webhooks",
    "API REST + Webhooks avancés": "REST API + advanced webhooks",
    "Sécurité": "Security",
    "Domaine personnalisé": "Custom domain",
    "Support par email": "Email support",
    "Account Manager dédié": "Dedicated account manager",
    "Questions fréquentes": "Frequently asked questions",
    "Comment fonctionne l'essai de 14 jours ?": "How does the 14-day trial work?",
    "Tous les plans incluent 14 jours d'essai avec accès complet à toutes les fonctionnalités.\n      Une carte bancaire est requise à l'inscription — elle ne sera débitée qu'à la fin de l'essai si vous décidez de continuer.\n      Vous pouvez annuler à tout moment avant la fin de l'essai sans frais.": "All plans include a 14-day trial with full access to every feature.\n      A credit card is required at sign-up. It will only be charged at the end of the trial if you choose to continue.\n      You can cancel at any time before the trial ends at no cost.",
    "Puis-je acheter des add-ons pendant l'essai ?": "Can I buy add-ons during the trial?",
    "Oui — les add-ons sont disponibles immédiatement, même pendant la période d'essai.\n      Chaque add-on est facturé séparément dès l'activation via Stripe, indépendamment de votre statut d'essai.\n      Ils sont sans engagement et annulables à tout moment depuis votre tableau de bord.": "Yes. Add-ons are available immediately, even during the trial.\n      Each add-on is billed separately through Stripe as soon as it is activated, regardless of trial status.\n      They have no commitment and can be canceled from your dashboard at any time.",
    "Puis-je changer de plan à tout moment ?": "Can I change plans at any time?",
    "Oui, vous pouvez upgrader ou downgrader à tout moment depuis votre tableau de bord.\n      Les upgrades prennent effet immédiatement au prorata, les downgrades à la fin de la période de facturation en cours.": "Yes. You can upgrade or downgrade from your dashboard at any time.\n      Upgrades take effect immediately on a prorated basis; downgrades take effect at the end of the current billing period.",
    "Comment fonctionne l'annulation ?": "How does cancellation work?",
    "Annulation en un clic depuis votre tableau de bord, sans justification requise.\n      Votre accès reste actif jusqu'à la fin de la période de facturation. Aucun frais supplémentaire.": "Cancel in one click from your dashboard; no reason is required.\n      Your access remains active until the end of the billing period, with no additional fees.",
    "Quels moyens de paiement acceptez-vous ?": "Which payment methods do you accept?",
    "Nous acceptons toutes les principales cartes bancaires (Visa, Mastercard, Amex) ainsi que le prélèvement SEPA pour les entreprises européennes, via Stripe.": "We accept all major credit cards (Visa, Mastercard, and Amex), as well as SEPA direct debit for European businesses, through Stripe.",
    "Qu'arrive-t-il à mes données si j'annule ?": "What happens to my data if I cancel?",
    "Vos données sont conservées pendant 30 jours après la fin de votre abonnement pour vous laisser le temps d'exporter.\n      Passé ce délai, elles sont supprimées conformément à notre politique RGPD.": "Your data is kept for 30 days after your subscription ends so you have time to export it.\n      After that, it is deleted in accordance with our GDPR policy.",
    "Les add-ons sont-ils engageants ?": "Do add-ons require a commitment?",
    "Non — les add-ons sont facturés mensuellement et peuvent être ajoutés ou supprimés à tout moment depuis votre tableau de bord, sans engagement minimum.\n      La facturation est au prorata pour le premier mois.": "No. Add-ons are billed monthly and can be added or removed from your dashboard at any time, with no minimum commitment.\n      The first month is prorated.",
    "© 2026 FlowPoint — Tous droits réservés": "© 2026 FlowPoint — All rights reserved",
    "Mentions légales": "Legal notice",
    "Confidentialité": "Privacy",
    "Réessayer la vérification": "Retry verification",
    "Voir les tarifs": "View pricing",
    "Réessayer": "Try again",
    "Vérification de votre paiement…": "Verifying your payment…",
    "Nous confirmons votre paiement auprès du serveur. Cela ne prend que quelques secondes.": "We are confirming your payment with the server. This only takes a few seconds.",
    "Paiement annulé — FlowPoint": "Payment canceled — FlowPoint",
    "Paiement annulé": "Payment canceled",
    "Vous avez annulé la procédure de paiement.": "You canceled the payment process.",
    "Aucun abonnement n'a été confirmé. Aucun montant n'a été débité.": "No subscription was confirmed. No amount was charged.",
    "Votre sélection est conservée": "Your selection has been saved",
    "Reprendre le paiement →": "Resume payment →",
    "← Modifier mon panier": "← Edit my cart",
    "Retour aux tarifs": "Back to pricing",
    "Paiement confirmé — FlowPoint": "Payment confirmed — FlowPoint",
    "Paiement confirmé !": "Payment confirmed!",
    "✓ Abonnement activé — 14 jours d'essai offerts": "✓ Subscription activated — 14-day trial included",
    "Paiement confirmé ! Connectez-vous pour accéder à votre tableau de bord.": "Payment confirmed! Sign in to access your dashboard.",
    "Ce que vous avez commandé": "Your order",
    "Accéder au tableau de bord →": "Go to dashboard →",
    "Se connecter pour accéder au dashboard": "Sign in to access the dashboard",
    "Retour à l'accueil": "Back to home",
    "Redirection automatique dans": "Redirecting automatically in",
    "Rejoindre l'équipe — FlowPoint": "Join the team — FlowPoint",
    "Vérification de l'invitation…": "Verifying invitation…",
    "Vous avez été invité": "You've been invited",
    "Rejoignez l'équipe FlowPoint pour accéder à tous les outils d'agence.": "Join the FlowPoint team to access all agency tools.",
    "Rejoindre l'équipe": "Join team",
    "Invitation invalide": "Invalid invitation",
    "Ce lien ne contient pas de jeton d'invitation.": "This link does not contain an invitation token.",
    "Bienvenue dans l'équipe !": "Welcome to the team!",
    "Vous avez bien rejoint l'espace de travail. Redirection en cours…": "You joined the workspace. Redirecting…",
    "Accéder au tableau de bord": "Go to dashboard",
    "Vérification — FlowPoint": "Verification — FlowPoint",
    "Vérification en cours…": "Verifying…",
    "Nous validons votre lien de connexion, veuillez patienter.": "We're verifying your sign-in link. Please wait.",
    "Connexion réussie !": "Sign-in successful!",
    "Vous êtes connecté. Redirection vers votre tableau de bord…": "You're signed in. Redirecting to your dashboard…",
    "Aucun token trouvé dans l'URL.": "No sign-in token was found in the URL.",
    "Demander un nouveau lien": "Request a new link",
    "Retour à la connexion": "Back to sign in",
    "Rapport — FlowPoint": "Report — FlowPoint",
    "Rapport partagé": "Shared report",
    "Chargement du rapport…": "Loading report…",
    "Rapport introuvable": "Report not found",
    "Aucun identifiant de rapport trouvé dans l'URL.": "No report ID was found in the URL.",
    "🖨️ Imprimer": "🖨️ Print",
    "Rapport d'analyse": "Analysis report",
    "Organisation": "Organization",
    "Rôle": "Role",
    "Expire le": "Expires",
    "Résumé": "Summary",
    "Indicateurs clés": "Key metrics",
    "Données": "Data",
    "Précédent": "Previous",
    "Suivant": "Next",
    "Sélectionner": "Select",
    "Commencer": "Get started",
    "Voir plus ▾": "See more ▾",
    "Voir moins ▴": "See less ▴",
    "Voir moins": "See less",
    "Voir tous les add-ons (24 de plus)": "View all add-ons (24 more)",
    "Voir toutes les fonctionnalités (34 de plus)": "View all features (34 more)",
    "✓ Sélectionné — Essai 14 jours": "✓ Selected — 14-day trial",
    "✓ Votre plan actuel": "✓ Your current plan",
    "✓ Actif": "✓ Active",
    "✓ Dans le panier": "✓ In cart",
    "Activer →": "Activate →",
    "→ Sélectionné": "→ Selected",
    "Mise à jour…": "Updating…",
    "Finaliser": "Complete checkout",
    "Tableau de bord": "Dashboard",
    "Réduire la quantité de +10 Monitors": "Decrease +10 Monitors quantity",
    "Quantité de +10 Monitors": "Quantity of +10 Monitors",
    "Augmenter la quantité de +10 Monitors": "Increase +10 Monitors quantity",
    "Réduire la quantité de +50 Monitors": "Decrease +50 Monitors quantity",
    "Quantité de +50 Monitors": "Quantity of +50 Monitors",
    "Augmenter la quantité de +50 Monitors": "Increase +50 Monitors quantity",
    "Réduire la quantité de +5 Sièges": "Decrease +5 seats quantity",
    "Quantité de +5 Sièges": "Quantity of +5 seats",
    "Augmenter la quantité de +5 Sièges": "Increase +5 seats quantity",
    "Réduire la quantité de Pack audits +200": "Decrease +200 audit pack quantity",
    "Quantité de Pack audits +200": "Quantity of +200 audit pack",
    "Augmenter la quantité de Pack audits +200": "Increase +200 audit pack quantity",
    "Réduire la quantité de Pack audits +1 000": "Decrease +1,000 audit pack quantity",
    "Quantité de Pack audits +1 000": "Quantity of +1,000 audit pack",
    "Augmenter la quantité de Pack audits +1 000": "Increase +1,000 audit pack quantity",
    "Réduire la quantité de Pack PDF +200": "Decrease +200 PDF pack quantity",
    "Quantité de Pack PDF +200": "Quantity of +200 PDF pack",
    "Augmenter la quantité de Pack PDF +200": "Increase +200 PDF pack quantity",
    "Réduire la quantité de Pack exports +1 000": "Decrease +1,000 export pack quantity",
    "Quantité de Pack exports +1 000": "Quantity of +1,000 export pack",
    "Augmenter la quantité de Pack exports +1 000": "Increase +1,000 export pack quantity",
    "Erreur : session d'inscription introuvable. Rechargez la page.": "Error: signup session not found. Reload the page.",
    "Accès refusé. Autorisez l'accès à votre compte Google.": "Access denied. Allow access to your Google account.",
    "Erreur d'authentification Google. Veuillez réessayer.": "Google sign-in failed. Please try again.",
    "Erreur d'authentification GitHub. Veuillez réessayer.": "GitHub sign-in failed. Please try again.",
    "Code OAuth manquant. Veuillez réessayer.": "Missing OAuth code. Please try again.",
    "Une erreur temporaire s'est produite lors de la création de votre session d'inscription Google. Veuillez réessayer.": "A temporary error occurred while creating your Google signup session. Please try again.",
    "Le prénom est requis.": "First name is required.",
    "Le nom est requis.": "Last name is required.",
    "Adresse email invalide.": "Invalid email address.",
    "Les adresses email temporaires ne sont pas acceptées.": "Disposable email addresses are not accepted.",
    "Le nom de l'entreprise est requis.": "Company name is required.",
    "Le pays est requis.": "Country is required.",
    "L'adresse est requise.": "Address is required.",
    "La ville est requise.": "City is required.",
    "Le code postal est requis.": "Postal code is required.",
    "Une erreur est survenue.": "An error occurred.",
    "Impossible de joindre le serveur. Vérifiez votre connexion.": "Unable to reach the server. Check your connection.",
    "→ Me connecter": "→ Sign in",
    "Échec de la connexion Google. Réessayez.": "Google sign-in failed. Please try again.",
    "Connexion annulée.": "Sign-in canceled.",
    "Accès refusé.": "Access denied.",
    "Code OAuth manquant. Veuillez réessayer.": "Missing OAuth code. Please try again.",
    "Erreur : ": "Error: ",
    "Veuillez saisir votre adresse e-mail.": "Please enter your email address.",
    "✉️ Lien envoyé à": "✉️ Sign-in link sent to",
    "Vérifiez votre boîte mail (et les spams).": "Check your inbox (and spam folder).",
    "Service e-mail indisponible. Connectez-vous avec Google.": "Email service unavailable. Sign in with Google.",
    "Une erreur est survenue. Veuillez réessayer.": "An error occurred. Please try again.",
    "→ Créer mon compte": "→ Create my account",
    "→ Continuer": "→ Continue",
    "Impossible de contacter le serveur. Vérifiez votre connexion.": "Unable to reach the server. Check your connection.",
    "Erreur réseau — vérifiez votre connexion.": "Network error — check your connection.",
    "Ce lien a déjà été utilisé.": "This link has already been used.",
    "Ce lien a expiré.": "This link has expired.",
    "Lien invalide ou introuvable.": "Invalid link or link not found.",
    "Token manquant": "Missing token",
    "Erreur base de données. Veuillez réessayer.": "Database error. Please try again.",
    "Demandez un nouveau lien depuis la page de connexion.": "Request a new link from the sign-in page.",
    "Les liens de connexion expirent après 1 heure. Demandez un nouveau lien.": "Sign-in links expire after one hour. Request a new link.",
    "L'email de connexion n'a pas pu être envoyé.": "The sign-in email could not be sent.",
    "Cette invitation a déjà été acceptée.": "This invitation has already been accepted.",
    "Connectez-vous directement.": "Sign in directly.",
    "Email incorrect — assurez-vous d'utiliser l'adresse à laquelle l'invitation a été envoyée.": "Incorrect email — use the address the invitation was sent to.",
    "Une erreur est survenue. Réessayez.": "An error occurred. Please try again.",
    "Cette invitation a été révoquée par l'administrateur.": "This invitation was revoked by the administrator.",
    "Ce lien d'invitation a expiré. Demandez un nouvel envoi à votre administrateur.": "This invitation link has expired. Ask your administrator to send a new one.",
    "Cette invitation est introuvable ou invalide.": "This invitation could not be found or is invalid.",
    "Ce lien d'invitation est invalide ou a expiré.": "This invitation link is invalid or has expired.",
    "Ce lien n'est plus valide.": "This link is no longer valid.",
    "Impossible de vérifier l'invitation. Vérifiez votre connexion et réessayez.": "Unable to verify the invitation. Check your connection and try again.",
    "Lien invalide": "Invalid link",
    "Invitation expirée": "Invitation expired",
    "Déjà acceptée": "Already accepted",
    "Invitation révoquée": "Invitation revoked",
    "Invitation introuvable": "Invitation not found",
    "Confirmez votre adresse email": "Confirm your email address",
    "Validation…": "Verifying…",
    "Organisation": "Organization",
    "Rôle": "Role",
    "Expire le": "Expires",
    "Erreur réseau": "Network error",
    "Aucun identifiant de rapport trouvé dans l'URL.": "No report ID was found in the URL.",
    "Ce rapport n'existe pas ou le lien de partage a expiré.": "This report does not exist or the sharing link has expired.",
    "Rapport introuvable ou expiré.": "Report not found or expired.",
    "Impossible de charger le rapport.": "Unable to load the report.",
    "Vérification du paiement — FlowPoint": "Payment verification — FlowPoint",
    "Compte activé !": "Account activated!",
    "Compte activé ! Vérifiez vos emails": "Account activated! Check your email",
    "Votre paiement est confirmé et votre compte a été créé.": "Your payment is confirmed and your account has been created.",
    "L'email de connexion n'a pas pu être envoyé — connectez-vous directement :": "The sign-in email could not be sent — sign in directly:",
    "Connectez-vous directement depuis la page de connexion :": "Sign in directly from the sign-in page:",
    "Vous pourrez demander un nouveau lien de connexion depuis cette page.": "You can request a new sign-in link from this page.",
    "Vous pourrez demander un nouveau lien depuis cette page.": "You can request a new link from this page.",
    "Add-on activé !": "Add-on activated!",
    "Votre add-on est": "Your add-on is",
    "immédiatement disponible": "available immediately",
    "Vous allez être redirigé vers le tableau de bord…": "You will be redirected to your dashboard…",
    "Abonnement en cours d'activation": "Activating subscription",
    "Votre paiement est confirmé.": "Your payment is confirmed.",
    "Activation de votre abonnement en cours…": "Your subscription is being activated…",
    "Vous serez redirigé automatiquement.": "You will be redirected automatically.",
    "Votre abonnement est confirmé.": "Your subscription is confirmed.",
    "Un": "A",
    "lien de connexion": "sign-in link",
    "vient de vous être envoyé par email.": "has just been sent to your email.",
    "Cliquez dessus pour accéder à votre tableau de bord.": "Click it to access your dashboard.",
    "Déjà connecté ? Se connecter →": "Already signed in? Sign in →",
    "Votre commande est confirmée !": "Your order is confirmed!",
    "Abonnement activé · 14 jours d'essai en cours.": "Subscription active · 14-day trial in progress.",
    "Vous allez être redirigé…": "You will be redirected…",
    "Paiement enregistré": "Payment recorded",
    "Votre paiement a bien été enregistré.": "Your payment has been recorded.",
    "Connectez-vous pour accéder à votre compte.": "Sign in to access your account.",
    "Erreur de finalisation": "Finalization error",
    "Une erreur est survenue lors de la création de votre abonnement.": "An error occurred while creating your subscription.",
    "Erreur lors de la finalisation. Réessayez ou contactez le support.": "An error occurred while finalizing. Please try again or contact support.",
    "Session de paiement introuvable ou invalide.": "Payment session not found or invalid.",
    "Une erreur inattendue est survenue.": "An unexpected error occurred.",
    "Connexion impossible": "Unable to sign in",
    "Votre paiement a peut-être abouti. Rendez-vous sur votre tableau de bord pour vérifier.": "Your payment may have gone through. Check your dashboard to confirm.",
    "Paiement en cours de traitement": "Payment is being processed",
    "Mise à jour de votre compte en cours. Vous serez redirigé automatiquement.": "Your account is being updated. You will be redirected automatically.",
    "Vérification impossible": "Unable to verify",
    "Rendez-vous sur le tableau de bord pour vérifier votre abonnement.": "Go to your dashboard to check your subscription.",
    "Compte activé ! Vérifiez vos emails": "Account activated! Check your email",
    "Votre abonnement est actif.": "Your subscription is active.",
    "Connexion automatique en cours…": "Signing you in automatically…",
    "Confirmation du paiement en cours…": "Payment confirmation in progress…",
    "Confirmation du paiement en cours (": "Payment confirmation in progress (",
    "Crédits IA ajoutés !": "AI credits added!",
    " crédits IA": " AI credits",
    " ont été ajoutés à votre compte.": " have been added to your account.",
    "⚡ Crédits IA ajoutés": "⚡ AI credits added",
    "✓ Add-on activé": "✓ Add-on activated",
    "✓ Abonnement activé — 14 jours d'essai offerts": "✓ Subscription activated — 14-day trial included",
    "Essai 14j": "14-day trial",
    "Payé maintenant": "Paid now",
    "Actif": "Active",
    "Votre espace FlowPoint est prêt": "Your FlowPoint workspace is ready",
    "Votre espace FlowPoint est prêt.": "Your FlowPoint workspace is ready.",
    "0€ / 14j": "€0 / 14 days",
    "Plan Standard": "Standard plan",
    "Plan Pro": "Pro plan",
    "Plan Ultra": "Ultra plan",
    "SLA Monitoring Avancé": "Advanced SLA monitoring",
    "+10 Emplacements GBP": "+10 GBP locations",
    "AB Testing IA": "AI A/B testing",
    "+5 Sièges": "+5 seats",
    "Rétention 90 jours": "90-day retention",
    "Rétention 365 jours": "365-day retention",
    "Webhooks Avancés": "Advanced webhooks",
    "Intégration CRM": "CRM integration",
    "Pack audits +200": "+200 audit pack",
    "Pack audits +1 000": "+1,000 audit pack",
    "Pack PDF +200": "+200 PDF pack",
    "Pack exports +1 000": "+1,000 export pack",
    "+50 000 crédits IA": "+50,000 AI credits",
    "+200 000 crédits IA": "+200,000 AI credits",
    "+500 000 crédits IA": "+500,000 AI credits",
    "Voir toutes les fonctionnalités (34 de plus)": "View all features (34 more)",
    "Voir tous les add-ons (24 de plus)": "View all add-ons (24 more)",
    "Tous les add-ons": "All add-ons",
    "➕ Ajout d'add-on à votre abonnement": "➕ Add an add-on to your subscription",
    "Sélectionnez l'add-on ci-dessous et cliquez sur Finaliser.": "Select the add-on below, then click Complete checkout.",
    "Aucun add-on sélectionné.": "No add-on selected.",
    "Sélectionnez d'abord un plan pour activer votre compte.": "Select a plan first to activate your account.",
    "Abonnement introuvable dans Stripe. Rechargez la page ou contactez le support.": "Subscription not found in Stripe. Reload the page or contact support.",
    "Erreur lors du changement de plan": "Unable to change plan",
    "Erreur réseau — réessayez": "Network error — please try again",
    "Page précédente": "Previous page",
    "Pour les grandes agences et entreprises.": "For large agencies and enterprises.",
    "1000 audits/mois": "1,000 audits/month",
    "1000 rapports PDF/mois": "1,000 PDF reports/month",
    "1000 exports/mois": "1,000 exports/month",
    "Commencer Standard": "Start Standard",
    "Audit technique complet": "Full technical audit",
    "Intelligence concurrentielle": "Competitor intelligence",
    "Gestion avis Google": "Google review management",
    "une fois": "one-time",
    "Acheter →": "Buy →",
    "ACHAT UNIQUE": "ONE-TIME PURCHASE",
    "Achat unique": "One-time purchase",
    "Chargement du catalogue…": "Loading catalog…",
    "Impossible de charger les add-ons. Actualisez la page pour réessayer.": "Unable to load add-ons. Refresh the page to try again.",
    "Basique": "Basic",
    "CGV": "Terms",
    "Pour les indépendants et PME": "For freelancers and small businesses",
    "Pour les agences et équipes growth": "For agencies and growth teams",
    "Pour les grandes agences et entreprises": "For large agencies and enterprises",
    "Démarrage": "Getting started",
    "IA": "AI",
    "IA Insights": "AI Insights",
    "IA Insights Pro": "AI Insights Pro",
    "Analytics concurrents": "Competitor analytics",
    "Facturation client": "Client billing",
    "Support prioritaire 4h": "Priority support within 4 hours",
    "Support email 48h": "48-hour email support",
    "SLA garanti 99.9%": "Guaranteed 99.9% SLA",
    "SLA 99.9% garanti": "Guaranteed 99.9% SLA",
    "White-label rapports": "White-label reports",
    "White-label portail": "White-label portal",
    "Équipe": "Team",
    "+10 monitors actifs": "+10 active monitors",
    "+50 monitors actifs": "+50 active monitors",
    "Synchronisation CRM": "CRM synchronization",
    "+200 audits mensuels": "+200 monthly audits",
    "+1 000 audits mensuels": "+1,000 monthly audits",
    "+200 exports PDF": "+200 PDF exports",
    "+1 000 exports": "+1,000 exports",
    "Pack de crédits IA": "AI credits pack",
    "Support dédié <1h": "Dedicated support <1 hour",
    "Veille concurrentielle IA": "AI competitive intelligence",
    "Multi-clients (agence)": "Multi-client agency"
  };

  var PUBLIC_ENGLISH_ATTRIBUTES = {
    "Marie": "Jane",
    "Dupont": "Smith",
    "marie@monentreprise.fr": "alex@mycompany.com",
    "Mon Agence Digitale": "My Digital Agency",
    "12 rue de la Paix": "123 Main Street",
    "Paris": "Brussels",
    "75001": "1000",
    "+33 6 12 34 56 78": "+32 470 12 34 56",
    "FR 12 345678901": "BE 0123.456.789",
    "vous@exemple.com": "you@example.com"
  };

  var PUBLIC_PAGES = {
    "signin.html": true, "login.html": true, "pricing.html": true,
    "cancel.html": true, "success.html": true, "accept-invitation.html": true,
    "login-verify.html": true, "report-view.html": true,
    "checkout-return.html": true, "checkout.html": true, "checkout-payment.html": true
  };

  // Signup funnel pages are now authored in ENGLISH (default language). For
  // visitors who chose French ('fp:language' = 'fr') they are translated
  // EN -> FR at runtime with PUBLIC_FRENCH (inverse of PUBLIC_ENGLISH, keeping
  // only unambiguous entries, plus explicit funnel strings) and a few patterns
  // for strings that embed dynamic numbers or prices.
  var FUNNEL_PAGES = {
    "signin.html": true, "login.html": true, "login-verify.html": true,
    "checkout.html": true, "checkout-payment.html": true, "checkout-return.html": true,
    "success.html": true, "cancel.html": true
  };

  var PUBLIC_FRENCH_EXPLICIT = {
    // signin.html
    "FlowPoint — Create your account": "FlowPoint — Créer votre compte",
    "Create your account": "Créer votre compte",
    "Enter your details to create your FlowPoint account.": "Renseignez vos informations pour créer votre compte FlowPoint.",
    "Continue with Google": "Continuer avec Google",
    "or fill in the form": "ou remplissez le formulaire",
    "First name *": "Prénom *",
    "Last name *": "Nom *",
    "Work email *": "Email professionnel *",
    "Continue to plan selection →": "Continuer vers le choix du plan →",
    "Already have an account?": "Déjà un compte ?",
    "Sign in": "Se connecter",
    "See plans and pricing →": "Voir les plans et tarifs →",
    "Choose your plan": "Choisissez votre plan",
    "14-day free trial · Card required · Cancel anytime": "Essai gratuit de 14 jours · Carte bancaire requise · Annulable à tout moment",
    "Ideal for freelancers and small teams": "Idéal pour les freelances et petites équipes",
    "/month": "/mois",
    "Recommended": "Recommandé",
    "For agencies and growing teams": "Pour les agences et équipes en croissance",
    "For large agencies and enterprises": "Pour les grandes agences et entreprises",
    "Secure payment via Stripe · Your card is not charged until the trial ends": "Paiement sécurisé via Stripe · Votre carte n'est débitée qu'à la fin de l'essai",
    "Compare plans in detail →": "Comparer les plans en détail →",
    "By creating an account, you agree to our": "En créant un compte, vous acceptez nos",
    "Terms and Conditions": "Conditions générales",
    "and our": "et notre",
    "Privacy Policy": "Politique de confidentialité",
    "Jane": "Marie",
    "Smith": "Dupont",
    "jane@company.com": "marie@monentreprise.fr",
    "✅ Your account has been permanently deleted. All your data has been erased.": "✅ Votre compte a été définitivement supprimé. Toutes vos données ont été effacées.",
    "Try again": "Réessayer",
    "Your session has expired. Please sign in again.": "Votre session a expiré. Veuillez vous reconnecter.",
    "Session verification is temporarily unavailable. Your session has been kept.": "La vérification de session est temporairement indisponible. Votre session a été conservée.",
    "We could not verify your session right now. Check your connection and try again.": "Impossible de vérifier votre session pour le moment. Vérifiez votre connexion et réessayez.",
    "Your sign-up session has expired. Please fill in the form again to continue.": "Votre session d'inscription a expiré. Veuillez remplir à nouveau le formulaire pour continuer.",
    "Access denied. Please allow access to your Google account.": "Accès refusé. Veuillez autoriser l'accès à votre compte Google.",
    "Google sign-in failed. Please try again.": "La connexion Google a échoué. Veuillez réessayer.",
    "GitHub sign-in failed. Please try again.": "La connexion GitHub a échoué. Veuillez réessayer.",
    "The sign-in code is missing. Please try again.": "Le code de connexion est manquant. Veuillez réessayer.",
    "A temporary error occurred while creating your Google sign-up session. Please try again.": "Une erreur temporaire est survenue lors de la création de votre session d'inscription Google. Veuillez réessayer.",
    "Sign-up could not be started. Please try again.": "L'inscription n'a pas pu démarrer. Veuillez réessayer.",
    "Continue to payment →": "Continuer vers le paiement →",
    "First name is required.": "Le prénom est obligatoire.",
    "Last name is required.": "Le nom est obligatoire.",
    "Please enter a valid email address.": "Veuillez saisir une adresse email valide.",
    "Temporary email addresses are not accepted.": "Les adresses email temporaires ne sont pas acceptées.",
    "An error occurred. Please try again.": "Une erreur est survenue. Veuillez réessayer.",
    "→ Sign in": "→ Se connecter",
    "→ Continue": "→ Continuer",
    "Unable to reach the server. Please check your connection.": "Impossible de joindre le serveur. Vérifiez votre connexion.",
    // login.html
    "Sign in — FlowPoint": "Connexion — FlowPoint",
    "Welcome back": "Bon retour",
    "Sign in to your FlowPoint workspace": "Connectez-vous à votre espace FlowPoint",
    "Email address": "Adresse email",
    "Send me a sign-in link": "Recevoir un lien de connexion",
    "or": "ou",
    "No account yet?": "Pas encore de compte ?",
    "Create your account →": "Créer votre compte →",
    "→ Create your account": "→ Créer votre compte",
    "See plans and pricing": "Voir les plans et tarifs",
    "By signing in, you agree to our": "En vous connectant, vous acceptez nos",
    "Terms of Use": "Conditions d'utilisation",
    "you@company.com": "vous@exemple.com",
    "We could not complete this request. Please try again.": "Impossible de traiter cette demande. Veuillez réessayer.",
    "Sending…": "Envoi…",
    "Access denied.": "Accès refusé.",
    "Your sign-in session expired. Please try again.": "Votre session de connexion a expiré. Veuillez réessayer.",
    "Your Google email address is not verified.": "Votre adresse email Google n'est pas vérifiée.",
    "No active FlowPoint workspace is linked to this account.": "Aucun espace FlowPoint actif n'est lié à ce compte.",
    "Please enter your email address.": "Veuillez saisir votre adresse email.",
    "✉️ If this address matches an authorized account, a sign-in link may be sent.": "✉️ Si cette adresse correspond à un compte autorisé, un lien de connexion peut vous être envoyé.",
    "Please also check your spam folder.": "Pensez à vérifier vos spams.",
    "Email service unavailable. Please continue with Google.": "Service email indisponible. Veuillez continuer avec Google.",
    // login-verify.html
    "Verifying — FlowPoint": "Vérification — FlowPoint",
    "Verifying…": "Vérification…",
    "We are checking your sign-in link. Please wait.": "Nous vérifions votre lien de connexion. Veuillez patienter.",
    "You are signed in!": "Vous êtes connecté !",
    "Redirecting you to your dashboard…": "Redirection vers votre tableau de bord…",
    "Invalid link": "Lien invalide",
    "This sign-in link is invalid or has expired.": "Ce lien de connexion est invalide ou a expiré.",
    "Request a new link": "Demander un nouveau lien",
    "Back to sign in": "Retour à la connexion",
    // checkout.html
    "Summary — FlowPoint": "Récapitulatif — FlowPoint",
    "Plans": "Plans",
    "Summary": "Récapitulatif",
    "Payment": "Paiement",
    "Your cart is empty": "Votre panier est vide",
    "Pick a plan, an add-on or AI credits on the pricing page to get started.": "Choisissez un plan, une option ou des crédits IA sur la page tarifs pour commencer.",
    "See plans →": "Voir les plans →",
    "Choose a FlowPoint plan to activate your workspace. A plan is required.": "Choisissez un plan FlowPoint pour activer votre espace. Un plan est obligatoire.",
    "Continue to secure payment →": "Continuer vers le paiement sécurisé →",
    "← Edit my cart": "← Modifier mon panier",
    "Secure payment by Stripe · TLS encryption": "Paiement sécurisé par Stripe · Chiffrement TLS",
    "€0 today · Card required · Cancel anytime": "0 € aujourd'hui · Carte bancaire requise · Annulable à tout moment",
    "Most popular": "Le plus populaire",
    "Start free trial": "Commencer l'essai gratuit",
    "Choose this plan": "Choisir ce plan",
    "Card required · Cancel anytime": "Carte bancaire requise · Annulable à tout moment",
    "Free trial": "Essai gratuit",
    "Monthly · no commitment · cancel anytime": "Mensuel · sans engagement · annulable à tout moment",
    "Add-ons active from today": "Options actives dès aujourd'hui",
    "Billed today": "Facturé aujourd'hui",
    "Activated immediately": "Activé immédiatement",
    "Included in the plan": "Inclus dans le plan",
    "Included": "Inclus",
    "€0": "0 €",
    "AI credits — one-time purchase": "Crédits IA — achat unique",
    "One-time": "Achat unique",
    "Credits available immediately": "Crédits disponibles immédiatement",
    "Due today": "À payer aujourd'hui",
    "Monthly": "Mensuel",
    "Add-ons billed today · active immediately · renewed every month.": "Options facturées aujourd'hui · actives immédiatement · renouvelées chaque mois.",
    "AI credits charged now · one-time purchase.": "Crédits IA débités maintenant · achat unique.",
    "Cancel anytime · payments secured by Stripe.": "Annulable à tout moment · paiements sécurisés par Stripe.",
    "This add-on is not sold separately.": "Cette option n'est pas vendue séparément.",
    "We could not calculate the amount. Please try again.": "Impossible de calculer le montant. Veuillez réessayer.",
    "Plans are unavailable right now. Reload the page in a moment.": "Les plans sont indisponibles pour le moment. Rechargez la page dans un instant.",
    "Choose a plan first": "Choisissez d'abord un plan",
    "Redirecting…": "Redirection…",
    "Something went wrong while loading. Reload the page or go back to plans.": "Un problème est survenu au chargement. Rechargez la page ou revenez aux plans.",
    // checkout-payment.html
    "Payment — FlowPoint": "Paiement — FlowPoint",
    "Loading…": "Chargement…",
    "Card details": "Informations de carte",
    "Confirms your FlowPoint subscription. A card is required; payments are secured by Stripe.": "Confirme votre abonnement FlowPoint. Une carte est requise ; les paiements sont sécurisés par Stripe.",
    "← Back to summary": "← Retour au récapitulatif",
    "Secure payment · TLS · your card details never touch our servers": "Paiement sécurisé · TLS · vos données de carte ne transitent jamais par nos serveurs",
    "Confirm and start": "Confirmer et démarrer",
    "Confirm →": "Confirmer →",
    "The browser blocked the Stripe payment module (site security policy). Try again; if the problem persists, contact support.": "Le navigateur a bloqué le module de paiement Stripe (politique de sécurité du site). Réessayez ; si le problème persiste, contactez le support.",
    "You appear to be offline: the Stripe payment module could not be loaded. Check your Internet connection, then try again.": "Vous semblez hors ligne : le module de paiement Stripe n'a pas pu être chargé. Vérifiez votre connexion Internet, puis réessayez.",
    "The Stripe payment module could not be loaded (unstable network, firewall, browser extension or temporary outage). Try again; if the problem persists, try another network or temporarily disable your extensions.": "Le module de paiement Stripe n'a pas pu être chargé (réseau instable, pare-feu, extension de navigateur ou panne temporaire). Réessayez ; si le problème persiste, essayez un autre réseau ou désactivez temporairement vos extensions.",
    "Start my free trial": "Commencer mon essai gratuit",
    "Calculating the amount…": "Calcul du montant…",
    "Today": "Aujourd'hui",
    "Today · monthly": "Aujourd'hui · mensuel",
    "After trial · monthly": "Après l'essai · mensuel",
    "Monthly after trial": "Mensuel après l'essai",
    "Cancel anytime before to avoid being charged.": "Annulez avant la fin pour ne pas être débité.",
    "Price summary unavailable. Go back to the summary and try again.": "Récapitulatif de prix indisponible. Revenez au récapitulatif et réessayez.",
    "Invalid server response. Go back to the summary and try again.": "Réponse du serveur invalide. Revenez au récapitulatif et réessayez.",
    "Payment configuration missing. Please contact support.": "Configuration de paiement manquante. Veuillez contacter le support.",
    "The payment form could not be displayed (connection or Stripe service temporarily unavailable).": "Le formulaire de paiement n'a pas pu s'afficher (connexion ou service Stripe temporairement indisponible).",
    "The payment form could not be displayed (connection or Stripe service temporarily unavailable). Try again.": "Le formulaire de paiement n'a pas pu s'afficher (connexion ou service Stripe temporairement indisponible). Réessayez.",
    "The payment failed. Check your details and try again.": "Le paiement a échoué. Vérifiez vos informations et réessayez.",
    "The Stripe confirmation is incomplete. Try again or contact support.": "La confirmation Stripe est incomplète. Réessayez ou contactez le support.",
    "Something went wrong. Try again or contact support.": "Un problème est survenu. Réessayez ou contactez le support.",
    // checkout-return.html
    "Verifying payment — FlowPoint": "Vérification du paiement — FlowPoint",
    "Finalizing your account…": "Finalisation de votre compte…",
    "Please wait a moment.": "Merci de patienter un instant.",
    "Verifying your payment…": "Vérification de votre paiement…",
    "We are confirming your payment with the server. This only takes a few seconds.": "Nous confirmons votre paiement auprès du serveur. Cela ne prend que quelques secondes.",
    "What you ordered": "Votre commande",
    "Go to my dashboard →": "Accéder à mon tableau de bord →",
    "Sign in to access your dashboard": "Connectez-vous pour accéder à votre tableau de bord",
    "Retry verification": "Relancer la vérification",
    "View pricing": "Voir les tarifs",
    "Back to home": "Retour à l'accueil",
    "Sign in to verify your purchase": "Connectez-vous pour vérifier votre achat",
    "We cannot confirm this payment without being signed in to the account used for the purchase. Nothing is confirmed at this stage: sign in, then check your billing.": "Nous ne pouvons pas confirmer ce paiement sans connexion au compte utilisé pour l'achat. Rien n'est confirmé à ce stade : connectez-vous, puis vérifiez votre facturation.",
    "Payment session not found or expired": "Session de paiement introuvable ou expirée",
    "No purchase was confirmed for this link. Start again from the pricing page, or sign in to see the real state of your account.": "Aucun achat n'a été confirmé pour ce lien. Recommencez depuis la page tarifs, ou connectez-vous pour voir l'état réel de votre compte.",
    "View plans": "Voir les plans",
    "This payment does not belong to this account": "Ce paiement n'appartient pas à ce compte",
    "This payment session does not match the signed-in organization. Sign in with the account used for the purchase.": "Cette session de paiement ne correspond pas à l'organisation connectée. Connectez-vous avec le compte utilisé pour l'achat.",
    "Payment failed": "Paiement échoué",
    "Your payment did not go through: no purchase is confirmed and nothing was activated. You can try again with the same payment method or another one.": "Votre paiement n'a pas abouti : aucun achat n'est confirmé et rien n'a été activé. Vous pouvez réessayer avec le même moyen de paiement ou un autre.",
    "Try the payment again": "Relancer le paiement",
    "Confirmation pending": "Confirmation en attente",
    "The server has not confirmed this payment yet. This is not a failure, but nothing is confirmed for now. Try again in a few moments.": "Le serveur n'a pas encore confirmé ce paiement. Ce n'est pas un échec, mais rien n'est confirmé pour l'instant. Réessayez dans quelques instants.",
    "Verification unavailable right now": "Vérification indisponible pour le moment",
    "An error occurred (server or connection): your payment could not be verified. This is not a confirmation. Try again; if it persists, check your billing.": "Une erreur est survenue (serveur ou connexion) : votre paiement n'a pas pu être vérifié. Ce n'est pas une confirmation. Réessayez ; si cela persiste, vérifiez votre facturation.",
    "Payment canceled": "Paiement annulé",
    "No purchase was confirmed and you have not been charged. You can go back to billing and try again.": "Aucun achat n'a été confirmé et vous n'avez pas été débité. Vous pouvez revenir à la facturation et réessayer.",
    "Back to billing": "Retour à la facturation",
    "Your account is ready!": "Votre compte est prêt !",
    "Your payment is confirmed and your account has been created.": "Votre paiement est confirmé et votre compte a été créé.",
    "We could not send your sign-in email.": "Nous n'avons pas pu envoyer votre email de connexion.",
    "Sign in directly from the login page:": "Connectez-vous directement depuis la page de connexion :",
    "Sign in →": "Se connecter →",
    "You can request a new sign-in link from that page.": "Vous pouvez demander un nouveau lien de connexion depuis cette page.",
    "Add-on activated!": "Option activée !",
    "Your add-on is": "Votre option est",
    "available right away": "disponible immédiatement",
    "Subscription activation in progress": "Activation de l'abonnement en cours",
    "Your payment is confirmed.": "Votre paiement est confirmé.",
    "Activating your subscription…": "Activation de votre abonnement…",
    "You will be redirected as soon as activation is confirmed.": "Vous serez redirigé dès que l'activation sera confirmée.",
    "Your account is ready! Check your email": "Votre compte est prêt ! Consultez vos emails",
    "Your subscription is confirmed.": "Votre abonnement est confirmé.",
    "We just emailed you a": "Nous venons de vous envoyer un",
    "sign-in link": "lien de connexion",
    "Click it to go to your dashboard.": "Cliquez dessus pour accéder à votre tableau de bord.",
    "Already have access? Sign in →": "Déjà un accès ? Se connecter →",
    "Your order is confirmed!": "Votre commande est confirmée !",
    "Subscription activated · your 14-day free trial has started.": "Abonnement activé · 14 jours d'essai en cours.",
    "Redirecting you…": "Vous allez être redirigé…",
    "Confirming your payment…": "Confirmation de votre paiement…",
    "We are waiting for confirmation from your bank.": "Nous attendons la confirmation de votre banque.",
    "We could not send your sign-in email — sign in directly:": "Nous n'avons pas pu envoyer votre email de connexion — connectez-vous directement :",
    "Could not finalize your account": "Impossible de finaliser votre compte",
    "An error occurred while creating your subscription.": "Une erreur est survenue lors de la création de votre abonnement.",
    "Back to plans": "Retour aux plans",
    "Open billing": "Ouvrir la facturation",
    "Activation is confirmed and your account access has been updated.": "L'activation est confirmée et l'accès à votre compte a été mis à jour.",
    "Activation in progress": "Activation en cours",
    "Your payment is confirmed, but updating your account is taking longer than expected. Try again in a few moments or open billing to refresh your account.": "Votre paiement est confirmé, mais la mise à jour de votre compte prend plus de temps que prévu. Réessayez dans quelques instants ou ouvrez la facturation pour actualiser votre compte.",
    "Payment session expired": "Session de paiement expirée",
    "No purchase was confirmed. Go back to billing to start again.": "Aucun achat n'a été confirmé. Revenez à la facturation pour recommencer.",
    "Checking your account update…": "Vérification de la mise à jour de votre compte…",
    "Payment not confirmed": "Paiement non confirmé",
    "Stripe does not report a completed payment for this session yet. Check your payment method or go back to billing.": "Stripe ne signale pas encore de paiement finalisé pour cette session. Vérifiez votre moyen de paiement ou revenez à la facturation.",
    "Verification unavailable": "Vérification indisponible",
    "We could not confirm the status of this purchase. Check your billing before trying again.": "Impossible de confirmer le statut de cet achat. Vérifiez votre facturation avant de réessayer.",
    "Verification in progress": "Vérification en cours",
    "Connection temporarily unavailable. Retrying…": "Connexion temporairement indisponible. Nouvelle tentative…",
    "The payment server is not responding. Try again or check your account.": "Le serveur de paiement ne répond pas. Réessayez ou vérifiez votre compte.",
    "Your subscription is active.": "Votre abonnement est actif.",
    "Signing you in automatically…": "Connexion automatique…",
    "No purchase was confirmed. Go back to the plans to start again.": "Aucun achat n'a été confirmé. Revenez aux plans pour recommencer.",
    "You can request a new link from that page.": "Vous pouvez demander un nouveau lien depuis cette page.",
    "An unexpected error occurred while activating your account.": "Une erreur inattendue est survenue lors de l'activation de votre compte.",
    // success.html
    "Redirecting automatically in": "Redirection automatique dans",
    "Standard plan": "Plan Standard",
    "Pro plan": "Plan Pro",
    "Ultra plan": "Plan Ultra",
    "+10 GBP Locations": "+10 établissements GBP",
    "AI A/B Testing": "A/B testing IA",
    "+200 audits pack": "Pack +200 audits",
    "+1,000 audits pack": "Pack +1 000 audits",
    "+200 PDF pack": "Pack +200 PDF",
    "+1,000 exports pack": "Pack +1 000 exports",
    "+50,000 AI credits": "+50 000 crédits IA",
    "+200,000 AI credits": "+200 000 crédits IA",
    "+500,000 AI credits": "+500 000 crédits IA",
    "No payment to confirm": "Aucun paiement à confirmer",
    "This page confirms a payment after a Stripe checkout. No payment session was found: no purchase is in progress.": "Cette page confirme un paiement après un passage sur Stripe. Aucune session de paiement n'a été trouvée : aucun achat n'est en cours.",
    "No purchase was confirmed for this link. If you did pay, sign in: your account shows the real state of your subscription. Otherwise, start again from the pricing page.": "Aucun achat n'a été confirmé pour ce lien. Si vous avez payé, connectez-vous : votre compte indique l'état réel de votre abonnement. Sinon, recommencez depuis la page tarifs.",
    "We cannot confirm this payment until you are signed in to the account used for the purchase. Nothing is confirmed at this stage.": "Nous ne pouvons pas confirmer ce paiement tant que vous n'êtes pas connecté au compte utilisé pour l'achat. Rien n'est confirmé à ce stade.",
    "Payment not completed": "Paiement non finalisé",
    "Stripe does not report a completed payment for this session: no purchase is confirmed and nothing was activated. You can start again from the pricing page.": "Stripe ne signale aucun paiement finalisé pour cette session : aucun achat n'est confirmé et rien n'a été activé. Vous pouvez recommencer depuis la page tarifs.",
    "Your payment is confirmed and your account was created, but the sign-in email could not be sent. Sign in from the login page.": "Votre paiement est confirmé et votre compte a été créé, mais l'email de connexion n'a pas pu être envoyé. Connectez-vous depuis la page de connexion.",
    "Your payment is confirmed. A sign-in link has just been emailed to you: open it to reach your dashboard.": "Votre paiement est confirmé. Un lien de connexion vient de vous être envoyé par email : ouvrez-le pour accéder à votre tableau de bord.",
    "Your FlowPoint workspace is ready.": "Votre espace FlowPoint est prêt.",
    "Payment confirmed!": "Paiement confirmé !",
    "Payment confirmed — FlowPoint": "Paiement confirmé — FlowPoint",
    "⚡ AI credits added": "⚡ Crédits IA ajoutés",
    "✓ Add-on activated": "✓ Option activée",
    "✓ Subscription activated — 14-day free trial started": "✓ Abonnement activé — 14 jours d'essai offerts",
    "Paid now": "Payé maintenant",
    "Active": "Actif",
    // cancel.html
    "Payment canceled — FlowPoint": "Paiement annulé — FlowPoint",
    "You canceled the checkout. Your free trial has not started yet.": "Vous avez annulé le paiement. Votre essai gratuit n'a pas encore commencé.",
    "No subscription was confirmed and you have not been charged.": "Aucun abonnement n'a été confirmé et vous n'avez pas été débité.",
    "Your selection has been saved": "Votre sélection a été enregistrée",
    "Resume my free trial →": "Reprendre mon essai gratuit →",
    "Back to pricing": "Retour aux tarifs"
  };

  // Wording restored from the original French pages (origin/Test-Replit).
  // These override the explicit entries above; typography kept as-is.
  var PUBLIC_FRENCH_ORIGINAL = {
    "✅ Your account has been permanently deleted. All your data has been erased.": "✅ Votre compte a été supprimé définitivement. Toutes vos données ont été effacées.",
    "Your session has expired. Please sign in again.": "Votre session a expiré. Connectez-vous à nouveau.",
    "Session verification is temporarily unavailable. Your session has been kept.": "La vérification de votre session est temporairement indisponible. Votre session est conservée.",
    "We could not verify your session right now. Check your connection and try again.": "Impossible de vérifier votre session pour le moment. Vérifiez votre connexion puis réessayez.",
    "Create your account": "Créer votre compte FlowPoint",
    "14-day free trial · Card required · Cancel anytime": "14 jours d'essai gratuit · Carte requise · Annulation à tout moment",
    "Ideal for freelancers and small teams": "Idéal pour les indépendants et petites équipes",
    "Secure payment via Stripe · Your card is not charged until the trial ends": "Paiement sécurisé via Stripe · Aucune carte débitée avant la fin de l'essai",
    "Terms and Conditions": "Conditions Générales",
    "Your sign-up session has expired. Please fill in the form again to continue.": "Votre session d'inscription a expiré. Veuillez renseigner à nouveau le formulaire pour continuer.",
    "Access denied. Please allow access to your Google account.": "Accès refusé. Autorisez l'accès à votre compte Google.",
    "Google sign-in failed. Please try again.": "Erreur d'authentification Google. Veuillez réessayer.",
    "GitHub sign-in failed. Please try again.": "Erreur d'authentification GitHub. Veuillez réessayer.",
    "The sign-in code is missing. Please try again.": "Code OAuth manquant. Veuillez réessayer.",
    "A temporary error occurred while creating your Google sign-up session. Please try again.": "Une erreur temporaire s'est produite lors de la création de votre session d'inscription Google. Veuillez réessayer.",
    "First name is required.": "Le prénom est requis.",
    "Last name is required.": "Le nom est requis.",
    "Please enter a valid email address.": "Adresse email invalide.",
    "An error occurred. Please try again.": "Une erreur est survenue.",
    "Welcome back": "Bienvenue",
    "Email address": "Adresse e-mail",
    "Send me a sign-in link": "Recevoir le lien de connexion",
    "Create your account →": "Créer mon compte →",
    "→ Create your account": "→ Créer mon compte",
    "Verifying…": "Vérification en cours…",
    "We are checking your sign-in link. Please wait.": "Nous validons votre lien de connexion, veuillez patienter.",
    "You are signed in!": "Connexion réussie !",
    "Redirecting you to your dashboard…": "Vous êtes connecté. Redirection vers votre tableau de bord…",
    "Plans": "Tarifs",
    "Your cart is empty": "Panier vide",
    "Pick a plan, an add-on or AI credits on the pricing page to get started.": "Sélectionnez un plan, un add-on ou des crédits IA depuis la page tarifs pour commencer.",
    "Secure payment by Stripe · TLS encryption": "Paiement sécurisé Stripe · Chiffrement TLS",
    "Billed today": "Facturé maintenant",
    "Something went wrong while loading. Reload the page or go back to plans.": "Erreur de chargement. Rechargez la page ou revenez aux tarifs.",
    "This add-on is not sold separately.": "Cet add-on n'est pas vendu séparément.",
    "Card details": "Informations de paiement",
    "Confirms your FlowPoint subscription. A card is required; payments are secured by Stripe.": "Confirme et finalise votre abonnement FlowPoint. Paiement sécurisé par Stripe.",
    "Confirm and start": "Confirmer et payer",
    "← Back to summary": "← Récapitulatif",
    "Secure payment · TLS · your card details never touch our servers": "Paiement sécurisé · TLS · vos données ne transitent pas par nos serveurs",
    "Today": "Maintenant",
    "Today · monthly": "Maintenant · mensuel",
    "After trial · monthly": "Après essai · mensuel",
    "Due today": "Dû aujourd'hui",
    "Monthly after trial": "Mensuel après essai",
    "Please wait a moment.": "Merci de patienter quelques instants.",
    "What you ordered": "Ce que vous avez commandé",
    "Go to my dashboard →": "Accéder au tableau de bord →",
    "Sign in to access your dashboard": "Se connecter pour accéder au dashboard",
    "Retry verification": "Réessayer la vérification",
    "View plans": "Voir les offres",
    "Try the payment again": "Réessayer le paiement",
    "Verification unavailable right now": "Vérification impossible pour le moment",
    "Verification unavailable": "Vérification impossible",
    "Subscription activation in progress": "Abonnement en cours d'activation",
    "Activating your subscription…": "Activation de votre abonnement en cours…",
    "You will be redirected as soon as activation is confirmed.": "Vous serez redirigé dès que l'activation est confirmée.",
    "Confirming your payment…": "Confirmation du paiement en cours…",
    "Your payment is confirmed and your account has been created.": "Votre paiement est confirmé et votre compte a été créé.",
    "We could not send your sign-in email.": "L'email de connexion n'a pas pu être envoyé.",
    "We could not send your sign-in email — sign in directly:": "L'email de connexion n'a pas pu être envoyé — connectez-vous directement :",
    "Sign in directly from the login page:": "Connectez-vous directement depuis la page de connexion :",
    "Your add-on is": "Votre add-on est",
    "available right away": "immédiatement disponible",
    "Your subscription is confirmed.": "Votre abonnement est confirmé.",
    "An error occurred while creating your subscription.": "Une erreur est survenue lors de la création de votre abonnement.",
    "AI credits added": "Crédits IA ajoutés",
    "Add-on and credits activated": "Add-on et crédits activés",
    "Add-on activated": "Add-on activé",
    "Open billing": "Ouvrir la facturation",
    "Your subscription is active.": "Votre abonnement est actif.",
    "Signing you in automatically…": "Connexion automatique en cours…",
    "An unexpected error occurred while activating your account.": "Une erreur inattendue est survenue.",
    "Standard plan": "Plan Standard",
    "Advanced SLA Monitoring": "SLA Monitoring Avancé",
    "+10 GBP Locations": "+10 Emplacements GBP",
    "AI A/B Testing": "AB Testing IA",
    "+5 Seats": "+5 Sièges",
    "90-day retention": "Rétention 90 jours",
    "365-day retention": "Rétention 365 jours",
    "Advanced Webhooks": "Webhooks Avancés",
    "CRM Integration": "Intégration CRM",
    "Priority Support": "Support Prioritaire",
    "+200 audits pack": "Pack audits +200",
    "+1,000 audits pack": "Pack audits +1 000",
    "+200 PDF pack": "Pack PDF +200",
    "+1,000 exports pack": "Pack exports +1 000",
    "No payment to confirm": "Aucun paiement à confirmer",
    "This page confirms a payment after a Stripe checkout. No payment session was found: no purchase is in progress.": "Cette page confirme un paiement après un passage par Stripe. Aucune session de paiement n'a été trouvée : aucun achat n'est en cours.",
    "No purchase was confirmed for this link. If you did pay, sign in: your account shows the real state of your subscription. Otherwise, start again from the pricing page.": "Aucun achat n'a été confirmé pour ce lien. Si vous avez bien payé, connectez-vous : votre compte indique l'état réel de votre abonnement. Sinon, reprenez depuis les tarifs.",
    "We cannot confirm this payment until you are signed in to the account used for the purchase. Nothing is confirmed at this stage.": "Nous ne pouvons pas confirmer ce paiement tant que vous n'êtes pas connecté au compte utilisé lors de l'achat. Rien n'est confirmé à ce stade.",
    "This payment does not belong to this account": "Ce paiement n'appartient pas à ce compte",
    "This payment session does not match the signed-in organization. Sign in with the account used for the purchase.": "Cette session de paiement ne correspond pas à l'organisation connectée. Connectez-vous avec le compte utilisé lors de l'achat.",
    "Stripe does not report a completed payment for this session: no purchase is confirmed and nothing was activated. You can start again from the pricing page.": "Stripe n'indique pas de paiement terminé pour cette session : aucun achat n'est confirmé et rien n'a été activé. Vous pouvez reprendre depuis les tarifs.",
    "The server has not confirmed this payment yet. This is not a failure, but nothing is confirmed for now. Try again in a few moments.": "Le serveur n'a pas encore confirmé ce paiement. Ce n'est pas un échec, mais rien n'est confirmé pour le moment. Réessayez dans quelques instants.",
    "An error occurred (server or connection): your payment could not be verified. This is not a confirmation. Try again; if it persists, check your billing.": "Une erreur est survenue (serveur ou connexion) : votre paiement n'a pas pu être vérifié. Ce n'est pas une confirmation. Réessayez ; si le problème persiste, consultez votre facturation.",
    "Your payment is confirmed and your account was created, but the sign-in email could not be sent. Sign in from the login page.": "Votre paiement est confirmé et votre compte a été créé, mais l'e-mail de connexion n'a pas pu être envoyé. Connectez-vous depuis la page de connexion.",
    "Your payment is confirmed. A sign-in link has just been emailed to you: open it to reach your dashboard.": "Votre paiement est confirmé. Un lien de connexion vient de vous être envoyé par e-mail : ouvrez-le pour accéder à votre tableau de bord.",
    "✓ Add-on activated": "✓ Add-on activé",
    "✓ Subscription activated — 14-day trial included": "✓ Abonnement activé — 14 jours d'essai offerts",
    "You canceled the checkout. Your free trial has not started yet.": "Vous avez annulé la procédure de paiement.",
    "No subscription was confirmed and you have not been charged.": "Aucun abonnement n'a été confirmé. Aucun montant n'a été débité.",
    "Your selection has been saved": "Votre sélection est conservée"
  };
  // checkout-return.html used typographic apostrophes (’) in its original copy.
  var PUBLIC_FRENCH_BY_PAGE = {
    "checkout-return.html": {
      "We cannot confirm this payment without being signed in to the account used for the purchase. Nothing is confirmed at this stage: sign in, then check your billing.": "Nous ne pouvons pas confirmer ce paiement sans être connecté au compte utilisé lors de l’achat. Rien n’est confirmé à ce stade : connectez-vous, puis consultez la facturation.",
      "No purchase was confirmed for this link. Start again from the pricing page, or sign in to see the real state of your account.": "Aucun achat n’a été confirmé pour ce lien. Reprenez depuis les offres, ou connectez-vous pour voir l’état réel de votre compte.",
      "This payment does not belong to this account": "Ce paiement n’appartient pas à ce compte",
      "This payment session does not match the signed-in organization. Sign in with the account used for the purchase.": "Cette session de paiement ne correspond pas à l’organisation connectée. Connectez-vous avec le compte utilisé lors de l’achat.",
      "Your payment did not go through: no purchase is confirmed and nothing was activated. You can try again with the same payment method or another one.": "Votre paiement n’a pas abouti : aucun achat n’est confirmé et rien n’a été activé. Vous pouvez réessayer avec le même moyen de paiement ou un autre.",
      "The server has not confirmed this payment yet. This is not a failure, but nothing is confirmed for now. Try again in a few moments.": "Le serveur n’a pas encore confirmé ce paiement. Ce n’est pas un échec, mais rien n’est confirmé pour le moment. Réessayez dans quelques instants.",
      "An error occurred (server or connection): your payment could not be verified. This is not a confirmation. Try again; if it persists, check your billing.": "Une erreur est survenue (serveur ou connexion) : votre paiement n’a pas pu être vérifié. Ce n’est pas une confirmation. Réessayez ; si le problème persiste, consultez votre facturation.",
      "No purchase was confirmed and you have not been charged. You can go back to billing and try again.": "Aucun achat n’a été confirmé. Vous pouvez revenir à la facturation et réessayer.",
      "Activation is confirmed and your account access has been updated.": "L’activation a été confirmée et vos droits ont été mis à jour.",
      "Your payment is confirmed, but updating your account is taking longer than expected. Try again in a few moments or open billing to refresh your account.": "Le paiement est confirmé, mais la mise à jour de vos droits prend plus de temps que prévu. Réessayez dans quelques instants ou ouvrez la facturation pour actualiser votre compte.",
      "No purchase was confirmed. Go back to billing to start again.": "Aucun achat n’a été confirmé. Retournez à la facturation pour recommencer.",
      "Stripe does not report a completed payment for this session yet. Check your payment method or go back to billing.": "La session Stripe n’indique pas encore un paiement terminé. Vérifiez votre mode de paiement ou retournez à la facturation.",
      "We could not confirm the status of this purchase. Check your billing before trying again.": "Le statut de cet achat n’a pas pu être confirmé. Consultez la facturation avant de réessayer.",
      "The payment server is not responding. Try again or check your account.": "Le serveur de paiement ne répond pas. Réessayez ou consultez votre compte.",
      "No purchase was confirmed. Go back to the plans to start again.": "Aucun achat n’a été confirmé. Retournez aux offres pour recommencer.",
      "Payment session expired": "Session de paiement expirée",
      "Payment not confirmed": "Paiement non confirmé",
      "Redirecting you to your dashboard…": "Vous allez être redirigé vers le tableau de bord…"
    }
  };

  var PUBLIC_FRENCH = (function () {
    var inverse = {};
    var ambiguous = {};
    Object.keys(PUBLIC_ENGLISH).forEach(function (french) {
      var english = PUBLIC_ENGLISH[french];
      if (Object.prototype.hasOwnProperty.call(inverse, english) && inverse[english] !== french) ambiguous[english] = true;
      else inverse[english] = french;
    });
    Object.keys(ambiguous).forEach(function (english) { delete inverse[english]; });
    Object.keys(PUBLIC_FRENCH_EXPLICIT).forEach(function (english) {
      inverse[english] = PUBLIC_FRENCH_EXPLICIT[english];
    });
    Object.keys(PUBLIC_FRENCH_ORIGINAL).forEach(function (english) {
      inverse[english] = PUBLIC_FRENCH_ORIGINAL[english];
    });
    return inverse;
  })();

  // "€29" -> "29 €", "€29.50" -> "29,50 €" (non-breaking space before €).
  function frenchMoney(text) {
    return String(text).replace(/€\s?(\d+(?:[.,]\d+)?)/g, function (_, amount) {
      return amount.replace('.', ',') + ' €';
    });
  }
  var AMOUNT = '€\\s?\\d+(?:[.,]\\d+)?';
  // Fragment patterns, applied in order after an exact-match miss. A string is
  // only rewritten when at least one pattern matched; amounts are then
  // converted to the French format.
  var PUBLIC_FRENCH_PATTERNS = [
    [/^(\d+) days free$/, '$1 jours gratuits'],
    // Message serveur de validation du panier (/billing/quote, /public/payment-intent).
    [/^Unknown add-on: "(.+)"$/, 'Add-on inconnu : "$1"'],
    [new RegExp('^(' + AMOUNT + ')/month after trial$'), "puis $1/mois après l'essai"],
    [/^Start my (\d+)-day free trial →$/, 'Commencer mon essai gratuit de $1 jours →'],
    [new RegExp('^Pay (' + AMOUNT + ') and subscribe$'), "Payer $1 et s'abonner"],
    [new RegExp('^(' + AMOUNT + ') today \\(add-ons\\) · Card required · Cancel anytime$'), "$1 aujourd'hui (options) · Carte bancaire requise · Annulable à tout moment"],
    [new RegExp('^(' + AMOUNT + ') due today · Cancel anytime$'), "$1 à payer aujourd'hui · Annulable à tout moment"],
    [new RegExp('^€0 today for the plan · (' + AMOUNT + ') today for add-ons · Card required · Cancel anytime$'), "0 € aujourd'hui pour le plan · $1 aujourd'hui pour les add-ons · Carte bancaire requise · Annulable à tout moment"],
    [/^Monthly after (\d+) days$/, 'Mensuel après $1 jours'],
    [/^(\d+)-day free trial · €0 charged today for the plan\.$/, "Essai gratuit de $1 jours · 0 € débité aujourd'hui pour le plan."],
    [new RegExp('^Card required · then (' + AMOUNT + ')/month after your trial unless you cancel before it ends\\.$'), "Carte bancaire requise · puis $1/mois après votre essai, sauf annulation avant la fin."],
    [/^Unreadable server response \((\d+)\)\.$/, 'Réponse du serveur illisible ($1).'],
    [/^Price summary unavailable \((\d+)\)\.$/, 'Récapitulatif de prix indisponible ($1).'],
    [/^Network error \((\d+)\)\. Check your connection and try again\.$/, 'Erreur réseau ($1). Vérifiez votre connexion et réessayez.'],
    [/^Loading error: (.*)\. Go back to the summary and try again\.$/, 'Erreur de chargement : $1. Revenez au récapitulatif et réessayez.'],
    [/^Confirming your payment \((\d+)\)…$/, 'Confirmation de votre paiement ($1)…'],
    [/^Confirming with the server \(attempt (\d+)\)…$/, 'Confirmation en cours auprès du serveur (tentative $1)…'],
    [/^→ Sign in \((\d+)s\)$/, '→ Se connecter ($1 s)'],
    [/^(.+) — (.+) per month after trial$/, function (_, name, price) { return (PUBLIC_FRENCH[name] || name) + ' — ' + price + ' par mois après essai'; }],
    [/^(\d+)-day trial$/, 'Essai $1j'],
    [/^(.+) — (\d+)-day free trial$/, function (_, name, days) { return (PUBLIC_FRENCH[name] || name) + ' — essai gratuit de ' + days + ' jours'; }],
    [/^€0 for (\d+) days$/, '0 € pendant $1 jours'],
    // Trial note in checkout-payment.html (composed of fragments).
    [/€0 today · Card required\. /, "0 € aujourd'hui · Carte bancaire requise. "],
    [new RegExp('Add-ons billed today \\((' + AMOUNT + ')\\) · Card required\\. '), "Options facturées aujourd'hui ($1) · Carte bancaire requise. "],
    [new RegExp('Then (' + AMOUNT + ')/month after your (\\d+)-day trial\\. '), 'Puis $1/mois après votre essai de $2 jours. '],
    [/Your subscription is charged after 1 day\. /, 'Votre abonnement est facturé après 1 jour. '],
    [/Your subscription is charged after (\d+) days\. /, 'Votre abonnement est facturé après $1 jours. '],
    [/Cancel anytime before to avoid being charged\.$/, 'Annulez avant la fin pour ne pas être débité.']
  ];

  function currentPage() {
    return String((window.location && window.location.pathname) || '').split('/').pop() || 'index.html';
  }
  function translateToFrench(source) {
    var pageEntries = PUBLIC_FRENCH_BY_PAGE[currentPage()];
    if (pageEntries && Object.prototype.hasOwnProperty.call(pageEntries, source)) return pageEntries[source];
    if (Object.prototype.hasOwnProperty.call(PUBLIC_FRENCH, source)) return PUBLIC_FRENCH[source];
    var result = source;
    var matched = false;
    PUBLIC_FRENCH_PATTERNS.forEach(function (pattern) {
      if (pattern[0].test(result)) {
        result = result.replace(pattern[0], pattern[1]);
        matched = true;
      }
    });
    return matched ? frenchMoney(result) : null;
  }
  function translateToEnglish(source) {
    return Object.prototype.hasOwnProperty.call(PUBLIC_ENGLISH, source) ? PUBLIC_ENGLISH[source] : null;
  }
  window.fpPublicFunnelTranslateToFrench = translateToFrench;

  function resolveLanguage(language) {
    var raw = String(language || '').trim().replace(/_/g, '-').toLowerCase();
    if (!raw) {
      try { raw = String(localStorage.getItem('fp:language') || 'en').trim().toLowerCase(); }
      catch (_) { raw = 'en'; }
    }
    if (raw === 'pt-br') return 'pt-br';
    var base = raw.split('-')[0];
    return Object.prototype.hasOwnProperty.call(LOCALE_BY_LANGUAGE, raw)
      ? raw
      : (Object.prototype.hasOwnProperty.call(LOCALE_BY_LANGUAGE, base) ? base : 'en');
  }

  window.fpResolveLanguage = resolveLanguage;
  window.fpResolveLocale = function (language) {
    return LOCALE_BY_LANGUAGE[resolveLanguage(language)] || 'en-US';
  };
  // Textes de l'etat d'acces (lecture seule / grace de paiement). FR et EN ;
  // toute autre langue retombe sur l'anglais (repli) — jamais de cle brute.
  var ACCESS_TEXT = {
    fr: {
      readOnlyTitle: 'Espace en lecture seule',
      readOnlyBody: 'Votre abonnement n\u2019est plus actif : vos donn\u00e9es sont conserv\u00e9es et consultables, mais les modifications, g\u00e9n\u00e9rations et actions premium sont d\u00e9sactiv\u00e9es.',
      readOnlyPastDue: 'Le paiement de votre abonnement a \u00e9chou\u00e9 et le d\u00e9lai de gr\u00e2ce est \u00e9coul\u00e9. Vos donn\u00e9es sont conserv\u00e9es en lecture seule.',
      graceTitle: 'Paiement \u00e0 r\u00e9gulariser',
      graceBody: 'Le dernier paiement a \u00e9chou\u00e9. Votre acc\u00e8s reste complet jusqu\u2019au {date}, puis l\u2019espace passera en lecture seule.',
      cancelTitle: 'Abonnement annul\u00e9',
      cancelBody: 'Votre acc\u00e8s reste complet jusqu\u2019au {date}, puis l\u2019espace passera en lecture seule (donn\u00e9es conserv\u00e9es).',
      action: 'G\u00e9rer mon abonnement'
    },
    en: {
      readOnlyTitle: 'Workspace is read-only',
      readOnlyBody: 'Your subscription is no longer active: your data is kept and can be viewed, but edits, generation and premium actions are disabled.',
      readOnlyPastDue: 'Your subscription payment failed and the grace period has ended. Your data is kept in read-only mode.',
      graceTitle: 'Payment needs attention',
      graceBody: 'The last payment failed. You keep full access until {date}, after which the workspace becomes read-only.',
      cancelTitle: 'Subscription canceled',
      cancelBody: 'You keep full access until {date}, after which the workspace becomes read-only (your data is kept).',
      action: 'Manage my subscription'
    }
  };
  window.fpAccessText = function (key, vars) {
    var lang = resolveLanguage() === 'fr' ? 'fr' : 'en';
    var text = (ACCESS_TEXT[lang] && ACCESS_TEXT[lang][key]) || ACCESS_TEXT.en[key] || '';
    if (vars) text = text.replace(/\{(\w+)\}/g, function (_, k) { return vars[k] !== undefined ? vars[k] : '{' + k + '}'; });
    return text;
  };
  window.fpPublicText = function (french, english) {
    var language = resolveLanguage();
    if (language === 'fr') return french;
    if (typeof window.fpT === 'function') {
      var translated = window.fpT(french);
      if (translated && translated !== french) return translated;
    }
    return language === 'en' ? (PUBLIC_ENGLISH[french] || english || french) : french;
  };
  window.fpPublicTranslateText = function (text) {
    var value = String(text == null ? '' : text);
    if (resolveLanguage() === 'fr') return value;
    if (typeof window.fpT === 'function') {
      var translated = window.fpT(value);
      if (translated && translated !== value) return translated;
    }
    return resolveLanguage() === 'en' ? (PUBLIC_ENGLISH[value] || value) : value;
  };
  window.fpPublicTranslateMarkup = function (markup) {
    var value = String(markup == null ? '' : markup);
    if (resolveLanguage() !== 'en') return value;
    var template = document.createElement('template');
    template.innerHTML = value;
    translateSubtree(template.content);
    return template.innerHTML;
  };
  window.fpFormatDate = function (value, options, language) {
    var date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(window.fpResolveLocale(language), options || {});
  };
  window.fpFormatTime = function (value, options, language) {
    var date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleTimeString(window.fpResolveLocale(language), options || {});
  };
  window.fpFormatNumber = function (value, options, language) {
    var number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return number.toLocaleString(window.fpResolveLocale(language), options || {});
  };

  // `translate` maps a trimmed source string to its translation (or null).
  // Without it, the historical FR -> EN direction is used (English only).
  function translateSubtree(root, translate) {
    if (!root) return root;
    if (!translate) {
      if (resolveLanguage() !== 'en') return root;
      translate = translateToEnglish;
    }
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var parent = node.parentElement;
      if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|CODE|PRE|OPTION)$/.test(parent.tagName)) continue;
      if (parent.closest('[data-fp-user-content]')) continue;
      var source = node.nodeValue.trim();
      if (!source) continue;
      var target = translate(source);
      if (target && target !== source) node.nodeValue = node.nodeValue.replace(source, function () { return target; });
    }
    var selector = '[placeholder], [aria-label], [title], input[type="submit"], input[type="button"], meta[name="description"], meta[property="og:title"], meta[property="og:description"], meta[name="twitter:title"], meta[name="twitter:description"]';
    var elements = [];
    if (root.nodeType === 1 && root.matches(selector)) elements.push(root);
    if (root.querySelectorAll) elements = elements.concat(Array.prototype.slice.call(root.querySelectorAll(selector)));
    var english = translate === translateToEnglish;
    elements.forEach(function (element) {
      var attributes = ['placeholder', 'aria-label', 'title'];
      if (element.tagName === 'INPUT' && /^(submit|button)$/i.test(element.type)) attributes.push('value');
      if (element.tagName === 'META') attributes.push('content');
      attributes.forEach(function (attribute) {
        var value = element.getAttribute(attribute);
        if (!value) return;
        var translated = translate(value) || (english ? PUBLIC_ENGLISH_ATTRIBUTES[value] : null);
        if (translated && translated !== value) element.setAttribute(attribute, translated);
      });
    });
    return root;
  }
  window.fpTranslatePublicSubtree = translateSubtree;

  function translatePublicDocument() {
    var filename = String(window.location.pathname || '').split('/').pop() || 'index.html';
    if (!PUBLIC_PAGES[filename]) return;

    var language = resolveLanguage();
    var funnel = !!FUNNEL_PAGES[filename];
    var translate;
    if (funnel) {
      // Funnel pages are authored in English: only French visitors get a
      // translation (EN -> FR); every other language keeps English.
      document.documentElement.lang = language === 'fr' ? 'fr' : 'en';
      if (language !== 'fr') return;
      translate = translateToFrench;
    } else {
      // Other public pages are authored in French and translated to English.
      // Keep the document language aligned with the content selected.
      document.documentElement.lang = language === 'en' ? 'en' : 'fr';
      if (language !== 'en') return;
      translate = translateToEnglish;
    }

    var translatedTitle = translate(document.title);
    if (translatedTitle) document.title = translatedTitle;
    if (document.head) translateSubtree(document.head, translate);
    translateSubtree(document.body, translate);

    var countrySelect = document.querySelector('select#country, select[name="country"]');
    if (!funnel && countrySelect && typeof Intl.DisplayNames === 'function') {
      try {
        var names = new Intl.DisplayNames(['en'], { type: 'region' });
        var flags = { FR: '🇫🇷', BE: '🇧🇪', CH: '🇨🇭', LU: '🇱🇺', CA: '🇨🇦', MA: '🇲🇦', DZ: '🇩🇿', TN: '🇹🇳' };
        Array.prototype.forEach.call(countrySelect.options, function (option) {
          var code = String(option.value || '').toUpperCase();
          if (!code) option.textContent = '— Select —';
          else if (code === 'OTHER') option.textContent = 'Other';
          else {
            var name = names.of(code);
            if (name && name !== code) option.textContent = (flags[code] ? flags[code] + ' ' : '') + name + (code === 'CA' ? ' (French)' : '');
          }
        });
      } catch (_) {}
    }

    if (typeof MutationObserver === 'function') {
      var observer = new MutationObserver(function (records) {
        records.forEach(function (record) {
          if (record.type === 'attributes') {
            translateSubtree(record.target, translate);
            return;
          }
          if (record.type === 'characterData') {
            if (record.target.parentElement) translateSubtree(record.target.parentElement, translate);
            return;
          }
          Array.prototype.forEach.call(record.addedNodes, function (added) {
            var target = added.nodeType === 3 ? added.parentElement : added;
            if (target) translateSubtree(target, translate);
          });
        });
      });
      if (funnel) {
        // Scripts may set document.title after load: translate it again.
        var titleElement = document.querySelector('title');
        if (titleElement) {
          new MutationObserver(function () {
            var translatedLaterTitle = translate(document.title);
            if (translatedLaterTitle && translatedLaterTitle !== document.title) document.title = translatedLaterTitle;
          }).observe(titleElement, { childList: true, characterData: true, subtree: true });
        }
      }
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['placeholder', 'aria-label', 'title', 'value']
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', translatePublicDocument, { once: true });
  } else {
    translatePublicDocument();
  }
})();
