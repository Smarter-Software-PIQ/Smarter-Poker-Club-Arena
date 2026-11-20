-- 20261119184500_reporting_functions_resolve_must_move_receipts.sql
--
-- WHAT THIS CHANGES, AND WHY:
-- When a player buys into a cash Feeder table under their funding club and is
-- moved via must-move / break / balance / swap (`fn_cash_seat_move_execute`) to
-- a destination Main table, no new chip-ledger buy-in occurs, so
-- `public.cash_participant_funding_receipts` has no row for the destination
-- `table_id`. Instead, `fn_cash_seat_move_execute` writes an immutable receipt
-- to `public.cash_seat_move_receipts` preserving the funding `club_id`.
--
-- Stage 2 (`20261119180417_fn_member_record_fact_club_resolves_must_move_receipts.sql`)
-- added `cash_seat_move_receipts_dest_player_at_idx(to_table_id, player_id, created_at DESC, move_id DESC)`
-- and updated `fn_member_record_fact_club`. This Stage 3 sweep updates all 21
-- remaining live/active unpinned reporting functions that queried
-- `cash_participant_funding_receipts` by `table_id` + `operation_kind = 'buyin'`
-- without checking `cash_seat_move_receipts`:
--   - 17 `ca_player_*_by_club` / `ca_player_stats_*` Player Stats RPCs
--   - 3 Club Data / rollup functions (`fn_ca_club_data_fact_seed`,
--     `fn_ca_club_rake_daily_compute`, `fn_ca_reporting_rollups_from_facts`)
--   - 1 Roster cash window (`ca_club_members_cash_window`), preserving Stage 2's
--     purely additive partial-day slices.
-- (`fn_ca_club_data_ct_seed` is a retired one-time Sept/Oct 2026 historical
-- backfill with 0 live callers and dynamic TEMP tables, so it is left untouched.)
--
-- This migration also creates `cash_seat_move_receipts_player_dest_at_idx
-- (player_id, to_table_id, created_at DESC, move_id DESC)` concurrently before
-- `BEGIN;` so the 17 single-player stats RPCs filtering by `player_id` use an
-- index/bitmap scan rather than sequentially scanning `cash_seat_move_receipts`.
--
-- Read-only reporting functions + one concurrent index only. No table DDL,
-- no financial/money-path writes, no engine dependency.
--
-- @live-proof: EXISTS(SELECT 1 FROM pg_index WHERE indexrelid = 'public.cash_seat_move_receipts_player_dest_at_idx'::regclass AND indisvalid AND indisready)
-- @live-proof: (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('ca_player_class_hands_by_club', 'ca_player_ev_curve_by_club', 'ca_player_hand_grid_by_club', 'ca_player_hands_separated_by_club', 'ca_player_hands_v2_by_club', 'ca_player_nemesis_by_club', 'ca_player_rake_stats_by_club', 'ca_player_rake_stats_calendar_by_club', 'ca_player_stats_club_comparison', 'ca_player_stats_club_comparison_separated', 'ca_player_stats_hand_evidence', 'ca_player_stats_hand_evidence_base', 'ca_player_stats_overview_separated_by_club', 'ca_player_stats_overview_v2_by_club', 'ca_player_stats_pulse_by_club', 'ca_player_stats_shared_overview_v1', 'ca_player_stats_shared_separated', 'fn_ca_club_data_fact_seed', 'fn_ca_club_rake_daily_compute', 'fn_ca_reporting_rollups_from_facts', 'ca_club_members_cash_window') AND pg_get_functiondef(p.oid) ILIKE '%cash_seat_move_receipts%') = 21
-- @live-proof: NOT has_function_privilege('authenticated', 'public.ca_club_members_cash_window(uuid,uuid[],date,date)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.ca_player_stats_hand_evidence_base(uuid,uuid,text,text,text,numeric,timestamp with time zone,timestamp with time zone,text,boolean,boolean,boolean,boolean,text,boolean,text,timestamp with time zone,uuid,integer)', 'EXECUTE')

CREATE INDEX CONCURRENTLY IF NOT EXISTS cash_seat_move_receipts_player_dest_at_idx
  ON public.cash_seat_move_receipts (player_id, to_table_id, created_at DESC, move_id DESC);

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indexrelid = 'public.cash_seat_move_receipts_dest_player_at_idx'::regclass
      AND indisvalid
      AND indisready
  ) THEN
    RAISE EXCEPTION 'cash_seat_move_receipts_dest_player_at_idx must be valid and ready';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indexrelid = 'public.cash_seat_move_receipts_player_dest_at_idx'::regclass
      AND indisvalid
      AND indisready
  ) THEN
    RAISE EXCEPTION 'cash_seat_move_receipts_player_dest_at_idx must be valid and ready';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ca_player_class_hands_by_club(p_user uuid, p_hand_class text, p_position text DEFAULT NULL::text, p_variant text DEFAULT NULL::text, p_days integer DEFAULT NULL::integer, p_limit integer DEFAULT 20, p_asset text DEFAULT 'chips'::text, p_club_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cap integer:=least(greatest(coalesce(p_limit,20),1),100);
BEGIN
  -- funded_stats_scope: historical funding, original caller gates.
  PERFORM public.ca_assert_player_stats_club(p_user,p_club_id,p_asset);
  IF p_hand_class IS NULL OR btrim(p_hand_class)='' THEN
    RETURN jsonb_build_object('contract_version',2,
      'scope',jsonb_build_object('target_user_id',p_user,'club_id',p_club_id,'asset',p_asset,
        'range_days',CASE WHEN p_days IS NULL THEN NULL ELSE least(greatest(p_days,1),3650) END,'visibility','owner'),
      'hands','[]'::jsonb,'hand_class',NULL,'generated_at',now());
  END IF;
  RETURN jsonb_build_object('contract_version',2,
    'scope',jsonb_build_object('target_user_id',p_user,'club_id',p_club_id,'asset',p_asset,
      'range_days',CASE WHEN p_days IS NULL THEN NULL ELSE least(greatest(p_days,1),3650) END,'visibility','owner'),
    'hand_class',p_hand_class,'hands',coalesce((SELECT jsonb_agg(h ORDER BY played_at DESC)
    FROM (SELECT f.played_at,jsonb_build_object('hand_id',f.hand_id,'played_at',f.played_at,
      'position',f.position,'net',round(f.net,2),'net_bb',round(f.net_bb,2),
      'big_blind',f.big_blind,'variant',f.game_variant,'was_all_in',f.was_all_in,
      'showdown',f.went_to_showdown,'won',f.net>0,'hole_cards',f.hole_cards) h
      FROM (
 WITH receipts AS MATERIALIZED (
  SELECT DISTINCT ON(a.table_id,a.account_entity_id,a.seat_joined_at)
   a.table_id,a.account_entity_id,a.seat_joined_at,a.funding_club_id
  FROM (
   SELECT table_id,account_entity_id,seat_joined_at,funding_club_id,recorded_at AS seq_at,id AS seq_id
   FROM public.cash_participant_funding_receipts
   WHERE account_entity_id=p_user AND operation_kind='buyin'
   UNION ALL
   SELECT to_table_id AS table_id,player_id AS account_entity_id,created_at AS seat_joined_at,club_id AS funding_club_id,created_at AS seq_at,move_id AS seq_id
   FROM public.cash_seat_move_receipts
   WHERE player_id=p_user
  ) a
  ORDER BY a.table_id,a.account_entity_id,a.seat_joined_at,a.seq_at DESC,a.seq_id DESC
 ), funding AS MATERIALIZED (
  SELECT *,lead(seat_joined_at) OVER(PARTITION BY table_id,account_entity_id ORDER BY seat_joined_at) until_at
  FROM receipts
 )
 SELECT fact.*,coalesce(x.funding_club_id,tp.club_id,ra.club_id,fact.club_id) funded_club
 FROM public.ca_hand_facts fact
 LEFT JOIN funding x ON fact.tournament_id IS NULL AND x.table_id=fact.table_id
  AND fact.played_at>=x.seat_joined_at AND (x.until_at IS NULL OR fact.played_at<x.until_at)
 LEFT JOIN public.tournament_players tp ON tp.tournament_id=fact.tournament_id AND tp.user_id=fact.user_id
 LEFT JOIN public.rake_attributions ra ON x.funding_club_id IS NULL AND tp.club_id IS NULL
  AND ra.hand_id=fact.hand_id AND ra.player_id=fact.user_id
 WHERE fact.user_id=p_user
 ) f WHERE f.user_id=p_user AND f.tournament_id IS NULL AND f.funded_club=p_club_id
        AND f.hand_class=p_hand_class AND (p_position IS NULL OR f.position=p_position)
        AND (p_variant IS NULL OR f.game_variant=p_variant)
        AND (p_days IS NULL OR f.played_at>=now()-make_interval(days=>least(greatest(p_days,1),3650)))
      ORDER BY f.played_at DESC LIMIT v_cap) q),'[]'::jsonb),'generated_at',now());
END;$function$;

CREATE OR REPLACE FUNCTION public.ca_player_ev_curve_by_club(p_user uuid, p_days integer DEFAULT NULL::integer, p_limit integer DEFAULT 5000, p_asset text DEFAULT 'chips'::text, p_club_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cap integer := least(greatest(coalesce(p_limit, 5000), 100), 20000);
BEGIN
  -- funded_stats_scope: historical funding, original caller gates.
  PERFORM public.ca_assert_player_stats_club(p_user, p_club_id, p_asset);
  RETURN (WITH picked AS MATERIALIZED (
    SELECT f.played_at, f.net_bb, f.ev_net_bb, f.was_all_in
    FROM (
 WITH receipts AS MATERIALIZED (
  SELECT DISTINCT ON(a.table_id,a.account_entity_id,a.seat_joined_at)
   a.table_id,a.account_entity_id,a.seat_joined_at,a.funding_club_id
  FROM (
   SELECT table_id,account_entity_id,seat_joined_at,funding_club_id,recorded_at AS seq_at,id AS seq_id
   FROM public.cash_participant_funding_receipts
   WHERE account_entity_id=p_user AND operation_kind='buyin'
   UNION ALL
   SELECT to_table_id AS table_id,player_id AS account_entity_id,created_at AS seat_joined_at,club_id AS funding_club_id,created_at AS seq_at,move_id AS seq_id
   FROM public.cash_seat_move_receipts
   WHERE player_id=p_user
  ) a
  ORDER BY a.table_id,a.account_entity_id,a.seat_joined_at,a.seq_at DESC,a.seq_id DESC
 ), funding AS MATERIALIZED (
  SELECT *,lead(seat_joined_at) OVER(PARTITION BY table_id,account_entity_id ORDER BY seat_joined_at) until_at
  FROM receipts
 )
 SELECT fact.*,coalesce(x.funding_club_id,tp.club_id,ra.club_id,fact.club_id) funded_club
 FROM public.ca_hand_facts fact
 LEFT JOIN funding x ON fact.tournament_id IS NULL AND x.table_id=fact.table_id
  AND fact.played_at>=x.seat_joined_at AND (x.until_at IS NULL OR fact.played_at<x.until_at)
 LEFT JOIN public.tournament_players tp ON tp.tournament_id=fact.tournament_id AND tp.user_id=fact.user_id
 LEFT JOIN public.rake_attributions ra ON x.funding_club_id IS NULL AND tp.club_id IS NULL
  AND ra.hand_id=fact.hand_id AND ra.player_id=fact.user_id
 WHERE fact.user_id=p_user
 ) f WHERE f.user_id=p_user AND f.tournament_id IS NULL AND f.funded_club=p_club_id
      AND f.went_to_showdown AND f.game_variant NOT IN ('mtt','sit_and_go')
      AND (p_days IS NULL OR f.played_at >= now()-make_interval(days=>least(greatest(p_days,1),3650)))
    ORDER BY f.played_at DESC LIMIT v_cap
  ), a AS (
    SELECT row_number() OVER w i, played_at at, net_bb, ev_net_bb,
      sum(net_bb) OVER w cum_net_bb, sum(ev_net_bb) OVER w cum_ev_net_bb,
      was_all_in FROM picked WINDOW w AS (ORDER BY played_at)
  ), s AS (
    SELECT count(*) hands, count(*) FILTER (WHERE was_all_in) all_in_hands,
      coalesce(sum(net_bb),0) net_bb, coalesce(sum(ev_net_bb),0) ev_net_bb,
      coalesce(sum(net_bb-ev_net_bb),0) luck_bb,
      coalesce(max(net_bb-ev_net_bb),0) biggest_suckout,
      coalesce(min(net_bb-ev_net_bb),0) biggest_beat FROM a
  ) SELECT jsonb_build_object('contract_version',2,
    'scope',jsonb_build_object('target_user_id',p_user,'club_id',p_club_id,'asset',p_asset,
      'range_days',CASE WHEN p_days IS NULL THEN NULL ELSE least(greatest(p_days,1),3650) END,'visibility','owner'),
    'points',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'i',i,'at',at,'net_bb',net_bb,'ev_net_bb',ev_net_bb,
      'cum_net_bb',cum_net_bb,'cum_ev_net_bb',cum_ev_net_bb) ORDER BY i) FROM a),'[]'::jsonb),
    'summary',(SELECT jsonb_build_object('hands',hands,'all_in_hands',all_in_hands,
      'net_bb',round(net_bb,2),'ev_net_bb',round(ev_net_bb,2),'luck_bb',round(luck_bb,2),
      'luck_bb_per_100',CASE WHEN hands>0 THEN round(luck_bb/hands*100,2) ELSE 0 END,
      'biggest_suckout',round(biggest_suckout,2),'biggest_beat',round(biggest_beat,2),
      'capped',hands=v_cap) FROM s),'generated_at',now()));
END;$function$;

