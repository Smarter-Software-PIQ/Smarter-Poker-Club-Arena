-- @install-window: daily-maintenance
-- @locks: public.horse_exact_profiles
-- @live-proof: (SELECT strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_exact_accept_hand()')), 'IF h.game_variant IN (''plo4'',''plo5'',''plo6'',''plo8'',''flo8'') THEN')>0 AND to_regprocedure('public.fn_horse_flop_shown_wholes(jsonb,integer)') IS NOT NULL AND strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_flop_shown_add(jsonb,jsonb)')), 'public.fn_horse_flop_shown_wholes(')>0 AND strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_flop_shown_add(jsonb,jsonb)')), 'public.fn_horse_flop_shown_whole(')=0 AND strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_flop_shown_public_class(jsonb,jsonb,text,text[])')), '(sd->''mucked'') IS DISTINCT FROM ''false''::jsonb')>0 AND strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_street_price_add(jsonb,jsonb)')), 'fn_horse_street_price_number(')>0)
-- 20261119213206_the_flop_shown_learner_reads_omaha_only_shown_only_when_unmu.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Hardening of the accepted-hand learner that 20261119192551 added (the
-- flop-shown record and the fold-to-raise price record). Review notes N1, N2,
-- N4 and N6 of REVIEW-de83d3abf89 (archive plo-handoff-review-01a1cbbd/
-- flopshown-01TLQer7J). That file is not edited; this one replaces what it
-- defined. MEASUREMENT ONLY, as before: no Horse decision reads either record.
--
-- N1, ONE PASS. fn_horse_flop_shown_add read every stored and supplied number
-- through fn_horse_flop_shown_whole, 130 to 170 calls per learned hand, and
-- that helper carries SET search_path, so it is never inlined: a function
-- call with a GUC save and restore for every number. The add rule now reads
-- each of its four lists (stored bet, stored call, the hand's bet, the hand's
-- call) once with fn_horse_flop_shown_wholes(list, n), one pass in plain
-- PL/pgSQL expressions, and works on bigint arrays: four calls per hand.
-- The number rule is the same (a JSON integer of at most 1e9 in size,
-- anything else 0), so every result is identical; the parity vectors, the
-- 160-hand chain and a set of damaged inputs read before and after in
-- scripts/ci/test-horse-exact-public-memory.py run against this definition.
-- Measured on a scratch PG17 cluster on the shared Mac (interleaved, best of
-- 5 rounds of 300 calls, a realistic stored record): about 330 us per add
-- before, about 93 us after. fn_horse_flop_shown_whole is left as it was and
-- is no longer called.
--
-- N2, OMAHA ONLY. The record was learned for every variant. A Hold'em, short
-- deck or pineapple hand can never be classed (fewer than four hole cards),
-- so those rows took only `unshown` call cells, and street_counters_price,
-- that no reader takes: the decision transport carries both records for the
-- Omaha family only (HorseOmahaFlopShown.flopShownCarriedFor). The accepted-
-- hand learner now computes both increments only when the hand's variant is
-- one of plo4, plo5, plo6, plo8, flo8 (HorseOmahaFlopShown.
-- FLOP_SHOWN_LEARNED_VARIANTS: every variant the learner admits that the
-- transport carries). For any other game the increments stay NULL, and the
-- add rules return the stored value unchanged (NULL stays NULL). No work is
-- done for those hands at all.
--
-- N4, SHOWN MEANS mucked=false WRITTEN OUT. A showdown entry with no `mucked`
-- key read as shown. It now reads as shown only when `mucked` is the JSON
-- boolean false; a missing key, null, a string or anything else is not shown.
-- HorseOmahaFlopShown's publicHoleCards is the twin (entry.mucked !== false).
--
-- N6, FLOAT GUARD. fn_horse_street_price_add cast a stored JSON number to
-- float8 with no magnitude guard: a hand-edited value beyond float8 (1e400 is
-- a valid jsonb number) would raise inside the accepted-hand transaction. A
-- number is now read only under 1e12 in size, through
-- fn_horse_street_price_number; anything else counts as 0.
-- HorseOmahaStreetReadPrice.addStreetPriceEvidence is the twin.
--
-- PREREQUISITE: 20261119192551. Without its functions and its fragments in
-- fn_horse_exact_accept_hand this file refuses loudly and rolls back.
--
-- No column, no row, no back-fill: functions only, plus the accepted-hand
-- trigger function patched by one exact preimage fragment. Declared for the
-- daily-maintenance window with the same @locks as 20261119192551 so that the
-- installer sends it after that file, never before it (an undeclared file is
-- sent first and would be refused by the prerequisite).

BEGIN;
SET LOCAL lock_timeout='1s';

DO $prerequisite$
BEGIN
 IF to_regprocedure('public.fn_horse_flop_shown_add(jsonb,jsonb)') IS NULL
    OR to_regprocedure('public.fn_horse_flop_shown_public_class(jsonb,jsonb,text,text[])') IS NULL
    OR to_regprocedure('public.fn_horse_street_price_add(jsonb,jsonb)') IS NULL
    OR strpos(pg_get_functiondef('public.fn_horse_exact_accept_hand()'::regprocedure),'flop_shown=public.fn_horse_flop_shown_add(horse_exact_profiles.flop_shown,flop_shown_inc->actor.key)')=0
    OR strpos(pg_get_functiondef('public.fn_horse_exact_accept_hand()'::regprocedure),'street_counters_price=public.fn_horse_street_price_add(horse_exact_profiles.street_counters_price,street_price_inc->actor.key)')=0 THEN
  RAISE EXCEPTION 'the flop-shown hardening needs 20261119192551 (the flop-shown record) installed first';
 END IF;
END $prerequisite$;

CREATE OR REPLACE FUNCTION public.fn_horse_flop_shown_wholes(p_list jsonb,p_length int)
RETURNS bigint[] LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE out bigint[]:=array_fill(0::bigint,ARRAY[greatest(p_length,0)]); e jsonb; x numeric; i int;
BEGIN
 -- Element i of p_list for i in 0..p_length-1, each read as fn_horse_flop_shown_whole reads one number: only a
 -- JSON integer of at most 1e9 in size; anything else, a missing element, or a list that is not an array, is 0.
 -- One pass over the list in plain PL/pgSQL expressions, no function call per number. Every cast sits behind its
 -- type test, so a damaged record can never raise.
 IF jsonb_typeof(p_list) IS DISTINCT FROM 'array' THEN RETURN out; END IF;
 FOR i IN 0..p_length-1 LOOP
  e:=p_list->i;
  IF jsonb_typeof(e)='number' THEN
   x:=(e#>>'{}')::numeric;
   IF abs(x)<=1e9 AND x=trunc(x) THEN out[i+1]:=x::bigint; END IF;
  END IF;
 END LOOP;
 RETURN out;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_horse_flop_shown_add(p_base jsonb,p_delta jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE
 g int; k int; i int; any_bet boolean; learned boolean:=false; n_calls bigint; b bigint;
 base_bet bigint[]; base_call bigint[]; d_bet bigint[]; d_call bigint[];
 bet bigint[]:=array_fill(0::bigint,ARRAY[40]); calls bigint[]:=array_fill(0::bigint,ARRAY[40]);
BEGIN
 IF p_delta IS NULL OR jsonb_typeof(p_delta) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_delta->'bet') IS DISTINCT FROM 'array' OR jsonb_typeof(p_delta->'call') IS DISTINCT FROM 'array' THEN
  RETURN p_base;
 END IF;
 -- Each list is read once, in one pass (fn_horse_flop_shown_wholes): four calls per hand.
 d_bet:=public.fn_horse_flop_shown_wholes(p_delta->'bet',40);
 d_call:=public.fn_horse_flop_shown_wholes(p_delta->'call',40);
 base_bet:=public.fn_horse_flop_shown_wholes(CASE WHEN jsonb_typeof(p_base)='object' THEN p_base->'bet' END,40);
 base_call:=public.fn_horse_flop_shown_wholes(CASE WHEN jsonb_typeof(p_base)='object' THEN p_base->'call' END,40);
 -- bet: the five classes of a line and texture that took a shown bet age together, then the class takes a unit.
 FOR g IN 0..7 LOOP
  any_bet:=false;
  FOR k IN 1..5 LOOP IF d_bet[g*5+k]>0 THEN any_bet:=true; END IF; END LOOP;
  FOR k IN 1..5 LOOP
   b:=base_bet[g*5+k];
   bet[g*5+k]:=CASE WHEN any_bet THEN least(50000,(b*977)/1000+greatest(0,d_bet[g*5+k])*1000) ELSE b END;
  END LOOP;
  IF any_bet THEN learned:=true; END IF;
 END LOOP;
 -- call: a cell that took calls ages its calls, price and return, then takes the hand's; its count never ages.
 FOR g IN 0..9 LOOP
  i:=g*4;
  n_calls:=d_call[i+1];
  IF n_calls>0 THEN
   learned:=true;
   calls[i+1]:=least(400000,(base_call[i+1]*977)/1000+n_calls*1000);
   calls[i+2]:=least(40000000,greatest(0,(base_call[i+2]*977)/1000+d_call[i+2]));
   calls[i+3]:=least(40000000,greatest(-40000000,(base_call[i+3]*977)/1000+d_call[i+3]));
   calls[i+4]:=least(1000000,base_call[i+4]+n_calls);
  ELSE
   calls[i+1]:=base_call[i+1]; calls[i+2]:=base_call[i+2]; calls[i+3]:=base_call[i+3]; calls[i+4]:=base_call[i+4];
  END IF;
 END LOOP;
 -- A hand with no evidence leaves the record exactly as it was.
 IF NOT learned THEN RETURN p_base; END IF;
 RETURN jsonb_build_object('bet',to_jsonb(bet),'call',to_jsonb(calls));
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_horse_flop_shown_public_class(p_hole_cards jsonb,p_showdown jsonb,p_user text,p_flop text[])
RETURNS int[] LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE sd jsonb;
BEGIN
 -- Shown only when the revealed holdings name him AND the showdown lists him with mucked = false written out:
 -- a missing key, null, a string or any other value is not shown.
 IF jsonb_typeof(p_hole_cards) IS DISTINCT FROM 'object' OR NOT p_hole_cards ? p_user
    OR jsonb_typeof(p_hole_cards->p_user) IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_showdown) IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
 SELECT e.value INTO sd FROM jsonb_array_elements(p_showdown) WITH ORDINALITY e
  WHERE jsonb_typeof(e.value)='object' AND jsonb_typeof(e.value->'user_id')='string' AND e.value->>'user_id'=p_user
  ORDER BY e.ordinality LIMIT 1;
 IF sd IS NULL OR (sd->'mucked') IS DISTINCT FROM 'false'::jsonb THEN RETURN NULL; END IF;
 RETURN public.fn_horse_flop_shown_class(p_hole_cards->p_user,p_flop);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_horse_street_price_number(p_value jsonb)
RETURNS double precision LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
 -- Only a JSON number under 1e12 in size is read; anything else counts as 0. The cast to float8 sits behind both
 -- tests, so a stored value beyond float8 (1e400 is valid jsonb) can never raise inside the accepted hand.
 SELECT CASE WHEN jsonb_typeof(p_value)='number'
  THEN CASE WHEN abs((p_value#>>'{}')::numeric)<1e12 THEN (p_value#>>'{}')::double precision ELSE 0 END
  ELSE 0 END
$fn$;

CREATE OR REPLACE FUNCTION public.fn_horse_street_price_add(p_base jsonb,p_delta jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE
 decay constant double precision:=power(0.5::double precision,1.0/30);
 st text; learned boolean:=false; out_cells jsonb:='{}';
 bs double precision; bo double precision; ds double precision; d_opp double precision;
BEGIN
 IF p_delta IS NULL OR jsonb_typeof(p_delta) IS DISTINCT FROM 'object' THEN RETURN p_base; END IF;
 FOREACH st IN ARRAY ARRAY['flop','turn','river'] LOOP
  -- Every stored or supplied number through fn_horse_street_price_number: under 1e12 in size, else 0.
  bs:=public.fn_horse_street_price_number(p_base#>ARRAY['foldToRaise',st,'sum']);
  bo:=public.fn_horse_street_price_number(p_base#>ARRAY['foldToRaise',st,'opp']);
  ds:=public.fn_horse_street_price_number(p_delta#>ARRAY['foldToRaise',st,'sum']);
  d_opp:=public.fn_horse_street_price_number(p_delta#>ARRAY['foldToRaise',st,'opp']);
  IF d_opp>0 THEN learned:=true; bs:=bs*decay+ds; bo:=bo*decay+d_opp; END IF;
  out_cells:=out_cells||jsonb_build_object(st,jsonb_build_object('sum',bs,'opp',bo));
 END LOOP;
 IF NOT learned THEN RETURN p_base; END IF;
 RETURN jsonb_build_object('foldToRaise',out_cells);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_horse_flop_shown_wholes(jsonb,int),public.fn_horse_flop_shown_add(jsonb,jsonb),public.fn_horse_flop_shown_public_class(jsonb,jsonb,text,text[]),public.fn_horse_street_price_number(jsonb),public.fn_horse_street_price_add(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE item record; def text; signature regprocedure;
BEGIN
 -- Both records are learned for the Omaha family only (HorseOmahaFlopShown.FLOP_SHOWN_LEARNED_VARIANTS).
 FOR item IN SELECT * FROM (VALUES
  ('public.fn_horse_exact_accept_hand()', $a$flop_shown_inc:=public.fn_horse_flop_shown_increments(h.actions,h.community_cards,h.community_cards2,h.hole_cards,h.showdown,h.winners,h.big_blind);
 street_price_inc:=public.fn_horse_street_price_increments(h.actions,h.pot_size);$a$,
   $b$IF h.game_variant IN ('plo4','plo5','plo6','plo8','flo8') THEN
 flop_shown_inc:=public.fn_horse_flop_shown_increments(h.actions,h.community_cards,h.community_cards2,h.hole_cards,h.showdown,h.winners,h.big_blind);
 street_price_inc:=public.fn_horse_street_price_increments(h.actions,h.pot_size);
 END IF;$b$)
 ) edits(name,old_fragment,new_fragment) LOOP
  signature:=item.name::regprocedure;
  def:=pg_get_functiondef(signature);
  IF strpos(def,item.new_fragment)>0 THEN CONTINUE; END IF;
  IF (length(def)-length(replace(def,item.old_fragment,'')))<>length(item.old_fragment) THEN
   RAISE EXCEPTION 'unexpected flop-shown learner preimage: %',left(item.old_fragment,60);
  END IF;
  EXECUTE replace(def,item.old_fragment,item.new_fragment);
 END LOOP;
END $patch$;

COMMIT;
