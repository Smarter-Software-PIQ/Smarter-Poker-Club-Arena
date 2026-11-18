-- @install-window: daily-maintenance
-- @locks: public.horse_exact_profiles
-- @live-proof: (SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.horse_exact_profiles') AND attname='street_counters' AND atttypid='jsonb'::regtype AND NOT attisdropped) AND strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_exact_accept_hand()')), 'street_counters=public.fn_horse_street_read_add(horse_exact_profiles.street_counters,street_read_inc->actor.key)')>0 AND strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_exact_accept_hand()')), 'street_read_inc:=public.fn_horse_street_read_increments(h.actions,h.community_cards,h.community_cards2);')>0)
-- 20261117175407_the_exact_opponent_profile_keeps_a_postflop_read_by_street_a.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- The exact opponent profile (horse_exact_profiles.counters) keeps ONE pooled
-- postflop bet rate and ONE pooled fold-to-a-bet rate: flop, turn and river
-- together, every flop texture, aggressor or not. A player who bets most flops
-- and then slows down has a moderate pooled rate and carries one label on
-- every street. An audit of 721 live Omaha hands measured the halves apart:
-- one regular's bets on paired boards were trips or better 60 / 77 / 72
-- percent of the time by street, while on unpaired flops more than half were a
-- draw or one pair.
--
-- This file gives the exact profile a read that keeps them apart, written by
-- the same accepted-hand learner that keeps its counters. MEASUREMENT ONLY: no
-- Horse decision reads it. The engine change that ships with this file only
-- carries the record to the decision workers.
--   - a new nullable column street_counters jsonb, 17 cells of {hit, opp}:
--       {"bet":         {"flop","turn","river"},   acted with no bet yet on that street, and bet
--        "foldToBet":   {"flop","turn","river"},   faced another player's bet or raise, and folded
--        "foldToRaise": {"flop","turn","river"},   had bet or raised, was raised, and folded
--        "cbet":    {"paired","rainbow","twoTone","monotone"},  last preflop raiser, no bet yet on the flop, and bet
--        "flopBet": {"paired","rainbow","twoTone","monotone"}}  anyone, no bet yet on the flop, and bet
--   - fn_horse_flop_texture(community_cards, community_cards2): the texture of
--     the one flop every seat saw (paired when any rank repeats, else monotone
--     / twoTone / rainbow by suits), NULL when there are fewer than three
--     cards, a card is not written as the history writes it, or a second board
--     has a different flop (a double-board hand has no single texture; its
--     street cells are still learned). HorseOmahaStreetRead.publicFlopOfHistory
--     and flopTextureOf are the engine's twin.
--   - fn_horse_street_read_increments(actions, community_cards,
--     community_cards2): per player, that hand's cells, replayed from the
--     public action log exactly as HorseOmahaStreetRead.streetReadHandIncrements
--     does. The same admission as the pooled counters (voluntary, attributed,
--     never forced). At most one opportunity per player per cell per hand. The
--     last preflop raiser is the last admitted bet, raise or full-raise all-in
--     of the preflop street in that same log.
--   - fn_horse_street_read_add(base, delta): a cell ages only on a hand that
--     gave it an opportunity, by 2^(-1/30) (a half-life of 30 opportunities),
--     then takes that hand's hit and opportunity. A hand that gave the player
--     no opportunity leaves the record exactly as it was (NULL stays NULL).
--     HorseOmahaStreetRead.addStreetReadEvidence is the engine's twin.
--   - fn_horse_exact_accept_hand writes it beside counters, long_counters and
--     shown_river on the insert and on the conflict update, for the actors the
--     reducer learns. Patched by exact preimage fragments like 20261115144258.
--
-- PUBLIC INFORMATION ONLY. The functions read the hand's public action log and
-- its board cards. They are never passed hole cards or the showdown, and no
-- cell depends on what anyone held.
--
-- FORWARD ONLY. No back-fill, no replay of history, no reset: every existing
-- row keeps street_counters NULL until its owner's first accepted hand with a
-- postflop opportunity after install, from which the cells accumulate. The
-- engine reads a NULL or malformed record as absent, so either the engine or
-- this file may be installed first. The read RPC returns SETOF
-- horse_exact_profiles and so returns the column; the boot read selects every
-- column.
--
-- PREREQUISITE: 20261115144258 (the shown river record). Its fragments are
-- this file's anchors; without it this file refuses loudly and rolls back.
-- hand_history.community_cards and community_cards2 (text[]) are asserted too.
--
-- ADD COLUMN with no default is a catalog-only change but takes ACCESS
-- EXCLUSIVE on horse_exact_profiles, which every accepted hand writes, and the
-- accepted-hand trigger function is replaced: the daily-maintenance window,
-- one 1 s lock request.

