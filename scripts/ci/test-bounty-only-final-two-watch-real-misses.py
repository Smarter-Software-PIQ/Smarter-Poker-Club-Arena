#!/usr/bin/env python3
"""Private PostgreSQL proof of 20261106105853 (the final two watch alerts only a real miss).

Owner rule: a tournament must never freeze, and a bounty only PKO ends with two
players. The EXACT watch migration (20261106032337) is installed first, then
the EXACT follow-up, over a minimal schema shaped like production's:

  * closed_without_final_two is raised (one critical alert) only when the field
    sat at exactly two (three or more entrants; second and third busted in
    different hands) and no refusal was recorded; an unknown bust hand still
    raises;
  * a field that went from three to one in one hand, a two player event and a
    recorded refusal raise nothing, while a refused event's pool is still
    judged (pool_not_closed_exactly);
  * every other breach kind and a clean close behave as before;
  * the refusals table is service_role only; the watch keeps its owner, ACL,
    config and SECURITY DEFINER; the preimage guard refuses a changed watch and
    a second install.
"""
from pathlib import Path
import hashlib, json, os, shutil, socket, subprocess, tempfile

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'supabase/migrations/20261106032337_bounty_only_final_two_payout_is_watched.sql'
MIG = ROOT / 'supabase/migrations/20261106105853_bounty_only_final_two_watch_alerts_only_real_misses.sql'
# Production's lane doctrine as installed (md5 9cd12c0b...), the preimage the
# migration adds the reviewed close to.
DOCTRINE = json.loads((ROOT / 'scripts/ci/fixtures/tournament-cancellation-lane/doctrine-postimage.json').read_text())
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
work = Path(tempfile.mkdtemp(prefix='final-two-misses-', dir=os.environ.get('TMPDIR')))
sock = Path(tempfile.mkdtemp(prefix='s-', dir=os.environ.get('CA_PG_SOCKET_ROOT', os.environ.get('TMPDIR'))))
port = None
tcp_guard = socket.socket()
started = False


def run(args, sql=None, timeout=120):
    r = subprocess.run([str(a) for a in args], input=sql, text=True, capture_output=True, timeout=timeout)
    if r.returncode:
        startup_log = work / 'postgres.log'
        diagnostic = startup_log.read_text() if startup_log.exists() else ''
        raise RuntimeError(r.stderr + '\n' + diagnostic)
    return r.stdout


