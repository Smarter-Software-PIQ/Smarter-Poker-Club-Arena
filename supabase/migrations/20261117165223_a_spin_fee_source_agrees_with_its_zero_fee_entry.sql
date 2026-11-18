-- @live-proof: position('r.gross_fee=0 AND r.principal=0 AND EXISTS(SELECT 1 FROM public.tournaments spin WHERE spin.id=f.tournament_id AND spin.variant=''spin'')' in pg_get_functiondef('public.fn_ca_promo_consume_event_fee(uuid)'::regprocedure)) > 0
-- 20261117165223_a_spin_fee_source_agrees_with_its_zero_fee_entry.sql
--
-- WHAT THIS CHANGES, AND WHY (incident 002a0deb SpinFleetProducingNothing):
--
-- Promo Play Through was enforced at 2026-11-17 14:28:44Z. The last Spin
-- start was 14:12:13Z and none has started since: eleven horse-opened boards
-- hold 2 of 3 seats, and every third-seat call answers
--   fn_seat_horse_in_seat_first_game -> promo_canonical_fee_lost_original_entitlement
-- (engine log "seat-first fill refused for <id>"), so the start that fills the
-- board rolls back with it, on every board, forever.
--
-- The refusal is the receipt check in fn_ca_promo_consume_event_fee, which
-- requires the entry-time receipt's gross_fee (the entitlement's refund_fee) to
-- equal the canonical fee row's rake_credit. That equation holds for every
-- variant except Spin, by design: a Spin entry carries no refundable fee
-- (refund_fee = 0) and its rake is recognised from the pool at the draw. Read
-- from production over the ten days to 2026-11-17, joining
-- accounting_tournament_fee_sources to its source entitlement:
--   spin             59,628 rows, refund_fee = 0 and rake_credit > 0 in all
--   sng / satellite / freezeout / bounty / progressive / mystery
--                    78,736 rows, refund_fee = rake_credit in all
-- So every Spin whose entrant sat after enforcement can never start.
--
-- The fix admits exactly that designed Spin shape and nothing else: a Spin
-- receipt that spent nothing on an entry fee (gross_fee = 0 AND principal = 0)
-- agrees with its canonical fee row whatever the draw rake is. Entitlement,
-- club and player identity are still compared for every row, a Spin receipt
-- that claims any entry fee or spent principal still refuses, and every other
-- variant keeps the exact gross_fee = rake_credit equation. The function still
-- returns r.principal (0 here), so recognising the Spin fee never spends promo
-- principal again.
--
-- No money moves and no row is written by this migration. Function-only DDL
-- on one function through the guarded replace(pg_get_functiondef) pattern: it
-- refuses unless the anchor is present exactly once, and re-reads the result.

BEGIN;

DO $migration$
DECLARE
  v_def text;
  v_anchor text := ' OR r.gross_fee IS DISTINCT FROM f.rake_credit OR ';
  v_replacement text := ' OR (r.gross_fee IS DISTINCT FROM f.rake_credit AND NOT (r.gross_fee=0 AND r.principal=0 AND EXISTS(SELECT 1 FROM public.tournaments spin WHERE spin.id=f.tournament_id AND spin.variant=''spin''))) OR ';
BEGIN
  v_def := pg_get_functiondef('public.fn_ca_promo_consume_event_fee(uuid)'::regprocedure);
  IF position(v_replacement IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_promo_consume_event_fee: fee agreement anchor is not present exactly once';
  END IF;
  EXECUTE replace(v_def, v_anchor, v_replacement);
  IF position(v_replacement IN pg_get_functiondef('public.fn_ca_promo_consume_event_fee(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'fn_ca_promo_consume_event_fee: amended fee agreement did not land';
  END IF;
END
$migration$;

REVOKE ALL ON FUNCTION public.fn_ca_promo_consume_event_fee(uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
