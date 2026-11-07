-- A STOPPED TABLE IS MEASURED FROM THE MAINTENANCE THAW, NOT FROM BEFORE IT
-- (2026-11-07).
--
-- Of the 38 critical TableStoppedDealing alerts in the 2026-11-05 digest, 33
-- were raised 0-60 seconds after the hourly maintenance thaw (every one at
-- :05:0x, "no progress for ~600 seconds"). The engine's
-- poker_table_ms_since_progress counts from the table's last hand before the
-- :55 tournament break, so it already read ~600 s at the first watch tick
-- after fn_platform_frozen lifted at :05:00. Nothing was wrong with those
-- tables yet: by Dan's rule (2026-10-31) a stopped table is one that has not
-- dealt for 60 seconds when it should be dealing, and before the thaw it was
-- not supposed to deal.
--
-- Measured against hand_history for those 33: 13 resumed within 60 s of the
-- thaw (no stall at all) and 20 took longer (median 84 s, worst 14 min 4 s).
-- Those 20 are real, and this change keeps them: they are now raised at
-- thaw + 60 s, with the time measured since the thaw.
--
-- WHAT CHANGES:
--   * fn_ca_table_stall_watch_ingest reads the latest completed maintenance
--     break (engine_maintenance_break_log.break_ended_at <= now) once per
--     tick and adds it to each table's facts as maintenance_thawed_at.
--   * fn_ca_table_stall_decide returns 'resuming_after_maintenance' for a
--     table whose last progress predates that thaw while the thaw is under
--     60 seconds old. After 60 seconds without a hand the table is stopped
--     and is raised exactly as before.
--   * The alert summary of such a table says how long it has gone without a
--     hand SINCE the maintenance break ended, instead of the pre-break total.
-- Nothing else in the watch, its recovery or its escalation moves.
--
-- @live-proof: position('resuming_after_maintenance' IN pg_get_functiondef('public.fn_ca_table_stall_decide(jsonb,bigint,timestamptz,boolean,boolean)'::regprocedure)) > 0 AND position('maintenance_thawed_at' IN pg_get_functiondef('public.fn_ca_table_stall_watch_ingest(text,timestamptz,bigint)'::regprocedure)) > 0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_table_stall_watch_ingest(text,timestamptz,bigint)'::regprocedure)) IS DISTINCT FROM '8763c5fd6f5f268530fe0a3dbf1a021e' THEN
    RAISE EXCEPTION 'STALL_THAW_PREIMAGE_DRIFT fn_ca_table_stall_watch_ingest';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_table_stall_decide(jsonb,bigint,timestamptz,boolean,boolean)'::regprocedure)) IS DISTINCT FROM '6e7e7d09bd8e0ee7e80852190d77afd8' THEN
    RAISE EXCEPTION 'STALL_THAW_PREIMAGE_DRIFT fn_ca_table_stall_decide';
  END IF;
END $guard$;

