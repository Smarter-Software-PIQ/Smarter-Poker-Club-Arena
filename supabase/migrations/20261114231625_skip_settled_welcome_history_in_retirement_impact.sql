-- After an immutable welcome-v1 reset, the package can never be pristine again.
-- Rewalking its retired games and hands here timed out inside financial closure.
-- The core balance, authorization, gameplay and command checks above this
-- branch are still evaluated on every inspection.
-- @live-proof: position('r.result->>''operation_id'' = r.operation_id::text' in pg_get_functiondef('public.fn_club_retirement_impact(uuid)'::regprocedure)) > 0
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

DO $migration$
DECLARE
  target regprocedure := 'public.fn_club_retirement_impact(uuid)'::regprocedure;
  original text := pg_get_functiondef(target);
  first_line text := '  v_reset := public.fn_get_club_welcome_package_reset_impact(p_club_id);';
  last_line text := '  RETURN v_result || jsonb_build_object(';
  start_at integer := strpos(original, first_line);
  end_at integer := strpos(original, last_line);
  pristine_checks text;
  guarded_checks text;
BEGIN
  IF md5(original) <> '7e66802572f72b6d891aaa8f51c8900f' OR start_at=0 OR end_at<=start_at THEN
    RAISE EXCEPTION 'Requalify the welcome retirement impact body before changing it';
  END IF;
  pristine_checks := substr(original,start_at,end_at-start_at);
  guarded_checks := $guard$  IF NOT EXISTS (
    SELECT 1 FROM public.club_welcome_reset_receipts r
     WHERE r.club_id = p_club_id AND r.result @> '{"ok":true,"package_version":"welcome-v1"}'::jsonb
       AND r.result->>'club_id' = p_club_id::text
       AND r.result->>'operation_id' = r.operation_id::text
  ) THEN
$guard$ || pristine_checks || E'  END IF;\n';
  EXECUTE replace(original,pristine_checks,guarded_checks);
  IF replace(pg_get_functiondef(target),guarded_checks,pristine_checks) IS DISTINCT FROM original THEN
    RAISE EXCEPTION 'Retirement impact changed outside the pristine welcome check';
  END IF;
END
$migration$;
COMMIT;
