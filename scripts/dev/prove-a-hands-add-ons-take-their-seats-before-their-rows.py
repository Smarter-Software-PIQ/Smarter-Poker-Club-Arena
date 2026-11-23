"""Native proof for migration 20261123023325 (a hand's add-ons take their seats
before their rows). Runs on a THROWAWAY local PostgreSQL cluster it creates and
removes; it never connects to any other database.

The post-commit envelope is rebuilt byte for byte as production holds it
(md5 39d75365156c46476bfe01854d3c86b9, read from production on 2026-11-23: the
production text in
scripts/ci/fixtures/cash-rake-pending/live-definitions.json through
20261118035606, 20261118071736 and 20261118073646), and resolve_pending_addon
as production holds it (md5 0abfcda28173f8251b4b3cff0ad52be6, from
tests/fixtures/promo-profit-movements/money-owners.json). The other side of
each cycle is the next hand's commit, using the two statements production's
lock-wait lines name: fn_lightning_settle_hand line 242 (an anchor seat FOR
UPDATE) and fn_ca_commit_hand_settlement line 649 (the table's unresolved
add-ons FOR UPDATE, ORDER BY created_at, id).

  CASE 1, the production cycle. The commit holds the player's seat; the
          envelope delivering that player's top-up locks the add-on, then
          waits for the seat; the commit then waits for the add-on.
          BEFORE: deadlock detected (40P01). AFTER: the envelope waits for the
          seat holding nothing the commit needs; both commit, no deadlock.
  CASE 2, two add-ons of one table in reverse order. The envelope took them
          in uuid text order, the commit door by created_at, id.
          BEFORE: deadlock detected. AFTER: both commit, no deadlock.
  CASE 3, outcomes. Five serial cases (a fitting top-up, two top-ups capped by
          the buy-in ceiling, a vacated seat, a replayed resolved add-on, a
          foreign add-on) leave byte-identical rows and answers before and
          after.

Usage (as root, which runs the cluster as the postgres user, or as a user that
may run postgres):
  PG_BIN=/usr/lib/postgresql/16/bin python3 scripts/dev/prove-a-hands-add-ons-take-their-seats-before-their-rows.py
"""
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / 'supabase' / 'migrations'
FIXTURE = ROOT / 'scripts' / 'ci' / 'fixtures' / 'cash-rake-pending' / 'live-definitions.json'
RESOLVE_FIXTURE = ROOT / 'tests' / 'fixtures' / 'promo-profit-movements' / 'money-owners.json'
EDITS = (
    ('20261118035606_a_cash_hand_never_waits_on_a_tournament_wallet_lock.sql', ('env0',)),
    ('20261118071736_a_cash_hand_never_waits_on_the_union_bbj_pool_or_insurance_b.sql', ('env0', 'env1', 'env2')),
)
CONVOY = MIGRATIONS / '20261118073646_a_post_commit_envelope_never_queues_behind_a_slow_predecesso.sql'
CANDIDATE = MIGRATIONS / '20261123023325_a_hands_add_ons_take_their_seats_before_their_rows.sql'
SIG = 'public.fn_ca_process_hand_post_commit_obligations(uuid)'
LIVE_MD5 = '39d75365156c46476bfe01854d3c86b9'
RESOLVE_MD5 = '0abfcda28173f8251b4b3cff0ad52be6'
POST_MD5 = '16332f6377e82b717505f846e046af32'

pg = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/16/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
as_owner = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
work = pathlib.Path(tempfile.mkdtemp(prefix='seats-first-'))
sock = work / 'socket'
sock.mkdir(mode=0o700)
if as_owner:
    shutil.chown(work, 'postgres')
    shutil.chown(sock, 'postgres')
PORT = '55851'
LOG = work / 'log'
DB = 'seatsfirst'
checks = []

CLUB = 'a0000000-0000-4000-8000-000000000001'
H = 'c0000000-0000-4000-8000-0000000000a1'
OTHER_TABLE = 'c0000000-0000-4000-8000-0000000000b2'
U1, U2, U3 = (f'10000000-0000-4000-8000-00000000000{n}' for n in (1, 2, 3))
S1, S2, S3 = (f'50000000-0000-4000-8000-00000000000{n}' for n in (1, 2, 3))
HAND = 'e0000000-0000-4000-8000-000000000001'


