"""Qualify the exact player-period owner in isolated PostgreSQL17.

The existing daily report is a deterministic fixture here. This verifies the
new snapshot/period owner, not production money or the existing daily query.
"""
from pathlib import Path
import os
import shutil
import socket
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[2]
pg = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
work = os.environ.get('DIGEST_NATIVE_WORK')
if not work:
    raise SystemExit('DIGEST_NATIVE_WORK must name an owned scratch directory')
scratch = Path(tempfile.mkdtemp(prefix='digest-player-period-', dir=work))
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    port = str(listener.getsockname()[1])

def run(tool, args, sql=None):
    p = subprocess.run([str(pg / tool), *args], input=sql, text=True, capture_output=True)
    if p.returncode:
        raise RuntimeError(p.stdout + p.stderr)
    return p.stdout

def sql(text):
    return run('psql', ['-X', '-h', '127.0.0.1', '-p', port, '-d', 'postgres',
                        '-v', 'ON_ERROR_STOP=1'], text)

started = False
try:
    run('initdb', ['-D', str(scratch / 'data'), '-A', 'trust', '--no-locale'])
    run('pg_ctl', ['-D', str(scratch / 'data'), '-l', str(scratch / 'log'),
                   '-o', f"-h 127.0.0.1 -k '' -p {port}", '-w', 'start'])
    started = True
    fixture = repo / 'scripts/ci/fixtures/digest-player-period'
    sql((fixture / 'setup.sql').read_text())
    migration = next((repo / 'supabase/migrations').glob('20261026140704_*.sql')).read_text()
    tables = migration[migration.index('CREATE TABLE'):migration.index(
        'CREATE OR REPLACE FUNCTION public.fn_sp_digest_player_totals')]
    owner = migration[migration.index('-- Keep one day:'):]
    sql('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;\n'
        + 'BEGIN;\n' + tables + owner)
    sql((fixture / 'assert.sql').read_text())
    # The signed service route must not inherit its 8s default for the funding
    # report. Apply the actual guarded metadata migration to its exact body;
    # no report fixtures or financial queries need to execute for this change.
    sql("CREATE ROLE postgres; CREATE SCHEMA smarter_private; "
        "SET check_function_bodies=off;\n" +
        (fixture / 'funding-budget-preimage.sql').read_text() +
        ";\nALTER FUNCTION fn_sp_digest_free_buy_funding(date) OWNER TO postgres;"
        "REVOKE ALL ON FUNCTION fn_sp_digest_free_buy_funding(date) FROM PUBLIC;"
        "GRANT EXECUTE ON FUNCTION fn_sp_digest_free_buy_funding(date) TO service_role;"
        "ALTER ROLE service_role SET statement_timeout='8s';")
    budget_migration = next((repo / 'supabase/migrations').glob(
        '*_free_buy_funding_report_has_its_own_read_budget.sql')).read_text()
    def rejected_budget_preimage(change, restore):
        sql(change)
        try:
            sql(budget_migration)
            raise AssertionError('Changed funding report preimage was accepted')
        except RuntimeError as error:
            assert 'FUNDING_REPORT_BUDGET_PREIMAGE_CHANGED' in str(error), error
        sql(restore)
    rejected_budget_preimage(
        "ALTER FUNCTION fn_sp_digest_free_buy_funding(date) SET statement_timeout='30s';",
        "ALTER FUNCTION fn_sp_digest_free_buy_funding(date) RESET statement_timeout;")
    rejected_budget_preimage(
        "GRANT EXECUTE ON FUNCTION fn_sp_digest_free_buy_funding(date) TO authenticated;",
        "REVOKE EXECUTE ON FUNCTION fn_sp_digest_free_buy_funding(date) FROM authenticated;")
    sql(budget_migration)
    sql("""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_proc
        WHERE oid='fn_sp_digest_free_buy_funding(date)'::regprocedure
          AND proconfig=ARRAY['search_path=pg_catalog, public, smarter_private, pg_temp','statement_timeout=60s']
          AND md5(prosrc)='59f51949fde459c23eaeaaed636f0daa'
          AND proowner='postgres'::regrole AND prosecdef AND provolatile='s'
          AND proacl=ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[])
        OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role'
          AND rolconfig=ARRAY['statement_timeout=8s'])
      THEN RAISE EXCEPTION 'funding report budget or preserved metadata mismatch'; END IF;
    END $$;""")
    print('PASS funding report: exact source/ACL guards, local 60s, service role still 8s')
    print('PASS exact period owner: one daily compute, explicit missing history, finite fill, '
          'day/week/month, distinct players, end wallet, inherited grants removed')
finally:
    if started:
        run('pg_ctl', ['-D', str(scratch / 'data'), '-m', 'immediate', '-w', 'stop'])
    shutil.rmtree(scratch)
