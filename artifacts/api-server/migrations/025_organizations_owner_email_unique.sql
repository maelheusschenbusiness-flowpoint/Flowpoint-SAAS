-- 025_organizations_owner_email_unique.sql
--
-- A-06 : « un e-mail = une organisation ». finalize-checkout et le webhook
-- Stripe pouvaient creer chacun une organisation pour le meme proprietaire.
-- Le correctif applicatif (verrou advisory + reutilisation de l'organisation
-- existante) empeche de NOUVEAUX doublons ; cet index en fait une garantie de
-- la base.
--
-- NON DESTRUCTIVE ET NON BLOQUANTE :
--   * ne supprime, ne fusionne et ne modifie aucune ligne ;
--   * si des doublons existent deja, l'index n'est PAS cree : la migration
--     s'arrete avec un NOTICE et reussit (jamais d'echec sur des donnees
--     existantes). Lancer alors migrations/diagnostics/
--     025_detect_duplicate_org_owner_email.sql (lecture seule), traiter les
--     doublons a la main, puis rejouer ce fichier (idempotent) ;
--   * les organisations supprimees (status = 'deleted') sont hors index.
--
-- Etape MANUELLE : ce fichier n'est execute par aucun demarrage (voir
-- migrations/README.md). A appliquer volontairement, base par base, apres
-- verification du diagnostic.

DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT count(*) INTO dup_count
    FROM (
      SELECT lower(owner_email)
        FROM organizations
       WHERE owner_email IS NOT NULL
         AND owner_email <> ''
         AND status IS DISTINCT FROM 'deleted'
       GROUP BY lower(owner_email)
      HAVING count(*) > 1
    ) d;

  IF dup_count > 0 THEN
    RAISE NOTICE '025: % adresse(s) proprietaire(s) ont plusieurs organisations non supprimees — index organizations_owner_email_active_uniq NON cree. Executer migrations/diagnostics/025_detect_duplicate_org_owner_email.sql, traiter les doublons a la main, puis rejouer ce fichier.', dup_count;
  ELSE
    EXECUTE $idx$
      CREATE UNIQUE INDEX IF NOT EXISTS organizations_owner_email_active_uniq
          ON organizations (lower(owner_email))
       WHERE owner_email IS NOT NULL
         AND owner_email <> ''
         AND status IS DISTINCT FROM 'deleted'
    $idx$;
  END IF;
END
$$;
