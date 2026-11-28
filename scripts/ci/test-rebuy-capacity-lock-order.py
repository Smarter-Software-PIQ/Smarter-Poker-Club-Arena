#!/usr/bin/env python3
"""Native PostgreSQL proof: a capacity check never upgrades the tournament lock.

Production alert 445924 (DatabaseDeadlocksElevated, 2026-11-19 23:02-23:29
UTC): nine deadlocks, each between a seatless rebuy and a hand commit of the
same event. The rebuy's seat root holds the tournament row FOR NO KEY UPDATE;
fn_ensure_late_registration_capacity then asked for the same row FOR UPDATE,
an upgrade that conflicts with the FOR KEY SHARE a hand commit's foreign-key
check holds, while that hand waits FOR SHARE on the rebuy's NO KEY UPDATE.
Migration 20261119235115 makes the capacity lock FOR NO KEY UPDATE.

This builds a throwaway cluster on a Unix socket (no network, no production
connection), installs the EXACT production pre-image of the capacity function
(scripts/ci/fixtures/rebuy-capacity-lock-order/, md5-checked against the
pg_get_functiondef md5 read from production), and drives real sessions:

  BEFORE  rebuy holds NO KEY UPDATE; hand inserts a child row (KEY SHARE) and
          asks FOR SHARE (waits on the rebuy); the rebuy calls the capacity
          check -> 40P01 deadlock detected.
  AFTER   the unmodified migration file is applied; the same sequence: the
          capacity call returns without waiting, the hand proceeds once the
          rebuy commits, no session sees 40P01; two capacity checks still
          serialise against each other; ACL and SECURITY DEFINER preserved.

Usage: PG_BIN=/usr/lib/postgresql/17/bin python3 scripts/ci/test-rebuy-capacity-lock-order.py [--output DIR]
Must run as a non-root user (initdb refuses root).
"""
import argparse
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'scripts/ci/fixtures/rebuy-capacity-lock-order/fn_ensure_late_registration_capacity.preimage.sql'
MIGRATION = ROOT / 'supabase/migrations/20261119235115_a_rebuy_never_upgrades_its_tournament_row_lock.sql'
PRE_MD5 = 'a539fd43bb2992f8d75253f2d7a4dd7c'
POST_MD5 = 'c142f16547e8cde3ba10338c2bf6e6e4'

SCHEMA = r"""
SET check_function_bodies = off;
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE EXTENSION dblink;
CREATE SCHEMA smarter_private;
CREATE TABLE public.tournaments(id uuid PRIMARY KEY, status text NOT NULL, game_type text,
  max_players int, table_size int, club_id uuid, name text, action_time_seconds int,
  big_blind_ante boolean, all_in_or_fold boolean, allow_rabbit_hunt boolean, variant text);
-- Stands in for every row a hand commit writes that references its event
-- (its foreign-key check takes FOR KEY SHARE on the tournament row).
CREATE TABLE public.hand_rows(id bigserial PRIMARY KEY, tournament_id uuid REFERENCES public.tournaments(id));
CREATE FUNCTION public.fn_ca_lock_mtt_admission_contract() RETURNS void LANGUAGE sql AS $$ SELECT $$;
INSERT INTO public.tournaments(id,status) VALUES ('00000000-0000-0000-0000-0000000000a1','PAUSED_FOR_PROOF');
"""

