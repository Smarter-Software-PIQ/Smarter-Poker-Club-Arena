#!/usr/bin/env python3
"""Heads-up rematch under real concurrency, on an isolated native cluster.

The rematch core (fn_ca_heads_up_rematch_core) and its two browser doors are
installed from the merged migration and must hash to the definitions installed
in production. Independent psql sessions then call the doors at the same
instant, repeat their taps, and are cancelled or disconnected in the middle of
a purchase. After every scenario the database must hold one rematch, one charge
per player and no partial state: a game is created only with both seats bought,
and an interrupted purchase leaves nothing behind for the retry to trip over.
"""
import json, os, re, signal, subprocess, tempfile, time, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
FIX = ROOT / 'scripts/ci/fixtures/heads-up-rematch-concurrency/bootstrap.sql'
MIG = ROOT / 'supabase/migrations/20261109021122_heads_up_rematch_atomic_buy_in.sql'
# md5(pg_get_functiondef(oid)) read from production on 2026-11-09 05:12Z.
PRODUCTION_MD5 = {
    'fn_ca_heads_up_rematch_core': '2df60372fbf4d0fff788be4d4e2f3530',
    'ca_heads_up_rematch_respond': '79ae417a9bff7aaa90a39175d9723571',
    'ca_heads_up_rematch_state': 'a1fdac1b84d68aca5b488843302d585c',
}
CLUB = '00000000-0000-4000-8000-00000000c1ab'
BUY_IN, FEE = 10, 1
COST = BUY_IN + FEE
ALLOWED = {'matched', 'waiting_for_opponent', 'waiting_for_you', 'finding_table', 'none'}

