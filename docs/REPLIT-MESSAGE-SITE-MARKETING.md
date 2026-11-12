# Message à transmettre à Replit — site vitrine flowpoint.pro

> Copier-coller tel quel. Le code du site vitrine n'est pas dans le dépôt `Flowpoint-SAAS` : **rien de ce qui suit n'a été appliqué par nous**. Les constats ont été vérifiés en ligne le 12 novembre 2026 ; le comportement de l'application a été vérifié dans le code et par simulation navigateur (390 px). Spécification complète : `docs/conversion-marketing-site-patch.md` et `docs/conversion-marketing-site-patch-langue.md` (dépôt `Flowpoint-SAAS`, branche `Test-Replit`).

---

Hi Replit,

Please apply the following changes to the **marketing site (flowpoint.pro)** in ONE pass, then run the verification checklist at the bottom and send us its output. Do not change prices, quotas, the 14-day trial length, or anything Stripe-related.

## 1. Trial FAQ is misleading (P0)
In `/pricing`, in BOTH the visible FAQ and the `FAQPage` JSON-LD, replace
> After your 14-day trial, choose the plan that fits your needs. Your data is retained so you can pick up where you left off.

with exactly:
> All plans include a free 14-day trial with full access. You choose your plan before you start, and a credit card is required at sign-up. Nothing is charged during the trial. When the 14 days end, your subscription to the chosen plan starts and your card is charged automatically, unless you cancel before that date. You can cancel at any time before the trial ends, at no cost.

French pages: « Tous les plans incluent 14 jours d'essai gratuit avec accès complet. Vous choisissez votre plan avant de commencer, et une carte bancaire est requise à l'inscription. Rien n'est débité pendant l'essai. À la fin des 14 jours, l'abonnement au plan choisi démarre et la carte est débitée automatiquement, sauf si vous annulez avant cette date. Vous pouvez annuler à tout moment avant la fin de l'essai, sans frais. »
Also, next to every price and every "Try for free / Start free" button, add "Card required · billed automatically after 14 days unless cancelled".

## 2. Plan buttons must carry the plan (P0)
All 5 CTAs on `/pricing` link to `https://app.flowpoint.pro/signin.html` with no plan. Use:
- Standard → `https://app.flowpoint.pro/signin.html?plan=standard`
- Pro → `https://app.flowpoint.pro/signin.html?plan=pro`
- Ultra → `https://app.flowpoint.pro/signin.html?plan=ultra`
- Generic CTAs ("Start free", "Create my free account") stay without `plan`.
The app only accepts `standard|pro|ultra` (anything else is ignored) and the visitor can still change the plan before paying.

## 3. Parameters to keep on EVERY link to app.flowpoint.pro (if known)
`lang` (fr, en, es, de, it, pt, pt-br, nl, pl, sv, ro, cs — only if the visitor chose it or it is unambiguous; never force `fr`), `fp_lid` (22 chars `[A-Za-z0-9_-]`, copy as received, never invent), `utm_source`/`utm_medium`/`utm_campaign` (lowercase `[a-z0-9._-]`, 1–64 chars), `fp_source` (`smartlead|google|direct|social|other_campaign`), `fp_ref` (seller code, unchanged). Example: `https://app.flowpoint.pro/signin.html?plan=pro&lang=fr&utm_source=instagram&fp_lid=AbCdEfGhIjKlMnOpQr_-12`.

## 4. Consent and visitor id (only if you run analytics on the marketing site)
Set the cookie **only after explicit consent**, readable by the app:
`fp_analytics_consent=accepted; Domain=.flowpoint.pro; Path=/; Max-Age=15552000; SameSite=Lax; Secure`.
If the visitor refuses or hasn't answered: no cookie, no `fp_vid`, send nothing. After consent: generate a UUID v4, keep it, and append it as `fp_vid=<uuid>` to links to the app (the app reuses it: one id per visitor, no double counting).
Optional events (after consent): `POST https://app.flowpoint.pro/api/public/funnel-event` with `credentials: "include"` (CORS allows flowpoint.pro and www.flowpoint.pro), JSON `{"etape":"landing_vue","visiteurId":"<uuid>","source":"<allowed source>","fp_lid":"<or omit>","utm_source":"…","utm_medium":"…","utm_campaign":"…"}`; accepted `etape`: `landing_vue`, `tarifs_vus`, `cta_clique`, `signup_started`, `signup_form_engaged`. The server de-duplicates per visitor, step and day.

## 5. Copy fix (P2)
Replace "Dashboard IA" with "AI dashboard" on English pages (currently on `/pricing`).

## 6. HEAD returns 404 (P2)
`HEAD /` and `HEAD /pricing` return 404 (`application/json`, 23 bytes) while GET returns 200. Make HEAD behave like GET (no body).

## Verification checklist — please run and paste the output
```bash
curl -s https://flowpoint.pro/pricing | grep -c "charged automatically"          # expect >= 1
curl -s https://flowpoint.pro/pricing | grep -c "choose the plan that fits"      # expect 0
curl -s https://flowpoint.pro/pricing | grep -o 'signin.html?plan=[a-z]*' | sort -u   # expect plan=standard, plan=pro, plan=ultra
curl -s https://flowpoint.pro/pricing | grep -c "Dashboard IA"                   # expect 0
curl -sI https://flowpoint.pro/ | head -1                                        # expect HTTP/2 200
```
Then, in a fresh browser: accept consent, click "Pro" on `/pricing` → you must land on app.flowpoint.pro with the Pro plan pre-selected, and `https://app.flowpoint.pro/signin.html?lang=fr` must render in French.

Thanks — please reply with the five outputs and the date/time of publication.
