-- 20261101030330_full_game_session_hand_statistics.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

-- Full-session counters come from committed hands, never the browser's observation window.
-- Self-only aggregate, no writes to gameplay, player, wallet or hand records.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';
CREATE FUNCTION public.fn_my_game_session_hand_stats(p_table_id uuid,p_as_of timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
WITH RECURSIVE context AS (
  SELECT t.id,t.tournament_id,auth.uid() AS user_id FROM public.tables t
  WHERE t.id=p_table_id AND auth.uid() IS NOT NULL
), opened AS (
  SELECT c.*,CASE WHEN c.tournament_id IS NOT NULL THEN
    (SELECT CASE WHEN count(*)>0 THEN greatest(min(p.registered_at),coalesce(
       (SELECT t.started_at FROM public.tournaments t WHERE t.id=c.tournament_id),
       (SELECT min(f.played_at) FROM public.ca_hand_facts f
        WHERE f.user_id=c.user_id AND f.tournament_id=c.tournament_id))) END
     FROM public.tournament_players p
     WHERE p.tournament_id=c.tournament_id AND p.user_id=c.user_id)
  ELSE coalesce(
    (SELECT s.opened_at FROM public.cash_player_session s
     WHERE s.player_id=c.user_id AND s.scope_type='table' AND s.scope_id=c.id AND s.opened_at<=coalesce(p_as_of,statement_timestamp())
     ORDER BY s.opened_at DESC LIMIT 1),
    (SELECT d.created_at FROM public.poker_diamond_custody d
     WHERE d.user_id=c.user_id AND d.purpose='cash_seat' AND d.target_id=c.id AND d.created_at<=coalesce(p_as_of,statement_timestamp())
     ORDER BY d.created_at DESC LIMIT 1)) END AS started_at,
  CASE WHEN c.tournament_id IS NOT NULL THEN coalesce(
    (SELECT p.eliminated_at FROM public.tournament_players p WHERE p.user_id=c.user_id
      AND p.tournament_id=c.tournament_id LIMIT 1),
    (SELECT t.ended_at FROM public.tournaments t WHERE t.id=c.tournament_id),statement_timestamp()) ELSE coalesce(
    (SELECT coalesce(s.closed_at,statement_timestamp()) FROM public.cash_player_session s
     WHERE s.player_id=c.user_id AND s.scope_type='table' AND s.scope_id=c.id AND s.opened_at<=coalesce(p_as_of,statement_timestamp())
     ORDER BY s.opened_at DESC LIMIT 1),
    (SELECT coalesce(d.released_at,statement_timestamp()) FROM public.poker_diamond_custody d
     WHERE d.user_id=c.user_id AND d.purpose='cash_seat' AND d.target_id=c.id AND d.created_at<=coalesce(p_as_of,statement_timestamp())
     ORDER BY d.created_at DESC LIMIT 1)) END AS through_at
  FROM context c
), lineage AS (
  SELECT o.id AS table_id,
    coalesce((SELECT s.occupancy_id FROM public.table_seats s
      WHERE s.table_id=o.id AND s.user_id=o.user_id AND s.joined_at<=least(o.through_at,coalesce(p_as_of,statement_timestamp()))
      AND (s.left_at IS NULL OR s.left_at>=o.started_at)
      ORDER BY s.left_at DESC NULLS FIRST,s.joined_at DESC LIMIT 1),
     (SELECT r.destination_occupancy_id FROM public.cash_seat_move_receipts r
      WHERE r.player_id=o.user_id AND r.to_table_id=o.id
      AND r.created_at BETWEEN o.started_at AND o.through_at
      ORDER BY r.created_at DESC LIMIT 1)) AS occupancy_id,
    o.through_at,ARRAY[]::uuid[] AS visited
  FROM opened o WHERE o.tournament_id IS NULL AND o.started_at IS NOT NULL
  UNION ALL
  SELECT r.from_table_id,r.source_occupancy_id,r.created_at,l.visited||l.occupancy_id
  FROM lineage l JOIN opened o ON true
  JOIN public.cash_seat_move_receipts r
    ON r.player_id=o.user_id AND r.to_table_id=l.table_id
    AND r.destination_occupancy_id=l.occupancy_id
    AND r.created_at BETWEEN o.started_at AND l.through_at
  WHERE NOT r.source_occupancy_id=ANY(l.visited)
), segments AS (
  SELECT l.table_id,coalesce((SELECT r.created_at FROM public.cash_seat_move_receipts r,opened o
    WHERE r.player_id=o.user_id AND r.to_table_id=l.table_id
    AND r.destination_occupancy_id=l.occupancy_id
    AND r.created_at BETWEEN o.started_at AND l.through_at
    ORDER BY r.created_at DESC LIMIT 1),o.started_at) AS from_at,l.through_at
  FROM lineage l,opened o
), facts AS MATERIALIZED (
  SELECT f.hand_id,f.returned,f.vpip,f.pfr FROM public.ca_hand_facts f,opened o
  WHERE f.user_id=o.user_id AND o.started_at IS NOT NULL AND (
    (o.tournament_id IS NOT NULL AND f.tournament_id=o.tournament_id) OR
    (o.tournament_id IS NULL AND f.tournament_id IS NULL AND EXISTS(
      SELECT 1 FROM segments s WHERE f.table_id=s.table_id
      AND f.played_at BETWEEN s.from_at AND s.through_at)))
), history AS (
  SELECT h.id FROM opened o JOIN public.tables t ON t.tournament_id=o.tournament_id
  JOIN public.hand_history h ON h.table_id=t.id
  WHERE o.tournament_id IS NOT NULL AND o.started_at IS NOT NULL
    AND h.players @> jsonb_build_array(jsonb_build_object('userId',o.user_id::text))
  UNION ALL
  SELECT h.id FROM segments s JOIN public.hand_history h ON h.table_id=s.table_id
    AND h.created_at BETWEEN s.from_at AND s.through_at
  JOIN opened o ON o.tournament_id IS NULL AND o.started_at IS NOT NULL
  WHERE h.players @> jsonb_build_array(jsonb_build_object('userId',o.user_id::text))
), hands AS (
  SELECT hand_id FROM facts UNION SELECT id FROM history
), totals AS (
  SELECT (SELECT count(*) FROM hands) AS played,count(*) AS recorded,
    count(*) FILTER(WHERE returned>0) AS won,
    count(*) FILTER(WHERE vpip) AS vpip,count(*) FILTER(WHERE pfr) AS pfr FROM facts
)
SELECT CASE WHEN o.started_at IS NULL THEN NULL ELSE jsonb_build_object(
  'started_at',o.started_at,'through_at',o.through_at,'tournament_id',o.tournament_id,
  'hands_played',v.played,'facts_complete',v.played=v.recorded,
  'hands_won',CASE WHEN v.played=v.recorded THEN v.won END,
  'vpip_percent',CASE WHEN v.played=v.recorded THEN CASE WHEN v.played=0 THEN 0
    ELSE round(100.0*v.vpip/v.played,1) END END,
  'pfr_percent',CASE WHEN v.played=v.recorded THEN CASE WHEN v.played=0 THEN 0
    ELSE round(100.0*v.pfr/v.played,1) END END
) END FROM opened o,totals v;
$fn$;
REVOKE ALL ON FUNCTION public.fn_my_game_session_hand_stats(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_my_game_session_hand_stats(uuid,timestamptz) TO authenticated,service_role;
COMMENT ON FUNCTION public.fn_my_game_session_hand_stats(uuid,timestamptz) IS
 'Self-only full tournament or actual cash-session completed dealt-in hand totals, including confirmed table moves. One database snapshot for count/VPIP/PFR. Missing fact coverage leaves rates unknown; no browser lifetime or row cap.';
-- @live-proof: has_function_privilege('authenticated','public.fn_my_game_session_hand_stats(uuid,timestamptz)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_my_game_session_hand_stats(uuid,timestamptz)','EXECUTE')
COMMIT;
