#!/usr/bin/env python3
"""Isolated PostgreSQL 17 regression: bulk closure stays out of live play.

Installs the EXACT production bodies (pg_get_functiondef captured 2026-11-05,
md5 pinned in scripts/ci/fixtures/bulk-closure-guard/preimages.json) of the
five operator bulk closure doors and fn_entry_purchases_frozen, with the tables
they declare, then applies the unmodified migration
20261105181406_bulk_closure_stays_out_of_live_play.sql and proves, per door:

  * inside :53-:07 UTC, during an announced break, within 180 s of a thaw, for a
    large (>50 player rows) event outside 04:00-06:00 Chicago, for an unbounded
    caller, and inside the 5 s cooldown, the door raises 55P03 bulk_closure_*
    BEFORE its first lane statement, and writes nothing;
  * when admitted, the door reaches its original next statement (the lane
    helper is replaced by a sentinel that raises 'reached_original_body'), and
    every later lock wait in the transaction is bounded to 100 ms;
  * a held row then refuses in about 100 ms instead of queueing.

The migration's own preimage guard must accept the captured bodies and refuse
one drifted byte. An empty throwaway cluster on a Unix socket; no network, no
production connection.
"""
import argparse, json, os, pathlib, shutil, subprocess, tempfile, time, hashlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261105181406_bulk_closure_stays_out_of_live_play.sql'
FIX = ROOT / 'scripts/ci/fixtures/bulk-closure-guard'
ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('--output', type=pathlib.Path, default=ROOT / 'artifacts/bulk-closure-stays-out-of-live-play')
out = ap.parse_args().output.resolve(); out.mkdir(parents=True, exist_ok=True)
pg = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}; env['LC_ALL'] = 'C'
as_owner = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
cluster = pathlib.Path(tempfile.mkdtemp(prefix='bulk-closure-guard-')); sock = cluster / 's'; sock.mkdir(mode=0o700)
if as_owner:
    shutil.chown(cluster, 'postgres'); shutil.chown(sock, 'postgres')
