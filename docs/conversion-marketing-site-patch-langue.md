# Site vitrine : continuité de langue (pour Replit)

Complète `docs/conversion-marketing-site-patch.md`. Comportement de l'application vérifié dans le code (`fp-locale.js`) et par simulation navigateur à 390 px.

## Règle côté application
La langue des pages de l'application (inscription, connexion, choix du plan, checkout, retour) est déterminée dans cet ordre :
1. **une préférence déjà enregistrée dans le navigateur** gagne toujours ;
2. sinon le paramètre `?lang=<code>` du lien, s'il est supporté ;
3. sinon **l'anglais**. Le français n'est jamais un repli : il n'est retenu que s'il est demandé.

Codes supportés : `fr` `en` `es` `de` `it` `pt` `pt-br` `nl` `pl` `sv` `ro` `cs` (`es-MX` → `es`, `pt_BR` → `pt-br`). Un code inconnu, vide ou mal formé est ignoré sans effet (aucune écriture).

Les pages de l'application sont rédigées en anglais ; la traduction automatique ne couvre aujourd'hui que **l'anglais et le français** (les autres langues retombent sur l'anglais, tout en étant mémorisées).

## À faire sur le site vitrine
- Ajouter `lang=<langue affichée>` à **tous** les liens vers `app.flowpoint.pro`, par exemple `https://app.flowpoint.pro/signin.html?plan=pro&lang=fr`.
- Ne le mettre que si la langue est **choisie par le visiteur** ou connue sans ambiguïté ; sinon l'omettre (l'application affichera l'anglais).
- Ne jamais forcer `fr` pour un visiteur anglophone.

## Vérification
Simulation locale : `?lang=fr` → pages en français, conservées d'une page à l'autre ; `?lang=en` → anglais ; `?lang=xx` → ignoré, anglais ; une préférence existante n'est jamais écrasée.
Après publication : ouvrir `https://app.flowpoint.pro/signin.html?lang=fr` dans un navigateur neuf → `document.documentElement.lang === "fr"`.
