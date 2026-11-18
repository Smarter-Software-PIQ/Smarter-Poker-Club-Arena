"""Isolated PostgreSQL regression for the post-commit envelope convoy (incident
075013fd, 2026-11-18, LightningHandHost.post_commit_obligations_pending).

A Lightning host table commits many hands at once. When one hand's post-commit
envelope ran slowly, every later hand of the table queued on the per-table
advisory lock until the statement timeout, only to learn under the lock that
an earlier envelope was still open. This proof rebuilds the envelope exactly as
production will hold it before the candidate (the 20261118071736 postimage,
md5 7a796358fa28fda910e0f28ded72ff79: the production text in
scripts/ci/fixtures/cash-rake-pending/live-definitions.json through
20261118035606 and 20261118071736), then:

  BEFORE  one slow predecessor and many concurrent successors: successors
          time out (57014) waiting on the lock; a held member row times the
          envelope out too.
  AFTER   (migration 20261118073646) the same interleaving: zero statement
          timeouts; successors answer predecessor_pending at once, naming the
          oldest open hand; a second caller of the running hand answers
          table_busy within the bounded wait; a held row answers
          obligation_lock_busy with nothing written; a held player_stats row
          (which promo_apply_playthrough's upsert would swallow an error on)
          answers obligation_lock_busy too and its stat is never dropped; the
          caller's
          lock_timeout is restored and callees run with it (never shortened);
          a caller holding the table mutex as fn_project_hand_side_effects does
          gets obligation_lock_busy in a usable transaction; #11266's busy
          insurance bank (55P03) answers obligation_lock_busy and stores one leg
          once free; a caller already
          holding the table mutex
          re-enters; and draining the table afterwards applies every hand
          exactly once, in hand order.

An empty throwaway cluster on a Unix socket; no network, no production
connection.
"""
import argparse
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
SWITCH = MIGRATIONS / '20261118035606_a_cash_hand_never_waits_on_a_tournament_wallet_lock.sql'
BANK_SWITCH = MIGRATIONS / '20261118071736_a_cash_hand_never_waits_on_the_union_bbj_pool_or_insurance_b.sql'
CANDIDATE = MIGRATIONS / '20261118073646_a_post_commit_envelope_never_queues_behind_a_slow_predecesso.sql'
SIG = 'public.fn_ca_process_hand_post_commit_obligations(uuid)'
PRE = '7a796358fa28fda910e0f28ded72ff79'
POST = '39d75365156c46476bfe01854d3c86b9'

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'artifacts/post-commit-envelope-convoy')
parser.add_argument('--successors', type=int, default=24)
args = parser.parse_args()
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)
pg = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
as_owner = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
cluster = pathlib.Path(tempfile.mkdtemp(prefix='envelope-convoy-'))
sock = cluster / 'socket'
sock.mkdir(mode=0o700)
if as_owner:
    shutil.chown(cluster, 'postgres')
    shutil.chown(sock, 'postgres')
PORT = '55841'
LOG = cluster / 'log'
DB = 'convoy'
results = {'checks': [], 'production_mutations': False}

T = 'c0000000-0000-0000-0000-0000000000a1'
CLUB = 'a0000000-0000-0000-0000-000000000001'
UNION = 'b0000000-0000-0000-0000-000000000001'
U = '10000000-0000-0000-0000-00000000000a'
SLOW_SECONDS = 3
SUCCESSOR_TIMEOUT = '2s'


def hand_id(n):
    return f'e0000000-0000-0000-0000-{n:012d}'


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
    """One session; returns (returncode, stdout, stderr, seconds)."""
    started = time.monotonic()
    r = subprocess.run(list(map(str, psql())), input=sql, text=True, capture_output=True, env=env, timeout=180)
    return r.returncode, r.stdout.strip(), r.stderr.strip(), time.monotonic() - started


def check(name, passed, detail=None):
    results['checks'].append({'name': name, 'passed': bool(passed), 'detail': detail})
    if not passed:
        raise AssertionError(f'{name}: {detail}')