cluster = Path(tempfile.mkdtemp(prefix='hu-rematch-', dir=os.environ.get('TMPDIR')))
sock = Path(tempfile.mkdtemp(prefix='hu-rematch-sock-', dir='/tmp'))
data = cluster / 'data'
env = {'PATH': str(PG) + ':/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}
started = False
children = []


def run(args, sql=None):
    r = subprocess.run([str(a) for a in args], input=sql, text=True, capture_output=True, env=env, timeout=120)
    if r.returncode:
        raise RuntimeError(r.stdout + r.stderr)
    return r.stdout.strip()


def argv(user='postgres'):
    return [PG / 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-U', user, '-d', 'postgres']


def q(sql):
    return run(argv(), sql)


def until(sql, seconds=15):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if q(sql) == 't':
            return
        time.sleep(0.02)
    raise AssertionError('timed out waiting for: ' + sql)


def extract(text, start, end_marker):
    i = text.index(start)
    j = text.index(end_marker, i) + len(end_marker)
    return text[i:j]


def install():
    mig = MIG.read_text()
    tables = extract(mig, 'CREATE TABLE IF NOT EXISTS public.ca_heads_up_rematches',
                     'USING (auth.uid() = ANY (player_ids));')
    sources = extract(mig, 'CREATE TABLE IF NOT EXISTS public.ca_heads_up_rematch_sources',
                      'FROM PUBLIC, anon, authenticated, service_role;')
    core = extract(mig, 'CREATE OR REPLACE FUNCTION public.fn_ca_heads_up_rematch_core(', '$function$;')
    respond = extract(mig, 'CREATE OR REPLACE FUNCTION public.ca_heads_up_rematch_respond(', '$function$;')
    state = extract(mig, 'CREATE OR REPLACE FUNCTION public.ca_heads_up_rematch_state(', '$function$;')
    grants = extract(mig, 'REVOKE ALL ON FUNCTION public.ca_heads_up_rematch_respond(uuid, boolean) FROM PUBLIC, anon;',
                     'GRANT EXECUTE ON FUNCTION public.ca_heads_up_rematch_state(uuid) TO authenticated;')
    q('BEGIN;\n' + tables + '\n' + sources + '\n' + core + '\n'
      + 'REVOKE ALL ON FUNCTION public.fn_ca_heads_up_rematch_core(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;\n'
      + respond + '\n' + state + '\n' + grants + '\nCOMMIT;')
    q("INSERT INTO public.ca_heads_up_rematch_sources VALUES ('public.fixture_source_layer()', "
      "md5(pg_get_functiondef('public.fixture_source_layer()'::regprocedure)), 'public.fixture_source_layer()');")
    got = dict(line.split('|') for line in q(
        "SELECT proname, md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace "
        "AND proname IN ('fn_ca_heads_up_rematch_core','ca_heads_up_rematch_respond','ca_heads_up_rematch_state')").splitlines())
    assert got == PRODUCTION_MD5, ('installed definitions differ from production', got)
    print('PASS the tested core and doors hash to the production definitions', flush=True)


def knob(name, value=None):
    if value is None:
        q(f"DELETE FROM public.fixture_knobs WHERE name='{name}'")
    else:
        q(f"INSERT INTO public.fixture_knobs VALUES ('{name}','{value}') ON CONFLICT (name) DO UPDATE SET value=excluded.value")


def person(balance, horse=False):
    uid = str(uuid.uuid4())
    q(f"INSERT INTO public.profiles VALUES ('{uid}', {str(horse).lower()});"
      f"INSERT INTO public.club_members VALUES ('{CLUB}','{uid}',{balance});")
    return uid


def finished_game(winner, loser, ended_seconds_ago=1):
    src = str(uuid.uuid4())
    q(f"""INSERT INTO public.tournaments (id,status,ended_at,club_id,buy_in_amount,buy_in_fee,game_type,variant,
            format_contract,max_players,name,tournament_type,guaranteed_prize,starting_chips,min_players,table_size,
            blind_structure,payout_structure)
          VALUES ('{src}','COMPLETED',clock_timestamp()-interval '{ended_seconds_ago} seconds','{CLUB}',{BUY_IN},{FEE},
            'nlh','holdem','sng-v1',2,'Heads Up','sng',0,1500,2,2,'[{{"level":1}}]','[100]');
          INSERT INTO public.tournament_players VALUES ('{src}','{winner}',1),('{src}','{loser}',2);""")
    return src


def worker(uid, sql_call, tag):
    """One independent session. It waits on the controller's gate, then calls."""
    script = (f"SET application_name='hu_worker_{tag}';\n"
              f"SET request.jwt.claim.sub='{uid}';\nSET ROLE authenticated;\n"
              "SELECT pg_advisory_lock_shared(4242);\nSELECT pg_advisory_unlock_shared(4242);\n"
              f"SELECT 'RESULT ' || ({sql_call})::text;\n")
    p = subprocess.Popen([str(a) for a in argv()], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True, env=env)
    p.stdin.write(script)
    p.stdin.close()
    children.append(p)
    return p


def accept(src):
    return f"public.ca_heads_up_rematch_respond('{src}', true)"


def decline(src):
    return f"public.ca_heads_up_rematch_respond('{src}', false)"


def read(src):
    return f"public.ca_heads_up_rematch_state('{src}')"


def simultaneously(calls):
    """Start every call at the same instant from its own session."""
    gate = subprocess.Popen([str(a) for a in argv()], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, env=env)
    children.append(gate)
    gate.stdin.write("SET application_name='hu_gate'; SELECT pg_advisory_lock(4242);\n")
    gate.stdin.flush()
    until("SELECT EXISTS (SELECT FROM pg_locks WHERE locktype='advisory' AND objid=4242 AND granted AND mode='ExclusiveLock')")
    procs = [worker(uid, call, i) for i, (uid, call) in enumerate(calls)]
    until(f"SELECT count(*) = {len(procs)} FROM pg_stat_activity WHERE application_name LIKE 'hu_worker_%' "
          "AND wait_event_type = 'Lock' AND wait_event = 'advisory'")
    gate.stdin.write('SELECT pg_advisory_unlock(4242);\n')
    gate.stdin.close()
    gate.wait(timeout=10)
    out = []
    for p in procs:
        stdout, stderr = p.communicate(timeout=60)
        line = [l for l in stdout.splitlines() if l.startswith('RESULT ')]
        out.append(json.loads(line[0][7:]) if line else {'error': stderr.strip()})
    return out


def facts(src):
    row = q(f"SELECT coalesce(row_to_json(r)::text,'null') FROM public.ca_heads_up_rematches r WHERE source_tournament_id='{src}'")
    row = json.loads(row) if row else None
    target = row and row['target_tournament_id']
    games = int(q(f"SELECT count(*) FROM public.tournaments WHERE created_by_rematch AND id::text = '{target or ''}'") or 0)
    stray = int(q("SELECT count(*) FROM public.tournaments t WHERE created_by_rematch AND NOT EXISTS "
                  "(SELECT FROM public.ca_heads_up_rematches r WHERE r.target_tournament_id = t.id)"))
    charges = json.loads(q(f"SELECT coalesce(json_agg(json_build_object('payer',payer,'amount',amount,'txid',txid)),'[]') "
                           f"FROM public.fixture_charges WHERE tournament_id::text = '{target or ''}'"))
    seats = int(q(f"SELECT count(*) FROM public.table_seats s JOIN public.tables t ON t.id=s.table_id "
                  f"WHERE t.tournament_id::text = '{target or ''}' AND s.left_at IS NULL"))
    return row, games, stray, charges, seats


def balance(uid):
    return float(q(f"SELECT chip_balance FROM public.club_members WHERE user_id='{uid}'"))


def assert_matched(src, players, before, label):
    row, games, stray, charges, seats = facts(src)
    assert row and row['outcome'] == 'matched', (label, row)
    assert games == 1 and stray == 0, (label, games, stray)
    assert sorted(c['payer'] for c in charges) == sorted(players), (label, charges)
    assert len({c['txid'] for c in charges}) == 1, (label, 'charges committed in more than one transaction', charges)
    assert seats == 2, (label, seats)
    for uid in players:
        assert balance(uid) == before[uid] - COST, (label, uid, balance(uid), before[uid])
    seen = set()
    for uid in players:
        state = simultaneously([(uid, read(src))])[0]
        assert state['status'] == 'matched' and state['table_id'] == row['target_table_id'], (label, state)
        seen.add(state['seat_number'])
    assert seen == {1, 2}, (label, seen)
    return row


def assert_nothing_charged(src, players, before, label):
    row, games, stray, charges, seats = facts(src)
    assert games == 0 and stray == 0 and charges == [] and seats == 0, (label, row, games, stray, charges, seats)
    for uid in players:
        assert balance(uid) == before[uid], (label, uid)
    return row


def scenario_simultaneous_yes_and_repeats(rounds):
    knob('seat_delay_all', '0.15')  # hold the row lock long enough for every other session to queue on it
    for n in range(rounds):
        a, b = person(100), person(100)
        src = finished_game(a, b)
        before = {a: balance(a), b: balance(b)}
        calls = [(a, accept(src))] * 4 + [(b, accept(src))] * 4
        results = simultaneously(calls)
        errors = [r for r in results if 'error' in r]
        assert not errors, errors
        assert {r['status'] for r in results} <= ALLOWED, results
        assert any(r['status'] == 'matched' for r in results), results
        assert_matched(src, [a, b], before, f'simultaneous round {n}')
        # Repeat taps after the match change nothing.
        again = simultaneously([(a, accept(src)), (b, accept(src)), (a, accept(src)), (b, read(src))])
        assert all(r['status'] == 'matched' for r in again), again
        assert_matched(src, [a, b], before, f'simultaneous round {n} repeats')
    knob('seat_delay_all')
    print(f'PASS {rounds} rounds of 8 simultaneous Yes sessions: one rematch, one charge each, repeats inert', flush=True)


def scenario_interrupted_then_retry(kind):
    a, b = person(100), person(100)
    src = finished_game(a, b)
    before = {a: balance(a), b: balance(b)}
    first = simultaneously([(a, accept(src))])[0]
    assert first['status'] == 'waiting_for_opponent', first
    # The second Yes stalls inside the SECOND purchase, after the first payer was
    # already charged inside the same transaction.
    knob('seat_delay_for', b)
    knob('seat_delay', '30')
    p = worker(b, accept(src), 'interrupt')
    until("SELECT EXISTS (SELECT FROM pg_stat_activity WHERE application_name='hu_worker_interrupt' AND wait_event='PgSleep')")
    pid = q("SELECT pid FROM pg_stat_activity WHERE application_name='hu_worker_interrupt'")
    if kind == 'cancel':
        q(f'SELECT pg_cancel_backend({pid})')
    elif kind == 'disconnect':
        q(f'SELECT pg_terminate_backend({pid})')
    stdout, stderr = p.communicate(timeout=30)
    assert 'RESULT' not in stdout, (kind, stdout)
    until(f"SELECT NOT EXISTS (SELECT FROM pg_stat_activity WHERE pid={pid})")
    row = assert_nothing_charged(src, [a, b], before, f'{kind} mid-purchase')
    assert row['accepted_by'] == [a] and row['outcome'] is None, (kind, row)
    knob('seat_delay_for')
    knob('seat_delay')
    retry = simultaneously([(b, accept(src))])[0]
    assert retry['status'] == 'matched', (kind, retry)
    assert_matched(src, [a, b], before, f'{kind} then retry')
    print(f'PASS a Yes {"cancelled" if kind == "cancel" else "disconnected"} mid-purchase left no charge, '
          'no game and no seat; its retry matched once', flush=True)


def scenario_client_dies_before_reading_answer():
    """The browser's request reaches the database and the client vanishes before
    it reads the reply. Whatever the server did, a retry must land on one match."""
    a, b = person(100), person(100)
    src = finished_game(a, b)
    before = {a: balance(a), b: balance(b)}
    assert simultaneously([(a, accept(src))])[0]['status'] == 'waiting_for_opponent'
    knob('seat_delay_for', b)
    knob('seat_delay', '1')
    p = worker(b, accept(src), 'vanish')
    until("SELECT EXISTS (SELECT FROM pg_stat_activity WHERE application_name='hu_worker_vanish' AND wait_event='PgSleep')")
    p.send_signal(signal.SIGKILL)
    p.wait(timeout=10)
    until("SELECT NOT EXISTS (SELECT FROM pg_stat_activity WHERE application_name='hu_worker_vanish')")
    knob('seat_delay_for')
    knob('seat_delay')
    row, games, stray, charges, seats = facts(src)
    path = 'committed' if row['outcome'] == 'matched' else 'rolled back'
    if path == 'rolled back':
        assert_nothing_charged(src, [a, b], before, 'client vanished')
    retry = simultaneously([(b, accept(src)), (b, accept(src)), (a, read(src))])
    assert all(r['status'] == 'matched' for r in retry), retry
    assert_matched(src, [a, b], before, 'client vanished then retry')
    print(f'PASS a client killed before reading its answer ({path} on the server); the retry matched once', flush=True)


def scenario_short_wallet_concurrent():
    a, b = person(100), person(COST - 1)
    src = finished_game(a, b)
    before = {a: balance(a), b: balance(b)}
    results = simultaneously([(a, accept(src))] * 3 + [(b, accept(src))] * 3)
    assert not [r for r in results if 'error' in r], results
    row = assert_nothing_charged(src, [a, b], before, 'short wallet')
    assert row['outcome'] == 'buy_in_refused' and row['refused_by'] == b, row
    again = simultaneously([(a, accept(src)), (b, accept(src))])
    assert all(r['status'] == 'buy_in_refused' for r in again), again
    assert_nothing_charged(src, [a, b], before, 'short wallet repeats')
    print('PASS a short wallet under simultaneous Yes: nobody charged, no game, repeats stay refused', flush=True)


def scenario_horse_opponent_concurrent():
    a, h = person(100), person(100, horse=True)
    src = finished_game(a, h, ended_seconds_ago=30)  # past the horse's own ask moment
    before = {a: balance(a), h: balance(h)}
    results = simultaneously([(a, accept(src))] * 4 + [(a, read(src))] * 4)
    assert not [r for r in results if 'error' in r], results
    assert {r['status'] for r in results} <= ALLOWED, results
    end = time.monotonic() + 15
    while time.monotonic() < end and facts(src)[0]['outcome'] is None:
        simultaneously([(a, read(src)), (a, read(src))])
        time.sleep(0.5)
    row, games, stray, charges, seats = facts(src)
    assert row['outcome'] == 'matched' and games == 1 and seats == 2, row
    assert sorted(c['payer'] for c in charges) == sorted([a, h]) and len({c['txid'] for c in charges}) == 1, charges
    assert balance(a) == before[a] - COST and balance(h) == before[h] - COST
    print('PASS a person against a horse under simultaneous Yes and reads: one rematch, each charged once', flush=True)


def scenario_decline_races_accept():
    outcomes = set()
    for n in range(6):
        a, b = person(100), person(100)
        src = finished_game(a, b)
        before = {a: balance(a), b: balance(b)}
        assert simultaneously([(a, accept(src))])[0]['status'] == 'waiting_for_opponent'
        simultaneously([(b, accept(src)), (b, decline(src)), (b, accept(src))])
        row = facts(src)[0]
        if row['outcome'] == 'matched':
            assert_matched(src, [a, b], before, f'decline race {n}')
            outcomes.add('matched')
        else:
            assert row['declined_by'] == b and row['outcome'] is None, row
            assert_nothing_charged(src, [a, b], before, f'decline race {n}')
            outcomes.add('declined')
    print(f'PASS Yes and No racing from the same player end whole every time (seen: {sorted(outcomes)})', flush=True)


def scenario_drift_and_dead_session():
    a, b = person(100), person(100)
    src = finished_game(a, b)
    before = {a: balance(a), b: balance(b)}
    knob('session_dead_for', b)
    refused = simultaneously([(b, accept(src))])[0]
    assert 'SESSION_REVOKED' in refused.get('error', ''), refused
    knob('session_dead_for')
    q("CREATE OR REPLACE FUNCTION public.fixture_source_layer() RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 2 $$;")
    results = simultaneously([(a, accept(src)), (b, accept(src))])
    assert not [r for r in results if 'error' in r], results
    row = assert_nothing_charged(src, [a, b], before, 'drift')
    assert row['outcome'] == 'unavailable', row
    q("CREATE OR REPLACE FUNCTION public.fixture_source_layer() RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 1 $$;")
    print('PASS a signed-out session is refused, and a changed buy-in layer charges nobody', flush=True)


try:
    version = run([PG / 'postgres', '--version'])
    assert re.search(r' 1[6-9]\.', version), version
    run([PG / 'initdb', '-D', data, '-U', 'hu_fixture_admin', '--auth-local=trust', '--auth-host=reject',
         '--no-locale', '-E', 'UTF8'])
    with (data / 'postgresql.conf').open('a') as f:
        f.write(f"\nlisten_addresses=''\nunix_socket_directories='{sock}'\nautovacuum=off\nmax_connections=60\n")
    started = True
    run([PG / 'pg_ctl', '-D', data, '-l', cluster / 'server.log', '-w', 'start'])
    run(argv('hu_fixture_admin'),
        'CREATE ROLE postgres LOGIN NOSUPERUSER BYPASSRLS CREATEROLE; GRANT CREATE ON DATABASE postgres TO postgres; '
        'GRANT ALL ON SCHEMA public TO postgres;')
    run(argv('hu_fixture_admin'), 'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; '
        'CREATE ROLE service_role NOLOGIN; GRANT authenticated TO postgres;')
    q(FIX.read_text())
    install()
    scenario_simultaneous_yes_and_repeats(int(os.environ.get('REMATCH_ROUNDS', '12')))
    scenario_interrupted_then_retry('cancel')
    scenario_interrupted_then_retry('disconnect')
    scenario_client_dies_before_reading_answer()
    scenario_short_wallet_concurrent()
    scenario_horse_opponent_concurrent()
    scenario_decline_races_accept()
    scenario_drift_and_dead_session()
    total = q("SELECT count(*) FROM public.fixture_charges")
    print(f'PASS heads-up rematch concurrency: every scenario whole ({total} charges in all)', flush=True)
finally:
    for p in children:
        if p.poll() is None:
            p.kill()
    if started:
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], env=env, capture_output=True)
