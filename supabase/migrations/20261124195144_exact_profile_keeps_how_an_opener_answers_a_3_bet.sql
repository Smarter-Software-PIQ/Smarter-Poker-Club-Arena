-- @install-window: daily-maintenance
-- @locks: public.horse_exact_profiles
-- @live-proof: (SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.horse_exact_profiles') AND attname='opener_response' AND atttypid='jsonb'::regtype AND NOT attisdropped) AND strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_exact_accept_hand()')), 'opener_response=public.fn_horse_opener_response_add(horse_exact_profiles.opener_response,opener_response_inc->actor.key)')>0 AND strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_exact_accept_hand()')), 'opener_response_inc:=CASE WHEN h.game_variant IN (''nlh'',''plo4'',''plo5'') THEN public.fn_horse_opener_response_increments(h.actions) END;')>0)
-- 20261124195144_exact_profile_keeps_how_an_opener_answers_a_3_bet.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- The exact opponent profile (horse_exact_profiles.counters) keeps how often an
-- OPENER folds to a 3-bet (foldTo3Bet / foldTo3BetOpp). It keeps nothing about
-- how the rest of his answers split between a call and a 4-bet, nor his
-- position against the 3-bettor. The out-of-position 3-bet rule
-- (HorseOopReraiseRangeHolds, #11917) needs exactly that: a 3-bet the Horse
-- would fold to a 4-bet costs only as often as THIS opener 4-bets. Its league
-- probes (2026-11-24) priced every opener with the population's split and lost
-- about 25 bb/100 heads-up to an opener who never 4-bets light.
--
-- This file gives the exact profile that record, written by the same
-- accepted-hand learner that keeps its counters. Measurement here; read only
-- by a default-OFF engine option.
--   - a new nullable column opener_response jsonb, two cells of
--     {opp, fold, call, raise}:
--       {"inPosition":    he made the first raise of the preflop street, the next raise was another player's (a
--                         3-bet), he then acted before any further raise, and he acts after the 3-bettor on the
--                         later streets
--        "outOfPosition": the same, and he acts before the 3-bettor}
--   - fn_horse_opener_response_increments(actions): for the opener who
--     answered a 3-bet, that hand's cell, replayed from the public action log
--     exactly as HorseOpenerAnswersThreeBet.openerResponseHandIncrements does.
--     Position from the public log only: the blinds are the players who posted
--     them (sb / bb entries that are not dead), or, with no such posts, the
--     first voluntary preflop actors (heads-up the first is the small blind,
--     otherwise the last two are the blinds); after the flop the small blind
--     acts first, then the big blind, then the others in preflop order, and
--     heads-up the big blind acts first. The same admission as the pooled
--     counters (voluntary, attributed, never forced). At most one opportunity
--     per player per hand. A raise is a bet, a raise or a full-raise all-in.
--   - fn_horse_opener_response_add(base, delta): a cell ages only on a hand
--     that gave it an opportunity, by 2^(-1/30), then takes that hand's
--     counts. A hand that gave the player no opportunity leaves the record
--     exactly as it was (NULL stays NULL). HorseOpenerAnswersThreeBet
--     .addOpenerResponseEvidence is the engine's twin.
--   - fn_horse_exact_accept_hand computes the increments for nlh, plo4 and
--     plo5 hands only (the games whose decisions read the record) and writes
--     the record beside counters and the other public records on the insert
--     and on the conflict update. Patched by exact preimage fragments like
--     20261118023000.
--
-- PUBLIC INFORMATION ONLY. The functions read the hand's public action log.
-- They are never passed hole cards, board cards or the showdown.
--
-- FORWARD ONLY. No back-fill, no replay of history, no reset: every existing
-- row keeps opener_response NULL until its owner's first accepted hand with
-- such an opportunity after install (the re-raise response record,
-- 20261118023000, was installed the same way). The engine reads a NULL,
-- absent or malformed record as absent, so either the engine or this file may
-- be installed first. The read RPC returns SETOF horse_exact_profiles and so
-- returns the column; the boot read selects every column.
--
-- PREREQUISITE: 20261119213206 (the learner hardening). Its fragments are this
-- file's anchors; without it this file refuses loudly and rolls back.
--
-- ADD COLUMN with no default is a catalog-only change but takes ACCESS
-- EXCLUSIVE on horse_exact_profiles, which every accepted hand writes, and the
-- accepted-hand trigger function is replaced: the daily-maintenance window,
-- one 1 s lock request.

BEGIN;
SET LOCAL lock_timeout='1s';