# The tournament is not RUNNING, so the capacity function returns right after
# its row lock: the lock is the behaviour under proof, and every statement it
# executes is production text.
RACE = r"""
CREATE OR REPLACE FUNCTION pg_temp.race(label text, expect_cycle boolean) RETURNS jsonb LANGUAGE plpgsql AS $race$
DECLARE
  conn text := 'host='||current_setting('unix_socket_directories')||' port='||current_setting('port')||' user=postgres dbname='||current_database();
  t uuid := '00000000-0000-0000-0000-0000000000a1';
  rpid int; hpid int; deadline timestamptz; cap jsonb; hand int; rerr text; herr text; cycle boolean; waited boolean := false;
  t0 timestamptz; cap_ms numeric;
BEGIN
  PERFORM dblink_connect('rebuy', conn); PERFORM dblink_connect('hand', conn);
  PERFORM dblink_exec('rebuy', 'SET deadlock_timeout=''200ms''; SET statement_timeout=''10s''; SET lock_timeout=''8s''');
  PERFORM dblink_exec('hand', 'SET deadlock_timeout=''200ms''; SET statement_timeout=''10s''; SET lock_timeout=''8s''');
  SELECT pid INTO rpid FROM dblink('rebuy','SELECT pg_backend_pid()') AS x(pid int);
  SELECT pid INTO hpid FROM dblink('hand','SELECT pg_backend_pid()') AS x(pid int);
  -- The rebuy's seat root (fn_ca_lock_tournament_rebuy_acquisition).
  PERFORM dblink_exec('rebuy', 'BEGIN');
  PERFORM * FROM dblink('rebuy', format('SELECT 1 FROM public.tournaments WHERE id=%L FOR NO KEY UPDATE', t)) AS x(one int);
  -- The hand commit: a row that references the event, then the event row FOR SHARE.
  PERFORM dblink_exec('hand', 'BEGIN');
  PERFORM dblink_exec('hand', format('INSERT INTO public.hand_rows(tournament_id) VALUES (%L)', t));
  PERFORM dblink_send_query('hand', format('SELECT 1 FROM public.tournaments WHERE id=%L FOR SHARE', t));
  deadline := clock_timestamp() + interval '5 seconds';
  LOOP
    PERFORM pg_stat_clear_snapshot();
    EXIT WHEN rpid = ANY(pg_blocking_pids(hpid));
    IF clock_timestamp() > deadline THEN RAISE EXCEPTION '%: the hand never waited on the rebuy', label; END IF;
    PERFORM pg_sleep(0.01);
  END LOOP;
  -- The seatless rebuy chooses its chair: fn_ca_choose_tournament_seat_locked
  -- -> fn_ensure_late_registration_capacity.
  t0 := clock_timestamp();
  PERFORM dblink_send_query('rebuy', format('SELECT public.fn_ensure_late_registration_capacity(%L,0)', t));
  deadline := clock_timestamp() + interval '5 seconds';
  LOOP
    PERFORM pg_stat_clear_snapshot();
    IF hpid = ANY(pg_blocking_pids(rpid)) THEN waited := true; END IF;
    EXIT WHEN dblink_is_busy('rebuy') = 0;
    IF clock_timestamp() > deadline THEN EXIT; END IF;
    PERFORM pg_sleep(0.005);
  END LOOP;
  SELECT r INTO cap FROM dblink_get_result('rebuy', false) AS x(r jsonb);
  cap_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
  rerr := NULLIF(dblink_error_message('rebuy'), 'OK');
  PERFORM * FROM dblink_get_result('rebuy', false) AS x(r jsonb);
  IF rerr IS NULL THEN PERFORM dblink_exec('rebuy', 'COMMIT'); ELSE PERFORM dblink_exec('rebuy', 'ROLLBACK'); END IF;
  SELECT one INTO hand FROM dblink_get_result('hand', false) AS x(one int);
  herr := NULLIF(dblink_error_message('hand'), 'OK');
  PERFORM * FROM dblink_get_result('hand', false) AS x(one int);
  IF herr IS NULL THEN PERFORM dblink_exec('hand', 'COMMIT'); ELSE PERFORM dblink_exec('hand', 'ROLLBACK'); END IF;
  PERFORM dblink_disconnect('rebuy'); PERFORM dblink_disconnect('hand');
  cycle := COALESCE(rerr ILIKE '%deadlock detected%', false) OR COALESCE(herr ILIKE '%deadlock detected%', false);
  IF expect_cycle AND NOT cycle THEN
    RAISE EXCEPTION '%: the production pre-image did not reproduce 40P01 (rebuy %, hand %)', label, rerr, herr;
  END IF;
  IF NOT expect_cycle THEN
    IF cycle OR rerr IS NOT NULL OR herr IS NOT NULL THEN
      RAISE EXCEPTION '%: candidate failed (rebuy %, hand %)', label, rerr, herr;
    END IF;
    IF waited THEN RAISE EXCEPTION '%: the capacity check waited on the hand', label; END IF;
    IF cap->>'reason' IS DISTINCT FROM 'tournament_not_running' THEN RAISE EXCEPTION '%: unexpected answer %', label, cap; END IF;
    IF hand IS DISTINCT FROM 1 THEN RAISE EXCEPTION '%: the hand did not get its row after the rebuy committed', label; END IF;
  END IF;
  RETURN jsonb_build_object('label', label, 'cycle', cycle, 'capacity_waited_on_hand', waited,
    'capacity_ms', round(cap_ms, 1), 'rebuy_error', rerr, 'hand_error', herr, 'capacity', cap);
END $race$;
"""

