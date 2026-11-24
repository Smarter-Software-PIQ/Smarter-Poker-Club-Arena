-- @live-proof: (SELECT regexp_count(prosrc,'bounded_maintenance_freeze')=2 AND position('public.engine_maintenance_thaws' in prosrc)>0 AND position('v_now := clock_timestamp();' in prosrc)>0 FROM pg_proc WHERE oid='public.fn_ca_table_stall_watch_tick(bigint)'::regprocedure) AND (SELECT position('public.engine_maintenance_thaws' in prosrc)>0 AND position('GREATEST(' in prosrc)>0 AND position('tournament finished; it will not deal again' in prosrc)>0 FROM pg_proc WHERE oid='public.fn_ca_table_stall_watch_ingest(text,timestamp with time zone,bigint)'::regprocedure)
-- 20261124041800_stall_watch_v3_thaw_boundary.sql
--
-- Incident 6684eba0-e78b-4872-b968-1858d8ece5f7 (2026-11-24T04:04:59.914Z):
-- 15 false TableStoppedDealing alerts (2 critical on Prime Time Free Buy
-- 64b7c660 + 13 warning across 4 MTTs) fired in a single pg_cron tick
-- (3412938) straddling the 04:05:00Z maintenance thaw boundary:
--   1. At 04:03:50.404Z, v3 thaw committed engine_maintenance_thaws
--      (contract_version=3, shifted->>'complete'='true',
--      release_target_at=04:05:00.001Z) and deleted engine_maintenance_break.
--      fn_ca_table_stall_watch_tick's bounded_maintenance_freeze guard only
--      checked engine_maintenance_break, so the final 70s of the bounded
--      freeze stopped skipping and ran full HTTP scrapes + profile scans.
--   2. Tick 3412938 froze v_now := clock_timestamp() at 04:04:59.914Z BEFORE
--      http_get('/metrics'). During the ~500ms HTTP call, MaintenanceBreak.end()
--      flipped poker_maintenance_break_active to 0 at 04:05:00.111Z before
--      recordOutcome committed engine_maintenance_break_log at 04:05:00.337Z.
--      fn_ca_table_stall_watch_ingest then queried break_ended_at <= p_now
--      (04:05:00.111 <= 04:04:59.914 = FALSE) and saw the 3-hour-old thaw
--      (01:05:00.132Z), bypassing resuming_after_maintenance.
--
-- Fix (two preimage-guarded surgical anchor patches, zero change to the 60s
-- post-thaw stall detection rule):
--   * fn_ca_table_stall_watch_tick(bigint): extend both
--     bounded_maintenance_freeze guards to also recognize bounded complete v3
--     thaw rows (<= 5 minutes) in public.engine_maintenance_thaws, and refresh
--     v_now := clock_timestamp() after http_get('/metrics') returns.
--   * fn_ca_table_stall_watch_ingest(text,timestamptz,bigint): compute
--     v_last_thaw as GREATEST(engine_maintenance_break_log.break_ended_at,
--     bounded complete v3 engine_maintenance_thaws.release_target_at <= p_now).
--     Because MaintenanceBreak.waitForCertifiedRelease polls Postgres
--     fn_active_maintenance_release_boundary(), phase='idle' cannot flip before
--     clock_timestamp() >= release_target_at, eliminating both pre-HTTP v_now
--     skew and the recordOutcome commit-lag race.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $stall_watch_v3_thaw$
DECLARE
  v_tick_fn regprocedure := 'public.fn_ca_table_stall_watch_tick(bigint)'::regprocedure;
  v_ingest_fn regprocedure := 'public.fn_ca_table_stall_watch_ingest(text,timestamp with time zone,bigint)'::regprocedure;
  v_tick_def text := pg_get_functiondef(v_tick_fn);
  v_ingest_def text := pg_get_functiondef(v_ingest_fn);
  v_tick_patched text;
  v_ingest_patched text;
  v_n int;

  v_old_freeze_guard text := $guard$  IF public.fn_platform_frozen() AND EXISTS (
    SELECT 1 FROM public.engine_maintenance_break b
    WHERE b.enforce_freeze AND b.phase='counting_down'
      AND b.break_started_at <= clock_timestamp()
      AND b.break_ends_at > clock_timestamp()
      AND b.break_ends_at > b.break_started_at
      AND b.break_ends_at <= b.break_started_at + interval '5 minutes'
  ) THEN
    RETURN jsonb_build_object('skipped','bounded_maintenance_freeze');
  END IF;$guard$;

  v_new_freeze_guard text := $guard$  IF public.fn_platform_frozen() AND (
    EXISTS (
      SELECT 1 FROM public.engine_maintenance_break b
      WHERE b.enforce_freeze AND b.phase='counting_down'
        AND b.break_started_at <= clock_timestamp()
        AND b.break_ends_at > clock_timestamp()
        AND b.break_ends_at > b.break_started_at
        AND b.break_ends_at <= b.break_started_at + interval '5 minutes'
    ) OR EXISTS (
      SELECT 1 FROM public.engine_maintenance_thaws t
      WHERE t.contract_version = 3
        AND COALESCE((t.shifted->>'complete')::boolean, false)
        AND t.freeze_started_at IS NOT NULL
        AND t.freeze_started_at <= clock_timestamp()
        AND t.release_target_at > clock_timestamp()
        AND t.release_target_at > t.freeze_started_at
        AND t.release_target_at <= t.freeze_started_at + interval '5 minutes'
    )
  ) THEN
    RETURN jsonb_build_object('skipped','bounded_maintenance_freeze');
  END IF;$guard$;

  v_old_ingest_call text := '  RETURN public.fn_ca_table_stall_watch_ingest(v_body, v_now, p_threshold_ms);';
  v_new_ingest_call text := E'  v_now := clock_timestamp();\n  RETURN public.fn_ca_table_stall_watch_ingest(v_body, v_now, p_threshold_ms);';

  v_old_last_thaw text := $thaw$  -- The latest completed maintenance break (20261107032642).
  SELECT max(l.break_ended_at) INTO v_last_thaw FROM public.engine_maintenance_break_log l
   WHERE l.break_ended_at <= p_now AND l.break_ended_at > p_now - interval '1 day';$thaw$;

  v_new_last_thaw text := $thaw$  -- The latest completed maintenance break (20261107032642, 20261124041800).
  -- Include bounded complete v3 engine_maintenance_thaws.release_target_at so a
  -- post-thaw scrape before engine_maintenance_break_log commits still observes
  -- the certified thaw boundary without weakening the 60s stall catch.
  SELECT GREATEST(
    (SELECT max(l.break_ended_at) FROM public.engine_maintenance_break_log l
      WHERE l.break_ended_at <= p_now AND l.break_ended_at > p_now - interval '1 day'),
    (SELECT max(t.release_target_at) FROM public.engine_maintenance_thaws t
      WHERE t.contract_version = 3
        AND COALESCE((t.shifted->>'complete')::boolean, false)
        AND t.freeze_started_at IS NOT NULL
        AND t.release_target_at > t.freeze_started_at
        AND t.release_target_at <= t.freeze_started_at + interval '5 minutes'
        AND t.release_target_at <= p_now
        AND t.release_target_at > p_now - interval '1 day')
  ) INTO v_last_thaw;$thaw$;
