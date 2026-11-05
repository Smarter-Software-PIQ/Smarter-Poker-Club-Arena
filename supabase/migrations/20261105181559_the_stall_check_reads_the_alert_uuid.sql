-- 20261105181559_the_stall_check_reads_the_alert_uuid
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-05 18:15:59 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.

--
-- ============================================================================
-- THE STALL CHECK READS THE ALERT UUID
-- ============================================================================
--
-- THE DEFECT, measured on production (kuklfnapbkmacvwxktbh) 2026-11-05:
-- fn_ca_engine_release_stall_check (20261102135212) declared `v_open bigint`,
-- but public.financial_alerts.id is uuid. The first run raised its page
-- (bbec606c-..., 2026-11-02 16:23Z); every later run read that page's id into
-- the bigint and failed ("invalid input syntax for type bigint", line 46).
-- cron ca-engine-release-stall-check-hourly failed 73 of 74 runs, so the page
-- never resolved although engines 67bc0e85 and 8017564a have since led, and a
-- new stall could never page. The native proof missed it because its fixture
-- gave financial_alerts a bigserial id.
--
-- WHAT THIS CHANGES: only the declaration `v_open bigint` becomes `v_open uuid`.
-- The installed definition must be exactly the 20261102135212 body (md5
-- guard); it is patched at that one anchor and re-created in place, so the
-- signature, SECURITY DEFINER, settings, grants (service_role only) and the
-- hourly cron job are unchanged. The next :23 run resolves the 2026-11-02
-- page against the engine that now leads.
--
-- Native proof: scripts/ci/test-a-stalled-engine-replacement-is-paged.py
-- (fixture financial_alerts.id is now uuid, matching production).
--
-- @live-proof: (SELECT pg_get_functiondef('public.fn_ca_engine_release_stall_check(integer,integer)'::regprocedure) LIKE '%v_open      uuid;%' AND pg_get_functiondef('public.fn_ca_engine_release_stall_check(integer,integer)'::regprocedure) NOT LIKE '%v_open      bigint;%' AND NOT has_function_privilege('anon','public.fn_ca_engine_release_stall_check(integer,integer)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_ca_engine_release_stall_check(integer,integer)','EXECUTE') AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-engine-release-stall-check-hourly' AND schedule = '23 * * * *' AND active))

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_engine_release_stall_check(integer,integer)'::regprocedure);
  v_anchor constant text := 'v_open      bigint;';
BEGIN
  IF md5(v_def) <> '949feaac5f11e663a370d4dd14cf1d47' THEN
    RAISE EXCEPTION 'fn_ca_engine_release_stall_check preimage md5 % is not the 20261102135212 body', md5(v_def);
  END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'v_open bigint anchor must occur exactly once';
  END IF;
  EXECUTE replace(v_def, v_anchor, 'v_open      uuid;');
END
$patch$;

COMMIT;
