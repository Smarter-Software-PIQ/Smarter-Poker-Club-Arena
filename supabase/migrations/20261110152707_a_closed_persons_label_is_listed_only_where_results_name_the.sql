-- 20261110152707_a_closed_persons_label_is_listed_only_where_results_name_the.sql
-- Reserved by scripts/new-migration.mjs.
--
-- WHY. ca_closed_player_labels (20261109235153, owner rights since
-- 20261110051146) lists every closed non-horse profile with its label, and
-- anon and authenticated may select it, because the read policy queued in
-- 20261110003726 asks it as the reader. Measured on 2026-11-10 as anon over
-- the REST API, it listed 1,000 of 2,664 closed profile ids (the API page
-- limit). A client cannot otherwise read profiles.id or profiles.status as
-- anon, so the view said who had closed an account, which no result needs.
--
-- WHAT. The view lists a closed person only where a tournament result names
-- them: a profile with at least one tournament_players row. That is exactly
-- the set the two readers of this view ask about (tournament_players_public
-- joins it on user_id, and the queued policy asks it per tournament_players
-- row), so neither reader's answer changes, and each listed label is one
-- tournament_players_public already shows. Columns, owner rights and grants
-- are restated unchanged. Measured plan for a 193-row tournament read: a
-- per-row probe of idx_profiles_closed_person then idx_tourn_players_user,
-- 2.5 ms.
--
-- No lock on tournament_players beyond the ACCESS SHARE of reading its
-- definition; ACCESS EXCLUSIVE on this view only, 1 s lock_timeout.
-- No row is written, moved or rewritten. Not a repair job.
-- @live-proof: pg_get_viewdef('public.ca_closed_player_labels'::regclass) LIKE '%tournament_players%' AND (SELECT COALESCE(array_to_string(reloptions, ','), '') LIKE '%security_invoker=false%' FROM pg_class WHERE oid = 'public.ca_closed_player_labels'::regclass)
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE OR REPLACE VIEW public.ca_closed_player_labels
  WITH (security_invoker = false) AS
SELECT p.id,
       COALESCE(NULLIF(btrim(p.username), ''), 'Player') AS label
  FROM public.profiles p
 WHERE p.status = 'deleted'
   AND p.is_horse IS NOT TRUE
   AND EXISTS (SELECT 1 FROM public.tournament_players tp WHERE tp.user_id = p.id);

REVOKE ALL ON public.ca_closed_player_labels FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ca_closed_player_labels TO anon, authenticated, service_role;

COMMIT;
