-- @install-window: daily-maintenance
-- @locks: public.horse_exact_profiles
-- @live-proof: (SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.horse_exact_profiles') AND attname='shown_river' AND atttypid='jsonb'::regtype AND NOT attisdropped) AND strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_exact_accept_hand()')), 'shown_river=public.fn_horse_shown_river_add(horse_exact_profiles.shown_river,shown_river_inc->actor.key,shown_river_at)')>0 AND strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_exact_accept_hand()')), 'shown_river_inc:=public.fn_horse_shown_river_increments(h.actions,h.showdown);')>0)
-- 20261115144258_the_exact_opponent_profile_remembers_shown_river_strength.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- A Horse's memory of what an opponent showed after betting the river (the
-- style read's river size buckets: river first bets by size, how many were
-- called and shown down, how many of those were strong) lives in engine memory
-- and is rebuilt at every boot from 72 hours of hand history. A player who
-- bets the river for value a few times a week is therefore unknown again after
-- each restart: on 2026-11-14 one cash regular had 1 shown river bet inside 72
-- hours against 13 in 14 days, and the read needs 3 before it speaks.
--
-- This file gives the exact opponent profile a durable copy of that evidence,
-- written by the same accepted-hand learner that keeps its counters:
--   - a new nullable column shown_river jsonb:
--       {"since": <epoch ms of the first river first bet it learned>,
--        "buckets": {"<small|medium|large|overbet>": {"bets","shown","strong"}}};
--   - fn_horse_shown_river_increments(actions, showdown): per player, the
--     bucket of his FIRST river wager as a share of the pot before it, replayed
--     from the public action log exactly as the engine's
--     HorseOpponentStyle.riverFirstBetFractions does (bet / raise / all_in
--     amounts are street totals, calls and posts increments; under 0.5 small,
--     under 0.66 medium, up to 1.0 large, above overbet); shown when the hand's
--     public showdown list names him; strong only when that entry is not mucked
--     and its public hand name is two pair or better (STYLE_STRONG_HAND_NAMES).
--     Only the public showdown list is read; a mucked entry carries no hand.
--   - fn_horse_shown_river_add(base, delta, at_ms): a half-life counted in
--     SHOWN river bets (40): when the hand adds a shown first river bet, every
--     tally the record held ages by 2^(-1/40) before the bet is added; a bet
--     nobody called adds without ageing; no bet leaves the record unchanged.
--     HorseLongShownMemory.addShownRiverEvidence is the engine's twin.
--   - fn_horse_exact_accept_hand writes it beside counters and long_counters on
--     the insert and on the conflict update, for the actors the reducer
--     learns (forced and unattributed actors are not learned, as for every
--     other field). Patched by exact preimage fragments like 20261115015341.
--
-- Cash and tournament, table sizes, variants and public rule domains stay
-- apart because the row key keeps them apart. Horses and humans alike.
--
-- FORWARD ONLY. No back-fill, no replay of history, no reset: every existing
-- row keeps shown_river NULL until its owner's first accepted hand with a
-- river first bet after install. The engine reads a NULL or invalid record as
-- absent, and reads a present one only behind the default-off option
-- styleLongShownMemory, so either the engine or this file may be installed
-- first. The read RPC returns SETOF horse_exact_profiles and so returns the
-- column; the boot read selects every column.
--
-- PREREQUISITE: 20261115015341 (the long participation window). Its fragments
-- are this file's anchors; without it this file refuses loudly and rolls back.
-- hand_history.showdown (20260825) is asserted too.
--
-- ADD COLUMN with no default is a catalog-only change but takes ACCESS
-- EXCLUSIVE on horse_exact_profiles, which every accepted hand writes, and the
-- accepted-hand trigger function is replaced: the daily-maintenance window,
-- one 1 s lock request.

BEGIN;
SET LOCAL lock_timeout='1s';