BEGIN;
SET LOCAL lock_timeout='1s';

DO $prerequisite$
BEGIN
 IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.hand_history'::regclass
      AND attname IN ('community_cards','community_cards2') AND atttypid='text[]'::regtype AND NOT attisdropped)<>2 THEN
  RAISE EXCEPTION 'the street read needs hand_history.community_cards and community_cards2 (text[])';
 END IF;
 IF to_regprocedure('public.fn_horse_shown_river_add(jsonb,jsonb,bigint)') IS NULL
    OR strpos(pg_get_functiondef('public.fn_horse_exact_accept_hand()'::regprocedure),'shown_river=public.fn_horse_shown_river_add(')=0 THEN
  RAISE EXCEPTION 'the street read needs 20261115144258 (the shown river record) installed first';
 END IF;
END $prerequisite$;

ALTER TABLE public.horse_exact_profiles ADD COLUMN IF NOT EXISTS street_counters jsonb;

CREATE OR REPLACE FUNCTION public.fn_horse_flop_texture(p_community_cards text[],p_community_cards2 text[])
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
 SELECT CASE
  WHEN coalesce(cardinality(p_community_cards),0)<3 THEN NULL
  -- A second board with its own flop: two flops, no single texture.
  WHEN coalesce(cardinality(p_community_cards2),0)>0
       AND p_community_cards2[1:3] IS DISTINCT FROM p_community_cards[1:3] THEN NULL
  WHEN EXISTS (SELECT 1 FROM unnest(p_community_cards[1:3]) c
               WHERE c IS NULL OR c !~ '^[2-9TJQKA](spades|hearts|diamonds|clubs)$') THEN NULL
  WHEN (SELECT count(DISTINCT left(c,1)) FROM unnest(p_community_cards[1:3]) c)<3 THEN 'paired'
  ELSE CASE (SELECT count(DISTINCT substr(c,2)) FROM unnest(p_community_cards[1:3]) c)
        WHEN 1 THEN 'monotone' WHEN 2 THEN 'twoTone' ELSE 'rainbow' END
 END
$fn$;

CREATE OR REPLACE FUNCTION public.fn_horse_street_read_increments(p_actions jsonb,p_community_cards text[],p_community_cards2 text[])
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE
 a jsonb; id text; act text; st text; ag boolean; texture text;
 street text; bettor text; last_raiser text; k text; u text; t text; flop_cell jsonb;
 wagered jsonb:='{}'; seen jsonb:='{}'; cbet jsonb:='{}'; users jsonb:='{}'; res jsonb:='{}';
 zero constant jsonb:='{"hit":0,"opp":0}';
 by_street jsonb; by_fold jsonb; by_raise jsonb; by_cbet jsonb; by_flop jsonb;
