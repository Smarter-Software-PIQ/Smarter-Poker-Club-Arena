"""Native PostgreSQL 17 regression proof for engine_lifecycle_logs bounded retention.

Proves migration 20261120213600_engine_lifecycle_logs_bounded_retention.sql against a
throwaway local PostgreSQL 17 cluster (never production):
  - Prerequisite table migration (20261119175748) and retention migration
    (20261120213600) install cleanly in one transaction each, including the
    @probe-for DO block.
  - @live-proof evaluates to true.
  - Daily cron job ca-engine-lifecycle-logs-prune-daily is scheduled to call
    public.fn_ca_prune_engine_lifecycle_logs(interval '30 days', 5000).
  - Function carries SECURITY DEFINER, search_path=public, statement_timeout=15s,
    lock_timeout=2s, and denies EXECUTE to PUBLIC, anon, authenticated, and
    service_role.
  - Bounded page delete removes oldest expired rows first, respects p_batch,
    leaves unexpired and just-inside-boundary rows untouched, honors custom
    p_keep >= 1 day, and rejects NULL or < 1 day p_keep with SQLSTATE 22023.
"""
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def find_pg_bin() -> Path:
    if os.environ.get('PG_BIN'):
        return Path(os.environ['PG_BIN'])
    for candidate in (
        '/usr/lib/postgresql/17/bin',
        '/opt/homebrew/opt/postgresql@17/bin',
        '/opt/homebrew/bin',
        '/usr/local/bin',
    ):
        if (Path(candidate) / 'initdb').exists():
            return Path(candidate)
    found = shutil.which('initdb')
    if found:
        return Path(found).parent
    raise RuntimeError('PostgreSQL initdb not found; set PG_BIN')


PG = find_pg_bin()
OUT = Path(
    os.environ.get(
        'PRUNER_TEST_OUTPUT',
        ROOT / 'artifacts/engine-lifecycle-logs-bounded-retention',
    )
)
OUT.mkdir(parents=True, exist_ok=True)

TABLE_MIGRATION = ROOT / 'supabase/migrations/20261119175748_engine_lifecycle_logs_table.sql'
RETENTION_MIGRATION = ROOT / 'supabase/migrations/20261120213600_engine_lifecycle_logs_bounded_retention.sql'

def free_loopback_port() -> str:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return str(s.getsockname()[1])


PG_PORT = free_loopback_port()
cluster = Path(tempfile.mkdtemp(prefix='ell-ret-'))
owner = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
if owner:
    shutil.chown(cluster, 'postgres')
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
psql = [
    PG / 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
    '-p', PG_PORT, '-U', 'postgres', '-d', 'postgres',
]
checks = []


def cmd(args, sql=None, ok=True):
    p = subprocess.run(
        list(map(str, args)),
        input=sql,
        text=True,
        capture_output=True,
        env=env,
        timeout=60,
    )
    if ok and p.returncode:
        raise RuntimeError(f'{args} failed:\nSTDOUT:\n{p.stdout}\nSTDERR:\n{p.stderr}')
    return p


def run(sql):
    return cmd(psql, sql).stdout.strip()


def check(name, result):
    checks.append({'name': name, 'passed': bool(result)})
    assert result, f'Check failed: {name}'


PREREQ = """
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

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
"""


def seed_logs():
    run('TRUNCATE public.engine_lifecycle_logs RESTART IDENTITY;')
    # 10 expired rows: 40 days old down to 31 days old (seq 1..10, oldest first)
    run("""
    INSERT INTO public.engine_lifecycle_logs (created_at, instance_id, release_sha, level, event, message, detail)
    SELECT now() - make_interval(days => 41 - g),
           'inst-expired-' || g,
           'sha-old',
           'info',
           'boot',
           'expired row ' || g,
           jsonb_build_object('seq', g)
      FROM generate_series(1, 10) AS g;

    -- 1 just-inside-boundary row (29 days 23 hours old: MUST survive 30-day prune)
    INSERT INTO public.engine_lifecycle_logs (created_at, instance_id, release_sha, level, event, message, detail)
    VALUES (now() - interval '29 days 23 hours', 'inst-boundary', 'sha-cur', 'warn', 'boundary', 'just inside 30d', '{"seq":100}'::jsonb);

    -- 5 recent rows: 5 days old down to 1 day old
    INSERT INTO public.engine_lifecycle_logs (created_at, instance_id, release_sha, level, event, message, detail)
    SELECT now() - make_interval(days => g),
           'inst-recent-' || g,
           'sha-cur',
           'info',
           'boot',
           'recent row ' || g,
           jsonb_build_object('seq', 200 + g)
      FROM generate_series(1, 5) AS g;
    """)


