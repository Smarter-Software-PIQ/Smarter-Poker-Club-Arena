"""Isolated PostgreSQL proof for migration 20261118155509 (incident 075013fd
follow-up left open by #11269): THE PROJECTION WORKER NEVER QUEUES ON THE
TABLE LOCK OR A PLAYER KEY.

(a) One session holds the per-table mutex 'hand-post-commit:<table>' for 10 s
    while 20 callers of fn_project_hand_side_effects (one per hand of that
    table) arrive at once.
      BEFORE  (the production preimage, md5 39d043cd...): every caller waits on
              the mutex until its statement timeout.
      AFTER   every caller answers table_busy (contract 2) within ~0.3 s,
              zero statement timeouts, nothing written; contract 1 (no
              header: today's engine, a rolled-back build, every SQL caller)
              gets predecessor_pending with queued_reason table_busy, the one
              queued answer the old worker already defers. A held
              'player-stats:<uuid>' lock answers obligation_lock_busy within
              ~1 s. After release, a worker-shaped drain (one chain per
              table, stop at the first deferred hand, come back) projects
              every hand exactly once, in hand order, with every envelope
              completed once, every deferred cash rake banked once, and the
              outbox empty.
(c) THE 'player-stats-user:<uuid>' KEYS. The after-function takes them with a
    blocking lock after it has written (production shape, kept in the
    stand-in); the cash commission batch, the cash source retry and the Midway
    promo take the same keys.
      BEFORE  a held key keeps the projection waiting past 1 s, and a holder
              that then asks for a key the projection holds (the other order)
              is a deadlock (40P01).
      AFTER   a held key answers obligation_lock_busy within ~1 s with nothing
              written; the reverse-order holder is no deadlock (the projection
              never sits in a lock queue, gives up within 1 s, and the holder
              then gets its key); two hands at two tables with overlapping
              players, listed in opposite orders, run concurrently in both
              start orders: 0 deadlocks, no call waits past 1 s, and each hand
              projects exactly once.
The drain (fn_ca_drain_orphaned_post_commit_envelopes) is not changed by the
migration: the proof asserts its md5 is the production preimage after install.

The envelope is the production text: the #11266 postimage rebuilt from
scripts/ci/fixtures/cash-rake-pending/live-definitions.json, then #11269's
migration 20261118073646 run on it (md5 39d75365...). The projection function
is the production preimage rebuilt from the same fixture through 20261118034950
and 20261118071728. The after-post-commit projection, the two deferred
bankers and promo_apply_playthrough are stand-ins with production's lock
shape that leave one receipt per effect, so exactly-once is countable.

An empty throwaway cluster on a Unix socket; no network, no production
connection.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / 'supabase' / 'migrations'
FIXTURE = ROOT / 'scripts' / 'ci' / 'fixtures' / 'cash-rake-pending' / 'live-definitions.json'
RAKE_SWITCH = MIGRATIONS / '20261118035606_a_cash_hand_never_waits_on_a_tournament_wallet_lock.sql'
BANK_SWITCH = MIGRATIONS / '20261118071736_a_cash_hand_never_waits_on_the_union_bbj_pool_or_insurance_b.sql'
ENVELOPE = MIGRATIONS / '20261118073646_a_post_commit_envelope_never_queues_behind_a_slow_predecesso.sql'
RAKE_PART = MIGRATIONS / '20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall.sql'
BANK_PART = MIGRATIONS / '20261118071728_a_hands_bbj_drop_and_insurance_wait_in_their_own_rows_not_on.sql'
DRAIN_ORIGIN = MIGRATIONS / '20260909085724_a_hand_that_finished_stops_paging_and_an_orphan_envelope_gets_drained.sql'
CANDIDATE = MIGRATIONS / '20261118155509_the_projection_worker_never_queues_on_the_table_lock_and_the.sql'

ENV_SIG = 'public.fn_ca_process_hand_post_commit_obligations(uuid)'
PROJ_SIG = 'public.fn_project_hand_side_effects(uuid)'
DRAIN_SIG = 'public.fn_ca_drain_orphaned_post_commit_envelopes(interval,integer)'
ENV_PRE, ENV_POST = '7a796358fa28fda910e0f28ded72ff79', '39d75365156c46476bfe01854d3c86b9'
PROJ_PRE, DRAIN_PRE = '39d043cda727119e0a6d883a3fb25d50', '6abdcb7286ea8823034f7c0eb1c7ed40'
LIVE_PROOF = re.search(r"@live-proof: \(SELECT md5\(pg_get_functiondef\('public\.fn_project_hand_side_effects\(uuid\)'"
                       r"::regprocedure\)\) = '([0-9a-f]{32})'\)$", CANDIDATE.read_text(), re.M)
PROJ_POST = LIVE_PROOF.group(1)

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'artifacts/projection-table-lock-bound')
parser.add_argument('--callers', type=int, default=20)
parser.add_argument('--rounds', type=int, default=10)
parser.add_argument('--hold-seconds', type=float, default=10)
args = parser.parse_args()
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)
pg = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
as_owner = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
cluster = pathlib.Path(tempfile.mkdtemp(prefix='projection-lock-'))
sock = cluster / 'socket'
sock.mkdir(mode=0o700)
if as_owner:
    shutil.chown(cluster, 'postgres')
    shutil.chown(sock, 'postgres')
PORT = '55843'
LOG = cluster / 'log'
DB = 'projection'
results = {'checks': [], 'production_mutations': False}

T = 'c0000000-0000-0000-0000-0000000000a1'
T2 = 'c0000000-0000-0000-0000-0000000000b2'
CLUB = 'a0000000-0000-0000-0000-000000000001'
UNION = 'b0000000-0000-0000-0000-000000000001'
STATEMENT_TIMEOUT = '8s'  # service_role's, on production


def hand_id(n, table=T):
    return f'e{"0" if table == T else "2"}000000-0000-0000-0000-{n:012d}'


def user(n):
    return f'10000000-0000-0000-0000-{n:012d}'


def md5(s):
    return hashlib.md5(s.encode()).hexdigest()


def psql():
    return [pg / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', PORT, '-U', 'postgres', '-d', DB]


def command(argv, sql=None):
    r = subprocess.run(list(map(str, argv)), input=sql, text=True, capture_output=True, env=env, timeout=300)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def run(sql):
    return command(psql(), sql)


def attempt(sql):
    started = time.monotonic()
    r = subprocess.run(list(map(str, psql())), input=sql, text=True, capture_output=True, env=env, timeout=300)
    return r.returncode, r.stdout.strip(), r.stderr.strip(), time.monotonic() - started


def check(name, passed, detail=None):
    results['checks'].append({'name': name, 'passed': bool(passed), 'detail': detail})
    print(('PASS ' if passed else 'FAIL ') + name, flush=True)
    if not passed:
        raise AssertionError(f'{name}: {json.dumps(detail, default=str)[:2000]}')


def dollar(sql, tag):
    parts = sql.split(f'${tag}$')
    assert len(parts) == 3, tag
    return parts[1]


def envelope_preimage():
    text = json.loads(FIXTURE.read_text())['functions']['fn_ca_process_hand_post_commit_obligations']['definition']
    for path, tags in ((RAKE_SWITCH, ('env0',)), (BANK_SWITCH, ('env0', 'env1', 'env2'))):
        sql = path.read_text()
        for tag in tags:
            old, new = dollar(sql, f'o{tag}'), dollar(sql, f'n{tag}')
            assert text.count(old) == 1, (path.name, tag)
            text = text.replace(old, new)
    assert md5(text) == ENV_PRE
    return text


def projection_preimage():
    text = json.loads(FIXTURE.read_text())['functions']['fn_project_hand_side_effects']['definition']
    rake = RAKE_PART.read_text()
    text = text.replace(dollar(rake, 'oproj0'), dollar(rake, 'nproj0'))
    bank = BANK_PART.read_text()
    for i in range(1, 5):
        old = dollar(bank, f'oproj{i}')
        assert text.count(old) == 1, i
        text = text.replace(old, dollar(bank, f'nproj{i}'))
    assert md5(text) == PROJ_PRE
    return text


def drain_preimage():
    sql = DRAIN_ORIGIN.read_text()
    start = sql.index('  CREATE OR REPLACE FUNCTION public.fn_ca_drain_orphaned_post_commit_envelopes(')
    end = sql.index('$function$;', start) + len('$function$;')
    return sql[start:end]


SCHEMA = f"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA extensions; CREATE SCHEMA smarter_private;
CREATE EXTENSION pgcrypto SCHEMA extensions;
CREATE TABLE public.clubs(id uuid PRIMARY KEY, union_id uuid, asset text DEFAULT 'chips');
CREATE TABLE public.tables(id uuid PRIMARY KEY, club_id uuid REFERENCES public.clubs(id), tournament_id uuid,
  union_id uuid, is_private boolean DEFAULT false);
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
CREATE TABLE public.player_stats(user_id uuid, club_id uuid, total_losses numeric NOT NULL DEFAULT 0,
  UNIQUE (user_id, club_id));
CREATE TABLE public.club_members(club_id uuid, user_id uuid, wagered numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (club_id, user_id));
CREATE TABLE public.promo_receipts(id bigserial PRIMARY KEY, hand_user uuid, wagered numeric);
CREATE FUNCTION public.promo_apply_playthrough(p_club uuid, p_user uuid, p_wagered numeric)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    INSERT INTO public.player_stats(user_id, club_id, total_losses) VALUES (p_user, p_club, p_wagered)
    ON CONFLICT (user_id, club_id) DO UPDATE SET total_losses = player_stats.total_losses + EXCLUDED.total_losses;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  PERFORM 1 FROM public.club_members WHERE club_id = p_club AND user_id = p_user FOR UPDATE;
  UPDATE public.club_members SET wagered = wagered + p_wagered WHERE club_id = p_club AND user_id = p_user;
  INSERT INTO public.promo_receipts(hand_user, wagered) VALUES (p_user, p_wagered);
  RETURN jsonb_build_object('ok', true);
END $$;

-- The projection side: the durable outbox, the hand's history row, and the
-- receipts the stand-ins leave.
CREATE TABLE public.hand_projection_outbox(hand_id uuid PRIMARY KEY, table_id uuid NOT NULL,
  hand_number bigint NOT NULL);
CREATE TABLE public.hand_history(id uuid PRIMARY KEY, table_id uuid, hand_number bigint, players jsonb,
  tournament_id uuid);
CREATE TABLE public.projection_receipts(id bigserial PRIMARY KEY, hand_id uuid, table_id uuid, hand_number bigint);
CREATE TABLE public.bank_receipts(id bigserial PRIMARY KEY, hand_id uuid, kind text);

-- Stand-ins for #11270 / #11266's bankers: try-lock shape, one receipt, the
-- pending row consumed.
CREATE FUNCTION public.fn_ca_bank_pending_cash_rake(p_hand_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  DELETE FROM public.cash_rake_pending WHERE hand_id = p_hand_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'absent'); END IF;
  INSERT INTO public.bank_receipts(hand_id, kind) VALUES (p_hand_id, 'cash_rake');
  RETURN jsonb_build_object('status', 'banked');
END $$;
CREATE FUNCTION public.fn_ca_bank_pending_hand_obligations(p_hand_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  DELETE FROM public.hand_bank_obligation_pending WHERE hand_id = p_hand_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'absent'); END IF;
  INSERT INTO public.bank_receipts(hand_id, kind) VALUES (p_hand_id, 'hand_bank');
  RETURN jsonb_build_object('status', 'banked');
END $$;

-- Stand-in for fn_project_hand_side_effects_after_post_commit_20260908 with
-- production's lock shape (claim the outbox row FOR UPDATE, the per-table
-- projection lock, refuse to leapfrog an earlier outbox row, write the club
-- member projection, THEN each seated player's 'player-stats-user:' key with
-- a blocking lock in uuid order for a cash hand at a non-Diamond club), one
-- receipt per projected hand, and the outbox delete that fires the obligation
-- trigger. ca_test.after_sleep widens the window the projection holds its
-- keys, so concurrent hands really overlap.
CREATE FUNCTION public.fn_project_hand_side_effects_after_post_commit_20260908(p_hand_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v record; h record; v_uid uuid; v_diamond boolean; v_club uuid;
BEGIN
  SELECT o.* INTO v FROM public.hand_projection_outbox o WHERE o.hand_id = p_hand_id FOR UPDATE OF o;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pending', 'hand_id', p_hand_id);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hand-projection:' || v.table_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.hand_projection_outbox e
              WHERE e.table_id = v.table_id AND e.hand_number < v.hand_number) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'predecessor_pending');
  END IF;
  SELECT * INTO h FROM public.hand_history WHERE id = p_hand_id;
  SELECT t.club_id, c.asset = 'diamonds' INTO v_club, v_diamond
    FROM public.tables t JOIN public.clubs c ON c.id = t.club_id WHERE t.id = h.table_id;
  INSERT INTO public.projection_receipts(hand_id, table_id, hand_number) VALUES (p_hand_id, v.table_id, v.hand_number);
  IF NOT COALESCE(v_diamond, false) AND h.tournament_id IS NULL AND v_club IS NOT NULL
     AND jsonb_typeof(h.players) = 'array' AND jsonb_array_length(h.players) > 0 THEN
    FOR v_uid IN
      SELECT DISTINCT (pl->>'userId')::uuid FROM jsonb_array_elements(h.players) pl
       WHERE (pl->>'userId') ~* '^[0-9a-f]{{8}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{12}}$'
       ORDER BY 1
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('player-stats-user:'||v_uid::text,0));
    END LOOP;
    INSERT INTO public.stats_user_receipts(hand_id) VALUES (p_hand_id);
  END IF;
  PERFORM pg_sleep(COALESCE(NULLIF(current_setting('ca_test.after_sleep', true), ''), '0')::numeric);
  DELETE FROM public.hand_projection_outbox WHERE hand_id = p_hand_id;
  RETURN jsonb_build_object('ok', true, 'hand_id', p_hand_id);
END $$;
CREATE TABLE public.stats_user_receipts(id bigserial PRIMARY KEY, hand_id uuid);

INSERT INTO public.clubs(id, union_id) VALUES ('{CLUB}', '{UNION}');
INSERT INTO public.union_wallets(union_id, insurance_wallet) VALUES ('{UNION}', 100);
INSERT INTO public.tables(id, club_id) VALUES ('{T}', '{CLUB}'), ('{T2}', '{CLUB}');
"""

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

