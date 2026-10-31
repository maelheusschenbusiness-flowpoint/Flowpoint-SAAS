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
    "Plans FlowPoint : Standard 29€ (30 audits, 10 monitors), Pro 79€ (300 audits, 50 monitors), Ultra 149€ (2000 audits, 300 monitors). Essai 14 jours.": "FlowPoint plans: Standard €29 (30 audits, 10 monitors), Pro €79 (300 audits, 50 monitors), and Ultra €149 (2,000 audits, 300 monitors). Includes a 14-day trial.",
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
    "2 000 audits/mois": "2,000 audits/month",
    "2 000 rapports PDF/mois": "2,000 PDF reports/month",
    "2 000 exports/mois": "2,000 exports/month",
    "10 membres d'équipe": "10 team members",
    "∞ crédits IA/mois": "∞ AI credits/month",
    "IA Stratégiste complet": "Full AI Strategist",
    "API illimitée": "Unlimited API",
    "Support dédié < 1h": "Dedicated support < 1 hour",
    "Rétention 365 jours": "365-day retention",
    "Démarrer Ultra": "Start Ultra",
    "Personnalisez avec des add-ons": "Customize with add-ons",
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

  function translateSubtree(root) {
    if (!root || resolveLanguage() !== 'en') return root;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var parent = node.parentElement;
      if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|CODE|PRE|OPTION)$/.test(parent.tagName)) continue;
      if (parent.closest('[data-fp-user-content]')) continue;
      var source = node.nodeValue.trim();
      var target = PUBLIC_ENGLISH[source];
      if (target) node.nodeValue = node.nodeValue.replace(source, target);
    }
    var selector = '[placeholder], [aria-label], [title], input[type="submit"], input[type="button"], meta[name="description"], meta[property="og:title"], meta[property="og:description"], meta[name="twitter:title"], meta[name="twitter:description"]';
    var elements = [];
    if (root.nodeType === 1 && root.matches(selector)) elements.push(root);
    if (root.querySelectorAll) elements = elements.concat(Array.prototype.slice.call(root.querySelectorAll(selector)));
    elements.forEach(function (element) {
      var attributes = ['placeholder', 'aria-label', 'title'];
      if (element.tagName === 'INPUT' && /^(submit|button)$/i.test(element.type)) attributes.push('value');
      if (element.tagName === 'META') attributes.push('content');
      attributes.forEach(function (attribute) {
        var value = element.getAttribute(attribute);
        if (!value) return;
        var translated = PUBLIC_ENGLISH[value] || PUBLIC_ENGLISH_ATTRIBUTES[value];
        if (translated) element.setAttribute(attribute, translated);
      });
    });
    return root;
  }
  window.fpTranslatePublicSubtree = translateSubtree;

  function translatePublicDocument() {
    var filename = String(window.location.pathname || '').split('/').pop() || 'index.html';
    if (!PUBLIC_PAGES[filename]) return;

    var language = resolveLanguage();
    // Public pages are authored in French and translated to English. Keep the
    // document language aligned with the content selected for this visitor.
    document.documentElement.lang = language === 'en' ? 'en' : 'fr';
    if (language !== 'en') return;

    if (PUBLIC_ENGLISH[document.title]) document.title = PUBLIC_ENGLISH[document.title];
    if (document.head) translateSubtree(document.head);
    translateSubtree(document.body);

    var countrySelect = document.querySelector('select#country, select[name="country"]');
    if (countrySelect && typeof Intl.DisplayNames === 'function') {
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
            translateSubtree(record.target);
            return;
          }
          if (record.type === 'characterData') {
            if (record.target.parentElement) translateSubtree(record.target.parentElement);
            return;
          }
          Array.prototype.forEach.call(record.addedNodes, function (added) {
            var target = added.nodeType === 3 ? added.parentElement : added;
            if (target) translateSubtree(target);
          });
        });
      });
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