try:
    cmd(owner + [PG / 'initdb', '-D', cluster / 'd', '-U', 'postgres', '--auth=trust', '--no-sync'])
    cmd(
        owner + [
            PG / 'pg_ctl', '-D', cluster / 'd', '-l', cluster / 'log',
            '-o', f'-h 127.0.0.1 -p {PG_PORT} -c unix_socket_directories= -F', '-w', 'start',
        ]
    )

    run(PREREQ)
    run(TABLE_MIGRATION.read_text())

    migration_sql = RETENTION_MIGRATION.read_text()
    run(migration_sql)
    check('migration-installs-cleanly-with-probe', True)

    # Verify @live-proof evaluates to true.
    proof_matches = re.findall(r'^-- @live-proof: (.*)$', migration_sql, flags=re.MULTILINE)
    check('migration-has-live-proof', len(proof_matches) == 1)
    check('live-proof-evaluates-true', run(f'SELECT ({proof_matches[0]})::boolean') == 't')

    # Verify daily cron job is scheduled.
    check(
        'cron-job-scheduled',
        run(
            "SELECT schedule = '45 5 * * *' "
            "AND command LIKE '%fn_ca_prune_engine_lifecycle_logs(interval ''30 days'', 5000)%' "
            "AND command LIKE '%statement_timeout%' "
            "AND command LIKE '%lock_timeout%' "
            "FROM cron.job WHERE jobname = 'ca-engine-lifecycle-logs-prune-daily'"
        ) == 't',
    )

    # Verify SECURITY DEFINER + proconfig settings.
    check(
        'function-security-definer-and-config',
        run(
            "SELECT prosecdef "
            "AND 'search_path=public' = ANY(proconfig) "
            "AND 'statement_timeout=15s' = ANY(proconfig) "
            "AND 'lock_timeout=2s' = ANY(proconfig) "
            "FROM pg_proc "
            "WHERE oid = 'public.fn_ca_prune_engine_lifecycle_logs(interval,integer)'::regprocedure"
        ) == 't',
    )

    # Verify strict ACLs (owner/postgres only).
    fn_sig = 'public.fn_ca_prune_engine_lifecycle_logs(interval, integer)'
    for role in ('public', 'anon', 'authenticated', 'service_role'):
        ok = run(f"SELECT NOT has_function_privilege('{role}', '{fn_sig}', 'EXECUTE')") == 't'
        check(f'acl-denied-{role}', ok)

    # Bounded page delete + oldest-first + exact 30-day boundary preservation.
    seed_logs()
    check(
        'batch-1-respects-p-batch-3',
        run("SELECT public.fn_ca_prune_engine_lifecycle_logs(interval '30 days', 3)") == '3',
    )
    check(
        'oldest-3-deleted-first',
        run("SELECT min((detail->>'seq')::int) FROM public.engine_lifecycle_logs WHERE (detail->>'seq')::int <= 10") == '4',
    )
    check(
        'batch-2-respects-p-batch-4',
        run("SELECT public.fn_ca_prune_engine_lifecycle_logs(interval '30 days', 4)") == '4',
    )
    check(
        'batch-3-drains-remaining-3-expired',
        run("SELECT public.fn_ca_prune_engine_lifecycle_logs(interval '30 days', 10)") == '3',
    )
    check(
        'unexpired-and-boundary-untouched',
        run('SELECT count(*) FROM public.engine_lifecycle_logs') == '6'
        and run("SELECT count(*) FROM public.engine_lifecycle_logs WHERE instance_id = 'inst-boundary'") == '1',
    )
    check(
        'noop-when-none-expired',
        run("SELECT public.fn_ca_prune_engine_lifecycle_logs(interval '30 days', 10)") == '0',
    )

    # Custom p_keep (3 days 12 hours) prunes boundary + 5d + 4d rows (3 rows), keeps 3d, 2d, 1d (3 rows).
    check(
        'custom-p-keep-3d12h',
        run("SELECT public.fn_ca_prune_engine_lifecycle_logs(interval '3 days 12 hours', 100)") == '3'
        and run('SELECT count(*) FROM public.engine_lifecycle_logs') == '3',
    )

    # Invalid p_keep rejected with SQLSTATE 22023.
    for label, expr in (
        ('null-p-keep', 'NULL::interval'),
        ('zero-p-keep', "interval '0 seconds'"),
        ('negative-p-keep', "interval '-1 day'"),
        ('sub-day-p-keep', "interval '12 hours'"),
    ):
        res = cmd(
            psql,
            f"SELECT public.fn_ca_prune_engine_lifecycle_logs({expr}, 10);",
            ok=False,
        )
        check(f'rejects-{label}', res.returncode != 0 and 'p_keep must be at least 1 day' in res.stderr)

    print(json.dumps({'checks': checks, 'production_mutations': False}, indent=2))
finally:
    (OUT / 'RESULTS.json').write_text(json.dumps({'checks': checks, 'production_mutations': False}, indent=2))
    cmd(owner + [PG / 'pg_ctl', '-D', cluster / 'd', '-m', 'immediate', '-w', 'stop'], ok=False)
    shutil.rmtree(cluster, ignore_errors=True)