def postimage_before():
    live = json.loads(FIXTURE.read_text())['functions']['fn_ca_process_hand_post_commit_obligations']['definition']
    text = live
    for path, tags in ((SWITCH, ('env0',)), (BANK_SWITCH, ('env0', 'env1', 'env2'))):
        sql = path.read_text()
        for tag in tags:
            old, new = sql.split(f'$o{tag}$')[1], sql.split(f'$n{tag}$')[1]
            assert text.count(old) == 1, (path.name, tag)
            text = text.replace(old, new)
    assert hashlib.md5(text.encode()).hexdigest() == PRE
    return text


F06_LANE = """
CREATE OR REPLACE FUNCTION smarter_private.f06_wait_table_lane(p_table_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' SET lock_timeout TO '4s'
AS $function$
DECLARE t uuid;
BEGIN
  IF p_table_id IS NULL THEN RETURN; END IF;
  SELECT tb.tournament_id INTO t FROM public.tables tb WHERE tb.id = p_table_id;
  IF t IS NULL THEN RETURN; END IF;
  BEGIN
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('ca:tournament-terminal-settlement:v1', 0));
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('ca:tournament-terminal-settlement:v1:' || t::text, 0));
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'F06_RETRY_CANONICAL_LANE' USING ERRCODE = '55P03';
  END;
END
$function$;
"""

SCHEMA = f"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA extensions; CREATE SCHEMA smarter_private;
CREATE EXTENSION pgcrypto SCHEMA extensions;
CREATE TABLE public.clubs(id uuid PRIMARY KEY, union_id uuid, asset text DEFAULT 'chips');
CREATE TABLE public.tables(id uuid PRIMARY KEY, club_id uuid REFERENCES public.clubs(id), tournament_id uuid,
  union_id uuid, is_private boolean DEFAULT false);
-- #11266's insurance step: the union bank row it reads and the stored legs.
CREATE TABLE public.union_wallets(union_id uuid PRIMARY KEY, insurance_wallet numeric NOT NULL DEFAULT 0);
CREATE TABLE public.hand_bank_obligation_pending(hand_id uuid, kind text, item_key text, table_id uuid,
  hand_number bigint, union_id uuid, felt_amount numeric, obligation jsonb, PRIMARY KEY (hand_id, kind, item_key));
CREATE TABLE public.hand_atomic_commits(
  table_id uuid NOT NULL, hand_number bigint NOT NULL, hand_id uuid NOT NULL UNIQUE,
  payload_hash text NOT NULL DEFAULT '', stack_result jsonb NOT NULL DEFAULT '{{}}',
  committed_at timestamptz NOT NULL DEFAULT now(), post_commit_payload jsonb,
  post_commit_request_hash text, post_commit_payload_hash text,
  post_commit_completed_at timestamptz, post_commit_result jsonb,
  PRIMARY KEY (table_id, hand_number));
CREATE INDEX idx_hand_atomic_commits_post_commit_pending ON public.hand_atomic_commits (table_id, hand_number)
  WHERE post_commit_payload IS NOT NULL AND post_commit_completed_at IS NULL;
CREATE TABLE public.table_pending_addons(id uuid PRIMARY KEY, table_id uuid, amount numeric,
  resolved_at timestamptz, applied_to_stack numeric, refunded numeric);
CREATE TABLE public.union_pnl_cash_outcomes(table_id uuid, hand_number bigint, evidence jsonb);
CREATE TABLE public.cash_rake_pending(hand_id uuid PRIMARY KEY, table_id uuid, hand_number bigint,
  amount numeric, rake jsonb);
-- The promo step's callee in production's shape (read 2026-11-18): its
-- player_stats upsert is wrapped in EXCEPTION WHEN OTHERS THEN NULL (an error
-- there is swallowed and the stat silently dropped), then it locks the
-- player's club_members row FOR UPDATE and updates it. It can be made slow,
-- and leaves one receipt per call so exactly-once is countable.
CREATE TABLE public.player_stats(user_id uuid, club_id uuid, total_losses numeric NOT NULL DEFAULT 0,
  UNIQUE (user_id, club_id));
