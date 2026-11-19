-- @install-window: daily-maintenance
-- @locks: public.horse_exact_profiles
-- @live-proof: (SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.horse_exact_profiles') AND attname='flop_shown' AND atttypid='jsonb'::regtype AND NOT attisdropped) AND strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_exact_accept_hand()')), 'flop_shown=public.fn_horse_flop_shown_add(horse_exact_profiles.flop_shown,flop_shown_inc->actor.key)')>0 AND strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_exact_accept_hand()')), 'flop_shown_inc:=public.fn_horse_flop_shown_increments(h.actions,h.community_cards,h.community_cards2,h.hole_cards,h.showdown,h.winners,h.big_blind);')>0 AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.horse_exact_profiles') AND attname='street_counters_price' AND atttypid='jsonb'::regtype AND NOT attisdropped) AND strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_exact_accept_hand()')), 'street_counters_price=public.fn_horse_street_price_add(horse_exact_profiles.street_counters_price,street_price_inc->actor.key)')>0)
-- 20261119192551_the_exact_opponent_profile_keeps_what_a_flop_bet_showed.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- The flop facing-bet verdict of the Omaha Horses (omahaFlopFacingBetEv,
-- default off) prices a call against the bettor's range. A read of how OFTEN
-- an opponent bets a flop (street_counters, 20261117175407) was measured on
-- 563 audited decisions and did not help: it fixed 1 and newly broke 4. What
-- the verdict lacks is WHAT the opponent holds when he bets the flop, and what
-- calls of his flop bets actually returned: one regular's flop bets paid a
-- caller's draws out of position -0.39 where the population paid 0.95.
--
-- This file gives the exact opponent profile that record, written by the same
-- accepted-hand learner that keeps its counters. MEASUREMENT ONLY: no Horse
-- decision reads it. The engine change that ships with this file only carries
-- the record to the decision workers.
--   - a new nullable column flop_shown jsonb, two flat lists of INTEGERS:
--       {"bet":  [40]   (line * 4 + texture) * 5 + class
--                       line: 0 the last preflop raiser's continuation bet, 1 any other first bet
--                       texture: paired, rainbow, twoTone, monotone
--                       class of the shown hand on the flop: nut, strong, weak, strongDraw, air
--                       each number: shown first flop bets, in thousandths
--        "call": [40]}  (kind * 5 + cell) * 4 + k
--                       kind of the caller: 0 a Horse, 1 a person
--                       cell: made, drawIp, drawOop, pair (the caller's shown hand), unshown
--                       k: 0 calls in thousandths, 1 what the calls cost and 2 what the hands returned
--                       from the call on (hundredths of a big blind), 3 calls ever counted (never aged)
--   - fn_horse_flop_shown_straight(hole_mask, board_mask): a straight under
--     the two-card rule by rank masks.
--   - fn_horse_flop_shown_class(hole, flop): [bet class, caller class] of 4 to
--     6 hole cards on a 3-card flop, NULL when it cannot be named.
--     HorseOmahaFlopShown.flopShownClassOf is the engine's twin; the caller
--     class is the flop verdict's own (omahaFlopHandClass).
--   - fn_horse_flop_shown_public_class(hole_cards, showdown, user, flop): the
--     class of a player's hand ONLY when the hand's public record shows it.
--   - fn_horse_flop_shown_increments(actions, community_cards,
--     community_cards2, hole_cards, showdown, winners, big_blind): the hand's
--     evidence about the player who made the first bet of the flop, replayed
--     exactly as HorseOmahaFlopShown.flopShownHandIncrements does. At most one
--     player per hand. Nothing for a hand without a single flop, a bomb pot, or
--     a flop whose first wager is not an admitted bet.
--   - fn_horse_flop_shown_add(base, delta): integer arithmetic only. The five
--     classes of a line and texture that took a shown bet age together by
--     977/1000, truncated (a half-life of 29.8 such bets), then the class takes
--     1000. A call cell that took calls ages its calls, price and return the
--     same way and adds the hand's. A hand with no evidence leaves the record
--     exactly as it was (NULL stays NULL). A count never exceeds 50 000, so the
--     record never grows. HorseOmahaFlopShown.addFlopShownEvidence is the twin.
--   - fn_horse_exact_accept_hand writes it beside counters, long_counters,
--     shown_river, street_counters and reraise_response on the insert and on
--     the conflict update. Patched by exact preimage fragments like
--     20261118023000, the newest definition of that function.
--
-- A SECOND RECORD, THE PRICE BEHIND A FOLD-TO-RAISE CELL. street_counters
-- keeps how often a player folds when his own bet or raise is raised, by
-- street. It does not keep what those raises cost him to call, so a consumer
-- pricing a raise of another size must assume one reference price.
--   - a new nullable column street_counters_price jsonb:
--       {"foldToRaise": {"flop": {"sum","opp"}, "turn": {...}, "river": {...}}}
--     sum: the prices of the raises he faced after betting or raising on that
--     street; opp: how many of them had a price. The cell's mean price is
--     sum / opp. Kept apart from street_counters so that record's shape, its
--     validation and its 34-number wire row are untouched.
--   - fn_horse_street_price_increments(actions, pot_size): the street read's
--     own fold-to-raise opportunity (fn_horse_street_read_increments), with
--     the price it was offered at: what he had to add over every chip in the
--     pot when the action returned to him, which is
--     increment / (pot + call + increment). The pot before the flop is the
--     hand's public pot size less what the postflop streets added. An
--     opportunity whose price cannot be named adds nothing.
--     HorseOmahaStreetReadPrice.streetPriceHandIncrements is the engine twin.
--   - fn_horse_street_price_add(base, delta): a cell that took a priced raise
--     ages by 2^(-1/30), the street read's own half-life, then takes the
--     hand's sum and count. HorseOmahaStreetReadPrice.addStreetPriceEvidence.
--   Public actions and the public pot size only. MEASUREMENT ONLY as well.
--
-- PUBLIC INFORMATION ONLY. A hand is read only when hand_history.hole_cards
-- names the player (that column is written from the showdown's revealed
-- holdings only; a mucked or folded hand is never stored there) AND
-- hand_history.showdown lists him as not mucked. A folded player's cards are
-- never read: the functions are not passed hand_history.players or any other
-- private column. Money is replayed from the public action log and the public
-- winners list. A caller whose hand was not shown is counted in the `unshown`
-- cell, with his price and his return, and in no class cell.
--
-- FORWARD ONLY. No back-fill, no replay of history, no reset: every existing
-- row keeps flop_shown NULL until its owner's first accepted hand with such
-- evidence after install. The engine reads a NULL, absent or malformed record
-- as absent, so either the engine or this file may be installed first. The
-- read RPC returns SETOF horse_exact_profiles and so returns the column; the
-- boot read selects every column.
--
-- PREREQUISITE: 20261118023000 (the re-raise response record). Its fragments
-- are this file's anchors; without it this file refuses loudly and rolls back.
-- fn_horse_flop_texture (20261117175407) and the hand_history columns read
-- here are asserted too.
--
-- ADD COLUMN with no default is a catalog-only change but takes ACCESS
-- EXCLUSIVE on horse_exact_profiles, which every accepted hand writes, and the
-- accepted-hand trigger function is replaced: the daily-maintenance window,
-- one 1 s lock request.

BEGIN;
SET LOCAL lock_timeout='1s';

DO $prerequisite$
BEGIN
 IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.hand_history'::regclass AND NOT attisdropped
      AND ((attname IN ('hole_cards','showdown','winners','actions') AND atttypid='jsonb'::regtype)
        OR (attname IN ('community_cards','community_cards2') AND atttypid='text[]'::regtype)
        OR (attname IN ('big_blind','pot_size') AND atttypid='numeric'::regtype)))<>8 THEN
  RAISE EXCEPTION 'the flop-shown record needs hand_history.actions, hole_cards, showdown, winners (jsonb), community_cards, community_cards2 (text[]), big_blind and pot_size (numeric)';
 END IF;
 IF to_regprocedure('public.fn_horse_flop_texture(text[],text[])') IS NULL
    OR to_regprocedure('public.fn_horse_reraise_response_add(jsonb,jsonb)') IS NULL
    OR strpos(pg_get_functiondef('public.fn_horse_exact_accept_hand()'::regprocedure),'reraise_response=public.fn_horse_reraise_response_add(')=0 THEN
  RAISE EXCEPTION 'the flop-shown record needs 20261118023000 (the re-raise response record) installed first';
 END IF;
