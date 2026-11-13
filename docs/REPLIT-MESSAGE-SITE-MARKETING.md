# Message à transmettre à Replit — site vitrine flowpoint.pro (instruction unique)

> **Copier-coller tel quel** (tout ce qui suit la ligne `---`). Le code du site vitrine n'est pas dans le dépôt `Flowpoint-SAAS` : **rien de ce qui suit n'a été appliqué par nous**.
> **État vérifié en ligne le 13 novembre 2026** (`node scripts/verifier-site-vitrine.mjs`, lecture seule) : 8/12 contrôles réussis ; **échecs : FAQ trompeuse toujours publiée, aucune mention « charged automatically »/« credit card is required », aucun bouton de plan avec `plan=`**. Le site n'est **pas** considéré comme corrigé tant que ce même script ne renvoie pas 12/12 sur le site **publié** et que la checklist navigateur (section 8) est passée.
> Spécifications détaillées : `docs/conversion-marketing-site-patch.md` et `docs/conversion-marketing-site-patch-langue.md`.

---

Hi Replit,

Please apply ALL the changes below to the **marketing site (flowpoint.pro)** in ONE pass, publish, then run the verification checklist (section 8) and send us its raw output with the publication date/time. Do not change prices, quotas, the 14-day trial length, or anything Stripe-related. The goal: no break between flowpoint.pro and app.flowpoint.pro (honest trial wording, plan kept, language kept, attribution kept, consent respected).

## 1. Trial FAQ is misleading (P0)
In `/pricing` — in BOTH the visible FAQ and the `FAQPage` JSON-LD — replace
> After your 14-day trial, choose the plan that fits your needs. Your data is retained so you can pick up where you left off.

with exactly:
> All plans include a free 14-day trial with full access. You choose your plan before you start, and a credit card is required at sign-up. Nothing is charged during the trial. When the 14 days end, your subscription to the chosen plan starts and your card is charged automatically, unless you cancel before that date. You can cancel at any time before the trial ends, at no cost.

French pages: « Tous les plans incluent 14 jours d'essai gratuit avec accès complet. Vous choisissez votre plan avant de commencer, et une carte bancaire est requise à l'inscription. Rien n'est débité pendant l'essai. À la fin des 14 jours, l'abonnement au plan choisi démarre et la carte est débitée automatiquement, sauf si vous annulez avant cette date. Vous pouvez annuler à tout moment avant la fin de l'essai, sans frais. »

Next to every price and every "Try for free / Start free / Create my free account" button, add: "Card required · billed automatically after 14 days unless cancelled" (French: « Carte bancaire requise · débit automatique après 14 jours sauf annulation »).

## 2. Plan buttons must carry the plan (P0)
All 5 CTAs on `/pricing` currently link to `https://app.flowpoint.pro/signin.html` with no plan. Use:
- Standard → `https://app.flowpoint.pro/signin.html?plan=standard`
- Pro → `https://app.flowpoint.pro/signin.html?plan=pro`
- Ultra → `https://app.flowpoint.pro/signin.html?plan=ultra`
- Generic CTAs ("Start free", "Create my free account") stay without `plan`.
The app only accepts `standard|pro|ultra` (anything else is ignored), keeps the plan until Stripe Checkout, and the visitor can still change it before paying. Never add any other plan value.

## 3. Language continuity (P0)
Add `lang=<displayed language>` to EVERY link to app.flowpoint.pro, e.g. `https://app.flowpoint.pro/signin.html?plan=pro&lang=fr`.
- Supported codes: `fr en es de it pt pt-br nl pl sv ro cs`.
- Add it only if the visitor chose the language or it is unambiguous; otherwise omit it (the app then shows English). **Never force `fr` for an English visitor.**
- An existing preference in the visitor's browser always wins on the app side; do not try to override it.

