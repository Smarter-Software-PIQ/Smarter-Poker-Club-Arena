"""Isolated PostgreSQL regression for migration 20261111134959.

SpinFleetProducingNothing paged critical at 2026-11-11 11:19Z on the room
working as specified: fn_spin_metrics.open_boards counted 32 empty Spin boards
(certification fixture clubs with no horse members, REGISTERING since
2026-11-09, no entrant and no live seat) as open, while no house board was
open and nothing was starting overnight by design.

The test loads the exact production definition of fn_spin_metrics captured on
2026-11-11 (pg_get_functiondef md5 equal to production's), proves the baseline
counts an empty board as open, applies the migration as production would, and
proves the candidate counts only boards holding a live seat, still holds a
floor-parked board, keeps every other gauge, owner, security, settings and
grants, and refuses a second run. An empty throwaway cluster on a Unix
socket; no network, no production connection.
"""
import argparse
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase' / 'migrations' / '20261111134959_an_empty_spin_board_is_not_open.sql'
FIXTURE = ROOT / 'scripts' / 'ci' / 'fixtures' / 'spin-open-boards' / 'fn_spin_metrics.live-20261111.sql'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'artifacts/spin-open-boards')
out = parser.parse_args().output.resolve()
out.mkdir(parents=True, exist_ok=True)
pg = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
as_owner = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
cluster = pathlib.Path(tempfile.mkdtemp(prefix='spin-open-boards-'))
sock = cluster / 'socket'
sock.mkdir(mode=0o700)
if as_owner:
    shutil.chown(cluster, 'postgres')
    shutil.chown(sock, 'postgres')
