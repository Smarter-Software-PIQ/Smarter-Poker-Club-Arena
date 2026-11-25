"""Native proof for migration 20261123071151 (a horse claim never waits on a
dashboard revision). Runs on a THROWAWAY local PostgreSQL cluster it creates and
removes; it never connects to any other database.

Production's own text, md5-checked against what production returned on
2026-11-23:
  fn_ca_horse_claim_due                   cc2313be... (rebuilt from
      scripts/ci/fixtures/horse-claim-lock-order/fn_ca_horse_claim_due.live-20261015.sql
      through 20261015032612 and 20261030003124)
  bump_daily_challenge_dashboard_revision 6de77f0b...
  fn_ca_diamond_prune_history             a4f628c3...
  claim_daily_challenge_serialized_body   b1394ddf...
  (scripts/ci/fixtures/daily-mission-revision-lock-order/live-20261123.json)
Their triggers are production's (AFTER ROW on user_daily_challenges, AFTER
UPDATE OF diamonds on profiles). The one stand-in is the claimed-milestone
trigger, which here only keeps the run inside its first claim for a moment so
the prune can arrive, the interleaving production logged.

  CASE 1, the production cycle. Two horses, each owed a reward and each with an
          abandoned 60-day-old row. The claim run pays horse B first (bumping
          B's revision) and is still running when the prune deletes A's and
          B's abandoned rows (bumping A's revision, then waiting for B's).
          BEFORE: deadlock detected, the prune is cancelled (as at 06:40 UTC).
          AFTER:  no deadlock; the run leaves A owed, the prune commits, the
                  next run pays A.
  CASE 2, outcomes. The same work done one transaction at a time, and with a
          horse that has no revision row yet, leaves identical rewards,
          journal rows, deferrals, prunes and revision numbers before and after.

Usage (as root, which runs the cluster as the postgres user, or as a user that
may run postgres):
  PG_BIN=/usr/lib/postgresql/16/bin python3 scripts/dev/prove-a-horse-claim-never-waits-on-a-dashboard-revision.py
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
CLAIM_FIXTURE = ROOT / 'scripts' / 'ci' / 'fixtures' / 'horse-claim-lock-order' / 'fn_ca_horse_claim_due.live-20261015.sql'
LIVE = ROOT / 'scripts' / 'ci' / 'fixtures' / 'daily-mission-revision-lock-order' / 'live-20261123.json'
CANDIDATE = MIGRATIONS / '20261123071151_a_horse_claim_never_waits_on_a_dashboard_revision.sql'
SIG = 'public.fn_ca_horse_claim_due(integer)'
LIVE_MD5 = 'cc2313bee55c2149786824aae8d3b87e'
POST_MD5 = '88cfc5b8cbde2247e42b41cdbf457d09'

pg = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/16/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
as_owner = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
work = pathlib.Path(tempfile.mkdtemp(prefix='revision-lock-order-'))
sock = work / 'socket'
sock.mkdir(mode=0o700)
if as_owner:
    shutil.chown(work, 'postgres')
    shutil.chown(sock, 'postgres')
PORT = '55861'
DB = 'revisions'
checks = []

A, B, N = ('a0000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000b2',
           'a0000000-0000-4000-8000-0000000000c3')
# Claim rows in primary key order: B's first, then A's, then N's.
CLAIM = {B: 'c0000000-0000-4000-8000-000000000001', A: 'c0000000-0000-4000-8000-000000000002',
         N: 'c0000000-0000-4000-8000-000000000003'}
REWARD = {A: 10, B: 20, N: 40}
OLD = {A: 'd0000000-0000-4000-8000-000000000001', B: 'd0000000-0000-4000-8000-000000000002'}


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
    r = subprocess.run(list(map(str, psql())), input=sql, text=True, capture_output=True, env=env, timeout=180)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def check(name, passed, detail=None):
    checks.append(name)
    print(('ok   ' if passed else 'FAIL ') + name + ('' if passed else f'  {detail}'))
    if not passed:
        raise AssertionError(f'{name}: {detail}')


def live_claim():
    text = CLAIM_FIXTURE.read_text()
    for name, o, n in (('20261015032612_a_horse_claim_never_waits_on_a_player_lock.sql', 'o1', 'n1'),
                       ('20261030003124_tournament_rebuy_player_contention_releases_the_event_lane.sql', 'old0', 'new0')):
        sql = (MIGRATIONS / name).read_text()
        old, new = sql.split(f'${o}$')[1], sql.split(f'${n}$')[1]
        assert text.count(old) == 1, name
        text = text.replace(old, new)
    assert hashlib.md5(text.encode()).hexdigest() == LIVE_MD5
    return text


def live(sig):
    f = json.loads(LIVE.read_text())['functions'][sig]
    assert hashlib.md5(f['definition'].encode()).hexdigest() == f['md5'], sig
    return f['definition']


SCHEMA = """
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA realtime;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE TABLE realtime.sent(id bigserial PRIMARY KEY, topic text, payload jsonb);
CREATE FUNCTION realtime.send(p jsonb, e text, t text, priv boolean) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO realtime.sent(topic, payload) VALUES (t, p) $$;
CREATE FUNCTION public.fn_platform_frozen() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.fn_caller_is_engine() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE public.diamond_incidents(code text, user_id uuid, detail jsonb);
CREATE FUNCTION public.fn_ca_diamond_incident(p_code text, p_severity text, p_user uuid, p_amount numeric,
  p_source text, p_detail jsonb) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.diamond_incidents VALUES (p_code, p_user, p_detail) $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, is_horse boolean NOT NULL, diamonds integer NOT NULL DEFAULT 0,
  diamond_balance integer NOT NULL DEFAULT 0, updated_at timestamptz);
