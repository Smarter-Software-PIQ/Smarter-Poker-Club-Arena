#!/usr/bin/env python3
"""Real promo funded cashier ticket doors, the shared cap, cancel and redeem routing in isolated PG17.

Scope: balances, receipts, the shared 50 chip allowance, replay, batch, receipt
recovery, cancel and redeem routing, and concurrent sessions. The production
journal triggers (the agents and club_members autoledger and the tally) are NOT
in this fixture and are out of scope here; the fixture's small journal adapter
only exposes the ledger declaration each real body makes.
"""
import hashlib
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
MIGRATIONS = ROOT / 'supabase/migrations'
CAP_MIGRATION = MIGRATIONS / '20261112050118_agent_promo_sends_are_capped_at_fifty_chips_per_downline_in_.sql'
TICKET_MIGRATION = MIGRATIONS / '20261112184216_promo_chips_fund_cashier_tickets_and_cancel_returns_escrow.sql'
BATCH_MIGRATION = MIGRATIONS / '20261112204754_promo_tickets_batch_allowance_receipts_and_redeem_names_its_.sql'
OWNERS = ROOT / 'tests/fixtures/satellite-value-awards/current-owners.json'
CANCEL_PREIMAGE = 'e52d94e64fe64cc1508885a541450c71'
REDEEM_PREIMAGE = '0bb17681b38164a7a2746e17d07597b3'
LIMIT_CODE = 'promo_downline_seven_day_limit'
# CI runs PostgreSQL 17. The override exists only for a development machine
# that carries another major version.
PG_MAJOR = os.environ.get('PROMO_TICKET_PG_MAJOR', '17')
pg = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin' if os.uname().sysname == 'Darwin' else '/usr/lib/postgresql/17/bin'))
scratch = Path(os.environ.get('TMPDIR', tempfile.gettempdir())).resolve()
if os.uname().sysname == 'Darwin' and scratch.stat().st_dev == Path('/').stat().st_dev:
    raise RuntimeError('Set TMPDIR to the verified task-owned external SSD directory')
cluster = Path(tempfile.mkdtemp(prefix='pt-', dir=scratch))
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
second_agent = uid(6)
passed = []

def check(name, condition):
    assert condition, name
    passed.append(name)

def call(actor, expression, prefix='', suffix=''):
    output = query(f"{prefix}SET request.jwt.claim.sub='{actor}'; SELECT {expression};{suffix}")
    return json.loads(next(line for line in output.splitlines() if line.startswith('{')))

def ticket_sql(target, amount, key):
    return f"fn_cashier_promo_ticket_send('{club}','{target}',{amount},'{key}')"

def ticket(amount, actor=agent, target=player, key=None, **kwargs):
    return call(actor, ticket_sql(target, amount, key or str(uuid.uuid4())), **kwargs)

def send_sql(target, amount):
    return f"fn_promo_wallet_send('{club}','{target}',{amount},'player_wallet',NULL,'{uuid.uuid4()}')"

def send(amount, actor=agent, target=player):
    return call(actor, send_sql(target, amount))

def batch(items, actor=agent):
    return call(actor, f"fn_cashier_promo_ticket_batch('{club}','{json.dumps(items)}'::jsonb,'{uuid.uuid4()}')")

def cancel(ticket_id, actor=agent):
    return call(actor, f"fn_cancel_tournament_ticket('{ticket_id}')")

def redeem(ticket_id, actor):
    return call(actor, f"fn_redeem_tournament_ticket('{ticket_id}')")

def state():
    return query("SELECT jsonb_build_object('wallets',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM agents a),'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY club_id,user_id) FROM club_members m),'tickets',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM tournament_tickets t),'transactions',(SELECT count(*) FROM chip_transactions),'journal',(SELECT count(*) FROM journal));")

def unchanged(action):
    before = state()
    result = action()
    assert state() == before, f'Balances, tickets or financial records changed: {result}'
    return result

def refused(action):
    result = unchanged(action)
    assert result['success'] is False, result
    return result

def promo(user):
    return float(query(f"SELECT promo_wallet_balance FROM agents WHERE club_id='{club}' AND user_id='{user}';"))

