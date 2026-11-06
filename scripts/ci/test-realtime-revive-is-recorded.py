#!/usr/bin/env python3
"""Private PostgreSQL proof of 20261106102321 (a realtime revive is recorded).

The exact migration runs on native PostgreSQL 17 with Supabase's roles and an
auth.uid() that reads the request's JWT subject, and proves:

  * a signed-in player can insert only their own revive row;
  * anon cannot insert, and no client role can read the rows back;
  * the reason, rejoined/gap pairing and value ranges are enforced;
  * v_realtime_revival_daily reports revives, rejoins, players and gap
    percentiles per day and reason, and only service_role can read it;
  * a second install is refused.
"""
from pathlib import Path
import os, shutil, subprocess, tempfile

ROOT = Path(__file__).resolve().parents[2]
MIG = ROOT / 'supabase/migrations/20261106102321_realtime_revive_is_recorded.sql'
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
work = Path(tempfile.mkdtemp(prefix='rt-revive-', dir=os.environ.get('TMPDIR')))
sock = Path(tempfile.mkdtemp(prefix='s-', dir=os.environ.get('CA_PG_SOCKET_ROOT', os.environ.get('TMPDIR'))))
port = str(38000 + (os.getpid() + 29) % 10000)
started = False
A = 'a0000000-0000-0000-0000-00000000000a'
B = 'b0000000-0000-0000-0000-00000000000b'


def run(args, sql=None, timeout=120):
    r = subprocess.run([str(a) for a in args], input=sql, text=True, capture_output=True, timeout=timeout)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout


def q(sql):
    return run([PG / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', port, '-U', 'postgres', '-d', 'w'], sql)


def as_role(role, sub, sql):
    claim = f"SET LOCAL request.jwt.claim.sub = '{sub}';" if sub else ''
    return q(f"BEGIN; SET LOCAL ROLE {role}; {claim} {sql}; COMMIT;")


def must_fail(sql_or_fn, needle):
    try:
        sql_or_fn() if callable(sql_or_fn) else q(sql_or_fn)
    except RuntimeError as error:
        assert needle in str(error), str(error)
        return
    raise AssertionError('expected a refusal containing %r' % needle)


def row(user, reason='unanswered_heartbeat', rejoined='true', gap='4250', waited='3000'):
    return (f"INSERT INTO public.client_realtime_revivals(user_id,reason,rejoined,gap_ms,waited_ms,route,app_version) "
            f"VALUES('{user}','{reason}',{rejoined},{gap},{waited},'/club/x/table/y','abc123')")


try:
    run([PG / 'initdb', '-D', work / 'data', '-U', 'postgres', '-A', 'trust', '--no-locale'])
    run([PG / 'pg_ctl', '-D', work / 'data', '-l', work / 'postgres.log', '-o', f'-k {sock} -p {port} -h 127.0.0.1', '-w', 'start'])
    started = True
    run([PG / 'psql', '-X', '-qAt', '-h', sock, '-p', port, '-U', 'postgres', '-d', 'postgres'],
        'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE DATABASE w;')
    q(f"""CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 INSERT INTO auth.users VALUES ('{A}'), ('{B}');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
   $$SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
 GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
 GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
 GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;""")
    q(MIG.read_text())
    print('PASS: the exact migration installs', flush=True)

    as_role('authenticated', A, row(A))
    as_role('authenticated', A, row(A, 'not_connected', 'false', 'NULL', 'NULL'))
    as_role('authenticated', B, row(B, gap='12000'))
    assert q('SELECT count(*) FROM public.client_realtime_revivals').strip() == '3'
    print('PASS: a signed-in player inserts their own revive rows', flush=True)

    must_fail(lambda: as_role('authenticated', A, row(B)), 'row-level security')
    must_fail(lambda: as_role('anon', None, row(A)), 'permission denied')
    must_fail(lambda: as_role('authenticated', A, 'SELECT * FROM public.client_realtime_revivals'), 'permission denied')
    must_fail(lambda: as_role('anon', None, 'SELECT * FROM public.client_realtime_revivals'), 'permission denied')
    must_fail(lambda: as_role('authenticated', A, 'SELECT * FROM public.v_realtime_revival_daily'), 'permission denied')
    print('PASS: no one inserts for another player, anon cannot insert, no client role reads', flush=True)

    for bad, needle in [
        (row(A, reason='bogus'), 'check constraint'),
        (row(A, rejoined='true', gap='NULL'), 'check constraint'),
        (row(A, rejoined='false', gap='10'), 'check constraint'),
        (row(A, gap='-1'), 'check constraint'),
        (row(A, waited='700000'), 'check constraint'),
    ]:
        must_fail(lambda bad=bad: as_role('authenticated', A, bad), needle)
    print('PASS: reason, rejoined/gap pairing and ranges are enforced', flush=True)

    got = as_role('service_role', None,
                  "SELECT reason||':'||revives||':'||rejoined||':'||players||':'||coalesce(gap_p50_ms::text,'-')"
                  "||':'||coalesce(gap_p95_ms::text,'-')||':'||coalesce(gap_max_ms::text,'-') "
                  "FROM public.v_realtime_revival_daily ORDER BY reason").split()
    assert got == ['not_connected:1:0:1:-:-:-', 'unanswered_heartbeat:2:2:2:4250:12000:12000'], got
    print('PASS: the daily view reports revives, rejoins, players and gap percentiles', flush=True)

    must_fail(MIG.read_text(), 'already installed')
    print('PASS: a second install is refused', flush=True)
finally:
    if started:
        run([PG / 'pg_ctl', '-D', work / 'data', '-m', 'immediate', '-w', 'stop'])
    shutil.rmtree(work, ignore_errors=True)
    shutil.rmtree(sock, ignore_errors=True)
