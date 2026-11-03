-- 20261103124023_horse_stats_basis_accepts_the_optional_horse_rollups.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Cron job sp_prune_hand_history_10m (every 10 s) has failed ~330 times an hour
-- since 2026-11-03 03:00Z with HORSE_STATS_BASIS_INVALID_SHAPE, raised by
-- smarter_private.horse_compact_stats_basis via
-- hand_submission_retention_disposal -> compact_settled_horse_requests ->
-- capture_horse_stats_basis. Engine v2 stats_facts may carry the optional
-- top-level key horse_rollups (an object; public.ca_project_hand_stats_facts
-- already accepts and validates it as "Optional on rolling engines"), but the
-- compaction basis admitted only version/facts/transfers. Hands holding
-- horse_rollups reached the disposal horizon at 03:00Z, and every prune batch
-- containing one aborts the whole transaction, so retention stalls.
--
-- The fix admits horse_rollups only when it is a JSON object and keeps it
-- verbatim (jsonb_set replaces only facts), so horse_stats_basis_matches stays
-- exact. Every previously valid input yields byte-identical output; unknown
-- top-level keys and a non-object horse_rollups are still refused. The body is
-- the live prosrc (md5 d98b854afc552bcc6fae590335e203e3) with only the
-- top-level key check changed. The DO block proves it in the same transaction.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

CREATE OR REPLACE FUNCTION smarter_private.horse_compact_stats_basis(p_stats jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE facts jsonb;
BEGIN
 IF p_stats IS NULL THEN RETURN 'null'::jsonb; END IF;
 IF COALESCE(p_stats->>'version','') NOT IN('1','2') OR jsonb_typeof(p_stats->'facts') IS DISTINCT FROM 'array'
 OR jsonb_typeof(p_stats->'transfers') IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_stats->'facts') NOT BETWEEN 1 AND 10 OR jsonb_array_length(p_stats->'transfers') NOT BETWEEN 0 AND 90
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_stats) k WHERE k NOT IN('version','facts','transfers','horse_rollups'))
 OR (p_stats ? 'horse_rollups' AND jsonb_typeof(p_stats->'horse_rollups') IS DISTINCT FROM 'object')
 THEN RAISE EXCEPTION 'HORSE_STATS_BASIS_INVALID_SHAPE' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_stats->'facts') f WHERE jsonb_typeof(f) IS DISTINCT FROM 'object')
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_stats->'transfers') t WHERE jsonb_typeof(t) IS DISTINCT FROM 'object') THEN
  RAISE EXCEPTION 'HORSE_STATS_BASIS_INVALID_ROW' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_stats->'facts') f CROSS JOIN LATERAL jsonb_object_keys(f) k WHERE NOT k=ANY(ARRAY['hand_id','user_id','club_id','table_id','tournament_id','played_at','game_variant','big_blind','seat','position','players_dealt','hole_cards','hand_class','invested','returned','net','net_bb','rake_paid','vpip','pfr','three_bet','faced_three_bet','folded_to_three_bet','had_cbet_flop_opp','cbet_flop','saw_flop','went_to_showdown','won_at_showdown','aggressive_actions','passive_actions','was_all_in','all_in_street','all_in_at_risk','all_in_equity','ev_returned','ev_net','ev_net_bb','created_at','opponent_ids','four_bet','all_in_equity_owed','source_hash','effective_stack_bb_at_deal','hero_in_position','aggressive_actions_preflop','passive_actions_preflop','aggressive_actions_flop','passive_actions_flop','aggressive_actions_turn','passive_actions_turn','aggressive_actions_river','passive_actions_river','three_bet_opportunity','four_bet_opportunity','steal_opportunity','stole','squeeze_opportunity','squeezed','blind_defense_opportunity','defended_blind','cbet_flop_opportunity','barrel_turn_opportunity','barreled_turn','barrel_river_opportunity','barreled_river','check_raise_opportunity','check_raised','donk_opportunity','donk_bet','probe_opportunity','probe_bet']))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_stats->'transfers') t CROSS JOIN LATERAL jsonb_object_keys(t) k WHERE k NOT IN('hand_id','winner_id','loser_id','amount','played_at','club_id','table_id'))
 THEN RAISE EXCEPTION 'HORSE_STATS_BASIS_UNKNOWN_FIELD' USING ERRCODE='55000'; END IF;
 SELECT jsonb_agg(f-'hole_cards' ORDER BY ord) INTO facts FROM jsonb_array_elements(p_stats->'facts') WITH ORDINALITY x(f,ord);
 RETURN jsonb_set(p_stats,'{facts}',facts);
END $function$;

DO $proof$
DECLARE
  v_in  jsonb := '{"version":"2","facts":[{"hand_id":"h","user_id":"u","hole_cards":["As","Kd"],"net":5}],"transfers":[],"horse_rollups":{"nets":{"u":5},"play":{"u":1}}}';
  v_old jsonb := '{"version":"2","facts":[{"hand_id":"h","user_id":"u","hole_cards":["As","Kd"],"net":5}],"transfers":[]}';
  v_out jsonb;
  v_refused boolean;
BEGIN
  v_out := smarter_private.horse_compact_stats_basis(v_in);
  IF v_out->'horse_rollups' IS DISTINCT FROM v_in->'horse_rollups' THEN
    RAISE EXCEPTION 'proof: horse_rollups was not kept verbatim'; END IF;
  IF (v_out->'facts'->0) ? 'hole_cards' THEN
    RAISE EXCEPTION 'proof: hole_cards survived compaction'; END IF;
  IF smarter_private.horse_compact_stats_basis(v_old)
     IS DISTINCT FROM '{"version":"2","facts":[{"hand_id":"h","user_id":"u","net":5}],"transfers":[]}'::jsonb THEN
    RAISE EXCEPTION 'proof: a previously valid basis changed output'; END IF;

  v_refused := false;
  BEGIN PERFORM smarter_private.horse_compact_stats_basis(v_old || '{"surprise":1}');
  EXCEPTION WHEN SQLSTATE '55000' THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'proof: unknown top-level key admitted'; END IF;

  v_refused := false;
  BEGIN PERFORM smarter_private.horse_compact_stats_basis(v_old || '{"horse_rollups":[1]}');
  EXCEPTION WHEN SQLSTATE '55000' THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'proof: non-object horse_rollups admitted'; END IF;
END $proof$;

COMMIT;
