-- Current maintained weekly terms own this occurrence; legacy schedules keep
-- their existing6PM fallback until they carry that authoritative contract.
-- @live-proof: position('AND public.fn_ca_midway_weekly_terms(NEW.schedule_id) IS NULL' in pg_get_functiondef('public.fn_ca_bounty_mtt_rebuys_until_registration_closes()'::regprocedure)) > 0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $correct_sixpm$
DECLARE source text; needle text := $needle$     AND NEW.schedule_id = 'a70c1028-1800-2500-9000-000000000001'::uuid$needle$;
BEGIN
 SELECT pg_get_functiondef('public.fn_ca_bounty_mtt_rebuys_until_registration_closes()'::regprocedure) INTO source;
 IF md5(source)<>'2e0b024e984523fc7f10cb856ed6406d' THEN
  RAISE EXCEPTION 'Inspected definition changed: fn_ca_bounty_mtt_rebuys_until_registration_closes';
 END IF;
 IF (length(source)-length(replace(source,needle,'')))/length(needle)<>1 THEN
  RAISE EXCEPTION 'Expected one legacy6PM creation branch';
 END IF;
 EXECUTE replace(source,needle,needle||E'\n     AND public.fn_ca_midway_weekly_terms(NEW.schedule_id) IS NULL');
END $correct_sixpm$;
COMMIT;