def q(sql):
    return run([PG / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', port, '-U', 'postgres', '-d', 'w'], sql).strip()


SCHEMA = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.tournaments(
  id uuid PRIMARY KEY, name text, status text, is_pko boolean, is_mystery_bounty boolean,
  buy_in_amount numeric, guaranteed_prize numeric, prize_pool numeric,
  bounty_pool numeric(15,2), bounty_pool_paid numeric(15,2), ended_at timestamptz,
  updated_at timestamptz DEFAULT now());
CREATE TABLE public.tournament_players(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, user_id uuid,
  status text DEFAULT 'eliminated', position integer);
CREATE TABLE public.tournament_knockout_candidates(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, eliminated_user_id uuid,
  hand_id uuid, hand_number bigint, state text, created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE public.ca_bounty_only_final_two(
  tournament_id uuid PRIMARY KEY, winner_user_id uuid, runner_up_user_id uuid,
  winner_head numeric(15,2), runner_up_head numeric(15,2), created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE public.tournament_obligations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, kind text, place integer,
  user_id uuid, amount_owed numeric(15,2), amount_paid numeric(15,2));
CREATE TABLE public.tournament_bounty_completion_receipts(
  tournament_id uuid PRIMARY KEY, winner_user_id uuid, pool_finalized_at timestamptz, pool_result jsonb);
CREATE TABLE public.tournament_bounties(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, eliminated_player_id uuid,
  collector_player_id uuid, created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE public.wallet_transactions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), related_entity_id uuid, category text, type text, amount numeric(15,2));
CREATE TABLE public.financial_alerts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text NOT NULL CHECK (severity IN ('critical','warning','info')),
  source text NOT NULL, message text NOT NULL, context jsonb DEFAULT '{}', resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint
  LANGUAGE sql AS $$INSERT INTO cron.job(jobname,schedule,command) VALUES(p_name,p_schedule,p_command) RETURNING jobid$$;
CREATE FUNCTION cron.unschedule(p_jobid bigint) RETURNS boolean
  LANGUAGE sql AS $$DELETE FROM cron.job WHERE jobid=p_jobid RETURNING true$$;
"""

W, R, X = ('aa000000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000002',
           'cc000000-0000-0000-0000-000000000003')
LIVE = "now()"
n = [0]


def event(status='COMPLETED', ended=LIVE, pool=10, paid=10, wallet=10, entrants=(W, R, X), **over):
    n[0] += 1
    t = '7f000000-0000-0000-0000-0000000000%02d' % n[0]
    cols = dict(is_pko='true', is_mystery_bounty='false', buy_in_amount='0', guaranteed_prize='0', prize_pool='0')
    cols.update(over)
    q(f"""INSERT INTO tournaments(id,name,status,bounty_pool,bounty_pool_paid,ended_at,{','.join(cols)})
          VALUES ('{t}','Free Buy {n[0]}','{status}',{pool},{paid},{ended},{','.join(cols.values())});""")
    for u in entrants:
        q(f"INSERT INTO tournament_players(tournament_id,user_id) VALUES ('{t}','{u}');")
    if wallet:
        q(f"INSERT INTO wallet_transactions(related_entity_id,category,type,amount) VALUES ('{t}','bounty','credit',{wallet});")
    return t


def close(t, w_head=4, r_head=3, r_paid=3, residual=4, receipt=True, closed_at='clock_timestamp()'):
    q(f"""INSERT INTO ca_bounty_only_final_two(tournament_id,winner_user_id,runner_up_user_id,winner_head,runner_up_head,created_at)
          VALUES ('{t}','{W}','{R}',{w_head},{r_head},{closed_at});""")
    if r_paid is not None:
        q(f"""INSERT INTO tournament_obligations(tournament_id,kind,place,user_id,amount_owed,amount_paid)
              VALUES ('{t}','bounty_residual',NULL,'{R}',{r_paid},{r_paid});""")
    if receipt:
        q(f"""INSERT INTO tournament_bounty_completion_receipts(tournament_id,winner_user_id,pool_finalized_at,pool_result)
              VALUES ('{t}','{W}',now(),jsonb_build_object('ok',true,'residual',{residual},'paid_to','{W}'));""")


def scan():
    # The rule's go-live is a constant in the function; the proof pins its own.
    return int(q("SELECT public.fn_ca_bounty_only_final_two_watch(now() - interval '1 hour');"))


def breaches(t):
    return q(f"SELECT string_agg(breach, ',' ORDER BY breach) FROM ca_bounty_only_final_two_breaches WHERE tournament_id='{t}';")


def alerts(t):
    return int(q(f"""SELECT count(*) FROM financial_alerts WHERE source='fn_ca_bounty_only_final_two_watch'
                      AND severity='critical' AND context->>'tournament_id'='{t}';"""))



H1, H2, H3 = ('d1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002',
              'd3000000-0000-0000-0000-000000000003')


def finish(t, second_hand, third_hand):
    """Record who finished second (R) and third (X) and the hand each bust was in."""
    q(f"UPDATE tournament_players SET position=2 WHERE tournament_id='{t}' AND user_id='{R}';")
    q(f"UPDATE tournament_players SET position=3 WHERE tournament_id='{t}' AND user_id='{X}';")
    q(f"UPDATE tournament_players SET position=1, status='winner' WHERE tournament_id='{t}' AND user_id='{W}';")
    for u, h in ((R, second_hand), (X, third_hand)):
        if h is not None:
            q(f"""INSERT INTO tournament_knockout_candidates(tournament_id,eliminated_user_id,hand_id,state)
                  VALUES ('{t}','{u}','{h}','eliminated');""")


def refuse(t, reason='heads_do_not_match_the_open_pool'):
    q(f"INSERT INTO ca_bounty_only_final_two_refusals(tournament_id,reason) VALUES ('{t}','{reason}');")


def fn_state():
    return q("""SELECT p.proowner::regrole || '|' || p.proacl::text || '|' || to_jsonb(p.proconfig)::text || '|' || p.prosecdef
                  FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ca_bounty_only_final_two_watch(timestamptz)')""")


try:
    tcp_guard.bind(('127.0.0.1', 0))
    port = str(tcp_guard.getsockname()[1])
    shutil.rmtree(work / 'data', ignore_errors=True)
    run([PG / 'initdb', '-D', work / 'data', '-U', 'postgres', '-A', 'trust', '--no-locale'])
    run([PG / 'pg_ctl', '-D', work / 'data', '-l', work / 'postgres.log', '-o', f"-k {sock} -p {port} -c listen_addresses=''", '-w', 'start'])
    started = True
    run([PG / 'createdb', '-h', sock, '-p', port, '-U', 'postgres', 'w'])
    q(SCHEMA)
    assert hashlib.md5(DOCTRINE['definition'].encode()).hexdigest() == '9cd12c0b962d33af3c1193b890b8f898'
    q(DOCTRINE['definition'])
    q("REVOKE ALL ON FUNCTION public.fn_ca_settlement_lane_doctrine() FROM PUBLIC;"
      "GRANT EXECUTE ON FUNCTION public.fn_ca_settlement_lane_doctrine() TO service_role;")
    q(BASE.read_text())
    # The installed watch is byte for byte the production preimage the follow-up guards.
    assert q("SELECT md5(pg_get_functiondef('public.fn_ca_bounty_only_final_two_watch(timestamptz)'::regprocedure))") == 'd5d3d03c25baa6b97533ee1699827ec2'
    before_state = fn_state()
    q(MIG.read_text())
    assert fn_state() == before_state, (fn_state(), before_state)
    assert before_state == 'postgres|{postgres=X/postgres,service_role=X/postgres}|["search_path=public, pg_temp"]|true', before_state

    # The field sat at two and nothing closed it: a real miss.
    miss = event(); finish(miss, H1, H2)
    # An unknown bust hand is not proof of anything: still raised.
    unknown = event(); finish(unknown, None, None)
    # Three to one in a single hand: never sat at two.
    three_to_one = event(); finish(three_to_one, H3, H3)
    # Three to one in a single hand, plus a newer 'rebought' bust of second in
    # another hand: only a bust that ended the entry counts, so still quiet.
    rebought = event(); finish(rebought, H3, H3)
    q(f"""INSERT INTO tournament_knockout_candidates(tournament_id,eliminated_user_id,hand_id,state,created_at)
          VALUES ('{rebought}','{R}','{H1}','rebought', now() + interval '1 minute');""")
    # A two player event never has a bust that leaves two.
    pair = event(entrants=(W, R)); finish(pair, None, None)
    # Refused for a rule reason (or given up so the event never froze).
    refused = event(); finish(refused, H1, H2); refuse(refused)
    refused_pool = event(paid=9, wallet=9); finish(refused_pool, H1, H2); refuse(refused_pool, 'busts_not_settled; gave up after 12 tries in 55s')
    # Unchanged behaviour around it.
    clean = event(); close(clean)
    unpaid = event(); close(unpaid, r_paid=1.5)

    found = scan()
    assert breaches(miss) == 'closed_without_final_two', breaches(miss)
    assert breaches(unknown) == 'closed_without_final_two', breaches(unknown)
    for t in (three_to_one, rebought, pair, refused, clean):
        assert not breaches(t), (t, breaches(t))
    assert breaches(refused_pool) == 'pool_not_closed_exactly', breaches(refused_pool)
    assert breaches(unpaid) == 'runner_up_not_paid_own_head', breaches(unpaid)
    assert found == 4, found
    for t in (miss, unknown, refused_pool, unpaid):
        assert alerts(t) == 1, (t, alerts(t))
    for t in (three_to_one, rebought, pair, refused, clean):
        assert alerts(t) == 0, (t, alerts(t))
    # Dedupe still holds.
    assert scan() == 4 and int(q("SELECT count(*) FROM financial_alerts")) == 4

    # Authority over the new table: service_role writes it (engine upsert), clients never read it.
    for priv in ('select', 'insert', 'update'):
        assert q(f"SELECT has_table_privilege('service_role','public.ca_bounty_only_final_two_refusals','{priv}')") == 't', priv
    assert q("SELECT has_table_privilege('service_role','public.ca_bounty_only_final_two_refusals','delete')") == 'f'
    for role in ('anon', 'authenticated'):
        assert q(f"SELECT has_table_privilege('{role}','public.ca_bounty_only_final_two_refusals','select')") == 'f', role
        assert q(f"SELECT has_function_privilege('{role}','public.fn_ca_bounty_only_final_two_watch(timestamptz)','execute')") == 'f', role
    assert q("SELECT relrowsecurity FROM pg_class WHERE oid='public.ca_bounty_only_final_two_refusals'::regclass") == 't'
    # The engine's upsert shape (one row per event, the latest reason wins).
    q(f"""INSERT INTO ca_bounty_only_final_two_refusals(tournament_id,reason) VALUES ('{refused}','a_live_head_is_empty')
          ON CONFLICT (tournament_id) DO UPDATE SET reason = EXCLUDED.reason;""")
    assert q(f"SELECT reason FROM ca_bounty_only_final_two_refusals WHERE tournament_id='{refused}'") == 'a_live_head_is_empty'
    # Read-only toward money.
    assert q("SELECT count(*) FROM wallet_transactions WHERE category <> 'bounty'") == '0'

    # A second install is refused.
    try:
        q(MIG.read_text())
        raise AssertionError('second install was accepted')
    except RuntimeError as error:
        assert 'already installed' in str(error), str(error)
    # A watch that changed since it was read is refused, and nothing is left half done.
    q("DROP TABLE public.ca_bounty_only_final_two_refusals;")
    changed = q("SELECT pg_get_functiondef('public.fn_ca_bounty_only_final_two_watch(timestamptz)'::regprocedure)")
    q(changed.replace("v_found integer := 0;", "v_found integer := 0; -- drift"))
    try:
        q(MIG.read_text())
        raise AssertionError('a changed preimage was accepted')
    except RuntimeError as error:
        assert 'FINAL_TWO_WATCH_PREIMAGE_CHANGED' in str(error), str(error)
    assert q("SELECT to_regclass('public.ca_bounty_only_final_two_refusals') IS NULL") == 't'
    print('bounty only final two watch: only a real miss alerts; three to one, two player and refused events are quiet - OK')
finally:
    if started:
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(work / 'data'), '-m', 'immediate', 'stop'], capture_output=True)
    shutil.rmtree(work, ignore_errors=True)
    shutil.rmtree(sock, ignore_errors=True)
    tcp_guard.close()
