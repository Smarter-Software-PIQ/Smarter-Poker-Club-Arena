-- 20261124162105_a_lightning_hand_promo_check_counts_chips_still_in_an_earlie.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: to_regprocedure('public.fn_ca_promo_position_stack_before(uuid,uuid,numeric)') IS NOT NULL AND position('fn_ca_promo_position_stack_before' in pg_get_functiondef('public.fn_ca_promo_profit_capture_cash(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure)) > 0 AND position('fn_ca_promo_position_stack_before' in pg_get_functiondef('public.fn_ca_promo_accept_cash_hand(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure)) > 0
--
-- A PROMO PLAYER'S LIGHTNING HANDS NEVER SETTLE (owner report 2026-11-24,
-- player GRANDmasterFLUSH, PLO4 0.50/1 Lightning on Android).
--
-- WHAT BROKE. A player holding 50 promo chips (play-through grant d7b4bf4f)
-- sat in Lightning at 07:36Z. Hand 1 (09bedb8a) settled. Every hand after it
-- (bd430b7f, 8478badc, 3aeb26a9, 5acdad44, 8b4cb15b) was dealt, played to a
-- single survivor and then never settled: fn_lightning_settle_hand raised
-- 'original_winnings_sources_exceed_accepted_stack' from
-- fn_ca_promo_profit_capture_cash on all five attempts each (postgres log
-- 07:37:53-07:37:56Z), the engine logged "settlement outcome unknown; left to
-- the reaper", and the reaper voided each hand ten minutes later. The player
-- saw blinds/bets taken, no flop, no result, and a new hand, four times.
--
-- WHY. Lightning is fast-fold: a player who folds is dealt a new hand while
-- the hand they folded is still running. The new hand's stack_before is the
-- pool stack, which already excludes the chips they committed to the earlier,
-- still-unsettled hand (48 = 50 - 2). The promo custody at the anchor seat
-- only falls when that earlier hand settles (still 50). The check compared
-- custody 50 to stack_before 48 and refused. The refusal rolled the settlement
-- back, so the next hand was dealt from 46 against custody 48, and so on: a
-- self-sustaining chain for as long as the player kept playing.
--
-- WHAT THIS CHANGES. fn_ca_promo_position_stack_before() gives the position's
-- stack before any unsettled hand: the hand's stack_before plus the chips the
-- same player still has committed in earlier hands of the same sitting that
-- have not settled (still running, or voided and handed back). It finds them
-- through this transaction's own Lightning settlement markers, so a physical
-- hand is unchanged. The source check, the clean-chip and principal-risk
-- arithmetic in fn_ca_promo_profit_capture_cash and the promo-investment split
-- in fn_ca_promo_accept_cash_hand use it. Loss accounting (custody minus the
-- absolute stack after) was already order-safe and is unchanged. Both
-- functions are edited in place from their exact live preimages; nothing else
-- in them changes, and their owner, security and grants stay.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_position_stack_before(p_user uuid, p_place uuid, p_stack_before numeric)
 RETURNS numeric
 LANGUAGE sql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 -- The promo position's stack before this hand. For a physical hand that is
 -- the hand's own stack_before. For a Lightning hand being settled in this
 -- transaction (its lightning_settlement_marker rows name it), the pool stack
 -- the hand was dealt with excludes chips the same player still has committed
 -- in EARLIER hands of the same sitting that have not settled (still running,
 -- or voided, which hands them back); those chips are on the anchor seat, and
 -- so is their promo custody. A settled earlier hand already charged its loss
 -- to the custody, so it is not counted twice.
 SELECT p_stack_before + COALESCE((
   SELECT sum(hp.committed_at_fold)
     FROM public.lightning_settlement_marker m
     JOIN public.lightning_hand cur ON cur.hand_id = m.hand_id
     JOIN public.lightning_hand_player me ON me.hand_id = m.hand_id AND me.player_id = m.player_id
     JOIN public.lightning_hand_player hp ON hp.pool_slot_id = me.pool_slot_id
                                        AND hp.player_id = m.player_id
                                        AND hp.hand_id <> m.hand_id
     JOIN public.lightning_hand lh ON lh.hand_id = hp.hand_id
    WHERE m.txid = pg_current_xact_id()
      AND m.player_id = p_user
      AND m.anchor_table_id = p_place
      AND lh.settled_at IS NULL
      AND lh.formed_at < cur.formed_at
      AND hp.folded_at IS NOT NULL
      AND hp.committed_at_fold > 0), 0);
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_position_stack_before(uuid,uuid,numeric) FROM PUBLIC,anon,authenticated,service_role;

DO $migration$
DECLARE d text;o text;n text;before jsonb;after jsonb;
BEGIN
 d:=pg_get_functiondef('public.fn_ca_promo_profit_capture_cash(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure);
 IF md5(d)<>'8f3eabe33981081836ea41f52b1781ef' THEN RAISE EXCEPTION 'lightning_promo_capture_preimage_refused';END IF;
 SELECT jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proacl::text,p.proconfig) INTO before FROM pg_proc p WHERE p.oid='public.fn_ca_promo_profit_capture_cash(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure;
 o:='principal_risk numeric;scopes integer;';n:='principal_risk numeric;scopes integer;base numeric;';
 IF (length(d)-length(replace(d,o,'')))/length(o)<>1 THEN RAISE EXCEPTION 'lightning_promo_capture_anchor_refused';END IF;
 d:=replace(d,o,n);
 o:='  IF principal+profit=0 THEN CONTINUE;END IF;
