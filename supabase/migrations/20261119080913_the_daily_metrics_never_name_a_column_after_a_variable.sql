-- 20261119080913_the_daily_metrics_never_name_a_column_after_a_variable.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE DAILY METRICS NEVER NAME A COLUMN AFTER A VARIABLE
-- (Production Alerts incident sp-daily-metrics-snapshot-ambiguous-d,
-- operational_alert_events 445194 PgCronJobFailingRepeatedly and 445206
-- fn_ca_cron_failure_watch, 2026-11-19)
--
-- WHAT WAS WRONG, READ FROM ROWS (production, read-only, 2026-11-19 ~08:10 UTC)
--
-- cron job sp-daily-metrics-snapshot failed at 06:15, 06:45, 07:15 and 07:45
-- UTC (00:15-01:45 America/Chicago), every one with:
--   ERROR: column reference "d" is ambiguous
--   LINE 21: ...ER (ORDER BY beat_at, id) AS grp FROM hb) r WHERE d GROUP BY...
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
-- 20261118165140 (#11308, merged 01:10 UTC) added 'max_degraded_run' to the
-- horse_fleet block of public.fn_sp_daily_metrics_compute(date) and named its
-- run flag column `d`. That function DECLAREs `d jsonb` (the diamonds
-- section), so PL/pgSQL refuses the statement the first time it runs. The
-- substitution had only ever been planned, never executed: 00:15 Chicago is
-- the first real run, and every retry fails the same way. No sp_daily_metrics
-- row is written for 2026-11-18 until this is installed, and the 06:15 digest
-- has nothing to read.
--
-- THE FIX
--
-- Rename the column alias to is_degraded, which no variable of the function
-- uses (declared: s, e, us, ue, v_usd, v_big, g, m, d, sv, pl, ag, h, en,
-- sec, cap, fr). Meaning is unchanged: max_degraded_run is still the longest
-- run of consecutive fallback cycles in the day.
--
-- Same pinned-text substitution as 20261118165140: the live function must be
-- exactly that migration's postimage (md5 d28b32a8...), each anchor must occur
-- exactly once, and the result must read back as the derived postimage
-- (075e3684..., computed read-only from production's text on 2026-11-19)
-- with owner, SECURITY DEFINER, settings and grants unchanged.
--
-- WHY THE MIGRATION DOES NOT EXECUTE THE FUNCTION TO PROVE IT: a full run reads
-- tables that are not bounded by the day (the four failed runs spent 4 min
-- before reaching the faulty statement), and holding this DDL transaction
-- open that long is exactly what CLAUDE.md section 2 forbids. The invariant
-- is enforced statically instead: the md5 readback pins the exact text, and
-- tests/the-daily-metrics-never-name-a-column-after-a-variable.law.test.ts
-- refuses any replacement text, in this or a later migration, that names a
-- column or alias after one of the function's declared variables.
--
-- No hot-table lock: CREATE OR REPLACE FUNCTION only. One transaction.

BEGIN;

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

CREATE FUNCTION pg_temp.metrics_subst(p_sig text, p_before text, p_after text,
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
  IF array_length(p_old, 1) IS DISTINCT FROM array_length(p_new, 1) THEN
    RAISE EXCEPTION '%: anchors and replacements do not pair', p_sig;
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

-- max_degraded_run: the run flag is is_degraded, never the variable d.
SELECT pg_temp.metrics_subst(
  'public.fn_sp_daily_metrics_compute(date)',
  'd28b32a8562f5b24035f7fc0d1323326', '075e3684b69d680a55a2c29d81cf3de4',
  ARRAY[
$o1$SELECT COALESCE(degraded, false) AS d, count(*)$o1$,
$o2$FROM hb) r WHERE d GROUP BY grp$o2$],
  ARRAY[
$n1$SELECT COALESCE(degraded, false) AS is_degraded, count(*)$n1$,
$n2$FROM hb) r WHERE is_degraded GROUP BY grp$n2$]);

COMMIT;
