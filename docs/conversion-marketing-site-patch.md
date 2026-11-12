# Correctifs à appliquer sur le site vitrine flowpoint.pro (pour Replit)

Le code du site vitrine n'est pas dans ce dépôt (il est servi séparément). Constats vérifiés en ligne le 12 novembre 2026. Aucun prix, quota, durée d'essai ou règle Stripe n'est à modifier.

## 1. FAQ de /pricing — formulation trompeuse (P0)
Texte publié (aussi dans le JSON-LD FAQPage) :
> After your 14-day trial, choose the plan that fits your needs. Your data is retained so you can pick up where you left off.

Ce texte laisse croire que le plan se choisit après l'essai. Remplacer, dans le HTML visible ET dans le JSON-LD, par :
> You choose your plan before you start, and a credit card is required at sign-up. Nothing is charged during the 14-day free trial. When the trial ends, your subscription to the chosen plan starts and your card is charged automatically, unless you cancel before that date. You can cancel at any time before the trial ends, at no cost.

Vérifier aussi les cartes tarifaires, le bandeau et les CTA : chaque mention « free trial » doit être accompagnée de « card required » et de « billed automatically after 14 days unless cancelled ».

## 2. Liens vers l'inscription sans plan (P0)
Les 5 liens de /pricing pointent vers `https://app.flowpoint.pro/signin.html` sans plan. Les boutons Standard / Pro / Ultra doivent pointer vers :
- `https://app.flowpoint.pro/signin.html?plan=standard`
- `https://app.flowpoint.pro/signin.html?plan=pro`
- `https://app.flowpoint.pro/signin.html?plan=ultra`

L'application (signin.html) lit `plan` avec une liste blanche stricte (standard, pro, ultra), le range dans le panier, nettoie l'URL et laisse le visiteur modifier son choix. Le prix est toujours recalculé côté serveur : le paramètre ne peut modifier ni prix ni quota. Conserver aussi `fp_ref`, `fp_lid` et les UTM déjà transmis.
Les CTA génériques (« Start free », « Create my free account ») restent sans `plan`.

## 3. Langue (P1)
Transmettre la langue connue (`lang=<code>`) vers l'application seulement si le visiteur l'a choisie ou si elle est déterminable ; sinon ne rien envoyer. Ne jamais forcer `fr` : l'anglais est le repli.

## 4. Libellé « Dashboard IA » sur les pages anglophones (P2)
Présent sur https://flowpoint.pro/pricing. Remplacer par « AI dashboard ».

## 5. HEAD renvoie 404 (P2)
`HEAD https://flowpoint.pro/` et `/pricing` renvoient 404 (`content-type: application/json`, 23 octets) alors que GET renvoie 200. Le serveur n'expose pas HEAD : le router doit répondre à HEAD comme à GET (corps omis). Impact : moniteurs d'uptime, crawlers et aperçus de liens.
