-- 20261111074922_a_table_resuming_from_its_tournament_break_is_not_stopped.sql
--
-- A TABLE RESUMING FROM ITS TOURNAMENT BREAK IS MEASURED FROM THE END OF THAT
-- BREAK, NOT FROM BEFORE IT (2026-11-11, operational alert 376615).
--
-- 20261107032642 fixed this for the daily MAINTENANCE thaw. The hourly
-- synchronized TOURNAMENT break (:55 last hand, five minutes once every table
-- has finished it) has the same shape and was never covered:
--
--   * During the break fn_ca_table_stall_decide answers 'tournament_break',
--     but only while tournaments.on_break is true.
--   * The engine's release (TournamentManagerBase, break release) writes
--     on_break = false and break_ends_at = NULL in one row version. Nothing
--     records WHEN the break ended.
--   * poker_table_ms_since_progress counts from the table's last hand before
--     the break, so at the first 10-second watch tick after the release every
--     tournament table reads ~300-400 s "since progress" and on_break is
--     already false. It is raised as TableStoppedDealing ("no progress for
--     309 seconds") before it has had a single second to deal.
--
-- Measured (operational_alert_events, 14 days to 2026-11-11 07:00Z): 248
-- TableStoppedDealing rows whose table's last hand fell inside a tournament
-- break that had just been released, 40 of them critical, raised at :00-:02
-- of almost every busy hour (07:00Z today: four tables of Five-Card Last
-- Chance, rows 376615-376618, every one dealing again by 07:00:50). Of the
-- 114 with a recorded first resumed hand, 89 dealt within 50 s of detection
-- (median 35 s, worst 91 s). The remaining 25 are real by Dan's rule
-- (2026-10-31: a stopped table is one that has not dealt for 60 seconds when
-- it should be dealing) and this change keeps them.
--
-- WHAT CHANGES:
--   * smarter_private.ca_table_stall_watch gains tournament_break_seen_at:
--     the last watch tick at which this table's tournament was on its break
--     (intended_reason = 'tournament_break'). The watch already sees every
--     silent tournament table on every tick of the break, so this is the
--     watch's own observation of the release, accurate to one 10 s tick. It
--     lives only while the table is silent: the row is deleted as soon as the
--     table deals, exactly as before.
--   * fn_ca_table_stall_watch_ingest passes it to the decision as
--     facts.tournament_break_seen_at and keeps it current in the upsert.
--   * fn_ca_table_stall_decide returns 'resuming_after_tournament_break' for
--     a table whose tournament is no longer on break, whose break was seen
--     less than 60 seconds ago, and whose last progress predates that. The
--     60 s is counted from the last tick that SAW the break, which is at most
--     one tick before the release, so the excuse never exceeds Dan's 60 s.
--     After that the table is stopped and raised exactly as before.
--   * The alert summary of such a table says how long it has gone without a
--     hand since its tournament break ended, instead of the pre-break total.
-- Nothing else in the watch, its recovery, its escalation or its routing moves.
--
-- Lock profile: ADD COLUMN (nullable, no default; metadata only) on the
-- watcher's private bookkeeping table, which only the stall-watch cron
-- writes. No player, money, seat or tournament relation is locked or written.
--
-- @live-proof: position('resuming_after_tournament_break' IN pg_get_functiondef('public.fn_ca_table_stall_decide(jsonb,bigint,timestamptz,boolean,boolean)'::regprocedure)) > 0 AND position('tournament_break_seen_at' IN pg_get_functiondef('public.fn_ca_table_stall_watch_ingest(text,timestamptz,bigint)'::regprocedure)) > 0 AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'smarter_private' AND table_name = 'ca_table_stall_watch' AND column_name = 'tournament_break_seen_at')

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_table_stall_watch_ingest(text,timestamptz,bigint)'::regprocedure)) IS DISTINCT FROM '7e5d5b4f64e15b1d539c16f130a2de95' THEN
    RAISE EXCEPTION 'STALL_BREAK_PREIMAGE_DRIFT fn_ca_table_stall_watch_ingest';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_table_stall_decide(jsonb,bigint,timestamptz,boolean,boolean)'::regprocedure)) IS DISTINCT FROM '077f272a204d8392dc292a49d1eec168' THEN
    RAISE EXCEPTION 'STALL_BREAK_PREIMAGE_DRIFT fn_ca_table_stall_decide';
  END IF;
END $guard$;

ALTER TABLE smarter_private.ca_table_stall_watch ADD COLUMN IF NOT EXISTS tournament_break_seen_at timestamptz;
COMMENT ON COLUMN smarter_private.ca_table_stall_watch.tournament_break_seen_at IS
  'Last watch tick at which this silent table''s tournament was on its synchronized break (20261111074922). The stall decision excuses the table for 60 s after it, never longer.';

