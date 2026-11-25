-- 029_funnel_event_rejections.sql
--
-- Compteur anonyme des evenements du tunnel refuses ou perdus (voir
-- src/services/funnel-rejections.ts). Un jour (UTC), un motif d'une liste
-- fermee choisie par le serveur, un total. Aucune donnee personnelle :
-- ni visiteur, ni email, ni IP, ni valeur recopiee depuis l'appelant.
--
-- Additif et idempotent. Comme `funnel_events`, la table est aussi creee a la
-- premiere ecriture par le service : cette migration est la definition
-- versionnee, a appliquer avant le deploiement si l'on veut lire le compteur
-- sans attendre le premier rejet. Pas de CHECK sur `motif` : la liste est
-- fermee dans le code, et une contrainte qui derive du code a deja fait
-- perdre des etapes en silence (funnel_events_etape_check).
--
-- Rollback : DROP TABLE IF EXISTS funnel_event_rejections;

CREATE TABLE IF NOT EXISTS funnel_event_rejections (
  jour   DATE   NOT NULL,
  motif  TEXT   NOT NULL,
  total  BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (jour, motif)
);

-- Table interne au backend, sans policy : le defaut est le refus pour PostgREST.
ALTER TABLE funnel_event_rejections ENABLE ROW LEVEL SECURITY;