PORT = '55851'
psql = [str(pg / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', str(sock), '-p', PORT, '-U', 'postgres', '-d', 'postgres']
results = {'checks': [], 'production_mutations': False}

def run(args, stdin=None, ok=True):
    r = subprocess.run([str(a) for a in args], input=stdin, text=True, capture_output=True, env=env)
    if ok and r.returncode:
        raise RuntimeError(f'{args[0]} failed ({r.returncode}): {r.stderr}')
    return r

def sql(text, ok=True):
    return run(psql, text, ok)

def check(name, cond, detail=None):
    results['checks'].append({'name': name, 'ok': bool(cond), 'detail': detail})
    if not cond:
        raise AssertionError(f'{name}: {detail}')

SCHEMA = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA smarter_private;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
CREATE TABLE public.tournaments(id uuid PRIMARY KEY, status text, started_at timestamptz);
CREATE TABLE public.tournament_players(id bigserial PRIMARY KEY, tournament_id uuid, user_id uuid);
CREATE TABLE public.ca_operator_tournament_operations(op_id uuid PRIMARY KEY);
CREATE TABLE smarter_private.tournament_abort_targets(operation_id uuid, tournament_id uuid PRIMARY KEY);
CREATE TABLE smarter_private.tournament_abort_operations(operation_id uuid PRIMARY KEY);
CREATE TABLE public.engine_maintenance_break(id boolean PRIMARY KEY, phase text NOT NULL, announced_at timestamptz NOT NULL,
 break_started_at timestamptz, break_ends_at timestamptz, reason text NOT NULL DEFAULT 'x', declared_by text,
 updated_at timestamptz NOT NULL DEFAULT now(), enforce_freeze boolean NOT NULL DEFAULT true, ownership_token uuid NOT NULL DEFAULT gen_random_uuid());
CREATE TABLE public.engine_maintenance_thaws(freeze_started_at timestamptz PRIMARY KEY, thawed_at timestamptz NOT NULL,
 frozen_seconds numeric NOT NULL DEFAULT 0, shifted jsonb NOT NULL DEFAULT '{}', thawed_by text, announced_at timestamptz,
 ownership_token uuid, contract_version integer, release_target_at timestamptz, release_generation integer NOT NULL DEFAULT 0);
CREATE TABLE smarter_private.daily_window_policy(singleton boolean PRIMARY KEY DEFAULT true, time_zone text NOT NULL DEFAULT 'America/Chicago',
 window_start time NOT NULL DEFAULT '04:00', window_end time NOT NULL DEFAULT '06:00');
INSERT INTO smarter_private.daily_window_policy DEFAULT VALUES;
CREATE TABLE public.reached(door text, at timestamptz DEFAULT clock_timestamp());
-- Sentinels for each door's ORIGINAL next statement after the admission.
CREATE FUNCTION smarter_private.cancellation_lane(p uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'reached_original_body' USING ERRCODE='P0099'; END $$;
CREATE FUNCTION smarter_private.assert_tournament_abort_not_recovered(o uuid, t uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'reached_original_body' USING ERRCODE='P0099'; END $$;
CREATE FUNCTION public.fn_ca_operator_permissions(a uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT '{"permissions":["console.read","clubs.write","money.write","money.read"]}'::jsonb $$;
"""

def install_preimages():
    src = 'SET check_function_bodies=off;\n'
    src += (FIX / 'fn_active_maintenance_release_boundary.sql').read_text() + ';\n'
    for r in json.loads((FIX / 'preimages.json').read_text()):
        assert hashlib.md5(r['definition'].encode()).hexdigest() == r['definition_md5'], r['signature']
        src += r['definition'] + ';\n'
        sig = r['signature'] if '.' in r['signature'].split('(')[0] else 'public.' + r['signature']
        src += f'REVOKE ALL ON FUNCTION {sig} FROM PUBLIC;\n'
        for grant in r['acl'].strip('{}').split(','):
            role = grant.split('=')[0]
            if role and role != 'postgres':
                src += f'GRANT EXECUTE ON FUNCTION {sig} TO {role};\n'
    sql(src)
    for r in json.loads((FIX / 'preimages.json').read_text()):
        sig = r['signature'] if '.' in r['signature'].split('(')[0] else 'public.' + r['signature']
        got = sql(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure));").stdout.strip()
        check(f'preimage reproduces production md5 {sig}', got == r['definition_md5'], got)

T_SMALL = '00000000-0000-4000-8000-0000000000a1'
T_LARGE = '00000000-0000-4000-8000-0000000000a2'
OP = '00000000-0000-4000-8000-0000000000b1'
DOORS = {
    'settle_refund': f"public.fn_ca_settle_tournament_abort('{OP}','{{T}}','h')",
    'settle_equal_share': f"public.fn_ca_settle_tournament_abort_equal_share('{OP}','{{T}}','h')",
    'owner_retire': f"public.fn_ca_owner_retire_tournament('{OP}','{{T}}','h')",
    'operator_cancel': f"public.fn_ca_operator_cancel_tournament('{{T}}','{OP}','operator closure reason','{OP}','req-1')",
    'request_abort': f"public.fn_ca_request_tournament_abort('{OP}',ARRAY['{{T}}'::uuid],'operator closure reason')",
}

def call(door, at, t=T_SMALL, timeout='5s', setup=''):
    # The clock is replaced in this disposable cluster only; the cooldown table
    # is cleared so each probe is judged on its own clock unless stated.
    text = f"""BEGIN; SET LOCAL statement_timeout='{timeout}';
SELECT set_config('request.jwt.claim.role','service_role',true);
CREATE OR REPLACE FUNCTION smarter_private.bulk_closure_clock() RETURNS timestamptz LANGUAGE sql VOLATILE SET search_path TO 'pg_catalog' AS $c$ SELECT '{at}'::timestamptz $c$;
{setup}
SELECT {DOORS[door].replace('{T}', t)};
COMMIT;"""
    r = sql(text, ok=False)
    return r.stderr

def reset():
    sql('TRUNCATE smarter_private.bulk_closure_admissions, public.engine_maintenance_break, public.engine_maintenance_thaws;')

try:
    run(as_owner + [pg / 'initdb', '-D', cluster / 'data', '-U', 'postgres', '-A', 'trust'])
    run(as_owner + [pg / 'pg_ctl', '-D', cluster / 'data', '-w', '-o', f"-k {sock} -p {PORT} -c listen_addresses=''", '-l', cluster / 'log', 'start'])
    sql(SCHEMA)
    install_preimages()
    sql(f"INSERT INTO public.tournament_players(tournament_id,user_id) SELECT '{T_SMALL}',gen_random_uuid() FROM generate_series(1,50);"
        f"INSERT INTO public.tournament_players(tournament_id,user_id) SELECT '{T_LARGE}',gen_random_uuid() FROM generate_series(1,243);")

    # The preimage guard refuses one drifted byte and leaves nothing behind.
    drift = MIGRATION.read_text().replace('41bd8459f2927155ad9613d9f0a52dbb', '41bd8459f2927155ad9613d9f0a52dbc')
    r = sql(drift, ok=False)
    check('a drifted preimage is refused', 'BULK_CLOSURE_PREIMAGE_DRIFT' in r.stderr, r.stderr[-300:])
    check('the refused install left nothing', sql("SELECT to_regclass('smarter_private.bulk_closure_admissions') IS NULL;").stdout.strip() == 't')

    t0 = time.monotonic(); sql(MIGRATION.read_text()); results['migration_install_seconds'] = time.monotonic() - t0
    proof = next(l.removeprefix('-- @live-proof: ') for l in MIGRATION.read_text().splitlines() if l.startswith('-- @live-proof: '))
    check('the @live-proof holds after install', sql('SELECT ' + proof + ';').stdout.strip() == 't')

    # 10:20 UTC (04:20 Chicago, quiet) and 17:20 UTC (11:20 Chicago, live).
    QUIET, LIVE = '2026-11-05T10:20:00Z', '2026-11-05T17:20:00Z'
    for door in DOORS:
        for minute in ['53', '55', '58', '00', '04', '07']:
            reset()
            e = call(door, f'2026-11-05T17:{minute}:30Z')
            check(f'{door} refused at :{minute}', 'bulk_closure_break_window' in e and 'reached_original_body' not in e, e[-200:])
        reset(); e = call(door, '2026-11-05T17:08:00Z')
        check(f'{door} admitted at :08 reaches its original body', 'reached_original_body' in e, e[-200:])
        reset(); sql("INSERT INTO public.engine_maintenance_break(id,phase,announced_at) VALUES(true,'last_hand',clock_timestamp());")
        e = call(door, LIVE)
        check(f'{door} refused while a break is announced', 'bulk_closure_maintenance_active' in e, e[-200:])
        reset(); sql("INSERT INTO public.engine_maintenance_thaws(freeze_started_at,thawed_at) VALUES('2026-11-05T17:13:00Z','2026-11-05T17:18:30Z');")
        e = call(door, LIVE)
        check(f'{door} refused within 180 s of a thaw', 'bulk_closure_resume_settling' in e, e[-200:])
        reset(); e = call(door, LIVE, t=T_LARGE)
        check(f'{door} refuses a 243-account event in live hours', 'bulk_closure_large_outside_quiet_hours' in e, e[-200:])
        reset(); e = call(door, QUIET, t=T_LARGE)
        check(f'{door} admits a 243-account event in the quiet window', 'reached_original_body' in e, e[-200:])
        reset(); e = call(door, LIVE, t=T_SMALL)
        check(f'{door} admits a 50-account event in live hours', 'reached_original_body' in e, e[-200:])
        if door != 'operator_cancel':
            for to in ['0', '20s']:
                reset(); e = call(door, LIVE, timeout=to)
                check(f'{door} refuses an unbounded caller (statement_timeout {to})', 'bulk_closure_unbounded_caller' in e, e[-200:])
        check(f'{door} refusals wrote no admission', sql('SELECT count(*) FROM smarter_private.bulk_closure_admissions;').stdout.strip() == '0')

    # Cooldown: an admitted settlement commits; the next within 5 s refuses.
    reset()
    sql(f"""BEGIN; SET LOCAL statement_timeout='5s';
CREATE OR REPLACE FUNCTION smarter_private.bulk_closure_clock() RETURNS timestamptz LANGUAGE sql VOLATILE SET search_path TO 'pg_catalog' AS $c$ SELECT '{LIVE}'::timestamptz $c$;
SELECT smarter_private.bulk_closure_admission('settle_refund',ARRAY['{T_SMALL}'::uuid]);
SELECT current_setting('lock_timeout');
COMMIT;""")
    for door in ['settle_refund', 'settle_equal_share', 'owner_retire', 'operator_cancel']:
        e = call(door, '2026-11-05T17:20:04Z')
        check(f'{door} refused inside the 5 s cooldown', 'bulk_closure_cooldown' in e, e[-200:])
        e = call(door, '2026-11-05T17:20:06Z')
        check(f'{door} admitted after the cooldown', 'reached_original_body' in e, e[-200:])
    e = call('request_abort', '2026-11-05T17:20:04Z')
    check('a stop request is not a settlement and has no cooldown', 'reached_original_body' in e, e[-200:])

    # Admission bounds every later lock wait in the transaction to 100 ms.
    reset()
    lt = sql(f"""BEGIN; SET LOCAL statement_timeout='5s';
CREATE OR REPLACE FUNCTION smarter_private.bulk_closure_clock() RETURNS timestamptz LANGUAGE sql VOLATILE SET search_path TO 'pg_catalog' AS $c$ SELECT '{LIVE}'::timestamptz $c$;
SELECT smarter_private.bulk_closure_admission('owner_retire',ARRAY['{T_SMALL}'::uuid]);
SELECT current_setting('lock_timeout'); ROLLBACK;""").stdout.strip().splitlines()[-1]
    check('admission sets lock_timeout 100ms', lt == '100ms', lt)
    sql(f"INSERT INTO public.tournaments(id,status) VALUES('{T_SMALL}','RUNNING');")
    holder = subprocess.Popen([str(a) for a in psql], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
    holder.stdin.write(f"BEGIN; SELECT 1 FROM public.tournaments WHERE id='{T_SMALL}' FOR UPDATE; SELECT pg_sleep(3); COMMIT;\n"); holder.stdin.flush()
    time.sleep(0.5)
    t0 = time.monotonic()
    r = sql(f"""BEGIN; SET LOCAL statement_timeout='5s';
CREATE OR REPLACE FUNCTION smarter_private.bulk_closure_clock() RETURNS timestamptz LANGUAGE sql VOLATILE SET search_path TO 'pg_catalog' AS $c$ SELECT '{LIVE}'::timestamptz $c$;
SELECT smarter_private.bulk_closure_admission('owner_retire',ARRAY['{T_SMALL}'::uuid]);
SELECT 1 FROM public.tournaments WHERE id='{T_SMALL}' FOR UPDATE; COMMIT;""", ok=False)
    waited = time.monotonic() - t0
    holder.communicate(timeout=10)
    check('an admitted closure meeting a held row refuses fast instead of queueing',
          'lock timeout' in r.stderr and waited < 1.5, {'stderr': r.stderr[-200:], 'seconds': waited})
    check('the refused closure rolled its admission back', sql('SELECT count(*) FROM smarter_private.bulk_closure_admissions;').stdout.strip() == '0')

    # Private: the service role cannot call the admission or read its log directly.
    r = sql("SET ROLE service_role; SELECT smarter_private.bulk_closure_admission('owner_retire',NULL);", ok=False)
    check('service_role cannot call the admission directly', 'permission denied' in r.stderr, r.stderr[-200:])
    results['ok'] = True
finally:
    run(as_owner + [pg / 'pg_ctl', '-D', cluster / 'data', '-m', 'immediate', 'stop'], ok=False)
    (out / 'RESULTS.json').write_text(json.dumps(results, indent=1))
    shutil.rmtree(cluster, ignore_errors=True)
print(json.dumps({'ok': results.get('ok', False), 'checks': len(results['checks'])}))
