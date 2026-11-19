-- @install-window: daily-maintenance
-- @locks: public.horse_exact_profiles
-- @live-proof: (SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.horse_exact_profiles') AND attname='reraise_response' AND atttypid='jsonb'::regtype AND NOT attisdropped) AND strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_exact_accept_hand()')), 'reraise_response=public.fn_horse_reraise_response_add(horse_exact_profiles.reraise_response,reraise_response_inc->actor.key)')>0 AND strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_exact_accept_hand()')), 'reraise_response_inc:=public.fn_horse_reraise_response_increments(h.actions);')>0)
-- 20261118023000_exact_profile_keeps_reraiser_answers.sql
--
-- WHAT THIS CHANGES, AND WHY:
--
-- The exact opponent profile (horse_exact_profiles.counters) keeps how often a
-- player re-raises before the flop (threeBet / threeBetOpp) and how an OPENER
-- answers a re-raise (foldTo3Bet). It keeps nothing about a RE-RAISER whose own
-- re-raise is raised again. That is the number a priced 4-bet or 5-bet needs:
-- how often the player a Horse would raise folds, calls or raises back. The
-- WooWoo 48-hour audit (CALL-VS-RAISE, 2026-11-18) had to take it from an
-- offline hand export: one player folded 0 of 77 such spots while the Horse
-- population folded 0.65 of theirs, so a prior alone credits fold equity that
-- is not there.
--
-- This file gives the exact profile that record, written by the same
-- accepted-hand learner that keeps its counters. Read only by the default-OFF
-- engine option omahaReraisedCallVsRaisePriced.
--   - a new nullable column reraise_response jsonb, two nodes of
--     {opp, fold, call, raise}:
--       {"threeBetFacesFourBet": he made the second raise of the preflop street, exactly one more raise
--                                followed (another player), and he acted
--        "fourBetFacesFiveBet":  he made the third raise or a later one, exactly one more raise followed,
--                                and he acted}
--   - fn_horse_reraise_response_increments(actions): per player with an
--     opportunity, that hand's nodes, replayed from the public action log
--     exactly as HorseOmahaReraiseResponse.reraiseResponseHandIncrements does.
--     The same admission as the pooled counters (voluntary, attributed, never
--     forced). At most one opportunity per player per node per hand. A raise
--     is a bet, a raise or a full-raise all-in; any other continuing action is
--     a call.
--   - fn_horse_reraise_response_add(base, delta): a node ages only on a hand
--     that gave it an opportunity, by 2^(-1/30) (the half-life of the
--     opportunity-gated preflop counters), then takes that hand's counts. A
--     hand that gave the player no opportunity leaves the record exactly as it
--     was (NULL stays NULL). HorseOmahaReraiseResponse.addReraiseResponseEvidence
--     is the engine's twin.
--   - fn_horse_exact_accept_hand writes it beside counters, long_counters,
--     shown_river and street_counters on the insert and on the conflict update.
--     Patched by exact preimage fragments like 20261117175407.
--
-- PUBLIC INFORMATION ONLY. The functions read the hand's public action log.
-- They are never passed hole cards, board cards or the showdown.
--
-- FORWARD ONLY. No back-fill, no replay of history, no reset: every existing
-- row keeps reraise_response NULL until its owner's first accepted hand with
-- such an opportunity after install. The engine reads a NULL, absent or
-- malformed record as absent, so either the engine or this file may be
-- installed first. The read RPC returns SETOF horse_exact_profiles and so
-- returns the column; the boot read selects every column.
--
-- PREREQUISITE: 20261117175407 (the street read). Its fragments are this
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
 IF to_regprocedure('public.fn_horse_street_read_add(jsonb,jsonb)') IS NULL
    OR strpos(pg_get_functiondef('public.fn_horse_exact_accept_hand()'::regprocedure),'street_counters=public.fn_horse_street_read_add(')=0 THEN
  RAISE EXCEPTION 'the re-raise response record needs 20261117175407 (the street read) installed first';
 END IF;
END $prerequisite$;

ALTER TABLE public.horse_exact_profiles ADD COLUMN IF NOT EXISTS reraise_response jsonb;