# Production's trigger function (read 2026-11-18, md5 2d9d0d7c...), unchanged.
TRIGGER = """
CREATE OR REPLACE FUNCTION public.trg_finish_hand_post_commit_obligations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.fn_ca_process_hand_post_commit_obligations(OLD.hand_id);
  IF COALESCE((v_result->>'ok')::boolean, false) IS NOT TRUE
     AND v_result->>'reason' <> 'legacy_no_obligations' THEN
    RAISE EXCEPTION 'hand post-commit obligations remain pending for %: %',
      OLD.hand_id, v_result;
  END IF;
  /* 20261118: the outbox row is the continuation that banks a cash hand's
     stored rake. It may not leave while that rake is still pending. */
  IF EXISTS (SELECT 1 FROM public.cash_rake_pending rp WHERE rp.hand_id = OLD.hand_id) THEN
    v_result := public.fn_ca_bank_pending_cash_rake(OLD.hand_id);
    IF v_result->>'status' IS DISTINCT FROM 'banked' THEN
      RAISE EXCEPTION 'hand rake remains pending for %: %', OLD.hand_id, v_result;
    END IF;
  END IF;
  /* 20261118071728: nor while its BBJ drop or an insurance leg is pending. */
  IF EXISTS (SELECT 1 FROM public.hand_bank_obligation_pending bp WHERE bp.hand_id = OLD.hand_id) THEN
    v_result := public.fn_ca_bank_pending_hand_obligations(OLD.hand_id);
    IF v_result->>'status' IS DISTINCT FROM 'banked' THEN
      RAISE EXCEPTION 'hand bank obligations remain pending for %: %', OLD.hand_id, v_result;
    END IF;
  END IF;
  RETURN OLD;
END;
$function$
;
CREATE TRIGGER a0_finish_hand_post_commit_obligations BEFORE DELETE ON public.hand_projection_outbox
  FOR EACH ROW EXECUTE FUNCTION public.trg_finish_hand_post_commit_obligations();
"""