PORT = '55834'
psql = [pg / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', PORT, '-U', 'postgres', '-d', 'postgres']
results = {'checks': [], 'production_mutations': False}
SIG = 'public.fn_spin_metrics(integer)'
PRE = 'c3eec000c70e31cfcc3c38b8bac998fe'
GRANTS = f'REVOKE ALL ON FUNCTION {SIG} FROM PUBLIC; GRANT EXECUTE ON FUNCTION {SIG} TO service_role;\n'

# Only what fn_spin_metrics reads. Views are stood in for by tables.
SCHEMA = """
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE tournaments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), variant text, status text,
  club_id uuid, union_id uuid, spin_reveal_lag_ms integer, spin_multiplier numeric, buy_in_amount numeric,
  buy_in_fee numeric, started_at timestamptz, ended_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE tournament_players(tournament_id uuid);
CREATE TABLE tables(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid);
CREATE TABLE table_seats(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid, left_at timestamptz);
CREATE TABLE spin_reserve_ledger(tournament_id uuid, amount numeric, kind text);
CREATE TABLE wallet_transactions(related_entity_id uuid, amount numeric, type text, category text);
CREATE TABLE v_spin_draw_fairness(window_label text, draws bigint, realised_e numeric, spec_e numeric,
  z numeric, drift boolean, constrained_draws bigint);
CREATE TABLE v_spin_reserve_health(club_id uuid, balance numeric, spin_count integer, is_thin boolean);
CREATE TABLE v_tournament_rake_attribution_gaps(id integer);
CREATE TABLE v_spin_unfilled_waits(id integer);
CREATE FUNCTION fn_spin_unpaid_settlements(integer) RETURNS TABLE(chips_short numeric)
  LANGUAGE sql AS 'SELECT 0::numeric WHERE false';
CREATE FUNCTION fn_spin_reserve_owner(p_club uuid) RETURNS uuid LANGUAGE sql STABLE AS 'SELECT p_club';
CREATE TABLE parked_clubs(club_id uuid PRIMARY KEY);
CREATE FUNCTION fn_ca_operator_floor_park_holds(p_club uuid, p_union uuid) RETURNS boolean
  LANGUAGE sql STABLE AS 'SELECT EXISTS (SELECT 1 FROM parked_clubs WHERE club_id = p_club)';
"""

U = lambda n: uuid.UUID(int=n)
HOUSE, FIXTURE_CLUB, PARKED = U(1), U(2), U(3)


def command(args, sql=None):
    r = subprocess.run(list(map(str, args)), input=sql, text=True, capture_output=True, env=env, timeout=120)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def run(sql):
    return command(psql, sql)


def check(name, passed, detail=None):
    results['checks'].append({'name': name, 'passed': bool(passed), 'detail': detail})
    if not passed:
        raise AssertionError(f'{name}: {detail}')


def md5():
    return run(f"SELECT md5(pg_get_functiondef('{SIG}'::regprocedure))")


def board(club, seats_live, seats_left=0):
    """One REGISTERING Spin with its table and the given seats."""
    t = uuid.uuid4()
    tb = uuid.uuid4()
    sql = [f"INSERT INTO tournaments(id,variant,status,club_id) VALUES ('{t}','spin','REGISTERING','{club}');",
           f"INSERT INTO tables(id,tournament_id) VALUES ('{tb}','{t}');"]
    sql += [f"INSERT INTO table_seats(table_id) VALUES ('{tb}');"] * seats_live
    sql += [f"INSERT INTO table_seats(table_id,left_at) VALUES ('{tb}',now());"] * seats_left
    return sql


def seed():
    sql = ['TRUNCATE tournaments, tables, table_seats, parked_clubs;',
           f"INSERT INTO parked_clubs VALUES ('{PARKED}');",
           # The last Spin started three hours ago: past the ladder's envelope.
           "INSERT INTO tournaments(variant,status,club_id,started_at) VALUES "
           f"('spin','COMPLETED','{HOUSE}',now() - interval '3 hours');"]
    sql += board(HOUSE, 1)                 # one horse opened it: open
    sql += board(HOUSE, 2)                 # two seats waiting: open
    for _ in range(4):
        sql += board(FIXTURE_CLUB, 0)      # nobody ever sat: not open
    sql += board(FIXTURE_CLUB, 0, 1)       # its only seat left: not open
    sql += board(PARKED, 1)                # held by an owner floor park: not open
    run('\n'.join(sql))


def metrics():
    return json.loads(run('SELECT to_jsonb(m) FROM fn_spin_metrics(60) m'))


try:
    command(as_owner + [pg / 'initdb', '-D', cluster / 'data', '-U', 'postgres', '--auth-local=trust',
                        '--auth-host=reject', '--no-locale', '--encoding=UTF8'])
    command(as_owner + [pg / 'pg_ctl', '-D', cluster / 'data', '-l', cluster / 'server.log', '-o',
                        f"-k {sock} -p {PORT} -c listen_addresses='' -c shared_buffers=32MB -c max_connections=10",
                        '-w', 'start'])
    run(SCHEMA)
    run(FIXTURE.read_text() + ';\n' + GRANTS)
    check('baseline-is-production-preimage', md5() == PRE, md5())

    seed()
    base = metrics()
    results['baseline_open_boards'] = base['open_boards']
    check('baseline-counts-empty-boards-as-open', base['open_boards'] == 7, base)

    migration = MIGRATION.read_text()
    check('candidate-is-one-transaction',
          len(re.findall(r'^BEGIN;', migration, re.M)) == 1 and len(re.findall(r'^COMMIT;', migration, re.M)) == 1)
    check('candidate-sets-lock-timeout', 'SET LOCAL lock_timeout' in migration)
    proof = re.search(r'^-- @live-proof: (.+)$', migration, re.M)
    check('candidate-carries-a-live-proof', proof is not None)
    check('live-proof-reads-false-before-install', run('SELECT ' + proof.group(1)) == 'f')
    run(migration)
    check('live-proof-reads-true-after-install', run('SELECT ' + proof.group(1)) == 't')
    post = md5()
    results['postimage_md5'] = post

    seed()
    cand = metrics()
    results['candidate_open_boards'] = cand['open_boards']
    check('only-a-board-with-a-live-seat-is-open', cand['open_boards'] == 2, cand)
    check('every-other-gauge-unchanged',
          {k: v for k, v in cand.items() if k != 'open_boards'}
          == {k: v for k, v in base.items() if k != 'open_boards'}, (base, cand))
    run(f"DELETE FROM parked_clubs WHERE club_id = '{PARKED}'")
    check('an-unparked-board-with-a-seat-counts-again', metrics()['open_boards'] == 3)
    run("UPDATE table_seats SET left_at = now() WHERE left_at IS NULL")
    check('a-room-nobody-sits-in-has-no-open-board', metrics()['open_boards'] == 0)

    meta = run(f"SELECT pg_get_userbyid(proowner)||' '||prosecdef::text||' '||provolatile::text||' '"
               f"||coalesce(proconfig::text,'-')||' '||coalesce(proacl::text,'-') FROM pg_proc "
               f"WHERE oid = '{SIG}'::regprocedure")
    check('owner-security-volatility-settings-and-grants-kept',
          meta == 'postgres true s {"search_path=public, pg_temp"} {postgres=X/postgres,service_role=X/postgres}',
          meta)
    for role in ('anon', 'authenticated'):
        r = subprocess.run(list(map(str, psql)), input=f'SET ROLE {role}; SELECT * FROM fn_spin_metrics(60);',
                           text=True, capture_output=True, env=env, timeout=30)
        check(role + '-cannot-read-the-metrics', r.returncode != 0 and 'permission denied' in r.stderr)
    replay = subprocess.run(list(map(str, psql)), input=migration, text=True, capture_output=True, env=env,
                            timeout=60)
    check('migration-refuses-a-second-run',
          replay.returncode != 0 and 'changed since 2026-11-11' in replay.stderr, replay.stderr[-300:])
    check('second-run-left-the-postimage', md5() == post)
finally:
    if (cluster / 'data' / 'postmaster.pid').exists():
        command(as_owner + [pg / 'pg_ctl', '-D', cluster / 'data', '-m', 'fast', '-w', 'stop'])
    shutil.rmtree(cluster, ignore_errors=True)
    results['owned_cluster_removed'] = not cluster.exists()
    (out / 'RESULTS.json').write_text(json.dumps(results, indent=2, default=str) + '\n')
print(json.dumps({'passed': len(results['checks']), 'output': str(out / 'RESULTS.json')}))
