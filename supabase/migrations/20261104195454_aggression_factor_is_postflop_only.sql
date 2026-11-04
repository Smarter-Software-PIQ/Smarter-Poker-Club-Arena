-- 20261104195454_aggression_factor_is_postflop_only.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- The stats page's "aggression factor" counted PREFLOP calls in its
-- denominator (ca_fact_aggression_counts counts every voluntary call on every
-- street). Every poker tracker defines AF as (bets + raises) / calls on the
-- flop, turn and river. The difference is not small: a KINGS CLUB regular
-- (Dan, 2026-11-04) read 1.12 by the platform's count and 1.50 by the
-- textbook one, and every loose player's number was dragged under the
-- thresholds the style classifier was written against, which is how a
-- winning 34/17 player came to be titled Fish. The classifier was made robust
-- to it the same day; this fixes the number itself.
--
-- Historical facts are never rewritten (write-once evidence), and the facts
-- table is the hottest on the platform (89M rows, 101 GB), so it is not
-- altered either. The same shape ca_hand_stat_intervals already uses:
--   * ca_hand_postflop_aggression is a cold side table keyed by (hand_id,
--     user_id) with NO foreign key to a live table (CLAUDE.md 2.7), written
--     by the existing BEFORE INSERT trigger on ca_hand_facts from this
--     migration on. Per player-hand: two smallints.
--   * ca_fact_postflop_aggression_counts is ca_fact_aggression_counts with the
--     preflop street excluded from both counts. The original is kept: its
--     persisted pair is still what the readers pass, and it is the
--     last-resort fallback below.
--   * ca_player_recorded_hand_coverage reads, per hand, the side-table pair;
--     else recomputes postflop from the retained hand record; else (a fact
--     from 2026-10-27 to now whose horse-only hand record was pruned) the
--     preflop-inclusive pair the readers already pass, so no player loses the
--     metric. The payload carries 'aggression_factor_basis': 'postflop'.
--   * The two club-scoped readers are redefined from the bodies installed by
--     20261104194608 with one line added, carrying aggression_factor_basis
--     into their explicitly keyed overall object. The two unscoped readers
--     merge the coverage object wholesale and are untouched.
--
-- Table creation and function redefinitions take no lock on a live table;
-- this installs during play.
--
-- @live-proof: to_regclass('public.ca_hand_postflop_aggression') IS NOT NULL AND position('aggression_factor_basis' in pg_get_functiondef('public.ca_player_stats_overview_separated_by_club(uuid,integer,text,text,uuid,text)'::regprocedure))>0 AND to_regprocedure('public.ca_fact_postflop_aggression_counts(jsonb,uuid,numeric)') IS NOT NULL AND position('ca_hand_postflop_aggression' in pg_get_functiondef('public.ca_player_recorded_hand_coverage(uuid,jsonb,timestamptz,timestamptz)'::regprocedure))>0
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

-- Cold evidence table. No foreign key to a live table: an orphan row here is
-- harmless, a lock on ca_hand_facts or hand_history is not.
CREATE TABLE public.ca_hand_postflop_aggression (
  hand_id uuid NOT NULL,
  user_id uuid NOT NULL,
  bet_raise_actions smallint NOT NULL CHECK (bet_raise_actions >= 0),
  call_actions smallint NOT NULL CHECK (call_actions >= 0),
  PRIMARY KEY (hand_id, user_id)
);
ALTER TABLE public.ca_hand_postflop_aggression ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_hand_postflop_aggression FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.ca_hand_postflop_aggression TO service_role;

