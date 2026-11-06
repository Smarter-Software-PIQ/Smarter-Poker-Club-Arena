-- 2026-11-05: fn_ca_escrow_balance_drift opened 4 incidents (prize +X / fee -X)
-- on events retired through the started-event operator abort. Every player was
-- refunded in full, the fee reversed exactly equals X, and every escrow closed at 0.
-- The shadow (fn_ca_tournament_escrow_chips) already ignores the negative rake
-- reversal rows written by atomic_cancel_tournament and fn_unregister_from_tournament,
-- because the refund legs carry that money; the operator abort writes the same
-- reversal as 'operator_abort_tournament', which the shadow counted a second time.
-- Measured before install on every affected event: 4 mismatched before, 0 after,
-- 0 newly mismatched.
do $mig$
declare src text := pg_get_functiondef('public.fn_ca_tournament_escrow_chips(uuid)'::regprocedure); out text;
begin
  out := replace(src, $$'atomic_cancel_tournament','fn_unregister_from_tournament'$$,
                      $$'atomic_cancel_tournament','fn_unregister_from_tournament','operator_abort_tournament'$$);
  if out = src then raise exception 'anchor not found'; end if;
  execute out;
end $mig$;
