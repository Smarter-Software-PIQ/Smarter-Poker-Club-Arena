#!/usr/bin/env python3
"""Real promo send core, public/batch doors and concurrent sessions in isolated PG17."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261112050118_agent_promo_sends_are_capped_at_fifty_chips_per_downline_in_.sql'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--baseline', action='store_true')
args = parser.parse_args()
pg = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin' if os.uname().sysname == 'Darwin' else '/usr/lib/postgresql/17/bin'))
scratch = Path(os.environ.get('TMPDIR', tempfile.gettempdir())).resolve()
if os.uname().sysname == 'Darwin' and scratch.stat().st_dev == Path('/').stat().st_dev:
    raise RuntimeError('Set TMPDIR to the verified task-owned external SSD directory')
cluster = Path(tempfile.mkdtemp(prefix='pc-', dir=scratch))
socket = cluster / 's'
socket.mkdir()
psql = [pg/'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-U', 'postgres', '-d', 'postgres']

def run(command, sql=None):
    result = subprocess.run([str(x) for x in command], input=sql, text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError(result.stderr + result.stdout)
    return result.stdout.strip()

def query(sql):
    return run(psql, sql)

def uid(n):
    return f'00000000-0000-0000-0000-{n:012d}'

club, owner, agent, downagent, player = [uid(n) for n in range(1, 6)]
passed = []

def check(name, condition):
    assert condition, name
    passed.append(name)

def send(amount, actor=agent, target=player, destination='player_wallet', op=None, prefix='', suffix='', club_id=club):
    op = op or str(uuid.uuid4())
    sql = f"SET request.jwt.claim.sub='{actor}'; SELECT fn_promo_wallet_send('{club_id}','{target}',{amount},'{destination}',NULL,'{op}');"
    output = query(prefix + sql + suffix)
    return json.loads(next(line for line in output.splitlines() if line.startswith('{')))

def state():
    return query("SELECT jsonb_build_object('wallets',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM agents a),'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY club_id,user_id) FROM club_members m),'transactions',(SELECT count(*) FROM chip_transactions),'journal',(SELECT count(*) FROM journal));")

def refused(amount, **kwargs):
    before = state()
    result = send(amount, **kwargs)
    assert result['success'] is False, result
    assert state() == before, 'Refusal changed balances or financial records'
    return result

def fixture_history(amount, age, actor=agent, target=player, role='agent', club_id=club):
    query(f"INSERT INTO chip_transactions(club_id,from_user_id,to_user_id,amount,transaction_type,metadata,created_at) VALUES('{club_id}','{actor}','{target}',{amount},'promo_wallet_send',jsonb_build_object('actor_role','{role}','op_id',gen_random_uuid()),clock_timestamp()-interval '{age}');")

try:
    assert ' 17.' in run([pg/'postgres', '--version'])
    shared = Path(run([pg/'pg_config', '--sharedir']))
    if not (shared/'postgres.bki').exists():
        shared = pg.parent/'share/postgresql'
    run([pg/'initdb', '-L', shared, '-D', cluster/'data', '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'])
    run([pg/'pg_ctl', '-D', cluster/'data', '-l', cluster/'server.log', '-o', f"-h '' -k {socket}", '-w', 'start'])
    check('isolated Unix-socket-only PostgreSQL', query("SELECT inet_server_addr() IS NULL AND current_setting('listen_addresses')='';") == 't')
    fixture = ROOT/'scripts/ci/fixtures/chip-wallet-choice'
    query((fixture/'setup.sql').read_text())
    query((fixture/'selected-setup.sql').read_text())
    query('ALTER TABLE chip_transactions ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();')
    # Load exact retained routing bodies, not a reimplementation of the cap.
    source = (ROOT/'supabase/migrations/20261016024912_cashier_sends_use_the_selected_source_and_destination_wallet.sql').read_text()
    for name in ['fn_promo_wallet_send_core_20261004', 'fn_cashier_batch_transfer']:
        match = re.search(r'CREATE OR REPLACE FUNCTION public\.' + name + r'\(.*?\$function\$.*?\$function\$', source, re.S)
        assert match, name
        query(match.group(0) + ';')
    query((fixture/'fn_promo_wallet_send.sql').read_text() + ';')
    # Existing fixture exposes journal inputs and role/hierarchy checks. Exercise
    # all ranks with the real core; production authorization is separately retained.
    query(f"INSERT INTO club_members(club_id,user_id,role,status,agent_id) VALUES('{club}','{uid(6)}','sub_agent','active','{agent}'); INSERT INTO agents(club_id,user_id,promo_wallet_balance) VALUES('{club}','{uid(6)}',1000);")
    if not args.baseline:
        query(MIGRATION.read_text())
    print('CORE_HASH', query("SELECT md5(pg_get_functiondef('fn_promo_wallet_send_core_20261004(uuid,uuid,numeric,text,text,uuid)'::regprocedure));"), flush=True)
    if not args.baseline:
        body_hash = query("SELECT md5(prosrc) FROM pg_proc WHERE oid='fn_promo_wallet_send_core_20261004(uuid,uuid,numeric,text,text,uuid)'::regprocedure;")
        contract = (ROOT/'scripts/verification-harness/cashier-release-contract.sql').read_text()
        check('live browser contract pins the qualified cap body', f"'hash', '{body_hash}'" in contract)
    first_op = str(uuid.uuid4())
    check('first split send', send(30, op=first_op)['success'])
    result = refused(20.01)
    check('cumulative cap before debit', result['error_code'] == 'promo_downline_seven_day_limit' and result['remaining_chips'] == 20)
    check('exact cap accepted', send(20)['success'])
    before = state()
    check('original retry replays at exhausted cap', send(30, op=first_op)['replayed'])
    check('retry has no financial effects', state() == before)
    check('changed retry payload refused', refused(31, op=first_op)['error'] == 'Retry Intent Mismatch')
    check('one cent over rejected', refused(.01)['remaining_chips'] == 0)
    # The receipt role remains authoritative if an upline is promoted/demoted.
    query(f"UPDATE club_members SET role='super_agent' WHERE user_id='{agent}';")
    check('super agent shares existing allowance', refused(1)['remaining_chips'] == 0)
    query(f"UPDATE club_members SET agent_id='{uid(6)}' WHERE user_id='{player}';")
    check('different sub agent cannot stack', refused(1, actor=uid(6))['remaining_chips'] == 0)
    # A claim-back/reversal never replenishes the rolling gross-send allowance.
    query(f"UPDATE chip_transactions SET is_reversed=true,clawed_back=true WHERE to_user_id='{player}';")
    check('reversals do not reopen allowance', refused(1, actor=uid(6))['remaining_chips'] == 0)
    query(f"UPDATE chip_transactions SET created_at=clock_timestamp()-interval '168 hours 1 second' WHERE to_user_id='{player}';")
    check('expired sends release allowance', send(50, actor=uid(6))['success'])
    # Same recipient, three wallet routes; the history is not split by destination.
    check('agent destination receives first 25', send(25, target=downagent, destination='cashier_agent_wallet')['success'])
    check('promo destination receives remaining 25', send(25, target=downagent, destination='cashier_promo_wallet')['success'])
    check('player destination cannot reset cap', refused(.01, target=downagent)['remaining_chips'] == 0)
    check('legacy destination alias cannot reset cap', refused(.01, target=downagent, destination='agent_wallet')['remaining_chips'] == 0)
    check('owner funding remains unrestricted', send(75, actor=owner, target=downagent)['success'])
    # Existing receipts immediately count, independent of who currently parents them.
    query(f"INSERT INTO club_members(club_id,user_id,role,status,agent_id) VALUES('{club}','{uid(7)}','player','active','{agent}');")
    fixture_history(49.99, '167 hours', actor=uid(6), target=uid(7), role='sub_agent')
    fixture_history(500, '169 hours', target=uid(7))
    fixture_history(500, '1 hour', target=uid(7), role='owner', actor=owner)
    fixture_history(500, '1 hour', target=uid(7), club_id=uid(99))
    check('historical sends and cents respected', send(.01, target=uid(7))['success'])
    check('history excludes other clubs and owner sources', refused(.01, target=uid(7))['remaining_chips'] == 0)
    for amount in ['NULL', '0', '-1', '0.001', "'NaN'::numeric", "'Infinity'::numeric"]:
        check(f'invalid amount {amount}', refused(amount, target=uid(6))['success'] is False)
    check('self send refused', refused(1, target=agent)['success'] is False)
    check('outside downline refused', refused(1, target=owner)['success'] is False)
    check('player cannot spend agent promo', refused(1, actor=player, target=agent)['success'] is False)
    for isolation in ['REPEATABLE READ', 'SERIALIZABLE']:
        check('stale snapshot refused '+isolation, refused(1, target=uid(6), prefix='BEGIN ISOLATION LEVEL '+isolation+';', suffix='ROLLBACK;')['error_code'] == 'promo_limit_snapshot')
    before = state()
    check('rolled back send accepts provisionally', send(10, target=uid(6), prefix='BEGIN;', suffix='ROLLBACK;')['success'])
    check('rollback consumes no allowance or balance', state() == before)
    # Simultaneous different operations from different uplines, queued on the
    # existing club mutex. Test hierarchy fixture permits both ancestors here.
    query(f"CREATE OR REPLACE FUNCTION fn_club_cashier_can_transact(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1='{club}'::uuid AND $3='{uid(6)}'::uuid AND $2 IN ('{agent}'::uuid,'{downagent}'::uuid) $$;")
    holder = subprocess.Popen([str(x) for x in psql], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    holder.stdin.write(f"BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('agent-agreement:{club}',0)); SELECT 'held';\n")
    holder.stdin.flush()
    while holder.stdout.readline().strip() != 'held':
        if holder.poll() is not None:
            raise RuntimeError('mutex holder exited')
    workers = []
    for actor in [agent, downagent]:
        worker = subprocess.Popen([str(x) for x in psql], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        worker.stdin.write(f"SET application_name='promo-limit-race'; SET request.jwt.claim.sub='{actor}'; SELECT fn_promo_wallet_send('{club}','{uid(6)}',30,'player_wallet',NULL,gen_random_uuid());\n")
        worker.stdin.flush()
        workers.append(worker)
    deadline = time.monotonic() + 5
    try:
        while query("SELECT count(*) FROM pg_stat_activity WHERE application_name='promo-limit-race' AND wait_event='advisory';") != '2':
            if time.monotonic() > deadline:
                raise RuntimeError('two sends did not reach the mutex')
            time.sleep(.02)
    finally:
        holder.communicate('ROLLBACK;\n', timeout=5)
    results = []
    for worker in workers:
        output, error = worker.communicate(timeout=5)
        assert worker.returncode == 0, error
        results.append(json.loads(next(line for line in output.splitlines() if line.startswith('{'))))
    check('concurrent uplines cannot exceed 50', sum(r['success'] for r in results) == 1)
    check('concurrent refusal sees committed 30', next(r for r in results if not r['success'])['remaining_chips'] == 20)
    check('one committed transfer and journal', query(f"SELECT (SELECT count(*) FROM chip_transactions WHERE to_user_id='{uid(6)}')=1 AND (SELECT count(*) FROM journal WHERE to_id='{uid(6)}')=1;") == 't')
    # Public batch API must hit the same cap rather than its own uncapped writer.
    for amount in [20, 1]:
        rows = json.dumps([{'user_id': uid(6), 'amount': amount, 'source': 'promo_wallet', 'destination': 'promo_wallet', 'op_id': str(uuid.uuid4())}])
        batch = json.loads(query(f"SET request.jwt.claim.sub='{agent}'; SELECT fn_cashier_batch_transfer('{club}','send','{rows}'::jsonb,gen_random_uuid());"))
        check('batch allowance '+str(amount), batch['results'][0]['success'] == (amount == 20))
        if amount == 1:
            check('batch returns same limit refusal', batch['results'][0]['error_code'] == 'promo_downline_seven_day_limit')
    check('batch cannot split around cap', query(f"SELECT sum(amount)=50 FROM chip_transactions WHERE to_user_id='{uid(6)}';") == 't')
    if not args.baseline:
        for proof in re.findall(r'^-- @live-proof: (.+)$', MIGRATION.read_text(), re.M):
            check('exact installed postimage', query('SELECT '+proof+';') == 't')
        try:
            query(MIGRATION.read_text())
        except RuntimeError as error:
            check('migration replay refuses changed preimage', 'Unexpected promo send preimage' in str(error))
        else:
            raise AssertionError('Migration replay was accepted')
    print(json.dumps({'passed': True, 'cases': passed}, indent=2))
finally:
    if (cluster/'data/postmaster.pid').exists():
        run([pg/'pg_ctl', '-D', cluster/'data', '-m', 'fast', '-w', 'stop'])
    shutil.rmtree(cluster)