CREATE OR REPLACE FUNCTION public.ca_player_hand_grid_by_club(p_user uuid, p_position text DEFAULT NULL::text, p_variant text DEFAULT NULL::text, p_days integer DEFAULT NULL::integer, p_asset text DEFAULT 'chips'::text, p_club_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- funded_stats_scope: historical funding, original caller gates.
  PERFORM public.ca_assert_player_stats_club(p_user,p_club_id,p_asset);
  RETURN (WITH g AS (
    SELECT f.hand_class, count(*) hands, count(*) FILTER(WHERE f.vpip) hands_vpip,
      count(*) FILTER(WHERE f.net>0) hands_won,
      count(*) FILTER(WHERE f.vpip)::numeric/nullif(count(*),0) vpip_pct,
      round(sum(f.net_bb),2) net_bb, round(sum(f.ev_net_bb),2) ev_net_bb,
      round(sum(f.net_bb)/nullif(count(*),0)*100,2) bb100
    FROM (
 WITH receipts AS MATERIALIZED (
  SELECT DISTINCT ON(a.table_id,a.account_entity_id,a.seat_joined_at)
   a.table_id,a.account_entity_id,a.seat_joined_at,a.funding_club_id
  FROM (
   SELECT table_id,account_entity_id,seat_joined_at,funding_club_id,recorded_at AS seq_at,id AS seq_id
   FROM public.cash_participant_funding_receipts
   WHERE account_entity_id=p_user AND operation_kind='buyin'
   UNION ALL
   SELECT to_table_id AS table_id,player_id AS account_entity_id,created_at AS seat_joined_at,club_id AS funding_club_id,created_at AS seq_at,move_id AS seq_id
   FROM public.cash_seat_move_receipts
   WHERE player_id=p_user
  ) a
  ORDER BY a.table_id,a.account_entity_id,a.seat_joined_at,a.seq_at DESC,a.seq_id DESC
 ), funding AS MATERIALIZED (
  SELECT *,lead(seat_joined_at) OVER(PARTITION BY table_id,account_entity_id ORDER BY seat_joined_at) until_at
  FROM receipts
 )
 SELECT fact.*,coalesce(x.funding_club_id,tp.club_id,ra.club_id,fact.club_id) funded_club
 FROM public.ca_hand_facts fact
 LEFT JOIN funding x ON fact.tournament_id IS NULL AND x.table_id=fact.table_id
  AND fact.played_at>=x.seat_joined_at AND (x.until_at IS NULL OR fact.played_at<x.until_at)
 LEFT JOIN public.tournament_players tp ON tp.tournament_id=fact.tournament_id AND tp.user_id=fact.user_id
 LEFT JOIN public.rake_attributions ra ON x.funding_club_id IS NULL AND tp.club_id IS NULL
  AND ra.hand_id=fact.hand_id AND ra.player_id=fact.user_id
 WHERE fact.user_id=p_user
 ) f WHERE f.user_id=p_user AND f.tournament_id IS NULL AND f.funded_club=p_club_id
      AND f.hand_class IS NOT NULL AND (p_position IS NULL OR f.position=p_position)
      AND (p_variant IS NULL OR f.game_variant=p_variant)
      AND (p_days IS NULL OR f.played_at>=now()-make_interval(days=>least(greatest(p_days,1),3650)))
    GROUP BY f.hand_class
  ) SELECT jsonb_build_object('contract_version',2,
    'scope',jsonb_build_object('target_user_id',p_user,'club_id',p_club_id,'asset',p_asset,
      'range_days',CASE WHEN p_days IS NULL THEN NULL ELSE least(greatest(p_days,1),3650) END,'visibility','owner'),
    'cells',coalesce((SELECT jsonb_agg(g) FROM g),'[]'::jsonb),
    'totals',jsonb_build_object('hands',coalesce((SELECT sum(hands) FROM g),0),
      'classes_seen',(SELECT count(*) FROM g)),
    'filters',jsonb_build_object('position',p_position,'variant',p_variant,
      'days',CASE WHEN p_days IS NULL THEN NULL ELSE least(greatest(p_days,1),3650) END),
    'generated_at',now()));
END;$function$;

CREATE OR REPLACE FUNCTION public.ca_player_hands_separated_by_club(p_user uuid, p_mode text DEFAULT 'recent'::text, p_limit integer DEFAULT 25, p_asset text DEFAULT 'chips'::text, p_club_id uuid DEFAULT NULL::uuid, p_game_mode text DEFAULT 'cash'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_window constant integer := 750;
  v_limit integer := least(greatest(coalesce(p_limit,25),1),100);
  v_mode text := lower(coalesce(p_mode,'recent'));
BEGIN
  IF p_game_mode IS NULL OR p_game_mode NOT IN ('cash','tournament') THEN
    RAISE EXCEPTION 'invalid stats game mode' USING ERRCODE='22023';
  END IF;
  -- funded_stats_scope: historical funding, original caller gates.
  PERFORM public.ca_assert_player_stats_club(p_user,p_club_id,p_asset);
  IF v_mode NOT IN ('recent','biggest_won','biggest_lost') THEN
    v_mode := 'recent';
  END IF;
  RETURN (WITH mine AS MATERIALIZED (
    SELECT f.hand_id id, f.played_at, f.game_variant variant, f.big_blind,
      f.tournament_id IS NOT NULL is_tournament, nullif(f.position,'UNK') position,
      round(coalesce(h.pot_size,0)::numeric,2) pot_size,
      round(f.returned,2) won, round(f.net,2) profit, f.net>0 is_winner,
      f.players_dealt players, coalesce(h.board,to_jsonb(h.community_cards)) board,
      f.hole_cards
    FROM (
 WITH receipts AS MATERIALIZED (
  SELECT DISTINCT ON(a.table_id,a.account_entity_id,a.seat_joined_at)
   a.table_id,a.account_entity_id,a.seat_joined_at,a.funding_club_id
  FROM (
   SELECT table_id,account_entity_id,seat_joined_at,funding_club_id,recorded_at AS seq_at,id AS seq_id
   FROM public.cash_participant_funding_receipts
   WHERE account_entity_id=p_user AND operation_kind='buyin'
   UNION ALL
   SELECT to_table_id AS table_id,player_id AS account_entity_id,created_at AS seat_joined_at,club_id AS funding_club_id,created_at AS seq_at,move_id AS seq_id
   FROM public.cash_seat_move_receipts
   WHERE player_id=p_user
  ) a
  ORDER BY a.table_id,a.account_entity_id,a.seat_joined_at,a.seq_at DESC,a.seq_id DESC
 ), funding AS MATERIALIZED (
  SELECT *,lead(seat_joined_at) OVER(PARTITION BY table_id,account_entity_id ORDER BY seat_joined_at) until_at
  FROM receipts
 )
 SELECT fact.*,coalesce(x.funding_club_id,tp.club_id,ra.club_id,fact.club_id) funded_club
 FROM public.ca_hand_facts fact
 LEFT JOIN funding x ON fact.tournament_id IS NULL AND x.table_id=fact.table_id
  AND fact.played_at>=x.seat_joined_at AND (x.until_at IS NULL OR fact.played_at<x.until_at)
 LEFT JOIN public.tournament_players tp ON tp.tournament_id=fact.tournament_id AND tp.user_id=fact.user_id
 LEFT JOIN public.rake_attributions ra ON x.funding_club_id IS NULL AND tp.club_id IS NULL
  AND ra.hand_id=fact.hand_id AND ra.player_id=fact.user_id
 WHERE fact.user_id=p_user
 ) f
    LEFT JOIN public.hand_history h ON h.id=f.hand_id
    WHERE f.user_id=p_user AND f.funded_club=p_club_id
      AND (f.tournament_id IS NULL)=(p_game_mode='cash')
    ORDER BY f.played_at DESC
    LIMIT CASE WHEN v_mode='recent' THEN v_limit ELSE c_window END
  ), ranked AS (
    SELECT * FROM mine
    ORDER BY CASE WHEN v_mode='biggest_won' THEN profit END DESC NULLS LAST,
      CASE WHEN v_mode='biggest_lost' THEN profit END ASC NULLS LAST,
      CASE WHEN v_mode='recent' THEN played_at END DESC NULLS LAST
    LIMIT v_limit
  ) SELECT jsonb_build_object('contract_version',2,
    'scope',jsonb_build_object('target_user_id',p_user,'club_id',p_club_id,'asset',p_asset,'game_mode',p_game_mode,'visibility','owner'),
    'hands',coalesce(jsonb_agg(to_jsonb(r)
    ORDER BY CASE WHEN v_mode='biggest_won' THEN profit END DESC NULLS LAST,
      CASE WHEN v_mode='biggest_lost' THEN profit END ASC NULLS LAST,
      CASE WHEN v_mode='recent' THEN played_at END DESC NULLS LAST), '[]'::jsonb),
    'generated_at',now())
    FROM ranked r);
END;$function$;

CREATE OR REPLACE FUNCTION public.ca_player_hands_v2_by_club(p_user uuid, p_mode text DEFAULT 'recent'::text, p_limit integer DEFAULT 25, p_asset text DEFAULT 'chips'::text, p_club_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_window constant integer := 750;
  v_limit integer := least(greatest(coalesce(p_limit,25),1),100);
  v_mode text := lower(coalesce(p_mode,'recent'));
BEGIN
  -- funded_stats_scope: historical funding, original caller gates.
  PERFORM public.ca_assert_player_stats_club(p_user,p_club_id,p_asset);
  IF v_mode NOT IN ('recent','biggest_won','biggest_lost') THEN
    v_mode := 'recent';
  END IF;
  RETURN (WITH mine AS MATERIALIZED (
    SELECT f.hand_id id, f.played_at, f.game_variant variant, f.big_blind,
      f.tournament_id IS NOT NULL is_tournament, nullif(f.position,'UNK') position,
      round(coalesce(h.pot_size,0)::numeric,2) pot_size,
      round(f.returned,2) won, round(f.net,2) profit, f.net>0 is_winner,
      f.players_dealt players, coalesce(h.board,to_jsonb(h.community_cards)) board,
      f.hole_cards
    FROM (
 WITH receipts AS MATERIALIZED (
  SELECT DISTINCT ON(a.table_id,a.account_entity_id,a.seat_joined_at)
   a.table_id,a.account_entity_id,a.seat_joined_at,a.funding_club_id
  FROM (
   SELECT table_id,account_entity_id,seat_joined_at,funding_club_id,recorded_at AS seq_at,id AS seq_id
   FROM public.cash_participant_funding_receipts
   WHERE account_entity_id=p_user AND operation_kind='buyin'
   UNION ALL
   SELECT to_table_id AS table_id,player_id AS account_entity_id,created_at AS seat_joined_at,club_id AS funding_club_id,created_at AS seq_at,move_id AS seq_id
   FROM public.cash_seat_move_receipts
   WHERE player_id=p_user
  ) a
  ORDER BY a.table_id,a.account_entity_id,a.seat_joined_at,a.seq_at DESC,a.seq_id DESC
 ), funding AS MATERIALIZED (
  SELECT *,lead(seat_joined_at) OVER(PARTITION BY table_id,account_entity_id ORDER BY seat_joined_at) until_at
  FROM receipts
 )
 SELECT fact.*,coalesce(x.funding_club_id,tp.club_id,ra.club_id,fact.club_id) funded_club
 FROM public.ca_hand_facts fact
 LEFT JOIN funding x ON fact.tournament_id IS NULL AND x.table_id=fact.table_id
  AND fact.played_at>=x.seat_joined_at AND (x.until_at IS NULL OR fact.played_at<x.until_at)
 LEFT JOIN public.tournament_players tp ON tp.tournament_id=fact.tournament_id AND tp.user_id=fact.user_id
 LEFT JOIN public.rake_attributions ra ON x.funding_club_id IS NULL AND tp.club_id IS NULL
  AND ra.hand_id=fact.hand_id AND ra.player_id=fact.user_id
 WHERE fact.user_id=p_user
 ) f
    LEFT JOIN public.hand_history h ON h.id=f.hand_id
    WHERE f.user_id=p_user AND f.funded_club=p_club_id
      AND (v_mode='recent' OR f.tournament_id IS NULL)
    ORDER BY f.played_at DESC
    LIMIT CASE WHEN v_mode='recent' THEN v_limit ELSE c_window END
  ), ranked AS (
    SELECT * FROM mine
    ORDER BY CASE WHEN v_mode='biggest_won' THEN profit END DESC NULLS LAST,
      CASE WHEN v_mode='biggest_lost' THEN profit END ASC NULLS LAST,
      CASE WHEN v_mode='recent' THEN played_at END DESC NULLS LAST
    LIMIT v_limit
  ) SELECT jsonb_build_object('contract_version',2,
    'scope',jsonb_build_object('target_user_id',p_user,'club_id',p_club_id,'asset',p_asset,'visibility','owner'),
    'hands',coalesce(jsonb_agg(to_jsonb(r)
    ORDER BY CASE WHEN v_mode='biggest_won' THEN profit END DESC NULLS LAST,
      CASE WHEN v_mode='biggest_lost' THEN profit END ASC NULLS LAST,
      CASE WHEN v_mode='recent' THEN played_at END DESC NULLS LAST), '[]'::jsonb),
    'generated_at',now())
    FROM ranked r);
END;$function$;

CREATE OR REPLACE FUNCTION public.ca_player_nemesis_by_club(p_user uuid, p_days integer DEFAULT NULL::integer, p_min_hands integer DEFAULT 25, p_limit integer DEFAULT 10, p_asset text DEFAULT 'chips'::text, p_club_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '20s'
 SET work_mem TO '64MB'
 SET enable_indexscan TO 'off'
 SET search_path TO 'public'
AS $function$
BEGIN
  -- funded_stats_scope: historical funding, original caller gates.
  PERFORM public.ca_assert_player_stats_club(p_user,p_club_id,p_asset);
  RETURN (WITH funded_stats_scope AS MATERIALIZED (SELECT hand_id,user_id,played_at,opponent_ids,funded_club FROM (
 WITH receipts AS MATERIALIZED (
  SELECT DISTINCT ON(a.table_id,a.account_entity_id,a.seat_joined_at)
   a.table_id,a.account_entity_id,a.seat_joined_at,a.funding_club_id
  FROM (
   SELECT table_id,account_entity_id,seat_joined_at,funding_club_id,recorded_at AS seq_at,id AS seq_id
   FROM public.cash_participant_funding_receipts
   WHERE account_entity_id=p_user AND operation_kind='buyin'
   UNION ALL
   SELECT to_table_id AS table_id,player_id AS account_entity_id,created_at AS seat_joined_at,club_id AS funding_club_id,created_at AS seq_at,move_id AS seq_id
   FROM public.cash_seat_move_receipts
   WHERE player_id=p_user
  ) a
  ORDER BY a.table_id,a.account_entity_id,a.seat_joined_at,a.seq_at DESC,a.seq_id DESC
 ), funding AS MATERIALIZED (
  SELECT *,lead(seat_joined_at) OVER(PARTITION BY table_id,account_entity_id ORDER BY seat_joined_at) until_at
  FROM receipts
 )
 SELECT fact.*,coalesce(x.funding_club_id,tp.club_id,ra.club_id,fact.club_id) funded_club
 FROM public.ca_hand_facts fact
 LEFT JOIN funding x ON fact.tournament_id IS NULL AND x.table_id=fact.table_id
  AND fact.played_at>=x.seat_joined_at AND (x.until_at IS NULL OR fact.played_at<x.until_at)
 LEFT JOIN public.tournament_players tp ON tp.tournament_id=fact.tournament_id AND tp.user_id=fact.user_id
 LEFT JOIN public.rake_attributions ra ON x.funding_club_id IS NULL AND tp.club_id IS NULL
  AND ra.hand_id=fact.hand_id AND ra.player_id=fact.user_id
 WHERE fact.user_id=p_user AND fact.tournament_id IS NULL
 ) resolved), flows AS (
    SELECT loser_id opponent_id,amount delta FROM public.ca_hand_transfers ht LEFT JOIN funded_stats_scope hf ON hf.hand_id=ht.hand_id
      WHERE EXISTS (SELECT 1 FROM public.ca_hand_facts cf WHERE cf.hand_id=ht.hand_id AND cf.user_id=p_user AND cf.tournament_id IS NULL) AND winner_id=p_user AND coalesce(hf.funded_club,ht.club_id)=p_club_id AND (p_days IS NULL OR ht.played_at>=now()-make_interval(days=>least(greatest(p_days,1),3650)))
    UNION ALL SELECT winner_id,-amount FROM public.ca_hand_transfers ht LEFT JOIN funded_stats_scope hf ON hf.hand_id=ht.hand_id
      WHERE EXISTS (SELECT 1 FROM public.ca_hand_facts cf WHERE cf.hand_id=ht.hand_id AND cf.user_id=p_user AND cf.tournament_id IS NULL) AND loser_id=p_user AND coalesce(hf.funded_club,ht.club_id)=p_club_id AND (p_days IS NULL OR ht.played_at>=now()-make_interval(days=>least(greatest(p_days,1),3650)))
  ), netted AS (SELECT opponent_id,sum(delta) net_chips FROM flows GROUP BY opponent_id),
  shared AS (SELECT o.opponent_id,count(*) hands_together,max(f.played_at) last_played_at
    FROM funded_stats_scope f CROSS JOIN LATERAL unnest(coalesce(f.opponent_ids,'{}'::uuid[])) o(opponent_id)
    WHERE f.user_id=p_user AND f.funded_club=p_club_id
      AND (p_days IS NULL OR f.played_at>=now()-make_interval(days=>least(greatest(p_days,1),3650))) GROUP BY o.opponent_id),
  j AS (SELECT n.opponent_id,n.net_chips,s.hands_together,s.last_played_at,p.username,p.avatar_url
    FROM netted n JOIN shared s USING(opponent_id) LEFT JOIN public.profiles p ON p.id=n.opponent_id
    WHERE s.hands_together>=p_min_hands)
  SELECT jsonb_build_object('contract_version',2,
    'scope',jsonb_build_object('target_user_id',p_user,'club_id',p_club_id,'asset',p_asset,
      'range_days',CASE WHEN p_days IS NULL THEN NULL ELSE least(greatest(p_days,1),3650) END,'visibility','owner'),
    'nemesis',(SELECT to_jsonb(x) FROM (SELECT * FROM j WHERE net_chips<0 ORDER BY net_chips LIMIT 1)x),
    'target',(SELECT to_jsonb(x) FROM (SELECT * FROM j WHERE net_chips>0 ORDER BY net_chips DESC LIMIT 1)x),
    'worst',coalesce((SELECT jsonb_agg(x) FROM (SELECT * FROM j WHERE net_chips<0 ORDER BY net_chips LIMIT p_limit)x),'[]'::jsonb),
    'best',coalesce((SELECT jsonb_agg(x) FROM (SELECT * FROM j WHERE net_chips>0 ORDER BY net_chips DESC LIMIT p_limit)x),'[]'::jsonb),
    'min_hands',p_min_hands,'opponents_qualified',(SELECT count(*) FROM j),'generated_at',now()));
END;$function$;

CREATE OR REPLACE FUNCTION public.ca_player_rake_stats_by_club(p_user uuid DEFAULT NULL::uuid, p_days integer DEFAULT NULL::integer, p_asset text DEFAULT 'chips'::text, p_club_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_fee_redemption numeric := 0; v_rake_share numeric := 0; v_uid uuid:=coalesce(p_user,auth.uid()); v_hands bigint;
  v_raked bigint; v_rake numeric; v_bb numeric; v_first timestamptz; v_last timestamptz;
BEGIN
  -- funded_stats_scope: historical funding, original caller gates.
  PERFORM public.ca_assert_player_stats_club(v_uid,p_club_id,p_asset);
  SELECT count(*),count(*) FILTER(WHERE coalesce(rake_paid,0)>0),coalesce(sum(rake_paid),0),
    coalesce(sum(CASE WHEN big_blind>0 THEN rake_paid/big_blind ELSE 0 END),0),
    min(played_at),max(played_at) INTO v_hands,v_raked,v_rake,v_bb,v_first,v_last
  FROM (
 WITH receipts AS MATERIALIZED (
  SELECT DISTINCT ON(a.table_id,a.account_entity_id,a.seat_joined_at)
   a.table_id,a.account_entity_id,a.seat_joined_at,a.funding_club_id
  FROM (
   SELECT table_id,account_entity_id,seat_joined_at,funding_club_id,recorded_at AS seq_at,id AS seq_id
   FROM public.cash_participant_funding_receipts
   WHERE account_entity_id=v_uid AND operation_kind='buyin'
   UNION ALL
   SELECT to_table_id AS table_id,player_id AS account_entity_id,created_at AS seat_joined_at,club_id AS funding_club_id,created_at AS seq_at,move_id AS seq_id
   FROM public.cash_seat_move_receipts
   WHERE player_id=v_uid
  ) a
  ORDER BY a.table_id,a.account_entity_id,a.seat_joined_at,a.seq_at DESC,a.seq_id DESC
 ), funding AS MATERIALIZED (
  SELECT *,lead(seat_joined_at) OVER(PARTITION BY table_id,account_entity_id ORDER BY seat_joined_at) until_at
  FROM receipts
 )
 SELECT fact.*,coalesce(x.funding_club_id,tp.club_id,ra.club_id,fact.club_id) funded_club
 FROM public.ca_hand_facts fact
 LEFT JOIN funding x ON fact.tournament_id IS NULL AND x.table_id=fact.table_id
  AND fact.played_at>=x.seat_joined_at AND (x.until_at IS NULL OR fact.played_at<x.until_at)
 LEFT JOIN public.tournament_players tp ON tp.tournament_id=fact.tournament_id AND tp.user_id=fact.user_id
 LEFT JOIN public.rake_attributions ra ON x.funding_club_id IS NULL AND tp.club_id IS NULL
  AND ra.hand_id=fact.hand_id AND ra.player_id=fact.user_id
 WHERE fact.user_id=v_uid
 ) funded_stats_scope WHERE user_id=v_uid AND funded_club=p_club_id AND tournament_id IS NULL
    AND (p_days IS NULL OR played_at>=now()-make_interval(days=>least(greatest(p_days,1),3650)));

  SELECT coalesce(sum(r.amount_cents),0)::numeric / 100
    INTO v_fee_redemption
    FROM smarter_private.player_fee_redemptions r
   WHERE r.user_id=v_uid AND p_asset='chips'
     AND (p_days IS NULL OR r.effective_on >=
       (now()-make_interval(days=>least(greatest(p_days,1),3650)))::date)
     AND r.club_id=p_club_id;
  -- A standing rake share (smarter_private.player_rake_share_rules), from the
  -- same funded hands: negative where this player gives, positive where it receives.
  SELECT coalesce(sum(s.share_cents),0)::numeric / 100
    INTO v_rake_share
    FROM smarter_private.fn_player_rake_share_hand_cents(v_uid,
           CASE WHEN p_days IS NULL THEN '-infinity'::timestamptz
                ELSE now()-make_interval(days=>least(greatest(p_days,1),3650)) END,
           p_asset) s
   WHERE s.share_club_id=p_club_id;
  v_fee_redemption := v_fee_redemption - v_rake_share;
  v_rake := v_rake - v_fee_redemption;
  RETURN jsonb_build_object('fee_redemption',v_fee_redemption,'rake_share',v_rake_share,
    'gross_rake_paid',round(v_rake + v_fee_redemption,2),'contract_version',2,
    'scope',jsonb_build_object('target_user_id',v_uid,'club_id',p_club_id,'asset',p_asset,
      'range_days',CASE WHEN p_days IS NULL THEN NULL ELSE least(greatest(p_days,1),3650) END,'visibility','owner'),
    'hands',v_hands,'raked_hands',v_raked,'rake_paid',round(v_rake,2),
    'rake_per_100',CASE WHEN v_hands>0 THEN round(v_rake*100/v_hands,2) ELSE 0 END,
    'rake_in_bb',round(v_bb,2),'bb_per_100',CASE WHEN v_hands>0 THEN round(v_bb*100/v_hands,2) ELSE 0 END,
    'avg_rake_per_raked_hand',CASE WHEN v_raked>0 THEN round(v_rake/v_raked,4) ELSE 0 END,
    'first_hand_at',v_first,'last_hand_at',v_last,'days',
      CASE WHEN p_days IS NULL THEN NULL ELSE least(greatest(p_days,1),3650) END);
END;$function$;

CREATE OR REPLACE FUNCTION public.ca_player_rake_stats_calendar_by_club(p_user uuid, p_days integer, p_asset text, p_club_id uuid, p_tz text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_calendar_from timestamptz; v_calendar_to timestamptz;
  v_fee_redemption numeric := 0; v_rake_share numeric := 0; v_uid uuid:=coalesce(p_user,auth.uid()); v_hands bigint;
  v_raked bigint; v_rake numeric; v_bb numeric; v_first timestamptz; v_last timestamptz;
BEGIN
  SELECT b.range_days,b.range_tz,coalesce(b.from_at,'-infinity'::timestamptz),b.to_at
    INTO p_days,p_tz,v_calendar_from,v_calendar_to
    FROM public.ca_stats_calendar_bounds(p_days,p_tz) b;
  -- funded_stats_scope: historical funding, original caller gates.
  PERFORM public.ca_assert_player_stats_club(v_uid,p_club_id,p_asset);
  SELECT count(*),count(*) FILTER(WHERE coalesce(rake_paid,0)>0),coalesce(sum(rake_paid),0),
    coalesce(sum(CASE WHEN big_blind>0 THEN rake_paid/big_blind ELSE 0 END),0),
    min(played_at),max(played_at) INTO v_hands,v_raked,v_rake,v_bb,v_first,v_last
  FROM (
 WITH receipts AS MATERIALIZED (
  SELECT DISTINCT ON(a.table_id,a.account_entity_id,a.seat_joined_at)
   a.table_id,a.account_entity_id,a.seat_joined_at,a.funding_club_id
  FROM (
   SELECT table_id,account_entity_id,seat_joined_at,funding_club_id,recorded_at AS seq_at,id AS seq_id
   FROM public.cash_participant_funding_receipts
   WHERE account_entity_id=v_uid AND operation_kind='buyin'
   UNION ALL
   SELECT to_table_id AS table_id,player_id AS account_entity_id,created_at AS seat_joined_at,club_id AS funding_club_id,created_at AS seq_at,move_id AS seq_id
   FROM public.cash_seat_move_receipts
   WHERE player_id=v_uid
  ) a
  ORDER BY a.table_id,a.account_entity_id,a.seat_joined_at,a.seq_at DESC,a.seq_id DESC
 ), funding AS MATERIALIZED (
  SELECT *,lead(seat_joined_at) OVER(PARTITION BY table_id,account_entity_id ORDER BY seat_joined_at) until_at
  FROM receipts
 )
 SELECT fact.*,coalesce(x.funding_club_id,tp.club_id,ra.club_id,fact.club_id) funded_club
 FROM public.ca_hand_facts fact
 LEFT JOIN funding x ON fact.tournament_id IS NULL AND x.table_id=fact.table_id
  AND fact.played_at>=x.seat_joined_at AND (x.until_at IS NULL OR fact.played_at<x.until_at)
 LEFT JOIN public.tournament_players tp ON tp.tournament_id=fact.tournament_id AND tp.user_id=fact.user_id
 LEFT JOIN public.rake_attributions ra ON x.funding_club_id IS NULL AND tp.club_id IS NULL
  AND ra.hand_id=fact.hand_id AND ra.player_id=fact.user_id
 WHERE fact.user_id=v_uid
 ) funded_stats_scope WHERE user_id=v_uid AND funded_club=p_club_id AND tournament_id IS NULL
    AND played_at>=v_calendar_from
    AND (v_calendar_to IS NULL OR played_at<v_calendar_to);

  SELECT coalesce(sum(r.amount_cents),0)::numeric / 100
    INTO v_fee_redemption
    FROM smarter_private.player_fee_redemptions r
   WHERE r.user_id=v_uid AND p_asset='chips'
     AND (r.effective_on::timestamp AT TIME ZONE 'UTC') >= v_calendar_from
     AND (v_calendar_to IS NULL OR (r.effective_on::timestamp AT TIME ZONE 'UTC') < v_calendar_to)
     AND r.club_id=p_club_id;
  -- A standing rake share (smarter_private.player_rake_share_rules), from the
  -- same funded hands: negative where this player gives, positive where it receives.
  SELECT coalesce(sum(s.share_cents),0)::numeric / 100
    INTO v_rake_share
    FROM smarter_private.fn_player_rake_share_calendar_cents(v_uid,v_calendar_from,v_calendar_to,p_asset) s
   WHERE s.share_club_id=p_club_id;
  v_fee_redemption := v_fee_redemption - v_rake_share;
  v_rake := v_rake - v_fee_redemption;
  RETURN jsonb_build_object('range_tz',p_tz,'range_from',CASE WHEN p_days IS NULL THEN NULL ELSE v_calendar_from END,'range_to',v_calendar_to,'fee_redemption',v_fee_redemption,'rake_share',v_rake_share,
    'gross_rake_paid',round(v_rake + v_fee_redemption,2),'contract_version',2,
    'scope',jsonb_build_object('target_user_id',v_uid,'club_id',p_club_id,'asset',p_asset,
      'range_days',CASE WHEN p_days IS NULL THEN NULL ELSE least(greatest(p_days,1),3650) END,'visibility','owner'),
    'hands',v_hands,'raked_hands',v_raked,'rake_paid',round(v_rake,2),
    'rake_per_100',CASE WHEN v_hands>0 THEN round(v_rake*100/v_hands,2) ELSE 0 END,
    'rake_in_bb',round(v_bb,2),'bb_per_100',CASE WHEN v_hands>0 THEN round(v_bb*100/v_hands,2) ELSE 0 END,
    'avg_rake_per_raked_hand',CASE WHEN v_raked>0 THEN round(v_rake/v_raked,4) ELSE 0 END,
    'first_hand_at',v_first,'last_hand_at',v_last,'days',
      CASE WHEN p_days IS NULL THEN NULL ELSE least(greatest(p_days,1),3650) END);
END;$function$;

CREATE OR REPLACE FUNCTION public.ca_player_stats_club_comparison(p_user uuid, p_days integer DEFAULT NULL::integer, p_asset text DEFAULT 'chips'::text, p_tz text DEFAULT 'UTC'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '20s'
 SET work_mem TO '64MB'
 SET enable_indexscan TO 'off'
 SET search_path TO 'public'
AS $function$
DECLARE
  v_days integer := CASE WHEN p_days IS NULL THEN NULL ELSE least(greatest(p_days,1),3650) END;
  v_tz text := CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names WHERE name=p_tz) THEN p_tz ELSE 'UTC' END;
  v_from timestamptz := CASE WHEN v_days IS NULL THEN NULL ELSE
    (((now() AT TIME ZONE v_tz)::date-(v_days-1))::timestamp AT TIME ZONE v_tz) END;
  v_to timestamptz := CASE WHEN v_days IS NULL THEN NULL ELSE
    ((((now() AT TIME ZONE v_tz)::date+1)::timestamp) AT TIME ZONE v_tz) END;
BEGIN
  -- funded_stats_scope: historical funding, original caller gates.
  PERFORM public.ca_assert_self(p_user);
  IF p_asset IS NULL OR p_asset NOT IN ('chips','diamonds') THEN
    RAISE EXCEPTION 'unknown stats asset: %', p_asset USING ERRCODE='22023';
  END IF;
  RETURN (WITH memberships AS MATERIALIZED (
    SELECT DISTINCT c.id club_id, c.name club_name
    FROM public.club_members m JOIN public.clubs c ON c.id=m.club_id
    WHERE m.user_id=p_user AND m.status IN ('active','approved')
      AND coalesce(c.lifecycle_status,'active')<>'retired'
      AND coalesce(c.asset,'chips')=p_asset
  ), cash AS (
    SELECT f.funded_club AS club_id, count(*)::integer total_hands,
      count(*) FILTER (WHERE f.tournament_id IS NULL)::integer cash_hands,
      coalesce(sum(f.net) FILTER (WHERE f.tournament_id IS NULL),0) profit,
      coalesce(sum(f.net_bb) FILTER (WHERE f.tournament_id IS NULL),0) net_bb,
      count(*) FILTER (WHERE f.vpip)::integer vpip_hands,
      count(*) FILTER (WHERE f.pfr)::integer pfr_hands,
      coalesce(sum(f.rake_paid) FILTER (WHERE f.tournament_id IS NULL),0) rake_paid,
      max(f.played_at) last_played_at, min(f.played_at) first_played_at
    FROM (
 WITH receipts AS MATERIALIZED (
  SELECT DISTINCT ON(a.table_id,a.account_entity_id,a.seat_joined_at)
   a.table_id,a.account_entity_id,a.seat_joined_at,a.funding_club_id
  FROM (
   SELECT table_id,account_entity_id,seat_joined_at,funding_club_id,recorded_at AS seq_at,id AS seq_id
   FROM public.cash_participant_funding_receipts
   WHERE account_entity_id=p_user AND operation_kind='buyin'
   UNION ALL
   SELECT to_table_id AS table_id,player_id AS account_entity_id,created_at AS seat_joined_at,club_id AS funding_club_id,created_at AS seq_at,move_id AS seq_id
   FROM public.cash_seat_move_receipts
   WHERE player_id=p_user
  ) a
  ORDER BY a.table_id,a.account_entity_id,a.seat_joined_at,a.seq_at DESC,a.seq_id DESC
 ), funding AS MATERIALIZED (
  SELECT *,lead(seat_joined_at) OVER(PARTITION BY table_id,account_entity_id ORDER BY seat_joined_at) until_at
  FROM receipts
 )
 SELECT fact.*,coalesce(x.funding_club_id,tp.club_id,ra.club_id,fact.club_id) funded_club
 FROM public.ca_hand_facts fact
 LEFT JOIN funding x ON fact.tournament_id IS NULL AND x.table_id=fact.table_id
  AND fact.played_at>=x.seat_joined_at AND (x.until_at IS NULL OR fact.played_at<x.until_at)
 LEFT JOIN public.tournament_players tp ON tp.tournament_id=fact.tournament_id AND tp.user_id=fact.user_id
 LEFT JOIN public.rake_attributions ra ON x.funding_club_id IS NULL AND tp.club_id IS NULL
  AND ra.hand_id=fact.hand_id AND ra.player_id=fact.user_id
 WHERE fact.user_id=p_user
 ) f JOIN memberships m ON m.club_id=f.funded_club
    WHERE f.user_id=p_user
      AND (v_from IS NULL OR f.played_at>=v_from)
      AND (v_to IS NULL OR f.played_at<v_to)
    GROUP BY f.funded_club
  ), tourn AS (
    SELECT coalesce(tp.club_id,t.club_id) AS club_id, count(*)::integer tournament_entries,
      count(*) FILTER (WHERE coalesce(tp.prize,0)>0)::integer tournament_cashes,
      count(*) FILTER (WHERE tp.position=1 OR tp.status='winner')::integer tournament_wins,
      coalesce(sum(coalesce(tp.prize,0)+coalesce(tp.bounty_winnings,0)),0) tournament_winnings,
      max(t.ended_at) tournament_last_played_at
    FROM public.tournament_players tp JOIN public.tournaments t ON t.id=tp.tournament_id
    JOIN memberships m ON m.club_id=coalesce(tp.club_id,t.club_id)
    WHERE tp.user_id=p_user
      AND upper(coalesce(t.status,''))='COMPLETED'
      AND t.ended_at IS NOT NULL
      AND (v_from IS NULL OR t.ended_at>=v_from)
      AND (v_to IS NULL OR t.ended_at<v_to)
    GROUP BY coalesce(tp.club_id,t.club_id)
  ), rows AS (
    SELECT m.club_id,m.club_name,coalesce(c.total_hands,0) hands,
      coalesce(c.cash_hands,0) cash_hands,
      round(coalesce(c.profit,0),2) profit,
      coalesce(round(c.net_bb/nullif(c.cash_hands,0)*100,2),0) bb_per_100,
      coalesce(round(c.vpip_hands::numeric/nullif(c.total_hands,0),4),0) vpip,
      coalesce(round(c.pfr_hands::numeric/nullif(c.total_hands,0),4),0) pfr,
      NULL::numeric hours,
      round(coalesce(c.rake_paid,0),2) rake,
      coalesce(t.tournament_entries,0) tournament_entries,
      coalesce(t.tournament_cashes,0) tournament_cashes,
      coalesce(t.tournament_wins,0) tournament_wins,
      round(coalesce(t.tournament_winnings,0),2) tournament_winnings,
      greatest(c.last_played_at,t.tournament_last_played_at) last_played_at,
      c.first_played_at,
      coalesce(c.vpip_hands,0) vpip_numerator,
      coalesce(c.pfr_hands,0) pfr_numerator,
      coalesce(c.total_hands,0) dealt_denominator,
      coalesce(c.net_bb,0) net_bb_numerator
    FROM memberships m LEFT JOIN cash c USING(club_id) LEFT JOIN tourn t USING(club_id)
  ), totals AS (
    SELECT coalesce(sum(hands),0) hands,coalesce(sum(cash_hands),0) cash_hands,
      round(coalesce(sum(profit),0),2) profit,
      round(coalesce(sum(rake),0),2) rake,coalesce(sum(tournament_entries),0) tournament_entries,
      coalesce(sum(tournament_cashes),0) tournament_cashes,
      coalesce(sum(tournament_wins),0) tournament_wins,
      round(coalesce(sum(tournament_winnings),0),2) tournament_winnings,
      coalesce(sum(vpip_numerator),0) vpip_numerator,
      coalesce(sum(pfr_numerator),0) pfr_numerator,
      coalesce(sum(dealt_denominator),0) dealt_denominator,
      coalesce(sum(net_bb_numerator),0) net_bb_numerator,max(last_played_at) last_played_at
    FROM rows
  ) SELECT jsonb_build_object('contract_version',2,
    'scope',jsonb_build_object('target_user_id',p_user,'asset',p_asset,'range_days',v_days,
      'range_tz',v_tz,'visibility','owner'),
    'quality',jsonb_build_object('cash_money_source','exact_settlement','cash_money_exact',true,
      'historical_club_breakdown_available',false,'club_breakdown_source','ca_hand_facts',
      'hours_available',false,'three_bet_percent_available',false,
      'tournament_money_exact',false,
      'all_clubs_contract_conservation_comparable',false,
      'all_clubs_contract_conservation_reason','existing All Clubs includes pre-fact rollup history without club identity'),
    'rows',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY club_name,club_id) FROM rows r),'[]'::jsonb),
    'totals',(SELECT to_jsonb(t)||jsonb_build_object(
      'bb_per_100',coalesce(round(net_bb_numerator/nullif(cash_hands,0)*100,2),0),
      'vpip',coalesce(round(vpip_numerator::numeric/nullif(dealt_denominator,0),4),0),
      'pfr',coalesce(round(pfr_numerator::numeric/nullif(dealt_denominator,0),4),0),
      'hours',NULL) FROM totals t),
    'generated_at',now()));
END;$function$;

CREATE OR REPLACE FUNCTION public.ca_player_stats_club_comparison_separated(p_user uuid, p_days integer DEFAULT NULL::integer, p_asset text DEFAULT 'chips'::text, p_tz text DEFAULT 'UTC'::text, p_game_mode text DEFAULT 'cash'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '20s'
 SET work_mem TO '64MB'
 SET enable_indexscan TO 'off'
 SET search_path TO 'public'
AS $function$
DECLARE
  v_days integer := CASE WHEN p_days IS NULL THEN NULL ELSE least(greatest(p_days,1),3650) END;
  v_tz text := CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names WHERE name=p_tz) THEN p_tz ELSE 'UTC' END;
  v_from timestamptz := CASE WHEN v_days IS NULL THEN NULL ELSE
    (((now() AT TIME ZONE v_tz)::date-(v_days-1))::timestamp AT TIME ZONE v_tz) END;
  v_to timestamptz := CASE WHEN v_days IS NULL THEN NULL ELSE
    ((((now() AT TIME ZONE v_tz)::date+1)::timestamp) AT TIME ZONE v_tz) END;
BEGIN
  IF p_game_mode IS NULL OR p_game_mode NOT IN ('cash','tournament') THEN
    RAISE EXCEPTION 'invalid stats game mode' USING ERRCODE='22023';
  END IF;
  -- funded_stats_scope: historical funding, original caller gates.
  PERFORM public.ca_assert_self(p_user);
  IF p_asset IS NULL OR p_asset NOT IN ('chips','diamonds') THEN
    RAISE EXCEPTION 'unknown stats asset: %', p_asset USING ERRCODE='22023';
  END IF;
  RETURN (WITH memberships AS MATERIALIZED (
    SELECT DISTINCT c.id club_id, c.name club_name
    FROM public.club_members m JOIN public.clubs c ON c.id=m.club_id
    WHERE m.user_id=p_user AND m.status IN ('active','approved')
      AND coalesce(c.lifecycle_status,'active')<>'retired'
      AND coalesce(c.asset,'chips')=p_asset
  ), cash AS (
    SELECT f.funded_club AS club_id, count(*)::integer total_hands,
      count(*) FILTER (WHERE f.tournament_id IS NULL)::integer cash_hands,
      coalesce(sum(f.net) FILTER (WHERE f.tournament_id IS NULL),0) profit,
      coalesce(sum(f.net_bb) FILTER (WHERE f.tournament_id IS NULL),0) net_bb,
      count(*) FILTER (WHERE f.vpip)::integer vpip_hands,
      count(*) FILTER (WHERE f.pfr)::integer pfr_hands,
      coalesce(sum(f.rake_paid) FILTER (WHERE f.tournament_id IS NULL),0) rake_paid,
      max(f.played_at) last_played_at, min(f.played_at) first_played_at
    FROM (
 WITH receipts AS MATERIALIZED (
  SELECT DISTINCT ON(a.table_id,a.account_entity_id,a.seat_joined_at)
   a.table_id,a.account_entity_id,a.seat_joined_at,a.funding_club_id
  FROM (
   SELECT table_id,account_entity_id,seat_joined_at,funding_club_id,recorded_at AS seq_at,id AS seq_id
   FROM public.cash_participant_funding_receipts
   WHERE account_entity_id=p_user AND operation_kind='buyin'
   UNION ALL
   SELECT to_table_id AS table_id,player_id AS account_entity_id,created_at AS seat_joined_at,club_id AS funding_club_id,created_at AS seq_at,move_id AS seq_id
   FROM public.cash_seat_move_receipts
   WHERE player_id=p_user
  ) a
  ORDER BY a.table_id,a.account_entity_id,a.seat_joined_at,a.seq_at DESC,a.seq_id DESC
 ), funding AS MATERIALIZED (
  SELECT *,lead(seat_joined_at) OVER(PARTITION BY table_id,account_entity_id ORDER BY seat_joined_at) until_at
  FROM receipts
 )
 SELECT fact.*,coalesce(x.funding_club_id,tp.club_id,ra.club_id,fact.club_id) funded_club
 FROM public.ca_hand_facts fact
 LEFT JOIN funding x ON fact.tournament_id IS NULL AND x.table_id=fact.table_id
  AND fact.played_at>=x.seat_joined_at AND (x.until_at IS NULL OR fact.played_at<x.until_at)
 LEFT JOIN public.tournament_players tp ON tp.tournament_id=fact.tournament_id AND tp.user_id=fact.user_id
 LEFT JOIN public.rake_attributions ra ON x.funding_club_id IS NULL AND tp.club_id IS NULL
  AND ra.hand_id=fact.hand_id AND ra.player_id=fact.user_id
 WHERE fact.user_id=p_user AND (fact.tournament_id IS NULL)=(p_game_mode='cash')
 ) f JOIN memberships m ON m.club_id=f.funded_club
    WHERE f.user_id=p_user
      AND (v_from IS NULL OR f.played_at>=v_from)
      AND (v_to IS NULL OR f.played_at<v_to)
    GROUP BY f.funded_club
  ), tourn AS (
    SELECT coalesce(tp.club_id,t.club_id) AS club_id, count(*)::integer tournament_entries,
      count(*) FILTER (WHERE coalesce(tp.prize,0)>0)::integer tournament_cashes,
      count(*) FILTER (WHERE tp.position=1 OR tp.status='winner')::integer tournament_wins,
      coalesce(sum(coalesce(tp.prize,0)+coalesce(tp.bounty_winnings,0)),0) tournament_winnings,
      max(t.ended_at) tournament_last_played_at
    FROM public.tournament_players tp JOIN public.tournaments t ON t.id=tp.tournament_id
    JOIN memberships m ON m.club_id=coalesce(tp.club_id,t.club_id)
    WHERE p_game_mode='tournament' AND tp.user_id=p_user
      AND upper(coalesce(t.status,''))='COMPLETED'
      AND t.ended_at IS NOT NULL
      AND (v_from IS NULL OR t.ended_at>=v_from)
      AND (v_to IS NULL OR t.ended_at<v_to)
    GROUP BY coalesce(tp.club_id,t.club_id)
  ), rows AS (
    SELECT m.club_id,m.club_name,coalesce(c.total_hands,0) hands,
      coalesce(c.cash_hands,0) cash_hands,
      round(coalesce(c.profit,0),2) profit,
      coalesce(round(c.net_bb/nullif(c.cash_hands,0)*100,2),0) bb_per_100,
      coalesce(round(c.vpip_hands::numeric/nullif(c.total_hands,0),4),0) vpip,
      coalesce(round(c.pfr_hands::numeric/nullif(c.total_hands,0),4),0) pfr,
      NULL::numeric hours,
      round(coalesce(c.rake_paid,0),2) rake,
      coalesce(t.tournament_entries,0) tournament_entries,
      coalesce(t.tournament_cashes,0) tournament_cashes,
      coalesce(t.tournament_wins,0) tournament_wins,
      round(coalesce(t.tournament_winnings,0),2) tournament_winnings,
      greatest(c.last_played_at,t.tournament_last_played_at) last_played_at,
      c.first_played_at,
      coalesce(c.vpip_hands,0) vpip_numerator,
      coalesce(c.pfr_hands,0) pfr_numerator,
      coalesce(c.total_hands,0) dealt_denominator,
      coalesce(c.net_bb,0) net_bb_numerator
    FROM memberships m LEFT JOIN cash c USING(club_id) LEFT JOIN tourn t USING(club_id)
  ), totals AS (
    SELECT coalesce(sum(hands),0) hands,coalesce(sum(cash_hands),0) cash_hands,
      round(coalesce(sum(profit),0),2) profit,
      round(coalesce(sum(rake),0),2) rake,coalesce(sum(tournament_entries),0) tournament_entries,
      coalesce(sum(tournament_cashes),0) tournament_cashes,
      coalesce(sum(tournament_wins),0) tournament_wins,
      round(coalesce(sum(tournament_winnings),0),2) tournament_winnings,
      coalesce(sum(vpip_numerator),0) vpip_numerator,
      coalesce(sum(pfr_numerator),0) pfr_numerator,
      coalesce(sum(dealt_denominator),0) dealt_denominator,
      coalesce(sum(net_bb_numerator),0) net_bb_numerator,max(last_played_at) last_played_at
    FROM rows
  ) SELECT jsonb_build_object('contract_version',2,
    'scope',jsonb_build_object('target_user_id',p_user,'asset',p_asset,'game_mode',p_game_mode,'range_days',v_days,
      'range_tz',v_tz,'visibility','owner'),
    'quality',jsonb_build_object('cash_money_source','exact_settlement','cash_money_exact',true,
      'historical_club_breakdown_available',false,'club_breakdown_source','ca_hand_facts',
      'hours_available',false,'three_bet_percent_available',false,
      'tournament_money_exact',false,
      'all_clubs_contract_conservation_comparable',false,
      'all_clubs_contract_conservation_reason','existing All Clubs includes pre-fact rollup history without club identity'),
    'rows',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY club_name,club_id) FROM rows r),'[]'::jsonb),
    'totals',(SELECT to_jsonb(t)||jsonb_build_object(
      'bb_per_100',coalesce(round(net_bb_numerator/nullif(cash_hands,0)*100,2),0),
      'vpip',coalesce(round(vpip_numerator::numeric/nullif(dealt_denominator,0),4),0),
      'pfr',coalesce(round(pfr_numerator::numeric/nullif(dealt_denominator,0),4),0),
      'hours',NULL) FROM totals t),
    'generated_at',now()));