## 4. Parameters to keep on EVERY link to app.flowpoint.pro (when known)
- `fp_lid` — 22 chars `[A-Za-z0-9_-]` from a Smartlead e-mail: copy it as received, never invent it, never log it.
- `utm_source`, `utm_medium`, `utm_campaign` — lowercase `[a-z0-9._-]`, 1–64 chars (a value outside this pattern is ignored by the app).
- `fp_source` — `smartlead | google | direct | social | other_campaign` (first-touch source).
- `fp_ref` — seller code, unchanged.
Example: `https://app.flowpoint.pro/signin.html?plan=pro&lang=fr&utm_source=instagram&fp_lid=AbCdEfGhIjKlMnOpQr_-12`.
If the visitor lands on flowpoint.pro with these parameters, keep them (sessionStorage is fine) and re-append them to the app links on the next pages.

## 5. Consent and visitor id (only if you run analytics on the marketing site)
The app measures **only** if the cookie `fp_analytics_consent=accepted` exists. Set it **only after explicit consent**:
`fp_analytics_consent=accepted; Domain=.flowpoint.pro; Path=/; Max-Age=15552000; SameSite=Lax; Secure`.
If the visitor refuses or has not answered: no cookie, no `fp_vid`, send nothing. After consent: generate a UUID v4, keep it, append it as `fp_vid=<uuid>` to links to the app (the app reuses it: one id per visitor, no double counting). **Never add `fp_vid` without consent, never hard-code it in the HTML.**
Optional events (after consent only): `POST https://app.flowpoint.pro/api/public/funnel-event` with `credentials: "include"` (CORS allows https://flowpoint.pro and https://www.flowpoint.pro), JSON `{"etape":"landing_vue","visiteurId":"<uuid>","source":"<allowed source>","fp_lid":"<or omit>","utm_source":"…","utm_medium":"…","utm_campaign":"…"}`. Accepted `etape`: `landing_vue`, `tarifs_vus`, `cta_clique`, `signup_started`, `signup_form_engaged`. The server de-duplicates per visitor, step and day. **Do not send `tarifs_vus` from the marketing site** (the app already emits it on its own pricing page: it would be counted twice) — `landing_vue` and `cta_clique` only.

## 6. Copy fix (P2)
Replace "Dashboard IA" with "AI dashboard" on English pages (currently absent from `/pricing` — check every English page).

## 7. HEAD requests (P2)
`HEAD /` and `HEAD /pricing` must answer like GET (200, no body). They answered 404 on 12 November.

## 8. Verification checklist — run AFTER publication and paste the raw output
```bash
curl -s https://flowpoint.pro/pricing | grep -c "charged automatically"        # expect >= 1
curl -s https://flowpoint.pro/pricing | grep -c "credit card is required"      # expect >= 2 (visible FAQ + JSON-LD)
curl -s https://flowpoint.pro/pricing | grep -c "choose the plan that fits"    # expect 0
curl -s https://flowpoint.pro/pricing | grep -o 'signin.html?[^"]*plan=[a-z]*' | sort -u   # expect plan=standard, plan=pro, plan=ultra
curl -s https://flowpoint.pro/pricing | grep -c "Dashboard IA"                 # expect 0
curl -sI https://flowpoint.pro/ | head -1                                      # expect 200
curl -sI https://flowpoint.pro/pricing | head -1                               # expect 200
```
Then, in a fresh browser (no cookies), and report the result of each point:
1. Refuse consent → open DevTools → no `fp_analytics_consent` cookie, no `fp_vid` anywhere in the links, no request to `/api/public/funnel-event`.
2. Accept consent → cookie present with `Domain=.flowpoint.pro`; click "Pro" on `/pricing` → you land on app.flowpoint.pro with the **Pro plan pre-selected** and the URL carries `fp_vid`.
3. Open the marketing site with `?lang=fr&utm_source=test&fp_lid=AbCdEfGhIjKlMnOpQr_-12`, click a CTA → the app link carries `lang=fr`, the `utm_*` and the `fp_lid`; `https://app.flowpoint.pro/signin.html?lang=fr` renders in French (`document.documentElement.lang === "fr"`).
4. Open the marketing site with `?lang=en` → every app link carries `lang=en`; the pages stay English on the app.

We will re-run our own read-only verification on the published site and only then consider the site fixed. Please reply with the raw outputs and the date/time of publication.

Thanks.