CREATE OR REPLACE FUNCTION public.fn_horse_reraise_response_increments(p_actions jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE
 a jsonb; id text; act text; st text; ag boolean; mine int; node text; k text; cur jsonb; ans text;
 raises int:=0; own jsonb:='{}'; seen jsonb:='{}'; res jsonb:='{}';
 zero constant jsonb:='{"opp":0,"fold":0,"call":0,"raise":0}';
BEGIN
 IF jsonb_typeof(p_actions) IS DISTINCT FROM 'array' THEN RETURN res; END IF;
 FOR a IN SELECT e.value FROM jsonb_array_elements(p_actions) WITH ORDINALITY e ORDER BY e.ordinality LOOP
  IF jsonb_typeof(a) IS DISTINCT FROM 'object' THEN CONTINUE; END IF;
  id:=CASE WHEN jsonb_typeof(a->'userId')='string' THEN a->>'userId' END;
  act:=CASE WHEN jsonb_typeof(a->'action')='string' THEN a->>'action' END;
  st:=CASE WHEN jsonb_typeof(a->'stage')='string' THEN a->>'stage' END;
  IF id IS NULL OR id='' THEN CONTINUE; END IF;
  -- The pooled counters' admission (HorseOpponentExploit.learnablePublicAction): voluntary, never forced, and a
  -- fold only when it is attributed to the player, a pre-action or the Horse policy.
  IF act IS NULL OR act NOT IN ('fold','check','call','bet','raise','all_in') THEN CONTINUE; END IF;
  IF (a->'origin')='"forced"'::jsonb THEN CONTINUE; END IF;
  IF act='fold' AND NOT coalesce((a->'origin') IN ('"player"'::jsonb,'"pre_action"'::jsonb,'"horse_policy"'::jsonb),false) THEN CONTINUE; END IF;
  IF st IS DISTINCT FROM 'preflop' THEN CONTINUE; END IF;
  ag:=act IN ('bet','raise') OR (act='all_in' AND coalesce((a->'isFullRaise')='true'::jsonb,false));
  IF own ? id THEN
   -- His first action after his own raise consumes it; it is an opportunity only when exactly one more raise
   -- has been made since.
   mine:=(own->>id)::int; own:=own-id;
   IF mine>=2 AND raises=mine+1 THEN
    node:=CASE WHEN mine=2 THEN 'threeBetFacesFourBet' ELSE 'fourBetFacesFiveBet' END;
    k:=node||':'||id;
    IF NOT seen ? k THEN
     seen:=seen||jsonb_build_object(k,true);
     ans:=CASE WHEN act='fold' THEN 'fold' WHEN ag THEN 'raise' ELSE 'call' END;
     cur:=coalesce(res->id,jsonb_build_object('threeBetFacesFourBet',zero,'fourBetFacesFiveBet',zero));
     cur:=jsonb_set(cur,ARRAY[node],(zero||jsonb_build_object('opp',1))||jsonb_build_object(ans,1));
     res:=res||jsonb_build_object(id,cur);
    END IF;
   END IF;
  END IF;
  IF ag THEN raises:=raises+1; own:=own||jsonb_build_object(id,raises); END IF;
 END LOOP;
 RETURN res;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_horse_reraise_response_add(p_base jsonb,p_delta jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE
 decay constant double precision:=power(0.5::double precision,1.0/30);
 node text; f text; learned boolean:=false; out_node jsonb; res jsonb:='{}';
 b double precision; d double precision; d_opp double precision;
BEGIN
 IF p_delta IS NULL OR jsonb_typeof(p_delta) IS DISTINCT FROM 'object' THEN RETURN p_base; END IF;
 FOREACH node IN ARRAY ARRAY['threeBetFacesFourBet','fourBetFacesFiveBet'] LOOP
  d_opp:=CASE WHEN jsonb_typeof(p_delta#>ARRAY[node,'opp'])='number' THEN (p_delta#>>ARRAY[node,'opp'])::double precision ELSE 0 END;
  out_node:='{}';
  FOREACH f IN ARRAY ARRAY['opp','fold','call','raise'] LOOP
   -- Only a JSON number is read; anything else in a stored or supplied field counts as 0, so a damaged record
   -- can never raise inside the accepted-hand transaction.
   b:=CASE WHEN jsonb_typeof(p_base#>ARRAY[node,f])='number' THEN (p_base#>>ARRAY[node,f])::double precision ELSE 0 END;
   d:=CASE WHEN jsonb_typeof(p_delta#>ARRAY[node,f])='number' THEN (p_delta#>>ARRAY[node,f])::double precision ELSE 0 END;
   -- A node ages only on a hand that gave it an opportunity.
   IF d_opp>0 THEN learned:=true; b:=b*decay+d; END IF;
   out_node:=out_node||jsonb_build_object(f,b);
  END LOOP;
  res:=res||jsonb_build_object(node,out_node);
 END LOOP;
 -- A hand that gave him no opportunity in either node leaves the record exactly as it was.
 IF NOT learned THEN RETURN p_base; END IF;
 RETURN res;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_horse_reraise_response_increments(jsonb),public.fn_horse_reraise_response_add(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE item record; def text; signature regprocedure;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('public.fn_horse_exact_accept_hand()', $a$shown_river_at bigint; street_read_inc jsonb;$a$,
   $b$shown_river_at bigint; street_read_inc jsonb; reraise_response_inc jsonb;$b$),
  ('public.fn_horse_exact_accept_hand()', $a$street_read_inc:=public.fn_horse_street_read_increments(h.actions,h.community_cards,h.community_cards2);$a$,
   $b$street_read_inc:=public.fn_horse_street_read_increments(h.actions,h.community_cards,h.community_cards2);
 reraise_response_inc:=public.fn_horse_reraise_response_increments(h.actions);$b$),
  ('public.fn_horse_exact_accept_hand()', $a$observed_hands,initialized,long_counters,shown_river,street_counters)$a$,
   $b$observed_hands,initialized,long_counters,shown_river,street_counters,reraise_response)$b$),
  ('public.fn_horse_exact_accept_hand()', $a$public.fn_horse_street_read_add(NULL,street_read_inc->actor.key))$a$,
   $b$public.fn_horse_street_read_add(NULL,street_read_inc->actor.key),public.fn_horse_reraise_response_add(NULL,reraise_response_inc->actor.key))$b$),
  ('public.fn_horse_exact_accept_hand()', $a$street_counters=public.fn_horse_street_read_add(horse_exact_profiles.street_counters,street_read_inc->actor.key),$a$,
   $b$street_counters=public.fn_horse_street_read_add(horse_exact_profiles.street_counters,street_read_inc->actor.key),reraise_response=public.fn_horse_reraise_response_add(horse_exact_profiles.reraise_response,reraise_response_inc->actor.key),$b$)
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
