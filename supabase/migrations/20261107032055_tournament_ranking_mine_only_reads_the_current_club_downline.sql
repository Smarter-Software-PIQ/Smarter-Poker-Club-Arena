-- 20261107032055_tournament_ranking_mine_only_reads_the_current_club_downline.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Dan, 2026-11-06, on the tournament lobby Ranking tab: "THE 'MINE ONLY' TAKES
-- TOO LONG TO APPEAR. IT SHOULD SHOW SUPER AGENTS, AGENTS, OR SUB AGENTS
-- DOWNLINES HERE. AND KINGFISH SHOULD ONLY BE SHOWN THE DOWNLINES INSIDE OF THE
-- CLUB HES CURRENTLY INSIDE OF, (SAME WITH AGENTS AND EVERYTHING ELSE) IT
-- SHOULD ONLY SHOW THE CURRENT CLUBS DOWNLINES THAT ARE STILL INSIDE THE CLUB."
--
-- Root cause of the delay (measured on production 2026-11-07): the client hook
-- resolved the whole union scope, then for EVERY club in it where the viewer
-- was staff called ca_club_members_overview - the full roster reader, which
-- computes wallets, fees, hands and downline counts for every member - and
-- threw everything away except user_id, one club after another, re-running
-- the whole function per 500-row page. For KingFish on a Midway Union event
-- that was four rosters: 670 ms + 6,936 ms + 6,742 ms + 2,268 ms = ~16.6 s,
-- plus a second full run of the 505-row Felt Society roster for page two.
-- Mine Only stayed hidden until all of it finished.
--
-- Root cause of the scope: the same union walk unioned every club's roster,
-- so an owner of several union clubs saw every club's players as "his".
--
-- This reader answers only the question the button asks, in one call:
--   * the club is the one the viewer is INSIDE (passed by the client), and
--     it must belong to the tournament's own club/union scope;
--   * the viewer must still be an active member of that club;
--   * owner / co-owner / admin (rank >= 80): every active member of that club;
--   * super agent / agent / sub agent (rank 20-79): their recursive agent
--     subtree inside that club, the same tree Club Data walks
--     (fn_ca_club_data_downline);
--   * plain players: nothing;
--   * only members still in the club (membership_lifecycle_status 'active')
--     and never a deleted profile, never the viewer.
-- It returns user ids only - no names, balances or stats - so it reveals
-- nothing the roster readers do not already show these roles.
-- Measured with the same body on production: 2-8 ms; agent results identical
-- to ca_club_member_downline for the four largest agent trees.
--
-- No table is touched; one new function only.

BEGIN;

CREATE OR REPLACE FUNCTION public.ca_tournament_my_downline_ids(
  p_tournament_id uuid,
  p_club_id uuid
)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH RECURSIVE viewer AS (
    SELECT max(public.fn_club_role_rank(cm.role)) AS rk
      FROM public.club_members cm
     WHERE cm.club_id = p_club_id
       AND cm.user_id = auth.uid()
       AND cm.membership_lifecycle_status = 'active'
  ), in_scope AS (
    SELECT 1
      FROM public.tournaments t
     WHERE t.id = p_tournament_id
       AND p_club_id = ANY (public.fn_club_scope_ids(coalesce(t.union_id, t.club_id)))
  ), staff AS (
    SELECT cm.user_id AS uid
      FROM public.club_members cm, viewer v
     WHERE v.rk >= 80 AND cm.club_id = p_club_id
  ), edges AS MATERIALIZED (
    SELECT cm.user_id AS child, cm.agent_id AS parent
      FROM public.club_members cm, viewer v
     WHERE v.rk BETWEEN 20 AND 79
       AND cm.club_id = p_club_id
       AND cm.agent_id IS NOT NULL
       AND cm.agent_id <> cm.user_id
  ), tree(uid) AS (
    SELECT e.child FROM edges e WHERE e.parent = auth.uid()
    UNION
    SELECT e.child FROM tree t JOIN edges e ON e.parent = t.uid
  ), cand AS (
    SELECT uid FROM staff
    UNION
    SELECT uid FROM tree
  )
  SELECT coalesce(array_agg(DISTINCT c.uid), ARRAY[]::uuid[])
    FROM cand c
    JOIN public.club_members cm
      ON cm.club_id = p_club_id
     AND cm.user_id = c.uid
     AND cm.membership_lifecycle_status = 'active'
    JOIN public.profiles pr
      ON pr.id = c.uid
     AND pr.status IS DISTINCT FROM 'deleted'
   WHERE auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM in_scope)
     AND c.uid <> auth.uid();
$function$;

COMMENT ON FUNCTION public.ca_tournament_my_downline_ids(uuid, uuid) IS
  'Tournament Ranking "Mine Only": user ids beneath the signed-in viewer inside the ONE club they are in (staff: all active members; agents: recursive subtree). Members still in the club only. Dan 2026-11-06.';

REVOKE ALL ON FUNCTION public.ca_tournament_my_downline_ids(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_tournament_my_downline_ids(uuid, uuid) TO authenticated, service_role;

COMMIT;
