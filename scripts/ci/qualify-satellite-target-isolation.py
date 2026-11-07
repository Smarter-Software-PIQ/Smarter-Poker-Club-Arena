"""Check live PostgreSQL lock behavior in a private PG17 cluster. No external DB input."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from contextlib import contextmanager

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / 'supabase/migrations'
SATELLITE = MIGRATIONS / '20260917191322_sweeps_and_satellites_take_their_own_lanes.sql'
ORDINARY = MIGRATIONS / '20261001232124_a_payout_waits_only_for_finishes_that_share_its_bank.sql'
FIX = MIGRATIONS / '20261107190137_a_blocked_satellite_target_releases_the_shared_finish_lane.sql'
PAYER = 'fn_ca_lock_settlement_lane_for_satellite_finish'
FINISH = 'fn_ca_lock_settlement_lane_for_finish'


def original_function(source, name):
    body = source.read_text()
    start = body.index('CREATE OR REPLACE FUNCTION public.' + name + '(')
    end = body.index('$function$;', start) + len('$function$;')
    return body[start:end]


def qualify(pg, scratch):
    # All clients below name this cluster's private socket explicitly. Neither
    # a remote URL nor the caller's PG connection environment is used.
    env = {key: val for key, val in os.environ.items() if not key.startswith('PG')}
    env.update(PGUSER='postgres', PGDATABASE='postgres', PGSSLMODE='disable',
               PGPORT='56480', LC_ALL='C')
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='lane-',dir=scratch) as private:
        work = Path(private)
        data, sock = work/'d', work/'s'
        sock.mkdir()
        env['PGHOST'] = str(sock)
        def command(args, timeout=25):
            return subprocess.run([str(pg/args[0]), *map(str,args[1:])], env=env,
                                  text=True, capture_output=True, timeout=timeout, check=True)
        command(['initdb','-D',data,'-U','postgres','--auth-local=trust',
                 '--auth-host=reject','--no-locale','-E','UTF8'])
        command(['pg_ctl','-D',data,'-l',work/'postgres.log','-w','start',
                 '-o',f"-h '' -k '{sock}' -p 56480"])
        client = [str(pg/'psql'),'-XAtq','-v','ON_ERROR_STOP=1']
        def query(sql):
            proc = subprocess.run(client, input=sql,text=True,env=env,timeout=8,capture_output=True)
            if proc.returncode:
                raise RuntimeError(proc.stderr)
            return proc.stdout.strip()

        @contextmanager
        def active_client(name, sql):
            opts = dict(env, PGAPPNAME=name)
            client_process = subprocess.Popen(client, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                              stderr=subprocess.PIPE, env=opts, text=True)
            try:
                client_process.stdin.write(sql+'\n')
                client_process.stdin.flush()
                yield client_process
            finally:
                client_process.stdin.close()
                try:
                    client_process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    client_process.kill()
                    client_process.wait(timeout=5)
                client_process.stdout.close()
                client_process.stderr.close()

        def await_evidence(sql):
            expires = time.monotonic()+5
            while time.monotonic()<expires:
                if query(sql)=='t':
                    return
                time.sleep(.04)
            raise RuntimeError('missing backend evidence: '+sql)

        def await_idle(name):
            await_evidence(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE "
                           f"application_name='{name}' AND state='idle in transaction');")

        def wait_edge(waiter, holder):
            return (f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity w,pg_stat_activity h "
                    f"WHERE w.application_name='{waiter}' AND h.application_name='{holder}' "
                    f"AND w.wait_event_type='Lock' AND h.pid=ANY(pg_blocking_pids(w.pid)));")

        def admission(fn, name):
            return f"SELECT public.{fn}(md5('{name}')::uuid);"

        try:
            if query("SELECT current_setting('server_version_num')::int/10000=17 AND inet_server_addr() IS NULL")!='t':
                raise RuntimeError('private PostgreSQL 17 Unix socket required')
            query("""
CREATE ROLE service_role;
CREATE TABLE public.clubs(id uuid PRIMARY KEY,union_id uuid);
CREATE TABLE public.tournaments(id uuid PRIMARY KEY,club_id uuid,variant text,
 tournament_type text,satellite_target_id uuid,satellite_target uuid);