END;$function$;

CREATE OR REPLACE FUNCTION public.ca_player_stats_hand_evidence(p_user uuid, p_club_id uuid DEFAULT NULL::uuid, p_asset text DEFAULT 'chips'::text, p_variant text DEFAULT NULL::text, p_position text DEFAULT NULL::text, p_big_blind numeric DEFAULT NULL::numeric, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_outcome text DEFAULT NULL::text, p_showdown boolean DEFAULT NULL::boolean, p_all_in boolean DEFAULT NULL::boolean, p_big_pots boolean DEFAULT NULL::boolean, p_noted boolean DEFAULT NULL::boolean, p_hand_class text DEFAULT NULL::text, p_tournament boolean DEFAULT NULL::boolean, p_cash_metric text DEFAULT NULL::text, p_cash_session_id uuid DEFAULT NULL::uuid, p_cursor_played_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_hand_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session public.cash_player_session%ROWTYPE;
  v_session_asset text;
  v_overlap integer;
  v_limit integer := least(greatest(coalesce(p_limit,25),1),100);
  v_cash_metric text := lower(nullif(btrim(p_cash_metric),''));
BEGIN
  -- funded_stats_scope: historical funding, original caller gates.
  PERFORM public.ca_assert_self(p_user);
  IF p_asset IS NULL OR p_asset NOT IN ('chips','diamonds') THEN
    RAISE EXCEPTION 'unknown stats asset: %',p_asset USING ERRCODE='22023';
  END IF;
  IF p_cash_session_id IS NULL THEN
    RETURN public.ca_player_stats_hand_evidence_base(
      p_user,p_club_id,p_asset,p_variant,p_position,p_big_blind,p_from,p_to,
      p_outcome,p_showdown,p_all_in,p_big_pots,p_noted,p_hand_class,p_tournament,
      v_cash_metric,p_cursor_played_at,p_cursor_hand_id,p_limit);
  END IF;
  IF (p_cursor_played_at IS NULL) <> (p_cursor_hand_id IS NULL) THEN
    RAISE EXCEPTION 'session evidence cursor requires played_at and hand_id together'
      USING ERRCODE='22023';
  END IF;
  IF v_cash_metric IS NOT NULL AND v_cash_metric NOT IN (
    'three_bet','four_bet','steal','squeeze','blind_defense','cbet_flop',
    'barrel_turn','barrel_river','check_raise','donk','probe'
  ) THEN
    RAISE EXCEPTION 'unknown cash evidence metric: %',p_cash_metric USING ERRCODE='22023';
  END IF;
  SELECT s.* INTO v_session
    FROM public.cash_player_session s
    JOIN public.clubs c ON c.id=s.club_id
    JOIN public.club_members m ON m.club_id=c.id AND m.user_id=p_user
   WHERE s.id=p_cash_session_id AND s.player_id=p_user
     AND m.status IN ('active','approved')
     AND coalesce(c.lifecycle_status,'active')<>'retired'
     AND coalesce(c.asset,'chips')=p_asset
     AND (p_club_id IS NULL OR s.club_id=p_club_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cash session evidence refused' USING ERRCODE='42501';
  END IF;
  SELECT coalesce(c.asset,'chips') INTO v_session_asset
    FROM public.clubs c WHERE c.id=v_session.club_id;
  SELECT count(*)::integer INTO v_overlap
    FROM public.cash_player_session o
   WHERE o.player_id=p_user AND o.id<>v_session.id
     AND o.club_id=v_session.club_id
     AND ((v_session.cluster_id IS NOT NULL AND o.cluster_id=v_session.cluster_id)
          OR (v_session.cluster_id IS NULL AND o.cluster_id IS NULL
              AND o.table_id=v_session.table_id))
     AND tstzrange(o.opened_at,coalesce(o.closed_at,'infinity'),'[)') &&
         tstzrange(v_session.opened_at,coalesce(v_session.closed_at,'infinity'),'[)');
  IF v_overlap>0 THEN
    RETURN jsonb_build_object('contract_version',3,'hands','[]'::jsonb,'has_more',false,
      'next_cursor',NULL,'evidence_status','overlap_unavailable',
      'scope',jsonb_build_object('target_user_id',p_user,'cash_session_id',v_session.id,
        'club_id',v_session.club_id,'asset',v_session_asset,'visibility','owner'),'generated_at',now());
  END IF;

  RETURN (WITH filtered AS MATERIALIZED (
    SELECT f.hand_id,f.played_at,f.funded_club AS club_id,f.table_id,f.net,f.net_bb,f.game_variant,
      v_cash_metric cash_metric,
      CASE v_cash_metric
        WHEN 'three_bet' THEN f.three_bet WHEN 'four_bet' THEN f.four_bet
        WHEN 'steal' THEN f.stole WHEN 'squeeze' THEN f.squeezed
        WHEN 'blind_defense' THEN f.defended_blind WHEN 'cbet_flop' THEN f.cbet_flop
        WHEN 'barrel_turn' THEN f.barreled_turn WHEN 'barrel_river' THEN f.barreled_river
        WHEN 'check_raise' THEN f.check_raised WHEN 'donk' THEN f.donk_bet
        WHEN 'probe' THEN f.probe_bet ELSE NULL END cash_metric_action
      FROM (
 WITH receipts AS MATERIALIZED (
  SELECT DISTINCT ON(a.table_id,a.account_entity_id,a.seat_joined_at)
   a.table_id,a.account_entity_id,a.seat_joined_at,a.funding_club_id
  FROM (
   SELECT table_id,account_entity_id,seat_joined_at,funding_club_id,recorded_at AS seq_at,id AS seq_id
   FROM public.cash_participant_funding_receipts
   WHERE account_entity_id=p_user AND operation_kind='buyin'
   UNION ALL
   SELECT to_table_id AS table_id,player_id AS account_entity_id,created_at AS seat_joined_at,club_id AS funding_club_id,created_at AS seq_at,move_id AS seq_id
   FROM public.cash_seat_move_receipts
   WHERE player_id=p_user
  ) a
  ORDER BY a.table_id,a.account_entity_id,a.seat_joined_at,a.seq_at DESC,a.seq_id DESC
 ), funding AS MATERIALIZED (
  SELECT *,lead(seat_joined_at) OVER(PARTITION BY table_id,account_entity_id ORDER BY seat_joined_at) until_at
  FROM receipts
 )
 SELECT fact.*,coalesce(x.funding_club_id,tp.club_id,ra.club_id,fact.club_id) funded_club
 FROM public.ca_hand_facts fact
 LEFT JOIN funding x ON fact.tournament_id IS NULL AND x.table_id=fact.table_id
  AND fact.played_at>=x.seat_joined_at AND (x.until_at IS NULL OR fact.played_at<x.until_at)
 LEFT JOIN public.tournament_players tp ON tp.tournament_id=fact.tournament_id AND tp.user_id=fact.user_id
 LEFT JOIN public.rake_attributions ra ON x.funding_club_id IS NULL AND tp.club_id IS NULL
  AND ra.hand_id=fact.hand_id AND ra.player_id=fact.user_id
 WHERE fact.user_id=p_user
 ) f LEFT JOIN public.tables t ON t.id=f.table_id
     WHERE f.user_id=p_user AND f.funded_club=v_session.club_id AND f.tournament_id IS NULL
       AND f.played_at>=v_session.opened_at
       AND f.played_at<coalesce(v_session.closed_at,'infinity')
       AND ((v_session.cluster_id IS NOT NULL AND t.cluster_id=v_session.cluster_id)
            OR (v_session.cluster_id IS NULL AND f.table_id=v_session.table_id))
       AND (v_cash_metric IS NULL OR CASE v_cash_metric
          WHEN 'three_bet' THEN f.three_bet_opportunity
          WHEN 'four_bet' THEN f.four_bet_opportunity
          WHEN 'steal' THEN f.steal_opportunity
          WHEN 'squeeze' THEN f.squeeze_opportunity
          WHEN 'blind_defense' THEN f.blind_defense_opportunity
          WHEN 'cbet_flop' THEN f.cbet_flop_opportunity
          WHEN 'barrel_turn' THEN f.barrel_turn_opportunity
          WHEN 'barrel_river' THEN f.barrel_river_opportunity
          WHEN 'check_raise' THEN f.check_raise_opportunity
          WHEN 'donk' THEN f.donk_opportunity
          WHEN 'probe' THEN f.probe_opportunity ELSE false END IS TRUE)
       AND (p_cursor_played_at IS NULL OR
         (f.played_at,f.hand_id)<(p_cursor_played_at,p_cursor_hand_id))
     ORDER BY f.played_at DESC,f.hand_id DESC LIMIT v_limit+1
  ), page AS (SELECT * FROM filtered ORDER BY played_at DESC,hand_id DESC LIMIT v_limit),
  last_row AS (SELECT played_at,hand_id FROM page ORDER BY played_at,hand_id LIMIT 1)
  SELECT jsonb_build_object('contract_version',3,
    'hands',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY played_at DESC,hand_id DESC) FROM page p),'[]'::jsonb),
    'has_more',(SELECT count(*)>v_limit FROM filtered),
    'next_cursor',CASE WHEN (SELECT count(*)>v_limit FROM filtered) THEN
      (SELECT jsonb_build_object('played_at',played_at,'hand_id',hand_id) FROM last_row) ELSE NULL END,
    'evidence_status','exact_session','scope',jsonb_build_object('target_user_id',p_user,
      'cash_session_id',v_session.id,'club_id',v_session.club_id,'asset',v_session_asset,
      'cash_metric',v_cash_metric,'visibility','owner'),'generated_at',now()));