END $prerequisite$;

ALTER TABLE public.horse_exact_profiles ADD COLUMN IF NOT EXISTS flop_shown jsonb, ADD COLUMN IF NOT EXISTS street_counters_price jsonb;

CREATE OR REPLACE FUNCTION public.fn_horse_flop_shown_straight(p_hole_mask int,p_board_mask int)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE top int; w int; missing int;
BEGIN
 -- Bit r is rank value r (an ace is also bit 1). The straight whose top card is `top` is five bits down from it.
 FOR top IN REVERSE 14..5 LOOP
  w:=31<<(top-4);
  missing:=w & (~p_board_mask);
  IF length(replace((missing::bit(16))::text,'0',''))>2 OR (missing & (~p_hole_mask))<>0 THEN CONTINUE; END IF;
  IF length(replace(((p_hole_mask&w)::bit(16))::text,'0',''))>=2 THEN RETURN true; END IF;
 END LOOP;
 RETURN false;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_horse_flop_shown_class(p_hole jsonb,p_flop text[])
RETURNS int[] LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE
 ranks constant text:='23456789TJQKA';
 n int; i int; r int; top int; c jsonb; t text; w int; missing int;
 hr int[]:='{}'; hs text[]:='{}'; br int[]:='{}'; bs text[]:='{}'; seen text[]:='{}';
 hc int[]:=array_fill(0,ARRAY[14]); bc int[]:=array_fill(0,ARRAY[14]);
 hm int:=0; bm int:=0; sm int:=0;
 most int:=0; monotone boolean; flush_suit text; pocket boolean:=false; other_pair boolean:=false;
 cat int:=1; rr int; ss int; paired int:=0; has_set boolean:=false;
 outs int:=0; draw_suit text; top_board int:=0; nut_straight boolean:=false; top_missing int;
 bet int; caller int;