SERIAL = r"""
CREATE OR REPLACE FUNCTION pg_temp.serial() RETURNS jsonb LANGUAGE plpgsql AS $s$
DECLARE
  conn text := 'host='||current_setting('unix_socket_directories')||' port='||current_setting('port')||' user=postgres dbname='||current_database();
  t uuid := '00000000-0000-0000-0000-0000000000a1'; apid int; bpid int; deadline timestamptz;
BEGIN
  PERFORM dblink_connect('a', conn); PERFORM dblink_connect('b', conn);
  SELECT pid INTO apid FROM dblink('a','SELECT pg_backend_pid()') AS x(pid int);
  SELECT pid INTO bpid FROM dblink('b','SELECT pg_backend_pid()') AS x(pid int);
  PERFORM dblink_exec('a', 'BEGIN');
  PERFORM * FROM dblink('a', format('SELECT public.fn_ensure_late_registration_capacity(%L,0)', t)) AS x(r jsonb);
  PERFORM dblink_exec('b', 'BEGIN');
  PERFORM dblink_send_query('b', format('SELECT public.fn_ensure_late_registration_capacity(%L,0)', t));
  deadline := clock_timestamp() + interval '5 seconds';
  LOOP
    PERFORM pg_stat_clear_snapshot();
    EXIT WHEN apid = ANY(pg_blocking_pids(bpid));
    IF clock_timestamp() > deadline THEN RAISE EXCEPTION 'two capacity checks no longer serialise'; END IF;
    PERFORM pg_sleep(0.01);
  END LOOP;
  PERFORM dblink_exec('a', 'COMMIT');
  PERFORM * FROM dblink_get_result('b') AS x(r jsonb);
  PERFORM * FROM dblink_get_result('b') AS x(r jsonb);
  PERFORM dblink_exec('b', 'COMMIT');
  PERFORM dblink_disconnect('a'); PERFORM dblink_disconnect('b');
  RETURN jsonb_build_object('serialised', true);
END $s$;
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--output', default=str(ROOT / 'artifacts/rebuy-capacity-lock-order'))
    args = ap.parse_args()
    out = pathlib.Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    if os.geteuid() == 0:
        sys.exit('run as a non-root user: initdb refuses root')
    pg_bin = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
    fixture = FIXTURE.read_text()
    if hashlib.md5(fixture.encode()).hexdigest() != PRE_MD5:
        sys.exit('fixture is not the production pre-image')
    results = {'pre_md5': PRE_MD5, 'post_md5': POST_MD5,
               'migration_sha256': hashlib.sha256(MIGRATION.read_bytes()).hexdigest(),
               'production_mutations': False, 'sections': []}
    work = pathlib.Path(tempfile.mkdtemp(prefix='capacity-lock-'))
    data, sock = work / 'data', work / 'sock'
    sock.mkdir()
    port = '55433'
    subprocess.run([str(pg_bin / 'initdb'), '-D', str(data), '-A', 'trust', '-U', 'postgres', '--no-sync'],
                   check=True, stdout=subprocess.DEVNULL)
    subprocess.run([str(pg_bin / 'pg_ctl'), '-D', str(data), '-w', '-l', str(work / 'server.log'),
                    '-o', f"-k {sock} -p {port} -c listen_addresses='' -c log_lock_waits=on -c deadlock_timeout=200ms",
                    'start'], check=True, stdout=subprocess.DEVNULL)

    def psql(sql, single=True):
        cmd = [str(pg_bin / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', str(sock), '-p', port,
               '-U', 'postgres', '-d', 'postgres']
        if single:
            cmd.append('-1')
        r = subprocess.run(cmd, input=sql, text=True, capture_output=True)
        if r.returncode != 0:
            raise RuntimeError(r.stderr.strip())
        return r.stdout.strip()

    def defmd5():
        return psql("SELECT md5(pg_get_functiondef('public.fn_ensure_late_registration_capacity(uuid,integer)'::regprocedure))")

    try:
        psql(SCHEMA)
        psql('SET check_function_bodies = off;\n' + fixture + ';\n'
             "REVOKE ALL ON FUNCTION public.fn_ensure_late_registration_capacity(uuid,integer) FROM PUBLIC;\n"
             "GRANT EXECUTE ON FUNCTION public.fn_ensure_late_registration_capacity(uuid,integer) TO service_role;\n")
        if defmd5() != PRE_MD5:
            raise RuntimeError('installed pre-image differs from production md5')
        before = json.loads(psql(RACE + "SELECT pg_temp.race('before', true);"))
        results['sections'].append(before)
        print('PASS before: production pre-image reproduces 40P01', json.dumps(before))
        # The unmodified migration file, as the applier sends it.
        psql(MIGRATION.read_text(), single=False)
        if defmd5() != POST_MD5:
            raise RuntimeError('post-image md5 differs from the migration live-proof')
        after = json.loads(psql(RACE + "SELECT pg_temp.race('after', false);"))
        results['sections'].append(after)
        print('PASS after: capacity check never waits on the hand; no 40P01', json.dumps(after))
        results['sections'].append(json.loads(psql(SERIAL + 'SELECT pg_temp.serial();')))
        print('PASS serial: two capacity checks of one event still serialise')
        meta = psql("SELECT prosecdef::text||'|'||array_to_string(proconfig,',')||'|'||"
                    "has_function_privilege('service_role','public.fn_ensure_late_registration_capacity(uuid,integer)','EXECUTE')::text||'|'||"
                    "has_function_privilege('authenticated','public.fn_ensure_late_registration_capacity(uuid,integer)','EXECUTE')::text "
                    "FROM pg_proc WHERE oid='public.fn_ensure_late_registration_capacity(uuid,integer)'::regprocedure")
        if meta != 'true|search_path=public, pg_temp|true|false':
            raise RuntimeError('function metadata changed: ' + meta)
        print('PASS metadata: SECURITY DEFINER, search_path and service-only EXECUTE preserved')
        results['passed'] = True
    except Exception as e:  # noqa: BLE001 - report and fail
        results['passed'] = False
        results['error'] = str(e)
        print('FAIL', e)
    finally:
        subprocess.run([str(pg_bin / 'pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        log = (work / 'server.log').read_text() if (work / 'server.log').exists() else ''
        results['server_log_deadlocks'] = log.count('deadlock detected')
        (out / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
        (out / 'server.log').write_text(log)
        shutil.rmtree(work, ignore_errors=True)
    if not results['passed']:
        sys.exit(1)
    # Exactly one cycle: the BEFORE section's, none after the migration.
    if results['server_log_deadlocks'] != 1:
        sys.exit(f"expected exactly one deadlock (the pre-image's), server log has {results['server_log_deadlocks']}")


if __name__ == '__main__':
    main()