CREATE TABLE public.club_members(club_id uuid, user_id uuid, wagered numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (club_id, user_id));
CREATE VIEW public.members AS SELECT user_id, wagered FROM public.club_members;
CREATE TABLE public.promo_receipts(id bigserial PRIMARY KEY, user_id uuid, wagered numeric,
  lock_timeout text DEFAULT current_setting('lock_timeout'));
CREATE TABLE public.slow_promo(user_id uuid PRIMARY KEY, seconds numeric);
CREATE FUNCTION public.promo_apply_playthrough(p_club uuid, p_user uuid, p_wagered numeric)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE s numeric;
BEGIN
  BEGIN
    INSERT INTO public.player_stats(user_id, club_id, total_losses) VALUES (p_user, p_club, p_wagered)
    ON CONFLICT (user_id, club_id) DO UPDATE SET total_losses = player_stats.total_losses + EXCLUDED.total_losses;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  PERFORM 1 FROM public.club_members WHERE club_id = p_club AND user_id = p_user FOR UPDATE;
  UPDATE public.club_members SET wagered = wagered + p_wagered WHERE club_id = p_club AND user_id = p_user;
  INSERT INTO public.promo_receipts(user_id, wagered) VALUES (p_user, p_wagered);
  SELECT seconds INTO s FROM public.slow_promo WHERE user_id = p_user;
  IF s IS NOT NULL THEN PERFORM pg_sleep(s); END IF;
  RETURN jsonb_build_object('ok', true);
END $$;
INSERT INTO public.clubs(id, union_id) VALUES ('{CLUB}', '{UNION}');
INSERT INTO public.union_wallets(union_id, insurance_wallet) VALUES ('{UNION}', 100);
INSERT INTO public.tables(id, club_id) VALUES ('{T}', '{CLUB}');
"""


def user(n):
    return f'10000000-0000-0000-0000-{n:012d}'


def seed(count, slow_hand=1):
    """`count` committed hands at one table, each with one promo obligation for
    its own player; the first hand's player is slow."""
    rows = []
    for n in range(1, count + 1):
        rows.append(f"""
INSERT INTO public.club_members(club_id, user_id) VALUES ('{CLUB}', '{user(n)}') ON CONFLICT DO NOTHING;
INSERT INTO public.player_stats(user_id, club_id) VALUES ('{user(n)}', '{CLUB}') ON CONFLICT DO NOTHING;
WITH p AS (SELECT jsonb_build_object(
    'rake', null, 'bbj_contribution', null, 'pending_addons', null, 'insurance', '[]'::jsonb,
    'time_banks', '[]'::jsonb,
    'promo_playthrough', jsonb_build_array(jsonb_build_object(
        'club_id', '{CLUB}', 'user_id', '{user(n)}', 'wagered', {n}))) AS v)
INSERT INTO public.hand_atomic_commits(table_id, hand_number, hand_id, committed_at, post_commit_payload,
  post_commit_payload_hash)
SELECT '{T}', {1000 + n}, '{hand_id(n)}', now() - interval '{count - n} seconds', p.v,
  encode(extensions.digest(convert_to(p.v::text, 'UTF8'), 'sha256'), 'hex') FROM p;""")
    run('TRUNCATE public.hand_atomic_commits, public.promo_receipts, public.slow_promo; '
        'UPDATE public.club_members SET wagered = 0; UPDATE public.player_stats SET total_losses = 0;' + ''.join(rows) +
        f"INSERT INTO public.slow_promo VALUES ('{user(slow_hand)}', {SLOW_SECONDS});")


# The answer contract a caller speaks (20261118073646). PostgREST exposes the
# request's headers as the transaction setting request.headers; contract 2 is
# the header x-ca-post-commit-contract: 2 (the new engine), contract 1 is no
# header (today's engine, a rolled-back build, every SQL caller).
CONTRACT = {'v': 2}
LEGACY_REASONS = {'ok', 'predecessor_pending', 'not_found', 'legacy_no_obligations'}


def speak():
    if CONTRACT['v'] >= 2:
        return ' SET "request.headers" TO \'{"x-ca-post-commit-contract": "2"}\';'
    return ''


