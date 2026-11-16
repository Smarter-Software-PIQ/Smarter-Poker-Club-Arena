#!/usr/bin/env python3
"""Real PG17 marker/ack regression; controlled unit lookup, no wallet/payment fixture."""
import argparse
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / 'supabase/migrations'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--migration', type=Path, default=MIGRATIONS / '20261116044125_a_shared_mystery_chest_settles_in_the_whole_chips_it_was_split_in.sql')
args = parser.parse_args()
pg = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin' if os.uname().sysname == 'Darwin' else '/usr/lib/postgresql/17/bin'))
parent = os.environ.get('TMPDIR') or os.environ.get('RUNNER_TEMP')
if not parent:
    raise RuntimeError('Set TMPDIR to owned external scratch or RUNNER_TEMP on CI')
if os.uname().sysname == 'Darwin' and not str(Path(parent).resolve()).startswith('/Volumes/SmarterWork/agent-work/'):
    raise RuntimeError('Mac fixture storage must be on verified external work storage')

def extract(filename, name, delimiter='$function$'):
    source = (MIGRATIONS / filename).read_text()
    start = source.index('CREATE OR REPLACE FUNCTION public.' + name + '(')
    end = source.index(delimiter + ';', source.index('AS ' + delimiter, start)) + len(delimiter) + 1
    return source[start:end]

old = extract('20260914113514_a_diamond_mystery_chest_holds_whole_diamonds.sql', 'fn_bounty_obligation_has_complete_marker')
ack = extract('20260908042000_bounty_elimination_outbox_is_atomic_and_recoverable.sql', 'fn_ack_bounty_obligation_from_award')
floor = extract('20260912103907_one_recovery_fee_and_it_knows_its_unit.sql', 'fn_ca_unit_floor_cents', '$fn$')
new = args.migration.read_text()
# Preserve the entire regular/PKO owner branch, rather than reimplement its arithmetic.
new_marker = new[new.index('CREATE OR REPLACE FUNCTION public.fn_bounty_obligation_has_complete_marker('):]
assert old[old.index('\n    ELSE\n'):].split('$function$;')[0] == new_marker[new_marker.index('\n    ELSE\n'):].split('$function$;')[0], 'non-mystery branch changed'
producer = (MIGRATIONS / '20261022170421_mystery_bounty_half_of_the_whole_entry_in_whole_chip_chests.sql').read_text()
assert 'v_unit integer := GREATEST(100, public.fn_ca_tournament_unit_cents(p_tournament_id));' in producer

