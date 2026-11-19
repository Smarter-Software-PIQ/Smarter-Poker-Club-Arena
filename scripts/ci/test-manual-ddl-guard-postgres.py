#!/usr/bin/env python3
"""A manual session never locks the live tables (incident 075013fd).

Native proof of supabase/migrations/20261119053515_a_manual_session_never_locks_the_live_tables.sql
on a throwaway PostgreSQL (16 by default; --pg-bin for another major). The
migration is installed exactly as written, by a superuser (vanilla PostgreSQL
lets only a superuser create event triggers; Supabase lets postgres), and every
case runs as the login role postgres through TCP, the way the pooler, the MCP
and psql reach production. The applier's transaction is built from the
applier's own history template (apply-recorded-migration.mjs historyStatement)
and bound by the real bindMigrationSession (migration-session-identity.mjs).

Cases:
  * a manual ALTER TABLE on a live table is refused, before its lock: with a
    reader holding ACCESS SHARE and lock_timeout 30 s it returns at once;
  * a manual session wearing the applier's application_name and a forged
    marker is refused the same way;
  * the incident file itself, sent statement by statement the way the
    incident's client sent it, is refused statement by statement before any
    lock and changes nothing;
  * dynamic DDL whose text does not spell the table is refused by the
    ddl_command_end backstop;
  * manual DDL on a table that is not live, and CREATE INDEX CONCURRENTLY on a
    live table, still work;
  * the applier's bound transaction installs (ALTER TABLE on a live table,
    ADD COLUMN IF NOT EXISTS of a new column) and records its history;
  * a re-run of the applied version is refused before its body runs;
  * a claim whose transaction does not record its history cannot commit;
  * ADD COLUMN IF NOT EXISTS of an existing column is refused before the lock,
    for the applier and for a manual session.

Prints "PASS  every manual-DDL guard assertion held" and writes evidence JSON.
"""
from pathlib import Path
import argparse, json, os, re, shutil, socket, subprocess, sys, tempfile, time

R = Path(__file__).resolve().parents[2]
MIGRATION = R / 'supabase/migrations/20261119053515_a_manual_session_never_locks_the_live_tables.sql'
INCIDENT_FILE = R / 'supabase/migrations/20260308_tournament_bounties_and_columns.sql'
APPLIER = R / 'scripts/ci/apply-recorded-migration.mjs'
BINDER = R / 'scripts/ci/migration-session-identity.mjs'

