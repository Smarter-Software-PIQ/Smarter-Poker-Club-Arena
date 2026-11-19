-- 20261119083000_the_fleet_degraded_run_never_shadows_the_digest.sql
--
-- THE FLEET DEGRADED RUN NEVER SHADOWS THE DIGEST (fn_sp_daily_metrics_compute, 2026-11-19)
--
-- WHAT WAS WRONG, READ FROM ROWS (production, read-only, 2026-11-19 ~08:20 UTC)
--
-- pg_cron sp-daily-metrics-snapshot failed on every run from 06:15 UTC
-- (PgCronJobFailingRepeatedly, fn_ca_cron_failure_watch): "column reference
-- "d" is ambiguous ... FROM hb) r WHERE d GROUP BY grp". #11308 (the horse
-- fleet measures its stuck horses) added max_degraded_run with a derived column
-- aliased `d`, and the function DECLAREs `d jsonb` for its digest block.
-- PL/pgSQL resolves a bare `d` against both, so the statement cannot plan;
-- CREATE FUNCTION checks syntax only and installed it. The daily metrics
-- snapshot - the source of the morning digest - has not been written since.
--
-- THE FIX
--
-- The derived column is named is_degraded and read qualified (r.is_degraded),
-- so no name in the statement can resolve to a variable. Pinned pre/postimage;
-- re-apply is a no-op. The probe below executes the new body before COMMIT
-- (tests/a-migration-proves-its-functions-before-commit.law.test.ts) on a day
-- with no rows, so every statement plans without reading a day of history.
--
-- @live-proof: position('AS is_degraded' in pg_get_functiondef('public.fn_sp_daily_metrics_compute(date)'::regprocedure)) > 0 AND position('r WHERE d GROUP BY' in pg_get_functiondef('public.fn_sp_daily_metrics_compute(date)'::regprocedure)) = 0

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

CREATE FUNCTION pg_temp.dmc_subst(p_sig text, p_before text, p_after text,
                                  p_old text[], p_new text[])
RETURNS void LANGUAGE plpgsql AS $h$
DECLARE
  v_def text; v_new text; v_n integer; i integer;
  v_acl text; v_owner text; v_secdef boolean; v_cfg text[];
BEGIN
  v_def := pg_get_functiondef(p_sig::regprocedure);
  IF md5(v_def) = p_after THEN
    RAISE NOTICE '%: already the postimage, nothing to do', p_sig;
    RETURN;
  END IF;
  IF md5(v_def) <> p_before THEN
    RAISE EXCEPTION '% is not the pinned text (md5 %)', p_sig, md5(v_def);
  END IF;
  v_new := v_def;
  FOR i IN 1 .. array_length(p_old, 1) LOOP
    v_n := (length(v_new) - length(replace(v_new, p_old[i], ''))) / length(p_old[i]);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: anchor % occurs % times, expected exactly 1', p_sig, i, v_n;
    END IF;
    v_new := replace(v_new, p_old[i], p_new[i]);
  END LOOP;
  IF md5(v_new) <> p_after THEN
    RAISE EXCEPTION '%: substituted text is not the derived postimage (md5 %)', p_sig, md5(v_new);
  END IF;
  SELECT p.proacl::text, pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_acl, v_owner, v_secdef, v_cfg
    FROM pg_proc p WHERE p.oid = p_sig::regprocedure;
  EXECUTE v_new;
  IF md5(pg_get_functiondef(p_sig::regprocedure)) <> p_after THEN
    RAISE EXCEPTION '%: the replaced function does not read back as the postimage', p_sig;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = p_sig::regprocedure
                    AND p.proacl::text IS NOT DISTINCT FROM v_acl
                    AND pg_get_userbyid(p.proowner) = v_owner
                    AND p.prosecdef = v_secdef
                    AND p.proconfig IS NOT DISTINCT FROM v_cfg) THEN
    RAISE EXCEPTION '%: owner, security, settings or grants moved', p_sig;
  END IF;
END $h$;

SELECT pg_temp.dmc_subst(
  'public.fn_sp_daily_metrics_compute(date)',
  'd28b32a8562f5b24035f7fc0d1323326', 'defe7f21cf46a34c59ff1d374b455e25',
  ARRAY[
$o1$COALESCE(degraded, false) AS d, count(*) FILTER$o1$,
$o2$FROM hb) r WHERE d GROUP BY grp$o2$],
  ARRAY[
$n1$COALESCE(degraded, false) AS is_degraded, count(*) FILTER$n1$,
$n2$FROM hb) r WHERE r.is_degraded GROUP BY grp$n2$]);

-- @probe-for: public.fn_sp_daily_metrics_compute
DO $probe$
BEGIN
  PERFORM public.fn_sp_daily_metrics_compute(DATE '2099-01-01');
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