def seed(count, table=T, outbox=True, age_seconds=3600, rake_hands=(), players=None):
    """`count` committed hands at `table`, each with one promo obligation for
    its own player, a hand_history row seating that player, and (outbox) a
    pending projection row. Hands in rake_hands carry a deferred cash rake.
    players (a list of user ids) overrides who is seated at every hand."""
    offset = 0 if table == T else 500
    rows = []
    for n in range(1, count + 1):
        u = user(n + offset)
        h = hand_id(n, table)
        rows.append(f"""
INSERT INTO public.club_members(club_id, user_id) VALUES ('{CLUB}', '{u}') ON CONFLICT DO NOTHING;
INSERT INTO public.player_stats(user_id, club_id) VALUES ('{u}', '{CLUB}') ON CONFLICT DO NOTHING;
WITH p AS (SELECT jsonb_build_object(
    'rake', null, 'bbj_contribution', null, 'pending_addons', null, 'insurance', '[]'::jsonb,
    'time_banks', '[]'::jsonb,
    'promo_playthrough', jsonb_build_array(jsonb_build_object(
        'club_id', '{CLUB}', 'user_id', '{u}', 'wagered', {n}))) AS v)
INSERT INTO public.hand_atomic_commits(table_id, hand_number, hand_id, committed_at, post_commit_payload,
  post_commit_payload_hash)
SELECT '{table}', {1000 + n}, '{h}', now() - interval '{age_seconds + count - n} seconds', p.v,
  encode(extensions.digest(convert_to(p.v::text, 'UTF8'), 'sha256'), 'hex') FROM p;
INSERT INTO public.hand_history(id, table_id, hand_number, players)
VALUES ('{h}', '{table}', {1000 + n}, '{seated(players or [u])}'::jsonb);""")
        if outbox:
            rows.append(f"INSERT INTO public.hand_projection_outbox VALUES ('{h}', '{table}', {1000 + n});")
        if n in rake_hands:
            rows.append(f"INSERT INTO public.cash_rake_pending VALUES ('{h}', '{table}', {1000 + n}, 1, '{{}}');")
    run(''.join(rows))