DO $decide$
DECLARE b text; old text; replacement text;
BEGIN
  SELECT pg_get_functiondef('public.fn_ca_table_stall_decide(jsonb,bigint,timestamptz,boolean,boolean)'::regprocedure) INTO b;
  old := E'                    (p_facts->>''break_started_at'')::timestamptz + interval ''10 minutes'') > p_now THEN RETURN ''tournament_break''; END IF;\n';
  replacement := old
    || E'    -- Measured from the end of the break (20261111074922): the release writes no\n'
    || E'    -- end time, so the watch''s last tick that saw the break stands in for it.\n'
    || E'    -- A table silent since before that tick is not stopped until 60 s after it.\n'
    || E'    -- resuming_after_maintenance (20261107032642) is the same rule for the thaw.\n'
    || E'    IF NOT COALESCE((p_facts->>''on_break'')::boolean, false)\n'
    || E'       AND (p_facts->>''tournament_break_seen_at'')::timestamptz > p_now - interval ''60 seconds''\n'
    || E'       AND p_now - make_interval(secs => p_ms / 1000.0) < (p_facts->>''tournament_break_seen_at'')::timestamptz THEN\n'
    || E'      RETURN ''resuming_after_tournament_break'';\n'
    || E'    END IF;\n';
  IF (length(b) - length(replace(b, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'STALL_BREAK_PREIMAGE_DRIFT decide anchor';
  END IF;
  EXECUTE replace(b, old, replacement);
END $decide$;

DO $ingest$
DECLARE b text; a1 text; r1 text; a2 text; r2 text; a3 text; r3 text; a4 text; r4 text; a5 text; r5 text; a6 text; r6 text;
BEGIN
  SELECT pg_get_functiondef('public.fn_ca_table_stall_watch_ingest(text,timestamptz,bigint)'::regprocedure) INTO b;
  a1 := 'v_maint_since timestamptz; v_last_thaw timestamptz;';
  r1 := 'v_maint_since timestamptz; v_last_thaw timestamptz; v_break_seen timestamptz;';
  a2 := 'v_facts := public.fn_ca_table_stall_facts(r.table_id, v_silent, p_now) || jsonb_build_object(''maintenance_thawed_at'', v_last_thaw);';
  r2 := E'-- The watch''s own last sight of this table''s tournament break (20261111074922).\n'
     || E'    SELECT w.tournament_break_seen_at INTO v_break_seen FROM smarter_private.ca_table_stall_watch w WHERE w.table_id = r.table_id;\n'
     || E'    v_facts := public.fn_ca_table_stall_facts(r.table_id, v_silent, p_now) || jsonb_build_object(''maintenance_thawed_at'', v_last_thaw, ''tournament_break_seen_at'', v_break_seen);';
  a3 := 'INSERT INTO smarter_private.ca_table_stall_watch AS w (table_id, first_seen_at, last_seen_at, ms_since_progress, intended_reason, people_waiting, tournament_id)';
  r3 := 'INSERT INTO smarter_private.ca_table_stall_watch AS w (table_id, first_seen_at, last_seen_at, ms_since_progress, intended_reason, people_waiting, tournament_id, tournament_break_seen_at)';
  a4 := 'VALUES (r.table_id, p_now - make_interval(secs => r.ms / 1000.0), p_now, r.ms, v_reason, v_people, (v_facts->>''tournament_id'')::uuid)';
  r4 := 'VALUES (r.table_id, p_now - make_interval(secs => r.ms / 1000.0), p_now, r.ms, v_reason, v_people, (v_facts->>''tournament_id'')::uuid, CASE WHEN v_reason = ''tournament_break'' THEN p_now END)';
  a5 := 'intended_reason = EXCLUDED.intended_reason, people_waiting = EXCLUDED.people_waiting, tournament_id = EXCLUDED.tournament_id';
  r5 := 'intended_reason = EXCLUDED.intended_reason, people_waiting = EXCLUDED.people_waiting, tournament_id = EXCLUDED.tournament_id,'
     || E'\n          tournament_break_seen_at = COALESCE(EXCLUDED.tournament_break_seen_at, w.tournament_break_seen_at)';
  a6 := 'v_summary := CASE WHEN v_last_thaw IS NOT NULL AND p_now - make_interval(secs => r.ms / 1000.0) < v_last_thaw';
  r6 := E'v_summary := CASE WHEN v_break_seen IS NOT NULL AND p_now - make_interval(secs => r.ms / 1000.0) < v_break_seen\n'
     || E'                         AND (v_last_thaw IS NULL OR v_break_seen > v_last_thaw)\n'
     || E'        THEN format(''%s has not dealt for %s seconds since its tournament break ended%s.'', COALESCE(NULLIF(v_facts->>''name'', ''''), ''A table''),\n'
     || E'                    floor(extract(epoch FROM p_now - v_break_seen))::bigint, CASE WHEN v_people THEN '' with a player waiting'' ELSE '''' END)\n'
     || E'        WHEN v_last_thaw IS NOT NULL AND p_now - make_interval(secs => r.ms / 1000.0) < v_last_thaw';
  IF (length(b) - length(replace(b, a1, ''))) / length(a1) <> 1
     OR (length(b) - length(replace(b, a2, ''))) / length(a2) <> 1
     OR (length(b) - length(replace(b, a3, ''))) / length(a3) <> 1
     OR (length(b) - length(replace(b, a4, ''))) / length(a4) <> 1
     OR (length(b) - length(replace(b, a5, ''))) / length(a5) <> 1
     OR (length(b) - length(replace(b, a6, ''))) / length(a6) <> 1 THEN
    RAISE EXCEPTION 'STALL_BREAK_PREIMAGE_DRIFT ingest anchors';
  END IF;
  EXECUTE replace(replace(replace(replace(replace(replace(b, a1, r1), a2, r2), a3, r3), a4, r4), a5, r5), a6, r6);
END $ingest$;

-- The decision, exercised on the shapes of 2026-11-11 07:00Z (pure function).
DO $prove$
DECLARE t timestamptz := '2026-11-11 07:00:17+00'; seen timestamptz := '2026-11-11 07:00:07+00';
        f jsonb := jsonb_build_object('tournament_id', gen_random_uuid(), 'tournament_status', 'RUNNING',
                     'started_at', '2026-11-11 05:00:00+00', 'on_break', false, 'break_started_at', '2026-11-11 06:55:00+00',
                     'break_ends_at', NULL, 'sibling_tables', 3, 'sibling_tables_silent', 3,
                     'tournament_break_seen_at', seen);
BEGIN
  -- Row 376615: silent 309 s, released ~10 s ago. Not stopped.
  IF public.fn_ca_table_stall_decide(f, 309090, t, false, false) IS DISTINCT FROM 'resuming_after_tournament_break' THEN
    RAISE EXCEPTION 'STALL_BREAK_PROOF a table 10 s after its tournament break was called stopped';
  END IF;
  -- Still silent 61 s after the last tick that saw the break: stopped, raised as before.
  IF public.fn_ca_table_stall_decide(f, 371000, seen + interval '61 seconds', false, false) IS NOT NULL THEN
    RAISE EXCEPTION 'STALL_BREAK_PROOF a table silent 61 s after its tournament break was not called stopped';
  END IF;
  -- Dealt after the break and then stopped: not excused.
  IF public.fn_ca_table_stall_decide(f, 45000, seen + interval '50 seconds', false, false) IS NOT NULL THEN
    RAISE EXCEPTION 'STALL_BREAK_PROOF a table that dealt after its break and then stopped was excused';
  END IF;
  -- Still on the break: unchanged.
  IF public.fn_ca_table_stall_decide(f || jsonb_build_object('on_break', true), 200000, t, false, false) IS DISTINCT FROM 'tournament_break' THEN
    RAISE EXCEPTION 'STALL_BREAK_PROOF a table on its tournament break lost the tournament_break reason';
  END IF;
  -- A table never seen on a break is untouched (cash or a stall outside any break).
  IF public.fn_ca_table_stall_decide(f - 'tournament_break_seen_at', 309090, t, false, false) IS NOT NULL THEN
    RAISE EXCEPTION 'STALL_BREAK_PROOF a table never seen on a break was excused';
  END IF;
  -- The maintenance-thaw excuse is unchanged (20261107032642).
  IF public.fn_ca_table_stall_decide(f - 'tournament_break_seen_at' || jsonb_build_object('maintenance_thawed_at', t - interval '8 seconds'), 600000, t, false, false)
     IS DISTINCT FROM 'resuming_after_maintenance' THEN
    RAISE EXCEPTION 'STALL_BREAK_PROOF the maintenance-thaw excuse moved';
  END IF;
END $prove$;

-- The ingest carries the observation and keeps it in the upsert.
DO $prove_ingest$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.fn_ca_table_stall_watch_ingest(text,timestamptz,bigint)'::regprocedure);
  IF position('''tournament_break_seen_at'', v_break_seen' IN d) = 0
     OR position('CASE WHEN v_reason = ''tournament_break'' THEN p_now END' IN d) = 0
     OR position('COALESCE(EXCLUDED.tournament_break_seen_at, w.tournament_break_seen_at)' IN d) = 0
     OR position('since its tournament break ended' IN d) = 0 THEN
    RAISE EXCEPTION 'STALL_BREAK_PROOF ingest postimage incomplete';
  END IF;
END $prove_ingest$;

COMMIT;
