-- 20261119002137_the_promo_sweep_state_is_closed_to_service_role.sql
--
-- 20261118194330 (promo winnings are checked hourly, never per hand) was
-- installed on production by hand at 2026-11-18 19:43 UTC, during the lag
-- incident. Supabase's default privileges gave service_role full access to
-- the new table and EXECUTE on the new procedure. Only the sweep's owner
-- (the cron job, as postgres) reads or writes the table or calls the
-- procedure, so both are closed to service_role here. Idempotent.
--
-- @live-proof: NOT has_table_privilege('service_role', 'public.ca_promo_profit_sweep_state', 'SELECT')

BEGIN;

REVOKE ALL ON TABLE public.ca_promo_profit_sweep_state FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON PROCEDURE public.sp_ca_promo_profit_hourly_sweep(integer) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
