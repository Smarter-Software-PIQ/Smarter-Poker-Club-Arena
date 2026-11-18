#!/usr/bin/env python3
"""Exact terms revision and existing profile RLS/ACL, socket-only PostgreSQL 17.
Typed minimal profile/own-row policies are fixture inputs, never production.
Uses the maintained profile-account native runner's start/query/stop pattern.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT/'supabase/migrations/20261116195541_club_arena_terms_acceptance_records_the_exact_reviewed_revis.sql'
REVISION = '2026-11-16-87a8e57589a09136'
A = 'aaaaaaaa-1111-2222-3333-444444444444'
B = 'bbbbbbbb-1111-2222-3333-444444444444'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--pg-bin', default=os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
parser.add_argument('--scratch', default=os.environ.get('RUNNER_TEMP', tempfile.gettempdir()))
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
if os.uname().sysname == 'Darwin' and not str(Path(args.scratch).resolve()).startswith('/Volumes/'):
    raise SystemExit('external scratch required')
args.output.mkdir(parents=True, exist_ok=False)
pg = Path(args.pg_bin).resolve()
env = {'PATH': str(pg)+':/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C', 'PGCONNECT_TIMEOUT': '5'}
cluster = Path(tempfile.mkdtemp(prefix='ca-terms-', dir=args.scratch))
data, socket = cluster/'data', cluster/'s'
socket.mkdir(mode=0o700)
started = False
results = []
completed = False

def run(argv, sql=None, check=True):
    result = subprocess.run([str(v) for v in argv], input=sql, text=True, capture_output=True, env=env, timeout=60)
    if check and result.returncode:
        raise RuntimeError(result.stderr+result.stdout)
    return result

def query(sql, check=True):
    return run([pg/'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At', '-h', socket, '-U', 'postgres', '-d', 'postgres'], sql, check)

def one(sql):
    return query(sql).stdout.strip()

def check(label, actual, expected):
    passed = actual == expected
    results.append({'check': label, 'ok': passed, 'actual': actual, 'expected': expected})
    print(('PASS ' if passed else 'FAIL ')+label, flush=True)
    if not passed:
        raise AssertionError((label, actual, expected))

def rpc(user=A, revision=REVISION, role='service_role'):
    uid = 'NULL' if user is None else "'"+user+"'::uuid"
    rev = 'NULL' if revision is None else "'"+revision+"'"
    return f"SET ROLE {role}; SET request.jwt.claim.role='{role}'; SELECT public.fn_ca_accept_terms_revision({uid},{rev});"

try:
    check('PostgreSQL 17 is the actual server', ' 17.' in run([pg/'postgres', '--version']).stdout, True)
    run([pg/'initdb', '-D', data, '-U', 'postgres', '--auth-local=trust', '--auth-host=reject', '--no-locale', '--encoding=UTF8'])
    with (data/'postgresql.conf').open('a') as f:
        f.write("\nlisten_addresses=''\nunix_socket_directories='"+str(socket)+"'\nautovacuum=off\n")
    started = True
    run([pg/'pg_ctl', '-D', data, '-l', cluster/'server.log', '-w', 'start'])
    check('native endpoint has no network listener', one("SELECT inet_server_addr() IS NULL AND current_setting('listen_addresses')=''"), 't')
    query(f"""CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,club_arena_tos_accepted_at timestamptz,display_name text);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_own_profile_read ON public.profiles FOR SELECT TO authenticated USING(id=auth.uid());