def seated(users):
    return json.dumps([{'userId': x} for x in users])


def seed_overlap():
    """Hand 1 at T seats players 1 and 2; hand 1 at T2 seats players 2 and 1
    (the opposite order in the hand's JSON)."""
    seed(1, players=[user(1), user(2)])
    seed(1, table=T2, players=[user(2), user(1)])


def complete_envelopes():
    """Complete every pending envelope first, so the projection reaches its
    player-stats-user keys on this pass."""
    out = run("SELECT bool_and(COALESCE((public.fn_ca_process_hand_post_commit_obligations(hand_id)->>'ok')::boolean, false)) "
              "FROM (SELECT hand_id FROM public.hand_atomic_commits ORDER BY table_id, hand_number) x")
    assert out == 't', out


def reverse_order_holder():
    """A writer that holds the higher player's 'player-stats-user:' key and then
    asks for the lower one (the other order), while the projection of a hand
    seating both runs."""
    reset()
    seed(1, players=[user(1), user(2)])
    complete_envelopes()
    lo, hi = sorted([user(1), user(2)])
    holder = subprocess.Popen(list(map(str, psql())), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, env=env)
    holder.stdin.write(f"SET statement_timeout = '8s'; BEGIN;\n"
                       f"SELECT pg_advisory_xact_lock(hashtextextended('player-stats-user:{hi}', 0));\n"
                       "SELECT pg_sleep(0.6);\n"
                       f"SELECT pg_advisory_xact_lock(hashtextextended('player-stats-user:{lo}', 0));\n"
                       "SELECT 'holder-ok'; COMMIT;\n")
    holder.stdin.close()
    time.sleep(0.2)
    answer, secs, err = project(hand_id(1))
    holder.wait(timeout=60)
    hout, herr = holder.stdout.read(), holder.stderr.read()
    return {'deadlocks': int('deadlock detected' in err) + int('deadlock detected' in herr),
            'holder_ok': 'holder-ok' in hout, 'answer': answer,
            'projection_s': None if secs is None else round(secs, 3),
            'projection_error': err[-300:], 'holder_error': herr[-300:]}