FIXTURE = r"""
CREATE ROLE postgres LOGIN;
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA smarter_private;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
GRANT USAGE ON SCHEMA supabase_migrations, smarter_private TO postgres;
GRANT ALL ON supabase_migrations.schema_migrations TO postgres;
GRANT ALL ON SCHEMA public TO postgres;
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261001000000', 'an_earlier_migration', ARRAY['SELECT 1;']);
SET ROLE postgres;
CREATE TABLE public.tournaments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_pko boolean DEFAULT false,
  is_mystery_bounty boolean, bounty_amount numeric, mystery_bounty_min integer, mystery_bounty_max integer,
  spin_multiplier numeric, is_premium_spin boolean, addon_cost numeric, addon_chips integer, prize_pool_finalized boolean);
CREATE TABLE public.tournament_players (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, user_id uuid,
  status text, chips numeric, current_bounty numeric, bounties_collected integer, bounty_winnings numeric, mystery_bounty_value numeric);
CREATE TABLE public.tables (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.hand_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid, created_at timestamptz);
CREATE TABLE public.clubs (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
INSERT INTO public.tournaments DEFAULT VALUES;
RESET ROLE;
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pg-bin', type=Path, default=Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/16/bin')))
    ap.add_argument('--out', type=Path, default=R / 'artifacts/manual-ddl-guard/evidence.json')
    a = ap.parse_args()
    pg = a.pg_bin
    if not (pg / 'initdb').exists():
        sys.exit(f'FAIL  no PostgreSQL at {pg}')
    root = os.geteuid() == 0
    as_server = ['runuser', '-u', 'postgres', '--'] if root else []
    work = Path(tempfile.mkdtemp(prefix='manual-ddl-guard-'))
    if root:
        shutil.chown(work, 'postgres', 'postgres')
    data = work / 'data'
    s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    env.update(PGHOST='127.0.0.1', PGPORT=str(port), PGDATABASE='postgres', PGSSLMODE='disable')
    cases = {}

    def run(cmd, **kw):
        return subprocess.run([str(c) for c in cmd], text=True, capture_output=True, env=env, timeout=120, **kw)

    def psql(sql, user='postgres', app='Supavisor', stop=True):
        f = work / f'q{len(cases)}-{time.monotonic_ns()}.sql'
        f.write_text(sql)
        if root:
            shutil.chown(f, 'postgres', 'postgres')
        e = dict(env, PGUSER=user, PGAPPNAME=app)
        t0 = time.monotonic()
        x = subprocess.run([str(pg / 'psql'), '-XAtq', '-v', f'ON_ERROR_STOP={1 if stop else 0}', '-f', str(f)],
                           text=True, capture_output=True, env=e, timeout=120)
        return x.returncode, x.stdout.strip(), x.stderr.strip(), time.monotonic() - t0

    def su(sql):
        code, out, err, _ = psql(sql, user='supabase_admin', app='fixture')
        assert code == 0, err
        return out

    def check(name, ok, detail):
        cases[name] = {'ok': bool(ok), 'detail': detail}
        print(('ok    ' if ok else 'FAIL  ') + name + ('' if ok else f'  {detail}'))

    def refused(name, sql, needle, app='Supavisor', fast=True):
        code, out, err, secs = psql(sql, app=app)
        ok = code != 0 and needle in err and (not fast or secs < 3)
        check(name, ok, {'exit': code, 'seconds': round(secs, 3), 'error': err[-600:]})
        return err

    def allowed(name, sql, app='Supavisor'):
        code, out, err, secs = psql(sql, app=app)
        check(name, code == 0, {'exit': code, 'seconds': round(secs, 3), 'error': err[-600:]})

    def column(table, col):
        return su(f"SELECT count(*) FROM pg_attribute WHERE attrelid='public.{table}'::regclass AND attname='{col}' AND NOT attisdropped") == '1'

    class Holder:
        """A live reader: ACCESS SHARE on tournaments, idle in its transaction."""
        def __enter__(self):
            e = dict(env, PGUSER='postgres', PGAPPNAME='live-reader')
            self.p = subprocess.Popen([str(pg / 'psql'), '-XAtq'], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, text=True, env=e)
            self.p.stdin.write('BEGIN; SELECT count(*) FROM public.tournaments;\n'); self.p.stdin.flush()
            for _ in range(100):
                if su("SELECT count(*) FROM pg_stat_activity WHERE application_name='live-reader' AND state='idle in transaction'") == '1':
                    return self
                time.sleep(0.1)
            raise AssertionError('the live reader never held its lock')

        def __exit__(self, *exc):
            self.p.stdin.write('ROLLBACK;\n\\q\n'); self.p.stdin.flush(); self.p.wait(10)

    def applier_tx(version, slug, source):
        """The applier's owning transaction: its history template, then the real binder."""
        template = re.search(r'const historyStatement = `([\s\S]*?)`;', APPLIER.read_text()).group(1)
        tag = '$ca_file_history_' + version + '$'
        history = template.replace('${version}', version).replace('${slug}', slug).replace('${exactSQLLiteral}', tag + source + tag)
        atomic = re.sub(r'COMMIT\s*;\s*$', lambda m: history + '\nCOMMIT;', source)
        assert atomic != source
        js = ("import {bindMigrationSession} from " + json.dumps(BINDER.as_uri()) +
              "; import fs from 'node:fs'; process.stdout.write(bindMigrationSession(fs.readFileSync(0, 'utf8'), 12000));")
        x = subprocess.run(['node', '--input-type=module', '-e', js], input=atomic, text=True, capture_output=True, timeout=60)
        assert x.returncode == 0, x.stderr
        bound = x.stdout
        assert 'fn_ca_migration_applier_claim' in bound
        # PostgreSQL 16 has no transaction_timeout; the binder's budget line is a PG17 setting.
        if int(su('SHOW server_version_num')) < 170000:
            bound = bound.replace("SET LOCAL transaction_timeout = '12000ms';", '')
        return bound

    try:
        x = run(as_server + [pg / 'initdb', '-D', data, '-U', 'supabase_admin', '-A', 'trust', '--no-locale', '-E', 'UTF8'])
        assert x.returncode == 0, x.stderr
        with open(data / 'postgresql.conf', 'a') as conf:
            conf.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nunix_socket_directories=''\nshared_buffers='16MB'\n")
        x = run(as_server + [pg / 'pg_ctl', '-D', data, '-l', work / 'server.log', '-w', 'start'])
        assert x.returncode == 0, x.stderr + x.stdout
        version = su('SHOW server_version')
        su(FIXTURE)
        su(MIGRATION.read_text())
        check('install the guard migration exactly as written',
              su("SELECT count(*) FROM pg_event_trigger WHERE evtname LIKE 'ca_live_tables_refuse_manual_ddl%' AND evtenabled='O'") == '2',
              'two enabled event triggers')

        # 1. A manual session is refused, before its lock.
        with Holder():
            refused('manual ALTER TABLE on a live table is refused before its lock (reader holds ACCESS SHARE, lock_timeout 30s)',
                    "SET lock_timeout='30s';\nALTER TABLE public.tournaments ADD COLUMN manual_added integer;",
                    'live-table DDL refused: ALTER TABLE names public.tournaments')
            refused('the applier application_name and a forged marker do not make a session the applier',
                    "SET lock_timeout='30s';\nBEGIN;\nSET LOCAL ca.migration_applier_claim = '00000000-0000-4000-8000-000000000000';\n"
                    "ALTER TABLE tables ADD COLUMN forged integer;\nCOMMIT;",
                    'live-table DDL refused: ALTER TABLE names public.tables', app='apply-recorded-migration')
            # The incident, replayed: the file statement by statement in autocommit, carrying on past errors.
            code, out, err, secs = psql("SET lock_timeout='30s';\n" + INCIDENT_FILE.read_text(), stop=False)
            alters = len(re.findall(r'(?im)^\s*ALTER TABLE (tournaments|tournament_players) ADD COLUMN', INCIDENT_FILE.read_text()))
            refusals = err.count('live-table DDL refused') + err.count('no-op live-table DDL refused before its lock')
            check('the incident file re-run statement by statement is refused at every live-table statement, before any lock',
                  refusals >= alters and secs < 10 and su("SELECT to_regclass('public.tournament_bounties') IS NULL") == 't',
                  {'seconds': round(secs, 3), 'live_table_alters_in_file': alters, 'refusals': refusals,
                   'first_errors': err.splitlines()[:6]})
        check('nothing the refused manual sessions sent was applied',
              not column('tournaments', 'manual_added') and not column('tables', 'forged')
              and su("SELECT count(*) FROM pg_indexes WHERE indexname IN ('idx_hand_history_table_created','idx_tournament_players_status')") == '0',
              'no column, no index')

        refused('dynamic DDL that does not spell the table is refused by the ddl_command_end backstop',
                "DO $d$ BEGIN EXECUTE 'ALTER TABLE public.' || 'tourn' || 'aments ADD COLUMN dynamic_added integer'; END $d$;",
                'left this session holding AccessExclusiveLock on public.tournaments', fast=False)
        check('the backstop rolled the dynamic DDL back', not column('tournaments', 'dynamic_added'), 'no column')

        allowed('manual DDL on a table that is not live still works',
                'CREATE TABLE public.scratch_notes (id integer);\nALTER TABLE public.scratch_notes ADD COLUMN note text;')
        allowed('CREATE INDEX CONCURRENTLY on a live table never blocks writers and still works',
                'CREATE INDEX CONCURRENTLY tournaments_is_pko_idx ON public.tournaments (is_pko);')

        # 2. The applier's session is allowed.
        v1, s1 = '20991231000100', 'a_fixture_adds_tournament_columns'
        src1 = ("-- Fixture: the applier adds columns to a live table.\nBEGIN;\nSET LOCAL lock_timeout = '3s';\n"
                "ALTER TABLE public.tournaments ADD COLUMN applier_added integer;\n"
                "ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS applier_if_absent integer;\n"
                "CREATE INDEX tournaments_applier_added_idx ON public.tournaments (applier_added);\nCOMMIT;\n")
        tx1 = applier_tx(v1, s1, src1)
        allowed('the applier\'s bound transaction installs DDL on a live table (through the pooler\'s rewritten application_name)', tx1)
        check('the applier\'s install changed the live table and recorded its exact history and claim',
              column('tournaments', 'applier_added') and column('tournaments', 'applier_if_absent')
              and su(f"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='{v1}' AND name='{s1}' AND statements=ARRAY[$h${src1}$h$]") == '1'
              and su(f"SELECT count(*) FROM smarter_private.ca_migration_applier_claims WHERE version='{v1}' AND md5($h${src1}$h$)=source_md5") == '1',
              'columns, history and claim')

        # 3. A re-run of an applied version is refused.
        refused('a re-run of an applied version is refused before its body runs', tx1, 'migration_already_applied: 20991231000100_a_fixture_adds_tournament_columns is already recorded')
        refused('a migration whose name is already recorded under another version is refused too',
                applier_tx('20991231000101', 'an_earlier_migration', 'BEGIN;\nSELECT 1;\nCOMMIT;\n'),
                'migration_already_applied')

        # A claim cannot commit without its history.
        refused('a claim whose transaction does not record the claimed history cannot commit',
                "BEGIN;\nSELECT smarter_private.fn_ca_migration_applier_claim('20991231000102', 'unrecorded', md5('x'));\n"
                "ALTER TABLE public.tournaments ADD COLUMN unrecorded_added integer;\nCOMMIT;",
                'migration_applier_claim_unrecorded', fast=False)
        check('the unrecorded claim rolled its DDL back', not column('tournaments', 'unrecorded_added'), 'no column')

        # 4. A no-op IF NOT EXISTS is refused without taking the lock, for the applier too.
        src4 = ("BEGIN;\nSET LOCAL lock_timeout = '30s';\n"
                "ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS is_pko boolean DEFAULT false;\nCOMMIT;\n")
        with Holder():
            refused('the applier\'s ADD COLUMN IF NOT EXISTS of an existing column is refused before its lock (lock_timeout 30s)',
                    applier_tx('20991231000103', 'a_fixture_redeclares_a_column', src4),
                    'no-op live-table DDL refused before its lock: ADD COLUMN IF NOT EXISTS names existing column public.tournaments.is_pko')
            refused('a manual ADD COLUMN IF NOT EXISTS of an existing column is refused before its lock',
                    "SET lock_timeout='30s';\nALTER TABLE tournaments ADD COLUMN IF NOT EXISTS is_pko BOOLEAN DEFAULT FALSE;",
                    'no-op live-table DDL refused before its lock')
            waits = su("SELECT count(*) FROM pg_locks WHERE NOT granted")
        check('no lock request was ever queued behind the live reader', waits == '0', {'ungranted_locks': waits})
    finally:
        run(as_server + [pg / 'pg_ctl', '-D', data, '-m', 'immediate', 'stop'])

    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps({'postgres': locals().get('version'), 'cases': cases}, indent=2) + '\n')
    failed = [k for k, v in cases.items() if not v['ok']]
    if failed or not cases:
        print(f'FAIL  {len(failed)} of {len(cases)} assertions failed')
        sys.exit(1)
    print('PASS  every manual-DDL guard assertion held')


if __name__ == '__main__':
    main()
