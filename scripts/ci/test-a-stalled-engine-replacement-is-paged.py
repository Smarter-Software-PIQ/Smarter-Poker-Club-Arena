#!/usr/bin/env python3
"""Native proof for 20261102135212_a_stalled_engine_replacement_is_paged.

Runs the exact migration file against a throwaway PostgreSQL 17 cluster (never
production) with the minimal production shapes it reads and writes, then
drives fn_ca_engine_release_stall_check through every outcome.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261102135212_a_stalled_engine_replacement_is_paged.sql'
# 2026-11-03: production financial_alerts.id is a uuid. The bigserial fixture this
# test used hid a bigint v_open that failed every run once a page was open.
UUID_FIX = ROOT / 'supabase/migrations/20261103003406_engine_release_stall_check_holds_its_open_alert_id_as_uuid.sql'


def pg_bin(name):
    for candidate in (os.environ.get('PG_BIN'), '/usr/lib/postgresql/17/bin', '/opt/homebrew/opt/postgresql@17/bin'):
        if candidate and Path(candidate, name).exists():
            return str(Path(candidate, name))
    found = shutil.which(name)
    if not found:
        raise SystemExit(f'{name} (PostgreSQL 17) is required')
    return found


SCHEMA = """
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE TABLE public.engine_leader (id int PRIMARY KEY, instance_id text, engine_version text,
  acquired_at timestamptz, heartbeat_at timestamptz);
CREATE TABLE public.engine_deploy_exit_paths (id bigserial PRIMARY KEY, recorded_at timestamptz NOT NULL DEFAULT now(),
  run_id text, target_sha text, stage text, outcome text, error text, release_result jsonb);
CREATE TABLE public.financial_alerts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text, source text, message text,
  context jsonb, resolved boolean NOT NULL DEFAULT false, resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), resolved_by text, resolution text);
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job(jobname, schedule, command) VALUES (n, s, c) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS
  $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;
