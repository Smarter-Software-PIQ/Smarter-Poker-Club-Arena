-- 2026-11-05: "1 diamond movements over 10,000" fired every night for the Table
-- Studio commerce certification, which funds a throwaway example.invalid account
-- with 18,975 diamonds (reference customization-cert-fund:*), tests a purchase and
-- deletes the account. Test fixtures are not money moving between people; skip them.
-- The owner's own large moves (e.g. KINGFISH Diamond Spins) still show.
do $mig$
declare
  src text := pg_get_functiondef('public.fn_sp_daily_metrics_compute(date)'::regprocedure);
  out text;
begin
  out := replace(src,
    'WHERE abs(dt.amount) > v_big AND dt.tt NOT IN (''arena_deposit'',''arena_withdraw'')',
    'WHERE abs(dt.amount) > v_big AND dt.tt NOT IN (''arena_deposit'',''arena_withdraw'')
            AND NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = dt.user_id AND au.email ~* ''\.invalid$'')');
  if out = src then raise exception 'big_movements anchor not found'; end if;
  execute out;
end
$mig$;
