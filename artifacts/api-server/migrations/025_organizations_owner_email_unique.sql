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
-- VERROUS : CREATE UNIQUE INDEX (non CONCURRENTLY) prend un verrou SHARE sur
-- `organizations` : les ecritures sont bloquees pendant la construction de
-- l'index (lectures non bloquees). Sur une table de quelques milliers de lignes
-- c'est de l'ordre de la milliseconde. CONCURRENTLY est volontairement NON
-- utilise : il est interdit dans une transaction ET dans un bloc DO, et un
-- echec laisserait un index INVALIDE que `IF NOT EXISTS` prendrait ensuite pour
-- un succes (ce fichier detecte ce cas, voir ci-dessous). Un lock_timeout de 5 s
-- evite d'attendre indefiniment un verrou et de bloquer les ecritures derriere.
-- Si une ecriture concurrente cree un doublon entre le controle et l'index,
-- l'index echoue avec une erreur 23505 : rien n'est modifie, relancer.
--
-- RETOUR ARRIERE : migrations/rollback/025_organizations_owner_email_unique.down.sql
--
-- Etape MANUELLE : ce fichier n'est execute par aucun demarrage (voir
-- migrations/README.md). A appliquer volontairement, base par base, apres
-- verification du diagnostic.

DO $$
DECLARE
  dup_count integer;
  idx_valid boolean;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  IF to_regclass('public.organizations') IS NULL THEN
    RAISE NOTICE '025: table organizations absente : rien a faire';
    RETURN;
  END IF;

  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'organizations'
         AND column_name IN ('owner_email', 'status')) < 2 THEN
    RAISE NOTICE '025: colonnes owner_email/status absentes : rien a faire';
    RETURN;
  END IF;

  -- Index deja present : valide = rien a faire ; invalide (CREATE INDEX
  -- CONCURRENTLY interrompu ailleurs) = a supprimer et recreer a la main.
  SELECT i.indisvalid INTO idx_valid
    FROM pg_index i
   WHERE i.indexrelid = to_regclass('public.organizations_owner_email_active_uniq');
  IF idx_valid IS TRUE THEN
    RAISE NOTICE '025: index organizations_owner_email_active_uniq deja present et valide';
    RETURN;
  ELSIF idx_valid IS FALSE THEN
    RAISE NOTICE '025: index organizations_owner_email_active_uniq present mais INVALIDE : DROP INDEX puis rejouer ce fichier';
    RETURN;
  END IF;

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
    RAISE NOTICE '025: index organizations_owner_email_active_uniq cree';
  END IF;
END
$$;