';n:='  IF principal+profit=0 THEN CONTINUE;END IF;
  base:=public.fn_ca_promo_position_stack_before((s->>''user_id'')::uuid,place,(s->>''stack_before'')::numeric);
';
 IF (length(d)-length(replace(d,o,'')))/length(o)<>1 THEN RAISE EXCEPTION 'lightning_promo_capture_anchor_refused';END IF;
 d:=replace(d,o,n);
 o:='IF principal+profit+review-overlap>(s->>''stack_before'')::numeric THEN';n:='IF principal+profit+review-overlap>base THEN';
 IF (length(d)-length(replace(d,o,'')))/length(o)<>1 THEN RAISE EXCEPTION 'lightning_promo_capture_anchor_refused';END IF;
 d:=replace(d,o,n);
 o:='clean:=(s->>''stack_before'')::numeric-principal-profit-review+overlap;';n:='clean:=base-principal-profit-review+overlap;';
 IF (length(d)-length(replace(d,o,'')))/length(o)<>1 THEN RAISE EXCEPTION 'lightning_promo_capture_anchor_refused';END IF;
 d:=replace(d,o,n);
 o:='GREATEST(investment-((s->>''stack_before'')::numeric-principal),0)';n:='GREATEST(investment-(base-principal),0)';
 IF (length(d)-length(replace(d,o,'')))/length(o)<>1 THEN RAISE EXCEPTION 'lightning_promo_capture_anchor_refused';END IF;
 d:=replace(d,o,n);
 EXECUTE d;
 SELECT jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proacl::text,p.proconfig) INTO after FROM pg_proc p WHERE p.oid='public.fn_ca_promo_profit_capture_cash(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure;
 IF after IS DISTINCT FROM before THEN RAISE EXCEPTION 'lightning_promo_capture_identity_changed';END IF;
 IF position('fn_ca_promo_position_stack_before' IN pg_get_functiondef('public.fn_ca_promo_profit_capture_cash(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure))=0 THEN RAISE EXCEPTION 'lightning_promo_capture_not_installed';END IF;
 d:=pg_get_functiondef('public.fn_ca_promo_accept_cash_hand(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure);
 IF md5(d)<>'3258b0c724583064132c74b5035f2793' THEN RAISE EXCEPTION 'lightning_promo_accept_preimage_refused';END IF;
 SELECT jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proacl::text,p.proconfig) INTO before FROM pg_proc p WHERE p.oid='public.fn_ca_promo_accept_cash_hand(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure;
 o:='GREATEST(investment-GREATEST((s->>''stack_before'')::numeric-before_promo,0),0)';n:='GREATEST(investment-GREATEST(public.fn_ca_promo_position_stack_before(r.user_id,place,(s->>''stack_before'')::numeric)-before_promo,0),0)';
 IF (length(d)-length(replace(d,o,'')))/length(o)<>1 THEN RAISE EXCEPTION 'lightning_promo_accept_anchor_refused';END IF;
 d:=replace(d,o,n);
 EXECUTE d;
 SELECT jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proacl::text,p.proconfig) INTO after FROM pg_proc p WHERE p.oid='public.fn_ca_promo_accept_cash_hand(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure;
 IF after IS DISTINCT FROM before THEN RAISE EXCEPTION 'lightning_promo_accept_identity_changed';END IF;
 IF position('fn_ca_promo_position_stack_before' IN pg_get_functiondef('public.fn_ca_promo_accept_cash_hand(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure))=0 THEN RAISE EXCEPTION 'lightning_promo_accept_not_installed';END IF;
END
$migration$;

-- Each new body runs once before COMMIT. With no accepted hand the clock
-- refuses by name, after the body has been entered and its settings and
-- tournament reads have run; the source arithmetic itself is proved on
-- production's preimages by scripts/ci/test-a-promo-player-lightning-hand-settles-postgres.py.
-- @probe-for: public.fn_ca_promo_profit_capture_cash
-- @probe-for: public.fn_ca_promo_accept_cash_hand
DO $probe$
BEGIN
  IF public.fn_ca_promo_position_stack_before(gen_random_uuid(), gen_random_uuid(), 48) <> 48 THEN
    RAISE EXCEPTION 'probe_position_stack_before_without_marker_changed';
  END IF;
  BEGIN
    PERFORM public.fn_ca_promo_profit_capture_cash(gen_random_uuid(), gen_random_uuid(), '[]'::jsonb, '{}'::jsonb, '{}'::jsonb);
    RAISE EXCEPTION 'probe_expected_capture_clock_refusal';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'promo_cash_original_accepted_hand_missing' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.fn_ca_promo_accept_cash_hand(gen_random_uuid(), gen_random_uuid(), '[]'::jsonb, '{}'::jsonb, '{}'::jsonb);
    RAISE EXCEPTION 'probe_expected_accept_clock_refusal';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'promo_cash_original_accepted_hand_missing' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