CREATE TABLE public.user_daily_challenges(id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.profiles(id),
  completed boolean NOT NULL, claimed boolean NOT NULL DEFAULT false, claimed_at timestamptz,
  expired_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  progress integer NOT NULL DEFAULT 1, requirement_snapshot integer NOT NULL DEFAULT 1,
  diamond_reward_snapshot integer NOT NULL DEFAULT 0, challenge_id text NOT NULL DEFAULT 'play_hands',
  challenge_name_snapshot text NOT NULL DEFAULT 'Play Hands');
CREATE TABLE public.ca_horse_claim_deferrals(challenge_row_id uuid PRIMARY KEY, user_id uuid,
  refused_by text, detail text, retry_after timestamptz, refusals integer NOT NULL DEFAULT 1,
  last_refused_at timestamptz);
CREATE TABLE public.diamond_transactions(id bigserial PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.profiles(id),
  amount integer NOT NULL, transaction_type text, type text, description text, balance_after integer,
  metadata jsonb, reference_id text NOT NULL UNIQUE, created_at timestamptz, counterparty text, issuance_class text);
CREATE TABLE public.ca_diamond_incidents(id bigserial PRIMARY KEY, resolved_at timestamptz, severity text,
  occurred_at timestamptz);
-- Production's cursor table: one row per player, FK to profiles.
CREATE TABLE public.daily_challenge_dashboard_revisions(
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
-- Stand-in for the claimed-milestone step: holds the run inside one claim.
CREATE FUNCTION public.fn_daily_missions_claimed_milestone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id::text = current_setting('test.hold_user', true) THEN
    PERFORM pg_sleep(COALESCE(NULLIF(current_setting('test.hold', true), ''), '0')::numeric);
  END IF;
  RETURN NEW;
END $$;
"""

TRIGGERS = """
CREATE TRIGGER trg_daily_challenge_revision_from_contract AFTER INSERT OR DELETE OR UPDATE
  ON public.user_daily_challenges FOR EACH ROW EXECUTE FUNCTION bump_daily_challenge_dashboard_revision();
CREATE TRIGGER trg_daily_missions_claimed_milestone AFTER UPDATE OF claimed
  ON public.user_daily_challenges FOR EACH ROW EXECUTE FUNCTION fn_daily_missions_claimed_milestone();
CREATE TRIGGER trg_daily_challenge_revision_from_diamonds AFTER UPDATE OF diamonds ON public.profiles
  FOR EACH ROW WHEN ((old.diamonds IS DISTINCT FROM new.diamonds)) EXECUTE FUNCTION bump_daily_challenge_dashboard_revision();
"""


def seed(horses=(A, B), revisions=True):
    """Each horse: one reward owed (completed an hour ago) and one abandoned row 70
    days old. A's abandoned row goes in first, so the prune reaches A before B."""
    sql = ['TRUNCATE public.diamond_transactions, public.ca_horse_claim_deferrals, public.diamond_incidents,'
           ' public.user_daily_challenges, public.daily_challenge_dashboard_revisions, public.profiles, realtime.sent;']
    for h in horses:
        sql.append(f"INSERT INTO public.profiles(id, is_horse) VALUES ('{h}', true);")
        if revisions:
            sql.append(f"INSERT INTO public.daily_challenge_dashboard_revisions(user_id, revision) VALUES ('{h}', 5);")
    for h in horses:
        if h in OLD:
            sql.append("INSERT INTO public.user_daily_challenges(id, user_id, completed, created_at) "
                       f"VALUES ('{OLD[h]}', '{h}', false, now() - interval '70 days');")
    for h in horses:
        sql.append("INSERT INTO public.user_daily_challenges(id, user_id, completed, completed_at, diamond_reward_snapshot) "
                   f"VALUES ('{CLAIM[h]}', '{h}', true, now() - interval '1 hour', {REWARD[h]});")
    # The setup inserts bumped the cursor; start every case from the same numbers.
    if revisions:
        sql.append("UPDATE public.daily_challenge_dashboard_revisions SET revision = 5;")
    else:
        sql.append("DELETE FROM public.daily_challenge_dashboard_revisions;")
    run('\n'.join(sql))


CLAIM_RUN = "SELECT claimed, capped, failed, ran FROM public.fn_ca_horse_claim_due(500);"
PRUNE_RUN = "SELECT public.fn_ca_diamond_prune_history()->>'abandoned_pruned';"


def state():
    return json.loads(run("""SELECT json_build_object(
      'diamonds', (SELECT json_object_agg(id, diamonds ORDER BY id) FROM public.profiles),
      'journal', (SELECT coalesce(json_agg(json_build_array(user_id, amount, reference_id, balance_after) ORDER BY reference_id), '[]') FROM public.diamond_transactions),
      'claimed', (SELECT coalesce(json_agg(id ORDER BY id), '[]') FROM public.user_daily_challenges WHERE claimed),
      'rows', (SELECT coalesce(json_agg(id ORDER BY id), '[]') FROM public.user_daily_challenges),
      'deferrals', (SELECT count(*) FROM public.ca_horse_claim_deferrals),
      'incidents', (SELECT count(*) FROM public.diamond_incidents),
      'revisions', (SELECT coalesce(json_object_agg(user_id, revision ORDER BY user_id), '{}') FROM public.daily_challenge_dashboard_revisions))::text"""))


def deadlocks():
    return int(run("SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()"))


def concurrently(*sessions):
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


def case_1():
    seed()
    before = deadlocks()
    answers = concurrently(
        ('claim', 0.0, f"SET test.hold = '1.2'; SET test.hold_user = '{B}';\n{CLAIM_RUN}"),
        ('prune', 0.3, f"SET statement_timeout = '20s';\n{PRUNE_RUN}"))
    time.sleep(1.2)  # let pg_stat_database catch up with the backends' counters
    return answers, deadlocks() - before


def serial(horses=(A, B), revisions=True):
    seed(horses, revisions)
    first = attempt(CLAIM_RUN)
    pruned = attempt(PRUNE_RUN)
    second = attempt(CLAIM_RUN)
    return {'first': first[1], 'prune': pruned[1], 'second': second[1], 'state': state()}


try:
    command(as_owner + [pg / 'initdb', '-D', work / 'data', '-A', 'trust', '-U', 'postgres'])
    command(as_owner + [pg / 'pg_ctl', '-D', work / 'data', '-o',
                        f"-k {sock} -p {PORT} -c listen_addresses='' -c deadlock_timeout=1s",
                        '-l', work / 'log', '-w', 'start'])
    command([pg / 'psql', '-X', '-qAt', '-h', sock, '-p', PORT, '-U', 'postgres', '-d', 'postgres',
             '-c', f'CREATE DATABASE {DB}'])
    run(SCHEMA)
    run(live('public.bump_daily_challenge_dashboard_revision()'))
    run(live('public.claim_daily_challenge_serialized_body(uuid,uuid,numeric)'))
    run(live('public.fn_ca_diamond_prune_history(integer,integer,integer)'))
    run(TRIGGERS)
    run(live_claim() + f";\nREVOKE ALL ON FUNCTION {SIG} FROM PUBLIC, anon, authenticated;"
        f"\nGRANT EXECUTE ON FUNCTION {SIG} TO service_role;")
    md5 = lambda: run(f"SELECT md5(pg_get_functiondef('{SIG}'::regprocedure))")
    check("the rebuilt horse claim is production's (md5 cc2313be...)", md5() == LIVE_MD5, md5())

    # ---- BEFORE ------------------------------------------------------------
    b1, b1_dead = case_1()
    print('BEFORE case 1:', json.dumps(b1))
    check('BEFORE case 1: the prune and the claim run deadlock, and the prune is cancelled (40P01)',
          b1_dead == 1 and b1['prune'][0] != 0 and 'deadlock detected' in b1['prune'][2], {'deadlocks': b1_dead, **b1})
    before_serial = serial()
    before_new = serial(horses=(N,), revisions=False)

    # ---- the migration, exactly as it ships --------------------------------
    run(CANDIDATE.read_text())
    check('the migration installs on the production text, as the pinned postimage', md5() == POST_MD5, md5())

    # ---- AFTER -------------------------------------------------------------
    a1, a1_dead = case_1()
    print('AFTER  case 1:', json.dumps(a1))
    check('AFTER case 1: no deadlock; the prune commits every abandoned row',
          a1_dead == 0 and a1['prune'][0] == 0 and a1['prune'][1].endswith('2'), {'deadlocks': a1_dead, **a1})
    check('AFTER case 1: the run pays the horse it could lock and leaves the busy one owed, not deferred',
          a1['claim'][0] == 0 and a1['claim'][1] == '1|0|0|t'
          and run('SELECT count(*) FROM public.ca_horse_claim_deferrals') == '0'
          and run(f"SELECT claimed FROM public.user_daily_challenges WHERE id = '{CLAIM[A]}'") == 'f', a1)
    rerun = attempt(CLAIM_RUN)
    check('AFTER case 1: the next run pays the horse it left, once', rerun[1] == '1|0|0|t', rerun)
    after_case_1 = state()
    check('AFTER case 1: every reward paid once and every change bumped once, as when done one at a time',
          after_case_1 == before_serial['state'], {'concurrent': after_case_1, 'serial': before_serial['state']})
    after_serial = serial()
    after_new = serial(horses=(N,), revisions=False)
    check('CASE 2: the same work one at a time: identical answers, rewards, journal, prunes and revisions',
          after_serial == before_serial, {'before': before_serial, 'after': after_serial})
    check('CASE 2: a horse with no revision row yet is still claimed, and its first row created, as before',
          after_new == before_new and after_new['first'] == '1|0|0|t'
          and after_new['state']['revisions'] == {N: 2}, {'before': before_new, 'after': after_new})
    print(json.dumps({'serial': before_serial, 'no_revision_row': after_new}, indent=1)[:2000])
    print(f'PROOF OK ({len(checks)} checks)')
finally:
    try:
        command(as_owner + [pg / 'pg_ctl', '-D', work / 'data', '-m', 'immediate', 'stop'])
    except Exception:
        pass
    shutil.rmtree(work, ignore_errors=True)
