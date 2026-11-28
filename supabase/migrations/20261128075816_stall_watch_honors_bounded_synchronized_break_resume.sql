-- 20261128075816_stall_watch_honors_bounded_synchronized_break_resume
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-28.
--
-- STALL WATCH HONORS THE BOUNDED SYNCHRONIZED BREAK RESUME BOUNDARY (2026-11-28).
--
-- Incidents 82f7e3ed / 6139298e / 641a108f (TableStoppedDealing, 2026-11-28
-- 05:00:51Z on Friday Night Feature) and 20 of the 20 most recent
-- TableStoppedDealing alerts over the past 7 days:
--
-- WHAT WAS WRONG (proven live across 20/20 recent TableStoppedDealing alerts).
-- Every one fired at :00:02-:01:08 with break_started_at = HH:55:00,
-- on_break = false, break_ends_at = null, ms_since_progress = 301-362 s,
-- ~0.5 s before every table dealt its first post-break hand (e.g. Friday Night
-- Feature: alerted 05:00:51.587Z, all 3 tables dealt at 05:00:52.130-05:00:52.168Z).
--
-- Exact race:
--   1. ca-table-stall-watch-10s scrapes /metrics just before
--      TournamentManagerBase.resumeFromBreak() calls engine.resumeDealing(),
--      observing paused="1" and ms_since_progress = 301-362 s.
--   2. resumeFromBreak() commits clearPersistedBreak() (on_break = false,
--      break_ends_at = null) to PostgreSQL BEFORE calling engine.resumeDealing().
--   3. The stall-watch ingest RPC reads public.tournaments ~150-300 ms
--      later, sees on_break = false, and fn_ca_table_stall_decide returns NULL.
--
-- WHAT THIS CHANGES (surgical preimage-guarded patch to fn_ca_table_stall_decide):
--   * When p_engine_paused = true (the /metrics sample itself reported
--     paused="1"), AND break_started_at is within the last 8 minutes (5 m
--     break + 2 m last-hand grace + 1 m margin), AND the table's last progress
--     was at or after break_started_at - 2 minutes (so a pre-existing stall is
--     never excused), return 'tournament_break_resuming'.
--   * On the next 10 s scrape after resumeDealing(), p_engine_paused = false
--     and any genuine post-break stall is still caught at 60 s.
--   * If an engine bug leaves paused="1" stuck past 8 minutes from
--     break_started_at, it still alerts.
--   * All existing branches (resuming_after_maintenance, 60 s unexplained
--     pause cap, cash tables) remain byte-identical.
--
-- @live-proof: (SELECT position('tournament_break_resuming' IN pg_get_functiondef('public.fn_ca_table_stall_decide(jsonb,bigint,timestamp with time zone,boolean,boolean)'::regprocedure)) > 0 AND position('resuming_after_maintenance' IN pg_get_functiondef('public.fn_ca_table_stall_decide(jsonb,bigint,timestamp with time zone,boolean,boolean)'::regprocedure)) > 0)

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $decide$
DECLARE
  v_fn regprocedure := 'public.fn_ca_table_stall_decide(jsonb,bigint,timestamp with time zone,boolean,boolean)'::regprocedure;
  v_def text := pg_get_functiondef(v_fn);
  v_anchor text := E'    IF (p_facts->>''on_break'')::boolean AND COALESCE((p_facts->>''break_ends_at'')::timestamptz + interval ''1 minute'',\n                    (p_facts->>''break_started_at'')::timestamptz + interval ''10 minutes'') > p_now THEN RETURN ''tournament_break''; END IF;\n';
  v_replacement text := v_anchor
    || E'    -- Synchronized break resume boundary (2026-11-28): clearPersistedBreak()\n'
    || E'    -- commits on_break=false before engine.resumeDealing() resets ms_since_progress,\n'
    || E'    -- so a /metrics scrape captured just before release (paused="1") and ingested\n'
    || E'    -- just after the DB clear sees on_break=false with 300-365 s of break silence.\n'
    || E'    -- Honor that bounded boundary only while the engine sample itself still says\n'
    || E'    -- paused="1", within 8 minutes of break_started_at (5 m break + 2 m last-hand\n'
    || E'    -- grace + 1 m margin), and only if the table was progressing up to the break.\n'
    || E'    IF COALESCE(p_engine_paused, false)\n'
    || E'       AND (p_facts->>''break_started_at'')::timestamptz <= p_now\n'
    || E'       AND (p_facts->>''break_started_at'')::timestamptz > p_now - interval ''8 minutes''\n'
    || E'       AND p_now - make_interval(secs => p_ms / 1000.0) >= (p_facts->>''break_started_at'')::timestamptz - interval ''2 minutes'' THEN\n'
    || E'      RETURN ''tournament_break_resuming'';\n'
    || E'    END IF;\n';
  v_matches int;