END;
$function$;

CREATE OR REPLACE FUNCTION public.ca_player_stats_hand_evidence_base(p_user uuid, p_club_id uuid DEFAULT NULL::uuid, p_asset text DEFAULT 'chips'::text, p_variant text DEFAULT NULL::text, p_position text DEFAULT NULL::text, p_big_blind numeric DEFAULT NULL::numeric, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_outcome text DEFAULT NULL::text, p_showdown boolean DEFAULT NULL::boolean, p_all_in boolean DEFAULT NULL::boolean, p_big_pots boolean DEFAULT NULL::boolean, p_noted boolean DEFAULT NULL::boolean, p_hand_class text DEFAULT NULL::text, p_tournament boolean DEFAULT NULL::boolean, p_cash_metric text DEFAULT NULL::text, p_cursor_played_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_hand_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit,25),1),100);
  v_variant text := lower(nullif(btrim(p_variant),''));
  v_position text := upper(nullif(btrim(p_position),''));
  v_outcome text := lower(nullif(btrim(p_outcome),''));
  v_cash_metric text := lower(nullif(btrim(p_cash_metric),''));
BEGIN
  -- funded_stats_scope: historical funding, original caller gates.
  IF auth.uid() IS NULL OR p_user IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'stats access refused' USING ERRCODE='42501';
  END IF;
  IF p_asset IS NULL OR p_asset NOT IN ('chips','diamonds') THEN
    RAISE EXCEPTION 'unknown stats asset: %',p_asset USING ERRCODE='22023';
  END IF;
  IF p_club_id IS NOT NULL THEN
    PERFORM public.ca_assert_player_stats_club(p_user,p_club_id,p_asset);
  END IF;
  IF v_outcome IS NOT NULL AND v_outcome NOT IN ('won','lost') THEN
    RAISE EXCEPTION 'unknown evidence outcome: %',p_outcome USING ERRCODE='22023';
  END IF;
  IF v_cash_metric IS NOT NULL AND v_cash_metric NOT IN (
    'three_bet','four_bet','steal','squeeze','blind_defense','cbet_flop',
    'barrel_turn','barrel_river','check_raise','donk','probe'
  ) THEN
    RAISE EXCEPTION 'unknown cash evidence metric: %',p_cash_metric USING ERRCODE='22023';
  END IF;
  IF (p_cursor_played_at IS NULL) <> (p_cursor_hand_id IS NULL) THEN
    RAISE EXCEPTION 'evidence cursor requires played_at and hand_id together' USING ERRCODE='22023';
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from >= p_to THEN
    RAISE EXCEPTION 'evidence range must be increasing' USING ERRCODE='22023';
  END IF;

  RETURN (WITH filtered AS MATERIALIZED (
    SELECT f.hand_id,f.played_at,f.funded_club AS club_id,f.table_id,f.tournament_id,
      f.game_variant,f.big_blind,f.position,f.players_dealt,f.hand_class,
      f.invested,f.returned,f.net,f.net_bb,f.rake_paid,f.vpip,f.pfr,
      f.three_bet,f.faced_three_bet,f.folded_to_three_bet,
      f.had_cbet_flop_opp,f.cbet_flop,f.saw_flop,f.went_to_showdown,
      f.won_at_showdown,f.aggressive_actions,f.passive_actions,f.was_all_in,
      f.ev_net_bb,f.hole_cards own_hole_cards,h.pot_size,
      v_cash_metric cash_metric,
      CASE v_cash_metric
        WHEN 'three_bet' THEN f.three_bet WHEN 'four_bet' THEN f.four_bet
        WHEN 'steal' THEN f.stole WHEN 'squeeze' THEN f.squeezed
        WHEN 'blind_defense' THEN f.defended_blind WHEN 'cbet_flop' THEN f.cbet_flop
        WHEN 'barrel_turn' THEN f.barreled_turn WHEN 'barrel_river' THEN f.barreled_river
        WHEN 'check_raise' THEN f.check_raised WHEN 'donk' THEN f.donk_bet
        WHEN 'probe' THEN f.probe_bet ELSE NULL END cash_metric_action
    FROM (
 WITH receipts AS MATERIALIZED (
  SELECT DISTINCT ON(a.table_id,a.account_entity_id,a.seat_joined_at)
   a.table_id,a.account_entity_id,a.seat_joined_at,a.funding_club_id
  FROM (
   SELECT table_id,account_entity_id,seat_joined_at,funding_club_id,recorded_at AS seq_at,id AS seq_id
   FROM public.cash_participant_funding_receipts
   WHERE account_entity_id=p_user AND operation_kind='buyin'
   UNION ALL
   SELECT to_table_id AS table_id,player_id AS account_entity_id,created_at AS seat_joined_at,club_id AS funding_club_id,created_at AS seq_at,move_id AS seq_id
   FROM public.cash_seat_move_receipts
   WHERE player_id=p_user
  ) a
  ORDER BY a.table_id,a.account_entity_id,a.seat_joined_at,a.seq_at DESC,a.seq_id DESC
 ), funding AS MATERIALIZED (
  SELECT *,lead(seat_joined_at) OVER(PARTITION BY table_id,account_entity_id ORDER BY seat_joined_at) until_at
  FROM receipts
 )
 SELECT fact.*,coalesce(x.funding_club_id,tp.club_id,ra.club_id,fact.club_id) funded_club
 FROM public.ca_hand_facts fact
 LEFT JOIN funding x ON fact.tournament_id IS NULL AND x.table_id=fact.table_id
  AND fact.played_at>=x.seat_joined_at AND (x.until_at IS NULL OR fact.played_at<x.until_at)
 LEFT JOIN public.tournament_players tp ON tp.tournament_id=fact.tournament_id AND tp.user_id=fact.user_id
 LEFT JOIN public.rake_attributions ra ON x.funding_club_id IS NULL AND tp.club_id IS NULL
  AND ra.hand_id=fact.hand_id AND ra.player_id=fact.user_id
 WHERE fact.user_id=p_user
 ) f
    JOIN public.clubs c ON c.id=f.funded_club
    LEFT JOIN public.hand_history h ON h.id=f.hand_id
    WHERE f.user_id=p_user
      AND coalesce(c.asset,'chips')=p_asset
      AND (p_club_id IS NULL OR f.funded_club=p_club_id)
      AND (v_variant IS NULL OR lower(f.game_variant)=CASE
        WHEN v_variant IN ('holdem','texasholdem') THEN 'nlh'
        WHEN v_variant IN ('omaha','plo') THEN 'plo4' ELSE v_variant END)
      AND (v_position IS NULL OR upper(f.position)=v_position)
      AND (p_big_blind IS NULL OR f.big_blind=p_big_blind)
      AND (p_from IS NULL OR f.played_at>=p_from)
      AND (p_to IS NULL OR f.played_at<p_to)
      AND (v_outcome IS NULL OR (v_outcome='won' AND f.net>0) OR (v_outcome='lost' AND f.net<0))
      AND (p_showdown IS NULL OR f.went_to_showdown=p_showdown)
      AND (p_all_in IS NULL OR f.was_all_in=p_all_in)
      AND (p_big_pots IS NULL OR NOT p_big_pots OR
        (h.pot_size IS NOT NULL AND f.big_blind>0 AND h.pot_size>=f.big_blind*100))
      AND (p_noted IS NULL OR NOT p_noted OR EXISTS (
        SELECT 1 FROM public.ca_hand_notes n WHERE n.user_id=p_user AND n.hand_id=f.hand_id))
      AND (p_hand_class IS NULL OR f.hand_class=p_hand_class)
      AND (p_tournament IS NULL OR (f.tournament_id IS NOT NULL)=p_tournament)
      AND (v_cash_metric IS NULL OR (
        f.tournament_id IS NULL AND CASE v_cash_metric
          WHEN 'three_bet' THEN f.three_bet_opportunity
          WHEN 'four_bet' THEN f.four_bet_opportunity
          WHEN 'steal' THEN f.steal_opportunity
          WHEN 'squeeze' THEN f.squeeze_opportunity
          WHEN 'blind_defense' THEN f.blind_defense_opportunity
          WHEN 'cbet_flop' THEN f.cbet_flop_opportunity
          WHEN 'barrel_turn' THEN f.barrel_turn_opportunity
          WHEN 'barrel_river' THEN f.barrel_river_opportunity
          WHEN 'check_raise' THEN f.check_raise_opportunity
          WHEN 'donk' THEN f.donk_opportunity
          WHEN 'probe' THEN f.probe_opportunity ELSE false END IS TRUE))
      AND (p_cursor_played_at IS NULL OR (f.played_at,f.hand_id)<(p_cursor_played_at,p_cursor_hand_id))
    ORDER BY f.played_at DESC,f.hand_id DESC
    LIMIT v_limit+1
  ), numbered AS (
    SELECT filtered.*,row_number() OVER (ORDER BY played_at DESC,hand_id DESC) rn FROM filtered
  ), page AS (
    SELECT * FROM numbered WHERE rn<=v_limit
  ), last_row AS (
    SELECT played_at,hand_id FROM page ORDER BY played_at,hand_id LIMIT 1
  ) SELECT jsonb_build_object(
    'contract_version',3,
    'hands',coalesce((SELECT jsonb_agg(to_jsonb(p)-'rn' ORDER BY played_at DESC,hand_id DESC) FROM page p),'[]'::jsonb),
    'has_more',(SELECT count(*)>v_limit FROM filtered),
    'next_cursor',CASE WHEN (SELECT count(*)>v_limit FROM filtered) THEN
      (SELECT jsonb_build_object('played_at',played_at,'hand_id',hand_id) FROM last_row) ELSE NULL END,
    'scope',jsonb_build_object('target_user_id',p_user,'club_id',p_club_id,'asset',p_asset,
      'from_inclusive',p_from,'to_exclusive',p_to,'cash_metric',v_cash_metric),
    'generated_at',now()));
END;$function$;

CREATE OR REPLACE FUNCTION public.ca_player_stats_overview_separated_by_club(p_user uuid, p_days integer DEFAULT NULL::integer, p_tz text DEFAULT 'UTC'::text, p_asset text DEFAULT 'chips'::text, p_club_id uuid DEFAULT NULL::uuid, p_game_mode text DEFAULT 'cash'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '20s'
 SET work_mem TO '64MB'
 SET enable_indexscan TO 'off'
 SET search_path TO 'public'
AS $function$
DECLARE
  c_analysis_cap constant integer := 750;
  v_days integer := CASE WHEN p_days IS NULL THEN NULL ELSE least(greatest(p_days, 1), 3650) END;
  v_tz text := CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_tz) THEN p_tz ELSE 'UTC' END;
  v_from timestamptz := CASE WHEN v_days IS NULL THEN NULL ELSE
    (((now() AT TIME ZONE v_tz)::date - (v_days - 1))::timestamp AT TIME ZONE v_tz) END;
  v_to timestamptz := CASE WHEN v_days IS NULL THEN NULL ELSE
    ((((now() AT TIME ZONE v_tz)::date + 1)::timestamp) AT TIME ZONE v_tz) END;
  v_first timestamptz;
  v_last timestamptz;
  v_lifetime integer;