INSERT INTO public.clubs SELECT md5('scope')::uuid,NULL;
INSERT INTO public.tournaments SELECT md5(name)::uuid,md5('scope')::uuid,
 CASE WHEN target IS NULL THEN 'plain' ELSE 'satellite' END,format,md5(target)::uuid,NULL
 FROM (VALUES ('a','target','SNG'),('b','target','MTT'),('c','other','SATELLITE'),
 ('target',NULL,'MTT'),('other',NULL,'MTT'),('mtt',NULL,'MTT'),
 ('spin',NULL,'SPIN'),('sng',NULL,'SNG')) events(name,target,format);
""" + original_function(ORDINARY,FINISH) + original_function(SATELLITE,PAYER)
                  + f"REVOKE ALL ON FUNCTION public.{PAYER}(uuid) FROM PUBLIC;"
                  + f"GRANT EXECUTE ON FUNCTION public.{PAYER}(uuid) TO service_role;")
            hold_row = "BEGIN; SELECT id FROM tournaments WHERE id=md5('target')::uuid FOR UPDATE;"
            hold_key = ("BEGIN; SELECT pg_advisory_xact_lock_shared(hashtextextended("
                        "'ca:tournament-terminal-settlement:v1:'||md5('target')::uuid::text,0));")
            # Observe the actual predecessor wait graph before releasing it.
            with active_client('holder',hold_row) as holder:
                await_idle('holder')
                old_pay = admission(PAYER,'a') + "SELECT id FROM tournaments WHERE id=md5('target')::uuid FOR UPDATE;"
                with active_client('old-payer','BEGIN;'+old_pay) as payer:
                    await_evidence(wait_edge('old-payer','holder'))
                    with active_client('old-peer','BEGIN;'+admission(FINISH,'spin')) as peer:
                        await_evidence(wait_edge('old-peer','old-payer'))
                        holder.stdin.write('ROLLBACK;\n'); holder.stdin.flush()
                        await_idle('old-payer')
                        payer.stdin.write('ROLLBACK;\n'); payer.stdin.flush()
                        await_idle('old-peer')

            query(FIX.read_text())
            cases = []
            for name, lock in [('target_row',hold_row),('target_hand_key',hold_key)]:
                with active_client('holder',lock):
                    await_idle('holder')
                    for event in ('a','b'):
                        query("SET statement_timeout='2s'; DO $case$ BEGIN BEGIN "
                              + admission(PAYER,event).replace('SELECT','PERFORM',1)
                              + "RAISE EXCEPTION 'blocked request admitted'; "
                                "EXCEPTION WHEN lock_not_available THEN NULL; END; END $case$;")
                    for event in ('mtt','spin','sng','c'):
                        query("SET statement_timeout='2s'; "+admission(PAYER if event=='c' else FINISH,event))
                    await_idle('holder')
                for event in ('a','b'):
                    query(admission(PAYER,event))
                cases.append(name)
            # Once admitted, two same-target writers still exclude each other.
            with active_client('first','BEGIN;'+admission(PAYER,'a')) as first:
                await_idle('first')
                with active_client('second','BEGIN;'+admission(PAYER,'b')):
                    await_evidence(wait_edge('second','first'))
                    first.stdin.write('COMMIT;\n'); first.stdin.flush()
                    await_idle('second')
            return {'migration':FIX.stem, 'sha256':hashlib.sha256(FIX.read_bytes()).hexdigest(),
                    'predecessor_peer_blocked':True,'corrected_cases':cases,
                    'unrelated_admissions':['MTT','SPIN','SNG','SATELLITE'],
                    'same_target_serialization':True,'original_admission_after_unlock':True}
        finally:
            command(['pg_ctl','-D',data,'-m','immediate','-w','stop'])


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--pg-bin',type=Path,required=True)
    ap.add_argument('--scratch',type=Path,required=True)
    args=ap.parse_args()
    print(json.dumps(qualify(args.pg_bin.resolve(),args.scratch.resolve()),sort_keys=True))
