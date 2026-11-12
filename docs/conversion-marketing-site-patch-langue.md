# Site vitrine : continuité de langue (pour Replit)

Complète `docs/conversion-marketing-site-patch.md` (section 3, remplacée par celle-ci).

## Langue (P1) — complément du patch principal
L'application lit désormais `?lang=<code>` (codes supportés : fr, en, es, de, it, pt, pt-br, nl, pl, sv, ro, cs). Règles côté application : une préférence déjà enregistrée dans le navigateur gagne ; sinon la langue du lien ; sinon l'anglais (le français n'est jamais un repli).
Sur le site vitrine : ajouter `lang=<langue affichée>` à tous les liens vers `app.flowpoint.pro` (inscription, connexion, plans), par exemple `https://app.flowpoint.pro/signin.html?plan=pro&lang=fr`. Ne mettre `lang` que si la langue est choisie par le visiteur ou connue sans ambiguïté ; sinon l'omettre. Une langue inconnue est ignorée sans effet.