def call(n, timeout=SUCCESSOR_TIMEOUT, pre=" SET lock_timeout = '7s';"):
    return attempt(f"SET statement_timeout = '{timeout}';{pre}{speak()}\n"
                   f"SELECT public.fn_ca_process_hand_post_commit_obligations('{hand_id(n)}')::text;\n")


def convoy(successors):
    """Hand 1 runs slowly; while it holds the table, `successors` later hands
    and one more caller of hand 1 itself arrive at once."""
    seed(successors + 1)
    answers = {}

    def go(key, n, timeout):
        answers[key] = call(n, timeout)

    head = threading.Thread(target=go, args=('head', 1, '8s'))
    head.start()
    time.sleep(0.4)
    threads = [threading.Thread(target=go, args=(f's{n}', n, SUCCESSOR_TIMEOUT)) for n in range(2, successors + 2)]
    threads.append(threading.Thread(target=go, args=('helper', 1, SUCCESSOR_TIMEOUT)))
    for t in threads:
        t.start()
    for t in threads + [head]:
        t.join()
    timeouts = sum('statement timeout' in a[2] for a in answers.values())
    return answers, timeouts


def reason(answer):
    code, stdout, stderr, _ = answer
    if code != 0 or not stdout:
        return 'error: ' + stderr[-200:]
    return json.loads(stdout).get('reason') or ('ok' if json.loads(stdout).get('ok') else '?')


def drain(count):
    """The table drained afterwards, oldest first, one call per hand."""
    for n in range(1, count + 1):
        code, stdout, stderr, _ = call(n, '8s')
        check(f'drain: hand {n} completes', code == 0 and json.loads(stdout).get('ok') is True, stdout or stderr)
    receipts = run('SELECT count(*), count(DISTINCT user_id) FROM public.promo_receipts')
    order = run("SELECT bool_and(prev IS NULL OR prev <= post_commit_completed_at) FROM ("
                "SELECT post_commit_completed_at, lag(post_commit_completed_at) OVER (ORDER BY hand_number) prev "
                f"FROM public.hand_atomic_commits WHERE table_id = '{T}') x")
    wagered = run('SELECT sum(wagered) FROM public.members')
    return receipts, order, wagered


def held_member_row(timeout, row='club_members', sql=None):
    """Another transaction holds one of hand 2's player rows; hand 1 has completed."""
    seed(2, slow_hand=99)
    check('setup: hand 1 completes', reason(call(1, '8s')) == 'ok')
    holder = subprocess.Popen(list(map(str, psql())), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, env=env)
    holder.stdin.write(f"BEGIN; SELECT 1 FROM public.{row} WHERE user_id = '{user(2)}' FOR UPDATE;\n"
                       "SELECT pg_sleep(6);\nCOMMIT;\n")
    holder.stdin.flush()
    time.sleep(0.4)
    answer = attempt(sql) if sql else call(2, timeout, pre=" SET lock_timeout = '7s';")
    holder.stdin.close()
    holder.wait(timeout=60)
    return answer


def insurance_bank_busy():
    """#11266: a net insurance payout TRIES the union's 'insurance-bank:' lock
    and raises 55P03 when another session holds it. The envelope must answer
    obligation_lock_busy (retry), store nothing, and apply once when free."""
    run('TRUNCATE public.hand_atomic_commits, public.hand_bank_obligation_pending;')
    run(f"""
WITH p AS (SELECT jsonb_build_object(
    'rake', null, 'bbj_contribution', null, 'pending_addons', null, 'time_banks', '[]'::jsonb,
    'promo_playthrough', '[]'::jsonb,
    'insurance', jsonb_build_array(jsonb_build_object('club_id', '{CLUB}', 'player_id', '{user(1)}',
        'premium', 0, 'payout', 5, 'insured_amount', 10, 'equity_percent', 50, 'kind', 'insurance'))) AS v)
INSERT INTO public.hand_atomic_commits(table_id, hand_number, hand_id, post_commit_payload, post_commit_payload_hash)
SELECT '{T}', 5001, '{hand_id(1)}', p.v, encode(extensions.digest(convert_to(p.v::text, 'UTF8'), 'sha256'), 'hex') FROM p;""")
    holder = subprocess.Popen(list(map(str, psql())), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, env=env)
    holder.stdin.write(f"SELECT pg_advisory_lock(hashtextextended('insurance-bank:{UNION}', 0));\n"
                       "SELECT pg_sleep(3);\n")
    holder.stdin.flush()
    time.sleep(0.4)
    busy = call(1, SUCCESSOR_TIMEOUT)
    holder.stdin.close()
    holder.wait(timeout=60)
    stored_while_busy = run('SELECT count(*) FROM public.hand_bank_obligation_pending')
    after = call(1, '8s')
    again = call(1, '8s')
    stored = run("SELECT count(*), sum(felt_amount) FROM public.hand_bank_obligation_pending WHERE kind = 'insurance'")
    return busy, stored_while_busy, after, again, stored


