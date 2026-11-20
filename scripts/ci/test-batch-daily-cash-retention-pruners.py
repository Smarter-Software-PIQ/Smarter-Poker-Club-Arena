"""Native PostgreSQL 17 regression proof for bounded daily cash retention pruners.

Proves migration 20261119185027_batch_daily_cash_retention_pruners.sql against a
throwaway local PostgreSQL 17 cluster (never production):
  - Migration installs cleanly in one transaction, including both @probe-for DO blocks
  - @live-proof evaluates to true
  - Both existing pg_cron jobs are updated in place (no new cron jobs added)
  - Both pruner functions respect p_batch, p_max_batches, and exact 14d / 30d cutoffs
  - Unexpired rows (including just-inside-boundary rows) are untouched
  - PUBLIC, anon, authenticated, and service_role have NO EXECUTE privilege
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def find_pg_bin() -> Path:
    if os.environ.get('PG_BIN'):
        return Path(os.environ['PG_BIN'])
    for candidate in ('/usr/lib/postgresql/17/bin', '/opt/homebrew/bin', '/usr/local/bin'):
        if (Path(candidate) / 'initdb').exists():
            return Path(candidate)
    found = shutil.which('initdb')
    if found:
        return Path(found).parent
    raise RuntimeError('PostgreSQL initdb not found; set PG_BIN')


PG = find_pg_bin()
OUT = Path(os.environ.get('PRUNER_TEST_OUTPUT', ROOT / 'artifacts/batch-daily-cash-retention-pruners'))
OUT.mkdir(parents=True, exist_ok=True)

MIGRATION = ROOT / 'supabase/migrations/20261119185027_batch_daily_cash_retention_pruners.sql'

cluster = Path(tempfile.mkdtemp(prefix='bdc-'))
sock = cluster / 's'
sock.mkdir()
owner = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
if owner:
    shutil.chown(cluster, 'postgres')
    shutil.chown(sock, 'postgres')
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
psql = [PG / 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-h', sock,
        '-p', '55839', '-U', 'postgres', '-d', 'postgres']
checks = []


def cmd(args, sql=None, ok=True):
    p = subprocess.run(list(map(str, args)), input=sql, text=True,
                       capture_output=True, env=env, timeout=60)
    if ok and p.returncode:
        raise RuntimeError(f'{args} failed:\nSTDOUT:\n{p.stdout}\nSTDERR:\n{p.stderr}')
    return p


def run(sql):
    return cmd(psql, sql).stdout.strip()


def check(name, result):
    checks.append({'name': name, 'passed': bool(result)})
    assert result, f'Check failed: {name}'


SCHEMA = """
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE SCHEMA smarter_private;
CREATE SCHEMA cron;

CREATE TABLE cron.job (
  jobid serial PRIMARY KEY,
  jobname text UNIQUE NOT NULL,
  schedule text NOT NULL,
  command text NOT NULL
);

