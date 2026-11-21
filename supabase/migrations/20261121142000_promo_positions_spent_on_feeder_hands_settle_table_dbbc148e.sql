-- 20261121142000_promo_positions_spent_on_feeder_hands_settle_table_dbbc148e
--
-- ACTIVE OUTAGE SETTLEMENT (incidents bb04ee5f, e542fbd7, 887c0008; 2026-11-21).
--
-- What happened. Player e922e29a (club a41434bb) bought in to cash table
-- dbbc148e (cluster 37ac7634) at 07:49:14 UTC with 7.35 chips that were all
-- promo principal, so ca_promo_principal_custody held 7.35 at
-- (table_stack, dbbc148e). At 07:53:13 the cluster balancer moved the seat to
-- feeder a5d84d81 (cash_seat_move_receipts, reason balance, 7.20 chips).
-- fn_cash_seat_move_execute moved the chips and the Diamond custody but never
-- the promo positions, so the principal stayed keyed to dbbc148e. On the
-- feeder fn_ca_promo_accept_cash_hand looked for custody at a5d84d81, found
-- none and recorded nothing for 37 hands while the stack fell to 2.64. At
-- 08:16:00 a must_move brought the seat (2.64) back to dbbc148e, where hand
-- #60380607 found 7.20 of principal against a 2.64 accepted stack and
-- fn_ca_promo_profit_capture_cash refused it with
-- original_winnings_sources_exceed_accepted_stack. The bounded replay was
-- exhausted, the generation was terminated with the hand retained behind its
-- causal barrier, and every replacement since has died at
-- start_failed:start_seed_hand_count (ClubArenaEngineKillStorm, about twenty
-- kills a minute for six hours, nine seats frozen).
--
-- What this settles. The losses those 37 hands should have charged, exactly as
-- fn_ca_promo_accept_cash_hand charges them: principal never exceeds the stack
-- it rides on (a win does not create promo, a loss consumes it first), so
-- principal after the feeder session is min(7.20, every stack on the way) =
-- 2.64, i.e. 4.56 is spent, FIFO by grant, through the platform's own
-- fn_ca_promo_move_selected_custody with reason 'spent'. No chips move: this is
-- the restriction bookkeeping only, the seat stack and every wallet are
-- untouched. Grant aaf34f38 (2.99) closes spent, 775cb978 keeps 0.51, 6e942b2c
-- (1.50) and 0783004d (0.63) are unchanged; 2.64 remains on the felt.
--
-- Proved first in a self-aborting probe (CLAUDE.md 11.5): seat 2.64, moved
-- 4.56, principal 2.64, winnings 0, review 0, overlap 0, so
-- principal+profit+review-overlap <= accepted stack and the retained hand can
-- settle. The block below asserts that board and is a no-op once it is already
-- settled (excess 0), so the merged install answers without changing anything.
--
-- The root fix (seat moves carry every promo position with the stack) is
-- 20261121142100_a_seat_move_carries_its_promo_positions.
BEGIN;
DO $settle$
DECLARE
 club constant uuid:='a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
 member constant uuid:='e922e29a-c18e-4428-9b81-3f1c297fda67';
 tbl constant uuid:='dbbc148e-384a-4c38-abb6-833b2d2847ff';
 seat numeric;held numeric;excess numeric;ids uuid[];moved numeric;
BEGIN
 SELECT stack INTO seat FROM public.table_seats WHERE table_id=tbl AND user_id=member AND left_at IS NULL FOR UPDATE;
 SELECT COALESCE(sum(c.amount),0) INTO held FROM public.ca_promo_principal_custody c
  JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
  WHERE g.club_id=club AND g.user_id=member AND g.closed_at IS NULL AND c.kind='table_stack' AND c.entity_id=tbl;
 excess:=held-COALESCE(seat,0);
 IF excess<=0 THEN RETURN; END IF;
 IF seat IS DISTINCT FROM 2.64 OR excess<>4.56 THEN
  RAISE EXCEPTION 'feeder_settlement_board_moved seat=% held=%',seat,held;
 END IF;
 SELECT array_agg(s.grant_id) INTO ids FROM public.fn_ca_promo_play_through_state(club,member) s
  WHERE s.state IN('locked','expired_pending');
 moved:=public.fn_ca_promo_move_selected_custody(club,member,'table_stack',tbl,NULL,NULL,excess,'spent',ids);
 IF moved<>excess THEN RAISE EXCEPTION 'feeder_settlement_partial moved=% excess=%',moved,excess; END IF;
END $settle$;
COMMIT;
