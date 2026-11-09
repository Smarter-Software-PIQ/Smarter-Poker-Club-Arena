#!/usr/bin/env python3
"""The installed-migration set reads the same on every route, on real PostgreSQL.

The Backup export records production's installed set with
server/standby/schema-evidence.py capture (#10113); the refresh-due decision
and the daily selector read it again through psql
(engine-release-installed-migrations.py read_production_psql); the release
host reads it through public.fn_ca_installed_migration_listing() because it
holds only the engine's REST credential. A copy is judged by comparing those
reads, so they must agree exactly. This proof installs the real migration on a
disposable cluster with a schema_migrations table shaped like production's
(a NULL name, non-standard versions) and stub required functions, and asserts:
the three routes give the same rows and the same set digest; a later install
changes the digest and the cutover sees it; browser roles cannot execute the
listing; it is read-only; and the evidence bracket refuses a dump taken while
a migration installed.
"""
import argparse
import getpass
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile

ap = argparse.ArgumentParser()
ap.add_argument('--pg-bin', type=Path, required=True)
ap.add_argument('--scratch', type=Path, required=True)
a = ap.parse_args()
root = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, root / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


im = load('im', 'server/scripts/engine-release-installed-migrations.py')
se = load('se', 'server/standby/schema-evidence.py')
migration = root / 'supabase/migrations/20261108233453_the_release_host_can_read_the_installed_migration_set.sql'

probe = socket.socket(); probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]; probe.close()
base = Path(tempfile.mkdtemp(prefix='installed-listing-', dir=a.scratch)); data = base / 'data'; started = False
url = f'postgresql://{getpass.getuser()}@127.0.0.1:{port}/postgres'
os.environ['PATH'] = f'{a.pg_bin}{os.pathsep}{os.environ["PATH"]}'


def run(args, **kw):
    return subprocess.run([str(x) for x in args], capture_output=True, text=True, check=True, **kw).stdout


def sql(text, user=None):
    r = subprocess.run(['psql', '-h', '127.0.0.1', '-p', str(port), '-U', user or getpass.getuser(),
                        '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
                       input=text, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout


def listing():
    return json.loads(sql('SELECT public.fn_ca_installed_migration_listing();'))


try:
    run([a.pg_bin / 'initdb', '-D', data, '-A', 'trust', '--no-locale', '-E', 'UTF8'])
    run([a.pg_bin / 'pg_ctl', '-D', data, '-l', base / 'pg.log', '-o', f"-k '' -p {port} -h 127.0.0.1", '-w', 'start'])
    started = True
    sql("""CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
           CREATE ROLE browser LOGIN IN ROLE authenticated;
           CREATE SCHEMA supabase_migrations; CREATE SCHEMA smarter_private;
           CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, statements text[], name text,
             created_by text, idempotency_key text UNIQUE, rollback text[]);""")
    stubs = ''
    for signature in se.SIGNATURES:
        name, args = signature.split('(', 1)
        stubs += f"CREATE FUNCTION {name}({args} RETURNS int LANGUAGE sql AS 'select 1';\n"
    sql(stubs)
    rows = [('20260311', 'early'), ('20260819_ca_player_stats_full_rpc', 'odd'), ('manual', None),
            ('20261108193515', 'a_full_ring_feeder_starts_with_the_last_two_to_sit')]
    sql(''.join(f"INSERT INTO supabase_migrations.schema_migrations(version, name) VALUES ('{v}', "
                f"{'NULL' if n is None else repr(n)});\n" for v, n in rows))
    sql(migration.read_text())

    os.environ['DATABASE_URL'] = url
    host = im.rows_of(listing())
    selector = im.read_production_psql(url)['migrations']
    evidence = im.rows_of(se.capture()['migrations'])
    assert host == selector == evidence, (host, selector, evidence)
    assert host['manual'] is None and len(host) == len(rows)
    before = im.digest(host)
    # Granted only to service_role; a browser role is refused.
    try:
        sql('SELECT public.fn_ca_installed_migration_listing();', user='browser')
    except RuntimeError as error:
        assert 'permission denied' in str(error)
    else:
        raise AssertionError('a browser role executed the listing')
    assert sql("SELECT provolatile::text || prosecdef::text FROM pg_proc "
               "WHERE proname='fn_ca_installed_migration_listing'").strip() == 'strue'

    # A later install is a different set, and the cutover comparison sees it.
    sql("INSERT INTO supabase_migrations.schema_migrations(version, name) "
        "VALUES ('20261108210509', 'weekly_rounds_respect_maintenance_admission');")
    later = im.rows_of(listing())
    assert im.digest(later) != before
    assert im.compare(host, later) == {'missing': ['20261108210509'], 'extra': [], 'differs': []}
    fixture = base / 'production.json'
    fixture.write_text(json.dumps(listing()))
    env = {**os.environ, 'ENGINE_INSTALLED_MIGRATIONS_PRODUCTION_FIXTURE': str(fixture)}
    target = subprocess.run(['git', '-C', str(root), 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
    status = subprocess.run(['python3', '-B', str(root / 'server/scripts/engine-release-installed-migrations.py'),
                             'status', '--env-file', '/nonexistent', '--repo', str(root), '--sha', target,
                             '--certified', before], capture_output=True, text=True, env=env)
    assert status.returncode == 1 and 'after certification' in status.stdout, status.stdout

    # The export bracket (#10113): evidence captured before a dump and after a
    # migration installed during it never compares equal.
    first = se.capture()
    sql("INSERT INTO supabase_migrations.schema_migrations(version, name) VALUES ('20261109000001', 'during');")
    try:
        se.compare(first, se.capture())
    except ValueError as error:
        assert 'changed' in str(error)
    else:
        raise AssertionError('evidence taken while a migration installed compared equal')
    print('installed-migration set: schema-evidence capture, the selector read and '
          'fn_ca_installed_migration_listing() agree row for row; a later install refuses the cutover; '
          'a dump taken during an install is refused')
finally:
    if started:
        run([a.pg_bin / 'pg_ctl', '-D', data, '-m', 'immediate', '-w', 'stop'])
    shutil.rmtree(base)