GRANT SELECT(id,club_arena_tos_accepted_at,display_name) ON public.profiles TO authenticated;
INSERT INTO public.profiles VALUES('{A}','2026-11-16T19:00:00Z','First'),('{B}','2026-11-07T12:00:00Z','Second');""")
    before = one("SELECT md5(pg_get_expr(polqual,polrelid)) FROM pg_policy WHERE polrelid='public.profiles'::regclass")
    other = one(f"SELECT to_jsonb(p) FROM public.profiles p WHERE id='{B}'")
    source = MIGRATION.read_text()
    query(source)
    (args.output/'INPUTS.json').write_text(json.dumps({'migration_sha256':hashlib.sha256(source.encode()).hexdigest(),'harness_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}, indent=2)+'\n')
    proof = next(line.split('-- @live-proof: ',1)[1] for line in source.splitlines() if line.startswith('-- @live-proof: '))
    check('declared installed contract and private RPC privileges hold', one('SELECT '+proof), 't')
    check('legacy acceptance is not silently promoted', one(f"SELECT club_arena_tos_revision IS NULL FROM public.profiles WHERE id='{A}'"), 't')
    first = json.loads(one(rpc()))
    check('original service writer echoes exact persisted revision', first['termsRevision'], REVISION)
    check('legacy timestamp is renewed atomically with revision', one(f"SELECT club_arena_tos_revision='{REVISION}' AND isfinite(club_arena_tos_accepted_at) AND club_arena_tos_accepted_at<>'2026-11-16T19:00:00Z' FROM public.profiles WHERE id='{A}'"), 't')
    check('confirmed duplicate retains original acceptance timestamp', json.loads(one(rpc())), first)
    # A typed legacy opening forces both concurrent callers through the
    # first acceptance transition, not merely two reads of an existing receipt.
    query(f"UPDATE public.profiles SET club_arena_tos_revision=NULL,club_arena_tos_accepted_at='2026-11-16T19:00:00Z' WHERE id='{A}'")
    with ThreadPoolExecutor(max_workers=2) as workers:
        replies = list(workers.map(lambda _: json.loads(one(rpc())), range(2)))
    check('concurrent first acceptance returns one locked original receipt', replies[0] == replies[1] and replies[0]['termsRevision'] == REVISION, True)
    first = replies[0]
    for label, sql, code in [
        ('wrong revision',rpc(revision='old-terms'),'22023'),
        ('null revision',rpc(revision=None),'22023'),
        ('null user',rpc(user=None),'22023'),
        ('missing profile',rpc(user='cccccccc-1111-2222-3333-444444444444'),'P0002'),
        ('authenticated browser',rpc(role='authenticated'),'42501'),
        ('anonymous browser',rpc(role='anon'),'42501'),
        ('browser revision forgery',"SET ROLE authenticated; SET request.jwt.claim.sub='"+A+"'; UPDATE public.profiles SET club_arena_tos_revision='forged' WHERE id='"+A+"';",'42501'),
        ('service grant with wrong request role',"SET ROLE service_role; SET request.jwt.claim.role='authenticated'; SELECT fn_ca_accept_terms_revision('"+A+"','"+REVISION+"');",'42501')]:
        result = query(sql, check=False)
        check(label+' refuses with its original SQLSTATE', result.returncode != 0 and code in result.stderr, True)
    check('refusals cannot alter the recorded acceptance', json.loads(one(rpc())), first)
    check('own profile remains readable through unchanged RLS', one(f"SET ROLE authenticated; SET request.jwt.claim.sub='{A}'; SELECT club_arena_tos_revision FROM public.profiles"), REVISION)
    check('browser has no acceptance revision update privilege', one("SELECT has_column_privilege('authenticated','public.profiles','club_arena_tos_revision','UPDATE')"), 'f')
    check('profile policy and enabled RLS are preserved', one("SELECT relrowsecurity AND (SELECT md5(pg_get_expr(polqual,polrelid)) FROM pg_policy WHERE polrelid='public.profiles'::regclass)='"+before+"' FROM pg_class WHERE oid='public.profiles'::regclass"), 't')
    # Compare only original columns; the nullable new column is intentional.
    check('another profile is untouched', one(f"SELECT to_jsonb(p)-'club_arena_tos_revision' FROM public.profiles p WHERE id='{B}'"), other)
    query(f"UPDATE public.profiles SET club_arena_tos_accepted_at='infinity' WHERE id='{A}'")
    query(rpc())
    check('matching revision with a nonfinite timestamp is renewed safely', one(f"SELECT isfinite(club_arena_tos_accepted_at) FROM public.profiles WHERE id='{A}'"), 't')
    completed = True
finally:
    (args.output/'RESULTS.json').write_text(json.dumps({'status': 'passed' if completed else 'failed', 'production_mutations': False, 'checks': results}, indent=2)+'\n')
    if started and (data/'postmaster.pid').exists():
        run([pg/'pg_ctl', '-D', data, '-m', 'fast', '-w', 'stop'])
    shutil.rmtree(cluster)