"""


def main():
    os.environ.setdefault("LC_ALL", "C")
    os.environ.setdefault("LANG", "C")
    scratch = Path(tempfile.mkdtemp(prefix='stall-check-', dir=os.environ.get('TMPDIR') or os.environ.get('RUNNER_TEMP')))
    data = scratch / 'data'
    # Unix socket paths are limited to ~103 bytes; keep the socket directory short.
    sock = Path(tempfile.mkdtemp(prefix='pgs', dir=os.environ.get('PG_SOCKET_ROOT') or scratch))
    subprocess.run([pg_bin('initdb'), '-D', str(data), '-U', 'postgres', '-A', 'trust'], check=True, capture_output=True)
    port = str(55000 + os.getpid() % 5000)
    subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-o', f"-k {sock} -p {port} -c listen_addresses=''",
                    '-l', str(scratch / 'log'), '-w', 'start'], check=True, capture_output=True)
    try:
        def sql(text, expect_error=False):
            r = subprocess.run([pg_bin('psql'), '-h', str(sock), '-p', port, '-U', 'postgres', '-d', 'postgres',
                                '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', text],
                               capture_output=True, text=True)
            if expect_error:
                assert r.returncode != 0, text
                return r.stderr
            assert r.returncode == 0, f'{text}\n{r.stderr}'
            return r.stdout.strip()

        sql(SCHEMA)
        r = subprocess.run([pg_bin('psql'), '-h', str(sock), '-p', port, '-U', 'postgres', '-d', 'postgres',
                            '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', str(MIGRATION)], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        proof = re.search(r'^-- @live-proof: (.+)$', MIGRATION.read_text(), re.M).group(1)
        assert sql(f'SELECT {proof}') == 't', 'live proof must hold after install'
        r = subprocess.run([pg_bin('psql'), '-h', str(sock), '-p', port, '-U', 'postgres', '-d', 'postgres',
                            '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', str(UUID_FIX)], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        fix_proof = re.search(r'^-- @live-proof: (.+)$', UUID_FIX.read_text(), re.M).group(1)
        assert sql(f'SELECT {fix_proof}') == 't', 'uuid fix live proof must hold after install'

        def check():
            return sql("SELECT public.fn_ca_engine_release_stall_check(6, 3)->>'state'")

        def open_alerts():
            return int(sql("SELECT count(*) FROM financial_alerts WHERE source='fn_ca_engine_release_stall_check' AND NOT resolved"))

        def fail(target, ago, run):
            sql(f"INSERT INTO engine_deploy_exit_paths(recorded_at, run_id, target_sha, stage, outcome, error) "
                f"VALUES (now() - interval '{ago}', '{run}', '{target}', 'release', 'failure', 'release failed at observe (exit 1)')")

        serving = 'eed06fe51dea622069c661a6213d5b031ff3a9e3'
        sql(f"INSERT INTO engine_leader VALUES (1, '1-2790e861', '{serving[:8]}', now() - interval '2 hours', now())")

        # Below threshold: clear, nothing raised.
        fail('197c2b733698b9eb62a90f7c91b42b263a028ef1', '3 hours', '41400905104-1')
        fail('6d178de0' + '0' * 32, '20 minutes', '41432783729-1')
        assert check() == 'clear' and open_alerts() == 0
        # Failures for the serving version itself and outside the window do not count.
        fail(serving, '10 minutes', '1-1'); fail('aaaaaaaa' + '0' * 32, '7 hours', '2-1')
        assert check() == 'clear' and open_alerts() == 0
        # Third failed replacement inside the window: one critical alert.
        fail('230fa8fb' + '0' * 32, '2 hours', '41432203099-1')
        assert check() == 'stalled' and open_alerts() == 1
        row = sql("SELECT severity||'|'||(context->>'failures')||'|'||(context->>'runs')||'|'||(context->>'serving_version')||'|'||(context->>'latest_run') "
                  "FROM financial_alerts WHERE source='fn_ca_engine_release_stall_check'")
        assert row == 'critical|3|3|eed06fe5|41432783729-1', row
        # Still stalled: no duplicate page.
        fail('1a481157' + '0' * 32, '1 hour', '41431696915-1')
        assert check() == 'stalled' and open_alerts() == 1
        # A stale leader heartbeat is unknown: neither raises nor resolves.
        sql("UPDATE engine_leader SET heartbeat_at = now() - interval '10 minutes'")
        out = sql("SELECT public.fn_ca_engine_release_stall_check(6, 3)->>'state'")
        assert out == 'leader_unknown' and open_alerts() == 1
        # A wedged lane that stops attempting is not recovery: failures age out, the page stays open.
        sql("UPDATE engine_leader SET heartbeat_at=now()")
        sql("UPDATE engine_deploy_exit_paths SET recorded_at = recorded_at - interval '7 hours'")
        assert check() == 'stalled_open' and open_alerts() == 1
        # Replacement succeeds: a different version leads, the page is resolved with the re-measurement.
        sql("UPDATE engine_leader SET engine_version='6d178de0', heartbeat_at=now()")
        assert check() == 'clear' and open_alerts() == 0
        resolution = sql("SELECT resolution FROM financial_alerts WHERE source='fn_ca_engine_release_stall_check'")
        assert 'engine 6d178de0 now leads (the page named eed06fe5)' in resolution, resolution
        # A later stall pages again as a new alert.
        for i, ago in enumerate(('50 minutes', '40 minutes', '30 minutes')):
            fail(f'{i}bbbbbbb' + '0' * 32, ago, f'9{i}-1')
        assert check() == 'stalled' and open_alerts() == 1
        assert sql("SELECT count(*) FROM financial_alerts WHERE source='fn_ca_engine_release_stall_check'") == '2'
        # The new engine is itself replaced while still stalled: old page closes and a fresh one names the new leader.
        sql("UPDATE engine_leader SET engine_version='9c9c9c9c', heartbeat_at=now()")
        assert check() == 'stalled' and open_alerts() == 1
        assert sql("SELECT context->>'serving_version' FROM financial_alerts WHERE source='fn_ca_engine_release_stall_check' AND NOT resolved") == '9c9c9c9c'
        # Clients cannot run it.
        assert not sql("SELECT has_function_privilege('anon','public.fn_ca_engine_release_stall_check(integer,integer)','EXECUTE')") == 't'
        assert sql("SELECT has_function_privilege('service_role','public.fn_ca_engine_release_stall_check(integer,integer)','EXECUTE')") == 't'
        # Reinstall is refused (CREATE, not OR REPLACE): the migration is applied once.
        r = subprocess.run([pg_bin('psql'), '-h', str(sock), '-p', port, '-U', 'postgres', '-d', 'postgres',
                            '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', str(MIGRATION)], capture_output=True, text=True)
        assert r.returncode != 0 and 'already exists' in r.stderr
        print('a stalled engine replacement is paged: 10 behaviours PASS')
    finally:
        subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(scratch, ignore_errors=True)
        shutil.rmtree(sock, ignore_errors=True)


if __name__ == '__main__':
    main()