BEGIN
  IF md5(v_tick_def) IS DISTINCT FROM '87164ec27781d0534559e80a6fd16bf4' THEN
    RAISE EXCEPTION 'STALL_WATCH_V3_THAW_PREIMAGE_DRIFT fn_ca_table_stall_watch_tick got %', md5(v_tick_def)
      USING ERRCODE = '55000';
  END IF;
  IF md5(v_ingest_def) IS DISTINCT FROM '91feca7e2e98b63f1f28777cda57b67a' THEN
    RAISE EXCEPTION 'STALL_WATCH_V3_THAW_PREIMAGE_DRIFT fn_ca_table_stall_watch_ingest got %', md5(v_ingest_def)
      USING ERRCODE = '55000';
  END IF;

  v_n := (length(v_tick_def) - length(replace(v_tick_def, v_old_freeze_guard, ''))) / length(v_old_freeze_guard);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'freeze guard anchor found % times in fn_ca_table_stall_watch_tick, expected 2', v_n
      USING ERRCODE = '55000';
  END IF;
  v_n := (length(v_tick_def) - length(replace(v_tick_def, v_old_ingest_call, ''))) / length(v_old_ingest_call);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ingest call anchor found % times in fn_ca_table_stall_watch_tick, expected 1', v_n
      USING ERRCODE = '55000';
  END IF;

  v_tick_patched := replace(replace(v_tick_def, v_old_freeze_guard, v_new_freeze_guard), v_old_ingest_call, v_new_ingest_call);
  IF replace(replace(v_tick_patched, v_new_ingest_call, v_old_ingest_call), v_new_freeze_guard, v_old_freeze_guard) IS DISTINCT FROM v_tick_def THEN
    RAISE EXCEPTION 'STALL_WATCH_V3_THAW_ROUNDTRIP_DRIFT fn_ca_table_stall_watch_tick'
      USING ERRCODE = '55000';
  END IF;

  v_n := (length(v_ingest_def) - length(replace(v_ingest_def, v_old_last_thaw, ''))) / length(v_old_last_thaw);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'last thaw anchor found % times in fn_ca_table_stall_watch_ingest, expected 1', v_n
      USING ERRCODE = '55000';
  END IF;

  v_ingest_patched := replace(v_ingest_def, v_old_last_thaw, v_new_last_thaw);
  IF replace(v_ingest_patched, v_new_last_thaw, v_old_last_thaw) IS DISTINCT FROM v_ingest_def THEN
    RAISE EXCEPTION 'STALL_WATCH_V3_THAW_ROUNDTRIP_DRIFT fn_ca_table_stall_watch_ingest'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE v_tick_patched;
  EXECUTE v_ingest_patched;

  IF position('public.engine_maintenance_thaws' in pg_get_functiondef(v_tick_fn)) = 0
     OR position('v_now := clock_timestamp();' in pg_get_functiondef(v_tick_fn)) = 0 THEN
    RAISE EXCEPTION 'rewrite of fn_ca_table_stall_watch_tick did not land';
  END IF;
  IF position('public.engine_maintenance_thaws' in pg_get_functiondef(v_ingest_fn)) = 0
     OR position('GREATEST(' in pg_get_functiondef(v_ingest_fn)) = 0
     OR position('tournament finished; it will not deal again' in pg_get_functiondef(v_ingest_fn)) = 0 THEN
    RAISE EXCEPTION 'rewrite of fn_ca_table_stall_watch_ingest did not land';
  END IF;
END
$stall_watch_v3_thaw$;

COMMIT;