BEGIN
 IF jsonb_typeof(p_hole) IS DISTINCT FROM 'array' OR p_flop IS NULL OR coalesce(cardinality(p_flop),0)<>3 THEN RETURN NULL; END IF;
 n:=jsonb_array_length(p_hole);
 IF n<4 OR n>6 THEN RETURN NULL; END IF;
 FOR c IN SELECT e.value FROM jsonb_array_elements(p_hole) WITH ORDINALITY e ORDER BY e.ordinality LOOP
  IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR jsonb_typeof(c->'rank') IS DISTINCT FROM 'string'
     OR jsonb_typeof(c->'suit') IS DISTINCT FROM 'string' THEN RETURN NULL; END IF;
  IF (c->>'rank') !~ '^[2-9TJQKA]$' OR (c->>'suit') NOT IN ('spades','hearts','diamonds','clubs') THEN RETURN NULL; END IF;
  t:=(c->>'rank')||(c->>'suit');
  IF t=ANY(seen) THEN RETURN NULL; END IF;
  seen:=seen||t; hr:=hr||(strpos(ranks,c->>'rank')+1); hs:=hs||(c->>'suit');
 END LOOP;
 FOREACH t IN ARRAY p_flop LOOP
  IF t IS NULL OR t !~ '^[2-9TJQKA](spades|hearts|diamonds|clubs)$' OR t=ANY(seen) THEN RETURN NULL; END IF;
  seen:=seen||t; br:=br||(strpos(ranks,left(t,1))+1); bs:=bs||substr(t,2);
 END LOOP;
 -- Rank counts (index = rank value, 2..14) and rank masks.
 FOR i IN 1..n LOOP
  hc[hr[i]]:=hc[hr[i]]+1; hm:=hm|(1<<hr[i])|(CASE WHEN hr[i]=14 THEN 2 ELSE 0 END);
 END LOOP;
 FOR i IN 1..3 LOOP
  bc[br[i]]:=bc[br[i]]+1; bm:=bm|(1<<br[i])|(CASE WHEN br[i]=14 THEN 2 ELSE 0 END);
  top_board:=greatest(top_board,br[i]);
 END LOOP;
 FOR r IN 2..14 LOOP
  most:=greatest(most,bc[r]);
  IF hc[r]>=2 THEN pocket:=true; END IF;
 END LOOP;
 monotone:=bs[1]=bs[2] AND bs[2]=bs[3];
 IF monotone AND (SELECT count(*) FROM unnest(hs) x WHERE x=bs[1])>=2 THEN flush_suit:=bs[1]; END IF;
 -- The category of 2 hole cards with the 3 flop cards: 1 high card, 2 pair, 3 two pair, 4 three of a kind,
 -- 5 straight, 6 flush, 7 full house, 8 four of a kind, 9 straight flush.
 IF most=3 THEN
  rr:=br[1];
  FOR r IN 2..14 LOOP IF r<>rr AND hc[r]>=2 THEN other_pair:=true; END IF; END LOOP;
  cat:=CASE WHEN hc[rr]>=1 THEN 8 WHEN other_pair THEN 7 ELSE 4 END;
 ELSIF most=2 THEN
  FOR r IN 2..14 LOOP IF bc[r]=2 THEN rr:=r; ELSIF bc[r]=1 THEN ss:=r; END IF; END LOOP;
  cat:=CASE WHEN hc[rr]>=2 THEN 8
            WHEN (hc[rr]>=1 AND hc[ss]>=1) OR hc[ss]>=2 THEN 7
            WHEN hc[rr]>=1 THEN 4
            WHEN hc[ss]>=1 OR pocket THEN 3
            ELSE 2 END;
 ELSE
  IF flush_suit IS NOT NULL THEN
   FOR i IN 1..n LOOP
    IF hs[i]=flush_suit THEN sm:=sm|(1<<hr[i])|(CASE WHEN hr[i]=14 THEN 2 ELSE 0 END); END IF;
   END LOOP;
  END IF;
  FOR r IN 2..14 LOOP
   IF bc[r]=1 THEN
    IF hc[r]>=1 THEN paired:=paired+1; END IF;
    IF hc[r]>=2 THEN has_set:=true; END IF;
   END IF;
  END LOOP;
  cat:=CASE WHEN flush_suit IS NOT NULL AND public.fn_horse_flop_shown_straight(sm,bm) THEN 9
            WHEN flush_suit IS NOT NULL THEN 6
            WHEN public.fn_horse_flop_shown_straight(hm,bm) THEN 5
            WHEN has_set THEN 4
            WHEN paired>=2 THEN 3
            WHEN paired=1 OR pocket THEN 2
            ELSE 1 END;
 END IF;
 -- Straight outs: each rank not on the board whose arrival makes a straight, by the cards of it not in hand.
 IF NOT public.fn_horse_flop_shown_straight(hm,bm) THEN
  FOR r IN 2..14 LOOP
   IF (bm&(1<<r))<>0 THEN CONTINUE; END IF;
   IF public.fn_horse_flop_shown_straight(hm,bm|(1<<r)|(CASE WHEN r=14 THEN 2 ELSE 0 END)) THEN outs:=outs+4-hc[r]; END IF;
  END LOOP;
 END IF;
 -- A flush draw: two of a suit in hand, exactly two on the flop.
 FOREACH t IN ARRAY ARRAY['spades','hearts','diamonds','clubs'] LOOP
  IF (SELECT count(*) FROM unnest(bs) x WHERE x=t)=2 AND (SELECT count(*) FROM unnest(hs) x WHERE x=t)>=2 THEN draw_suit:=t; END IF;
 END LOOP;
 caller:=CASE WHEN cat>=3 THEN 0 WHEN draw_suit IS NOT NULL OR outs>=8 THEN 1 ELSE 2 END;
 -- The highest card of the flush suit or the flush-draw suit that is not on the flop.
 t:=coalesce(flush_suit,draw_suit); top_missing:=0;
 IF t IS NOT NULL THEN
  FOR r IN REVERSE 14..2 LOOP
   IF NOT EXISTS (SELECT 1 FROM generate_subscripts(br,1) k WHERE bs[k]=t AND br[k]=r) THEN top_missing:=r; EXIT; END IF;
  END LOOP;
 END IF;
 IF cat=5 THEN
  -- The highest straight this flop allows is his when both of its missing ranks are in his hand.
  FOR top IN REVERSE 14..5 LOOP
   w:=31<<(top-4); missing:=w & (~bm);
   IF length(replace((missing::bit(16))::text,'0',''))<>2 THEN CONTINUE; END IF;
   nut_straight:=(missing & (~hm))=0; EXIT;
  END LOOP;
 END IF;
 bet:=CASE
  WHEN cat>=7
    OR (cat=6 AND EXISTS (SELECT 1 FROM generate_subscripts(hr,1) k WHERE hs[k]=flush_suit AND hr[k]=top_missing))
    OR (NOT monotone AND cat=5 AND nut_straight)
    OR (NOT monotone AND cat=4 AND most=1 AND hc[top_board]>=2) THEN 0
  WHEN (cat>=4 AND NOT (cat=4 AND most=3)) OR (cat=3 AND most=1) THEN 1
  WHEN (draw_suit IS NOT NULL AND (outs>=8 OR EXISTS (SELECT 1 FROM generate_subscripts(hr,1) k WHERE hs[k]=draw_suit AND hr[k]=top_missing)))
    OR outs>=13 THEN 3
  WHEN (most=1 AND cat=2) OR (most=2 AND cat=3) THEN 2
  ELSE 4 END;
 RETURN ARRAY[bet,caller];
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_horse_flop_shown_public_class(p_hole_cards jsonb,p_showdown jsonb,p_user text,p_flop text[])
RETURNS int[] LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE sd jsonb;
BEGIN
 -- Shown only when the revealed holdings name him AND the showdown lists him as not mucked.
 IF jsonb_typeof(p_hole_cards) IS DISTINCT FROM 'object' OR NOT p_hole_cards ? p_user
    OR jsonb_typeof(p_hole_cards->p_user) IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_showdown) IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
 SELECT e.value INTO sd FROM jsonb_array_elements(p_showdown) WITH ORDINALITY e
  WHERE jsonb_typeof(e.value)='object' AND jsonb_typeof(e.value->'user_id')='string' AND e.value->>'user_id'=p_user
  ORDER BY e.ordinality LIMIT 1;
 IF sd IS NULL OR (sd->'mucked')='true'::jsonb THEN RETURN NULL; END IF;
 RETURN public.fn_horse_flop_shown_class(p_hole_cards->p_user,p_flop);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_horse_flop_shown_increments(p_actions jsonb,p_community_cards text[],p_community_cards2 text[],p_hole_cards jsonb,p_showdown jsonb,p_winners jsonb,p_big_blind numeric)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE
 a jsonb; w jsonb; id text; act text; st text; texture text; flop text[];
 last_raiser text; bettor text; line int:=1; raised boolean:=false; stage text;
 admitted boolean; ag boolean; wager boolean; learned boolean:=false;
 amount double precision; prev double precision; inc double precision; bb double precision; paid_out double precision;
 uids text[]:='{}'; street double precision[]:='{}'; from_call double precision[]:='{}'; ord text[]:='{}';
 caller_ids text[]:='{}'; caller_kinds int[]:='{}'; caller_paid double precision[]:='{}';
 u int; k int; kind int; cell int; cls int[];
 bet bigint[]:=array_fill(0::bigint,ARRAY[40]); calls bigint[]:=array_fill(0::bigint,ARRAY[40]);