CREATE OR REPLACE FUNCTION public.ca_fact_postflop_aggression_counts(p_actions jsonb, p_user uuid, p_big_blind numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 -- Textbook aggression factor: (bets + raises) / calls on the FLOP, TURN and
 -- RIVER only. Identical validation and level tracking to
 -- ca_fact_aggression_counts; the two FILTERs simply exclude the preflop
 -- street, so a limp, a cold call or a call of a raise before the flop is
 -- no longer counted as passivity.
 WITH ordered AS (
  SELECT a,ord,lower(a->>'action') action,lower(a->>'stage') stage,
   coalesce(a->>'userId',a->>'user_id') actor,
   CASE WHEN a->>'amount' ~ '^[0-9]+([.][0-9]+)?$' THEN (a->>'amount')::numeric END amount,
   coalesce(a->>'origin','')<>'forced' AND coalesce(a->>'dead','false')<>'true' voluntary
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_actions)='array' THEN p_actions ELSE '[]'::jsonb END)
   WITH ORDINALITY x(a,ord)
 ), levels AS (
  SELECT *,greatest(CASE WHEN stage='preflop' THEN greatest(coalesce(p_big_blind,0),0) ELSE 0 END,coalesce(max(CASE WHEN action IN ('bet','raise','all_in','allin','sb','bb','straddle','kill_blind','post_sb','post_bb','small_blind','big_blind')
    AND coalesce(a->>'dead','false')<>'true' THEN amount END)
   OVER(PARTITION BY stage ORDER BY ord ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0)) prior_level
  FROM ordered
 ) SELECT CASE WHEN jsonb_typeof(p_actions) IS DISTINCT FROM 'array' OR
   jsonb_array_length(CASE WHEN jsonb_typeof(p_actions)='array' THEN p_actions ELSE '[]'::jsonb END)=0 OR p_user IS NULL
   OR EXISTS(SELECT 1 FROM ordered WHERE action IS NULL OR action NOT IN
     ('fold','check','call','bet','raise','all_in','allin','sb','bb','post','blind','post_sb','post_bb','small_blind','big_blind','straddle','kill_blind','ante','post_ante','dead_blind','bring_in','return','bomb_ante','discard')
     AND NOT coalesce((action ~ '^rit_board_[23]:([2-9tjqka](hearts|diamonds|clubs|spades),){4}[2-9tjqka](hearts|diamonds|clubs|spades)$'
       AND actor='system' AND stage='river' AND a->'seat'='0'::jsonb
       AND CASE WHEN jsonb_typeof(a->'timestamp')='number' AND a->>'timestamp' ~ '^[0-9]+$' THEN (a->>'timestamp')::numeric<=9007199254740991 ELSE false END
       AND (SELECT count(DISTINCT card) FROM unnest(string_to_array(split_part(action,':',2),',')) card)=5),false)
     OR (action='discard' AND (amount IS DISTINCT FROM 0 OR jsonb_typeof(a->'amount') IS DISTINCT FROM 'number' OR stage NOT IN ('pineapple_discard','flop','turn','river')))
     OR (action='bomb_ante' AND (a->>'origin' IS DISTINCT FROM 'forced' OR a->'dead' IS DISTINCT FROM 'true'::jsonb
       OR stage IS DISTINCT FROM 'preflop' OR amount IS NULL OR amount<=0))
     OR stage IS NULL OR stage='' OR actor IS NULL OR actor=''
     OR (action IN ('bet','raise','all_in','allin') AND (amount IS NULL OR amount<=0)))
  THEN NULL ELSE jsonb_build_object(
   'bets_raises',count(*) FILTER(WHERE actor=p_user::text AND voluntary AND stage<>'preflop' AND
    (action IN ('bet','raise') OR (action IN ('all_in','allin') AND amount>prior_level))),
   'calls',count(*) FILTER(WHERE actor=p_user::text AND voluntary AND stage<>'preflop' AND
    (action='call' OR (action IN ('all_in','allin') AND amount<=prior_level)))) END
 FROM levels;
$function$;

CREATE OR REPLACE FUNCTION public.ca_capture_fact_aggression_counts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_actions jsonb; v_counts jsonb; v_postflop jsonb; v_big_blind numeric; v_start timestamptz; v_end timestamptz;
BEGIN
 SELECT h.actions,h.big_blind,h.started_at,h.ended_at INTO v_actions,v_big_blind,v_start,v_end
 FROM public.hand_history h WHERE h.id=NEW.hand_id;
 v_counts:=public.ca_fact_aggression_counts(v_actions,NEW.user_id,v_big_blind);
 NEW.af_bet_raise_actions:=(v_counts->>'bets_raises')::smallint;
 NEW.af_call_actions:=(v_counts->>'calls')::smallint;
 -- Postflop-only pair (2026-11-04): what the aggression factor reads.
 v_postflop:=public.ca_fact_postflop_aggression_counts(v_actions,NEW.user_id,v_big_blind);
 IF v_postflop IS NOT NULL THEN
  INSERT INTO public.ca_hand_postflop_aggression(hand_id,user_id,bet_raise_actions,call_actions)
  VALUES(NEW.hand_id,NEW.user_id,(v_postflop->>'bets_raises')::smallint,(v_postflop->>'calls')::smallint)
  ON CONFLICT(hand_id,user_id) DO NOTHING;
 END IF;
 IF isfinite(v_start) AND isfinite(v_end) AND v_end>v_start THEN
  INSERT INTO public.ca_hand_stat_intervals(hand_id,started_at,ended_at)
  VALUES(NEW.hand_id,v_start,v_end) ON CONFLICT(hand_id) DO NOTHING;
 END IF;
 RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ca_player_recorded_hand_coverage(p_user uuid, p_hands jsonb, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 -- The aggression factor is postflop-only (2026-11-04). Per hand, in order
 -- of preference: the postflop pair recorded in ca_hand_postflop_aggression
 -- (every fact written since this migration); the postflop count recomputed
 -- from the retained hand record; and, only for a fact written between
 -- 2026-10-27 and this migration whose hand record has since been pruned,
 -- the preflop-inclusive pair the readers pass in `bets` / `calls`, so that
 -- sliver of history keeps an aggression factor rather than losing the
 -- metric. New rows never reach the legacy branch.
 WITH requested AS MATERIALIZED (
  SELECT x.hand_id,x.bets,x.calls,x.is_cash FROM jsonb_to_recordset(coalesce(p_hands,'[]'::jsonb))
   x(hand_id uuid,bets integer,calls integer,is_cash boolean)
 ), evidence AS MATERIALIZED (
  SELECT r.hand_id,r.is_cash,
   CASE WHEN pf.hand_id IS NOT NULL
    THEN jsonb_build_object('bets_raises',pf.bet_raise_actions,'calls',pf.call_actions)
    ELSE coalesce(public.ca_fact_postflop_aggression_counts(h.actions,p_user,h.big_blind),
     CASE WHEN r.bets IS NOT NULL AND r.calls IS NOT NULL AND r.bets>=0 AND r.calls>=0
      THEN jsonb_build_object('bets_raises',r.bets,'calls',r.calls) END) END af,
   coalesce(i.started_at,CASE WHEN isfinite(h.started_at) AND isfinite(h.ended_at) AND h.ended_at>h.started_at THEN h.started_at END) start_at,
   coalesce(i.ended_at,CASE WHEN isfinite(h.started_at) AND isfinite(h.ended_at) AND h.ended_at>h.started_at THEN h.ended_at END) end_at
  FROM requested r LEFT JOIN public.ca_hand_stat_intervals i ON i.hand_id=r.hand_id
  LEFT JOIN public.ca_hand_postflop_aggression pf ON pf.hand_id=r.hand_id AND pf.user_id=p_user
  LEFT JOIN public.hand_history h ON h.id=r.hand_id
 ), totals AS (
  SELECT count(*) hands,count(af) af_hands,count(start_at) interval_hands,
   coalesce(sum((af->>'bets_raises')::integer),0) bets,
   coalesce(sum((af->>'calls')::integer),0) calls,count(*) FILTER(WHERE is_cash) cash_hands,count(start_at) FILTER(WHERE is_cash) cash_interval_hands FROM evidence
 ), clipped AS (
  SELECT hand_id,kind,greatest(start_at,p_from) s,least(end_at,p_to) e FROM evidence CROSS JOIN (VALUES('all'),('cash')) buckets(kind)
  WHERE start_at IS NOT NULL AND end_at IS NOT NULL AND (kind='all' OR is_cash)
 ), ordered AS (
  SELECT hand_id,kind,s,e,max(e) OVER(PARTITION BY kind ORDER BY s,e,hand_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) previous_max
  FROM clipped WHERE e>s
 ), marked AS (
  SELECT *,sum(CASE WHEN previous_max IS NULL OR s>previous_max THEN 1 ELSE 0 END)
   OVER(PARTITION BY kind ORDER BY s,e,hand_id ROWS UNBOUNDED PRECEDING) island FROM ordered
 ), merged AS (SELECT kind,min(s) s,max(e) e FROM marked GROUP BY kind,island), elapsed AS (
  SELECT coalesce(sum(extract(epoch FROM(e-s))) FILTER(WHERE kind='all'),0) seconds,coalesce(sum(extract(epoch FROM(e-s))) FILTER(WHERE kind='cash'),0) cash_seconds FROM merged
 ) SELECT jsonb_build_object(
  'aggression_factor',CASE WHEN hands>0 AND af_hands=hands AND calls>0 THEN round(bets::numeric/calls,2) ELSE 0 END,
  'aggression_factor_basis','postflop',
  'hours_played',CASE WHEN hands>0 AND interval_hands=hands THEN round(seconds/3600,9) ELSE 0 END,
  'cash_hours_played',CASE WHEN cash_hands>0 AND cash_interval_hands=cash_hands THEN round(cash_seconds/3600,9) ELSE 0 END,
  'metric_availability',jsonb_build_object(
   'cash_hours_played',cash_hands>0 AND cash_interval_hands=cash_hands,
   'aggression_factor',hands>0 AND af_hands=hands AND calls>0,
   'aggression_factor_denominator',calls,
   'hours_played',hands>0 AND interval_hands=hands),
  'recorded_coverage',jsonb_build_object('hands',hands,'af_hands',af_hands,'interval_hands',interval_hands,
   'hours_source','recorded_hand_interval_union','elapsed_seconds',seconds,'cash_elapsed_seconds',cash_seconds,'cash_hands',cash_hands,'cash_interval_hands',cash_interval_hands)) FROM totals CROSS JOIN elapsed;
$function$;

-- ca_player_stats_overview_separated_by_club (as installed by 20261104194608; one line added: the club-scoped readers name
-- their output keys explicitly, so the basis is carried through here)
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
  SELECT DISTINCT ON(table_id,account_entity_id,seat_joined_at)
   table_id,account_entity_id,seat_joined_at,funding_club_id
  FROM public.cash_participant_funding_receipts
  WHERE account_entity_id=p_user AND operation_kind='buyin'
  ORDER BY table_id,account_entity_id,seat_joined_at,recorded_at DESC,id DESC
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

-- ca_player_stats_overview_v2_by_club (as installed by 20261104194608; one line added: the club-scoped readers name
-- their output keys explicitly, so the basis is carried through here)
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
  SELECT DISTINCT ON(table_id,account_entity_id,seat_joined_at)
   table_id,account_entity_id,seat_joined_at,funding_club_id
  FROM public.cash_participant_funding_receipts
  WHERE account_entity_id=p_user AND operation_kind='buyin'
  ORDER BY table_id,account_entity_id,seat_joined_at,recorded_at DESC,id DESC
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

COMMIT;