CREATE OR REPLACE FUNCTION cron.schedule(p_jobname text, p_schedule text, p_command text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO cron.job (jobname, schedule, command)
  VALUES (p_jobname, p_schedule, p_command)
  ON CONFLICT (jobname) DO UPDATE
    SET schedule = EXCLUDED.schedule,
        command  = EXCLUDED.command
  RETURNING jobid INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.fn_cash_provenance_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'cash_provenance_is_immutable' USING ERRCODE = '55000';
END $$;

CREATE TABLE smarter_private.cash_hand_chair_clubs (
  table_id       uuid        NOT NULL,
  hand_number    bigint      NOT NULL,
  user_id        uuid        NOT NULL,
  seat_id        uuid        NOT NULL,
  occupancy_id   uuid        NOT NULL,
  seat_joined_at timestamptz NOT NULL,
  club_id        uuid,
  captured_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (table_id, hand_number, user_id)
);
CREATE INDEX cash_hand_chair_clubs_captured_at_idx
  ON smarter_private.cash_hand_chair_clubs (captured_at);

CREATE OR REPLACE FUNCTION smarter_private.cash_hand_chair_clubs_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.captured_at < now() - interval '14 days' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'cash_hand_chair_clubs_is_immutable' USING ERRCODE = '55000';
END $$;

CREATE TRIGGER cash_hand_chair_clubs_immutable
  BEFORE UPDATE OR DELETE ON smarter_private.cash_hand_chair_clubs
  FOR EACH ROW EXECUTE FUNCTION smarter_private.cash_hand_chair_clubs_immutable();

CREATE TABLE smarter_private.cash_seat_occupancy_history (
  seat_id      uuid        NOT NULL,
  user_id      uuid        NOT NULL,
  joined_at    timestamptz NOT NULL,
  table_id     uuid        NOT NULL,
  occupancy_id uuid,
  club_id      uuid,
  seat_number  integer,
  stack_at_end numeric,
  ended_at     timestamptz NOT NULL,
  end_kind     text        NOT NULL CHECK (end_kind IN ('left', 'reoccupied', 'deleted')),
  recorded_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (seat_id, user_id, joined_at)
);
CREATE INDEX cash_seat_occupancy_history_recorded_at_idx
  ON smarter_private.cash_seat_occupancy_history (recorded_at);

CREATE OR REPLACE FUNCTION smarter_private.cash_seat_occupancy_history_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.recorded_at < now() - interval '30 days' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'cash_seat_occupancy_history_is_immutable' USING ERRCODE = '55000';
END $$;

CREATE TRIGGER cash_seat_occupancy_history_immutable
  BEFORE UPDATE OR DELETE ON smarter_private.cash_seat_occupancy_history
  FOR EACH ROW EXECUTE FUNCTION smarter_private.cash_seat_occupancy_history_immutable();

-- Pre-seed the exact two unbatched daily jobs created on 2026-11-18.
SELECT cron.schedule('ca-cash-hand-chair-clubs-prune-daily', '35 5 * * *',
  $cron$DELETE FROM smarter_private.cash_hand_chair_clubs WHERE captured_at < now() - interval '14 days'$cron$);
SELECT cron.schedule('ca-cash-seat-occupancy-history-prune-daily', '40 5 * * *',
  $cron$DELETE FROM smarter_private.cash_seat_occupancy_history WHERE recorded_at < now() - interval '30 days'$cron$);
"""


def seed_chair_clubs():
    run("""
    DELETE FROM smarter_private.cash_hand_chair_clubs WHERE captured_at < now() - interval '14 days';
    INSERT INTO smarter_private.cash_hand_chair_clubs
      (table_id, hand_number, user_id, seat_id, occupancy_id, seat_joined_at, club_id, captured_at)
    SELECT md5('t')::uuid, g, md5('u' || g)::uuid, md5('s' || g)::uuid, md5('o' || g)::uuid,
           now() - interval '16 days', md5('c')::uuid,
           now() - interval '15 days' + g * interval '5 minutes'
      FROM generate_series(1, 10) g
    ON CONFLICT DO NOTHING;

    -- Just inside the 14-day retention boundary (must NOT be deleted).
    INSERT INTO smarter_private.cash_hand_chair_clubs
      (table_id, hand_number, user_id, seat_id, occupancy_id, seat_joined_at, club_id, captured_at)
    VALUES (md5('t')::uuid, 100, md5('u100')::uuid, md5('s100')::uuid, md5('o100')::uuid,
            now() - interval '14 days', md5('c')::uuid, now() - interval '13 days 23 hours 59 minutes')
    ON CONFLICT DO NOTHING;

    -- Fresh rows (must NOT be deleted).
    INSERT INTO smarter_private.cash_hand_chair_clubs
      (table_id, hand_number, user_id, seat_id, occupancy_id, seat_joined_at, club_id, captured_at)
    SELECT md5('t')::uuid, 200 + g, md5('uf' || g)::uuid, md5('sf' || g)::uuid, md5('of' || g)::uuid,
           now() - interval '2 days', md5('c')::uuid, now() - interval '1 day'
      FROM generate_series(1, 5) g
    ON CONFLICT DO NOTHING;
    ANALYZE smarter_private.cash_hand_chair_clubs;
    """)


def seed_occupancy_history():
    run("""
    DELETE FROM smarter_private.cash_seat_occupancy_history WHERE recorded_at < now() - interval '30 days';
    INSERT INTO smarter_private.cash_seat_occupancy_history
      (seat_id, user_id, joined_at, table_id, occupancy_id, club_id, seat_number, stack_at_end, ended_at, end_kind, recorded_at)
    SELECT md5('hs' || g)::uuid, md5('hu' || g)::uuid, now() - interval '32 days' + g * interval '1 minute',
           md5('t')::uuid, md5('ho' || g)::uuid, md5('c')::uuid, 1, 100,
           now() - interval '31 days' + g * interval '5 minutes', 'left',
           now() - interval '31 days' + g * interval '5 minutes'
      FROM generate_series(1, 10) g
    ON CONFLICT DO NOTHING;

    -- Just inside the 30-day retention boundary (must NOT be deleted).
    INSERT INTO smarter_private.cash_seat_occupancy_history
      (seat_id, user_id, joined_at, table_id, occupancy_id, club_id, seat_number, stack_at_end, ended_at, end_kind, recorded_at)
    VALUES (md5('hs100')::uuid, md5('hu100')::uuid, date_trunc('hour', now()) - interval '30 days',
            md5('t')::uuid, md5('ho100')::uuid, md5('c')::uuid, 1, 100,
            now() - interval '29 days 23 hours 59 minutes', 'left',
            now() - interval '29 days 23 hours 59 minutes')
    ON CONFLICT DO NOTHING;

    -- Fresh rows (must NOT be deleted).
    INSERT INTO smarter_private.cash_seat_occupancy_history
      (seat_id, user_id, joined_at, table_id, occupancy_id, club_id, seat_number, stack_at_end, ended_at, end_kind, recorded_at)
    SELECT md5('hf' || g)::uuid, md5('huf' || g)::uuid, date_trunc('hour', now()) - interval '2 days' + g * interval '1 minute',
           md5('t')::uuid, md5('hof' || g)::uuid, md5('c')::uuid, 1, 100,
           now() - interval '1 day', 'left', now() - interval '1 day'
      FROM generate_series(1, 5) g
    ON CONFLICT DO NOTHING;
    ANALYZE smarter_private.cash_seat_occupancy_history;
    """)


try:
    cmd(owner + [PG / 'initdb', '-D', cluster / 'd', '-U', 'postgres',
                 '--auth-local=trust', '--auth-host=reject', '--no-locale', '--encoding=UTF8'])
    cmd(owner + [PG / 'pg_ctl', '-D', cluster / 'd', '-l', cluster / 'log', '-o',
                 f"-k {sock} -p 55839 -c listen_addresses='' -c shared_buffers=16MB", '-w', 'start'])

    run(SCHEMA)
    migration_sql = MIGRATION.read_text()
    run(migration_sql)
    check('migration-installs-cleanly-with-probes', True)

    # Verify @live-proof expression evaluates true.
    proof_matches = re.findall(r'^-- @live-proof: (.*)$', migration_sql, flags=re.MULTILINE)
    check('migration-has-live-proof', len(proof_matches) == 1)
    check('live-proof-evaluates-true', run(f'SELECT ({proof_matches[0]})::boolean') == 't')

    # Verify no new cron jobs were added and both existing jobs were updated in place.
    check('exactly-two-cron-jobs-exist', run('SELECT count(*) FROM cron.job') == '2')
    check('chair-clubs-cron-updated-in-place',
          run("SELECT schedule = '35 5 * * *' AND command LIKE '%fn_prune_cash_hand_chair_clubs(5000, 15)%' AND command LIKE '%statement_timeout%' FROM cron.job WHERE jobname = 'ca-cash-hand-chair-clubs-prune-daily'") == 't')
    check('occupancy-history-cron-updated-in-place',
          run("SELECT schedule = '40 5 * * *' AND command LIKE '%fn_prune_cash_seat_occupancy_history(5000, 15)%' AND command LIKE '%statement_timeout%' FROM cron.job WHERE jobname = 'ca-cash-seat-occupancy-history-prune-daily'") == 't')

    # Test 1: cash_hand_chair_clubs bounded batching + 14-day retention boundary.
    seed_chair_clubs()
    check('chair-clubs-batch-1-respects-p-batch-3',
          run('SELECT smarter_private.fn_prune_cash_hand_chair_clubs(3, 15.0, 1)') == '3')
    # Oldest 3 (hand_number 1, 2, 3) deleted first.
    check('chair-clubs-oldest-deleted-first',
          run('SELECT min(hand_number) FROM smarter_private.cash_hand_chair_clubs WHERE hand_number <= 10') == '4')
    check('chair-clubs-batch-2-respects-p-batch-4',
          run('SELECT smarter_private.fn_prune_cash_hand_chair_clubs(4, 15.0, 1)') == '4')
    check('chair-clubs-drain-remaining-expired',
          run('SELECT smarter_private.fn_prune_cash_hand_chair_clubs(5, 15.0, 10)') == '3')
    check('chair-clubs-unexpired-and-boundary-untouched',
          run('SELECT count(*) FROM smarter_private.cash_hand_chair_clubs') == '6'
          and run('SELECT count(*) FROM smarter_private.cash_hand_chair_clubs WHERE hand_number = 100') == '1')
    check('chair-clubs-noop-when-none-expired',
          run('SELECT smarter_private.fn_prune_cash_hand_chair_clubs(5, 15.0, 10)') == '0')

    # Multi-batch drain in a single call for chair clubs.
    seed_chair_clubs()
    check('chair-clubs-multi-batch-single-call',
          run('SELECT smarter_private.fn_prune_cash_hand_chair_clubs(4, 15.0, 10)') == '10'
          and run('SELECT count(*) FROM smarter_private.cash_hand_chair_clubs') == '6')

    # Test 2: cash_seat_occupancy_history bounded batching + 30-day retention boundary.
    seed_occupancy_history()
    check('occupancy-history-batch-1-respects-p-batch-3',
          run('SELECT smarter_private.fn_prune_cash_seat_occupancy_history(3, 15.0, 1)') == '3')
    check('occupancy-history-batch-2-respects-p-batch-4',
          run('SELECT smarter_private.fn_prune_cash_seat_occupancy_history(4, 15.0, 1)') == '4')
    check('occupancy-history-drain-remaining-expired',
          run('SELECT smarter_private.fn_prune_cash_seat_occupancy_history(5, 15.0, 10)') == '3')
    check('occupancy-history-unexpired-and-boundary-untouched',
          run('SELECT count(*) FROM smarter_private.cash_seat_occupancy_history') == '6'
          and run("SELECT count(*) FROM smarter_private.cash_seat_occupancy_history WHERE seat_id = md5('hs100')::uuid") == '1')
    check('occupancy-history-noop-when-none-expired',
          run('SELECT smarter_private.fn_prune_cash_seat_occupancy_history(5, 15.0, 10)') == '0')

    # Multi-batch drain in a single call for occupancy history.
    seed_occupancy_history()
    check('occupancy-history-multi-batch-single-call',
          run('SELECT smarter_private.fn_prune_cash_seat_occupancy_history(4, 15.0, 10)') == '10'
          and run('SELECT count(*) FROM smarter_private.cash_seat_occupancy_history') == '6')

    # Test 3: Strict ACLs (owner/postgres only — PUBLIC, anon, authenticated, service_role denied).
    for fn in (
        'smarter_private.fn_prune_cash_hand_chair_clubs(integer, double precision, integer)',
        'smarter_private.fn_prune_cash_seat_occupancy_history(integer, double precision, integer)',
    ):
        for role in ('public', 'anon', 'authenticated', 'service_role'):
            ok = run(f"SELECT NOT has_function_privilege('{role}', '{fn}', 'EXECUTE')") == 't'
            check(f'acl-denied-{role}-{fn.split(".")[1].split("(")[0]}', ok)

    print(json.dumps({'checks': checks, 'production_mutations': False}, indent=2))
finally:
    (OUT / 'RESULTS.json').write_text(json.dumps({'checks': checks, 'production_mutations': False}, indent=2))
    cmd(owner + [PG / 'pg_ctl', '-D', cluster / 'd', '-m', 'immediate', '-w', 'stop'], ok=False)
    shutil.rmtree(cluster, ignore_errors=True)