def reset():
    run('DELETE FROM public.hand_projection_outbox; '
        'TRUNCATE public.hand_atomic_commits, public.hand_history, public.promo_receipts, '
        'public.projection_receipts, public.bank_receipts, public.cash_rake_pending, public.stats_user_receipts, '
        'public.hand_bank_obligation_pending; '
        'UPDATE public.club_members SET wagered = 0; UPDATE public.player_stats SET total_losses = 0;')


CONTRACT = {'v': 2}


def speak():
    if CONTRACT['v'] >= 2:
        return ' SET "request.headers" TO \'{"x-ca-post-commit-contract": "2"}\';'
    return ''


def project(h, timeout=STATEMENT_TIMEOUT, after_sleep=None):
    """One projection RPC as the worker sends it: one transaction, the
    service_role statement timeout, production's lock_timeout 0. Returns
    (answer, server-side seconds, stderr)."""
    code, stdout, stderr, _ = attempt(
        f"SET statement_timeout = '{timeout}'; SET lock_timeout = 0;{speak()}"
        + (f" SET ca_test.after_sleep = '{after_sleep}';" if after_sleep else '') + "\n"
        f"SELECT jsonb_build_object('a', public.fn_project_hand_side_effects('{h}'), "
        f"'s', extract(epoch FROM clock_timestamp() - statement_timestamp()))::text;\n")
    if code != 0 or not stdout:
        return None, None, stderr
    body = json.loads(stdout)
    return body['a'], body['s'], stderr


def hold(key, seconds):
    holder = subprocess.Popen(list(map(str, psql())), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, env=env)
    holder.stdin.write(f"BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('{key}', 0));\n"
                       f"SELECT pg_sleep({seconds});\nCOMMIT;\n")
    holder.stdin.close()
    time.sleep(0.5)
    return holder


