-- @install-window: daily-maintenance
-- @locks: public.horse_exact_profiles
-- @live-proof: (SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.horse_exact_profiles') AND attname='postflop_bets' AND atttypid='jsonb'::regtype AND NOT attisdropped) AND strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_exact_accept_hand()')), 'postflop_bets_inc:=CASE WHEN h.game_variant=''nlh'' THEN public.fn_horse_postflop_bets_increments(h.actions,h.showdown) END;')>0 AND strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_exact_accept_hand()')), 'postflop_bets=public.fn_horse_postflop_bets_add(horse_exact_profiles.postflop_bets,postflop_bets_inc->actor.key),')>0)
-- 20261126021624_exact_profile_keeps_his_postflop_raises_and_shown_bets.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Two Hold'em options need a per-opponent public record the exact profile does
-- not keep (2026-11-25, PLO-OWNER lead-7):
--   - the priced value bet (holdemOpeningValueBetIsPriced) lost heads-up because
--     the opponent's RAISE of the new bet was not priced, and no record of how
--     often he raises a postflop bet exists (the street read keeps folds only);
--   - "call more only against a measured over-bluffer" needs how many of his
--     called bets that were SHOWN were air; the only showdown record, the
--     big-bet tally, counts one-pair value as not strong.
--
-- This file gives the exact profile one nullable column postflop_bets jsonb:
--   {"raiseToBet": {flop|turn|river: {opp, raise}},
--    "shownBet":   {flop|turn|river: {small|medium|large|overbet: {called, shown, air}}}}
-- written by the accepted-hand learner for nlh hands only:
--   - fn_horse_postflop_bets_increments(actions, showdown): one hand's counts,
--     replayed from the public action log and the public showdown list exactly
--     as HorsePostflopBetRecord.postflopBetHandIncrements does:
--       raiseToBet: he acts on a street where another player has wagered and he
--         has not wagered on it yet (one opportunity per player per street);
--         raise = a bet, a raise or a full-raise all-in.
--       shownBet: his first wager of a street made when nobody had wagered
--         on that street, called by another player before any raise;
--         size bucket = that wager over the pot before it (the shown-river
--         buckets, the pot summed as fn_horse_shown_river_increments sums it);
--         shown = the showdown list names him and he did not muck; air = shown
--         and the hand name is "high card".
--     The same admission as the pooled counters for every action that decides
--     a cell (voluntary, attributed, never forced).
--   - fn_horse_postflop_bets_add(base, delta): a cell ages only on a hand that
--     gave it an opportunity (raiseToBet opp > 0; shownBet called > 0), by
--     2^(-1/30), then takes that hand's counts. A hand with no opportunity
--     leaves the record exactly as it was (NULL stays NULL).
--   - fn_horse_exact_accept_hand writes it beside the other records. Patched by
--     exact preimage fragments that no other open learner patch edits (the
--     DECLARE head, the line after the street read, "counters," in the column
--     list, "actor.value," in VALUES, the counters line of the update), so this
--     file and a sibling record patch install in either order.
--
-- PUBLIC INFORMATION ONLY: the public action log and the public showdown list
-- (who showed, mucked, the shown hand's name). No hole card is read, and a
-- mucked or folded hand is never classified.
--
-- FORWARD ONLY. No back-fill, no replay, no reset: every existing row keeps
-- postflop_bets NULL until its owner's first accepted NLH hand with such an
-- opportunity after install. The engine reads a NULL, absent or malformed
-- record as absent, so either side may be installed first.
--
-- PREREQUISITE: 20261119213206 (the learner hardening); without it this file
-- refuses loudly and rolls back.
--
-- ADD COLUMN with no default is catalog-only but takes ACCESS EXCLUSIVE on
-- horse_exact_profiles (written by every accepted hand), and the trigger
-- function is replaced: the daily-maintenance window, one 1 s lock request.

BEGIN;
SET LOCAL lock_timeout='1s';

DO $prerequisite$
BEGIN
 IF to_regprocedure('public.fn_horse_street_price_add(jsonb,jsonb)') IS NULL
    OR strpos(pg_get_functiondef('public.fn_horse_exact_accept_hand()'::regprocedure),'street_read_inc:=public.fn_horse_street_read_increments(h.actions,h.community_cards,h.community_cards2);')=0 THEN
  RAISE EXCEPTION 'the postflop bet record needs 20261119213206 (the learner hardening) installed first';
 END IF;
END $prerequisite$;

ALTER TABLE public.horse_exact_profiles ADD COLUMN IF NOT EXISTS postflop_bets jsonb;

CREATE OR REPLACE FUNCTION public.fn_horse_postflop_bets_empty()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
 SELECT jsonb_build_object(
  'raiseToBet',jsonb_build_object('flop','{"opp":0,"raise":0}'::jsonb,'turn','{"opp":0,"raise":0}'::jsonb,'river','{"opp":0,"raise":0}'::jsonb),
  'shownBet',jsonb_build_object(
    'flop',jsonb_build_object('small','{"called":0,"shown":0,"air":0}'::jsonb,'medium','{"called":0,"shown":0,"air":0}'::jsonb,'large','{"called":0,"shown":0,"air":0}'::jsonb,'overbet','{"called":0,"shown":0,"air":0}'::jsonb),
    'turn',jsonb_build_object('small','{"called":0,"shown":0,"air":0}'::jsonb,'medium','{"called":0,"shown":0,"air":0}'::jsonb,'large','{"called":0,"shown":0,"air":0}'::jsonb,'overbet','{"called":0,"shown":0,"air":0}'::jsonb),
    'river',jsonb_build_object('small','{"called":0,"shown":0,"air":0}'::jsonb,'medium','{"called":0,"shown":0,"air":0}'::jsonb,'large','{"called":0,"shown":0,"air":0}'::jsonb,'overbet','{"called":0,"shown":0,"air":0}'::jsonb)))
$fn$;

CREATE OR REPLACE FUNCTION public.fn_horse_postflop_bets_increments(p_actions jsonb,p_showdown jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE
 a jsonb; uid text; sid text; act text; st text; cur_stage text; fresh boolean:=true;
 pot double precision:=0; prev double precision; amt double precision; inc double precision; frac double precision;
 wager boolean; ag boolean; learnable boolean; street jsonb:='{}';
 wagered_by text; wagered jsonb:='{}'; seen jsonb:='{}'; res jsonb:='{}';
 open_id text; open_st text; open_b text; called jsonb:='[]'; c jsonb; sd jsonb; is_shown int; is_air int; cur jsonb;
BEGIN
 IF jsonb_typeof(p_actions) IS DISTINCT FROM 'array' THEN RETURN '{}'::jsonb; END IF;
 FOR a IN SELECT e.value FROM jsonb_array_elements(p_actions) WITH ORDINALITY e ORDER BY e.ordinality LOOP
  IF jsonb_typeof(a) IS DISTINCT FROM 'object' THEN CONTINUE; END IF;
  st:=CASE WHEN jsonb_typeof(a->'stage')='string' THEN a->>'stage' END;
  IF fresh OR st IS DISTINCT FROM cur_stage THEN
   cur_stage:=st; fresh:=false; street:='{}'; wagered_by:=NULL; wagered:='{}'; open_id:=NULL;
  END IF;
  uid:=CASE WHEN jsonb_typeof(a->'userId')='string' THEN a->>'userId' END;
  sid:=coalesce(uid,'');
  prev:=coalesce((street->>sid)::double precision,0);
  amt:=CASE WHEN jsonb_typeof(a->'amount')='number' AND abs((a->>'amount')::numeric)<1e15 THEN greatest(0,(a->>'amount')::double precision) ELSE 0 END;
  act:=CASE WHEN jsonb_typeof(a->'action')='string' THEN a->>'action' ELSE '' END;
  wager:=act IN ('bet','raise','all_in');
  inc:=CASE WHEN act IN ('fold','check') THEN 0 WHEN wager THEN greatest(0,amt-prev) ELSE amt END;
  -- The pooled counters' admission (HorseOpponentExploit.learnablePublicAction).
  learnable:=act IN ('fold','check','call','bet','raise','all_in')
   AND (a->'origin') IS DISTINCT FROM '"forced"'::jsonb
   AND (act<>'fold' OR coalesce((a->'origin') IN ('"player"'::jsonb,'"pre_action"'::jsonb,'"horse_policy"'::jsonb),false));
  IF st IN ('flop','turn','river') AND uid IS NOT NULL AND learnable THEN
   ag:=act IN ('bet','raise') OR (act='all_in' AND coalesce((a->'isFullRaise')='true'::jsonb,false));
   IF wagered_by IS NOT NULL AND wagered_by<>uid AND NOT wagered ? uid AND NOT seen ? (st||':'||uid) THEN
    seen:=seen||jsonb_build_object(st||':'||uid,true);
    cur:=coalesce(res->uid,public.fn_horse_postflop_bets_empty());
    cur:=jsonb_set(cur,ARRAY['raiseToBet',st],jsonb_build_object('opp',1,'raise',CASE WHEN ag THEN 1 ELSE 0 END));
    res:=res||jsonb_build_object(uid,cur);
   END IF;
   IF open_id IS NOT NULL AND uid<>open_id THEN
    IF ag THEN open_id:=NULL;
    ELSIF act='call' OR act='all_in' THEN
     called:=called||jsonb_build_array(jsonb_build_object('id',open_id,'st',open_st,'b',open_b));
     open_id:=NULL;
    END IF;
   END IF;
   IF ag AND wagered_by IS NULL AND inc>0 AND pot>0 THEN
    frac:=inc/pot;
    open_id:=uid; open_st:=st;
    open_b:=CASE WHEN frac<0.5 THEN 'small' WHEN frac<0.66 THEN 'medium' WHEN frac<=1 THEN 'large' ELSE 'overbet' END;
   END IF;
   IF ag THEN wagered_by:=uid; wagered:=wagered||jsonb_build_object(uid,true); END IF;
  END IF;
  pot:=pot+inc;
  street:=street||jsonb_build_object(sid,prev+inc);
 END LOOP;
 FOR c IN SELECT e.value FROM jsonb_array_elements(called) e LOOP
  sd:=NULL;
  IF jsonb_typeof(p_showdown)='array' THEN
   SELECT e.value INTO sd FROM jsonb_array_elements(p_showdown) WITH ORDINALITY e
    WHERE jsonb_typeof(e.value)='object' AND jsonb_typeof(e.value->'user_id')='string' AND e.value->>'user_id'=c->>'id'
    ORDER BY e.ordinality LIMIT 1;
  END IF;
  is_shown:=CASE WHEN sd IS NOT NULL AND (sd->'mucked') IS DISTINCT FROM 'true'::jsonb THEN 1 ELSE 0 END;
  is_air:=CASE WHEN is_shown=1 AND jsonb_typeof(sd->'hand_name')='string' AND lower(sd->>'hand_name')='high card' THEN 1 ELSE 0 END;
  cur:=coalesce(res->(c->>'id'),public.fn_horse_postflop_bets_empty());
  cur:=jsonb_set(cur,ARRAY['shownBet',c->>'st',c->>'b'],jsonb_build_object('called',1,'shown',is_shown,'air',is_air));
  res:=res||jsonb_build_object(c->>'id',cur);
 END LOOP;
 RETURN res;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_horse_postflop_bets_add(p_base jsonb,p_delta jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE
 decay constant double precision:=power(0.5::double precision,1.0/30);
 s text; b text; f text; learned boolean:=false; res jsonb; gate double precision; v double precision; d double precision;
BEGIN
 IF p_delta IS NULL OR jsonb_typeof(p_delta) IS DISTINCT FROM 'object' THEN RETURN p_base; END IF;
 res:=public.fn_horse_postflop_bets_empty();
 FOREACH s IN ARRAY ARRAY['flop','turn','river'] LOOP
  gate:=CASE WHEN jsonb_typeof(p_delta#>ARRAY['raiseToBet',s,'opp'])='number' AND abs((p_delta#>>ARRAY['raiseToBet',s,'opp'])::numeric)<1e12 THEN (p_delta#>>ARRAY['raiseToBet',s,'opp'])::double precision ELSE 0 END;
  FOREACH f IN ARRAY ARRAY['opp','raise'] LOOP
   -- Only a JSON number under 1e12 in size is read; anything else counts as 0, so a damaged record never raises.
   v:=CASE WHEN jsonb_typeof(p_base#>ARRAY['raiseToBet',s,f])='number' AND abs((p_base#>>ARRAY['raiseToBet',s,f])::numeric)<1e12 THEN (p_base#>>ARRAY['raiseToBet',s,f])::double precision ELSE 0 END;
   d:=CASE WHEN jsonb_typeof(p_delta#>ARRAY['raiseToBet',s,f])='number' AND abs((p_delta#>>ARRAY['raiseToBet',s,f])::numeric)<1e12 THEN (p_delta#>>ARRAY['raiseToBet',s,f])::double precision ELSE 0 END;
   IF gate>0 THEN learned:=true; v:=v*decay+d; END IF;
   res:=jsonb_set(res,ARRAY['raiseToBet',s,f],to_jsonb(v));
  END LOOP;
 END LOOP;
 FOREACH s IN ARRAY ARRAY['flop','turn','river'] LOOP
  FOREACH b IN ARRAY ARRAY['small','medium','large','overbet'] LOOP
   gate:=CASE WHEN jsonb_typeof(p_delta#>ARRAY['shownBet',s,b,'called'])='number' AND abs((p_delta#>>ARRAY['shownBet',s,b,'called'])::numeric)<1e12 THEN (p_delta#>>ARRAY['shownBet',s,b,'called'])::double precision ELSE 0 END;
   FOREACH f IN ARRAY ARRAY['called','shown','air'] LOOP
    v:=CASE WHEN jsonb_typeof(p_base#>ARRAY['shownBet',s,b,f])='number' AND abs((p_base#>>ARRAY['shownBet',s,b,f])::numeric)<1e12 THEN (p_base#>>ARRAY['shownBet',s,b,f])::double precision ELSE 0 END;
    d:=CASE WHEN jsonb_typeof(p_delta#>ARRAY['shownBet',s,b,f])='number' AND abs((p_delta#>>ARRAY['shownBet',s,b,f])::numeric)<1e12 THEN (p_delta#>>ARRAY['shownBet',s,b,f])::double precision ELSE 0 END;
    IF gate>0 THEN learned:=true; v:=v*decay+d; END IF;
    res:=jsonb_set(res,ARRAY['shownBet',s,b,f],to_jsonb(v));
   END LOOP;
  END LOOP;
 END LOOP;
 -- A hand that gave him no opportunity leaves the record exactly as it was.
 IF NOT learned THEN RETURN p_base; END IF;
 RETURN res;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_horse_postflop_bets_empty(),public.fn_horse_postflop_bets_increments(jsonb,jsonb),public.fn_horse_postflop_bets_add(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE item record; def text; signature regprocedure;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('public.fn_horse_exact_accept_hand()', $a$DECLARE actor record;$a$,
   $b$DECLARE actor record; postflop_bets_inc jsonb;$b$),
  ('public.fn_horse_exact_accept_hand()', $a$street_read_inc:=public.fn_horse_street_read_increments(h.actions,h.community_cards,h.community_cards2);$a$,
   $b$street_read_inc:=public.fn_horse_street_read_increments(h.actions,h.community_cards,h.community_cards2);
 postflop_bets_inc:=CASE WHEN h.game_variant='nlh' THEN public.fn_horse_postflop_bets_increments(h.actions,h.showdown) END;$b$),
  ('public.fn_horse_exact_accept_hand()', $a$public_memory_domain,counters,observed_hands$a$,
   $b$public_memory_domain,counters,postflop_bets,observed_hands$b$),
  ('public.fn_horse_exact_accept_hand()', $a$h.public_memory_domain,actor.value,1,true,$a$,
   $b$h.public_memory_domain,actor.value,public.fn_horse_postflop_bets_add(NULL,postflop_bets_inc->actor.key),1,true,$b$),
  ('public.fn_horse_exact_accept_hand()', $a$counters=public.fn_horse_exploit_add(horse_exact_profiles.counters,excluded.counters),$a$,
   $b$counters=public.fn_horse_exploit_add(horse_exact_profiles.counters,excluded.counters),postflop_bets=public.fn_horse_postflop_bets_add(horse_exact_profiles.postflop_bets,postflop_bets_inc->actor.key),$b$)
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