DO $decide$
DECLARE b text; old text; replacement text;
BEGIN
  SELECT pg_get_functiondef('public.fn_ca_table_stall_decide(jsonb,bigint,timestamptz,boolean,boolean)'::regprocedure) INTO b;
  old := E'  IF p_maintenance THEN RETURN ''maintenance_break''; END IF;\n';
  replacement := old
    || E'  -- Measured from the thaw (20261107032642): a table whose last hand predates\n'
    || E'  -- the latest maintenance thaw is not stopped until 60 s after that thaw.\n'
    || E'  IF (p_facts->>''maintenance_thawed_at'')::timestamptz > p_now - interval ''60 seconds''\n'
    || E'     AND p_now - make_interval(secs => p_ms / 1000.0) < (p_facts->>''maintenance_thawed_at'')::timestamptz THEN\n'
    || E'    RETURN ''resuming_after_maintenance'';\n'
    || E'  END IF;\n';
  IF (length(b) - length(replace(b, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'STALL_THAW_PREIMAGE_DRIFT decide anchor';
  END IF;
  EXECUTE replace(b, old, replacement);
END $decide$;

DO $ingest$
DECLARE b text; a1 text; r1 text; a2 text; r2 text; a3 text; r3 text; a4 text; r4 text;
BEGIN
  SELECT pg_get_functiondef('public.fn_ca_table_stall_watch_ingest(text,timestamptz,bigint)'::regprocedure) INTO b;
  a1 := 'v_maint_since timestamptz;';
  r1 := 'v_maint_since timestamptz; v_last_thaw timestamptz;';
  a2 := E'  FOR r IN SELECT s.table_id, s.ms, s.paused FROM stall_sample s LOOP';
  r2 := E'  -- The latest completed maintenance break (20261107032642).\n'
     || E'  SELECT max(l.break_ended_at) INTO v_last_thaw FROM public.engine_maintenance_break_log l\n'
     || E'   WHERE l.break_ended_at <= p_now AND l.break_ended_at > p_now - interval ''1 day'';\n'
     || a2;
  a3 := 'v_facts := public.fn_ca_table_stall_facts(r.table_id, v_silent, p_now);';
  r3 := 'v_facts := public.fn_ca_table_stall_facts(r.table_id, v_silent, p_now) || jsonb_build_object(''maintenance_thawed_at'', v_last_thaw);';
  a4 := E'      v_summary := format(''%s has made no progress for %s seconds%s.'', COALESCE(NULLIF(v_facts->>''name'', ''''), ''A table''), r.ms / 1000,\n'
     || E'                          CASE WHEN v_people THEN '' with a player waiting'' ELSE '''' END);';
  r4 := E'      v_summary := CASE WHEN v_last_thaw IS NOT NULL AND p_now - make_interval(secs => r.ms / 1000.0) < v_last_thaw\n'
     || E'        THEN format(''%s has not dealt for %s seconds since the maintenance break ended%s.'', COALESCE(NULLIF(v_facts->>''name'', ''''), ''A table''),\n'
     || E'                    floor(extract(epoch FROM p_now - v_last_thaw))::bigint, CASE WHEN v_people THEN '' with a player waiting'' ELSE '''' END)\n'
     || E'        ELSE format(''%s has made no progress for %s seconds%s.'', COALESCE(NULLIF(v_facts->>''name'', ''''), ''A table''), r.ms / 1000,\n'
     || E'                    CASE WHEN v_people THEN '' with a player waiting'' ELSE '''' END) END;';
  IF (length(b) - length(replace(b, a1, ''))) / length(a1) <> 1
     OR (length(b) - length(replace(b, a2, ''))) / length(a2) <> 1
     OR (length(b) - length(replace(b, a3, ''))) / length(a3) <> 1
     OR (length(b) - length(replace(b, a4, ''))) / length(a4) <> 1 THEN
    RAISE EXCEPTION 'STALL_THAW_PREIMAGE_DRIFT ingest anchors';
  END IF;
  EXECUTE replace(replace(replace(replace(b, a1, r1), a2, r2), a3, r3), a4, r4);
END $ingest$;

-- The decision, exercised on the shapes of 2026-11-05 (pure function).
DO $prove$
DECLARE t timestamptz := '2026-11-05 15:05:08+00'; thaw timestamptz := '2026-11-05 15:05:00.13+00';
        f jsonb := jsonb_build_object('tournament_id', gen_random_uuid(), 'tournament_status', 'RUNNING',
                     'started_at', '2026-11-05 14:30:00+00', 'on_break', false, 'maintenance_thawed_at', thaw);
BEGIN
  IF public.fn_ca_table_stall_decide(f, 600000, t, false, false) IS DISTINCT FROM 'resuming_after_maintenance' THEN
    RAISE EXCEPTION 'STALL_THAW_PROOF a table 8 s after the thaw was called stopped';
  END IF;
  IF public.fn_ca_table_stall_decide(f, 661000, thaw + interval '61 seconds', false, false) IS NOT NULL THEN
    RAISE EXCEPTION 'STALL_THAW_PROOF a table silent 61 s after the thaw was not called stopped';
  END IF;
  IF public.fn_ca_table_stall_decide(f, 45000, thaw + interval '50 seconds', false, false) IS NOT NULL THEN
    RAISE EXCEPTION 'STALL_THAW_PROOF a table that dealt after the thaw and then stopped was excused';
  END IF;
END $prove$;

COMMIT;
