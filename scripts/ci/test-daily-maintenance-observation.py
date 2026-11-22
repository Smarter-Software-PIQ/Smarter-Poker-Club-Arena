#!/usr/bin/env python3
"""Run the actual schedule-observer migration on isolated PostgreSQL, never production."""
import os
from pathlib import Path
import socket
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
MIGRATION = next((ROOT / 'supabase/migrations').glob('*_daily_chicago_maintenance_observation.sql'))
THREE_HOURLY_MIGRATION = next((ROOT / 'supabase/migrations').glob('*_three_hourly_break_scorecard_and_weekly_report.sql'))
WEEKLY_REPORT_ORIGINAL = ROOT / 'supabase/migrations/20260902120000_the_break_writes_its_own_weekly_report.sql'

def function(source, name):
    a = source.index('CREATE OR REPLACE FUNCTION public.' + name + '(')
    b = source.index('END $function$;', a) + len('END $function$;')
    return source[a:b]

with tempfile.TemporaryDirectory(prefix='daily-pg-') as tmp:
    temp = Path(tmp)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    def run(args, **kwargs):
        return subprocess.run([str(x) for x in args], text=True, capture_output=True, timeout=45, **kwargs)
    def sql(source, ok=True):
        result = run([PG/'psql', '-X', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], input=source)
        if ok and result.returncode: raise AssertionError(result.stderr)
        return result
    result = run([PG/'initdb', '-D', temp/'data', '-A', 'trust', '-U', 'postgres', '--no-locale'])
    assert result.returncode == 0, result.stderr
    result = run([PG/'pg_ctl', '-D', temp/'data', '-l', temp/'log', '-o', f"-h 127.0.0.1 -p {port} -k ''", '-w', 'start'])
    assert result.returncode == 0, result.stderr
    try:
        first = (ROOT/'supabase/migrations/20260902203100_engine_restart_phase1_scorecard_freezeproof_dispatcher.sql').read_text()
        table = first[first.index('CREATE TABLE IF NOT EXISTS public.ca_break_scorecards'):first.index('COMMENT ON TABLE public.ca_break_scorecards')]
        original = function((ROOT/'supabase/migrations/20260910132747_the_break_scorecard_names_why_a_break_never_started.sql').read_text(), 'fn_ca_record_break_scorecard')
        sql('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE engine_maintenance_break_log(break_started_at timestamptz, break_ended_at timestamptz, unparked_at_countdown int, peak_unparked int, ready_for_restart_at timestamptz, recorded_at timestamptz default now());
CREATE TABLE engine_maintenance_break_faults(announced_at timestamptz, stage text, outcome text, error text, recorded_at timestamptz);
CREATE TABLE hand_history(created_at timestamptz, table_id uuid);
CREATE TABLE engine_maintenance_thaws(freeze_started_at timestamptz, frozen_seconds numeric, thawed_at timestamptz, shifted jsonb default '{}'::jsonb);
CREATE TABLE engine_recovery_events(event text, event_class text, created_at timestamptz);
CREATE TABLE tables(id uuid, status text);
CREATE TABLE ca_engine_deploy_attempts(at timestamptz, target_sha text, shipped bool);
CREATE TABLE ca_freeze_circulation_marks(window_hour timestamptz, kind text, total numeric);
''' + table + '''
ALTER TABLE ca_break_scorecards ADD COLUMN unparked_at_countdown int, ADD COLUMN peak_unparked int, ADD COLUMN ready_for_restart_at timestamptz, ADD COLUMN gate_opened bool;
CREATE FUNCTION fn_ca_break_scorecard_push(ca_break_scorecards) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
''' + original)
        # Reproduce the old defect without games or money: no break was due,
        # but the old default still writes a failed global-maintenance card.
        assert sql("SELECT (fn_ca_record_break_scorecard()).verdict").stdout.strip() == 'fail'
        sql('TRUNCATE ca_break_scorecards;')
        sql(MIGRATION.read_text())
        source = MIGRATION.read_text()
        selection = source.split('-- DAILY_OBSERVATION_SELECTION_BEGIN')[1].split('-- DAILY_OBSERVATION_SELECTION_END')[0]
        selection = selection.replace('v_observed_at', 'p_at').replace(' INTO v_end', '')
        fixture_sql = 'CREATE FUNCTION pg_temp.expected_end(p_at timestamptz) RETURNS timestamptz LANGUAGE sql AS $select$' + selection + '$select$;'
        replay = sql(MIGRATION.read_text(), ok=False)
        assert replay.returncode != 0 and 'preimage changed' in replay.stderr
        sql(fixture_sql + '''DO $test$ BEGIN
  IF pg_temp.expected_end('2026-10-20 17:12Z') IS NOT NULL THEN RAISE EXCEPTION 'ordinary hour invented a break'; END IF;
  IF pg_temp.expected_end('2026-10-20 09:12Z') <> '2026-10-20 09:05Z'::timestamptz THEN RAISE EXCEPTION 'CDT boundary'; END IF;
  IF pg_temp.expected_end('2026-11-01 10:12Z') <> '2026-11-01 10:05Z'::timestamptz THEN RAISE EXCEPTION 'CST boundary'; END IF;
  IF pg_temp.expected_end('2026-03-08 09:12Z') <> '2026-03-08 09:05Z'::timestamptz THEN RAISE EXCEPTION 'spring boundary'; END IF;
  IF pg_temp.expected_end('2026-10-20 09:04:59Z') IS NOT NULL THEN RAISE EXCEPTION 'premature observation'; END IF;
  IF pg_temp.expected_end('2026-10-20 10:05Z') IS NOT NULL THEN RAISE EXCEPTION 'expired expectation'; END IF;
END $test$;
INSERT INTO engine_maintenance_break_log VALUES ('2026-10-20 17:25:30Z','2026-10-20 17:30:31Z',0,0,'2026-10-20 17:25:35Z',now());
DO $test$ BEGIN
  IF pg_temp.expected_end('2026-10-20 18:12Z') <> '2026-10-20 17:30:30Z'::timestamptz THEN RAISE EXCEPTION 'emergency omitted'; END IF;
  IF pg_temp.expected_end('2026-10-20 18:31Z') IS NOT NULL THEN RAISE EXCEPTION 'old emergency replayed'; END IF;
END $test$;
TRUNCATE engine_maintenance_break_log;
''')
        # Explicit scheduled missing-break evidence still fails; only no-break-
        # due returns NULL and leaves no phantom result.
        assert sql("SELECT (fn_ca_record_break_scorecard('2026-10-20 09:05Z')).verdict").stdout.strip() == 'fail'
        print('PASS: fail-before, exact migration, daily/DST/emergency boundaries, missing-break failure and replay refusal')

        # Now apply the E6 three-hourly scorecard + weekly report migration on top
        # of both predecessor definitions and prove daily, three-hourly, DST, and
        # weekly-report behavior.
        sql(WEEKLY_REPORT_ORIGINAL.read_text())
        sql('TRUNCATE ca_break_scorecards, engine_maintenance_break_log, engine_maintenance_thaws, hand_history;')
        e6_source = THREE_HOURLY_MIGRATION.read_text()
        live_proof = next(
            line.split('-- @live-proof:', 1)[1].strip()
            for line in e6_source.splitlines()
            if line.strip().startswith('-- @live-proof:')
        )
        assert sql(f'SELECT ({live_proof})').stdout.strip() == 'f', 'live-proof must be false before E6 migration'
        sql(e6_source)
        assert sql(f'SELECT ({live_proof})').stdout.strip() == 't', 'live-proof must be true after E6 migration'
        e6_replay = sql(e6_source, ok=False)
        assert e6_replay.returncode != 0 and 'preimage changed' in e6_replay.stderr

        e6_selection = e6_source.split('-- DAILY_OBSERVATION_SELECTION_BEGIN')[1].split('-- DAILY_OBSERVATION_SELECTION_END')[0]
        e6_selection = e6_selection.replace('v_observed_at', 'p_at').replace(' INTO v_end', '')
        e6_fixture = 'CREATE FUNCTION pg_temp.expected_end_e6(p_at timestamptz) RETURNS timestamptz LANGUAGE sql AS $select$' + e6_selection + '$select$;'
        sql(e6_fixture + '''DO $test$ BEGIN
  -- Daily fallback (no non-04 breaks in last 24h): identical 04:05 Chicago anchor across CDT/CST/DST.
  IF pg_temp.expected_end_e6('2026-10-20 17:12Z') IS NOT NULL THEN RAISE EXCEPTION 'daily mode invented ordinary hour'; END IF;
  IF pg_temp.expected_end_e6('2026-10-21 00:12Z') IS NOT NULL THEN RAISE EXCEPTION 'daily mode invented 19:00 CDT slot'; END IF;
  IF pg_temp.expected_end_e6('2026-10-20 09:12Z') <> '2026-10-20 09:05Z'::timestamptz THEN RAISE EXCEPTION 'daily CDT boundary'; END IF;
  IF pg_temp.expected_end_e6('2026-11-01 10:12Z') <> '2026-11-01 10:05Z'::timestamptz THEN RAISE EXCEPTION 'daily CST boundary'; END IF;
  IF pg_temp.expected_end_e6('2026-03-08 09:12Z') <> '2026-03-08 09:05Z'::timestamptz THEN RAISE EXCEPTION 'daily spring boundary'; END IF;
  IF pg_temp.expected_end_e6('2026-10-20 09:04:59Z') IS NOT NULL THEN RAISE EXCEPTION 'daily premature observation'; END IF;
  IF pg_temp.expected_end_e6('2026-10-20 10:05Z') IS NOT NULL THEN RAISE EXCEPTION 'daily expired expectation'; END IF;
END $test$;

-- A mid-hour emergency break must NOT flip fallback cadence into three-hourly mode.
INSERT INTO engine_maintenance_break_log VALUES ('2026-10-20 15:25:00Z','2026-10-20 15:30:01Z',0,0,'2026-10-20 15:25:05Z',now());
DO $test$ BEGIN
  IF pg_temp.expected_end_e6('2026-10-20 16:12Z') <> '2026-10-20 15:30:00Z'::timestamptz THEN RAISE EXCEPTION 'emergency break omitted'; END IF;
  IF pg_temp.expected_end_e6('2026-10-20 18:12Z') IS NOT NULL THEN RAISE EXCEPTION 'mid-hour emergency flipped daily into three-hourly'; END IF;
END $test$;
TRUNCATE engine_maintenance_break_log;

-- Three-hourly cadence: a recent scheduled non-04 Chicago break (16:00 CST = 22:00Z)
-- enables break_never_started fallback across all 8 Chicago hours {1,4,7,10,13,16,19,22}.
INSERT INTO engine_maintenance_break_log VALUES ('2026-11-21 22:00:02Z','2026-11-21 22:05:03Z',0,0,'2026-11-21 22:00:05Z',now());
DO $test$ BEGIN
  -- 19:00 CST (01:00Z) missed break -> synthesized at 01:05Z
  IF pg_temp.expected_end_e6('2026-11-22 01:12Z') <> '2026-11-22 01:05Z'::timestamptz THEN RAISE EXCEPTION 'three-hourly 19:00 CST missed'; END IF;
  -- Across UTC hour boundary within 1h window (02:02Z still observes 01:05Z)
  IF pg_temp.expected_end_e6('2026-11-22 02:02Z') <> '2026-11-22 01:05Z'::timestamptz THEN RAISE EXCEPTION 'three-hourly cross-hour observation missed'; END IF;
  IF pg_temp.expected_end_e6('2026-11-22 02:05Z') IS NOT NULL THEN RAISE EXCEPTION 'three-hourly expired expectation not cleared'; END IF;
  -- Non-cycle hour (20:00 CST = 02:00Z) -> NULL
  IF pg_temp.expected_end_e6('2026-11-22 02:12Z') IS NOT NULL THEN RAISE EXCEPTION 'three-hourly invented 20:00 CST break'; END IF;
  -- 22:00 CST (04:00Z) -> 04:05Z
  IF pg_temp.expected_end_e6('2026-11-22 04:12Z') <> '2026-11-22 04:05Z'::timestamptz THEN RAISE EXCEPTION 'three-hourly 22:00 CST missed'; END IF;
  -- 01:00 CST (07:00Z) -> 07:05Z
  IF pg_temp.expected_end_e6('2026-11-22 07:12Z') <> '2026-11-22 07:05Z'::timestamptz THEN RAISE EXCEPTION 'three-hourly 01:00 CST missed'; END IF;
  -- 04:00 CST (10:00Z) -> 10:05Z
  IF pg_temp.expected_end_e6('2026-11-22 10:12Z') <> '2026-11-22 10:05Z'::timestamptz THEN RAISE EXCEPTION 'three-hourly 04:00 CST missed'; END IF;
END $test$;
TRUNCATE engine_maintenance_break_log;

-- Fall-back DST day (2026-11-01): 01:00 CDT (06:00Z) is ONE cycle; repeated 01:00 CST (07:00Z) is NOT a second cycle.
INSERT INTO engine_maintenance_break_log VALUES ('2026-11-01 03:00:00Z','2026-11-01 03:05:00Z',0,0,'2026-11-01 03:00:05Z',now());
DO $test$ BEGIN
  IF pg_temp.expected_end_e6('2026-11-01 06:12Z') <> '2026-11-01 06:05Z'::timestamptz THEN RAISE EXCEPTION 'fall-back first 01:00 CDT missed'; END IF;
  IF pg_temp.expected_end_e6('2026-11-01 07:12Z') IS NOT NULL THEN RAISE EXCEPTION 'fall-back repeated 01:00 CST invented a second break'; END IF;
  IF pg_temp.expected_end_e6('2026-11-01 10:12Z') <> '2026-11-01 10:05Z'::timestamptz THEN RAISE EXCEPTION 'fall-back 04:00 CST missed'; END IF;
END $test$;
TRUNCATE engine_maintenance_break_log;

-- Spring-forward DST day (2026-03-08): 01:00 CST (07:00Z) and 04:00 CDT (09:00Z) both fire; 03:00 CDT (08:00Z) does not.
INSERT INTO engine_maintenance_break_log VALUES ('2026-03-08 04:00:00Z','2026-03-08 04:05:00Z',0,0,'2026-03-08 04:00:05Z',now());
DO $test$ BEGIN
  IF pg_temp.expected_end_e6('2026-03-08 07:12Z') <> '2026-03-08 07:05Z'::timestamptz THEN RAISE EXCEPTION 'spring-forward 01:00 CST missed'; END IF;
  IF pg_temp.expected_end_e6('2026-03-08 08:12Z') IS NOT NULL THEN RAISE EXCEPTION 'spring-forward 03:00 CDT invented a break'; END IF;
  IF pg_temp.expected_end_e6('2026-03-08 09:12Z') <> '2026-03-08 09:05Z'::timestamptz THEN RAISE EXCEPTION 'spring-forward 04:00 CDT missed'; END IF;
END $test$;
TRUNCATE engine_maintenance_break_log;

-- Weekly report: daily cadence on empty/daily-only tables, three-hourly cadence once non-04 breaks or thaws exist.
DO $test$
DECLARE
  r JSONB;
  v_anchor_04 TIMESTAMPTZ := (date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '4 hours') AT TIME ZONE 'America/Chicago';
  v_anchor_19 TIMESTAMPTZ := (date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '19 hours') AT TIME ZONE 'America/Chicago';
BEGIN
  IF v_anchor_04 > now() THEN v_anchor_04 := v_anchor_04 - interval '1 day'; END IF;
  IF v_anchor_19 > now() THEN v_anchor_19 := v_anchor_19 - interval '1 day'; END IF;

  -- Empty tables -> daily (1*window_days), no 24*window_days
  r := public.fn_maintenance_week_report(7);
  IF r->>'observed_cadence' <> 'daily' OR (r->>'expected_breaks_per_day')::int <> 1 THEN
    RAISE EXCEPTION 'empty report expected daily/1, got %', r;
  END IF;
  IF position('1*window_days' IN r->>'breaks_without_thaw_note') = 0
     OR position('24*window_days' IN r->>'breaks_without_thaw_note') > 0 THEN
    RAISE EXCEPTION 'daily note wrong: %', r->>'breaks_without_thaw_note';
  END IF;

  -- Daily 04:00 break + thaw (with boolean/decimal/nested shifted metadata as in v3 thaw) -> still daily/1
  INSERT INTO engine_maintenance_break_log VALUES (v_anchor_04, v_anchor_04 + interval '5 minutes', 0, 0, v_anchor_04 + interval '5 seconds', now());
  INSERT INTO engine_maintenance_thaws VALUES (v_anchor_04, 301, v_anchor_04 + interval '5 minutes', '{"applied": true, "tables": 10, "ratio": 1.5, "meta": {"v": 3}}'::jsonb);
  INSERT INTO hand_history VALUES
    (v_anchor_04 - interval '5 minutes', gen_random_uuid()),
    (v_anchor_04 - interval '1 minute', gen_random_uuid()),
    (v_anchor_04 + interval '6 minutes', gen_random_uuid());
  r := public.fn_maintenance_week_report(7);
  IF r->>'observed_cadence' <> 'daily' OR (r->>'expected_breaks_per_day')::int <> 1 THEN
    RAISE EXCEPTION 'daily-only report expected daily/1, got %', r;
  END IF;
  IF (r->'freezes'->'total_shifted'->>'tables')::bigint <> 10
     OR (r->'freezes'->'total_shifted') ? 'applied' THEN
    RAISE EXCEPTION 'total_shifted must sum only integer counters, got %', r->'freezes'->'total_shifted';
  END IF;
  IF (r->'dealing_by_minute'->>'before_53_57')::int <> 1
     OR (r->'dealing_by_minute'->>'last_hand_58_59')::int <> 1
     OR (r->'dealing_by_minute'->>'after_05_09')::int <> 1 THEN
    RAISE EXCEPTION 'daily dealing_by_minute buckets wrong: %', r->'dealing_by_minute';
  END IF;

  -- Add a 19:00 Chicago break -> switches to three-hourly (8*window_days)
  INSERT INTO engine_maintenance_break_log VALUES (v_anchor_19, v_anchor_19 + interval '5 minutes', 0, 0, v_anchor_19 + interval '5 seconds', now());
  r := public.fn_maintenance_week_report(7);
  IF r->>'observed_cadence' <> 'three-hourly' OR (r->>'expected_breaks_per_day')::int <> 8 THEN
    RAISE EXCEPTION 'three-hourly report expected three-hourly/8, got %', r;
  END IF;
  IF position('8*window_days' IN r->>'breaks_without_thaw_note') = 0
     OR position('24*window_days' IN r->>'breaks_without_thaw_note') > 0 THEN
    RAISE EXCEPTION 'three-hourly note wrong: %', r->>'breaks_without_thaw_note';
  END IF;

  -- Thaw-only three-hourly detection (without break_log, including NULL shifted row) also switches to three-hourly/8
  TRUNCATE engine_maintenance_break_log;
  INSERT INTO engine_maintenance_thaws VALUES
    (v_anchor_19, 300, v_anchor_19 + interval '5 minutes', '{"applied": true, "tables": 12}'::jsonb),
    (v_anchor_19, 299, v_anchor_19 + interval '5 minutes', NULL);
  r := public.fn_maintenance_week_report(7);
  IF r->>'observed_cadence' <> 'three-hourly' OR (r->>'expected_breaks_per_day')::int <> 8 THEN
    RAISE EXCEPTION 'thaw-only three-hourly detection failed: %', r;
  END IF;
  IF (r->'freezes'->'total_shifted'->>'tables')::bigint <> 22 THEN
    RAISE EXCEPTION 'total_shifted sum across rows failed: %', r->'freezes'->'total_shifted';
  END IF;

  -- Service-role only ACL preserved on both functions
  IF has_function_privilege('anon', 'public.fn_ca_record_break_scorecard(timestamptz)', 'execute')
     OR has_function_privilege('authenticated', 'public.fn_ca_record_break_scorecard(timestamptz)', 'execute')
     OR NOT has_function_privilege('service_role', 'public.fn_ca_record_break_scorecard(timestamptz)', 'execute') THEN
    RAISE EXCEPTION 'scorecard ACL drift';
  END IF;
  IF has_function_privilege('anon', 'public.fn_maintenance_week_report(integer)', 'execute')
     OR has_function_privilege('authenticated', 'public.fn_maintenance_week_report(integer)', 'execute')
     OR NOT has_function_privilege('service_role', 'public.fn_maintenance_week_report(integer)', 'execute') THEN
    RAISE EXCEPTION 'weekly report ACL drift';
  END IF;
END $test$;
''')
        print('PASS: E6 three-hourly scorecard fallback (daily/3h/DST/emergency), weekly report (daily/3h/buckets/ACL), live-proof and replay refusal')
    finally:
        result = run([PG/'pg_ctl', '-D', temp/'data', '-m', 'immediate', '-w', 'stop'])
        assert result.returncode == 0, result.stderr

# Daily mark alignment shares this already-required observation qualification.
import sys
subprocess.run([sys.executable, '-B', str(ROOT/'scripts/ci/test-daily-maintenance-marks.py')], check=True)
