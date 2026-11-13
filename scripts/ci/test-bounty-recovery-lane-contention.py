#!/usr/bin/env python3
"""Real PostgreSQL lock contention; disposable local database, no production access."""
import json
import os
from pathlib import Path
import socket as sockets
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = 'supabase/migrations/20261113054116_bounty_recovery_skips_busy_settlement_lanes.sql'
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
    def hold(key, shared=False):
        p = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        holders.append(p)
        p.stdin.write(f"BEGIN; SELECT pg_advisory_xact_lock{'_shared' if shared else ''}(hashtextextended('{key}',0)); SELECT 'ready';\n")
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
        holder = hold('ca:tournament-terminal-settlement:v1:' + A)
        # Establish the exact pre-fix regression with a different backend.
        try:
            sweep()
            raise AssertionError('old sweep unexpectedly bypassed busy oldest lane')
        except subprocess.CalledProcessError as error:
            assert 'statement timeout' in error.stderr, error.stderr
        sql((ROOT / MIGRATION).read_text())
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
        print('BOUNTY_LANE_CONTENTION PASS: pre-fix timeout, independent progress, scoped/global/shared contention, retained pending, duplicate no-op')
    finally:
        for holder in list(holders):
            holder.kill()
            holder.communicate()
        subprocess.run([str(bindir / 'pg_ctl'), '-D', str(data), '-m', 'immediate', '-w', 'stop'], check=True, stdout=subprocess.DEVNULL)
