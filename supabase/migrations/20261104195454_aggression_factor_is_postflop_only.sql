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
--   * The four overview readers are untouched: their call signature to the
--     coverage function is unchanged.
--
-- Table creation and function redefinitions take no lock on a live table;
-- this installs during play.
--
-- @live-proof: to_regclass('public.ca_hand_postflop_aggression') IS NOT NULL AND to_regprocedure('public.ca_fact_postflop_aggression_counts(jsonb,uuid,numeric)') IS NOT NULL AND position('ca_hand_postflop_aggression' in pg_get_functiondef('public.ca_player_recorded_hand_coverage(uuid,jsonb,timestamptz,timestamptz)'::regprocedure))>0
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

COMMIT;
