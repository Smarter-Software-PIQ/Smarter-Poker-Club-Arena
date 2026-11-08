#!/usr/bin/env python3
"""Qualify fn_cron_failing_jobs() and the per-job cron watch in an isolated PostgreSQL 17 cluster.

Installs supabase/migrations/20261108020000_a_job_failing_every_run_is_named.sql unchanged over a
fixture that reproduces what it reads (pg_cron's cron.job and cron.job_run_details, the guard
inventory, the drift-incident door as a recorder), then proves the rule the design names: a job
failing run after run is named within ten minutes, a transient failure never is, sporadic
successes do not hide a job that is mostly failing, an hourly job still counts, the per-job watch
raises the streak once a day per job, and only service_role can read it. It also renders the
collector's labelled series from server/scripts/collect-monitoring-health.sh.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261108020000_a_job_failing_every_run_is_named.sql'
COLLECTOR = ROOT / 'server/scripts/collect-monitoring-health.sh'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/cron-failing-jobs')
args = parser.parse_args()
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=False)
pg = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
cluster = Path(tempfile.mkdtemp(prefix='cron-failing-jobs-', dir='/tmp'))
socket = cluster / 'socket'
socket.mkdir(mode=0o700)
PORT = '55743'
cmd = [str(pg / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', str(socket), '-p', PORT, '-U', 'postgres', '-d', 'postgres']
results = {'scope': 'repeatedly failing pg_cron jobs: rule, watch, grants, collector rendering; '
                    'isolated fixture, not whole-schema qualification', 'cases': [], 'passed': False}

FIXTURE = """
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE TABLE cron.job_run_details (runid bigserial PRIMARY KEY, jobid bigint, status text, start_time timestamptz,
                                   end_time timestamptz, return_message text);
CREATE TABLE public.ca_guard_inventory (kind text, object_a text, active boolean);
CREATE TABLE public.ca_detector_runs (detector text, detail jsonb);
CREATE TABLE public.raised (severity text, dedupe_key text, message text, metadata jsonb);
CREATE FUNCTION public.fn_ca_raise_drift_incident(p_source text, p_classification text, p_severity text,
  p_dedupe_key text, p_discrepancy numeric, p_expected numeric, p_actual numeric, p_layer text, p_entity_type text,
  p_entity_id uuid, p_club_id uuid, p_union_id uuid, p_table_id uuid, p_tournament_id uuid, p_hand_id uuid,
  p_settlement_id text, p_wallet_ids uuid[], p_transaction_ids uuid[], p_suspected_cause text,
  p_ledger_balanced boolean, p_metadata jsonb) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.raised VALUES (p_severity, p_dedupe_key, p_suspected_cause, p_metadata);
  SELECT gen_random_uuid() $$;
CREATE FUNCTION public.fn_ca_ledger_invariant_refusal_watch() RETURNS integer LANGUAGE sql AS 'SELECT 0';
-- runs(job, n, status, every, ending): n runs of one status, `every` apart, the last one `ending` ago.
CREATE FUNCTION public.runs(p_job text, p_n int, p_status text, p_every interval, p_ending interval)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO cron.job_run_details (jobid, status, start_time, return_message)
  SELECT (SELECT jobid FROM cron.job WHERE jobname = p_job), p_status,
         now() - p_ending - p_every * (p_n - i),
         CASE WHEN p_status = 'failed' THEN 'ERROR:  ' || p_job || ' failed "quoted"' ELSE 'COMMIT' END
    FROM generate_series(1, p_n) i $$;