def stampede(n, timeout=STATEMENT_TIMEOUT):
    answers = {}

    def go(i):
        answers[i] = project(hand_id(i), timeout)

    threads = [threading.Thread(target=go, args=(i,)) for i in range(1, n + 1)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return answers


def worker_drain(tables=(T,), max_passes=200):
    """The projection worker's shape (handProjection.ts projectChain): per
    table, outbox rows oldest first; stop the chain at the first hand that is
    not consumed (deferred), come back on the next pass."""
    calls = 0
    for _ in range(max_passes):
        pending = run("SELECT count(*) FROM public.hand_projection_outbox")
        if pending == '0':
            return calls
        for table in tables:
            rows = run(f"SELECT hand_id FROM public.hand_projection_outbox WHERE table_id = '{table}' "
                       "ORDER BY hand_number").split()
            for h in rows:
                answer, _, err = project(h)
                calls += 1
                if answer is None:
                    raise AssertionError(f'projection error: {err}')
                if answer.get('ok') is True or answer.get('reason') == 'not_pending':
                    continue
                if answer.get('reason') in ('predecessor_pending', 'table_busy', 'obligation_lock_busy'):
                    break
                raise AssertionError(f'projection refused: {answer}')
    raise AssertionError('worker drain did not finish')


def exactly_once_in_order(count, table=T):
    receipts = run(f"SELECT count(*), count(DISTINCT hand_id) FROM public.projection_receipts WHERE table_id = '{table}'")
    order = run(f"SELECT bool_and(prev IS NULL OR prev < hand_number) FROM (SELECT hand_number, "
                f"lag(hand_number) OVER (ORDER BY id) prev FROM public.projection_receipts WHERE table_id = '{table}') x")
    return receipts == f'{count}|{count}', order == 't', receipts, order


try:
    command(as_owner + [pg / 'initdb', '-D', cluster / 'data', '-A', 'trust', '-U', 'postgres'])
    command(as_owner + [pg / 'pg_ctl', '-D', cluster / 'data', '-o',
                        f"-k {sock} -p {PORT} -c listen_addresses='' -c max_connections=200",
                        '-l', LOG, '-w', 'start'])
    command([pg / 'psql', '-X', '-qAt', '-h', sock, '-p', PORT, '-U', 'postgres', '-d', 'postgres',
             '-c', f'CREATE DATABASE {DB}'])
    run(SCHEMA)
    run(F06_LANE)
    run(envelope_preimage() + ';\n'
        f'REVOKE ALL ON FUNCTION {ENV_SIG} FROM PUBLIC, anon, authenticated; '
        f'GRANT EXECUTE ON FUNCTION {ENV_SIG} TO service_role;')
    run(ENVELOPE.read_text())
    fmd5 = lambda sig: run(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure))")
    check("#11269's envelope is installed (production md5)", fmd5(ENV_SIG) == ENV_POST, fmd5(ENV_SIG))
    run(projection_preimage() + ';\n'
        f'REVOKE ALL ON FUNCTION {PROJ_SIG} FROM PUBLIC, anon, authenticated; '
        f'GRANT EXECUTE ON FUNCTION {PROJ_SIG} TO service_role;')
    check('the projection function is the production preimage', fmd5(PROJ_SIG) == PROJ_PRE, fmd5(PROJ_SIG))
    run(drain_preimage() + '\n'
        f'REVOKE ALL ON FUNCTION {DRAIN_SIG} FROM PUBLIC, anon, authenticated; '
        f'GRANT EXECUTE ON FUNCTION {DRAIN_SIG} TO service_role;')
    check('the drain is the production preimage', fmd5(DRAIN_SIG) == DRAIN_PRE, fmd5(DRAIN_SIG))
    run(TRIGGER)

    N = args.callers
    MUTEX = f'hand-post-commit:{T}'
    # ---- BEFORE (a) ---------------------------------------------------------
    reset()
    seed(N, rake_hands=(3,))
    holder = hold(MUTEX, args.hold_seconds)
    answers = stampede(N, timeout='3s')  # shorter than 8 s only to keep the run short
    holder.wait(timeout=120)
    timeouts = sum('statement timeout' in a[2] for a in answers.values())
    # hand 3 banks its deferred rake before the mutex and ends its pass, so it
    # never reaches the lock in either version.
    check('BEFORE (a): every caller that reaches the mutex queues until its statement timeout',
          timeouts == N - 1, {'timeouts': timeouts, 'answers': {k: a[0] for k, a in answers.items() if a[0]}})
    results['before_a'] = {'statement_timeouts': timeouts, 'callers': N}

    # ---- BEFORE (c) ---------------------------------------------------------
    # A held 'player-stats-user:' key: the preimage's after-function queues on it.
    reset()
    seed(1)
    complete_envelopes()
    holder = hold(f'player-stats-user:{user(1)}', 3)
    answer, secs, err = project(hand_id(1))
    holder.wait(timeout=60)
    check('BEFORE (c): a held player-stats-user key keeps the projection waiting past 1 s',
          answer is not None and answer.get('ok') is True and secs > 2, {'answer': answer, 's': secs, 'err': err})
    # The other order: the holder of Y then asks for X while the projection holds X and waits for Y.
    before_c = reverse_order_holder()
    check('BEFORE (c): a reverse-order holder deadlocks with the projection (40P01)',
          before_c['deadlocks'] >= 1, before_c)
    results['before_c'] = before_c

    # ---- the candidate -------------------------------------------------------
    run(CANDIDATE.read_text())
    check('the migration reproduces the projection postimage', fmd5(PROJ_SIG) == PROJ_POST, fmd5(PROJ_SIG))
    check('the drain is not changed (still the production preimage)', fmd5(DRAIN_SIG) == DRAIN_PRE, fmd5(DRAIN_SIG))
    meta = run(f"SELECT array_to_string(proconfig, ','), prosecdef, proacl::text FROM pg_proc WHERE oid = '{PROJ_SIG}'::regprocedure")
    check(f'{PROJ_SIG}: settings, security and grants unchanged',
          meta == 'search_path=public, pg_temp|t|{postgres=X/postgres,service_role=X/postgres}', meta)
    blocking = run("SELECT src ~ 'pg_advisory_(xact_)?lock\\s*\\(' OR src ~* 'for\\s+(no\\s+key\\s+)?update' "
                   "OR src ~* 'lock\\s+table' FROM (SELECT regexp_replace(regexp_replace(prosrc, '/\\*.*?\\*/', ' ', 'g'), "
                   f"'--[^\\n]*', ' ', 'g') AS src FROM pg_proc WHERE oid = '{PROJ_SIG}'::regprocedure) x")
    check('the installed projection function makes no blocking lock call (comments aside)', blocking == 'f', blocking)
    check('the envelope is untouched', fmd5(ENV_SIG) == ENV_POST, fmd5(ENV_SIG))
    try:
        run(CANDIDATE.read_text())
        check('a second install is refused (preimage pin)', False)
    except RuntimeError as e:
        check('a second install is refused (preimage pin)', 'is not the pinned text' in str(e), str(e)[-300:])

    # ---- AFTER (a), contract 2 ----------------------------------------------
    for contract in (2, 1):
        CONTRACT['v'] = contract
        label = f'AFTER (a) contract {contract}'
        reset()
        seed(N, rake_hands=(3,))
        holder = hold(MUTEX, args.hold_seconds)
        started = time.monotonic()
        answers = stampede(N)
        wall = time.monotonic() - started
        busy_answers = {k: a for k, a in answers.items() if k != 3}
        timeouts = sum('statement timeout' in a[2] for a in answers.values())
        errors = {k: a[2] for k, a in answers.items() if a[0] is None}
        check(f'{label}: zero statement timeouts and no errors', timeouts == 0 and not errors, errors)
        want = 'table_busy' if contract >= 2 else 'predecessor_pending'
        check(f'{label}: every caller answers {want} (queued_reason table_busy)',
              all(a[0].get('reason') == want and a[0].get('queued_reason') == 'table_busy'
                  and a[0].get('retryable') is True and a[0].get('projection_applied') is False
                  for a in busy_answers.values()),
              sorted({(a[0].get('reason'), a[0].get('queued_reason')) for a in busy_answers.values()}))
        slowest = max(a[1] for a in busy_answers.values())
        check(f'{label}: each answers within ~0.3 s server-side', slowest < 0.5, slowest)
        check(f'{label}: all {N} answered while the lock was still held',
              wall < args.hold_seconds - 0.5, wall)
        check(f'{label}: hand 3 banked its deferred rake once and ended its pass',
              answers[3][0].get('reason') == 'predecessor_pending'
              and run("SELECT count(*) FROM public.bank_receipts WHERE kind = 'cash_rake'") == '1', answers[3][0])
        check(f'{label}: nothing projected, no envelope completed, outbox intact while busy',
              run('SELECT count(*) FROM public.projection_receipts') == '0'
              and run('SELECT count(*) FROM public.promo_receipts') == '0'
              and run('SELECT count(*) FROM public.hand_projection_outbox') == str(N))
        holder.wait(timeout=120)
        calls = worker_drain()
        once, ordered, receipts, order = exactly_once_in_order(N)
        check(f'{label}: after release every hand projects exactly once', once, receipts)
        check(f'{label}: in hand order', ordered, order)
        check(f'{label}: every envelope completed once (one promo receipt per hand, wagers summed once)',
              run('SELECT count(*), count(DISTINCT hand_user), sum(wagered) FROM public.promo_receipts')
              == f'{N}|{N}|{N * (N + 1) // 2}'
              and run('SELECT count(*) FROM public.hand_atomic_commits WHERE post_commit_completed_at IS NULL') == '0')
        check(f'{label}: the rake was banked exactly once and the outbox is empty',
              run("SELECT count(*) FROM public.bank_receipts") == '1'
              and run('SELECT count(*) FROM public.hand_projection_outbox') == '0'
              and run('SELECT count(*) FROM public.cash_rake_pending') == '0')
        results[f'after_a_contract_{contract}'] = {'statement_timeouts': timeouts, 'slowest_server_s': round(slowest, 3),
                                                   'wall_s': round(wall, 3), 'worker_calls_after_release': calls}

        # A held player-stats lock (another table's projection holds the player).
        reset()
        seed(1)
        holder = hold(f'player-stats:{user(1)}', 4)
        answer, secs, err = project(hand_id(1))
        holder.wait(timeout=60)
        want = 'obligation_lock_busy' if contract >= 2 else 'predecessor_pending'
        check(f'{label}: a held player-stats lock answers {want} within ~1 s',
              answer is not None and answer.get('reason') == want
              and answer.get('queued_reason') == 'obligation_lock_busy' and secs < 1.4,
              {'answer': answer, 's': secs, 'err': err})
        check(f'{label}: and nothing was written',
              run('SELECT count(*) FROM public.promo_receipts') == '0'
              and run('SELECT count(*) FROM public.hand_projection_outbox') == '1')
        worker_drain()
        check(f'{label}: then the hand projects exactly once', exactly_once_in_order(1)[0])
        results.setdefault(f'contract_{contract}_reasons', set()).update(
            {a[0].get('reason') for a in answers.values()} | {answer.get('reason')})
    # The old engine (before #11269's engine part) defers predecessor_pending
    # and fails every other reason it does not know (handProjection.ts at
    # e315035b8^): contract 1 must never show it anything else.
    check('CONTRACT 1: every answer is one the old engine already defers',
          results['contract_1_reasons'] == {'predecessor_pending'}, sorted(results['contract_1_reasons']))

    # A caller already holding the table mutex re-enters at once (nested use).
    CONTRACT['v'] = 2
    reset()
    seed(1)
    reentry = run(f"BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('{MUTEX}', 0)); "
                  f"SELECT public.fn_project_hand_side_effects('{hand_id(1)}')->>'detail'; COMMIT;")
    check('AFTER (a): a transaction already holding the mutex re-enters',
          reentry.splitlines()[-1] == 'post_commit_completed_in_this_transaction', reentry)

    # ---- AFTER (c) ----------------------------------------------------------
    for contract in (2, 1):
        CONTRACT['v'] = contract
        label = f'AFTER (c) contract {contract}'
        want = 'obligation_lock_busy' if contract >= 2 else 'predecessor_pending'
        reset()
        seed(1)
        complete_envelopes()
        holder = hold(f'player-stats-user:{user(1)}', 4)
        answer, secs, err = project(hand_id(1))
        holder.wait(timeout=60)
        check(f'{label}: a held player-stats-user key answers {want} within ~1 s',
              answer is not None and answer.get('reason') == want
              and answer.get('queued_reason') == 'obligation_lock_busy'
              and answer.get('detail') == 'player_stats_user_lock_busy' and secs < 1.2,
              {'answer': answer, 's': secs, 'err': err})
        check(f'{label}: and nothing was written',
              run('SELECT count(*) FROM public.projection_receipts') == '0'
              and run('SELECT count(*) FROM public.stats_user_receipts') == '0'
              and run('SELECT count(*) FROM public.hand_projection_outbox') == '1')
        worker_drain()
        check(f'{label}: then the hand projects exactly once', exactly_once_in_order(1)[0]
              and run('SELECT count(*) FROM public.stats_user_receipts') == '1')

    CONTRACT['v'] = 2
    after_c = reverse_order_holder()
    check('AFTER (c): a reverse-order holder is no deadlock: the projection gives up within ~1 s, the holder gets its key',
          after_c['deadlocks'] == 0 and after_c['holder_ok'] and after_c['answer'] is not None
          and after_c['answer'].get('reason') == 'obligation_lock_busy' and after_c['projection_s'] < 1.2, after_c)
    results['after_c_reverse_holder'] = after_c

    # A tournament hand or a Diamond club's hand takes no player-stats-user key (the after-function takes none).
    reset()
    seed(1)
    run(f"UPDATE public.hand_history SET tournament_id = gen_random_uuid() WHERE id = '{hand_id(1)}'")
    complete_envelopes()
    holder = hold(f'player-stats-user:{user(1)}', 3)
    answer, secs, err = project(hand_id(1))
    holder.wait(timeout=60)
    check('AFTER (c): a tournament hand is not held up by a player-stats-user key',
          answer is not None and answer.get('ok') is True and secs < 0.5, {'answer': answer, 's': secs})

    # Two hands at two tables with overlapping players, listed in opposite
    # orders, concurrently, in both start orders; short and long holds.
    stats = {'calls': 0, 'deadlocks': 0, 'errors': [], 'slowest_wait_s': 0.0, 'busy': 0, 'ok': 0}
    for sleep in (0.3, 1.5):
        for first in (0, 1):
            for _ in range(args.rounds):
                reset()
                seed_overlap()
                complete_envelopes()
                pair = [(hand_id(1), T), (hand_id(1, T2), T2)]
                if first:
                    pair.reverse()
                answers = {}

                def go(h, delay):
                    time.sleep(delay)
                    answers[h] = project(h, after_sleep=sleep)

                threads = [threading.Thread(target=go, args=(h, 0.05 * i)) for i, (h, _) in enumerate(pair)]
                for t in threads:
                    t.start()
                for t in threads:
                    t.join()
                for h, (answer, secs, err) in answers.items():
                    stats['calls'] += 1
                    if 'deadlock' in err:
                        stats['deadlocks'] += 1
                    if answer is None:
                        stats['errors'].append(err[-300:])
                        continue
                    if answer.get('ok') is True:
                        stats['ok'] += 1
                        # its own hold is the stand-in's sleep; the rest is waiting
                        waited = secs - sleep
                    else:
                        stats['busy'] += 1
                        waited = secs
                    stats['slowest_wait_s'] = max(stats['slowest_wait_s'], round(waited, 3))
                worker_drain(tables=(T, T2))
                once = run('SELECT count(*), count(DISTINCT hand_id) FROM public.projection_receipts') == '2|2'
                if not once:
                    stats['errors'].append('not exactly once')
    deadlock_log = LOG.read_text().count('deadlock detected') if LOG.exists() else -1
    check('AFTER (c): overlapping players, concurrent, both orders: 0 deadlocks and no errors',
          stats['deadlocks'] == 0 and not stats['errors'], stats)
    check('AFTER (c): neither hand ever waits past 1 s', stats['slowest_wait_s'] < 1.15, stats)
    check('AFTER (c): every hand projected exactly once', not stats['errors'], stats)
    check('AFTER (c): the long hold really made the second hand give up (the bound was exercised)', stats['busy'] > 0, stats)
    results['after_c_overlap'] = stats
    results['server_log_deadlocks_total'] = deadlock_log
finally:
    (out / 'PROJECTION-LOCK.json').write_text(json.dumps(results, indent=2, default=str))
    try:
        command(as_owner + [pg / 'pg_ctl', '-D', cluster / 'data', '-m', 'immediate', 'stop'])
    except Exception:
        pass
    shutil.rmtree(cluster, ignore_errors=True)

print(json.dumps({'passed': len(results['checks']),
                  'before_a': results.get('before_a'), 'before_c': results.get('before_c'),
                  'after_a_contract_2': results.get('after_a_contract_2'),
                  'after_a_contract_1': results.get('after_a_contract_1'),
                  'after_c_reverse_holder': results.get('after_c_reverse_holder'),
                  'after_c_overlap': results.get('after_c_overlap')}, default=str))
