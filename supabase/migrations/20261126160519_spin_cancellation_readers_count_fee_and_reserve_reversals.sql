-- @live-proof: md5(pg_get_functiondef('public.fn_ca_tournament_escrow_chips(uuid)'::regprocedure))='b926440f40d580d2a0d9365e749b7276' AND md5(pg_get_functiondef('public.fn_tournament_conservation_delta(uuid)'::regprocedure))='c4ecb7495d49fa87f97402023a82a589'
-- A cancelled booked Spin returns gross entry money on the prize refund rail.
-- Its atomic cancellation reverses fees separately and writes an immutable
-- undrawn reserve unwind. Excluding that fee reversal invents prize -fee / fee
-- +fee in the shadow. Count it only for that recorded undrawn cancellation;
-- ordinary unregister and operator-abort refund splits remain unchanged.
-- Conservation must also count the signed contribution and draw reversals.
-- Reporting only: no refunds, balances, journals, game state or alerts change.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $migration$
DECLARE
 shadow text := pg_get_functiondef('public.fn_ca_tournament_escrow_chips(uuid)'::regprocedure);
 conservation text := pg_get_functiondef('public.fn_tournament_conservation_delta(uuid)'::regprocedure);
 updated text;
BEGIN
 IF md5(shadow) <> '106048822dd555a8bef8fc3e6c119f11'
 OR md5(conservation) <> 'f7a43ea11bb89a62f1a1e68aa078278d' THEN
   RAISE EXCEPTION 'spin_cancellation_reporting_preimage_refused';
 END IF;
 updated := replace(shadow,
 $old$AND NOT (rake_amount<0 AND source IN (
      'atomic_cancel_tournament','fn_unregister_from_tournament','operator_abort_tournament'))$old$,
 $new$AND NOT (rake_amount<0 AND source IN (
      'atomic_cancel_tournament','fn_unregister_from_tournament','operator_abort_tournament')
      AND NOT (source='atomic_cancel_tournament' AND EXISTS (
        SELECT 1 FROM public.tournament_spin_cancellation_unwinds u
        JOIN public.tournaments cancelled ON cancelled.id=u.tournament_id
        WHERE u.tournament_id=p_tournament_id
          AND upper(cancelled.tournament_type)='SPIN'
          AND u.original_draw_id IS NULL)))$new$);
 IF updated=shadow THEN RAISE EXCEPTION 'spin_cancellation_shadow_anchor_missing'; END IF;
 IF strpos(updated,'net_guarantee_promo')=0
 OR strpos(updated,'guarantee_promo_excess_return')=0 THEN
   RAISE EXCEPTION 'spin_cancellation_reporting_promo_contract_missing';
 END IF;
 EXECUTE updated;
 updated := replace(conservation,
 $old$l.kind IN ('contribution','jackpot_draw')$old$,
 $new$l.kind IN ('contribution','jackpot_draw','contribution_reversal','draw_reversal')$new$);
 IF updated=conservation THEN RAISE EXCEPTION 'spin_cancellation_conservation_anchor_missing'; END IF;
 IF strpos(updated,'net_guarantee_promo')=0
 OR strpos(updated,'guarantee_promo_excess_return')=0 THEN
   RAISE EXCEPTION 'spin_cancellation_reporting_promo_contract_missing';
 END IF;
 EXECUTE updated;
END $migration$;
-- Read-only execution against an already cancelled incident event. The
-- native qualification separately proves populated cases and missing receipts.
-- @probe-for: public.fn_ca_tournament_escrow_chips
DO $probe$
BEGIN
 PERFORM public.fn_ca_tournament_escrow_chips('d46b69ac-6b7a-4db4-99e4-00843412fe9b'::uuid);
 RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
 IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
-- Read-only execution against an already cancelled incident event. The
-- native qualification separately proves populated cases and missing receipts.
-- @probe-for: public.fn_tournament_conservation_delta
DO $probe$
BEGIN
 PERFORM public.fn_tournament_conservation_delta('d46b69ac-6b7a-4db4-99e4-00843412fe9b'::uuid);
 RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
 IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
COMMIT;