BEGIN
 IF jsonb_typeof(p_actions) IS DISTINCT FROM 'array' THEN RETURN res; END IF;
 texture:=public.fn_horse_flop_texture(p_community_cards,p_community_cards2);
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
  ag:=act IN ('bet','raise') OR (act='all_in' AND coalesce((a->'isFullRaise')='true'::jsonb,false));
  IF st='preflop' THEN
   IF ag THEN last_raiser:=id; END IF;
   CONTINUE;
  END IF;
  IF st IS NULL OR st NOT IN ('flop','turn','river') THEN CONTINUE; END IF;
  IF st IS DISTINCT FROM street THEN street:=st; bettor:=NULL; wagered:='{}'; END IF;
  users:=users||jsonb_build_object(id,true);
  IF bettor IS NULL THEN
   -- No bet yet on this street: an opportunity to bet (a fold here is not one).
   k:='bet:'||street||':'||id;
   IF act<>'fold' AND NOT seen ? k THEN
    seen:=seen||jsonb_build_object(k,ag);
    IF street='flop' AND last_raiser IS NOT DISTINCT FROM id THEN cbet:=cbet||jsonb_build_object(id,true); END IF;
   END IF;
  ELSIF bettor<>id THEN
   IF wagered ? id THEN
    -- He had bet or raised on this street and now faces a raise.
    k:='ftr:'||street||':'||id;
    IF NOT seen ? k THEN seen:=seen||jsonb_build_object(k,act='fold'); END IF;
   ELSE
    k:='ftb:'||street||':'||id;
    IF NOT seen ? k THEN seen:=seen||jsonb_build_object(k,act='fold'); END IF;
   END IF;
  END IF;
  IF ag THEN bettor:=id; wagered:=wagered||jsonb_build_object(id,true); END IF;
 END LOOP;
 FOR u IN SELECT jsonb_object_keys(users) LOOP
  by_street:='{}'; by_fold:='{}'; by_raise:='{}'; by_cbet:='{}'; by_flop:='{}';
  FOREACH t IN ARRAY ARRAY['flop','turn','river'] LOOP
   by_street:=by_street||jsonb_build_object(t,CASE WHEN seen ? ('bet:'||t||':'||u)
     THEN jsonb_build_object('hit',CASE WHEN seen->('bet:'||t||':'||u)='true'::jsonb THEN 1 ELSE 0 END,'opp',1) ELSE zero END);
   by_fold:=by_fold||jsonb_build_object(t,CASE WHEN seen ? ('ftb:'||t||':'||u)
     THEN jsonb_build_object('hit',CASE WHEN seen->('ftb:'||t||':'||u)='true'::jsonb THEN 1 ELSE 0 END,'opp',1) ELSE zero END);
   by_raise:=by_raise||jsonb_build_object(t,CASE WHEN seen ? ('ftr:'||t||':'||u)
     THEN jsonb_build_object('hit',CASE WHEN seen->('ftr:'||t||':'||u)='true'::jsonb THEN 1 ELSE 0 END,'opp',1) ELSE zero END);
  END LOOP;
  flop_cell:=by_street->'flop';
  FOREACH t IN ARRAY ARRAY['paired','rainbow','twoTone','monotone'] LOOP
   by_flop:=by_flop||jsonb_build_object(t,CASE WHEN texture IS NOT DISTINCT FROM t THEN flop_cell ELSE zero END);
   by_cbet:=by_cbet||jsonb_build_object(t,CASE WHEN texture IS NOT DISTINCT FROM t AND cbet ? u THEN flop_cell ELSE zero END);
  END LOOP;
  res:=res||jsonb_build_object(u,jsonb_build_object('bet',by_street,'foldToBet',by_fold,'foldToRaise',by_raise,'cbet',by_cbet,'flopBet',by_flop));
 END LOOP;
 RETURN res;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_horse_street_read_add(p_base jsonb,p_delta jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE
 decay constant double precision:=power(0.5::double precision,1.0/30);
 stat text; cell_key text; keys text[]; learned boolean:=false; out_stat jsonb; res jsonb:='{}';
 bh double precision; bo double precision; dh double precision; d_opp double precision;
BEGIN
 IF p_delta IS NULL OR jsonb_typeof(p_delta) IS DISTINCT FROM 'object' THEN RETURN p_base; END IF;
 FOREACH stat IN ARRAY ARRAY['bet','foldToBet','foldToRaise','cbet','flopBet'] LOOP
  keys:=CASE WHEN stat IN ('cbet','flopBet') THEN ARRAY['paired','rainbow','twoTone','monotone'] ELSE ARRAY['flop','turn','river'] END;
  out_stat:='{}';
  FOREACH cell_key IN ARRAY keys LOOP
   -- Only a JSON number is read; anything else in a stored or supplied cell counts as 0, so a damaged record
   -- can never raise inside the accepted-hand transaction.
   bh:=CASE WHEN jsonb_typeof(p_base#>ARRAY[stat,cell_key,'hit'])='number' THEN (p_base#>>ARRAY[stat,cell_key,'hit'])::double precision ELSE 0 END;
   bo:=CASE WHEN jsonb_typeof(p_base#>ARRAY[stat,cell_key,'opp'])='number' THEN (p_base#>>ARRAY[stat,cell_key,'opp'])::double precision ELSE 0 END;
   dh:=CASE WHEN jsonb_typeof(p_delta#>ARRAY[stat,cell_key,'hit'])='number' THEN (p_delta#>>ARRAY[stat,cell_key,'hit'])::double precision ELSE 0 END;
   d_opp:=CASE WHEN jsonb_typeof(p_delta#>ARRAY[stat,cell_key,'opp'])='number' THEN (p_delta#>>ARRAY[stat,cell_key,'opp'])::double precision ELSE 0 END;
   -- A cell ages only on a hand that gave it an opportunity.
   IF d_opp>0 THEN learned:=true; bh:=bh*decay+dh; bo:=bo*decay+d_opp; END IF;
   out_stat:=out_stat||jsonb_build_object(cell_key,jsonb_build_object('hit',bh,'opp',bo));
  END LOOP;
  res:=res||jsonb_build_object(stat,out_stat);
 END LOOP;
 -- A hand that gave him no opportunity in any cell leaves the record exactly as it was.
 IF NOT learned THEN RETURN p_base; END IF;
 RETURN res;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_horse_flop_texture(text[],text[]),public.fn_horse_street_read_increments(jsonb,text[],text[]),public.fn_horse_street_read_add(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE item record; def text; signature regprocedure;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('public.fn_horse_exact_accept_hand()', $a$sz text; shown_river_inc jsonb; shown_river_at bigint;$a$,
   $b$sz text; shown_river_inc jsonb; shown_river_at bigint; street_read_inc jsonb;$b$),
  ('public.fn_horse_exact_accept_hand()', $a$shown_river_at:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;$a$,
   $b$shown_river_at:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 street_read_inc:=public.fn_horse_street_read_increments(h.actions,h.community_cards,h.community_cards2);$b$),
  ('public.fn_horse_exact_accept_hand()', $a$observed_hands,initialized,long_counters,shown_river)$a$,
   $b$observed_hands,initialized,long_counters,shown_river,street_counters)$b$),
  ('public.fn_horse_exact_accept_hand()', $a$public.fn_horse_shown_river_add(NULL,shown_river_inc->actor.key,shown_river_at))$a$,
   $b$public.fn_horse_shown_river_add(NULL,shown_river_inc->actor.key,shown_river_at),public.fn_horse_street_read_add(NULL,street_read_inc->actor.key))$b$),
  ('public.fn_horse_exact_accept_hand()', $a$shown_river=public.fn_horse_shown_river_add(horse_exact_profiles.shown_river,shown_river_inc->actor.key,shown_river_at),$a$,
   $b$shown_river=public.fn_horse_shown_river_add(horse_exact_profiles.shown_river,shown_river_inc->actor.key,shown_river_at),street_counters=public.fn_horse_street_read_add(horse_exact_profiles.street_counters,street_read_inc->actor.key),$b$)
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