BEGIN
 IF jsonb_typeof(p_actions) IS DISTINCT FROM 'array' THEN RETURN '{}'::jsonb; END IF;
 -- One flop every seat saw, or nothing (a double-board hand with two flops has no single flop).
 texture:=public.fn_horse_flop_texture(p_community_cards,p_community_cards2);
 IF texture IS NULL THEN RETURN '{}'::jsonb; END IF;
 flop:=p_community_cards[1:3];
 FOR a IN SELECT e.value FROM jsonb_array_elements(p_actions) WITH ORDINALITY e ORDER BY e.ordinality LOOP
  IF jsonb_typeof(a) IS DISTINCT FROM 'object' THEN CONTINUE; END IF;
  act:=CASE WHEN jsonb_typeof(a->'action')='string' THEN a->>'action' END;
  IF act='bomb_ante' THEN RETURN '{}'::jsonb; END IF;
  id:=CASE WHEN jsonb_typeof(a->'userId')='string' THEN a->>'userId' END;
  st:=CASE WHEN jsonb_typeof(a->'stage')='string' THEN a->>'stage' END;
  IF id IS NULL OR id='' OR act IS NULL OR st IS NULL THEN CONTINUE; END IF;
  -- The pooled counters' admission (HorseOpponentExploit.learnablePublicAction): voluntary, never forced, and a
  -- fold only when it is attributed to the player, a pre-action or the Horse policy.
  admitted:=act IN ('fold','check','call','bet','raise','all_in')
   AND (a->'origin') IS DISTINCT FROM '"forced"'::jsonb
   AND (act<>'fold' OR coalesce((a->'origin') IN ('"player"'::jsonb,'"pre_action"'::jsonb,'"horse_policy"'::jsonb),false));
  ag:=act IN ('bet','raise') OR (act='all_in' AND coalesce((a->'isFullRaise')='true'::jsonb,false));
  IF st='preflop' THEN
   IF admitted AND ag THEN last_raiser:=id; END IF;
   CONTINUE;
  END IF;
  IF st NOT IN ('flop','turn','river') THEN CONTINUE; END IF;
  IF st IS DISTINCT FROM stage THEN stage:=st; street:=array_fill(0::double precision,ARRAY[coalesce(cardinality(uids),0)]); END IF;
  -- Only a JSON number under 1e12 is read as an amount; anything else counts as 0, so a damaged log can never
  -- raise inside the accepted-hand transaction.
  amount:=CASE WHEN jsonb_typeof(a->'amount')='number'
               THEN CASE WHEN abs((a->>'amount')::numeric)<1e12 THEN greatest(0::double precision,(a->>'amount')::double precision) ELSE 0 END
               ELSE 0 END;
  u:=array_position(uids,id);
  IF u IS NULL THEN uids:=uids||id; street:=street||0::double precision; from_call:=from_call||NULL::double precision; u:=cardinality(uids); END IF;
  IF act='return' THEN
   -- An uncalled bet returned to a caller is not money he put in.
   IF from_call[u] IS NOT NULL THEN from_call[u]:=from_call[u]-amount; END IF;
   CONTINUE;
  END IF;
  IF act NOT IN ('fold','check','call','bet','raise','all_in') THEN CONTINUE; END IF;
  -- bet / raise / all-in amounts are street totals; a call is an increment.
  prev:=street[u];
  wager:=act IN ('bet','raise','all_in');
  inc:=CASE WHEN act IN ('fold','check') THEN 0 WHEN wager THEN greatest(0::double precision,amount-prev) ELSE amount END;
  street[u]:=prev+inc;
  IF from_call[u] IS NOT NULL THEN from_call[u]:=from_call[u]+inc; END IF;
  IF st<>'flop' THEN CONTINUE; END IF;
  IF NOT id=ANY(ord) THEN ord:=ord||id; END IF;
  IF bettor IS NULL THEN
   IF admitted AND ag THEN
    bettor:=id; line:=CASE WHEN last_raiser IS NOT DISTINCT FROM id THEN 0 ELSE 1 END;
   ELSIF wager THEN
    -- A first wager that is not an admitted bet: the flop has no clean first bet.
    RETURN '{}'::jsonb;
   END IF;
  ELSIF NOT raised THEN
   IF wager THEN raised:=true;
   ELSIF act='call' AND id<>bettor AND admitted AND from_call[u] IS NULL THEN
    kind:=CASE WHEN (a->'origin')='"horse_policy"'::jsonb THEN 0
               WHEN coalesce((a->'origin') IN ('"player"'::jsonb,'"pre_action"'::jsonb),false) THEN 1 END;
    IF kind IS NOT NULL THEN
     caller_ids:=caller_ids||id; caller_kinds:=caller_kinds||kind; caller_paid:=caller_paid||inc; from_call[u]:=inc;
    END IF;
   END IF;
  END IF;
 END LOOP;
 IF bettor IS NULL THEN RETURN '{}'::jsonb; END IF;
 cls:=public.fn_horse_flop_shown_public_class(p_hole_cards,p_showdown,bettor,flop);
 IF cls IS NOT NULL THEN
  bet[(line*4+array_position(ARRAY['paired','rainbow','twoTone','monotone'],texture)-1)*5+cls[1]+1]:=1;
  learned:=true;
 END IF;
 bb:=CASE WHEN p_big_blind IS NOT NULL AND p_big_blind>0 AND p_big_blind<1e9 THEN p_big_blind::double precision END;
 IF jsonb_typeof(p_winners)='array' AND bb IS NOT NULL AND bb>0 THEN
  FOR k IN 1..coalesce(cardinality(caller_ids),0) LOOP
   id:=caller_ids[k]; u:=array_position(uids,id); paid_out:=0;
   FOR w IN SELECT e.value FROM jsonb_array_elements(p_winners) WITH ORDINALITY e ORDER BY e.ordinality LOOP
    IF jsonb_typeof(w)='object' AND jsonb_typeof(w->'userId')='string' AND w->>'userId'=id AND jsonb_typeof(w->'amount')='number' THEN
     IF abs((w->>'amount')::numeric)<1e12 THEN paid_out:=paid_out+greatest(0::double precision,(w->>'amount')::double precision); END IF;
    END IF;
   END LOOP;
   cls:=public.fn_horse_flop_shown_public_class(p_hole_cards,p_showdown,id,flop);
   -- In position: no player acts for the first time on the flop after him.
   cell:=CASE WHEN cls IS NULL THEN 4 WHEN cls[2]=0 THEN 0 WHEN cls[2]=2 THEN 3
              WHEN ord[cardinality(ord)]=id THEN 1 ELSE 2 END;
   u:=(caller_kinds[k]*5+cell)*4;
   calls[u+1]:=calls[u+1]+1;
   calls[u+2]:=calls[u+2]+least(100000::double precision,greatest(0::double precision,floor((caller_paid[k]*100)/bb+0.5)))::bigint;
   calls[u+3]:=calls[u+3]+least(100000::double precision,greatest(-100000::double precision,floor(((paid_out-from_call[array_position(uids,id)])*100)/bb+0.5)))::bigint;
   calls[u+4]:=calls[u+4]+1;
   learned:=true;
  END LOOP;
 END IF;
 IF NOT learned THEN RETURN '{}'::jsonb; END IF;
 RETURN jsonb_build_object(bettor,jsonb_build_object('bet',to_jsonb(bet),'call',to_jsonb(calls)));
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_horse_flop_shown_whole(p_value jsonb)
RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
 -- Only a JSON integer of at most 1e9 in size is read; anything else counts as 0, so a damaged record can never
 -- raise inside the accepted-hand transaction.
 SELECT CASE WHEN jsonb_typeof(p_value)='number'
  THEN CASE WHEN abs((p_value#>>'{}')::numeric)<=1e9 AND (p_value#>>'{}')::numeric=trunc((p_value#>>'{}')::numeric)
            THEN (p_value#>>'{}')::numeric::bigint ELSE 0 END
  ELSE 0 END
$fn$;

CREATE OR REPLACE FUNCTION public.fn_horse_flop_shown_add(p_base jsonb,p_delta jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE
 g int; k int; i int; any_bet boolean; learned boolean:=false; n_calls bigint;
 base_bet jsonb; base_call jsonb; d_bet jsonb; d_call jsonb; b bigint; b1 bigint; b2 bigint; b3 bigint;
 bet bigint[]:=array_fill(0::bigint,ARRAY[40]); calls bigint[]:=array_fill(0::bigint,ARRAY[40]);
BEGIN
 IF p_delta IS NULL OR jsonb_typeof(p_delta) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_delta->'bet') IS DISTINCT FROM 'array' OR jsonb_typeof(p_delta->'call') IS DISTINCT FROM 'array' THEN
  RETURN p_base;
 END IF;
 d_bet:=p_delta->'bet'; d_call:=p_delta->'call';
 IF jsonb_typeof(p_base)='object' THEN
  base_bet:=CASE WHEN jsonb_typeof(p_base->'bet')='array' THEN p_base->'bet' END;
  base_call:=CASE WHEN jsonb_typeof(p_base->'call')='array' THEN p_base->'call' END;
 END IF;
 -- bet: the five classes of a line and texture that took a shown bet age together, then the class takes a unit.
 FOR g IN 0..7 LOOP
  any_bet:=false;
  FOR k IN 0..4 LOOP IF public.fn_horse_flop_shown_whole(d_bet->(g*5+k))>0 THEN any_bet:=true; END IF; END LOOP;
  FOR k IN 0..4 LOOP
   b:=public.fn_horse_flop_shown_whole(base_bet->(g*5+k));
   bet[g*5+k+1]:=CASE WHEN any_bet
     THEN least(50000,(b*977)/1000+greatest(0,public.fn_horse_flop_shown_whole(d_bet->(g*5+k)))*1000) ELSE b END;
  END LOOP;
  IF any_bet THEN learned:=true; END IF;
 END LOOP;
 -- call: a cell that took calls ages its calls, price and return, then takes the hand's; its count never ages.
 FOR g IN 0..9 LOOP
  i:=g*4;
  n_calls:=public.fn_horse_flop_shown_whole(d_call->i);
  b:=public.fn_horse_flop_shown_whole(base_call->i); b1:=public.fn_horse_flop_shown_whole(base_call->(i+1));
  b2:=public.fn_horse_flop_shown_whole(base_call->(i+2)); b3:=public.fn_horse_flop_shown_whole(base_call->(i+3));
  IF n_calls>0 THEN
   learned:=true;
   calls[i+1]:=least(400000,(b*977)/1000+n_calls*1000);
   calls[i+2]:=least(40000000,greatest(0,(b1*977)/1000+public.fn_horse_flop_shown_whole(d_call->(i+1))));
   calls[i+3]:=least(40000000,greatest(-40000000,(b2*977)/1000+public.fn_horse_flop_shown_whole(d_call->(i+2))));
   calls[i+4]:=least(1000000,b3+n_calls);
  ELSE
   calls[i+1]:=b; calls[i+2]:=b1; calls[i+3]:=b2; calls[i+4]:=b3;
  END IF;
 END LOOP;
 -- A hand with no evidence leaves the record exactly as it was.
 IF NOT learned THEN RETURN p_base; END IF;
 RETURN jsonb_build_object('bet',to_jsonb(bet),'call',to_jsonb(calls));
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_horse_street_price_increments(p_actions jsonb,p_pot_size numeric)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE
 a jsonb; id text; act text; st text; stage text; bettor text; k text; ag boolean; admitted boolean; pass int; u int;
 amount double precision; prev double precision; inc double precision; added double precision:=0;
 pot double precision; to_match double precision:=0; to_call double precision; price double precision;
 uids text[]:='{}'; street double precision[]:='{}'; wagered text[]:='{}'; seen text[]:='{}';
 cur jsonb; res jsonb:='{}';
 zero constant jsonb:='{"foldToRaise":{"flop":{"sum":0,"opp":0},"turn":{"sum":0,"opp":0},"river":{"sum":0,"opp":0}}}';
BEGIN
 IF jsonb_typeof(p_actions) IS DISTINCT FROM 'array' THEN RETURN res; END IF;
 IF p_pot_size IS NULL OR NOT (p_pot_size>0 AND p_pot_size<1e12) THEN RETURN res; END IF;
 -- Pass 1: what the postflop streets added to the pot. Pass 2: the fold-to-raise opportunity and its price.
 FOR pass IN 1..2 LOOP
  IF pass=2 THEN
   pot:=p_pot_size::double precision-added;
   IF NOT pot>0 THEN RETURN res; END IF;
  END IF;
  stage:=NULL; uids:='{}'; street:='{}';
  FOR a IN SELECT e.value FROM jsonb_array_elements(p_actions) WITH ORDINALITY e ORDER BY e.ordinality LOOP
   IF jsonb_typeof(a) IS DISTINCT FROM 'object' THEN CONTINUE; END IF;
   id:=CASE WHEN jsonb_typeof(a->'userId')='string' THEN a->>'userId' END;
   act:=CASE WHEN jsonb_typeof(a->'action')='string' THEN a->>'action' END;
   st:=CASE WHEN jsonb_typeof(a->'stage')='string' THEN a->>'stage' END;
   IF id IS NULL OR id='' OR act IS NULL OR st IS NULL OR st NOT IN ('flop','turn','river') THEN CONTINUE; END IF;
   IF st IS DISTINCT FROM stage THEN
    stage:=st; street:=array_fill(0::double precision,ARRAY[coalesce(cardinality(uids),0)]);
    to_match:=0; bettor:=NULL; wagered:='{}';
   END IF;
   -- Only a JSON number under 1e12 is read as an amount; anything else counts as 0.
   amount:=CASE WHEN jsonb_typeof(a->'amount')='number'
                THEN CASE WHEN abs((a->>'amount')::numeric)<1e12 THEN greatest(0::double precision,(a->>'amount')::double precision) ELSE 0 END
                ELSE 0 END;
   IF act='return' THEN
    IF pass=1 THEN added:=added-amount; ELSE pot:=pot-amount; END IF;
    CONTINUE;
   END IF;
   IF act NOT IN ('fold','check','call','bet','raise','all_in') THEN CONTINUE; END IF;
   u:=array_position(uids,id);
   IF u IS NULL THEN uids:=uids||id; street:=street||0::double precision; u:=cardinality(uids); END IF;
   prev:=street[u];
   IF pass=2 THEN
    -- The pooled counters' admission (HorseOpponentExploit.learnablePublicAction).
    admitted:=(a->'origin') IS DISTINCT FROM '"forced"'::jsonb
     AND (act<>'fold' OR coalesce((a->'origin') IN ('"player"'::jsonb,'"pre_action"'::jsonb,'"horse_policy"'::jsonb),false));
    IF admitted THEN
     ag:=act IN ('bet','raise') OR (act='all_in' AND coalesce((a->'isFullRaise')='true'::jsonb,false));
     k:=stage||':'||id;
     IF bettor IS NOT NULL AND bettor<>id AND id=ANY(wagered) AND NOT k=ANY(seen) THEN
      -- He had bet or raised on this street and now faces a raise: what he must add over the pot he is offered.
      seen:=seen||k;
      to_call:=to_match-prev;
      price:=CASE WHEN to_call>0 AND pot>0 THEN to_call/pot ELSE 0 END;
      IF price>0 AND price<=1 THEN
       cur:=coalesce(res->id,zero);
       -- One priced raise per player per street per hand: the cell is written once, from zero.
       cur:=jsonb_set(cur,ARRAY['foldToRaise',stage],jsonb_build_object('sum',price,'opp',1));
       res:=res||jsonb_build_object(id,cur);
      END IF;
     END IF;
     IF ag THEN bettor:=id; IF NOT id=ANY(wagered) THEN wagered:=wagered||id; END IF; END IF;
    END IF;
   END IF;
   -- bet / raise / all-in amounts are street totals; a call is an increment.
   inc:=CASE WHEN act IN ('bet','raise','all_in') THEN greatest(0::double precision,amount-prev) WHEN act='call' THEN amount ELSE 0 END;
   street[u]:=prev+inc;
   IF pass=1 THEN added:=added+inc; ELSE pot:=pot+inc; IF prev+inc>to_match THEN to_match:=prev+inc; END IF; END IF;
  END LOOP;
 END LOOP;
 RETURN res;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_horse_street_price_add(p_base jsonb,p_delta jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE
 decay constant double precision:=power(0.5::double precision,1.0/30);
 st text; learned boolean:=false; out_cells jsonb:='{}';
 bs double precision; bo double precision; ds double precision; d_opp double precision;
BEGIN
 IF p_delta IS NULL OR jsonb_typeof(p_delta) IS DISTINCT FROM 'object' THEN RETURN p_base; END IF;
 FOREACH st IN ARRAY ARRAY['flop','turn','river'] LOOP
  -- Only a JSON number is read; anything else in a stored or supplied cell counts as 0, so a damaged record can
  -- never raise inside the accepted-hand transaction.
  bs:=CASE WHEN jsonb_typeof(p_base#>ARRAY['foldToRaise',st,'sum'])='number' THEN (p_base#>>ARRAY['foldToRaise',st,'sum'])::double precision ELSE 0 END;
  bo:=CASE WHEN jsonb_typeof(p_base#>ARRAY['foldToRaise',st,'opp'])='number' THEN (p_base#>>ARRAY['foldToRaise',st,'opp'])::double precision ELSE 0 END;
  ds:=CASE WHEN jsonb_typeof(p_delta#>ARRAY['foldToRaise',st,'sum'])='number' THEN (p_delta#>>ARRAY['foldToRaise',st,'sum'])::double precision ELSE 0 END;
  d_opp:=CASE WHEN jsonb_typeof(p_delta#>ARRAY['foldToRaise',st,'opp'])='number' THEN (p_delta#>>ARRAY['foldToRaise',st,'opp'])::double precision ELSE 0 END;
  IF d_opp>0 THEN learned:=true; bs:=bs*decay+ds; bo:=bo*decay+d_opp; END IF;
  out_cells:=out_cells||jsonb_build_object(st,jsonb_build_object('sum',bs,'opp',bo));
 END LOOP;
 IF NOT learned THEN RETURN p_base; END IF;
 RETURN jsonb_build_object('foldToRaise',out_cells);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_horse_street_price_increments(jsonb,numeric),public.fn_horse_street_price_add(jsonb,jsonb),public.fn_horse_flop_shown_straight(int,int),public.fn_horse_flop_shown_class(jsonb,text[]),public.fn_horse_flop_shown_public_class(jsonb,jsonb,text,text[]),public.fn_horse_flop_shown_increments(jsonb,text[],text[],jsonb,jsonb,jsonb,numeric),public.fn_horse_flop_shown_whole(jsonb),public.fn_horse_flop_shown_add(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE item record; def text; signature regprocedure;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('public.fn_horse_exact_accept_hand()', $a$street_read_inc jsonb; reraise_response_inc jsonb;$a$,
   $b$street_read_inc jsonb; reraise_response_inc jsonb; flop_shown_inc jsonb; street_price_inc jsonb;$b$),
  ('public.fn_horse_exact_accept_hand()', $a$reraise_response_inc:=public.fn_horse_reraise_response_increments(h.actions);$a$,
   $b$reraise_response_inc:=public.fn_horse_reraise_response_increments(h.actions);
 flop_shown_inc:=public.fn_horse_flop_shown_increments(h.actions,h.community_cards,h.community_cards2,h.hole_cards,h.showdown,h.winners,h.big_blind);
 street_price_inc:=public.fn_horse_street_price_increments(h.actions,h.pot_size);$b$),
  ('public.fn_horse_exact_accept_hand()', $a$observed_hands,initialized,long_counters,shown_river,street_counters,reraise_response)$a$,
   $b$observed_hands,initialized,long_counters,shown_river,street_counters,reraise_response,flop_shown,street_counters_price)$b$),
  ('public.fn_horse_exact_accept_hand()', $a$public.fn_horse_reraise_response_add(NULL,reraise_response_inc->actor.key))$a$,
   $b$public.fn_horse_reraise_response_add(NULL,reraise_response_inc->actor.key),public.fn_horse_flop_shown_add(NULL,flop_shown_inc->actor.key),public.fn_horse_street_price_add(NULL,street_price_inc->actor.key))$b$),
  ('public.fn_horse_exact_accept_hand()', $a$reraise_response=public.fn_horse_reraise_response_add(horse_exact_profiles.reraise_response,reraise_response_inc->actor.key),$a$,
   $b$reraise_response=public.fn_horse_reraise_response_add(horse_exact_profiles.reraise_response,reraise_response_inc->actor.key),flop_shown=public.fn_horse_flop_shown_add(horse_exact_profiles.flop_shown,flop_shown_inc->actor.key),street_counters_price=public.fn_horse_street_price_add(horse_exact_profiles.street_counters_price,street_price_inc->actor.key),$b$)
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
