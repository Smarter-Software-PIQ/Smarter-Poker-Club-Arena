-- 20261123025029_stall_watch_gives_a_table_its_resume_minute_after_the_tourna.sql
--
-- A TOURNAMENT TABLE IS MEASURED FROM THE END OF ITS HOURLY BREAK, NOT FROM
-- BEFORE IT (2026-11-23, Production Alerts fleet, incident
-- stall-after-tournament-break).
--
-- WHAT WAS WRONG, READ FROM ROWS:
--   Every TableStoppedDealing raised by ca-stall-watch since 2026-11-20 (65 of
--   65, operational_alert_events 446358 .. 447723) was raised at :00:05 to
--   :01:11, right after the synchronized hourly tournament break, with
--   facts.on_break = false, facts.break_started_at = :55 and "no progress for
--   ~300-365 seconds". Each resolved itself 40-210 s later, and the first hand
--   after the break landed 5 min 0 s to 7 min 59 s after break_started_at.
--   Table 1bdbb114 (Sunday Night Late PKO) on 2026-11-23: last hand 01:55:34,
--   break, first hand 02:01:05; it was raised at 02:00:41.
--
-- THE CAUSE (one line of fn_ca_table_stall_decide):
--   The decision excuses a tournament table only while tournaments.on_break is
--   TRUE. The engine releases a break by writing on_break = false and
--   break_ends_at = NULL in one row version (TournamentManagerBase, break
--   release), so from the first watch tick after the release the table reads
--   as stopped, measured from its last hand BEFORE the break, although it has
--   not yet had a single second in which it was supposed to deal. This is the
--   tournament twin of 20261107032642, which fixed the same defect for the
--   maintenance thaw.
--
-- THE FIX:
--   fn_ca_table_stall_decide returns 'resuming_after_tournament_break' for a
--   tournament table that is no longer on break, whose last progress lies in
--   [break_started_at - 60 s, break_started_at + 2 min) (it was dealing up to
--   the break and its last hand was the pre-break hand), while now is under
--   break_started_at + 8 min. The bound is the engine's own worst case:
--   LAST_HAND_GRACE_MS (2 min, the countdown starts by then regardless) +
--   BREAK_DURATION_MS (5 min) is the latest a synchronized break can end, and
--   Dan's rule (2026-10-31, a stopped table is caught within 60 seconds) adds
--   the same 60 s the maintenance thaw gets. A table still silent past that
--   is raised exactly as before. A table that was already silent before the
--   break is not excused and keeps its existing alert.
-- Nothing else in the watch, its recovery, its summaries or its escalation
-- moves. No table, seat, chip or ledger row is touched; no hot-table lock.
--
-- @live-proof: position('resuming_after_tournament_break' IN pg_get_functiondef('public.fn_ca_table_stall_decide(jsonb,bigint,timestamptz,boolean,boolean)'::regprocedure)) > 0 AND public.fn_ca_table_stall_decide('{"tournament_id":"00000000-0000-0000-0000-000000000001","tournament_status":"RUNNING","on_break":false,"break_started_at":"2026-11-23T01:55:00Z"}'::jsonb, 306736, '2026-11-23T02:00:41Z'::timestamptz, false, false) = 'resuming_after_tournament_break'

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $patch$
DECLARE
  definition text := pg_get_functiondef('public.fn_ca_table_stall_decide(jsonb,bigint,timestamptz,boolean,boolean)'::regprocedure);
  anchor constant text := $a$(p_facts->>'break_started_at')::timestamptz + interval '10 minutes') > p_now THEN RETURN 'tournament_break'; END IF;$a$;
  addition constant text := $b$
    -- 20261123025029: the break release clears on_break; give the table the
    -- engine's worst-case break end (2 min last-hand grace + 5 min break) plus
    -- the 60 s every table gets, measured only for a table that was dealing up
    -- to the break.
    IF NOT COALESCE((p_facts->>'on_break')::boolean, false)
       AND (p_facts->>'break_started_at')::timestamptz IS NOT NULL
       AND p_now < (p_facts->>'break_started_at')::timestamptz + interval '8 minutes'
       AND p_now - make_interval(secs => p_ms / 1000.0) >= (p_facts->>'break_started_at')::timestamptz - interval '60 seconds'
       AND p_now - make_interval(secs => p_ms / 1000.0) < (p_facts->>'break_started_at')::timestamptz + interval '2 minutes' THEN
      RETURN 'resuming_after_tournament_break';
    END IF;$b$;
BEGIN
  IF md5(definition) IS DISTINCT FROM '077f272a204d8392dc292a49d1eec168' THEN
    RAISE EXCEPTION 'STALL_TOURNAMENT_BREAK_PREIMAGE_DRIFT fn_ca_table_stall_decide';
  END IF;
  IF (length(definition) - length(replace(definition, anchor, ''))) <> length(anchor) THEN
    RAISE EXCEPTION 'STALL_TOURNAMENT_BREAK_ANCHOR fn_ca_table_stall_decide';
  END IF;
  EXECUTE replace(definition, anchor, anchor || addition);
END $patch$;

DO $proof$
DECLARE
  bs constant timestamptz := '2026-11-23 01:55:00Z';
  f constant jsonb := jsonb_build_object('tournament_id', '00000000-0000-0000-0000-000000000001',
    'tournament_status', 'RUNNING', 'on_break', false, 'break_started_at', bs);
BEGIN
  -- The measured case: table 1bdbb114 raised at 02:00:41, last hand 01:55:34.
  IF public.fn_ca_table_stall_decide(f, 306736, '2026-11-23 02:00:41Z', false, false)
       IS DISTINCT FROM 'resuming_after_tournament_break' THEN
    RAISE EXCEPTION 'STALL_TOURNAMENT_BREAK_PROOF a table resuming after the break was called stopped';
  END IF;
  -- Still silent one second past the worst-case break end plus 60 s: raised.
  IF public.fn_ca_table_stall_decide(f, 451000, bs + interval '8 minutes 1 second', false, false) IS NOT NULL THEN
    RAISE EXCEPTION 'STALL_TOURNAMENT_BREAK_PROOF a table silent past the bound was not called stopped';
  END IF;
  -- Already silent 90 s before the break started: not excused.
  IF public.fn_ca_table_stall_decide(f, 450000, bs + interval '6 minutes', false, false) IS NOT NULL THEN
    RAISE EXCEPTION 'STALL_TOURNAMENT_BREAK_PROOF a table stopped before the break was excused';
  END IF;
  -- Unchanged neighbours.
  IF public.fn_ca_table_stall_decide(f || '{"on_break":true}', 306736, '2026-11-23 01:58:00Z', false, false) IS DISTINCT FROM 'tournament_break'
     OR public.fn_ca_table_stall_decide(f, 306736, '2026-11-23 02:00:41Z', true, false) IS DISTINCT FROM 'maintenance_break'
     OR public.fn_ca_table_stall_decide('{}', 306736, '2026-11-23 02:00:41Z', false, false) IS NOT NULL
     OR public.fn_ca_table_stall_decide('{}', 59999, '2026-11-07 03:35:00Z', false, true) IS DISTINCT FROM 'engine_paused'
     OR position('resuming_after_maintenance' IN pg_get_functiondef('public.fn_ca_table_stall_decide(jsonb,bigint,timestamptz,boolean,boolean)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'STALL_TOURNAMENT_BREAK_PROOF an existing stall decision changed';
  END IF;
END $proof$;

COMMIT;