DO $prerequisite$
BEGIN
 IF to_regprocedure('public.fn_horse_street_price_add(jsonb,jsonb)') IS NULL
    OR strpos(pg_get_functiondef('public.fn_horse_exact_accept_hand()'::regprocedure),'street_counters_price=public.fn_horse_street_price_add(horse_exact_profiles.street_counters_price,street_price_inc->actor.key)')=0
    OR strpos(pg_get_functiondef('public.fn_horse_exact_accept_hand()'::regprocedure),'reraise_response_inc:=public.fn_horse_reraise_response_increments(h.actions);')=0 THEN
  RAISE EXCEPTION 'the opener response record needs 20261119213206 (the learner hardening) installed first';
 END IF;
END $prerequisite$;

ALTER TABLE public.horse_exact_profiles ADD COLUMN IF NOT EXISTS opener_response jsonb;

CREATE OR REPLACE FUNCTION public.fn_horse_opener_response_increments(p_actions jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE
 a jsonb; id text; act text; st text; ag boolean; ans text; node text;
 raises int:=0; opener text; three text; sb text; bb text; ord text[]:='{}';
 small text; big text; n int; plist text[]; others text[]; ro int; rt int;
 zero constant jsonb:='{"opp":0,"fold":0,"call":0,"raise":0}';
BEGIN
 IF jsonb_typeof(p_actions) IS DISTINCT FROM 'array' THEN RETURN '{}'::jsonb; END IF;
 FOR a IN SELECT e.value FROM jsonb_array_elements(p_actions) WITH ORDINALITY e ORDER BY e.ordinality LOOP
  IF jsonb_typeof(a) IS DISTINCT FROM 'object' THEN CONTINUE; END IF;
  id:=CASE WHEN jsonb_typeof(a->'userId')='string' THEN a->>'userId' END;
  act:=CASE WHEN jsonb_typeof(a->'action')='string' THEN a->>'action' END;
  st:=CASE WHEN jsonb_typeof(a->'stage')='string' THEN a->>'stage' END;
  IF id IS NULL OR id='' THEN CONTINUE; END IF;
  IF st IS DISTINCT FROM 'preflop' THEN CONTINUE; END IF;
  -- The blind posts name the blinds (a dead blind names nobody).
  IF act IN ('sb','bb') AND (a->'dead') IS DISTINCT FROM 'true'::jsonb THEN
   IF act='sb' AND sb IS NULL THEN sb:=id; END IF;
   IF act='bb' AND bb IS NULL THEN bb:=id; END IF;
   CONTINUE;
  END IF;
  -- The pooled counters' admission (HorseOpponentExploit.learnablePublicAction): voluntary, never forced, and a
  -- fold only when it is attributed to the player, a pre-action or the Horse policy.
  IF act IS NULL OR act NOT IN ('fold','check','call','bet','raise','all_in') THEN CONTINUE; END IF;
  IF (a->'origin')='"forced"'::jsonb THEN CONTINUE; END IF;
  IF act='fold' AND NOT coalesce((a->'origin') IN ('"player"'::jsonb,'"pre_action"'::jsonb,'"horse_policy"'::jsonb),false) THEN CONTINUE; END IF;
  IF NOT id=ANY(ord) THEN ord:=ord||id; END IF;
  ag:=act IN ('bet','raise') OR (act='all_in' AND coalesce((a->'isFullRaise')='true'::jsonb,false));
  IF raises=2 AND id=opener AND three IS NOT NULL THEN
   -- His position against the 3-bettor after the flop (HorseOpenerAnswersThreeBet.openerActsLater).
   small:=sb; big:=bb; plist:=ord;
   IF small IS NOT NULL AND big IS NOT NULL THEN
    IF NOT small=ANY(plist) THEN plist:=plist||small; END IF;
    IF NOT big=ANY(plist) THEN plist:=plist||big; END IF;
   ELSE
    n:=coalesce(array_length(ord,1),0);
    IF n=2 THEN small:=ord[1]; big:=ord[2];
    ELSIF n>=3 THEN small:=ord[n-1]; big:=ord[n];
    ELSE small:=NULL; big:=NULL; END IF;
   END IF;
   others:=ARRAY(SELECT x FROM unnest(ord) WITH ORDINALITY u(x,i) WHERE x IS DISTINCT FROM small AND x IS DISTINCT FROM big ORDER BY i);
   IF coalesce(array_length(plist,1),0)=2 THEN
    ro:=CASE WHEN opener=small THEN 1 ELSE 0 END; rt:=CASE WHEN three=small THEN 1 ELSE 0 END;
   ELSE
    ro:=CASE WHEN opener=small THEN 0 WHEN opener=big THEN 1 ELSE 1+coalesce(array_position(others,opener),0) END;
    rt:=CASE WHEN three=small THEN 0 WHEN three=big THEN 1 ELSE 1+coalesce(array_position(others,three),0) END;
   END IF;
   node:=CASE WHEN ro>rt THEN 'inPosition' ELSE 'outOfPosition' END;
   ans:=CASE WHEN act='fold' THEN 'fold' WHEN ag THEN 'raise' ELSE 'call' END;
   RETURN jsonb_build_object(id,jsonb_build_object('inPosition',zero,'outOfPosition',zero)
     ||jsonb_build_object(node,(zero||jsonb_build_object('opp',1))||jsonb_build_object(ans,1)));
  END IF;
  IF ag THEN
   raises:=raises+1;
   IF raises=1 THEN opener:=id;
   ELSIF raises=2 THEN
    IF id=opener THEN RETURN '{}'::jsonb; END IF;
    three:=id;
   ELSE RETURN '{}'::jsonb; END IF;
  END IF;
 END LOOP;
 RETURN '{}'::jsonb;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_horse_opener_response_add(p_base jsonb,p_delta jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE
 decay constant double precision:=power(0.5::double precision,1.0/30);
 node text; f text; learned boolean:=false; out_node jsonb; res jsonb:='{}';
 b double precision; d double precision; d_opp double precision;
BEGIN
 IF p_delta IS NULL OR jsonb_typeof(p_delta) IS DISTINCT FROM 'object' THEN RETURN p_base; END IF;
 FOREACH node IN ARRAY ARRAY['inPosition','outOfPosition'] LOOP
  d_opp:=CASE WHEN jsonb_typeof(p_delta#>ARRAY[node,'opp'])='number' AND abs((p_delta#>>ARRAY[node,'opp'])::numeric)<1e12 THEN (p_delta#>>ARRAY[node,'opp'])::double precision ELSE 0 END;
  out_node:='{}';
  FOREACH f IN ARRAY ARRAY['opp','fold','call','raise'] LOOP
   -- Only a JSON number under 1e12 in size is read; anything else in a stored or supplied field counts as 0, so a
   -- damaged record can never raise inside the accepted-hand transaction.
   b:=CASE WHEN jsonb_typeof(p_base#>ARRAY[node,f])='number' AND abs((p_base#>>ARRAY[node,f])::numeric)<1e12 THEN (p_base#>>ARRAY[node,f])::double precision ELSE 0 END;
   d:=CASE WHEN jsonb_typeof(p_delta#>ARRAY[node,f])='number' AND abs((p_delta#>>ARRAY[node,f])::numeric)<1e12 THEN (p_delta#>>ARRAY[node,f])::double precision ELSE 0 END;
   -- A cell ages only on a hand that gave it an opportunity.
   IF d_opp>0 THEN learned:=true; b:=b*decay+d; END IF;
   out_node:=out_node||jsonb_build_object(f,b);
  END LOOP;
  res:=res||jsonb_build_object(node,out_node);
 END LOOP;
 -- A hand that gave him no opportunity in either cell leaves the record exactly as it was.
 IF NOT learned THEN RETURN p_base; END IF;
 RETURN res;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_horse_opener_response_increments(jsonb),public.fn_horse_opener_response_add(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE item record; def text; signature regprocedure;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('public.fn_horse_exact_accept_hand()', $a$street_read_inc jsonb; reraise_response_inc jsonb; flop_shown_inc jsonb; street_price_inc jsonb;$a$,
   $b$street_read_inc jsonb; reraise_response_inc jsonb; flop_shown_inc jsonb; street_price_inc jsonb; opener_response_inc jsonb;$b$),
  ('public.fn_horse_exact_accept_hand()', $a$reraise_response_inc:=public.fn_horse_reraise_response_increments(h.actions);$a$,
   $b$reraise_response_inc:=public.fn_horse_reraise_response_increments(h.actions);
 opener_response_inc:=CASE WHEN h.game_variant IN ('nlh','plo4','plo5') THEN public.fn_horse_opener_response_increments(h.actions) END;$b$),
  ('public.fn_horse_exact_accept_hand()', $a$observed_hands,initialized,long_counters,shown_river,street_counters,reraise_response,flop_shown,street_counters_price)$a$,
   $b$observed_hands,initialized,long_counters,shown_river,street_counters,reraise_response,flop_shown,street_counters_price,opener_response)$b$),
  ('public.fn_horse_exact_accept_hand()', $a$public.fn_horse_street_price_add(NULL,street_price_inc->actor.key))$a$,
   $b$public.fn_horse_street_price_add(NULL,street_price_inc->actor.key),public.fn_horse_opener_response_add(NULL,opener_response_inc->actor.key))$b$),
  ('public.fn_horse_exact_accept_hand()', $a$street_counters_price=public.fn_horse_street_price_add(horse_exact_profiles.street_counters_price,street_price_inc->actor.key),$a$,
   $b$street_counters_price=public.fn_horse_street_price_add(horse_exact_profiles.street_counters_price,street_price_inc->actor.key),opener_response=public.fn_horse_opener_response_add(horse_exact_profiles.opener_response,opener_response_inc->actor.key),$b$)
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