def chips(user):
    return float(query(f"SELECT chip_balance FROM club_members WHERE club_id='{club}' AND user_id='{user}';"))

def player_chip_total():
    return query('SELECT sum(chip_balance) FROM club_members;')

def add_player(n):
    query(f"INSERT INTO club_members(club_id,user_id,role,status,agent_id) VALUES('{club}','{uid(n)}','player','active','{agent}');")
    return uid(n)

def race(target, statements):
    """Queue different operations from different uplines on the club mutex, then release them together."""
    holder = subprocess.Popen([str(x) for x in psql], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    holder.stdin.write(f"BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('agent-agreement:{club}',0)); SELECT 'held';\n")
    holder.stdin.flush()
    while holder.stdout.readline().strip() != 'held':
        if holder.poll() is not None:
            raise RuntimeError('mutex holder exited')
    tag = 'promo-ticket-race-' + target[-4:]
    workers = []
    for actor, expression in statements:
        worker = subprocess.Popen([str(x) for x in psql], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        worker.stdin.write(f"SET application_name='{tag}'; SET request.jwt.claim.sub='{actor}'; SELECT {expression};\n")
        worker.stdin.flush()
        workers.append(worker)
    deadline = time.monotonic() + 5
    try:
        while query(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{tag}' AND wait_event='advisory';") != str(len(workers)):
            if time.monotonic() > deadline:
                raise RuntimeError('the concurrent operations did not reach the mutex')
            time.sleep(.02)
    finally:
        holder.communicate('ROLLBACK;\n', timeout=5)
    results = []
    for worker in workers:
        output, error = worker.communicate(timeout=5)
        assert worker.returncode == 0, error
        results.append(json.loads(next(line for line in output.splitlines() if line.startswith('{'))))
    return results

def received(target):
    return query(f"SELECT coalesce(sum(amount),0) FROM chip_transactions WHERE to_user_id='{target}' AND transaction_type='promo_wallet_send';")

try:
    assert f' {PG_MAJOR}.' in run([pg/'postgres', '--version'])
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
    # What the ticket bodies read or write and the wallet fixture lacks.
    query("""
CREATE TABLE ca_money_rpc_registry(proname text PRIMARY KEY,status text,notes text);
CREATE TABLE tournament_tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid,issued_by uuid,holder_id uuid,value numeric,note text,status text DEFAULT 'issued',redeemed_at timestamptz,cancelled_at timestamptz,created_at timestamptz DEFAULT now(),redemption_mode text DEFAULT 'wallet_chips');
CREATE TABLE tournament_ticket_entry_targets(ticket_id uuid PRIMARY KEY,tournament_id uuid);
CREATE TABLE wallet_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,wallet_type text,type text,amount numeric,category text,description text,balance_after numeric);
""")
    # The fixture's journal adapters demand a ledger retry key that only the
    # wallet cores declare. The ticket bodies rely on the production autoledger
    # for theirs, so the adapters record what was declared and nothing more.
    query("""
CREATE OR REPLACE FUNCTION bank_agent_journal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_setting('app.ledger_autoskip_agents',true)='1' THEN RETURN NEW; END IF;
 IF NEW.agent_wallet_balance IS DISTINCT FROM OLD.agent_wallet_balance THEN
 INSERT INTO journal VALUES(current_setting('app.ledger_category',true),current_setting('app.ledger_counterparty',true),nullif(current_setting('app.ledger_counterparty_entity',true),'')::uuid,'agent_wallet',NEW.user_id,NEW.agent_wallet_balance-OLD.agent_wallet_balance,NEW.club_id,nullif(current_setting('app.ledger_idempotency_key',true),''));
 ELSIF NEW.promo_wallet_balance IS DISTINCT FROM OLD.promo_wallet_balance THEN
 INSERT INTO journal VALUES(current_setting('app.ledger_category',true),current_setting('app.ledger_counterparty',true),nullif(current_setting('app.ledger_counterparty_entity',true),'')::uuid,'promo_wallet',NEW.user_id,NEW.promo_wallet_balance-OLD.promo_wallet_balance,NEW.club_id,nullif(current_setting('app.ledger_idempotency_key',true),''));
 END IF; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION player_journal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_setting('app.ledger_autoskip_club_members',true)='1' THEN RETURN NEW; END IF;
 IF NEW.chip_balance <> OLD.chip_balance THEN INSERT INTO journal VALUES(current_setting('app.ledger_category',true),current_setting('app.ledger_counterparty',true),nullif(current_setting('app.ledger_counterparty_entity',true),'')::uuid,'player_wallet',NEW.user_id,NEW.chip_balance-OLD.chip_balance,NEW.club_id,nullif(current_setting('app.ledger_idempotency_key',true),'')); END IF; RETURN NEW;
END $$;
""")
    # Load exact retained routing bodies, not a reimplementation of the cap.
    source = (MIGRATIONS/'20261016024912_cashier_sends_use_the_selected_source_and_destination_wallet.sql').read_text()
    match = re.search(r'CREATE OR REPLACE FUNCTION public\.fn_promo_wallet_send_core_20261004\(.*?\$function\$.*?\$function\$', source, re.S)
    assert match, 'fn_promo_wallet_send_core_20261004'
    query(match.group(0) + ';')
    query((fixture/'fn_promo_wallet_send.sql').read_text() + ';')
    query(CAP_MIGRATION.read_text())
    # The exact production ticket owners the two migrations patch.
    owners = {row['proname']: row['definition'] for row in json.loads(OWNERS.read_text())}
    cancel_owner = owners['fn_cancel_tournament_ticket']
    assert "'app.ledger_category','escrow_release'" in cancel_owner
    cancel_owner = cancel_owner.replace("'app.ledger_category','escrow_release'", "'app.ledger_category','refund'")
    redeem_owner = owners['fn_redeem_tournament_ticket']
    assert hashlib.md5(cancel_owner.encode()).hexdigest() == CANCEL_PREIMAGE
    assert hashlib.md5(redeem_owner.encode()).hexdigest() == REDEEM_PREIMAGE
    query(cancel_owner + ';')
    query(redeem_owner + ';')
    check('installed cancel and redeem preimages are the production owners', query(f"SELECT md5(pg_get_functiondef('public.fn_cancel_tournament_ticket(uuid)'::regprocedure))='{CANCEL_PREIMAGE}' AND md5(pg_get_functiondef('public.fn_redeem_tournament_ticket(uuid)'::regprocedure))='{REDEEM_PREIMAGE}';") == 't')
    # Both migrations run whole and unmodified: every CREATE OR REPLACE
    # FUNCTION body and both guarded DO $patch$ blocks are the shipped bytes.
    for migration in [TICKET_MIGRATION, BATCH_MIGRATION]:
        text = migration.read_text()
        assert re.search(r'CREATE OR REPLACE FUNCTION public\.fn_cashier_promo_\w+\(.*?\$function\$.*?\$function\$', text, re.S), migration.name
        assert re.search(r'DO \$patch\$.*?\$patch\$;', text, re.S), migration.name
        query(text)
        for proof in re.findall(r'^-- @live-proof: (.+)$', text, re.M):
            check('exact installed postimage ' + migration.name[:14], query('SELECT ' + proof + ';') == 't')
    for migration, message in [(TICKET_MIGRATION, 'Unexpected ticket cancel preimage'), (BATCH_MIGRATION, 'Unexpected ticket redeem preimage')]:
        try:
            query(migration.read_text())
        except RuntimeError as error:
            check('migration replay refuses changed preimage ' + migration.name[:14], message in str(error))
        else:
            raise AssertionError('Migration replay was accepted')
    query(f"INSERT INTO club_members(club_id,user_id,role,status,agent_id) VALUES('{club}','{second_agent}','sub_agent','active','{agent}'); INSERT INTO agents(club_id,user_id,promo_wallet_balance) VALUES('{club}','{second_agent}',1000);")

    # One promo ticket: promo float out, an issued ticket, a promo receipt.
    members_before = player_chip_total()
    agent_wallet_before = query(f"SELECT agent_wallet_balance FROM agents WHERE user_id='{agent}';")
    first_key = 'ticket-' + str(uuid.uuid4())
    first = ticket(30, key=first_key)
    check('promo ticket issued', first['success'] and first['replayed'] is False and first['source'] == 'promo_wallet')
    check('promo ticket debits the agent promo wallet', promo(agent) == 970 and first['sender_promo_after'] == 970)
    check('promo ticket debits no player wallet and no agent wallet', player_chip_total() == members_before and query(f"SELECT agent_wallet_balance FROM agents WHERE user_id='{agent}';") == agent_wallet_before)
    check('issued ticket row exists with the value', query(f"SELECT count(*) FROM tournament_tickets WHERE id='{first['ticket_id']}' AND club_id='{club}' AND issued_by='{agent}' AND holder_id='{player}' AND value=30 AND status='issued';") == '1')
    check('receipt is promo_wallet_send with destination tournament_ticket', query(f"SELECT count(*) FROM chip_transactions WHERE transaction_type='promo_wallet_send' AND metadata->>'destination'='tournament_ticket' AND metadata->>'actor_role'='agent' AND metadata->>'ticket_id'='{first['ticket_id']}' AND metadata->>'idempotency_key'='{first_key}' AND from_user_id='{agent}' AND to_user_id='{player}' AND amount=30;") == '1')
    check('promo debit is declared as ticket_issue against the ticket escrow', query(f"SELECT count(*) FROM journal WHERE category='ticket_issue' AND from_type='escrow' AND from_id='{first['ticket_id']}' AND to_type='promo_wallet' AND to_id='{agent}' AND amount=-30;") == '1')
    over = refused(lambda: ticket(20.01))
    check('ticket over the remaining allowance refused and changes nothing', over['error_code'] == LIMIT_CODE and over['remaining_chips'] == 20 and over['sent_last_7_days'] == 30)
    replay = unchanged(lambda: ticket(30, key=first_key))
    check('same retry key replays with no second debit', replay['success'] and replay['replayed'] is True and replay['ticket_id'] == first['ticket_id'] and promo(agent) == 970)
    check('same key with a different amount refused', refused(lambda: ticket(31, key=first_key))['error'] == 'That Retry Key Belongs To A Different Ticket')
    check('same key with a different holder refused', refused(lambda: ticket(30, target=downagent, key=first_key))['error'] == 'That Retry Key Belongs To A Different Ticket')
    check('same key from a different sender refused', refused(lambda: ticket(30, actor=owner, key=first_key))['error'] == 'That Retry Key Belongs To A Different Ticket')
    check('exact remaining allowance accepted as a ticket', ticket(20)['success'])
    check('one cent over refused', refused(lambda: ticket(.01))['remaining_chips'] == 0)
    for isolation in ['REPEATABLE READ', 'SERIALIZABLE']:
        check('stale snapshot refused ' + isolation, refused(lambda: ticket(1, target=downagent, prefix='BEGIN ISOLATION LEVEL ' + isolation + ';', suffix='ROLLBACK;'))['error_code'] == 'promo_limit_snapshot')
    for amount in ['NULL', '0', '-1', '0.001', "'NaN'::numeric"]:
        check(f'invalid ticket value {amount}', refused(lambda: ticket(amount, target=downagent))['success'] is False)
    check('ticket to self refused', refused(lambda: ticket(1, target=agent))['success'] is False)
    check('ticket outside the downline refused', refused(lambda: ticket(1, target=owner))['error'] == 'That Member Is Not In Your Downline')
    check('player cannot fund a promo ticket', refused(lambda: ticket(1, actor=player, target=downagent))['success'] is False)
    check('ticket beyond the promo wallet balance refused', refused(lambda: ticket(1001, actor=owner, target=downagent))['error'] == 'Insufficient Promo Wallet Balance')

    # Promo sends and promo tickets are one allowance, in both doors.
    shared_a, shared_b = add_player(11), add_player(12)
    check('promo send of 30 accepted', send(30, target=shared_a)['success'])
    check('promo ticket of 20 fits after a send of 30', ticket(20, target=shared_a)['success'])
    after_send = refused(lambda: ticket(.01, target=shared_a))
    check('promo send then promo ticket share one allowance', after_send['error_code'] == LIMIT_CODE and after_send['remaining_chips'] == 0 and after_send['sent_last_7_days'] == 50)
    check('promo ticket of 50 accepted first', ticket(50, target=shared_b)['success'])
    after_ticket = refused(lambda: send(.01, target=shared_b))
    check('promo ticket then promo send refused by the same allowance', after_ticket['error_code'] == LIMIT_CODE and after_ticket['remaining_chips'] == 0)

    # Staff promo is not capped, and staff receipts do not consume the agent allowance.
    owner_before = promo(owner)
    check('owner is not capped', ticket(75, actor=owner, target=shared_b)['success'] and promo(owner) == owner_before - 75)
    fresh = add_player(13)
    allowance = unchanged(lambda: call(agent, f"fn_cashier_promo_allowance('{club}',ARRAY['{player}','{shared_b}','{fresh}','{owner}','{agent}']::uuid[])"))
    rows = {row['user_id']: row for row in allowance['allowances']}
    check('allowance reports remaining for an agent', allowance['success'] and allowance['capped'] is True and allowance['limit_chips'] == 50 and rows[player]['remaining_chips'] == 0 and rows[shared_b]['sent_last_7_days'] == 50 and rows[fresh]['remaining_chips'] == 50 and rows[fresh]['sent_last_7_days'] == 0)
    check('allowance lists only the caller downlines', set(rows) == {player, shared_b, fresh})
    staff = unchanged(lambda: call(owner, f"fn_cashier_promo_allowance('{club}',ARRAY['{player}']::uuid[])"))
    check('allowance reports capped false for the owner', staff['success'] and staff['capped'] is False and staff['allowances'] == [])

    # Batch: several tickets, one refused by the cap, the others kept.
    partly_used, third = add_player(14), add_player(15)
    check('prior promo send of 40 to a batch recipient', send(40, target=partly_used)['success'])
    keys = [str(uuid.uuid4()) for _ in range(3)]
    items = [
        {'user_id': fresh, 'amount': 10, 'idempotency_key': keys[0]},
        {'user_id': partly_used, 'amount': 20, 'idempotency_key': keys[1]},
        {'user_id': third, 'amount': 5, 'idempotency_key': keys[2]},
    ]
    before_batch = promo(agent)
    result = batch(items)
    outcomes = result['results']
    check('batch issues several tickets', result['success'] and result['processed'] == 3 and outcomes[0]['success'] and outcomes[2]['success'] and query(f"SELECT count(*) FROM tournament_tickets WHERE status='issued' AND ((holder_id='{fresh}' AND value=10) OR (holder_id='{third}' AND value=5));") == '2')
    check('batch reports a per item cap refusal without undoing the others', outcomes[1]['success'] is False and outcomes[1]['error_code'] == LIMIT_CODE and outcomes[1]['remaining_chips'] == 10 and outcomes[1]['user_id'] == partly_used and promo(agent) == before_batch - 15 and received(partly_used) == '40')
    again = unchanged(lambda: batch(items))
    check('batch retry replays its tickets with no second debit', again['results'][0]['replayed'] is True and again['results'][0]['ticket_id'] == outcomes[0]['ticket_id'] and again['results'][2]['replayed'] is True)
    duplicate = [{'user_id': downagent, 'amount': 1, 'idempotency_key': str(uuid.uuid4())}, {'user_id': third, 'amount': 1, 'idempotency_key': str(uuid.uuid4())}, {'user_id': downagent, 'amount': 1, 'idempotency_key': str(uuid.uuid4())}]
    check('batch rejects duplicate recipients before moving anything', refused(lambda: batch(duplicate))['error'] == 'A Recipient May Appear Only Once Per Batch')
    too_many = [{'user_id': uid(1000 + n), 'amount': 1, 'idempotency_key': str(uuid.uuid4())} for n in range(26)]
    check('batch rejects more than 25 items before moving anything', refused(lambda: batch(too_many))['error'] == 'A Batch Must Contain Between 1 And 25 Recipients')
    no_key = [{'user_id': downagent, 'amount': 1, 'idempotency_key': str(uuid.uuid4())}, {'user_id': third, 'amount': 1}]
    check('batch rejects an item without a retry key before moving anything', refused(lambda: batch(no_key))['error'] == 'Every Ticket Needs Its Own Retry Key')

    # Receipt recovery reads only the caller's own promo ticket receipts.
    mine = unchanged(lambda: call(agent, f"fn_cashier_promo_ticket_receipts('{club}',ARRAY['{first_key}','{keys[1]}','{keys[2]}'])"))
    found = {row['ticket_key']: row['receipt'] for row in mine['tickets']}
    check('receipts return the caller receipt by key', set(found) == {first_key, keys[2]} and found[first_key]['ticket_id'] == first['ticket_id'] and found[first_key]['success'] is True and found[first_key]['source'] == 'promo_wallet')
    for other in [owner, second_agent, player]:
        check('receipts return nothing for another actor ' + other[-1], call(other, f"fn_cashier_promo_ticket_receipts('{club}',ARRAY['{first_key}','{keys[2]}'])")['tickets'] == [])

    # Cancel: a promo ticket returns to the promo wallet and stays counted.
    cancel_holder = add_player(16)
    promo_before, chips_before = promo(agent), chips(agent)
    promo_ticket = ticket(50, target=cancel_holder)
    check('promo ticket of 50 issued for cancel', promo_ticket['success'] and promo(agent) == promo_before - 50)
    check('only the issuer may cancel a promo ticket', refused(lambda: cancel(promo_ticket['ticket_id'], actor=cancel_holder))['error'] == 'Only The Issuer May Cancel A Ticket')
    cancelled = cancel(promo_ticket['ticket_id'])
    check('cancelling a promo ticket restores the promo wallet', cancelled['success'] and cancelled['refund_wallet'] == 'promo_wallet' and cancelled['your_balance'] == promo_before and promo(agent) == promo_before)
    check('cancelling a promo ticket credits no player wallet', chips(agent) == chips_before and chips(cancel_holder) == 0 and query(f"SELECT status FROM tournament_tickets WHERE id='{promo_ticket['ticket_id']}';") == 'cancelled')
    check('promo cancel is declared as a refund from the ticket escrow', query(f"SELECT count(*) FROM journal WHERE category='refund' AND from_type='escrow' AND from_id='{promo_ticket['ticket_id']}' AND to_type='promo_wallet' AND to_id='{agent}' AND amount=50;") == '1')
    recancel = unchanged(lambda: cancel(promo_ticket['ticket_id']))
    check('repeated cancel replays with no second refund', recancel['success'] and recancel['replayed'] is True and promo(agent) == promo_before)
    check('cancelled promo ticket cannot be redeemed', refused(lambda: redeem(promo_ticket['ticket_id'], cancel_holder))['error'] == 'Ticket Already Cancelled')
    check('cancelling a promo ticket does not reopen the ticket allowance', refused(lambda: ticket(.01, target=cancel_holder))['remaining_chips'] == 0)
    check('cancelling a promo ticket does not reopen the send allowance', refused(lambda: send(.01, target=cancel_holder))['error_code'] == LIMIT_CODE)

    # An ordinary player wallet ticket still refunds the issuer's player wallet.
    ordinary = str(uuid.uuid4())
    query(f"INSERT INTO tournament_tickets(id,club_id,issued_by,holder_id,value,note) VALUES('{ordinary}','{club}','{owner}','{player}',40,'Cashier Ticket'); INSERT INTO chip_transactions(club_id,from_user_id,to_user_id,amount,transaction_type,notes,metadata) VALUES('{club}','{owner}','{player}',40,'tournament_ticket_issue','Tournament Ticket Issued',jsonb_build_object('ticket_id','{ordinary}','escrow_entity_id','{ordinary}','issuer_id','{owner}','holder_id','{player}'));")
    owner_chips, owner_promo = chips(owner), promo(owner)
    plain = cancel(ordinary, actor=owner)
    check('cancelling an ordinary player wallet ticket refunds chip_balance', plain['success'] and plain['refund_wallet'] == 'player_wallet' and chips(owner) == owner_chips + 40 and plain['your_balance'] == owner_chips + 40)
    check('ordinary ticket cancel leaves every promo wallet alone', promo(owner) == owner_promo and query(f"SELECT count(*) FROM journal WHERE category='refund' AND from_id='{ordinary}' AND to_type='player_wallet' AND to_id='{owner}' AND amount=40;") == '1')

    # Redeem: the holder is credited once and the leg names the ticket.
    redeem_holder = add_player(17)
    promo_before = promo(agent)
    redeemable = ticket(25, target=redeem_holder)
    check('only the holder may redeem a promo ticket', refused(lambda: redeem(redeemable['ticket_id'], agent))['error'] == 'This Ticket Is Not Yours')
    paid = redeem(redeemable['ticket_id'], redeem_holder)
    check('redeeming a promo ticket credits the holder chip_balance', paid['success'] and paid['replayed'] is False and paid['value'] == 25 and chips(redeem_holder) == 25)
    again = unchanged(lambda: redeem(redeemable['ticket_id'], redeem_holder))
    check('redeeming a promo ticket credits once', again['success'] and again['replayed'] is True and chips(redeem_holder) == 25 and query(f"SELECT count(*) FROM chip_transactions WHERE transaction_type='tournament_ticket_redeem' AND metadata->>'ticket_id'='{redeemable['ticket_id']}';") == '1')
    check('redeem leg names the promo ticket as its escrow entity', query(f"SELECT count(*) FROM journal WHERE category='ticket_redeem' AND from_type='escrow' AND from_id='{redeemable['ticket_id']}' AND to_type='player_wallet' AND to_id='{redeem_holder}' AND amount=25;") == '1')
    check('redeemed promo ticket cannot also be cancelled', refused(lambda: cancel(redeemable['ticket_id']))['error'] == 'Ticket Already Redeemed')
    check('redeem leaves the issuer promo wallet debited', promo(agent) == promo_before - 25)

    # Simultaneous different operations from different uplines, queued on the
    # club mutex. The hierarchy adapter permits both uplines for these members.
    raced, mixed = add_player(18), add_player(19)
    query(f"CREATE OR REPLACE FUNCTION fn_club_cashier_can_transact(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1='{club}'::uuid AND $3 IN ('{raced}'::uuid,'{mixed}'::uuid) AND $2 IN ('{agent}'::uuid,'{second_agent}'::uuid) $$;")
    results = race(raced, [(actor, ticket_sql(raced, 30, str(uuid.uuid4()))) for actor in [agent, second_agent]])
    check('concurrent promo tickets from two agents cannot exceed 50', sum(r['success'] for r in results) == 1 and received(raced) == '30')
    loser = next(r for r in results if not r['success'])
    check('concurrent ticket refusal sees the committed 30', loser['error_code'] == LIMIT_CODE and loser['remaining_chips'] == 20)
    check('one issued ticket and one promo debit after the race', query(f"SELECT count(*) FROM tournament_tickets WHERE holder_id='{raced}' AND status='issued' AND value=30;") == '1' and promo(agent) + promo(second_agent) == promo_before - 25 + 1000 - 30)
    results = race(mixed, [(agent, ticket_sql(mixed, 30, str(uuid.uuid4()))), (second_agent, send_sql(mixed, 30))])
    check('concurrent promo ticket and promo send cannot exceed 50', sum(r['success'] for r in results) == 1 and received(mixed) == '30')
    check('mixed door refusal sees the committed 30', next(r for r in results if not r['success'])['remaining_chips'] == 20)
    print(json.dumps({'passed': True, 'cases': passed}, indent=2))
finally:
    if (cluster/'data/postmaster.pid').exists():
        run([pg/'pg_ctl', '-D', cluster/'data', '-m', 'fast', '-w', 'stop'])
    shutil.rmtree(cluster)
