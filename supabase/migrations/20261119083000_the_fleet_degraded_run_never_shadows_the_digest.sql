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
-- re-apply is a no-op.
--
-- THE PROBE THAT COULD NOT FIT (corrected in place 2026-11-19, incident
-- dc479141). The first version proved the body by calling it for 2099-01-01,
-- on the belief that an empty day reads no history. A dozen sections of the
-- function are not bounded by the day (lifetime human totals, diamond
-- circulation, admins, stuck tournaments, freshness maxima): production
-- measures 238-264 s per call (cron sp-daily-metrics-snapshot, 06:15-09:45
-- UTC), and the applier killed the install at its statement budget (run
-- 44503916790, 10:20 UTC: "canceling statement due to statement timeout").
-- The whole-function call is therefore exempt, and the probe below executes
-- exactly the statement this file changes, inside PL/pgSQL with a variable
-- named d in scope - the shape that refused - over the real heartbeat table.
-- Measured on production 10:4x UTC: the old statement raises "column
-- reference "d" is ambiguous", the new one runs in ~100 ms over a full day.
-- scripts/ci/migration-cost-shape.mjs now refuses an install-time call of
-- this function (OVER_BUDGET_FUNCTIONS), at merge and in the applier.
--
-- @probe-exempt: public.fn_sp_daily_metrics_compute one call takes 238-264 s on production (cron sp-daily-metrics-snapshot, 2026-11-19), far past the install budget; the changed statement is executed by the DO block below with the colliding variable d in scope
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

-- The changed statement, executed as the function runs it: in PL/pgSQL, with
-- the function's own jsonb variable d in scope, over the last day of the real
-- heartbeat table (indexed by beat_at). Any planning error aborts the install.
DO $changed_statement$
DECLARE
  d jsonb;
  s timestamptz := now() - interval '1 day';
  e timestamptz := now();
  v_run bigint;
BEGIN
  WITH hb AS (SELECT * FROM public.ca_horse_fleet_heartbeat WHERE beat_at >= s AND beat_at < e)
  SELECT COALESCE(max(n), 0) INTO v_run
    FROM (SELECT count(*) AS n
            FROM (SELECT COALESCE(degraded, false) AS is_degraded,
                         count(*) FILTER (WHERE NOT COALESCE(degraded, false)) OVER (ORDER BY beat_at, id) AS grp
                    FROM hb) r
           WHERE r.is_degraded GROUP BY grp) q;
  IF v_run IS NULL OR v_run < 0 THEN
    RAISE EXCEPTION 'max_degraded_run read back %', v_run;
  END IF;
END $changed_statement$;

COMMIT;
