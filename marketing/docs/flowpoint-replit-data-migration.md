# Préparation d’une migration éventuelle des données Replit

**Ce document prépare une copie future; il ne lance ni export ni import.** Aucun
historique ne doit être supprimé, modifié ou rendu inaccessible sur Replit.
L’app `app.flowpoint.pro` et sa base restent hors périmètre.

## Tables du code marketing à comparer

Le schéma source du code comporte :

| Table | Champs de données |
| --- | --- |
| `leads` | `id`, `email`, `name`, `company_name`, `selected_plan`, `created_at` |
| `conversations` | `id`, `title`, `session_token`, `created_at` |
| `messages` | `id`, `conversation_id`, `role`, `content`, `created_at` |

`messages.conversation_id` référence `conversations.id`. Les identifiants de
session permettent de reprendre certaines conversations et doivent être traités
comme des secrets. Les noms de tables/champs du code ne prouvent pas que la base
Replit actuellement publiée ou le PostgreSQL Render existant ont exactement ce
schéma. Confirmer les deux côtés en lecture seule avant d’écrire un plan
d’import. Ne pas inspecter ni copier `app.flowpoint.pro`.

## Décider si une copie est nécessaire

1. Lister les besoins opérationnels des leads historiques et des conversations
   existantes. Si les données peuvent rester consultables dans Replit, ne pas
   migrer l’historique.
2. Relever séparément, sans valeurs personnelles, les versions de schéma,
   permissions, nombres de lignes, bornes de `created_at`, clés primaires,
   index, séquences et clés étrangères des seules tables marketing.
3. Vérifier en lecture seule la base Render existante et les collisions
   d’identifiants. Si elle contient déjà des lignes, comparer avant toute
   tentative de copie; ne pas écraser ni supprimer les divergences.
4. S’il manque un schéma, un rôle ou une permission, arrêter. L’application du
   schéma et tout import nécessitent une autorisation distincte; aucun `db:push`
   global.

## Plan d’exécution à autoriser séparément

1. Garder Replit en ligne. Créer et vérifier une sauvegarde récupérable de la
   source par un mécanisme approuvé, puis stocker l’export chiffré dans un
   emplacement à accès limité. Ne pas écrire de PII ou de `session_token` dans
   les journaux, la PR ou les fichiers du dépôt.
2. Exporter uniquement `leads`, `conversations` et `messages`, avec leurs clés
   d’origine, horodatages et relations. Protéger l’export comme des données
   personnelles; ne pas exporter les autres tables.
3. Importer d’abord les conversations, ensuite les leads, puis les messages,
   dans une transaction sur la seule base Render approuvée. Ne jamais supprimer
   les lignes Replit. Les conflits de clé ou de contenu doivent interrompre
   l’import et produire un rapport expurgé, pas un `UPDATE` implicite.
4. Rendre l’opération rejouable seulement pour les lignes absentes ou déjà
   identiques. Vérifier les nombres, les identifiants, les références
   `conversation_id`, les horodatages et les empreintes calculées dans un
   contexte protégé. Réaligner les séquences seulement après approbation et
   vérification des valeurs courantes.
5. Après stabilisation DNS, effectuer un relevé incrémental borné par le point
   de reprise convenu pour récupérer les formulaires reçus sur Replit pendant
   la propagation. Distinguer les leads reçus de chaque côté; ne pas dédupliquer
   des personnes sur la seule base d’un e-mail.
6. Vérifier les données importées par des contrôles agrégés et des tests
   d’accès autorisés. Conserver la source Replit, les sauvegardes et les
   informations de retour arrière tant qu’une suppression n’a pas été
   explicitement autorisée.

## Conditions d’arrêt

Arrêter sans écrire si la base, le rôle, le schéma ou les sauvegardes Render ne
sont pas établis; si une écriture exige une migration de schéma; si les
identifiants ne correspondent pas; si des collisions existent; ou si une
restauration n’a pas été démontrée. Cette préparation n’autorise aucun accès
aux secrets, export de PII, import, écriture, test de formulaire ou suppression.
