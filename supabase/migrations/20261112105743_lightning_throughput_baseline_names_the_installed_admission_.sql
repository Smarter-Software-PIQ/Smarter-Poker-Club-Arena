-- Relative throughput compares only one installed admission-definition cohort.
-- Owner-required 70-90s arrivals replaced accelerated 4.4-10s arrivals on
-- 2026-11-12 (20261112005012). At 10:45UTC the active NLH/PLO4 pools held
-- 48 players versus 127 at the same time yesterday; 30min committed cash
-- hands were 847 Lightning/195 Classic versus 3234/168. The historical
-- comparator must not call differently admitted populations an outage.
-- This read-only catalog RPC supplies a conservative definition fingerprint,
-- including replacement at the same migration version. No pace, floor,
-- payment, seat, timer, incident or historical series is changed.
-- 52 bits fit exactly in Prometheus float64 and are printed as an integer.
-- The consumer requires the same fingerprint throughout both 30min windows
-- and keeps its existing three-day minimum; unavailable is explicitly unknown.
-- @live-proof: strpos(pg_get_functiondef('public.fn_lightning_admission_policy()'::regprocedure), '::bit(52)::bigint') > 0 AND has_function_privilege('service_role','public.fn_lightning_admission_policy()','EXECUTE') AND NOT has_function_privilege('anon','public.fn_lightning_admission_policy()','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_lightning_admission_policy()','EXECUTE')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';
CREATE FUNCTION public.fn_lightning_admission_policy()
RETURNS TABLE (fingerprint bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
SET statement_timeout = '5s'
AS $function$
  SELECT ('x' || left(md5(pg_get_functiondef(
    to_regprocedure('public.fn_lightning_horse_admit_paced(uuid,uuid,timestamp with time zone)')
  )), 13))::bit(52)::bigint;
$function$;
REVOKE ALL ON FUNCTION public.fn_lightning_admission_policy() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lightning_admission_policy() TO service_role;
COMMIT;