def psql():
    return [pg / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', PORT, '-U', 'postgres', '-d', DB]


def command(argv, sql=None):
    r = subprocess.run(list(map(str, argv)), input=sql, text=True, capture_output=True, env=env, timeout=180)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def run(sql):
    return command(psql(), sql)


def attempt(sql):
    """One session; returns (returncode, stdout, stderr)."""
    r = subprocess.run(list(map(str, psql())), input=sql, text=True, capture_output=True, env=env, timeout=180)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def check(name, passed, detail=None):
    checks.append(name)
    print(('ok   ' if passed else 'FAIL ') + name + ('' if passed else f'  {detail}'))
    if not passed:
        raise AssertionError(f'{name}: {detail}')


def live_envelope():
    text = json.loads(FIXTURE.read_text())['functions']['fn_ca_process_hand_post_commit_obligations']['definition']
    for name, tags in EDITS:
        sql = (MIGRATIONS / name).read_text()
        for tag in tags:
            old, new = sql.split(f'$o{tag}$')[1], sql.split(f'$n{tag}$')[1]
            assert text.count(old) == 1, (name, tag)
            text = text.replace(old, new)
    sql = CONVOY.read_text()
    for i in range(1, 8):
        old, new = sql.split(f'$o{i}$')[1], sql.split(f'$n{i}$')[1]
        assert text.count(old) == 1, ('convoy', i)
        text = text.replace(old, new)
    assert hashlib.md5(text.encode()).hexdigest() == LIVE_MD5
    return text


def live_resolver():
    rows = json.loads(RESOLVE_FIXTURE.read_text())
    text = next(r['definition'] for r in rows if r['signature'] == 'resolve_pending_addon(uuid,numeric)')
    assert hashlib.md5(text.encode()).hexdigest() == RESOLVE_MD5
    return text


SCHEMA = f"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA extensions; CREATE SCHEMA smarter_private;
CREATE EXTENSION pgcrypto SCHEMA extensions;
-- A cash table outside any tournament: the lane is a no-op, as in production.
CREATE FUNCTION smarter_private.f06_wait_table_lane(p_table_id uuid) RETURNS void
  LANGUAGE sql AS $$ SELECT $$;
CREATE TABLE public.clubs(id uuid PRIMARY KEY, union_id uuid, asset text DEFAULT 'chips');
CREATE TABLE public.tables(id uuid PRIMARY KEY, club_id uuid REFERENCES public.clubs(id), tournament_id uuid,
  union_id uuid, is_private boolean DEFAULT false, min_buy_in numeric DEFAULT 40, big_blind numeric DEFAULT 2);
CREATE TABLE public.union_wallets(union_id uuid PRIMARY KEY, insurance_wallet numeric NOT NULL DEFAULT 0);
CREATE TABLE public.hand_bank_obligation_pending(hand_id uuid, kind text, item_key text, table_id uuid,
  hand_number bigint, union_id uuid, felt_amount numeric, obligation jsonb, PRIMARY KEY (hand_id, kind, item_key));
CREATE TABLE public.cash_rake_pending(hand_id uuid PRIMARY KEY, table_id uuid, hand_number bigint,
  amount numeric, rake jsonb);
CREATE TABLE public.union_pnl_cash_outcomes(table_id uuid, hand_number bigint, evidence jsonb);
CREATE TABLE public.hand_atomic_commits(
  table_id uuid NOT NULL, hand_number bigint NOT NULL, hand_id uuid NOT NULL UNIQUE,
  committed_at timestamptz NOT NULL DEFAULT now(), post_commit_payload jsonb,
  post_commit_payload_hash text, post_commit_completed_at timestamptz, post_commit_result jsonb,
  PRIMARY KEY (table_id, hand_number));
CREATE TABLE public.table_seats(id uuid PRIMARY KEY, table_id uuid, user_id uuid, stack numeric,
  left_at timestamptz, occupancy_id uuid DEFAULT gen_random_uuid());
CREATE UNIQUE INDEX idx_unique_active_user_per_table ON public.table_seats (table_id, user_id) WHERE left_at IS NULL;
CREATE TABLE public.table_pending_addons(id uuid PRIMARY KEY, table_id uuid, user_id uuid, amount numeric,
  created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, applied_to_stack numeric,
  refunded numeric, kind text DEFAULT 'addon');
-- resolve_pending_addon's three callees, recording what they were asked to do.
CREATE TABLE public.callee_log(id bigserial PRIMARY KEY, fn text, args text);
CREATE FUNCTION public.fn_cash_session_add_baseline(p_user uuid, p_table uuid, p_amount numeric) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.callee_log(fn, args) VALUES ('baseline', concat_ws(',', p_user, p_table, p_amount)) $$;
CREATE FUNCTION public.atomic_credit_wallet_and_log(p_user uuid, p_amount numeric, p_kind text, p_note text,
  p_table uuid, p_a uuid, p_b uuid, p_key text) RETURNS jsonb
  LANGUAGE sql AS $$ INSERT INTO public.callee_log(fn, args) VALUES ('credit', concat_ws(',', p_user, p_amount, p_kind, p_table, p_key)) RETURNING '{{}}'::jsonb $$;
CREATE FUNCTION public.fn_cash_record_funding_application(p_pending uuid, p_applied numeric, p_refunded numeric,
  p_occupancy uuid) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.callee_log(fn, args) VALUES ('funding', concat_ws(',', p_pending, p_applied, p_refunded)) $$;
INSERT INTO public.clubs(id) VALUES ('{CLUB}');
INSERT INTO public.tables(id, club_id) VALUES ('{H}', '{CLUB}'), ('{OTHER_TABLE}', '{CLUB}');
"""


def seed(seats, addons, ids=None, max_buy_in=1000):
    """seats: [(seat id, user, stack, left)], addons: [(id, user, amount, seconds ago, resolved, table)].
    One committed hand at H whose envelope freezes `ids` (default: the add-ons at H by created_at, id)."""
    sql = ['TRUNCATE public.hand_atomic_commits, public.table_seats, public.table_pending_addons, public.callee_log;']
    for sid, uid, stack, left in seats:
        sql.append(f"INSERT INTO public.table_seats(id, table_id, user_id, stack, left_at) VALUES "
                   f"('{sid}', '{H}', '{uid}', {stack}, {'now()' if left else 'NULL'});")
    for aid, uid, amount, ago, resolved, table in addons:
        sql.append(f"INSERT INTO public.table_pending_addons(id, table_id, user_id, amount, created_at, resolved_at, "
                   f"applied_to_stack, refunded) VALUES ('{aid}', '{table or H}', '{uid}', {amount}, "
                   f"now() - interval '{ago} seconds', {'now()' if resolved else 'NULL'}, "
                   f"{amount if resolved else 'NULL'}, {0 if resolved else 'NULL'});")
    frozen = ("(SELECT jsonb_agg(a.id ORDER BY a.created_at, a.id) FROM public.table_pending_addons a "
              f"WHERE a.table_id = '{H}' AND a.resolved_at IS NULL)") if ids is None else \
        f"'{json.dumps(ids)}'::jsonb"
    sql.append(f"""
WITH p AS (SELECT jsonb_build_object('version', 1, 'time_banks', '[]'::jsonb, 'rake', null,
    'bbj_contribution', null, 'promo_playthrough', '[]'::jsonb, 'insurance', '[]'::jsonb,
    'pending_addons', jsonb_build_object('enabled', true, 'max_buy_in', {max_buy_in},
                                         'ids', COALESCE({frozen}, '[]'::jsonb))) AS v)
INSERT INTO public.hand_atomic_commits(table_id, hand_number, hand_id, post_commit_payload, post_commit_payload_hash)
SELECT '{H}', 1, '{HAND}', p.v, encode(extensions.digest(convert_to(p.v::text, 'UTF8'), 'sha256'), 'hex') FROM p;""")
    run('\n'.join(sql))


ENVELOPE = (f"SET lock_timeout = '7s'; SET statement_timeout = '15s';\n"
            f"SELECT public.fn_ca_process_hand_post_commit_obligations('{HAND}')::text;\n")


def commit_door(seat, hold=0.8):
    """The next hand's commit: its seat (fn_lightning_settle_hand line 242), then
    the table's unresolved add-ons (fn_ca_commit_hand_settlement line 649)."""
    return (f"SET lock_timeout = '7s'; SET statement_timeout = '15s'; BEGIN;\n"
            f"SELECT ts.id FROM public.table_seats ts WHERE ts.id = '{seat}' FOR UPDATE;\n"
            f"SELECT pg_sleep({hold});\n"
            f"SELECT count(*) FROM (SELECT 1 FROM public.table_pending_addons a WHERE a.table_id = '{H}' "
            f"AND a.resolved_at IS NULL AND a.created_at <= transaction_timestamp() "
            f"ORDER BY a.created_at, a.id FOR UPDATE) x;\n"
            f"UPDATE public.table_seats SET stack = stack WHERE id = '{seat}';\nCOMMIT;\nSELECT 'committed';\n")


def concurrently(*sessions):
    """sessions: (name, start delay seconds, sql). Returns {name: (code, stdout, stderr)}."""
    answers = {}

    def go(name, delay, sql):
        time.sleep(delay)
        answers[name] = attempt(sql)

    threads = [threading.Thread(target=go, args=s) for s in sessions]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return answers


def deadlocks():
    return LOG.read_text().count('ERROR:  deadlock detected')


def case_1():
    """The production cycle: one top-up, the next hand committing on its chair."""
    seed([(S1, U1, 100, False)], [('a0000000-0000-4000-8000-000000000001', U1, 50, 5, False, None)])
    before = deadlocks()
    answers = concurrently(('commit', 0.0, commit_door(S1)), ('envelope', 0.3, ENVELOPE))
    return answers, deadlocks() - before


def case_2():
    """Two top-ups at one table whose uuid order is the reverse of their created_at
    order. A third session holds the second player's seat for a moment, so the
    envelope is caught between its two add-ons while the commit freezes both."""
    early_high = 'f0000000-0000-4000-8000-0000000000aa'   # U1, created first, sorts last
    late_low = '00000000-0000-4000-8000-0000000000bb'     # U2, created later, sorts first
    seed([(S1, U1, 100, False), (S2, U2, 100, False), (S3, U3, 100, False)],
         [(early_high, U1, 30, 9, False, None), (late_low, U2, 30, 5, False, None)])
    holder = (f"BEGIN; SELECT 1 FROM public.table_seats WHERE id = '{S2}' FOR UPDATE;\n"
              "SELECT pg_sleep(0.7);\nCOMMIT;\nSELECT 'released';\n")
    before = deadlocks()
    answers = concurrently(('holder', 0.0, holder), ('envelope', 0.15, ENVELOPE),
                           ('commit', 0.35, commit_door(S3, hold=0.0)))
    return answers, deadlocks() - before


OUTCOME_CASES = {
    'one top-up that fits': (
        [(S1, U1, 100, False)], [('a1000000-0000-4000-8000-000000000001', U1, 50, 5, False, None)], None, 1000),
    'two top-ups capped by the ceiling': (
        [(S1, U1, 90, False)],
        [('f1000000-0000-4000-8000-000000000001', U1, 20, 9, False, None),
         ('01000000-0000-4000-8000-000000000002', U1, 5, 5, False, None)], None, 100),
    'a vacated seat is refunded whole': (
        [(S1, U1, 100, True)], [('a2000000-0000-4000-8000-000000000001', U1, 40, 5, False, None)], None, 1000),
    'a replayed resolved add-on and a new one': (
        [(S1, U1, 100, False), (S2, U2, 60, False)],
        [('a3000000-0000-4000-8000-000000000001', U1, 25, 9, True, None),
         ('a3000000-0000-4000-8000-000000000002', U2, 70, 5, False, None)],
        ['a3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002'], 100),
    "an add-on of another table is refused": (
        [(S1, U1, 100, False)], [('a4000000-0000-4000-8000-000000000001', U1, 25, 5, False, OTHER_TABLE)],
        ['a4000000-0000-4000-8000-000000000001'], 1000),
}


def outcomes():
    seen = {}
    for name, (seats, addons, ids, cap) in OUTCOME_CASES.items():
        seed(seats, addons, ids, cap)
        code, out, err = attempt(ENVELOPE)
        answer = json.loads(out) if code == 0 and out else {'error': err.splitlines()[0] if err else code}
        answer.pop('completed_at', None)
        rows = run("SELECT coalesce(json_agg(x ORDER BY x.id)::text, '[]') FROM (SELECT id, amount, resolved_at IS NOT NULL AS resolved, "
                   "applied_to_stack, refunded FROM public.table_pending_addons) x")
        stacks = run("SELECT coalesce(json_agg(x ORDER BY x.id)::text, '[]') FROM (SELECT id, stack FROM public.table_seats) x")
        calls = run("SELECT coalesce(json_agg(x ORDER BY x.id)::text, '[]') FROM (SELECT id, fn, args FROM public.callee_log) x")
        calls = [{'fn': c['fn'], 'args': c['args']} for c in json.loads(calls)]
        seen[name] = {'answer': answer, 'addons': json.loads(rows), 'stacks': json.loads(stacks),
                      'callees': calls}
    return seen


def died(answer):
    return answer[0] != 0 and 'deadlock detected' in answer[2]


try:
    command(as_owner + [pg / 'initdb', '-D', work / 'data', '-A', 'trust', '-U', 'postgres'])
    command(as_owner + [pg / 'pg_ctl', '-D', work / 'data', '-o',
                        f"-k {sock} -p {PORT} -c listen_addresses='' -c deadlock_timeout=1s",
                        '-l', LOG, '-w', 'start'])
    command([pg / 'psql', '-X', '-qAt', '-h', sock, '-p', PORT, '-U', 'postgres', '-d', 'postgres',
             '-c', f'CREATE DATABASE {DB}'])
    run(SCHEMA)
    run(live_resolver())
    run(live_envelope())
    md5 = lambda: run(f"SELECT md5(pg_get_functiondef('{SIG}'::regprocedure))")
    check('the rebuilt envelope is production\'s (md5 39d75365...)', md5() == LIVE_MD5, md5())

    # ---- BEFORE ------------------------------------------------------------
    b1, b1_dead = case_1()
    print('BEFORE case 1:', json.dumps({k: (v[0], v[1][-120:], v[2][-160:]) for k, v in b1.items()}))
    check('BEFORE case 1: the envelope and the next commit deadlock (40P01)',
          b1_dead == 1 and (died(b1['envelope']) or died(b1['commit'])), b1)
    b2, b2_dead = case_2()
    print('BEFORE case 2:', json.dumps({k: (v[0], v[1][-120:], v[2][-160:]) for k, v in b2.items()}))
    check('BEFORE case 2: two add-ons taken in reverse order deadlock (40P01)',
          b2_dead == 1 and (died(b2['envelope']) or died(b2['commit'])), b2)
    before_outcomes = outcomes()

    # ---- the migration, exactly as it ships --------------------------------
    run(CANDIDATE.read_text())
    after_md5 = md5()
    check('the migration installs on the production text, as the pinned postimage', after_md5 == POST_MD5, after_md5)

    # ---- AFTER -------------------------------------------------------------
    a1, a1_dead = case_1()
    print('AFTER  case 1:', json.dumps({k: (v[0], v[1][-120:], v[2][-160:]) for k, v in a1.items()}))
    env_answer = json.loads(a1['envelope'][1].splitlines()[-1]) if a1['envelope'][0] == 0 else {}
    check('AFTER case 1: no deadlock; the commit commits', a1_dead == 0 and a1['commit'][1].endswith('committed'), a1)
    delivered = (run(f"SELECT stack FROM public.table_seats WHERE id = '{S1}'"),
                 run("SELECT count(*) FROM public.callee_log WHERE fn = 'funding'"))
    check('AFTER case 1: the envelope completes and delivers the top-up once',
          env_answer.get('ok') is True and env_answer.get('pending_addons') == 1
          and delivered == ('150.00', '1'), (env_answer, delivered))
    a2, a2_dead = case_2()
    print('AFTER  case 2:', json.dumps({k: (v[0], v[1][-120:], v[2][-160:]) for k, v in a2.items()}))
    env_answer = json.loads(a2['envelope'][1].splitlines()[-1]) if a2['envelope'][0] == 0 else {}
    check('AFTER case 2: no deadlock; the commit commits', a2_dead == 0 and a2['commit'][1].endswith('committed'), a2)
    check('AFTER case 2: the envelope completes and delivers both top-ups once',
          env_answer.get('ok') is True and env_answer.get('pending_addons') == 2
          and run("SELECT count(*) FROM public.callee_log WHERE fn = 'funding'") == '2', env_answer)
    after_outcomes = outcomes()
    for name in OUTCOME_CASES:
        check(f'CASE 3 ({name}): identical answer, add-on rows, stacks and callee calls',
              before_outcomes[name] == after_outcomes[name],
              {'before': before_outcomes[name], 'after': after_outcomes[name]})
    print(json.dumps(after_outcomes, indent=1, default=str)[:2400])
    print(f'PROOF OK ({len(checks)} checks)')
finally:
    try:
        command(as_owner + [pg / 'pg_ctl', '-D', work / 'data', '-m', 'immediate', 'stop'])
    except Exception:
        pass
    shutil.rmtree(work, ignore_errors=True)