BEGIN
  IF p_game_mode IS NULL OR p_game_mode NOT IN ('cash','tournament') THEN
    RAISE EXCEPTION 'invalid stats game mode' USING ERRCODE='22023';
  END IF;
  -- funded_stats_scope: historical funding, original caller gates.
  PERFORM public.ca_assert_player_stats_club(p_user, p_club_id, p_asset);



  RETURN (
    WITH funded_stats_scope AS MATERIALIZED (SELECT hand_id,user_id,played_at,tournament_id,game_variant,big_blind,position,invested,returned,net,net_bb,vpip,pfr,three_bet,three_bet_opportunity,cbet_flop_opportunity,faced_three_bet,folded_to_three_bet,had_cbet_flop_opp,cbet_flop,saw_flop,went_to_showdown,won_at_showdown,aggressive_actions,passive_actions,af_bet_raise_actions,af_call_actions,funded_club FROM (
 WITH receipts AS MATERIALIZED (
  SELECT DISTINCT ON(a.table_id,a.account_entity_id,a.seat_joined_at)
   a.table_id,a.account_entity_id,a.seat_joined_at,a.funding_club_id
  FROM (
   SELECT table_id,account_entity_id,seat_joined_at,funding_club_id,recorded_at AS seq_at,id AS seq_id
   FROM public.cash_participant_funding_receipts
   WHERE account_entity_id=p_user AND operation_kind='buyin'
   UNION ALL
   SELECT to_table_id AS table_id,player_id AS account_entity_id,created_at AS seat_joined_at,club_id AS funding_club_id,created_at AS seq_at,move_id AS seq_id
   FROM public.cash_seat_move_receipts
   WHERE player_id=p_user
  ) a
  ORDER BY a.table_id,a.account_entity_id,a.seat_joined_at,a.seq_at DESC,a.seq_id DESC
 ), funding AS MATERIALIZED (
  SELECT *,lead(seat_joined_at) OVER(PARTITION BY table_id,account_entity_id ORDER BY seat_joined_at) until_at
  FROM receipts
 )
 SELECT fact.*,coalesce(x.funding_club_id,tp.club_id,ra.club_id,fact.club_id) funded_club
 FROM public.ca_hand_facts fact
 LEFT JOIN funding x ON fact.tournament_id IS NULL AND x.table_id=fact.table_id
  AND fact.played_at>=x.seat_joined_at AND (x.until_at IS NULL OR fact.played_at<x.until_at)
 LEFT JOIN public.tournament_players tp ON tp.tournament_id=fact.tournament_id AND tp.user_id=fact.user_id
 LEFT JOIN public.rake_attributions ra ON x.funding_club_id IS NULL AND tp.club_id IS NULL
  AND ra.hand_id=fact.hand_id AND ra.player_id=fact.user_id
 WHERE fact.user_id=p_user AND (fact.tournament_id IS NULL)=(p_game_mode='cash')
 ) resolved), coverage_totals AS (SELECT count(*)::integer total,min(played_at) first_at,max(played_at) last_at FROM funded_stats_scope WHERE funded_club=p_club_id), filtered AS MATERIALIZED (
      SELECT f.*
      FROM funded_stats_scope f
      WHERE f.user_id = p_user
        AND f.funded_club = p_club_id
        AND (v_from IS NULL OR f.played_at >= v_from)
        AND (v_to IS NULL OR f.played_at < v_to)
    ), recorded_coverage AS MATERIALIZED (SELECT public.ca_player_recorded_hand_coverage(p_user,coalesce(jsonb_agg(jsonb_build_object('hand_id',hand_id,'is_cash',tournament_id IS NULL,'bets',af_bet_raise_actions,'calls',af_call_actions)),'[]'::jsonb),v_from,v_to) m FROM filtered), scored AS MATERIALIZED (
      SELECT * FROM filtered ORDER BY played_at DESC LIMIT c_analysis_cap
    ), totals AS (
      SELECT count(*)::integer hands,
        count(*) FILTER (WHERE tournament_id IS NULL)::integer cash_hands,
        count(*) FILTER (WHERE tournament_id IS NOT NULL)::integer tourney_hands,
        count(DISTINCT tournament_id) FILTER (WHERE tournament_id IS NOT NULL)::integer tournaments_with_hands,
        count(*) FILTER (WHERE returned > 0)::integer hands_won,
        count(*) FILTER (WHERE vpip)::integer vpip_hands,
        count(*) FILTER (WHERE pfr)::integer pfr_hands,
        count(*) FILTER (WHERE three_bet AND three_bet_opportunity)::integer three_bet_hands,
        count(*) FILTER (WHERE three_bet_opportunity)::integer recorded_three_bet_opportunities,
        count(*) FILTER (WHERE faced_three_bet)::integer faced_three_bet_hands,
        count(*) FILTER (WHERE folded_to_three_bet)::integer folded_to_three_bet_hands,
        count(*) FILTER (WHERE cbet_flop_opportunity)::integer cbet_opps,
        count(*) FILTER (WHERE cbet_flop AND cbet_flop_opportunity)::integer cbet_hands,
        coalesce(sum(af_bet_raise_actions), 0)::integer aggro,
        count(*) FILTER(WHERE af_bet_raise_actions IS NOT NULL AND af_call_actions IS NOT NULL)::integer af_measured_hands,
        coalesce(sum(af_call_actions), 0)::integer passive,
        count(*) FILTER (WHERE saw_flop)::integer saw_flop_hands,
        count(*) FILTER (WHERE went_to_showdown)::integer showdowns,
        count(*) FILTER (WHERE won_at_showdown)::integer showdowns_won,
        coalesce(sum(net) FILTER (WHERE tournament_id IS NULL), 0) cash_profit,
        coalesce(sum(returned) FILTER (WHERE tournament_id IS NULL), 0) cash_won,
        coalesce(sum(invested) FILTER (WHERE tournament_id IS NULL), 0) cash_invested,
        coalesce(max(returned) FILTER (WHERE tournament_id IS NULL), 0) biggest_pot,
        coalesce(min(net) FILTER (WHERE tournament_id IS NULL), 0) biggest_loss,
        coalesce(sum(net_bb) FILTER (WHERE tournament_id IS NULL), 0) cash_net_bb,
        min(played_at) first_hand_at, max(played_at) last_hand_at
      FROM filtered
    ), analysis_sample AS (
      SELECT count(*)::integer hands FROM scored
    ), daily AS (
      SELECT date(played_at AT TIME ZONE v_tz) d, count(*)::integer hands,
             round(sum(net), 2) profit
      FROM filtered WHERE tournament_id IS NULL GROUP BY 1 ORDER BY 1
    ), positions AS (
      SELECT position, count(*)::integer hands_played,
        count(*) FILTER (WHERE vpip)::integer vpip_count,
        count(*) FILTER (WHERE pfr)::integer pfr_count,
        count(*) FILTER (WHERE three_bet AND three_bet_opportunity)::integer three_bet_count,
        count(*) FILTER (WHERE three_bet_opportunity)::integer three_bet_opps,
        count(*) FILTER (WHERE returned > 0)::integer hands_won,
        round(coalesce(sum(net) FILTER (WHERE tournament_id IS NULL), 0), 2) total_profit,
        round(coalesce(sum(net_bb) FILTER (WHERE tournament_id IS NULL), 0)
          / nullif(count(*) FILTER (WHERE tournament_id IS NULL), 0) * 100, 2) bb100
      FROM filtered GROUP BY position
    ), variants AS (
      SELECT game_variant, count(*)::integer hands,
        count(*) FILTER (WHERE returned > 0)::integer hands_won,
        round(coalesce(sum(net) FILTER (WHERE tournament_id IS NULL), 0), 2) profit,
        round(coalesce(sum(net_bb) FILTER (WHERE tournament_id IS NULL), 0)
          / nullif(count(*) FILTER (WHERE tournament_id IS NULL), 0) * 100, 2) bb100
      FROM filtered GROUP BY game_variant
    ), stakes AS (
      SELECT big_blind, count(*)::integer hands,
        count(*) FILTER (WHERE returned > 0)::integer hands_won,
        round(sum(net), 2) profit,
        round(sum(net_bb) / nullif(count(*), 0) * 100, 2) bb100
      FROM filtered WHERE tournament_id IS NULL AND big_blind > 0 GROUP BY big_blind
    ), tournament_rows AS (
      SELECT tp.*, t.name, t.start_time, t.ended_at, t.variant, t.buy_in_amount, t.buy_in_fee,
             t.rebuy_cost, t.addon_cost, t.is_mystery_bounty
      FROM public.tournament_players tp
      JOIN public.tournaments t ON t.id = tp.tournament_id
      WHERE p_game_mode='tournament' AND tp.user_id = p_user AND coalesce(tp.club_id,t.club_id) = p_club_id
        AND upper(coalesce(t.status, '')) = 'COMPLETED'
        AND t.ended_at IS NOT NULL
        AND (v_from IS NULL OR t.ended_at >= v_from)
        AND (v_to IS NULL OR t.ended_at < v_to)
    ), tournament_totals AS (
      SELECT count(*)::integer entries,
        count(*) FILTER (WHERE coalesce(prize, 0) > 0)::integer cashes,
        count(*) FILTER (WHERE position = 1 OR status = 'winner')::integer wins,
        min(position) FILTER (WHERE position IS NOT NULL) best_finish,
        coalesce(sum(coalesce(buy_in_amount, 0) + coalesce(buy_in_fee, 0)
          + coalesce(rebuys, 0) * coalesce(rebuy_cost, 0)
          + CASE WHEN add_on THEN coalesce(addon_cost, 0) ELSE 0 END), 0) total_buyins,
        coalesce(sum(coalesce(prize, 0)), 0) total_prizes,
        coalesce(sum(coalesce(bounty_winnings, 0)), 0) total_bounty_winnings,
        coalesce(sum(coalesce(bounties_collected, 0)), 0)::integer total_bounties
      FROM tournament_rows
    )
    SELECT jsonb_build_object(
      'contract_version', 2, 'generated_at', now(), 'window_days', v_days, 'window_tz', v_tz,
      'scope', jsonb_build_object('target_user_id', p_user, 'club_id', p_club_id,
        'asset', p_asset, 'game_mode', p_game_mode, 'range_days', v_days, 'range_tz', v_tz, 'visibility', 'owner'),
      'quality', jsonb_build_object('cash_money_source', 'exact_settlement',
        'cash_money_exact', true, 'exact_cash_hands', (SELECT cash_hands FROM totals),
        'advanced_facts_source', 'ca_hand_facts',
        'historical_club_breakdown_available', false,
        'club_breakdown_available', true, 'club_breakdown_source', 'ca_hand_facts',
        'club_breakdown_starts_at', (SELECT first_at FROM coverage_totals), 'live_tail_included', true,
        'section_availability', jsonb_build_object(
          'sessions', false,
          'sessions_reason', 'not_captured_in_ca_hand_facts'
        ),
        'recorded_hand_coverage', (SELECT m->'recorded_coverage' FROM recorded_coverage), 'metric_availability', (SELECT jsonb_build_object(
          'three_bet_percent', recorded_three_bet_opportunities > 0,
          'three_bet_numerator', three_bet_hands,
          'three_bet_opportunities', recorded_three_bet_opportunities,
          'fold_to_three_bet', faced_three_bet_hands > 0,
          'fold_to_three_bet_opportunities', faced_three_bet_hands,
          'cbet_flop', cbet_opps > 0,
          'cbet_flop_opportunities', cbet_opps,
          'aggression_factor', (SELECT (m#>>'{metric_availability,aggression_factor}')::boolean FROM recorded_coverage),
          'aggression_factor_denominator', (SELECT (m#>>'{metric_availability,aggression_factor_denominator}')::numeric FROM recorded_coverage),
          'wtsd', saw_flop_hands > 0,
          'wtsd_opportunities', saw_flop_hands,
          'cash_hours_played', (SELECT (m#>>'{metric_availability,cash_hours_played}')::boolean FROM recorded_coverage),'hours_played', (SELECT (m#>>'{metric_availability,hours_played}')::boolean FROM recorded_coverage)
        ) FROM totals)),
      'coverage', jsonb_build_object('analysis_hand_cap', c_analysis_cap,
        'analysis_sample_hands', (SELECT hands FROM analysis_sample),
        'analysis_sampled_sections',jsonb_build_array(),'analysis_hands_capped', (SELECT hands FROM totals) > c_analysis_cap,
        'lifetime_index_complete', true, 'first_hand_at', (SELECT first_at FROM coverage_totals), 'last_hand_at', (SELECT last_at FROM coverage_totals),
        'rollup_covered_through', (SELECT last_at FROM coverage_totals), 'rollup_updated_at', now()),
      'lifetime', jsonb_build_object('hands', (SELECT total FROM coverage_totals), 'first_hand_at', (SELECT first_at FROM coverage_totals),
        'last_hand_at', (SELECT last_at FROM coverage_totals), 'indexed_complete', true),
      'overall', (SELECT jsonb_build_object(
        'total_hands', hands, 'cash_hands', cash_hands, 'exact_cash_hands', cash_hands,
        'tourney_hands', tourney_hands, 'tournaments_with_hands', tournaments_with_hands,
        'hands_won', hands_won, 'hands_lost', hands - hands_won,
        'vpip', coalesce(round(vpip_hands::numeric / nullif(hands, 0), 4), 0),
        'pfr', coalesce(round(pfr_hands::numeric / nullif(hands, 0), 4), 0),
        -- ca_hand_facts does not retain the three-bet-opportunity flag. A
        -- per-hand denominator would manufacture a tracker statistic, so the
        -- compatible numeric field is zero and quality.metric_availability
        -- says it was not measured.
        'three_bet_percent', coalesce(round(three_bet_hands::numeric / nullif(recorded_three_bet_opportunities,0),4),0),
        'fold_to_three_bet', coalesce(round(folded_to_three_bet_hands::numeric / nullif(faced_three_bet_hands, 0), 4), 0),
        'cbet_flop', coalesce(round(cbet_hands::numeric / nullif(cbet_opps, 0), 4), 0),
        -- An action count is not a ratio. Zero passive actions means AF is
        -- unmeasured/infinite; keep the legacy numeric shape at zero and make
        -- availability explicit in quality.metric_availability.
        'aggression_factor', (SELECT (m->>'aggression_factor')::numeric FROM recorded_coverage),
        'aggression_factor_basis', (SELECT m->>'aggression_factor_basis' FROM recorded_coverage),
        'showdowns_total', showdowns, 'showdowns_won', showdowns_won,
        'wtsd', coalesce(round(showdowns::numeric / nullif(saw_flop_hands, 0), 4), 0),
        'total_profit', round(cash_profit, 2), 'total_winnings', round(cash_won, 2),
        'total_invested', round(cash_invested, 2), 'biggest_pot_won', round(biggest_pot, 2),
        'biggest_hand_loss', round(biggest_loss, 2),
        'bb_per_100', coalesce(round(cash_net_bb / nullif(cash_hands, 0) * 100, 2), 0),
        'cash_hours_played', (SELECT (m->>'cash_hours_played')::numeric FROM recorded_coverage),'hours_played', (SELECT (m->>'hours_played')::numeric FROM recorded_coverage), 'hand_cap', c_analysis_cap, 'hands_capped', false,
        'first_hand_at', first_hand_at, 'last_hand_at', last_hand_at) FROM totals),
      'daily', coalesce((SELECT jsonb_agg(jsonb_build_object('date', d, 'hands', hands, 'profit', profit) ORDER BY d) FROM daily), '[]'::jsonb),
      'sessions', '[]'::jsonb,
      'positions', coalesce((SELECT jsonb_agg(jsonb_build_object('position', position,
        'hands_played', hands_played, 'vpip_count', vpip_count, 'pfr_count', pfr_count,
        'three_bet_count', three_bet_count, 'three_bet_opps', three_bet_opps, 'hands_won', hands_won,
        'total_profit', total_profit, 'bb100', coalesce(bb100, 0))) FROM positions), '[]'::jsonb),
      'variants', coalesce((SELECT jsonb_agg(jsonb_build_object('variant', game_variant,
        'hands', hands, 'hands_won', hands_won, 'profit', profit, 'bb100', coalesce(bb100, 0))) FROM variants), '[]'::jsonb),
      'stakes', coalesce((SELECT jsonb_agg(jsonb_build_object('big_blind', big_blind,
        'hands', hands, 'hands_won', hands_won, 'profit', profit, 'bb100', bb100)) FROM stakes), '[]'::jsonb),
      'tournaments', (SELECT jsonb_build_object('entries', entries, 'cashes', cashes,
        'wins', wins, 'best_finish', best_finish,
        'itm_percent', coalesce(round(cashes::numeric / nullif(entries, 0), 4), 0),
        'total_buyins', round(total_buyins, 2),
        'total_winnings', round(total_prizes + total_bounty_winnings, 2),
        'total_prizes', round(total_prizes, 2),
        'total_bounty_winnings', round(total_bounty_winnings, 2),
        'total_bounties', total_bounties,
        'net_profit', round(total_prizes + total_bounty_winnings - total_buyins, 2),
        'roi', coalesce(round((total_prizes + total_bounty_winnings - total_buyins) / nullif(total_buyins, 0), 4), 0)) FROM tournament_totals),
      'recent_tournaments', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'tournament_id', tournament_id, 'name', name, 'start_time', start_time,
        'ended_at', ended_at,
        'variant', variant, 'is_mystery_bounty', coalesce(is_mystery_bounty, false),
        'finish_rank', position, 'status', status, 'prize', coalesce(prize, 0),
        'bounty_winnings', coalesce(bounty_winnings, 0),
        'bounties', coalesce(bounties_collected, 0),
        'total_won', coalesce(prize, 0) + coalesce(bounty_winnings, 0),
        'buyin', coalesce(buy_in_amount, 0) + coalesce(buy_in_fee, 0)
          + coalesce(rebuys, 0) * coalesce(rebuy_cost, 0)
          + CASE WHEN add_on THEN coalesce(addon_cost, 0) ELSE 0 END)
        ORDER BY ended_at DESC) FROM (SELECT * FROM tournament_rows ORDER BY ended_at DESC LIMIT 25) recent), '[]'::jsonb)
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.ca_player_stats_overview_v2_by_club(p_user uuid, p_days integer DEFAULT NULL::integer, p_tz text DEFAULT 'UTC'::text, p_asset text DEFAULT 'chips'::text, p_club_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '20s'
 SET work_mem TO '64MB'
 SET enable_indexscan TO 'off'
 SET search_path TO 'public'
AS $function$
DECLARE
  c_analysis_cap constant integer := 750;
  v_days integer := CASE WHEN p_days IS NULL THEN NULL ELSE least(greatest(p_days, 1), 3650) END;
  v_tz text := CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_tz) THEN p_tz ELSE 'UTC' END;
  v_from timestamptz := CASE WHEN v_days IS NULL THEN NULL ELSE
    (((now() AT TIME ZONE v_tz)::date - (v_days - 1))::timestamp AT TIME ZONE v_tz) END;
  v_to timestamptz := CASE WHEN v_days IS NULL THEN NULL ELSE
    ((((now() AT TIME ZONE v_tz)::date + 1)::timestamp) AT TIME ZONE v_tz) END;
  v_first timestamptz;
  v_last timestamptz;
  v_lifetime integer;
BEGIN
  -- funded_stats_scope: historical funding, original caller gates.
  PERFORM public.ca_assert_player_stats_club(p_user, p_club_id, p_asset);



  RETURN (
    WITH funded_stats_scope AS MATERIALIZED (SELECT hand_id,user_id,played_at,tournament_id,game_variant,big_blind,position,invested,returned,net,net_bb,vpip,pfr,three_bet,three_bet_opportunity,cbet_flop_opportunity,faced_three_bet,folded_to_three_bet,had_cbet_flop_opp,cbet_flop,saw_flop,went_to_showdown,won_at_showdown,aggressive_actions,passive_actions,af_bet_raise_actions,af_call_actions,funded_club FROM (
 WITH receipts AS MATERIALIZED (
  SELECT DISTINCT ON(a.table_id,a.account_entity_id,a.seat_joined_at)
   a.table_id,a.account_entity_id,a.seat_joined_at,a.funding_club_id
  FROM (
   SELECT table_id,account_entity_id,seat_joined_at,funding_club_id,recorded_at AS seq_at,id AS seq_id
   FROM public.cash_participant_funding_receipts
   WHERE account_entity_id=p_user AND operation_kind='buyin'
   UNION ALL
   SELECT to_table_id AS table_id,player_id AS account_entity_id,created_at AS seat_joined_at,club_id AS funding_club_id,created_at AS seq_at,move_id AS seq_id
   FROM public.cash_seat_move_receipts
   WHERE player_id=p_user
  ) a
  ORDER BY a.table_id,a.account_entity_id,a.seat_joined_at,a.seq_at DESC,a.seq_id DESC
 ), funding AS MATERIALIZED (
  SELECT *,lead(seat_joined_at) OVER(PARTITION BY table_id,account_entity_id ORDER BY seat_joined_at) until_at
  FROM receipts
 )
 SELECT fact.*,coalesce(x.funding_club_id,tp.club_id,ra.club_id,fact.club_id) funded_club
 FROM public.ca_hand_facts fact
 LEFT JOIN funding x ON fact.tournament_id IS NULL AND x.table_id=fact.table_id
  AND fact.played_at>=x.seat_joined_at AND (x.until_at IS NULL OR fact.played_at<x.until_at)
 LEFT JOIN public.tournament_players tp ON tp.tournament_id=fact.tournament_id AND tp.user_id=fact.user_id
 LEFT JOIN public.rake_attributions ra ON x.funding_club_id IS NULL AND tp.club_id IS NULL
  AND ra.hand_id=fact.hand_id AND ra.player_id=fact.user_id
 WHERE fact.user_id=p_user
 ) resolved), coverage_totals AS (SELECT count(*)::integer total,min(played_at) first_at,max(played_at) last_at FROM funded_stats_scope WHERE funded_club=p_club_id), filtered AS MATERIALIZED (
      SELECT f.*
      FROM funded_stats_scope f
      WHERE f.user_id = p_user
        AND f.funded_club = p_club_id
        AND (v_from IS NULL OR f.played_at >= v_from)
        AND (v_to IS NULL OR f.played_at < v_to)
    ), recorded_coverage AS MATERIALIZED (SELECT public.ca_player_recorded_hand_coverage(p_user,coalesce(jsonb_agg(jsonb_build_object('hand_id',hand_id,'is_cash',tournament_id IS NULL,'bets',af_bet_raise_actions,'calls',af_call_actions)),'[]'::jsonb),v_from,v_to) m FROM filtered), scored AS MATERIALIZED (
      SELECT * FROM filtered ORDER BY played_at DESC LIMIT c_analysis_cap
    ), totals AS (
      SELECT count(*)::integer hands,
        count(*) FILTER (WHERE tournament_id IS NULL)::integer cash_hands,
        count(*) FILTER (WHERE tournament_id IS NOT NULL)::integer tourney_hands,
        count(DISTINCT tournament_id) FILTER (WHERE tournament_id IS NOT NULL)::integer tournaments_with_hands,
        count(*) FILTER (WHERE returned > 0)::integer hands_won,
        count(*) FILTER (WHERE vpip)::integer vpip_hands,
        count(*) FILTER (WHERE pfr)::integer pfr_hands,
        count(*) FILTER (WHERE three_bet AND three_bet_opportunity)::integer three_bet_hands,
        count(*) FILTER (WHERE three_bet_opportunity)::integer recorded_three_bet_opportunities,
        count(*) FILTER (WHERE faced_three_bet)::integer faced_three_bet_hands,
        count(*) FILTER (WHERE folded_to_three_bet)::integer folded_to_three_bet_hands,
        count(*) FILTER (WHERE cbet_flop_opportunity)::integer cbet_opps,
        count(*) FILTER (WHERE cbet_flop AND cbet_flop_opportunity)::integer cbet_hands,
        coalesce(sum(af_bet_raise_actions), 0)::integer aggro,
        count(*) FILTER(WHERE af_bet_raise_actions IS NOT NULL AND af_call_actions IS NOT NULL)::integer af_measured_hands,
        coalesce(sum(af_call_actions), 0)::integer passive,
        count(*) FILTER (WHERE saw_flop)::integer saw_flop_hands,
        count(*) FILTER (WHERE went_to_showdown)::integer showdowns,
        count(*) FILTER (WHERE won_at_showdown)::integer showdowns_won,
        coalesce(sum(net) FILTER (WHERE tournament_id IS NULL), 0) cash_profit,
        coalesce(sum(returned) FILTER (WHERE tournament_id IS NULL), 0) cash_won,
        coalesce(sum(invested) FILTER (WHERE tournament_id IS NULL), 0) cash_invested,
        coalesce(max(returned) FILTER (WHERE tournament_id IS NULL), 0) biggest_pot,
        coalesce(min(net) FILTER (WHERE tournament_id IS NULL), 0) biggest_loss,
        coalesce(sum(net_bb) FILTER (WHERE tournament_id IS NULL), 0) cash_net_bb,
        min(played_at) first_hand_at, max(played_at) last_hand_at
      FROM filtered
    ), analysis_sample AS (
      SELECT count(*)::integer hands FROM scored
    ), daily AS (
      SELECT date(played_at AT TIME ZONE v_tz) d, count(*)::integer hands,
             round(sum(net), 2) profit
      FROM filtered WHERE tournament_id IS NULL GROUP BY 1 ORDER BY 1
    ), positions AS (
      SELECT position, count(*)::integer hands_played,
        count(*) FILTER (WHERE vpip)::integer vpip_count,
        count(*) FILTER (WHERE pfr)::integer pfr_count,
        count(*) FILTER (WHERE three_bet AND three_bet_opportunity)::integer three_bet_count,
        count(*) FILTER (WHERE three_bet_opportunity)::integer three_bet_opps,
        count(*) FILTER (WHERE returned > 0)::integer hands_won,
        round(coalesce(sum(net) FILTER (WHERE tournament_id IS NULL), 0), 2) total_profit,
        round(coalesce(sum(net_bb) FILTER (WHERE tournament_id IS NULL), 0)
          / nullif(count(*) FILTER (WHERE tournament_id IS NULL), 0) * 100, 2) bb100
      FROM filtered GROUP BY position
    ), variants AS (
      SELECT game_variant, count(*)::integer hands,
        count(*) FILTER (WHERE returned > 0)::integer hands_won,
        round(coalesce(sum(net) FILTER (WHERE tournament_id IS NULL), 0), 2) profit,
        round(coalesce(sum(net_bb) FILTER (WHERE tournament_id IS NULL), 0)
          / nullif(count(*) FILTER (WHERE tournament_id IS NULL), 0) * 100, 2) bb100
      FROM filtered GROUP BY game_variant
    ), stakes AS (
      SELECT big_blind, count(*)::integer hands,
        count(*) FILTER (WHERE returned > 0)::integer hands_won,
        round(sum(net), 2) profit,
        round(sum(net_bb) / nullif(count(*), 0) * 100, 2) bb100
      FROM filtered WHERE tournament_id IS NULL AND big_blind > 0 GROUP BY big_blind
    ), tournament_rows AS (
      SELECT tp.*, t.name, t.start_time, t.ended_at, t.variant, t.buy_in_amount, t.buy_in_fee,
             t.rebuy_cost, t.addon_cost, t.is_mystery_bounty
      FROM public.tournament_players tp
      JOIN public.tournaments t ON t.id = tp.tournament_id
      WHERE tp.user_id = p_user AND coalesce(tp.club_id,t.club_id) = p_club_id
        AND upper(coalesce(t.status, '')) = 'COMPLETED'
        AND t.ended_at IS NOT NULL
        AND (v_from IS NULL OR t.ended_at >= v_from)
        AND (v_to IS NULL OR t.ended_at < v_to)
    ), tournament_totals AS (
      SELECT count(*)::integer entries,
        count(*) FILTER (WHERE coalesce(prize, 0) > 0)::integer cashes,
        count(*) FILTER (WHERE position = 1 OR status = 'winner')::integer wins,
        min(position) FILTER (WHERE position IS NOT NULL) best_finish,
        coalesce(sum(coalesce(buy_in_amount, 0) + coalesce(buy_in_fee, 0)
          + coalesce(rebuys, 0) * coalesce(rebuy_cost, 0)
          + CASE WHEN add_on THEN coalesce(addon_cost, 0) ELSE 0 END), 0) total_buyins,
        coalesce(sum(coalesce(prize, 0)), 0) total_prizes,
        coalesce(sum(coalesce(bounty_winnings, 0)), 0) total_bounty_winnings,
        coalesce(sum(coalesce(bounties_collected, 0)), 0)::integer total_bounties
      FROM tournament_rows
    )
    SELECT jsonb_build_object(
      'contract_version', 2, 'generated_at', now(), 'window_days', v_days, 'window_tz', v_tz,
      'scope', jsonb_build_object('target_user_id', p_user, 'club_id', p_club_id,
        'asset', p_asset, 'range_days', v_days, 'range_tz', v_tz, 'visibility', 'owner'),
      'quality', jsonb_build_object('cash_money_source', 'exact_settlement',
        'cash_money_exact', true, 'exact_cash_hands', (SELECT cash_hands FROM totals),
        'advanced_facts_source', 'ca_hand_facts',
        'historical_club_breakdown_available', false,
        'club_breakdown_available', true, 'club_breakdown_source', 'ca_hand_facts',
        'club_breakdown_starts_at', (SELECT first_at FROM coverage_totals), 'live_tail_included', true,
        'section_availability', jsonb_build_object(
          'sessions', false,
          'sessions_reason', 'not_captured_in_ca_hand_facts'
        ),
        'recorded_hand_coverage', (SELECT m->'recorded_coverage' FROM recorded_coverage), 'metric_availability', (SELECT jsonb_build_object(
          'three_bet_percent', recorded_three_bet_opportunities > 0,
          'three_bet_numerator', three_bet_hands,
          'three_bet_opportunities', recorded_three_bet_opportunities,
          'fold_to_three_bet', faced_three_bet_hands > 0,
          'fold_to_three_bet_opportunities', faced_three_bet_hands,
          'cbet_flop', cbet_opps > 0,
          'cbet_flop_opportunities', cbet_opps,
          'aggression_factor', (SELECT (m#>>'{metric_availability,aggression_factor}')::boolean FROM recorded_coverage),
          'aggression_factor_denominator', (SELECT (m#>>'{metric_availability,aggression_factor_denominator}')::numeric FROM recorded_coverage),
          'wtsd', saw_flop_hands > 0,
          'wtsd_opportunities', saw_flop_hands,
          'cash_hours_played', (SELECT (m#>>'{metric_availability,cash_hours_played}')::boolean FROM recorded_coverage),'hours_played', (SELECT (m#>>'{metric_availability,hours_played}')::boolean FROM recorded_coverage)
        ) FROM totals)),
      'coverage', jsonb_build_object('analysis_hand_cap', c_analysis_cap,
        'analysis_sample_hands', (SELECT hands FROM analysis_sample),
        'analysis_sampled_sections',jsonb_build_array(),'analysis_hands_capped', (SELECT hands FROM totals) > c_analysis_cap,
        'lifetime_index_complete', true, 'first_hand_at', (SELECT first_at FROM coverage_totals), 'last_hand_at', (SELECT last_at FROM coverage_totals),
        'rollup_covered_through', (SELECT last_at FROM coverage_totals), 'rollup_updated_at', now()),
      'lifetime', jsonb_build_object('hands', (SELECT total FROM coverage_totals), 'first_hand_at', (SELECT first_at FROM coverage_totals),
        'last_hand_at', (SELECT last_at FROM coverage_totals), 'indexed_complete', true),
      'overall', (SELECT jsonb_build_object(
        'total_hands', hands, 'cash_hands', cash_hands, 'exact_cash_hands', cash_hands,
        'tourney_hands', tourney_hands, 'tournaments_with_hands', tournaments_with_hands,
        'hands_won', hands_won, 'hands_lost', hands - hands_won,
        'vpip', coalesce(round(vpip_hands::numeric / nullif(hands, 0), 4), 0),
        'pfr', coalesce(round(pfr_hands::numeric / nullif(hands, 0), 4), 0),
        -- ca_hand_facts does not retain the three-bet-opportunity flag. A
        -- per-hand denominator would manufacture a tracker statistic, so the
        -- compatible numeric field is zero and quality.metric_availability
        -- says it was not measured.
        'three_bet_percent', coalesce(round(three_bet_hands::numeric / nullif(recorded_three_bet_opportunities,0),4),0),
        'fold_to_three_bet', coalesce(round(folded_to_three_bet_hands::numeric / nullif(faced_three_bet_hands, 0), 4), 0),
        'cbet_flop', coalesce(round(cbet_hands::numeric / nullif(cbet_opps, 0), 4), 0),
        -- An action count is not a ratio. Zero passive actions means AF is
        -- unmeasured/infinite; keep the legacy numeric shape at zero and make
        -- availability explicit in quality.metric_availability.
        'aggression_factor', (SELECT (m->>'aggression_factor')::numeric FROM recorded_coverage),
        'aggression_factor_basis', (SELECT m->>'aggression_factor_basis' FROM recorded_coverage),
        'showdowns_total', showdowns, 'showdowns_won', showdowns_won,
        'wtsd', coalesce(round(showdowns::numeric / nullif(saw_flop_hands, 0), 4), 0),
        'total_profit', round(cash_profit, 2), 'total_winnings', round(cash_won, 2),
        'total_invested', round(cash_invested, 2), 'biggest_pot_won', round(biggest_pot, 2),
        'biggest_hand_loss', round(biggest_loss, 2),
        'bb_per_100', coalesce(round(cash_net_bb / nullif(cash_hands, 0) * 100, 2), 0),
        'cash_hours_played', (SELECT (m->>'cash_hours_played')::numeric FROM recorded_coverage),'hours_played', (SELECT (m->>'hours_played')::numeric FROM recorded_coverage), 'hand_cap', c_analysis_cap, 'hands_capped', false,
        'first_hand_at', first_hand_at, 'last_hand_at', last_hand_at) FROM totals),
      'daily', coalesce((SELECT jsonb_agg(jsonb_build_object('date', d, 'hands', hands, 'profit', profit) ORDER BY d) FROM daily), '[]'::jsonb),
      'sessions', '[]'::jsonb,
      'positions', coalesce((SELECT jsonb_agg(jsonb_build_object('position', position,
        'hands_played', hands_played, 'vpip_count', vpip_count, 'pfr_count', pfr_count,
        'three_bet_count', three_bet_count, 'three_bet_opps', three_bet_opps, 'hands_won', hands_won,
        'total_profit', total_profit, 'bb100', coalesce(bb100, 0))) FROM positions), '[]'::jsonb),
      'variants', coalesce((SELECT jsonb_agg(jsonb_build_object('variant', game_variant,
        'hands', hands, 'hands_won', hands_won, 'profit', profit, 'bb100', coalesce(bb100, 0))) FROM variants), '[]'::jsonb),
      'stakes', coalesce((SELECT jsonb_agg(jsonb_build_object('big_blind', big_blind,
        'hands', hands, 'hands_won', hands_won, 'profit', profit, 'bb100', bb100)) FROM stakes), '[]'::jsonb),
      'tournaments', (SELECT jsonb_build_object('entries', entries, 'cashes', cashes,
        'wins', wins, 'best_finish', best_finish,
        'itm_percent', coalesce(round(cashes::numeric / nullif(entries, 0), 4), 0),
        'total_buyins', round(total_buyins, 2),
        'total_winnings', round(total_prizes + total_bounty_winnings, 2),
        'total_prizes', round(total_prizes, 2),
        'total_bounty_winnings', round(total_bounty_winnings, 2),
        'total_bounties', total_bounties,
        'net_profit', round(total_prizes + total_bounty_winnings - total_buyins, 2),
        'roi', coalesce(round((total_prizes + total_bounty_winnings - total_buyins) / nullif(total_buyins, 0), 4), 0)) FROM tournament_totals),
      'recent_tournaments', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'tournament_id', tournament_id, 'name', name, 'start_time', start_time,
        'ended_at', ended_at,
        'variant', variant, 'is_mystery_bounty', coalesce(is_mystery_bounty, false),
        'finish_rank', position, 'status', status, 'prize', coalesce(prize, 0),
        'bounty_winnings', coalesce(bounty_winnings, 0),
        'bounties', coalesce(bounties_collected, 0),
        'total_won', coalesce(prize, 0) + coalesce(bounty_winnings, 0),
        'buyin', coalesce(buy_in_amount, 0) + coalesce(buy_in_fee, 0)
          + coalesce(rebuys, 0) * coalesce(rebuy_cost, 0)
          + CASE WHEN add_on THEN coalesce(addon_cost, 0) ELSE 0 END)
        ORDER BY ended_at DESC) FROM (SELECT * FROM tournament_rows ORDER BY ended_at DESC LIMIT 25) recent), '[]'::jsonb)
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.ca_player_stats_pulse_by_club(p_user uuid, p_asset text DEFAULT 'chips'::text, p_club_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_hand timestamptz; v_tourn text;
BEGIN
  -- funded_stats_scope: historical funding, original caller gates.
  PERFORM public.ca_assert_player_stats_club(p_user,p_club_id,p_asset);
  SELECT played_at INTO v_hand FROM (
 WITH receipts AS MATERIALIZED (
  SELECT DISTINCT ON(a.table_id,a.account_entity_id,a.seat_joined_at)
   a.table_id,a.account_entity_id,a.seat_joined_at,a.funding_club_id
  FROM (
   SELECT table_id,account_entity_id,seat_joined_at,funding_club_id,recorded_at AS seq_at,id AS seq_id
   FROM public.cash_participant_funding_receipts
   WHERE account_entity_id=p_user AND operation_kind='buyin'
   UNION ALL
   SELECT to_table_id AS table_id,player_id AS account_entity_id,created_at AS seat_joined_at,club_id AS funding_club_id,created_at AS seq_at,move_id AS seq_id
   FROM public.cash_seat_move_receipts
   WHERE player_id=p_user
  ) a
  ORDER BY a.table_id,a.account_entity_id,a.seat_joined_at,a.seq_at DESC,a.seq_id DESC
 ), funding AS MATERIALIZED (
  SELECT *,lead(seat_joined_at) OVER(PARTITION BY table_id,account_entity_id ORDER BY seat_joined_at) until_at
  FROM receipts
 )
 SELECT fact.*,coalesce(x.funding_club_id,tp.club_id,ra.club_id,fact.club_id) funded_club
 FROM public.ca_hand_facts fact
 LEFT JOIN funding x ON fact.tournament_id IS NULL AND x.table_id=fact.table_id
  AND fact.played_at>=x.seat_joined_at AND (x.until_at IS NULL OR fact.played_at<x.until_at)
 LEFT JOIN public.tournament_players tp ON tp.tournament_id=fact.tournament_id AND tp.user_id=fact.user_id
 LEFT JOIN public.rake_attributions ra ON x.funding_club_id IS NULL AND tp.club_id IS NULL
  AND ra.hand_id=fact.hand_id AND ra.player_id=fact.user_id
 WHERE fact.user_id=p_user
 ) funded_stats_scope
    WHERE user_id=p_user AND funded_club=p_club_id ORDER BY played_at DESC LIMIT 1;
  SELECT md5(coalesce(string_agg(tp.id::text||':'||coalesce(tp.status,'')||':'||
    coalesce(tp.position::text,'')||':'||coalesce(tp.prize::text,'')||':'||
    coalesce(tp.bounty_winnings::text,''),'|' ORDER BY tp.id),'')) INTO v_tourn
  FROM public.tournament_players tp JOIN public.tournaments t ON t.id=tp.tournament_id
  WHERE tp.user_id=p_user AND coalesce(tp.club_id,t.club_id)=p_club_id;
  RETURN jsonb_build_object('contract_version',2,
    'scope',jsonb_build_object('target_user_id',p_user,'club_id',p_club_id,'asset',p_asset,'visibility','owner'),
    'newest_hand_at',v_hand,'tournaments',v_tourn,
    'pulse',coalesce(v_hand::text,'')||'#'||coalesce(v_tourn,''));
END;$function$;

CREATE OR REPLACE FUNCTION public.ca_player_stats_shared_overview_v1(p_target_user uuid, p_club_id uuid, p_days integer DEFAULT NULL::integer, p_tz text DEFAULT 'UTC'::text, p_asset text DEFAULT 'chips'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '20s'
 SET work_mem TO '64MB'
 SET enable_indexscan TO 'off'
 SET search_path TO 'public'
AS $function$
DECLARE v_viewer uuid:=auth.uid(); v_days integer; v_tz text; v_from timestamptz; v_to timestamptz;
BEGIN
  -- funded_stats_scope: historical funding, original caller gates.
  IF v_viewer IS NULL OR p_target_user IS NULL OR v_viewer=p_target_user OR p_club_id IS NULL THEN
    RAISE EXCEPTION 'shared player stats require viewer, target and club' USING ERRCODE='42501';
  END IF;
  IF p_asset NOT IN ('chips','diamonds') THEN RAISE EXCEPTION 'unknown stats asset' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clubs c
    JOIN public.club_members vm ON vm.club_id=c.id AND vm.user_id=v_viewer AND vm.status IN ('active','approved')
    JOIN public.club_members tm ON tm.club_id=c.id AND tm.user_id=p_target_user AND tm.status IN ('active','approved')
    WHERE c.id=p_club_id AND coalesce(c.lifecycle_status,'active')<>'retired' AND coalesce(c.asset,'chips')=p_asset)
  THEN RAISE EXCEPTION 'not authorized for shared player stats club' USING ERRCODE='42501'; END IF;
  SELECT b.range_days,b.range_tz,b.from_at,b.to_at INTO v_days,v_tz,v_from,v_to
    FROM public.ca_stats_calendar_bounds(p_days,p_tz) b;
  RETURN (WITH facts AS (
    SELECT * FROM (
 WITH receipts AS MATERIALIZED (
  SELECT DISTINCT ON(a.table_id,a.account_entity_id,a.seat_joined_at)
   a.table_id,a.account_entity_id,a.seat_joined_at,a.funding_club_id
  FROM (
   SELECT table_id,account_entity_id,seat_joined_at,funding_club_id,recorded_at AS seq_at,id AS seq_id
   FROM public.cash_participant_funding_receipts
   WHERE account_entity_id=p_target_user AND operation_kind='buyin'
   UNION ALL
   SELECT to_table_id AS table_id,player_id AS account_entity_id,created_at AS seat_joined_at,club_id AS funding_club_id,created_at AS seq_at,move_id AS seq_id
   FROM public.cash_seat_move_receipts
   WHERE player_id=p_target_user
  ) a
  ORDER BY a.table_id,a.account_entity_id,a.seat_joined_at,a.seq_at DESC,a.seq_id DESC
 ), funding AS MATERIALIZED (
  SELECT *,lead(seat_joined_at) OVER(PARTITION BY table_id,account_entity_id ORDER BY seat_joined_at) until_at
  FROM receipts
 )
 SELECT fact.*,coalesce(x.funding_club_id,tp.club_id,ra.club_id,fact.club_id) funded_club
 FROM public.ca_hand_facts fact
 LEFT JOIN funding x ON fact.tournament_id IS NULL AND x.table_id=fact.table_id
  AND fact.played_at>=x.seat_joined_at AND (x.until_at IS NULL OR fact.played_at<x.until_at)
 LEFT JOIN public.tournament_players tp ON tp.tournament_id=fact.tournament_id AND tp.user_id=fact.user_id
 LEFT JOIN public.rake_attributions ra ON x.funding_club_id IS NULL AND tp.club_id IS NULL
  AND ra.hand_id=fact.hand_id AND ra.player_id=fact.user_id
 WHERE fact.user_id=p_target_user
 ) f WHERE f.user_id=p_target_user AND f.funded_club=p_club_id
      AND (v_from IS NULL OR f.played_at>=v_from) AND (v_to IS NULL OR f.played_at<v_to)
  ), a AS (SELECT count(*)::integer hands,count(*) FILTER(WHERE tournament_id IS NULL)::integer cash_hands,
      count(*) FILTER(WHERE tournament_id IS NOT NULL)::integer tournament_hands,
      count(*) FILTER(WHERE returned>0)::integer hands_won,count(*) FILTER(WHERE vpip)::integer vpip_hands,
      count(*) FILTER(WHERE pfr)::integer pfr_hands,coalesce(sum(net_bb) FILTER(WHERE tournament_id IS NULL),0) net_bb,
      max(played_at) last_played_at FROM facts), tr AS (
    SELECT count(*)::integer entries,count(*) FILTER(WHERE coalesce(tp.prize,0)>0)::integer cashes,
      count(*) FILTER(WHERE tp.position=1 OR tp.status='winner')::integer wins
    FROM public.tournament_players tp JOIN public.tournaments t ON t.id=tp.tournament_id
    WHERE tp.user_id=p_target_user AND coalesce(tp.club_id,t.club_id)=p_club_id AND upper(coalesce(t.status,''))='COMPLETED'
      AND t.ended_at IS NOT NULL AND (v_from IS NULL OR t.ended_at>=v_from) AND (v_to IS NULL OR t.ended_at<v_to)
  ) SELECT jsonb_build_object('contract_version',2,'scope',jsonb_build_object('viewer_user_id',v_viewer,
      'target_user_id',p_target_user,'club_id',p_club_id,'asset',p_asset,'range_days',v_days,
      'range_tz',v_tz,'visibility','shared_club'),
    'overview',(SELECT jsonb_build_object('hands',hands,'cash_hands',cash_hands,'tournament_hands',tournament_hands,
      'hands_won',hands_won,'vpip',coalesce(round(vpip_hands::numeric/nullif(hands,0),4),0),
      'pfr',coalesce(round(pfr_hands::numeric/nullif(hands,0),4),0),
      'bb_per_100',coalesce(round(net_bb/nullif(cash_hands,0)*100,2),0),'last_played_at',last_played_at) FROM a),
    'tournaments',(SELECT to_jsonb(tr) FROM tr),'generated_at',now()));
END;$function$;

CREATE OR REPLACE FUNCTION public.ca_player_stats_shared_separated(p_target_user uuid, p_club_id uuid, p_days integer DEFAULT NULL::integer, p_tz text DEFAULT 'UTC'::text, p_asset text DEFAULT 'chips'::text, p_game_mode text DEFAULT 'cash'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '20s'
 SET work_mem TO '64MB'
 SET enable_indexscan TO 'off'
 SET search_path TO 'public'
AS $function$
DECLARE v_viewer uuid:=auth.uid(); v_days integer; v_tz text; v_from timestamptz; v_to timestamptz;
BEGIN
  IF p_game_mode IS NULL OR p_game_mode NOT IN ('cash','tournament') THEN
    RAISE EXCEPTION 'invalid stats game mode' USING ERRCODE='22023';
  END IF;
  -- funded_stats_scope: historical funding, original caller gates.
  IF v_viewer IS NULL OR p_target_user IS NULL OR v_viewer=p_target_user OR p_club_id IS NULL THEN
    RAISE EXCEPTION 'shared player stats require viewer, target and club' USING ERRCODE='42501';
  END IF;
  IF p_asset NOT IN ('chips','diamonds') THEN RAISE EXCEPTION 'unknown stats asset' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clubs c
    JOIN public.club_members vm ON vm.club_id=c.id AND vm.user_id=v_viewer AND vm.status IN ('active','approved')
    JOIN public.club_members tm ON tm.club_id=c.id AND tm.user_id=p_target_user AND tm.status IN ('active','approved')
    WHERE c.id=p_club_id AND coalesce(c.lifecycle_status,'active')<>'retired' AND coalesce(c.asset,'chips')=p_asset)
  THEN RAISE EXCEPTION 'not authorized for shared player stats club' USING ERRCODE='42501'; END IF;
  SELECT b.range_days,b.range_tz,b.from_at,b.to_at INTO v_days,v_tz,v_from,v_to
    FROM public.ca_stats_calendar_bounds(p_days,p_tz) b;
  RETURN (WITH facts AS (
    SELECT * FROM (
 WITH receipts AS MATERIALIZED (
  SELECT DISTINCT ON(a.table_id,a.account_entity_id,a.seat_joined_at)
   a.table_id,a.account_entity_id,a.seat_joined_at,a.funding_club_id
  FROM (
   SELECT table_id,account_entity_id,seat_joined_at,funding_club_id,recorded_at AS seq_at,id AS seq_id
   FROM public.cash_participant_funding_receipts
   WHERE account_entity_id=p_target_user AND operation_kind='buyin'
   UNION ALL
   SELECT to_table_id AS table_id,player_id AS account_entity_id,created_at AS seat_joined_at,club_id AS funding_club_id,created_at AS seq_at,move_id AS seq_id
   FROM public.cash_seat_move_receipts
   WHERE player_id=p_target_user
  ) a
  ORDER BY a.table_id,a.account_entity_id,a.seat_joined_at,a.seq_at DESC,a.seq_id DESC
 ), funding AS MATERIALIZED (
  SELECT *,lead(seat_joined_at) OVER(PARTITION BY table_id,account_entity_id ORDER BY seat_joined_at) until_at
  FROM receipts
 )
 SELECT fact.*,coalesce(x.funding_club_id,tp.club_id,ra.club_id,fact.club_id) funded_club
 FROM public.ca_hand_facts fact
 LEFT JOIN funding x ON fact.tournament_id IS NULL AND x.table_id=fact.table_id
  AND fact.played_at>=x.seat_joined_at AND (x.until_at IS NULL OR fact.played_at<x.until_at)
 LEFT JOIN public.tournament_players tp ON tp.tournament_id=fact.tournament_id AND tp.user_id=fact.user_id
 LEFT JOIN public.rake_attributions ra ON x.funding_club_id IS NULL AND tp.club_id IS NULL
  AND ra.hand_id=fact.hand_id AND ra.player_id=fact.user_id
 WHERE fact.user_id=p_target_user AND (fact.tournament_id IS NULL)=(p_game_mode='cash')
 ) f WHERE f.user_id=p_target_user AND f.funded_club=p_club_id
      AND (v_from IS NULL OR f.played_at>=v_from) AND (v_to IS NULL OR f.played_at<v_to)
  ), a AS (SELECT count(*)::integer hands,count(*) FILTER(WHERE tournament_id IS NULL)::integer cash_hands,
      count(*) FILTER(WHERE tournament_id IS NOT NULL)::integer tournament_hands,
      count(*) FILTER(WHERE returned>0)::integer hands_won,count(*) FILTER(WHERE vpip)::integer vpip_hands,
      count(*) FILTER(WHERE pfr)::integer pfr_hands,coalesce(sum(net_bb) FILTER(WHERE tournament_id IS NULL),0) net_bb,
      max(played_at) last_played_at FROM facts), tr AS (
    SELECT count(*)::integer entries,count(*) FILTER(WHERE coalesce(tp.prize,0)>0)::integer cashes,
      count(*) FILTER(WHERE tp.position=1 OR tp.status='winner')::integer wins
    FROM public.tournament_players tp JOIN public.tournaments t ON t.id=tp.tournament_id
    WHERE p_game_mode='tournament' AND tp.user_id=p_target_user AND coalesce(tp.club_id,t.club_id)=p_club_id AND upper(coalesce(t.status,''))='COMPLETED'
      AND t.ended_at IS NOT NULL AND (v_from IS NULL OR t.ended_at>=v_from) AND (v_to IS NULL OR t.ended_at<v_to)
  ) SELECT jsonb_build_object('contract_version',2,'scope',jsonb_build_object('viewer_user_id',v_viewer,
      'target_user_id',p_target_user,'club_id',p_club_id,'asset',p_asset,'game_mode',p_game_mode,'range_days',v_days,
      'range_tz',v_tz,'visibility','shared_club'),
    'overview',(SELECT jsonb_build_object('hands',hands,'cash_hands',cash_hands,'tournament_hands',tournament_hands,
      'hands_won',hands_won,'vpip',coalesce(round(vpip_hands::numeric/nullif(hands,0),4),0),
      'pfr',coalesce(round(pfr_hands::numeric/nullif(hands,0),4),0),
      'bb_per_100',coalesce(round(net_bb/nullif(cash_hands,0)*100,2),0),'last_played_at',last_played_at) FROM a),
    'tournaments',(SELECT to_jsonb(tr) FROM tr),'generated_at',now()));
END;$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_club_data_fact_seed(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_live timestamptz := public.fn_ca_club_data_fact_live_from();
  v_to timestamptz := LEAST(p_to, v_live);
  v_rows bigint := 0;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR v_to <= p_from THEN
    RAISE EXCEPTION 'seed needs a window that ends after it starts and before live_from (%)', v_live;
  END IF;
  IF now() < v_live + interval '1 minute' THEN
    RAISE EXCEPTION 'seed waits until a minute after live_from (%), so every row before it has committed', v_live;
  END IF;
  IF v_to - p_from > interval '1 day' THEN
    RAISE EXCEPTION 'seed one day or less at a time';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ca_club_data_fact_seed_log l
              WHERE l.from_at < v_to AND l.to_at > p_from) THEN
    RAISE EXCEPTION 'this window overlaps one already seeded';
  END IF;

  WITH cash_c AS (
    SELECT r.id, r.table_id, r.rake_amount, r.created_at, t.union_id, t.club_id AS table_club,
           e.key::uuid AS uid, (CASE WHEN e.value ~ '^[0-9]+(\.[0-9]+)?$' THEN e.value::numeric ELSE 0 END) AS contrib
      FROM public.rake_records r
      JOIN public.tables t ON t.id = r.table_id AND t.tournament_id IS NULL
      CROSS JOIN LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(r.player_contributions) = 'object'
                                              THEN r.player_contributions ELSE '{}'::jsonb END) e
     WHERE r.created_at >= p_from AND r.created_at < v_to
       AND r.rake_amount > 0 AND r.tournament_id IS NULL AND NOT COALESCE(r.is_tournament, false)
       AND e.key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       AND (CASE WHEN e.value ~ '^[0-9]+(\.[0-9]+)?$' THEN e.value::numeric ELSE 0 END) > 0
  ), cash_s AS (
    SELECT c.*, SUM(c.contrib) OVER (PARTITION BY c.id) AS tot FROM cash_c c
  ), cash_rake AS (
    SELECT COALESCE(ra.club_id, rc.club, st.club,
                    public.fn_ca_cash_reporting_club(s.union_id, s.table_club, s.uid)) AS club_id,
           (s.created_at AT TIME ZONE 'UTC')::date AS stat_date, 'CASH'::text AS kind,
           s.table_id AS game_id, s.uid AS user_id,
           s.rake_amount * s.contrib / s.tot AS fee, 0::numeric AS buyins, 0::numeric AS cashouts,
           0::numeric AS winnings, s.created_at AS at
      FROM cash_s s
      LEFT JOIN public.rake_attributions ra ON ra.rake_record_id = s.id AND ra.player_id = s.uid
      LEFT JOIN LATERAL (
        SELECT a.club_id AS club FROM (
          (SELECT x.funding_club_id AS club_id, x.seat_joined_at AS arrived_at, x.recorded_at AS seq_at, x.id AS seq_id
             FROM public.cash_participant_funding_receipts x
            WHERE ra.club_id IS NULL AND x.operation_kind = 'buyin' AND x.table_id = s.table_id
              AND x.account_entity_id = s.uid AND x.seat_joined_at <= s.created_at
            ORDER BY x.seat_joined_at DESC, x.recorded_at DESC, x.id DESC LIMIT 1)
          UNION ALL
          (SELECT m.club_id, m.created_at AS arrived_at, m.created_at AS seq_at, m.move_id AS seq_id
             FROM public.cash_seat_move_receipts m
            WHERE ra.club_id IS NULL AND m.to_table_id = s.table_id AND m.player_id = s.uid
              AND m.created_at <= s.created_at
            ORDER BY m.created_at DESC, m.move_id DESC LIMIT 1)
        ) a ORDER BY a.arrived_at DESC, a.seq_at DESC, a.seq_id DESC LIMIT 1) rc ON true
      LEFT JOIN LATERAL (
        SELECT ts.club_id AS club FROM public.table_seats ts
         WHERE ra.club_id IS NULL AND rc.club IS NULL AND ts.table_id = s.table_id
           AND ts.user_id = s.uid AND ts.club_id IS NOT NULL AND ts.joined_at <= s.created_at
         ORDER BY ts.joined_at DESC LIMIT 1) st ON true
  ), cash_unnamed AS (
    SELECT t.club_id, (r.created_at AT TIME ZONE 'UTC')::date, 'CASH'::text, r.table_id,
           '00000000-0000-0000-0000-000000000000'::uuid, r.rake_amount, 0::numeric, 0::numeric,
           0::numeric, r.created_at
      FROM public.rake_records r
      JOIN public.tables t ON t.id = r.table_id AND t.tournament_id IS NULL
     WHERE r.created_at >= p_from AND r.created_at < v_to
       AND r.rake_amount > 0 AND r.tournament_id IS NULL AND NOT COALESCE(r.is_tournament, false)
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_each_text(CASE WHEN jsonb_typeof(r.player_contributions) = 'object'
                                            THEN r.player_contributions ELSE '{}'::jsonb END) e
          WHERE e.key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            AND (CASE WHEN e.value ~ '^[0-9]+(\.[0-9]+)?$' THEN e.value::numeric ELSE 0 END) > 0)
  ), tour_named AS (
    SELECT COALESCE(tp.club_id, public.fn_ca_cash_reporting_club(tr.union_id, tr.club_id, (r.metadata->>'user_id')::uuid)),
           (r.created_at AT TIME ZONE 'UTC')::date, 'TOURNAMENT'::text, r.tournament_id,
           (r.metadata->>'user_id')::uuid, r.rake_amount, 0::numeric, 0::numeric, 0::numeric, r.created_at
      FROM public.rake_records r
      LEFT JOIN public.tournaments tr ON tr.id = r.tournament_id
      LEFT JOIN public.tournament_players tp
        ON tp.tournament_id = r.tournament_id AND tp.user_id::text = r.metadata->>'user_id'
     WHERE r.created_at >= p_from AND r.created_at < v_to AND r.is_tournament
       AND r.tournament_id IS NOT NULL AND r.rake_amount <> 0
       AND (r.metadata->>'user_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ), tour_split AS (
    SELECT COALESCE(tp.club_id, public.fn_ca_cash_reporting_club(tr.union_id, tr.club_id, tp.user_id)),
           (r.created_at AT TIME ZONE 'UTC')::date, 'TOURNAMENT'::text, r.tournament_id,
           tp.user_id, r.rake_amount / n.n, 0::numeric, 0::numeric, 0::numeric, r.created_at
      FROM public.rake_records r
      LEFT JOIN public.tournaments tr ON tr.id = r.tournament_id
      JOIN LATERAL (SELECT count(*)::numeric AS n FROM public.tournament_players x
                     WHERE x.tournament_id = r.tournament_id) n ON n.n > 0
      JOIN public.tournament_players tp ON tp.tournament_id = r.tournament_id
     WHERE r.created_at >= p_from AND r.created_at < v_to AND r.is_tournament
       AND r.tournament_id IS NOT NULL AND r.rake_amount <> 0
       AND NOT ((r.metadata->>'user_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
         IS TRUE
  ), wal AS (
    SELECT w.id, w.user_id, w.amount, w.type, w.created_at, w.table_id, w.related_entity_id,
           CASE WHEN w.table_id IS NOT NULL THEN 'CASH' ELSE 'TOURNAMENT' END AS kind
      FROM public.wallet_transactions w
     WHERE w.created_at >= p_from AND w.created_at < v_to
       AND ((w.table_id IS NOT NULL AND w.category IN ('buyin', 'cashout', 'addon', 'rebuy', 'refund'))
         OR (w.table_id IS NULL AND w.related_entity_id IS NOT NULL
             AND w.category IN ('tournament_buyin', 'prize', 'bounty', 'addon', 'rebuy', 'refund', 'prize_reversal')))
  ), wal_cash AS (
    SELECT COALESCE(public.fn_ca_ledger_leg_club(w.user_id, w.amount, w.type, w.created_at, w.table_id),
                    rc.club,
                    public.fn_ca_cash_reporting_club(t.union_id, t.club_id, w.user_id)),
           (w.created_at AT TIME ZONE 'UTC')::date, 'CASH'::text, w.table_id, w.user_id, 0::numeric,
           CASE WHEN w.type = 'debit' THEN w.amount ELSE 0 END,
           CASE WHEN w.type = 'credit' THEN w.amount ELSE 0 END,
           CASE WHEN w.type = 'credit' THEN w.amount WHEN w.type = 'debit' THEN -w.amount ELSE 0 END,
           w.created_at
      FROM wal w
      JOIN public.tables t ON t.id = w.table_id AND t.tournament_id IS NULL
      LEFT JOIN LATERAL (
        SELECT a.club_id AS club FROM (
          (SELECT x.funding_club_id AS club_id, x.seat_joined_at AS arrived_at, x.recorded_at AS seq_at, x.id AS seq_id
             FROM public.cash_participant_funding_receipts x
            WHERE x.operation_kind = 'buyin' AND x.table_id = w.table_id
              AND x.account_entity_id = w.user_id AND x.seat_joined_at <= w.created_at
            ORDER BY x.seat_joined_at DESC, x.recorded_at DESC, x.id DESC LIMIT 1)
          UNION ALL
          (SELECT m.club_id, m.created_at AS arrived_at, m.created_at AS seq_at, m.move_id AS seq_id
             FROM public.cash_seat_move_receipts m
            WHERE m.to_table_id = w.table_id AND m.player_id = w.user_id
              AND m.created_at <= w.created_at
            ORDER BY m.created_at DESC, m.move_id DESC LIMIT 1)
        ) a ORDER BY a.arrived_at DESC, a.seq_at DESC, a.seq_id DESC LIMIT 1) rc ON true
     WHERE w.kind = 'CASH'
  ), wal_tour AS (
    SELECT COALESCE(tp.club_id,
                    public.fn_ca_ledger_leg_club(w.user_id, w.amount, w.type, w.created_at, NULL),
                    public.fn_ca_cash_reporting_club(tr.union_id, tr.club_id, w.user_id)),
           (w.created_at AT TIME ZONE 'UTC')::date, 'TOURNAMENT'::text, w.related_entity_id, w.user_id,
           0::numeric,
           CASE WHEN w.type = 'debit' THEN w.amount ELSE 0 END,
           CASE WHEN w.type = 'credit' THEN w.amount ELSE 0 END,
           CASE WHEN w.type = 'credit' THEN w.amount WHEN w.type = 'debit' THEN -w.amount ELSE 0 END,
           w.created_at
      FROM wal w
      JOIN public.tournaments tr ON tr.id = w.related_entity_id
      LEFT JOIN public.tournament_players tp
        ON tp.tournament_id = w.related_entity_id AND tp.user_id = w.user_id
     WHERE w.kind = 'TOURNAMENT'
  ), all_facts (club_id, stat_date, kind, game_id, user_id, fee, buyins, cashouts, winnings, at) AS (
    SELECT * FROM cash_rake
    UNION ALL SELECT * FROM cash_unnamed
    UNION ALL SELECT * FROM tour_named
    UNION ALL SELECT * FROM tour_split
    UNION ALL SELECT * FROM wal_cash
    UNION ALL SELECT * FROM wal_tour
  ), accepted AS (
    SELECT a.* FROM all_facts a
     WHERE a.club_id IS NOT NULL AND a.user_id IS NOT NULL
       AND public.fn_ca_launch_accounting_accepts(a.club_id, a.at) IS TRUE
  ), grouped AS (
    SELECT club_id, stat_date, min(kind) AS kind, game_id, user_id,
           SUM(fee) AS fee, SUM(buyins) AS buyins, SUM(cashouts) AS cashouts,
           SUM(winnings) AS winnings, max(at) AS last_at
      FROM accepted GROUP BY club_id, stat_date, game_id, user_id
  ), put AS (
    INSERT INTO public.ca_club_data_fact AS f
      (club_id, stat_date, kind, game_id, user_id, fee, buyins, cashouts, winnings, last_at)
    SELECT club_id, stat_date, kind, game_id, user_id, fee, buyins, cashouts, winnings, last_at FROM grouped
    ON CONFLICT (club_id, stat_date, game_id, user_id) DO UPDATE
       SET fee = f.fee + EXCLUDED.fee,
           buyins = f.buyins + EXCLUDED.buyins,
           cashouts = f.cashouts + EXCLUDED.cashouts,
           winnings = f.winnings + EXCLUDED.winnings,
           last_at = GREATEST(f.last_at, EXCLUDED.last_at)
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM put;

  INSERT INTO public.ca_club_data_fact_seed_log (from_at, to_at, rows_put) VALUES (p_from, v_to, v_rows);
  RETURN jsonb_build_object('from', p_from, 'to', v_to, 'rows', v_rows, 'live_from', v_live);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_club_rake_daily_compute(p_from timestamp with time zone, p_to timestamp with time zone, p_ids uuid[])
 RETURNS TABLE(club_id uuid, stat_date date, hands bigint, rake numeric, bbj numeric, pot numeric, source_rows bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH src AS (
    SELECT r.id, r.table_id, r.club_id, r.created_at,
           coalesce(r.rake_amount, 0) AS rake, coalesce(r.bbj_contribution, 0) AS bbj,
           coalesce(r.pot_size, 0) AS pot, r.player_contributions
      FROM rake_records r
     WHERE p_ids IS NOT NULL AND r.id = ANY (p_ids)
       AND r.club_id IS NOT NULL AND NOT coalesce(r.is_tournament, false)
       AND public.fn_ca_launch_accounting_accepts(r.club_id,r.created_at)
    UNION ALL
    SELECT r.id, r.table_id, r.club_id, r.created_at,
           coalesce(r.rake_amount, 0), coalesce(r.bbj_contribution, 0),
           coalesce(r.pot_size, 0), r.player_contributions
      FROM rake_records r
     WHERE p_ids IS NULL AND r.created_at >= p_from AND r.created_at < p_to
       AND r.club_id IS NOT NULL AND NOT coalesce(r.is_tournament, false)
       AND public.fn_ca_launch_accounting_accepts(r.club_id,r.created_at)
  ),
  tbl AS (
    SELECT s.id, s.club_id AS table_club, (s.created_at AT TIME ZONE 'UTC')::date AS day,
           s.rake, s.bbj, s.pot, s.player_contributions, t.union_id, s.table_id, s.created_at
      FROM src s
      LEFT JOIN tables t ON t.id = s.table_id
     WHERE t.id IS NULL OR t.tournament_id IS NULL
  ),
  -- Only a union table needs its contributions read: a standalone table's
  -- rake has exactly one place to go. A key that is not a uuid or a value
  -- that is not a number is ignored, never raised: a reporting rollup must
  -- not fail a ledger write. A contribution of zero still counts the hand
  -- for that player's club, as club_table_daily counts it.
  contrib AS (
    SELECT b.id, b.union_id,
           CASE WHEN e.key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                THEN e.key::uuid END AS uid,
           CASE WHEN e.value ~ '^-?[0-9]+(\.[0-9]+)?$' THEN e.value::numeric END AS contrib
      FROM tbl b
      CROSS JOIN LATERAL jsonb_each_text(
        CASE WHEN jsonb_typeof(b.player_contributions) = 'object'
             THEN b.player_contributions ELSE '{}'::jsonb END) e
     WHERE b.union_id IS NOT NULL
  ),
  attributed AS (
    SELECT c.id, c.contrib,
           -- The witness wins. Without it, use the funding or seat at the
           -- hand's time, never a later seat or buy-in at the same table.
           coalesce((SELECT ra.club_id FROM rake_attributions ra
                      WHERE ra.rake_record_id = c.id AND ra.player_id = c.uid AND ra.club_id IS NOT NULL
                      LIMIT 1),
                    (SELECT a.club_id FROM (
          (SELECT x.funding_club_id AS club_id, x.seat_joined_at AS arrived_at, x.recorded_at AS seq_at, x.id AS seq_id
             FROM public.cash_participant_funding_receipts x
            WHERE x.operation_kind = 'buyin' AND x.table_id = b.table_id
              AND x.account_entity_id = c.uid AND x.seat_joined_at <= b.created_at
            ORDER BY x.seat_joined_at DESC, x.recorded_at DESC, x.id DESC LIMIT 1)
          UNION ALL
          (SELECT m.club_id, m.created_at AS arrived_at, m.created_at AS seq_at, m.move_id AS seq_id
             FROM public.cash_seat_move_receipts m
            WHERE m.to_table_id = b.table_id AND m.player_id = c.uid
              AND m.created_at <= b.created_at
            ORDER BY m.created_at DESC, m.move_id DESC LIMIT 1)
        ) a ORDER BY a.arrived_at DESC, a.seq_at DESC, a.seq_id DESC LIMIT 1),
                    (SELECT ts.club_id FROM public.table_seats ts
                      WHERE ts.table_id = b.table_id AND ts.user_id = c.uid
                        AND ts.club_id IS NOT NULL AND ts.joined_at <= b.created_at
                      ORDER BY ts.joined_at DESC LIMIT 1),
                    (SELECT cm.club_id
                       FROM club_members cm
                       JOIN union_clubs uc ON uc.club_id = cm.club_id AND uc.union_id = c.union_id
                      WHERE cm.user_id = c.uid
                      ORDER BY cm.joined_at ASC NULLS LAST, cm.club_id
                      LIMIT 1),
                    b.table_club) AS club_id
      FROM contrib c JOIN tbl b ON b.id = c.id
     WHERE c.uid IS NOT NULL AND c.contrib IS NOT NULL AND c.contrib >= 0
  ),
  split AS (
    SELECT a.id, a.club_id, sum(a.contrib) AS contrib, count(*) AS src_rows
      FROM attributed a GROUP BY a.id, a.club_id
  ),
  split_total AS (
    SELECT s.id, sum(s.contrib) AS tot FROM split s GROUP BY s.id
  ),
  hand_rows AS (
    SELECT b.*, EXISTS (SELECT 1 FROM split_total st WHERE st.id = b.id AND st.tot > 0) AS has_split
      FROM tbl b
  ),
  parts AS (
    -- A union hand with a usable split: rake by contribution share, and one
    -- hand for every club that contributed.
    SELECT h.day, s.club_id, 1::bigint AS hands, h.rake * s.contrib / st.tot AS rake,
           0::numeric AS bbj, 0::numeric AS pot, s.src_rows
      FROM split s
      JOIN split_total st ON st.id = s.id AND st.tot > 0
      JOIN hand_rows h ON h.id = s.id
    UNION ALL
    -- The table's club: the drop and the pot volume of every hand it hosted,
    -- plus the whole hand when nothing could be attributed.
    SELECT h.day, h.table_club,
           CASE WHEN h.has_split THEN 0 ELSE 1 END,
           CASE WHEN h.has_split THEN 0 ELSE h.rake END,
           h.bbj, h.pot,
           CASE WHEN h.has_split THEN 0 ELSE 1 END
      FROM hand_rows h
  )
  SELECT p.club_id, p.day, sum(p.hands)::bigint, sum(p.rake), sum(p.bbj), sum(p.pot),
         sum(p.src_rows)::bigint
    FROM parts p
   GROUP BY p.club_id, p.day;
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_reporting_rollups_from_facts(p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_from_day date := public.fn_ca_club_data_facts_from();
  v_lo timestamptz := (p_day::timestamp AT TIME ZONE 'UTC');
  v_hi timestamptz := ((p_day + 1)::timestamp AT TIME ZONE 'UTC');
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000';
  v_tables bigint; v_players bigint; v_tournaments bigint;
BEGIN
  IF p_day IS NULL OR p_day > v_today OR v_from_day IS NULL OR p_day < v_from_day THEN
    RETURN jsonb_build_object('day', p_day, 'skipped', 'outside_club_data_facts', 'facts_from', v_from_day);
  END IF;
  IF now() < v_hi + interval '10 minutes' THEN
    PERFORM pg_advisory_xact_lock(918273645);
  END IF;

  DELETE FROM public.club_table_daily WHERE stat_date = p_day;
  DELETE FROM public.ca_club_table_player_daily WHERE stat_date = p_day;
  DELETE FROM public.ca_club_player_daily WHERE stat_date = p_day;
  DELETE FROM public.ca_club_tournament_daily WHERE stat_date = p_day;
  DELETE FROM public.ca_club_tournament_player_daily WHERE stat_date = p_day;

  WITH day_facts AS MATERIALIZED (
    SELECT f.club_id, f.game_id, f.stat_date, f.kind, f.user_id, f.fee, f.buyins, f.cashouts, f.winnings
      FROM public.ca_club_data_fact f
     WHERE f.stat_date = p_day
  ), rr AS MATERIALIZED (
    SELECT r.id, r.table_id, r.created_at, t.union_id, t.club_id AS table_club,
           CASE WHEN jsonb_typeof(r.player_contributions) = 'object' THEN r.player_contributions ELSE '{}'::jsonb END AS pc
      FROM public.rake_records r
      JOIN public.tables t ON t.id = r.table_id AND t.tournament_id IS NULL
     WHERE r.created_at >= v_lo AND r.created_at < v_hi
       AND r.rake_amount > 0 AND r.tournament_id IS NULL AND NOT COALESCE(r.is_tournament, false)
  ), contrib AS (
    SELECT rr.id, rr.table_id, rr.created_at, rr.union_id, rr.table_club, e.key::uuid AS uid
      FROM rr CROSS JOIN LATERAL jsonb_each_text(rr.pc) e
     WHERE e.key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       AND (CASE WHEN e.value ~ '^[0-9]+(\.[0-9]+)?$' THEN e.value::numeric ELSE 0 END) > 0
  ), matched_attributions AS MATERIALIZED (
    -- Only eligible contributor keys need attribution lookups; preserve all matches.
    SELECT ra.rake_record_id, ra.player_id, ra.club_id
      FROM (SELECT DISTINCT id FROM contrib) r
      JOIN public.rake_attributions ra ON ra.rake_record_id = r.id
  ), clubbed AS (
    SELECT c.id, c.table_id,
           COALESCE(ra.club_id, rc.club, st.club,
                    public.fn_ca_cash_reporting_club(c.union_id, c.table_club, c.uid)) AS club_id,
           c.created_at
      FROM contrib c
      LEFT JOIN matched_attributions ra ON ra.rake_record_id = c.id AND ra.player_id = c.uid
      LEFT JOIN LATERAL (
        SELECT a.club_id AS club FROM (
          (SELECT x.funding_club_id AS club_id, x.seat_joined_at AS arrived_at, x.recorded_at AS seq_at, x.id AS seq_id
             FROM public.cash_participant_funding_receipts x
            WHERE ra.club_id IS NULL AND x.operation_kind = 'buyin' AND x.table_id = c.table_id
              AND x.account_entity_id = c.uid AND x.seat_joined_at <= c.created_at
            ORDER BY x.seat_joined_at DESC, x.recorded_at DESC, x.id DESC LIMIT 1)
          UNION ALL
          (SELECT m.club_id, m.created_at AS arrived_at, m.created_at AS seq_at, m.move_id AS seq_id
             FROM public.cash_seat_move_receipts m
            WHERE ra.club_id IS NULL AND m.to_table_id = c.table_id AND m.player_id = c.uid
              AND m.created_at <= c.created_at
            ORDER BY m.created_at DESC, m.move_id DESC LIMIT 1)
        ) a ORDER BY a.arrived_at DESC, a.seq_at DESC, a.seq_id DESC LIMIT 1) rc ON true
      LEFT JOIN LATERAL (
        SELECT ts.club_id AS club FROM public.table_seats ts
         WHERE ra.club_id IS NULL AND rc.club IS NULL AND ts.table_id = c.table_id
           AND ts.user_id = c.uid AND ts.club_id IS NOT NULL AND ts.joined_at <= c.created_at
         ORDER BY ts.joined_at DESC LIMIT 1) st ON true
  ), cut AS MATERIALIZED (
    -- A stable boundary is a property of the club, not each contribution.
    SELECT c.club_id, public.fn_ca_launch_accounting_cutoff('club', c.club_id) AS cutoff
      FROM (SELECT DISTINCT club_id FROM clubbed WHERE club_id IS NOT NULL) c
  ), hands AS (
    SELECT h.club_id, h.table_id, SUM(h.hands)::int AS hands, SUM(h.src)::int AS src FROM (
      SELECT cl.club_id, cl.table_id, count(DISTINCT cl.id) AS hands, count(*) AS src
        FROM clubbed cl JOIN cut ON cut.club_id = cl.club_id
       WHERE cut.cutoff IS NULL
          OR (cl.created_at IS NOT NULL AND isfinite(cl.created_at) AND cl.created_at >= cut.cutoff)
       GROUP BY 1, 2
      UNION ALL
      -- A raked hand that named nobody is the table's club's hand.
      SELECT rr.table_club, rr.table_id, count(*), count(*)
        FROM rr
       WHERE rr.table_club IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM contrib c WHERE c.id = rr.id)
       GROUP BY 1, 2) h
     GROUP BY 1, 2
  ),
  table_rows AS (
    INSERT INTO public.club_table_daily
      (club_id, table_id, stat_date, union_id, rake, hands, players, buyins, cashouts, net, source_rows, updated_at)
    SELECT f.club_id, f.game_id, p_day, t.union_id,
           SUM(f.fee), COALESCE(MAX(h.hands), 0),
           (count(DISTINCT f.user_id) FILTER (WHERE f.fee > 0 AND f.user_id <> v_zero))::int,
           round(SUM(f.buyins), 2), round(SUM(f.cashouts), 2), round(SUM(f.cashouts) - SUM(f.buyins), 2),
           COALESCE(MAX(h.src), 0), now()
      FROM day_facts f
      JOIN public.tables t ON t.id = f.game_id
      LEFT JOIN hands h ON h.club_id = f.club_id AND h.table_id = f.game_id
     WHERE f.stat_date = p_day AND f.kind = 'CASH'
     GROUP BY f.club_id, f.game_id, t.union_id
    RETURNING 1
  ),
  table_player_rows AS (
    INSERT INTO public.ca_club_table_player_daily (club_id, table_id, stat_date, user_id)
    SELECT DISTINCT f.club_id, f.game_id, p_day, f.user_id
      FROM day_facts f
     WHERE f.stat_date = p_day AND f.kind = 'CASH' AND f.fee > 0 AND f.user_id <> v_zero
    ON CONFLICT DO NOTHING
    RETURNING 1
  ),
  player_rows AS (
    INSERT INTO public.ca_club_player_daily (club_id, user_id, stat_date, cash_net, tournament_net, updated_at)
    SELECT f.club_id, f.user_id, p_day,
           COALESCE(SUM(f.winnings) FILTER (WHERE f.kind = 'CASH'), 0),
           COALESCE(SUM(f.winnings) FILTER (WHERE f.kind = 'TOURNAMENT'), 0), now()
      FROM day_facts f
     WHERE f.stat_date = p_day AND f.user_id <> v_zero
     GROUP BY f.club_id, f.user_id
    HAVING bool_or(f.buyins <> 0 OR f.cashouts <> 0)
    RETURNING 1
  ),
  tournament_rows AS (
    INSERT INTO public.ca_club_tournament_daily (club_id, tournament_id, stat_date, fee, winnings, updated_at)
    SELECT f.club_id, f.game_id, p_day, SUM(f.fee), SUM(f.winnings), now()
      FROM day_facts f
     WHERE f.stat_date = p_day AND f.kind = 'TOURNAMENT'
     GROUP BY f.club_id, f.game_id
    RETURNING 1
  ),
  tournament_player_rows AS (
    INSERT INTO public.ca_club_tournament_player_daily (club_id, tournament_id, user_id, stat_date, updated_at)
    SELECT DISTINCT f.club_id, f.game_id, f.user_id, p_day, now()
      FROM day_facts f
     WHERE f.stat_date = p_day AND f.kind = 'TOURNAMENT' AND f.user_id <> v_zero
       AND (f.buyins <> 0 OR f.cashouts <> 0)
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM table_rows),
         (SELECT count(*) FROM player_rows),
         (SELECT count(*) FROM tournament_rows)
    INTO v_tables, v_players, v_tournaments;

  RETURN jsonb_build_object('day', p_day, 'source', 'ca_club_data_fact', 'table_rows', v_tables,
                            'player_rows', v_players, 'tournament_rows', v_tournaments);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ca_club_members_cash_window(
  p_club_id uuid,
  p_user_ids uuid[],
  p_from date,
  p_to date
)
RETURNS TABLE(user_id uuid, cash_net numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
 WITH b AS MATERIALIZED (
  SELECT public.fn_ca_launch_accounting_cutoff('club',p_club_id) cutoff,
   (p_from IS NULL AND p_to IS NULL) overall,
   (p_from IS NULL AND p_to IS NULL) OR
    (p_from IS NOT NULL AND p_to IS NOT NULL AND p_to>p_from) valid,
   p_from::timestamp AT TIME ZONE 'America/Chicago' cs,
   (p_from+1)::timestamp AT TIME ZONE 'UTC' u1,
   p_to::timestamp AT TIME ZONE 'UTC' u2,
   p_to::timestamp AT TIME ZONE 'America/Chicago' ce
 ), wanted AS MATERIALIZED (
  SELECT DISTINCT uid FROM unnest(coalesce(p_user_ids,ARRAY[]::uuid[])) uid WHERE uid IS NOT NULL
 ), daily AS MATERIALIZED (
  SELECT f.user_id uid,sum(f.net) net
  FROM wanted w JOIN public.ca_stats_member_record_daily_facts f ON f.user_id=w.uid CROSS JOIN b
  WHERE b.valid AND f.club_id=p_club_id AND NOT f.is_mtt
   AND f.accounting_cutoff IS NOT DISTINCT FROM b.cutoff
   AND (b.overall OR (p_to>p_from+1 AND f.played_on>=p_from+1 AND f.played_on<=p_to-1))
  GROUP BY f.user_id
 ), slices AS MATERIALIZED (
  -- Purely additive partial-day slices from retained timestamped facts.
  SELECT f.user_id,f.table_id,f.hand_id,f.played_at,f.club_id,f.net
  FROM wanted w CROSS JOIN b
  CROSS JOIN LATERAL(VALUES(b.cs,b.u1),(b.u2,b.ce)) slice(start_at,end_at)
  JOIN public.ca_hand_facts f ON f.user_id=w.uid
   AND f.played_at>=slice.start_at AND f.played_at<slice.end_at
  WHERE b.valid AND NOT b.overall AND f.tournament_id IS NULL
   AND CASE WHEN b.cutoff IS NULL THEN true ELSE
    f.played_at IS NOT NULL AND isfinite(f.played_at) AND f.played_at>=b.cutoff END
 ), occupancies AS MATERIALIZED (
  SELECT DISTINCT table_id,user_id FROM slices
 ), funding AS MATERIALIZED (
  SELECT DISTINCT ON(a.table_id,a.account_entity_id,a.seat_joined_at)
   a.table_id,a.account_entity_id,a.seat_joined_at,a.funding_club_id
  FROM (
   SELECT x.table_id,x.account_entity_id,x.seat_joined_at,x.funding_club_id,x.recorded_at AS seq_at,x.id AS seq_id
   FROM public.cash_participant_funding_receipts x JOIN occupancies o
    ON o.table_id=x.table_id AND o.user_id=x.account_entity_id
   WHERE x.operation_kind='buyin'
   UNION ALL
   SELECT m.to_table_id AS table_id,m.player_id AS account_entity_id,m.created_at AS seat_joined_at,m.club_id AS funding_club_id,m.created_at AS seq_at,m.move_id AS seq_id
   FROM public.cash_seat_move_receipts m JOIN occupancies o
    ON o.table_id=m.to_table_id AND o.user_id=m.player_id
  ) a
  ORDER BY a.table_id,a.account_entity_id,a.seat_joined_at,a.seq_at DESC,a.seq_id DESC
 ), timeline AS MATERIALIZED (
  SELECT *,lead(seat_joined_at) OVER(
   PARTITION BY table_id,account_entity_id ORDER BY seat_joined_at) next_joined_at FROM funding
 ), resolved AS MATERIALIZED (
  SELECT f.*,x.funding_club_id FROM slices f
  LEFT JOIN timeline x ON x.table_id=f.table_id AND x.account_entity_id=f.user_id
   AND x.seat_joined_at<=f.played_at AND (x.next_joined_at IS NULL OR f.played_at<x.next_joined_at)
 ), unfunded AS MATERIALIZED (
  SELECT * FROM resolved WHERE funding_club_id IS NULL
 ), amounts AS (
  SELECT f.user_id uid,f.net FROM resolved f WHERE f.funding_club_id=p_club_id
  UNION ALL
  SELECT f.user_id uid,f.net FROM unfunded f
  LEFT JOIN public.rake_attributions ra ON ra.hand_id=f.hand_id AND ra.player_id=f.user_id
  WHERE coalesce(ra.club_id,f.club_id)=p_club_id
 ), added AS MATERIALIZED (
  SELECT uid,sum(net) net FROM amounts GROUP BY uid
 )
 SELECT w.uid,coalesce(d.net,0)+coalesce(a.net,0)
 FROM wanted w LEFT JOIN daily d ON d.uid=w.uid LEFT JOIN added a ON a.uid=w.uid;
$function$;

REVOKE ALL ON FUNCTION public.ca_player_class_hands_by_club(uuid,text,text,text,integer,integer,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_player_class_hands_by_club(uuid,text,text,text,integer,integer,text,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ca_player_ev_curve_by_club(uuid,integer,integer,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_player_ev_curve_by_club(uuid,integer,integer,text,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ca_player_hand_grid_by_club(uuid,text,text,integer,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_player_hand_grid_by_club(uuid,text,text,integer,text,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ca_player_hands_separated_by_club(uuid,text,integer,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_player_hands_separated_by_club(uuid,text,integer,text,uuid,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ca_player_hands_v2_by_club(uuid,text,integer,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_player_hands_v2_by_club(uuid,text,integer,text,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ca_player_nemesis_by_club(uuid,integer,integer,integer,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_player_nemesis_by_club(uuid,integer,integer,integer,text,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ca_player_rake_stats_by_club(uuid,integer,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_player_rake_stats_by_club(uuid,integer,text,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ca_player_rake_stats_calendar_by_club(uuid,integer,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_player_rake_stats_calendar_by_club(uuid,integer,text,uuid,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ca_player_stats_club_comparison(uuid,integer,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_player_stats_club_comparison(uuid,integer,text,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ca_player_stats_club_comparison_separated(uuid,integer,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_player_stats_club_comparison_separated(uuid,integer,text,text,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ca_player_stats_hand_evidence(uuid,uuid,text,text,text,numeric,timestamp with time zone,timestamp with time zone,text,boolean,boolean,boolean,boolean,text,boolean,text,uuid,timestamp with time zone,uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_player_stats_hand_evidence(uuid,uuid,text,text,text,numeric,timestamp with time zone,timestamp with time zone,text,boolean,boolean,boolean,boolean,text,boolean,text,uuid,timestamp with time zone,uuid,integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ca_player_stats_hand_evidence_base(uuid,uuid,text,text,text,numeric,timestamp with time zone,timestamp with time zone,text,boolean,boolean,boolean,boolean,text,boolean,text,timestamp with time zone,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ca_player_stats_hand_evidence_base(uuid,uuid,text,text,text,numeric,timestamp with time zone,timestamp with time zone,text,boolean,boolean,boolean,boolean,text,boolean,text,timestamp with time zone,uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.ca_player_stats_overview_separated_by_club(uuid,integer,text,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_player_stats_overview_separated_by_club(uuid,integer,text,text,uuid,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ca_player_stats_overview_v2_by_club(uuid,integer,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_player_stats_overview_v2_by_club(uuid,integer,text,text,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ca_player_stats_pulse_by_club(uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_player_stats_pulse_by_club(uuid,text,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ca_player_stats_shared_overview_v1(uuid,uuid,integer,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_player_stats_shared_overview_v1(uuid,uuid,integer,text,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ca_player_stats_shared_separated(uuid,uuid,integer,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_player_stats_shared_separated(uuid,uuid,integer,text,text,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_fact_seed(timestamp with time zone,timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_club_data_fact_seed(timestamp with time zone,timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_club_rake_daily_compute(timestamp with time zone,timestamp with time zone,uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_club_rake_daily_compute(timestamp with time zone,timestamp with time zone,uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_reporting_rollups_from_facts(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_reporting_rollups_from_facts(date) TO service_role;
REVOKE ALL ON FUNCTION public.ca_club_members_cash_window(uuid,uuid[],date,date) FROM PUBLIC, anon, authenticated, service_role;

-- @probe-for: public.ca_player_class_hands_by_club
DO $probe$
DECLARE v_uid uuid; v_club uuid;
BEGIN
  IF to_regclass('public.clubs') IS NOT NULL AND to_regclass('public.club_members') IS NOT NULL THEN
    SELECT m.user_id, m.club_id INTO v_uid, v_club
    FROM public.club_members m
    JOIN public.clubs c ON c.id = m.club_id
    WHERE m.status IN ('active', 'approved')
      AND coalesce(c.lifecycle_status, 'active') <> 'retired'
      AND coalesce(c.asset, 'chips') = 'chips'
    LIMIT 1;
    IF v_uid IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM public.ca_player_class_hands_by_club(v_uid, 'AA', NULL, NULL, 1, 1, 'chips', v_club);
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
-- @probe-for: public.ca_player_ev_curve_by_club
DO $probe$
DECLARE v_uid uuid; v_club uuid;
BEGIN
  IF to_regclass('public.clubs') IS NOT NULL AND to_regclass('public.club_members') IS NOT NULL THEN
    SELECT m.user_id, m.club_id INTO v_uid, v_club
    FROM public.club_members m
    JOIN public.clubs c ON c.id = m.club_id
    WHERE m.status IN ('active', 'approved')
      AND coalesce(c.lifecycle_status, 'active') <> 'retired'
      AND coalesce(c.asset, 'chips') = 'chips'
    LIMIT 1;
    IF v_uid IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM public.ca_player_ev_curve_by_club(v_uid, 1, 100, 'chips', v_club);
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
-- @probe-for: public.ca_player_hand_grid_by_club
DO $probe$
DECLARE v_uid uuid; v_club uuid;
BEGIN
  IF to_regclass('public.clubs') IS NOT NULL AND to_regclass('public.club_members') IS NOT NULL THEN
    SELECT m.user_id, m.club_id INTO v_uid, v_club
    FROM public.club_members m
    JOIN public.clubs c ON c.id = m.club_id
    WHERE m.status IN ('active', 'approved')
      AND coalesce(c.lifecycle_status, 'active') <> 'retired'
      AND coalesce(c.asset, 'chips') = 'chips'
    LIMIT 1;
    IF v_uid IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM public.ca_player_hand_grid_by_club(v_uid, NULL, NULL, 1, 'chips', v_club);
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
-- @probe-for: public.ca_player_hands_separated_by_club
DO $probe$
DECLARE v_uid uuid; v_club uuid;
BEGIN
  IF to_regclass('public.clubs') IS NOT NULL AND to_regclass('public.club_members') IS NOT NULL THEN
    SELECT m.user_id, m.club_id INTO v_uid, v_club
    FROM public.club_members m
    JOIN public.clubs c ON c.id = m.club_id
    WHERE m.status IN ('active', 'approved')
      AND coalesce(c.lifecycle_status, 'active') <> 'retired'
      AND coalesce(c.asset, 'chips') = 'chips'
    LIMIT 1;
    IF v_uid IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM public.ca_player_hands_separated_by_club(v_uid, 'recent', 1, 'chips', v_club, 'cash');
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
-- @probe-for: public.ca_player_hands_v2_by_club
DO $probe$
DECLARE v_uid uuid; v_club uuid;
BEGIN
  IF to_regclass('public.clubs') IS NOT NULL AND to_regclass('public.club_members') IS NOT NULL THEN
    SELECT m.user_id, m.club_id INTO v_uid, v_club
    FROM public.club_members m
    JOIN public.clubs c ON c.id = m.club_id
    WHERE m.status IN ('active', 'approved')
      AND coalesce(c.lifecycle_status, 'active') <> 'retired'
      AND coalesce(c.asset, 'chips') = 'chips'
    LIMIT 1;
    IF v_uid IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM public.ca_player_hands_v2_by_club(v_uid, 'recent', 1, 'chips', v_club);
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
-- @probe-for: public.ca_player_nemesis_by_club
DO $probe$
DECLARE v_uid uuid; v_club uuid;
BEGIN
  IF to_regclass('public.clubs') IS NOT NULL AND to_regclass('public.club_members') IS NOT NULL THEN
    SELECT m.user_id, m.club_id INTO v_uid, v_club
    FROM public.club_members m
    JOIN public.clubs c ON c.id = m.club_id
    WHERE m.status IN ('active', 'approved')
      AND coalesce(c.lifecycle_status, 'active') <> 'retired'
      AND coalesce(c.asset, 'chips') = 'chips'
    LIMIT 1;
    IF v_uid IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM public.ca_player_nemesis_by_club(v_uid, 1, 1, 1, 'chips', v_club);
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
-- @probe-for: public.ca_player_rake_stats_by_club
DO $probe$
DECLARE v_uid uuid; v_club uuid;
BEGIN
  IF to_regclass('public.clubs') IS NOT NULL AND to_regclass('public.club_members') IS NOT NULL THEN
    SELECT m.user_id, m.club_id INTO v_uid, v_club
    FROM public.club_members m
    JOIN public.clubs c ON c.id = m.club_id
    WHERE m.status IN ('active', 'approved')
      AND coalesce(c.lifecycle_status, 'active') <> 'retired'
      AND coalesce(c.asset, 'chips') = 'chips'
    LIMIT 1;
    IF v_uid IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM public.ca_player_rake_stats_by_club(v_uid, 1, 'chips', v_club);
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
-- @probe-for: public.ca_player_rake_stats_calendar_by_club
DO $probe$
DECLARE v_uid uuid; v_club uuid;
BEGIN
  IF to_regclass('public.clubs') IS NOT NULL AND to_regclass('public.club_members') IS NOT NULL THEN
    SELECT m.user_id, m.club_id INTO v_uid, v_club
    FROM public.club_members m
    JOIN public.clubs c ON c.id = m.club_id
    WHERE m.status IN ('active', 'approved')
      AND coalesce(c.lifecycle_status, 'active') <> 'retired'
      AND coalesce(c.asset, 'chips') = 'chips'
    LIMIT 1;
    IF v_uid IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM public.ca_player_rake_stats_calendar_by_club(v_uid, 1, 'chips', v_club, 'UTC');
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
-- @probe-for: public.ca_player_stats_club_comparison
DO $probe$
DECLARE v_uid uuid; v_club uuid;
BEGIN
  IF to_regclass('public.clubs') IS NOT NULL AND to_regclass('public.club_members') IS NOT NULL THEN
    SELECT m.user_id, m.club_id INTO v_uid, v_club
    FROM public.club_members m
    JOIN public.clubs c ON c.id = m.club_id
    WHERE m.status IN ('active', 'approved')
      AND coalesce(c.lifecycle_status, 'active') <> 'retired'
      AND coalesce(c.asset, 'chips') = 'chips'
    LIMIT 1;
    IF v_uid IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM public.ca_player_stats_club_comparison(v_uid, 1, 'chips', 'UTC');
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
-- @probe-for: public.ca_player_stats_club_comparison_separated
DO $probe$
DECLARE v_uid uuid; v_club uuid;
BEGIN
  IF to_regclass('public.clubs') IS NOT NULL AND to_regclass('public.club_members') IS NOT NULL THEN
    SELECT m.user_id, m.club_id INTO v_uid, v_club
    FROM public.club_members m
    JOIN public.clubs c ON c.id = m.club_id
    WHERE m.status IN ('active', 'approved')
      AND coalesce(c.lifecycle_status, 'active') <> 'retired'
      AND coalesce(c.asset, 'chips') = 'chips'
    LIMIT 1;
    IF v_uid IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM public.ca_player_stats_club_comparison_separated(v_uid, 1, 'chips', 'UTC', 'cash');
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
-- @probe-for: public.ca_player_stats_hand_evidence
DO $probe$
DECLARE v_uid uuid; v_club uuid;
BEGIN
  IF to_regclass('public.clubs') IS NOT NULL AND to_regclass('public.club_members') IS NOT NULL THEN
    SELECT m.user_id, m.club_id INTO v_uid, v_club
    FROM public.club_members m
    JOIN public.clubs c ON c.id = m.club_id
    WHERE m.status IN ('active', 'approved')
      AND coalesce(c.lifecycle_status, 'active') <> 'retired'
      AND coalesce(c.asset, 'chips') = 'chips'
    LIMIT 1;
    IF v_uid IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM public.ca_player_stats_hand_evidence(v_uid, v_club, 'chips', NULL, NULL, NULL, now() - interval '1 day', now(), NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, 1);
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
-- @probe-for: public.ca_player_stats_hand_evidence_base
DO $probe$
DECLARE v_uid uuid; v_club uuid;
BEGIN
  IF to_regclass('public.clubs') IS NOT NULL AND to_regclass('public.club_members') IS NOT NULL THEN
    SELECT m.user_id, m.club_id INTO v_uid, v_club
    FROM public.club_members m
    JOIN public.clubs c ON c.id = m.club_id
    WHERE m.status IN ('active', 'approved')
      AND coalesce(c.lifecycle_status, 'active') <> 'retired'
      AND coalesce(c.asset, 'chips') = 'chips'
    LIMIT 1;
    IF v_uid IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM public.ca_player_stats_hand_evidence_base(v_uid, v_club, 'chips', NULL, NULL, NULL, now() - interval '1 day', now(), NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, 1);
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
-- @probe-for: public.ca_player_stats_overview_separated_by_club
DO $probe$
DECLARE v_uid uuid; v_club uuid;
BEGIN
  IF to_regclass('public.clubs') IS NOT NULL AND to_regclass('public.club_members') IS NOT NULL THEN
    SELECT m.user_id, m.club_id INTO v_uid, v_club
    FROM public.club_members m
    JOIN public.clubs c ON c.id = m.club_id
    WHERE m.status IN ('active', 'approved')
      AND coalesce(c.lifecycle_status, 'active') <> 'retired'
      AND coalesce(c.asset, 'chips') = 'chips'
    LIMIT 1;
    IF v_uid IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM public.ca_player_stats_overview_separated_by_club(v_uid, 1, 'UTC', 'chips', v_club, 'cash');
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
-- @probe-for: public.ca_player_stats_overview_v2_by_club
DO $probe$
DECLARE v_uid uuid; v_club uuid;
BEGIN
  IF to_regclass('public.clubs') IS NOT NULL AND to_regclass('public.club_members') IS NOT NULL THEN
    SELECT m.user_id, m.club_id INTO v_uid, v_club
    FROM public.club_members m
    JOIN public.clubs c ON c.id = m.club_id
    WHERE m.status IN ('active', 'approved')
      AND coalesce(c.lifecycle_status, 'active') <> 'retired'
      AND coalesce(c.asset, 'chips') = 'chips'
    LIMIT 1;
    IF v_uid IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM public.ca_player_stats_overview_v2_by_club(v_uid, 1, 'UTC', 'chips', v_club);
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
-- @probe-for: public.ca_player_stats_pulse_by_club
DO $probe$
DECLARE v_uid uuid; v_club uuid;
BEGIN
  IF to_regclass('public.clubs') IS NOT NULL AND to_regclass('public.club_members') IS NOT NULL THEN
    SELECT m.user_id, m.club_id INTO v_uid, v_club
    FROM public.club_members m
    JOIN public.clubs c ON c.id = m.club_id
    WHERE m.status IN ('active', 'approved')
      AND coalesce(c.lifecycle_status, 'active') <> 'retired'
      AND coalesce(c.asset, 'chips') = 'chips'
    LIMIT 1;
    IF v_uid IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM public.ca_player_stats_pulse_by_club(v_uid, 'chips', v_club);
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
-- @probe-for: public.ca_player_stats_shared_overview_v1
DO $probe$
DECLARE v_viewer uuid; v_target uuid; v_club uuid;
BEGIN
  IF to_regclass('public.clubs') IS NOT NULL AND to_regclass('public.club_members') IS NOT NULL THEN
    SELECT m1.user_id, m2.user_id, m1.club_id INTO v_viewer, v_target, v_club
    FROM public.club_members m1
    JOIN public.club_members m2 ON m2.club_id = m1.club_id AND m2.user_id <> m1.user_id
    JOIN public.clubs c ON c.id = m1.club_id
    WHERE m1.status IN ('active', 'approved')
      AND m2.status IN ('active', 'approved')
      AND coalesce(c.lifecycle_status, 'active') <> 'retired'
      AND coalesce(c.asset, 'chips') = 'chips'
    LIMIT 1;
    IF v_viewer IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_viewer::text, true);
      PERFORM public.ca_player_stats_shared_overview_v1(v_target, v_club, 1, 'UTC', 'chips');
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
-- @probe-for: public.ca_player_stats_shared_separated
DO $probe$
DECLARE v_viewer uuid; v_target uuid; v_club uuid;
BEGIN
  IF to_regclass('public.clubs') IS NOT NULL AND to_regclass('public.club_members') IS NOT NULL THEN
    SELECT m1.user_id, m2.user_id, m1.club_id INTO v_viewer, v_target, v_club
    FROM public.club_members m1
    JOIN public.club_members m2 ON m2.club_id = m1.club_id AND m2.user_id <> m1.user_id
    JOIN public.clubs c ON c.id = m1.club_id
    WHERE m1.status IN ('active', 'approved')
      AND m2.status IN ('active', 'approved')
      AND coalesce(c.lifecycle_status, 'active') <> 'retired'
      AND coalesce(c.asset, 'chips') = 'chips'
    LIMIT 1;
    IF v_viewer IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_viewer::text, true);
      PERFORM public.ca_player_stats_shared_separated(v_target, v_club, 1, 'UTC', 'chips', 'cash');
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
-- @probe-for: public.fn_ca_club_data_fact_seed
DO $probe$
BEGIN
  IF to_regclass('public.ca_club_data_fact') IS NOT NULL THEN
    PERFORM public.fn_ca_club_data_fact_seed('2020-01-01 00:00:00+00'::timestamptz, '2020-01-01 00:00:01+00'::timestamptz);
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
-- @probe-for: public.fn_ca_reporting_rollups_from_facts
DO $probe$
BEGIN
  IF to_regclass('public.club_table_daily') IS NOT NULL THEN
    PERFORM public.fn_ca_reporting_rollups_from_facts('2099-01-01'::date);
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