"""


def command(argv, sql=None):
    return subprocess.run([str(a) for a in argv], input=sql, text=True, capture_output=True, env=env, timeout=60)


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def run(name, sql, expected=None, error=None, last=False):
    r = command(cmd, sql)
    (out / (name + '.log')).write_text('-- SQL\n' + sql + '\n-- STDOUT\n' + r.stdout + '-- STDERR\n' + r.stderr)
    passed = (r.returncode != 0 and error in r.stderr) if error else r.returncode == 0
    got = r.stdout.rstrip('\n')
    if last:
        got = got.split('\n')[-1]
    if expected is not None:
        passed = passed and got == expected
    results['cases'].append({'name': name, 'passed': passed, 'expected': expected, 'expectedError': error,
                             'observed': got if not error else r.stderr.strip()[-400:]})
    require(passed, name + ': ' + r.stdout[-800:] + r.stderr[-1200:])
    return got


NAMED = "SELECT coalesce(string_agg(jobname || ':' || failed_in_a_row || ':' || failed_of_last_20 || ':' || is_guard, ',' ORDER BY jobname), '-') FROM public.fn_cron_failing_jobs();"
RESET = "TRUNCATE cron.job_run_details, public.raised; DELETE FROM cron.job; DELETE FROM public.ca_guard_inventory;"


def collector_block():
    text = COLLECTOR.read_text()
    start = text.index('CRON_FAILING_RENDERED=$(python3 - "$CRON_FAILING_BODY" <<\'PY\'')
    body = text[start:].split("<<'PY'\n", 1)[1].split('\nPY\n', 1)[0]
    return body


def render(body):
    r = subprocess.run(['python3', '-', body], input=collector_block(), text=True, capture_output=True, timeout=30)
    return r.stdout


try:
    require(re.search(r'PostgreSQL\) 17\.', command([pg / 'postgres', '--version']).stdout), 'PostgreSQL 17 required')
    r = command([pg / 'initdb', '-D', cluster / 'data', '-U', 'postgres', '--auth-local=trust', '--auth-host=reject',
                 '--no-locale', '--encoding=UTF8'])
    require(r.returncode == 0, r.stderr)
    with (cluster / 'data/postgresql.conf').open('a') as f:
        f.write("\nlisten_addresses=''\nunix_socket_directories='" + str(socket) + "'\nunix_socket_permissions=0700\n"
                "port=" + PORT + "\nshared_buffers='16MB'\nmax_connections=20\n")
    r = command([pg / 'pg_ctl', '-D', cluster / 'data', '-l', cluster / 'server.log', '-w', 'start'])
    require(r.returncode == 0, r.stderr)
    run('fixture', FIXTURE)
    run('install', MIGRATION.read_text())

    run('grants', """SELECT
      NOT has_function_privilege('anon', 'public.fn_cron_failing_jobs()', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.fn_cron_failing_jobs()', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.fn_cron_failing_jobs()', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.fn_ca_cron_failure_watch()', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.fn_ca_cron_failure_watch()', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.fn_ca_cron_failure_watch()', 'EXECUTE')
      AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_cron_failing_jobs()'::regprocedure);""", 't')

    # 2026-11-07, job 117: one success, then a failed run every 10 s for 13.5 minutes.
    run('the-117-shape-is-named', RESET + """
      INSERT INTO cron.job (jobname) VALUES ('sp_prune_hand_history_10m');
      SELECT public.runs('sp_prune_hand_history_10m', 40, 'succeeded', interval '10 seconds', interval '13 minutes 40 seconds');
      SELECT public.runs('sp_prune_hand_history_10m', 81, 'failed', interval '10 seconds', interval '0 seconds');
      """ + NAMED, 'sp_prune_hand_history_10m:81:20:false', last=True)

    run('a-young-streak-waits-ten-minutes', RESET + """
      INSERT INTO cron.job (jobname) VALUES ('fast');
      SELECT public.runs('fast', 40, 'succeeded', interval '10 seconds', interval '5 minutes');
      SELECT public.runs('fast', 30, 'failed', interval '10 seconds', interval '0 seconds');
      """ + NAMED, '-', last=True)

    run('one-transient-failure-is-never-named', RESET + """
      INSERT INTO cron.job (jobname) VALUES ('blip');
      SELECT public.runs('blip', 100, 'succeeded', interval '10 seconds', interval '20 minutes');
      SELECT public.runs('blip', 1, 'failed', interval '10 seconds', interval '19 minutes 50 seconds');
      SELECT public.runs('blip', 100, 'succeeded', interval '10 seconds', interval '0 seconds');
      """ + NAMED, '-', last=True)

    # Mostly failing with a success now and then: the streak keeps restarting,
    # 18 of the last 20 still names it.
    run('sporadic-successes-do-not-hide-it', RESET + """
      INSERT INTO cron.job (jobname) VALUES ('mostly');
      INSERT INTO cron.job_run_details (jobid, status, start_time, return_message)
      SELECT (SELECT jobid FROM cron.job WHERE jobname = 'mostly'),
             CASE WHEN i % 10 = 0 THEN 'succeeded' ELSE 'failed' END,
             now() - interval '1 minute' * (40 - i), 'ERROR:  x'
        FROM generate_series(1, 40) i;
      """ + NAMED, 'mostly:0:18:false', last=True)

    run('an-hourly-job-counts-after-three', RESET + """
      INSERT INTO cron.job (jobname) VALUES ('hourly');
      SELECT public.runs('hourly', 5, 'succeeded', interval '1 hour', interval '3 hours');
      SELECT public.runs('hourly', 3, 'failed', interval '1 hour', interval '5 minutes');
      """ + NAMED, 'hourly:3:3:false', last=True)

    run('two-hourly-failures-are-not-yet-a-pattern', RESET + """
      INSERT INTO cron.job (jobname) VALUES ('hourly');
      SELECT public.runs('hourly', 5, 'succeeded', interval '1 hour', interval '2 hours');
      SELECT public.runs('hourly', 2, 'failed', interval '1 hour', interval '5 minutes');
      """ + NAMED, '-', last=True)

    run('an-inactive-job-is-not-named-and-a-guard-says-so', RESET + """
      INSERT INTO cron.job (jobname, active) VALUES ('off', false), ('guarded', true);
      INSERT INTO public.ca_guard_inventory VALUES ('cron', 'guarded', true);
      SELECT public.runs('off', 90, 'failed', interval '10 seconds', interval '0 seconds');
      SELECT public.runs('guarded', 90, 'failed', interval '10 seconds', interval '0 seconds');
      """ + NAMED, 'guarded:90:20:true', last=True)

    run('a-running-row-is-not-a-result', RESET + """
      INSERT INTO cron.job (jobname) VALUES ('fast');
      SELECT public.runs('fast', 90, 'failed', interval '10 seconds', interval '10 seconds');
      INSERT INTO cron.job_run_details (jobid, status, start_time) VALUES ((SELECT jobid FROM cron.job), 'running', now());
      """ + NAMED, 'fast:90:20:false', last=True)

    # The watch: the streak raises once per job per day, with the job named; a job the
    # day rule already raised is not raised twice; a failure of the read is critical.
    run('the-watch-raises-the-streak-by-name', RESET + """
      INSERT INTO cron.job (jobname) VALUES ('sp_prune_hand_history_10m');
      -- As in production: far more successes than failures in 24 h, the last one 13 minutes ago,
      -- so neither of the watch's original rules sees it.
      SELECT public.runs('sp_prune_hand_history_10m', 200, 'succeeded', interval '10 seconds', interval '13 minutes 40 seconds');
      SELECT public.runs('sp_prune_hand_history_10m', 81, 'failed', interval '10 seconds', interval '0 seconds');
      SELECT public.fn_ca_cron_failure_watch();
      SELECT severity || '|' || (dedupe_key = 'cron-failing:sp_prune_hand_history_10m:' || CURRENT_DATE::text)
             || '|' || (message LIKE 'scheduled job sp_prune_hand_history_10m is failing repeatedly: 81 failed runs in a row%')
             || '|' || (metadata ->> 'rule') FROM public.raised;""",
        'warning|true|true|streak', last=True)

    run('the-watch-does-not-raise-a-job-twice', RESET + """
      INSERT INTO cron.job (jobname) VALUES ('dead');
      SELECT public.runs('dead', 300, 'failed', interval '1 minute', interval '0 seconds');
      SELECT public.fn_ca_cron_failure_watch();
      SELECT count(*) || '|' || min(dedupe_key) FROM public.raised;""",
        '1|cron-failing:dead:' + run('today', "SELECT CURRENT_DATE::text;"), last=True)

    run('a-failed-read-is-critical-not-silent', RESET + """
      CREATE OR REPLACE FUNCTION public.fn_cron_failing_jobs()
      RETURNS TABLE (jobid bigint, jobname text, failed_in_a_row integer, failing_since timestamptz,
                     failed_of_last_20 integer, last_success timestamptz, last_error text, is_guard boolean)
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'read failed'; END $$;
      SELECT public.fn_ca_cron_failure_watch();
      SELECT severity || '|' || (dedupe_key LIKE 'cron-failing-streak-read-failed:%') FROM public.raised;""",
        'critical|true', last=True)

    # The collector renders one labelled series per job and never the fleet gauges' failure.
    rendered = render(json.dumps([
        {'jobname': 'sp_prune_hand_history_10m', 'failed_in_a_row': 81, 'failed_of_last_20': 20, 'is_guard': False},
        {'jobname': 'odd "name" \\ x', 'failed_in_a_row': 0, 'failed_of_last_20': 18, 'is_guard': True}]))
    expect = [
        'poker_cron_jobs_failing_repeatedly 2',
        'poker_cron_job_failing_streak{jobname="sp_prune_hand_history_10m",guard="false"} 81',
        'poker_cron_job_failing_streak{jobname="odd \\"name\\" \\\\ x",guard="true"} 0',
        'poker_cron_job_failing_of_last_20{jobname="sp_prune_hand_history_10m",guard="false"} 20',
        'poker_cron_failing_collect_ok 1']
    ok = all(line in rendered.splitlines() for line in expect)
    results['cases'].append({'name': 'collector-renders-labelled-series', 'passed': ok, 'observed': rendered})
    require(ok, 'collector rendering: ' + rendered)
    empty = render('[]')
    bad = render('{"message":"Could not find the function public.fn_cron_failing_jobs"}')
    ok = ('poker_cron_jobs_failing_repeatedly 0' in empty and 'poker_cron_failing_collect_ok 1' in empty
          and bad.strip() == '# HELP poker_cron_failing_collect_ok 1 when fn_cron_failing_jobs was read this run, else 0.\n'
          '# TYPE poker_cron_failing_collect_ok gauge\npoker_cron_failing_collect_ok 0'.strip())
    results['cases'].append({'name': 'collector-empty-and-missing-function', 'passed': ok, 'observed': empty + '\n---\n' + bad})
    require(ok, 'collector empty/missing: ' + empty + '\n---\n' + bad)
    results['passed'] = True
finally:
    if (cluster / 'data/postmaster.pid').exists():
        r = command([pg / 'pg_ctl', '-D', cluster / 'data', '-m', 'fast', '-w', 'stop'])
        require(r.returncode == 0, 'Could not stop owned cluster: ' + r.stderr)
    if (cluster / 'server.log').exists():
        shutil.copyfile(cluster / 'server.log', out / 'server.log')
    require(not (cluster / 'data/postmaster.pid').exists(), 'Owned cluster still running')
    shutil.rmtree(cluster)
    results['ownedClusterRemoved'] = not cluster.exists()
    (out / 'RESULTS.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps({'passed': results['passed'], 'cases': len(results['cases']), 'evidence': str(out)}))