DO $prerequisite$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.hand_history'::regclass AND attname='showdown' AND NOT attisdropped) THEN
  RAISE EXCEPTION 'shown river memory needs hand_history.showdown';
 END IF;
 IF to_regprocedure('public.fn_horse_long_participation_add(jsonb,jsonb)') IS NULL
    OR strpos(pg_get_functiondef('public.fn_horse_exact_accept_hand()'::regprocedure),'long_counters=public.fn_horse_long_participation_add(')=0 THEN
  RAISE EXCEPTION 'shown river memory needs 20261115015341 (the long participation window) installed first';
 END IF;
END $prerequisite$;

ALTER TABLE public.horse_exact_profiles ADD COLUMN IF NOT EXISTS shown_river jsonb;

CREATE OR REPLACE FUNCTION public.fn_horse_shown_river_increments(p_actions jsonb,p_showdown jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE
 a jsonb; act text; uid text; sid text; cur_stage text; fresh boolean:=true;
 pot double precision:=0; prev double precision; amt double precision; inc double precision; frac double precision;
 wager boolean; street jsonb:='{}'; buckets jsonb:='{}'; res jsonb:='{}'; f record; sd jsonb;
 is_shown int; is_strong int;
BEGIN
 IF jsonb_typeof(p_actions) IS DISTINCT FROM 'array' THEN RETURN '{}'::jsonb; END IF;
 FOR a IN SELECT e.value FROM jsonb_array_elements(p_actions) WITH ORDINALITY e ORDER BY e.ordinality LOOP
  IF jsonb_typeof(a) IS DISTINCT FROM 'object' THEN CONTINUE; END IF;
  -- A new street resets the street totals (a missing stage is its own street, as in the engine).
  IF fresh OR (a->>'stage') IS DISTINCT FROM cur_stage THEN
   cur_stage:=a->>'stage'; fresh:=false; street:='{}';
  END IF;
  uid:=CASE WHEN jsonb_typeof(a->'userId')='string' THEN a->>'userId' END;
  sid:=coalesce(uid,'');
  prev:=coalesce((street->>sid)::double precision,0);
  amt:=CASE WHEN jsonb_typeof(a->'amount')='number' THEN greatest(0,(a->>'amount')::double precision) ELSE 0 END;
  act:=a->>'action';
  wager:=coalesce(act IN ('bet','raise','all_in'),false);
  inc:=CASE WHEN act IN ('fold','check') THEN 0 WHEN wager THEN greatest(0,amt-prev) ELSE amt END;
  -- The player's FIRST river wager, as a share of the pot before it, decides his bucket.
  IF cur_stage='river' AND uid IS NOT NULL AND uid<>'' AND wager AND inc>0 AND pot>0 AND NOT buckets ? uid THEN
   frac:=inc/pot;
   buckets:=buckets||jsonb_build_object(uid,CASE WHEN frac<0.5 THEN 'small' WHEN frac<0.66 THEN 'medium' WHEN frac<=1 THEN 'large' ELSE 'overbet' END);
  END IF;
  pot:=pot+inc;
  street:=street||jsonb_build_object(sid,prev+inc);
 END LOOP;
 FOR f IN SELECT key,value#>>'{}' AS bucket FROM jsonb_each(buckets) LOOP
  sd:=NULL;
  IF jsonb_typeof(p_showdown)='array' THEN
   SELECT e.value INTO sd FROM jsonb_array_elements(p_showdown) WITH ORDINALITY e
    WHERE jsonb_typeof(e.value)='object' AND jsonb_typeof(e.value->'user_id')='string' AND e.value->>'user_id'=f.key
    ORDER BY e.ordinality LIMIT 1;
  END IF;
  -- Shown: the public showdown list names him. Strong: not mucked, and the shown hand is two pair or better.
  is_shown:=CASE WHEN sd IS NULL THEN 0 ELSE 1 END;
  is_strong:=CASE WHEN sd IS NOT NULL AND (sd->'mucked') IS DISTINCT FROM 'true'::jsonb
                 AND jsonb_typeof(sd->'hand_name')='string'
                 AND lower(sd->>'hand_name') IN ('two pair','three of a kind','straight','flush','full house','four of a kind','straight flush','royal flush')
            THEN 1 ELSE 0 END;
  res:=res||jsonb_build_object(f.key,jsonb_build_object('b',f.bucket,'shown',is_shown,'strong',is_strong));
 END LOOP;
 RETURN res;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_horse_shown_river_add(p_base jsonb,p_delta jsonb,p_at_ms bigint)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE f double precision; k text; cell jsonb; here boolean; buckets jsonb:='{}';
BEGIN
 IF p_delta IS NULL OR jsonb_typeof(p_delta) IS DISTINCT FROM 'object' THEN RETURN p_base; END IF;
 f:=CASE WHEN coalesce((p_delta->>'shown')::int,0)>0 THEN power(0.5::double precision,1.0/40) ELSE 1 END;
 FOREACH k IN ARRAY ARRAY['small','medium','large','overbet'] LOOP
  cell:=p_base->'buckets'->k;
  here:=coalesce((p_delta->>'b')=k,false);
  IF cell IS NULL AND NOT here THEN CONTINUE; END IF;
  buckets:=buckets||jsonb_build_object(k,jsonb_build_object(
   'bets',coalesce((cell->>'bets')::double precision*f,0)+CASE WHEN here THEN 1 ELSE 0 END,
   'shown',coalesce((cell->>'shown')::double precision*f,0)+CASE WHEN here THEN (p_delta->>'shown')::double precision ELSE 0 END,
   'strong',coalesce((cell->>'strong')::double precision*f,0)+CASE WHEN here THEN (p_delta->>'strong')::double precision ELSE 0 END));
 END LOOP;
 RETURN jsonb_build_object('since',coalesce((p_base->>'since')::bigint,p_at_ms),'buckets',buckets);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_horse_shown_river_increments(jsonb,jsonb),public.fn_horse_shown_river_add(jsonb,jsonb,bigint) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE item record; def text; signature regprocedure;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('public.fn_horse_exact_accept_hand()', $a$DECLARE actor record; h public.hand_history%ROWTYPE; m text; sz text;$a$,
   $b$DECLARE actor record; h public.hand_history%ROWTYPE; m text; sz text; shown_river_inc jsonb; shown_river_at bigint;$b$),
  ('public.fn_horse_exact_accept_hand()', $a$WHEN h.horse_exploit_dealt_count<=5 THEN 'short' ELSE 'full' END;$a$,
   $b$WHEN h.horse_exploit_dealt_count<=5 THEN 'short' ELSE 'full' END;
 shown_river_inc:=public.fn_horse_shown_river_increments(h.actions,h.showdown);
 shown_river_at:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;$b$),
  ('public.fn_horse_exact_accept_hand()', $a$observed_hands,initialized,long_counters)$a$,
   $b$observed_hands,initialized,long_counters,shown_river)$b$),
  ('public.fn_horse_exact_accept_hand()', $a$public.fn_horse_long_participation_add(NULL,actor.value))$a$,
   $b$public.fn_horse_long_participation_add(NULL,actor.value),public.fn_horse_shown_river_add(NULL,shown_river_inc->actor.key,shown_river_at))$b$),
  ('public.fn_horse_exact_accept_hand()', $a$long_counters=public.fn_horse_long_participation_add(horse_exact_profiles.long_counters,excluded.counters),$a$,
   $b$long_counters=public.fn_horse_long_participation_add(horse_exact_profiles.long_counters,excluded.counters),shown_river=public.fn_horse_shown_river_add(horse_exact_profiles.shown_river,shown_river_inc->actor.key,shown_river_at),$b$)
 ) edits(name,old_fragment,new_fragment) LOOP
  signature:=item.name::regprocedure;
  def:=pg_get_functiondef(signature);
  IF strpos(def,item.new_fragment)>0 THEN CONTINUE; END IF;
  IF (length(def)-length(replace(def,item.old_fragment,'')))<>length(item.old_fragment) THEN
   RAISE EXCEPTION 'unexpected exact public-memory learner preimage: %',left(item.old_fragment,60);
  END IF;
  EXECUTE replace(def,item.old_fragment,item.new_fragment);
 END LOOP;
END $patch$;

COMMIT;