with tempfile.TemporaryDirectory(prefix='mystery-marker-', dir=parent) as folder:
    scratch = Path(folder)
    def run(tool, *arguments, source=None, check=True):
        result = subprocess.run([str(pg / tool), *arguments], input=source, text=True, capture_output=True, timeout=90)
        if check and result.returncode:
            raise RuntimeError(result.stdout + result.stderr)
        return result
    assert re.search(r'\b17\.', run('postgres', '--version').stdout), 'PostgreSQL 17 required'
    run('initdb', '-D', str(scratch / 'data'), '-A', 'trust', '--no-locale', '-E', 'UTF8')
    with socket.socket() as reserve:
        reserve.bind(('127.0.0.1', 0))
        port = str(reserve.getsockname()[1])
    # TCP only avoids macOS Unix socket path limits in deeply nested owned worktrees.
    run('pg_ctl', '-D', str(scratch / 'data'), '-l', str(scratch / 'server.log'), '-o', f"-h 127.0.0.1 -p {port} -c unix_socket_directories=''", 'start')
    try:
        def sql(source, check=True):
            return run('psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', port, '-d', 'postgres', source=source, check=check)
        def value(source):
            return sql(source).stdout.strip()
        def uid(n):
            return f'00000000-0000-0000-0000-{n:012d}'
        sql('''CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated;
CREATE TABLE tournaments(id uuid PRIMARY KEY, unit_cents integer NOT NULL);
CREATE TABLE tournament_bounty_obligations(id uuid PRIMARY KEY,tournament_id uuid,mode text,claimants jsonb,head_amount numeric,state text,settled_at timestamptz,last_error text);
CREATE TABLE tournament_bounty_awards(id uuid PRIMARY KEY,bounty_obligation_id uuid,status text,amount_cents bigint);
CREATE TABLE tournament_bounty_award_recipients(id uuid PRIMARY KEY,award_id uuid,user_id uuid,amount_cents bigint,paid_at timestamptz,UNIQUE(award_id,user_id));
CREATE TABLE tournament_bounties(bounty_obligation_id uuid,collector_player_id uuid,bounty_amount numeric,added_to_collector_bounty numeric);
CREATE FUNCTION fn_ca_tournament_unit_cents(uuid) RETURNS integer LANGUAGE sql STABLE AS $$SELECT unit_cents FROM tournaments WHERE id=$1$$;
''')
        sql(floor + old + ack + '''
REVOKE ALL ON FUNCTION fn_bounty_obligation_has_complete_marker(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION fn_bounty_obligation_has_complete_marker(uuid) TO service_role;
CREATE TRIGGER trg_ack_bounty_obligation_from_award AFTER INSERT OR UPDATE OF status ON tournament_bounty_awards FOR EACH ROW EXECUTE FUNCTION fn_ack_bounty_obligation_from_award();
''')
        def fixture(n, amounts, unit=1, mode='mystery_chest', paid=True, state='pending', total=1100):
            claimants = json.dumps([{'user_id': uid(1 + i), 'weight': 1} for i in range(len(amounts))])
            sql(f"INSERT INTO tournaments VALUES('{uid(n)}',{unit}); INSERT INTO tournament_bounty_obligations VALUES('{uid(n)}','{uid(n)}','{mode}','{claimants}',{total}/100.0,'{state}',NULL,'retained error');")
            if mode == 'mystery_chest':
                status = 'completed' if paid else 'revealed'
                sql(f"INSERT INTO tournament_bounty_awards VALUES('{uid(n)}','{uid(n)}','{status}',{total});")
                for i, amount in enumerate(amounts):
                    timestamp = "'2026-11-16T04:24:00Z'" if paid else 'NULL'
                    sql(f"INSERT INTO tournament_bounty_award_recipients VALUES('{uid(n*10+i)}','{uid(n)}','{uid(i+1)}',{amount},{timestamp});")
            else:
                for i, amount in enumerate(amounts):
                    added = amount - ((amount // 2) // unit * unit) if mode == 'pko' else 0
                    sql(f"INSERT INTO tournament_bounties VALUES('{uid(n)}','{uid(i+1)}',{amount}/100.0,{added}/100.0);")
        def marker(n):
            return value(f"SELECT fn_bounty_obligation_has_complete_marker('{uid(n)}');") == 't'
        fixture(100, [600, 500], paid=False)
        fixture(101, [550, 550], state='settled')
        fixture(102, [600, 500], unit=100)
        fixture(103, [550, 550], unit=100)
        fixture(104, [100, 0], total=100)
        fixture(105, [500, 300, 300])
        fixture(106, [367, 367, 366])
        for n, mode, unit, amounts, total in [(110,'regular',1,[5,6],11),(111,'pko',1,[5,6],11),(112,'regular',100,[500,600],1100),(113,'pko',100,[500,600],1100)]:
            fixture(n, amounts, unit, mode, total=total)
        assert marker(101) and marker(102) and not marker(103)
        baseline = {n: marker(n) for n in range(110,114)}
        assert all(baseline.values())
        completion = f"""DO $$BEGIN
UPDATE tournament_bounty_award_recipients SET paid_at='2026-11-16T04:42:00Z' WHERE award_id='{uid(100)}';
UPDATE tournament_bounty_awards SET status='completed' WHERE id='{uid(100)}';
IF NOT fn_bounty_obligation_has_complete_marker('{uid(100)}') OR NOT EXISTS(SELECT 1 FROM tournament_bounty_obligations WHERE id='{uid(100)}' AND state='settled') THEN
 RAISE EXCEPTION 'exact marker and real acknowledgement did not settle'; END IF;
END$$;"""
        failed = sql(completion, check=False)
        assert failed.returncode and 'exact marker and real acknowledgement did not settle' in failed.stderr
        assert value(f"SELECT status FROM tournament_bounty_awards WHERE id='{uid(100)}';") == 'revealed'
        assert value(f"SELECT count(*) FROM tournament_bounty_award_recipients WHERE award_id='{uid(100)}' AND paid_at IS NOT NULL;") == '0'
        assert value(f"SELECT state FROM tournament_bounty_obligations WHERE id='{uid(100)}';") == 'pending'
        print('PASS: old actual marker rejects 600+500; actual ack fails to settle and asserted transaction rolls back')
        metadata = "SELECT jsonb_build_array(oid,proowner,proacl,prosecdef,proconfig) FROM pg_proc WHERE oid='fn_bounty_obligation_has_complete_marker(uuid)'::regprocedure;"
        def snapshot():
            return value("SELECT jsonb_build_array((SELECT jsonb_agg(t ORDER BY id) FROM tournament_bounty_obligations t),(SELECT jsonb_agg(t ORDER BY id) FROM tournament_bounty_awards t),(SELECT jsonb_agg(t ORDER BY id) FROM tournament_bounty_award_recipients t));")
        estate, rows = value(metadata), snapshot()
        sql(new)
        assert value(metadata) == estate, 'function OID, owner, ACL or security contract changed'
        assert snapshot() == rows, 'migration changed financial evidence'
        assert value("SELECT md5(prosrc) FROM pg_proc WHERE oid='fn_bounty_obligation_has_complete_marker(uuid)'::regprocedure;") == '12d89db812b1a52bc09dc3a86d6633ed'
        sql(completion)
        assert marker(100)
        settled = snapshot()
        sql(f"UPDATE tournament_bounty_awards SET status='completed' WHERE id='{uid(100)}';")
        assert snapshot() == settled, 'repeated acknowledgement changed settled evidence'
        assert marker(101) and marker(102) and not marker(103) and marker(104) and marker(105) and marker(106)
        assert {n: marker(n) for n in baseline} == baseline
        print('PASS: new exact source settles whole-chip award; replay idempotent; legacy cents and Diamond/regular/PKO unchanged')
        cases = [
            (100, f"UPDATE tournament_bounty_award_recipients SET amount_cents=1100-amount_cents WHERE award_id='{uid(100)}'", 'wrong remainder'),
            (100, f"UPDATE tournament_bounty_award_recipients SET amount_cents=600 WHERE award_id='{uid(100)}'", 'wrong sum'),
            (100, f"UPDATE tournament_bounty_award_recipients SET user_id='{uid(9)}' WHERE award_id='{uid(100)}' AND user_id='{uid(2)}'", 'outsider'),
            (100, f"UPDATE tournament_bounty_award_recipients SET paid_at=NULL WHERE award_id='{uid(100)}' AND user_id='{uid(2)}'", 'unpaid'),
            (100, f"INSERT INTO tournament_bounty_award_recipients VALUES('{uid(9999)}','{uid(100)}','{uid(9)}',0,now())", 'extra zero recipient'),
            (104, f"DELETE FROM tournament_bounty_award_recipients WHERE award_id='{uid(104)}' AND user_id='{uid(2)}'", 'missing zero recipient'),
            (104, f"UPDATE tournament_bounty_award_recipients SET paid_at=NULL WHERE award_id='{uid(104)}' AND user_id='{uid(2)}'", 'unpaid zero recipient'),
            (105, f"UPDATE tournament_bounty_award_recipients SET amount_cents=CASE user_id WHEN '{uid(1)}' THEN 500 WHEN '{uid(2)}' THEN 367 ELSE 233 END WHERE award_id='{uid(105)}'", 'mixed unit cut'),
            (100, f"UPDATE tournament_bounty_awards SET bounty_obligation_id='{uid(999)}' WHERE id='{uid(100)}'", 'wrong obligation binding'),
            (111, f"UPDATE tournament_bounties SET added_to_collector_bounty=0 WHERE bounty_obligation_id='{uid(111)}'", 'incorrect PKO half'),
            (113, f"UPDATE tournament_bounties SET added_to_collector_bounty=2.5 WHERE bounty_obligation_id='{uid(113)}'", 'fractional Diamond half'),
        ]
        for n, mutation, label in cases:
            result = value(f"BEGIN; {mutation}; SELECT fn_bounty_obligation_has_complete_marker('{uid(n)}'); ROLLBACK;")
            assert result == 'f', (label, result)
        print(f'PASS: {len(cases)} strict refusals, including one common unit across all claimants')
        replay = sql(new, check=False)
        assert replay.returncode and 'changed; qualify current source' in replay.stderr
        assert snapshot() == settled
        print('PASS: preimage guard rejects migration replay; no evidence rows rewritten')
        print('SCOPE: actual SQL marker, floor helper and ack trigger on PG17; controlled unit lookup; no wallet payer or production mutation')
    finally:
        run('pg_ctl', '-D', str(scratch / 'data'), '-m', 'immediate', 'stop')