try:
    command(as_owner + [pg / 'initdb', '-D', cluster / 'data', '-A', 'trust', '-U', 'postgres'])
    command(as_owner + [pg / 'pg_ctl', '-D', cluster / 'data', '-o',
                        f"-k {sock} -p {PORT} -c listen_addresses='' -c max_connections=200",
                        '-l', LOG, '-w', 'start'])
    command([pg / 'psql', '-X', '-qAt', '-h', sock, '-p', PORT, '-U', 'postgres', '-d', 'postgres',
             '-c', f'CREATE DATABASE {DB}'])
    run(SCHEMA)
    run(F06_LANE)
    run(postimage_before() + ';\n'
        f'REVOKE ALL ON FUNCTION {SIG} FROM PUBLIC, anon, authenticated; '
        f'GRANT EXECUTE ON FUNCTION {SIG} TO service_role;')
    md5 = lambda: run(f"SELECT md5(pg_get_functiondef('{SIG}'::regprocedure))")
    check('the rebuilt envelope is the 20261118071736 postimage', md5() == PRE, md5())

    # ---- BEFORE ------------------------------------------------------------
    answers, timeouts = convoy(args.successors)
    check('BEFORE: successors queue on the table lock until the statement timeout',
          timeouts >= args.successors, {'timeouts': timeouts, 'reasons': sorted({reason(a) for a in answers.values()})})
    results['before'] = {'statement_timeouts': timeouts,
                         'slowest_successor_s': round(max(a[3] for k, a in answers.items() if k != 'head'), 3)}
    before_held = held_member_row(SUCCESSOR_TIMEOUT)
    check('BEFORE: a held member row times the envelope out', 'statement timeout' in before_held[2], before_held)

    # ---- the candidate -----------------------------------------------------
    run(CANDIDATE.read_text())
    check('the migration reproduces the pinned postimage', md5() == POST, md5())
    cfg = run(f"SELECT array_to_string(proconfig, ',') FROM pg_proc WHERE oid = '{SIG}'::regprocedure")
    check('the function settings are unchanged (no function-level lock_timeout)', cfg == 'search_path=public, extensions, pg_temp', cfg)
    try:
        run(CANDIDATE.read_text())
        check('a second install is refused (preimage pin)', False)
    except RuntimeError as e:
        check('a second install is refused (preimage pin)', 'is not the pinned text' in str(e), str(e)[-300:])

    # ---- AFTER -------------------------------------------------------------
    answers, timeouts = convoy(args.successors)
    successors = {k: a for k, a in answers.items() if k.startswith('s')}
    check('AFTER: zero statement timeouts', timeouts == 0, {k: a[2] for k, a in answers.items() if a[2]})
    check('AFTER: the slow head completes', reason(answers['head']) == 'ok', answers['head'])
    check('AFTER: every successor answers predecessor_pending',
          all(reason(a) == 'predecessor_pending' for a in successors.values()),
          sorted({reason(a) for a in successors.values()}))
    named = {json.loads(a[1]).get('oldest_pending_hand_id') for a in successors.values()}
    check('AFTER: each names the one oldest open hand', named == {hand_id(1)}, sorted(map(str, named)))
    slowest = max(a[3] for a in successors.values())
    check('AFTER: successors answer without waiting on the slow hand', slowest < 1.5, slowest)
    check('AFTER: a second caller of the running hand answers table_busy within the bound',
          reason(answers['helper']) == 'table_busy' and answers['helper'][3] < 1.5, answers['helper'])
    results['after'] = {'statement_timeouts': timeouts, 'slowest_successor_s': round(slowest, 3),
                        'helper_s': round(answers['helper'][3], 3)}
    receipts, order, wagered = drain(args.successors + 1)
    n = args.successors + 1
    check('AFTER: draining applies every hand exactly once', receipts == f'{n}|{n}', receipts)
    check('AFTER: completion order is hand order', order == 't', order)
    check('AFTER: every wager applied once', wagered == str(n * (n + 1) // 2), wagered)
    callee_wait = run('SELECT string_agg(DISTINCT lock_timeout, \',\') FROM public.promo_receipts')
    check('AFTER: the callee runs with the caller\'s own lock_timeout (nothing shortened to swallow)', callee_wait == '7s', callee_wait)

    after_held = held_member_row(SUCCESSOR_TIMEOUT)
    body = json.loads(after_held[1]) if after_held[0] == 0 and after_held[1] else {}
    check('AFTER: a held member row answers obligation_lock_busy, not a timeout',
          body.get('reason') == 'obligation_lock_busy' and body.get('retryable') is True, after_held)
    check('AFTER: the refused envelope wrote nothing',
          run(f"SELECT count(*) FROM public.promo_receipts WHERE user_id = '{user(2)}'") == '0'
          and run(f"SELECT post_commit_completed_at IS NULL FROM public.hand_atomic_commits "
                  f"WHERE hand_id = '{hand_id(2)}'") == 't')
    check('AFTER: once the row is free the same hand applies exactly once',
          reason(call(2, '8s')) == 'ok'
          and run(f"SELECT count(*) FROM public.promo_receipts WHERE user_id = '{user(2)}'") == '1'
          and reason(call(2, '8s')) == 'ok'
          and run(f"SELECT count(*) FROM public.promo_receipts WHERE user_id = '{user(2)}'") == '1')
    stats_held = held_member_row(SUCCESSOR_TIMEOUT, row='player_stats')
    body = json.loads(stats_held[1]) if stats_held[0] == 0 and stats_held[1] else {}
    check('AFTER: a held player_stats row answers obligation_lock_busy before the swallowing callee runs',
          body.get('reason') == 'obligation_lock_busy', stats_held)
    check('AFTER: the stat is not dropped: nothing written while held, written once after',
          run(f"SELECT total_losses FROM public.player_stats WHERE user_id = '{user(2)}'") == '0'
          and reason(call(2, '8s')) == 'ok'
          and run(f"SELECT total_losses FROM public.player_stats WHERE user_id = '{user(2)}'") == '2'
          and run(f"SELECT count(*) FROM public.promo_receipts WHERE user_id = '{user(2)}'") == '1')
    # fn_project_hand_side_effects takes the table mutex itself (blocking), then
    # calls the envelope and hands any non-ok answer back to the projection
    # worker, which must read it as deferred. The answer must be the typed
    # one and the caller's transaction must stay usable.
    projection = held_member_row(SUCCESSOR_TIMEOUT, sql=(
        f"SET statement_timeout = '{SUCCESSOR_TIMEOUT}';{speak()} BEGIN; "
        f"SELECT pg_advisory_xact_lock(hashtextextended('hand-post-commit:{T}', 0)) IS NULL; "
        f"SELECT public.fn_ca_process_hand_post_commit_obligations('{hand_id(2)}')->>'reason'; "
        "SELECT 'usable'; COMMIT;"))
    check('AFTER: a caller holding the table mutex (fn_project_hand_side_effects) gets obligation_lock_busy and a usable transaction',
          projection[0] == 0 and projection[1].splitlines()[-2:] == ['obligation_lock_busy', 'usable'], projection)
    check('AFTER: and wrote nothing',
          run(f"SELECT count(*) FROM public.promo_receipts WHERE user_id = '{user(2)}'") == '0')
    busy, stored_while_busy, ins_after, ins_again, ins_stored = insurance_bank_busy()
    check("AFTER: #11266's busy insurance bank (55P03) answers obligation_lock_busy, not an error",
          reason(busy) == 'obligation_lock_busy' and 'insurance bank' in json.loads(busy[1]).get('detail', ''), busy)
    check('AFTER: and stores no leg while busy, then exactly one once free',
          stored_while_busy == '0' and reason(ins_after) == 'ok' and reason(ins_again) == 'ok'
          and ins_stored == '1|-5.00', {'while_busy': stored_while_busy, 'stored': ins_stored, 'after': ins_after})
    restored = run(f"SET lock_timeout = '7s'; SELECT public.fn_ca_process_hand_post_commit_obligations('{hand_id(2)}') IS NOT NULL; SHOW lock_timeout;")
    check("AFTER: the caller's lock_timeout is restored", restored.splitlines()[-1] == '7s', restored)
    seed(1, slow_hand=99)
    reentry = run(f"BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('hand-post-commit:{T}', 0)); "
                  f"SELECT public.fn_ca_process_hand_post_commit_obligations('{hand_id(1)}')->>'ok'; COMMIT;")
    check('AFTER: a caller already holding the table mutex re-enters', reentry.splitlines()[-1] == 'true', reentry)

    # ---- CONTRACT 1: today's engine, a rolled-back build, every SQL caller ----
    # The same interleavings without the header. Every answer must be one an
    # existing caller already handles (it defers or retries predecessor_pending),
    # with the real reason carried only in keys it ignores; still no timeouts.
    CONTRACT['v'] = 1
    legacy_answers = {}
    answers, timeouts = convoy(args.successors)
    legacy_answers.update({f'convoy:{k}': a for k, a in answers.items()})
    check('CONTRACT 1: zero statement timeouts', timeouts == 0, {k: a[2] for k, a in answers.items() if a[2]})
    check("CONTRACT 1: the running hand's second caller gets predecessor_pending, queued_reason table_busy",
          reason(answers['helper']) == 'predecessor_pending'
          and json.loads(answers['helper'][1]).get('queued_reason') == 'table_busy', answers['helper'])
    drain(args.successors + 1)
    held = held_member_row(SUCCESSOR_TIMEOUT)
    legacy_answers['held_member_row'] = held
    check('CONTRACT 1: a held member row answers predecessor_pending, queued_reason obligation_lock_busy',
          reason(held) == 'predecessor_pending'
          and json.loads(held[1]).get('queued_reason') == 'obligation_lock_busy', held)
    check('CONTRACT 1: and wrote nothing',
          run(f"SELECT count(*) FROM public.promo_receipts WHERE user_id = '{user(2)}'") == '0')
    check('CONTRACT 1: once free, the same hand applies exactly once',
          reason(call(2, '8s')) == 'ok'
          and run(f"SELECT count(*) FROM public.promo_receipts WHERE user_id = '{user(2)}'") == '1')
    busy, stored_while_busy, ins_after, ins_again, ins_stored = insurance_bank_busy()
    legacy_answers['insurance_bank_busy'] = busy
    check('CONTRACT 1: a busy insurance bank answers predecessor_pending, queued_reason obligation_lock_busy',
          reason(busy) == 'predecessor_pending'
          and json.loads(busy[1]).get('queued_reason') == 'obligation_lock_busy'
          and stored_while_busy == '0' and ins_stored == '1|-5.00', busy)
    seen = sorted({reason(a) for a in legacy_answers.values()})
    check('CONTRACT 1: every answer is one an existing caller already handles',
          set(seen) <= LEGACY_REASONS, seen)
    results['contract_1_reasons'] = seen
finally:
    (out / 'CONVOY.json').write_text(json.dumps(results, indent=2, default=str))
    try:
        command(as_owner + [pg / 'pg_ctl', '-D', cluster / 'data', '-m', 'immediate', 'stop'])
    except Exception:
        pass
    shutil.rmtree(cluster, ignore_errors=True)

print(json.dumps({'passed': len(results['checks']), 'before': results.get('before'), 'after': results.get('after')}))
