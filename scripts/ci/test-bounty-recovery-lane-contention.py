#!/usr/bin/env python3
"""Real PostgreSQL lock contention; disposable local database, no production access."""
import json
import sys
from pathlib import Path
import socket as sockets
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = 'supabase/migrations/20261113063322_bounty_recovery_keeps_admission_pins_and_skips_busy_lanes.sql'
OLD = 'supabase/migrations/20260910174349_the_bounty_sweep_takes_one_tournament_lane_per_call.sql'
A = '10000000-0000-0000-0000-000000000001'
B = '10000000-0000-0000-0000-000000000002'

def definition(path):
    s = (ROOT / path).read_text()
    start = s.index('CREATE OR REPLACE FUNCTION public.fn_sweep_pending_tournament_bounties')
    return s[start:s.index('\n$function$;', start) + len('\n$function$;')]

bindir = Path(subprocess.check_output(['pg_config', '--bindir'], text=True).strip())
# Mac caller must provide TMPDIR on its verified external task volume.
with tempfile.TemporaryDirectory(prefix='bounty-lanes-') as folder:
    folder = Path(folder)
    data = folder / 'db'
    with sockets.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        port = str(reservation.getsockname()[1])
    subprocess.run([str(bindir / 'initdb'), '-D', str(data), '-A', 'trust', '-U', 'postgres', '--no-locale'], check=True, stdout=subprocess.DEVNULL)
    subprocess.run([str(bindir / 'pg_ctl'), '-D', str(data), '-l', str(folder / 'pg.log'), '-o', f"-p {port} -c unix_socket_directories='' -c listen_addresses=127.0.0.1 -c fsync=off", '-w', 'start'], check=True, stdout=subprocess.DEVNULL)
    command = [str(bindir / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', 'postgres']
    holders = []
    def sql(query):
        return subprocess.run(command, input=query, text=True, check=True, capture_output=True).stdout.strip()
    def guarded(source):
        js = "import {readFileSync} from 'node:fs'; import {stalePinGuardSQL} from './scripts/ci/migration-stale-pins.mjs'; const s=readFileSync(0,'utf8'); process.stdout.write(stalePinGuardSQL(process.argv[1],s,s));"
        return subprocess.check_output(['node', '--input-type=module', '-e', js, MIGRATION], input=source, text=True, cwd=ROOT)
    def hold(key, shared=False):
        p = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        holders.append(p)
        keys = key if isinstance(key, list) else [key]
        statements = ''.join(f"SELECT pg_advisory_xact_lock{'_shared' if shared else ''}(hashtextextended('{item}',0));" for item in keys)
        p.stdin.write("BEGIN; " + statements + " SELECT 'ready';\n")
        p.stdin.flush()
        while p.stdout.readline().strip() != 'ready':
            if p.poll() is not None:
                raise RuntimeError(p.stderr.read())
        return p
    def release(p):
        p.communicate('ROLLBACK;\n', timeout=5)
        holders.remove(p)
    def sweep(scope='NULL'):
        return json.loads(sql(f"SET statement_timeout='500ms'; SELECT public.fn_sweep_pending_tournament_bounties({scope},20);"))
    try:
        sql('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.tournaments(id uuid PRIMARY KEY);
CREATE TABLE public.tournament_bounty_obligations(
 id uuid PRIMARY KEY,tournament_id uuid,eliminated_user_id uuid,table_id uuid,hand_id uuid,
 hand_number bigint,settlement_completed_at timestamptz,seat_joined_at timestamptz,
 position integer,prize numeric,bubble_refund numeric,mode text,activation_generation bigint,
 head_amount numeric,knocker_user_id uuid,claimants jsonb,state text,attempt_count integer DEFAULT 0,
 next_attempt_at timestamptz,last_error text,created_at timestamptz,settled_at timestamptz);
-- Only fully evidenced response-loss rows: payment must not execute in this
-- lock-admission fixture. The complete financial harness owns payout coverage.
CREATE FUNCTION public.fn_bounty_obligation_has_complete_marker(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
''')
        for event, offset in ((A, 2), (B, 1)):
            sql(f"INSERT INTO tournaments VALUES('{event}'); INSERT INTO tournament_bounty_obligations(id,tournament_id,eliminated_user_id,hand_number,mode,state,next_attempt_at) VALUES('{event}','{event}','{event}',1,'regular','pending',now()-interval '{offset} seconds');")
        lane = json.loads((ROOT / 'docs/audits/2026-09-10-native-current-settlement-lane.json').read_text())
        sql(lane['definition'] + ';')
        sql(definition(OLD))
        sql("REVOKE ALL ON FUNCTION public.fn_sweep_pending_tournament_bounties(uuid,integer) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.fn_sweep_pending_tournament_bounties(uuid,integer) TO service_role;")
        old_hash = sql("SELECT md5(pg_get_functiondef('public.fn_sweep_pending_tournament_bounties(uuid,integer)'::regprocedure))")
        assert old_hash == '30ca1181317d0f76d7a549ceab37b493', old_hash
        pins = {'functions': [
            {'signature': 'public.fn_sweep_pending_tournament_bounties(uuid,integer)', 'definition_md5': old_hash,
             'owner': 'postgres', 'acl': ['postgres=X/postgres','service_role=X/postgres']},
            {'signature': 'public.unrelated()', 'definition_md5': '11111111111111111111111111111111'}]}
        guard = (Path(sys.argv[1]).read_text() if len(sys.argv)>1 else
            "CREATE OR REPLACE FUNCTION public.fn_ca_guard_mtt_admission_contract() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $guard$ DECLARE v_expected jsonb := $prepared$" + json.dumps(pins,separators=(',',':')) + "$prepared$::jsonb; BEGIN RETURN NEW; END $guard$;")
        sql(guard)
        sql("REVOKE ALL ON FUNCTION public.fn_ca_guard_mtt_admission_contract() FROM PUBLIC,anon,authenticated,service_role;")
        holder = hold('ca:tournament-terminal-settlement:v1:' + A)
        # Establish the exact pre-fix regression with a different backend.
        try:
            sweep()
            raise AssertionError('old sweep unexpectedly bypassed busy oldest lane')
        except subprocess.CalledProcessError as error:
            assert 'statement timeout' in error.stderr, error.stderr
        source = (ROOT / MIGRATION).read_text()
        # Reproduce the real production refusal, using the actual applier's
        # snapshot/check wrapper, before proving atomic pin rotation.
        without_pin = source[:source.index('DO $bounty_admission_pin$')] + 'COMMIT;'
        try:
            sql(guarded(without_pin))
            raise AssertionError('a stale admission pin was accepted')
        except subprocess.CalledProcessError as error:
            assert 'migration_left_a_stale_pin' in error.stderr, error.stderr
        assert sql("SELECT md5(pg_get_functiondef('public.fn_sweep_pending_tournament_bounties(uuid,integer)'::regprocedure))") == old_hash
        before_guard = sql("SELECT pg_get_functiondef('public.fn_ca_guard_mtt_admission_contract()'::regprocedure)")
        # Wrong pins fail before commit and must not leave the sweep replaced.
        sql(guard.replace(old_hash, '22222222222222222222222222222222'))
        try:
            sql(guarded(source))
            raise AssertionError('an unqualified pin preimage was accepted')
        except subprocess.CalledProcessError as error:
            assert 'Bounty admission pin preimage changed' in error.stderr, error.stderr
        assert sql("SELECT md5(pg_get_functiondef('public.fn_sweep_pending_tournament_bounties(uuid,integer)'::regprocedure))") == old_hash
        sql(guard)
        sql(guarded(source))
        new_hash = sql("SELECT md5(pg_get_functiondef('public.fn_sweep_pending_tournament_bounties(uuid,integer)'::regprocedure))")
        after_guard = sql("SELECT pg_get_functiondef('public.fn_ca_guard_mtt_admission_contract()'::regprocedure)")
        assert after_guard == before_guard.replace(old_hash,new_hash)
        assert old_hash not in after_guard
        answer = sweep()
        assert answer['settled'] == 1 and answer['pending'] == 1 and answer['failed'] == 0, answer
        assert answer['settled_tournament_ids'] == [B], answer
        # Explicit scope never consumes another event or acknowledges a busy row.
        answer = sweep("'" + A + "'")
        assert answer['processed'] == 0 and answer['pending'] == 1 and answer['failed'] == 0, answer
        assert sql(f"SELECT state||':'||attempt_count FROM tournament_bounty_obligations WHERE id='{A}'") == 'pending:0'
        release(holder)
        # Terminal authority G-exclusive blocks every rolling admission without
        # forcing the RPC to wait or erasing the original obligation.
        holder = hold('ca:tournament-terminal-settlement:v1')
        answer = sweep()
        assert answer['processed'] == 0 and answer['pending'] == 1 and answer['retry_after_ms'] == 0, answer
        release(holder)
        # An active hand's T-shared lock must be respected too.
        holder = hold('ca:tournament-terminal-settlement:v1:' + A, shared=True)
        assert sweep()['processed'] == 0
        release(holder)
        answer = sweep()
        assert answer['settled'] == 1 and answer['pending'] == 0, answer
        answer = sweep()
        assert answer['processed'] == 0 and answer['settled'] == 0 and answer['pending'] == 0, answer
        assert sql("SELECT count(*) FROM tournament_bounty_obligations WHERE state='settled'") == '2'
        # More busy tournaments than the payment batch must not hide the next
        # available tournament. Admission scans the finite due set, while the
        # unchanged settlement body still processes only one event per call.
        events = [f'20000000-0000-0000-0000-{n:012d}' for n in range(1, 22)]
        for event in events:
            sql(f"INSERT INTO tournaments VALUES('{event}'); INSERT INTO tournament_bounty_obligations(id,tournament_id,eliminated_user_id,hand_number,mode,state,next_attempt_at) VALUES('{event}','{event}','{event}',1,'regular','pending',now()-interval '1 minute');")
        holder = hold(['ca:tournament-terminal-settlement:v1:' + event for event in events[:20]])
        answer = sweep()
        assert answer['settled_tournament_ids'] == [events[20]] and answer['pending'] == 20, answer
        release(holder)
        print('BOUNTY_LANE_CONTENTION PASS: pre-fix timeout, independent progress, scoped/global/shared contention, retained pending, duplicate no-op, atomic admission pin rotation')
    finally:
        for holder in list(holders):
            holder.kill()
            holder.communicate()
        subprocess.run([str(bindir / 'pg_ctl'), '-D', str(data), '-m', 'immediate', '-w', 'stop'], check=True, stdout=subprocess.DEVNULL)