BEGIN
  IF md5(v_def) IS DISTINCT FROM '077f272a204d8392dc292a49d1eec168' THEN
    RAISE EXCEPTION 'STALL_BREAK_RESUME_PREIMAGE_DRIFT fn_ca_table_stall_decide got %', md5(v_def)
      USING ERRCODE = '55000';
  END IF;
  v_matches := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  IF v_matches <> 1 THEN
    RAISE EXCEPTION 'STALL_BREAK_RESUME_ANCHOR_DRIFT anchor found % times', v_matches
      USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(v_def, v_anchor, v_replacement);
END $decide$;

DO $prove$
DECLARE
  v_now timestamptz := '2026-11-28 05:00:51.587705+00';
  v_facts jsonb := jsonb_build_object(
    'tournament_id', 'c1571cae-a9b7-40d6-af52-7133da02a0ce',
    'tournament_status', 'RUNNING',
    'started_at', '2026-11-28 03:00:00+00',
    'on_break', false,
    'break_started_at', '2026-11-28 04:55:00.002+00',
    'break_ends_at', NULL
  );
BEGIN
  -- 1. Exact Friday Night Feature race shape (paused=true at scrape, on_break=false at ingest)
  IF public.fn_ca_table_stall_decide(v_facts, 309508, v_now, false, true) IS DISTINCT FROM 'tournament_break_resuming' THEN
    RAISE EXCEPTION 'STALL_BREAK_RESUME_PROOF case 1 failed: bounded break resume was called stopped';
  END IF;
  -- 2. Next scrape once resumeDealing() cleared paused=false: a real stall STILL alerts
  IF public.fn_ca_table_stall_decide(v_facts, 65000, v_now + interval '65 seconds', false, false) IS NOT NULL THEN
    RAISE EXCEPTION 'STALL_BREAK_RESUME_PROOF case 2 failed: unpaused post-break stall was excused';
  END IF;
  -- 3. Stuck paused=true past the 8-minute bound STILL alerts
  IF public.fn_ca_table_stall_decide(v_facts, 481000, '2026-11-28 05:03:01+00'::timestamptz, false, true) IS NOT NULL THEN
    RAISE EXCEPTION 'STALL_BREAK_RESUME_PROOF case 3 failed: stuck pause past 8m bound was excused';
  END IF;
  -- 4. Table already stalled BEFORE the :55 break (last progress 04:52:51 < 04:53:00) STILL alerts
  IF public.fn_ca_table_stall_decide(v_facts, 480000, v_now, false, true) IS NOT NULL THEN
    RAISE EXCEPTION 'STALL_BREAK_RESUME_PROOF case 4 failed: pre-break stall was excused';
  END IF;
  -- 5. Unexplained paused table at 60 s (no tournament break) STILL alerts (20261107034100)
  IF public.fn_ca_table_stall_decide('{}'::jsonb, 60000, v_now, false, true) IS NOT NULL THEN
    RAISE EXCEPTION 'STALL_BREAK_RESUME_PROOF case 5 failed: unexplained 60s pause was excused';
  END IF;
  -- 6. Maintenance thaw boundary remains intact (20261107032642)
  IF public.fn_ca_table_stall_decide(
    v_facts || jsonb_build_object('maintenance_thawed_at', '2026-11-28 04:05:00+00'),
    600000, '2026-11-28 04:05:08+00'::timestamptz, false, false
  ) IS DISTINCT FROM 'resuming_after_maintenance' THEN
    RAISE EXCEPTION 'STALL_BREAK_RESUME_PROOF case 6 failed: maintenance thaw branch regressed';
  END IF;
END $prove$;

COMMIT;
